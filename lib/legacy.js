"use strict";
/**
 * Recuperacion de texto de formatos propietarios antiguos (.doc, .xls, .ppt)
 * y otros binarios sin parser disponible.
 *
 * Estrategia: los documentos OLE2 de Office guardan el texto como UTF-16LE
 * (Word) o como cadenas de 8 bits (Excel/PowerPoint). Extraemos secuencias
 * imprimibles y las unimos. Es una recuperacion APROXIMADA: si el sistema
 * tiene LibreOffice se puede convertir a PDF para un analisis visual exacto.
 */
const { normalizeText } = require("./content");

function isPrintableCode(cp) {
  if (cp === 9 || cp === 10 || cp === 13) return true;
  if (cp < 32) return false;
  if (cp === 0xfffe || cp === 0xffff) return false;
  return true;
}

/** Extrae cadenas UTF-16LE (Word 97-2003, PowerPoint). */
function utf16Strings(buf, minLen = 4) {
  const out = [];
  let cur = [];
  for (let i = 0; i + 1 < buf.length; i += 2) {
    const cp = buf.readUInt16LE(i);
    if (cp === 13 || cp === 10) {
      if (cur.length >= minLen) out.push(cur.join(""));
      cur = [];
      continue;
    }
    if (isPrintableCode(cp) && cp !== 0) {
      cur.push(String.fromCharCode(cp));
    } else {
      if (cur.length >= minLen) out.push(cur.join(""));
      cur = [];
    }
  }
  if (cur.length >= minLen) out.push(cur.join(""));
  return out;
}

/** Extrae cadenas ASCII/Latin-1 (Excel BIFF, PPT antiguo). */
function latinStrings(buf, minLen = 5) {
  const out = [];
  let cur = [];
  for (let i = 0; i < buf.length; i++) {
    const b = buf[i];
    if (b === 13 || b === 10 || b === 9) {
      if (cur.length >= minLen) out.push(cur.join(""));
      cur = [];
      continue;
    }
    if (b >= 32 && b < 127) cur.push(String.fromCharCode(b));
    else {
      if (cur.length >= minLen) out.push(cur.join(""));
      cur = [];
    }
  }
  if (cur.length >= minLen) out.push(cur.join(""));
  return out;
}

function looksLikeText(s) {
  if (!s || s.length < 3) return false;
  const letters = (s.match(/[A-Za-zÁÉÍÓÚáéíóúÑñÜü]/g) || []).length;
  const digits = (s.match(/[0-9]/g) || []).length;
  const vowels = (s.match(/[aeiouAEIOUáéíóú]/g) || []).length;
  if (letters + digits < 3) return false;
  // Debe tener vocales (descarta binario tipo "x9F3kQ")
  return vowels >= 1 && letters / s.length > 0.35;
}

/**
 * @param {Buffer} buf contenido del archivo
 * @param {"doc"|"xls"|"ppt"|"bin"} kind
 */
function recoverLegacyText(buf, kind = "bin") {
  const chunks = [];

  // UTF-16LE: patron principal de Word y PowerPoint.
  const u16 = utf16Strings(buf, 4);
  // 8 bits: comun en Excel.
  const l8 = latinStrings(buf, 5);

  const useful = (arr) => arr.filter(looksLikeText).map((s) => s.trim());

  const u16u = useful(u16);
  const l8u = useful(l8);

  // Elige la representacion con mas texto util.
  const u16Len = u16u.join(" ").length;
  const l8Len = l8u.join(" ").length;

  if (u16Len >= l8Len && u16u.length) chunks.push(...u16u);
  else if (l8u.length) chunks.push(...l8u);

  // Si habia mucho UTF-16 pero poco texto util, complementa con 8 bits.
  if (u16Len > 0 && l8Len > 0 && Math.min(u16Len, l8Len) / Math.max(u16Len, l8Len) > 0.35) {
    chunks.push(...l8u.slice(0, 400));
  }

  const joined = normalizeText(chunks.join("\n"));
  return {
    text: joined,
    confidence: u16Len + l8Len > 1200 ? "media" : joined.length > 300 ? "baja" : "muy baja",
    chars: joined.length,
  };
}

module.exports = { recoverLegacyText };
