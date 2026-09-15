import * as assert from "node:assert/strict";
import { test } from "node:test";
import { strToU8, zipSync } from "fflate";
import { buildXlsx, colLetter, readXlsx, sheetName } from "./xlsxFile";

/** Libro mínimo "como lo escribe Excel": sharedStrings, estilos con fecha y un hipervínculo. */
function libroExcel(): Buffer {
  const files: Record<string, Uint8Array> = {
    "[Content_Types].xml": strToU8("<Types/>"),
    "xl/workbook.xml": strToU8(
      '<workbook xmlns:r="r"><workbookPr/><sheets><sheet name="Datos" sheetId="1" r:id="rId1"/>' +
        '<sheet name="Vacía" sheetId="2" r:id="rId2"/></sheets></workbook>'
    ),
    "xl/_rels/workbook.xml.rels": strToU8(
      '<Relationships><Relationship Id="rId1" Type="w" Target="worksheets/sheet1.xml"/>' +
        '<Relationship Id="rId2" Type="w" Target="/xl/worksheets/sheet2.xml"/></Relationships>'
    ),
    "xl/sharedStrings.xml": strToU8(
      "<sst><si><t>Nombre</t></si><si><t>Fecha</t></si><si><r><t>Ana </t></r><r><t>&amp; Bo</t></r></si>" +
        '<si><t xml:space="preserve">  con espacios</t></si></sst>'
    ),
    "xl/styles.xml": strToU8(
      '<styleSheet><numFmts count="1"><numFmt numFmtId="164" formatCode="dd/mm/yyyy"/></numFmts>' +
        '<cellXfs count="3"><xf numFmtId="0"/><xf numFmtId="14"/><xf numFmtId="164"/></cellXfs></styleSheet>'
    ),
    "xl/worksheets/sheet1.xml": strToU8(
      "<worksheet><sheetData>" +
        '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="inlineStr"><is><t>Num</t></is></c></row>' +
        '<row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2" s="1"><v>45000</v></c><c r="C2"><v>0.1</v></c></row>' +
        '<row r="3"><c r="A3" t="s"><v>3</v></c><c r="B3" s="2"><v>45000.5</v></c><c r="C3" t="b"><v>1</v></c><c r="D3"/></row>' +
        '<row r="4"><c r="A4" t="str"><f>A1</f><v>Nombre</v></c><c r="C4"><v>1E+3</v></c></row>' +
        '</sheetData><hyperlinks><hyperlink ref="A2" r:id="rId1"/></hyperlinks></worksheet>'
    ),
    "xl/worksheets/_rels/sheet1.xml.rels": strToU8(
      '<Relationships><Relationship Id="rId1" Type="h" Target="https://example.test/a?b=1&amp;c=2" TargetMode="External"/></Relationships>'
    ),
    "xl/worksheets/sheet2.xml": strToU8("<worksheet><sheetData/></worksheet>"),
  };
  return Buffer.from(zipSync(files));
}

test("colLetter cubre una y dos letras", () => {
  assert.equal(colLetter(0), "A");
  assert.equal(colLetter(25), "Z");
  assert.equal(colLetter(26), "AA");
  assert.equal(colLetter(701), "ZZ");
});

test("sheetName sanea, recorta a 31 y desambigua", () => {
  const usados = new Set<string>();
  assert.equal(sheetName("3. Activos: datos [ADLS] / rutas?", usados, "Tabla 1"), "3. Activos datos ADLS rutas");
  assert.equal(sheetName("", usados, "Tabla 2"), "Tabla 2");
  const largo = "5. Jobs, compute y librerías corporativas del squad";
  assert.equal(sheetName(largo, usados, "x"), "5. Jobs, compute y librerías co");
  assert.equal(sheetName(largo, usados, "x"), "5. Jobs, compute y librería (2)");
  assert.equal(sheetName("tabla 2", usados, "x"), "tabla 2 (2)");
});

test("readXlsx resuelve cadenas compartidas, fechas, números, booleanos e hipervínculos", () => {
  const sheets = readXlsx(libroExcel());
  assert.deepEqual(
    sheets.map((s) => s.name),
    ["Datos", "Vacía"]
  );
  const rows = sheets[0].rows;
  assert.equal(rows.length, 4);
  assert.equal(rows[0].map((c) => c.text).join("|"), "Nombre|Fecha|Num");
  assert.equal(rows[1][0].text, "Ana & Bo");
  assert.equal(rows[1][0].link, "https://example.test/a?b=1&c=2");
  assert.equal(rows[1][1].text, "2023-03-15");
  assert.equal(rows[1][2].text, "0.1");
  assert.equal(rows[1][2].num, 0.1);
  assert.equal(rows[2][0].text, "  con espacios");
  assert.equal(rows[2][1].text, "2023-03-15 12:00:00");
  assert.equal(rows[2][2].text, "TRUE");
  assert.equal(rows[3][0].text, "Nombre");
  assert.equal(rows[3][2].text, "1000");
  assert.deepEqual(sheets[1].rows, []);
});

test("buildXlsx produce un libro que readXlsx lee igual", () => {
  const xlsx = buildXlsx([
    {
      name: "Hoja & <1>",
      rows: [
        [{ text: "Col A" }, { text: "Col B" }],
        [{ text: "línea 1\nlínea 2" }, { text: "42", num: 42 }],
        [{ text: "enlace", link: "../doc.md" }, { text: "" }],
        [{ text: " espacio " }, { text: "a<b & \"c\"" }],
      ],
    },
  ]);
  const [hoja] = readXlsx(xlsx);
  assert.equal(hoja.name, "Hoja & <1>");
  assert.equal(hoja.rows.length, 4);
  assert.equal(hoja.rows[1][0].text, "línea 1\nlínea 2");
  assert.equal(hoja.rows[1][1].num, 42);
  assert.equal(hoja.rows[2][0].link, "../doc.md");
  assert.equal(hoja.rows[3][0].text, " espacio ");
  assert.equal(hoja.rows[3][1].text, 'a<b & "c"');
});

test("buildXlsx rechaza un libro sin hojas y readXlsx un archivo que no es ZIP", () => {
  assert.throws(() => buildXlsx([]), /No hay hojas/);
  assert.throws(() => readXlsx(Buffer.from("no soy un zip")), /no es un \.xlsx/);
  assert.throws(() => readXlsx(Buffer.from(zipSync({ "a.txt": strToU8("x") }))), /workbook\.xml/);
});
