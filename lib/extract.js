"use strict";
/**
 * Orquestador de extraccion: recibe cualquier archivo admitido y produce
 * (1) texto para el prompt y (2) imagenes para el analisis visual.
 * Decisiones automaticas: si un PDF es escaneado se rasteriza; si un
 * documento trae diagramas relevantes se adjuntan; si es video se muestrean
 * fotogramas de toda la linea de tiempo.
 */
const fs = require("fs");
const path = require("path");
const config = require("./config");
const { detectKind, Content, normalizeText, wordCount } = require("./content");
const { readPdf, renderPage } = require("./pdf");
const office = require("./office");
const video = require("./video");
const { recoverLegacyText } = require("./legacy");

function readTextFile(filePath) {
  const buf = fs.readFileSync(filePath);
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) return buf.toString("utf16le", 2);
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) {
    // UTF-16BE -> intercambia bytes
    const sw = Buffer.from(buf.subarray(2));
    sw.swap16();
    return sw.toString("utf16le");
  }
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) return buf.toString("utf8", 3);
  const utf8 = buf.toString("utf8");
  // Si el UTF-8 produce caracteres de reemplazo, cae a latin1 (Windows-1252 aprox.)
  const bad = (utf8.match(/\uFFFD/g) || []).length;
  return bad > utf8.length * 0.01 ? buf.toString("latin1") : utf8;
}

