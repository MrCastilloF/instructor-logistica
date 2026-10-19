"use strict";
/**
 * Extraccion de documentos de Office (OOXML y ODF) leyendo el ZIP interno:
 *  - DOCX: word/document.xml  (parrafos, tablas, encabezados, notas)
 *  - PPTX: ppt/slides/slideN.xml (texto + notas del orador)
 *  - XLSX: sharedStrings + worksheets (se reconstruye la rejilla)
 *  - ODT/ODS/ODP: content.xml
 * Tambien recupera imagenes incrustadas (diagramas, capturas, evidencias).
 */
const fs = require("fs");
const path = require("path");
const { Zip } = require("./zip");
const { normalizeText } = require("./content");

function decodeXmlEntities(s) {
  return String(s)
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&amp;/g, "&");
}

/** Texto plano de un XML de WordprocessingML, conservando parrafos y celdas. */
function docxText(xml) {
  if (!xml) return "";
  let s = xml;
  s = s.replace(/<w:tab\b[^>]*\/>/g, "\t");
  s = s.replace(/<w:br\b[^>]*\/>/g, "\n");
  s = s.replace(/<\/w:p>/g, "\n");
  s = s.replace(/<\/w:tc>/g, "\t");
  s = s.replace(/<\/w:tr>/g, "\n");
  const runs = s.match(/<w:t(?:\s[^>]*)?>[\s\S]*?<\/w:t>/g) || [];
  let out = "";
  let idx = 0;
  for (const r of runs) {
    const at = s.indexOf(r, idx);
    out += s.slice(idx, at);
    out += decodeXmlEntities(r.replace(/<[^>]+>/g, ""));
    idx = at + r.length;
  }
  out += s.slice(idx);
  out = out.replace(/<[^>]+>/g, " ").replace(/[ \t]+\t/g, "\t");
  return normalizeText(out);
}

/** Texto de un XML de PresentationML, respetando saltos de parrafo. */
function pptxText(xml) {
  if (!xml) return "";
  let s = xml.replace(/<a:br\b[^>]*\/>/g, "\n").replace(/<\/a:p>/g, "\n");
  const runs = s.match(/<a:t(?:\s[^>]*)?>[\s\S]*?<\/a:t>/g) || [];
  let out = "";
  let idx = 0;
  for (const r of runs) {
    const at = s.indexOf(r, idx);
    out += s.slice(idx, at);
    out += decodeXmlEntities(r.replace(/<[^>]+>/g, ""));
    idx = at + r.length;
  }
  out += s.slice(idx);
  out = out.replace(/<[^>]+>/g, " ");
  return normalizeText(out);
}

function officeText(xml) {
  if (!xml) return "";
  let s = String(xml)
    .replace(/<text:line-break\b[^>]*\/>/g, "\n")
    .replace(/<\/text:p>/g, "\n")
    .replace(/<\/text:h>/g, "\n")
    .replace(/<\/table:table-cell>/g, "\t")
    .replace(/<\/table:table-row>/g, "\n");
  const runs = s.match(/<text:(?:span|p|h)(?:\s[^>]*)?>[\s\S]*?<\/text:(?:span|p|h)>/g) || [];
  let out = s.replace(/<[^>]+>/g, " ");
  return normalizeText(decodeXmlEntities(out));
}

