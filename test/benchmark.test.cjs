'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseCSV, summarize } = require('../tools/analyze-benchmark.cjs');

test('a visible pause changes tail percentiles without pretending to measure display FPS', () => {
  const report = summarize(parseCSV('timestamp_ms,interval_ms\n8,8\n16,8\n24,8\n40,16\n90,50\n'));
  assert.equal(report.samples, 5);
  assert.equal(report.observed_duration_ms, 90);
  assert.deepEqual([report.interval_ms.p50, report.interval_ms.p95, report.interval_ms.p99], [8, 50, 50]);
  assert.equal(report.callbacks_per_second, 5 * 1000 / 90);
  assert.match(report.metric, /not displayed FPS or input latency/);
  assert.equal(report.warnings.length, 1);
});

test('CSV accepts Excel BOM, CRLF and quoted labels with comma and quotes', () => {
  const samples = parseCSV('\uFEFFlabel,timestamp_ms,interval_ms\r\n"OVJ, \"\"60 Hz\"\"",120,16.7\r\n"OVJ, \"\"60 Hz\"\"",136.7,16.7\r\n');
  assert.equal(samples[0].label, 'OVJ, "60 Hz"');
  assert.equal(summarize(samples).labels['OVJ, "60 Hz"'], 2);
});

test('bad or discontinuous captures are rejected instead of silently discarding rows', () => {
  for (const invalid of [
    '',
    'timestamp_ms,interval_ms\n',
    'timestamp_ms,interval_ms\n1,\n',
    'timestamp_ms,interval_ms\n1,0\n',
    'timestamp_ms,interval_ms\n1,-2\n',
    'timestamp_ms,interval_ms\nInfinity,1\n',
    'timestamp_ms,interval_ms\n1,NaN\n',
    'timestamp_ms,interval_ms\n1,1\n1,1\n',
    'timestamp_ms,interval_ms\n1,1\n0,1\n',
    'timestamp_ms,interval_ms\n1,1\n100,1\n',
    'timestamp_ms,interval_ms\n1,1,unexpected\n',
    'timestamp_ms,interval_ms,label\n1,1,"unclosed\n',
    'timestamp_ms,interval_ms,label\n1,1,"closed"junk\n',
    'timestamp_ms,interval_ms,interval_ms\n1,1,1\n',
  ]) assert.throws(() => parseCSV(invalid), undefined, invalid);
});

test('percentiles keep a one-percent long frame visible at nearest-rank boundary', () => {
  const samples = Array.from({ length: 100 }, (_, index) => ({ timestamp_ms: index * 10, interval_ms: index < 99 ? 10 : 100, label: '' }));
  const report = summarize(samples);
  assert.equal(report.interval_ms.p99, 10);
  assert.equal(report.interval_ms.max, 100);
  assert.equal(report.warnings.length, 0);
});
