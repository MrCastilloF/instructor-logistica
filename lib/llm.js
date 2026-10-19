"use strict";
/**
 * Motor de evaluacion: combina las instrucciones del usuario (escritas o
 * subidas como archivo) con el contenido extraido del documento y genera
 * una retroalimentacion con tono de instructor humano, sencillo y directo.
 */
const config = require("./config");
const { wordCount } = require("./content");

const SYSTEM_PROMPT = `Eres un instructor experto en logistica y cadena de suministro (almacenamiento, inventarios, transporte, distribucion, compras y servicio al cliente). Llevas anos acompanando aprendices y sabes dar retroalimentacion que la gente entiende y puede aplicar.

TU FORMA DE HABLAR:
- Escribes en espanol claro y sencillo, como si conversaras con la persona. Nada de lenguaje rebuscado ni de robot.
- Te diriges directamente a quien hizo el trabajo ("veo que...", "te falto...", "buen trabajo en...").
- Eres cercano y respetuoso, pero honesto: si algo esta mal o incompleto, lo dices sin rodeos y sin adornos.
- Explicas el "por que" de cada observacion para que la persona aprenda, no solo para calificar.
- Usas ejemplos concretos tomados del propio documento. Si el documento menciona cifras, productos, areas o procesos, los citas.
- Evitas el relleno, las frases genericas y las listas interminables. Prefieres parrafos cortos.

COMO EVALUAS:
- Sigues al pie de la letra las INSTRUCCIONES DE EVALUACION que te entregue el usuario (criterios, pesos, niveles, formato, si debe poner nota, etc.). Esas instrucciones manda sobre cualquier criterio propio.
- Si las instrucciones piden una nota o porcentaje, lo calculas y lo justificas.
- Si las instrucciones no dicen nada sobre la nota, NO inventas una calificacion numerica: te centras en la retroalimentacion cualitativa.
- Basas TODA tu evaluacion en la evidencia del documento. Si un criterio no se puede verificar porque la informacion no aparece, lo dices explicitamente en lugar de suponer.
- Cuando el material incluya imagenes o fotogramas de video, describes lo que observas y lo relacionas con los criterios.

ESTRUCTURA DE TU RESPUESTA (usa estos titulos en texto plano, sin simbolos decorativos):
1. "Que observe" - resumen breve y neutral de lo que entrega la persona.
2. "Lo que esta bien" - aciertos concretos, citando evidencia.
3. "Lo que hay que mejorar" - uno por uno, cada punto con: que falta o esta debil, por que importa en logistica, y como corregirlo.
4. "Recomendaciones" - acciones practicas, aplicables y medibles.
5. "Cierre" - una o dos frases de animo, realistas.

REGLAS FINALES:
- Nunca inventes datos que no esten en el material.
- No repitas textualmente parrafos largos del documento; interpreta.
- Si el material es insuficiente o ilegible, dilo con claridad y explica que deberia entregar la persona.
- Escribe en texto plano y en parrafos. NUNCA uses simbolos de formato: nada de **, ##, guiones bajos, asteriscos, numerales ni tablas markdown. Los titulos se escriben solos, en su propia linea, como "Que observe".

LISTA DE VERIFICACION OBLIGATORIA (va al FINAL, despues del cierre):
Aclaracion importante sobre el formato: la aplicacion DIBUJA LA TABLA por ti a partir de los
datos de este bloque. Por eso NO debes escribir la tabla dentro de la retroalimentacion, ni
usar el caracter "|", ni simbolos markdown: si la escribes como texto, la aplicacion la
elimina. El bloque de abajo ES la tabla. Si las instrucciones del docente piden "una tabla en
Markdown" o "una tabla de calificacion", esa peticion se cumple con este bloque, que la
aplicacion convierte en la tabla visual.

Despues de tu retroalimentacion debes entregar la lista de verificacion como DATOS. La tabla
debe COPIAR el formato de las instrucciones que recibiste. Se escribe exactamente asi:

===LISTA_DE_VERIFICACION===
{
  "titulo": "nombre de la lista o de la rubrica",
  "tituloColumna": "encabezado de la columna de criterios, tomado de las instrucciones (por ejemplo
                    'Variables/indicadores de logro'); si no lo indican, dejalo vacio",
  "tipo": "checklist | puntaje | concepto | mixto",
  "escala": "escala de nota si las instrucciones la piden (por ejemplo 0 a 5); vacio si no",
  "columnas": [
    { "clave": "cumple_si", "titulo": "CUMPLE SÍ", "tipo": "marca" },
    { "clave": "cumple_no", "titulo": "CUMPLE NO", "tipo": "marca" }
  ],
  "items": [
    {
      "descripcion": "texto COMPLETO del criterio, tal como lo escribieron las instrucciones",
      "valores": { "cumple_si": "✓", "cumple_no": "'"'"''"'"' },
      "observacion": "una o dos frases que justifiquen, citando la evidencia del documento"
    }
  ],
  "resumen": [
    { "etiqueta": "CUMPLE SÍ", "valor": "4 de 5 criterios" },
    { "etiqueta": "Puntaje", "valor": "80% de 100%" }
  ],
  "total": {
    "nota": "nota final en la escala pedida, por ejemplo 4.0 de 5; vacio si no la piden",
    "concepto": "concepto final: Aprobado, Reprobado, Cumple, No cumple, etc."
  }
}
===FIN_LISTA===

Reglas de la lista de verificacion:
- Un item por cada criterio de las instrucciones, EN EL MISMO ORDEN en que aparecen.
- Si las instrucciones no traen criterios, usa de 4 a 6 criterios propios de una entrega de logistica.
- "descripcion" es el texto del criterio. Si las instrucciones ya traen la redaccion (por ejemplo
  "Identifico la jerarquia de los cargos en el organigrama institucional"), usala TAL CUAL, sin
  acortarla ni inventar otra.
- ELIGE EL FORMATO SEGUN LAS INSTRUCCIONES, estas son las posibilidades:
  * Si las instrucciones usan casillas de verificacion (Cumple / No cumple, Si / No, Aplica / No
    aplica): "tipo" es "checklist" y defines una columna "marca" por cada opcion. La columna que
    corresponde al resultado de cada criterio lleva el simbolo ✓, y las demas van vacias.
    Los "titulo" de esas columnas se copian de las instrucciones (por ejemplo "CUMPLE SÍ" y
    "CUMPLE NO"). Si las instrucciones traen un valor dentro de la casilla (por ejemplo "20%"),
    escribe ese valor junto al simbolo: "✓ 20%".
  * Si las instrucciones dan puntos o porcentajes por criterio: una sola columna "marca" con
    "titulo": "CALIFICACIÓN" y "clave": "calificacion", y en cada item el valor es lo obtenido
    sobre el maximo: "24 / 30".
  * Si las instrucciones piden un concepto por criterio: una columna por cada concepto
    (por ejemplo "CUMPLE", "CUMPLE PARCIAL", "NO CUMPLE") y se marca el que corresponda.
- Nunca inventes columnas que las instrucciones no pidan, ni omitas las que si piden.
- "observacion": una o dos frases cortas, concretas, citando lo que viste en el documento.
- CALIFICACION FINAL (muy importante, nunca la dejes vacia):
  * "resumen" lleva una linea por cada columna con su total: "4 de 5 criterios".
  * Si los criterios tienen valor (porcentaje o puntos), AÑADE SIEMPRE al resumen una linea
    "Puntaje total" con el gran total obtenido sobre el maximo. Por ejemplo, si hay 8 criterios
    de 10% cada uno, una linea: { "etiqueta": "Puntaje total", "valor": "80% (80 de 100 puntos)" }.
    Ese total es la suma de los valores de los criterios marcados como cumplidos.
  * "total.calificacion" repite ese gran total ("80 de 100" o "80%"). Si las instrucciones piden
    una nota, "total.nota" la da en su escala ("4.0 de 5"). Nunca dejes los tres campos vacios.
  * "total.concepto" es Aprobado o Reprobado (o Cumple / No cumple).
- Si un criterio no se puede verificar por falta de informacion, deja las casillas vacias y
  explicalo en la observacion.
- Escribe las marcas con el simbolo ✓ en la columna que corresponda, nunca con la palabra "SI".
- Responde el bloque en JSON valido, sin comentarios, sin texto antes ni despues de ===FIN_LISTA===.`;

