"use strict";
/** Prueba del respaldo que convierte la calificacion en parrafos a tabla. */
const { extraerListaEnProsa } = require("../lib/llm");
const render = require("./render-helper");

let fallos = 0;
const check = (n, c, extra = "") => {
  console.log(`  ${c ? "OK   " : "FALLA"} ${n}${extra ? " -> " + extra : ""}`);
  if (!c) fallos++;
};

/* Texto COMO EL DE LA CAPTURA DEL USUARIO: calificacion en parrafos. */
const respuesta = `Hola Carlos, espero que estés muy bien. Revisé tu informe y se nota el esfuerzo.

4. Definió las funciones y responsabilidades de los cargos en el área de operaciones logísticas. 10 % - SÍ - 10% El informe es claro al listar funciones y responsabilidades de cada cargo, por ejemplo Gestor de Experiencia, Auxiliar Financiero o Soporte Técnico.

5. Estableció dentro de la organización la política de capacitación continua a los equipos de trabajo. 10 % - NO - 0% - La capacitación aparece solo como función de Recursos Humanos, pero no se establece como política con acciones, periodicidad o responsables.

6. Reconoció la importancia del factor humano en el cumplimiento de las metas establecidas por la organización. 10 % - SÍ - 10% - Se refleja en la conclusión, al señalar que la ejecución responsable de las funciones impulsa el desarrollo institucional.

7. Utilizó herramientas para generar motivación en el área de desempeño a través de incentivos en función de los resultados. 10 % - NO - 0% - No se evidencia ninguna herramienta de motivación ni esquema de incentivos por resultados en el documento.

8. Usó la plataforma virtual para el envío de la evidencia y formato solicitado. 10 % - SÍ - 10% - Evidencia entregada en formato PDF por la plataforma, conforme a lo solicitado.

Porcentaje total obtenido: 80% (80 puntos sobre 100).`;

const r = extraerListaEnProsa(respuesta);
check("Detecta la lista escrita en parrafos", Boolean(r));

if (r) {
  const cl = r.checklist;
  console.log("\n  Criterios reconstruidos: " + cl.items.length);
  for (const it of cl.items) {
    const marca = it.valores.cumple_si ? "CUMPLE SÍ " + it.valores.cumple_si : "CUMPLE NO " + it.valores.cumple_no;
    console.log(`    ${it.descripcion.slice(0, 52).padEnd(54)} ${marca}`);
  }
  console.log("  Resumen: " + cl.resumen.map((x) => `${x.etiqueta}=${x.valor}`).join(" | "));

  check("Reconstruye al menos 4 criterios", cl.items.length >= 4, cl.items.length + " items");
  check("El criterio 4 quedo en CUMPLE SÍ", /[✓✔☑]/.test(cl.items[0].valores.cumple_si), JSON.stringify(cl.items[0].valores));
  check("El criterio 5 quedo en CUMPLE NO", /[✓✔☑]/.test(cl.items[1].valores.cumple_no), JSON.stringify(cl.items[1].valores));
  check("Conserva el peso del criterio", cl.items[0].descripcion.includes("10%"), cl.items[0].descripcion.slice(-12));
  check("Conserva la observacion", cl.items[0].observacion.includes("Gestor de Experiencia"), cl.items[0].observacion.slice(0, 50));
  check("Quita las lineas convertidas del texto", !r.texto.includes("Gestor de Experiencia"));
  check("Conserva el saludo", r.texto.includes("Hola Carlos"));

  // ¿La aplicacion la dibuja como tabla de rubrica?
  const html = render(cl, null);
  console.log("\n=== TABLA QUE DIBUJA LA APLICACION ===");
  console.log(html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 500) + "...");
  check("Se dibuja como tabla de rubrica", html.includes("tabla-verificacion"));
  check("Con columnas CUMPLE SÍ / CUMPLE NO", html.includes(">CUMPLE SÍ<") && html.includes(">CUMPLE NO<"));
  check("Muestra las casillas marcadas", html.includes("marca-si"));
  check("Ya no queda la calificacion como parrafos", !html.includes("10 % - SÍ -"));
}

/* No debe activarse con prosa normal */
check(
  "No se activa con texto normal",
  extraerListaEnProsa("Hola Ana, tu informe está bien. Te sugiero mejorar el análisis de causas y revisar las cifras del conteo cíclico.") === null
);

/* No debe activarse si solo hay porcentajes sin veredicto */
check(
  "No se activa sin veredictos SÍ/NO",
  extraerListaEnProsa("El nivel de servicio fue 94,2 % frente a una meta de 96 %.\nEl costo subió 7 % este trimestre.\nLa exactitud llegó a 99,1 %.\nSe recibieron 1240 unidades.") === null
);

console.log(`\n${fallos === 0 ? "TODO OK" : fallos + " FALLO(S)"}`);
process.exit(fallos ? 1 : 0);
