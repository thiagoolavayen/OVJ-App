'use strict';

// Writes literal, package-owned deletion instructions. No wildcard or recursive
// directory removal is emitted into the uninstaller.
const fs = require('node:fs/promises');
const path = require('node:path');

const nsisEscape = value => value.replaceAll('$', () => '$$').replaceAll('"', '$\\"');

async function createManifest(unpacked, output) {
  const root = path.resolve(unpacked);
  const files = [];
  const dirs = [];
  async function visit(relative) {
    const entries = await fs.readdir(path.join(root, relative), { withFileTypes: true });
    for (const entry of entries) {
      if (/[\x00-\x1f\x7f]/.test(entry.name)) throw new Error('Nombre de archivo de paquete inválido.');
      const child = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isSymbolicLink()) throw new Error(`No se permiten enlaces simbólicos en el paquete: ${child}`);
      if (entry.isDirectory()) { dirs.push(child); await visit(child); }
      else if (entry.isFile()) files.push(child);
      else throw new Error(`Tipo de archivo no admitido: ${child}`);
    }
  }
  await visit('');
  if (!files.includes('OVJ App.exe') || !files.includes('resources/app.asar')) throw new Error('La carpeta debe contener OVJ App.exe y resources/app.asar.');
  const lines = ['; Generated from this exact package. Literal deletion only.'];
  for (const file of files.sort()) {
    lines.push('ClearErrors');
    lines.push(`Delete "$INSTDIR\\${nsisEscape(file.replaceAll('/', '\\'))}"`);
    lines.push('IfErrors ovjUninstallFilesBusy');
  }
  for (const dir of dirs.sort((a, b) => b.split('/').length - a.split('/').length || b.localeCompare(a))) {
    lines.push(`RMDir "$INSTDIR\\${nsisEscape(dir.replaceAll('/', '\\'))}"`);
  }
  await fs.mkdir(path.dirname(path.resolve(output)), { recursive: true });
  await fs.writeFile(output, `${lines.join('\n')}\n`, 'utf8');
  return { files: files.length, directories: dirs.length, output: path.resolve(output) };
}

if (require.main === module) {
  if (process.argv.length !== 4) {
    console.error('Uso: node tools/create-preview-uninstall.cjs carpeta-win-unpacked salida.nsh');
    process.exitCode = 1;
  } else createManifest(process.argv[2], process.argv[3])
    .then(result => console.log(JSON.stringify(result)))
    .catch(error => { console.error(error.message); process.exitCode = 1; });
}

module.exports = { createManifest };
