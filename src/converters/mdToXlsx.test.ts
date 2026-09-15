import * as assert from "node:assert/strict";
import { test } from "node:test";
import { extractTables, mdToXlsx, plainCell, splitRow } from "./mdToXlsx";
import { xlsxToMd } from "./xlsxToMd";
import { readXlsx } from "./xlsxFile";

const DOC = [
  "# Inventario",
  "",
  "Texto introductorio que no es tabla.",
  "",
  "## 2. Procesos y flujo",
  "",
  "| Activo | Función | Evidencia |",
  "|---|---|---|",
  "| `StreamingApp` | Entrada **principal**; usa `foreachBatch`. | R: F01, líneas 42–74. |",
  "| Librerías | Parte del arranque \\| acceso externo.<br>Segunda línea | W: versiones. |",
  "",
  "## 3. Activos: datos [ADLS]",
  "",
  "Plantilla: `abfss://...`",
  "",
  "| Activo | Contenedor | Nº |",
  "| :--- | :---: | ---: |",
  "| Leads CRM | `base-contacts` | 12 |",
  "| Cubo | `transactions` | 007 |",
  "| Fila corta | solo dos |",
  "",
  "```",
  "| esto | no es tabla |",
  "|---|---|",
  "```",
  "",
  "### Nombres y ambientes",
  "",
  "| ID | Archivo |",
  "|---|---|",
  "| F01 | [StreamingApp.scala](../../src/StreamingApp.scala) |",
  "| F02 | Ver [doc](x.md) y [otro](y.md) |",
  "",
  "- [ ] Una lista, no una tabla",
  "",
  "| Sin | separador |",
  "| esto | tampoco |",
].join("\n");

test("splitRow respeta \\| y quita las barras exteriores", () => {
  assert.deepEqual(splitRow("| a | b \\| c | d |"), ["a", "b \\| c", "d"]);
  assert.deepEqual(splitRow("a | b"), ["a", "b"]);
  assert.deepEqual(splitRow("| a |  | c |"), ["a", "", "c"]);
});

test("plainCell quita marcas inline, decodifica entidades y detecta números y enlaces", () => {
  assert.equal(plainCell("**Registra.** Batch `overwrite`, partición `hostProcessDate`").text, "Registra. Batch overwrite, partición hostProcessDate");
  assert.equal(plainCell("campo *Ejecutar como*").text, "campo Ejecutar como");
  assert.equal(plainCell("enriched_batch_wave5 y Standard_E8_v3").text, "enriched_batch_wave5 y Standard_E8_v3");
  assert.equal(plainCell("a &lt;b&gt; &amp; c").text, "a <b> & c");
  assert.equal(plainCell("uno<br>dos<br/>tres").text, "uno\ndos\ntres");
  assert.equal(plainCell("x \\| y").text, "x | y");
  assert.deepEqual(plainCell("1300"), { text: "1300", num: 1300 });
  assert.deepEqual(plainCell("-3.5"), { text: "-3.5", num: -3.5 });
  assert.deepEqual(plainCell("007"), { text: "007" });
  assert.deepEqual(plainCell("3.0.0"), { text: "3.0.0" });
  assert.deepEqual(plainCell("[doc](../a.md)"), { text: "doc", link: "../a.md" });
  assert.deepEqual(plainCell("Ver [doc](../a.md) y [otro](b.md)"), { text: "Ver doc y otro" });
  assert.deepEqual(plainCell("![captura](img.png)"), { text: "captura" });
});

test("extractTables localiza las tablas con su encabezado e ignora bloques de código", () => {
  const tables = extractTables(DOC);
  assert.deepEqual(
    tables.map((t) => t.heading),
    ["2. Procesos y flujo", "3. Activos: datos [ADLS]", "Nombres y ambientes"]
  );
  assert.equal(tables[0].rows.length, 3);
  assert.equal(tables[0].rows[2][1].text, "Parte del arranque | acceso externo.\nSegunda línea");
  // La fila corta se rellena hasta el ancho de la tabla.
  assert.equal(tables[1].rows[3].length, 3);
  assert.equal(tables[1].rows[3][2].text, "");
  assert.equal(tables[1].rows[1][2].num, 12);
  assert.equal(tables[2].rows[1][1].link, "../../src/StreamingApp.scala");
});

test("mdToXlsx genera una hoja por tabla con nombres saneados y únicos", () => {
  const r = mdToXlsx(DOC);
  const sheets = readXlsx(r.content);
  assert.deepEqual(
    sheets.map((s) => s.name),
    ["2. Procesos y flujo", "3. Activos datos ADLS", "Nombres y ambientes"]
  );
  assert.equal(sheets[0].rows[0].map((c) => c.text).join("|"), "Activo|Función|Evidencia");
  assert.equal(sheets[1].rows[1][2].num, 12);
  assert.equal(sheets[2].rows[1][1].link, "../../src/StreamingApp.scala");
  assert.match(r.log, /3 tabla\(s\) → 3 hoja\(s\)/);
});

test("mdToXlsx desambigua dos tablas bajo el mismo encabezado y falla sin tablas", () => {
  const dos = "## Misma\n\n| a |\n|---|\n| 1 |\n\n| b |\n|---|\n| 2 |\n";
  assert.deepEqual(
    readXlsx(mdToXlsx(dos).content).map((s) => s.name),
    ["Misma", "Misma (2)"]
  );
  assert.deepEqual(readXlsx(mdToXlsx("| a |\n|---|\n| 1 |\n").content).map((s) => s.name), ["Tabla 1"]);
  assert.throws(() => mdToXlsx("# Solo texto\n\nsin tablas\n"), /ninguna tabla/);
});

test("xlsxToMd reconstruye las tablas, escapa | y <br>, y conserva enlaces", () => {
  const md = xlsxToMd(mdToXlsx(DOC).content).content;
  const lineas = md.split("\n");
  assert.equal(lineas[0], "## 2. Procesos y flujo");
  assert.ok(md.includes("| Librerías | Parte del arranque \\| acceso externo.<br>Segunda línea | W: versiones. |"));
  assert.ok(md.includes("| F01 | [StreamingApp.scala](../../src/StreamingApp.scala) |"));
  assert.ok(md.includes("| Cubo | transactions | 007 |"));
  assert.ok(md.includes("| Fila corta | solo dos |  |"));
  assert.ok(md.endsWith("|\n"));
  // Ida y vuelta: las tablas se re-extraen idénticas en contenido plano.
  const otraVez = extractTables(md);
  assert.deepEqual(
    otraVez.map((t) => t.rows.map((r) => r.map((c) => c.text))),
    extractTables(DOC).map((t) => t.rows.map((r) => r.map((c) => c.text)))
  );
});

test("xlsxToMd con una sola hoja no añade encabezado y omite hojas vacías", () => {
  const r = xlsxToMd(mdToXlsx("| a | b |\n|---|---|\n| 1 | x |\n").content);
  assert.equal(r.content, "| a | b |\n| --- | --- |\n| 1 | x |\n");
  assert.match(r.log, /1 hoja\(s\) → 1 tabla\(s\)/);
});
