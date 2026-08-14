'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const { atomicWrite, listSkillFiles } = require('./util');

const CRC_TABLE = (function makeCrcTable() {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
    }
    table[index] = value >>> 0;
  }
  return table;
}());

function crc32(buffer) {
  let value = 0xffffffff;
  for (let index = 0; index < buffer.length; index += 1) {
    value = CRC_TABLE[(value ^ buffer[index]) & 0xff] ^ (value >>> 8);
  }
  return (value ^ 0xffffffff) >>> 0;
}

function buildArchiveEntries(skill) {
  return listSkillFiles(skill.path).map(function toEntry(file) {
    return {
      name: skill.directoryName + '/' + file.relative,
      content: fs.readFileSync(file.path),
      mode: fs.statSync(file.path).mode & 0xffff,
    };
  }).sort(function byName(a, b) {
    return a.name.localeCompare(b.name);
  });
}

function buildArchive(skill) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  const flags = 0x0800;
  const method = 8;
  const dosTime = 0;
  const dosDate = 33;

  buildArchiveEntries(skill).forEach(function addEntry(entry) {
    const name = Buffer.from(entry.name, 'utf8');
    const compressed = zlib.deflateRawSync(entry.content, { level: 9 });
    const checksum = crc32(entry.content);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(dosTime, 10);
    local.writeUInt16LE(dosDate, 12);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(entry.content.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    localParts.push(local, name, compressed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(0x0314, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(flags, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(dosTime, 12);
    central.writeUInt16LE(dosDate, 14);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(entry.content.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(((entry.mode & 0xffff) << 16) >>> 0, 38);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, name);
    offset += local.length + name.length + compressed.length;
  });

  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  const count = centralParts.length / 2;
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(count, 8);
  end.writeUInt16LE(count, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat(localParts.concat([centralDirectory, end]));
}

function archiveContentStatus(archivePath, skill) {
  if (!fs.existsSync(archivePath) || !fs.statSync(archivePath).isFile()) {
    return { current: false, detail: 'missing' };
  }
  let actual;
  try {
    actual = fs.readFileSync(archivePath);
  } catch (error) {
    return { current: false, detail: 'cannot read archive: ' + error.message };
  }
  const expected = buildArchive(skill);
  return actual.equals(expected)
    ? { current: true, detail: 'current' }
    : { current: false, detail: 'content differs' };
}

function writePackages(skills, outputDir) {
  fs.mkdirSync(outputDir, { recursive: true });
  return skills.slice().sort(function byName(a, b) {
    return a.directoryName.localeCompare(b.directoryName);
  }).map(function write(skill) {
    const output = path.join(outputDir, skill.directoryName + '.skill');
    const content = buildArchive(skill);
    if (!fs.existsSync(output) || !fs.readFileSync(output).equals(content)) atomicWrite(output, content);
    return output;
  });
}

module.exports = {
  archiveContentStatus,
  buildArchive,
  buildArchiveEntries,
  crc32,
  writePackages,
};
