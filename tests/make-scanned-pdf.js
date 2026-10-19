"use strict";
/**
 * Crea un PDF "escaneado" (una sola imagen, sin capa de texto) a partir de una
 * imagen cualquiera. Sirve para verificar la ruta de analisis visual.
 * Uso: node tests/make-scanned-pdf.js <entrada.(png|jpg)> <salida.pdf>
 */
const fs = require("fs");
const path = require("path");
const config = require("../lib/config");

const [, , inImg, outPdf] = process.argv;
if (!inImg || !outPdf) {
  console.error("Uso: node tests/make-scanned-pdf.js <entrada.png|jpg> <salida.pdf>");
  process.exit(1);
}

(async () => {
  const { createCanvas, loadImage } = require(path.join(config.vendor, "node_modules/@napi-rs/canvas"));
  const img = await loadImage(fs.readFileSync(inImg));
  const width = img.width;
  const height = img.height;
  const cv = createCanvas(width, height);
  const ctx = cv.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(img, 0, 0);
  const jpeg = cv.toBuffer("image/jpeg", 0.85);

  function stream(dict, data) {
    return Buffer.concat([
      Buffer.from(`<< ${dict} /Length ${data.length} >>\nstream\n`, "latin1"),
      data,
      Buffer.from("\nendstream", "latin1"),
    ]);
  }

  const content = Buffer.from(`q\n${width} 0 0 ${height} 0 0 cm\n/Im0 Do\nQ`, "latin1");
  const objs = [
    Buffer.from("<< /Type /Catalog /Pages 2 0 R >>", "latin1"),
    Buffer.from("<< /Type /Pages /Kids [3 0 R] /Count 1 >>", "latin1"),
    Buffer.from(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] /Resources << /XObject << /Im0 5 0 R >> >> /Contents 4 0 R >>`,
      "latin1"
    ),
    stream("", content),
    stream(
      `/Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode`,
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
  const xrefPos = pos;
  let xref = `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (const o of offsets) xref += String(o).padStart(10, "0") + " 00000 n \n";
  xref += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF\n`;
  partes.push(Buffer.from(xref, "latin1"));

  fs.mkdirSync(path.dirname(outPdf), { recursive: true });
  fs.writeFileSync(outPdf, Buffer.concat(partes));
  console.log(`PDF escaneado creado: ${outPdf} (${width}x${height}, ${fs.statSync(outPdf).size} bytes, sin capa de texto)`);
})();
