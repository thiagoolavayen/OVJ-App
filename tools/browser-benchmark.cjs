#!/usr/bin/env node
'use strict';
// Prints a self-contained browser-console capture using OVJ's same collector.
const { BENCHMARK_SOURCE } = require('../src/benchmark-collector.cjs');
process.stdout.write(`/* Seleccionar el frame del juego en DevTools. Captura 60 segundos. */\n(async () => {
  const samples = await ${BENCHMARK_SOURCE};
  if (!samples.length) throw new Error('La captura no contiene muestras.');
  const csv = 'timestamp_ms,interval_ms\\n' + samples.map(row => row.map(value => value.toFixed(6)).join(',')).join('\\n') + '\\n';
  const link = document.createElement('a');
  const url = URL.createObjectURL(new Blob([csv], {type: 'text/csv;charset=utf-8'}));
  link.href = url; link.download = 'haxball-raf.csv'; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  console.log(samples.length + ' intervalos rAF. No son FPS presentados ni latencia de entrada.');
})()\n`);
