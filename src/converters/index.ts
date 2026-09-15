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
  run: (input: string | Buffer, outPath: string, includeOutputs: boolean) => ConvertResult<string | Buffer>;
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
  const base = path.basename(inputPath, path.extname(inputPath));
  return path.join(dir, base + conv.outputSuffix + conv.outputExt);
}
