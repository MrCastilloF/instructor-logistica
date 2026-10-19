"use strict";
/**
 * Verifica que el servidor entregue SIEMPRE la version actual del programa
 * (sin cache) y que la pagina pida las versiones nuevas de los archivos.
 * Uso: node tests/test-version-servida.js
 */
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const PORT = 5717;
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
    for (let i = 0; i < 40; i++) {
      try {
        if ((await fetch(BASE + "/api/estado")).ok) break;
      } catch {}
      await new Promise((s) => setTimeout(s, 300));
    }

    // 1) La pagina referencia versiones nuevas (evita cache vieja).
    const html = await (await fetch(BASE + "/")).text();
    check("La pagina pide app.js con version", /\/app\.js\?v=\d+/.test(html), (html.match(/\/app\.js\?v=\d+/) || [])[0]);
    check("La pagina pide estilos.css con version", /\/estilos\.css\?v=\d+/.test(html));

    // 2) El servidor prohibe el cache.
    const r = await fetch(BASE + "/app.js?v=5");
    const cc = r.headers.get("cache-control") || "";
    check("app.js se sirve sin cache", /no-store/.test(cc), cc);

    const rcss = await fetch(BASE + "/estilos.css?v=5");
    check("estilos.css se sirve sin cache", /no-store/.test(rcss.headers.get("cache-control") || ""));

    // 3) El contenido servido es el ACTUAL en disco (no una copia vieja).
    const servido = await r.text();
    const enDisco = fs.readFileSync(path.join(__dirname, "..", "public", "app.js"), "utf8");
    check("app.js servido = app.js en disco", servido === enDisco, `${servido.length} vs ${enDisco.length} bytes`);

    const cssServido = await rcss.text();
    const cssDisco = fs.readFileSync(path.join(__dirname, "..", "public", "estilos.css"), "utf8");
    check("estilos.css servido = en disco", cssServido === cssDisco);

    // 4) El programa servido sabe dibujar la tabla nueva.
    check("Incluye soporte de columnas dinamicas", servido.includes("checklist.columnas"));
    check("Incluye la tabla de verificacion", servido.includes("tabla-verificacion"));
    check("Incluye el calculo del puntaje final", servido.includes("calcularPuntajeFinal"));
    const cssOk = cssServido.includes(".tabla-verificacion") && cssServido.includes(".marca-si");
    check("El CSS incluye los estilos de la tabla", cssOk);

    // 5) El backend tiene los respaldos.
    const llm = fs.readFileSync(path.join(__dirname, "..", "lib", "llm.js"), "utf8");
    check("Backend: respaldo de tabla Markdown", llm.includes("extraerTablaMarkdown"));
    check("Backend: respaldo de lista en parrafos", llm.includes("extraerListaEnProsa"));
  } catch (e) {
    console.log("ERROR GENERAL:", e.message);
    fallos++;
  } finally {
    srv.kill();
  }

  console.log(`\n${fallos === 0 ? "TODO OK" : fallos + " FALLO(S)"}`);
  process.exit(fallos ? 1 : 0);
})();
