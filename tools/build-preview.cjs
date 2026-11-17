'use strict';

// Uses the supplied original mark when available. Otherwise the preview removes
// bundled icons rather than adding a replacement. All PE editing is JavaScript;
// the custom NSIS installer does not execute a Wine uninstaller helper.
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { build, Platform, Arch } = require('electron-builder');
const { DebugLogger } = require('builder-util');
const { validateConfiguration } = require('app-builder-lib/out/util/config/config');
const yaml = require('js-yaml');
const { checkBranding } = require('./set-branding.cjs');
const { stripAndDescribeExe, describe } = require('./preview-resources.cjs');
const { createManifest } = require('./create-preview-uninstall.cjs');

async function isFile(filename) {
  try { return (await fs.stat(filename)).isFile(); }
  catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}

async function detectBranding(projectDir) {
  const logo = path.join(projectDir, 'assets', 'logo.png');
  const icon = path.join(projectDir, 'assets', 'icon.ico');
  const [hasLogo, hasIcon] = await Promise.all([isFile(logo), isFile(icon)]);
  const enabled = hasLogo && hasIcon;
  if (!enabled) return { enabled, hasLogo, hasIcon, logo, icon };
  // Invalid files fail visibly instead of silently changing the app identity.
  await checkBranding();
  const [png, ico] = await Promise.all([fs.readFile(logo), fs.readFile(icon)]);
  const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
  return { enabled, hasLogo, hasIcon, logo, icon, logoSha256: hash(png), iconSha256: hash(ico) };
}

function createPreviewConfig(canonical, { output, branding }) {
  const config = structuredClone(canonical);
  config.extends = null;
  config.directories = { ...config.directories, output };
  config.compression = 'normal';
  config.win = {
    ...config.win,
    target: [{ target: 'portable', arch: ['x64'] }],
    signExecutable: false,
    // electron-builder 26.18 edits these resources with resedit, without Wine.
    signAndEditExecutable: branding.enabled,
    icon: branding.enabled ? branding.icon : null
  };
  config.nsis = {
    ...config.nsis,
    installerIcon: branding.enabled ? branding.icon : null,
    uninstallerIcon: branding.enabled ? branding.icon : null
  };
  if (!branding.enabled) config.icon = null;
  config.portable = { ...config.portable, artifactName: 'OVJ-App-${version}-${arch}-Portable-Preview.${ext}' };
  return config;
}

function createInstallerConfig(base, projectDir) {
  const config = structuredClone(base);
  // NSIS 3.12 supports !uninstfinalize: embed a complete, independently finalized
  // uninstaller instead of a delta tied to the installer's PE resource offsets.
  config.toolsets = { ...config.toolsets, nsis: '1.2.1' };
  config.win.target = [{ target: 'nsis', arch: ['x64'] }];
  config.nsis = {
    ...config.nsis,
    artifactName: 'OVJ-App-${version}-${arch}-Setup-Preview.${ext}',
    script: path.join(projectDir, 'tools', 'installer-preview.nsi'),
    installerLanguages: ['es_ES'],
    packElevateHelper: false,
    differentialPackage: false,
    perMachine: false,
    allowElevation: false
  };
  return config;
}

async function executableReport(filename, { branding, version, allowNsis = false, description }) {
  const report = branding.enabled
    ? describe(await fs.readFile(filename))
    : await stripAndDescribeExe(filename, { preserveOverlay: true, allowNsis, version, description });
  if (branding.enabled && !report.icons) throw new Error(`Falta el icono original esperado en ${filename}. Recompilá sin --reuse-unpacked.`);
  return { path: filename, ...report, signed: false };
}

