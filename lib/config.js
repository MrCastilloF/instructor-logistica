"use strict";
/**
 * Configuracion central de la aplicacion.
 * Lee la clave de DeepSeek (o compatible OpenAI) desde:
 *   1. Variable de entorno (DEEPSEEK_API_KEY / OPENAI_API_KEY)
 *   2. Archivo data/config.json
 *   3. Credenciales del arnes DSH (~/.dsh/.credentials.yaml)
 */
const os = require("os");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const DATA = path.join(ROOT, "data");
const UPLOADS = path.join(DATA, "uploads");
const TMP = path.join(DATA, "tmp");
const VENDOR = path.join(ROOT, "vendor");

for (const d of [DATA, UPLOADS, TMP]) fs.mkdirSync(d, { recursive: true });

function readConfigFile() {
  try {
    return JSON.parse(fs.readFileSync(path.join(DATA, "config.json"), "utf8"));
  } catch {
    return {};
  }
}

function fromDshCredentials() {
  const candidates = [
    path.join(os.homedir(), ".dsh", ".credentials.yaml"),
    path.join(process.env.DSH_HOME || "", ".credentials.yaml"),
  ].filter(Boolean);
  for (const f of candidates) {
    try {
      const txt = fs.readFileSync(f, "utf8");
      const m = txt.match(/^\s*DEEPSEEK_API_KEY\s*:\s*(\S+)\s*$/m);
      if (m) return m[1];
    } catch {
      /* ignorar */
    }
  }
  return "";
}

const fileCfg = readConfigFile();

const config = {
  root: ROOT,
  data: DATA,
  uploads: UPLOADS,
  tmp: TMP,
  vendor: VENDOR,
  port: Number(process.env.PORT || fileCfg.port || 5599),
  host: process.env.HOST || "127.0.0.1",
  apiUrl: process.env.DEEPSEEK_API_URL || fileCfg.apiUrl || "https://api.deepseek.com/chat/completions",
  model: process.env.DEEPSEEK_MODEL || fileCfg.model || "deepseek-flash",
  apiKey:
    process.env.DEEPSEEK_API_KEY ||
    process.env.OPENAI_API_KEY ||
    fileCfg.apiKey ||
    fromDshCredentials(),
  ffmpeg: process.env.FFMPEG_PATH || fileCfg.ffmpeg || path.join(VENDOR, "bin", "ffmpeg.exe"),
  limits: {
    uploadBytes: 300 * 1024 * 1024, // 300 MB
    maxPages: 120, // paginas de PDF a analizar
    // Cupo total de imagenes por evaluacion. El servicio de IA admite 24;
    // se deja un margen para combinaciones de paginas + figuras + imagenes.
    maxImages: 22,
    maxImagenesIncrustadas: 16, // imagenes dentro de Word/PPT/Excel
    maxPaginas: 14, // paginas de PDF convertidas a imagen
    maxVideoFrames: 18,
    maxTextChars: 120000,
    // Resolucion de las paginas de documento enviadas al modelo. Debe ser
    // suficiente para que el texto impreso se lea con nitidez.
    pageMaxWidth: 1650,
    imageWidth: 1800,
    videoFrameWidth: 768,
    pageQuality: 0.9,
  },
};

module.exports = config;
