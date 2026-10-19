"use strict";
/**
 * Repara archivos de texto danados por doble codificacion UTF-8 (mojibake)
 * y les quita el BOM. Solo toca archivos que realmente lo necesitan.
 * Uso: node tests/reparar-encoding.js [--aplicar]
 */
const fs = require("fs");
const path = require("path");

const RAIZ = path.join(__dirname, "..");
const APLICAR = process.argv.includes("--aplicar");
const EXT = new Set([".js", ".mjs", ".json", ".html", ".css", ".md", ".bat"]);

/** Detecta el patron tipico de UTF-8 leido como Windows-1252. */
function tieneMojibake(t) {
  return /[\u00c3\u00c2][\u0080-\u00bf]/.test(t) || /Ã¡|Ã©|Ã|Ã³|Ãº|Ã±|Â¿|Â¡|â€/.test(t);
}

/** Revierte la doble codificacion. */
function reparar(t) {
  // Se reinterpreta el texto como bytes latin1 y se vuelve a decodificar UTF-8.
  const bytes = Buffer.from(t, "latin1");
  const intento = bytes.toString("utf8");
  // Si el resultado tiene menos caracteres de reemplazo, es mejor.
  const malosAntes = (t.match(/\uFFFD/g) || []).length;
  const malosDespues = (intento.match(/\uFFFD/g) || []).length;
  return malosDespues <= malosAntes ? intento : t;
}

function recorrer(dir, encontrados) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "vendor" || e.name === "node_modules" || e.name === "data" || e.name.startsWith(".")) continue;
    // Este mismo archivo contiene los patrones de deteccion a proposito.
    if (e.name === "reparar-encoding.js") continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) recorrer(p, encontrados);
    else if (EXT.has(path.extname(e.name).toLowerCase())) encontrados.push(p);
  }
}

const archivos = [];
recorrer(RAIZ, archivos);

let revisados = 0;
let danados = 0;
let reparados = 0;

for (const f of archivos) {
  const buf = fs.readFileSync(f);
  revisados++;
  const tieneBom = buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf;
  let texto = buf.toString("utf8");
  if (tieneBom) texto = texto.slice(1);

  const roto = tieneMojibake(texto);
  if (!roto && !tieneBom) continue;

  danados++;
  const arreglado = roto ? reparar(texto) : texto;
  const sigueRoto = tieneMojibake(arreglado);
  const rel = path.relative(RAIZ, f);
  console.log(
    `${sigueRoto ? "[PENDIENTE]" : "[OK]       "} ${rel}` +
      `${tieneBom ? " (BOM)" : ""}${roto ? " (mojibake)" : ""}` +
      (roto ? ` -> ${sigueRoto ? "no se pudo reparar del todo" : "reparado"}` : "")
  );

  if (sigueRoto) continue;
  reparados++;
  if (APLICAR) {
    // Se escribe UTF-8 SIN BOM y con los saltos de linea originales.
    fs.writeFileSync(f, arreglado, "utf8");
  }
}

console.log(`\nRevisados: ${revisados} | con problemas: ${danados} | reparables: ${reparados}`);
if (!APLICAR) console.log("Modo simulacion. Vuelve a ejecutar con --aplicar para escribir los cambios.");
else console.log("Cambios aplicados.");
