"use strict";
/**
 * Prueba de extraccion sobre todos los fixtures.
 * Uso:  node tests/test-extract.js [ruta/al/archivo]
 *       node tests/test-extract.js --llm        (ademas evalula con el modelo)
 */
const fs = require("fs");
const path = require("path");
const { extract } = require("../lib/extract");
const config = require("../lib/config");

const FIX = path.join(__dirname, "fixtures");

async function probar(file) {
  const nombre = path.basename(file);
  // El directorio de trabajo debe estar en data/tmp: en este entorno ffmpeg no
  // puede escribir en %TEMP% ("Could not open file") y el fixture de video fallaria.
  const workDir = path.join(config.tmp, "test-extract-" + Date.now() + "-" + Math.random().toString(36).slice(2, 7));
  const t0 = Date.now();
  process.stdout.write(`\n=== ${nombre} ===\n`);
  try {
    const { kindLabel, content } = await extract(file, nombre, workDir, (e) => {
      if (process.env.VERBOSE) process.stdout.write(`   · ${e.message}\n`);
    });
    const ms = Date.now() - t0;
    console.log(`  Tipo        : ${kindLabel}`);
    console.log(`  Texto       : ${content.textChars} caracteres`);
    console.log(`  Imagenes    : ${content.images.length}`);
    console.log(`  Hechos      : ${JSON.stringify(content.facts)}`);
    if (content.notes.length) console.log(`  Notas       : ${content.notes.join(" | ")}`);
    const muestra = content.text.replace(/\s+/g, " ").slice(0, 260);
    console.log(`  Muestra     : ${muestra || "(sin texto)"}`);
    console.log(`  Tiempo      : ${ms} ms`);
    return { nombre, ok: content.textChars > 0 || content.images.length > 0, content, kindLabel };
  } catch (e) {
    console.log(`  ERROR: ${e.message}`);
    if (process.env.VERBOSE) console.log(e.stack);
    return { nombre, ok: false, error: e.message };
  }
}

(async () => {
  const args = process.argv.slice(2);
  const conLlm = args.includes("--llm");
  const explicit = args.filter((a) => !a.startsWith("--"));

  let archivos;
  if (explicit.length) {
    archivos = explicit;
  } else {
    if (!fs.existsSync(FIX)) {
      console.error("No hay fixtures. Ejecuta primero: node tests/make-fixtures.js");
      process.exit(1);
    }
    archivos = fs
      .readdirSync(FIX)
      .filter((f) => !/^\./.test(f))
      .map((f) => path.join(FIX, f));
  }

  const res = [];
  for (const f of archivos) res.push(await probar(f));

  console.log("\n================ RESUMEN ================");
  for (const r of res) {
    console.log(`${r.ok ? "OK  " : "FALLA"}  ${r.nombre}${r.error ? " -> " + r.error : ""}`);
  }

  if (conLlm) {
    const objetivo = res.find((r) => r.ok && r.content.textChars > 200);
    if (!objetivo) {
      console.log("\nNo hay material suficiente para probar el modelo.");
    } else {
      console.log(`\n=== Evaluacion con el modelo (${objetivo.nombre}) ===\n`);
      const { evaluate } = require("../lib/llm");
      const r = await evaluate({
        instructions:
          "Evalua este material con rubrica: 1) claridad (30%), 2) uso de indicadores (40%), 3) plan de accion (30%). Pon una nota de 0 a 5 y justificala.",
        content: objetivo.content,
        onProgress: (e) => console.log("  ·", e.message),
      });
      console.log("\n" + r.text);
      console.log("\nTokens:", JSON.stringify(r.usage));
    }
  }

  const fallos = res.filter((r) => !r.ok).length;
  console.log(`\n${res.length - fallos}/${res.length} archivos procesados correctamente.`);
  process.exit(fallos ? 1 : 0);
})();
