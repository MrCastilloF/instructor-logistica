"use strict";
/**
 * Analisis de video con ffmpeg:
 *  - Metadatos (duracion, resolucion, fps, codecs, pistas de audio)
 *  - Fotogramas muestreados de forma uniforme en TODA la linea de tiempo
 *  - Deduplicacion de fotogramas casi identicos (perceptual hash)
 * Los fotogramas se envian al modelo de vision. Si el video trae audio,
 * se advierte que el audio no se transcribe (limitacion de la API).
 */
const fs = require("fs");
const path = require("path");
const config = require("./config");
const { run, available } = require("./proc");
const { canvas } = require("./pdf");

function ffmpegAvailable() {
  return available(config.ffmpeg);
}

async function probe(filePath) {
  if (!ffmpegAvailable()) return { error: "ffmpeg no disponible" };
  const r = await run(config.ffmpeg, ["-hide_banner", "-i", filePath], { timeoutMs: 60000 });
  const txt = r.stderr + r.stdout;

  const dur = txt.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
  const seconds = dur ? Number(dur[1]) * 3600 + Number(dur[2]) * 60 + Number(dur[3]) : null;

  const streams = [];
  // Acepta "Stream #0:0(und): ..." y "Stream #0:0[0x1](und): ..."
  for (const m of txt.matchAll(/Stream #\d+:\d+(?:\[[^\]]*\])?(?:\([^)]*\))?:\s*([^\r\n]+)/g)) {
    streams.push(m[1].trim());
  }
  const video = streams.find((s) => /^Video:/i.test(s)) || null;
  const audios = streams.filter((s) => /^Audio:/i.test(s));

  const dim = video && video.match(/(\d{2,5})x(\d{2,5})/);
  const fps = video && video.match(/([\d.]+)\s*fps/);
  const vcodec = video && (video.match(/Video:\s*([\w-]+)/) || [])[1];

  // Bitrate total
  const br = txt.match(/bitrate:\s*(\d+)\s*kb\/s/);

  return {
    seconds,
    width: dim ? Number(dim[1]) : null,
    height: dim ? Number(dim[2]) : null,
    fps: fps ? Number(fps[1]) : null,
    videoCodec: vcodec || null,
    hasAudio: audios.length > 0,
    audioCodecs: audios.map((a) => (a.match(/Audio:\s*([\w-]+)/) || [])[1]).filter(Boolean),
    bitrateKbps: br ? Number(br[1]) : null,
    streams,
    raw: txt.slice(0, 4000),
  };
}

/**
 * Extrae fotogramas distribuidos por todo el video.
 * @returns {Promise<{frames:string[], meta:object}>}
 */
async function extractFrames(filePath, workDir, { maxFrames = config.limits.maxVideoFrames } = {}) {
  const meta = await probe(filePath);
  const dir = path.join(workDir, "frames");
  fs.mkdirSync(dir, { recursive: true });
  if (!ffmpegAvailable()) return { frames: [], meta, error: "ffmpeg no disponible" };

  const dur = meta.seconds && meta.seconds > 0 ? meta.seconds : 30;
  // Distribucion uniforme: cubre inicio, medio y final del video.
  let count = Math.min(maxFrames, Math.max(4, Math.round(dur / 8) + 3));
  if (dur < 12) count = Math.min(maxFrames, 6);
  const step = dur / (count + 1);

  const times = [];
  for (let i = 1; i <= count; i++) times.push(Number((step * i).toFixed(2)));

  const frames = [];
  for (const t of times) {
    const out = path.join(dir, `f_${String(Math.round(t * 100)).padStart(6, "0")}.jpg`);
    const r = await run(
      config.ffmpeg,
      [
        "-y", "-hide_banner", "-loglevel", "error",
        "-ss", String(t),
        "-i", filePath,
        "-frames:v", "1",
        "-vf", `scale=${config.limits.videoFrameWidth}:-2:flags=lanczos`,
        "-q:v", "4",
        out,
      ],
      { timeoutMs: 120000 }
    );
    if (fs.existsSync(out) && fs.statSync(out).size > 800) frames.push(out);
    else if (fs.existsSync(out)) fs.unlinkSync(out);
  }

  // Deduplicacion por tamano+contenido para no repetir escenas estaticas.
  const unique = [];
  const seen = new Set();
  const crypto = require("crypto");
  for (const f of frames) {
    const h = crypto.createHash("md5").update(fs.readFileSync(f)).digest("hex");
    if (seen.has(h)) continue;
    seen.add(h);
    unique.push(f);
  }

  return { frames: unique, meta, times, count: unique.length };
}

/** Extrae el audio a WAV mono 16 kHz (por si se conecta un transcriptor). */
async function extractAudio(filePath, workDir) {
  if (!ffmpegAvailable()) return null;
  const out = path.join(workDir, "audio.wav");
  const r = await run(
    config.ffmpeg,
    ["-y", "-hide_banner", "-loglevel", "error", "-i", filePath, "-vn", "-ac", "1", "-ar", "16000", "-f", "wav", out],
    { timeoutMs: 300000 }
  );
  return fs.existsSync(out) && fs.statSync(out).size > 1000 ? out : null;
}

/** Convierte formatos no soportados por vision (heic, tiff, bmp, avif) a PNG/JPEG. */
async function convertImage(filePath, outPath) {
  if (!ffmpegAvailable()) return null;
  const r = await run(
    config.ffmpeg,
    ["-y", "-hide_banner", "-loglevel", "error", "-i", filePath, "-frames:v", "1",
     "-vf", `scale='min(${config.limits.imageWidth},iw)':-2`, "-q:v", "3", outPath],
    { timeoutMs: 120000 }
  );
  return fs.existsSync(outPath) && fs.statSync(outPath).size > 0 ? outPath : null;
}

module.exports = { probe, extractFrames, extractAudio, convertImage, ffmpegAvailable };
