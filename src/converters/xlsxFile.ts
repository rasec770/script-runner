// Lectura y escritura mínima de libros .xlsx (Office Open XML) sin dependencias más allá
// de fflate para el ZIP. Cubre lo que necesitan los conversores: hojas con texto, números,
// fechas e hipervínculos. No preserva fórmulas, estilos ni gráficos.
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";

export interface XlsxCell {
  /** Texto ya formateado de la celda (vacío si no hay valor). */
  text: string;
  /** Valor numérico cuando la celda es un número real (no un texto que parece número). */
  num?: number;
  /** URL o ruta del hipervínculo asociado a la celda, si lo tiene. */
  link?: string;
}

export interface XlsxSheet {
  name: string;
  /** Filas de celdas. La primera fila se trata como encabezado al convertir a Markdown. */
  rows: XlsxCell[][];
}

/** Hoja leída de forma dispersa: solo las celdas con valor, indexadas por referencia ("C3").
 *  Sirve para plantillas con celdas muy alejadas (listas auxiliares en la columna XFC),
 *  donde una matriz densa tendría miles de columnas vacías. */
export interface XlsxSheetCells {
  name: string;
  /** Ruta de la hoja dentro del ZIP, p. ej. "xl/worksheets/sheet1.xml". */
  path: string;
  cells: Map<string, XlsxCell>;
}

/** Descompone "C3" en columna y fila, ambas en base 0. */
export function parseRef(ref: string): { col: number; row: number } | undefined {
  const m = /^([A-Z]+)(\d+)$/.exec(ref);
  return m ? { col: colIndex(m[1]), row: Number(m[2]) - 1 } : undefined;
}

/** Excel limita los nombres de hoja a 31 caracteres y prohíbe estos símbolos. */
const SHEET_NAME_MAX = 31;
const SHEET_NAME_FORBIDDEN = /[\[\]:*?/\\]/g;

/** Ajusta un título para que sirva como nombre de hoja único dentro de `usados`. */
export function sheetName(titulo: string, usados: Set<string>, fallback: string): string {
  let base = titulo.replace(SHEET_NAME_FORBIDDEN, " ").replace(/\s+/g, " ").replace(/^'+|'+$/g, "").trim();
  if (!base) {
    base = fallback;
  }
  base = base.slice(0, SHEET_NAME_MAX).trim();

  let nombre = base;
  for (let n = 2; usados.has(nombre.toLowerCase()); n++) {
    const sufijo = ` (${n})`;
    nombre = base.slice(0, SHEET_NAME_MAX - sufijo.length).trim() + sufijo;
  }
  usados.add(nombre.toLowerCase());
  return nombre;
}

// ---------------------------------------------------------------------------
// XML: escape, unescape y utilidades de coordenadas
// ---------------------------------------------------------------------------

