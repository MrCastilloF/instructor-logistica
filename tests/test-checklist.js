"use strict";
/** Prueba la separacion de la lista de verificacion. */
const { separarChecklist, MARCA_INICIO, MARCA_FIN } = require("../lib/llm");

const casos = [];
let fallos = 0;

function probar(nombre, entrada, esperado) {
  const r = separarChecklist(entrada);
  const problemas = [];
  if (esperado.textoContiene && !r.texto.includes(esperado.textoContiene)) {
    problemas.push(`el texto no contiene "${esperado.textoContiene}"`);
  }
  if (esperado.textoNoContiene && r.texto.includes(esperado.textoNoContiene)) {
    problemas.push(`el texto NO deberia contener "${esperado.textoNoContiene}"`);
  }
  if (esperado.items !== undefined) {
    const n = r.checklist ? r.checklist.items.length : 0;
    if (n !== esperado.items) problemas.push(`items=${n}, se esperaban ${esperado.items}`);
  }
  if (esperado.totalNota !== undefined) {
    const nota = r.checklist && r.checklist.total ? r.checklist.total.nota : "";
    if (nota !== esperado.totalNota) problemas.push(`nota="${nota}", se esperaba "${esperado.totalNota}"`);
  }
  if (esperado.aviso !== undefined) {
    const hay = Boolean(r.aviso);
    if (hay !== esperado.aviso) problemas.push(`aviso=${hay}, se esperaba ${esperado.aviso}`);
  }
  if (esperado.columnas !== undefined) {
    const n = r.checklist ? r.checklist.columnas.length : 0;
    if (n !== esperado.columnas) problemas.push(`columnas=${n}, se esperaban ${esperado.columnas}`);
  }
  if (esperado.tituloColumna !== undefined) {
    const t = r.checklist ? r.checklist.columnas.map((c) => c.titulo).join(" | ") : "";
    if (!t.includes(esperado.tituloColumna)) problemas.push(`titulos de columna="${t}"`);
  }
  if (esperado.valorPrimerItem !== undefined) {
    // Busca la columna de calificacion; si no existe, usa la primera con valor.
    const cl = r.checklist;
    let v = "";
    if (cl) {
      const colCal = cl.columnas.find((c) => /calific/i.test(c.titulo) || c.clave === "calificacion");
      const clave = colCal ? colCal.clave : cl.columnas[0].clave;
      v = cl.items[0].valores[clave] || "";
    }
    if (v !== esperado.valorPrimerItem) problemas.push(`primer valor="${v}", se esperaba "${esperado.valorPrimerItem}"`);
  }
  if (problemas.length) {
    fallos++;
    console.log(`FALLA  ${nombre}`);
    for (const p of problemas) console.log(`         - ${p}`);
  } else {
    console.log(`OK     ${nombre}`);
  }
  casos.push({ nombre, r });
}

const jsonValido = JSON.stringify({
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
      descripcion: "Interpretó las necesidades del departamento humano. 20%",
      valores: { cumple_si: "✓ 20%", cumple_no: "" },
      observacion: "Define necesidades de personal por área.",
    },
    {
      descripcion: "Diseñó el plan de acción con responsables y fechas. 20%",
      valores: { cumple_si: "", cumple_no: "✓" },
      observacion: "No se definen responsables ni fechas.",
    },
  ],
  resumen: [
    { etiqueta: "CUMPLE SÍ", valor: "2 de 3 criterios" },
    { etiqueta: "CUMPLE NO", valor: "1 de 3 criterios" },
  ],
  total: { nota: "3.3 de 5", concepto: "Aprobado" },
});

probar(
  "bloque por columnas (checklist)",
  `Que observe\nEl informe es corto.\n\nCierre\nAnimo.\n\n${MARCA_INICIO}\n${jsonValido}\n${MARCA_FIN}`,
  {
    textoContiene: "Que observe",
    textoNoContiene: MARCA_INICIO,
    items: 3,
    totalNota: "3.3 de 5",
    aviso: false,
    columnas: 2,
    tituloColumna: "CUMPLE SÍ",
  }
);

const jsonPuntaje = JSON.stringify({
  titulo: "Rúbrica de puntaje",
  tipo: "puntaje",
  columnas: [{ clave: "calificacion", titulo: "CALIFICACIÓN", tipo: "marca" }],
  items: [
    { descripcion: "Indicadores de gestión", valores: { calificacion: "24 / 30" }, observacion: "Metas y reales." },
    { descripcion: "Análisis de causas", valores: { calificacion: "7 / 40" }, observacion: "Sin causas." },
  ],
  resumen: [{ etiqueta: "Puntaje", valor: "31 de 70" }],
  total: { nota: "1.7 de 5", concepto: "Reprobado" },
});

probar("bloque de puntaje con una columna", `${MARCA_INICIO}\n${jsonPuntaje}\n${MARCA_FIN}`, {
  items: 2,
  columnas: 1,
  totalNota: "1.7 de 5",
  valorPrimerItem: "24 / 30",
});

// Compatibilidad con el formato anterior (peso/calificacion/maximo).
const jsonAntiguo = JSON.stringify({
  items: [
    { criterio: "Claridad", peso: "30%", calificacion: "24", maximo: "30", observacion: "Bien." },
    { criterio: "Causas", peso: "40%", calificacion: "7", maximo: "40", observacion: "Falta." },
  ],
  total: { calificacion: "31", maximo: "70", nota: "2.2 de 5", concepto: "Reprobado" },
  escala: "0 a 5",
});
probar("compatibilidad con el formato anterior", `${MARCA_INICIO}\n${jsonAntiguo}\n${MARCA_FIN}`, {
  items: 2,
  columnas: 3,
  valorPrimerItem: "24 / 30",
});

probar(
  "JSON dentro de bloque de codigo",
  `Texto de retro.\n${MARCA_INICIO}\n\`\`\`json\n${jsonValido}\n\`\`\`\n${MARCA_FIN}`,
  { items: 3, aviso: false }
);
probar(
  "JSON mal formado no rompe nada",
  `Texto de retro.\n${MARCA_INICIO}\n{ "items": [ {esto no es json,,, ] }\n${MARCA_FIN}`,
  { textoContiene: "Texto de retro", items: 0, aviso: true }
);

probar("sin bloque (modelo no lo entrego)", "Solo retroalimentacion normal.", {
  textoContiene: "Solo retroalimentacion",
  items: 0,
  aviso: false,
});

probar(
  "bloque sin marca de fin",
  `Retro.\n${MARCA_INICIO}\n${jsonValido}`,
  { textoContiene: "Retro", items: 3 }
);

probar(
  "tabla markdown en el texto se elimina",
  `Que observe\n\n| Criterio | Nota |\n|---|---|\n| Causas | 2.0 |\n\nFin del texto.`,
  { textoContiene: "Fin del texto", textoNoContiene: "|" }
);

probar(
  "items vacios -> sin tabla",
  `${MARCA_INICIO}\n{"items":[],"total":{}}\n${MARCA_FIN}`,
  { items: 0 }
);

console.log("\n--- ejemplo de datos listos para la tabla ---");
const ej = casos[0].r.checklist;
console.log(JSON.stringify(ej, null, 2));
console.log("texto final:", JSON.stringify(casos[0].r.texto));

console.log(`\n${casos.length - fallos}/${casos.length} casos correctos`);
process.exit(fallos ? 1 : 0);
