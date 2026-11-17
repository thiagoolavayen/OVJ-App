'use strict';

const { app, BrowserWindow, Menu, ipcMain, dialog, shell, nativeImage, nativeTheme, webFrameMain } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { ConfigStore, atomicWrite } = require('./config.cjs');
const { isGameUrl, isExternalUrl, isSettingsSender, validateIntervals } = require('./security.cjs');
const { createDiscordPresence } = require('./discord.cjs');
const { isCandidateUrl, transformGameScript } = require('./ball-adapter.cjs');
const { BENCHMARK_SOURCE, STOP_BENCHMARK_SOURCE } = require('./benchmark-collector.cjs');
const { webPDecoderSource } = require('./image-decoder.cjs');
const { frameThemeSource } = require('./game-theme.cjs');

app.setName('OVJ App');
app.enableSandbox();
const startedAt = Date.now();
const store = new ConfigStore(app.getPath('userData'));
let cachedSkinDataUrl = store.skinDataUrl();
const accelerationAtStartup = store.get().hardwareAcceleration;
if (!accelerationAtStartup) app.disableHardwareAcceleration();

let gameWindow = null;
let settingsWindow = null;
let presence = null;
let quitting = false;
let cleanupDone = false;
let gameSession = null;
let lastError = store.error;
let ballStatus = 'Diseño original de HaxBall.';
let reloadRequired = false;
let skinAppliedToLoad = false;
let skinProtocolInstalled = false;
let benchmarkFrame = null;
let benchmarkTimeout = null;
let benchmarkActive = false;
let benchmarkSamples = [];
let benchmarkStartedAt = null;
let benchmarkGeneration = 0;
let benchmarkPending = false;
let failureDialogOpen = false;
let brandLogoData = null;
const settingsUrl = pathToFileURL(path.join(__dirname, 'settings.html')).href;
const gameUrl = 'https://www.haxball.com/play';

function appIcon() {
  const icon = path.join(__dirname, '..', 'assets', process.platform === 'win32' ? 'icon.ico' : 'logo.png');
  return fs.existsSync(icon) ? icon : undefined;
}

function readBrandLogo() {
  const filename = path.join(__dirname, '..', 'assets', 'logo.png');
  try {
    if (fs.statSync(filename).size > 8 * 1024 * 1024) return null;
    const bytes = fs.readFileSync(filename);
    if (!bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) return null;
    return `data:image/png;base64,${bytes.toString('base64')}`;
  } catch { return null; }
}

function currentState() {
  const discord = presence?.status();
  return {
    settings: store.get(),
    ballPreview: cachedSkinDataUrl,
    brandLogo: brandLogoData,
    discordStatus: discord?.detail || 'Integración de Discord iniciándose.',
    ballStatus,
    benchmark: { active: benchmarkActive || benchmarkPending, samples: benchmarkSamples.length },
    runtime: {
      appVersion: app.getVersion(), electron: process.versions.electron,
      chromium: process.versions.chrome, node: process.versions.node, platform: process.platform
    },
    restartRequired: store.get().hardwareAcceleration !== accelerationAtStartup,
    reloadRequired,
    error: lastError
  };
}

function notify() {
  if (settingsWindow && !settingsWindow.isDestroyed()) settingsWindow.webContents.send('ovj:state-changed', currentState());
}

function reportError(error) {
  lastError = error instanceof Error ? error.message : String(error);
  notify();
}

