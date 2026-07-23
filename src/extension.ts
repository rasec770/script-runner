import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import { CONVERTERS, getConverter, defaultOutputPath } from "./converters";

export function activate(context: vscode.ExtensionContext): void {
  const provider = new FormViewProvider(context.extensionUri);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(FormViewProvider.viewType, provider)
  );
}

export function deactivate(): void {
  /* nada que limpiar */
}

class FormViewProvider implements vscode.WebviewViewProvider {
  static readonly viewType = "scriptRunner.form";

  constructor(private readonly extensionUri: vscode.Uri) {}

  resolveWebviewView(view: vscode.WebviewView): void {
    view.webview.options = { enableScripts: true, localResourceRoots: [this.extensionUri] };
    view.webview.html = this.getHtml(view.webview);

    view.webview.onDidReceiveMessage(async (msg) => {
      switch (msg.type) {
        case "ready":
          view.webview.postMessage({
            type: "converters",
            list: CONVERTERS.map((c) => ({
              id: c.id,
              label: c.label,
              hasOutputsOption: c.hasOutputsOption,
              inputExts: c.inputExts,
            })),
          });
          break;

        case "browse": {
          const conv = getConverter(msg.converterId);
          const filters: { [k: string]: string[] } = conv
            ? { Soportado: conv.inputExts.map((e) => e.replace(".", "")) }
            : {};
          const picked = await vscode.window.showOpenDialog({
            canSelectMany: false,
            openLabel: "Seleccionar",
            filters,
          });
          if (picked && picked[0]) {
            const inputPath = picked[0].fsPath;
            const out = conv ? defaultOutputPath(inputPath, conv) : "";
            view.webview.postMessage({ type: "picked", inputPath, outputPath: out });
          }
          break;
        }

        case "defaultOutput": {
          const conv = getConverter(msg.converterId);
          if (conv && msg.inputPath) {
            view.webview.postMessage({
              type: "outputSuggestion",
              outputPath: defaultOutputPath(msg.inputPath, conv),
            });
          }
          break;
        }

        case "useActive": {
          const editor = vscode.window.activeTextEditor;
          if (!editor) {
            view.webview.postMessage({
              type: "log",
              level: "error",
              message: "No hay ningún archivo abierto en el editor.",
            });
            break;
          }
          const doc = editor.document;
          if (doc.isUntitled) {
            view.webview.postMessage({
              type: "log",
              level: "error",
              message: "El archivo activo no está guardado. Guárdalo primero.",
            });
            break;
          }
          const inputPath = doc.uri.fsPath;
          const ext = path.extname(inputPath).toLowerCase();
          const conv = CONVERTERS.find((c) => c.inputExts.includes(ext));
          if (!conv) {
            view.webview.postMessage({
              type: "log",
              level: "error",
              message: `No hay conversor para "${ext}" (se admiten .md, .scala, .ipynb).`,
            });
            break;
          }
          if (doc.isDirty) {
            view.webview.postMessage({
              type: "log",
              level: "info",
              message: "Aviso: el archivo tiene cambios sin guardar; se convertirá la versión en disco.",
            });
          }
          view.webview.postMessage({
            type: "activeFile",
            converterId: conv.id,
            inputPath,
            outputPath: defaultOutputPath(inputPath, conv),
          });
          break;
        }

        case "run":
          await this.runConversion(view, msg);
          break;
      }
    });
  }