async function main(argv = process.argv.slice(2)) {
  const allowed = new Set(['--installer', '--reuse-unpacked']);
  for (const flag of argv) if (!allowed.has(flag)) throw new Error(`Opción no admitida: ${flag}. Usá --installer o --reuse-unpacked.`);
  const projectDir = path.resolve(__dirname, '..');
  const output = path.resolve(process.env.OVJ_PREVIEW_OUTPUT || path.join(projectDir, 'dist-preview'));
  const { version } = JSON.parse(await fs.readFile(path.join(projectDir, 'package.json'), 'utf8'));
  const peVersion = `${version.split('-')[0]}.0`;
  const branding = await detectBranding(projectDir);
  const canonical = yaml.load(await fs.readFile(path.join(projectDir, 'electron-builder.yml'), 'utf8'));
  const config = createPreviewConfig(canonical, { output, branding });
  const installerConfig = argv.includes('--installer') ? createInstallerConfig(config, projectDir) : null;
  await validateConfiguration(config, new DebugLogger());
  if (installerConfig) await validateConfiguration(installerConfig, new DebugLogger());
  const unpacked = path.join(output, 'win-unpacked');
  if (argv.includes('--reuse-unpacked')) {
    const asar = require('@electron/asar');
    const packaged = JSON.parse(asar.extractFile(path.join(unpacked, 'resources', 'app.asar'), 'package.json').toString());
    if (packaged.version !== version) throw new Error(`La carpeta reutilizada es ${packaged.version}, pero el proyecto es ${version}. Recompilá sin --reuse-unpacked.`);
    if (branding.enabled) {
      const previous = JSON.parse(await fs.readFile(path.join(output, 'preview-build-report.json'), 'utf8'));
      if (previous.brandAssets?.icoSha256 !== branding.iconSha256 || previous.brandAssets?.pngSha256 !== branding.logoSha256) {
        throw new Error('El escudo de la carpeta reutilizada no coincide con los archivos originales actuales. Recompilá sin --reuse-unpacked.');
      }
    }
  } else {
    await build({ projectDir, targets: Platform.WINDOWS.createTarget(['dir'], Arch.x64), config, publish: 'never' });
  }
  const executable = path.join(unpacked, 'OVJ App.exe');
  const mainReport = await executableReport(executable, { branding, version: peVersion });
  // Never reuse an archive made before updating the executable's icon/version.
  for (const name of await fs.readdir(output)) {
    if (name.endsWith('.nsis.7z') || name.endsWith('.nsis.zip')) await fs.unlink(path.join(output, name));
  }
  await build({ projectDir, prepackaged: unpacked, targets: Platform.WINDOWS.createTarget(['portable'], Arch.x64), config, publish: 'never' });
  const portable = path.join(output, `OVJ-App-${version}-x64-Portable-Preview.exe`);
  const portableReport = await executableReport(portable, { branding, version: peVersion, allowNsis: true, description: 'OVJ App · Portable preliminar' });
  const report = {
    status: 'compiled; Windows hardware validation pending',
    brandStatus: branding.enabled ? 'original-assets-applied' : 'pending-original-assets; no replacement logo embedded',
    brandAssets: {
      pngPresent: branding.hasLogo,
      icoPresent: branding.hasIcon,
      ...(branding.enabled ? { pngSha256: branding.logoSha256, icoSha256: branding.iconSha256 } : {})
    },
    main: mainReport,
    portable: portableReport
  };
  const reportPath = path.join(output, 'preview-build-report.json');
  // Keep the successfully built portable reviewable if the optional setup fails.
  await fs.writeFile(reportPath, JSON.stringify(report, null, 2) + '\n');
  if (installerConfig) {
    const manifest = path.join(output, 'preview-uninstall.nsh');
    await createManifest(unpacked, manifest);
    const previousUnpacked = process.env.OVJ_PREVIEW_UNPACKED_DIR;
    const previousManifest = process.env.OVJ_PREVIEW_UNINSTALL_MANIFEST;
    const previousNodePath = process.env.OVJ_PREVIEW_NODE_PATH;
    const previousGlob = process.env.OVJ_PREVIEW_FILE_GLOB;
    process.env.OVJ_PREVIEW_UNPACKED_DIR = unpacked;
    process.env.OVJ_PREVIEW_UNINSTALL_MANIFEST = manifest;
    process.env.OVJ_PREVIEW_NODE_PATH = process.execPath;
    process.env.OVJ_PREVIEW_FILE_GLOB = path.join(unpacked, "*");
    try {
      await build({ projectDir, prepackaged: unpacked, targets: Platform.WINDOWS.createTarget(['nsis'], Arch.x64), config: installerConfig, publish: 'never' });
    } finally {
      if (previousUnpacked === undefined) delete process.env.OVJ_PREVIEW_UNPACKED_DIR;
      else process.env.OVJ_PREVIEW_UNPACKED_DIR = previousUnpacked;
      if (previousManifest === undefined) delete process.env.OVJ_PREVIEW_UNINSTALL_MANIFEST;
      else process.env.OVJ_PREVIEW_UNINSTALL_MANIFEST = previousManifest;
      if (previousGlob === undefined) delete process.env.OVJ_PREVIEW_FILE_GLOB;
      else process.env.OVJ_PREVIEW_FILE_GLOB = previousGlob;
      if (previousNodePath === undefined) delete process.env.OVJ_PREVIEW_NODE_PATH;
      else process.env.OVJ_PREVIEW_NODE_PATH = previousNodePath;
    }
    const installer = path.join(output, `OVJ-App-${version}-x64-Setup-Preview.exe`);
    // Safe because !uninstfinalize embeds the finalized uninstaller in full.
    // Editing a legacy NSIS installer with delta uninstallers would corrupt it.
    report.installer = await executableReport(installer, { branding, version: peVersion, allowNsis: true, description: 'OVJ App · Instalador preliminar' });
    await fs.writeFile(reportPath, JSON.stringify(report, null, 2) + '\n');
  }
  console.log(`Programa Windows generado: ${executable}`);
  console.log(`Ejecutable portable generado: ${portable}`);
  if (report.installer) console.log(`Instalador generado: ${report.installer.path}`);
  console.log(branding.enabled ? 'Escudo original conservado en los ejecutables.' : 'Escudo original pendiente: no se incorporó un logo sustituto.');
  return report;
}

if (require.main === module) main().catch(error => { console.error(error.stack); process.exit(1); });

module.exports = { main, detectBranding, createPreviewConfig, createInstallerConfig };
