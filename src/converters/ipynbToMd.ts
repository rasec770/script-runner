// Jupyter .ipynb -> Markdown. Portado de convert_ipynb_to_md.py.
import { FENCE, HEADING, normalizeInput } from "./helpers";
import { ConvertResult } from "./types";

const PROMOTE = 2; // niveles que se SUBEN los encabezados (###->#); inverso del demote directo

// Limpieza de salidas/errores.
const ANSI = /\x1b\[[0-9;]*m/g;
const MULTI_BLANK = /\n{3,}/g;

/** Un trozo de salida ya renderizado: texto plano (va dentro de ```text) o tabla Markdown. */
type Block = { text: string; table: boolean };

/** Desescapa las entidades HTML más comunes (equivalente práctico a html.unescape). */
function htmlUnescape(s: string): string {
  return s
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&nbsp;/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

/** Aplana HTML a texto plano: respeta saltos de bloque, quita tags y desescapa entidades. */
function htmlToText(h: string): string {
  h = h.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "");
  h = h.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "");
  h = h.replace(/<br\s*\/?>/gi, "\n");
  h = h.replace(/<\/(div|p|tr|li|h[1-6]|table|thead|tbody)>/gi, "\n");
  h = h.replace(/<\/(td|th)>/gi, "\t");
  h = h.replace(/<[^>]+>/g, "");
  return htmlUnescape(h);
}

/** Quita ANSI, recorta espacios por línea y colapsa líneas en blanco repetidas. */
function cleanText(s: string): string {
  s = s.replace(ANSI, "");
  s = s
    .split("\n")
    .map((line) => line.replace(/\s+$/, ""))
    .join("\n");
  s = s.replace(MULTI_BLANK, "\n\n");
  return s.replace(/^\n+|\n+$/g, "");
}

/** Texto de una celda, aplanado a una sola línea y con los pipes escapados. */
function tableCell(html: string): string {
  return htmlToText(html)
    .replace(ANSI, "")
    .trim()
    .replace(/\s*\n\s*/g, "<br>")
    .replace(/\|/g, "\\|");
}

/** Convierte el interior de un <table> en una tabla Markdown, o null si no se puede. */
function tableToMarkdown(inner: string): string | null {
  if (/<table\b/i.test(inner)) {
    return null; // tabla anidada: se aplana como texto, no vale la pena adivinar
  }
  const rowRe = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
  const rows: string[][] = [];
  let r: RegExpExecArray | null;
  while ((r = rowRe.exec(inner))) {
    const cellRe = /<(t[hd])\b[^>]*>([\s\S]*?)<\/\1>/gi;
    const cells: string[] = [];
    let c: RegExpExecArray | null;
    while ((c = cellRe.exec(r[1]))) {
      cells.push(tableCell(c[2]));
    }
    if (cells.length) {
      rows.push(cells);
    }
  }
  if (!rows.length) {
    return null;
  }

  const cols = rows.reduce((n, row) => Math.max(n, row.length), 0);
  const line = (cells: string[]) =>
    "| " + Array.from({ length: cols }, (_, i) => cells[i] ?? "").join(" | ") + " |";

  const out = [line(rows[0]), "| " + Array(cols).fill("---").join(" | ") + " |"];
  for (const row of rows.slice(1)) {
    out.push(line(row));
  }
  return out.join("\n");
}

/** Parte un HTML de salida en bloques: cada <table> se vuelve tabla Markdown y el resto
 *  se aplana a texto. Es la forma exacta que emite `display()` en Databricks. */
function htmlToBlocks(h: string): Block[] {
  h = h.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "");
  h = h.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "");

  const blocks: Block[] = [];
  const pushText = (s: string) => {
    const t = cleanText(htmlToText(s));
    if (t) {
      blocks.push({ text: t, table: false });
    }
  };

  const tableRe = /<table\b[^>]*>([\s\S]*?)<\/table>/gi;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = tableRe.exec(h))) {
    const md = tableToMarkdown(m[1]);
    if (!md) {
      continue; // queda para el aplanado de texto
    }
    pushText(h.slice(last, m.index));
    blocks.push({ text: md, table: true });
    last = m.index + m[0].length;
  }
  pushText(h.slice(last));
  return blocks;
}

function joinSource(src: any): string {
  if (Array.isArray(src)) {
    return normalizeInput(src.join(""));
  }
  return typeof src === "string" ? normalizeInput(src) : "";
}

function textBlock(s: string): Block[] {
  return s ? [{ text: s, table: false }] : [];
}

