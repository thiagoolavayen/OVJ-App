'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { shouldBlockAd, installAdBlocker, AD_SLOT_STYLE_ID, AD_SLOT_CSS, adSlotSource } = require('../src/ad-blocker.cjs');

test('blocks the current HaxBall CPMStar bootstrap and known advertising services', () => {
  for (const url of [
    'https://server.cpmstar.com/view.aspx?poolid=26640&script=1&rnd=123',
    'http://cpmstar.com/view.aspx?poolid=26640',
    'https://SERVER.CPMSTAR.COM./view.aspx',
    'https://googleads.g.doubleclick.net/pagead/ads',
    'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-123',
    'https://www.googleadservices.com/pagead/conversion/123/',
    'https://securepubads.g.doubleclick.net/tag/js/gpt.js',
    'https://www.googletagservices.com/tag/js/gpt.js',
    'https://adservice.google.com/adsid/integrator.js',
  ]) assert.equal(shouldBlockAd(url), true, url);
});

test('preserves HaxBall, authentication, captcha, fonts and game transports', () => {
  for (const url of [
    'https://www.haxball.com/play',
    'https://www.haxball.com/JPDEx8Ti/__cache_static__/g/game-min.js',
    'https://html5.haxball.com/api/host',
    'https://www.haxball.com/api/ads',
    'https://www.haxball.com/?next=https://server.cpmstar.com/view.aspx',
    'https://accounts.google.com/o/oauth2/auth',
    'https://www.google.com/recaptcha/api.js',
    'https://www.recaptcha.net/recaptcha/api.js',
    'https://www.gstatic.com/recaptcha/releases/current/recaptcha__es.js',
    'https://fonts.googleapis.com/css?family=Open+Sans:400,600,700',
    'https://fonts.gstatic.com/s/opensans/v1/font.woff2',
    'wss://www.haxball.com/room',
    'stun:stun.l.google.com:19302',
    'turn:relay.example:3478',
    'wss://server.cpmstar.com/socket',
    'data:text/javascript,https://server.cpmstar.com/view.aspx',
    'file:///server.cpmstar.com/view.aspx',
    'not a URL',
    '',
  ]) assert.equal(shouldBlockAd(url), false, url);
});

test('matches DNS labels rather than substrings or credentials', () => {
  for (const url of [
    'https://server.cpmstar.com.evil.example/view.aspx',
    'https://notcpmstar.com/view.aspx',
    'https://doubleclick.net.evil.example/pagead/ads',
    'https://adservice.google.com.evil.example/adsid/integrator.js',
    'https://notadservice.google.com/adsid/integrator.js',
    'https://doubleclick.net@www.haxball.com/play',
    'https://server.cpmstar.com@accounts.google.com/signin',
    'https://example.com/doubleclick.net/pagead/ads',
    'https://example.com/?url=https://server.cpmstar.com/view.aspx',
  ]) assert.equal(shouldBlockAd(url), false, url);
  assert.equal(shouldBlockAd('https://www.haxball.com@server.cpmstar.com/view.aspx'), true);
});

test('disabled mode leaves even advertising requests alone', () => {
  assert.equal(shouldBlockAd('https://server.cpmstar.com/view.aspx', { enabled: false }), false);
  assert.equal(shouldBlockAd('https://googleads.g.doubleclick.net/pagead/ads', { enabled: false }), false);
});

function fakeSession() {
  const installs = [];
  return { installs, webRequest: { onBeforeRequest(...args) { installs.push(args); } } };
}

test('installs one narrow session listener and applies the preference on each request', () => {
  const session = fakeSession();
  const blocked = [];
  let enabled = true;
  installAdBlocker(session, { isEnabled: () => enabled, onBlocked: (request) => blocked.push(request.id) });
  assert.equal(session.installs.length, 1);
  const [filter, listener] = session.installs[0];
  assert.ok(filter.urls.includes('*://*.cpmstar.com/*'));
  assert.ok(filter.urls.includes('*://*.doubleclick.net/*'));
  assert.ok(filter.urls.includes('*://*.adservice.google.com/*'));
  assert.equal(filter.urls.some((url) => ['<all_urls>', '*://*/*', '*://*.google.com/*'].includes(url)), false);
  const responses = [];
  const request = { id: 7, url: 'https://server.cpmstar.com/view.aspx?poolid=26640', resourceType: 'script' };
  listener(request, (result) => responses.push(result));
  enabled = false;
  listener({ ...request, id: 8 }, (result) => responses.push(result));
  enabled = true;
  listener({ id: 9, url: 'https://accounts.google.com/signin' }, (result) => responses.push(result));
  assert.deepEqual(responses, [{ cancel: true }, { cancel: false }, { cancel: false }]);
  assert.deepEqual(blocked, [7]);
});

