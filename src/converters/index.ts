// Registro de conversores disponibles. El formulario se construye a partir de esta lista.
import * as path from "path";
import { ConvertResult } from "./types";
import { mdToIpynb } from "./mdToIpynb";
import { scalaToIpynb } from "./scalaToIpynb";
import { ipynbToMd } from "./ipynbToMd";
import { csvToMd } from "./csvToMd";
import { mhtmlToMd } from "./mhtmlToMd";
import { mdToXlsx } from "./mdToXlsx";
import { xlsxToMd } from "./xlsxToMd";
import { mhtmlToChecklist } from "./mhtmlToChecklist";

/** Datos extra que algunos conversores necesitan además del archivo de entrada. */
export interface RunOptions {
  /** Contenido de la plantilla .xlsx (conversores con `needsTemplate`). */
  template?: Buffer;
  /** Nombre de quien revisa, para el checklist. */
  reviewer?: string;
  /** Si el checklist conserva las respuestas de la plantilla (por defecto, sí). */
  keepAnswers?: boolean;
}

export interface Converter {
  id: string;
  label: string;
  /** Extensiones de entrada aceptadas (para el diálogo y la validación). */
  inputExts: string[];
  /** Extensión del archivo de salida. */
  outputExt: string;
  /** Si expone la opción "incluir salidas" (solo ipynb->md). */
  hasOutputsOption: boolean;
  /** Sufijo por defecto que se añade al nombre de salida (evita pisar la fuente). */
  outputSuffix: string;
  /** Si la entrada se lee como binario (Buffer) en vez de texto utf8. */
  binaryInput?: boolean;
  /** Si necesita una plantilla .xlsx del usuario; la extensión la pide y la recuerda. */
  needsTemplate?: boolean;
  /** Nombre de salida propio (sin carpeta) cuando no basta con cambiar la extensión. */
  outputName?: (inputPath: string) => string | undefined;
  run: (
    input: string | Buffer,
    outPath: string,
    includeOutputs: boolean,
    options?: RunOptions
  ) => ConvertResult<string | Buffer>;
}

/** Entrada como texto; los conversores de texto reciben siempre string, esto solo tipa. */
const text = (input: string | Buffer): string => (Buffer.isBuffer(input) ? input.toString("utf8") : input);
const binary = (input: string | Buffer): Buffer => (Buffer.isBuffer(input) ? input : Buffer.from(input, "utf8"));

export const CONVERTERS: Converter[] = [
  {
    id: "md-to-ipynb",
    label: "Markdown → Jupyter (.ipynb)",
    inputExts: [".md"],
    outputExt: ".ipynb",
    hasOutputsOption: false,
    outputSuffix: "",
    run: (input, outPath) => mdToIpynb(text(input), outPath),
  },
  {
    id: "scala-to-ipynb",
    label: "Scala Databricks → Jupyter (.ipynb)",
    inputExts: [".scala"],
    outputExt: ".ipynb",
    hasOutputsOption: false,
    outputSuffix: "",
    run: (input, outPath) => scalaToIpynb(text(input), outPath),
  },
  {
    id: "ipynb-to-md",
    label: "Jupyter (.ipynb) → Markdown",
    inputExts: [".ipynb"],
    outputExt: ".md",
    hasOutputsOption: true,
    // El .md suele ser la fuente de verdad: no pisarlo por defecto.
    outputSuffix: "_reconstruido",
    run: (input, _outPath, includeOutputs) => ipynbToMd(text(input), includeOutputs),
  },
  {
    id: "csv-to-md",
    label: "CSV → Tabla Markdown",
    inputExts: [".csv", ".tsv"],
    outputExt: ".md",
    hasOutputsOption: false,
    outputSuffix: "",
    run: (input) => csvToMd(text(input)),
  },
  {
    id: "mhtml-to-md",
    label: "Jira MHTML → Markdown",
    inputExts: [".mhtml", ".mht"],
    outputExt: ".md",
    hasOutputsOption: false,
    outputSuffix: "",
    run: (input, outPath) => mhtmlToMd(text(input), outPath),
  },
  {
    id: "mhtml-to-checklist",
    label: "Jira MHTML → Checklist Excel (.xlsx)",
    inputExts: [".mhtml", ".mht"],
    outputExt: ".xlsx",
    hasOutputsOption: false,
    outputSuffix: "",
    needsTemplate: true,
    // "[#OCD-233595] Título largo.mhtml" -> "CHECKLIST-OCD-233595.xlsx"
    outputName: (inputPath) => {
      const key = /\b([A-Z][A-Z0-9_]*-\d+)\b/.exec(path.basename(inputPath))?.[1];
      return key ? `CHECKLIST-${key}.xlsx` : undefined;
    },
    run: (input, _outPath, _includeOutputs, options) => {
      if (!options?.template) {
        throw new Error("Falta la plantilla del checklist (.xlsx).");
      }
      return mhtmlToChecklist(text(input), {
        template: options.template,
        reviewer: options.reviewer,
        keepAnswers: options.keepAnswers,
      });
    },
  },
  {
    id: "md-to-xlsx",
    label: "Markdown (tablas) → Excel (.xlsx)",
    inputExts: [".md"],
    outputExt: ".xlsx",
    hasOutputsOption: false,
    outputSuffix: "",
    run: (input) => mdToXlsx(text(input)),
  },
  {
    id: "xlsx-to-md",
    label: "Excel (.xlsx) → Markdown (tablas)",
    inputExts: [".xlsx"],
    outputExt: ".md",
    hasOutputsOption: false,
    outputSuffix: "",
    binaryInput: true,
    run: (input) => xlsxToMd(binary(input)),
  },
];

export function getConverter(id: string): Converter | undefined {
  return CONVERTERS.find((c) => c.id === id);
}

/** Deriva la ruta de salida por defecto a partir de la entrada y el conversor. */
export function defaultOutputPath(inputPath: string, conv: Converter): string {
  const dir = path.dirname(inputPath);
  const propio = conv.outputName?.(inputPath);
  if (propio) {
    return path.join(dir, propio);
  }
  const base = path.basename(inputPath, path.extname(inputPath));
  return path.join(dir, base + conv.outputSuffix + conv.outputExt);
}
