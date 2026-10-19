"use strict";
/**
 * Diagnostico del entorno y de las piezas incluidas en el paquete.
 * Uso: node tests/doctor.js
 */
const fs = require("fs");
const path = require("path");
const config = require("../lib/config");

const ok = [];
const fallos = [];
const avisos = [];

/** Ejecuta una verificacion (puede ser sincrona o devolver una promesa). */
async function check(nombre, fn) {
  try {
    const r = await fn();
    if (r === true || r === undefined) ok.push(nombre);
    else if (typeof r === "string") avisos.push(`${nombre}: ${r}`);
    else fallos.push(nombre);
  } catch (e) {
    fallos.push(`${nombre} -> ${e.message}`);
  }
}

(async () => {
  console.log("Diagnostico del Instructor de Logistica\n" + "=".repeat(45) + "\n");

  await check("Node.js 22.13 o superior", () => {
    const [mayor, menor] = process.versions.node.split(".").map(Number);
    // PDF.js 6.3.289 exige Node 22.13+; con versiones anteriores la app falla al leer PDF.
    if (mayor < 22 || (mayor === 22 && menor < 13)) {
      throw new Error("se requiere Node 22.13+ (actual " + process.version + ")");
    }
    return true;
  });

  await check("Clave de API configurada", () =>
    Boolean(config.apiKey) || "no hay clave; define DEEPSEEK_API_KEY o crea data/config.json"
  );

  await check("Interfaz web (public/)", () => fs.existsSync(path.join(config.root, "public", "index.html")));

  await check("pdfjs-dist incluido", () => fs.existsSync(path.join(config.vendor, "pdfjs-dist/legacy/build/pdf.mjs")));

  await check("Canvas nativo (@napi-rs/canvas)", () => {
    const { createCanvas } = require(path.join(config.vendor, "node_modules/@napi-rs/canvas"));
    const cv = createCanvas(12, 12);
    const x = cv.getContext("2d");
    x.fillStyle = "#123456";
    x.fillRect(0, 0, 6, 6);
    if (!cv.toBuffer("image/png").length) throw new Error("no genera imagenes PNG");
    return true;
  });

  await check("ffmpeg para video", () =>
    fs.existsSync(config.ffmpeg) ? true : "no encontrado; los videos no se podran analizar"
  );

  await check("Escritura en data/", () => {
    const f = path.join(config.data, ".prueba-escritura");
    fs.writeFileSync(f, "ok");
    const leido = fs.readFileSync(f, "utf8");
    fs.unlinkSync(f);
    if (leido !== "ok") throw new Error("no se pudo leer lo escrito");
    return true;
  });

  // --- Pruebas funcionales reales ---
  const fixture = path.join(__dirname, "fixtures", "informe_escaneado.pdf");
  if (fs.existsSync(fixture)) {
    await check("Lectura y rasterizado de PDF", async () => {
      const { readPdf, renderPage } = require("../lib/pdf");
      const work = path.join(config.tmp, "doctor");
      fs.mkdirSync(work, { recursive: true });
      const pdf = await readPdf(fixture);
      if (pdf.pages < 1) throw new Error("no se detectaron paginas");
      const img = await renderPage(pdf.doc, 1, path.join(work, "p1.jpg"));
      if (!img.bytes) throw new Error("la pagina no se pudo convertir a imagen");
      return true;
    });
  } else {
    avisos.push("Prueba de PDF omitida: ejecuta node tests/make-fixtures.js");
  }

  const fixtureVideo = path.join(__dirname, "fixtures", "proceso_recepcion.mp4");
  if (fs.existsSync(fixtureVideo) && fs.existsSync(config.ffmpeg)) {
    await check("Extraccion de fotogramas de video", async () => {
      const video = require("../lib/video");
      const work = path.join(config.tmp, "doctor-video");
      fs.mkdirSync(work, { recursive: true });
      const { frames, meta } = await video.extractFrames(fixtureVideo, work);
      if (!frames.length) throw new Error("no se extrajo ningun fotograma");
      if (!meta.seconds) throw new Error("no se pudo leer la duracion");
      return true;
    });
  } else {
    avisos.push("Prueba de video omitida: ejecuta node tests/make-video-fixture.js");
  }

  // --- Conexion con el servicio de IA ---
  process.stdout.write("Probando conexion con " + new URL(config.apiUrl).host + " ... ");
  try {
    const url = config.apiUrl.replace(/\/chat\/completions.*$/, "/models");
    const r = await fetch(url, { headers: { Authorization: "Bearer " + config.apiKey } });
    console.log(r.ok ? "OK (" + r.status + ")" : "respondio " + r.status);
    if (!r.ok) avisos.push("conexion a la API: estado HTTP " + r.status);
  } catch (e) {
    console.log("FALLA");
    fallos.push("conexion a la API -> " + e.message);
  }

  console.log("\nCorrecto:");
  for (const o of ok) console.log("  [ok] " + o);
  if (avisos.length) {
    console.log("\nAvisos (la aplicacion funciona con limitaciones):");
    for (const a of avisos) console.log("  [!] " + a);
  }
  if (fallos.length) {
    console.log("\nProblemas:");
    for (const f of fallos) console.log("  [x] " + f);
  }
  console.log("\n" + (fallos.length ? "HAY " + fallos.length + " PROBLEMA(S)" : "TODO CORRECTO"));
  process.exit(fallos.length ? 1 : 0);
})();