function showSettings() {
  if (!gameWindow || gameWindow.isDestroyed()) return;
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.show();
    settingsWindow.focus();
    return;
  }
  settingsWindow = new BrowserWindow({
    width: 670, height: 830, minWidth: 480, minHeight: 500,
    backgroundColor: '#080808',
    title: 'Configuración · OVJ App', parent: gameWindow, show: false,
    autoHideMenuBar: true, icon: appIcon(),
    webPreferences: {
      preload: path.join(__dirname, 'settings-preload.cjs'),
      contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true,
      devTools: !app.isPackaged, spellcheck: false
    }
  });
  settingsWindow.setMenu(null);
  settingsWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  settingsWindow.webContents.on('will-navigate', event => event.preventDefault());
  settingsWindow.webContents.on('will-redirect', event => event.preventDefault());
  settingsWindow.webContents.session.setPermissionCheckHandler(() => false);
  settingsWindow.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  settingsWindow.once('ready-to-show', () => settingsWindow?.show());
  settingsWindow.on('closed', () => {
    settingsWindow = null;
    if (!quitting && gameWindow && !gameWindow.isDestroyed()) gameWindow.focus();
  });
  settingsWindow.loadFile(path.join(__dirname, 'settings.html')).catch(reportError);
}

async function confirmExternal(url) {
  if (!isExternalUrl(url) || !gameWindow || gameWindow.isDestroyed()) return;
  const result = await dialog.showMessageBox(gameWindow, {
    type: 'question', title: 'Abrir enlace externo',
    message: '¿Abrir este enlace en tu navegador predeterminado?',
    detail: url.slice(0, 1500), buttons: ['Cancelar', 'Abrir enlace'], defaultId: 0, cancelId: 0
  });
  if (result.response === 1) await shell.openExternal(url);
}

function effectiveSkin() {
  const settings = store.get();
  return settings.ballEnabled && !settings.competitiveMode ? cachedSkinDataUrl : null;
}

async function updateSkinInGame() {
  const data = effectiveSkin();
  configureSkinProtocol();
  if (!gameWindow || gameWindow.isDestroyed()) return;
  if (!data && !skinAppliedToLoad) {
    reloadRequired = false;
    ballStatus = store.get().competitiveMode
      ? 'Modo competitivo: juego original; las imágenes personales están desactivadas.'
      : 'Diseño original de HaxBall.';
    notify();
    return;
  }
  let found = false;
  for (const frame of gameWindow.webContents.mainFrame.framesInSubtree) {
    if (!isGameUrl(frame.url)) continue;
    try {
      const result = await frame.executeJavaScript(
        `typeof window.__ovjSetBallSkin === 'function' ? (window.__ovjSetBallSkin(${JSON.stringify(data)}), true) : false`, false
      );
      found ||= result === true;
    } catch { /* El frame puede cambiar al abandonar una sala. */ }
  }
  if (data && !found) {
    reloadRequired = true;
    ballStatus = 'Diseño guardado. Recargá HaxBall para comprobar compatibilidad y aplicarlo.';
  } else if (!data) {
    reloadRequired = skinAppliedToLoad;
    ballStatus = store.get().competitiveMode
      ? (skinAppliedToLoad ? 'Imagen desactivada. Recargá para retirar el adaptador y usar el juego íntegro en modo competitivo.' : 'Modo competitivo: juego original; las imágenes personales están desactivadas.')
      : 'Diseño original de HaxBall.';
  } else {
    reloadRequired = false;
    ballStatus = 'Adaptador compatible cargado. El diseño se muestra cuando la imagen termina de decodificarse.';
  }
  notify();
}

function installSessionPolicies() {
  const session = gameSession;
  session.setPermissionCheckHandler((contents, permission, origin) =>
    contents === gameWindow?.webContents && permission === 'fullscreen' && isGameUrl(origin));
  session.setPermissionRequestHandler((contents, permission, callback, details) => {
    const origin = details.requestingUrl || contents.getURL();
    callback(contents === gameWindow?.webContents && permission === 'fullscreen' && isGameUrl(origin));
  });
  session.setDisplayMediaRequestHandler((_request, callback) => callback({}));
  session.on('will-download', (event, item) => {
    const extension = path.extname(item.getFilename()).toLowerCase();
    if (!['.hbr2', '.hbs', '.txt'].includes(extension)) {
      event.preventDefault();
      reportError('Solo se permiten descargas de repeticiones (.hbr2), estadios (.hbs) y texto (.txt).');
      return;
    }
    item.setSaveDialogOptions({
      title: 'Guardar archivo de HaxBall',
      defaultPath: path.join(app.getPath('downloads'), path.basename(item.getFilename())),
      filters: [{ name: 'Archivo de HaxBall', extensions: [extension.slice(1)] }]
    });
  });
  configureSkinProtocol();
}

