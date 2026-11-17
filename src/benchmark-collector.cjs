'use strict';

// Executed as ordinary page JavaScript in the HaxBall frame. No Electron/Node API
// or IPC is made available to that frame. Keep this function self-contained.
function collectFrameIntervals() {
  'use strict';
  if (typeof window.__ovjStopBenchmark === 'function') {
    return Promise.reject(new Error('Ya hay una captura de diagnóstico en curso.'));
  }
  return new Promise(resolve => {
    const durationMs = 60_000;
    const maximumDurationMs = 10 * 60_000;
    const maximumSamples = 150_000;
    const samples = [];
    let previousTimestamp = null;
    let firstTimestamp = null;
    let frameId = null;
    let timerId = null;
    let finished = false;

    function finish() {
      if (finished) return;
      finished = true;
      if (frameId !== null) cancelAnimationFrame(frameId);
      if (timerId !== null) clearTimeout(timerId);
      window.removeEventListener('pagehide', finish);
      if (window.__ovjStopBenchmark === finish) delete window.__ovjStopBenchmark;
      resolve(samples);
    }

    function record(timestamp) {
      frameId = null;
      if (finished) return;
      if (!Number.isFinite(timestamp) || timestamp < 0 ||
          (previousTimestamp !== null && timestamp < previousTimestamp)) {
        finish();
        return;
      }
      if (firstTimestamp === null) firstTimestamp = timestamp;
      if (previousTimestamp !== null && timestamp > previousTimestamp) {
        samples.push([timestamp, timestamp - previousTimestamp]);
      }
      previousTimestamp = timestamp;
      if (samples.length >= maximumSamples || timestamp - firstTimestamp >= maximumDurationMs) {
        finish();
        return;
      }
      frameId = requestAnimationFrame(record);
    }

    window.__ovjStopBenchmark = finish;
    window.addEventListener('pagehide', finish, { once: true });
    timerId = setTimeout(finish, Math.min(durationMs, maximumDurationMs));
    frameId = requestAnimationFrame(record);
  });
}

const BENCHMARK_SOURCE = `(${collectFrameIntervals.toString()})()`;
const STOP_BENCHMARK_SOURCE = `(() => {
  if (typeof window.__ovjStopBenchmark !== 'function') return false;
  window.__ovjStopBenchmark();
  return true;
})()`;

module.exports = { BENCHMARK_SOURCE, STOP_BENCHMARK_SOURCE };
