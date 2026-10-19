"use strict";
/**
 * Instructor de Logística — lógica de la interfaz (public/app.js).
 *
 * Aplicación local, sin frameworks, sin dependencias y 100 % offline.
 * Este archivo solo habla con el backend local (lib/server.js):
 *
 *   POST   /api/evaluar            (multipart)  -> { jobId }
 *   GET    /api/progreso?job=...   (SSE)        -> eventos { stage, message }
 *   GET    /api/resultado/<jobId>               -> { status, result }
 *   GET    /api/estado                          -> estado del servicio/modelo
 *
 * Organización del archivo:
 *   1. Referencias al DOM.
 *   2. Utilidades generales (tamaños, iconos, mostrar/ocultar, escape).
 *   3. Retroalimentación: detecta los títulos reales y los muestra con estilo.
 *   4. Lista de verificación (tabla): funciones de nivel superior que también
 *      extraen las pruebas automáticas (calcularPuntajeFinal, claseResultado y
 *      renderChecklist). No deben cambiar de nombre, firma ni clases CSS.
 *   5. Lista de verificación como texto alineado (para Copiar / Descargar).
 *   6. Aplicación (IIFE): estado, eventos, evaluación, progreso, resultado y
 *      vigilancia del servicio.
 *
 * Reglas funcionales que se conservan del diseño original:
 *   - El documento es el único requisito para evaluar.
 *   - Las instrucciones pueden ser texto, archivo o ambas; el contexto es opcional.
 *   - Si se corta el canal SSE se consulta el resultado directamente.
 *   - Un fallo de red se explica como "la aplicación se cerró".
 *   - La retroalimentación en crudo sigue disponible para Copiar y Descargar.
 */

/* =====================================================================
   1. Referencias al DOM
   ===================================================================== */
const $ = (id) => document.getElementById(id);

const el = {
  zona: $("zonaDocumento"),
  inputDoc: $("archivoDocumento"),
  elegido: $("archivoElegido"),
  nombre: $("archivoNombre"),
  meta: $("archivoMeta"),
  icono: $("archivoIcono"),
  quitar: $("quitarArchivo"),
  instruccionesTexto: $("instruccionesTexto"),
  inputInstrucciones: $("archivoInstrucciones"),
  chip: $("chipInstrucciones"),
  chipNombre: $("chipInstruccionesNombre"),
  quitarInstrucciones: $("quitarInstrucciones"),
  contexto: $("contexto"),
  evaluar: $("botonEvaluar"),
  limpiar: $("botonLimpiar"),
  panelProgreso: $("panelProgreso"),
  barra: $("barraRelleno"),
  progresoMensaje: $("progresoMensaje"),
  progresoLista: $("progresoLista"),
  panelError: $("panelError"),
  textoError: $("textoError"),
  panelResultado: $("panelResultado"),
  resultadoTexto: $("resultadoTexto"),
  resultadoDetalles: $("resultadoDetalles"),
  copiar: $("botonCopiar"),
  descargar: $("botonDescargar"),
  contenedorChecklist: $("contenedorChecklist"),
  puntoEstado: $("puntoEstado"),
  textoEstado: $("textoEstado"),
};

/* =====================================================================
   2. Utilidades generales
   ===================================================================== */

/**
 * Convierte un tamaño en bytes a una etiqueta legible (B, KB, MB, GB).
 * @param {number} bytes
 * @returns {string}
 */
function humano(bytes) {
  if (!bytes && bytes !== 0) return "";
  const unidades = ["B", "KB", "MB", "GB"];
  let i = 0;
  let n = bytes;
  while (n >= 1024 && i < unidades.length - 1) {
    n /= 1024;
    i++;
  }
  // Sin decimales en bytes o cuando el número es grande; un decimal si no.
  return `${n.toFixed(n >= 10 || i === 0 ? 0 : 1)} ${unidades[i]}`;
}

/** Emoji que representa cada familia de archivos admitidos. */
const ICONO_POR_EXTENSION = {
  pdf: "📕",
  doc: "📘",
  docx: "📘",
  docm: "📘",
  odt: "📘",
  rtf: "📘",
  xls: "📗",
  xlsx: "📗",
  xlsm: "📗",
  ods: "📗",
  csv: "📗",
  tsv: "📗",
  ppt: "📙",
  pptx: "📙",
  ppsx: "📙",
  odp: "📙",
  png: "🖼️",
  jpg: "🖼️",
  jpeg: "🖼️",
  webp: "🖼️",
  gif: "🖼️",
  bmp: "🖼️",
  tif: "🖼️",
  tiff: "🖼️",
  heic: "🖼️",
  avif: "🖼️",
  mp4: "🎬",
  mov: "🎬",
  avi: "🎬",
  mkv: "🎬",
  webm: "🎬",
  wmv: "🎬",
  flv: "🎬",
  m4v: "🎬",
  mpeg: "🎬",
  mpg: "🎬",
  "3gp": "🎬",
  txt: "📄",
  md: "📄",
  log: "📄",
  json: "📄",
  xml: "📄",
  html: "📄",
  htm: "📄",
  srt: "📄",
  vtt: "📄",
};

/**
 * Devuelve el icono (emoji) según la extensión del archivo.
 * @param {string} nombre
 * @returns {string}
 */
function iconoDe(nombre) {
  const ext = (String(nombre || "").split(".").pop() || "").toLowerCase();
  return ICONO_POR_EXTENSION[ext] || "📁";
}