function configureSkinProtocol() {
  if (!gameSession) return;
  if (!effectiveSkin()) {
    if (skinProtocolInstalled) {
      gameSession.protocol.unhandle('https');
      skinProtocolInstalled = false;
    }
    return;
  }
  if (skinProtocolInstalled) return;
  // Solo el modo visual opcional reenvía recursos; el modo competitivo conserva
  // el camino de red nativo. Los redirects quedan visibles para Chromium.
  gameSession.protocol.handle('https', async request => {
    const response = await gameSession.fetch(request, { bypassCustomProtocolHandlers: true, redirect: 'manual' });
    if (!isCandidateUrl(request.url) || !effectiveSkin() || !response.ok) return response;
    try {
      const declaredLength = Number(response.headers.get('content-length'));
      if (declaredLength > 2 * 1024 * 1024) throw new Error('Script de HaxBall demasiado grande para el adaptador visual.');
      const source = await response.clone().text();
      if (Buffer.byteLength(source) > 2 * 1024 * 1024) throw new Error('Script de HaxBall demasiado grande para el adaptador visual.');
      const transformed = transformGameScript(source, { skinDataUrl: effectiveSkin() });
      if (!transformed.supported) {
        ballStatus = 'Esta versión de HaxBall no es compatible con el diseño. Se conserva la pelota original.';
        notify();
        return response;
      }
      const headers = new Headers(response.headers);
      for (const header of ['content-length', 'content-encoding', 'etag', 'last-modified', 'content-md5']) headers.delete(header);
      headers.set('content-type', 'application/javascript; charset=utf-8');
      headers.set('cache-control', 'no-store');
      skinAppliedToLoad = true;
      ballStatus = `Adaptador visual compatible con la versión ${transformed.build}.`;
      reloadRequired = false;
      notify();
      return new Response(transformed.source, { status: response.status, statusText: response.statusText, headers });
    } catch (error) {
      ballStatus = `Se conserva la pelota original: ${error.message}`;
      notify();
      return response;
    }
  });
  skinProtocolInstalled = true;
}

async function gameFailure(message) {
  if (failureDialogOpen || quitting || !gameWindow || gameWindow.isDestroyed()) return;
  finishBenchmark();
  failureDialogOpen = true;
  try {
    const result = await dialog.showMessageBox(gameWindow, {
      type: 'error', title: 'OVJ App · HaxBall', message,
      detail: 'Recargar puede abandonar la sala actual. También podés revisar la configuración.',
      buttons: ['Configuración', 'Recargar HaxBall', 'Cerrar'], defaultId: 0, cancelId: 2
    });
    if (!gameWindow || gameWindow.isDestroyed()) return;
    if (result.response === 0) showSettings();
    else if (result.response === 1) gameWindow.webContents.reload();
    else if (result.response === 2) gameWindow.close();
  } finally { failureDialogOpen = false; }
}

