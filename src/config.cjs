'use strict';

const fs = require('node:fs');
const path = require('node:path');

const DEFAULTS = Object.freeze({
  version: 1,
  hardwareAcceleration: true,
  fullscreen: false,
  competitiveMode: true,
  adBlockingEnabled: true,
  discordEnabled: true,
  discordClientId: '',
  discordAssetKey: 'ovj_logo',
  ballEnabled: false,
  ballSkinName: ''
});
const BOOLEAN_KEYS = ['hardwareAcceleration', 'fullscreen', 'competitiveMode', 'adBlockingEnabled', 'discordEnabled', 'ballEnabled'];

function validatePatch(patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new Error('Configuración inválida.');
  const clean = {};
  for (const [key, value] of Object.entries(patch)) {
    if (BOOLEAN_KEYS.includes(key)) {
      if (typeof value !== 'boolean') throw new Error(`El valor de ${key} debe ser booleano.`);
      clean[key] = value;
    } else if (key === 'discordClientId') {
      if (typeof value !== 'string' || (value !== '' && (!/^[1-9]\d{16,19}$/.test(value) || BigInt(value) > 18446744073709551615n))) {
        throw new Error('El Application ID de Discord debe contener entre 17 y 20 dígitos.');
      }
      clean[key] = value;
    } else if (key === 'discordAssetKey') {
      if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{0,128}$/.test(value)) {
        throw new Error('La clave de imagen de Discord solo admite letras, números, guiones y guiones bajos.');
      }
      clean[key] = value;
    } else {
      throw new Error(`Opción desconocida: ${key}`);
    }
  }
  return clean;
}

function normalizeStored(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Archivo de configuración inválido.');
  const clean = { ...DEFAULTS };
  for (const key of [...BOOLEAN_KEYS, 'discordClientId', 'discordAssetKey']) {
    if (!(key in raw)) continue;
    try { Object.assign(clean, validatePatch({ [key]: raw[key] })); } catch { /* Recuperar valores seguros. */ }
  }
  if (typeof raw.ballSkinName === 'string') clean.ballSkinName = raw.ballSkinName.slice(0, 150);
  return clean;
}

function atomicWrite(filename, contents) {
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  const temporary = `${filename}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(temporary, contents, { mode: 0o600 });
    fs.renameSync(temporary, filename);
  } finally {
    try { fs.unlinkSync(temporary); } catch { /* Ya renombrado o no creado. */ }
  }
}

class ConfigStore {
  constructor(directory) {
    this.directory = directory;
    this.filename = path.join(directory, 'settings.json');
    this.skinPath = path.join(directory, 'ball.png');
    this.error = null;
    this.value = { ...DEFAULTS };
    try {
      const stat = fs.statSync(this.filename);
      if (stat.size > 64 * 1024) throw new Error('Configuración demasiado grande.');
      this.value = normalizeStored(JSON.parse(fs.readFileSync(this.filename, 'utf8')));
    } catch (error) {
      if (error.code !== 'ENOENT') {
        this.error = 'No se pudo leer la configuración; se restauraron los valores predeterminados.';
        try { fs.renameSync(this.filename, `${this.filename}.invalid-${Date.now()}`); } catch { /* Informar sin impedir abrir. */ }
      }
    }
    if (!fs.existsSync(this.skinPath)) {
      this.value.ballSkinName = '';
      this.value.ballEnabled = false;
    }
  }
  get() { return { ...this.value }; }
  save(patch) {
    const next = { ...this.value, ...validatePatch(patch) };
    atomicWrite(this.filename, JSON.stringify(next, null, 2) + '\n');
    this.value = next;
    return this.get();
  }
  setSkin(pngBuffer, name) {
    if (!Buffer.isBuffer(pngBuffer) || pngBuffer.length > 1024 * 1024 || !pngBuffer.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) {
      throw new Error('La imagen convertida no es un PNG válido.');
    }
    atomicWrite(this.skinPath, pngBuffer);
    const next = { ...this.value, ballSkinName: path.basename(name).slice(0, 150), ballEnabled: true };
    atomicWrite(this.filename, JSON.stringify(next, null, 2) + '\n');
    this.value = next;
  }
  removeSkin() {
    const next = { ...this.value, ballEnabled: false, ballSkinName: '' };
    atomicWrite(this.filename, JSON.stringify(next, null, 2) + '\n');
    this.value = next;
    try { fs.unlinkSync(this.skinPath); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  skinDataUrl() {
    try {
      if (fs.statSync(this.skinPath).size > 1024 * 1024) return null;
      const bytes = fs.readFileSync(this.skinPath);
      if (!bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) return null;
      return `data:image/png;base64,${bytes.toString('base64')}`;
    } catch { return null; }
  }
}

module.exports = { DEFAULTS, validatePatch, normalizeStored, atomicWrite, ConfigStore };
