"use strict";
/**
 * Pruebas de la politica de imagenes: que conserve TODAS las imagenes con
 * contenido y que solo descarte las decorativas o repetidas.
 * Uso: node tests/test-imagenes.js
 */
const fs = require("fs");
const path = require("path");
const os = require("os");
const config = require("../lib/config");
const { seleccionarImagenes, esDecorativa, medirImagen } = require("../lib/images");
const { createCanvas } = require(path.join(config.vendor, "node_modules/@napi-rs/canvas"));

let fallos = 0;
function check(nombre, condicion, extra = "") {
  console.log(`  ${condicion ? "OK   " : "FALLA"} ${nombre}${extra ? " -> " + extra : ""}`);
  if (!condicion) fallos++;
}

const dir = path.join(os.tmpdir(), "il-imagenes-" + Date.now());
fs.mkdirSync(dir, { recursive: true });

/** Crea una imagen de prueba con contenido visible. */
function crear(nombre, ancho, alto, relleno) {
  const cv = createCanvas(ancho, alto);
  const x = cv.getContext("2d");
  x.fillStyle = "#ffffff";
  x.fillRect(0, 0, ancho, alto);
  x.fillStyle = relleno || "#1d6fa5";
  x.fillRect(0, 0, ancho, Math.max(1, Math.round(alto * 0.6)));
  if (ancho > 40 && alto > 40) {
    x.fillStyle = "#000000";
    x.font = `${Math.max(12, Math.round(alto / 8))}px Arial`;
    x.fillText("DIAGRAMA", 8, Math.round(alto / 2));
  }
  const p = path.join(dir, nombre);
  fs.writeFileSync(p, cv.toBuffer("image/png"));
  return p;
}

async function main() {
  console.log("=== MEDICION Y FILTRO DE DECORATIVAS ===");
  const grande = crear("grande.png", 900, 620);
  const icono = crear("icono.png", 120, 120);
  const punto = crear("punto.png", 4, 4, "#cccccc");
  const linea = crear("linea.png", 600, 3, "#999999");

  const mGrande = medirImagen(grande);
  check("Mide el ancho de una imagen grande", Boolean(mGrande) && mGrande.ancho === 900, JSON.stringify(mGrande));
  check("Mide el alto de una imagen grande", Boolean(mGrande) && mGrande.alto === 620);
  check("Un diagrama grande NO es decorativo", !esDecorativa(mGrande));
  check("Un icono de 120x120 NO es decorativo (antes se descartaba)", !esDecorativa(medirImagen(icono)));
  check("Un punto de 4x4 SI es decorativo", esDecorativa(medirImagen(punto)));
  check("Una linea de 600x3 SI es decorativa", esDecorativa(medirImagen(linea)));

  console.log("\n=== SELECCION ===");
  const copia = path.join(dir, "copia.png");
  fs.copyFileSync(grande, copia); // mismo contenido, otro nombre

  const entrada = [
    { path: grande, name: "diagrama.png" },
    { path: icono, name: "icono.png" },
    { path: punto, name: "punto.png" },
    { path: linea, name: "linea.png" },
    { path: copia, name: "copia.png" },
  ];
  const r = await seleccionarImagenes(entrada, { max: 10 });
  const nombres = r.seleccionadas.map((s) => path.basename(s.path));
  check("Conserva el diagrama", nombres.includes("grande.png"), nombres.join(", "));
  check("Conserva el icono pequeno (antes se perdia)", nombres.includes("icono.png"));
  check("Descarta el punto diminuto", !nombres.includes("punto.png"));
  check("Descarta la linea decorativa", !nombres.includes("linea.png"));
  check("Descarta la imagen duplicada", !nombres.includes("copia.png"), r.descartadas.map((d) => d.motivo).join(","));
  check("Cuenta solo las que tienen contenido", r.total === 2, "total=" + r.total);
  check("Ordena el diagrama primero (mayor area)", nombres[0] === "grande.png", nombres.join(", "));

  console.log("\n=== CUPO ===");
  const muchas = [];
  for (let i = 1; i <= 25; i++) {
    muchas.push({ path: crear(`img${i}.png`, 400 + i, 300 + i, `hsl(${i * 14},60%,45%)`), name: `img${i}.png` });
  }
  const r2 = await seleccionarImagenes(muchas, { max: 10 });
  check("Respeta el cupo maximo", r2.seleccionadas.length === 10, r2.seleccionadas.length + " enviadas");
  check("Informa el total real", r2.total === 25, "total=" + r2.total);
  check("Marca las omitidas por cupo", r2.descartadas.filter((d) => d.motivo === "excede el cupo").length === 15);
  check("Elige las de mayor area", r2.seleccionadas[0].medida.ancho === 425, "ancho=" + r2.seleccionadas[0].medida.ancho);

  console.log("\n=== ETIQUETAS ===");
  const conEtiqueta = await seleccionarImagenes([{ path: grande, name: "x.png" }], {
    max: 5,
    etiqueta: (v, i) => `Imagen ${i + 1} del documento`,
  });
  check("Aplica la etiqueta personalizada", conEtiqueta.seleccionadas[0].label === "Imagen 1 del documento", conEtiqueta.seleccionadas[0].label);

  fs.rmSync(dir, { recursive: true, force: true });
  console.log(`\n${fallos === 0 ? "TODO OK" : fallos + " FALLO(S)"}`);
  process.exit(fallos ? 1 : 0);
}

main().catch((e) => {
  console.error("ERROR:", e.message);
  process.exit(1);
});
