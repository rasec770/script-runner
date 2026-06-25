// Jupyter .ipynb -> Markdown. Portado de convert_ipynb_to_md.py.
import { FENCE, HEADING } from "./helpers";
import { ConvertResult } from "./types";

const PROMOTE = 2; // niveles que se SUBEN los encabezados (###->#); inverso del demote directo

// Limpieza de salidas/errores.
const ANSI = /\x1b\[[0-9;]*m/g;
const MULTI_BLANK = /\n{3,}/g;

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

function joinSource(src: any): string {
  if (Array.isArray(src)) {
    return src.join("");
  }
  return typeof src === "string" ? src : "";
}

/** Devuelve [texto, esError] para una salida de celda, o [null, _] si no hay nada útil. */
function outputToText(o: any): [string | null, boolean] {
  const t = o.output_type;
  if (t === "stream") {
    return [cleanText(joinSource(o.text)), false];
  }
  if (t === "execute_result" || t === "display_data") {
    const data = o.data || {};
    let txt: string;
    if ("text/html" in data) {
      txt = htmlToText(joinSource(data["text/html"]));
    } else if ("text/plain" in data) {
      txt = joinSource(data["text/plain"]);
    } else if (Object.keys(data).length) {
      txt = "[salida no textual: " + Object.keys(data).sort().join(", ") + "]";
    } else {
      return [null, false];
    }
    return [cleanText(txt), false];
  }
  if (t === "error") {
    const ename = o.ename || "";
    const evalue = o.evalue || "";
    const head = [ename, evalue].filter(Boolean).join(": ");
    const tb = (o.traceback || []).join("\n");
    return [cleanText((head + "\n" + tb).trim()), true];
  }
  return [null, false];
}

/** Bloques markdown con SALIDAS y ERRORES de una celda de código (o [] si no hay). */
function renderOutputs(cell: any): string[] {
  const salidas: string[] = [];
  const errores: string[] = [];
  for (const o of cell.outputs || []) {
    const [txt, isErr] = outputToText(o);
    if (!txt) {
      continue;
    }
    (isErr ? errores : salidas).push(txt);
  }
  const bloques: string[] = [];
  if (salidas.length) {
    bloques.push("**Salida:**\n\n```text\n" + salidas.join("\n") + "\n```");
  }
  if (errores.length) {
    bloques.push("**Error:**\n\n```text\n" + errores.join("\n") + "\n```");
  }
  return bloques;
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
  const nb = JSON.parse(jsonText);

  const meta = nb.metadata || {};
  const codeLang =
    meta.language_info?.name || meta.kernelspec?.language || "scala";

  const blocks: string[] = [];
  let nOut = 0;
  let nErr = 0;

  for (const cell of nb.cells || []) {
    const txt = joinSource(cell.source).replace(/^\n+|\n+$/g, "");
    if (!txt) {
      continue;
    }
    if (cell.cell_type === "code") {
      const f = fenceFor(txt);
      blocks.push(f + codeLang + "\n" + txt + "\n" + f);
      if (includeOutputs) {
        const flags = (cell.outputs || [])
          .map((o: any) => outputToText(o))
          .filter(([t]: [string | null, boolean]) => t)
          .map(([, e]: [string | null, boolean]) => e);
        if (flags.some((e: boolean) => !e)) {
          nOut++;
        }
        if (flags.some((e: boolean) => e)) {
          nErr++;
        }
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

  const extra = includeOutputs ? `, salidas=${nOut}, errores=${nErr}` : "";
  return {
    content: blocks.join("\n\n") + "\n",
    log: `${nMd + nCode} bloques: ${nMd} md, ${nCode} code${extra}, lenguaje=${codeLang}`,
  };
}
