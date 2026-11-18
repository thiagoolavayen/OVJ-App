'use strict';

(() => {
  const api = window.ovj;
  const $ = (id) => document.getElementById(id);
  const dirtyForms = new Set();
  const formRevisions = new Map();
  const pendingButtons = new Set();
  let currentState = null;
  let localError = '';
  const sectionNames = new Set(['performance', 'ball', 'discord', 'diagnostics']);

  function navigateSection(section) {
    if (!sectionNames.has(section)) return;
    $(`${section}-section`).scrollIntoView({ block: 'start' });
    $(`${section}-title`).focus({ preventScroll: true });
  }

  function validDiscordId(value) {
    return value === '' || (/^[1-9]\d{16,19}$/.test(value) && BigInt(value) <= 18446744073709551615n);
  }

  const discordIdError = 'El Application ID debe tener entre 17 y 20 dígitos, sin cero inicial, y no superar 18446744073709551615. Podés dejarlo vacío para configurarlo más adelante.';

  function showError(message) {
    localError = message || '';
    $('error').textContent = localError;
    $('error').hidden = !localError;
    $('success').hidden = true;
  }

  function clearError() {
    localError = '';
    $('error').textContent = '';
    $('error').hidden = true;
  }

  function render(state) {
    if (!state || typeof state !== 'object' || !state.settings) {
      showError('No se pudo leer la configuración del cliente.');
      return;
    }
    currentState = state;
    const settings = state.settings;
    $('mode-status').textContent = settings.competitiveMode
      ? 'Modo torneo activo: pelota original y capturas desactivadas. Podés cambiarlo en Juego.'
      : 'Modo personal activo: podés usar tu pelota y capturar un diagnóstico.';
    const hasBrandLogo = typeof state.brandLogo === 'string' && /^data:image\/png;base64,/.test(state.brandLogo);
    $('brand-logo').hidden = !hasBrandLogo;
    if (hasBrandLogo) $('brand-logo').src = state.brandLogo;
    else $('brand-logo').removeAttribute('src');

    if (!dirtyForms.has('performance-form')) {
      $('competitive-mode').checked = Boolean(settings.competitiveMode);
      $('hardware-acceleration').checked = Boolean(settings.hardwareAcceleration);
      $('ad-blocking-enabled').checked = Boolean(settings.adBlockingEnabled);
    }
    if (!dirtyForms.has('discord-form')) {
      $('discord-enabled').checked = Boolean(settings.discordEnabled);
      $('discord-client-id').value = settings.discordClientId || '';
      $('discord-asset-key').value = settings.discordAssetKey || '';
      $('discord-client-id').setCustomValidity(validDiscordId($('discord-client-id').value) ? '' : discordIdError);
    }
    if (!dirtyForms.has('ball-form')) $('ball-enabled').checked = Boolean(settings.ballEnabled);

    const hasBall = typeof state.ballPreview === 'string' && /^data:image\/png;base64,/.test(state.ballPreview);
    $('ball-preview').hidden = !hasBall;
    $('ball-empty').hidden = hasBall;
    if (hasBall) $('ball-preview').src = state.ballPreview;
    else $('ball-preview').removeAttribute('src');
    $('ball-name').textContent = settings.ballSkinName || 'Sin imagen seleccionada';
    $('remove-ball').disabled = !hasBall;
    $('ball-enabled').disabled = Boolean(settings.competitiveMode) || !hasBall;
    $('save-ball').disabled = Boolean(settings.competitiveMode) || !hasBall;
    $('ball-mode-settings').hidden = !settings.competitiveMode;
    $('ball-mode-note').textContent = settings.competitiveMode
      ? 'Elegir una imagen te permite desactivar el modo torneo y activar tu diseño.'
      : hasBall ? 'Se aplica al cargar una versión compatible de HaxBall.' : 'Primero elegí una imagen.';
    $('ball-status').textContent = state.ballStatus || 'Diseño desactivado.';
    $('discord-status').textContent = state.discordStatus || 'Discord desconectado.';
    $('ad-status').textContent = settings.adBlockingEnabled
      ? `Activo · ${Number(state.adBlocking?.blockedRequests || 0)} solicitudes publicitarias bloqueadas en esta sesión.`
      : 'Desactivado. Podés activarlo aquí o desde el menú Publicidad.';

    $('fullscreen').textContent = `${settings.fullscreen ? 'Salir de pantalla completa' : 'Pantalla completa'} · F11`;
    $('restart-notice').hidden = !state.restartRequired;
    $('reload-notice').hidden = !state.reloadRequired;

    const benchmark = state.benchmark || { active: false, samples: 0 };
    $('benchmark-status').textContent = benchmark.active
      ? `Capturando · ${Number(benchmark.samples || 0).toLocaleString('es-AR')} muestras`
      : `${Number(benchmark.samples || 0).toLocaleString('es-AR')} muestras`;
    $('benchmark-start').disabled = Boolean(settings.competitiveMode) || Boolean(benchmark.active);
    $('benchmark-stop').disabled = !benchmark.active;
    $('export-diagnostics').disabled = Boolean(benchmark.active);
    $('benchmark-mode-settings').hidden = !settings.competitiveMode;
    $('benchmark-note').textContent = settings.competitiveMode
      ? 'El modo torneo impide iniciar capturas. Cambiá el modo de juego y guardá para habilitarlas.'
      : 'Captura de 60 segundos con parada automática. Usá las mismas condiciones al comparar clientes.';

    const runtime = state.runtime || {};
    $('runtime').textContent = [
      runtime.appVersion && `OVJ App ${runtime.appVersion}`,
      runtime.electron && `Electron ${runtime.electron}`,
      runtime.chromium && `Chromium ${runtime.chromium}`,
      runtime.platform,
    ].filter(Boolean).join(' · ') || 'Versión del cliente no disponible';

    if (state.error) showError(String(state.error));
    else if (!localError) clearError();
    for (const button of pendingButtons) button.disabled = true;
  }

  async function act(button, operation, options = {}) {
    const wasDisabled = button ? button.disabled : false;
    const formRevision = options.form ? formRevisions.get(options.form) : undefined;
    const previousBall = currentState && {
      preview: currentState.ballPreview,
      name: currentState.settings.ballSkinName,
      enabled: currentState.settings.ballEnabled,
    };
    const ballRevision = formRevisions.get('ball-form');
    if (button) {
      pendingButtons.add(button);
      button.disabled = true;
    }
    clearError();
    $('success').hidden = true;
    try {
      const state = await operation();
      if (state && state.settings && !state.error) {
        if (options.form && formRevisions.get(options.form) === formRevision) dirtyForms.delete(options.form);
        if (options.ballResource && previousBall && formRevisions.get('ball-form') === ballRevision && (
          state.ballPreview !== previousBall.preview || state.settings.ballSkinName !== previousBall.name ||
          state.settings.ballEnabled !== previousBall.enabled
        )) dirtyForms.delete('ball-form');
      }
      if (state) render(state);
      if (options.success && state && !state.error) {
        $('success').textContent = options.success + (options.form && dirtyForms.has(options.form)
          ? ' Hay cambios posteriores sin guardar.' : '');
        $('success').hidden = false;
      }
    } catch (error) {
      showError(error && error.message ? error.message : 'No se pudo completar la operación.');
    } finally {
      if (button) {
        pendingButtons.delete(button);
        button.disabled = wasDisabled;
      }
      if (currentState) render(currentState);
    }
  }

  for (const button of document.querySelectorAll('[data-section]')) {
    button.addEventListener('click', () => navigateSection(button.dataset.section));
  }

  if (!api) {
    showError('La configuración debe abrirse desde OVJ App.');
    return;
  }

  for (const id of ['performance-form', 'ball-form', 'discord-form']) {
    const markDirty = () => {
      dirtyForms.add(id);
      formRevisions.set(id, (formRevisions.get(id) || 0) + 1);
    };
    $(id).addEventListener('input', markDirty);
    $(id).addEventListener('change', markDirty);
  }
  $('discord-client-id').addEventListener('input', () => {
    $('discord-client-id').setCustomValidity(validDiscordId($('discord-client-id').value) ? '' : discordIdError);
  });

  $('performance-form').addEventListener('submit', (event) => {
    event.preventDefault();
    void act(event.submitter, () => api.saveSettings({
      competitiveMode: $('competitive-mode').checked,
      hardwareAcceleration: $('hardware-acceleration').checked,
      adBlockingEnabled: $('ad-blocking-enabled').checked,
    }), { form: 'performance-form', success: 'Preferencias guardadas.' });
  });
  $('ball-form').addEventListener('submit', (event) => {
    event.preventDefault();
    void act(event.submitter, () => api.saveSettings({ ballEnabled: $('ball-enabled').checked }), {
      form: 'ball-form', success: 'Preferencia de pelota guardada.',
    });
  });
  $('discord-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const clientId = $('discord-client-id').value;
    if (!validDiscordId(clientId)) {
      showError(discordIdError);
      $('discord-client-id').focus();
      return;
    }
    void act(event.submitter, () => api.saveSettings({
      discordEnabled: $('discord-enabled').checked,
      discordClientId: clientId,
      discordAssetKey: $('discord-asset-key').value.trim(),
    }), { form: 'discord-form', success: 'Configuración de Discord guardada.' });
  });

  for (const [id, method] of [
    ['choose-ball', 'chooseBall'],
    ['remove-ball', 'removeBall'],
    ['fullscreen', 'setFullscreen'],
    ['reload-game', 'reloadGame'],
    ['restart', 'restart'],
    ['benchmark-start', 'startBenchmark'],
    ['benchmark-stop', 'stopBenchmark'],
    ['export-diagnostics', 'exportDiagnostics'],
  ]) {
    $(id).addEventListener('click', () => {
      void act($(id), () => api[method](), { ballResource: id === 'choose-ball' || id === 'remove-ball' });
    });
  }
  $('close-settings').addEventListener('click', () => api.close());
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      api.close();
    } else if (!event.repeat && (event.key === 'F11' || (event.altKey && event.key === 'Enter'))) {
      event.preventDefault();
      void act($('fullscreen'), () => api.setFullscreen());
    } else if (!event.repeat && event.ctrlKey && event.shiftKey && event.key.toLowerCase() === 'r') {
      event.preventDefault();
      void act($('reload-game'), () => api.reloadGame());
    }
  });

  const unsubscribe = api.onState(render);
  window.addEventListener('unload', unsubscribe, { once: true });
  const unsubscribeNavigation = api.onNavigateSection(navigateSection);
  window.addEventListener('unload', unsubscribeNavigation, { once: true });
  void act(null, () => api.getState());
})();
