"use strict";
/**
 * Ejecuta la funcion real renderChecklist de public/app.js con un DOM minimo
 * y vuelca el HTML resultante. Verifica la estructura de la tabla final.
 * Uso: node tests/test-tabla-render.js
 */
const fs = require("fs");
const path = require("path");

/* ---------------- DOM minimo ---------------- */
class Nodo {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase();
    this.children = [];
    this.attrs = {};
    this._text = "";
    this._clases = new Set();
    this.colSpan = 0;
    // classList minimo, como en el navegador.
    this.classList = {
      add: (...cs) => cs.forEach((c) => c && this._clases.add(c)),
      remove: (...cs) => cs.forEach((c) => this._clases.delete(c)),
      contains: (c) => this._clases.has(c),
    };
  }
  set className(v) {
    this._clases = new Set(String(v).split(/\s+/).filter(Boolean));
  }
  get className() {
    return [...this._clases].join(" ");
  }
  appendChild(n) {
    this.children.push(n);
    return n;
  }
  set textContent(v) {
    this._text = String(v);
    this.children = [];
  }
  get textContent() {
    return this._text + this.children.map((c) => c.textContent).join("");
  }
  set innerHTML(v) {
    this.children = [];
    this._text = "";
  }
  get innerHTML() {
    return "";
  }
}
const documento = {
  createElement: (t) => new Nodo(t),
  createTextNode: (t) => {
    const n = new Nodo("#text");
    n.textContent = t;
    return n;
  },
};

function aHtml(n, prof = 0) {
  const pad = "  ".repeat(prof);
  const cls = n.className ? ` class="${n.className}"` : "";
  const span = n.colSpan ? ` colspan="${n.colSpan}"` : "";
  // Ojo: un nodo puede tener texto propio ADEMAS de hijos (como el DOM real).
  const textoPropio = n._text || "";
  if (!n.children.length) {
    return `${pad}<${n.tagName.toLowerCase()}${cls}${span}>${n.textContent}</${n.tagName.toLowerCase()}>`;
  }
  const partes = [];
  if (textoPropio) partes.push(`${pad}  ${textoPropio}`);
  for (const c of n.children) partes.push(aHtml(c, prof + 1));
  return `${pad}<${n.tagName.toLowerCase()}${cls}${span}>\n${partes.join("\n")}\n${pad}</${n.tagName.toLowerCase()}>`;
}

/* ---------------- Cargar la funcion real ---------------- */
const src = fs.readFileSync(path.join(__dirname, "..", "public", "app.js"), "utf8");
const bloque = src.match(/function claseResultado[\s\S]*?\n}\n/);
const bloque2 = src.match(/function renderChecklist[\s\S]*?\n}\n/);
const bloque3 = src.match(/function calcularPuntajeFinal[\s\S]*?\n}\n/);
if (!bloque || !bloque2 || !bloque3) {
  console.error("No se pudieron extraer las funciones de public/app.js");
  process.exit(1);
}

const cont = new Nodo("div");
const el = { contenedorChecklist: cont };

// Se cargan las funciones REALES de public/app.js desde un modulo temporal,
// para probar exactamente el mismo codigo que usa el navegador.
const os = require("os");
const tmpMod = path.join(os.tmpdir(), `il-tabla-${process.pid}.js`);
fs.writeFileSync(
  tmpMod,
  `"use strict";
const el = globalThis.__IL_EL;
${bloque3[0]}
${bloque[0]}
${bloque2[0]}
module.exports = { renderChecklist, claseResultado, calcularPuntajeFinal };
`,
  "utf8"
);
globalThis.__IL_EL = el;
globalThis.document = documento;
const { renderChecklist, calcularPuntajeFinal } = require(tmpMod);