function colLetter(index) {
  let n = index;
  let s = "";
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/** Reconstruye el contenido de un XLSX en texto legible tipo tabla. */
function xlsxText(zip, opts = {}) {
  const shared = [];
  const sst = zip.text("xl/sharedStrings.xml");
  if (sst) {
    const items = sst.match(/<si>[\s\S]*?<\/si>/g) || [];
    for (const it of items) {
      const ts = it.match(/<t(?:\s[^>]*)?>[\s\S]*?<\/t>/g) || [];
      shared.push(decodeXmlEntities(ts.map((t) => t.replace(/<[^>]+>/g, "")).join("")));
    }
  }
  // Nombres de hoja
  const names = {};
  const wb = zip.text("xl/workbook.xml");
  if (wb) {
    const rels = zip.text("xl/_rels/workbook.xml.rels") || "";
    const relMap = {};
    for (const m of rels.matchAll(/<Relationship\b[^>]*Id="([^"]+)"[^>]*Target="([^"]+)"/g)) {
      relMap[m[1]] = m[2].replace(/^\/?(xl\/)?/, "");
    }
    for (const m of wb.matchAll(/<sheet\b[^>]*name="([^"]*)"[^>]*r:id="([^"]+)"/g)) {
      const target = relMap[m[2]] || "";
      names[target.replace(/^.*?([^/]+)$/, "$1")] = decodeXmlEntities(m[1]);
    }
  }

  const sheetFiles = zip
    .match(/^xl\/worksheets\/sheet\d+\.xml$/)
    .sort((a, b) => Number(a.replace(/\D+/g, "")) - Number(b.replace(/\D+/g, "")));

  const out = [];
  const maxRowsPerSheet = opts.maxRowsPerSheet || 400;
  for (const f of sheetFiles) {
    const base = f.replace(/^.*\//, "");
    const label = names[base] || base;
    const xml = zip.text(f);
    if (!xml) continue;
    const rows = xml.match(/<row\b[\s\S]*?<\/row>/g) || [];
    const lines = [];
    let shown = 0;
    for (const row of rows) {
      if (shown >= maxRowsPerSheet) {
        lines.push(`[... ${rows.length - shown} filas mas omitidas ...]`);
        break;
      }
      const cells = row.match(/<c\b[\s\S]*?(?:\/>|<\/c>)/g) || [];
      const vals = [];
      for (const c of cells) {
        const ref = (c.match(/r="([A-Z]+\d+)"/) || [])[1] || "";
        const type = (c.match(/t="([^"]+)"/) || [])[1] || "";
        let v = "";
        if (type === "inlineStr") {
          const ts = c.match(/<t(?:\s[^>]*)?>[\s\S]*?<\/t>/g) || [];
          v = decodeXmlEntities(ts.map((t) => t.replace(/<[^>]+>/g, "")).join(""));
        } else {
          const vm = c.match(/<v>([\s\S]*?)<\/v>/);
          if (vm) {
            v = decodeXmlEntities(vm[1]);
            if (type === "s") v = shared[Number(v)] ?? v;
          }
        }
        if (v !== "") vals.push(`${ref}=${v}`);
      }
      if (vals.length) {
        lines.push(vals.join(" | "));
        shown++;
      }
    }
    out.push(`Hoja "${label}" (${rows.length} filas):\n` + (lines.join("\n") || "(vacia)"));
  }
  return normalizeText(out.join("\n\n"));
}

function writeImages(zip, names, dir) {
  fs.mkdirSync(dir, { recursive: true });
  const saved = [];
  let contador = 0;
  for (const n of names) {
    const b = zip.read(n);
    // Se guardan TODAS las imagenes del documento, sin filtrar por tamano:
    // la politica de imagenes (lib/images.js) decide despues cuales son
    // decorativas. Asi no se pierde ningun diagrama, tabla ni icono util.
    if (!b || b.length < 64) continue;
    contador++;
    const ext = path.extname(n).toLowerCase() || ".png";
    const base = path.basename(n).replace(/[^\w.-]/g, "_").replace(/\.[^.]+$/, "");
    const out = path.join(dir, `${String(contador).padStart(3, "0")}_${base}${ext}`);
    fs.writeFileSync(out, b);
    saved.push({ path: out, bytes: b.length, name: n, original: path.basename(n) });
  }
  return saved;
}

async function extractDocx(filePath, workDir) {
  const zip = new Zip(fs.readFileSync(filePath));
  const parts = [];
  const main = zip.text("word/document.xml");
  if (main) parts.push(docxText(main));
  for (const n of zip.match(/^word\/(header|footer)\d*\.xml$/)) {
    const t = docxText(zip.text(n));
    if (t) parts.push(`[${path.basename(n, ".xml")}] ${t}`);
  }
  const notes = docxText(zip.text("word/footnotes.xml"));
  if (notes) parts.push("[Notas al pie] " + notes);
  const images = writeImages(
    zip,
    zip.match(/^word\/media\/.+\.(png|jpe?g|gif|bmp|webp|tiff?|emf|wmf|svg)$/i),
    path.join(workDir, "media")
  );
  return { text: normalizeText(parts.join("\n\n")), images, parts: parts.length };
}

async function extractPptx(filePath, workDir) {
  const zip = new Zip(fs.readFileSync(filePath));
  const slides = zip
    .match(/^ppt\/slides\/slide\d+\.xml$/)
    .sort((a, b) => Number(a.replace(/\D+/g, "")) - Number(b.replace(/\D+/g, "")));
  const parts = [];
  slides.forEach((s, i) => {
    const t = pptxText(zip.text(s));
    const n = pptxText(zip.text(s.replace("slides/slide", "notesSlides/notesSlide")));
    let block = `--- Diapositiva ${i + 1} ---\n${t || "(sin texto)"}`;
    if (n) block += `\n[Notas del orador] ${n}`;
    parts.push(block);
  });
  const images = writeImages(
    zip,
    zip.match(/^ppt\/media\/.+\.(png|jpe?g|gif|bmp|webp|tiff?|emf|wmf|svg)$/i),
    path.join(workDir, "media")
  );
  return { text: normalizeText(parts.join("\n\n")), images, parts: slides.length, slides: slides.length };
}

async function extractXlsx(filePath, workDir) {
  const zip = new Zip(fs.readFileSync(filePath));
  const text = xlsxText(zip);
  const images = writeImages(
    zip,
    zip.match(/^xl\/media\/.+\.(png|jpe?g|gif|bmp|webp|tiff?|emf|wmf|svg)$/i),
    path.join(workDir, "media")
  );
  return { text, images, parts: 1 };
}

async function extractOdf(filePath, workDir, kind) {
  const zip = new Zip(fs.readFileSync(filePath));
  const parts = [];
  const c = zip.text("content.xml");
  if (c) parts.push(officeText(c));
  const styles = zip.text("styles.xml");
  if (styles) {
    const t = officeText(styles);
    if (t.length > 40) parts.push("[Estilos] " + t);
  }
  const images = writeImages(
    zip,
    zip.match(/^Pictures\/.+\.(png|jpe?g|gif|bmp|webp|tiff?|emf|wmf|svg)$/i),
    path.join(workDir, "media")
  );
  return { text: normalizeText(parts.join("\n\n")), images, parts: parts.length };
}

/** Nombres legibles de los estilos de un XLSX (para contexto). */
function workbookSheetNames(filePath) {
  try {
    const zip = new Zip(fs.readFileSync(filePath));
    const wb = zip.text("xl/workbook.xml") || "";
    return [...wb.matchAll(/<sheet\b[^>]*name="([^"]*)"/g)].map((m) => decodeXmlEntities(m[1]));
  } catch {
    return [];
  }
}

module.exports = { extractDocx, extractPptx, extractXlsx, extractOdf, workbookSheetNames, decodeXmlEntities };