test('callback errors cannot prevent the network callback and preference errors fail open', () => {
  const session = fakeSession();
  installAdBlocker(session, { onBlocked() { throw new Error('Counter unavailable'); } });
  const responses = [];
  session.installs[0][1]({ url: 'https://server.cpmstar.com/view.aspx' }, (result) => responses.push(result));
  assert.deepEqual(responses, [{ cancel: true }]);
  const second = fakeSession();
  installAdBlocker(second, { isEnabled() { throw new Error('Preferences unavailable'); } });
  second.installs[0][1]({ url: 'https://server.cpmstar.com/view.aspx' }, (result) => responses.push(result));
  assert.deepEqual(responses, [{ cancel: true }, { cancel: false }]);
});

test('rejects an invalid session or invalid hook before registering a listener', () => {
  assert.throws(() => installAdBlocker(null), TypeError);
  assert.throws(() => installAdBlocker({}), TypeError);
  const session = fakeSession();
  assert.throws(() => installAdBlocker(session, { isEnabled: false }), TypeError);
  assert.throws(() => installAdBlocker(session, { onBlocked: true }), TypeError);
  assert.equal(session.installs.length, 0);
});

function pageFixture(url = 'https://www.haxball.com/play') {
  const children = [];
  const document = {
    head: { appendChild(node) { children.push(node); } },
    getElementById(id) { return children.find((node) => node.id === id) || null; },
    createElement(tag) {
      return {
        tagName: tag.toUpperCase(), textContent: '',
        remove() { const index = children.indexOf(this); if (index !== -1) children.splice(index, 1); },
      };
    },
  };
  const context = { document, location: new URL(url) };
  return { children, document, run(enabled) { return vm.runInNewContext(adSlotSource(enabled), context); } };
}

test('ad slot toggle inserts one style and removes it without altering page content', () => {
  const page = pageFixture();
  assert.equal(page.run(false), true);
  assert.equal(page.children.length, 0);
  assert.equal(page.run(true), true);
  assert.equal(page.run(true), true);
  assert.equal(page.children.length, 1);
  assert.equal(page.children[0].tagName, 'STYLE');
  assert.equal(page.children[0].id, AD_SLOT_STYLE_ID);
  assert.equal(page.children[0].textContent, AD_SLOT_CSS);
  page.children[0].textContent = 'outdated';
  assert.equal(page.run(true), true);
  assert.equal(page.children[0].textContent, AD_SLOT_CSS);
  assert.equal(page.run(false), true);
  assert.equal(page.children.length, 0);
  assert.equal(page.run(false), true);
  assert.equal(page.run(true), true);
  assert.equal(page.children.length, 1);
});

test('ad slot style targets only the verified sidebar, with no game sizing rules or APIs', () => {
  assert.equal(AD_SLOT_CSS, 'body > .container > .rightbar { display: none !important; }');
  assert.doesNotMatch(adSlotSource(true), /\bcanvas\b|\biframe\b|width\s*:|height\s*:|innerHTML|replaceChildren|fetch\s*\(|WebSocket|RTCPeerConnection|require\s*\(|ipcRenderer|\.prototype|addEventListener|setTimeout|setInterval|MutationObserver|eval\s*\(/);
});

test('ad slot source accepts official HTTPS play pages and rejects game frames and other documents', () => {
  for (const url of ['https://www.haxball.com/play', 'https://haxball.com/play/',
    'https://html5.haxball.com/play?x=1']) {
    const page = pageFixture(url);
    assert.equal(page.run(true), true, url);
    assert.equal(page.children.length, 1, url);
  }
  for (const url of ['https://example.com/play', 'https://www.haxball.com.evil.example/play',
    'http://www.haxball.com/play', 'https://www.haxball.com:8443/play',
    'https://user:password@www.haxball.com/play', 'file:///play',
    'https://www.haxball.com/JPDEx8Ti/__cache_static__/g/game.html',
    'https://www.haxball.com/community', 'https://www.haxball.com/play/other',
    'https://www.haxball.com/Play']) {
    const page = pageFixture(url);
    assert.equal(page.run(true), false, url);
    assert.equal(page.run(false), false, url);
    assert.equal(page.children.length, 0, url);
  }
});

test('ad slot injection leaves unrelated elements sharing its id intact', () => {
  const page = pageFixture();
  page.children.push({ id: AD_SLOT_STYLE_ID, tagName: 'DIV', textContent: 'existing' });
  assert.equal(page.run(true), false);
  assert.equal(page.run(false), false);
  assert.equal(page.children.length, 1);
  assert.equal(page.children[0].textContent, 'existing');
});
