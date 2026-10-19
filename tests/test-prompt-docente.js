"use strict";
/**
 * Prueba definitiva: usa el PROMPT COMPLETO del docente (4 pasos) y verifica
 * que la tabla de rubrica se genere y se pueda dibujar.
 * Uso: node tests/test-prompt-docente.js
 */
const fs = require("fs");
const path = require("path");
const { extract } = require("../lib/extract");
const { evaluate } = require("../lib/llm");
const config = require("../lib/config");
const render = require("./render-helper");

const PROMPT_DOCENTE = `Actúa como instructor del SENA en Procesos Logísticos. Evalúa la actividad de aprendizaje entregada por el aprendiz.

PASO 1 – Extrae el nombre del aprendiz: mira todo el informe completo (portada, encabezado, pie de página, cualquier parte visible) y extrae automáticamente el nombre propio del aprendiz sin apellidos. Si aparece el nombre de una empresa, sigue buscando en otras partes del documento hasta encontrar el nombre de la persona. Si definitivamente no aparece ningún nombre propio de persona, usa "Hola" como referencia. Usa ese nombre real en el saludo y en toda la retroalimentación. Opina sobre conceptos propios del documento para mostrar que realmente lo viste.

PASO 2 – Criterio de calificación: Aplica un criterio generoso y formativo, propio de la educación para el trabajo del SENA: valora el esfuerzo, el intento y el proceso del aprendiz, no solo la perfección del resultado. Si el aprendiz abordó el tema, lo presentó de forma estructurada y entregó la evidencia, parte de una base mínima de 80% en el total. Evalúa únicamente lo que establecen los indicadores de la rúbrica y para el punto 8 de la rubrica que pregunta "Usó la plataforma virtual para el envío de la evidencia y formato solicitado." Califíquelo siempre con 10%.

PASO 3 – Retroalimentación en prosa (máximo tres párrafos): Saluda de forma breve y cercana al aprendiz usando su nombre propio extraído del documento (máximo dos frases). Haz un comentario general sobre el documento señalando de manera global qué se está haciendo bien. Incluye una o dos ideas generales de mejora escritas en primera persona, basadas únicamente en lo que los indicadores de la rúbrica evalúan, usando expresiones como "Te sugiero…", "Podrías fortalecer…". Al final del texto, agrega una frase de agradecimiento sincero y termina con palabras de ánimo. Sin listas, sin viñetas, sin puntos enumerados; todo debe leerse como un comentario fluido, cálido y natural.

PASO 4 – Tabla de calificación: Presenta la calificación en una tabla con la siguiente estructura, evaluando directamente cada indicador. Marca "CUMPLE SÍ" o "CUMPLE NO" y agrega el porcentaje parcial obtenido en la casilla según corresponda, con observaciones breves y concretas. Al final, incluye en la tabla explícitamente el porcentaje total obtenido.

LISTA DE VERIFICACIÓN
No. | VARIABLES/INDICADORES DE LOGRO | CUMPLE SÍ | CUMPLE NO | Observaciones
1. Identificó la jerarquía de los cargos en el organigrama institucional. 20 %
2. Interpretó las necesidades del departamento humano de conformidad con las políticas de la organización. 20 %
3. Describió los perfiles para cada cargo requeridos en el departamento logístico, de acuerdo con sus características operativas y organizacionales. 10 %
4. Definió las funciones y responsabilidades de los cargos en el área de operaciones logísticas. 10 %
5. Estableció dentro de la organización la política de capacitación continua a los equipos de trabajo. 10 %
6. Reconoció la importancia del factor humano en el cumplimiento de las metas establecidas por la organización. 10 %
7. Utilizó herramientas para generar motivación en el área de desempeño a través de incentivos en función de los resultados. 10 %
8. Usó la plataforma virtual para el envío de la evidencia y formato solicitado. 10 %`;

