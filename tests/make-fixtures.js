"use strict";
/** Genera archivos de prueba DOCX, XLSX, PPTX y texto en tests/fixtures. */
const fs = require("fs");
const path = require("path");
const { makeZip } = require("./zipwriter");

const OUT = path.join(__dirname, "fixtures");
fs.mkdirSync(OUT, { recursive: true });

/* ---------------------------- DOCX ---------------------------- */
function docx(paragraphs, tables = []) {
  const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  let body = "";
  for (const p of paragraphs) {
    if (typeof p === "string") body += `<w:p><w:r><w:t xml:space="preserve">${esc(p)}</w:t></w:r></w:p>`;
    else body += `<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>${esc(p.h)}</w:t></w:r></w:p>`;
  }
  for (const t of tables) {
    body += "<w:tbl>";
    for (const row of t) {
      body += "<w:tr>";
      for (const cell of row) {
        body += `<w:tc><w:p><w:r><w:t>${esc(cell)}</w:t></w:r></w:p></w:tc>`;
      }
      body += "</w:tr>";
    }
    body += "</w:tbl>";
  }
  return makeZip({
    "[Content_Types].xml":
      '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Default Extension="png" ContentType="image/png"/>' +
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    "_rels/.rels":
      '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
    "word/document.xml":
      '<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' +
      body +
      "</w:body></w:document>",
  });
}

/* ---------------------------- PPTX ---------------------------- */
function pptx(slides) {
  const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const files = {
    "[Content_Types].xml":
      '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="xml" ContentType="application/xml"/></Types>',
    "ppt/presentation.xml":
      '<?xml version="1.0" encoding="UTF-8"?><p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"></p:presentation>',
  };
  slides.forEach((s, i) => {
    const n = i + 1;
    const paras = s.lines
      .map((l) => `<a:p><a:r><a:t>${esc(l)}</a:t></a:r></a:p>`)
      .join("");
    files[`ppt/slides/slide${n}.xml`] =
      '<?xml version="1.0" encoding="UTF-8"?><p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" ' +
      'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree><p:sp><p:txBody>' +
      paras +
      "</p:txBody></p:sp></p:spTree></p:cSld></p:sld>";
    if (s.notes) {
      files[`ppt/notesSlides/notesSlide${n}.xml`] =
        '<?xml version="1.0" encoding="UTF-8"?><p:notes xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" ' +
        'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree><p:sp><p:txBody>' +
        `<a:p><a:r><a:t>${esc(s.notes)}</a:t></a:r></a:p>` +
        "</p:txBody></p:sp></p:spTree></p:cSld></p:notes>";
    }
  });
  return makeZip(files);
}

