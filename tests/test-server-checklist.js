"use strict";
/**
 * Verifica que la lista de verificacion llegue al navegador por el servidor.
 * Uso: node tests/test-server-checklist.js
 */
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const PORT = 5713;
const BASE = `http://127.0.0.1:${PORT}`;

(async () => {
  const srv = spawn(process.execPath, [path.join(__dirname, "..", "lib", "server.js")], {
    env: { ...process.env, PORT: String(PORT), NO_OPEN: "1" },
    stdio: ["ignore", "ignore", "ignore"],
  });

  let fallos = 0;
  const check = (n, c, extra = "") => {
    console.log(`  ${c ? "OK   " : "FALLA"} ${n}${extra ? " -> " + extra : ""}`);
    if (!c) fallos++;
  };

  try {
    // esperar arranque
    for (let i = 0; i < 40; i++) {
      try {
        if ((await fetch(BASE + "/api/estado")).ok) break;
      } catch {}
      await new Promise((s) => setTimeout(s, 300));
    }

    // la pagina debe cargar el contenedor de la tabla
    const html = await (await fetch(BASE + "/")).text();
    check("La pagina incluye el contenedor de la lista", html.includes('id="contenedorChecklist"'));

    const appjs = await (await fetch(BASE + "/app.js")).text();
    check("app.js incluye renderChecklist", appjs.includes("renderChecklist"));
    check("app.js incluye el titulo 'Lista de verificación'", appjs.includes("Lista de verificación"));
    const css = await (await fetch(BASE + "/estilos.css")).text();
    check("estilos.css incluye .tabla-verificacion", css.includes(".tabla-verificacion"));

    // evaluacion real
    console.log("\nEnviando documento (1-2 min)...");
    const fd = new FormData();
    fd.append("documento", new Blob([fs.readFileSync(path.join(__dirname, "fixtures", "informe_operaciones.docx"))]), "informe_operaciones.docx");
    fd.append(
      "instruccionesTexto",
      "Evalua con rubrica: 1) Indicadores de gestion 30%. 2) Analisis de causas 40%. 3) Plan de accion 30%. Pon nota de 0 a 5."
    );
    const r = await fetch(BASE + "/api/evaluar", { method: "POST", body: fd });
    const { jobId } = await r.json();
    check("La subida se acepta", r.status === 202 && Boolean(jobId));

    let res = null;
    for (let i = 0; i < 100; i++) {
      await new Promise((s) => setTimeout(s, 3000));
      const d = await (await fetch(`${BASE}/api/resultado/${jobId}`)).json();
      if (d.status === "listo") {
        res = d.result;
        break;
      }
      if (d.status === "error") {
        console.log("  ERROR del servidor:", d.error);
        fallos++;
        break;
      }
    }

    if (!res) {
      check("Llego el resultado", false);
    } else {
      check("El resultado trae la retroalimentacion", typeof res.feedback === "string" && res.feedback.length > 300, res.feedback.length + " caracteres");
      check("El resultado trae la lista de verificacion", Boolean(res.checklist), res.checklist ? res.checklist.items.length + " criterios" : "ninguna");
      const tieneCampos =
        res.checklist &&
        Array.isArray(res.checklist.columnas) &&
        res.checklist.columnas.length > 0 &&
        res.checklist.items.every((i) => i.descripcion && i.valores && Object.keys(i.valores).length);
      check("La lista tiene columnas, criterios y valores", Boolean(tieneCampos));
      check("El texto NO contiene la marca del bloque", !res.feedback.includes("===LISTA_DE_VERIFICACION==="));
      check("El texto NO contiene JSON", !/"items"/.test(res.feedback));

      if (res.checklist) {
        console.log("\n  Tabla recibida por el navegador:");
        const c = res.checklist;
        const cols = ["No.", ...c.columnas.map((x) => x.titulo), "Observaciones"];
        console.log("  " + cols.join(" | "));
        for (const it of c.items) {
          console.log("  " + [it.descripcion.slice(0, 40), ...c.columnas.map((x) => (it.valores && it.valores[x.clave]) || ""), (it.observacion || "").slice(0, 30)].join(" | "));
        }
        if (c.resumen && c.resumen.length) console.log("  RESUMEN: " + c.resumen.map((x) => `${x.etiqueta}=${x.valor}`).join(" | "));
        console.log("  TOTAL: " + JSON.stringify(c.total));

        /* ---- Renderizado real con el codigo de la interfaz ---- */
        const render = require("./render-helper");
        const html = render(res.checklist);
        check("El HTML de la tabla se genera", html.includes("tabla-verificacion"));
        check("Se ve la calificacion final en la tabla", html.includes("puntaje-final"));
        const m = html.match(/puntaje-final[^>]*>([^<]+)</);
        console.log("  Calificación final mostrada: " + (m ? m[1] : "(no se encontro)"));
        check("La calificacion final no esta vacia", Boolean(m && m[1].trim()));
        check("Las columnas de la rubrica se respetan", c.columnas.every((x) => html.includes(x.titulo)));
      }
    }
  } catch (e) {
    console.log("ERROR GENERAL:", e.message);
    fallos++;
  } finally {
    srv.kill();
  }

  console.log(`\n${fallos === 0 ? "TODO OK" : fallos + " FALLO(S)"}`);
  process.exit(fallos ? 1 : 0);
})();