(async () => {
  let fallos = 0;
  const check = (n, c, extra = "") => {
    console.log(`  ${c ? "OK   " : "FALLA"} ${n}${extra ? " -> " + extra : ""}`);
    if (!c) fallos++;
  };

  const archivo = path.join(__dirname, "fixtures", "informe_operaciones.docx");
  const { content } = await extract(archivo, "informe_operaciones.docx", path.join(config.tmp, "docente"), () => {});
  const r = await evaluate({ instructions: PROMPT_DOCENTE, content, onProgress: (e) => console.log("   ·", e.message) });

  console.log("\n=== COMPROBACIONES ===");
  check("Se genero la lista de verificacion", Boolean(r.checklist));
  check("No quedo markdown en la prosa (sin '|')", !r.text.includes("|"));
  check("No quedo el sintoma '10 % - SÍ - 10%' en la prosa", !/\d+\s*%\s*[-–]\s*(SÍ|SI|NO)\s*[-–]/i.test(r.text));

  if (!r.checklist) {
    console.log("\n--- FINAL DE LA PROSA (no hubo tabla) ---");
    console.log(r.text.slice(-1200));
  } else {
    const cl = r.checklist;
    console.log("\n  Columnas: " + cl.columnas.map((c) => c.titulo).join(" | "));
    console.log("  Criterios: " + cl.items.length);
    for (const it of cl.items) {
      const marcas = cl.columnas.map((c) => (it.valores[c.clave] ? `${c.titulo}=${it.valores[c.clave]}` : "")).filter(Boolean).join(" ");
      console.log(`    ${it.descripcion.slice(0, 56).padEnd(58)} ${marcas}`);
    }
    if (cl.resumen.length) console.log("  Resumen: " + cl.resumen.map((x) => `${x.etiqueta}=${x.valor}`).join(" | "));
    console.log("  Total: " + JSON.stringify(cl.total));

    check("Respeto los 8 indicadores de la rubrica", cl.items.length === 8, cl.items.length + " items");
    check("Columnas CUMPLE SÍ / CUMPLE NO", /CUMPLE\s*S[ÍI]/i.test(cl.columnas.map((c) => c.titulo).join(" ")));
    check("Cada criterio quedo marcado", cl.items.every((it) => cl.columnas.some((c) => it.valores[c.clave])));
    check("Conserva la redaccion de la rubrica", cl.items.some((i) => /jerarquía de los cargos/i.test(i.descripcion)));
    check("Punto 8 calificado con 10% (instruccion del docente)",
      /10/.test(cl.items[7].valores[cl.columnas[0].clave] || cl.items[7].valores[cl.columnas[1].clave] || ""),
      JSON.stringify(cl.items[7].valores));
    // El peso vive en la descripcion del criterio; si no, se busca en las casillas.
    const pesoDe = (it) => {
      const enDesc = String(it.descripcion || "").match(/(\d{1,3})\s*%/);
      if (enDesc) return Number(enDesc[1]);
      for (const c of cl.columnas) {
        const m = String(it.valores[c.clave] || "").match(/(\d{1,3})\s*%/);
        if (m) return Number(m[1]);
      }
      return 0;
    };
    const sumaPesos = cl.items.reduce((a, it) => a + pesoDe(it), 0);
    check("Los pesos suman 100%", sumaPesos === 100, sumaPesos + "%");

    /* --- Renderizado real --- */
    console.log("\n=== TABLA QUE DIBUJA LA APLICACION ===");
    const html = render(cl, r.checklistAviso);
    const limpio = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    console.log(limpio.slice(0, 700) + "...");
    check("El HTML tiene la tabla de rubrica", html.includes("tabla-verificacion"));
    check("Muestra el título LISTA DE VERIFICACIÓN", /Lista de verificaci/i.test(html));
    check("Se ve el puntaje final", html.includes("puntaje-final"));
    const m = html.match(/puntaje-final[^>]*>([^<]+)</);
    console.log("  Puntaje final mostrado: " + (m ? m[1] : "(ninguno)"));
  }

  console.log(`\n${fallos === 0 ? "TODO OK" : fallos + " FALLO(S)"}`);
  process.exit(fallos ? 1 : 0);
})().catch((e) => {
  console.error("ERROR:", e.message);
  process.exit(1);
});
