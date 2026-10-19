"use strict";
/**
 * Politica de imagenes: decide QUE imagenes de un documento se envian al
 * modelo para el analisis visual.
 *
 * Objetivo: que NUNCA se pierda una imagen con contenido. Se conservan
 * diagramas, tablas, capturas, fotografias, firmas o iconos. Solo se
 * descartan elementos decorativos (lineas, vinetas, espaciadores) que no
 * aportan informacion y que ademas consumirian el cupo de imagenes.
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { canvas } = require("./pdf");

/**
 * Lee las dimensiones reales de una imagen usando el lienzo, sin depender del
 * tipo de archivo (PNG, JPEG, GIF, BMP o WEBP).
 * @returns {{ancho:number, alto:number, bytes:number}|null}
 */
function medirImagen(ruta) {
  try {
    const { createCanvas, loadImage } = canvas();
    // loadImage puede ser asincrono en @napi-rs/canvas: se evita y se usa
    // decodificacion de cabecera para no bloquear.
    const buf = fs.readFileSync(ruta);
    const dim = dimensionesDeCabecera(buf);
    if (dim) return { ...dim, bytes: buf.length };
    return null;
  } catch {
    return null;
  }
}

/** Dimensiones a partir de la cabecera del archivo (PNG, GIF, BMP, JPEG). */
function dimensionesDeCabecera(buf) {
  if (buf.length < 24) return null;
  // PNG
  if (buf.readUInt32BE(0) === 0x89504e47) {
    return { ancho: buf.readUInt32BE(16), alto: buf.readUInt32BE(20) };
  }
  // GIF
  if (buf.toString("latin1", 0, 3) === "GIF") {
    return { ancho: buf.readUInt16LE(6), alto: buf.readUInt16LE(8) };
  }
  // BMP
  if (buf.toString("latin1", 0, 2) === "BM") {
    return { ancho: Math.abs(buf.readInt32LE(18)), alto: Math.abs(buf.readInt32LE(22)) };
  }
  // JPEG: se recorre la cabecera buscando el bloque SOF
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    let p = 2;
    while (p + 9 < buf.length) {
      if (buf[p] !== 0xff) {
        p++;
        continue;
      }
      const marca = buf[p + 1];
      const largo = buf.readUInt16BE(p + 2);
      if (marca >= 0xc0 && marca <= 0xcf && marca !== 0xc4 && marca !== 0xc8 && marca !== 0xcc) {
        return { alto: buf.readUInt16BE(p + 5), ancho: buf.readUInt16BE(p + 7) };
      }
      p += 2 + largo;
    }
  }
  return null;
}

/** Firma de contenido para no enviar la misma imagen dos veces. */
function firma(ruta) {
  try {
    return crypto.createHash("sha1").update(fs.readFileSync(ruta)).digest("hex");
  } catch {
    return null;
  }
}

/**
 * ¿Es un elemento decorativo sin informacion?
 * Se descartan solo los casos evidentes: imagenes diminutas o alargadas que
 * solo sirven de linea, vineta o separador.
 */
function esDecorativa(m) {
  if (!m) return false; // sin datos, se conserva (mejor de mas que de menos)
  const { ancho, alto, bytes } = m;
  const area = ancho * alto;
  // Menos de 32x32 pixeles no puede contener informacion legible.
  if (ancho < 32 || alto < 32) return true;
  // Formas muy alargadas y delgadas (lineas, reglas, separadores).
  const ratio = Math.max(ancho, alto) / Math.max(1, Math.min(ancho, alto));
  if (ratio > 12 && Math.min(ancho, alto) < 24) return true;
  // Archivos ridiculamente pequenos y de area reducida.
  if (bytes < 400 && area < 100 * 100) return true;
  return false;
}

/**
 * Selecciona las imagenes a enviar al modelo.
 * @param {Array<{path:string,name?:string,bytes?:number}>} imagenes
 * @param {{max?:number, etiqueta?:(i:object,n:number)=>string}} opciones
 * @returns {Promise<{seleccionadas:Array, descartadas:Array}>}
 */
async function seleccionarImagenes(imagenes, { max = 20, etiqueta } = {}) {
  const vistas = new Set();
  const validas = [];
  const descartadas = [];

  for (const img of imagenes || []) {
    if (!img || !img.path || !fs.existsSync(img.path)) continue;

    const f = firma(img.path);
    if (f && vistas.has(f)) {
      descartadas.push({ ...img, motivo: "repetida" });
      continue;
    }

    const m = medirImagen(img.path);
    if (esDecorativa(m)) {
      descartadas.push({ ...img, motivo: "decorativa", medida: m });
      continue;
    }

    if (f) vistas.add(f);
    validas.push({
      ...img,
      medida: m,
      // Se prioriza por area visible: captura diagramas y tablas primero.
      area: m ? m.ancho * m.alto : 0,
    });
  }

  // Orden: primero las de mayor area (suelen ser diagramas y tablas completas),
  // y al final las pequenas, que igual se conservan si sobra cupo.
  validas.sort((a, b) => b.area - a.area || (b.bytes || 0) - (a.bytes || 0));
  const seleccionadas = validas.slice(0, max).map((v, i) => ({
    ...v,
    label: etiqueta ? etiqueta(v, i) : v.name || path.basename(v.path),
  }));

  if (validas.length > max) descartadas.push(...validas.slice(max).map((v) => ({ ...v, motivo: "excede el cupo" })));

  return { seleccionadas, descartadas, total: validas.length };
}

/**
 * Convierte a PNG las imagenes en formatos que el modelo no acepta
 * (TIFF, BMP, WMF, EMF...) para poder analizarlas igual.
 */
async function normalizarFormato(ruta, dirSalida) {
  const ext = path.extname(ruta).toLowerCase();
  if ([".png", ".jpg", ".jpeg", ".webp", ".gif"].includes(ext)) return ruta;
  try {
    const { createCanvas, loadImage } = canvas();
    const img = await loadImage(fs.readFileSync(ruta));
    const cv = createCanvas(img.width, img.height);
    const ctx = cv.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, img.width, img.height);
    ctx.drawImage(img, 0, 0);
    fs.mkdirSync(dirSalida, { recursive: true });
    const out = path.join(dirSalida, path.basename(ruta).replace(/\.[^.]+$/, "") + ".png");
    fs.writeFileSync(out, cv.toBuffer("image/png"));
    return out;
  } catch {
    return null;
  }
}

module.exports = { seleccionarImagenes, medirImagen, esDecorativa, dimensionesDeCabecera, normalizarFormato, firma };