/* ---------------------------- XLSX ---------------------------- */
function xlsx(sheets) {
  const shared = [];
  const sharedIndex = new Map();
  const sIdx = (v) => {
    if (!sharedIndex.has(v)) {
      sharedIndex.set(v, shared.length);
      shared.push(v);
    }
    return sharedIndex.get(v);
  };
  const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  const files = {
    "[Content_Types].xml":
      '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="xml" ContentType="application/xml"/></Types>',
    "xl/workbook.xml":
      '<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
      'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>' +
      sheets
        .map((s, i) => `<sheet name="${esc(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
        .join("") +
      "</sheets></workbook>",
    "xl/_rels/workbook.xml.rels":
      '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      sheets
        .map(
          (s, i) =>
            `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`
        )
        .join("") +
      "</Relationships>",
  };

  // Construye las celdas (usa inlineStr y sharedStrings segun el tipo)
  sheets.forEach((s, i) => {
    let rows = "";
    s.rows.forEach((row, r) => {
      let cells = "";
      row.forEach((v, c) => {
        if (v === null || v === undefined || v === "") return;
        const ref = String.fromCharCode(65 + c) + (r + 1);
        if (typeof v === "number") {
          cells += `<c r="${ref}"><v>${v}</v></c>`;
        } else {
          cells += `<c r="${ref}" t="s"><v>${sIdx(String(v))}</v></c>`;
        }
      });
      rows += `<row r="${r + 1}">${cells}</row>`;
    });
    files[`xl/worksheets/sheet${i + 1}.xml`] =
      '<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>' +
      rows +
      "</sheetData></worksheet>";
  });

  files["xl/sharedStrings.xml"] =
    '<?xml version="1.0" encoding="UTF-8"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="' +
    shared.length +
    '" uniqueCount="' +
    shared.length +
    '">' +
    shared.map((s) => `<si><t>${esc(s)}</t></si>`).join("") +
    "</sst>";

  return makeZip(files);
}

/* ---------------------------- Salida ---------------------------- */
fs.writeFileSync(
  path.join(OUT, "informe_operaciones.docx"),
  docx(
    [
      { h: "Informe de operaciones logisticas - Centro de distribucion Norte" },
      "Elaborado por: Carlos Mendoza. Fecha: 12 de abril de 2025.",
      "Durante el trimestre se recibieron 4.320 unidades y se despacharon 4.180. El nivel de servicio alcanzo 91,5%, por debajo de la meta de 96%.",
      "El costo por despacho subio a 2.140 frente a una meta de 1.850. No se identifican las causas del incremento.",
      "Se realizo el conteo ciclico de 3 de las 8 zonas programadas.",
      { h: "Conclusiones" },
      "El inventario presenta diferencias en la zona de alta rotacion. Se recomienda revisar el proceso de alistamiento.",
    ],
    [
      [
        ["Indicador", "Meta", "Real", "Cumple"],
        ["Nivel de servicio", "96%", "91,5%", "No"],
        ["Exactitud inventario", "98%", "97,2%", "No"],
        ["Costo por despacho", "1850", "2140", "No"],
      ],
    ]
  )
);

fs.writeFileSync(
  path.join(OUT, "indicadores_almacen.xlsx"),
  xlsx([
    {
      name: "Indicadores",
      rows: [
        ["Indicador", "Meta", "Enero", "Febrero", "Marzo"],
        ["Nivel de servicio", 0.96, 0.93, 0.915, 0.94],
        ["Exactitud de inventario", 0.98, 0.972, 0.968, 0.975],
        ["Rotacion de inventario", 8, 6.2, 6.5, 6.1],
        ["Costo por despacho", 1850, 1980, 2140, 2090],
      ],
    },
    {
      name: "Novedades",
      rows: [
        ["Fecha", "Zona", "Novedad"],
        ["2025-03-04", "Zona A", "Faltante de 12 unidades en pickeo"],
        ["2025-03-11", "Zona C", "Conteo ciclico no realizado"],
      ],
    },
  ])
);

fs.writeFileSync(
  path.join(OUT, "capacitacion_recibo.pptx"),
  pptx([
    {
      lines: ["Proceso de recepcion de mercancia", "Instructor: Laura Gomez", "Duracion: 45 minutos"],
      notes: "Explicar la diferencia entre recepcion tecnica y administrativa.",
    },
    {
      lines: ["Paso 1: Verificacion documental", "Comparar orden de compra con remision del proveedor"],
      notes: "Enfatizar que sin remision no se recibe.",
    },
    { lines: ["Paso 2: Inspeccion fisica", "Revisar cantidad, empaque y lote"] },
    { lines: ["Conclusiones", "El proceso reduce errores de inventario hasta en 30%"] },
  ])
);

fs.writeFileSync(
  path.join(OUT, "notas_reunion.txt"),
  [
    "Reunion de seguimiento logistico - 18 de abril de 2025",
    "",
    "Asistentes: jefe de bodega, coordinador de transporte, analista de inventarios.",
    "",
    "Temas:",
    "1. El nivel de servicio del mes fue 91,5%, la meta es 96%.",
    "2. No hay plan de accion documentado para cerrar la brecha.",
    "3. Los despachos urgentes aumentaron 20% y no se midio su costo.",
    "4. Se propone conteo ciclico diario en la zona de alta rotacion.",
    "",
    "Compromisos: pendientes por definir responsable y fecha.",
  ].join("\n")
);

/* ------------------- PDF escaneado (solo imagen) ------------------- */
/** Genera un PDF cuya unica capa es una imagen JPEG: simula un escaneo. */
function scannedPdf(pagesJpeg, width, height) {
  function stream(dict, data) {
    return Buffer.concat([
      Buffer.from(`<< ${dict} /Length ${data.length} >>\nstream\n`, "latin1"),
      data,
      Buffer.from("\nendstream", "latin1"),
    ]);
  }
  const objs = [];
  // obj 1 = Catalog, obj 2 = Pages; cada pagina usa 3 objetos (pagina, contenido, imagen).
  const kids = pagesJpeg.map((_, i) => `${3 + i * 3} 0 R`).join(" ");
  objs.push(Buffer.from(`<< /Type /Catalog /Pages 2 0 R >>`, "latin1"));
  objs.push(Buffer.from(`<< /Type /Pages /Kids [${kids}] /Count ${pagesJpeg.length} >>`, "latin1"));
  pagesJpeg.forEach((jpeg, i) => {
    const num = 3 + i * 3;
    const content = Buffer.from(`q\n${width} 0 0 ${height} 0 0 cm\n/Im0 Do\nQ`, "latin1");
    objs.push(
      Buffer.from(
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] /Resources << /XObject << /Im0 ${num + 2} 0 R >> >> /Contents ${num + 1} 0 R >>`,
        "latin1"
      )
    );
    objs.push(stream("", content));
    objs.push(
      stream(
        `/Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode`,
        jpeg
      )
    );
  });

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
  return Buffer.concat(partes);
}

