"use strict";
/**
 * Capturas headless de la landing mediante Chrome/Edge y el protocolo CDP,
 * usando el WebSocket nativo de Node (>= 22). Sin dependencias npm.
 *
 * Hace todo el flujo solo:
 *   1. Arranca lib/server.js en un puerto libre (PORT + NO_OPEN=1).
 *   2. Lanza Chrome/Edge en headless con un puerto de depuracion.
 *   3. Se conecta por CDP, navega a la pagina y espera a que cargue.
 *   4. Captura escritorio 1440x1000 (pagina completa) -> docs/capturas/landing-escritorio.png
 *      y movil 390x844 @2x (viewport)                -> docs/capturas/landing-movil.png
 *   5. Comprueba desbordes horizontales, titulo, secciones visibles y errores
 *      de consola (Runtime.consoleAPICalled + Runtime.exceptionThrown).
 *   6. Cierra Chrome y el servidor y sale con codigo 1 si algo falla.
 *
 * Uso: node tests/capturar-pantallas.js
 */
const fs = require("fs");
const os = require("os");
const net = require("net");
const path = require("path");
const { spawn, spawnSync } = require("child_process");

const RAIZ = path.join(__dirname, "..");
const DIR_CAPTURAS = path.join(RAIZ, "docs", "capturas");
const RUTA_ESCRITORIO = path.join(DIR_CAPTURAS, "landing-escritorio.png");
const RUTA_MOVIL = path.join(DIR_CAPTURAS, "landing-movil.png");

const dormir = (ms) => new Promise((resolver) => setTimeout(resolver, ms));

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

/* ----------------------------- Procesos ---------------------------------- */

let procesoNavegador = null;
let procesoServidor = null;
let perfilTemporal = null;
let cdp = null;

function esperarFin(proceso, tiempoMaxMs) {
  if (!proceso || proceso.exitCode !== null) return Promise.resolve(true);
  return new Promise((resolver) => {
    const temporizador = setTimeout(() => {
      proceso.removeListener("exit", alSalir);
      resolver(false);
    }, tiempoMaxMs);
    function alSalir() {
      clearTimeout(temporizador);
      resolver(true);
    }
    proceso.once("exit", alSalir);
  });
}

