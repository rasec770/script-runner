// Tipos y fábrica de notebooks compartidos por los conversores.

export interface ConvertResult<T extends string | Buffer = string> {
  /** Contenido del archivo de salida ya serializado: texto (utf8) o binario (.xlsx). */
  content: T;
  /** Resumen legible de lo que se generó (para el log del formulario). */
  log: string;
  /** Recursos binarios generados junto al archivo principal (por ejemplo, imágenes). */
  assets?: GeneratedAsset[];
}

export interface GeneratedAsset {
  /** Ruta relativa al directorio del archivo principal. */
  relativePath: string;
  content: Buffer;
}

/** Construye el objeto notebook Jupyter/Databricks común a md->ipynb y scala->ipynb. */
export function buildNotebook(nbCells: any[], lang: string, name: string) {
  return {
    cells: nbCells,
    metadata: {
      "application/vnd.databricks.v1+notebook": {
        language: lang,
        notebookName: name,
        dashboards: [],
        widgets: {},
      },
      kernelspec: {
        display_name: lang.charAt(0).toUpperCase() + lang.slice(1),
        language: lang,
        name: lang,
      },
      language_info: { name: lang },
    },
    nbformat: 4,
    nbformat_minor: 5,
  };
}
