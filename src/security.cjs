'use strict';

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
    event.senderFrame.url === settingsUrl;
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
