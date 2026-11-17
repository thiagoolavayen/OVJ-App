'use strict';
// Runs the actual Electron windows against a local fixture; no live game or
// Discord connection is claimed. On Linux containers only, the caller can opt
// into --no-sandbox for this harness. Production code always enables sandbox.
const { _electron: electron } = require('@playwright/test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');

(async () => {
  const root = path.resolve(__dirname, '..');
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'ovj-smoke-'));
  const args = [path.join(root, 'test', 'fixtures', 'smoke-entry.cjs')];
  if (process.env.OVJ_TEST_NO_SANDBOX === '1') args.push('--no-sandbox');
  let application;
  try {
    application = await electron.launch({ args, env: { ...process.env, OVJ_SMOKE_PROFILE: profile }, timeout: 25000 });
    const game = await application.firstWindow();
    await game.waitForSelector('iframe');
    await game.frameLocator('iframe').locator('canvas').waitFor();
    assert.equal(await game.evaluate(() => typeof window.require), 'undefined');
    assert.equal(await game.evaluate(() => typeof window.ovj), 'undefined');
    const preferences = await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences());
    assert.equal(preferences.nodeIntegration, false);
    assert.equal(preferences.contextIsolation, true);
    assert.equal(preferences.webSecurity, true);
    assert.equal(preferences.sandbox, true);
    let settingsReady = application.waitForEvent('window', { predicate: page => page !== game });
    await application.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0]; window.focus();
      window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'F10' });
      window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'F10' });
    });
    let settings = await settingsReady;
    await settings.waitForSelector('#competitive-mode:checked');
    let state = await settings.evaluate(() => window.ovj.saveSettings({ competitiveMode: false, discordEnabled: false }));
    assert.equal(state.settings.competitiveMode, false);
    state = await settings.evaluate(() => window.ovj.saveSettings({ fullscreen: 'invalid' }));
    assert.match(state.error, /booleano/);
    state = await settings.evaluate(() => window.ovj.getState());
    assert.equal(state.settings.fullscreen, false);
    const imagePath = path.join(profile, 'sample.png');
    await settings.locator('.app-header').screenshot({ path: imagePath });
    await application.evaluate((_electron, filename) => { globalThis.__ovjSmoke.imagePath = filename; }, imagePath);
    // Remove only the fixture handler; the app now installs its own optional
    // adapter handler. session.fetch remains the offline fixture transport.
    await application.evaluate(({ session }) => session.fromPartition('persist:ovj-game').protocol.unhandle('https'));
    state = await settings.evaluate(() => window.ovj.chooseBall());
    assert.ok(state.ballPreview.startsWith('data:image/png;base64,'));
    assert.equal(state.reloadRequired, true);
    state = await settings.evaluate(() => window.ovj.removeBall());
    assert.equal(state.ballPreview, null);
    const webpPath = path.join(profile, 'sample.webp');
    const encodedWebP = await settings.evaluate(() => {
      const canvas = document.createElement('canvas'); canvas.width = 12; canvas.height = 8;
      const context = canvas.getContext('2d'); context.fillStyle = '#f1b500'; context.fillRect(0, 0, 12, 8);
      return canvas.toDataURL('image/webp').split(',')[1];
    });
    fs.writeFileSync(webpPath, Buffer.from(encodedWebP, 'base64'));
    await application.evaluate((_electron, filename) => { globalThis.__ovjSmoke.imagePath = filename; }, webpPath);
    state = await settings.evaluate(() => window.ovj.chooseBall());
    assert.equal(state.error, null);
    assert.ok(state.ballPreview.startsWith('data:image/png;base64,'), 'WebP debe convertirse realmente a PNG.');
    state = await settings.evaluate(() => window.ovj.removeBall());
    assert.equal(state.ballPreview, null);
    await settings.evaluate(() => window.ovj.startBenchmark()).catch(() => {});
    // Starting a capture closes settings and returns focus to the game.
    await game.waitForTimeout(400);
    settingsReady = application.waitForEvent('window', { predicate: page => page !== game });
    await application.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0]; window.focus();
      window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'F10' });
      window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'F10' });
    });
    settings = await settingsReady;
    await settings.waitForSelector('#benchmark-stop:not([disabled])');
    await settings.evaluate(() => window.ovj.stopBenchmark());
    await settings.waitForFunction(async () => !(await window.ovj.getState()).benchmark.active);
    state = await settings.evaluate(() => window.ovj.getState());
    assert.ok(state.benchmark.samples > 1, 'El recolector debe devolver muestras reales de la fixture.');
    const exportPath = path.join(profile, 'diagnostic.json');
    await application.evaluate((_electron, filename) => { globalThis.__ovjSmoke.exportPath = filename; }, exportPath);
    state = await settings.evaluate(() => window.ovj.exportDiagnostics());
    assert.equal(state.error, null);
    assert.ok(fs.existsSync(exportPath));
    assert.ok(fs.existsSync(exportPath.replace('.json', '-raf.csv')));
    const { parseCSV } = require('./analyze-benchmark.cjs');
    assert.ok(parseCSV(fs.readFileSync(exportPath.replace('.json', '-raf.csv'), 'utf8')).length > 1);
    assert.equal(JSON.parse(fs.readFileSync(path.join(profile, 'settings.json'), 'utf8')).competitiveMode, false);
    const settingsClosed = settings.waitForEvent('close');
    await settings.keyboard.down('Escape').catch(error => { if (!settings.isClosed()) throw error; });
    await settingsClosed;
    console.log('PASS: ventanas Electron reales; aislamiento, IPC/configuración, importación PNG/WebP y quitar diseño, captura y exportación CSV/JSON, persistencia y cierre de ajustes. Juego/Discord son fixtures, no prueba de una sala real.');
  } catch (error) {
    if (application) console.error(await application.evaluate(({ BrowserWindow }) => ({
      windows: BrowserWindow.getAllWindows().map(window => ({ title: window.getTitle(), url: window.webContents.getURL() })),
      dialogs: globalThis.__ovjSmoke?.dialogs, keys: globalThis.__ovjSmoke?.keys
    })).catch(() => null));
    throw error;
  } finally {
    await application?.close();
    fs.rmSync(profile, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
