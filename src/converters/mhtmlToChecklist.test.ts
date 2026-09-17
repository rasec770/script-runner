import * as assert from "node:assert/strict";
import { test } from "node:test";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { mhtmlToChecklist } from "./mhtmlToChecklist";
import { readXlsxCells } from "./xlsxFile";
import { patchXlsx, setCell } from "./xlsxPatch";
import { CONVERTERS, defaultOutputPath } from "./index";

/** Plantilla sintética con la misma forma que un checklist real: datos generales con el
 *  valor a la derecha, tabla de ambientes, validaciones por secciones separadas por una
 *  fila en blanco, lista auxiliar en una columna lejana (XFC) e historial en otra hoja. */
function plantilla(): Buffer {
  const strings = [
    "MVP", "OCD-VIEJO", "OWNER", "Dueño Anterior", "QA", "QA Anterior", "DESCRIPCIÓN", "Pase anterior", // 0-7
    "REVIEWER", "Revisor Anterior", "DESA", "CUMPLE", "VALIDACIONES", "RESULTADO", "AMBIENTE", "OBSERVACIÓN", // 8-15
    "DESPLIEGUE - PIPELINE JENKINS", "VALIDAR LINK", "Cert / Prod", "Nota vieja", // 16-19
    "CONFIGURACION DE COSMOS", "VALIDAR NOMBRE DE SERVICIO", "NO APLICA", "KAFKA CONNECT", "VALIDAR SERVER", // 20-24
    "Resultado", "FECHA", "VERSIÓN", "V1", "OK", // 25-29
  ];
  const si = strings.map((s) => `<si><t>${s}</t></si>`).join("");
  const c = (ref: string, idx: number, s = 1) => `<c r="${ref}" s="${s}" t="s"><v>${idx}</v></c>`;
  const hoja1 =
    '<worksheet xmlns="m" xmlns:r="r"><dimension ref="B2:XFC14"/><sheetData>' +
    `<row r="2" spans="2:8">${c("B2", 0)}${c("C2", 1, 30)}<c r="D2" s="30"/></row>` +
    `<row r="3" spans="2:8">${c("B3", 2)}${c("C3", 3, 31)}</row>` +
    `<row r="4" spans="2:8">${c("B4", 4)}${c("C4", 5, 30)}</row>` +
    `<row r="5" spans="2:8">${c("B5", 6)}${c("C5", 7, 30)}</row>` +
    `<row r="6" spans="2:8">${c("B6", 8)}${c("C6", 9, 30)}</row>` +
    `<row r="7" spans="2:8">${c("B7", 10)}<c r="C7" s="1"/>${c("D7", 11)}${c("E7", 11)}</row>` +
    `<row r="9" spans="2:8">${c("B9", 12, 29)}${c("F9", 13, 4)}${c("G9", 14, 4)}${c("H9", 15, 4)}</row>` +
    `<row r="10" spans="2:8">${c("B10", 16, 18)}<c r="F10" s="1"/></row>` +
    `<row r="11" spans="2:8">${c("B11", 17, 17)}${c("F11", 11)}${c("G11", 18)}${c("H11", 19)}</row>` +
    `<row r="12" spans="2:8"><c r="B12" s="17"/><c r="XFC12" t="s"><v>25</v></c></row>` +
    `<row r="13" spans="2:8">${c("B13", 20, 18)}<c r="XFC13" t="s"><v>11</v></c></row>` +
    `<row r="14" spans="2:8">${c("B14", 21, 17)}${c("F14", 11)}<c r="G14" s="1"/><c r="XFC14" t="s"><v>22</v></c></row>` +
    `<row r="16" spans="2:8">${c("B16", 23, 18)}</row>` +
    `<row r="17">${c("B17", 24, 17)}</row>` +
    '</sheetData><mergeCells count="1"><mergeCell ref="C2:D2"/></mergeCells>' +
    '<dataValidations count="1"><dataValidation type="list" sqref="F10:F17"><formula1>$XFC$13:$XFC$14</formula1></dataValidation></dataValidations>' +
    "</worksheet>";
  const hoja2 =
    '<worksheet xmlns="m"><sheetData>' +
    `<row r="2">${c("B2", 26)}${c("C2", 8)}${c("D2", 27)}${c("E2", 13)}</row>` +
    `<row r="3"><c r="B3" s="11"><v>45792</v></c>${c("C3", 9)}${c("D3", 28)}${c("E3", 29)}</row>` +
    "</sheetData></worksheet>";
  return Buffer.from(
    zipSync({
      "[Content_Types].xml": strToU8("<Types/>"),
      "xl/workbook.xml": strToU8(
        '<workbook xmlns:r="r"><sheets><sheet name="CLOUD" sheetId="1" r:id="rId1"/><sheet name="HISTORIAL" sheetId="2" r:id="rId2"/></sheets></workbook>'
      ),
      "xl/_rels/workbook.xml.rels": strToU8(
        '<Relationships><Relationship Id="rId1" Type="w" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="w" Target="worksheets/sheet2.xml"/></Relationships>'
      ),
      "xl/sharedStrings.xml": strToU8(`<sst>${si}</sst>`),
      "xl/styles.xml": strToU8('<styleSheet><cellXfs count="1"><xf numFmtId="0"/></cellXfs></styleSheet>'),
      "xl/worksheets/sheet1.xml": strToU8(hoja1),
      "xl/worksheets/sheet2.xml": strToU8(hoja2),
    })
  );
}

