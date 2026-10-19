"use strict";
/**
 * Crea un PDF que tiene TEXTO y ADEMAS una imagen (diagrama), para verificar
 * que el analisis visual tambien se active en PDF con capa de texto.
 * Uso: node tests/make-pdf-con-imagen.js
 */
const fs = require("fs");
const path = require("path");
const config = require("../lib/config");

const OUT = path.join(__dirname, "fixtures");
const { createCanvas } = require(path.join(config.vendor, "node_modules/@napi-rs/canvas"));

function diagrama() {
  const cv = createCanvas(800, 500);
  const x = cv.getContext("2d");
  x.fillStyle = "#ffffff";
  x.fillRect(0, 0, 800, 500);
  x.fillStyle = "#0f3d5c";
  x.font = "bold 36px Arial";
  x.fillText("MAPA DE PROCESO - DESPACHO", 50, 60);

  const pasos = [
    { t: "ALISTAMIENTO", c: "#1d6fa5", y: 100 },
    { t: "VERIFICACION DE PEDIDO", c: "#0e9f8e", y: 200 },
    { t: "CARGUE Y SELLADO", c: "#c98a00", y: 300 },
    { t: "DESPACHO Y GUIA", c: "#7a3fa5", y: 400 },
  ];
  for (const p of pasos) {
    x.fillStyle = p.c;
    x.fillRect(50, p.y, 420, 70);
    x.fillStyle = "#ffffff";
    x.font = "bold 24px Arial";
    x.fillText(p.t, 70, p.y + 45);
  }
  x.fillStyle = "#b3261e";
  x.font = "bold 26px Arial";
  x.fillText("TIEMPO META: 45 min", 500, 150);
  x.fillText("TIEMPO REAL: 68 min", 500, 195);
  x.fillStyle = "#1b2a33";
  x.font = "22px Arial";
  x.fillText("Responsable: jefe de despacho", 500, 260);
  x.fillText("Frecuencia: diaria", 500, 295);
  return cv.toBuffer("image/jpeg", 0.9);
}

const jpeg = diagrama();
const ancho = 800;
const alto = 500;

/* -------- PDF con texto + imagen (DCTDecode) -------- */
function stream(dict, data) {
  return Buffer.concat([
    Buffer.from(`<< ${dict} /Length ${data.length} >>\nstream\n`, "latin1"),
    data,
    Buffer.from("\nendstream", "latin1"),
  ]);
}

const texto = [
  "INFORME DE DESPACHO - CENTRO DE DISTRIBUCION NORTE",
  "Elaborado por: Carlos Mendoza. Fecha: 12 de abril de 2025.",
  "",
  "1. RESUMEN",
  "Durante el trimestre se despacharon 4180 unidades. El tiempo",
  "promedio de despacho fue de 68 minutos frente a una meta de 45.",
  "No se documenta la causa del incumplimiento.",
  "",
  "2. MAPA DE PROCESO",
  "A continuacion se presenta el mapa del proceso de despacho.",
  "",
  "3. CONCLUSIONES",
  "Se requiere revisar el alistamiento y el cargue.",
].join("\n");

const contenidoTexto =
  "BT\n/F1 12 Tf\n16 TL\n50 780 Td\n" +
  texto.split("\n").map((l) => `(${l.replace(/[()\\]/g, "\\$&")}) Tj T*`).join("\n") +
  "\nET\n";

// La imagen se dibuja en la parte media de la pagina.
const contenidoImagen = `q\n${ancho * 0.7} 0 0 ${alto * 0.7} 60 250 cm\n/Im0 Do\nQ`;
const contenido = contenidoTexto + contenidoImagen;

const objs = [
  Buffer.from("<< /Type /Catalog /Pages 2 0 R >>", "latin1"),
  Buffer.from("<< /Type /Pages /Kids [3 0 R] /Count 1 >>", "latin1"),
  Buffer.from(
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> /XObject << /Im0 6 0 R >> >> /Contents 4 0 R >>",
    "latin1"
  ),
  stream("", Buffer.from(contenido, "latin1")),
  Buffer.from("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>", "latin1"),
  stream(
    `/Type /XObject /Subtype /Image /Width ${ancho} /Height ${alto} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode`,
    jpeg
  ),
];

const partes = [Buffer.from("%PDF-1.4\n", "latin1")];
const offsets = [];
let pos = partes[0].length;
objs.forEach((o, i) => {
  offsets.push(pos);
  const b = Buffer.concat([Buffer.from(`${i + 1} 0 obj\n`, "latin1"), o, Buffer.from("\nendobj\n", "latin1")]);
  partes.push(b);
  pos += b.length;
});
let xref = `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
for (const o of offsets) xref += String(o).padStart(10, "0") + " 00000 n \n";
xref += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${pos}\n%%EOF\n`;
partes.push(Buffer.from(xref, "latin1"));

const salida = path.join(OUT, "informe_pdf_con_imagen.pdf");
fs.writeFileSync(salida, Buffer.concat(partes));
console.log(`Creado: ${salida} (${fs.statSync(salida).size} bytes) - PDF con TEXTO + IMAGEN`);