function buildUserMessage({ instructions, content, extraContext }) {
  const parts = [];

  if (instructions && instructions.trim()) {
    parts.push(
      "INSTRUCCIONES DE EVALUACION ENTREGADAS POR EL DOCENTE (tienen prioridad absoluta):\n" +
        '"""\n' +
        instructions.trim() +
        '\n"""'
    );
  } else {
    parts.push(
      "INSTRUCCIONES DE EVALUACION: el docente no entrego criterios especificos. " +
        "Evalua con criterio profesional de logistica: pertinencia tecnica, claridad, completitud, " +
        "uso de indicadores, analisis de causas y propuestas de mejora."
    );
  }

  const facts = Object.entries(content.facts)
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .map(([k, v]) => `- ${k}: ${v}`)
    .join("\n");

  parts.push("DATOS DEL ARCHIVO ENTREGADO:\n" + facts);

  if (content.notes.length) {
    parts.push("NOTAS TECNICAS DE LA LECTURA DEL ARCHIVO (tenlas en cuenta):\n- " + content.notes.join("\n- "));
  }

  const text = content.text;
  if (text && text.trim()) {
    parts.push('CONTENIDO DEL DOCUMENTO ENTREGADO:\n"""\n' + text.trim() + '\n"""');
  } else {
    parts.push(
      "CONTENIDO DEL DOCUMENTO ENTREGADO: no se pudo extraer texto. " +
        (content.images.length
          ? "Analiza unicamente las imagenes adjuntas."
          : "No hay contenido analizable.")
    );
  }

  if (content.images.length) {
    const labels = content.images.map((i, n) => `${n + 1}. ${i.label || "imagen"}`).join("\n");
    parts.push(
      `IMAGENES ADJUNTAS (${content.images.length}), en este orden:\n${labels}\n\n` +
        "OBLIGACION DE ANALISIS VISUAL: revisa TODAS las imagenes adjuntas una por una. Contienen " +
        "diagramas de flujo, organigramas, tablas, planos, graficos, capturas de pantalla, fotografias " +
        "de evidencia, firmas o paginas escaneadas del mismo material. Describe lo que VES en ellas y " +
        "usalas como evidencia dentro de tu evaluacion. Si una imagen confirma o contradice lo que dice " +
        "el texto, mencionalo. Si en una imagen aparece informacion que no esta en el texto (una cifra, " +
        "un cargo, un paso del proceso, una firma, una fecha), tomala en cuenta y citála. Si alguna " +
        "imagen es ilegible o no aporta nada, dilo con franqueza en lugar de ignorarla."
    );
  }

  if (extraContext && extraContext.trim()) {
    parts.push("CONTEXTO ADICIONAL DEL DOCENTE:\n" + extraContext.trim());
  }

  parts.push(
    "Redacta ahora tu retroalimentacion como instructor, siguiendo la estructura indicada. " +
      "Se especifico y usa la evidencia del material."
  );

  return parts.join("\n\n");
}

