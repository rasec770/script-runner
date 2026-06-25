// Markdown -> Jupyter .ipynb. Portado de convert_md_to_ipynb.py.
import { FENCE, HEADING, stripBlankEdges, toSourceArray, notebookName } from "./helpers";
import { buildNotebook, ConvertResult } from "./types";

// Solo estos lenguajes se vuelven CELDA ejecutable. Otro hint o sin hint queda VERBATIM en el markdown.
const EXEC_LANGS = new Set(["scala", "python", "py", "sql", "r"]);
const DEMOTE = 2; // niveles que se bajan los encabezados (#->###) dentro del notebook

type RawCell = { kind: "markdown" | "code"; body: string[] };

function demoteHeadings(ls: string[]): string[] {
  return ls.map((l) => {
    const m = HEADING.exec(l);
    if (m) {
      const level = Math.min(m[1].length + DEMOTE, 6);
      return "#".repeat(level) + l.slice(m[1].length);
    }
    return l;
  });
}

/** Convierte texto Markdown al JSON de un notebook Jupyter. */
export function mdToIpynb(text: string, outPath: string): ConvertResult {
  const lines = text.split("\n");

  const rawCells: RawCell[] = [];
  let cur: string[] = []; // prosa markdown (incluye bloques ilustrativos verbatim)
  let curCode: string[] = []; // celda de código en curso
  let state: "md" | "code" | "illus" = "md";
  let fenceTok = "";
  let codeLang: string | null = null;

  for (const ln of lines) {
    const m = FENCE.exec(ln);
    if (state === "md") {
      if (m && EXEC_LANGS.has(m[2].toLowerCase())) {
        if (cur.length) {
          rawCells.push({ kind: "markdown", body: cur });
          cur = [];
        }
        state = "code";
        fenceTok = m[1];
        if (codeLang === null) {
          codeLang = m[2].toLowerCase();
        }
        curCode = [];
      } else if (m) {
        cur.push(ln);
        state = "illus";
        fenceTok = m[1];
      } else {
        cur.push(ln);
      }
    } else if (state === "code") {
      if (m && m[1][0] === fenceTok[0] && m[2] === "") {
        rawCells.push({ kind: "code", body: curCode });
        curCode = [];
        state = "md";
      } else {
        curCode.push(ln);
      }
    } else {
      // illus: copia verbatim al markdown hasta cerrar la fence
      cur.push(ln);
      if (m && m[1][0] === fenceTok[0] && m[2] === "") {
        state = "md";
      }
    }
  }

  // remanentes (fence sin cerrar)
  if (state === "code" && curCode.length) {
    rawCells.push({ kind: "code", body: curCode });
  } else if (cur.length) {
    rawCells.push({ kind: "markdown", body: cur });
  }

  if (codeLang === "py") {
    codeLang = "python";
  }
  codeLang = codeLang || "scala";

  const nbCells: any[] = [];
  for (const { kind, body } of rawCells) {
    const trimmed = stripBlankEdges(body);
    if (!trimmed.length) {
      continue;
    }
    if (kind === "markdown") {
      nbCells.push({
        cell_type: "markdown",
        metadata: {},
        source: toSourceArray(demoteHeadings(trimmed)),
      });
    } else {
      nbCells.push({
        cell_type: "code",
        execution_count: null,
        metadata: {},
        outputs: [],
        source: toSourceArray(trimmed),
      });
    }
  }

  const nb = buildNotebook(nbCells, codeLang, notebookName(outPath));
  const nMd = nbCells.filter((c) => c.cell_type === "markdown").length;
  const nCode = nbCells.length - nMd;

  return {
    content: JSON.stringify(nb, null, 1),
    log: `${nbCells.length} celdas: ${nMd} md, ${nCode} code, kernel=${codeLang}`,
  };
}