/**
 * Muestra u oculta un panel con el atributo `hidden` (nunca con display).
 * @param {HTMLElement} nodo
 * @param {boolean} visible
 */
function mostrar(nodo, visible) {
  nodo.hidden = !visible;
}

/**
 * Escapa texto para poder interpolarlo dentro de HTML con seguridad.
 * @param {unknown} valor
 * @returns {string}
 */
function escapar(valor) {
  return String(valor == null ? "" : valor).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[c]);
}

/* =====================================================================
   3. Retroalimentación escrita
   ===================================================================== */

/**
 * Los títulos reales que el instructor debe usar (con o sin tildes).
 * Se comparan normalizados: minúsculas, sin diacríticos y sin numeración.
 */
const CLAVES_DE_BLOQUE = {
  "que observe": "que-observe",
  "lo que esta bien": "lo-que-esta-bien",
  "lo que hay que mejorar": "lo-que-hay-que-mejorar",
  "recomendaciones": "recomendaciones",
  "cierre": "cierre",
};

/**
 * Quita los diacríticos de un texto para comparar títulos sin depender de
 * si el modelo escribió "Qué observé" o "Que observe".
 * @param {unknown} texto
 * @returns {string}
 */
function sinTildes(texto) {
  return String(texto == null ? "" : texto)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

/**
 * Identifica si una línea es uno de los títulos conocidos de la
 * retroalimentación. Devuelve la clave interna o null.
 * @param {string} linea
 * @returns {string|null}
 */
function claveDeBloqueRetro(linea) {
  const limpio = sinTildes(linea)
    .replace(/^\s*\d+\s*[.)\-–:]\s*/, "") // quita numeración tipo "1. " o "2) "
    .trim()
    .replace(/[:.;]+$/, "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
  return CLAVES_DE_BLOQUE[limpio] || null;
}

/**
 * Pinta la retroalimentación dentro de #resultadoTexto.
 *
 * - Si el texto trae los títulos reales, se agrupa en bloques con su encabezado
 *   para que se lea mejor. Todo se inserta con textContent: el texto del modelo
 *   nunca se interpreta como HTML.
 * - Si no trae esos títulos, se conserva el texto en crudo (el CSS aplica
 *   `white-space: pre-wrap`).
 *
 * El texto original no se modifica: Copiar y Descargar usan el valor crudo de
 * `ultimoResultado.feedback`.
 * @param {string} textoBruto
 */
function renderRetroalimentacion(textoBruto) {
  const contenedor = el.resultadoTexto;
  const texto = String(textoBruto == null ? "" : textoBruto);

  // Limpiar el contenedor sin innerHTML.
  contenedor.textContent = "";
  if (!texto) return;

  const lineas = texto.split(/\r?\n/);
  const hayTitulos = lineas.some((linea) => claveDeBloqueRetro(linea) !== null);

  // Sin títulos reconocibles se mantiene el comportamiento original.
  if (!hayTitulos) {
    contenedor.textContent = texto;
    return;
  }

  let bloque = null; // <section> del bloque actual
  let parrafo = null; // <p> del párrafo en curso

  /** Abre un <section> para el bloque indicado y reinicia el párrafo. */
  const abrirBloque = (clave) => {
    bloque = document.createElement("section");
    bloque.className = "retro-bloque" + (clave ? " retro-bloque--" + clave : "");
    contenedor.appendChild(bloque);
    parrafo = null;
    return bloque;
  };

  /** Añade una línea al párrafo actual (con <br> si ya había texto). */
  const agregarLinea = (linea) => {
    if (!bloque) abrirBloque("intro");
    if (!parrafo) {
      parrafo = document.createElement("p");
      parrafo.className = "retro-parrafo";
      parrafo.textContent = linea;
      bloque.appendChild(parrafo);
      return;
    }
    parrafo.appendChild(document.createElement("br"));
    parrafo.appendChild(document.createTextNode(linea));
  };

  for (const linea of lineas) {
    const clave = claveDeBloqueRetro(linea);
    if (clave) {
      const seccion = abrirBloque(clave);
      const titulo = document.createElement("h3");
      titulo.className = "retro-titulo";
      titulo.textContent = linea.trim();
      seccion.appendChild(titulo);
      continue;
    }
    // Las líneas en blanco separan párrafos.
    if (!linea.trim()) {
      parrafo = null;
      continue;
    }
    agregarLinea(linea);
  }
}

/* =====================================================================
   4. Lista de verificación (tabla)

   IMPORTANTE: tests/test-tabla-render.js extrae por expresión regular las
   funciones `calcularPuntajeFinal`, `claseResultado` y `renderChecklist`, las
   ejecuta con un DOM mínimo y valida la tabla. Por eso:

   - Deben ser funciones de nivel superior y cerrar con `}` en columna 0.
   - Dentro de ellas no se puede usar innerHTML con HTML, querySelector,
     dataset, setAttribute ni otras APIs que ese DOM mínimo no tiene.
   - No deben renombrarse las clases CSS ni cambiar la lógica de totales.
   ===================================================================== */

/**
 * Calcula la calificación final cuando el modelo no la entregó.
 * Si la rúbrica es de casillas, se obtiene del porcentaje de criterios marcados
 * en la columna positiva.
 * @returns {{texto:string, origen:"modelo"|"calculado"}|null}
 */
function calcularPuntajeFinal(checklist) {
  if (!checklist || !checklist.items || !checklist.items.length) return null;
  const items = checklist.items;
  const columnas = checklist.columnas || [];
  const resumen = checklist.resumen || [];
  const total = checklist.total || {};

  // 1) Lo que ya dijo el modelo.
  const rPuntaje = resumen.find(
    (x) => /puntaje|porcentaje|total/i.test(x.etiqueta || "") && /%|\d/.test(x.valor || "")
  );
  if (rPuntaje && rPuntaje.valor) return { texto: rPuntaje.valor, origen: "modelo" };
  if (total.calificacion && total.maximo) return { texto: `${total.calificacion} de ${total.maximo}`, origen: "modelo" };
  if (total.calificacion) return { texto: total.calificacion, origen: "modelo" };
  if (total.nota) return { texto: total.nota, origen: "modelo" };

  // 2) Columna positiva (CUMPLE SÍ / SÍ / APLICA...).
  const positiva = columnas.find(
    (c) => /s[íi]\b|cumple\s*s[íi]|aplica|logrado|aprob/i.test(c.titulo) && !/no\b/i.test(c.titulo)
  );
  if (!positiva) return null;

  const marcados = items.filter((it) => /[✓✔☑]/.test((it.valores && it.valores[positiva.clave]) || "")).length;
  const totalItems = items.length;
  if (!totalItems) return null;

  const pctCriterios = Math.round((marcados / totalItems) * 100);

  /* Si cada criterio trae su valor (por ejemplo 10 %), se calcula el puntaje real.
     El peso puede venir en la columna positiva o en otra columna de la rúbrica. */
  const pesos = items.map((it) => {
    let marcado = false;
    let valor = null;
    for (const c of columnas) {
      const v = (it.valores && it.valores[c.clave]) || "";
      const m = String(v).match(/(\d+(?:[.,]\d+)?)\s*%/);
      if (m) {
        valor = parseFloat(m[1].replace(",", "."));
        if (c.clave === positiva.clave) marcado = /[✓✔☑]/.test(v);
      }
    }
    return { marcado, valor };
  });

  const conValor = pesos.filter((p) => p.valor !== null);
  if (conValor.length === totalItems) {
    const maximo = conValor.reduce((a, p) => a + p.valor, 0);
    const obtenido = conValor.filter((p) => p.marcado).reduce((a, p) => a + p.valor, 0);
    const redondear = (n) => (Number.isInteger(n) ? n : Number(n.toFixed(1)));
    if (maximo > 0) {
      return {
        texto: `${redondear(obtenido)} de ${redondear(maximo)} puntos (${Math.round((obtenido / maximo) * 100)}%)`,
        origen: "calculado",
      };
    }
  }

  return { texto: `${marcados} de ${totalItems} criterios (${pctCriterios}%)`, origen: "calculado" };
}

/**
 * Marca visual de una calificación.
 * Si llegan cifras (obtenido y máximo), se usa el porcentaje alcanzado;
 * si es un concepto ("Cumple", "No cumple"), se interpreta el texto.
 * @param {string} calificacion
 * @param {string|number} [maximo]
 * @returns {"vc-bien"|"vc-medio"|"vc-malo"|"vc-neutro"}
 */
function claseResultado(calificacion, maximo) {
  const texto = String(calificacion || "").toLowerCase();
  if (/no verificable|sin evidencia|ilegible|no se pudo/.test(texto)) return "vc-neutro";

  const num = (v) => {
    const m = String(v == null ? "" : v).replace(",", ".").match(/-?\d+(?:\.\d+)?/);
    return m ? parseFloat(m[0]) : null;
  };
  const obtenido = num(calificacion);
  const tope = num(maximo);
  if (obtenido !== null && tope !== null && tope > 0) {
    const pct = (obtenido / tope) * 100;
    if (pct >= 70) return "vc-bien";
    if (pct >= 50) return "vc-medio";
    return "vc-malo";
  }

  if (/^no\b|no cumple|reprob|deficiente|insuficiente|incumpl|falta|malo|bajo/.test(texto)) return "vc-malo";
  if (/parcial|regular|aceptable|en proceso|medio|incompleto/.test(texto)) return "vc-medio";
  if (/cumple|aprob|excelente|bueno|satisfactorio|alto|si\b|sí\b|logrado|destacado/.test(texto)) return "vc-bien";
  return "vc-neutro";
}

/**
 * Dibuja la lista de verificación como tabla.
 * Las columnas se muestran solo si el modelo aportó esos datos, para que la
 * tabla quede limpia cuando las instrucciones no traen pesos ni máximos.
 * @param {object|null} checklist
 * @param {string|null} aviso
 */
function renderChecklist(checklist, aviso) {
  const cont = el.contenedorChecklist;
  cont.innerHTML = "";

  if (!checklist || !checklist.items || !checklist.items.length) {
    if (aviso) {
      const p = document.createElement("p");
      p.className = "checklist-aviso";
      p.textContent = aviso;
      cont.appendChild(p);
    }
    return;
  }

  const items = checklist.items;
  const total = checklist.total || {};
  const columnas = checklist.columnas || [];

  const caja = document.createElement("section");
  caja.className = "checklist";

  const h = document.createElement("h3");
  h.className = "checklist-titulo";
  h.textContent = checklist.titulo || "Lista de verificación";
  caja.appendChild(h);

  if (checklist.escala) {
    const s = document.createElement("p");
    s.className = "checklist-escala";
    s.textContent = "Escala: " + checklist.escala;
    caja.appendChild(s);
  }

  const tabla = document.createElement("table");
  tabla.className = "tabla-verificacion";

  // Encabezado: N.º | (columnas según la rúbrica) | Observaciones
  const thead = document.createElement("thead");
  const filaH = document.createElement("tr");
  const encabezados = [
    { texto: "No.", clase: "col-num" },
    { texto: checklist.tituloColumna || "Variables / indicadores de logro", clase: "celda-descripcion" },
  ];
  for (const c of columnas) encabezados.push({ texto: c.titulo, clase: "col-centro" });
  encabezados.push({ texto: "Observaciones", clase: "celda-observacion" });
  for (const e of encabezados) {
    const th = document.createElement("th");
    th.textContent = e.texto;
    th.className = e.clase;
    filaH.appendChild(th);
  }
  thead.appendChild(filaH);
  tabla.appendChild(thead);

  // Cuerpo: una fila por criterio.
  const tbody = document.createElement("tbody");
  items.forEach((it, i) => {
    const tr = document.createElement("tr");

    const num = document.createElement("td");
    num.className = "col-num";
    num.textContent = String(i + 1);
    tr.appendChild(num);

    const desc = document.createElement("td");
    desc.className = "celda-descripcion";
    // Si el peso viene dentro del texto del criterio, se muestra atenuado.
    const texto = it.descripcion || "";
    const conPeso = texto.match(/^(.*?)[\s(]*(\d{1,3}\s?%)\)?\s*$/);
    if (conPeso && conPeso[1].trim()) {
      desc.appendChild(document.createTextNode(conPeso[1].trim() + " "));
      const peso = document.createElement("span");
      peso.className = "peso-criterio";
      peso.textContent = conPeso[2];
      desc.appendChild(peso);
    } else {
      desc.textContent = texto;
    }
    tr.appendChild(desc);

    for (const c of columnas) {
      const td = document.createElement("td");
      td.className = "col-centro celda-marca";
      const valor = (it.valores && it.valores[c.clave]) || "";
      // Una casilla marcada en una columna negativa (CUMPLE NO) no es un acierto.
      const columnaNegativa = /\bno\b|rechaz|reprob|deficiente|insuficiente/i.test(c.titulo);
      if (!valor) {
        td.textContent = "";
      } else if (/[✓✔☑]/.test(valor)) {
        // Casilla marcada: se destaca la marca y se conserva el valor anexo (ej. "20%").
        const marca = document.createElement("span");
        marca.className = "marca-si" + (columnaNegativa ? " marca-no" : "");
        marca.textContent = "✓";
        td.appendChild(marca);
        const resto = valor.replace(/[✓✔☑]/g, "").trim();
        if (resto) {
          const extra = document.createElement("span");
          extra.className = "marca-valor";
          extra.textContent = resto;
          td.appendChild(extra);
        }
      } else if (/^(x|X|✗|✘|—|-|n\/a|no aplica)$/.test(valor.trim())) {
        const marca = document.createElement("span");
        marca.className = "marca-vacia";
        marca.textContent = valor.trim() === "x" || valor.trim() === "X" ? "✗" : valor;
        td.appendChild(marca);
      } else {
        const chip = document.createElement("span");
        chip.className = "chip-resultado " + claseResultado(valor);
        chip.textContent = valor;
        td.appendChild(chip);
      }
      tr.appendChild(td);
    }

    const obs = document.createElement("td");
    obs.className = "celda-observacion";
    obs.textContent = it.observacion || "";
    tr.appendChild(obs);

    tbody.appendChild(tr);
  });
  tabla.appendChild(tbody);

  // Pie: totales por columna de marca + calificación final y concepto.
  const hayResumen = Array.isArray(checklist.resumen) && checklist.resumen.length;
  const puntaje = calcularPuntajeFinal(checklist);
  const tieneTotal = total.nota || total.concepto || total.calificacion || puntaje;
  if (hayResumen || tieneTotal) {
    const tfoot = document.createElement("tfoot");
    const tr = document.createElement("tr");

    // El puntaje final se ancla en la última columna de la rúbrica solo cuando
    // esta es una columna de puntaje (una única columna numérica, tipo
    // "CALIFICACIÓN"). En rúbricas de casillas se muestra en Observaciones,
    // junto al concepto, para no quedar dentro de "CUMPLE NO".
    const ultimaColumna = columnas.length ? columnas[columnas.length - 1] : null;
    const rubricaDeCasillas =
      !ultimaColumna ||
      columnas.length > 1 ||
      /no\b|cumple|aplica|logrado|s[íi]\b|aprob/i.test(ultimaColumna.titulo || "");
    const anclarPuntajeEnColumna = Boolean(puntaje) && !rubricaDeCasillas;

    /** Crea el bloque con la calificación final (del modelo o calculada). */
    const crearPuntajeFinal = () => {
      const valor = document.createElement("div");
      valor.className = "puntaje-final" + (puntaje.origen === "calculado" ? " calculado" : "");
      valor.textContent = puntaje.texto;
      if (puntaje.origen === "calculado") {
        valor.title = "Calculado por la aplicación a partir de los criterios marcados.";
      }
      return valor;
    };

    const etiqueta = document.createElement("td");
    // La etiqueta solo abarca No. + descripción; después viene una celda de
    // total por cada columna de la rúbrica y la celda de Observaciones. Así la
    // fila TOTAL tiene exactamente las mismas columnas que el encabezado.
    etiqueta.colSpan = 2;
    etiqueta.className = "celda-total-etiqueta";
    etiqueta.textContent = "TOTAL";
    tr.appendChild(etiqueta);

    // Una celda por columna con su total (viene del resumen del modelo).
    columnas.forEach((c, idx) => {
      const td = document.createElement("td");
      td.className = "col-centro celda-total";
      const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z]/g, "");
      const r = (checklist.resumen || []).find((x) => norm(x.etiqueta) === norm(c.titulo));
      if (r) {
        td.textContent = r.valor;
        // Se colorea el total según la columna: cumplidos en verde, no cumplidos en rojo.
        const m = String(r.valor).match(/(\d+)\s*de\s*(\d+)/i);
        if (m && Number(m[2]) > 0) {
          const negativa = /\bno\b|rechaz|reprob|deficiente|insuficiente/i.test(c.titulo);
          const pct = (Number(m[1]) / Number(m[2])) * 100;
          td.classList.add(
            negativa ? (pct > 0 ? "total-malo" : "total-bien") : pct >= 70 ? "total-bien" : pct >= 50 ? "total-medio" : "total-malo"
          );
        }
      }
      // En rúbricas de puntaje, la calificación final se ancla en esta columna.
      if (idx === columnas.length - 1 && anclarPuntajeEnColumna) {
        td.appendChild(crearPuntajeFinal());
      }
      tr.appendChild(td);
    });

    const cierre = document.createElement("td");
    if (total.concepto) {
      const chip = document.createElement("span");
      chip.className = "chip-resultado " + claseResultado(total.concepto);
      chip.textContent = total.concepto;
      cierre.appendChild(chip);
    }
    // Si el puntaje visible ya es esta misma nota (calcularPuntajeFinal la usó
    // como respaldo), no se repite otra vez.
    if (total.nota && !(puntaje && puntaje.texto === total.nota)) {
      const n = document.createElement("span");
      n.className = "nota-final";
      n.textContent = (total.concepto ? " · " : "") + total.nota;
      cierre.appendChild(n);
    }
    // En rúbricas de casillas la calificación final baja aquí, junto al
    // concepto, en lugar de quedar bajo la última columna de marca.
    if (puntaje && !anclarPuntajeEnColumna) {
      cierre.appendChild(crearPuntajeFinal());
    }
    tr.appendChild(cierre);

    tfoot.appendChild(tr);
    tabla.appendChild(tfoot);
  }

  caja.appendChild(tabla);

  // Resumen en texto (criterios cumplidos, puntajes, etc.).
  if (hayResumen) {
    const ul = document.createElement("ul");
    ul.className = "checklist-resumen";
    for (const r of checklist.resumen) {
      const li = document.createElement("li");
      const et = document.createElement("strong");
      et.textContent = r.etiqueta + ": ";
      li.appendChild(et);
      li.appendChild(document.createTextNode(r.valor));
      ul.appendChild(li);
    }
    caja.appendChild(ul);
  }

  cont.appendChild(caja);
}

