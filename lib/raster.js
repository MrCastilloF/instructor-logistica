"use strict";
/**
 * Rasterizador de paginas PDF a imagen (usa @napi-rs/canvas).
 *
 * La resolucion importa: una pagina escaneada o un plano enviado a baja
 * resolucion hace que el modelo no pueda leer el texto. Por eso se renderiza
 * a `pageMaxWidth` sin reducir por debajo del tamano natural de la pagina.
 */
const fs = require("fs");
const path = require("path");
const config = require("./config");
const { canvas } = require("./pdf");

const MAX_SCALE = 3.0; // tope para no generar imagenes gigantes

async function renderPdfPage(page, outPath, opts = {}) {
  const maxWidth = opts.maxWidth || config.limits.pageMaxWidth;
  const quality = opts.quality || config.limits.pageQuality;
  const { createCanvas } = canvas();
  const base = page.getViewport({ scale: 1 });
  // Nunca por debajo de 1: reducir emborrona el texto de un escaneo.
  const scale = Math.max(1, Math.min(MAX_SCALE, maxWidth / base.width));
  const viewport = page.getViewport({ scale });

  const cv = createCanvas(Math.max(1, Math.ceil(viewport.width)), Math.max(1, Math.ceil(viewport.height)));
  const ctx = cv.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, cv.width, cv.height);
  await page.render({ canvasContext: ctx, viewport, canvas: cv }).promise;

  const ext = path.extname(outPath).toLowerCase();
  const buf =
    ext === ".jpg" || ext === ".jpeg" ? cv.toBuffer("image/jpeg", quality) : cv.toBuffer("image/png");

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, buf);
  return { path: outPath, bytes: buf.length, width: cv.width, height: cv.height };
}

module.exports = { renderPdfPage };