function mhtml(instrucciones: string): string {
  const html = `<html><body><table>
<tr><td colspan="2"><h3 class="formtitle">[OCD-77]&nbsp;<a href="https://jira.test/browse/OCD-77">[APP] Optimizar &amp; migrar</a></h3></td></tr>
<tr><td><b>Informador:</b></td><td><a href="#">Ana Dueña</a></td><td><b>Persona asignada:</b></td><td>Otro</td></tr>
<tr><td><b>QE:</b></td><td>Quique Pruebas</td></tr>
<tr><td><b>CL-DEV:</b></td><td>Lía Chapter</td></tr>
${instrucciones}
</table></body></html>`;
  const b = "----b";
  return ["Subject: [#OCD-77] Asunto", "MIME-Version: 1.0", `Content-Type: multipart/related; boundary="${b}"`, "",
    `--${b}`, "Content-Type: text/html", "Content-Transfer-Encoding: 8bit", "Content-Location: https://jira.test/x", "", html, `--${b}--`, ""].join("\r\n");
}

const CON_INSTRUCCIONES =
  "<tr><td><b>Instrucciones para producción:</b></td><td><p>Ejecutar el job de Jenkins que despliega en Kafka Connect.</p></td></tr>";

function celdas(xlsx: Buffer, hoja = 0): Map<string, string> {
  return new Map([...readXlsxCells(xlsx)[hoja].cells].map(([ref, c]) => [ref, c.text]));
}

test("rellena los datos generales a la derecha de cada etiqueta", () => {
  const r = mhtmlToChecklist(mhtml(CON_INSTRUCCIONES), { template: plantilla(), reviewer: "Cesar Anco" });
  const c = celdas(r.content);
  assert.equal(c.get("C2"), "OCD-77");
  assert.equal(c.get("C3"), "Ana Dueña");
  assert.equal(c.get("C4"), "Quique Pruebas");
  assert.equal(c.get("C5"), "[APP] Optimizar & migrar");
  assert.equal(c.get("C6"), "Cesar Anco");
  assert.match(r.log, /Checklist de OCD-77: 5 de 5 datos generales/);
});

test("sin revisor configurado usa CL-DEV, y avisa de los datos que Jira no trae", () => {
  const sinQe = mhtml(CON_INSTRUCCIONES).replace(/<tr><td><b>QE:.*?<\/tr>/, "");
  const r = mhtmlToChecklist(sinQe, { template: plantilla() });
  const c = celdas(r.content);
  assert.equal(c.get("C6"), "Lía Chapter");
  assert.equal(c.get("C4"), undefined); // se vacía el QA del checklist anterior
  assert.match(r.log, /sin dato en Jira para QA/);
});

