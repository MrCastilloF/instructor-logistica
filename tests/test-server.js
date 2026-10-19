"use strict";
/**
 * Prueba del flujo web completo: arranca el servidor, sube archivos por HTTP
 * (multipart) con instrucciones y comprueba progreso + resultado.
 * Uso: node tests/test-server.js [--llm]
 */
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const PORT = Number(process.env.TEST_PORT || 5699);
const BASE = `http://127.0.0.1:${PORT}`;
const FIX = path.join(__dirname, "fixtures");
const conLlm = process.argv.includes("--llm");

function esperarServidor(timeoutMs = 20000) {
  const t0 = Date.now();
  return new Promise((resolve, reject) => {
    const tick = async () => {
      try {
        const r = await fetch(BASE + "/api/estado");
        if (r.ok) return resolve(await r.json());
      } catch {
        /* aun no escucha */
      }
      if (Date.now() - t0 > timeoutMs) return reject(new Error("El servidor no respondio a tiempo"));
      setTimeout(tick, 300);
    };
    tick();
  });
}

async function subir(file, { instrucciones = "", archivoInstr = null, contexto = "" } = {}) {
  // Reintenta ante fallos de red transitorios (puertos efimeros, antivirus, etc.).
  let ultimoError;
  for (let intento = 1; intento <= 3; intento++) {
    try {
      const fd = new FormData();
      const buf = fs.readFileSync(file);
      fd.append("documento", new Blob([buf]), path.basename(file));
      if (instrucciones) fd.append("instruccionesTexto", instrucciones);
      if (archivoInstr) fd.append("instruccionesArchivo", new Blob([fs.readFileSync(archivoInstr)]), path.basename(archivoInstr));
      if (contexto) fd.append("contexto", contexto);

      const r = await fetch(BASE + "/api/evaluar", { method: "POST", body: fd });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || "fallo al subir");
      return data.jobId;
    } catch (e) {
      ultimoError = e;
      if (intento < 3) await new Promise((s) => setTimeout(s, 1500 * intento));
    }
  }
  throw ultimoError;
}

async function seguir(jobId, { maxMs = 600000 } = {}) {
  const eventos = [];
  const t0 = Date.now();
  const res = await fetch(`${BASE}/api/progreso?job=${jobId}`);
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  let fin = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const partes = buf.split("\n\n");
    buf = partes.pop();
    for (const p of partes) {
      const m = p.match(/^data: (.*)$/m);
      if (!m) continue;
      let ev;
      try {
        ev = JSON.parse(m[1]);
      } catch {
        continue;
      }
      eventos.push(ev);
      if (ev.stage === "finish") fin = "finish";
      if (ev.stage === "error") {
        fin = "error";
        reader.cancel().catch(() => {});
        return { eventos, error: ev.message };
      }
    }
    if (Date.now() - t0 > maxMs) {
      reader.cancel().catch(() => {});
      return { eventos, error: "tiempo agotado esperando progreso" };
    }
  }
  return { eventos, fin };
}

async function resultado(jobId) {
  const r = await fetch(`${BASE}/api/resultado/${jobId}`);
  return r.json();
}