  private async runConversion(view: vscode.WebviewView, msg: any): Promise<void> {
    const log = (level: "info" | "error" | "ok", message: string) =>
      view.webview.postMessage({ type: "log", level, message });

    const conv = getConverter(msg.converterId);
    if (!conv) {
      log("error", "Conversor no encontrado.");
      return;
    }
    const inputPath: string = (msg.inputPath || "").trim();
    if (!inputPath) {
      log("error", "Indica la ruta del archivo a convertir.");
      return;
    }
    if (!fs.existsSync(inputPath)) {
      log("error", `No existe el archivo: ${inputPath}`);
      return;
    }
    const ext = path.extname(inputPath).toLowerCase();
    if (!conv.inputExts.includes(ext)) {
      log("error", `El conversor espera ${conv.inputExts.join("/")}, pero recibió "${ext}".`);
      return;
    }

    const outputPath: string =
      (msg.outputPath || "").trim() || defaultOutputPath(inputPath, conv);

    try {
      const input = fs.readFileSync(inputPath, "utf8");
      const result = conv.run(input, outputPath, !!msg.includeOutputs);
      fs.writeFileSync(outputPath, result.content, "utf8");
      log("ok", `OK → ${outputPath}`);
      log("info", result.log);

      const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(outputPath));
      await vscode.window.showTextDocument(doc, { preview: false });
    } catch (err: any) {
      log("error", `Falló la conversión: ${err?.message ?? err}`);
    }
  }

  private getHtml(webview: vscode.Webview): string {
    const nonce = String(Math.abs(hashString(this.extensionUri.toString() + CONVERTERS.length)));
    const csp = `default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';`;
    return /* html */ `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
  body { font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); padding: 10px 8px; }
  label { display: block; margin: 10px 0 4px; font-weight: 600; }
  select, input[type=text] {
    width: 100%; box-sizing: border-box; padding: 5px 6px;
    background: var(--vscode-input-background); color: var(--vscode-input-foreground);
    border: 1px solid var(--vscode-input-border, transparent); border-radius: 3px;
  }
  .row { display: flex; gap: 6px; }
  .row input { flex: 1; }
  button {
    padding: 5px 10px; cursor: pointer; border: none; border-radius: 3px;
    background: var(--vscode-button-background); color: var(--vscode-button-foreground);
  }
  button:hover { background: var(--vscode-button-hoverBackground); }
  button.secondary { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
  #run { width: 100%; margin-top: 14px; padding: 7px; font-weight: 600; }
  .check { display: flex; align-items: center; gap: 6px; margin-top: 10px; font-weight: 400; }
  .check input { width: auto; }
  #log { margin-top: 14px; font-family: var(--vscode-editor-font-family, monospace); font-size: 12px;
         white-space: pre-wrap; word-break: break-all; }
  .l-ok { color: var(--vscode-testing-iconPassed, #3fb950); }
  .l-error { color: var(--vscode-errorForeground, #f85149); }
  .l-info { color: var(--vscode-descriptionForeground); }
</style>
</head>
<body>
  <label for="conv">Conversión</label>
  <select id="conv"></select>

  <label for="input">Archivo a convertir</label>
  <div class="row">
    <input type="text" id="input" placeholder="Ruta del archivo…">
    <button class="secondary" id="browse">Examinar…</button>
  </div>
  <button class="secondary" id="active" style="width:100%; margin-top:6px">Usar archivo activo del editor</button>

  <label for="output">Archivo de salida</label>
  <input type="text" id="output" placeholder="(automático)">

  <label class="check" id="outputsRow" style="display:none">
    <input type="checkbox" id="includeOutputs" checked>
    Incluir salidas y errores de las celdas
  </label>

  <button id="run">Convertir</button>

  <div id="log"></div>

<script nonce="${nonce}">
  const vscode = acquireVsCodeApi();
  const $ = (id) => document.getElementById(id);
  let converters = [];

  function current() { return converters.find(c => c.id === $('conv').value); }

  function refreshOutputsRow() {
    const c = current();
    $('outputsRow').style.display = c && c.hasOutputsOption ? 'flex' : 'none';
  }

  function requestDefaultOutput() {
    const input = $('input').value.trim();
    if (input) vscode.postMessage({ type: 'defaultOutput', converterId: $('conv').value, inputPath: input });
  }

  function log(level, message) {
    const el = document.createElement('div');
    el.className = 'l-' + level;
    el.textContent = message;
    $('log').prepend(el);
  }

  $('conv').addEventListener('change', () => { refreshOutputsRow(); requestDefaultOutput(); });
  $('input').addEventListener('change', requestDefaultOutput);
  $('browse').addEventListener('click', () =>
    vscode.postMessage({ type: 'browse', converterId: $('conv').value }));
  $('active').addEventListener('click', () => vscode.postMessage({ type: 'useActive' }));

  $('run').addEventListener('click', () => {
    $('log').textContent = '';
    vscode.postMessage({
      type: 'run',
      converterId: $('conv').value,
      inputPath: $('input').value,
      outputPath: $('output').value,
      includeOutputs: $('includeOutputs').checked,
    });
  });

  window.addEventListener('message', (e) => {
    const m = e.data;
    if (m.type === 'converters') {
      converters = m.list;
      $('conv').innerHTML = converters.map(c => '<option value="' + c.id + '">' + c.label + '</option>').join('');
      refreshOutputsRow();
    } else if (m.type === 'picked') {
      $('input').value = m.inputPath;
      $('output').value = m.outputPath;
    } else if (m.type === 'activeFile') {
      $('conv').value = m.converterId;
      refreshOutputsRow();
      $('input').value = m.inputPath;
      $('output').value = m.outputPath;
    } else if (m.type === 'outputSuggestion') {
      $('output').value = m.outputPath;
    } else if (m.type === 'log') {
      log(m.level, m.message);
    }
  });

  vscode.postMessage({ type: 'ready' });
</script>
</body>
</html>`;
  }
}

// Hash determinista (no usamos Math.random para el nonce).
function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h << 5) - h + s.charCodeAt(i);
    h |= 0;
  }
  return h;
}