function humanSize(bytes) {
  if (!bytes) return "0 B";
  const u = ["B", "KB", "MB", "GB"];
  let i = 0;
  let n = bytes;
  while (n >= 1024 && i < u.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(n >= 10 || i === 0 ? 0 : 1)} ${u[i]}`;
}

const KIND_LABEL = {
  pdf: "PDF",
  docx: "Word (DOCX)",
  "doc-legacy": "Word 97-2003 (DOC)",
  odt: "OpenDocument Text (ODT)",
  rtf: "RTF",
  xlsx: "Excel (XLSX)",
  "xls-legacy": "Excel 97-2003 (XLS)",
  ods: "OpenDocument Hoja (ODS)",
  csv: "CSV",
  pptx: "PowerPoint (PPTX)",
  "ppt-legacy": "PowerPoint 97-2003 (PPT)",
  odp: "OpenDocument Presentacion (ODP)",
  image: "Imagen",
  "image-maybe": "Imagen",
  video: "Video",
  text: "Texto",
  "ole-unknown": "Documento Office antiguo",
  "zip-unknown": "Documento comprimido",
  unknown: "Archivo",
};

async function extract(filePath, originalName, workDir, onProgress = () => {}) {
  fs.mkdirSync(workDir, { recursive: true });
  const stat = fs.statSync(filePath);
  const head = Buffer.alloc(Math.min(4096, stat.size));
  const fd = fs.openSync(filePath, "r");
  fs.readSync(fd, head, 0, head.length, 0);
  fs.closeSync(fd);

  let kind = detectKind(originalName, head);
  if (kind === "unknown") {
    // Ultimo intento: si parece texto plano, tratarlo como texto.
    const probe = head.toString("latin1");
    if (/^[\x09\x0a\x0d\x20-\x7e]{16,}$/.test(probe)) kind = "text";
  }

  const content = new Content();
  content.fact("archivo", originalName);
  content.fact("tipo", KIND_LABEL[kind] || kind);
  content.fact("peso", humanSize(stat.size));

  onProgress({ stage: "detect", message: `Tipo detectado: ${KIND_LABEL[kind] || kind}` });

  switch (kind) {
    case "pdf":
      await extractPdf(filePath, workDir, content, onProgress);
      break;
    case "docx":
      await extractDocxLike(filePath, workDir, content, onProgress);
      break;
    case "odt":
    case "ods":
    case "odp": {
      onProgress({ stage: "office", message: "Leyendo documento OpenDocument..." });
      const r = await office.extractOdf(filePath, workDir, kind);
      content.addText("Contenido", r.text).fact("palabras", wordCount(r.text));
      await attachMedia(r.images, content, workDir, onProgress, config.limits.maxImagenesIncrustadas);
      break;
    }
    case "pptx":
      await extractPptxLike(filePath, workDir, content, onProgress);
      break;
    case "xlsx":
      await extractXlsxLike(filePath, workDir, content, onProgress);
      break;
    case "csv": {
      onProgress({ stage: "text", message: "Leyendo archivo de datos..." });
      const raw = readTextFile(filePath);
      const lines = raw.split(/\r?\n/);
      const limited = lines.slice(0, 500).join("\n");
      content
        .addText(`Datos tabulares (${lines.length} filas)`, limited)
        .fact("filas", lines.length)
        .fact("palabras", wordCount(limited));
      if (lines.length > 500) content.note(`Se analizaron las primeras 500 de ${lines.length} filas.`);
      break;
    }
    case "text": {
      onProgress({ stage: "text", message: "Leyendo texto..." });
      let raw = readTextFile(filePath);
      if (raw.length > config.limits.maxTextChars) {
        raw = raw.slice(0, config.limits.maxTextChars) + "\n[... texto truncado ...]";
        content.note("El texto era muy largo y se recorto.");
      }
      content.addText("Contenido", raw).fact("palabras", wordCount(raw));
      break;
    }
    case "rtf": {
      onProgress({ stage: "text", message: "Interpretando RTF..." });
      const raw = readTextFile(filePath);
      // Conversion RTF -> texto aproximada (suficiente para evaluar).
      let t = raw
        .replace(/\\'([0-9a-f]{2})/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
        .replace(/\\par[d]?\b/g, "\n")
        .replace(/\\line\b/g, "\n")
        .replace(/\{\\\*[\s\S]*?\}/g, "")
        .replace(/\\[a-z]+-?\d*\s?/gi, "")
        .replace(/[{}]/g, "");
      t = normalizeText(t);
      content.addText("Contenido", t).fact("palabras", wordCount(t));
      break;
    }
    case "image":
    case "image-maybe": {
      onProgress({ stage: "vision", message: "Preparando imagen para analisis visual..." });
      let p = filePath;
      if (kind === "image-maybe" || !/\.(png|jpe?g|webp|gif)$/i.test(originalName)) {
        const conv = await video.convertImage(filePath, path.join(workDir, "imagen.jpg"));
        if (conv) p = conv;
      }
      await content.addImage(p, "Imagen entregada");
      content.fact("analisis", "visual");
      break;
    }
    case "video":
      await extractVideo(filePath, workDir, content, onProgress);
      break;
    case "doc-legacy":
    case "xls-legacy":
    case "ppt-legacy":
    case "ole-unknown":
      await extractLegacy(filePath, workDir, content, onProgress, kind);
      break;
    case "zip-unknown": {
      // ZIP de Office sin extension clara: inspecciona su contenido.
      onProgress({ stage: "detect", message: "Inspeccionando documento comprimido..." });
      const { Zip } = require("./zip");
      const zip = new Zip(fs.readFileSync(filePath));
      if (zip.has("word/document.xml")) await extractDocxLike(filePath, workDir, content, onProgress);
      else if (zip.has("ppt/presentation.xml")) await extractPptxLike(filePath, workDir, content, onProgress);
      else if (zip.has("xl/workbook.xml")) await extractXlsxLike(filePath, workDir, content, onProgress);
      else if (zip.has("content.xml")) {
        const r = await office.extractOdf(filePath, workDir, "odt");
        content.addText("Contenido", r.text);
      } else {
        content.note("El archivo comprimido no contiene un documento reconocible.");
        content.fact("tipo", "Archivo comprimido");
      }
      break;
    }
    default:
      content.note(
        "No se pudo reconocer el formato del archivo. Formatos recomendados: PDF, Word (.docx), " +
          "Excel (.xlsx), PowerPoint (.pptx), imagenes (JPG/PNG) o video (MP4)."
      );
      content.fact("tipo", "Formato no reconocido");
  }

  onProgress({ stage: "done", message: "Contenido extraido." });
  return { kind, kindLabel: KIND_LABEL[kind] || kind, content };
}

async function extractPdf(filePath, workDir, content, onProgress) {
  onProgress({ stage: "pdf", message: "Leyendo PDF..." });
  const pdf = await readPdf(filePath);
  const text = pdf.text;
  const charsPerPage = pdf.analyzedPages ? text.length / pdf.analyzedPages : 0;

  content
    .fact("paginas", pdf.pages)
    .fact("palabras", wordCount(text))
    .fact("paginasAnalizadas", pdf.analyzedPages);

  if (text.trim().length > 200) {
    content.addText("Texto del PDF", text);
  } else {
    content.note("El PDF casi no tiene texto seleccionable (probablemente escaneado): se analiza como imagen.");
  }

  // Paginas sin texto util -> candidatas a rasterizar.
  const emptyPages = [];
  pdf.pageTexts.forEach((t, i) => {
    if (t.length < 30) emptyPages.push(i + 1);
  });

  const scanned = charsPerPage < 120 || emptyPages.length > pdf.analyzedPages * 0.4;
  const maxImgs = config.limits.maxPaginas;
  let pagesToRender = [];

  // Si el PDF es escaneado o tiene paginas sin texto, se convierten TODAS
  // (no solo las vacias): asi tambien se ven los graficos de las paginas
  // que si traen texto.
  if (scanned) {
    pagesToRender = Array.from({ length: pdf.analyzedPages }, (_, i) => i + 1);
    onProgress({ stage: "vision", message: "PDF escaneado: convirtiendo paginas a imagen..." });
  } else if (emptyPages.length) {
    pagesToRender = Array.from({ length: pdf.analyzedPages }, (_, i) => i + 1);
    onProgress({
      stage: "vision",
      message: `${emptyPages.length} pagina(s) sin texto: se convierten todas las paginas a imagen para no perder gráficos.`,
    });
  } else {
    // PDF con texto en todas las paginas: se buscan las que ADEMAS traen
    // imagenes (diagramas, planos, tablas, capturas) y se convierten esas.
    onProgress({ stage: "vision", message: "Revisando qué páginas contienen imágenes..." });
    const conImagenes = await detectarPaginasConImagenes(pdf);
    pagesToRender = conImagenes;
    if (conImagenes.length) {
      onProgress({
        stage: "vision",
        message: `PDF con texto: se adjuntan ${conImagenes.length} página(s) que contienen imágenes.`,
      });
      content.note(
        `Además del texto, se analizaron visualmente ${conImagenes.length} página(s) que contienen ` +
          `imágenes (diagramas, tablas o capturas).`
      );
    }
  }

  if (pagesToRender.length > maxImgs) {
    // Muestreo uniforme si hay muchisimas paginas con imagenes.
    const step = pagesToRender.length / maxImgs;
    pagesToRender = Array.from({ length: maxImgs }, (_, i) => pagesToRender[Math.floor(i * step)]);
    content.note(`Se adjuntaron ${maxImgs} páginas representativas como imagen (de ${pagesToRender.length} con contenido gráfico).`);
  }

  for (const p of pagesToRender) {
    onProgress({ stage: "vision", message: `Convirtiendo pagina ${p} a imagen...` });
    try {
      const r = await renderPage(pdf.doc, p, path.join(workDir, `pagina_${String(p).padStart(3, "0")}.jpg`));
      await content.addImage(r.path, `Página ${p} del PDF (imagen completa de la página)`);
    } catch (e) {
      content.note(`No se pudo convertir la pagina ${p}: ${e.message}`);
    }
  }
  content.fact("paginasComoImagen", pagesToRender.length);

  // Imagenes sueltas dentro del PDF. Si ya se adjuntaron paginas completas
  // (caso escaneado), esas paginas YA muestran las figuras, asi que extraerlas
  // aparte solo duplicaria contenido y gastaria cupo de imagenes.
  if (pagesToRender.length === 0) {
    try {
      await adjuntarImagenesPdf(pdf, workDir, content, onProgress);
    } catch (e) {
      content.note("No se pudieron extraer las imágenes sueltas del PDF: " + e.message);
    }
  }
}

/**
 * Marca que paginas de un PDF contienen imagenes, examinando las operaciones
 * de dibujo. Permite analizar visualmente un PDF con texto sin convertirlo
 * entero.
 */
async function detectarPaginasConImagenes(pdf) {
  const paginas = [];
  for (let p = 1; p <= pdf.analyzedPages; p++) {
    try {
      const page = await pdf.doc.getPage(p);
      const ops = await page.getOperatorList();
      const OPS = require(path.join(config.vendor, "pdfjs-dist/legacy/build/pdf.mjs"));
      // Cualquier operacion de imagen implica contenido grafico.
      const tieneImagen = ops.fnArray.some(
        (fn) =>
          fn === (OPS.OPS && OPS.OPS.paintImageXObject) ||
          fn === (OPS.OPS && OPS.OPS.paintJpegXObject) ||
          fn === (OPS.OPS && OPS.OPS.paintImageMaskXObject) ||
          fn === (OPS.OPS && OPS.OPS.paintInlineImageXObject) ||
          fn === (OPS.OPS && OPS.OPS.paintImageXObjectRepeat)
      );
      if (tieneImagen) paginas.push(p);
    } catch {
      /* pagina ilegible: se omite */
    }
  }
  return paginas;
}

/**
 * Extrae las imagenes incrustadas de un PDF (fotografias, figuras) para
 * enviarlas por separado, ademas de las paginas completas.
 */
async function adjuntarImagenesPdf(pdf, workDir, content, onProgress) {
  const dir = path.join(workDir, "imagenes_pdf");
  fs.mkdirSync(dir, { recursive: true });
  const guardadas = [];

  for (let p = 1; p <= pdf.analyzedPages; p++) {
    let page;
    try {
      page = await pdf.doc.getPage(p);
    } catch {
      continue;
    }
    let ops;
    try {
      ops = await page.getOperatorList();
    } catch {
      continue;
    }
    const nombres = new Set();
    try {
      const OPS = require(path.join(config.vendor, "pdfjs-dist/legacy/build/pdf.mjs")).OPS;
      ops.fnArray.forEach((fn, i) => {
        if (fn === OPS.paintImageXObject || fn === OPS.paintJpegXObject || fn === OPS.paintImageXObjectRepeat) {
          const nombre = ops.argsArray[i] && ops.argsArray[i][0];
          if (typeof nombre === "string") nombres.add(nombre);
        }
      });
    } catch {
      continue;
    }

    for (const nombre of nombres) {
      try {
        const obj = await new Promise((resolve) => {
          const t = setTimeout(() => resolve(null), 4000);
          try {
            page.objs.get(nombre, (o) => {
              clearTimeout(t);
              resolve(o);
            });
          } catch {
            clearTimeout(t);
            resolve(null);
          }
        });
        if (!obj || !obj.width || !obj.height || !obj.data) continue;
        if (obj.width < 40 || obj.height < 40) continue; // elementos diminutos

        const { canvas } = require("./pdf");
        const { createCanvas } = canvas();
        const cv = createCanvas(obj.width, obj.height);
        const ctx = cv.getContext("2d");
        const img = ctx.createImageData(obj.width, obj.height);
        const canales = obj.data.length / (obj.width * obj.height);
        for (let i = 0, j = 0; i < obj.width * obj.height; i++) {
          imagenPixel(img.data, j, obj.data, i, canales);
          j += 4;
        }
        ctx.putImageData(img, 0, 0);
        const out = path.join(dir, `pag${String(p).padStart(3, "0")}_${nombre.slice(0, 20).replace(/[^\w]/g, "_")}.png`);
        fs.writeFileSync(out, cv.toBuffer("image/png"));
        guardadas.push({ path: out, bytes: fs.statSync(out).size, nombre: `Figura de la página ${p}` });
      } catch {
        /* imagen no recuperable: se ignora */
      }
    }
  }

  if (!guardadas.length) return;
  const { seleccionarImagenes } = require("./images");
  const { seleccionadas, total } = await seleccionarImagenes(guardadas, {
    max: Math.max(4, Math.floor(config.limits.maxImages / 3)),
    etiqueta: (v) => v.nombre,
  });
  if (!seleccionadas.length) return;
  onProgress({ stage: "vision", message: `Adjuntando ${seleccionadas.length} figura(s) del PDF...` });
  for (const img of seleccionadas) {
    await content.addImage(img.path, img.label);
  }
  content.fact("figurasExtraidas", seleccionadas.length);
  if (total > seleccionadas.length) {
    content.note(`El PDF trae ${total} figuras; se enviaron las ${seleccionadas.length} más grandes.`);
  }
}

/** Copia un pixel de un búfer de pdfjs (1, 3 o 4 canales) a RGBA. */
function imagenPixel(destino, j, origen, i, canales) {
  if (canales >= 4) {
    destino[j] = origen[i * 4];
    destino[j + 1] = origen[i * 4 + 1];
    destino[j + 2] = origen[i * 4 + 2];
    destino[j + 3] = origen[i * 4 + 3];
  } else if (canales === 3) {
    destino[j] = origen[i * 3];
    destino[j + 1] = origen[i * 3 + 1];
    destino[j + 2] = origen[i * 3 + 2];
    destino[j + 3] = 255;
  } else {
    const g = origen[i];
    destino[j] = g;
    destino[j + 1] = g;
    destino[j + 2] = g;
    destino[j + 3] = 255;
  }
}

async function extractDocxLike(filePath, workDir, content, onProgress) {
  onProgress({ stage: "office", message: "Leyendo documento de Word..." });
  const r = await office.extractDocx(filePath, workDir);
  content.addText("Contenido del documento", r.text).fact("palabras", wordCount(r.text));
  if (r.text.trim().length < 40) {
    content.note("El documento tiene muy poco texto; puede ser un escaneo dentro de Word. Si puedes, sube el PDF original.");
  }
  await attachMedia(r.images, content, workDir, onProgress, config.limits.maxImagenesIncrustadas);
}

async function extractPptxLike(filePath, workDir, content, onProgress) {
  onProgress({ stage: "office", message: "Leyendo presentacion..." });
  const r = await office.extractPptx(filePath, workDir);
  content
    .addText("Contenido de la presentacion", r.text)
    .fact("diapositivas", r.slides || 0)
    .fact("palabras", wordCount(r.text));
  await attachMedia(r.images, content, workDir, onProgress, config.limits.maxImagenesIncrustadas);
}

async function extractXlsxLike(filePath, workDir, content, onProgress) {
  onProgress({ stage: "office", message: "Leyendo hojas de calculo..." });
  const r = await office.extractXlsx(filePath, workDir);
  const names = office.workbookSheetNames(filePath);
  content
    .addText("Contenido de las hojas", r.text)
    .fact("hojas", names.length || undefined)
    .fact("palabras", wordCount(r.text));
  if (r.text.trim().length < 30) {
    content.note(
      "El libro no tiene texto legible en las celdas. Puede deberse a que las hojas solo contienen " +
        "formulas, imagenes o graficos; si es asi, exporta la hoja a PDF y sube ese PDF para una revision visual."
    );
  }
  await attachMedia(r.images, content, workDir, onProgress, config.limits.maxImagenesIncrustadas);
}

async function extractVideo(filePath, workDir, content, onProgress) {
  onProgress({ stage: "video", message: "Analizando video..." });
  const { frames, meta } = await video.extractFrames(filePath, workDir);
  const mins = meta.seconds ? Math.floor(meta.seconds / 60) : 0;
  const secs = meta.seconds ? Math.round(meta.seconds % 60) : 0;

  content
    .fact("duracion", meta.seconds ? `${mins}m ${secs}s` : "desconocida")
    .fact("resolucion", meta.width && meta.height ? `${meta.width}x${meta.height}` : undefined)
    .fact("fps", meta.fps)
    .fact("tieneAudio", meta.hasAudio ? "si" : "no");

  if (meta.hasAudio) {
    content.note(
      "El video incluye audio (" +
        meta.audioCodecs.join(", ") +
        "). La evaluacion se basa en lo que se VE en los fotogramas; no se transcribe la voz."
    );
  }
  if (!frames.length) {
    content.note("No se pudieron extraer fotogramas del video. Verifica que el archivo no este danado.");
    return;
  }

  onProgress({ stage: "video", message: `Adjuntando ${frames.length} fotogramas...` });
  const { MIME_BY_EXT } = require("./content");
  frames.forEach((f, i) => {
    const buf = fs.readFileSync(f);
    const mime = MIME_BY_EXT[path.extname(f).toLowerCase()] || "image/jpeg";
    content.images.push({
      label: `Fotograma ${i + 1}`,
      dataUrl: `data:${mime};base64,${buf.toString("base64")}`,
      bytes: buf.length,
      path: f,
    });
  });
  content.fact("fotogramasAnalizados", frames.length);
}

async function extractLegacy(filePath, workDir, content, onProgress, kind) {
  onProgress({ stage: "legacy", message: "Interpretando formato Office antiguo..." });
  const buf = fs.readFileSync(filePath);
  const { text, confidence } = recoverLegacyText(buf, kind.replace("-legacy", ""));
  if (text.length > 60) {
    content.addText("Texto recuperado del documento", text).fact("palabras", wordCount(text));
    content.note(
      `El archivo esta en formato Office antiguo; el texto se recupero de forma ${confidence}. ` +
        "Si la retroalimentacion parece incompleta, guarda el archivo como .docx/.xlsx/.pptx o PDF y vuelve a subirlo."
    );
  } else {
    content.note(
      "No fue posible leer el contenido de este formato antiguo. " +
        "Abre el archivo y guardalo como PDF o como formato moderno (.docx, .xlsx, .pptx) para poder evaluarlo."
    );
  }
  content.fact("recuperacion", confidence);
}

/**
 * Adjunta las imagenes incrustadas de un documento (diagramas, tablas,
 * capturas, fotografias, firmas). Se envian TODAS las que tengan contenido:
 * la unica razon para dejar alguna fuera es que sea decorativa o que se
 * supere el cupo de imagenes del modelo.
 */
async function attachMedia(images, content, workDir, onProgress, max) {
  if (!images || !images.length) return;

  const { seleccionarImagenes, normalizarFormato } = require("./images");
  const cupo = max || config.limits.maxImagenesIncrustadas;

  // Los formatos que el modelo no entiende (emf, wmf, svg) se convierten.
  const normalizadas = [];
  for (const img of images) {
    const p = await normalizarFormato(img.path, path.join(workDir, "convertidas"));
    if (p) normalizadas.push({ ...img, path: p });
  }
  if (!normalizadas.length) return;

  const { seleccionadas, descartadas, total } = await seleccionarImagenes(normalizadas, {
    max: cupo,
    etiqueta: (v, i) => `Imagen ${i + 1} del documento${v.original ? ` (${v.original})` : ""}`,
  });

  if (!seleccionadas.length) {
    const decorativas = descartadas.filter((d) => d.motivo === "decorativa").length;
    content.note(
      `El documento trae ${total} imagen(es), pero todas son elementos decorativos ` +
        `(líneas o viñetas), así que no se enviaron al modelo.`
    );
    return;
  }

  onProgress({
    stage: "vision",
    message: `Adjuntando ${seleccionadas.length} imagen(es) del documento para análisis visual...`,
  });
  for (const img of seleccionadas) {
    try {
      await content.addImage(img.path, img.label);
    } catch {
      /* imagen ilegible: se omite */
    }
  }

  content.fact("imagenesEnDocumento", seleccionadas.length);
  const omitidas = descartadas.filter((d) => d.motivo === "excede el cupo").length;
  if (omitidas) {
    content.note(
      `El documento trae ${total} imágenes con contenido; se enviaron las ${seleccionadas.length} principales ` +
        `y ${omitidas} quedaron fuera por el límite de imágenes del modelo.`
    );
  }
}


module.exports = { extract, KIND_LABEL, readTextFile, humanSize };
