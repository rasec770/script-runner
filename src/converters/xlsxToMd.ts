// Excel (.xlsx) -> Markdown. Cada hoja con datos pasa a una tabla GFM; la primera fila
// no vacía se usa como encabezado. Con más de una hoja, cada tabla lleva su título "##".
import { ConvertResult } from "./types";
import { mdCell } from "./csvToMd";
import { readXlsx, XlsxCell, XlsxSheet } from "./xlsxFile";

function celdaMd(c: XlsxCell): string {
  const texto = mdCell(c.text);
  if (c.link && texto) {
    return `[${texto}](${c.link.replace(/\)/g, "%29")})`;
  }
  return texto;
}

function filaVacia(r: XlsxCell[]): boolean {
  return r.every((c) => c.text === "" && c.num === undefined);
}

/** Recorta filas vacías al principio y al final, y columnas vacías a la derecha. */
function recortar(rows: XlsxCell[][]): XlsxCell[][] {
  let a = 0;
  let b = rows.length;
  while (a < b && filaVacia(rows[a])) {
    a++;
  }
  while (b > a && filaVacia(rows[b - 1])) {
    b--;
  }
  const filas = rows.slice(a, b);

  let cols = filas.reduce((n, r) => Math.max(n, r.length), 0);
  while (cols > 0 && filas.every((r) => !r[cols - 1] || (r[cols - 1].text === "" && r[cols - 1].num === undefined))) {
    cols--;
  }
  return filas.map((r) => Array.from({ length: cols }, (_, i) => r[i] ?? { text: "" }));
}

export function sheetToMd(sheet: XlsxSheet): string[] {
  const filas = recortar(sheet.rows);
  if (!filas.length || !filas[0].length) {
    return [];
  }
  const cols = filas[0].length;
  const linea = (r: XlsxCell[]) => "| " + r.map(celdaMd).join(" | ") + " |";
  const out = [linea(filas[0]), "| " + Array(cols).fill("---").join(" | ") + " |"];
  for (const r of filas.slice(1)) {
    out.push(linea(r));
  }
  return out;
}

export function xlsxToMd(data: Buffer): ConvertResult {
  const sheets = readXlsx(data);
  const conDatos = sheets.map((s) => ({ s, md: sheetToMd(s) })).filter((x) => x.md.length > 0);
  if (!conDatos.length) {
    throw new Error("El libro no tiene ninguna hoja con datos.");
  }

  const bloques: string[] = [];
  for (const { s, md } of conDatos) {
    if (conDatos.length > 1) {
      bloques.push(`## ${s.name}`, "");
    }
    bloques.push(...md, "");
  }

  const omitidas = sheets.length - conDatos.length;
  const resumen = conDatos.map(({ s, md }) => `  ${s.name}: ${md.length - 2} filas de datos`).join("\n");
  return {
    content: bloques.join("\n").replace(/\n+$/, "\n"),
    log:
      `${conDatos.length} hoja(s) → ${conDatos.length} tabla(s)` +
      (omitidas ? `, ${omitidas} hoja(s) vacía(s) omitida(s)` : "") +
      `.\n${resumen}`,
  };
}