const MARCA_INICIO = "===LISTA_DE_VERIFICACION===";
const MARCA_FIN = "===FIN_LISTA===";

/**
 * Ultimo respaldo: algunos prompts hacen que el modelo escriba la lista de
 * verificacion como parrafos ("<criterio> 10 % - SÍ - 10% - <observacion>").
 * Se detectan esas lineas y se reconstruye la tabla, para que la calificacion
 * nunca quede como texto suelto.
 * @returns {{checklist:object, texto:string}|null}
 */
function extraerListaEnProsa(respuesta) {
  if (!respuesta) return null;
  const lineas = respuesta.split(/\r?\n/);
  const items = [];
  const lineasUsadas = new Set();
  let veredictos = 0;

  lineas.forEach((linea, idx) => {
    if (!linea.includes("%")) return;

    // 1) Localiza el veredicto: "SÍ" o "NO" (con o sin separadores alrededor).
    const v = linea.match(/(?:^|[\s\-–:.])(S[ÍI]|NO)(?=[\s\-–:.]|$)/i);
    if (!v) return;
    const veredicto = /^s/i.test(v[1]) ? "si" : "no";

    // 2) El peso del criterio es el primer porcentaje de la linea.
    const p1 = linea.match(/(\d{1,3}(?:[.,]\d+)?)\s*%/);
    if (!p1) return;
    const peso = p1[1];

    // 3) Descripcion: texto anterior al veredicto, sin el peso.
    let descripcion = linea.slice(0, v.index).replace(/[\s\-–:]+$/, "").trim();
    descripcion = descripcion.replace(/\s*\d{1,3}(?:[.,]\d+)?\s*%\s*$/, "").replace(/\s*[-–:]\s*$/, "").trim();

    // 4) Observacion: texto posterior al veredicto, quitando el segundo porcentaje.
    let observacion = linea.slice(v.index + v[0].length).replace(/^[\s\-–:]+/, "").trim();
    observacion = observacion.replace(/^(\d{1,3}(?:[.,]\d+)?)\s*%/, "").replace(/^[\s\-–:]+/, "").trim();

    if (descripcion.length < 15) return;
    // Se quita la numeracion que traia la linea ("4. ", "4) ").
    descripcion = descripcion.replace(/^\d{1,2}\s*[.)\-–]\s*/, "").trim();
    if (descripcion.length < 15) return;
    items.push({ descripcion, peso, veredicto, observacion });
    lineasUsadas.add(idx);
    veredictos++;
  });

  // Sin veredictos suficientes no hay lista que reconstruir.
  if (items.length < 3 || veredictos < Math.max(2, Math.ceil(items.length * 0.6))) return null;

  const aItems = items.map((it, i) => {
    const peso = it.peso ? `${it.peso}%` : "";
    const etiqueta = peso ? `${it.descripcion} (${peso})` : it.descripcion;
    return {
      descripcion: etiqueta,
      valores: {
        cumple_si: it.veredicto === "si" ? (peso ? `✓ ${peso}` : "✓") : "",
        cumple_no: it.veredicto === "no" ? (peso ? `✓ ${peso}` : "✓") : "",
      },
      observacion: it.observacion,
    };
  });

  const marcadosSi = aItems.filter((it) => it.valores.cumple_si).length;
  const checklist = {
    titulo: "Lista de verificación",
    tipo: "checklist",
    escala: "",
    columnas: [
      { clave: "cumple_si", titulo: "CUMPLE SÍ", tipo: "marca" },
      { clave: "cumple_no", titulo: "CUMPLE NO", tipo: "marca" },
    ],
    items: aItems,
    resumen: [
      { etiqueta: "CUMPLE SÍ", valor: `${marcadosSi} de ${aItems.length} criterios` },
      { etiqueta: "CUMPLE NO", valor: `${aItems.length - marcadosSi} de ${aItems.length} criterios` },
    ],
    total: { calificacion: "", maximo: "", nota: "", concepto: "" },
  };

  const restante = lineas.filter((_, i) => !lineasUsadas.has(i)).join("\n");
  return { checklist, texto: restante };
}

