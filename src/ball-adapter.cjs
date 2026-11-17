'use strict';

const { createHash } = require('node:crypto');

const SUPPORTED_PATH = '/JPDEx8Ti/__cache_static__/g/game-min.js';
const SUPPORTED_SHA256 = '322d1904fc09896e5a16482f53e35a6e046c50a40c0270646305700b7420e885';
const SUPPORTED_BUILD = '0349dd60';
const MAX_SKIN_DATA_URL_LENGTH = 1024 * 1024;
const MAX_SKIN_DIMENSION = 1024;

// This is OVJ's own rendering adapter. It contains no HaxBall source or native API.
// Keep it self contained: it runs in the remote page's ordinary JavaScript world.
function installBallRuntime() {
  let activeImage = null;
  let generation = 0;
  const maxLength = 1024 * 1024;
  const maxDimension = 1024;

  function validPng(dataUrl) {
    if (typeof dataUrl !== 'string' || dataUrl.length > maxLength ||
        !/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(dataUrl)) return false;
    const encoded = dataUrl.slice(22);
    if (encoded.length % 4 !== 0 || encoded.length < 44) return false;
    try {
      const header = window.atob(encoded.slice(0, 44));
      const expected = [137, 80, 78, 71, 13, 10, 26, 10];
      for (let i = 0; i < expected.length; i += 1) {
        if (header.charCodeAt(i) !== expected[i]) return false;
      }
      if (header.slice(12, 16) !== 'IHDR') return false;
      const u32 = (offset) => (header.charCodeAt(offset) * 16777216) +
        (header.charCodeAt(offset + 1) << 16) +
        (header.charCodeAt(offset + 2) << 8) + header.charCodeAt(offset + 3);
      const width = u32(16);
      const height = u32(20);
      return width > 0 && height > 0 && width <= maxDimension && height <= maxDimension;
    } catch {
      return false;
    }
  }

  function setSkin(dataUrl) {
    const request = ++generation;
    activeImage = null;
    if (dataUrl === null) return Promise.resolve(true);
    if (!validPng(dataUrl)) return Promise.resolve(false);
    return new Promise((resolve) => {
      const image = new window.Image();
      image.onload = () => {
        if (request !== generation || image.naturalWidth < 1 || image.naturalHeight < 1 ||
            image.naturalWidth > maxDimension || image.naturalHeight > maxDimension) {
          resolve(false);
          return;
        }
        activeImage = image;
        resolve(true);
      };
      image.onerror = () => resolve(false);
      image.src = dataUrl;
    });
  }

  function drawBall(context, x, y, radius) {
    const image = activeImage;
    if (!image || !Number.isFinite(x) || !Number.isFinite(y) ||
        !Number.isFinite(radius) || radius <= 0) return false;
    let saved = false;
    try {
      // The original renderer's current path is the ball circle. Do not create
      // a new path: its original stroke must remain exactly as HaxBall draws it.
      context.save();
      saved = true;
      context.clip();
      const side = Math.min(image.naturalWidth, image.naturalHeight);
      context.drawImage(image,
        (image.naturalWidth - side) / 2, (image.naturalHeight - side) / 2, side, side,
        x - radius, y - radius, radius * 2, radius * 2);
      return true;
    } catch {
      return false;
    } finally {
      if (saved) {
        try { context.restore(); } catch { /* Never interrupt the game renderer. */ }
      }
    }
  }

  Object.defineProperty(window, '__ovjSetBallSkin', {
    value: setSkin, configurable: true, enumerable: false, writable: false,
  });
  Object.defineProperty(window, '__ovjDrawBall', {
    value: drawBall, configurable: true, enumerable: false, writable: false,
  });
}

// Preserve the game's original script-wide strict semantics even though its
// original directive now appears after OVJ's header.
const BALL_RUNTIME_SOURCE = `'use strict';\n;(${installBallRuntime.toString()})();\n`;

function isValidSkinDataUrl(dataUrl) {
  if (dataUrl === null) return true;
  if (typeof dataUrl !== 'string' || dataUrl.length > MAX_SKIN_DATA_URL_LENGTH ||
      !/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(dataUrl)) return false;
  const encoded = dataUrl.slice(22);
  if (encoded.length % 4 !== 0 || encoded.length < 44) return false;
  const header = Buffer.from(encoded.slice(0, 44), 'base64');
  if (header.length < 24 || !header.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ||
      header.toString('ascii', 12, 16) !== 'IHDR') return false;
  const width = header.readUInt32BE(16);
  const height = header.readUInt32BE(20);
  return width > 0 && height > 0 && width <= MAX_SKIN_DIMENSION && height <= MAX_SKIN_DIMENSION;
}

function isCandidateUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.port === '' && url.username === '' && url.password === '' &&
      ['www.haxball.com', 'haxball.com', 'html5.haxball.com'].includes(url.hostname) &&
      url.pathname === SUPPORTED_PATH;
  } catch {
    return false;
  }
}

/**
 * Transform only a byte-for-byte verified public HaxBall build, in memory.
 * Every failure returns the original script, without installing any adapter.
 * No runtime/download code is included in this module.
 */
function transformGameScript(input, { skinDataUrl = null } = {}) {
  if (typeof input !== 'string' && !Buffer.isBuffer(input)) {
    throw new TypeError('El script debe ser texto UTF-8 o Buffer.');
  }
  const source = Buffer.isBuffer(input) ? input.toString('utf8') : input;
  const digest = createHash('sha256').update(input).digest('hex');
  const fallback = (reason) => ({ supported: false, source, reason, build: null });
  if (digest !== SUPPORTED_SHA256) return fallback('unknown-build');
  if (!isValidSkinDataUrl(skinDataUrl)) return fallback('invalid-skin-data');

  // These are short, exact renderer fingerprints, not bundled game code.
  const replacements = [
    ['this.lm(g,null)', 'this.lm(g,null,g===e[0])'],
    ['lm(a,b){', 'lm(a,b,ovjBall){'],
    [':-1!=(a.S|0)&&this.c.fill(),this.c.stroke())}',
      ':-1!=(a.S|0)&&(this.c.fill(),ovjBall&&window.__ovjDrawBall?.(this.c,a.a.x,a.a.y,a.V)),this.c.stroke())}'],
  ];
  let patched = source;
  for (const [before, after] of replacements) {
    const first = patched.indexOf(before);
    if (first < 0 || patched.indexOf(before, first + before.length) >= 0) {
      return fallback('renderer-fingerprint-mismatch');
    }
    patched = patched.replace(before, after);
  }
  const initialSkin = `window.__ovjSetBallSkin(${JSON.stringify(skinDataUrl)});\n`;
  return {
    supported: true,
    source: BALL_RUNTIME_SOURCE + initialSkin + patched,
    reason: 'supported',
    build: SUPPORTED_BUILD,
  };
}

module.exports = {
  transformGameScript,
  isCandidateUrl,
  isValidSkinDataUrl,
  SUPPORTED_PATH,
  SUPPORTED_SHA256,
  SUPPORTED_BUILD,
  MAX_SKIN_DATA_URL_LENGTH,
  MAX_SKIN_DIMENSION,
  BALL_RUNTIME_SOURCE,
};