/** Limpieza de emergencia si el script termina de forma inesperada. */
function limpiezaSincrona() {
  if (procesoNavegador && procesoNavegador.exitCode === null && procesoNavegador.pid) {
    try {
      spawnSync("taskkill", ["/PID", String(procesoNavegador.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
    } catch {
      /* nada que hacer */
    }
  }
  if (procesoServidor && procesoServidor.exitCode === null) {
    try {
      procesoServidor.kill();
    } catch {
      /* nada que hacer */
    }
  }
}
process.on("exit", limpiezaSincrona);

function puertoLibre() {
  return new Promise((resolver, rechazar) => {
    const servidor = net.createServer();
    servidor.unref();
    servidor.once("error", rechazar);
    servidor.listen(0, "127.0.0.1", () => {
      const puerto = servidor.address().port;
      servidor.close((error) => (error ? rechazar(error) : resolver(puerto)));
    });
  });
}

/* --------------------------- Navegador ----------------------------------- */

function buscarNavegador() {
  const candidatos = [
    { nombre: "Chrome", ruta: process.env.CHROME_PATH },
    { nombre: "Chrome", ruta: path.join(process.env.ProgramFiles || "C:\\Program Files", "Google", "Chrome", "Application", "chrome.exe") },
    { nombre: "Chrome", ruta: path.join(process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)", "Google", "Chrome", "Application", "chrome.exe") },
    { nombre: "Chrome", ruta: path.join(process.env.LOCALAPPDATA || "", "Google", "Chrome", "Application", "chrome.exe") },
    { nombre: "Edge", ruta: process.env.EDGE_PATH },
    { nombre: "Edge", ruta: path.join(process.env.ProgramFiles || "C:\\Program Files", "Microsoft", "Edge", "Application", "msedge.exe") },
    { nombre: "Edge", ruta: path.join(process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)", "Microsoft", "Edge", "Application", "msedge.exe") },
    { nombre: "Edge", ruta: path.join(process.env.LOCALAPPDATA || "", "Microsoft", "Edge", "Application", "msedge.exe") },
  ];
  for (const candidato of candidatos) {
    if (candidato.ruta && fs.existsSync(candidato.ruta)) return candidato;
  }
  return null;
}

/* ------------------------------ Servidor --------------------------------- */

async function arrancarServidor() {
  const puertoPedido = await puertoLibre();
  procesoServidor = spawn(process.execPath, [path.join(RAIZ, "lib", "server.js")], {
    env: { ...process.env, PORT: String(puertoPedido), NO_OPEN: "1", HOST: "127.0.0.1" },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  let salida = "";
  const acumular = (dato) => {
    salida += dato.toString("utf8");
    if (salida.length > 20000) salida = salida.slice(-20000);
  };
  procesoServidor.stdout.on("data", acumular);
  procesoServidor.stderr.on("data", acumular);

  const t0 = Date.now();
  while (Date.now() - t0 < 25000) {
    if (procesoServidor.exitCode !== null) {
      throw new Error("El servidor termino antes de tiempo:\n" + salida.slice(-1200));
    }
    const coincidencia = salida.match(/http:\/\/127\.0\.0\.1:(\d+)/);
    const puertos = coincidencia
      ? [Number(coincidencia[1])]
      : [puertoPedido, puertoPedido + 1, puertoPedido + 2];
    for (const puerto of puertos) {
      try {
        const respuesta = await fetch(`http://127.0.0.1:${puerto}/api/estado`);
        if (respuesta.ok) return { base: `http://127.0.0.1:${puerto}`, puerto };
      } catch {
        /* aun no escucha */
      }
    }
    await dormir(200);
  }
  throw new Error("El servidor no respondio a tiempo:\n" + salida.slice(-1200));
}

/* ------------------------- Cliente CDP (WebSocket) ------------------------ */

class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.siguienteId = 0;
    this.pendientes = new Map();
    this.oyentes = new Map();
    this.cerrado = false;
    ws.addEventListener("message", (evento) => this.alRecibir(evento.data));
    ws.addEventListener("close", () => {
      this.cerrado = true;
      for (const pendiente of this.pendientes.values()) {
        clearTimeout(pendiente.temporizador);
        pendiente.rechazar(new Error("La conexion CDP se cerro"));
      }
      this.pendientes.clear();
    });
  }

  static async conectar(url, tiempoMaxMs = 15000) {
    const ws = new WebSocket(url);
    await new Promise((resolver, rechazar) => {
      const temporizador = setTimeout(() => rechazar(new Error("Tiempo agotado abriendo el WebSocket CDP")), tiempoMaxMs);
      ws.addEventListener(
        "open",
        () => {
          clearTimeout(temporizador);
          resolver();
        },
        { once: true }
      );
      ws.addEventListener(
        "error",
        () => {
          clearTimeout(temporizador);
          rechazar(new Error("No se pudo abrir el WebSocket CDP"));
        },
        { once: true }
      );
    });
    return new Cdp(ws);
  }

  alRecibir(datos) {
    let texto = datos;
    if (typeof datos !== "string") {
      try {
        texto = Buffer.from(datos).toString("utf8");
      } catch {
        return;
      }
    }
    let mensaje;
    try {
      mensaje = JSON.parse(texto);
    } catch {
      return;
    }
    if (mensaje.id && this.pendientes.has(mensaje.id)) {
      const pendiente = this.pendientes.get(mensaje.id);
      this.pendientes.delete(mensaje.id);
      clearTimeout(pendiente.temporizador);
      if (mensaje.error) {
        pendiente.rechazar(new Error(`${mensaje.error.message || "error CDP"}${mensaje.error.code ? ` (${mensaje.error.code})` : ""}`));
      } else {
        pendiente.resolver(mensaje.result || {});
      }
      return;
    }
    const oyentes = mensaje.method ? this.oyentes.get(mensaje.method) : null;
    if (oyentes) {
      for (const oyente of oyentes) {
        try {
          oyente(mensaje.params || {});
        } catch {
          /* un oyente no debe romper la captura */
        }
      }
    }
  }

  alEvento(metodo, funcion) {
    if (!this.oyentes.has(metodo)) this.oyentes.set(metodo, []);
    this.oyentes.get(metodo).push(funcion);
  }

  enviar(metodo, params = {}, tiempoMaxMs = 20000) {
    if (this.cerrado) return Promise.reject(new Error("La conexion CDP esta cerrada"));
    const id = ++this.siguienteId;
    return new Promise((resolver, rechazar) => {
      const temporizador = setTimeout(() => {
        this.pendientes.delete(id);
        rechazar(new Error(`Tiempo agotado en CDP ${metodo}`));
      }, tiempoMaxMs);
      this.pendientes.set(id, { resolver, rechazar, temporizador });
      try {
        this.ws.send(JSON.stringify({ id, method: metodo, params }));
      } catch (error) {
        clearTimeout(temporizador);
        this.pendientes.delete(id);
        rechazar(error);
      }
    });
  }

  cerrar() {
    try {
      this.ws.close();
    } catch {
      /* nada que hacer */
    }
  }
}

async function evaluar(expresion, opciones = {}) {
  const { awaitPromise = false, tiempoMaxMs = 20000 } = opciones;
  const respuesta = await cdp.enviar(
    "Runtime.evaluate",
    { expression: expresion, returnByValue: true, awaitPromise, userGesture: false },
    tiempoMaxMs
  );
  if (respuesta.exceptionDetails) {
    const detalle =
      (respuesta.exceptionDetails.exception && respuesta.exceptionDetails.exception.description) ||
      respuesta.exceptionDetails.text ||
      "error de evaluacion";
    throw new Error("Fallo al evaluar en la pagina: " + detalle);
  }
  return respuesta.result ? respuesta.result.value : undefined;
}

async function esperarObjetivoDepuracion(puerto, salidaNavegador, tiempoMaxMs = 25000) {
  const t0 = Date.now();
  let ultimoError = "";
  while (Date.now() - t0 < tiempoMaxMs) {
    try {
      const respuesta = await fetch(`http://127.0.0.1:${puerto}/json/list`);
      const lista = await respuesta.json();
      const pagina = lista.find((objetivo) => objetivo.type === "page" && objetivo.webSocketDebuggerUrl);
      if (pagina) return pagina.webSocketDebuggerUrl;
    } catch (error) {
      ultimoError = error.message;
    }
    await dormir(200);
  }
  throw new Error(
    "Chrome no expuso ningun objetivo de depuracion." +
      (ultimoError ? " Ultimo error: " + ultimoError : "") +
      (salidaNavegador ? "\nSalida del navegador:\n" + salidaNavegador.slice(-1500) : "")
  );
}

/* --------------------------- Pagina y capturas ---------------------------- */

async function esperarPaginaLista(tiempoMaxMs = 25000) {
  const t0 = Date.now();
  while (Date.now() - t0 < tiempoMaxMs) {
    try {
      const estado = await evaluar(
        '({ listo: document.readyState, url: location.href, boton: Boolean(document.getElementById("botonEvaluar")) })'
      );
      if (estado && estado.listo === "complete" && estado.boton) return estado;
    } catch {
      /* la pagina aun esta navegando */
    }
    await dormir(150);
  }
  return null;
}

async function esperarFuentes() {
  try {
    await evaluar("document.fonts ? document.fonts.ready.then(() => true) : true", {
      awaitPromise: true,
      tiempoMaxMs: 10000,
    });
  } catch {
    /* las fuentes del sistema no bloquean la captura */
  }
}

async function congelarAnimaciones() {
  try {
    await evaluar(
      `(() => {
        if (document.getElementById("__qa_congelar")) return true;
        const estilo = document.createElement("style");
        estilo.id = "__qa_congelar";
        estilo.textContent = "*,*::before,*::after{animation-duration:0s!important;animation-delay:0s!important;transition-duration:0s!important;transition-delay:0s!important;scroll-behavior:auto!important}";
        document.head.appendChild(estilo);
        return true;
      })()`
    );
  } catch {
    /* si no se puede, la captura sale igual */
  }
}

/** Recorre la pagina para disparar las animaciones de revelado, y vuelve arriba. */
async function recorrerPagina() {
  await evaluar(
    `(async () => {
      const paso = Math.max(320, Math.floor(window.innerHeight * 0.7));
      const alto = document.documentElement.scrollHeight;
      for (let y = 0; y < alto; y += paso) {
        window.scrollTo(0, y);
        await new Promise((r) => setTimeout(r, 45));
      }
      window.scrollTo(0, 0);
      await new Promise((r) => setTimeout(r, 300));
      return true;
    })()`,
    { awaitPromise: true, tiempoMaxMs: 30000 }
  );
}

async function datosDeLaPagina() {
  return await evaluar(
    `(() => {
      const secciones = [...document.querySelectorAll("main section")].filter((seccion) => {
        const estilo = getComputedStyle(seccion);
        return estilo.display !== "none" && estilo.visibility !== "hidden" && seccion.getBoundingClientRect().height > 0;
      });
      const desbordes = [...document.querySelectorAll("body *")]
        .filter((nodo) => {
          const caja = nodo.getBoundingClientRect();
          if (!(caja.width > 0 && caja.right > window.innerWidth + 1)) return false;
          if (getComputedStyle(nodo).position === "fixed") return false;
          // Un contenedor con scroll propio (p. ej. la tabla en movil) no es un desborde de la pagina.
          let padre = nodo.parentElement;
          while (padre && padre !== document.body) {
            const estiloPadre = getComputedStyle(padre);
            if (/(auto|scroll)/.test(estiloPadre.overflowX) && padre.scrollWidth > padre.clientWidth + 1) return false;
            padre = padre.parentElement;
          }
          return true;
        })
        .slice(0, 6)
        .map((nodo) => {
          const clase = typeof nodo.className === "string" && nodo.className ? "." + nodo.className.split(/\\s+/)[0] : "";
          return (nodo.id ? "#" + nodo.id : nodo.tagName.toLowerCase() + clase);
        });
      const h1 = document.querySelector("h1");
      const estado = document.getElementById("textoEstado");
      return {
        titulo: document.title,
        url: location.href,
        h1: h1 ? h1.textContent.trim() : "",
        textoEstado: estado ? estado.textContent.trim() : "",
        scrollWidth: document.documentElement.scrollWidth,
        bodyScrollWidth: document.body ? document.body.scrollWidth : 0,
        innerWidth: window.innerWidth,
        innerHeight: window.innerHeight,
        devicePixelRatio: window.devicePixelRatio,
        secciones: secciones.length,
        seccionesIds: secciones.map((seccion) => seccion.id || "(sin id)"),
        desbordes: desbordes,
      };
    })()`,
    { tiempoMaxMs: 30000 }
  );
}

async function capturarPaginaCompleta(rutaDestino, anchoMinimo) {
  const metricas = await cdp.enviar("Page.getLayoutMetrics", {}, 20000);
  const contenido = metricas.cssContentSize || metricas.contentSize || { width: anchoMinimo, height: 1000 };
  const vista = metricas.cssLayoutViewport || metricas.layoutViewport || { clientWidth: anchoMinimo };
  const ancho = Math.max(1, Math.ceil(Math.max(contenido.width, vista.clientWidth)));
  const alto = Math.max(1, Math.ceil(contenido.height));
  const respuesta = await cdp.enviar(
    "Page.captureScreenshot",
    {
      format: "png",
      fromSurface: true,
      captureBeyondViewport: true,
      clip: { x: 0, y: 0, width: ancho, height: alto, scale: 1 },
    },
    90000
  );
  const buffer = Buffer.from(respuesta.data, "base64");
  fs.writeFileSync(rutaDestino, buffer);
  return { ancho, alto, bytes: buffer.length, ...dimensionesPng(buffer) };
}

async function capturarViewport(rutaDestino) {
  const respuesta = await cdp.enviar("Page.captureScreenshot", { format: "png", fromSurface: true }, 60000);
  const buffer = Buffer.from(respuesta.data, "base64");
  fs.writeFileSync(rutaDestino, buffer);
  return { bytes: buffer.length, ...dimensionesPng(buffer) };
}

function dimensionesPng(buffer) {
  if (!buffer || buffer.length < 24 || buffer.readUInt32BE(0) !== 0x89504e47) return {};
  return { anchoPng: buffer.readUInt32BE(16), altoPng: buffer.readUInt32BE(20) };
}

/**
 * Calcula en la pagina el contraste real (WCAG 2.x) de una muestra de textos
 * pequenos y de un barrido por estilos unicos. Devuelve color, fondo, tamano y
 * ratio. Los textos sobre gradientes no se pueden calcular: se informan aparte.
 */
async function analizarContraste() {
  return await evaluar(
    `(() => {
      const aRgb = (texto) => {
        const m = String(texto).match(/rgba?\\(([^)]+)\\)/);
        if (!m) return null;
        const partes = m[1].split(/[,\\s\\/]+/).filter(Boolean).map(Number);
        if (partes.length < 3) return null;
        return { r: partes[0], g: partes[1], b: partes[2], a: partes.length > 3 ? partes[3] : 1 };
      };
      const luminancia = (c) => {
        const canal = (v) => {
          v = v / 255;
          return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
        };
        return 0.2126 * canal(c.r) + 0.7152 * canal(c.g) + 0.0722 * canal(c.b);
      };
      const ratio = (a, b) => {
        const la = luminancia(a);
        const lb = luminancia(b);
        return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
      };
      const mezclar = (frente, fondo) => ({
        r: frente.r * frente.a + fondo.r * (1 - frente.a),
        g: frente.g * frente.a + fondo.g * (1 - frente.a),
        b: frente.b * frente.a + fondo.b * (1 - frente.a),
        a: 1,
      });
      // Separa las capas de background-image de nivel superior (comas fuera de parentesis).
      const dividirCapas = (imagen) => {
        const partes = [];
        let profundidad = 0;
        let inicio = 0;
        for (let i = 0; i < imagen.length; i++) {
          const caracter = imagen[i];
          if (caracter === "(") profundidad++;
          else if (caracter === ")") profundidad--;
          else if (caracter === "," && profundidad === 0) {
            partes.push(imagen.slice(inicio, i).trim());
            inicio = i + 1;
          }
        }
        partes.push(imagen.slice(inicio).trim());
        return partes.filter(Boolean);
      };
      // Superficies de fondo posibles del elemento, de la raiz hacia el. Con
      // degradados se ramifica por cada stop (transparente = no cambia) para
      // quedarse con el peor color de fondo posible; si hay demasiadas
      // combinaciones se usa el promedio de los stops del degradado.
      const superficiesDe = (el, maximo) => {
        const ancestros = [];
        let nodo = el;
        while (nodo && nodo.nodeType === 1) {
          ancestros.push(nodo);
          nodo = nodo.parentElement;
        }
        ancestros.reverse();
        const capas = [];
        for (const ancestro of ancestros) {
          const cs = getComputedStyle(ancestro);
          capas.push({ tipo: "color", color: aRgb(cs.backgroundColor) });
          const imagen = cs.backgroundImage;
          if (imagen && imagen !== "none") {
            const lista = dividirCapas(imagen);
            for (let i = lista.length - 1; i >= 0; i--) {
              const colores = (lista[i].match(/rgba?\\([^)]+\\)/g) || []).map(aRgb).filter(Boolean);
              if (colores.length) capas.push({ tipo: "gradiente", colores: colores });
            }
          }
        }
        let candidatos = [{ r: 255, g: 255, b: 255, a: 1 }];
        for (const capa of capas) {
          if (capa.tipo === "color") {
            if (!capa.color || capa.color.a <= 0) continue;
            candidatos = candidatos.map((fondo) => mezclar(capa.color, fondo));
            continue;
          }
          const colores = capa.colores.filter((color) => color.a > 0.001);
          if (!colores.length) continue;
          const nuevos = [];
          for (const fondo of candidatos) {
            for (const color of colores) nuevos.push(mezclar(color, fondo));
          }
          if (nuevos.length <= maximo) {
            candidatos = nuevos;
          } else {
            let promedio = { r: 0, g: 0, b: 0 };
            for (const color of colores) {
              promedio.r += color.r;
              promedio.g += color.g;
              promedio.b += color.b;
            }
            promedio.r = promedio.r / colores.length;
            promedio.g = promedio.g / colores.length;
            promedio.b = promedio.b / colores.length;
            candidatos = candidatos.map((fondo) =>
              mezclar({ r: promedio.r, g: promedio.g, b: promedio.b, a: 1 }, fondo)
            );
          }
        }
        return candidatos;
      };
      const visible = (el) => {
        const cs = getComputedStyle(el);
        const caja = el.getBoundingClientRect();
        return cs.display !== "none" && cs.visibility !== "hidden" && Number(cs.opacity) > 0.05 && caja.width > 0 && caja.height > 0;
      };
      const selectorUnico = (el) => {
        if (el.id) return "#" + el.id;
        const partes = [];
        let nodo = el;
        while (nodo && nodo.nodeType === 1 && partes.length < 4) {
          let parte = nodo.tagName.toLowerCase();
          if (typeof nodo.className === "string" && nodo.className.trim()) {
            parte += "." + nodo.className.trim().split(/\\s+/).slice(0, 2).join(".");
          }
          if (nodo.parentElement) {
            const hermanos = [...nodo.parentElement.children].filter((h) => h.tagName === nodo.tagName);
            if (hermanos.length > 1) parte += ":nth-of-type(" + (hermanos.indexOf(nodo) + 1) + ")";
          }
          partes.unshift(parte);
          if (nodo.id) {
            partes[0] = "#" + nodo.id;
            break;
          }
          nodo = nodo.parentElement;
        }
        return partes.join(" > ");
      };
      const examinar = (el, etiqueta, selector) => {
        if (!visible(el)) return { etiqueta: etiqueta, selector: selector, oculto: true };
        const cs = getComputedStyle(el);
        const color = aRgb(cs.color);
        if (!color) return { etiqueta: etiqueta, selector: selector, sinColor: true };
        const infoFondo = superficiesDe(el, 48);
        const candidatos = infoFondo;
        let fondo = candidatos[0];
        let valor = 0;
        for (const candidato of candidatos) {
          const texto = mezclar(color, candidato);
          const candidatoRatio = ratio(texto, candidato);
          if (valor === 0 || candidatoRatio < valor) {
            valor = candidatoRatio;
            fondo = candidato;
          }
        }
        const tam = parseFloat(cs.fontSize);
        const peso = Number(cs.fontWeight) || 400;
        const grande = tam >= 24 || (peso >= 700 && tam >= 18.66);
        const minimo = grande ? 3 : 4.5;
        return {
          etiqueta: etiqueta,
          selector: selector,
          muestra: (el.textContent || "").trim().replace(/\\s+/g, " ").slice(0, 60),
          color: cs.color,
          fondo: "rgb(" + Math.round(fondo.r) + ", " + Math.round(fondo.g) + ", " + Math.round(fondo.b) + ")",
          fontSize: cs.fontSize,
          fontWeight: String(peso),
          ratio: Math.round(valor * 100) / 100,
          minimo: minimo,
          cumple: valor >= minimo,
          degradado: candidatos.length > 1,
        };
      };
      const selectores = [
        [".situacion dt", "situacion dt"],
        [".situacion dd", "situacion dd"],
        [".nota-decorativas", "nota decorativas"],
        [".nota-cupos", "nota cupos"],
        [".paso-ayuda", "paso ayuda"],
        [".seccion-intro", "seccion intro"],
        [".archivo-meta", "archivo meta"],
        [".zona-sub", "zona sub"],
        [".zona-formatos", "zona formatos"],
        [".tabla-aviso", "tabla aviso"],
        [".lista-check li", "lista check"],
        [".footer-nota", "footer nota"],
        [".footer-fino", "footer fino"],
        [".checklist-resumen li", "checklist resumen"],
        [".detalles-formulario summary", "resumen detalles"],
        [".celda-observacion", "tabla observacion"],
        [".checklist-escala", "checklist escala"],
        [".antetitulo", "antetitulo"],
        [".tabla-formatos td", "tabla formatos"],
      ];
      const resultados = [];
      const examinados = [];
      for (let i = 0; i < selectores.length; i++) {
        const el = document.querySelector(selectores[i][0]);
        if (!el) {
          resultados.push({ etiqueta: selectores[i][1], ausente: true });
          continue;
        }
        examinados.push(el);
        resultados.push(examinar(el, selectores[i][1], selectores[i][0]));
      }
      const candidatos = [
        ...document.querySelectorAll(
          "main p, main li, main dd, main dt, main small, main summary, footer p, .antetitulo, .seccion-intro, .paso-ayuda, .archivo-meta, .zona-sub, .zona-formatos, .tabla-aviso, .nota-cupos, .nota-decorativas, .checklist-resumen li, .celda-observacion"
        ),
      ];
      const claves = new Set();
      let barridos = 0;
      for (const el of candidatos) {
        if (examinados.indexOf(el) !== -1) continue;
        if (!visible(el)) continue;
        const cs = getComputedStyle(el);
        if (parseFloat(cs.fontSize) > 18) continue; // textos pequenos: umbral AA de texto normal
        const clave = el.tagName + "|" + cs.color + "|" + cs.backgroundColor + "|" + cs.fontSize;
        if (claves.has(clave)) continue;
        claves.add(clave);
        barridos++;
        const clase = typeof el.className === "string" && el.className ? "." + el.className.split(/\\s+/)[0] : "";
        resultados.push(examinar(el, "texto pequeno " + el.tagName.toLowerCase() + clase, selectorUnico(el)));
      }
      return { resultados: resultados, barridos: barridos };
    })()`,
    { tiempoMaxMs: 30000 }
  );
}

/* ------------------- Contraste real por pixeles (CDP) --------------------- */

function parseRgba(texto) {
  const coincidencia = String(texto || "").match(/rgba?\(([^)]+)\)/);
  if (!coincidencia) return null;
  const partes = coincidencia[1].split(/[,\s/]+/).filter(Boolean).map(Number);
  if (partes.length < 3) return null;
  return { r: partes[0], g: partes[1], b: partes[2], a: partes.length > 3 ? partes[3] : 1 };
}

function luminanciaColor(color) {
  const canal = (valor) => {
    const v = valor / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * canal(color.r) + 0.7152 * canal(color.g) + 0.0722 * canal(color.b);
}

function ratioContraste(a, b) {
  const la = luminanciaColor(a);
  const lb = luminanciaColor(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/**
 * Verifica el contraste contra el fondo REAL: hace scroll al elemento, captura
 * un recorte con CDP y en la propia pagina decodifica el PNG en un canvas para
 * obtener el color de fondo dominante (moda de pixeles). Sirve para textos sobre
 * degradados, donde el calculo por estilos no es fiable.
 */
async function verificarPixel(selector) {
  const encontrado = await evaluar(
    `(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return false;
      el.scrollIntoView({ block: "center", inline: "nearest" });
      return true;
    })()`
  );
  if (!encontrado) return null;
  await dormir(150);
  const caja = await evaluar(
    `(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return null;
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return {
        x: r.left + window.scrollX,
        y: r.top + window.scrollY,
        ancho: r.width,
        alto: r.height,
        color: cs.color,
        fontSize: cs.fontSize,
        fontWeight: cs.fontWeight,
        texto: (el.textContent || "").trim().replace(/\\s+/g, " ").slice(0, 60),
      };
    })()`
  );
  if (!caja || caja.ancho < 4 || caja.alto < 4) return null;
  const ancho = Math.min(Math.ceil(caja.ancho), 520);
  const alto = Math.min(Math.ceil(caja.alto), 180);
  const captura = await cdp.enviar(
    "Page.captureScreenshot",
    {
      format: "png",
      fromSurface: true,
      clip: {
        x: Math.max(0, Math.round(caja.x)),
        y: Math.max(0, Math.round(caja.y)),
        width: ancho,
        height: alto,
        scale: 1,
      },
    },
    30000
  );
  const dataUrl = "data:image/png;base64," + captura.data;
  const muestreo = await evaluar(
    `(async () => {
      const imagen = new Image();
      imagen.src = ${JSON.stringify(dataUrl)};
      await imagen.decode();
      const lienzo = document.createElement("canvas");
      lienzo.width = imagen.naturalWidth;
      lienzo.height = imagen.naturalHeight;
      const ctx = lienzo.getContext("2d");
      ctx.drawImage(imagen, 0, 0);
      const datos = ctx.getImageData(0, 0, lienzo.width, lienzo.height).data;
      const conteo = new Map();
      let total = 0;
      for (let i = 0; i < datos.length; i += 4) {
        if (datos[i + 3] < 200) continue;
        const clave = ((datos[i] >> 3) << 10) | ((datos[i + 1] >> 3) << 5) | (datos[i + 2] >> 3);
        conteo.set(clave, (conteo.get(clave) || 0) + 1);
        total++;
      }
      let mejor = 0;
      let mejorCantidad = 0;
      for (const [clave, cantidad] of conteo) {
        if (cantidad > mejorCantidad) {
          mejorCantidad = cantidad;
          mejor = clave;
        }
      }
      return {
        fondo: { r: ((mejor >> 10) & 31) << 3, g: ((mejor >> 5) & 31) << 3, b: (mejor & 31) << 3 },
        coberturaFondo: total ? Math.round((mejorCantidad / total) * 100) : 0,
        pixeles: total,
      };
    })()`,
    { awaitPromise: true, tiempoMaxMs: 30000 }
  );
  const color = parseRgba(caja.color);
  if (!color || !muestreo) return null;
  const fondo = muestreo.fondo;
  const texto = {
    r: color.r * color.a + fondo.r * (1 - color.a),
    g: color.g * color.a + fondo.g * (1 - color.a),
    b: color.b * color.a + fondo.b * (1 - color.a),
  };
  const tam = parseFloat(caja.fontSize);
  const peso = Number(caja.fontWeight) || 400;
  const grande = tam >= 24 || (peso >= 700 && tam >= 18.66);
  const minimo = grande ? 3 : 4.5;
  const valor = ratioContraste(texto, fondo);
  return {
    selector: selector,
    texto: caja.texto,
    color: caja.color,
    fondo: `rgb(${fondo.r}, ${fondo.g}, ${fondo.b})`,
    coberturaFondo: muestreo.coberturaFondo,
    ratio: Math.round(valor * 100) / 100,
    minimo: minimo,
    cumple: valor >= minimo,
  };
}

/* ------------------------------ Limpieza --------------------------------- */

async function limpiarTodo() {
  if (cdp) {
    try {
      await cdp.enviar("Browser.close", {}, 3000);
    } catch {
      /* puede no estar permitido desde la sesion de pagina */
    }
    cdp.cerrar();
    cdp = null;
  }
  if (procesoNavegador) {
    await esperarFin(procesoNavegador, 4000);
    if (procesoNavegador.exitCode === null && procesoNavegador.pid) {
      try {
        spawnSync("taskkill", ["/PID", String(procesoNavegador.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
      } catch {
        /* nada que hacer */
      }
      await esperarFin(procesoNavegador, 2000);
    }
    procesoNavegador = null;
  }
  if (perfilTemporal) {
    for (let intento = 0; intento < 12; intento++) {
      try {
        fs.rmSync(perfilTemporal, { recursive: true, force: true });
        break;
      } catch {
        await dormir(300);
      }
    }
    perfilTemporal = null;
  }
  if (procesoServidor) {
    try {
      procesoServidor.kill();
    } catch {
      /* nada que hacer */
    }
    await esperarFin(procesoServidor, 3000);
    if (procesoServidor.exitCode === null && procesoServidor.pid) {
      try {
        spawnSync("taskkill", ["/PID", String(procesoServidor.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
      } catch {
        /* nada que hacer */
      }
    }
    try {
      procesoServidor.stdout.destroy();
      procesoServidor.stderr.destroy();
    } catch {
      /* nada que hacer */
    }
    procesoServidor = null;
  }
}

/* --------------------------------- Main ---------------------------------- */

(async () => {
  const erroresConsola = [];
  const avisosConsola = [];
  const erroresRed = [];

  try {
    console.log("Capturas headless del rediseno (Chrome/Edge + CDP + WebSocket nativo)\n");

    const navegador = buscarNavegador();
    if (!navegador) {
      console.log("ERROR GENERAL: no se encontro Chrome ni Edge instalado.");
      process.exit(1);
    }
    info(`Navegador: ${navegador.nombre} (${navegador.ruta})`);

    fs.mkdirSync(DIR_CAPTURAS, { recursive: true });

    seccion("Servidor local");
    const servidorInfo = await arrancarServidor();
    check("Servidor arrancado en un puerto libre", true, servidorInfo.base);
    info("NO_OPEN=1: el servidor no abre ninguna ventana del navegador.");

    seccion("Navegador headless y conexion CDP");
    const puertoDepuracion = await puertoLibre();
    perfilTemporal = fs.mkdtempSync(path.join(os.tmpdir(), "il-qa-chrome-"));
    const argumentos = [
      "--headless=new",
      `--remote-debugging-port=${puertoDepuracion}`,
      "--remote-allow-origins=*",
      "--disable-gpu",
      "--hide-scrollbars",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-extensions",
      "--disable-background-networking",
      "--disable-component-update",
      "--disable-sync",
      "--metrics-recording-only",
      "--mute-audio",
      "--window-size=1440,1000",
      `--user-data-dir=${perfilTemporal}`,
      "about:blank",
    ];
    procesoNavegador = spawn(navegador.ruta, argumentos, {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let salidaNavegador = "";
    procesoNavegador.stdout.on("data", (dato) => {
      salidaNavegador = (salidaNavegador + dato.toString("utf8")).slice(-8000);
    });
    procesoNavegador.stderr.on("data", (dato) => {
      salidaNavegador = (salidaNavegador + dato.toString("utf8")).slice(-8000);
    });

    const urlWebSocket = await esperarObjetivoDepuracion(puertoDepuracion, salidaNavegador);
    cdp = await Cdp.conectar(urlWebSocket);
    check("Conexion CDP por el WebSocket nativo de Node", true);

    cdp.alEvento("Runtime.consoleAPICalled", (params) => {
      const texto = (params.args || [])
        .map((arg) => (arg.value !== undefined ? String(arg.value) : arg.description || arg.type || "?"))
        .join(" ");
      if (params.type === "error" || params.type === "assert") erroresConsola.push(texto);
      else if (params.type === "warning") avisosConsola.push(texto);
    });
    cdp.alEvento("Runtime.exceptionThrown", (params) => {
      const detalles = params.exceptionDetails || {};
      const excepcion = detalles.exception || {};
      erroresConsola.push(String(excepcion.description || excepcion.value || detalles.text || "Excepcion sin detalle"));
    });
    cdp.alEvento("Log.entryAdded", (params) => {
      const entrada = params.entry || {};
      if (entrada.level !== "error") return;
      // El navegador pide /favicon.ico automaticamente; su 404 no es un error de la app.
      if (/\/favicon\.ico($|\?)/i.test(entrada.url || "")) return;
      erroresRed.push(`${entrada.source || "?"}: ${entrada.text || ""}${entrada.url ? " (" + entrada.url + ")" : ""}`);
    });

    await cdp.enviar("Page.enable");
    await cdp.enviar("Runtime.enable");
    await cdp.enviar("Log.enable");
    try {
      await cdp.enviar("Emulation.setEmulatedMedia", {
        features: [{ name: "prefers-reduced-motion", value: "reduce" }],
      });
    } catch {
      /* opcional */
    }

    seccion("Escritorio 1440x1000 (pagina completa)");
    await cdp.enviar("Emulation.setDeviceMetricsOverride", {
      width: 1440,
      height: 1000,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await cdp.enviar("Page.navigate", { url: servidorInfo.base + "/" });
    const carga = await esperarPaginaLista();
    check("La pagina cargo completamente", Boolean(carga), carga ? carga.url : "tiempo agotado");
    await esperarFuentes();
    await dormir(300);
    await congelarAnimaciones();
    await recorrerPagina();

    const datosEscritorio = await datosDeLaPagina();
    check("Titulo de la pagina correcto", /Instructor de Logística/i.test(datosEscritorio.titulo), datosEscritorio.titulo);
    check(
      "Viewport de escritorio de 1440 px",
      Math.abs(datosEscritorio.innerWidth - 1440) <= 1,
      datosEscritorio.innerWidth + " px"
    );
    check(
      "Sin desborde horizontal en escritorio",
      datosEscritorio.scrollWidth <= datosEscritorio.innerWidth + 1,
      `scrollWidth=${datosEscritorio.scrollWidth}, innerWidth=${datosEscritorio.innerWidth}`
    );
    check(
      "El <h1> muestra el nombre de la aplicacion",
      /instructor\s*de\s*logística/i.test(datosEscritorio.h1),
      datosEscritorio.h1
    );
    check(
      "Secciones visibles en escritorio (>= 5)",
      datosEscritorio.secciones >= 5,
      `${datosEscritorio.secciones} secciones: ${datosEscritorio.seccionesIds.join(", ")}`
    );
    info(`Estado del servicio en la pagina: "${datosEscritorio.textoEstado}"`);
    if (datosEscritorio.desbordes.length) info("Elementos que sobresalen a la derecha: " + datosEscritorio.desbordes.join(", "));

    const capturaEscritorio = await capturarPaginaCompleta(RUTA_ESCRITORIO, 1440);
    check(
      "Captura de escritorio generada",
      capturaEscritorio.bytes > 10000,
      `${path.relative(RAIZ, RUTA_ESCRITORIO)} (${capturaEscritorio.anchoPng}x${capturaEscritorio.altoPng} px, ${Math.round(capturaEscritorio.bytes / 1024)} KB)`
    );
    check(
      "La captura cubre la pagina completa",
      Math.abs(capturaEscritorio.altoPng - capturaEscritorio.alto) <= 2 && Math.abs(capturaEscritorio.anchoPng - capturaEscritorio.ancho) <= 2,
      `esperado ${capturaEscritorio.ancho}x${capturaEscritorio.alto}, obtenido ${capturaEscritorio.anchoPng}x${capturaEscritorio.altoPng}`
    );

    seccion("Movil 390x844 @2x (viewport)");
    await cdp.enviar("Emulation.setDeviceMetricsOverride", {
      width: 390,
      height: 844,
      deviceScaleFactor: 2,
      mobile: true,
      screenWidth: 390,
      screenHeight: 844,
    });
    await dormir(600);
    await evaluar("window.scrollTo(0, 0); true");
    await dormir(250);

    const datosMovil = await datosDeLaPagina();
    check("Titulo de la pagina correcto en movil", /Instructor de Logística/i.test(datosMovil.titulo), datosMovil.titulo);
    check("Viewport movil de 390 px", Math.abs(datosMovil.innerWidth - 390) <= 1, datosMovil.innerWidth + " px");
    check("Densidad de pixeles 2x en movil", Math.abs(datosMovil.devicePixelRatio - 2) < 0.01, String(datosMovil.devicePixelRatio));
    check(
      "Sin desborde horizontal en movil (390 px)",
      datosMovil.scrollWidth <= datosMovil.innerWidth + 1,
      `scrollWidth=${datosMovil.scrollWidth}, innerWidth=${datosMovil.innerWidth}`
    );
    check(
      "Secciones visibles en movil (>= 5)",
      datosMovil.secciones >= 5,
      `${datosMovil.secciones} secciones: ${datosMovil.seccionesIds.join(", ")}`
    );
    if (datosMovil.desbordes.length) info("Elementos que sobresalen en movil: " + datosMovil.desbordes.join(", "));

    const capturaMovil = await capturarViewport(RUTA_MOVIL);
    check(
      "Captura movil generada (390x844 @2x)",
      capturaMovil.bytes > 10000,
      `${path.relative(RAIZ, RUTA_MOVIL)} (${capturaMovil.anchoPng}x${capturaMovil.altoPng} px, ${Math.round(capturaMovil.bytes / 1024)} KB)`
    );
    check(
      "La captura movil corresponde al viewport de 390x844 a 2x",
      Math.abs(capturaMovil.anchoPng - 780) <= 2 && Math.abs(capturaMovil.altoPng - 1688) <= 2,
      `obtenido ${capturaMovil.anchoPng}x${capturaMovil.altoPng}`
    );

    seccion("Responsive: 768 y 360 px");
    let contrasteEstrecho = null;
    for (const medida of [
      { ancho: 768, alto: 1024 },
      { ancho: 360, alto: 740 },
    ]) {
      await cdp.enviar("Emulation.setDeviceMetricsOverride", {
        width: medida.ancho,
        height: medida.alto,
        deviceScaleFactor: 1,
        mobile: true,
        screenWidth: medida.ancho,
        screenHeight: medida.alto,
      });
      await dormir(500);
      await evaluar("window.scrollTo(0, 0); true");
      await dormir(200);
      const datos = await datosDeLaPagina();
      check(`Viewport aplicado a ${medida.ancho} px`, Math.abs(datos.innerWidth - medida.ancho) <= 1, datos.innerWidth + " px");
      check(
        `Sin desborde horizontal a ${medida.ancho} px`,
        datos.scrollWidth <= datos.innerWidth + 1,
        `scrollWidth=${datos.scrollWidth}, innerWidth=${datos.innerWidth}`
      );
      check(`Titulo correcto a ${medida.ancho} px`, /Instructor de Logística/i.test(datos.titulo));
      check(`Secciones visibles a ${medida.ancho} px (>= 5)`, datos.secciones >= 5, `${datos.secciones} secciones`);
      if (datos.desbordes.length) info(`Elementos que sobresalen a ${medida.ancho} px: ` + datos.desbordes.join(", "));
      if (medida.ancho === 360) contrasteEstrecho = await analizarContraste();
    }

    seccion("Contraste de textos (WCAG AA)");
    await cdp.enviar("Emulation.setDeviceMetricsOverride", {
      width: 1440,
      height: 1000,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await dormir(400);
    await evaluar("window.scrollTo(0, 0); true");
    const contraste = await analizarContraste();
    const resultadosContraste = (contraste && contraste.resultados) || [];
    const resultadosEstrechos = (contrasteEstrecho && contrasteEstrecho.resultados) || [];
    const problemasContraste = [
      ...resultadosContraste
        .filter((r) => !r.ausente && !r.oculto && !r.sinColor && !r.cumple)
        .map((r) => ({ ...r, ancho: 1440 })),
      ...resultadosEstrechos
        .filter((r) => !r.ausente && !r.oculto && !r.sinColor && !r.cumple)
        .map((r) => ({ ...r, ancho: 360 })),
    ];
    for (const r of resultadosContraste) {
      if (r.ausente) info(`contraste ${r.etiqueta}: selector sin elemento`);
      else if (r.oculto) info(`contraste ${r.etiqueta}: oculto, no se evalua`);
      else if (r.sinColor) info(`contraste ${r.etiqueta}: color no calculable`);
      else
        console.log(
          `  ${r.cumple ? "OK   " : "FALLA"} contraste ${r.etiqueta} (${r.fontSize}, peso ${r.fontWeight}) -> ${r.ratio}:1` +
            ` (minimo ${r.minimo}:1) | ${r.color} sobre ${r.fondo}` +
            (r.degradado ? " | peor caso sobre fondo con degradado" : "")
        );
    }
    for (const r of resultadosEstrechos) {
      if (!r.ausente && !r.oculto && !r.sinColor && !r.cumple) {
        info(`FALLA contraste a 360 px: ${r.etiqueta} -> ${r.ratio}:1 | ${r.color} sobre ${r.fondo}`);
      }
    }
    info(`Barrido de textos pequenos: ${contraste ? contraste.barridos : 0} estilos unicos a 1440 px.`);
    const situacionDd = resultadosContraste.find((r) => r.etiqueta === "situacion dd");
    check(
      ".situacion dd cumple contraste AA (>= 4.5:1)",
      Boolean(situacionDd) && situacionDd.cumple,
      situacionDd && !situacionDd.oculto && !situacionDd.ausente
        ? `${situacionDd.color} sobre ${situacionDd.fondo}, ratio ${situacionDd.ratio}:1`
        : "no evaluable"
    );

    // Los textos sobre degradados se aproximan por estilos; se confirman con el
    // fondo real muestreado en un recorte de pantalla (moda de pixeles).
    const selectoresDudosos = [...new Set(problemasContraste.map((r) => r.selector).filter(Boolean))];
    const contrasteReal = new Map();
    if (selectoresDudosos.length) info(`Confirmando por pixeles ${selectoresDudosos.length} caso(s) dudoso(s)...`);
    for (const selector of selectoresDudosos) {
      try {
        const real = await verificarPixel(selector);
        if (!real) {
          info(`no se pudo verificar por pixeles: ${selector}`);
          continue;
        }
        contrasteReal.set(selector, real);
        console.log(
          `  ${real.cumple ? "OK   " : "FALLA"} contraste real (pixel) ${selector} -> ${real.ratio}:1` +
            ` (minimo ${real.minimo}:1) | ${real.color} sobre ${real.fondo}` +
            (real.coberturaFondo ? `, fondo ${real.coberturaFondo}% del recorte` : "")
        );
      } catch (error) {
        info(`error verificando por pixeles ${selector}: ${error.message}`);
      }
    }
    await evaluar("window.scrollTo(0, 0); true");
    const fallosReales = problemasContraste.filter((fallo) => {
      const real = fallo.selector ? contrasteReal.get(fallo.selector) : null;
      return real ? !real.cumple : true;
    });
    check(
      "Todos los textos pequenos revisados cumplen AA",
      fallosReales.length === 0,
      fallosReales
        .slice(0, 8)
        .map((r) => {
          const real = r.selector ? contrasteReal.get(r.selector) : null;
          return `${r.etiqueta}@${r.ancho}px=${real ? "pixel " + real.ratio : "estimado " + r.ratio}:1`;
        })
        .join(" | ")
    );

    seccion("Errores de consola (1440, 768, 390 y 360 px)");
    if (avisosConsola.length) info(`${avisosConsola.length} aviso(s) de consola: ${avisosConsola.slice(0, 3).join(" | ")}`);
    check(
      "Sin errores de consola (consoleAPICalled / exceptionThrown)",
      erroresConsola.length === 0,
      erroresConsola.slice(0, 5).join(" | ")
    );
    check("Sin errores de red graves en consola", erroresRed.length === 0, erroresRed.slice(0, 5).join(" | "));
  } catch (error) {
    console.log("\nERROR GENERAL:", error.message);
    fallos++;
  } finally {
    await limpiarTodo();
  }

  console.log(`\n${fallos === 0 ? "TODO OK" : fallos + " FALLO(S)"} (${comprobaciones} comprobaciones)`);
  process.exit(fallos ? 1 : 0);
})();
