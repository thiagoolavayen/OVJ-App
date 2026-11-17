'use strict';
// Offline integration fixture. Excluded from packaged applications.
const { app, dialog, session } = require('electron');
const path = require('node:path');
if (!process.env.OVJ_SMOKE_PROFILE) throw new Error('Falta el perfil temporal para smoke.');
app.setPath('userData', path.resolve(process.env.OVJ_SMOKE_PROFILE));
const state = { dialogs: [], keys: [], imagePath: null, exportPath: null };
globalThis.__ovjSmoke = state;
app.on('web-contents-created', (_event, contents) => {
  contents.on('before-input-event', (_event, input) => state.keys.push(input));
});
dialog.showMessageBox = async (_window, options) => {
  state.dialogs.push(options.message);
  return { response: 0 };
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
  gameSession.protocol.handle('https', fixture);
  // Allows the opt-in adapter's own handler to be tested without a network.
  gameSession.fetch = async request => fixture(request);
});
require('../../src/main.cjs');