/* =====================================================================
   5. Lista de verificación como texto alineado (Copiar / Descargar)
   ===================================================================== */

/**
 * Arma la tabla de verificación como texto alineado por columnas.
 * @param {object|null} checklist
 * @returns {string}
 */
function checklistComoTexto(checklist) {
  if (!checklist || !checklist.items || !checklist.items.length) return "";
  const items = checklist.items;
  const total = checklist.total || {};
  const columnas = checklist.columnas || [];
  const resumen = Array.isArray(checklist.resumen) ? checklist.resumen : [];

  const cab = ["No.", ...columnas.map((c) => c.titulo), "Observaciones"];
  const filas = items.map((it, i) => [
    String(i + 1),
    ...columnas.map((c) => (it.valores && it.valores[c.clave]) || ""),
    it.observacion || "",
  ]);

  // Fila de totales: se alinea con la última columna y con el resumen.
  const filaTotal = ["", "TOTAL", ...columnas.slice(1).map(() => "")];
  const ultima = columnas.length ? columnas[columnas.length - 1] : null;
  if (ultima) {
    const r = resumen.find((x) => x.etiqueta && x.etiqueta.toLowerCase() === ultima.titulo.toLowerCase());
    filaTotal[filaTotal.length - 1] = r ? r.valor : total.nota || total.calificacion || "";
  }
  filaTotal.push(total.concepto || "");
  filas.push(filaTotal);

  const ancho = cab.map((_, c) => Math.max(...filas.map((f) => String(f[c] || "").length), cab[c].length));
  const linea = (f) => f.map((v, c) => String(v || "").padEnd(ancho[c])).join(" | ").trimEnd();
  const sep = ancho.map((a) => "-".repeat(a)).join("-+-");

  const partes = [checklist.titulo || "LISTA DE VERIFICACIÓN"];
  if (checklist.escala) partes.push(`Escala: ${checklist.escala}`);
  partes.push("", linea(cab), sep, ...filas.map(linea));
  if (resumen.length) {
    partes.push("");
    for (const r of resumen) partes.push(`${r.etiqueta}: ${r.valor}`);
  }
  return partes.join("\n");
}

