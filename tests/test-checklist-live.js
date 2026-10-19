"use strict";
/**
 * Prueba real: verifica que el modelo entregue la lista de verificacion
 * y que quede bien separada del texto.
 * Uso: node tests/test-checklist-live.js [ruta/al/archivo]
 */
const fs = require("fs");
const path = require("path");
const { extract } = require("../lib/extract");
const { evaluate, MARCA_INICIO, MARCA_FIN } = require("../lib/llm");

const archivo = process.argv[2] || path.join(__dirname, "fixtures", "informe_operaciones.docx");

const INSTRUCCIONES = `Evalúa el documento con la siguiente lista de verificación (marque CUMPLE SÍ o CUMPLE NO según corresponda).
Cada criterio tiene un valor del 20%.

No. | Variables/indicadores de logro | CUMPLE SÍ | CUMPLE NO | Observaciones

1. Identificó la jerarquía de los cargos en el organigrama institucional. 20%
2. Interpretó las necesidades del departamento humano de conformidad con las políticas de la organización. 20%
3. Diseñó el plan de acción con responsables, fechas y forma de medición. 20%
4. Reconoció la importancia del factor humano en el cumplimiento de las metas establecidas por la organización. 20%
5. Utilizó herramientas para generar motivación en el área de desempeño a través de incentivos en función de los resultados. 20%

Al final indique el total de criterios cumplidos y una nota de 0 a 5.`;

(async () => {
  console.log("Archivo:", path.basename(archivo));
  const { content, kindLabel } = await extract(archivo, path.basename(archivo), path.join(require("../lib/config").tmp, "cl-live"), () => {});
  console.log("Extraccion:", kindLabel, "|", content.textChars, "caracteres de texto\n");

  const r = await evaluate({
    instructions: INSTRUCCIONES,
    content,
    onProgress: (e) => console.log("   ·", e.message),
  });

  console.log("\n=== TEXTO DE LA RETROALIMENTACION (final) ===");
  const t = r.text;
  console.log(t.slice(-420));

  console.log("\n=== COMPROBACIONES ===");
  let fallos = 0;
  const check = (nombre, cond, extra = "") => {
    console.log(`  ${cond ? "OK   " : "FALLA"} ${nombre}${extra ? " -> " + extra : ""}`);
    if (!cond) fallos++;
  };

  check("La marca de inicio NO quedo en el texto", !t.includes(MARCA_INICIO));
  check("La marca de fin NO quedo en el texto", !t.includes(MARCA_FIN));
  check("El texto no contiene JSON crudo", !/"items"\s*:/.test(t));
  check("El texto no tiene tablas markdown", !t.includes("|"));
  check("Hay lista de verificacion", Boolean(r.checklist), r.checklist ? r.checklist.items.length + " criterios" : "ninguna");
  check("La lista trae items", Boolean(r.checklist && r.checklist.items.length >= 3));
  check("El texto conserva la retroalimentacion", t.length > 400, t.length + " caracteres");

  if (r.checklist) {
    console.log("\n=== DATOS CRUDOS ===");
    console.log(JSON.stringify(r.checklist, null, 2));

    console.log("\n=== TABLA QUE VERIA EL USUARIO ===");
    const c = r.checklist;
    const cols = ["No.", ...c.columnas.map((x) => x.titulo), "Observaciones"];
    const filas = c.items.map((it, i) => [
      String(i + 1),
      ...c.columnas.map((x) => (it.valores && it.valores[x.clave]) || ""),
      (it.observacion || "").slice(0, 60),
    ]);
    const ancho = cols.map((h, i) => Math.max(h.length, ...filas.map((f) => String(f[i] || "").length)));
    const linea = (f) => f.map((v, i) => String(v || "").padEnd(ancho[i])).join(" | ");
    console.log(linea(cols));
    console.log(ancho.map((a) => "-".repeat(a)).join("-+-"));
    for (const f of filas) console.log(linea(f));
    if (c.escala) console.log("\nEscala:", c.escala);
    if (c.resumen && c.resumen.length) {
      console.log("Resumen:", c.resumen.map((x) => `${x.etiqueta}: ${x.valor}`).join(" | "));
    }
    console.log("Total:", JSON.stringify(c.total));

    /* --- Validaciones del formato de lista de chequeo --- */
    const titulos = c.columnas.map((x) => x.titulo.toUpperCase());
    const tieneCumpleSi = titulos.some((t) => /CUMPLE\s*S[IÍ]/.test(t));
    const tieneCumpleNo = titulos.some((t) => /CUMPLE\s*NO/.test(t));
    check("Hay columna CUMPLE SÍ", tieneCumpleSi, titulos.join(" / "));
    check("Hay columna CUMPLE NO", tieneCumpleNo);
    check("Un item por cada criterio de la rubrica (5)", c.items.length === 5, c.items.length + " items");

    // Cada item debe tener exactamente una casilla marcada.
    const marcas = c.items.map((it) => c.columnas.filter((x) => /[✓✔☑]/.test(it.valores[x.clave] || "")).length);
    check("Cada criterio tiene una sola casilla marcada", marcas.every((m) => m === 1), marcas.join(","));

    // Las descripciones deben venir de la rubrica, no inventadas.
    const juntas = c.items.map((i) => i.descripcion.toLowerCase()).join(" ");
    check("Conserva la redaccion de la rubrica", /jerarqu/.test(juntas) && /organigrama/.test(juntas));
    check("Todos los criterios traen observacion", c.items.every((i) => i.observacion));

    // El total debe cuadrar con las marcas del modelo.
    const idxSi = c.columnas.findIndex((x) => /CUMPLE\s*S[IÍ]/i.test(x.titulo));
    const marcadosSi = c.items.filter((it) => /[✓✔☑]/.test(it.valores[c.columnas[idxSi].clave] || "")).length;
    const resumenSi = (c.resumen || []).find((x) => /CUMPLE\s*S[IÍ]/i.test(x.etiqueta));
    if (resumenSi) {
      check(
        "El resumen coincide con las casillas marcadas",
        resumenSi.valor.includes(String(marcadosSi)),
        `marcados=${marcadosSi}, resumen="${resumenSi.valor}"`
      );
    } else {
      console.log("  (el modelo no entrego resumen de CUMPLE SÍ)");
    }
  }

  console.log(`\n${fallos === 0 ? "TODO OK" : fallos + " FALLO(S)"}`);
  process.exit(fallos ? 1 : 0);
})().catch((e) => {
  console.error("ERROR:", e.message);
  process.exit(1);
});