/**
 * Respaldo: algunos prompts piden "una tabla en Markdown". Si el modelo la
 * escribe en vez de entregar el bloque de datos, se convierte esa tabla en la
 * lista de verificacion para no perderla.
 * @returns {{checklist:object, texto:string}|null}
 */
function extraerTablaMarkdown(respuesta) {
  if (!respuesta || respuesta.indexOf("|") < 0) return null;
  const lineas = respuesta.split(/\r?\n/);
  const filas = [];
  for (const l of lineas) {
    const s = l.trim();
    if (!s.startsWith("|") || !s.endsWith("|")) continue;
    const celdas = s.slice(1, -1).split("|").map((c) => c.trim().replace(/\*\*/g, ""));
    filas.push(celdas);
  }
  if (filas.length < 4) return null; // encabezado + separador + al menos 2 criterios

  const esSeparador = (f) => f.every((c) => /^:?-{2,}:?$/.test(c) || c === "");
  const cabecera = filas[0];
  if (!cabecera || cabecera.length < 2 || !filas[1] || !esSeparador(filas[1])) return null;

  const col = (re) => cabecera.findIndex((c) => re.test(c));
  // Ojo: la columna de numeracion ("No.", "N°", "N.º") no debe confundirse con "CUMPLE NO".
  const esColumnaNumero = (c) => /^(n|no|num|nro|núm|nº|n°|no\.)\.?$/i.test(String(c).trim());
  const iSi = col(/cumple\s*s[íi]|^s[íi]$|aplica|logrado/i);
  const iNoCol = cabecera.findIndex(
    (c, i) => i !== iSi && !esColumnaNumero(c) && /cumple\s*no|^no\b|no\s*cumple/i.test(c)
  );
  const iDesc = col(/variable|indicador|criterio|logro|descrip/i);
  const iObs = col(/observ/i);
  if (iDesc < 0) return null;

  const columnas = [];
  if (iSi >= 0) columnas.push({ clave: "cumple_si", titulo: cabecera[iSi] || "CUMPLE SÍ", tipo: "marca" });
  if (iNoCol >= 0) columnas.push({ clave: "cumple_no", titulo: cabecera[iNoCol] || "CUMPLE NO", tipo: "marca" });
  if (!columnas.length) {
    const iCal = col(/calific|nota|puntaje|%|valor/i);
    if (iCal < 0) return null;
    columnas.push({ clave: "calificacion", titulo: cabecera[iCal], tipo: "marca" });
  }

  const items = [];
  let totalMarkdown = null;

  for (const f of filas.slice(2)) {
    if (esSeparador(f)) continue;
    const descripcion = (f[iDesc] || "").trim();
    const valores = {};
    const marca = (v) => {
      const t = String(v || "").trim();
      if (!t) return "";
      // En una columna de casillas, cualquier valor presente ES la marca
      // ("SÍ 20%", "NO 10%", "X", "Cumple"...). Se normaliza a ✓ y se
      // conserva el porcentaje si lo trae.
      const pct = t.match(/(\d+(?:[.,]\d+)?)\s*%/);
      if (pct) return "✓ " + pct[0].replace(/\s+/g, "");
      if (/^(no aplica|n\/a|na)$/i.test(t)) return "";
      return "✓";
    };
    if (columnas.some((c) => c.clave === "cumple_si")) {
      valores.cumple_si = iSi >= 0 ? marca(f[iSi]) : "";
      valores.cumple_no = iNoCol >= 0 ? marca(f[iNoCol]) : "";
    } else {
      valores.calificacion = (f[col(/calific|nota|puntaje|%|valor/i)] || "").trim();
    }
    const observacion = iObs >= 0 ? (f[iObs] || "").trim() : "";

    // Fila de totales
    if (/total|porcentaje/i.test(descripcion) && !/\d+\./.test(descripcion)) {
      const m = JSON.stringify(f).match(/(\d{1,3})\s*%/);
      const m2 = JSON.stringify(f).match(/(\d{1,3})\s*(?:de|\/)\s*(\d{1,3})/);
      if (m) totalMarkdown = m[0].replace(/\s+/g, " ");
      else if (m2) totalMarkdown = `${m2[1]} de ${m2[2]}`;
      continue;
    }

    if (descripcion) items.push({ descripcion, valores, observacion });
  }

  if (items.length < 2) return null;

  // Se quitan las lineas de tabla del texto para no duplicar.
  const restante = lineas
    .filter((l) => {
      const s = l.trim();
      return !(s.startsWith("|") && s.endsWith("|"));
    })
    .join("\n");

  const marcadosSi = columnas.some((c) => c.clave === "cumple_si")
    ? items.filter((it) => /[✓✔☑]/.test(it.valores.cumple_si || "")).length
    : 0;

  const resumen = [];
  if (columnas.some((c) => c.clave === "cumple_si")) {
    resumen.push({ etiqueta: "CUMPLE SÍ", valor: `${marcadosSi} de ${items.length} criterios` });
    resumen.push({ etiqueta: "CUMPLE NO", valor: `${items.length - marcadosSi} de ${items.length} criterios` });
  }
  if (totalMarkdown) resumen.push({ etiqueta: "Puntaje total", valor: totalMarkdown });

  return {
    checklist: {
      titulo: "Lista de verificación",
      tipo: "checklist",
      escala: "",
      columnas,
      items,
      resumen,
      total: { calificacion: totalMarkdown || "", maximo: "", nota: "", concepto: "" },
    },
    texto: restante,
  };
}

