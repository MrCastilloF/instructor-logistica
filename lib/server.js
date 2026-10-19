"use strict";
/**
 * Servidor local del Instructor de Logistica.
 * Sin dependencias externas: usa http, FormData y fetch nativos de Node.
 *
 * Flujo: el usuario sube (1) el documento a evaluar y (2) las instrucciones
 * (como archivo o escritas). Solo puede pulsar "Evaluar".
 */
const http = require("http");
const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const crypto = require("crypto");
const { spawn } = require("child_process");

const config = require("./config");
const { extract } = require("./extract");
const { evaluate } = require("./llm");
const { normalizeText } = require("./content");

const PUBLIC = path.join(config.root, "public");

/* ------------------------------------------------------------------ */
/* Trabajos en memoria                                                 */
/* ------------------------------------------------------------------ */
const jobs = new Map();

function createJob() {
  const id = crypto.randomBytes(8).toString("hex");
  const job = {
    id,
    status: "pendiente",
    progress: [],
    result: null,
    error: null,
    createdAt: Date.now(),
    startedAt: null,
    finishedAt: null,
    subscribers: new Set(),
    fileName: null,
  };
  jobs.set(id, job);
  return job;
}

function emit(job, event) {
  job.progress.push(event);
  const payload = `data: ${JSON.stringify(event)}\n\n`;
  for (const res of job.subscribers) {
    try {
      res.write(payload);
    } catch {
      job.subscribers.delete(res);
    }
  }
}

// Limpieza de trabajos y archivos viejos (2 horas).
setInterval(() => {
  const cutoff = Date.now() - 2 * 60 * 60 * 1000;
  for (const [id, job] of jobs) {
    if (job.createdAt < cutoff) {
      jobs.delete(id);
      cleanupJob(job);
    }
  }
}, 15 * 60 * 1000).unref();

function cleanupJob(job) {
  for (const p of job.tempPaths || []) {
    fsp.rm(p, { recursive: true, force: true }).catch(() => {});
  }
}

