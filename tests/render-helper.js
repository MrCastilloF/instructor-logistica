"use strict";
/**
 * Ejecuta las funciones REALES de public/app.js (renderChecklist) sobre datos
 * de una evaluacion y devuelve el HTML resultante. Sirve para verificar en
 * Node lo que el navegador dibujaria.
 *
 * Uso: const html = require("./render-helper")(checklist, aviso);
 */
const fs = require("fs");
const os = require("os");
const path = require("path");

/* ---------------- DOM minimo fiel ---------------- */
class Nodo {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase();
    this.children = [];
    this._text = "";
    this._clases = new Set();
    this.colSpan = 0;
    this.title = "";
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

function aHtml(n, prof = 0) {
  const pad = "  ".repeat(prof);
  const cls = n.className ? ` class="${n.className}"` : "";
  const span = n.colSpan ? ` colspan="${n.colSpan}"` : "";
  if (!n.children.length) {
    return `${pad}<${n.tagName.toLowerCase()}${cls}${span}>${n.textContent}</${n.tagName.toLowerCase()}>`;
  }
  const partes = [];
  if (n._text) partes.push(`${pad}  ${n._text}`);
  for (const c of n.children) partes.push(aHtml(c, prof + 1));
  return `${pad}<${n.tagName.toLowerCase()}${cls}${span}>\n${partes.join("\n")}\n${pad}</${n.tagName.toLowerCase()}>`;
}

/* ---------------- Carga de las funciones reales ---------------- */
let cacheMod = null;
function cargarFunciones() {
  if (cacheMod) return cacheMod;
  const src = fs.readFileSync(path.join(__dirname, "..", "public", "app.js"), "utf8");
  const trozos = [
    src.match(/function calcularPuntajeFinal[\s\S]*?\n}\n/),
    src.match(/function claseResultado[\s\S]*?\n}\n/),
    src.match(/function renderChecklist[\s\S]*?\n}\n/),
  ];
  if (trozos.some((t) => !t)) throw new Error("No se pudieron extraer las funciones de public/app.js");

  globalThis.document = {
    createElement: (t) => new Nodo(t),
    createTextNode: (t) => {
      const n = new Nodo("#text");
      n.textContent = t;
      return n;
    },
  };
  globalThis.__IL_EL = { contenedorChecklist: new Nodo("div") };

  const tmp = path.join(os.tmpdir(), `il-render-${process.pid}.js`);
  fs.writeFileSync(
    tmp,
    `"use strict";
const el = globalThis.__IL_EL;
${trozos[0][0]}
${trozos[1][0]}
${trozos[2][0]}
module.exports = { renderChecklist, claseResultado, calcularPuntajeFinal };
`,
    "utf8"
  );
  cacheMod = require(tmp);
  return cacheMod;
}

/**
 * @param {object} checklist datos del resultado
 * @param {string|null} aviso mensaje de error de la lista
 * @returns {string} HTML de la tabla
 */
module.exports = function render(checklist, aviso = null) {
  const { renderChecklist } = cargarFunciones();
  const cont = new Nodo("div");
  globalThis.__IL_EL.contenedorChecklist = cont;
  renderChecklist(checklist, aviso);
  return aHtml(cont);
};