/**
 * Separa la retroalimentacion escrita de la lista de verificacion.
 * El modelo entrega la lista como JSON entre dos marcas; si no la entrega o
 * viene mal formada, la retroalimentacion se conserva y la tabla se omite.
 * @returns {{texto:string, checklist:object|null, aviso:string|null}}
 */
function separarChecklist(respuesta) {
  if (!respuesta) return { texto: "", checklist: null, aviso: null };

  let bruto = respuesta;
  let checklist = null;
  let aviso = null;

  const i = bruto.indexOf(MARCA_INICIO);
  if (i >= 0) {
    const j = bruto.indexOf(MARCA_FIN, i);
    const bloque = bruto.slice(i + MARCA_INICIO.length, j >= 0 ? j : undefined);
    bruto = bruto.slice(0, i) + (j >= 0 ? bruto.slice(j + MARCA_FIN.length) : "");

    // Por si el modelo envuelve el JSON en un bloque de codigo.
    const limpio = bloque.replace(/```(?:json)?/gi, "").trim();
    const desde = limpio.indexOf("{");
    const hasta = limpio.lastIndexOf("}");
    if (desde >= 0 && hasta > desde) {
      try {
        checklist = normalizarChecklist(JSON.parse(limpio.slice(desde, hasta + 1)));
      } catch (e) {
        aviso = "La lista de verificación llegó mal formada y no se pudo mostrar.";
      }
    } else {
      aviso = "La lista de verificación llegó vacía y no se pudo mostrar.";
    }
  }

  return { texto: limpiarFormato(bruto), checklist, aviso };
}

/** Deja la lista en una forma predecible para la interfaz. */
function normalizarChecklist(datos) {
  if (!datos || typeof datos !== "object") return null;
  const texto = (v) => (v === null || v === undefined ? "" : String(v).trim());

  let columnas = [];
  let items = [];

  if (Array.isArray(datos.columnas) && Array.isArray(datos.items)) {
    /* ---------- Formato por columnas (checklist / puntaje / concepto) ---------- */
    columnas = datos.columnas
      .filter((c) => c && typeof c === "object")
      .map((c, i) => ({
        clave: texto(c.clave) || "col" + i,
        titulo: texto(c.titulo || c.title) || "Columna " + (i + 1),
        tipo: texto(c.tipo || c.type) || "marca",
      }));

    items = datos.items
      .filter((it) => it && typeof it === "object")
      .map((it) => {
        const valores = {};
        const fuente = it.valores && typeof it.valores === "object" ? it.valores : {};
        // Admite tanto it.valores{clave:valor} como claves sueltas dentro del item.
        for (const c of columnas) {
          const v = fuente[c.clave] !== undefined ? fuente[c.clave] : it[c.clave];
          valores[c.clave] = texto(v);
        }
        return {
          descripcion: texto(it.descripcion || it.criterio || it.criterion),
          valores,
          observacion: texto(it.observacion || it.observation),
        };
      })
      .filter((it) => it.descripcion || Object.values(it.valores).some(Boolean));

    // Si el modelo no definio columnas utiles, se deduce una de calificacion.
    if (!columnas.length) {
      columnas = [{ clave: "calificacion", titulo: "CALIFICACIÓN", tipo: "marca" }];
    }
  } else if (Array.isArray(datos.items)) {
    /* ---------- Formato anterior (compatibilidad): peso/calificacion/maximo ---------- */
    const hayPeso = datos.items.some((i) => i && (i.peso || i.weight));
    const hayMaximo = datos.items.some((i) => i && (i.maximo || i.max));
    columnas = [];
    if (hayPeso) columnas.push({ clave: "peso", titulo: "PESO", tipo: "marca" });
    columnas.push({ clave: "calificacion", titulo: "CALIFICACIÓN", tipo: "marca" });
    if (hayMaximo) columnas.push({ clave: "maximo", titulo: "MÁXIMO", tipo: "marca" });

    items = datos.items
      .filter((it) => it && typeof it === "object")
      .map((it) => {
        const valores = {};
        if (hayPeso) valores.peso = texto(it.peso || it.weight);
        const cal = texto(it.calificacion || it.score);
        const max = texto(it.maximo || it.max);
        valores.calificacion = cal && max ? `${cal} / ${max}` : cal;
        if (hayMaximo) valores.maximo = max;
        return {
          descripcion: texto(it.criterio || it.criterion),
          valores,
          observacion: texto(it.observacion || it.observation),
        };
      })
      .filter((it) => it.descripcion || Object.values(it.valores).some(Boolean));
  } else {
    return null;
  }

  if (!items.length) return null;

  const t = datos.total && typeof datos.total === "object" ? datos.total : {};
  const resumen = Array.isArray(datos.resumen)
    ? datos.resumen
        .filter((r) => r && typeof r === "object")
        .map((r) => ({ etiqueta: texto(r.etiqueta || r.label), valor: texto(r.valor || r.value) }))
        .filter((r) => r.etiqueta || r.valor)
    : [];

  return {
    titulo: texto(datos.titulo || datos.title),
    tituloColumna: texto(datos.tituloColumna || datos.columnTitle),
    tipo: texto(datos.tipo || datos.type) || "mixto",
    escala: texto(datos.escala),
    columnas,
    items,
    resumen,
    total: {
      calificacion: texto(t.calificacion),
      maximo: texto(t.maximo),
      nota: texto(t.nota),
      concepto: texto(t.concepto),
    },
  };
}

/**
 * Quita los restos de formato markdown que a veces se escapan al modelo.
 * El objetivo es que la retroalimentacion se lea como un texto humano.
 */
function limpiarFormato(texto) {
  if (!texto) return "";
  let t = texto;
  t = t.replace(/^[ \t]*#{1,6}[ \t]*/gm, ""); // encabezados
  t = t.replace(/\*\*\*(.+?)\*\*\*/gs, "$1");
  t = t.replace(/\*\*(.+?)\*\*/gs, "$1"); // negrita
  t = t.replace(/(^|[\s(])\*(?!\s)(.+?)(?<!\s)\*(?=[\s.,;:)]|$)/gs, "$1$2"); // cursiva
  t = t.replace(/(^|[\s(])_(?!\s)(.+?)(?<!\s)_(?=[\s.,;:)]|$)/gs, "$1$2");
  t = t.replace(/^\s*[-*+]\s+/gm, "• "); // vinetas uniformes
  t = t.replace(/`{1,3}([^`]+)`{1,3}/g, "$1"); // codigo en linea
  t = t.replace(/^[ \t]*>(?=[ \t])[ \t]?/gm, ""); // citas markdown (solo al inicio de linea)
  // Bloques de tabla markdown: se eliminan porque la tabla real la dibuja la app.
  t = t
    .split("\n")
    .filter((l) => {
      const s = l.trim();
      if (/^\|.*\|$/.test(s)) return false; // fila de tabla
      if (/^[|\s:-]+$/.test(s) && s.includes("-")) return false; // separador |---|---|
      return true;
    })
    .join("\n");
  t = t.replace(/^[ \t]*\|.*$/gm, (m) => m.replace(/\|/g, " ").trim()); // filas sueltas
  t = t.replace(/\n{3,}/g, "\n\n");
  return t.trim();
}

async function callApi({ messages, maxTokens, onProgress }) {
  if (!config.apiKey) {
    throw new Error(
      "No hay clave de API configurada. Crea el archivo data/config.json con {\"apiKey\":\"tu-clave\"} " +
        "o define la variable de entorno DEEPSEEK_API_KEY."
    );
  }

  const body = {
    model: config.model,
    messages,
    max_tokens: maxTokens,
    temperature: 0.6,
    stream: false,
  };

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 420000); // 7 min
  let res;
  try {
    res = await fetch(config.apiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + config.apiKey },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
  } catch (e) {
    clearTimeout(timer);
    if (e.name === "AbortError") throw new Error("El modelo tardo demasiado en responder. Intenta de nuevo o con un archivo mas liviano.");
    throw new Error("No se pudo contactar al servicio de IA: " + e.message);
  }
  clearTimeout(timer);

  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    let detail = txt.slice(0, 500);
    try {
      const j = JSON.parse(txt);
      detail = j.error?.message || detail;
    } catch {
      /* respuesta no JSON */
    }
    if (res.status === 401) throw new Error("La clave de API fue rechazada (401). Revisa data/config.json.");
    if (res.status === 402) throw new Error("La cuenta no tiene saldo disponible (402).");
    if (res.status === 429) throw new Error("Demasiadas solicitudes (429). Espera unos segundos e intenta otra vez.");
    if (res.status === 413) throw new Error("El documento es demasiado grande para el servicio (413). Sube una version mas liviana.");
    throw new Error(`Error del servicio de IA (${res.status}): ${detail}`);
  }

  const data = await res.json();
  const choice = data.choices && data.choices[0];
  const msg = choice && choice.message;
  let text = (msg && msg.content) || "";

  if (!text.trim() && msg && msg.reasoning_content) {
    // Modelo de razonamiento sin presupuesto suficiente para redactar.
    throw new Error(
      "El modelo agoto su presupuesto de razonamiento antes de redactar la respuesta. " +
        "Intenta de nuevo; si se repite, reduce el tamano del documento o las imagenes."
    );
  }

  return {
    // El texto se entrega en bruto: la lista de verificacion se separa despues.
    text: text.trim(),
    finishReason: choice && choice.finish_reason,
    usage: data.usage || null,
    model: data.model || config.model,
  };
}

/**
 * Evalua el material y devuelve la retroalimentacion.
 */
async function evaluate({ instructions, content, extraContext, onProgress = () => {} }) {
  const maxImages = config.limits.maxImages;
  const images = content.images.slice(0, maxImages);
  if (content.images.length > maxImages) {
    content.note(`Se enviaron ${maxImages} de ${content.images.length} imagenes para no exceder el limite del modelo.`);
  }

  onProgress({
    stage: "llm",
    message: `Consultando al instructor virtual (${config.model})...`,
  });

  const userText = buildUserMessage({ instructions, content, extraContext });

  const userContent = [{ type: "text", text: userText }];
  for (const img of images) {
    if (!img.dataUrl) continue;
    userContent.push({ type: "image_url", image_url: { url: img.dataUrl } });
  }

  const messages = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: userContent },
  ];

  const estimate = {
    textoCaracteres: content.textChars,
    textoPalabras: wordCount(content.text),
    imagenes: userContent.length - 1,
  };
  onProgress({ stage: "llm", message: `Enviando ${estimate.imagenes} imagen(es) y ${estimate.textoPalabras} palabras al modelo...` });

  let result;
  try {
    result = await callApi({ messages, maxTokens: 12000, onProgress });
  } catch (e) {
    // Reintento con menos imagenes si el fallo parece de tamano.
    if (images.length > 6 && /413|grande|tamano|tamaño/i.test(e.message)) {
      onProgress({ stage: "llm", message: "Reintentando con menos imagenes..." });
      const reduced = images.slice(0, 6);
      const uc = [{ type: "text", text: userText }];
      for (const img of reduced) uc.push({ type: "image_url", image_url: { url: img.dataUrl } });
      result = await callApi({
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: uc },
        ],
        maxTokens: 12000,
        onProgress,
      });
      estimate.imagenes = reduced.length;
    } else {
      throw e;
    }
  }

  // Se separa la lista de verificacion (datos) de la retroalimentacion escrita.
  let { texto, checklist, aviso } = separarChecklist(result.text);

  // Respaldo 1: si el modelo escribio la tabla en Markdown, se convierte.
  if (!checklist) {
    const tabla = extraerTablaMarkdown(texto);
    if (tabla) {
      checklist = tabla.checklist;
      texto = limpiarFormato(tabla.texto);
      aviso = null;
      onProgress({ stage: "llm", message: "La tabla vino como texto y se convirtio automaticamente." });
    }
  }

  // Respaldo 2: si escribio la lista como parrafos, se reconstruye la tabla.
  if (!checklist) {
    const prosa = extraerListaEnProsa(texto);
    if (prosa) {
      checklist = prosa.checklist;
      texto = limpiarFormato(prosa.texto);
      aviso = null;
      onProgress({
        stage: "llm",
        message: `La calificación vino en párrafos: se convirtió en tabla de ${prosa.checklist.items.length} criterios.`,
      });
    }
  }

  if (aviso) onProgress({ stage: "llm", message: aviso });

  return {
    ...result,
    text: texto,
    checklist,
    checklistAviso: aviso,
    estimate,
  };
}

