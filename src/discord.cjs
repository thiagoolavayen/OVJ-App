'use strict';

// Discord's documented local RPC transport. This is not the Discord Social SDK.
const net = require('node:net');
const path = require('node:path');
const crypto = require('node:crypto');

const MAX_FRAME_BYTES = 64 * 1024;
const OPCODE = Object.freeze({ HANDSHAKE: 0, FRAME: 1, CLOSE: 2, PING: 3, PONG: 4 });

function isValidClientId(value) {
  return typeof value === 'string' && /^[1-9]\d{16,19}$/.test(value) &&
    BigInt(value) <= 18446744073709551615n;
}

function encodeFrame(opcode, payload) {
  const body = Buffer.isBuffer(payload) ? payload : Buffer.from(JSON.stringify(payload), 'utf8');
  const packet = Buffer.allocUnsafe(8 + body.length);
  packet.writeUInt32LE(opcode, 0);
  packet.writeUInt32LE(body.length, 4);
  body.copy(packet, 8);
  return packet;
}

function pipePaths(platform = process.platform, env = process.env) {
  if (platform === 'win32') {
    return Array.from({ length: 10 }, (_, i) => `\\\\?\\pipe\\discord-ipc-${i}`);
  }
  const directories = [...new Set([
    env.XDG_RUNTIME_DIR, env.TMPDIR, env.TMP, env.TEMP, '/tmp'
  ].filter(value => typeof value === 'string' && path.isAbsolute(value)))];
  return directories.flatMap(directory =>
    Array.from({ length: 10 }, (_, i) => path.join(directory, `discord-ipc-${i}`)));
}

function normalizeConfiguration(options = {}) {
  const candidate = typeof options.assetKey === 'string' ? options.assetKey.trim() : '';
  return {
    enabled: options.enabled === true,
    clientId: typeof options.clientId === 'string' ? options.clientId.trim() : '',
    assetKey: /^[a-zA-Z0-9_-]{1,128}$/.test(candidate) ? candidate : ''
  };
}

/**
 * Creates an optional local Rich Presence connection. No credentials are needed.
 * status()/onStatus: { state, detail }. stop() returns a bounded cleanup Promise.
 * The second parameter is dependency injection for tests, never renderer input.
 */
