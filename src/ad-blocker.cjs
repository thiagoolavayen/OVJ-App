'use strict';

// Small, local list of advertising services. The current public /play page
// loads server.cpmstar.com/view.aspx inside its rightbar. Keep HaxBall, Google
// sign-in/reCAPTCHA, fonts and game transports outside this list.
const AD_DOMAINS = Object.freeze([
  'cpmstar.com',
  'doubleclick.net',
  'googlesyndication.com',
  'googleadservices.com',
  'googletagservices.com',
  'adservice.google.com',
]);

function shouldBlockAd(value, { enabled = true } = {}) {
  if (!enabled) return false;
  let url;
  try { url = new URL(value); } catch { return false; }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return false;
  // A final DNS dot denotes the same host. Match full DNS labels, never a
  // substring in the URL, query, path, user name or an unrelated hostname.
  const hostname = url.hostname.toLowerCase().replace(/\.$/, '');
  return AD_DOMAINS.some((domain) => hostname === domain || hostname.endsWith(`.${domain}`));
}

/** Install once on the dedicated game session, before loading HaxBall. */
function installAdBlocker(session, { isEnabled = () => true, onBlocked = () => {} } = {}) {
  if (!session?.webRequest || typeof session.webRequest.onBeforeRequest !== 'function') {
    throw new TypeError('An Electron game session is required');
  }
  if (typeof isEnabled !== 'function' || typeof onBlocked !== 'function') {
    throw new TypeError('Ad blocker callbacks must be functions');
  }
  // Chromium dispatches only these hosts, keeping the listener out of ordinary
  // game, room-list and authentication requests. This changes no responses.
  const urls = AD_DOMAINS.flatMap((domain) => [
    `*://*.${domain}/*`,
    `*://*.${domain}./*`,
  ]);
  session.webRequest.onBeforeRequest({ urls }, (details, callback) => {
    let enabled = false;
    try { enabled = Boolean(isEnabled()); } catch { /* Fail open if preferences fail. */ }
    const cancel = shouldBlockAd(details.url, { enabled });
    callback({ cancel });
    if (cancel) {
      try { onBlocked(details); } catch { /* A counter must never break a request. */ }
    }
  });
}

const AD_SLOT_STYLE_ID = 'ovj-ad-slot-style';
const AD_SLOT_CSS = 'body > .container > .rightbar { display: none !important; }';

/** Ordinary page code: collapse only the advertising sidebar on /play. */
function adSlotSource(enabled) {
  function setAdSlotHidden(hide, styleId, css) {
    if (location.protocol !== 'https:' || location.port || location.username || location.password ||
        !['www.haxball.com', 'haxball.com', 'html5.haxball.com'].includes(location.hostname) ||
        !/^\/play\/?$/.test(location.pathname)) return false;
    let style = document.getElementById(styleId);
    if (style && style.tagName !== 'STYLE') return false;
    if (!hide) {
      if (style) style.remove();
      return true;
    }
    const root = document.head || document.documentElement;
    if (!root) return false;
    if (!style) {
      style = document.createElement('style');
      style.id = styleId;
      style.textContent = css;
      root.appendChild(style);
    } else if (style.textContent !== css) {
      style.textContent = css;
    }
    return true;
  }
  return `(${setAdSlotHidden.toString()})(${Boolean(enabled)}, ${JSON.stringify(AD_SLOT_STYLE_ID)}, ${JSON.stringify(AD_SLOT_CSS)})`;
}

module.exports = { AD_DOMAINS, shouldBlockAd, installAdBlocker, AD_SLOT_STYLE_ID, AD_SLOT_CSS, adSlotSource };