/**
 * Lee instrucciones de evaluacion que vienen en un PDF escaneado o en una
 * imagen: se transcriben con vision para poder aplicarlas.
 * @param {string[]} imageDataUrls
 */
async function evaluateInstructionsImage(imageDataUrls, onProgress = () => {}) {
  const content = [
    {
      type: "text",
      text:
        "Estas imagenes contienen las INSTRUCCIONES DE EVALUACION que un docente entrego " +
        "(puede ser un PDF escaneado o una foto). Transcribe su contenido de forma FIEL y COMPLETA " +
        "en texto plano: criterios, pesos o porcentajes, niveles de desempeno, escalas de nota y " +
        "cualquier indicacion de formato. No agregues comentarios ni interpretes: solo transcribe. " +
        "Si alguna parte es ilegible, escribe [ilegible] en ese punto.",
    },
  ];
  for (const url of imageDataUrls.slice(0, 8)) {
    content.push({ type: "image_url", image_url: { url } });
  }
  onProgress({ stage: "instructions", message: "Transcribiendo instrucciones con vision..." });
  const r = await callApi({
    messages: [
      { role: "system", content: "Eres un transcriptor preciso de documentos. Respondes solo con la transcripcion." },
      { role: "user", content },
    ],
    maxTokens: 6000,
    onProgress,
  });
  return r.text;
}

module.exports = {
  evaluate,
  evaluateInstructionsImage,
  SYSTEM_PROMPT,
  buildUserMessage,
  limpiarFormato,
  separarChecklist,
  extraerTablaMarkdown,
  extraerListaEnProsa,
  MARCA_INICIO,
  MARCA_FIN,
};
