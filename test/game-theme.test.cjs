'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { GAME_THEME_CSS, THEME_STYLE_ID, frameThemeSource } = require('../src/game-theme.cjs');

function fixture(url = 'https://www.haxball.com/JPDEx8Ti/__cache_static__/g/game.html') {
  const children = [];
  const document = {
    head: { appendChild(node) { children.push(node); } },
    getElementById(id) { return children.find(node => node.id === id) || null; },
    createElement(tag) { return { tagName: tag.toUpperCase(), textContent: '' }; },
  };
  const context = { document, location: new URL(url) };
  return { children, document, context, run() { return vm.runInNewContext(frameThemeSource(), context); } };
}

test('the theme contains only color properties and removes the decorative page background', () => {
  const allowed = new Set(['background-color', 'background-image', 'color', 'color-scheme',
    'border-color', 'border-bottom-color', 'caret-color', 'accent-color']);
  for (const block of GAME_THEME_CSS.matchAll(/\{([^{}]*)\}/g)) {
    for (const declaration of block[1].split(';').map(value => value.trim()).filter(Boolean)) {
      const property = declaration.slice(0, declaration.indexOf(':')).trim();
      assert.ok(allowed.has(property), `Unexpected property: ${property}`);
    }
  }
  assert.match(GAME_THEME_CSS, /background-image:\s*none/);
  assert.doesNotMatch(GAME_THEME_CSS, /url\s*\(|@import|@font-face|@keyframes|\bcanvas\b|\bfilter\s*:/i);
});

test('team colors, game objects and semantic alerts have no targeted replacement', () => {
  assert.doesNotMatch(GAME_THEME_CSS, /\.teamicon|\.t-red|\.t-blue|\.flagico|\.flashtag|\.notice\s*\{|\.admin\s*\[|\[data-hook=rec-btn\]/);
  for (const rule of GAME_THEME_CSS.split('}')) {
    if (!rule.includes('{')) continue;
    const selector = rule.slice(0, rule.indexOf('{'));
    if (selector.includes('button:not(')) {
      assert.match(selector, /:not\(\[data-hook=start-btn\]\)/);
      assert.match(selector, /:not\(\[data-hook=stop-btn\]\)/);
    }
  }
});

test('injection is idempotent and adds only one style element', () => {
  const page = fixture();
  assert.equal(page.run(), true);
  assert.equal(page.run(), true);
  assert.equal(page.children.length, 1);
  assert.equal(page.children[0].id, THEME_STYLE_ID);
  assert.equal(page.children[0].tagName, 'STYLE');
  assert.equal(page.children[0].textContent, GAME_THEME_CSS);
  page.children[0].textContent = 'old theme';
  assert.equal(page.run(), true);
  assert.equal(page.children.length, 1);
  assert.equal(page.children[0].textContent, GAME_THEME_CSS);
});

test('injection rejects unrelated, insecure and unexpected-origin documents', () => {
  for (const url of ['https://example.com/', 'https://www.haxball.com.evil.example/',
    'http://www.haxball.com/play', 'https://www.haxball.com:8443/play',
    'https://user:password@www.haxball.com/play', 'file:///settings.html']) {
    const page = fixture(url);
    assert.equal(page.run(), false, url);
    assert.equal(page.children.length, 0);
  }
});

test('injection leaves an unrelated node with the same ID intact', () => {
  const page = fixture();
  page.children.push({ id: THEME_STYLE_ID, tagName: 'DIV', textContent: 'existing' });
  assert.equal(page.run(), false);
  assert.equal(page.children[0].textContent, 'existing');
});

test('runtime has no timers, input hooks, networking, native bridge or prototype changes', () => {
  assert.doesNotMatch(frameThemeSource(), /requestAnimationFrame|setTimeout|setInterval|MutationObserver|addEventListener|\.prototype|fetch\s*\(|WebSocket|RTCPeerConnection|require\s*\(|ipcRenderer|keydown|keyup|innerHTML|eval\s*\(/);
});
