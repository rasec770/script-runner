import * as vscode from "vscode";
import * as fs from "fs";
import * as crypto from "crypto";
import { generarQrFrames, QrEncodeConfig } from "./encoder";
import { QrPlayerPanel } from "./playerPanel";

/** Formulario lateral del transmisor QR: origen + parámetros + preparar. */
export class QrFormViewProvider implements vscode.WebviewViewProvider {
  static readonly viewType = "scriptRunner.qrForm";

  constructor(private readonly extensionUri: vscode.Uri) {}

  resolveWebviewView(view: vscode.WebviewView): void {
    view.webview.options = { enableScripts: true, localResourceRoots: [this.extensionUri] };
    view.webview.html = getFormHtml();

    view.webview.onDidReceiveMessage(async (msg) => {
      switch (msg.type) {
        case "pickFile": {
          const picked = await vscode.window.showOpenDialog({
            canSelectMany: false,
            openLabel: "Seleccionar archivo",
          });
          if (picked && picked[0]) {
            view.webview.postMessage({ type: "picked", ruta: picked[0].fsPath });
          }
          break;
        }

        case "pickFolder": {
          const picked = await vscode.window.showOpenDialog({
            canSelectMany: false,
            canSelectFiles: false,
            canSelectFolders: true,
            openLabel: "Seleccionar carpeta",
          });
          if (picked && picked[0]) {
            view.webview.postMessage({ type: "picked", ruta: picked[0].fsPath });
          }
          break;
        }

        case "prepare":
          await this.prepare(view, msg);
          break;
      }
    });
  }

  private async prepare(view: vscode.WebviewView, msg: any): Promise<void> {
    const log = (level: "info" | "error" | "ok", message: string) =>
      view.webview.postMessage({ type: "log", level, message });

    const ruta: string = (msg.ruta || "").trim();
    if (!ruta) {
      log("error", "Indica un archivo o carpeta de origen.");
      return;
    }
    if (!fs.existsSync(ruta)) {
      log("error", `No existe la ruta: ${ruta}`);
      return;
    }

    const cfg: QrEncodeConfig = { chunkSize: Math.max(1, msg.chunkSize | 0 || 2500) };
    const qrMs = Math.max(10, msg.qrMs | 0 || 150);
    const syncSeconds = Math.max(0, msg.syncSeconds | 0);

    view.webview.postMessage({ type: "busy", busy: true });
    log("info", "=== Preparando QRs ===");

    try {
      const frames = await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: "Generando QRs…",
          cancellable: false,
        },
        async (progress) => {
          let previo = 0;
          return generarQrFrames(ruta, cfg, (hechos, total) => {
            const pct = Math.floor((100 * hechos) / total);
            progress.report({
              increment: pct - previo,
              message: `${hechos}/${total}`,
            });
            previo = pct;
          });
        }
      );

      log("ok", `ZIP: ${frames.zipSize} bytes → ${frames.dataSvgs.length} QRs + 1 SYNC`);
      log("info", "Reproductor abierto en el editor.");
      QrPlayerPanel.show(frames, { qrMs, syncSeconds });
    } catch (err: any) {
      log("error", `Falló la generación: ${err?.message ?? err}`);
    } finally {
      view.webview.postMessage({ type: "busy", busy: false });
    }
  }
}

function getFormHtml(): string {
  const nonce = crypto.randomBytes(16).toString("hex");
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
  input[type=text], input[type=number] {
    width: 100%; box-sizing: border-box; padding: 5px 6px;
    background: var(--vscode-input-background); color: var(--vscode-input-foreground);
    border: 1px solid var(--vscode-input-border, transparent); border-radius: 3px;
  }
  .row { display: flex; gap: 6px; margin-top: 6px; }
  .row button { flex: 1; }
  .grid { display: grid; grid-template-columns: auto 1fr; gap: 6px 8px; align-items: center; margin-top: 4px; }
  .grid span { font-weight: 400; }
  button {
    padding: 5px 10px; cursor: pointer; border: none; border-radius: 3px;
    background: var(--vscode-button-background); color: var(--vscode-button-foreground);
  }
  button:hover { background: var(--vscode-button-hoverBackground); }
  button:disabled { opacity: 0.5; cursor: default; }
  button.secondary { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
  #prepare { width: 100%; margin-top: 14px; padding: 7px; font-weight: 600; }
  #log { margin-top: 14px; font-family: var(--vscode-editor-font-family, monospace); font-size: 12px;
         white-space: pre-wrap; word-break: break-all; }
  .l-ok { color: var(--vscode-testing-iconPassed, #3fb950); }
  .l-error { color: var(--vscode-errorForeground, #f85149); }
  .l-info { color: var(--vscode-descriptionForeground); }
  .hint { color: var(--vscode-descriptionForeground); font-weight: 400; font-size: 11px; margin-top: 2px; }
</style>
</head>
<body>
  <label for="ruta">Origen (archivo o carpeta)</label>
  <input type="text" id="ruta" placeholder="Ruta del archivo o carpeta…">
  <div class="row">
    <button class="secondary" id="pickFile">Archivo…</button>
    <button class="secondary" id="pickFolder">Carpeta…</button>
  </div>

  <label>Parámetros</label>
  <div class="grid">
    <span>ms por QR</span><input type="number" id="qrMs" min="10" value="150">
    <span>seg. SYNC</span><input type="number" id="syncS" min="0" value="3">
    <span>Chunk (bytes)</span><input type="number" id="chunk" min="1" max="2940" value="2500">
  </div>
  <div class="hint">El origen se comprime en ZIP y se parte en fragmentos; cada fragmento es un QR.</div>

  <button id="prepare">Preparar y abrir reproductor</button>

  <div id="log"></div>

<script nonce="${nonce}">
  const vscode = acquireVsCodeApi();
  const $ = (id) => document.getElementById(id);

  function log(level, message) {
    const el = document.createElement('div');
    el.className = 'l-' + level;
    el.textContent = message;
    $('log').prepend(el);
  }

  $('pickFile').addEventListener('click', () => vscode.postMessage({ type: 'pickFile' }));
  $('pickFolder').addEventListener('click', () => vscode.postMessage({ type: 'pickFolder' }));

  $('prepare').addEventListener('click', () => {
    $('log').textContent = '';
    vscode.postMessage({
      type: 'prepare',
      ruta: $('ruta').value,
      qrMs: parseInt($('qrMs').value, 10),
      syncSeconds: parseInt($('syncS').value, 10),
      chunkSize: parseInt($('chunk').value, 10),
    });
  });

  window.addEventListener('message', (e) => {
    const m = e.data;
    if (m.type === 'picked') {
      $('ruta').value = m.ruta;
    } else if (m.type === 'busy') {
      $('prepare').disabled = m.busy;
    } else if (m.type === 'log') {
      log(m.level, m.message);
    }
  });
</script>
</body>
</html>`;
}