function createGameWindow() {
  gameWindow = new BrowserWindow({
    width: 1280, height: 800, minWidth: 800, minHeight: 600,
    backgroundColor: '#080808', title: 'OVJ App · Ovejeros FC',
    icon: appIcon(), fullscreen: store.get().fullscreen,
    autoHideMenuBar: true, show: false,
    webPreferences: {
      partition: 'persist:ovj-game',
      nodeIntegration: false, nodeIntegrationInSubFrames: false, contextIsolation: true,
      sandbox: true, webSecurity: true, allowRunningInsecureContent: false,
      spellcheck: false, devTools: !app.isPackaged,
      backgroundThrottling: true
    }
  });
  gameWindow.setMenu(null);
  gameSession = gameWindow.webContents.session;
  installSessionPolicies();
  const contents = gameWindow.webContents;
  contents.setWindowOpenHandler(({ url }) => {
    if (isGameUrl(url) && new URL(url).pathname.replace(/\/$/, '') === '/play') {
      dialog.showMessageBox(gameWindow, {
        type: 'question', message: '¿Abrir esta sala en OVJ App?', detail: 'Esto puede abandonar la sala actual.',
        buttons: ['Cancelar', 'Abrir sala'], defaultId: 0, cancelId: 0
      }).then(result => { if (result.response === 1 && !contents.isDestroyed()) contents.loadURL(url).catch(reportError); }).catch(reportError);
    } else confirmExternal(url).catch(reportError);
    return { action: 'deny' };
  });
  for (const eventName of ['will-navigate', 'will-redirect']) contents.on(eventName, (event, url, _inPlace, isMainFrame) => {
    if (eventName === 'will-redirect' && isMainFrame === false) return;
    if (!isGameUrl(url)) { event.preventDefault(); confirmExternal(url).catch(reportError); }
  });
  contents.on('will-attach-webview', event => event.preventDefault());
  gameWindow.on('page-title-updated', event => event.preventDefault());
  contents.on('did-frame-finish-load', (_event, _mainFrame, processId, routingId) => {
    try {
      const frame = webFrameMain.fromId(processId, routingId);
      if (frame && isGameUrl(frame.url)) frame.executeJavaScript(frameThemeSource(), false).catch(() => {});
    } catch { /* Un cambio de documento puede destruir el frame entre eventos. */ }
  });
  contents.on('did-start-navigation', (_event, _url, _inPlace, isMainFrame) => {
    if (isMainFrame) {
      finishBenchmark();
      skinAppliedToLoad = false;
      ballStatus = effectiveSkin() ? 'Comprobando la versión de HaxBall…' : 'Diseño original de HaxBall.';
    }
  });
  contents.on('did-finish-load', () => {
    gameWindow?.show();
    if (!effectiveSkin()) reloadRequired = false;
    if (effectiveSkin() && !skinAppliedToLoad) ballStatus = 'Adaptador visual no aplicado. Se conserva el diseño original de HaxBall.';
    notify();
  });
  contents.on('did-fail-load', (_event, code, description, _url, isMainFrame) => {
    if (isMainFrame && code !== -3) {
      gameWindow?.show();
      gameFailure(`No se pudo cargar HaxBall (${description}, ${code}).`).catch(reportError);
    }
  });
  contents.on('render-process-gone', (_event, details) => {
    if (details.reason !== 'clean-exit') gameFailure(`El proceso del juego se cerró (${details.reason}).`).catch(reportError);
  });
  contents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown' || input.isAutoRepeat) return;
    if (input.key === 'F10') { event.preventDefault(); showSettings(); }
    else if (input.key === 'F11' || (input.alt && input.key === 'Enter')) {
      event.preventDefault(); gameWindow.setFullScreen(!gameWindow.isFullScreen());
    } else if (input.control && input.shift && input.key.toLowerCase() === 'r') {
      event.preventDefault(); confirmReload().catch(reportError);
    }
  });
  for (const name of ['enter-full-screen', 'leave-full-screen']) gameWindow.on(name, () => {
    try { store.save({ fullscreen: gameWindow.isFullScreen() }); notify(); } catch (error) { reportError(error); }
  });
  gameWindow.once('ready-to-show', () => gameWindow?.show());
  gameWindow.on('closed', () => { gameWindow = null; app.quit(); });
  contents.loadURL(gameUrl).catch(reportError);
}

async function confirmReload() {
  if (!gameWindow || gameWindow.isDestroyed()) return;
  const result = await dialog.showMessageBox(settingsWindow || gameWindow, {
    type: 'question', title: 'Recargar HaxBall', message: '¿Recargar HaxBall?',
    detail: 'Vas a abandonar la sala actual. Los ajustes guardados se conservarán.',
    buttons: ['Cancelar', 'Recargar'], defaultId: 0, cancelId: 0
  });
  if (result.response === 1) {
    settingsWindow?.close();
    gameWindow?.webContents.reload();
  }
}