/* ------------------------------------------------------------------ */
/* Utilidades HTTP                                                     */
/* ------------------------------------------------------------------ */
function sendJson(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

function safeName(name) {
  return String(name || "archivo")
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_")
    .replace(/^\.+/, "_")
    .slice(0, 160);
}

/* ------------------------------------------------------------------ */
/* Analisis                                                            */
/* ------------------------------------------------------------------ */
async function saveUpload(file, dir) {
  const name = safeName(file.name || "documento");
  const target = path.join(dir, name);
  const buf = Buffer.from(await file.arrayBuffer());
  await fsp.writeFile(target, buf);
  return { path: target, name, bytes: buf.length };
}

async function readInstructions({ instructionsText, instructionsFile, workDir, onProgress }) {
  const typed = normalizeText(instructionsText || "");
  let fromFile = "";
  let fileInfo = null;

  if (instructionsFile && instructionsFile.size > 0) {
    onProgress({ stage: "instructions", message: "Leyendo el archivo de instrucciones..." });
    const dir = path.join(workDir, "instrucciones");
    await fsp.mkdir(dir, { recursive: true });
    const saved = await saveUpload(instructionsFile, dir);
    fileInfo = { name: saved.name, bytes: saved.bytes };
    try {
      const r = await extract(saved.path, saved.name, dir, () => {});
      fromFile = r.content.text || "";
      if (!fromFile.trim()) {
        // Si es PDF escaneado sin texto, se describe mediante vision en el mismo paso.
        onProgress({ stage: "instructions", message: "Las instrucciones no tienen texto; se leeran como imagen." });
        const imgs = r.content.images.map((i) => i.dataUrl).filter(Boolean);
        if (imgs.length) {
          const { evaluateInstructionsImage } = require("./llm");
          fromFile = await evaluateInstructionsImage(imgs, onProgress);
        }
      }
    } catch (e) {
      onProgress({ stage: "instructions", message: "No se pudo leer el archivo de instrucciones: " + e.message });
    }
  }

  const combined = [typed, fromFile].filter((s) => s && s.trim()).join("\n\n");
  return { instructions: combined, typedChars: typed.length, fileInfo, fromFile };
}

async function runAnalysisJob(job, { docFile, instructionsText, instructionsFile, contextText }) {
  const workDir = path.join(config.tmp, "jobs", job.id);
  job.tempPaths = [workDir];
  const onProgress = (e) => emit(job, { ...e, t: Date.now() });

  try {
    job.status = "analizando";
    job.startedAt = Date.now();

    const docDir = path.join(workDir, "documento");
    await fsp.mkdir(docDir, { recursive: true });
    const saved = await saveUpload(docFile, docDir);
    job.fileName = saved.name;
    emit(job, { stage: "upload", message: `Documento recibido: ${saved.name}`, t: Date.now() });

    const { instructions, typedChars, fileInfo } = await readInstructions({
      instructionsText,
      instructionsFile,
      workDir,
      onProgress,
    });

    if (!instructions.trim()) {
      onProgress({
        stage: "instructions",
        message: "No se dieron instrucciones: se aplicara un criterio general de logistica.",
      });
    } else {
      onProgress({
        stage: "instructions",
        message: `Instrucciones listas (${instructions.length} caracteres${fileInfo ? `, archivo: ${fileInfo.name}` : ""}${typedChars ? ", texto escrito" : ""}).`,
      });
    }

    onProgress({ stage: "extract", message: "Analizando el documento entregado..." });
    const { kindLabel, content } = await extract(saved.path, saved.name, docDir, onProgress);

    emit(job, {
      stage: "extract-done",
      message:
        `Extraccion completa (${kindLabel}): ${content.textChars} caracteres de texto, ` +
        `${content.images.length} imagen(es).`,
      t: Date.now(),
      preview: {
        kind: kindLabel,
        textChars: content.textChars,
        images: content.images.length,
        notes: content.notes,
        facts: content.facts,
      },
    });

    const result = await evaluate({ instructions, content, extraContext: contextText, onProgress });

    job.result = {
      feedback: result.text,
      checklist: result.checklist || null,
      checklistAviso: result.checklistAviso || null,
      model: result.model,
      usage: result.usage,
      estimate: result.estimate,
      document: {
        name: saved.name,
        kind: kindLabel,
        textChars: content.textChars,
        images: content.images.length,
        notes: content.notes,
        facts: content.facts,
      },
      instructions: {
        chars: instructions.length,
        fromFile: fileInfo ? fileInfo.name : null,
        typed: typedChars > 0,
        preview: instructions.slice(0, 1500),
      },
      elapsedMs: Date.now() - job.startedAt,
    };
    job.status = "listo";
    emit(job, { stage: "finish", message: "Evaluacion terminada.", t: Date.now() });
  } catch (e) {
    job.status = "error";
    job.error = e.message || String(e);
    emit(job, { stage: "error", message: job.error, t: Date.now() });
  } finally {
    job.finishedAt = Date.now();
    for (const res of job.subscribers) {
      try {
        res.end();
      } catch {
        /* ya cerrado */
      }
    }
    job.subscribers.clear();
    cleanupJob(job);
  }
}

/* ------------------------------------------------------------------ */
/* Rutas                                                               */
/* ------------------------------------------------------------------ */
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".json": "application/json; charset=utf-8",
};

async function serveStatic(req, res, urlPath) {
  let rel = decodeURIComponent(urlPath.split("?")[0]);
  if (rel === "/" || rel === "") rel = "/index.html";
  const target = path.join(PUBLIC, path.normalize(rel).replace(/^(\.\.[\\/])+/, ""));
  if (!target.startsWith(PUBLIC)) return sendJson(res, 403, { error: "Ruta no permitida" });
  try {
    const data = await fsp.readFile(target);
    res.writeHead(200, {
      "Content-Type": MIME[path.extname(target).toLowerCase()] || "application/octet-stream",
      // no-store evita que el navegador use una version antigua del programa
      // si la aplicacion se detuvo y se volvio a iniciar.
      "Cache-Control": "no-store, no-cache, must-revalidate",
      Pragma: "no-cache",
      Expires: "0",
    });
    res.end(data);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Recurso no encontrado");
  }
}

async function handleEvaluate(req, res) {
  const ctype = req.headers["content-type"] || "";
  if (!/multipart\/form-data/i.test(ctype)) {
    return sendJson(res, 400, { error: "Se esperaba multipart/form-data." });
  }

  let form;
  try {
    // Se envuelve la peticion para poder usar la API FormData de Node.
    const request = new Request("http://localhost/evaluar", { method: "POST", headers: req.headers, body: req, duplex: "half" });
    form = await request.formData();
  } catch (e) {
    return sendJson(res, 400, { error: "No se pudo leer el formulario: " + e.message });
  }

  const docFile = form.get("documento");
  if (!docFile || typeof docFile === "string" || !docFile.size) {
    return sendJson(res, 400, { error: "Falta el documento a evaluar." });
  }

  const instructionsFile = form.get("instruccionesArchivo");
  const instructionsText = form.get("instruccionesTexto") || "";
  const contextText = form.get("contexto") || "";

  const job = createJob();
  // El trabajo corre en segundo plano; el cliente sigue el progreso por SSE.
  runAnalysisJob(job, {
    docFile,
    instructionsText: typeof instructionsText === "string" ? instructionsText : "",
    instructionsFile: instructionsFile && typeof instructionsFile !== "string" && instructionsFile.size > 0 ? instructionsFile : null,
    contextText: typeof contextText === "string" ? contextText : "",
  });

  return sendJson(res, 202, { jobId: job.id, status: job.status });
}

