"use strict";
/**
 * Utilidades de contenido: deteccion de tipo, normalizacion de texto
 * y construccion de adjuntos (texto / imagenes) para el modelo.
 */
const path = require("path");
const fs = require("fs");

const EXT_KIND = {
  ".pdf": "pdf",
  ".docx": "docx",
  ".docm": "docx",
  ".doc": "doc-legacy",
  ".rtf": "rtf",
  ".odt": "odt",
  ".xlsx": "xlsx",
  ".xlsm": "xlsx",
  ".xls": "xls-legacy",
  ".ods": "ods",
  ".csv": "csv",
  ".tsv": "csv",
  ".pptx": "pptx",
  ".ppsx": "pptx",
  ".ppt": "ppt-legacy",
  ".odp": "odp",
  ".png": "image",
  ".jpg": "image",
  ".jpeg": "image",
  ".webp": "image",
  ".gif": "image",
  ".bmp": "image",
  ".tif": "image",
  ".tiff": "image",
  ".heic": "image-maybe",
  ".avif": "image-maybe",
  ".svg": "image-maybe",
  ".mp4": "video",
  ".mov": "video",
  ".avi": "video",
  ".mkv": "video",
  ".webm": "video",
  ".wmv": "video",
  ".flv": "video",
  ".m4v": "video",
  ".mpeg": "video",
  ".mpg": "video",
  ".3gp": "video",
  ".txt": "text",
  ".md": "text",
  ".log": "text",
  ".json": "text",
  ".xml": "text",
  ".html": "text",
  ".htm": "text",
  ".yaml": "text",
  ".yml": "text",
  ".ini": "text",
  ".srt": "text",
  ".vtt": "text",
};

const MIME_BY_EXT = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
};

function detectKind(filename, head) {
  const ext = path.extname(String(filename || "")).toLowerCase();
  const kind = EXT_KIND[ext] || "unknown";

  // Verificacion por firma binaria para formatos sin extension fiable.
  const b = head || Buffer.alloc(0);
  const sig = b.subarray(0, 8).toString("latin1");
  if (sig.startsWith("%PDF")) return "pdf";
  if (b.length >= 4 && b.readUInt32LE(0) === 0x04034b50) {
    // Es un ZIP: la extension decide entre OOXML/ODF.
    if (kind === "unknown" || kind === "text") return "zip-unknown";
    return kind;
  }
  if (b.length >= 8 && b.readUInt32BE(0) === 0xd0cf11e0) {
    // Contenedor OLE2 (Office 97-2003)
    if (kind === "unknown") return "ole-unknown";
  }
  if (b.length >= 12 && b.subarray(4, 12).toString("latin1") === "ftypisom") return "video";
  return kind;
}

/** Limpia el texto preservando saltos de linea utiles. */
function normalizeText(s) {
  if (!s) return "";
  return String(s)
    .replace(/\r\n?/g, "\n")
    .replace(/\u00a0/g, " ")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

/** Cuenta palabras de forma aproximada. */
function wordCount(s) {
  const t = String(s || "").trim();
  return t ? t.split(/\s+/).length : 0;
}

/**
 * Almacen de adjuntos. `text` alimenta el prompt; `images` se envian
 * como contenido multimodal.
 */
class Content {
  constructor() {
    this.textParts = [];
    this.images = [];
    this.notes = [];
    this.facts = {};
  }
  addText(label, body) {
    const t = normalizeText(body);
    if (t) this.textParts.push({ label, body: t });
    return this;
  }
  async addImage(imagePath, label) {
    const buf = fs.readFileSync(imagePath);
    const ext = path.extname(imagePath).toLowerCase();
    const mime = MIME_BY_EXT[ext] || "image/jpeg";
    this.images.push({ label, dataUrl: `data:${mime};base64,${buf.toString("base64")}`, bytes: buf.length, path: imagePath });
    return this;
  }
  note(msg) {
    this.notes.push(msg);
    return this;
  }
  fact(k, v) {
    this.facts[k] = v;
    return this;
  }
  get textChars() {
    return this.textParts.reduce((a, p) => a + p.body.length, 0);
  }
  get text() {
    return this.textParts.map((p) => (this.textParts.length > 1 ? `--- ${p.label} ---\n${p.body}` : p.body)).join("\n\n");
  }
}

module.exports = { detectKind, normalizeText, wordCount, Content, MIME_BY_EXT };
