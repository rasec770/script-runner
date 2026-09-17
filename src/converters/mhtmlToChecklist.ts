// Jira MHTML -> checklist de revisión en Excel. La plantilla NO viaja con la extensión:
// es un documento interno de quien la usa, así que se lee de su disco y aquí solo se
// rellenan celdas. Por defecto las respuestas de la plantilla se conservan, porque casi
// todos los pases comparten estructura y quien revisa solo corrige lo que cambia. Las celdas se localizan por su etiqueta ("MVP", "RESULTADO"…), no por
// posición fija, para tolerar que la plantilla cambie de filas.
import { ConvertResult } from "./types";
import { readJiraIssue } from "./mhtmlToMd";
import { colLetter, parseRef, readXlsxCells, XlsxSheetCells } from "./xlsxFile";
import { CellEdit, patchXlsx } from "./xlsxPatch";

export interface ChecklistOptions {
  /** Contenido de la plantilla .xlsx. */
  template: Buffer;
  /** Nombre de quien revisa. Si falta, se usa el campo CL-DEV de la incidencia. */
  reviewer?: string;
  /** Fecha para el historial de versiones (por defecto, hoy). */
  today?: Date;
  /** `true` (por defecto): el checklist sale respondido como la plantilla. `false`: se
   *  vacían las respuestas y se marca NO APLICA lo que el pase no menciona. */
  keepAnswers?: boolean;
}

/** Mayúsculas, sin tildes y con espacios simples: "Descripción " -> "DESCRIPCION". */
function norm(s: string): string {
  return s.normalize("NFD").replace(/\p{M}/gu, "").toUpperCase().replace(/\s+/g, " ").trim();
}

interface Celda {
  ref: string;
  row: number;
  col: number;
  text: string;
}

function celdasDe(sheet: XlsxSheetCells): Celda[] {
  const out: Celda[] = [];
  for (const [ref, cell] of sheet.cells) {
    const pos = parseRef(ref);
    if (pos && cell.text !== "") {
      out.push({ ref, row: pos.row, col: pos.col, text: cell.text });
    }
  }
  return out.sort((a, b) => a.row - b.row || a.col - b.col);
}

const refDe = (col: number, row: number) => colLetter(col) + (row + 1);

/** Primer valor no vacío entre varios campos de la incidencia. */
function campo(fields: Map<string, string>, ...labels: string[]): string {
  for (const l of labels) {
    const v = fields.get(l)?.trim();
    if (v) {
      return v;
    }
  }
  return "";
}

/** Tecnología de una sección del checklist y cómo reconocerla en el texto del pase.
 *  El orden importa: la primera regla cuyo título coincide decide. */
const SECCIONES: Array<{ titulo: RegExp; mencion: RegExp; nombre: string }> = [
  { titulo: /COSMOS/, mencion: /COSMOS/, nombre: "Cosmos DB" },
  { titulo: /KAFKA/, mencion: /KAFKA/, nombre: "Kafka Connect" },
  { titulo: /POWER ?SHELL/, mencion: /POWER ?SHELL|\.PS1\b|\.BAT\b|FILE ?SERVER/, nombre: "PowerShell ni File Server" },
  { titulo: /SERVICIOS COMPARTIDOS/, mencion: /SERVICIOS? COMPARTIDOS?|SHARED/, nombre: "servicios compartidos" },
  { titulo: /DATA ?FACTORY/, mencion: /DATA ?FACTORY|\bADF\b/, nombre: "Data Factory" },
  { titulo: /DATABRICKS|CLUSTER/, mencion: /DATABRICKS|CLUSTER/, nombre: "Databricks" },
];

const NO_APLICA = "NO APLICA";

