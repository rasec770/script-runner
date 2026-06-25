// Utilidades compartidas por los conversores. Portado de los scripts Python.

/** Fence de apertura/cierre: ``` o ~~~ (3+), con hint de lenguaje opcional. */
export const FENCE = /^(`{3,}|~{3,})[ \t]*([A-Za-z0-9_+-]*)[ \t]*$/;

/** Encabezado ATX: #..###### seguido de espacio. */
export const HEADING = /^(#{1,6})(\s)/;

/** Quita líneas en blanco al inicio y al final de una lista de líneas. */
export function stripBlankEdges(ls: string[]): string[] {
  let a = 0;
  let b = ls.length;
  while (a < b && ls[a].trim() === "") {
    a++;
  }
  while (b > a && ls[b - 1].trim() === "") {
    b--;
  }
  return ls.slice(a, b);
}

/** Jupyter 'source' = lista de líneas, cada una con \n salvo la última. */
export function toSourceArray(ls: string[]): string[] {
  if (ls.length === 0) {
    return [];
  }
  const out = ls.slice(0, -1).map((l) => l + "\n");
  out.push(ls[ls.length - 1]);
  return out;
}

/** Deriva el nombre del notebook desde una ruta de salida (sin extensión .ipynb). */
export function notebookName(outPath: string): string {
  const base = outPath.split("/").pop()!.split("\\").pop()!;
  return base.replace(/\.ipynb$/i, "");
}
