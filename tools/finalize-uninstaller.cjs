'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const PE = require('pe-library');
const { checkBranding } = require('./set-branding.cjs');
const { stripAndDescribeExe, describe } = require('./preview-resources.cjs');

function manifest(bytes) {
  const exe = PE.NtExecutable.from(bytes, { ignoreCert: true });
  const entries = PE.NtExecutableResource.from(exe).entries;
  const entry = entries.find(item => item.type === 24);
  if (!entry) throw new Error('El desinstalador no contiene un manifiesto de Windows.');
  const data = Buffer.from(entry.bin);
  const text = data.toString('utf8').replace(/^\uFEFF/, '');
  if (!/^<\?xml\b/.test(text) || !/<assembly\b/.test(text) || !/<requestedExecutionLevel\b[^>]*\blevel="asInvoker"/.test(text)) {
    throw new Error('El manifiesto del desinstalador no es XML reconocido con nivel asInvoker.');
  }
  return data;
}

async function isFile(filename) {
  try { return (await fs.stat(filename)).isFile(); }
  catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}

async function finalizeUninstaller(filename, version) {
  if (!filename || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version || '')) {
    throw new Error('Uso: node tools/finalize-uninstaller.cjs archivo.exe version');
  }
  const originalManifest = manifest(await fs.readFile(filename));
  const assets = path.join(__dirname, '..', 'assets');
  const [hasLogo, hasIcon] = await Promise.all([isFile(path.join(assets, 'logo.png')), isFile(path.join(assets, 'icon.ico'))]);
  let report;
  if (hasLogo && hasIcon) {
    await checkBranding();
    report = describe(await fs.readFile(filename));
    if (!report.icons) throw new Error('El desinstalador no contiene el icono original esperado.');
  } else {
    report = await stripAndDescribeExe(filename, { allowNsis: true, preserveOverlay: true, version: `${version.split('-')[0]}.0`, description: 'OVJ App · Desinstalador' });
  }
  if (!originalManifest.equals(manifest(await fs.readFile(filename)))) throw new Error('El manifiesto del desinstalador cambió durante la finalización.');
  console.log(`OVJ uninstaller finalized: ${report.bytes} bytes, ${report.icons} icon resources, SHA256 ${report.sha256}, manifest preserved.`);
  return report;
}

if (require.main === module) finalizeUninstaller(process.argv[2], process.argv[3])
  .catch(error => { console.error(error.stack); process.exitCode = 1; });

module.exports = { finalizeUninstaller };
