'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { BENCHMARK_SOURCE, STOP_BENCHMARK_SOURCE } = require('../src/benchmark-collector.cjs');

function createPage() {
  let nextId = 1;
  const frames = new Map();
  const timers = new Map();
  const listeners = new Map();
  const context = vm.createContext({
    window: {
      addEventListener(name, handler) { listeners.set(name, handler); },
      removeEventListener(name, handler) { if (listeners.get(name) === handler) listeners.delete(name); },
    },
    requestAnimationFrame(handler) { const id = nextId++; frames.set(id, handler); return id; },
    cancelAnimationFrame(id) { frames.delete(id); },
    setTimeout(handler, delay) { const id = nextId++; timers.set(id, { handler, delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
  });
  return {
    context, frames, timers, listeners,
    start: () => vm.runInContext(BENCHMARK_SOURCE, context),
    stop: () => vm.runInContext(STOP_BENCHMARK_SOURCE, context),
    frame(timestamp) {
      const pending = [...frames.entries()];
      frames.clear();
      for (const [, handler] of pending) handler(timestamp);
    },
    assertClean() {
      assert.equal(frames.size, 0);
      assert.equal(timers.size, 0);
      assert.equal(listeners.size, 0);
      assert.equal('__ovjStopBenchmark' in context.window, false);
    },
  };
}

test('manual stop exports real intervals, skips the baseline and removes every pending callback', async () => {
  const page = createPage();
  const capture = page.start();
  page.frame(100);
  page.frame(116.5);
  page.frame(150);
  assert.equal(page.stop(), true);
  assert.deepEqual(Array.from(await capture, row => Array.from(row)), [[116.5, 16.5], [150, 33.5]]);
  page.assertClean();
  assert.equal(page.stop(), false);
});

test('the 60 second timer completes even when a background page receives no animation frames', async () => {
  const page = createPage();
  const capture = page.start();
  assert.equal(page.timers.size, 1);
  const timer = [...page.timers.values()][0];
  assert.equal(timer.delay, 60_000);
  timer.handler();
  assert.equal((await capture).length, 0);
  page.assertClean();
});

test('a second start rejects without adding another loop or stopping the active capture', async () => {
  const page = createPage();
  const capture = page.start();
  await assert.rejects(page.start(), /captura.*en curso/);
  assert.equal(page.frames.size, 1);
  assert.equal(page.timers.size, 1);
  page.frame(10);
  page.frame(20);
  page.stop();
  assert.equal((await capture).length, 1);
  page.assertClean();
  const nextCapture = page.start();
  page.stop();
  await nextCapture;
  page.assertClean();
});

test('pagehide completes and cleans up instead of retaining a capture after navigation', async () => {
  const page = createPage();
  const capture = page.start();
  page.frame(10);
  page.listeners.get('pagehide')();
  assert.equal((await capture).length, 0);
  page.assertClean();
});

test('a late callback is inert after stop, and equal timestamps do not create zero intervals', async () => {
  const page = createPage();
  const capture = page.start();
  page.frame(10);
  page.frame(10);
  page.frame(20);
  const lateCallback = [...page.frames.values()][0];
  page.stop();
  lateCallback(30);
  const samples = await capture;
  assert.deepEqual(Array.from(samples, row => Array.from(row)), [[20, 10]]);
  page.assertClean();
});

test('the ten minute monotonic guard also bounds collection if wall-clock timers are delayed', async () => {
  const page = createPage();
  const capture = page.start();
  page.frame(100);
  page.frame(600_100);
  assert.equal((await capture).length, 1);
  page.assertClean();
});

test('sample count is bounded even with an unrealistically fast stream of frames', async () => {
  const page = createPage();
  const capture = page.start();
  for (let timestamp = 0; timestamp <= 150_000; timestamp++) page.frame(timestamp);
  assert.equal((await capture).length, 150_000);
  page.assertClean();
});