(async () => {
  console.log("Arrancando servidor de prueba en el puerto", PORT, "...");
  const srv = spawn(process.execPath, [path.join(__dirname, "..", "lib", "server.js")], {
    env: { ...process.env, PORT: String(PORT), NO_OPEN: "1" },
    stdio: ["ignore", "ignore", "ignore"],
    detached: false,
  });

  let fallos = 0;
  try {
    const estado = await esperarServidor();
    console.log("Servidor listo. Modelo:", estado.modelo, "| clave:", estado.claveConfigurada, "| ffmpeg:", estado.ffmpeg);

    // 1) Estaticos
    const html = await fetch(BASE + "/");
    const texto = await html.text();
    console.log(`\n[1] Pagina principal: ${html.status} (${texto.length} bytes) ${texto.includes("Instructor de Logística") ? "OK" : "FALLA"}`);
    if (!texto.includes("Instructor de Logística")) fallos++;

    for (const f of ["/estilos.css", "/app.js"]) {
      const r = await fetch(BASE + f);
      console.log(`[2] ${f}: ${r.status} ${r.ok ? "OK" : "FALLA"}`);
      if (!r.ok) fallos++;
    }

    // 2) Validaciones de entrada
    const vacio = await fetch(BASE + "/api/evaluar", {
      method: "POST",
      headers: { "Content-Type": "multipart/form-data; boundary=x" },
      body: "--x--",
    });
    console.log(`[3] Sin documento: ${vacio.status} ${vacio.status === 400 ? "OK" : "FALLA"}`);
    if (vacio.status !== 400) fallos++;

    const noExiste = await fetch(BASE + "/api/resultado/noexiste");
    console.log(`[4] Trabajo inexistente: ${noExiste.status} ${noExiste.status === 404 ? "OK" : "FALLA"}`);
    if (noExiste.status !== 404) fallos++;

    const traversal = await fetch(BASE + "/../lib/config.js");
    console.log(`[5] Traversal de rutas: ${traversal.status} ${traversal.status === 404 || traversal.status === 403 ? "OK" : "FALLA"}`);
    if (traversal.status !== 404 && traversal.status !== 403) fallos++;

    // 3) Subida real de cada fixture
    const fixtures = fs.readdirSync(FIX).map((f) => path.join(FIX, f));
    const extra = [
      "C:\\Users\\Usuario\\Documents\\_probe\\fixtures\\informe.pdf",
      "C:\\Users\\Usuario\\Documents\\_probe\\fixtures\\page1.png",
      "C:\\Users\\Usuario\\Documents\\_probe\\fixtures\\proceso.mp4",
    ];
    for (const e of extra) if (fs.existsSync(e)) fixtures.push(e);

    const instrucciones = conLlm
      ? "Evalua con rubrica: claridad (30%), uso de indicadores (40%), plan de accion (30%). Pon nota de 0 a 5."
      : "Revision general del material.";

    for (const f of fixtures) {
      const nombre = path.basename(f);
      process.stdout.write(`\n[6] Subiendo ${nombre} ... `);
      const t0 = Date.now();
      try {
        const jobId = await subir(f, { instrucciones, contexto: "Curso de logistica" });
        const { eventos, error } = await seguir(jobId);
        const r = await resultado(jobId);
        const seg = ((Date.now() - t0) / 1000).toFixed(1);
        const extraccion = eventos.find((e) => e.stage === "extract-done");
        if (error || r.status === "error") {
          console.log(`FALLA (${seg}s): ${error || r.error}`);
          fallos++;
          continue;
        }
        const d = r.result.document;
        console.log(`OK (${seg}s) | ${d.kind} | ${d.textChars} chars | ${d.images} img | ${eventos.length} eventos`);
        if (conLlm) {
          // La lista de verificacion debe llegar siempre al navegador.
          const cl = r.result.checklist;
          if (!cl || !cl.items || !cl.items.length) {
            console.log("    FALLA: no llego la lista de verificacion");
            fallos++;
          } else {
            // El formato puede ser de checklist (columnas) o de puntaje.
            const cols = (cl.columnas || []).map((c) => c.titulo);
            console.log(`    Lista de verificacion: ${cl.items.length} criterios | columnas: ${cols.join(" / ")}`);
            for (const it of cl.items.slice(0, 3)) {
              const marcas = (cl.columnas || [])
                .map((c) => {
                  const v = (it.valores && it.valores[c.clave]) || "";
                  return v ? `${c.titulo}=${v}` : null;
                })
                .filter(Boolean)
                .join(" ");
              console.log(`      - ${String(it.descripcion).slice(0, 60)} :: ${marcas}`);
            }
            if (cl.resumen && cl.resumen.length) {
              console.log("      Resumen: " + cl.resumen.map((x) => `${x.etiqueta}=${x.valor}`).join(" | "));
            }
            if (r.result.feedback.includes("===LISTA_DE_VERIFICACION===")) {
              console.log("    FALLA: la marca del bloque quedo dentro de la retroalimentacion");
              fallos++;
            }
          }
          console.log("    Retroalimentacion (primeras 220 letras):");
          console.log("    " + r.result.feedback.replace(/\s+/g, " ").slice(0, 220) + "...");
        }
      } catch (e) {
        console.log("FALLA:", e.message);
        fallos++;
      }
    }

    // 4) Instrucciones como archivo
    const docx = path.join(FIX, "informe_operaciones.docx");
    if (fs.existsSync(docx)) {
      process.stdout.write("\n[7] Instrucciones subidas como archivo ... ");
      try {
        const jobId = await subir(docx, { archivoInstr: path.join(FIX, "notas_reunion.txt") });
        const { error } = await seguir(jobId);
        const r = await resultado(jobId);
        if (error || r.status === "error") {
          console.log("FALLA:", error || r.error);
          fallos++;
        } else {
          console.log(`OK | instrucciones desde archivo: ${r.result.instructions.fromFile} | ${r.result.instructions.chars} chars`);
        }
      } catch (e) {
        console.log("FALLA:", e.message);
        fallos++;
      }
    }

    // 5) Sin instrucciones (criterio general)
    process.stdout.write("\n[8] Sin instrucciones (criterio general) ... ");
    try {
      const jobId = await subir(path.join(FIX, "notas_reunion.txt"));
      const { error } = await seguir(jobId);
      const r = await resultado(jobId);
      if (error || r.status === "error") {
        console.log("FALLA:", error || r.error);
        fallos++;
      } else {
        console.log(`OK | instrucciones: ${r.result.instructions.chars} chars (esperado 0)`);
        if (r.result.instructions.chars !== 0) fallos++;
      }
    } catch (e) {
      console.log("FALLA:", e.message);
      fallos++;
    }
  } catch (e) {
    console.log("ERROR GENERAL:", e.message);
    fallos++;
  } finally {
    srv.kill();
  }

  console.log(`\n================ ${fallos === 0 ? "TODO OK" : fallos + " FALLO(S)"} ================`);
  process.exit(fallos ? 1 : 0);
})();