function handleProgress(req, res, url) {
  const id = url.searchParams.get("job");
  const job = jobs.get(id);
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  if (!job) {
    res.write(`data: ${JSON.stringify({ stage: "error", message: "Trabajo no encontrado." })}\n\n`);
    return res.end();
  }
  // Reenvia lo ya ocurrido
  for (const e of job.progress) res.write(`data: ${JSON.stringify(e)}\n\n`);
  if (job.status === "listo" || job.status === "error") return res.end();

  job.subscribers.add(res);
  const ping = setInterval(() => {
    try {
      res.write(": ping\n\n");
    } catch {
      /* ignore */
    }
  }, 15000);
  req.on("close", () => {
    clearInterval(ping);
    job.subscribers.delete(res);
  });
}

function handleResult(req, res, id) {
  const job = jobs.get(id);
  if (!job) return sendJson(res, 404, { error: "Trabajo no encontrado." });
  if (job.status === "error") return sendJson(res, 200, { status: "error", error: job.error });
  if (job.status !== "listo") return sendJson(res, 202, { status: job.status });
  return sendJson(res, 200, { status: "listo", result: job.result });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  try {
    if (req.method === "POST" && url.pathname === "/api/evaluar") return await handleEvaluate(req, res);
    if (req.method === "GET" && url.pathname === "/api/progreso") return handleProgress(req, res, url);
    if (req.method === "GET" && url.pathname.startsWith("/api/resultado/")) {
      return handleResult(req, res, url.pathname.split("/").pop());
    }
    if (req.method === "GET" && url.pathname === "/api/estado") {
      return sendJson(res, 200, {
        ok: true,
        modelo: config.model,
        claveConfigurada: Boolean(config.apiKey),
        ffmpeg: fs.existsSync(config.ffmpeg),
        formatos: [
          "PDF (incluye escaneados)",
          "Word .docx",
          "Excel .xlsx / .csv",
          "PowerPoint .pptx",
          "OpenDocument .odt/.ods/.odp",
          "Imagenes JPG/PNG/WEBP/GIF/TIFF/BMP/HEIC",
          "Video MP4/MOV/AVI/MKV/WEBM",
          "Texto .txt/.md/.rtf/.srt/.json",
        ],
      });
    }
    if (req.method === "GET") return await serveStatic(req, res, url.pathname);
    res.writeHead(405, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Metodo no permitido");
  } catch (e) {
    sendJson(res, 500, { error: "Error interno: " + (e.message || e) });
  }
});

server.headersTimeout = 0;
server.requestTimeout = 0;

function openBrowser(url) {
  if (process.env.NO_OPEN) return;
  try {
    spawn("cmd", ["/c", "start", "", url], { stdio: "ignore", detached: true, windowsHide: true }).unref();
  } catch {
    /* si no se puede abrir, el usuario entra manualmente */
  }
}

function start(port = config.port, attempt = 0) {
  server.once("error", (e) => {
    if (e.code === "EADDRINUSE" && attempt < 12) {
      const next = port + 1;
      console.log(`El puerto ${port} esta ocupado; probando ${next}...`);
      start(next, attempt + 1);
    } else {
      console.error("No se pudo iniciar el servidor:", e.message);
      process.exit(1);
    }
  });
  server.listen(port, config.host, () => {
    const url = `http://${config.host}:${port}`;
    console.log("");
    console.log("  ===============================================");
    console.log("   INSTRUCTOR DE LOGISTICA - Evaluador de entregas");
    console.log("  ===============================================");
    console.log("");
    console.log("   Abre esta direccion en tu navegador:");
    console.log("   " + url);
    console.log("");
    console.log("   Modelo: " + config.model);
    console.log("   Clave de API: " + (config.apiKey ? "configurada" : "FALTA (revisa data/config.json)"));
    console.log("   ffmpeg (video): " + (fs.existsSync(config.ffmpeg) ? "disponible" : "no encontrado"));
    console.log("");
    console.log("   Para detener la aplicacion: Ctrl + C");
    console.log("");
    if (process.argv.includes("--open")) openBrowser(url);
  });
}

module.exports = { start, server };

if (require.main === module) start();
