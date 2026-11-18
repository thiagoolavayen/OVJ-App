'use strict';

const { fileURLToPath } = require('node:url');

const GAME_HOSTS = new Set(['www.haxball.com', 'haxball.com']);

function isGameUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && GAME_HOSTS.has(url.hostname) && !url.username && !url.password && !url.port;
  } catch { return false; }
}

function isExternalUrl(value) {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password;
  } catch { return false; }
}

function isSettingsSender(event, settingsWindow, settingsUrl) {
  if (!settingsWindow || settingsWindow.isDestroyed() || !event.senderFrame) return false;
  return event.sender === settingsWindow.webContents &&
    event.senderFrame === settingsWindow.webContents.mainFrame &&
    isSameLocalDocument(event.senderFrame.url, settingsUrl);
}

function isSameLocalDocument(actual, expected) {
  try {
    const urls = [new URL(actual), new URL(expected)];
    if (urls.some(url => url.protocol !== 'file:' || url.host || url.username || url.password || url.search || url.hash)) return false;
    // Node and Chromium serialize some filenames differently (notably ~ vs
    // %7E in Windows short paths). Compare the same decoded local path while
    // retaining the window/frame identity checks above. fileURLToPath rejects
    // encoded path separators rather than accepting a different document.
    return fileURLToPath(urls[0]) === fileURLToPath(urls[1]);
  } catch { return false; }
}

function validateIntervals(samples, maxSamples = 150000) {
  if (!Array.isArray(samples) || samples.length > maxSamples) return false;
  let previous = -Infinity;
  for (const sample of samples) {
    if (!Array.isArray(sample) || sample.length !== 2) return false;
    const [time, interval] = sample;
    if (!Number.isFinite(time) || !Number.isFinite(interval) || time < 0 || interval <= 0 || time <= previous || interval > 600000) return false;
    previous = time;
  }
  return true;
}

module.exports = { isGameUrl, isExternalUrl, isSettingsSender, validateIntervals };
