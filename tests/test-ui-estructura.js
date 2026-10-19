"use strict";
/**
 * Prueba de estructura y UI del rediseno (sin navegador y sin dependencias).
 *
 * Lee public/index.html, public/estilos.css y public/app.js y comprueba lo que
 * exige docs/contrato-ui.md: IDs obligatorios (una sola vez), estado inicial de
 * paneles y botones, referencias versionadas, ausencia de recursos externos,
 * accesibilidad basica, clases CSS de la tabla de verificacion y textos reales.
 *
 * Uso: node tests/test-ui-estructura.js
 * Sale con codigo 1 si alguna comprobacion falla.
 */
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const RAIZ = path.join(__dirname, "..");
const RUTA_HTML = path.join(RAIZ, "public", "index.html");
const RUTA_CSS = path.join(RAIZ, "public", "estilos.css");
const RUTA_JS = path.join(RAIZ, "public", "app.js");

let fallos = 0;
let comprobaciones = 0;

function check(nombre, condicion, extra = "") {
  comprobaciones++;
  console.log(`  ${condicion ? "OK   " : "FALLA"} ${nombre}${extra ? " -> " + extra : ""}`);
  if (!condicion) fallos++;
}
function info(texto) {
  console.log(`  INFO  ${texto}`);
}
function seccion(titulo) {
  console.log(`\n=== ${titulo} ===`);
}

/* -------------------------- Utilidades de lectura -------------------------- */

const escaparRe = (texto) => String(texto).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Cuenta cuantas veces aparece `id="..."` en el HTML. */
function contarId(html, id) {
  const re = new RegExp(`\\bid\\s*=\\s*(["'])${escaparRe(id)}\\1`, "g");
  return (html.match(re) || []).length;
}

/** Devuelve la etiqueta de apertura que contiene `id="..."` (o ""). */
function etiquetaConId(html, id) {
  const re = new RegExp(`<[^>]*\\bid\\s*=\\s*(["'])${escaparRe(id)}\\1[^>]*>`, "i");
  const m = html.match(re);
  return m ? m[0] : "";
}

/** true si la etiqueta tiene el atributo booleano indicado. */
function tieneAtributo(etiqueta, nombre) {
  if (!etiqueta) return false;
  return new RegExp(`\\s${escaparRe(nombre)}(?=[\\s=/>])`, "i").test(etiqueta);
}