/* =====================================================================
   6. Aplicación
   ---------------------------------------------------------------------
   Todo el estado mutable y el cableado de eventos viven dentro de esta
   IIFE. Las únicas funciones compartidas con el exterior son las
   declaradas arriba (utilidades, tabla y texto), que no guardan estado.
   ===================================================================== */
(function iniciarAplicacion() {
  /* --------------------------- Estado --------------------------- */
  let archivoDoc = null; // File del documento obligatorio
  let archivoInstr = null; // File opcional con las instrucciones
  let fuenteProgreso = null; // EventSource activo (SSE)
  let ultimoResultado = null; // Último resultado recibido (para Copiar/Descargar)

  /* ------------------- Selección de archivos -------------------- */

  /**
   * Fija o quita el documento a evaluar y actualiza la tarjeta visible.
   * @param {File|null} file
   */
  function setDocumento(file) {
    archivoDoc = file || null;
    if (file) {
      el.nombre.textContent = file.name;
      el.meta.textContent = humano(file.size);
      el.icono.textContent = iconoDe(file.name);
      mostrar(el.elegido, true);
      mostrar(el.zona, false);
    } else {
      el.inputDoc.value = "";
      mostrar(el.elegido, false);
      mostrar(el.zona, true);
    }
    actualizarBoton();
  }

  /**
   * Fija o quita el archivo de instrucciones y actualiza el chip visible.
   * @param {File|null} file
   */
  function setInstrucciones(file) {
    archivoInstr = file || null;
    if (file) {
      el.chipNombre.textContent = file.name;
      mostrar(el.chip, true);
    } else {
      el.inputInstrucciones.value = "";
      mostrar(el.chip, false);
    }
    actualizarBoton();
  }

  /** El documento es el único requisito para habilitar la evaluación. */
  function actualizarBoton() {
    el.evaluar.disabled = !archivoDoc;
  }

  /* ----------------------- Zona de arrastre --------------------- */

  // Clic o teclado (Enter / Espacio) abren el selector de archivos.
  el.zona.addEventListener("click", () => el.inputDoc.click());
  el.zona.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      el.inputDoc.click();
    }
  });

  ["dragenter", "dragover"].forEach((ev) =>
    el.zona.addEventListener(ev, (e) => {
      e.preventDefault();
      el.zona.classList.add("arrastrando");
    })
  );
  ["dragleave", "drop"].forEach((ev) =>
    el.zona.addEventListener(ev, (e) => {
      e.preventDefault();
      el.zona.classList.remove("arrastrando");
    })
  );
  el.zona.addEventListener("drop", (e) => {
    const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (f) setDocumento(f);
  });

  // También se puede soltar en cualquier parte de la ventana si aún no hay
  // documento elegido (se evita que el navegador abra el archivo).
  window.addEventListener("dragover", (e) => e.preventDefault());
  window.addEventListener("drop", (e) => {
    e.preventDefault();
    const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (f && !archivoDoc) setDocumento(f);
  });

  el.inputDoc.addEventListener("change", () => setDocumento(el.inputDoc.files[0] || null));
  el.quitar.addEventListener("click", (e) => {
    e.stopPropagation();
    setDocumento(null);
  });

  el.inputInstrucciones.addEventListener("change", () => setInstrucciones(el.inputInstrucciones.files[0] || null));
  el.quitarInstrucciones.addEventListener("click", () => setInstrucciones(null));

  /* --------------------------- Limpieza ------------------------- */

  el.limpiar.addEventListener("click", () => {
    setDocumento(null);
    setInstrucciones(null);
    el.instruccionesTexto.value = "";
    el.contexto.value = "";
    mostrar(el.panelProgreso, false);
    mostrar(el.panelError, false);
    mostrar(el.panelResultado, false);
    el.resultadoTexto.textContent = "";
    el.contenedorChecklist.innerHTML = "";
    el.resultadoDetalles.innerHTML = "";
    if (fuenteProgreso) {
      fuenteProgreso.close();
      fuenteProgreso = null;
    }
    ultimoResultado = null;
  });

  /* --------------------------- Progreso ------------------------- */

  // Orden real de las etapas que emite el servidor. Las etapas desconocidas
  // (por ejemplo "extract-done") dejan la barra en 20 %, como en el original.
  const ORDEN_ETAPAS = ["upload", "instructions", "extract", "vision", "video", "pdf", "office", "legacy", "text", "llm", "finish"];
  let vistos = new Set();

  /** Deja el panel de progreso listo para una evaluación nueva. */
  function reiniciarProgreso() {
    vistos = new Set();
    el.progresoLista.innerHTML = "";
    el.barra.style.width = "4%";
    el.progresoMensaje.textContent = "Preparando…";
  }

  /**
   * Agrega un evento de progreso (una sola vez por etapa+mensaje) y ajusta
   * el porcentaje de la barra según la tabla ORDEN_ETAPAS.
   * @param {{stage:string, message:string}} evento
   */
  function agregarProgreso(evento) {
    const clave = evento.stage + "|" + evento.message;
    if (vistos.has(clave)) return;
    vistos.add(clave);

    el.progresoMensaje.textContent = evento.message || evento.stage;

    // "finish" y "error" no se listan como pasos: cierran la evaluación.
    if (evento.stage !== "finish" && evento.stage !== "error") {
      const li = document.createElement("li");
      li.textContent = evento.message || evento.stage;
      el.progresoLista.appendChild(li);
      el.progresoLista.scrollTop = el.progresoLista.scrollHeight;
    }

    const idx = ORDEN_ETAPAS.indexOf(evento.stage);
    const pct =
      evento.stage === "finish" ? 100 : idx >= 0 ? Math.min(95, 8 + (idx / ORDEN_ETAPAS.length) * 88) : 20;
    el.barra.style.width = pct + "%";
  }

  /* ------------------------- Evaluación ------------------------- */

  el.evaluar.addEventListener("click", async () => {
    if (!archivoDoc) return;

    el.evaluar.disabled = true;
    el.evaluar.textContent = "Evaluando…";
    mostrar(el.panelError, false);
    mostrar(el.panelResultado, false);
    mostrar(el.panelProgreso, true);
    reiniciarProgreso();

    // El formulario solo incluye instrucciones/contexto si tienen contenido.
    const fd = new FormData();
    fd.append("documento", archivoDoc, archivoDoc.name);
    if (el.instruccionesTexto.value.trim()) fd.append("instruccionesTexto", el.instruccionesTexto.value);
    if (archivoInstr) fd.append("instruccionesArchivo", archivoInstr, archivoInstr.name);
    if (el.contexto.value.trim()) fd.append("contexto", el.contexto.value.trim());

    // 1) Iniciar el trabajo en el servidor.
    let jobId;
    try {
      const r = await fetch("/api/evaluar", { method: "POST", body: fd });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || "No se pudo iniciar la evaluación.");
      jobId = data.jobId;
    } catch (e) {
      // Un fallo de red significa que el servidor local no está escuchando.
      const red = /fetch|network|load failed|conexi|refused/i.test(e.message) || e.name === "TypeError";
      if (red) {
        servidorCaido();
      } else {
        finalizarConError(e.message);
      }
      return;
    }

    // 2) Seguir el avance por Server-Sent Events.
    if (fuenteProgreso) fuenteProgreso.close();
    fuenteProgreso = new EventSource("/api/progreso?job=" + encodeURIComponent(jobId));
    fuenteProgreso.onmessage = (ev) => {
      let d;
      try {
        d = JSON.parse(ev.data);
      } catch {
        return; // evento no JSON: se ignora
      }
      agregarProgreso(d);
      if (d.stage === "finish") {
        fuenteProgreso.close();
        fuenteProgreso = null;
        el.barra.style.width = "100%";
        cargarResultado(jobId);
      } else if (d.stage === "error") {
        fuenteProgreso.close();
        fuenteProgreso = null;
        finalizarConError(d.message);
      }
    };
    fuenteProgreso.onerror = () => {
      // Si el canal se corta, se consulta el resultado directamente.
      if (fuenteProgreso) {
        fuenteProgreso.close();
        fuenteProgreso = null;
      }
      cargarResultado(jobId);
    };
  });

  /**
   * Consulta el resultado del trabajo. Si todavía no está listo, reintenta
   * en 2,5 s (por si el SSE se cortó antes de la señal de fin).
   * @param {string} jobId
   */
  async function cargarResultado(jobId) {
    try {
      const r = await fetch("/api/resultado/" + encodeURIComponent(jobId));
      const data = await r.json();
      if (data.status === "error") return finalizarConError(data.error);
      if (data.status !== "listo") {
        // Aún en curso: reintenta en un momento.
        return setTimeout(() => cargarResultado(jobId), 2500);
      }
      mostrarResultado(data.result);
    } catch (e) {
      finalizarConError("No se pudo obtener el resultado: " + e.message);
    }
  }

  /** Deja el botón principal en su estado normal (según haya documento). */
  function restaurarBoton() {
    el.evaluar.disabled = !archivoDoc;
    el.evaluar.textContent = "Evaluar mi trabajo";
  }

  /**
   * Muestra un error de la evaluación y restaura el botón.
   * @param {string} msg
   */
  function finalizarConError(msg) {
    mostrar(el.panelProgreso, false);
    mostrar(el.panelError, true);
    el.textoError.textContent = msg || "Ocurrió un error inesperado.";
    restaurarBoton();
  }

  /**
   * Arma las filas de "Detalles técnicos del análisis" con los datos que
   * envía el servidor (archivo, contenido, instrucciones, tokens, modelo...).
   * Todo valor dinámico se escapa antes de interpolarse.
   * @param {object} res
   * @returns {string}
   */
  function construirDetalles(res) {
    const d = res.document || {};
    const u = res.usage || {};
    const segundos = res.elapsedMs ? (res.elapsedMs / 1000).toFixed(1) : "?";
    const filas = [];

    filas.push(`<b>Archivo:</b> ${escapar(d.name || "")} (${escapar(d.kind || "")})`);
    filas.push(`<b>Contenido analizado:</b> ${d.textChars || 0} caracteres de texto, ${d.images || 0} imagen(es)`);
    if (d.facts && Object.keys(d.facts).length) {
      filas.push(
        "<b>Datos del archivo:</b> " +
          Object.entries(d.facts)
            .filter(([, v]) => v !== undefined && v !== null && v !== "")
            .map(([k, v]) => `${escapar(k)}: ${escapar(String(v))}`)
            .join(" · ")
      );
    }
    filas.push(
      `<b>Instrucciones:</b> ${res.instructions && res.instructions.chars ? res.instructions.chars + " caracteres" : "ninguna (criterio general)"}` +
        (res.instructions && res.instructions.fromFile ? ` · archivo: ${escapar(res.instructions.fromFile)}` : "") +
        (res.instructions && res.instructions.typed ? " · texto escrito" : "")
    );
    if (d.notes && d.notes.length) filas.push("<b>Notas del análisis:</b> " + d.notes.map(escapar).join(" | "));
    if (u.total_tokens) {
      filas.push(
        `<b>Tokens usados:</b> ${u.total_tokens} (razonamiento: ${(u.completion_tokens_details || {}).reasoning_tokens || 0})`
      );
    }
    filas.push(`<b>Modelo:</b> ${escapar(res.model || "")} · <b>Tiempo:</b> ${segundos} s`);
    return filas.join("<br>");
  }

  /**
   * Muestra el resultado completo: retroalimentación, tabla de verificación,
   * detalles técnicos y botones de copiar/descargar.
   * @param {object} res
   */
  function mostrarResultado(res) {
    ultimoResultado = res;
    mostrar(el.panelProgreso, false);
    mostrar(el.panelError, false);
    mostrar(el.panelResultado, true);

    // Texto crudo para Copiar/Descargar; el contenedor recibe la versión con
    // los títulos detectados (sin alterar el contenido).
    renderRetroalimentacion(res.feedback);
    renderChecklist(res.checklist, res.checklistAviso);

    el.resultadoDetalles.innerHTML = construirDetalles(res);
    restaurarBoton();
    el.panelResultado.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  /* ----------------------- Copiar / descargar ------------------- */

  el.copiar.addEventListener("click", async () => {
    if (!ultimoResultado) return;
    const texto = [ultimoResultado.feedback, checklistComoTexto(ultimoResultado.checklist)]
      .filter(Boolean)
      .join("\n\n");
    try {
      await navigator.clipboard.writeText(texto);
      el.copiar.textContent = "¡Copiado!";
      setTimeout(() => (el.copiar.textContent = "Copiar"), 1800);
    } catch {
      el.copiar.textContent = "No se pudo copiar";
      setTimeout(() => (el.copiar.textContent = "Copiar"), 1800);
    }
  });

  el.descargar.addEventListener("click", () => {
    if (!ultimoResultado) return;
    const nombre = (ultimoResultado.document && ultimoResultado.document.name) || "documento";
    const cabecera =
      `RETROALIMENTACIÓN - INSTRUCTOR DE LOGÍSTICA\n` +
      `Archivo evaluado: ${nombre}\n` +
      `Fecha: ${new Date().toLocaleString("es-CO")}\n` +
      `${"-".repeat(60)}\n\n`;
    const cuerpo = [ultimoResultado.feedback, checklistComoTexto(ultimoResultado.checklist)]
      .filter(Boolean)
      .join("\n\n");
    const blob = new Blob([cabecera + cuerpo], { type: "text/plain;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "retroalimentacion_" + nombre.replace(/\.[^.]+$/, "") + ".txt";
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  });

  /* --------------------- Estado del servicio -------------------- */

  /**
   * Pinta la píldora de estado del encabezado.
   * @param {boolean} conectado
   * @param {string} texto
   */
  function pintarEstado(conectado, texto) {
    el.puntoEstado.className = "punto " + (conectado ? "ok" : "malo");
    el.textoEstado.textContent = texto;
  }

  /** El servidor local dejó de responder: se explica qué hacer. */
  function servidorCaido() {
    mostrar(el.panelProgreso, false);
    mostrar(el.panelResultado, false);
    mostrar(el.panelError, true);
    el.textoError.innerHTML =
      "La aplicación se cerró y ya no está disponible en <b>" +
      escapar(location.origin) +
      "</b>.<br><br>" +
      "Esto pasa cuando se cierra la ventana negra en la que se inició la aplicación, " +
      "o cuando el equipo se suspende.<br><br>" +
      "<b>Qué hacer:</b> vuelve a abrir <b>Iniciar.bat</b> y recarga esta página. " +
      "El trabajo que tenías seleccionado se pierde, así que tendrás que volver a subir el archivo.";
    pintarEstado(false, "Servidor detenido");
    restaurarBoton();
  }

  /**
   * Comprueba /api/estado: modelo disponible, clave configurada y servidor vivo.
   * @param {boolean} [inicial] true en la primera comprobación (no avisa caída)
   */
  async function comprobarServicio(inicial = false) {
    try {
      const r = await fetch("/api/estado", { cache: "no-store" });
      const d = await r.json();
      if (d.claveConfigurada) {
        pintarEstado(true, d.modelo);
      } else {
        pintarEstado(false, "Falta la clave de API");
        if (inicial) {
          mostrar(el.panelError, true);
          el.textoError.innerHTML =
            "La aplicación está encendida, pero no tiene clave de API configurada.<br><br>" +
            "Crea el archivo <b>data/config.json</b> con el contenido " +
            '<b>{"apiKey":"tu-clave"}</b> y vuelve a iniciar la aplicación.';
        }
      }
      // Si el servidor volvió, se limpia el aviso de caída.
      if (el.panelError.hidden === false && /se cerró/.test(el.textoError.textContent || "")) {
        mostrar(el.panelError, false);
      }
    } catch {
      pintarEstado(false, "Sin conexión con la aplicación");
      if (!inicial) servidorCaido();
    }
  }

  // Vigila que el servidor siga vivo, para avisar antes de que falle una subida.
  comprobarServicio(true);
  setInterval(() => comprobarServicio(false), 20000);
})();
