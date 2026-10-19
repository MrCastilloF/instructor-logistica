# Contrato de interfaz — rediseño de la landing/aplicación

Documento de coordinación entre el diseño visual (`public/index.html`, `public/estilos.css`)
y la lógica del navegador (`public/app.js`). **No se modifica el alcance funcional**:
el backend (`lib/`) y el flujo son los de la aplicación original.

## 1. Reglas técnicas obligatorias

- Sin frameworks, sin build, sin CDN, sin fuentes externas, sin imágenes remotas.
  La aplicación debe funcionar 100 % offline (solo sirve archivos locales `public/`).
- HTML5 semántico, `lang="es"`, `meta viewport`, `meta description`.
- CSS moderno (variables, grid, flex, `clamp()`, `@media`, `prefers-reduced-motion`).
- JS ES2020 en un único archivo `public/app.js`, sin dependencias.
- Referencias con versión anti-caché: `/estilos.css?v=6` y `/app.js?v=6`.
- Iconografía: SVG en línea o emojis ya usados por la app. Nada de archivos de iconos externos.
- Colores con contraste AA como mínimo para texto.
- `hidden` (atributo) para mostrar/ocultar paneles; no `display:none` en línea.

## 2. IDs obligatorios (la lógica los busca por `id`)

### Estado del servicio
| id | elemento |
|---|---|
| `estadoServicio` | contenedor de la píldora de estado |
| `puntoEstado` | punto de color (recibe clases `ok` / `malo`) |
| `textoEstado` | texto del estado ("Comprobando…", modelo, "Servidor detenido"…) |

### Paso 1 — documento
| id | elemento |
|---|---|
| `zonaDocumento` | zona de arrastre (rol botón, `tabindex="0"`, `aria-label`) |
| `archivoDocumento` | `<input type="file" hidden>` con el `accept` original completo |
| `archivoElegido` | tarjeta del archivo elegido (`hidden` al inicio) |
| `archivoIcono` | icono/emoji del archivo |
| `archivoNombre` | nombre del archivo |
| `archivoMeta` | peso legible |
| `quitarArchivo` | botón quitar |

### Paso 2 — instrucciones
| id | elemento |
|---|---|
| `instruccionesTexto` | `<textarea>` con el placeholder original |
| `archivoInstrucciones` | `<input type="file" hidden>` con el `accept` original |
| `chipInstrucciones` | chip del archivo de instrucciones (`hidden` al inicio) |
| `chipInstruccionesNombre` | nombre dentro del chip |
| `quitarInstrucciones` | botón quitar instrucciones |
| `contexto` | `<input type="text">` de contexto adicional (dentro de `<details>`) |

### Acciones
| id | elemento |
|---|---|
| `botonEvaluar` | botón principal, `disabled` al inicio |
| `botonLimpiar` | botón "Limpiar todo" |

### Progreso
| id | elemento |
|---|---|
| `panelProgreso` | panel (`hidden` al inicio) |
| `barraRelleno` | relleno de la barra (ancho vía `style.width`) |
| `progresoMensaje` | mensaje actual |
| `progresoLista` | `<ul>` de eventos |

### Error
| id | elemento |
|---|---|
| `panelError` | panel (`hidden` al inicio) |
| `textoError` | texto/HTML del error |

### Resultado
| id | elemento |
|---|---|
| `panelResultado` | panel (`hidden` al inicio) |
| `resultadoTexto` | contenedor de la retroalimentación |
| `contenedorChecklist` | contenedor de la tabla de verificación |
| `resultadoDetalles` | detalles técnicos (dentro de `<details>`) |
| `botonCopiar` | botón Copiar |
| `botonDescargar` | botón Descargar |

## 3. Clases de estado que usa la lógica

- `.arrastrando` en `#zonaDocumento` durante `dragenter`/`dragover`.
- `.punto.ok` / `.punto.malo` en `#puntoEstado`.
- Tabla de verificación (obligatorias, las verifica `tests/test-tabla-render.js`):
  `tabla-verificacion`, `col-num`, `col-centro`, `celda-descripcion`, `celda-observacion`,
  `marca-si`, `marca-no`, `marca-vacia`, `marca-valor`, `peso-criterio`, `chip-resultado`,
  `vc-bien`, `vc-medio`, `vc-malo`, `vc-neutro`, `celda-total`, `celda-total-etiqueta`,
  `total-bien`, `total-medio`, `total-malo`, `puntaje-final`, `calculado`, `nota-final`,
  `checklist`, `checklist-titulo`, `checklist-escala`, `checklist-resumen`, `checklist-aviso`.
- La lógica puede agregar clases extra de layout; **no puede renombrar las anteriores**.

## 4. Generación de la tabla (no romper la extracción de tests)