function finishBenchmark() {
  if (!benchmarkActive) return;
  benchmarkPending = true;
  try { benchmarkFrame?.executeJavaScript(STOP_BENCHMARK_SOURCE, false).catch(() => { benchmarkPending = false; notify(); }); }
  catch { benchmarkPending = false; }
  benchmarkActive = false;
  clearTimeout(benchmarkTimeout);
  benchmarkTimeout = null;
  notify();
}

function registerIpc() {
  const handle = (channel, callback) => ipcMain.handle(channel, async (event, ...args) => {
    if (!isSettingsSender(event, settingsWindow, settingsUrl)) throw new Error('Origen IPC no autorizado.');
    try { if (channel !== 'ovj:state') lastError = null; await callback(...args); } catch (error) { reportError(error); }
    return currentState();
  });
  handle('ovj:state', () => {});
  handle('ovj:save', async patch => {
    store.save(patch);
    const settings = store.get();
    if (settings.competitiveMode) finishBenchmark();
    presence.configure({ enabled: settings.discordEnabled, clientId: settings.discordClientId, assetKey: settings.discordAssetKey });
    await updateSkinInGame();
    notify();
  });
  handle('ovj:choose-ball', async () => {
    const result = await dialog.showOpenDialog(settingsWindow, {
      title: 'Elegir diseño de pelota', properties: ['openFile'],
      filters: [{ name: 'Imágenes estáticas', extensions: ['png', 'jpg', 'jpeg', 'webp'] }]
    });
    if (result.canceled) return;
    const filename = result.filePaths[0];
    if (!/\.(png|jpe?g|webp)$/i.test(filename)) throw new Error('Elegí un archivo PNG, JPEG o WebP.');
    if (fs.statSync(filename).size > 8 * 1024 * 1024) throw new Error('La imagen debe pesar como máximo 8 MB.');
    const bytes = fs.readFileSync(filename);
    const image = /\.webp$/i.test(filename)
      ? nativeImage.createFromDataURL(await settingsWindow.webContents.executeJavaScript(webPDecoderSource(bytes), false))
      : nativeImage.createFromBuffer(bytes);
    const size = image.getSize();
    if (image.isEmpty() || size.width < 1 || size.height < 1 || size.width > 4096 || size.height > 4096) throw new Error('Imagen inválida o mayor que 4096 × 4096 píxeles.');
    const factor = Math.min(1, 256 / size.width, 256 / size.height);
    const optimized = image.resize({ width: Math.max(1, Math.round(size.width * factor)), height: Math.max(1, Math.round(size.height * factor)), quality: 'best' });
    store.setSkin(optimized.toPNG(), path.basename(filename));
    cachedSkinDataUrl = store.skinDataUrl();
    await updateSkinInGame();
    notify();
  });
  handle('ovj:remove-ball', async () => { store.removeSkin(); cachedSkinDataUrl = null; await updateSkinInGame(); notify(); });
  handle('ovj:fullscreen', () => { gameWindow.setFullScreen(!gameWindow.isFullScreen()); });
  handle('ovj:reload', confirmReload);
  handle('ovj:restart', async () => {
    const result = await dialog.showMessageBox(settingsWindow || gameWindow, {
      type: 'question', message: '¿Reiniciar OVJ App?', detail: 'Vas a abandonar la sala actual.',
      buttons: ['Cancelar', 'Reiniciar'], defaultId: 0, cancelId: 0
    });
    if (result.response === 1) { app.relaunch(); app.quit(); }
  });
  handle('ovj:benchmark-start', () => {
    if (store.get().competitiveMode) throw new Error('Desactivá el modo competitivo para tomar una captura de diagnóstico.');
    if (benchmarkActive || benchmarkPending) return;
    const frames = gameWindow.webContents.mainFrame.framesInSubtree.filter(frame => isGameUrl(frame.url));
    benchmarkFrame = frames.find(frame => /\/g\/game\.html(?:[?#]|$)/.test(frame.url));
    if (!benchmarkFrame) throw new Error('Todavía no se encontró el frame del juego. Esperá a que HaxBall termine de cargar.');
    benchmarkSamples = [];
    benchmarkStartedAt = new Date().toISOString();
    benchmarkActive = true;
    const generation = ++benchmarkGeneration;
    benchmarkFrame.executeJavaScript(BENCHMARK_SOURCE, false).then(samples => {
      if (generation !== benchmarkGeneration) return;
      benchmarkActive = false;
      benchmarkPending = false;
      clearTimeout(benchmarkTimeout);
      benchmarkTimeout = null;
      if (!validateIntervals(samples)) throw new Error('La captura de diagnóstico tiene datos inválidos.');
      benchmarkSamples = samples;
      notify();
    }).catch(error => {
      if (generation !== benchmarkGeneration) return;
      benchmarkActive = false;
      benchmarkPending = false;
      clearTimeout(benchmarkTimeout);
      benchmarkTimeout = null;
      reportError(new Error(`Se interrumpió la captura: ${error.message}`));
    });
    benchmarkTimeout = setTimeout(finishBenchmark, 61000);
    benchmarkTimeout.unref();
    settingsWindow?.close();
  });
  handle('ovj:benchmark-stop', finishBenchmark);
  handle('ovj:export-diagnostics', async () => {
    if (benchmarkActive || benchmarkPending) throw new Error('Detené la captura y esperá a que se reciban las muestras antes de exportar.');
    const result = await dialog.showSaveDialog(settingsWindow, {
      title: 'Exportar diagnóstico', defaultPath: 'OVJ-diagnostico.json', filters: [{ name: 'JSON', extensions: ['json'] }]
    });
    if (result.canceled) return;
    const diagnostic = {
      exportedAt: new Date().toISOString(), captureStartedAt: benchmarkStartedAt,
      runtime: currentState().runtime, hardwareAcceleration: accelerationAtStartup,
      gpuFeatures: app.getGPUFeatureStatus(), processes: app.getAppMetrics(),
      frameSampleCount: benchmarkSamples.length,
      metric: 'Intervalos requestAnimationFrame del frame del juego. No mide FPS presentados, ping ni input lag.',
      privacy: 'No incluye nombres de sala, chat, enlaces de sala, Application ID ni imagen personal.'
    };
    atomicWrite(result.filePath, JSON.stringify(diagnostic, null, 2) + '\n');
    if (benchmarkSamples.length) {
      const csvPath = result.filePath.replace(/\.json$/i, '') + '-raf.csv';
      const csv = 'timestamp_ms,interval_ms\n' + benchmarkSamples.map(sample => sample.map(value => value.toFixed(6)).join(',')).join('\n') + '\n';
      atomicWrite(csvPath, csv);
    }
  });
  ipcMain.on('ovj:close-settings', event => {
    if (isSettingsSender(event, settingsWindow, settingsUrl)) settingsWindow.close();
  });
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!gameWindow) return;
    if (gameWindow.isMinimized()) gameWindow.restore();
    gameWindow.focus();
  });
  app.on('before-quit', event => {
    if (cleanupDone) return;
    event.preventDefault();
    if (quitting) return;
    quitting = true;
    finishBenchmark();
    Promise.resolve(presence?.stop()).catch(() => {}).finally(() => { cleanupDone = true; app.quit(); });
  });
  app.on('window-all-closed', () => app.quit());
  app.whenReady().then(() => {
    nativeTheme.themeSource = 'dark';
    brandLogoData = readBrandLogo();
    if (process.platform === 'win32') app.setAppUserModelId('ar.ovj.app');
    Menu.setApplicationMenu(null);
    registerIpc();
    const settings = store.get();
    presence = createDiscordPresence({
      enabled: settings.discordEnabled, clientId: settings.discordClientId, assetKey: settings.discordAssetKey,
      startedAt, onStatus: notify
    });
    createGameWindow();
  }).catch(error => {
    dialog.showErrorBox('No se pudo iniciar OVJ App', error.message);
    app.quit();
  });
}
