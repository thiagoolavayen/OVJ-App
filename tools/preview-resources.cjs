'use strict';

// This preview deliberately carries no replacement logo. It removes the
// bundled Electron icon while preserving every unrelated PE resource.
// NSIS layout/CRC follows Source/exehead/fileform.{h,c}, not assumptions about
// the last four bytes of an arbitrary executable.
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { crc32 } = require('node:zlib');
const PE = require('pe-library');
const ResEdit = require('resedit');

const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

function locateNsis(bytes) {
  for (let offset = 512; offset + 28 <= bytes.length; offset += 512) {
    if (bytes.readUInt32LE(offset + 4) !== 0xdeadbeef ||
        bytes.readUInt32LE(offset + 8) !== 0x6c6c754e ||
        bytes.readUInt32LE(offset + 12) !== 0x74666f73 ||
        bytes.readUInt32LE(offset + 16) !== 0x74736e49) continue;
    const flags = bytes.readUInt32LE(offset);
    const length = bytes.readUInt32LE(offset + 24);
    if ((flags & ~15) || length < 28 || offset + length > bytes.length) {
      throw new Error('NSIS firstheader inválido; no se modificó el ejecutable.');
    }
    const hasCrc = !(flags & 4) || Boolean(flags & 8);
    const crcOffset = hasCrc ? offset + length - 4 : null;
    if (hasCrc && crc32(bytes.subarray(512, crcOffset)) !== bytes.readUInt32LE(crcOffset)) {
      throw new Error('El CRC NSIS original no coincide; no se modificó el ejecutable.');
    }
    return { offset, length, flags, hasCrc, crcOffset };
  }
  return null;
}

function describe(bytes) {
  const exe = PE.NtExecutable.from(bytes, { ignoreCert: true });
  const resource = PE.NtExecutableResource.from(exe);
  return {
    bytes: bytes.length,
    sha256: hash(bytes),
    architecture: exe.is32bit() ? 'x86' : 'x64',
    icons: resource.entries.filter(entry => entry.type === 3 || entry.type === 14).length,
    resources: resource.entries.map(entry => ({ type: entry.type, id: entry.id, lang: entry.lang, bytes: entry.bin.byteLength })),
    nsis: locateNsis(bytes)
  };
}

async function stripAndDescribeExe(filename, options = {}) {
  const original = await fs.readFile(filename);
  const oldNsis = locateNsis(original);
  if (oldNsis && !options.allowNsis) {
    throw new Error('El archivo contiene un payload NSIS. Usá allowNsis:true para validarlo y conservarlo explícitamente.');
  }
  const exe = PE.NtExecutable.from(original, { ignoreCert: true });
  const originalOverlay = exe.getExtraData();
  if (originalOverlay && originalOverlay.byteLength && !oldNsis && !options.preserveOverlay) {
    throw new Error('El archivo contiene datos adicionales sin reconocer. Usá preserveOverlay:true para conservarlos explícitamente.');
  }
  const resource = PE.NtExecutableResource.from(exe);
  const keptResources = resource.entries.filter(entry => entry.type !== 3 && entry.type !== 14);
  const retained = keptResources.map(entry => ({ type: entry.type, id: entry.id, lang: entry.lang, hash: hash(Buffer.from(entry.bin)) }));
  resource.entries = keptResources;

  if (options.metadata !== false) {
    let versions = ResEdit.Resource.VersionInfo.fromEntries(resource.entries);
    if (!versions.length) versions = [ResEdit.Resource.VersionInfo.createEmpty()];
    for (const version of versions) {
      const languages = version.getAllLanguagesForStringValues();
      if (!languages.length) languages.push({ lang: 1033, codepage: 1200 });
      for (const language of languages) {
        version.setStringValues(language, {
          CompanyName: 'Ovejeros FC',
          FileDescription: options.description || 'OVJ App',
          ProductName: 'OVJ App',
          OriginalFilename: path.basename(filename),
          InternalName: 'OVJ App',
          LegalCopyright: 'Copyright © 2026 Ovejeros FC'
        });
        version.setFileVersion(options.version || '0.1.0.0', language.lang);
        version.setProductVersion(options.version || '0.1.0.0', language.lang);
      }
      version.outputToResourceEntries(resource.entries);
    }
  }
  resource.outputResource(exe);
  let output = Buffer.from(exe.generate());
  const newNsis = (() => {
    // Resource resizing changes the PE prefix, so its old CRC must be repaired
    // before locateNsis performs its strict validation.
    if (!oldNsis) return null;
    const signature = original.subarray(oldNsis.offset + 4, oldNsis.offset + 20);
    let newOffset = -1;
    for (let offset = 512; offset + 28 <= output.length; offset += 512) {
      if (output.subarray(offset + 4, offset + 20).equals(signature)) {
        newOffset = offset;
        break;
      }
    }
    if (newOffset < 0) throw new Error('El payload NSIS perdió su alineación de 512 bytes.');
    const payloadLength = oldNsis.length - (oldNsis.hasCrc ? 4 : 0);
    if (!original.subarray(oldNsis.offset, oldNsis.offset + payloadLength).equals(output.subarray(newOffset, newOffset + payloadLength))) {
      throw new Error('El payload NSIS cambió durante la edición de recursos.');
    }
    if (oldNsis.hasCrc) {
      const crcOffset = newOffset + oldNsis.length - 4;
      output.writeUInt32LE(crc32(output.subarray(512, crcOffset)), crcOffset);
    }
    return locateNsis(output);
  })();

  const verifiedExe = PE.NtExecutable.from(output);
  const verifiedResource = PE.NtExecutableResource.from(verifiedExe);
  if (verifiedResource.entries.some(entry => entry.type === 3 || entry.type === 14)) throw new Error('Persisten recursos de icono.');
  for (const old of retained) {
    if (old.type === 16 && options.metadata !== false) continue;
    const entry = verifiedResource.entries.find(entry => entry.type === old.type && entry.id === old.id && entry.lang === old.lang);
    if (!entry || hash(Buffer.from(entry.bin)) !== old.hash) throw new Error(`Cambió un recurso ajeno al icono: ${old.type}/${old.id}.`);
  }
  if (!oldNsis && originalOverlay) {
    const newOverlay = verifiedExe.getExtraData();
    if (!newOverlay || !Buffer.from(originalOverlay).equals(Buffer.from(newOverlay))) throw new Error('Los datos extra del PE cambiaron.');
  }
  const temp = `${filename}.resource-edit.tmp`;
  await fs.writeFile(temp, output);
  await fs.rename(temp, filename);
  return { ...describe(output), nsis: newNsis, noReplacementLogo: true, signed: false };
}

async function afterPack(context) {
  if (context.electronPlatformName !== 'win32') return;
  const filename = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.exe`);
  const result = await stripAndDescribeExe(filename, { preserveOverlay: true, version: `${context.packager.appInfo.version}.0` });
  console.log(`OVJ preview: sin icono sustituto, ${result.architecture}, ${result.bytes} bytes.`);
}

if (require.main === module) {
  const filename = process.argv[2];
  if (!filename) {
    console.error('Uso: node tools/preview-resources.cjs archivo.exe [--nsis]');
    process.exitCode = 1;
  } else stripAndDescribeExe(filename, { preserveOverlay: true, allowNsis: process.argv.includes('--nsis') })
    .then(result => console.log(JSON.stringify(result, null, 2)))
    .catch(error => { console.error(error.stack); process.exitCode = 1; });
}

module.exports = { stripAndDescribeExe, afterPack, describe, locateNsis };