/** Escapa texto para XML y quita los caracteres de control que XML 1.0 no admite. */
function xmlEsc(s: string): string {
  return s
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function xmlUnesc(s: string): string {
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, (_, e: string) => {
    if (e[0] === "#") {
      const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : "";
    }
    return { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" }[e] ?? "";
  });
}

/** 0 -> A, 25 -> Z, 26 -> AA. */
export function colLetter(idx: number): string {
  let s = "";
  let n = idx + 1;
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/** A -> 0, Z -> 25, AA -> 26. */
export function colIndex(letters: string): number {
  let n = 0;
  for (const ch of letters) {
    n = n * 26 + (ch.charCodeAt(0) - 64);
  }
  return n - 1;
}

function attr(tag: string, name: string): string | undefined {
  const m = new RegExp(`(?:^|\\s)${name}="([^"]*)"`).exec(tag);
  return m ? xmlUnesc(m[1]) : undefined;
}

// ---------------------------------------------------------------------------
// Escritura
// ---------------------------------------------------------------------------

const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const NS_MAIN = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const NS_REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const NS_PKG_REL = "http://schemas.openxmlformats.org/package/2006/relationships";
const REL_OFFICE = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

const STYLE_NORMAL = 0;
const STYLE_HEADER = 1;
const STYLE_LINK = 2;

/** Ancho de columna (en caracteres) a partir del contenido; con límites para que sea legible. */
function anchoColumna(rows: XlsxCell[][], col: number): number {
  let max = 0;
  for (const r of rows) {
    const t = r[col]?.text ?? "";
    for (const linea of t.split("\n")) {
      max = Math.max(max, linea.length);
    }
  }
  return Math.min(Math.max(max + 2, 8), 60);
}

function celdaXml(ref: string, c: XlsxCell | undefined, style: number): string {
  if (!c || (c.text === "" && c.num === undefined)) {
    return style === STYLE_NORMAL ? "" : `<c r="${ref}" s="${style}"/>`;
  }
  if (c.num !== undefined && Number.isFinite(c.num)) {
    return `<c r="${ref}" s="${style}"><v>${c.num}</v></c>`;
  }
  const preserve = /^\s|\s$|\n/.test(c.text) ? ' xml:space="preserve"' : "";
  return `<c r="${ref}" s="${style}" t="inlineStr"><is><t${preserve}>${xmlEsc(c.text)}</t></is></c>`;
}

function hojaXml(sheet: XlsxSheet): { xml: string; rels: string | null } {
  const rows = sheet.rows;
  const cols = rows.reduce((n, r) => Math.max(n, r.length), 0);
  const links: { ref: string; target: string }[] = [];

  const colsXml =
    cols > 0
      ? "<cols>" +
        Array.from({ length: cols }, (_, i) => {
          const w = anchoColumna(rows, i);
          return `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`;
        }).join("") +
        "</cols>"
      : "";

  const filasXml = rows
    .map((r, ri) => {
      const celdas = Array.from({ length: cols }, (_, ci) => {
        const ref = colLetter(ci) + (ri + 1);
        const c = r[ci];
        let style = ri === 0 ? STYLE_HEADER : STYLE_NORMAL;
        if (c?.link && ri !== 0) {
          style = STYLE_LINK;
          links.push({ ref, target: c.link });
        }
        return celdaXml(ref, c, style);
      }).join("");
      return `<row r="${ri + 1}">${celdas}</row>`;
    })
    .join("");

  const dim = cols > 0 && rows.length > 0 ? `${colLetter(0)}1:${colLetter(cols - 1)}${rows.length}` : "A1";
  // Panel congelado bajo el encabezado para que no se pierda al hacer scroll.
  const vista =
    rows.length > 1
      ? '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>'
      : '<sheetViews><sheetView workbookViewId="0"/></sheetViews>';
  const filtro = cols > 0 && rows.length > 1 ? `<autoFilter ref="${dim}"/>` : "";
  const hyper = links.length
    ? "<hyperlinks>" + links.map((l, i) => `<hyperlink ref="${l.ref}" r:id="rId${i + 1}"/>`).join("") + "</hyperlinks>"
    : "";

  const xml =
    XML_HEAD +
    `<worksheet xmlns="${NS_MAIN}" xmlns:r="${NS_REL}">` +
    `<dimension ref="${dim}"/>${vista}<sheetFormatPr defaultRowHeight="15"/>${colsXml}` +
    `<sheetData>${filasXml}</sheetData>${filtro}${hyper}</worksheet>`;

  const rels = links.length
    ? XML_HEAD +
      `<Relationships xmlns="${NS_PKG_REL}">` +
      links
        .map(
          (l, i) =>
            `<Relationship Id="rId${i + 1}" Type="${REL_OFFICE}/hyperlink" Target="${xmlEsc(l.target)}" TargetMode="External"/>`
        )
        .join("") +
      "</Relationships>"
    : null;
  return { xml, rels };
}

const STYLES_XML =
  XML_HEAD +
  `<styleSheet xmlns="${NS_MAIN}">` +
  '<fonts count="3">' +
  '<font><sz val="11"/><name val="Calibri"/></font>' +
  '<font><b/><sz val="11"/><name val="Calibri"/></font>' +
  '<font><u/><sz val="11"/><color rgb="FF0563C1"/><name val="Calibri"/></font>' +
  "</fonts>" +
  '<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>' +
  '<fill><patternFill patternType="solid"><fgColor rgb="FFD9E1F2"/></patternFill></fill></fills>' +
  '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
  '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
  '<cellXfs count="3">' +
  '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>' +
  '<xf numFmtId="0" fontId="1" fillId="2" borderId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>' +
  '<xf numFmtId="0" fontId="2" fillId="0" borderId="0" applyFont="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>' +
  "</cellXfs>" +
  '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
  "</styleSheet>";

/** Serializa las hojas como un archivo .xlsx. Los nombres deben venir ya saneados y únicos. */
export function buildXlsx(sheets: XlsxSheet[]): Buffer {
  if (!sheets.length) {
    throw new Error("No hay hojas que escribir.");
  }
  const files: Record<string, Uint8Array> = {};

  const overrides: string[] = [];
  const sheetEntries: string[] = [];
  const wbRels: string[] = [];
  const definedNames: string[] = [];

  sheets.forEach((s, i) => {
    const n = i + 1;
    const { xml, rels } = hojaXml(s);
    const cols = s.rows.reduce((m, r) => Math.max(m, r.length), 0);
    if (cols > 0 && s.rows.length > 1) {
      // Excel asocia cada autofiltro a este nombre oculto; sin él puede pedir "reparar".
      const ref = `'${s.name.replace(/'/g, "''")}'!$A$1:$${colLetter(cols - 1)}$${s.rows.length}`;
      definedNames.push(
        `<definedName name="_xlnm._FilterDatabase" localSheetId="${i}" hidden="1">${xmlEsc(ref)}</definedName>`
      );
    }
    files[`xl/worksheets/sheet${n}.xml`] = strToU8(xml);
    if (rels) {
      files[`xl/worksheets/_rels/sheet${n}.xml.rels`] = strToU8(rels);
    }
    overrides.push(
      `<Override PartName="/xl/worksheets/sheet${n}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`
    );
    sheetEntries.push(`<sheet name="${xmlEsc(s.name)}" sheetId="${n}" r:id="rId${n}"/>`);
    wbRels.push(`<Relationship Id="rId${n}" Type="${REL_OFFICE}/worksheet" Target="worksheets/sheet${n}.xml"/>`);
  });
  const stylesId = sheets.length + 1;
  wbRels.push(`<Relationship Id="rId${stylesId}" Type="${REL_OFFICE}/styles" Target="styles.xml"/>`);

  files["[Content_Types].xml"] = strToU8(
    XML_HEAD +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
      overrides.join("") +
      "</Types>"
  );
  files["_rels/.rels"] = strToU8(
    XML_HEAD +
      `<Relationships xmlns="${NS_PKG_REL}">` +
      `<Relationship Id="rId1" Type="${REL_OFFICE}/officeDocument" Target="xl/workbook.xml"/>` +
      "</Relationships>"
  );
  files["xl/workbook.xml"] = strToU8(
    XML_HEAD +
      `<workbook xmlns="${NS_MAIN}" xmlns:r="${NS_REL}">` +
      `<sheets>${sheetEntries.join("")}</sheets>` +
      (definedNames.length ? `<definedNames>${definedNames.join("")}</definedNames>` : "") +
      "</workbook>"
  );
  files["xl/_rels/workbook.xml.rels"] = strToU8(
    XML_HEAD + `<Relationships xmlns="${NS_PKG_REL}">${wbRels.join("")}</Relationships>`
  );
  files["xl/styles.xml"] = strToU8(STYLES_XML);

  return Buffer.from(zipSync(files, { level: 6 }));
}

// ---------------------------------------------------------------------------
// Lectura
// ---------------------------------------------------------------------------

/** Concatena el texto de todos los <t> de un fragmento (cadenas ricas con varios <r>). */
function textoDe(xml: string): string {
  const sinFonetica = xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, "");
  let out = "";
  const re = /<t\b[^>]*>([\s\S]*?)<\/t>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(sinFonetica))) {
    out += xmlUnesc(m[1]);
  }
  return out;
}

