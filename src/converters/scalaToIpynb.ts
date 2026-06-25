// Scala (notebook Databricks) -> Jupyter .ipynb. Portado de convert_scala_to_ipynb.py.
import { stripBlankEdges, toSourceArray, notebookName } from "./helpers";
import { buildNotebook, ConvertResult } from "./types";

/** Convierte un .scala de Databricks (celdas `// COMMAND ----------`) al JSON de un notebook. */
export function scalaToIpynb(text: string, outPath: string): ConvertResult {
  let lines = text.split("\n");
  if (lines.length && lines[0].trim() === "// Databricks notebook source") {
    lines = lines.slice(1);
  }

  // Separa en celdas crudas por el separador COMMAND.
  const rawCells: string[][] = [];
  let cur: string[] = [];
  for (const ln of lines) {
    if (ln.trim() === "// COMMAND ----------") {
      rawCells.push(cur);
      cur = [];
    } else {
      cur.push(ln);
    }
  }
  rawCells.push(cur);

  const nbCells: any[] = [];
  for (const raw of rawCells) {
    const cell = stripBlankEdges(raw);
    if (!cell.length) {
      continue;
    }
    const isMd = cell[0].trimStart().startsWith("// MAGIC %md");
    if (isMd) {
      const md: string[] = [];
      for (const s of cell) {
        if (s.startsWith("// MAGIC %md")) {
          continue;
        }
        if (s.startsWith("// MAGIC ")) {
          md.push(s.slice("// MAGIC ".length));
        } else if (s.trim() === "// MAGIC") {
          md.push("");
        } else {
          md.push(s);
        }
      }
      nbCells.push({
        cell_type: "markdown",
        metadata: {},
        source: toSourceArray(stripBlankEdges(md)),
      });
    } else {
      nbCells.push({
        cell_type: "code",
        execution_count: null,
        metadata: {},
        outputs: [],
        source: toSourceArray(cell),
      });
    }
  }

  const nb = buildNotebook(nbCells, "scala", notebookName(outPath));
  const nMd = nbCells.filter((c) => c.cell_type === "markdown").length;
  const nCode = nbCells.length - nMd;

  return {
    content: JSON.stringify(nb, null, 1),
    log: `${nbCells.length} celdas: ${nMd} md, ${nCode} code, kernel=scala`,
  };
}