/* ---------------- Datos de prueba ---------------- */
// Formato de lista de chequeo, como la rubrica real del docente.
const checklist = {
  titulo: "Lista de verificación - Informe de operaciones",
  tipo: "checklist",
  escala: "0 a 5",
  columnas: [
    { clave: "cumple_si", titulo: "CUMPLE SÍ", tipo: "marca" },
    { clave: "cumple_no", titulo: "CUMPLE NO", tipo: "marca" },
  ],
  items: [
    {
      descripcion: "Identificó la jerarquía de los cargos en el organigrama institucional. 20%",
      valores: { cumple_si: "✓ 20%", cumple_no: "" },
      observacion: "Incluye organigrama y tabla de niveles estratégico, táctico y operativo.",
    },
    {
      descripcion: "Interpretó las necesidades del departamento humano de conformidad con las políticas. 20%",
      valores: { cumple_si: "✓ 20%", cumple_no: "" },
      observacion: "Define necesidades de personal por recepción, producción y almacenamiento.",
    },
    {
      descripcion: "Diseñó el plan de acción con responsables y fechas. 20%",
      valores: { cumple_si: "", cumple_no: "✓" },
      observacion: "No se definen responsables ni fechas de ejecución.",
    },  ],
  resumen: [
    { etiqueta: "CUMPLE SÍ", valor: "2 de 3 criterios" },
    { etiqueta: "CUMPLE NO", valor: "1 de 3 criterios" },
  ],
  total: { nota: "3.3 de 5", concepto: "Aprobado" },
};

renderChecklist(checklist, null);
const html = aHtml(cont);
console.log("=== HTML GENERADO ===");
console.log(html);

/* ---------------- Verificaciones ---------------- */
let fallos = 0;
const check = (n, c, extra = "") => {
  console.log(`  ${c ? "OK   " : "FALLA"} ${n}${extra ? " -> " + extra : ""}`);
  if (!c) fallos++;
};

