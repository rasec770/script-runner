// CSV -> tabla Markdown (GFM). Parser propio, sin dependencias.
import { ConvertResult } from "./types";
import { normalizeInput } from "./helpers";

/** Delimitadores que se prueban cuando el archivo no dice cuál usa. */
const DELIMS = [",", ";", "\t", "|"];

const NOMBRE_DELIM: Record<string, string> = {
  ",": "coma",
  ";": "punto y coma",
  "\t": "tabulación",
  "|": "barra vertical",
};

/** Parte el texto en filas y campos siguiendo RFC 4180: comillas dobles opcionales,
 *  "" como comilla escapada y saltos de línea válidos dentro de un campo entrecomillado.
 *  El texto ya debe venir normalizado a \n. */
export function parseCsv(text: string, delim: string): string[][] {
  const filas: string[][] = [];
  let fila: string[] = [];
  let campo = "";
  let entreComillas = false;
  let i = 0;

  while (i < text.length) {
    const ch = text[i];

    if (entreComillas) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          campo += '"'; // "" es una comilla literal
          i += 2;
          continue;
        }
        entreComillas = false;
        i++;
        continue;
      }
      campo += ch;
      i++;
      continue;
    }

    // Una comilla solo abre campo si está al principio; en medio es un carácter más.
    if (ch === '"' && campo === "") {
      entreComillas = true;
      i++;
      continue;
    }
    if (ch === delim) {
      fila.push(campo);
      campo = "";
      i++;
      continue;
    }
    if (ch === "\n") {
      fila.push(campo);
      filas.push(fila);
      fila = [];
      campo = "";
      i++;
      continue;
    }

    campo += ch;
    i++;
  }

  // Última fila sin salto de línea final.
  if (campo !== "" || fila.length) {
    fila.push(campo);
    filas.push(fila);
  }
  return filas;
}

/** Elige el delimitador que parte el archivo de forma más consistente. Prima que todas
 *  las filas tengan el mismo nº de campos; a igualdad, el que produce más columnas. */
function detectarDelim(text: string): string {
  let mejor = ",";
  let mejorPuntaje = -1;

  for (const d of DELIMS) {
    const filas = parseCsv(text, d);
    if (!filas.length) {
      continue;
    }
    const cols = filas[0].length;
    if (cols < 2) {
      continue; // no partió nada: no es el delimitador
    }
    const iguales = filas.filter((f) => f.length === cols).length;
    const puntaje = Math.round((1000 * iguales) / filas.length) * 100 + Math.min(cols, 99);
    if (puntaje > mejorPuntaje) {
      mejorPuntaje = puntaje;
      mejor = d;
    }
  }
  return mejor;
}

/** Contenido de una celda GFM: sin saltos reales (parten la tabla), sin | suelto
 *  (abriría otra columna) y sin que el dato se cuele como HTML. */
export function mdCell(v: string): string {
  return v
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/\|/g, "\\|")
    .trim()
    .replace(/[ \t]*\n[ \t]*/g, "<br>");
}

export function csvToMd(text: string): ConvertResult {
  const limpio = normalizeInput(text);
  const delim = detectarDelim(limpio);

  // Una línea en blanco suelta no es un registro; un ,,, sí lo es.
  const filas = parseCsv(limpio, delim).filter((f) => !(f.length === 1 && f[0].trim() === ""));
  if (!filas.length) {
    throw new Error("El CSV no tiene ninguna fila.");
  }

  const cols = filas.reduce((n, f) => Math.max(n, f.length), 0);
  const linea = (celdas: string[]) =>
    "| " + Array.from({ length: cols }, (_, i) => mdCell(celdas[i] ?? "")).join(" | ") + " |";

  const out = [linea(filas[0]), "| " + Array(cols).fill("---").join(" | ") + " |"];
  for (const f of filas.slice(1)) {
    out.push(linea(f));
  }

  const irregulares = filas.filter((f) => f.length !== cols).length;
  const aviso = irregulares
    ? `, ${irregulares} fila(s) con distinto nº de campos (rellenadas)`
    : "";
  return {
    content: out.join("\n") + "\n",
    log: `${cols} columnas x ${filas.length - 1} filas de datos, delimitador: ${
      NOMBRE_DELIM[delim] ?? delim
    }${aviso}`,
  };
}