test("por defecto sale respondido como la plantilla y solo cambian los datos generales", () => {
  const r = mhtmlToChecklist(mhtml(CON_INSTRUCCIONES), { template: plantilla(), reviewer: "Cesar Anco" });
  const c = celdas(r.content);
  assert.equal(c.get("C2"), "OCD-77");
  // Respuestas de la plantilla intactas: ambientes, resultados y observaciones.
  assert.equal(c.get("D7"), "CUMPLE");
  assert.equal(c.get("E7"), "CUMPLE");
  assert.equal(c.get("F11"), "CUMPLE");
  assert.equal(c.get("H11"), "Nota vieja");
  // Cosmos no se menciona en el pase, pero la respuesta de la plantilla manda.
  assert.equal(c.get("F14"), "CUMPLE");
  assert.equal(c.get("H14"), undefined);
  // El historial conserva su resultado y recibe fecha y revisor.
  const h = celdas(r.content, 1);
  assert.equal(h.get("E3"), "OK");
  assert.equal(h.get("C3"), "Cesar Anco");
  assert.match(r.log, /Se conservan las 2 respuestas de la plantilla/);
});

test("con keepAnswers:false vacía las respuestas del checklist anterior", () => {
  const c = celdas(mhtmlToChecklist(mhtml(CON_INSTRUCCIONES), { template: plantilla(), keepAnswers: false }).content);
  // Tabla de ambientes y validaciones aplicables: en blanco para revisar.
  assert.equal(c.get("D7"), undefined);
  assert.equal(c.get("E7"), undefined);
  assert.equal(c.get("F11"), undefined);
  assert.equal(c.get("H11"), undefined);
  // Lo que es plantilla no se toca: títulos, columna AMBIENTE y la lista auxiliar lejana.
  assert.equal(c.get("B11"), "VALIDAR LINK");
  assert.equal(c.get("G11"), "Cert / Prod");
  assert.equal(c.get("F9"), "RESULTADO");
  assert.equal(c.get("XFC12"), "Resultado");
  assert.equal(c.get("XFC14"), "NO APLICA");
});

test("con keepAnswers:false marca NO APLICA solo lo que el pase no menciona", () => {
  const r = mhtmlToChecklist(mhtml(CON_INSTRUCCIONES), { template: plantilla(), keepAnswers: false });
  const c = celdas(r.content);
  // Cosmos no se menciona: NO APLICA con su observación. El título de sección no se toca.
  assert.equal(c.get("F14"), "NO APLICA");
  assert.equal(c.get("H14"), "Automático: el pase no menciona Cosmos DB.");
  assert.equal(c.get("F13"), undefined);
  // Kafka sí se menciona: queda en blanco. Jenkins no tiene regla: en blanco.
  assert.equal(c.get("F17"), undefined);
  assert.equal(c.get("F11"), undefined);
  assert.match(r.log, /3 validaciones: 1 marcadas NO APLICA de forma automática, 2 en blanco/);
});

test("sin instrucciones que analizar no deduce ningún NO APLICA", () => {
  const c = celdas(mhtmlToChecklist(mhtml(""), { template: plantilla(), keepAnswers: false }).content);
  assert.equal(c.get("F14"), undefined);
  assert.equal(c.get("H14"), undefined);
});

test("actualiza el historial con la fecha y el revisor, conservando el estilo de fecha", () => {
  const r = mhtmlToChecklist(mhtml(CON_INSTRUCCIONES), {
    template: plantilla(),
    reviewer: "Cesar Anco",
    today: new Date(2026, 8, 17),
    keepAnswers: false,
  });
  const xml = strFromU8(unzipSync(new Uint8Array(r.content))["xl/worksheets/sheet2.xml"]);
  assert.ok(xml.includes('<c r="B3" s="11"><v>46282</v></c>'));
  const h = celdas(r.content, 1);
  assert.equal(h.get("C3"), "Cesar Anco");
  assert.equal(h.get("D3"), "V1");
  assert.equal(h.get("E3"), undefined);
});

test("solo cambian las hojas: estilos, cadenas, combinaciones y validaciones quedan igual", () => {
  const tpl = plantilla();
  const out = mhtmlToChecklist(mhtml(CON_INSTRUCCIONES), { template: tpl }).content;
  const a = unzipSync(new Uint8Array(tpl));
  const b = unzipSync(new Uint8Array(out));
  assert.deepEqual(Object.keys(b), Object.keys(a));
  for (const parte of ["xl/styles.xml", "xl/sharedStrings.xml", "xl/workbook.xml", "[Content_Types].xml"]) {
    assert.deepEqual(b[parte], a[parte], parte);
  }
  const hoja = strFromU8(b["xl/worksheets/sheet1.xml"]);
  assert.ok(hoja.includes('<mergeCell ref="C2:D2"/>'));
  assert.ok(hoja.includes("<formula1>$XFC$13:$XFC$14</formula1>"));
  // La celda rellenada conserva el estilo que tenía en la plantilla.
  assert.ok(hoja.includes('<c r="C3" s="31" t="inlineStr"><is><t>Ana Dueña</t></is></c>'));
});

