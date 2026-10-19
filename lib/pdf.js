"use strict";
/**
 * Extraccion de PDF: texto por pagina (pdfjs) + rasterizado de paginas
 * a imagen para que el modelo "vea" documentos escaneados, planos,
 * tablas complejas o firmas.
 */
const fs = require("fs");
const path = require("path");
const config = require("./config");
const { normalizeText } = require("./content");

let pdfjsPromise = null;
let canvasMod = null;

function pdfjs() {
  if (!pdfjsPromise) {
    const url = "file:///" + path.join(config.vendor, "pdfjs-dist/legacy/build/pdf.mjs").replace(/\\/g, "/");
    pdfjsPromise = import(url);
  }
  return pdfjsPromise;
}

function canvas() {
  if (!canvasMod) canvasMod = require(path.join(config.vendor, "node_modules/@napi-rs/canvas"));
  return canvasMod;
}

function assets() {
  const base = path.join(config.vendor, "pdfjs-dist").replace(/\\/g, "/");
  return {
    standardFontDataUrl: "file:///" + base + "/standard_fonts/",
    cMapUrl: "file:///" + base + "/cmaps/",
    wasmUrl: "file:///" + base + "/wasm/",
    iccUrl: "file:///" + base + "/iccs/",
  };
}

/**
 * Node no soporta fetch de URLs file://, asi que pdfjs no puede bajar sus
 * fuentes estandar ni los CMaps. Se aportan factorias que leen del disco:
 * sin ellas, los PDF con fuentes no incrustadas o con alfabetos CJK
 * perderian texto (incluidos documentos en chino, japones o coreano).
 */
function nodeFileFactories(BaseFactory) {
  const cache = new Map();

  function load(kind, filename) {
    const dirs = {
      standardFontDataUrl: [path.join(config.vendor, "pdfjs-dist/standard_fonts")],
      cMapUrl: [path.join(config.vendor, "pdfjs-dist/cmaps")],
      wasmUrl: [path.join(config.vendor, "pdfjs-dist/wasm")],
    }[kind] || [];
    const wanted = String(filename).toLowerCase();
    for (const d of dirs) {
      const files = (() => {
        if (cache.has(d)) return cache.get(d);
        const out = [];
        const walk = (dir, depth) => {
          let items;
          try {
            items = fs.readdirSync(dir, { withFileTypes: true });
          } catch {
            return;
          }
          for (const it of items) {
            const full = path.join(dir, it.name);
            if (it.isFile()) out.push(full);
            else if (it.isDirectory() && depth > 0) walk(full, depth - 1);
          }
        };
        walk(d, 2);
        cache.set(d, out);
        return out;
      })();
      const hit = files.find((f) => path.basename(f).toLowerCase() === wanted);
      if (hit) return new Uint8Array(fs.readFileSync(hit));
    }
    throw new Error("recurso pdfjs no encontrado: " + filename);
  }

  return class NodeBinaryDataFactory extends BaseFactory {
    async _fetch(url, kind) {
      return load(kind, String(url).split("/").pop());
    }
  };
}

/**
 * @returns {Promise<{pages:number, text:string, pageTexts:string[], scanned:number[]}>}
 */
async function readPdf(filePath) {
  const pdfjsMod = await pdfjs();
  const { getDocument } = pdfjsMod;
  const data = new Uint8Array(fs.readFileSync(filePath));

  const base = { data, useSystemFonts: false, isEvalSupported: false };
  const cfg = { ...base, ...assets() };

  // pdfjs v6: la factoria de datos debe heredar de la del propio modulo.
  const BaseFactory = pdfjsMod.NodeBinaryDataFactory || pdfjsMod.BaseBinaryDataFactory;
  if (BaseFactory) {
    cfg.BinaryDataFactory = nodeFileFactories(BaseFactory);
    cfg.useWorkerFetch = false;
  }

  let doc;
  try {
    doc = await getDocument(cfg).promise;
  } catch {
    // Version anterior de pdfjs: se usan solo las URLs.
    doc = await getDocument(base).promise;
  }

  const total = doc.numPages;
  const limit = Math.min(total, config.limits.maxPages);
  const pageTexts = [];

  for (let p = 1; p <= limit; p++) {
    let txt = "";
    try {
      const page = await doc.getPage(p);
      const tc = await page.getTextContent();
      // Une los fragmentos respetando saltos de linea aproximados.
      let lastY = null;
      const chunks = [];
      for (const item of tc.items) {
        const y = item.transform ? Math.round(item.transform[5]) : null;
        if (lastY !== null && y !== null && Math.abs(y - lastY) > 2) chunks.push("\n");
        chunks.push(item.str);
        if (item.hasEOL) chunks.push("\n");
        lastY = y;
      }
      txt = normalizeText(chunks.join(""));
    } catch (e) {
      txt = "";
    }
    pageTexts.push(txt);
  }

  return {
    doc,
    pages: total,
    analyzedPages: limit,
    pageTexts,
    text: pageTexts.join("\n\n"),
    getPage: (n) => doc.getPage(n),
  };
}

/** Rasteriza una pagina a PNG/JPG. Devuelve la ruta del archivo. */
async function renderPage(doc, pageNumber, outPath, opts = {}) {
  const { renderPdfPage } = require("./raster");
  const page = await doc.getPage(pageNumber);
  return renderPdfPage(page, outPath, opts);
}

module.exports = { readPdf, renderPage, canvas };