/** Renderiza texto a JPEG usando canvas (para el PDF escaneado). */
function renderPageJpeg(lines, title, width, height, quality = 0.9) {
  const cfg = require("../lib/config");
  const { createCanvas } = require(path.join(cfg.vendor, "node_modules/@napi-rs/canvas"));
  const cv = createCanvas(width, height);
  const x = cv.getContext("2d");
  x.fillStyle = "#fff";
  x.fillRect(0, 0, width, height);
  x.fillStyle = "#111";
  x.font = "bold 42px Arial";
  x.fillText(title, 90, 150);
  let y = 230;
  for (const l of lines) {
    const bold = /^\d\./.test(l);
    x.font = (bold ? "bold 32px" : "29px") + " Arial";
    x.fillText(l, 90, y);
    y += 52;
  }
  return cv.toBuffer("image/jpeg", quality);
}

const escaneoLineas = [
  "Evaluado: Ana Maria Restrepo    Fecha: 14 de marzo de 2025",
  "",
  "1. RESUMEN EJECUTIVO",
  "Se recibieron 1240 unidades y se despacharon 1180 unidades.",
  "El nivel de servicio fue 94,2%, frente a la meta de 96%.",
  "El costo por despacho subio a 1980 frente a la meta de 1850.",
  "",
  "2. INDICADORES",
  "   Nivel de servicio:        meta 96%   - real 94,2%   - NO CUMPLE",
  "   Exactitud de inventario:  meta 98%   - real 99,1%   - CUMPLE",
  "   Costo por despacho:       meta 1850  - real 1980    - NO CUMPLE",
  "",
  "3. OBSERVACIONES",
  "No se documenta el plan de accion para cerrar la brecha del nivel de servicio.",
  "Falta la evidencia del conteo ciclico de la semana 11.",
  "No se menciona la rotacion de inventario ni los productos obsoletos.",
];

const W = 1700;
const H = 2200;
fs.writeFileSync(
  path.join(OUT, "informe_escaneado.pdf"),
  scannedPdf([renderPageJpeg(escaneoLineas, "INFORME DE OPERACIONES LOGISTICAS", W, H)], W, H)
);

// Escaneo de varias paginas para probar el muestreo de paginas sin texto.
fs.writeFileSync(
  path.join(OUT, "escaneo_3_paginas.pdf"),
  scannedPdf(
    [
      renderPageJpeg(escaneoLineas, "INFORME DE OPERACIONES LOGISTICAS - Pagina 1", W, H),
      renderPageJpeg(
        ["1. ANALISIS DE CAUSAS", "El incremento del costo no tiene explicacion documentada.", "No se uso Pareto ni los 5 por ques.", "", "2. PLAN DE ACCION", "No se definen responsables ni fechas."],
        "INFORME DE OPERACIONES LOGISTICAS - Pagina 2",
        W,
        H
      ),
      renderPageJpeg(
        ["1. ANEXOS", "Tabla de despachos por zona sin totalizar.", "Fotografias de estiba sin fecha."],
        "INFORME DE OPERACIONES LOGISTICAS - Pagina 3",
        W,
        H
      ),
    ],
    W,
    H
  )
);

console.log("Fixtures generados en", OUT);for (const f of fs.readdirSync(OUT)) {
  console.log("  -", f, fs.statSync(path.join(OUT, f)).size, "bytes");
}