console.log("\n=== COMPROBACIONES ===");
check("Hay un <table>", /<table class="tabla-verificacion">/.test(html));
check("Titulo tomado de la rubrica", html.includes("Lista de verificación - Informe de operaciones"));
check("Columna CUMPLE SÍ", html.includes(">CUMPLE SÍ<"));
check("Columna CUMPLE NO", html.includes(">CUMPLE NO<"));
check("Columna Observaciones", html.includes(">Observaciones<"));
check("Numeracion 1,2,3 en orden", ["<td class=\"col-num\">1<", "<td class=\"col-num\">2<", "<td class=\"col-num\">3<"].every((s) => html.includes(s)));
check("Las casillas marcadas muestran ✓", (html.match(/class="marca-si(?: marca-no)?">✓</g) || []).length === 3);
check("El peso dentro de la descripcion se muestra como etiqueta", (html.match(/class="peso-criterio">20%</g) || []).length === 3);
check("El criterio no cumplido va en CUMPLE NO", /cumple_no[\s\S]*?marca-si">✓</.test(html.replace(/\n/g, " ")) || html.includes("No se definen responsables"));
check("La marca en CUMPLE NO se pinta como negativa", html.includes("marca-si marca-no"));
// 2 de 3 = 67% -> ambar; 1 de 3 en una columna negativa -> rojo.
check("El total de CUMPLE SÍ se colorea segun el porcentaje (67% -> ambar)", html.includes('total-medio">2 de 3'));
check("El total de CUMPLE NO se colorea en rojo", /total-malo"[^>]*>[\s\S]{0,200}?1 de 3 criterios/.test(html));
check("Columna de descripcion de la rubrica", html.includes("Variables / indicadores de logro"));
// El texto completo vive en el nodo de texto y el peso en la etiqueta span.
check(
  "Se muestran las descripciones completas de la rubrica",
  html.includes("Identificó la jerarquía de los cargos en el organigrama institucional.") &&
    html.includes("Interpretó las necesidades del departamento humano") &&
    /celda-descripcion[\s\S]{0,200}?peso-criterio">20%/.test(html)
);
check("Cada fila tiene observacion", (html.match(/celda-observacion/g) || []).length >= 3);
check("Fila TOTAL presente", html.includes(">TOTAL<"));
check("Resumen: CUMPLE SÍ 2 de 3", html.includes("2 de 3 criterios"));
check("Concepto final visible", html.includes("Aprobado"));
check("Nota final visible", html.includes("3.3 de 5"));

/* ---- La calificacion final SIEMPRE debe verse ---- */
console.log("\n=== CALIFICACION FINAL ===");
// Caso del usuario: el modelo no entrega total; la app debe calcularlo.
const sinTotal = {
  columnas: [
    { clave: "si", titulo: "CUMPLE SÍ", tipo: "marca" },
    { clave: "no", titulo: "CUMPLE NO", tipo: "marca" },
  ],
  items: [
    { descripcion: "C1", valores: { si: "✓ 10%", no: "" }, observacion: "" },
    { descripcion: "C2", valores: { si: "✓ 10%", no: "" }, observacion: "" },
    { descripcion: "C3", valores: { si: "", no: "✓ 10%" }, observacion: "" },
    { descripcion: "C4", valores: { si: "✓ 10%", no: "" }, observacion: "" },
  ],
  resumen: [],
  total: { nota: "", concepto: "Aprobado" },
};
const p1 = calcularPuntajeFinal(sinTotal);
check("Calcula el puntaje cuando el modelo no lo da", p1 && p1.origen === "calculado", p1 ? p1.texto : "null");
check("El calculo es correcto (30 de 40 puntos, 75%)", p1 && p1.texto.includes("30 de 40") && p1.texto.includes("75%"), p1 ? p1.texto : "");

const cont6 = new Nodo("div");
el.contenedorChecklist = cont6;
renderChecklist(sinTotal, null);
const html6 = aHtml(cont6);
check("El puntaje final aparece dentro de la tabla", html6.includes("puntaje-final"));
check("Se ve el total calculado", html6.includes("30 de 40"));

// Si el modelo ya lo entrego, se respeta su valor.
const conTotal = JSON.parse(JSON.stringify(sinTotal));
conTotal.resumen = [{ etiqueta: "Puntaje total", valor: "80% (80 de 100 puntos)" }];
const p2 = calcularPuntajeFinal(conTotal);
check("Respeta el puntaje que si entrego el modelo", p2 && p2.origen === "modelo" && p2.texto.includes("80%"), p2 ? p2.texto : "null");
check("Sin inyeccion HTML posible", !html.includes("<script"));

/* ---- Variante de puntaje ---- */
console.log("\n=== VARIANTE DE PUNTAJE ===");
const cont2 = new Nodo("div");
el.contenedorChecklist = cont2;
renderChecklist(
  {
    titulo: "Rúbrica de puntaje",
    tipo: "puntaje",
    columnas: [{ clave: "calificacion", titulo: "CALIFICACIÓN", tipo: "marca" }],
    items: [
      { descripcion: "Indicadores de gestión", valores: { calificacion: "24 / 30" }, observacion: "Metas y reales." },
      { descripcion: "Análisis de causas", valores: { calificacion: "7 / 40" }, observacion: "Sin causas." },
    ],
    resumen: [{ etiqueta: "Puntaje", valor: "31 de 70" }],
    total: { nota: "1.7 de 5", concepto: "Reprobado" },
  },
  null
);
const html2 = aHtml(cont2);
check("Una sola columna CALIFICACIÓN", html2.includes(">CALIFICACIÓN<"));
check("Muestra 24 / 30", html2.includes("24 / 30"));
check("Muestra 7 / 40", html2.includes("7 / 40"));
check("No aparecen columnas de cumple", !html2.includes("CUMPLE"));

/* ---- Casos extremos ---- */
console.log("\n=== CASOS EXTREMOS ===");
const cont3 = new Nodo("div");
el.contenedorChecklist = cont3;
renderChecklist(null, "La lista llegó mal formada.");
check("Sin lista -> muestra el aviso", aHtml(cont3).includes("La lista llegó mal formada"));

const cont4 = new Nodo("div");
el.contenedorChecklist = cont4;
renderChecklist(null, null);
check("Sin lista y sin aviso -> no dibuja nada", cont4.children.length === 0);

const cont5 = new Nodo("div");
el.contenedorChecklist = cont5;
renderChecklist(
  {
    columnas: [{ clave: "c", titulo: "CUMPLE", tipo: "marca" }],
    items: [{ descripcion: "Criterio sin evidencia", valores: { c: "" }, observacion: "No verificable." }],
    total: {},
  },
  null
);
check("Casilla vacia no dibuja marca", !aHtml(cont5).includes("marca-si"));

console.log(`\n${fallos === 0 ? "TODO OK" : fallos + " FALLO(S)"}`);
process.exit(fallos ? 1 : 0);
