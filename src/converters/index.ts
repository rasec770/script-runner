// Registro de conversores disponibles. El formulario se construye a partir de esta lista.
import * as path from "path";
import { ConvertResult } from "./types";
import { mdToIpynb } from "./mdToIpynb";
import { scalaToIpynb } from "./scalaToIpynb";
import { ipynbToMd } from "./ipynbToMd";

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
  run: (input: string, outPath: string, includeOutputs: boolean) => ConvertResult;
}

export const CONVERTERS: Converter[] = [
  {
    id: "md-to-ipynb",
    label: "Markdown → Jupyter (.ipynb)",
    inputExts: [".md"],
    outputExt: ".ipynb",
    hasOutputsOption: false,
    outputSuffix: "",
    run: (input, outPath) => mdToIpynb(input, outPath),
  },
  {
    id: "scala-to-ipynb",
    label: "Scala Databricks → Jupyter (.ipynb)",
    inputExts: [".scala"],
    outputExt: ".ipynb",
    hasOutputsOption: false,
    outputSuffix: "",
    run: (input, outPath) => scalaToIpynb(input, outPath),
  },
  {
    id: "ipynb-to-md",
    label: "Jupyter (.ipynb) → Markdown",
    inputExts: [".ipynb"],
    outputExt: ".md",
    hasOutputsOption: true,
    // El .md suele ser la fuente de verdad: no pisarlo por defecto.
    outputSuffix: "_reconstruido",
    run: (input, _outPath, includeOutputs) => ipynbToMd(input, includeOutputs),
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
