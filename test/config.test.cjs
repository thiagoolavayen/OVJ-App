'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ConfigStore, validatePatch } = require('../src/config.cjs');
const { isGameUrl, isExternalUrl, isSettingsSender, validateIntervals } = require('../src/security.cjs');

test('la configuración sobrevive reinicios y rechaza opciones peligrosas sin modificar el archivo', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ovj-config-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const store = new ConfigStore(dir);
  store.save({ fullscreen: true, discordClientId: '123456789012345678' });
  assert.equal(new ConfigStore(dir).get().fullscreen, true);
  assert.throws(() => store.save({ fullscreen: false, nodeIntegration: true }), /desconocida/);
  assert.equal(new ConfigStore(dir).get().fullscreen, true);
  assert.throws(() => validatePatch({ hardwareAcceleration: 'false' }));
  assert.throws(() => validatePatch({ discordClientId: '../../x' }));
});

test('archivo corrupto no impide iniciar ni elimina la copia recuperable', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ovj-corrupt-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, 'settings.json'), '{broken');
  const store = new ConfigStore(dir);
  assert.ok(store.error);
  assert.equal(store.get().hardwareAcceleration, true);
  assert.ok(fs.readdirSync(dir).some(x => x.includes('.invalid-')));
});

test('un diseño ausente se desactiva al iniciar', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ovj-skin-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ ballEnabled: true, ballSkinName: 'lost.png' }));
  const store = new ConfigStore(dir);
  assert.equal(store.get().ballEnabled, false);
});

test('navegación y enlaces no aceptan protocolos del sistema ni dominios parecidos', () => {
  assert.ok(isGameUrl('https://www.haxball.com/play?c=room'));
  for (const url of ['http://www.haxball.com/play', 'https://www.haxball.com.evil.test/play', 'https://evil@www.haxball.com/play', 'file:///x', 'javascript:alert(1)']) assert.equal(isGameUrl(url), false);
  assert.equal(isExternalUrl('ms-settings:security'), false);
  assert.ok(isExternalUrl('https://discord.com/developers/applications'));
});

test('solo el frame local de ajustes puede invocar operaciones privilegiadas', () => {
  const frame = { url: 'file:///app/settings.html' };
  const contents = { mainFrame: frame };
  const window = { webContents: contents, isDestroyed: () => false };
  assert.ok(isSettingsSender({ sender: contents, senderFrame: frame }, window, frame.url));
  assert.equal(isSettingsSender({ sender: {}, senderFrame: frame }, window, frame.url), false);
  assert.equal(isSettingsSender({ sender: contents, senderFrame: { url: frame.url } }, window, frame.url), false);
});

test('el diagnóstico rechaza tamaños, intervalos y orden inválidos', () => {
  assert.ok(validateIntervals([[10, 10], [20, 10]]));
  for (const samples of [[[10, -1]], [[10, NaN]], [[20, 10], [10, 10]], [['10', 10]], [[1, 1, 1]]]) assert.equal(validateIntervals(samples), false);
});
