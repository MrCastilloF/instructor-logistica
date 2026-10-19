"use strict";
/**
 * Crea documentos de prueba CON IMAGENES INCRUSTADAS para verificar el
 * analisis visual: un DOCX con imagen grande y otra pequena, un PPTX y un PDF.
 * Uso: node tests/make-fixtures-con-imagenes.js
 */
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const config = require("../lib/config");
const { makeZip } = require("./zipwriter");

const OUT = path.join(__dirname, "fixtures");
const { createCanvas } = require(path.join(config.vendor, "node_modules/@napi-rs/canvas"));

/** Dibuja un diagrama de flujo reconocible y devuelve el PNG. */
function dibujarDiagrama(ancho = 900, alto = 620) {
  const cv = createCanvas(ancho, alto);
  const x = cv.getContext("2d");
  x.fillStyle = "#ffffff";
  x.fillRect(0, 0, ancho, alto);

  x.fillStyle = "#0f3d5c";
  x.font = "bold 40px Arial";
  x.fillText("FLUJO DE RECEPCION", 60, 70);

  const cajas = [
    { t: "1. CITA DEL PROVEEDOR", c: "#1d6fa5", y: 110 },
    { t: "2. VERIFICACION DOCUMENTAL", c: "#0e9f8e", y: 250 },
    { t: "3. INSPECCION FISICA", c: "#c98a00", y: 390 },
  ];
  for (const b of cajas) {
    x.fillStyle = b.c;
    x.fillRect(70, b.y, 500, 90);
    x.fillStyle = "#ffffff";
    x.font = "bold 28px Arial";
    x.fillText(b.t, 95, b.y + 55);
    if (b.y < 390) {
      x.strokeStyle = "#0f3d5c";
      x.lineWidth = 6;
      x.beginPath();
      x.moveTo(320, b.y + 90);
      x.lineTo(320, b.y + 140);
      x.stroke();
    }
  }

  x.fillStyle = "#b3261e";
  x.beginPath();
  x.arc(720, 300, 90, 0, Math.PI * 2);
  x.fill();
  x.fillStyle = "#ffffff";
  x.font = "bold 30px Arial";
  x.fillText("ALERTA", 660, 292);
  x.font = "24px Arial";
  x.fillText("si hay", 668, 322);
  x.fillText("faltantes", 655, 350);

  x.fillStyle = "#1b2a33";
  x.font = "22px Arial";
  x.fillText("Meta: 96% de nivel de servicio", 70, 540);
  x.fillText("Real: 91,5%", 70, 575);
  return cv.toBuffer("image/png");
}

/** Un icono pequeno (menos de 8000 bytes) para comprobar que no se descarte. */
function dibujarIcono() {
  const cv = createCanvas(120, 120);
  const x = cv.getContext("2d");
  x.fillStyle = "#ffffff";
  x.fillRect(0, 0, 120, 120);
  x.fillStyle = "#0e9f8e";
  x.beginPath();
  x.arc(60, 60, 50, 0, Math.PI * 2);
  x.fill();
  x.fillStyle = "#ffffff";
  x.font = "bold 60px Arial";
  x.fillText("OK", 18, 82);
  return cv.toBuffer("image/png");
}

function docxConImagenes(pngs) {
  const media = {};
  const rels = [];
  const drawings = [];
  pngs.forEach((item, i) => {
    const nombre = `image${i + 1}.png`;
    media[`word/media/${nombre}`] = item.png;
    rels.push(
      `<Relationship Id="rId${i + 10}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${nombre}"/>`
    );
    const cx = 5000000;
    const cy = Math.round(cx * (item.alto / item.ancho));
    drawings.push(
      `<w:p><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0">` +
        `<wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${i + 1}" name="Imagen ${i + 1}"/>` +
        `<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">` +
        `<a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">` +
        `<pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">` +
        `<pic:nvPicPr><pic:cNvPr id="${i + 1}" name="${nombre}"/><pic:cNvPicPr/></pic:nvPicPr>` +
        `<pic:blipFill><a:blip r:embed="rId${i + 10}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
        `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm>` +
        `<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>` +
        `</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`
    );
  });

  const documento =
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ` +
    `xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ` +
    `xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing">` +
    `<w:body>` +
    `<w:p><w:r><w:t>Informe de operaciones logisticas - Centro de Distribucion Norte</w:t></w:r></w:p>` +
    `<w:p><w:r><w:t>Elaborado por: Carlos Mendoza. Fecha: 12 de abril de 2025.</w:t></w:r></w:p>` +
    `<w:p><w:r><w:t>A continuacion se presenta el diagrama del proceso y la evidencia fotografica.</w:t></w:r></w:p>` +
    drawings.join("") +
    `<w:p><w:r><w:t>El nivel de servicio fue 91,5% frente a la meta de 96%. No se explica la causa.</w:t></w:r></w:p>` +
    `</w:body></w:document>`;

  return makeZip({
    "[Content_Types].xml":
      '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Default Extension="png" ContentType="image/png"/>' +
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
      "</Types>",
    "_rels/.rels":
      '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
      "</Relationships>",
    "word/_rels/document.xml.rels":
      '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      rels.join("") +
      "</Relationships>",
    "word/document.xml": documento,
    ...media,
  });
}

const diagrama = dibujarDiagrama();
const icono = dibujarIcono();
console.log("Diagrama:", diagrama.length, "bytes | Icono:", icono.length, "bytes");

fs.writeFileSync(path.join(OUT, "informe_con_imagenes.docx"), docxConImagenes([
  { png: diagrama, ancho: 900, alto: 620 },
  { png: icono, ancho: 120, alto: 120 },
]));
console.log("Creado: informe_con_imagenes.docx (diagrama grande + icono pequeno)");
console.log("Fixtures en:", OUT);