export function mhtmlToChecklist(raw: string, opts: ChecklistOptions): ConvertResult<Buffer> {
  const issue = readJiraIssue(raw);
  if (!issue.key) {
    throw new Error("No se encontró la clave de la incidencia (p. ej. OCD-123) en el MHTML.");
  }
  const sheets = readXlsxCells(opts.template);
  const principal = sheets.find((s) => celdasDe(s).some((c) => norm(c.text) === "MVP"));
  if (!principal) {
    throw new Error('La plantilla no parece un checklist: ninguna hoja tiene la celda "MVP".');
  }
  const celdas = celdasDe(principal);
  const edits: CellEdit[] = [];
  const avisos: string[] = [];
  const keepAnswers = opts.keepAnswers ?? true;

  // --- 1. Datos generales: el valor va en la celda a la derecha de cada etiqueta. -----
  const reviewer = opts.reviewer?.trim() || campo(issue.fields, "CL-DEV");
  const datos: Array<[string, string]> = [
    ["MVP", issue.key],
    ["OWNER", campo(issue.fields, "Informador", "Persona asignada")],
    ["QA", campo(issue.fields, "QE", "CL-QA")],
    ["DESCRIPCION", issue.summary],
    ["REVIEWER", reviewer],
  ];
  for (const [etiqueta, valor] of datos) {
    const c = celdas.find((x) => norm(x.text) === etiqueta);
    if (!c) {
      avisos.push(`la plantilla no tiene la etiqueta ${etiqueta}`);
      continue;
    }
    if (!valor) {
      avisos.push(`sin dato en Jira para ${etiqueta}`);
    }
    edits.push({ sheet: principal.path, ref: refDe(c.col + 1, c.row), value: valor || null });
  }

  // --- 2. Tabla de ambientes (DESA/CERT/PROD): se vacían las respuestas del ejemplo. ---
  const ambientes = keepAnswers ? [] : celdas.filter((x) => ["DESA", "CERT", "PROD"].includes(norm(x.text)));
  for (const c of ambientes) {
    for (const otra of celdas.filter((x) => x.row === c.row && x.col > c.col && x.col <= c.col + 12)) {
      edits.push({ sheet: principal.path, ref: otra.ref, value: null });
    }
  }

  // --- 3. Validaciones: columnas RESULTADO y OBSERVACIÓN bajo su fila de títulos. ------
  const obs = celdas.find((x) => norm(x.text) === "OBSERVACION");
  const res = obs && celdas.find((x) => x.row === obs.row && norm(x.text) === "RESULTADO");
  let autoNoAplica = 0;
  let items = 0;
  let respondidas = 0;
  if (!obs || !res) {
    avisos.push("la plantilla no tiene las columnas RESULTADO y OBSERVACIÓN en una misma fila");
  } else if (keepAnswers) {
    // Solo se cuentan, para informar de cuántas respuestas trae ya la plantilla.
    const conResultado = celdas.filter((x) => x.col === res.col && x.row > res.row);
    respondidas = conResultado.length;
  } else {
    const colEtiqueta = Math.min(...celdas.filter((x) => x.row === obs.row).map((x) => x.col));
    const etiquetas = new Map(celdas.filter((x) => x.col === colEtiqueta && x.row > obs.row).map((x) => [x.row, x]));
    const ultima = Math.max(obs.row, ...etiquetas.keys());

    // Solo se deduce aplicabilidad si el pase trae instrucciones que analizar.
    const corpus = norm([issue.summary, issue.description, ...issue.instructions.values()].join(" "));
    const hayInstrucciones = issue.instructions.size > 0;

    // Las secciones van separadas por una fila en blanco; la primera fila de cada bloque
    // es su título y las demás son las validaciones.
    let seccion: (typeof SECCIONES)[number] | undefined;
    let enBloque = false;
    for (let row = obs.row + 1; row <= ultima; row++) {
      const et = etiquetas.get(row);
      if (!et) {
        enBloque = false;
        continue;
      }
      if (!enBloque) {
        enBloque = true;
        const titulo = norm(et.text);
        seccion = SECCIONES.find((s) => s.titulo.test(titulo));
        continue;
      }
      items++;
      const noAplica = hayInstrucciones && seccion !== undefined && !seccion.mencion.test(corpus);
      if (noAplica) {
        autoNoAplica++;
      }
      edits.push({
        sheet: principal.path,
        ref: refDe(res.col, row),
        value: noAplica ? NO_APLICA : null,
        onlyIfExists: !noAplica,
      });
      edits.push({
        sheet: principal.path,
        ref: refDe(obs.col, row),
        value: noAplica ? `Automático: el pase no menciona ${seccion!.nombre}.` : null,
        onlyIfExists: !noAplica,
      });
    }
  }

  // --- 4. Historial de versiones: primera fila de datos con la fecha y el revisor. -----
  for (const hoja of sheets) {
    const cs = celdasDe(hoja);
    const fecha = cs.find((x) => norm(x.text) === "FECHA");
    if (!fecha || hoja === principal) {
      continue;
    }
    const titulos = cs.filter((x) => x.row === fecha.row);
    const hoy = opts.today ?? new Date();
    const serial = Math.floor(
      (Date.UTC(hoy.getFullYear(), hoy.getMonth(), hoy.getDate()) - Date.UTC(1899, 11, 30)) / 86400000
    );
    edits.push({ sheet: hoja.path, ref: refDe(fecha.col, fecha.row + 1), value: serial });
    const rev = titulos.find((x) => norm(x.text) === "REVIEWER");
    if (rev) {
      edits.push({ sheet: hoja.path, ref: refDe(rev.col, rev.row + 1), value: reviewer || null });
    }
    const resultado = titulos.find((x) => norm(x.text) === "RESULTADO");
    if (resultado && !keepAnswers) {
      edits.push({ sheet: hoja.path, ref: refDe(resultado.col, resultado.row + 1), value: null, onlyIfExists: true });
    }
  }

  const log = [
    `Checklist de ${issue.key}: ${datos.filter(([, v]) => v).length} de ${datos.length} datos generales rellenados.`,
    keepAnswers
      ? `Se conservan las ${respondidas} respuestas de la plantilla (resultados, observaciones y ambientes): revisa solo lo que cambie en este pase.`
      : items
        ? `${items} validaciones: ${autoNoAplica} marcadas ${NO_APLICA} de forma automática, ${items - autoNoAplica} en blanco para revisar.`
        : "",
    avisos.length ? `Avisos: ${avisos.join("; ")}.` : "",
  ]
    .filter(Boolean)
    .join("\n");
  return { content: patchXlsx(opts.template, edits), log };
}