function leerSharedStrings(xml: string | undefined): string[] {
  if (!xml) {
    return [];
  }
  const out: string[] = [];
  const re = /<si\b[^>]*>([\s\S]*?)<\/si>|<si\b[^>]*\/>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) {
    out.push(m[1] === undefined ? "" : textoDe(m[1]));
  }
  return out;
}

/** Ids de formato numérico integrados que Excel muestra como fecha u hora. */
const BUILTIN_DATE_FMTS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 45, 46, 47]);

/** Para cada índice de estilo (atributo s de la celda) indica si es un formato de fecha. */
function leerEstilosFecha(xml: string | undefined): boolean[] {
  if (!xml) {
    return [];
  }
  const custom = new Map<number, boolean>();
  const reFmt = /<numFmt\b([^>]*)\/>/g;
  let m: RegExpExecArray | null;
  while ((m = reFmt.exec(xml))) {
    const id = Number(attr(m[1], "numFmtId"));
    const code = (attr(m[1], "formatCode") ?? "")
      .replace(/\[[^\]]*\]/g, "") // colores y condiciones
      .replace(/"[^"]*"/g, "") // literales
      .replace(/\\./g, "");
    custom.set(id, /[dmyhs]/i.test(code) && !/[#0]/.test(code));
  }

  const xfsBlock = /<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/.exec(xml);
  if (!xfsBlock) {
    return [];
  }
  const out: boolean[] = [];
  const reXf = /<xf\b([^>]*?)(?:\/>|>[\s\S]*?<\/xf>)/g;
  while ((m = reXf.exec(xfsBlock[1]))) {
    const id = Number(attr(m[1], "numFmtId") ?? 0);
    out.push(BUILTIN_DATE_FMTS.has(id) || custom.get(id) === true);
  }
  return out;
}

function pad(n: number): string {
  return n < 10 ? "0" + n : String(n);
}

/** Convierte un serial de Excel a texto ISO (fecha, y hora si tiene parte fraccionaria). */
function serialAFecha(serial: number, date1904: boolean): string {
  // Excel cuenta desde 1900-01-00 e incluye el inexistente 29/02/1900; restar desde
  // 1899-12-30 corrige ambas cosas para seriales a partir de marzo de 1900.
  const base = date1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 30);
  const ms = Math.round(serial * 86400000);
  const d = new Date(base + ms);
  const fecha = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  const frac = serial - Math.floor(serial);
  if (frac < 1e-9) {
    return fecha;
  }
  const hora = `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
  return `${fecha} ${hora}`;
}

function numeroATexto(v: string): string {
  const n = Number(v);
  if (!Number.isFinite(n)) {
    return v;
  }
  // 15 cifras significativas evita colas tipo 0.30000000000000004 sin perder precisión útil.
  return String(Number(n.toPrecision(15)));
}

function leerRels(xml: string | undefined): Map<string, string> {
  const out = new Map<string, string>();
  if (!xml) {
    return out;
  }
  const re = /<Relationship\b([^>]*)\/>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) {
    const id = attr(m[1], "Id");
    const target = attr(m[1], "Target");
    if (id && target) {
      out.set(id, target);
    }
  }
  return out;
}

function leerCeldas(
  xml: string,
  shared: string[],
  esFecha: boolean[],
  date1904: boolean,
  rels: Map<string, string>
): Map<string, XlsxCell> {
  const cells = new Map<string, XlsxCell>();

  const dataBlock = /<sheetData\b[^>]*>([\s\S]*?)<\/sheetData>/.exec(xml);
  if (dataBlock) {
    const reCell = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
    let m: RegExpExecArray | null;
    while ((m = reCell.exec(dataBlock[1]))) {
      const tag = m[1];
      const inner = m[2] ?? "";
      const ref = attr(tag, "r");
      if (!ref || !parseRef(ref)) {
        continue;
      }
      const tipo = attr(tag, "t") ?? "n";
      const estilo = Number(attr(tag, "s") ?? -1);

      let cell: XlsxCell | null = null;
      if (tipo === "inlineStr") {
        cell = { text: textoDe(inner) };
      } else {
        const v = /<v>([\s\S]*?)<\/v>/.exec(inner);
        if (!v) {
          continue;
        }
        const raw = xmlUnesc(v[1]);
        if (tipo === "s") {
          cell = { text: shared[Number(raw)] ?? "" };
        } else if (tipo === "str" || tipo === "e") {
          cell = { text: raw };
        } else if (tipo === "b") {
          cell = { text: raw === "1" ? "TRUE" : "FALSE" };
        } else {
          const n = Number(raw);
          if (Number.isFinite(n) && esFecha[estilo]) {
            cell = { text: serialAFecha(n, date1904) };
          } else {
            cell = { text: numeroATexto(raw), num: Number.isFinite(n) ? n : undefined };
          }
        }
      }
      if (cell.text === "" && cell.num === undefined) {
        continue;
      }
      cells.set(ref, cell);
    }
  }

  // Hipervínculos: <hyperlink ref="B2" r:id="rId1"/> resueltos contra los rels de la hoja.
  const reLink = /<hyperlink\b([^>]*)\/>/g;
  let lm: RegExpExecArray | null;
  while ((lm = reLink.exec(xml))) {
    const ref = attr(lm[1], "ref");
    const rid = attr(lm[1], "r:id");
    if (!ref || !rid) {
      continue;
    }
    const target = rels.get(rid);
    const cell = cells.get(ref);
    if (target && cell) {
      cell.link = target;
    }
  }
  return cells;
}

/** Matriz densa (fila x columna) desde A1 hasta la última celda con valor. */
function densa(cells: Map<string, XlsxCell>): XlsxCell[][] {
  let maxRow = -1;
  let maxCol = -1;
  const porFila = new Map<number, Map<number, XlsxCell>>();
  for (const [ref, cell] of cells) {
    const pos = parseRef(ref)!;
    if (!porFila.has(pos.row)) {
      porFila.set(pos.row, new Map());
    }
    porFila.get(pos.row)!.set(pos.col, cell);
    maxRow = Math.max(maxRow, pos.row);
    maxCol = Math.max(maxCol, pos.col);
  }
  const rows: XlsxCell[][] = [];
  for (let r = 0; r <= maxRow; r++) {
    const fila = porFila.get(r);
    rows.push(Array.from({ length: maxCol + 1 }, (_, c) => fila?.get(c) ?? { text: "" }));
  }
  return rows;
}

/** Lee todas las hojas de un .xlsx en el orden del libro, como matrices densas. */
export function readXlsx(data: Buffer | Uint8Array): XlsxSheet[] {
  return readXlsxCells(data).map((s) => ({ name: s.name, rows: densa(s.cells) }));
}

/** Lee todas las hojas de un .xlsx en el orden del libro, solo con las celdas con valor. */
export function readXlsxCells(data: Buffer | Uint8Array): XlsxSheetCells[] {
  let zip: Record<string, Uint8Array>;
  try {
    zip = unzipSync(data instanceof Uint8Array ? data : new Uint8Array(data));
  } catch {
    throw new Error("El archivo no es un .xlsx válido (no se pudo abrir como ZIP).");
  }
  const texto = (p: string): string | undefined => (zip[p] ? strFromU8(zip[p]) : undefined);

  const workbook = texto("xl/workbook.xml");
  if (!workbook) {
    throw new Error("El archivo no contiene xl/workbook.xml: no es un libro de Excel.");
  }
  const date1904 = /<workbookPr\b[^>]*\bdate1904="(1|true)"/.test(workbook);
  const wbRels = leerRels(texto("xl/_rels/workbook.xml.rels"));
  const shared = leerSharedStrings(texto("xl/sharedStrings.xml"));
  const esFecha = leerEstilosFecha(texto("xl/styles.xml"));

  const sheets: XlsxSheetCells[] = [];
  const reSheet = /<sheet\b([^>]*)\/>/g;
  let m: RegExpExecArray | null;
  while ((m = reSheet.exec(workbook))) {
    const name = attr(m[1], "name") ?? `Hoja${sheets.length + 1}`;
    const rid = attr(m[1], "r:id");
    const target = rid && wbRels.get(rid);
    if (!target) {
      continue;
    }
    const ruta = target.startsWith("/") ? target.slice(1) : "xl/" + target;
    const xml = texto(ruta);
    if (!xml) {
      continue;
    }
    const relsPath = ruta.replace(/([^/]+)$/, "_rels/$1.rels");
    const rels = leerRels(texto(relsPath));
    sheets.push({ name, path: ruta, cells: leerCeldas(xml, shared, esFecha, date1904, rels) });
  }
  return sheets;
}
