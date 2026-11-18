'use strict';
// Exercise the application inside app.asar against an offline game fixture.
// Only the external test entry stubs dialogs/transport. This does not validate
// a Windows installation, Discord, or a live HaxBall room.
const { _electron: electron, expect } = require('@playwright/test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const asar = require('@electron/asar');

async function createArchive(root, directory) {
  if (process.env.OVJ_SMOKE_APP_ASAR) {
    const archive = path.resolve(process.env.OVJ_SMOKE_APP_ASAR);
    assert.ok(fs.statSync(archive).isFile(), 'OVJ_SMOKE_APP_ASAR debe ser un archivo real.');
    return archive;
  }
  const stage = path.join(directory, 'package');
  fs.mkdirSync(stage);
  // Match the production file set from electron-builder.yml.
  for (const item of ['package.json', 'src', 'assets']) {
    fs.cpSync(path.join(root, item), path.join(stage, item), {
      recursive: true,
      filter: filename => !filename.endsWith('.map') && path.basename(filename) !== '.DS_Store',
    });
  }
  const archive = path.join(directory, 'app.asar');
  await asar.createPackage(stage, archive);
  const files = asar.listPackage(archive).map(filename => filename.replace(/\\/g, '/'));
  assert.ok(files.includes('/src/main.cjs'));
  assert.ok(files.includes('/src/settings-preload.cjs'));
  assert.ok(files.every(filename => !filename.startsWith('/test/') && !filename.startsWith('/tools/')));
  return archive;
}

async function clickMenu(application, pattern) {
  return application.evaluate(({ Menu, BrowserWindow }, source) => {
    const expression = new RegExp(source, 'i');
    function find(items) {
      for (const item of items) {
        if (!item.submenu && item.enabled && expression.test(item.label)) return item;
        const child = item.submenu && find(item.submenu.items);
        if (child) return child;
      }
      return null;
    }
    const item = find(Menu.getApplicationMenu()?.items || []);
    if (!item) throw new Error(`No se encontró el menú: ${source}`);
    const game = BrowserWindow.getAllWindows().find(window => /haxball\.com/.test(window.webContents.getURL()));
    item.click(item, game, {});
    return item.label;
  }, pattern);
}

async function openSettings(application, game, pattern = 'configuraci[oó]n') {
  const ready = application.waitForEvent('window', { predicate: page => page !== game });
  await clickMenu(application, pattern);
  const settings = await ready;
  await settings.waitForSelector('#competitive-mode');
  return settings;
}

(async () => {
  const root = path.resolve(__dirname, '..');
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'ovj-packaged-smoke-'));
  const profile = path.join(temporary, 'profile');
  fs.mkdirSync(profile);
  let application;
  let settings;
  try {
    const archive = await createArchive(root, temporary);
    const args = [path.join(root, 'test', 'fixtures', 'smoke-entry.cjs')];
    if (process.env.OVJ_TEST_NO_SANDBOX === '1') args.push('--no-sandbox');
    const launch = () => electron.launch({
      args,
      env: { ...process.env, OVJ_SMOKE_PROFILE: profile, OVJ_SMOKE_APP_ASAR: archive },
      timeout: 25000,
    });
    application = await launch();
    let game = await application.firstWindow();
    await game.frameLocator('iframe').locator('canvas').waitFor();
    assert.equal(await game.evaluate(() => typeof window.require), 'undefined');
    assert.equal(await game.evaluate(() => typeof window.ovj), 'undefined');
    const runtime = await application.evaluate(({ BrowserWindow, Menu }) => {
      const window = BrowserWindow.getAllWindows()[0];
      return {
        preferences: window.webContents.getLastWebPreferences(),
        menuVisible: window.isMenuBarVisible(),
        menuLabels: Menu.getApplicationMenu()?.items.map(item => item.label) || [],
        entry: globalThis.__ovjSmoke.applicationEntry,
      };
    });
    for (const [key, expected] of Object.entries({ nodeIntegration: false, contextIsolation: true, webSecurity: true, sandbox: true })) {
      assert.equal(runtime.preferences[key], expected, key);
    }
    assert.equal(runtime.menuVisible, true, 'Las funciones deben estar visibles en el menú del juego.');
    assert.ok(runtime.menuLabels.length > 0, 'Debe existir un menú nativo visible.');
    assert.ok(runtime.entry.startsWith(archive + path.sep), 'El código ejecutado debe provenir del ASAR.');

    settings = await openSettings(application, game, 'pelota');
    assert.ok(settings.url().includes('/app.asar/src/settings.html'), 'Ajustes deben abrirse desde el ASAR.');
    await expect(settings.locator('#ball-title')).toBeFocused();
    await expect(settings.locator('#competitive-mode')).toBeChecked();
    await expect(settings.locator('#mode-status')).toContainText('Modo torneo activo');
    await expect(settings.locator('#ball-enabled')).toBeDisabled();
    await expect(settings.locator('#benchmark-start')).toBeDisabled();
    await expect(settings.locator('#ad-blocking-enabled')).toBeChecked();
    await expect(settings.locator('#brand-logo')).toBeVisible();
    if (process.env.OVJ_SMOKE_SCREENSHOT) {
      await settings.evaluate(() => window.scrollTo(0, 0));
      await settings.screenshot({ path: path.resolve(process.env.OVJ_SMOKE_SCREENSHOT) });
    }

    // Import directly from default tournament mode. Native consent must enable
    // the image and leave the reload decision explicit, not silently block it.
    const imagePath = path.join(temporary, 'sample.png');
    await settings.locator('.app-header').screenshot({ path: imagePath });
    await application.evaluate((_electron, filename) => { globalThis.__ovjSmoke.imagePath = filename; }, imagePath);
    // Let the app own its optional visual-adapter handler after import. The
    // fixture's session.fetch replacement still prevents all live requests.
    await application.evaluate(({ session }) => session.fromPartition('persist:ovj-game').protocol.unhandle('https'));
    await settings.getByRole('button', { name: 'Pelota personalizada', exact: true }).click();
    await settings.locator('#choose-ball').click();
    await expect(settings.locator('#ball-name')).toHaveText('sample.png');
    await expect(settings.locator('#ball-preview')).toBeVisible();
    await expect(settings.locator('#ball-enabled')).toBeChecked();
    await expect(settings.locator('#reload-notice')).toBeVisible();
    await expect(settings.locator('#competitive-mode')).not.toBeChecked();
    await expect(settings.locator('#mode-status')).toContainText('Modo personal activo');
    const consent = await application.evaluate(() => globalThis.__ovjSmoke.dialogs.find(dialog => dialog.title === 'Activar diseño de pelota'));
    assert.match(consent.detail, /desactivar.*modo torneo/);
    assert.deepEqual(consent.buttons, ['Cancelar', 'Guardar para después', 'Aplicar y recargar']);

    // Drive real buttons/forms through the packaged preload, not direct IPC.
    await settings.getByRole('button', { name: 'Juego', exact: true }).click();
    await expect(settings.locator('#performance-title')).toBeFocused();
    await settings.locator('#ad-blocking-enabled').uncheck();
    await settings.getByRole('button', { name: 'Guardar preferencias', exact: true }).click();
    await expect.poll(async () => (await settings.evaluate(() => window.ovj.getState())).adBlocking.enabled).toBe(false);
    assert.equal(JSON.parse(fs.readFileSync(path.join(profile, 'settings.json'), 'utf8')).adBlockingEnabled, false);
    await settings.locator('#ad-blocking-enabled').check();
    await settings.getByRole('button', { name: 'Guardar preferencias', exact: true }).click();
    await expect.poll(async () => (await settings.evaluate(() => window.ovj.getState())).adBlocking.enabled).toBe(true);
    assert.equal(JSON.parse(fs.readFileSync(path.join(profile, 'settings.json'), 'utf8')).adBlockingEnabled, true);
    await settings.locator('#competitive-mode').check();
    await settings.getByRole('button', { name: 'Guardar preferencias', exact: true }).click();
    await expect(settings.locator('#mode-status')).toContainText('Modo torneo activo');
    await settings.locator('#competitive-mode').uncheck();
    await settings.getByRole('button', { name: 'Guardar preferencias', exact: true }).click();
    await expect(settings.locator('#mode-status')).toContainText('Modo personal activo');
    await settings.getByRole('button', { name: 'Discord', exact: true }).click();
    await expect(settings.locator('#discord-title')).toBeFocused();
    await settings.locator('#discord-enabled').uncheck();
    await settings.getByRole('button', { name: 'Guardar Discord', exact: true }).click();
    await expect(settings.locator('#success')).toContainText('Discord guardada');

    await settings.getByRole('button', { name: 'Pelota personalizada', exact: true }).click();
    await settings.locator('#remove-ball').click();
    await expect(settings.locator('#ball-empty')).toBeVisible();

    const webpPath = path.join(temporary, 'sample.webp');
    const encodedWebP = await settings.evaluate(() => {
      const canvas = document.createElement('canvas'); canvas.width = 12; canvas.height = 8;
      const context = canvas.getContext('2d'); context.fillStyle = '#f1b500'; context.fillRect(0, 0, 12, 8);
      return canvas.toDataURL('image/webp').split(',')[1];
    });
    fs.writeFileSync(webpPath, Buffer.from(encodedWebP, 'base64'));
    await application.evaluate((_electron, filename) => { globalThis.__ovjSmoke.imagePath = filename; }, webpPath);
    await settings.locator('#choose-ball').click();
    await expect(settings.locator('#ball-name')).toHaveText('sample.webp');
    await expect(settings.locator('#ball-preview')).toBeVisible();
    const imported = await settings.evaluate(() => window.ovj.getState());
    assert.equal(imported.error, null);
    assert.ok(imported.ballPreview.startsWith('data:image/png;base64,'), 'WebP debe convertirse realmente a PNG.');

    // A decoder's asynchronous false result must never claim the skin applied.
    // This hook exists only in the local fixture frame and is removed below.
    const gameFrame = game.frames().find(frame => /\/g\/game\.html/.test(frame.url()));
    assert.ok(gameFrame, 'Debe existir el frame offline del juego.');
    await gameFrame.evaluate(() => { window.__ovjSetBallSkin = () => Promise.resolve(false); });
    await settings.locator('#save-ball').click();
    await expect(settings.locator('#ball-status')).toHaveText('No se pudo decodificar el diseño. Se conserva la pelota original.');
    await gameFrame.evaluate(() => { delete window.__ovjSetBallSkin; });
    await settings.locator('#save-ball').click();
    await expect(settings.locator('#reload-notice')).toBeVisible();

    await settings.getByRole('button', { name: 'Diagnóstico', exact: true }).click();
    await expect(settings.locator('#diagnostics-title')).toBeFocused();
    const closedForCapture = settings.waitForEvent('close');
    await settings.locator('#benchmark-start').click().catch(error => { if (!settings.isClosed()) throw error; });
    await closedForCapture;
    await game.waitForTimeout(400);
    settings = await openSettings(application, game);
    await expect(settings.locator('#benchmark-stop')).toBeEnabled();
    await settings.locator('#benchmark-stop').click();
    await settings.waitForFunction(async () => !(await window.ovj.getState()).benchmark.active);
    const captured = await settings.evaluate(() => window.ovj.getState());
    assert.ok(captured.benchmark.samples > 1, 'El recolector debe devolver muestras reales de la fixture.');
    const exportPath = path.join(temporary, 'diagnostic.json');
    await application.evaluate((_electron, filename) => { globalThis.__ovjSmoke.exportPath = filename; }, exportPath);
    await settings.locator('#export-diagnostics').click();
    await expect.poll(() => fs.existsSync(exportPath)).toBe(true);
    const csvPath = exportPath.replace('.json', '-raf.csv');
    await expect.poll(() => fs.existsSync(csvPath)).toBe(true);
    const { parseCSV } = require('./analyze-benchmark.cjs');
    assert.ok(parseCSV(fs.readFileSync(csvPath, 'utf8')).length > 1);
    const saved = JSON.parse(fs.readFileSync(path.join(profile, 'settings.json'), 'utf8'));
    assert.equal(saved.competitiveMode, false);
    assert.equal(saved.discordEnabled, false);
    assert.equal(saved.ballEnabled, true);
    assert.equal(saved.ballSkinName, 'sample.webp');

    // A second Electron process verifies disk persistence, including image data.
    await application.close();
    application = await launch();
    game = await application.firstWindow();
    await game.frameLocator('iframe').locator('canvas').waitFor();
    settings = await openSettings(application, game, 'pelota');
    await expect(settings.locator('#competitive-mode')).not.toBeChecked();
    await expect(settings.locator('#discord-enabled')).not.toBeChecked();
    await expect(settings.locator('#ball-name')).toHaveText('sample.webp');
    await expect(settings.locator('#ball-preview')).toBeVisible();
    const restored = await settings.evaluate(() => window.ovj.getState());
    assert.equal(restored.error, null);
    assert.equal(restored.ballPreview, imported.ballPreview);
    const settingsClosed = settings.waitForEvent('close');
    await settings.locator('#close-settings').click().catch(error => { if (!settings.isClosed()) throw error; });
    await settingsClosed;
    console.log('PASS: app.asar real; menú visible, navegación y botones reales, aislamiento, preload/IPC, PNG/WebP, captura/exportación CSV/JSON y persistencia entre procesos. HaxBall es una fixture offline; no valida Windows, Discord ni una sala real.');
  } catch (error) {
    if (settings && !settings.isClosed()) console.error('Settings diagnostics:', await settings.evaluate(async () => {
      let apiResult;
      try {
        const state = await window.ovj?.getState();
        if (state) {
          const { ballPreview, brandLogo, ...details } = state;
          apiResult = { ...details, hasBallPreview: Boolean(ballPreview), hasBrandLogo: Boolean(brandLogo) };
        }
      }
      catch (failure) { apiResult = { rejection: String(failure?.stack || failure) }; }
      return {
        url: location.href, bridgeType: typeof window.ovj,
        error: document.getElementById('error')?.textContent,
        errorHidden: document.getElementById('error')?.hidden,
        mode: document.getElementById('mode-status')?.textContent,
        runtime: document.getElementById('runtime')?.textContent,
        apiResult,
      };
    }).catch(failure => ({ diagnosticFailure: String(failure) })));
    if (application) console.error(await application.evaluate(({ BrowserWindow, Menu }) => ({
      windows: BrowserWindow.getAllWindows().map(window => ({
        title: window.getTitle(), url: window.webContents.getURL(),
        mainFrameUrl: window.webContents.mainFrame.url,
        preload: window.webContents.getLastWebPreferences().preload,
      })),
      menuLabels: Menu.getApplicationMenu()?.items.map(item => item.label),
      dialogs: globalThis.__ovjSmoke?.dialogs,
      settingsExpectedUrl: globalThis.__ovjSmoke?.settingsExpectedUrl,
      ipcStateRequests: globalThis.__ovjSmoke?.ipcStateRequests.slice(-10),
      preloadErrors: globalThis.__ovjSmoke?.preloadErrors,
    })).catch(() => null));
    throw error;
  } finally {
    await application?.close();
    fs.rmSync(temporary, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
