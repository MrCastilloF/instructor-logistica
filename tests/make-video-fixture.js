"use strict";
/**
 * Genera un video de prueba con ffmpeg (3 escenas de colores con titulos).
 * Usa redireccion a archivos porque el sandbox bloquea las tuberias.
 * Uso: node tests/make-video-fixture.js
 */
const fs = require("fs");
const path = require("path");
const config = require("../lib/config");
const { run, available } = require("../lib/proc");

(async () => {
  const out = path.join(__dirname, "fixtures", "proceso_recepcion.mp4");
  fs.mkdirSync(path.dirname(out), { recursive: true });

  if (!available(config.ffmpeg)) {
    console.log("ffmpeg no disponible: se omite el video de prueba.");
    return;
  }
  if (fs.existsSync(out) && !process.argv.includes("--force")) {
    console.log("Ya existe:", out, `(${fs.statSync(out).size} bytes). Usa --force para regenerarlo.`);
    return;
  }

  // HOME/XDG se redirigen para que fontconfig no intente escribir fuera del workspace.
  const home = path.join(config.tmp, "ffhome");
  fs.mkdirSync(path.join(home, "cache"), { recursive: true });
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  process.env.XDG_CACHE_HOME = path.join(home, "cache");

  const escenas = [
    { color: "navy", texto: "PASO 1: RECEPCION DE MERCANCIA" },
    { color: "darkgreen", texto: "PASO 2: ALMACENAJE Y UBICACION" },
    { color: "maroon", texto: "PASO 3: ALISTAMIENTO Y DESPACHO" },
  ];

  const args = ["-y", "-hide_banner", "-loglevel", "error"];
  escenas.forEach((e) => {
    args.push(
      "-f", "lavfi", "-i",
      `color=c=${e.color}:s=640x360:d=2,drawtext=text='${e.text}':fontsize=28:fontcolor=white:x=(w-text_w)/2:y=(h-text_h)/2`
    );
  });
  args.push("-f", "lavfi", "-i", "sine=frequency=440:duration=6");
  args.push(
    "-filter_complex", "[0:v][1:v][2:v]concat=n=3:v=1:a=0[v]",
    "-map", "[v]", "-map", "3:a",
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest",
    out
  );

  const r = await run(config.ffmpeg, args, { timeoutMs: 180000 });
  if (fs.existsSync(out) && fs.statSync(out).size > 1000) {
    console.log(`Video de prueba creado: ${out} (${fs.statSync(out).size} bytes)`);
  } else {
    console.log("No se pudo crear el video:", (r.stderr || "").split("\n").slice(-4).join(" "));
  }
})();
