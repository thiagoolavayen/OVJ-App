'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');
const { EventEmitter } = require('node:events');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createDiscordPresence, isValidClientId, pipePaths } = require('../src/discord.cjs');

const APP_ID = '123456789012345678';
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

function frame(opcode, message) {
  const payload = Buffer.isBuffer(message) ? message : Buffer.from(JSON.stringify(message));
  const header = Buffer.alloc(8);
  header.writeUInt32LE(opcode);
  header.writeUInt32LE(payload.length, 4);
  return Buffer.concat([header, payload]);
}

async function until(predicate, message = 'condition', timeout = 1000) {
  const end = Date.now() + timeout;
  while (!predicate()) {
    assert.ok(Date.now() < end, `Timed out waiting for ${message}`);
    await delay(5);
  }
}

async function fakeDiscord(t, onPacket) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'ovj-discord-'));
  const target = process.platform === 'win32'
    ? `\\\\?\\pipe\\ovj-test-${process.pid}-${path.basename(directory)}`
    : path.join(directory, 'rpc');
  const peers = new Set();
  const packets = [];
  const server = net.createServer(peer => {
    peers.add(peer);
    peer.on('error', () => {});
    peer.on('close', () => peers.delete(peer));
    let input = Buffer.alloc(0);
    peer.on('data', chunk => {
      input = Buffer.concat([input, chunk]);
      while (input.length >= 8 && input.length >= 8 + input.readUInt32LE(4)) {
        const opcode = input.readUInt32LE(0);
        const size = input.readUInt32LE(4);
        const body = input.subarray(8, 8 + size);
        input = input.subarray(8 + size);
        const packet = { opcode, body, peer, json: JSON.parse(body.toString()) };
        packets.push(packet);
        onPacket?.(packet, packets);
      }
    });
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(target, resolve);
  });
  t.after(async () => {
    for (const peer of peers) peer.destroy();
    await new Promise(resolve => server.close(resolve));
    await fs.rm(directory, { recursive: true, force: true });
  });
  return { target, packets, peers };
}

function ready(peer) {
  peer.write(frame(1, { cmd: 'DISPATCH', evt: 'READY', data: { user: { id: 'not-collected' } } }));
}

test('disabled and missing Application ID never open a transport', async () => {
  let calls = 0;
  const presence = createDiscordPresence({ enabled: false, clientId: APP_ID }, {
    connect: () => { calls++; throw new Error('must not connect'); }
  });
  assert.equal(presence.status().state, 'disabled');
  presence.configure({ enabled: true, clientId: '' });
  assert.equal(presence.status().state, 'needs-id');
  presence.configure({ clientId: '0'.repeat(18) });
  assert.equal(presence.status().state, 'needs-id');
  assert.equal(calls, 0);
  assert.equal(isValidClientId('18446744073709551616'), false);
  await presence.stop();
});

test('Windows pipe names and Application ID validation do not accept network endpoints', () => {
  const targets = pipePaths('win32');
  assert.equal(targets.length, 10);
  assert.equal(targets[0], '\\\\?\\pipe\\discord-ipc-0');
  assert.equal(targets[9], '\\\\?\\pipe\\discord-ipc-9');
  assert.equal(isValidClientId(APP_ID), true);
  assert.equal(isValidClientId('https://discord.com/123456789012345678'), false);
  assert.equal(isValidClientId('123456789012345678\n'), false);
});

