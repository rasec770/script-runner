// Edición quirúrgica de un .xlsx existente: cambia el valor de celdas concretas y deja
// intacto todo lo demás (estilos, combinaciones, validaciones, tablas, comentarios).
// Es lo que permite rellenar una plantilla ajena sin tener que reproducir su formato.
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { colIndex, parseRef } from "./xlsxFile";

/** Texto, número o `null` para vaciar la celda conservando su estilo. */
export type CellValue = string | number | null;

export interface CellEdit {
  /** Ruta de la hoja dentro del ZIP, tal como la devuelve readXlsxCells. */
  sheet: string;
  ref: string;
  value: CellValue;
  /** Si la celda no existe en la hoja, no la crea. Útil para "vaciar si está". */
  onlyIfExists?: boolean;
}

function xmlEsc(s: string): string {
  return s
    .replace(/[^\x09\x0A\x0D\x20-퟿-�]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function celda(ref: string, style: string | undefined, value: CellValue): string {
  const s = style !== undefined ? ` s="${style}"` : "";
  if (value === null || value === "") {
    return `<c r="${ref}"${s}/>`;
  }
  if (typeof value === "number") {
    return `<c r="${ref}"${s}><v>${value}</v></c>`;
  }
  const preserve = /^\s|\s$|\n/.test(value) ? ' xml:space="preserve"' : "";
  return `<c r="${ref}"${s} t="inlineStr"><is><t${preserve}>${xmlEsc(value)}</t></is></c>`;
}

/** Sustituye (o inserta) una celda en el XML de una hoja. */
export function setCell(xml: string, ref: string, value: CellValue, onlyIfExists = false): string {
  const pos = parseRef(ref);
  if (!pos) {
    throw new Error(`Referencia de celda no válida: ${ref}`);
  }

  // 1) La celda ya existe: se reemplaza conservando su estilo.
  const reCelda = new RegExp(`<c\\b(?=[^>]*\\br="${ref}")([^>]*?)(?:/>|>[\\s\\S]*?</c>)`);
  const m = reCelda.exec(xml);
  if (m) {
    const style = /\bs="(\d+)"/.exec(m[1])?.[1];
    return xml.slice(0, m.index) + celda(ref, style, value) + xml.slice(m.index + m[0].length);
  }
  if (onlyIfExists || value === null || value === "") {
    return xml;
  }

  // 2) Existe la fila: se inserta en orden de columna. `spans` es una pista de rango que
  //    quedaría desfasada, así que se elimina (Excel la recalcula).
  const fila = pos.row + 1;
  const reFila = new RegExp(`<row\\b(?=[^>]*\\br="${fila}")([^>]*?)(/>|>([\\s\\S]*?)</row>)`);
  const mf = reFila.exec(xml);
  const nueva = celda(ref, undefined, value);
  if (mf) {
    const attrs = mf[1].replace(/\s+spans="[^"]*"/, "");
    let cuerpo = mf[3] ?? "";
    const reC = /<c\b[^>]*?\br="([A-Z]+)\d+"[^>]*?(?:\/>|>[\s\S]*?<\/c>)/g;
    let insertAt = cuerpo.length;
    let mc: RegExpExecArray | null;
    while ((mc = reC.exec(cuerpo))) {
      if (colIndex(mc[1]) > pos.col) {
        insertAt = mc.index;
        break;
      }
    }
    cuerpo = cuerpo.slice(0, insertAt) + nueva + cuerpo.slice(insertAt);
    return xml.slice(0, mf.index) + `<row${attrs}>${cuerpo}</row>` + xml.slice(mf.index + mf[0].length);
  }

  // 3) No existe la fila: se crea en su sitio dentro de <sheetData>.
  const filaXml = `<row r="${fila}">${nueva}</row>`;
  const reRows = /<row\b[^>]*?\br="(\d+)"/g;
  let mr: RegExpExecArray | null;
  while ((mr = reRows.exec(xml))) {
    if (Number(mr[1]) > fila) {
      return xml.slice(0, mr.index) + filaXml + xml.slice(mr.index);
    }
  }
  if (xml.includes("</sheetData>")) {
    return xml.replace("</sheetData>", filaXml + "</sheetData>");
  }
  return xml.replace(/<sheetData\s*\/>/, `<sheetData>${filaXml}</sheetData>`);
}

/** Aplica las ediciones sobre una copia del libro y devuelve el nuevo .xlsx. */
export function patchXlsx(template: Buffer | Uint8Array, edits: CellEdit[]): Buffer {
  let zip: Record<string, Uint8Array>;
  try {
    zip = unzipSync(template instanceof Uint8Array ? template : new Uint8Array(template));
  } catch {
    throw new Error("La plantilla no es un .xlsx válido (no se pudo abrir como ZIP).");
  }
  const porHoja = new Map<string, CellEdit[]>();
  for (const e of edits) {
    if (!porHoja.has(e.sheet)) {
      porHoja.set(e.sheet, []);
    }
    porHoja.get(e.sheet)!.push(e);
  }
  for (const [sheet, lista] of porHoja) {
    if (!zip[sheet]) {
      throw new Error(`La plantilla no contiene la hoja ${sheet}.`);
    }
    let xml = strFromU8(zip[sheet]);
    for (const e of lista) {
      xml = setCell(xml, e.ref, e.value, e.onlyIfExists);
    }
    zip[sheet] = strToU8(xml);
  }
  return Buffer.from(zipSync(zip, { level: 6 }));
}
