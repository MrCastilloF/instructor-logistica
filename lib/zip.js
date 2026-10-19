"use strict";
/**
 * Lector de ZIP minimo (sin dependencias) usando el directorio central.
 * Permite leer DOCX, XLSX, PPTX y ODT.
 */
const zlib = require("zlib");

const EOCD_SIG = 0x06054b50;
const EOCD64_LOC = 0x07064b50;
const EOCD64_SIG = 0x06064b50;
const CEN_SIG = 0x02014b50;
const LOC_SIG = 0x04034b50;

function findEocd(buf) {
  const min = Math.max(0, buf.length - 65557);
  for (let i = buf.length - 22; i >= min; i--) {
    if (buf.readUInt32LE(i) === EOCD_SIG) return i;
  }
  return -1;
}

function readEntries(buf) {
  const eocd = findEocd(buf);
  if (eocd < 0) throw new Error("No es un archivo ZIP valido (sin EOCD).");

  let count = buf.readUInt16LE(eocd + 10);
  let cenOffset = buf.readUInt32LE(eocd + 16);

  // ZIP64: el offset real vive en un registro adicional.
  if (cenOffset === 0xffffffff || count === 0xffff) {
    const locOff = eocd - 20;
    if (locOff >= 0 && buf.readUInt32LE(locOff) === EOCD64_LOC) {
      const z64 = Number(buf.readBigUInt64LE(locOff + 8));
      if (z64 >= 0 && z64 + 56 <= buf.length && buf.readUInt32LE(z64) === EOCD64_SIG) {
        count = Number(buf.readBigUInt64LE(z64 + 32));
        cenOffset = Number(buf.readBigUInt64LE(z64 + 48));
      }
    }
  }

  const entries = new Map();
  let p = cenOffset;
  for (let i = 0; i < count && p + 46 <= buf.length; i++) {
    if (buf.readUInt32LE(p) !== CEN_SIG) break;
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    let locOffset = buf.readUInt32LE(p + 42);
    if (locOffset === 0xffffffff) {
      // ZIP64 en el campo extra
      let ep = p + 46 + nameLen;
      const end = ep + extraLen;
      while (ep + 4 <= end) {
        const hid = buf.readUInt16LE(ep);
        const hsz = buf.readUInt16LE(ep + 2);
        if (hid === 0x0001) {
          locOffset = Number(buf.readBigUInt64LE(ep + 8));
          break;
        }
        ep += 4 + hsz;
      }
    }
    const name = buf.toString("utf8", p + 46, p + 46 + nameLen);
    entries.set(name, { name, method, compSize, locOffset });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

function readEntry(buf, entry) {
  const p = entry.locOffset;
  if (buf.readUInt32LE(p) !== LOC_SIG) throw new Error("Cabecera local ZIP invalida.");
  const nameLen = buf.readUInt16LE(p + 26);
  const extraLen = buf.readUInt16LE(p + 28);
  const start = p + 30 + nameLen + extraLen;
  const end = entry.compSize > 0 ? start + entry.compSize : buf.length;

  if (entry.method === 0) return buf.subarray(start, end);
  if (entry.method === 8) return zlib.inflateRawSync(buf.subarray(start, end));
  throw new Error("Compresion ZIP no soportada: " + entry.method);
}

class Zip {
  constructor(buf) {
    this.buf = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
    this.entries = readEntries(this.buf);
  }
  has(name) {
    return this.entries.has(name);
  }
  names() {
    return [...this.entries.keys()];
  }
  /** Devuelve un Buffer con el contenido, o null si no existe. */
  read(name) {
    const e = this.entries.get(name);
    if (!e) return null;
    try {
      return readEntry(this.buf, e);
    } catch {
      return null;
    }
  }
  text(name) {
    const b = this.read(name);
    return b ? b.toString("utf8") : null;
  }
  /** Entradas cuyo nombre coincide con el patron (RegExp). */
  match(re) {
    return [...this.entries.keys()].filter((n) => re.test(n));
  }
}

module.exports = { Zip };