/** Todos los valores de un atributo (src, href...) del texto. */
function valoresDeAtributo(texto, nombre) {
  const re = new RegExp(`\\b${escaparRe(nombre)}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "gi");
  const valores = [];
  let m;
  while ((m = re.exec(texto))) valores.push(m[1] !== undefined ? m[1] : m[2]);
  return valores;
}

/** true si la URL es absoluta/remota (http, https o //). */
function esRemoto(valor) {
  return /^\s*(?:https?:)?\/\//i.test(String(valor || ""));
}

/** Texto que ve el usuario: quita etiquetas, comentarios y decodifica entidades. */
function textoVisible(html) {
  return String(html)
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&nbsp;/gi, " ")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
}

const normalizar = (texto) => String(texto || "").replace(/\s+/g, " ").trim();

/* ------------------------------- Archivos -------------------------------- */

let HTML = "";
let CSS = "";
let JS = "";
try {
  HTML = fs.readFileSync(RUTA_HTML, "utf8");
  CSS = fs.readFileSync(RUTA_CSS, "utf8");
  JS = fs.readFileSync(RUTA_JS, "utf8");
} catch (e) {
  console.log("ERROR GENERAL: no se pudieron leer los archivos de public/: " + e.message);
  process.exit(1);
}

seccion("Archivos estaticos");
check("public/index.html tiene contenido", HTML.length > 5000, HTML.length + " caracteres");
check("public/estilos.css tiene contenido", CSS.length > 5000, CSS.length + " caracteres");
check("public/app.js tiene contenido", JS.length > 5000, JS.length + " caracteres");
const conEncodingRoto = Object.entries({ "index.html": HTML, "estilos.css": CSS, "app.js": JS })
  .filter(([, texto]) => texto.includes("\uFFFD") || texto.includes("\u00C3\u00A9") || texto.includes("\u00C3\u00B3"))
  .map(([nombre]) => nombre);
check("Los archivos son UTF-8 sin caracteres corruptos", conEncodingRoto.length === 0, conEncodingRoto.join(", "));

/* -------------------- 1. IDs obligatorios del contrato -------------------- */

seccion("IDs obligatorios (docs/contrato-ui.md)");
const IDS_CONTRATO = [
  // Estado del servicio
  "estadoServicio",
  "puntoEstado",
  "textoEstado",
  // Paso 1 - documento
  "zonaDocumento",
  "archivoDocumento",
  "archivoElegido",
  "archivoIcono",
  "archivoNombre",
  "archivoMeta",
  "quitarArchivo",
  // Paso 2 - instrucciones
  "instruccionesTexto",
  "archivoInstrucciones",
  "chipInstrucciones",
  "chipInstruccionesNombre",
  "quitarInstrucciones",
  "contexto",
  // Acciones
  "botonEvaluar",
  "botonLimpiar",
  // Progreso
  "panelProgreso",
  "barraRelleno",
  "progresoMensaje",
  "progresoLista",
  // Error
  "panelError",
  "textoError",
  // Resultado
  "panelResultado",
  "resultadoTexto",
  "contenedorChecklist",
  "resultadoDetalles",
  "botonCopiar",
  "botonDescargar",
];
for (const id of IDS_CONTRATO) {
  const veces = contarId(HTML, id);
  check(`#${id} aparece exactamente una vez`, veces === 1, veces === 0 ? "no encontrado" : veces + " veces");
}
const conteoIds = new Map();
for (const m of HTML.matchAll(/\bid\s*=\s*(["'])([^"']+)\1/g)) {
  const id = m[2];
  conteoIds.set(id, (conteoIds.get(id) || 0) + 1);
}
const idsDuplicados = [...conteoIds.entries()].filter(([, n]) => n > 1).map(([id, n]) => `${id} (${n})`);
check("No hay IDs duplicados en el documento", idsDuplicados.length === 0, idsDuplicados.join(", "));

/* ------------------- 2. Estado inicial de paneles y botones ---------------- */

seccion("Estado inicial de la interfaz");
for (const id of ["panelProgreso", "panelError", "panelResultado", "archivoElegido", "chipInstrucciones"]) {
  const etiqueta = etiquetaConId(HTML, id);
  check(`#${id} empieza oculto con el atributo hidden`, tieneAtributo(etiqueta, "hidden"), etiqueta ? "" : "no encontrado");
}
check("#botonEvaluar empieza con el atributo disabled", tieneAtributo(etiquetaConId(HTML, "botonEvaluar"), "disabled"));

for (const id of ["archivoDocumento", "archivoInstrucciones"]) {
  const etiqueta = etiquetaConId(HTML, id);
  const esInputFile = /^<input\b/i.test(etiqueta) && /\btype\s*=\s*["']file["']/i.test(etiqueta);
  check(`#${id} es un <input type="file">`, esInputFile);
  check(`#${id} empieza oculto (hidden)`, tieneAtributo(etiqueta, "hidden"));
  check(`#${id} declara accept con .pdf`, /\baccept\s*=\s*["'][^"']*\.pdf/i.test(etiqueta));
}
const etiquetaTextarea = etiquetaConId(HTML, "instruccionesTexto");
check("#instruccionesTexto es un <textarea>", /^<textarea\b/i.test(etiquetaTextarea));
const etiquetaContexto = etiquetaConId(HTML, "contexto");
check("#contexto es un <input type=\"text\">", /^<input\b/i.test(etiquetaContexto) && /\btype\s*=\s*["']text["']/i.test(etiquetaContexto));
check("#contexto esta dentro de un <details>", /<details\b[\s\S]*?\bid\s*=\s*["']contexto["'][\s\S]*?<\/details>/i.test(HTML));

/* ------------------ 3. Referencias versionadas y metadatos ---------------- */

seccion("Referencias versionadas y metadatos");
const refCss = HTML.match(/\/estilos\.css\?v=(\d+)/);
check("Referencia /estilos.css?v=6", Boolean(refCss) && refCss[1] === "6", refCss ? "v=" + refCss[1] : "no encontrada");
const refJs = HTML.match(/\/app\.js\?v=(\d+)/);
check("Referencia /app.js?v=6", Boolean(refJs) && refJs[1] === "6", refJs ? "v=" + refJs[1] : "no encontrada");
check('El documento declara lang="es"', /<html\b[^>]*\blang\s*=\s*["']es["']/i.test(HTML));
check("El documento declara charset UTF-8", /<meta\b[^>]*\bcharset\s*=\s*["']?utf-8/i.test(HTML));
const metas = [...HTML.matchAll(/<meta\b[^>]*>/gi)].map((m) => m[0]);
const metaViewport = metas.find((t) => /\bname\s*=\s*["']viewport["']/i.test(t));
check("Declara meta viewport para movil", Boolean(metaViewport) && /width=device-width/i.test(metaViewport));
const metaDescription = metas.find((t) => /\bname\s*=\s*["']description["']/i.test(t));
const contenidoDescription = metaDescription
  ? (metaDescription.match(/\bcontent\s*=\s*["']([^"']*)["']/i) || [])[1] || ""
  : "";
check("Declara meta description con contenido real", Boolean(metaDescription) && contenidoDescription.length >= 60, contenidoDescription.length + " caracteres");
check("<title> incluye el nombre de la aplicacion", /<title>[^<]*Instructor de Logística[^<]*<\/title>/i.test(HTML));
check("<noscript> avisa que se necesita JavaScript", /<noscript>[\s\S]*?JavaScript[\s\S]*?<\/noscript>/i.test(HTML));

/* ---------------------- 4. Sin recursos externos ------------------------- */

seccion("Funcionamiento offline (sin recursos externos)");
const EXTERNOS_PERMITIDOS = new Set(["https://github.com/MrCastilloF/instructor-logistica"]);
const externos = [];
for (const nombre of ["src", "href", "srcset"]) {
  for (const valor of valoresDeAtributo(HTML, nombre)) {
    if (esRemoto(valor) && !EXTERNOS_PERMITIDOS.has(valor.trim())) externos.push(`${nombre}="${valor}"`);
  }
}
check("index.html no carga recursos externos", externos.length === 0, externos.slice(0, 6).join(" | "));
const urlsHtml = [...HTML.matchAll(/url\(\s*(['"]?)([^)'"]*)\1\s*\)/gi)].map((m) => m[2]);
check("index.html no usa url() remotas", !urlsHtml.some(esRemoto), urlsHtml.filter(esRemoto).join(" | "));
const urlsCss = [...CSS.matchAll(/url\(\s*(['"]?)([^)'"]*)\1\s*\)/gi)].map((m) => m[2]);
check("estilos.css no usa url() remotas", !urlsCss.some(esRemoto), urlsCss.filter(esRemoto).join(" | "));
const importsCss = [...CSS.matchAll(/@import\s+([^;]+);/gi)].map((m) => normalizar(m[1]));
check("estilos.css no importa hojas externas (@import)", !importsCss.some(esRemoto), importsCss.join(" | "));
check("No usa fuentes de Google", !/fonts\.(googleapis|gstatic)\.com/i.test(HTML + CSS));
check("El footer conserva el enlace al repositorio de GitHub", HTML.includes("https://github.com/MrCastilloF/instructor-logistica"));

/* -------------------------- 5. Accesibilidad ----------------------------- */

seccion("Accesibilidad basica");
const etiquetasFor = [...HTML.matchAll(/<label\b[^>]*\bfor\s*=\s*["']([^"']+)["']/gi)].map((m) => m[1]);
check("Hay etiquetas <label for>", etiquetasFor.length >= 3, etiquetasFor.join(", "));
const etiquetasRotas = [...new Set(etiquetasFor)].filter((id) => contarId(HTML, id) !== 1);
check("Cada <label for> apunta a un id existente", etiquetasRotas.length === 0, etiquetasRotas.join(", "));
for (const id of ["instruccionesTexto", "contexto", "archivoInstrucciones"]) {
  check(`#${id} tiene un <label> asociado`, etiquetasFor.includes(id));
}
check("El progreso anuncia cambios (aria-live)", tieneAtributo(etiquetaConId(HTML, "progresoMensaje"), "aria-live"));
check(
  "El estado del servicio anuncia cambios (aria-live)",
  tieneAtributo(etiquetaConId(HTML, "estadoServicio"), "aria-live") || tieneAtributo(etiquetaConId(HTML, "textoEstado"), "aria-live")
);
const enlaceSaltar = HTML.match(/<a\b[^>]*href\s*=\s*["']#contenido["'][^>]*>([\s\S]*?)<\/a>/i);
check(
  "Enlace 'Saltar al contenido' antes de <main>",
  Boolean(enlaceSaltar) && enlaceSaltar.index < HTML.indexOf("<main") && /saltar/i.test(textoVisible(enlaceSaltar[1]))
);
const zonaDocumento = etiquetaConId(HTML, "zonaDocumento");
check("#zonaDocumento es un control accesible (role=button)", /\brole\s*=\s*["']button["']/i.test(zonaDocumento));
check("#zonaDocumento se puede enfocar (tabindex=0)", /\btabindex\s*=\s*["']0["']/i.test(zonaDocumento));
check("#zonaDocumento tiene aria-label", /\baria-label\s*=\s*["'][^"']+["']/i.test(zonaDocumento));
const botones = [...HTML.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/gi)];
const botonesSinTexto = botones.filter(
  (m) => !textoVisible(m[2]) && !/\baria-label\s*=\s*["'][^"']+["']/i.test(m[1])
);
check(
  "Todos los botones tienen texto visible o aria-label",
  botones.length >= 5 && botonesSinTexto.length === 0,
  `${botones.length} botones` + (botonesSinTexto.length ? "; sin texto: " + botonesSinTexto.map((m) => m[1].slice(0, 60)).join(" | ") : "")
);
const textoBoton = (id) => {
  const m = HTML.match(new RegExp(`<button\\b[^>]*\\bid\\s*=\\s*["']${escaparRe(id)}["'][^>]*>([\\s\\S]*?)<\\/button>`, "i"));
  return m ? normalizar(textoVisible(m[1])) : "";
};
check('#botonEvaluar dice "Evaluar mi trabajo"', /evaluar mi trabajo/i.test(textoBoton("botonEvaluar")), textoBoton("botonEvaluar"));
check('#botonLimpiar dice "Limpiar todo"', /limpiar todo/i.test(textoBoton("botonLimpiar")), textoBoton("botonLimpiar"));
check('#botonCopiar dice "Copiar"', /copiar/i.test(textoBoton("botonCopiar")), textoBoton("botonCopiar"));
check('#botonDescargar dice "Descargar"', /descargar/i.test(textoBoton("botonDescargar")), textoBoton("botonDescargar"));
const anclas = [...new Set([...HTML.matchAll(/href\s*=\s*["']#([^"']+)["']/gi)].map((m) => m[1]).filter(Boolean))];
const anclasRotas = anclas.filter((id) => contarId(HTML, id) !== 1);
check("Los enlaces internos (#ancla) apuntan a secciones existentes", anclasRotas.length === 0, anclasRotas.join(", "));
const referenciasAria = [
  ...new Set([...HTML.matchAll(/\baria-labelledby\s*=\s*["']([^"']+)["']/gi)].flatMap((m) => m[1].split(/\s+/))),
].filter(Boolean);
const referenciasRotas = referenciasAria.filter((id) => contarId(HTML, id) !== 1);
check("Los aria-labelledby apuntan a ids existentes", referenciasRotas.length === 0, referenciasRotas.join(", "));

/* ------------------------------ 6. CSS ----------------------------------- */

seccion("Hoja de estilos");
for (const selector of [".tabla-verificacion", ".marca-si", ".total-bien", ".total-medio", ".total-malo", ".puntaje-final", ".checklist"]) {
  check(`El CSS define ${selector}`, CSS.includes(selector));
}
check("El CSS respeta prefers-reduced-motion", /prefers-reduced-motion/.test(CSS));
const variablesCss = [...new Set([...CSS.matchAll(/--([a-z][a-z0-9-]*)\s*:/gi)].map((m) => m[1]))];
check("El CSS define variables (custom properties)", variablesCss.length >= 8, variablesCss.length + " variables");
check("El CSS usa var(--...)", /var\(\s*--/.test(CSS));
const mediaQueries = (CSS.match(/@media\b/g) || []).length;
check("El CSS es responsive (media queries)", mediaQueries >= 3, mediaQueries + " @media");
check("El CSS usa clamp() para escalar", /clamp\(/.test(CSS));
check("El CSS usa grid o flexbox", /display\s*:\s*(grid|flex)/.test(CSS));
const CLASES_TABLA = [
  "col-num",
  "col-centro",
  "celda-descripcion",
  "celda-observacion",
  "marca-no",
  "marca-vacia",
  "marca-valor",
  "peso-criterio",
  "chip-resultado",
  "vc-bien",
  "vc-medio",
  "vc-malo",
  "vc-neutro",
  "celda-total",
  "celda-total-etiqueta",
  "checklist-titulo",
  "checklist-escala",
  "checklist-resumen",
  "checklist-aviso",
  "nota-final",
  "calculado",
];
const clasesTablaFaltan = CLASES_TABLA.filter((clase) => !CSS.includes("." + clase));
check("El CSS cubre las clases de la tabla de verificacion", clasesTablaFaltan.length === 0, clasesTablaFaltan.join(", "));

/* ------------------------------- 7. JS ----------------------------------- */

seccion("Logica del navegador (public/app.js)");
const revision = spawnSync(process.execPath, ["--check", RUTA_JS], { encoding: "utf8" });
check(
  "node --check public/app.js (sintaxis valida)",
  revision.status === 0,
  revision.status === 0 ? "" : (revision.stderr || "").split(/\r?\n/).slice(0, 3).join(" ")
);
const TOKENS_JS = [
  "EventSource",
  "/api/evaluar",
  "/api/progreso",
  "/api/resultado",
  "/api/estado",
  "FormData",
  "calcularPuntajeFinal",
  "renderChecklist",
  "checklistComoTexto",
];
for (const token of TOKENS_JS) check(`app.js contiene ${token}`, JS.includes(token));
for (const funcion of ["calcularPuntajeFinal", "claseResultado", "renderChecklist"]) {
  check(`function ${funcion} es de nivel superior`, new RegExp(`^function\\s+${funcion}\\s*\\(`, "m").test(JS));
}
check("app.js conserva checklist.columnas (tabla dinamica)", JS.includes("checklist.columnas"));
check("app.js conserva la clase tabla-verificacion", JS.includes("tabla-verificacion"));
check("app.js usa EventSource para el progreso", /new EventSource/.test(JS));
check("app.js usa FormData para la subida", /new FormData/.test(JS));

const usosInnerHtml = JS.split(/\r?\n/)
  .map((linea, indice) => ({ n: indice + 1, texto: linea.trim() }))
  .filter((x) => /\.innerHTML\b/.test(x.texto));
info(`innerHTML se usa en ${usosInnerHtml.length} linea(s)${usosInnerHtml.length ? ": " + usosInnerHtml.map((x) => x.n).join(", ") : ""}`);
for (const uso of usosInnerHtml) info(`linea ${uso.n}: ${uso.texto.slice(0, 130)}`);
const asignacionesInnerHtml = [...JS.matchAll(/\.innerHTML\s*=\s*([\s\S]{0,800}?);/g)].map((m) => m[1]);
const innerHtmlConFeedback = asignacionesInnerHtml.filter(
  (valor) => /feedback/i.test(valor) && !/escapar\s*\(/.test(valor)
);
check(
  "No se inyecta la retroalimentacion con innerHTML sin escapar",
  innerHtmlConFeedback.length === 0,
  innerHtmlConFeedback.map((v) => normalizar(v).slice(0, 90)).join(" | ")
);
check("Los errores se muestran con textContent", /textoError\.textContent\s*=/.test(JS));
check(
  "La retroalimentacion se pinta con textContent",
  /function\s+renderRetroalimentacion/.test(JS) && /contenedor\.textContent\s*=/.test(JS)
);

/* ------------------------- 8. Textos reales ------------------------------- */

seccion("Textos reales del producto");
const VISIBLE = textoVisible(HTML);
const TEXTO = normalizar(VISIBLE);
const TEXTOS_CLAVE = [
  ["nombre de la aplicacion", "Instructor de Logística"],
  ["lema del hero", "Sube tu trabajo y recibe retroalimentación como de un instructor real"],
  ["boton principal", "Evaluar mi trabajo"],
  ["nota de privacidad del footer", "Funciona en tu equipo"],
];
for (const [nombre, texto] of TEXTOS_CLAVE) {
  check(`La pagina incluye "${nombre}"`, TEXTO.includes(texto), texto);
}
check(
  'Menciona los formatos ("PDF (incluye escaneados)")',
  /pdf \(incluye escaneados\)/i.test(TEXTO) || (/pdf/i.test(TEXTO) && /escanead/i.test(TEXTO))
);
check(
  "Explica la lista de verificacion y las casillas Cumple / No cumple",
  /lista de verificaci[oó]n/i.test(TEXTO) && /cumple\s*s[íi]/i.test(TEXTO) && /cumple\s*no/i.test(TEXTO)
);
for (const bloque of ["Qué observé", "Lo que está bien", "Lo que hay que mejorar", "Recomendaciones", "Cierre"]) {
  check(`Incluye el bloque "${bloque}"`, TEXTO.includes(bloque));
}
check(
  "El textarea conserva el placeholder de la rubrica original",
  /placeholder\s*=\s*["'][\s\S]*?30%[\s\S]*?40%[\s\S]*?30%[\s\S]*?0 a 5/i.test(etiquetaTextarea)
);

/* -------------------------------- Resumen -------------------------------- */

console.log(`\n${fallos === 0 ? "TODO OK" : fallos + " FALLO(S)"} (${comprobaciones} comprobaciones)`);
process.exit(fallos ? 1 : 0);