/** Renderiza una salida de celda como bloques, indicando si es un error. */
function outputToBlocks(o: any): { blocks: Block[]; isError: boolean } {
  const t = o.output_type;
  if (t === "stream") {
    return { blocks: textBlock(cleanText(joinSource(o.text))), isError: false };
  }
  if (t === "execute_result" || t === "display_data") {
    const data = o.data || {};
    if ("text/html" in data) {
      return { blocks: htmlToBlocks(joinSource(data["text/html"])), isError: false };
    }
    if ("text/plain" in data) {
      return { blocks: textBlock(cleanText(joinSource(data["text/plain"]))), isError: false };
    }
    if (Object.keys(data).length) {
      const aviso = "[salida no textual: " + Object.keys(data).sort().join(", ") + "]";
      return { blocks: textBlock(aviso), isError: false };
    }
    return { blocks: [], isError: false };
  }
  if (t === "error") {
    const ename = o.ename || "";
    const evalue = o.evalue || "";
    const head = [ename, evalue].filter(Boolean).join(": ");
    const tb = (o.traceback || []).join("\n");
    return { blocks: textBlock(cleanText((head + "\n" + tb).trim())), isError: true };
  }
  return { blocks: [], isError: false };
}

/** Agrupa bloques bajo un título: el texto plano se junta en ```text, las tablas van sueltas. */
function renderGroup(titulo: string, blocks: Block[]): string[] {
  if (!blocks.length) {
    return [];
  }
  const out = [titulo];
  let buf: string[] = [];
  const flush = () => {
    if (buf.length) {
      out.push("```text\n" + buf.join("\n") + "\n```");
      buf = [];
    }
  };
  for (const b of blocks) {
    if (b.table) {
      flush();
      out.push(b.text);
    } else {
      buf.push(b.text);
    }
  }
  flush();
  return out;
}

/** Bloques markdown con SALIDAS y ERRORES de una celda de código (o [] si no hay). */
function renderOutputs(cell: any): string[] {
  const salidas: Block[] = [];
  const errores: Block[] = [];
  for (const o of cell.outputs || []) {
    const { blocks, isError } = outputToBlocks(o);
    (isError ? errores : salidas).push(...blocks);
  }
  return [...renderGroup("**Salida:**", salidas), ...renderGroup("**Error:**", errores)];
}

/** Sube PROMOTE niveles los encabezados ATX, sin tocar lo que esté dentro de fences. */
function promoteHeadings(text: string): string[] {
  const out: string[] = [];
  let inFence = false;
  let fenceTok = "";
  for (const l of text.split("\n")) {
    const m = FENCE.exec(l);
    if (m && !inFence) {
      inFence = true;
      fenceTok = m[1];
      out.push(l);
      continue;
    }
    if (m && inFence && m[1][0] === fenceTok[0] && m[2] === "") {
      inFence = false;
      out.push(l);
      continue;
    }
    let line = l;
    if (!inFence) {
      const h = HEADING.exec(l);
      if (h) {
        const level = Math.max(h[1].length - PROMOTE, 1);
        line = "#".repeat(level) + l.slice(h[1].length);
      }
    }
    out.push(line);
  }
  return out;
}

/** Backticks suficientes para que el contenido no rompa el fence (>= run interno + 1, min 3). */
function fenceFor(code: string): string {
  const runs = code.match(/`+/g) || [];
  const longest = runs.reduce((max, r) => Math.max(max, r.length), 0);
  return "`".repeat(Math.max(3, longest + 1));
}

/** Convierte el JSON de un notebook a Markdown. */
export function ipynbToMd(jsonText: string, includeOutputs: boolean): ConvertResult {
  const nb = JSON.parse(normalizeInput(jsonText));

  const meta = nb.metadata || {};
  const codeLang =
    meta.language_info?.name || meta.kernelspec?.language || "scala";

  const blocks: string[] = [];
  let nOut = 0;
  let nErr = 0;
  let nTab = 0;

  for (const cell of nb.cells || []) {
    const txt = joinSource(cell.source).replace(/^\n+|\n+$/g, "");
    if (!txt) {
      continue;
    }
    if (cell.cell_type === "code") {
      const f = fenceFor(txt);
      blocks.push(f + codeLang + "\n" + txt + "\n" + f);
      if (includeOutputs) {
        const partes = (cell.outputs || []).map((o: any) => outputToBlocks(o));
        const conBloques = partes.filter((p: any) => p.blocks.length);
        if (conBloques.some((p: any) => !p.isError)) {
          nOut++;
        }
        if (conBloques.some((p: any) => p.isError)) {
          nErr++;
        }
        nTab += conBloques.reduce(
          (n: number, p: any) => n + p.blocks.filter((b: Block) => b.table).length,
          0
        );
        blocks.push(...renderOutputs(cell));
      }
    } else {
      blocks.push(promoteHeadings(txt).join("\n"));
    }
  }

  const nMd = (nb.cells || []).filter(
    (c: any) => c.cell_type === "markdown" && joinSource(c.source).replace(/^\n+|\n+$/g, "")
  ).length;
  const nCode = (nb.cells || []).filter(
    (c: any) => c.cell_type === "code" && joinSource(c.source).replace(/^\n+|\n+$/g, "")
  ).length;

  const extra = includeOutputs
    ? `, salidas=${nOut}, errores=${nErr}, tablas=${nTab}`
    : "";
  return {
    content: blocks.join("\n\n") + "\n",
    log: `${nMd + nCode} bloques: ${nMd} md, ${nCode} code${extra}, lenguaje=${codeLang}`,
  };
}