test('real IPC handshake, fragmented READY, activity ACK, ping and clean removal', async t => {
  const statuses = [];
  const ping = { test: 'keep-alive' };
  const server = await fakeDiscord(t, packet => {
    if (packet.opcode === 0) {
      assert.deepEqual(packet.json, { v: 1, client_id: APP_ID });
      const response = frame(1, { cmd: 'DISPATCH', evt: 'READY', data: {} });
      packet.peer.write(response.subarray(0, 3));
      setTimeout(() => packet.peer.write(response.subarray(3)), 5);
    } else if (packet.json.cmd === 'SET_ACTIVITY' && packet.json.args.activity) {
      packet.peer.write(frame(1, { cmd: 'SET_ACTIVITY', nonce: packet.json.nonce, data: {} }));
      packet.peer.write(frame(3, ping));
    }
  });
  const presence = createDiscordPresence({
    enabled: true, clientId: APP_ID, assetKey: 'ovj_logo',
    startedAt: 1700000000123, onStatus: value => statuses.push(value)
  }, { paths: [server.target], retryDelaysMs: [1000], closeTimeoutMs: 100 });
  t.after(() => presence.stop());
  await until(() => presence.status().state === 'connected', 'publication ACK');
  const activity = server.packets.find(packet => packet.json.cmd === 'SET_ACTIVITY').json.args.activity;
  assert.equal(activity.state, 'OVJ App abierto');
  assert.equal(activity.timestamps.start, 1700000000);
  assert.equal(activity.assets.large_image, 'ovj_logo');
  assert.equal(activity.party, undefined);
  assert.equal(activity.secrets, undefined);
  assert.ok(statuses.some(status => status.state === 'connected'));
  await until(() => server.packets.some(packet => packet.opcode === 4), 'PONG');
  assert.deepEqual(server.packets.find(packet => packet.opcode === 4).json, ping);
  await presence.stop();
  await until(() => server.packets.some(packet => packet.json.args?.activity === null), 'activity clear');
  assert.equal(presence.status().state, 'disabled');
});

test('unavailable Discord scans pipes, backs off, and stop cancels reconnection', async () => {
  let calls = 0;
  const presence = createDiscordPresence({ enabled: true, clientId: APP_ID }, {
    paths: ['one', 'two'], retryDelaysMs: [25],
    connect: () => {
      calls++;
      const socket = new EventEmitter();
      socket.writable = false;
      socket.destroy = () => { socket.destroyed = true; };
      queueMicrotask(() => socket.emit('error', new Error('ENOENT')));
      return socket;
    }
  });
  await until(() => calls === 2, 'first scan');
  assert.equal(presence.status().state, 'waiting');
  await until(() => calls >= 4, 'next scan');
  await presence.stop();
  const stoppedCalls = calls;
  await delay(65);
  assert.equal(calls, stoppedCalls);
});

test('invalid local frames fail closed without publishing activity', async t => {
  const server = await fakeDiscord(t, packet => {
    const header = Buffer.alloc(8);
    header.writeUInt32LE(1);
    header.writeUInt32LE(0xffffffff, 4);
    packet.peer.write(header);
  });
  const presence = createDiscordPresence({ enabled: true, clientId: APP_ID }, {
    paths: [server.target], retryDelaysMs: [1000]
  });
  t.after(() => presence.stop());
  await until(() => presence.status().state === 'waiting', 'oversized frame rejection');
  assert.match(presence.status().detail, /demasiado grande/);
  assert.equal(server.packets.length, 1);
  await presence.stop();
});

test('Discord error does not claim an activity was published', async t => {
  const server = await fakeDiscord(t, packet => {
    if (packet.opcode === 0) ready(packet.peer);
    else packet.peer.write(frame(1, { cmd: 'SET_ACTIVITY', evt: 'ERROR', nonce: packet.json.nonce,
      data: { code: 4000, message: 'private error never exposed' } }));
  });
  const presence = createDiscordPresence({ enabled: true, clientId: APP_ID }, {
    paths: [server.target], retryDelaysMs: [1000]
  });
  t.after(() => presence.stop());
  await until(() => presence.status().state === 'waiting', 'RPC rejection');
  assert.match(presence.status().detail, /rechazó/);
  assert.doesNotMatch(presence.status().detail, /private error/);
  await presence.stop();
});

test('changing Application ID ignores callbacks from the previous connection', async t => {
  const secondId = '987654321098765432';
  const server = await fakeDiscord(t, packet => {
    if (packet.opcode === 0) ready(packet.peer);
    else if (packet.json.args?.activity) {
      packet.peer.write(frame(1, { cmd: 'SET_ACTIVITY', nonce: packet.json.nonce, data: {} }));
    }
  });
  const presence = createDiscordPresence({ enabled: true, clientId: APP_ID }, {
    paths: [server.target], retryDelaysMs: [1000], closeTimeoutMs: 50
  });
  t.after(() => presence.stop());
  await until(() => presence.status().state === 'connected', 'first connection');
  presence.configure({ clientId: secondId });
  await until(() => server.packets.some(packet => packet.json.client_id === secondId), 'new handshake');
  await until(() => presence.status().state === 'connected', 'second connection');
  await delay(70);
  assert.equal(presence.status().state, 'connected');
  await presence.stop();
});
