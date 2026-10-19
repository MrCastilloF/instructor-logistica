"use strict";
/**
 * Ejecucion de procesos externos (ffmpeg) compatible con el sandbox de DSH:
 * las tuberias (stdio: 'pipe') estan bloqueadas con EPERM, pero la
 * redireccion a archivos SI funciona. Por eso capturamos stdout/stderr
 * en archivos temporales y los leemos despues.
 */
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

function run(cmd, args, { timeoutMs = 300000, cwd } = {}) {
  return new Promise((resolve) => {
    const id = crypto.randomBytes(6).toString("hex");
    const dir = path.join(require("./config").tmp, "proc");
    fs.mkdirSync(dir, { recursive: true });
    const outFile = path.join(dir, id + ".out");
    const errFile = path.join(dir, id + ".err");
    const outFd = fs.openSync(outFile, "w");
    const errFd = fs.openSync(errFile, "w");

    let child;
    try {
      child = spawn(cmd, args, { stdio: ["ignore", outFd, errFd], cwd });
    } catch (e) {
      fs.closeSync(outFd);
      fs.closeSync(errFd);
      return resolve({ code: -1, stdout: "", stderr: "spawn: " + e.message, failed: true });
    }

    let done = false;
    const finish = (code, note) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try {
        child.kill();
      } catch {
        /* ya termino */
      }
      fs.closeSync(outFd);
      fs.closeSync(errFd);
      const read = (f) => {
        try {
          return fs.readFileSync(f, "utf8");
        } catch {
          return "";
        }
      };
      const stdout = read(outFile);
      const stderr = read(errFile) + (note ? "\n" + note : "");
      try {
        fs.unlinkSync(outFile);
        fs.unlinkSync(errFile);
      } catch {
        /* limpieza best-effort */
      }
      resolve({ code, stdout, stderr, failed: code !== 0 });
    };

    const timer = setTimeout(() => finish(-1, `\n[tiempo agotado tras ${timeoutMs} ms]`), timeoutMs);
    child.on("error", (e) => finish(-1, "error de proceso: " + e.message));
    child.on("close", (code) => finish(code === null ? -1 : code));
  });
}

function available(bin) {
  return Boolean(bin) && fs.existsSync(bin);
}

module.exports = { run, available };
