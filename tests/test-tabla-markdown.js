"use strict";
/** Prueba del respaldo: convierte una tabla Markdown en lista de verificacion. */
const { extraerTablaMarkdown, separarChecklist } = require("../lib/llm");

let fallos = 0;
const check = (n, c, extra = "") => {
  console.log(`  ${c ? "OK   " : "FALLA"} ${n}${extra ? " -> " + extra : ""}`);
  if (!c) fallos++;
};

/* --- Tabla como la escribe el modelo cuando el prompt pide "en Markdown" --- */
const respuesta = `Hola Ana, espero que estés muy bien. El informe está organizado y se nota el manejo del material.

Te sugiero fortalecer el análisis de causas y aclarar el alcance del conteo cíclico. Gracias por tu dedicación.

LISTA DE VERIFICACIÓN

| No. | VARIABLES/INDICADORES DE LOGRO | CUMPLE SÍ | CUMPLE NO | Observaciones |
|---|---|---|---|---|
| 1 | Identificó la jerarquía de los cargos en el organigrama institucional. 20 % | SÍ 20% | | Incluye organigrama de niveles. |
| 2 | Interpretó las necesidades del departamento humano. 20 % | SÍ 20% | | Define necesidades por área. |
| 3 | Describió los perfiles para cada cargo. 10 % | | NO 10% | Solo menciona cargos, sin perfiles. |
| 4 | Definió las funciones y responsabilidades de los cargos. 10 % | SÍ 10% | | Lista funciones por cargo. |
| 5 | Estableció la política de capacitación continua. 10 % | | NO 10% | No se establece como política. |
| 6 | Reconoció la importancia del factor humano. 10 % | SÍ 10% | | Se refleja en la conclusión. |
| 7 | Utilizó herramientas para generar motivación. 10 % | | NO 10% | No se evidencia. |
| 8 | Usó la plataforma virtual para el envío de la evidencia. 10 % | SÍ 10% | | Evidencia entregada en PDF. |
|  | Porcentaje total obtenido | 80% (80 puntos sobre 100) |  |  |`;

const r = extraerTablaMarkdown(respuesta);
check("Detecta la tabla Markdown", Boolean(r));
if (r) {
  const cl = r.checklist;
  check("Extrae los 8 criterios", cl.items.length === 8, cl.items.length + " items");
  check("Columnas CUMPLE SÍ y CUMPLE NO", cl.columnas.map((c) => c.titulo).join("|") === "CUMPLE SÍ|CUMPLE NO", cl.columnas.map((c) => c.titulo).join(" | "));
  check("Marca el criterio 1 en CUMPLE SÍ", /[✓✔☑]/.test(cl.items[0].valores.cumple_si), JSON.stringify(cl.items[0].valores));
  check("Conserva el porcentaje de la casilla", cl.items[0].valores.cumple_si.includes("20%"), cl.items[0].valores.cumple_si);
  check("Marca el criterio 3 en CUMPLE NO", /[✓✔☑]/.test(cl.items[2].valores.cumple_no), JSON.stringify(cl.items[2].valores));
  check("No cuenta la fila de total como criterio", !cl.items.some((i) => /porcentaje total/i.test(i.descripcion)));
  check("Conserva la descripcion completa", cl.items[0].descripcion.includes("jerarquía de los cargos"));
  check("Conserva las observaciones", cl.items[0].observacion.includes("organigrama"));
  const total = cl.resumen.find((x) => /puntaje/i.test(x.etiqueta));
  check("Recupera el porcentaje total", Boolean(total), total ? total.valor : "ninguno");
  check("El texto ya no contiene lineas de tabla", !r.texto.includes("|"), r.texto.slice(-60));
  check("Conserva la prosa", r.texto.includes("Hola Ana"));
}

/* --- No debe activarse con texto normal --- */
check("Sin tabla no se activa", extraerTablaMarkdown("Solo un parrafo con | una barra suelta.") === null);
check("Tabla de 2 filas no se considera rubrica", extraerTablaMarkdown("| a | b |\n|---|---|\n| 1 | 2 |") === null);

/* --- El bloque de datos tiene prioridad sobre el respaldo --- */
const conBloque = `Retro.\n===LISTA_DE_VERIFICACION===\n{"columnas":[{"clave":"si","titulo":"CUMPLE SÍ"}],"items":[{"descripcion":"C1","valores":{"si":"✓"}},{"descripcion":"C2","valores":{"si":""}}],"resumen":[],"total":{"concepto":"Aprobado"}}\n===FIN_LISTA===`;
const sep = separarChecklist(conBloque);
check("El bloque estructurado se prefiere", sep.checklist && sep.checklist.items.length === 2);

console.log(`\n${fallos === 0 ? "TODO OK" : fallos + " FALLO(S)"}`);
process.exit(fallos ? 1 : 0);
