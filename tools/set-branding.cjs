#!/usr/bin/env node
'use strict';

// Converts the supplied club mark. Never synthesizes replacement artwork.
const fs = require('node:fs/promises');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const assets = path.join(root, 'assets');
const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function pngSize(bytes) {
  if (bytes.length < 33 || !bytes.subarray(0, 8).equals(pngSignature) || bytes.toString('ascii', 12, 16) !== 'IHDR') {
    throw new Error('El logo debe ser un archivo PNG válido. No se acepta SVG ni una imagen renombrada.');
  }
  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  if (!width || !height || width > 4096 || height > 4096) {
    throw new Error('El logo debe medir entre 1 y 4096 píxeles por lado.');
  }
  return { width, height };
}

async function readLimited(filename) {
  const stat = await fs.stat(filename);
  if (!stat.isFile() || stat.size > 8 * 1024 * 1024) throw new Error('El PNG debe ser un archivo de hasta 8 MiB.');
  const bytes = await fs.readFile(filename);
  pngSize(bytes);
  return bytes;
}

async function checkBranding() {
  try {
    await readLimited(path.join(assets, 'logo.png'));
    const ico = await fs.readFile(path.join(assets, 'icon.ico'));
    if (ico.length < 22 || ico.readUInt16LE(0) !== 0 || ico.readUInt16LE(2) !== 1) throw new Error('ICO inválido.');
    const entries = ico.readUInt16LE(4);
    if (!entries || ico.length < 6 + 16 * entries) throw new Error('ICO incompleto.');
    let hasLarge = false;
    for (let i = 0; i < entries; i++) {
      const offset = 6 + i * 16;
      const width = ico[offset] || 256;
      const height = ico[offset + 1] || 256;
      const size = ico.readUInt32LE(offset + 8);
      const dataOffset = ico.readUInt32LE(offset + 12);
      if (!size || dataOffset < 6 + 16 * entries || dataOffset + size > ico.length) throw new Error('ICO truncado.');
      if (width === 256 && height === 256) hasLarge = true;
    }
    if (!hasLarge) throw new Error('Falta la entrada ICO de 256 × 256.');
  } catch (error) {
    throw new Error('Falta el logo original o su conversión válida. Ejecutá: npm run branding -- "ruta/al/logo.png". No se generará un instalador con un logo sustituto.', { cause: error });
  }
  console.log('Logo original e icono ICO verificados.');
}

function createIconImages(original, resize) {
  // Fit the mark to its own square first. A shared 256px canvas would halve
  // a 128px source again in every small icon, wasting the available pixels.
  const canvasSize = Math.max(original.width, original.height);
  const square = {
    width: canvasSize,
    height: canvasSize,
    data: Buffer.alloc(canvasSize * canvasSize * 4)
  };
  const left = Math.floor((canvasSize - original.width) / 2);
  const top = Math.floor((canvasSize - original.height) / 2);
  for (let row = 0; row < original.height; row++) {
    original.data.copy(square.data, ((top + row) * canvasSize + left) * 4, row * original.width * 4, (row + 1) * original.width * 4);
  }
  const sizes = [16, 24, 32, 48, 64, 128, 256];
  return sizes.map(size => {
    const fittedSize = Math.min(size, canvasSize);
    const fitted = fittedSize === canvasSize ? square : resize(square, fittedSize, fittedSize, 'bicubicInterpolation');
    if (size === fittedSize) return fitted;
    // Larger requested sizes get transparent padding instead of upscaling.
    const canvas = { width: size, height: size, data: Buffer.alloc(size * size * 4) };
    const offset = Math.floor((size - fittedSize) / 2);
    for (let row = 0; row < fittedSize; row++) {
      fitted.data.copy(canvas.data, ((offset + row) * size + offset) * 4, row * fittedSize * 4, (row + 1) * fittedSize * 4);
    }
    return canvas;
  });
}

async function convertBranding(filename) {
  const bytes = await readLimited(path.resolve(filename));
  const [{ imagesToIco }, { readPNG, resize }] = await Promise.all([
    import('png-to-ico'),
    // This helper is part of the exact pinned png-to-ico 3.0.2 package.
    import('png-to-ico/lib/png.js')
  ]);
  const original = await readPNG(bytes);
  const icons = createIconImages(original, resize);
  const sizes = icons.map(image => image.width);
  const ico = imagesToIco(icons);
  await fs.mkdir(assets, { recursive: true });
  // Keep the original bytes and transparency untouched for app identity/Discord.
  await fs.writeFile(path.join(assets, 'logo.png'), bytes);
  await fs.writeFile(path.join(assets, 'icon.ico'), ico);
  console.log(`Logo original conservado (${original.width} × ${original.height}). ICO generado con ${sizes.join(', ')} px.`);
  if (Math.max(original.width, original.height) < 256) {
    console.log('Los tamaños pequeños aprovechan su lienzo completo; los mayores que el original se centran en transparencia sin ampliar el dibujo.');
  }
  await checkBranding();
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === '--check') return checkBranding();
  if (args.length !== 1 || args[0].startsWith('--')) throw new Error('Uso: npm run branding -- "ruta/al/logo.png" o node tools/set-branding.cjs --check');
  await convertBranding(args[0]);
}

if (require.main === module) main().catch(error => {
  console.error(error.message);
  if (error.cause?.message) console.error(error.cause.message);
  process.exitCode = 1;
});

module.exports = { pngSize, checkBranding, convertBranding, createIconImages };
