'use strict';
// Offline integration fixture. Excluded from packaged applications.
const { app, dialog, session, ipcMain, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
if (!process.env.OVJ_SMOKE_PROFILE) throw new Error('Falta el perfil temporal para smoke.');
if (!process.env.OVJ_SMOKE_APP_ASAR) throw new Error('Falta el app.asar para smoke.');
const archive = path.resolve(process.env.OVJ_SMOKE_APP_ASAR);
if (!require('original-fs').statSync(archive).isFile() || !archive.endsWith('.asar')) throw new Error('El smoke requiere un archivo ASAR real.');
const metadata = require(path.join(archive, 'package.json'));
const applicationEntry = path.resolve(archive, metadata.main);
if (!applicationEntry.startsWith(archive + path.sep)) throw new Error('Entrada del ASAR inválida.');
app.setAppPath(archive);
app.setPath('userData', path.resolve(process.env.OVJ_SMOKE_PROFILE));
const settingsExpectedUrl = pathToFileURL(path.join(path.dirname(applicationEntry), 'settings.html')).href;
const resolvedApplicationEntry = require.resolve(applicationEntry);
const resolvedSettingsUrl = pathToFileURL(path.join(path.dirname(resolvedApplicationEntry), 'settings.html')).href;
const state = {
  dialogs: [], keys: [], imagePath: null, exportPath: null, applicationEntry,
  settingsExpectedUrl, resolvedApplicationEntry, resolvedSettingsUrl, ipcStateRequests: [], preloadErrors: [],
};
globalThis.__ovjSmoke = state;
// Observe the real handler's authorization inputs without changing its result.
const nativeHandle = ipcMain.handle.bind(ipcMain);
ipcMain.handle = (channel, listener) => nativeHandle(channel, (event, ...args) => {
  if (channel === 'ovj:state') {
    const settings = BrowserWindow.getAllWindows().find(window => window.webContents.getURL().endsWith('/settings.html'));
    state.ipcStateRequests.push({
      senderIsSettings: event.sender === settings?.webContents,
      frameIsMain: event.senderFrame === settings?.webContents.mainFrame,
      senderUrl: event.senderFrame?.url,
      mainFrameUrl: settings?.webContents.mainFrame.url,
      urlMatchesExpected: event.senderFrame?.url === settingsExpectedUrl,
      resolvedSettingsUrl,
    });
  }
  return listener(event, ...args);
});
app.on('web-contents-created', (_event, contents) => {
  contents.on('before-input-event', (_event, input) => state.keys.push(input));
  contents.on('preload-error', (_event, preloadPath, error) => {
    state.preloadErrors.push({ preloadPath, error: String(error?.stack || error) });
  });
});
dialog.showMessageBox = async (_window, options) => {
  state.dialogs.push({ title: options.title, message: options.message, detail: options.detail, buttons: options.buttons });
  return { response: options.title === 'Activar diseño de pelota' ? 1 : 0 };
};
dialog.showOpenDialog = async () => state.imagePath ? { canceled: false, filePaths: [state.imagePath] } : { canceled: true, filePaths: [] };
dialog.showSaveDialog = async () => state.exportPath ? { canceled: false, filePath: state.exportPath } : { canceled: true };
const fixture = request => {
  const inGame = new URL(request.url).pathname.endsWith('/game.html');
  const body = inGame
    ? '<!doctype html><title>OVJ offline game fixture</title><canvas width="640" height="360"></canvas><script>const c=document.querySelector("canvas").getContext("2d");function tick(t){c.fillStyle="#245638";c.fillRect(0,0,640,360);c.fillStyle="white";c.beginPath();c.arc(320+Math.sin(t/1000)*50,180,10,0,Math.PI*2);c.fill();requestAnimationFrame(tick)}requestAnimationFrame(tick)</script>'
    : '<!doctype html><title>OVJ offline fixture</title><h1>Prueba de integración local</h1><iframe style="width:700px;height:450px" src="https://www.haxball.com/JPDEx8Ti/__cache_static__/g/game.html"></iframe>';
  return new Response(body, { headers: { 'content-type': 'text/html' } });
};
app.whenReady().then(() => {
  const gameSession = session.fromPartition('persist:ovj-game');
  let stored = {};
  try { stored = JSON.parse(fs.readFileSync(path.join(process.env.OVJ_SMOKE_PROFILE, 'settings.json'), 'utf8')); } catch { /* First run. */ }
  const visualAdapterEnabled = stored.ballEnabled && !stored.competitiveMode && fs.existsSync(path.join(process.env.OVJ_SMOKE_PROFILE, 'ball.png'));
  if (!visualAdapterEnabled) gameSession.protocol.handle('https', fixture);
  // Allows the opt-in adapter's own handler to be tested without a network.
  gameSession.fetch = async request => fixture(request);
});
require(applicationEntry);
