'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const {
  transformGameScript, isCandidateUrl, isValidSkinDataUrl,
  SUPPORTED_PATH, MAX_SKIN_DATA_URL_LENGTH, BALL_RUNTIME_SOURCE,
} = require('../src/ball-adapter.cjs');

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWuAAAAAASUVORK5CYII=';

function runtime() {
  const images = [];
  class Image {
    constructor() {
      this.naturalWidth = 256;
      this.naturalHeight = 128;
      images.push(this);
    }
    set src(value) { this.url = value; }
  }
  const window = { Image, atob: (text) => Buffer.from(text, 'base64').toString('binary') };
  vm.runInNewContext(BALL_RUNTIME_SOURCE, { window });
  return { window, images };
}

async function loadSkin(window, images) {
  const pending = window.__ovjSetBallSkin(PNG);
  images.at(-1).onload();
  assert.equal(await pending, true);
}

function context({ failDraw = false } = {}) {
  const calls = [];
  return {
    calls,
    save() { calls.push(['save']); },
    clip() { calls.push(['clip']); },
    drawImage(...args) {
      calls.push(['drawImage', ...args]);
      if (failDraw) throw new Error('GPU/image failure');
    },
    restore() { calls.push(['restore']); },
    beginPath() { throw new Error('The original circle path must be retained'); },
    stroke() { throw new Error('Only the game draws the original stroke'); },
    fill() { throw new Error('Only the game draws the original fill'); },
  };
}

test('only the exact versioned script on an official HTTPS host is a candidate', () => {
  assert.equal(isCandidateUrl(`https://www.haxball.com${SUPPORTED_PATH}`), true);
  assert.equal(isCandidateUrl(`https://html5.haxball.com${SUPPORTED_PATH}?v=1`), true);
  for (const value of [
    `http://www.haxball.com${SUPPORTED_PATH}`,
    `https://www.haxball.com.evil.example${SUPPORTED_PATH}`,
    `https://evil.example${SUPPORTED_PATH}`,
    `https://www.haxball.com:8443${SUPPORTED_PATH}`,
    `https://user:password@www.haxball.com${SUPPORTED_PATH}`,
    'https://www.haxball.com/new-version/__cache_static__/g/game-min.js',
    'data:text/javascript,alert(1)', 'invalid',
  ]) assert.equal(isCandidateUrl(value), false, value);
});

test('prepending the adapter preserves the original game script strict semantics', () => {
  const window = { Image: class {}, atob() {} };
  const result = vm.runInNewContext(BALL_RUNTIME_SOURCE + '(function () { return this === undefined; })()', { window });
  assert.equal(result, true);
});

test('unknown or changed game bytes are returned intact with no adapter', () => {
  const source = "'use strict'; this.lm(g,null); function lm(a,b){}";
  for (const input of [source, Buffer.from(source), '', `${source}\n`]) {
    const result = transformGameScript(input, { skinDataUrl: PNG });
    assert.equal(result.supported, false);
    assert.equal(result.reason, 'unknown-build');
    assert.equal(result.source, String(input));
    assert.equal(result.build, null);
    assert.equal(result.source.includes('__ovjDrawBall'), false);
  }
  assert.throws(() => transformGameScript({ source }), TypeError);
});

test('image validation permits bounded PNG data and rejects URLs, SVG and oversized dimensions', () => {
  assert.equal(isValidSkinDataUrl(null), true);
  assert.equal(isValidSkinDataUrl(PNG), true);
  const hugeHeader = Buffer.from(PNG.slice(22), 'base64');
  hugeHeader.writeUInt32BE(32768, 16);
  const zeroHeader = Buffer.from(PNG.slice(22), 'base64');
  zeroHeader.writeUInt32BE(0, 20);
  const invalid = [
    'https://example.com/ball.png', 'file:///ball.png',
    'data:image/svg+xml;base64,PHN2Zz4=',
    'data:image/png;base64,AAAA',
    'data:image/png;base64,' + hugeHeader.toString('base64'),
    'data:image/png;base64,' + zeroHeader.toString('base64'),
    PNG + '\n', undefined, {},
    'data:image/png;base64,' + 'A'.repeat(MAX_SKIN_DATA_URL_LENGTH),
  ];
  for (const value of invalid) assert.equal(isValidSkinDataUrl(value), false);
});

test('runtime draws one center crop inside the original path and restores canvas state', async () => {
  const { window, images } = runtime();
  const ctx = context();
  assert.equal(window.__ovjDrawBall(ctx, 10, 20, 10), false);
  await loadSkin(window, images);
  assert.equal(window.__ovjDrawBall(ctx, 10, 20, 10), true);
  assert.deepEqual(ctx.calls.map((call) => call[0]), ['save', 'clip', 'drawImage', 'restore']);
  // 256×128 source is cropped to its middle 128×128 square and drawn at game coordinates.
  assert.deepEqual(ctx.calls[2].slice(2), [64, 0, 128, 128, 0, 10, 20, 20]);
  assert.equal(images[0].url, PNG);
});

test('clearing a skin invalidates an in-flight decode and restores original drawing', async () => {
  const { window, images } = runtime();
  const oldLoad = window.__ovjSetBallSkin(PNG);
  assert.equal(await window.__ovjSetBallSkin(null), true);
  images[0].onload();
  assert.equal(await oldLoad, false);
  const ctx = context();
  assert.equal(window.__ovjDrawBall(ctx, 0, 0, 10), false);
  assert.deepEqual(ctx.calls, []);
});

test('failed/invalid image decoding leaves no active drawing', async () => {
  const { window, images } = runtime();
  await loadSkin(window, images);
  const rejected = window.__ovjSetBallSkin('https://example.com/ball.png');
  assert.equal(await rejected, false);
  assert.equal(window.__ovjDrawBall(context(), 0, 0, 10), false);
  const failed = window.__ovjSetBallSkin(PNG);
  images.at(-1).onerror();
  assert.equal(await failed, false);
  assert.equal(window.__ovjDrawBall(context(), 0, 0, 10), false);
});

test('invalid geometry does not draw and a drawing failure still restores state', async () => {
  const { window, images } = runtime();
  await loadSkin(window, images);
  for (const args of [[0, 0, 0], [0, 0, -1], [NaN, 0, 10], [0, Infinity, 10]]) {
    const ctx = context();
    assert.equal(window.__ovjDrawBall(ctx, ...args), false);
    assert.deepEqual(ctx.calls, []);
  }
  const ctx = context({ failDraw: true });
  assert.equal(window.__ovjDrawBall(ctx, 0, 0, 10), false);
  assert.equal(ctx.calls.at(-1)[0], 'restore');
});

test('runtime and native-side preliminary PNG checks reject the same unsafe inputs', async () => {
  const { window, images } = runtime();
  for (const value of ['https://example.com/a.png', 'data:image/svg+xml;base64,PHN2Zz4=', PNG + '\n', '']) {
    assert.equal(await window.__ovjSetBallSkin(value), false);
  }
  assert.equal(images.length, 0);
});