`tests/test-tabla-render.js` extrae por expresión regular las funciones
`function calcularPuntajeFinal`, `function claseResultado` y `function renderChecklist`
de `public/app.js` (deben ser funciones de nivel superior y cerrar con `}` en columna 0
seguido de salto de línea). Además usan `globalThis.__IL_EL` como `el` y un DOM mínimo
(`document.createElement`, `document.createTextNode`, `appendChild`, `textContent`,
`className`, `classList`, `colSpan`). **No usar** en esas tres funciones APIs que ese DOM
mínimo no tenga (por ejemplo `innerHTML` con HTML, `insertAdjacentHTML`, `querySelector`,
`dataset`, `setAttribute`).

`tests/test-version-servida.js` exige que el `app.js` servido contenga los textos
`checklist.columnas`, `tabla-verificacion` y `calcularPuntajeFinal`, y que el CSS
contenga `.tabla-verificacion` y `.marca-si`.

## 5. Estructura de la página (landing + aplicación)

Orden sugerido, con contenido **real** (fuente: `README.md`, `docs/guia-completa.md` y textos de la UI original):

1. Enlace "saltar al contenido" y header fijo con marca + navegación por anclas
   (`#como-funciona`, `#evaluador`, `#formatos`, `#retroalimentacion`) + píldora de estado.
2. **Hero**: nombre "Instructor de Logística", lema "Sube tu trabajo y recibe
   retroalimentación como de un instructor real", CTA "Evaluar mi trabajo" (ancla al
   evaluador) y CTA secundario "Ver formatos admitidos". Sin métricas, testimonios ni logos
   inventados.
3. **Cómo funciona**: los 3 pasos reales del LEEME (subir documento; escribir o subir
   instrucciones; pulsar "Evaluar mi trabajo" y leer/copiar/descargar).
4. **Evaluador** (la aplicación): pasos 1 y 2 + acciones + progreso + error + resultado.
5. **Formatos admitidos**: categorías, extensiones y cómo se analiza (tabla del LEEME).
6. **Qué analiza**: texto, imágenes, datos de contexto; multimodal; cupos reales
   (hasta 22 imágenes por evaluación; 16 incrustadas y 14 páginas de PDF compartiendo cupo;
   PDF hasta 120 páginas). Solo descarta elementos decorativos (<32×32, líneas, repetidas).
7. **Estructura de la retroalimentación**: los 5 bloques reales + la lista de verificación
   final y su funcionamiento (respeta el formato de las instrucciones, totales coloreados,
   cálculo de respaldo, copiar/descargar en texto alineado).
8. **Privacidad / notas técnicas**: procesamiento local, archivos enviados al modelo solo
   para generar la retroalimentación, el audio de video no se transcribe, formatos antiguos
   de Office pueden leerse parcialmente, Node.js 22.13+.
9. Footer con la nota de privacidad original y enlace al repositorio de GitHub
   (`https://github.com/MrCastilloF/instructor-logistica`, se confirma al publicar).

Mantener el mensaje de `noscript` y el aviso de "La aplicación necesita JavaScript".

## 6. Textos que deben conservarse (no inventar)

- Título: "Instructor de Logística".
- Lema: "Sube tu trabajo y recibe retroalimentación como de un instructor real".
- Paso 1: "Sube el documento o material a evaluar" + "No tienes que escribir ni copiar nada
  del documento. Solo selecciónalo o arrástralo aquí."
- Paso 2: "Indica cómo debe evaluarse" + "Escribe las instrucciones o súbelas como archivo
  (PDF, Word, Excel, imagen…). Si dejas esto vacío, se evaluará con criterios generales de
  logística."
- Botón principal: "Evaluar mi trabajo"; limpiar: "Limpiar todo".
- Footer: "Funciona en tu equipo. Los archivos se procesan localmente y se envían al modelo
  de IA solo para generar la retroalimentación."
- Placeholder del textarea: el original (rúbrica de ejemplo con 30 %/40 %/30 % y nota 0 a 5).
- Puede reescribirse la redacción de apoyo del rediseño siempre que **no** invente
  capacidades, cifras, procesos ni datos logísticos nuevos.

## 7. Dirección visual (alto impacto, sin ruido)

- Estética: producto SaaS profesional de logística/educación. Fondo claro cálido con
  superficies blancas, hero oscuro con degradado y retícula sutil; acento verde-teal;
  detalles ámbar para puntajes. Sin sombras duras ni gradientes multicolor.
- Tipografía: pila del sistema, títulos con `clamp()` y tracking negativo; jerarquía clara.
- Microinteracciones: hover/focus, elevación sutil, revelado al hacer scroll solo con CSS
  (o `IntersectionObserver` en `app.js`, opcional), respetando `prefers-reduced-motion`.
- Tabla de verificación legible y con desplazamiento horizontal en móvil.
- Responsive real desde 360 px; sin desbordes horizontales de la página.