test("rechaza un MHTML sin clave y una plantilla que no es un checklist", () => {
  const sinClave = mhtml("").replace(/<h3[\s\S]*?<\/h3>/, "").replace("[#OCD-77] ", "");
  assert.throws(() => mhtmlToChecklist(sinClave, { template: plantilla() }), /clave de la incidencia/);
  const otra = Buffer.from(zipSync({
    "xl/workbook.xml": strToU8('<workbook xmlns:r="r"><sheets><sheet name="A" sheetId="1" r:id="rId1"/></sheets></workbook>'),
    "xl/_rels/workbook.xml.rels": strToU8('<Relationships><Relationship Id="rId1" Type="w" Target="worksheets/sheet1.xml"/></Relationships>'),
    "xl/worksheets/sheet1.xml": strToU8('<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Otra cosa</t></is></c></row></sheetData></worksheet>'),
  }));
  assert.throws(() => mhtmlToChecklist(mhtml(""), { template: otra }), /no parece un checklist/);
  assert.throws(() => mhtmlToChecklist(mhtml(""), { template: Buffer.from("x") }), /no es un \.xlsx/);
});

test("setCell reemplaza, inserta en orden de columna y crea filas que faltan", () => {
  const xml = '<sheetData><row r="2" spans="1:3"><c r="A2" s="5" t="s"><v>0</v></c><c r="C2" s="7"/></row><row r="5"><c r="A5"/></row></sheetData>';
  assert.ok(setCell(xml, "A2", "hola").includes('<c r="A2" s="5" t="inlineStr"><is><t>hola</t></is></c>'));
  assert.ok(setCell(xml, "C2", 42).includes('<c r="C2" s="7"><v>42</v></c>'));
  assert.ok(setCell(xml, "A2", null).includes('<c r="A2" s="5"/><c r="C2" s="7"/>'));
  // Inserción entre A2 y C2; `spans` se descarta porque quedaría desfasado.
  assert.ok(setCell(xml, "B2", "x").includes('<row r="2"><c r="A2" s="5" t="s"><v>0</v></c><c r="B2" t="inlineStr"><is><t>x</t></is></c><c r="C2" s="7"/></row>'));
  assert.ok(setCell(xml, "D2", "x").includes('<c r="C2" s="7"/><c r="D2" t="inlineStr">'));
  // Fila nueva entre la 2 y la 5, y al final.
  assert.ok(setCell(xml, "A3", "x").includes('</row><row r="3"><c r="A3" t="inlineStr"><is><t>x</t></is></c></row><row r="5">'));
  assert.ok(setCell(xml, "A9", "x").endsWith('<row r="9"><c r="A9" t="inlineStr"><is><t>x</t></is></c></row></sheetData>'));
  // Vaciar o "solo si existe" sobre una celda ausente no crea nada.
  assert.equal(setCell(xml, "B2", null), xml);
  assert.equal(setCell(xml, "B2", "x", true), xml);
  assert.ok(setCell(xml, "A2", "a<b & c\n").includes('<t xml:space="preserve">a&lt;b &amp; c\n</t>'));
  assert.throws(() => setCell(xml, "nope", "x"), /no válida/);
  assert.throws(() => patchXlsx(plantilla(), [{ sheet: "xl/worksheets/nope.xml", ref: "A1", value: "x" }]), /no contiene la hoja/);
});

test("el nombre de salida sugerido es CHECKLIST-<clave>.xlsx", () => {
  const conv = CONVERTERS.find((c) => c.id === "mhtml-to-checklist")!;
  assert.equal(conv.needsTemplate, true);
  assert.match(defaultOutputPath("/tmp/[#OCD-233595] [SHCL] Optimizacion.mhtml", conv), /[\\/]CHECKLIST-OCD-233595\.xlsx$/);
  assert.match(defaultOutputPath("/tmp/sin clave.mhtml", conv), /[\\/]sin clave\.xlsx$/);
  assert.throws(() => conv.run("x", "y", false), /Falta la plantilla/);
});
