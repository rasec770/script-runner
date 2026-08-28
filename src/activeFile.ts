import * as vscode from "vscode";

/** Archivo activo resuelto: ruta en disco y si tiene cambios sin guardar. */
export type ActiveFile = { path: string; dirty: boolean } | { error: string };

/** Ruta en disco del documento activo del editor, o el motivo por el que no sirve.
 *
 *  Hay que mirar los dos editores: un .ipynb abre en el editor de notebooks, donde
 *  `activeTextEditor` solo está definido si además hay una celda enfocada. Con el
 *  notebook recién abierto es undefined, y mirando solo el editor de texto parecería
 *  que no hay nada abierto. */
export function activeFilePath(): ActiveFile {
  const nb = vscode.window.activeNotebookEditor?.notebook;
  if (nb) {
    if (nb.isUntitled) {
      return { error: "El notebook activo no está guardado. Guárdalo primero." };
    }
    return { path: nb.uri.fsPath, dirty: nb.isDirty };
  }

  const doc = vscode.window.activeTextEditor?.document;
  if (!doc) {
    return { error: "No hay ningún archivo abierto en el editor." };
  }
  if (doc.isUntitled) {
    return { error: "El archivo activo no está guardado. Guárdalo primero." };
  }
  // Una celda de notebook enfocada da un doc con esquema vscode-notebook-cell; su
  // fsPath ignora el fragmento y ya apunta al .ipynb, así que sirve tal cual.
  return { path: doc.uri.fsPath, dirty: doc.isDirty };
}
