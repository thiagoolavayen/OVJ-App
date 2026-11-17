#!/usr/bin/env node
'use strict';

const fs = require('node:fs');

// Small RFC 4180-style reader: quoted labels, escaped quotes and CRLF are supported.
function readRecords(text) {
  const records = [];
  let record = [];
  let field = '';
  let quoted = false;
  let closedQuote = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else { quoted = false; closedQuote = true; }
      } else field += char;
      continue;
    }
    if (char === '"') {
      if (field || closedQuote) throw new Error('CSV inválido: comillas dentro de un campo sin escapar.');
      quoted = true;
    } else if (char === ',') {
      record.push(field); field = ''; closedQuote = false;
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[i + 1] === '\n') i++;
      record.push(field);
      if (record.some(value => value.trim() !== '')) records.push(record);
      record = []; field = ''; closedQuote = false;
    } else {
      if (closedQuote) throw new Error('CSV inválido: texto después del cierre de comillas.');
      field += char;
    }
  }
  if (quoted) throw new Error('CSV inválido: campo entre comillas sin cerrar.');
  record.push(field);
  if (record.some(value => value.trim() !== '')) records.push(record);
  return records;
}

function parseCSV(text) {
  if (typeof text !== 'string') throw new TypeError('El CSV debe ser texto UTF-8.');
  const records = readRecords(text.replace(/^\uFEFF/, ''));
  if (!records.length) throw new Error('CSV vacío.');
  const header = records.shift().map(value => value.trim());
  if (new Set(header).size !== header.length) throw new Error('El encabezado tiene columnas repetidas.');
  if (!header.includes('timestamp_ms') || !header.includes('interval_ms') ||
      header.some(value => !['timestamp_ms', 'interval_ms', 'label'].includes(value))) {
    throw new Error('Encabezado esperado: timestamp_ms,interval_ms[,label].');
  }
  const timestampIndex = header.indexOf('timestamp_ms');
  const intervalIndex = header.indexOf('interval_ms');
  const labelIndex = header.indexOf('label');
  let previousTimestamp;
  const samples = records.map((record, index) => {
    const row = index + 2;
    if (record.length !== header.length) throw new Error(`Fila ${row}: cantidad de columnas incorrecta.`);
    const rawTimestamp = record[timestampIndex].trim();
    const rawInterval = record[intervalIndex].trim();
    const timestamp = Number(rawTimestamp);
    const interval = Number(rawInterval);
    if (!rawTimestamp || !Number.isFinite(timestamp) || timestamp < 0) {
      throw new Error(`Fila ${row}: timestamp_ms debe ser finito y no negativo.`);
    }
    if (!rawInterval || !Number.isFinite(interval) || interval <= 0) {
      throw new Error(`Fila ${row}: interval_ms debe ser finito y mayor que cero.`);
    }
    if (previousTimestamp !== undefined) {
      if (timestamp <= previousTimestamp) throw new Error(`Fila ${row}: timestamp_ms debe crecer estrictamente.`);
      if (Math.abs((timestamp - previousTimestamp) - interval) > 0.1) {
        throw new Error(`Fila ${row}: interval_ms no coincide con la diferencia de timestamps (tolerancia 0,1 ms).`);
      }
    }
    previousTimestamp = timestamp;
    return { timestamp_ms: timestamp, interval_ms: interval, label: labelIndex === -1 ? '' : record[labelIndex] };
  });
  if (!samples.length) throw new Error('El CSV no contiene muestras.');
  return samples;
}

function summarize(samples) {
  if (!Array.isArray(samples) || !samples.length) throw new Error('Se necesita al menos una muestra.');
  const sorted = samples.map(sample => sample.interval_ms).sort((a, b) => a - b);
  if (sorted.some(value => !Number.isFinite(value) || value <= 0)) throw new Error('Intervalos inválidos.');
  const count = sorted.length;
  const percentile = fraction => sorted[Math.max(0, Math.ceil(fraction * count) - 1)];
  const total = sorted.reduce((sum, value) => sum + value, 0);
  const mean = total / count;
  const labels = new Map();
  for (const sample of samples) if (sample.label) labels.set(sample.label, (labels.get(sample.label) || 0) + 1);
  return {
    metric: 'requestAnimationFrame callback intervals; not displayed FPS or input latency',
    percentile_method: 'nearest-rank: sorted[ceil(p * n) - 1]',
    samples: count,
    observed_duration_ms: total,
    callbacks_per_second: count * 1000 / total,
    interval_ms: {
      mean,
      p50: percentile(0.50),
      p95: percentile(0.95),
      p99: percentile(0.99),
      max: sorted[count - 1],
      standard_deviation_population: Math.sqrt(sorted.reduce((sum, value) => sum + (value - mean) ** 2, 0) / count),
    },
    labels: Object.fromEntries(labels),
    warnings: count < 100 ? ['Menos de 100 muestras: p99 tiene muy poca resolución estadística.'] : [],
  };
}

function main(args) {
  const asJSON = args.includes('--json');
  const files = args.filter(value => value !== '--json');
  if (files.length !== 1 || files[0].startsWith('--')) {
    process.stderr.write('Uso: node tools/analyze-benchmark.cjs archivo.csv [--json]\n');
    return 2;
  }
  try {
    const report = summarize(parseCSV(fs.readFileSync(files[0], 'utf8')));
    if (asJSON) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    else {
      const format = value => value.toFixed(3);
      process.stdout.write([
        'Intervalos observados de callbacks requestAnimationFrame',
        `Muestras: ${report.samples} | duración cubierta: ${format(report.observed_duration_ms / 1000)} s`,
        `Callbacks/s observados: ${format(report.callbacks_per_second)}`,
        `Intervalos (ms): media ${format(report.interval_ms.mean)} | p50 ${format(report.interval_ms.p50)} | p95 ${format(report.interval_ms.p95)} | p99 ${format(report.interval_ms.p99)} | máximo ${format(report.interval_ms.max)}`,
        'Percentiles: nearest-rank. No mide FPS presentados, ping ni latencia de entrada.',
        ...report.warnings,
      ].join('\n') + '\n');
    }
    return 0;
  } catch (error) {
    process.stderr.write(`No se pudo analizar la captura: ${error.message}\n`);
    return 1;
  }
}

module.exports = { parseCSV, summarize };
if (require.main === module) process.exitCode = main(process.argv.slice(2));
