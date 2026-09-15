// Markdown -> Excel (.xlsx). Cada tabla GFM del documento se vuelve una hoja, nombrada
// por el encabezado más cercano que la precede. El texto fuera de las tablas se omite.
import { ConvertResult } from "./types";
import { FENCE, HEADING, normalizeInput } from "./helpers";
import { buildXlsx, sheetName, XlsxCell, XlsxSheet } from "./xlsxFile";

/** Fila separadora de una tabla GFM: | --- | :---: | ---: | (los | exteriores son opcionales). */
const DELIM_ROW = /^\s*\|?\s*:?-+:?\s*(?:\|\s*:?-+:?\s*)*\|?\s*$/;

/** Parte una fila en celdas respetando `\|` como barra literal. Quita los | exteriores. */
export function splitRow(line: string): string[] {
  const cells: string[] = [];
  let cur = "";
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === "\\" && line[i + 1] === "|") {
      cur += "\\|";
      i++;
      continue;
    }
    if (ch === "|") {
      cells.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  cells.push(cur);

  if (cells.length && cells[0].trim() === "" && line.trimStart().startsWith("|")) {
    cells.shift();
  }
  if (cells.length && cells[cells.length - 1].trim() === "" && line.trimEnd().endsWith("|")) {
    cells.pop();
  }
  return cells.map((c) => c.trim());
}

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}

/** Texto plano de una celda Markdown: sin marcas inline, con saltos reales y `|` literal.
 *  Si toda la celda es un único enlace, devuelve también su destino. */
export function plainCell(raw: string): XlsxCell {
  let s = raw;
  let link: string | undefined;

  // Un enlace que ocupa toda la celda pasa a hipervínculo; los demás quedan como texto.
  const soloEnlace = /^\s*\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)\s*$/.exec(s);
  if (soloEnlace) {
    link = soloEnlace[2];
    s = soloEnlace[1];
  }

  s = s
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1") // imágenes: alt
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1") // enlaces: texto
    .replace(/`([^`]*)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/(^|[^*\w])\*([^*\s][^*]*?)\*(?=[^*\w]|$)/g, "$1$2")
    .replace(/~~([^~]+)~~/g, "$1")
    .replace(/\\\|/g, "|")
    .replace(/\\([\\`*_{}\[\]()#+\-.!~])/g, "$1")
    .replace(/[ \t]*\n[ \t]*/g, "\n")
    .trim();
  s = decodeEntities(s);

  const cell: XlsxCell = { text: s };
  if (link) {
    cell.link = decodeEntities(link);
  }
  // Solo números "limpios" pasan a numéricos; "007" o "3.0.0" siguen siendo texto.
  if (/^-?(0|[1-9]\d*)(\.\d+)?$/.test(s)) {
    const n = Number(s);
    if (Number.isFinite(n) && Math.abs(n) < 1e15) {
      cell.num = n;
    }
  }
  return cell;
}

/** Texto de un encabezado Markdown sin marcas ni # de cierre. */
function headingText(line: string): string {
  const cuerpo = line.replace(HEADING, "").replace(/\s+#+\s*$/, "");
  return plainCell(cuerpo).text.replace(/\n/g, " ");
}

interface MdTable {
  heading: string;
  rows: XlsxCell[][];
}

/** Localiza las tablas GFM del documento, ignorando bloques de código. */
export function extractTables(text: string): MdTable[] {
  const lines = normalizeInput(text).split("\n");
  const tables: MdTable[] = [];
  let heading = "";
  let fence: string | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    const fm = FENCE.exec(line);
    if (fence) {
      if (fm && fm[1][0] === fence[0] && fm[1].length >= fence.length) {
        fence = null;
      }
      continue;
    }
    if (fm) {
      fence = fm[1];
      continue;
    }

    if (HEADING.test(line)) {
      heading = headingText(line);
      continue;
    }

    const next = lines[i + 1];
    if (!line.includes("|") || next === undefined || !DELIM_ROW.test(next) || !next.includes("|")) {
      continue;
    }
    const header = splitRow(line);
    const delims = splitRow(next);
    if (header.length === 0 || delims.length !== header.length) {
      continue;
    }

    const rows: string[][] = [header];
    let j = i + 2;
    for (; j < lines.length; j++) {
      const l = lines[j];
      if (l.trim() === "" || !l.includes("|") || HEADING.test(l) || FENCE.test(l)) {
        break;
      }
      rows.push(splitRow(l));
    }

    const cols = rows.reduce((n, r) => Math.max(n, r.length), 0);
    tables.push({
      heading,
      rows: rows.map((r) => Array.from({ length: cols }, (_, c) => plainCell(r[c] ?? ""))),
    });
    i = j - 1;
  }
  return tables;
}

export function mdToXlsx(text: string): ConvertResult<Buffer> {
  const tables = extractTables(text);
  if (!tables.length) {
    throw new Error("El Markdown no contiene ninguna tabla (| col | col | con fila separadora).");
  }

  const usados = new Set<string>();
  const sheets: XlsxSheet[] = tables.map((t, i) => ({
    name: sheetName(t.heading, usados, `Tabla ${i + 1}`),
    rows: t.rows,
  }));

  const resumen = sheets
    .map((s) => `  ${s.name}: ${s.rows[0].length} col x ${s.rows.length - 1} filas`)
    .join("\n");
  return {
    content: buildXlsx(sheets),
    log:
      `${sheets.length} tabla(s) → ${sheets.length} hoja(s). El texto fuera de las tablas no se conserva.\n` +
      resumen,
  };
}