function createDiscordPresence(options = {}, dependencies = {}) {
  const connect = dependencies.connect || (target => net.createConnection({ path: target }));
  const targets = dependencies.paths || pipePaths();
  const connectTimeoutMs = dependencies.connectTimeoutMs ?? 1500;
  const requestTimeoutMs = dependencies.requestTimeoutMs ?? 5000;
  const retryDelaysMs = dependencies.retryDelaysMs || [15000, 30000, 60000];
  const closeTimeoutMs = dependencies.closeTimeoutMs ?? 300;
  const onStatus = typeof options.onStatus === 'function' ? options.onStatus : () => {};
  const candidateStart = options.startedAt instanceof Date ? options.startedAt.getTime() : Number(options.startedAt);
  const startedAt = Number.isFinite(candidateStart) && candidateStart > 0
    ? Math.floor(candidateStart > 1e11 ? candidateStart / 1000 : candidateStart)
    : Math.floor(Date.now() / 1000);

  let config = normalizeConfiguration(options);
  let current = { state: 'disabled', detail: 'Discord desactivado.' };
  let generation = 0;
  let socket = null;
  let ready = false;
  let stopped = false;
  let retryTimer = null;
  let deadlineTimer = null;
  let failures = 0;
  let cleanup = Promise.resolve();

  function report(state, detail) {
    if (current.state === state && current.detail === detail) return;
    current = { state, detail };
    try { onStatus({ ...current }); } catch { /* Observers cannot break the transport. */ }
  }

  function clearTimers() {
    clearTimeout(retryTimer);
    clearTimeout(deadlineTimer);
    retryTimer = deadlineTimer = null;
  }

  function disconnect(clearActivity) {
    const oldSocket = socket;
    const wasReady = ready;
    socket = null;
    ready = false;
    if (!oldSocket || oldSocket.destroyed) return Promise.resolve();
    if (!clearActivity || !wasReady || !oldSocket.writable) {
      oldSocket.destroy();
      return Promise.resolve();
    }
    return new Promise(resolve => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        clearTimeout(closeTimer);
        oldSocket.destroy();
        resolve();
      };
      const closeTimer = setTimeout(finish, closeTimeoutMs);
      closeTimer.unref?.();
      oldSocket.once('close', finish);
      try {
        oldSocket.end(encodeFrame(OPCODE.FRAME, {
          cmd: 'SET_ACTIVITY', args: { pid: process.pid, activity: null }, nonce: crypto.randomUUID()
        }));
      } catch { finish(); }
    });
  }

  function isActive(epoch) {
    return epoch === generation && !stopped && config.enabled && isValidClientId(config.clientId);
  }

  function scheduleReconnect(epoch, detail) {
    if (!isActive(epoch) || retryTimer) return;
    report('waiting', detail || 'Discord no está disponible. Se reintentará automáticamente.');
    const delay = retryDelaysMs[Math.min(failures++, retryDelaysMs.length - 1)];
    retryTimer = setTimeout(() => {
      retryTimer = null;
      if (isActive(epoch)) attempt(epoch, 0);
    }, delay);
    retryTimer.unref?.();
  }

  function attempt(epoch, index) {
    if (!isActive(epoch)) return;
    if (index >= targets.length) {
      scheduleReconnect(epoch);
      return;
    }
    report('connecting', 'Buscando Discord de escritorio…');
    let connection;
    try { connection = connect(targets[index]); } catch {
      // A bad path must not prevent trying the next pipe or block the game.
      queueMicrotask(() => attempt(epoch, index + 1));
      return;
    }
    socket = connection;
    connection.unref?.();
    let input = Buffer.alloc(0);
    let handledFailure = false;
    let connected = false;
    let publishNonce = '';

    const active = () => isActive(epoch) && socket === connection;
    const fail = (detail, nextPipe = false) => {
      if (handledFailure || !active()) return;
      handledFailure = true;
      clearTimeout(deadlineTimer);
      deadlineTimer = null;
      socket = null;
      ready = false;
      connection.destroy();
      if (nextPipe) queueMicrotask(() => attempt(epoch, index + 1));
      else scheduleReconnect(epoch, detail);
    };
    const deadline = (milliseconds, nextPipe) => {
      clearTimeout(deadlineTimer);
      deadlineTimer = setTimeout(() => fail('Discord no respondió. Se reintentará automáticamente.', nextPipe), milliseconds);
      deadlineTimer.unref?.();
    };
    const send = (opcode, payload) => {
      if (!active() || !connection.writable) return false;
      try { connection.write(encodeFrame(opcode, payload)); return true; }
      catch { fail('No se pudo comunicar con Discord.'); return false; }
    };
    const publish = () => {
      publishNonce = crypto.randomUUID();
      const activity = {
        type: 0,
        details: 'HaxBall',
        state: 'OVJ App abierto',
        timestamps: { start: startedAt },
        instance: false
      };
      if (config.assetKey) {
        activity.assets = { large_image: config.assetKey, large_text: 'OVJ App · Ovejeros FC' };
      }
      send(OPCODE.FRAME, { cmd: 'SET_ACTIVITY', args: { pid: process.pid, activity }, nonce: publishNonce });
      deadline(requestTimeoutMs, false);
    };

    connection.on('connect', () => {
      if (!active()) return;
      connected = true;
      send(OPCODE.HANDSHAKE, { v: 1, client_id: config.clientId });
      deadline(requestTimeoutMs, false);
    });
    connection.on('data', chunk => {
      if (!active()) return;
      // Bound allocation even for a malformed or hostile local IPC peer.
      if (input.length + chunk.length > MAX_FRAME_BYTES * 2 + 16) {
        fail('Discord envió un mensaje demasiado grande.');
        return;
      }
      input = Buffer.concat([input, chunk]);
      while (active() && input.length >= 8) {
        const opcode = input.readUInt32LE(0);
        const length = input.readUInt32LE(4);
        if (length > MAX_FRAME_BYTES) {
          fail('Discord envió un mensaje demasiado grande.');
          return;
        }
        if (input.length < 8 + length) return;
        const body = input.subarray(8, 8 + length);
        input = input.subarray(8 + length);
        if (opcode === OPCODE.PING) { send(OPCODE.PONG, body); continue; }
        if (opcode === OPCODE.PONG) continue;
        if (opcode === OPCODE.CLOSE) { fail('Discord cerró la conexión.'); return; }
        if (opcode !== OPCODE.FRAME) { fail('Respuesta de Discord no reconocida.'); return; }
        let message;
        try { message = JSON.parse(body.toString('utf8')); }
        catch { fail('Respuesta de Discord no válida.'); return; }
        if (!message || typeof message !== 'object' || Array.isArray(message)) {
          fail('Respuesta de Discord no válida.'); return;
        }
        if (message.evt === 'ERROR') {
          fail('Discord rechazó la actividad. Revisá el Application ID y el recurso de imagen.');
          return;
        }
        if (message.cmd === 'DISPATCH' && message.evt === 'READY' && !ready) {
          ready = true;
          publish();
        } else if (message.cmd === 'SET_ACTIVITY' && publishNonce && message.nonce === publishNonce) {
          publishNonce = '';
          clearTimeout(deadlineTimer);
          deadlineTimer = null;
          failures = 0;
          report('connected', 'Discord conectado. Actividad publicada.');
        }
      }
    });
    connection.on('error', () => fail('No se pudo comunicar con Discord.', !connected));
    connection.on('close', () => fail('Discord se desconectó. Se reintentará automáticamente.', !connected));
    deadline(connectTimeoutMs, true);
  }

  function start() {
    if (stopped) return;
    if (!config.enabled) { report('disabled', 'Discord desactivado.'); return; }
    if (!isValidClientId(config.clientId)) {
      report('needs-id', 'Ingresá un Application ID válido de OVJ App.');
      return;
    }
    attempt(generation, 0);
  }

  function configure(changes = {}) {
    if (stopped) return { ...current };
    const next = normalizeConfiguration({ ...config, ...changes });
    if (JSON.stringify(next) === JSON.stringify(config)) return { ...current };
    generation++;
    const epoch = generation;
    clearTimers();
    // Retire the old presence before publishing a replacement for this PID.
    cleanup = Promise.all([cleanup, disconnect(true)]).then(() => undefined);
    config = next;
    failures = 0;
    if (!config.enabled || !isValidClientId(config.clientId)) start();
    else {
      report('connecting', 'Actualizando la conexión con Discord…');
      cleanup.then(() => { if (isActive(epoch)) start(); });
    }
    return { ...current };
  }

  function stop() {
    if (stopped) return cleanup;
    stopped = true;
    generation++;
    clearTimers();
    cleanup = Promise.all([cleanup, disconnect(true)]).then(() => undefined);
    report('disabled', 'Discord desactivado.');
    return cleanup;
  }

  start();
  return Object.freeze({ configure, stop, status: () => ({ ...current }) });
}

module.exports = { createDiscordPresence, isValidClientId, pipePaths };
