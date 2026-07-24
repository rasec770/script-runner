import * as vscode from "vscode";
import * as crypto from "crypto";
import { QrFrameSet } from "./encoder";

export interface QrPlayerConfig {
  qrMs: number;
  syncSeconds: number;
}

/** Panel del editor que reproduce la secuencia de QRs a pantalla completa. */
export class QrPlayerPanel {
  private static current: QrPlayerPanel | undefined;

  private readonly panel: vscode.WebviewPanel;

  static show(frames: QrFrameSet, cfg: QrPlayerConfig): void {
    // Un panel nuevo por cada preparación: evita mezclar estados de reproducción.
    QrPlayerPanel.current?.panel.dispose();
    QrPlayerPanel.current = new QrPlayerPanel(frames, cfg);
  }

  private constructor(frames: QrFrameSet, cfg: QrPlayerConfig) {
    this.panel = vscode.window.createWebviewPanel(
      "scriptRunner.qrPlayer",
      `QR: ${frames.sourceLabel}`,
      vscode.ViewColumn.One,
      { enableScripts: true, retainContextWhenHidden: true }
    );
    this.panel.webview.html = getPlayerHtml();

    this.panel.webview.onDidReceiveMessage((msg) => {
      if (msg.type === "ready") {
        this.panel.webview.postMessage({
          type: "frames",
          sync: frames.syncSvg,
          data: frames.dataSvgs,
          zipSize: frames.zipSize,
          sourceLabel: frames.sourceLabel,
          qrMs: cfg.qrMs,
          syncSeconds: cfg.syncSeconds,
        });
      }
    });

    this.panel.onDidDispose(() => {
      if (QrPlayerPanel.current === this) {
        QrPlayerPanel.current = undefined;
      }
    });
  }
}

function getPlayerHtml(): string {
  const nonce = crypto.randomBytes(16).toString("hex");
  const csp = `default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';`;
  return /* html */ `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<style>
  html, body { height: 100%; margin: 0; padding: 0; overflow: hidden; }
  body { display: flex; flex-direction: column; font-family: var(--vscode-font-family); font-size: 12px; }
  #bar {
    display: flex; flex-wrap: wrap; align-items: center; gap: 6px;
    padding: 6px 8px; background: var(--vscode-sideBar-background);
    border-bottom: 1px solid var(--vscode-panel-border, transparent);
  }
  #bar label { display: flex; align-items: center; gap: 4px; }
  #bar input[type=text], #bar input[type=number] {
    width: 70px; padding: 2px 4px;
    background: var(--vscode-input-background); color: var(--vscode-input-foreground);
    border: 1px solid var(--vscode-input-border, transparent); border-radius: 3px;
  }
  #excl { width: 140px !important; }
  button {
    padding: 3px 10px; cursor: pointer; border: none; border-radius: 3px;
    background: var(--vscode-button-background); color: var(--vscode-button-foreground);
  }
  button:hover { background: var(--vscode-button-hoverBackground); }
  button:disabled { opacity: 0.5; cursor: default; }
  button.secondary { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
  #status { font-weight: 600; margin-left: auto; }
  #stage {
    flex: 1; display: flex; align-items: center; justify-content: center;
    background: #ffffff; min-height: 0;
  }
  /* El QR debe verse sobre blanco puro, independientemente del tema. */
  #qr { width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; }
  #qr svg { width: auto; height: 100%; max-width: 100%; shape-rendering: crispEdges; }
</style>
</head>
<body>
  <div id="bar">
    <button id="play" disabled>Reproducir</button>
    <button id="stop" class="secondary" disabled>Detener</button>
    <label>ms/QR <input type="number" id="qrMs" min="10" value="150"></label>
    <label>seg SYNC <input type="number" id="syncS" min="0" value="3"></label>
    <label>Excluir <input type="text" id="excl" placeholder="ej: 0-5,12-69"></label>
    <button id="apply" class="secondary">Excluir</button>
    <button id="clear" class="secondary">Limpiar</button>
    <span id="exclInfo">Sin exclusiones</span>
    <span id="status">Esperando datos…</span>
  </div>
  <div id="stage"><div id="qr"></div></div>

<script nonce="${nonce}">
  const vscode = acquireVsCodeApi();
  const $ = (id) => document.getElementById(id);

  let syncSvg = null;
  let dataSvgs = [];
  let playing = false;
  let timer = null;
  const skip = new Set();

  function show(svg) { $('qr').innerHTML = svg; }
  function status(t) { $('status').textContent = t; }

  function parseRangos(texto) {
    const indices = new Set();
    for (const parte of texto.trim().split(/[,;\\s]+/)) {
      if (!parte) continue;
      const m = /^(\\d+)-(\\d+)$/.exec(parte);
      if (m) {
        const a = parseInt(m[1], 10), b = parseInt(m[2], 10);
        for (let i = Math.min(a, b); i <= Math.max(a, b); i++) indices.add(i);
      } else if (/^\\d+$/.test(parte)) {
        indices.add(parseInt(parte, 10));
      }
    }
    return indices;
  }

  function refreshExclInfo() {
    const total = dataSvgs.length;
    let validos = 0;
    for (const i of skip) if (i >= 0 && i < total) validos++;
    $('exclInfo').textContent = skip.size
      ? 'Excluidos: ' + validos + ' | Activos: ' + (total - validos) + '/' + total
      : 'Sin exclusiones';
  }

  $('apply').addEventListener('click', () => {
    for (const i of parseRangos($('excl').value)) skip.add(i);
    $('excl').value = '';
    refreshExclInfo();
  });
  $('clear').addEventListener('click', () => { skip.clear(); refreshExclInfo(); });

  function playData(idx) {
    if (!playing) return;
    const total = dataSvgs.length;
    while (idx < total && skip.has(idx)) idx++;
    if (idx >= total) {
      show(syncSvg);
      status('SYNC (reinicio)');
      timer = setTimeout(() => playData(0), Math.max(0, $('syncS').value * 1000));
      return;
    }
    show(dataSvgs[idx]);
    status('QR ' + idx + '/' + (total - 1));
    timer = setTimeout(() => playData(idx + 1), Math.max(10, $('qrMs').value | 0));
  }

  $('play').addEventListener('click', () => {
    if (!dataSvgs.length) return;
    playing = true;
    $('play').disabled = true;
    $('stop').disabled = false;
    show(syncSvg);
    status('SYNC');
    timer = setTimeout(() => playData(0), Math.max(0, $('syncS').value * 1000));
  });

  $('stop').addEventListener('click', stop);
  function stop() {
    playing = false;
    if (timer) { clearTimeout(timer); timer = null; }
    $('play').disabled = !dataSvgs.length;
    $('stop').disabled = true;
    status('Detenido — ' + dataSvgs.length + ' QRs listos');
  }

  window.addEventListener('message', (e) => {
    const m = e.data;
    if (m.type !== 'frames') return;
    stop();
    syncSvg = m.sync;
    dataSvgs = m.data;
    $('qrMs').value = m.qrMs;
    $('syncS').value = m.syncSeconds;
    skip.clear();
    refreshExclInfo();
    show(syncSvg);
    $('play').disabled = false;
    status(m.sourceLabel + ' — ZIP ' + m.zipSize + ' bytes → ' + dataSvgs.length + ' QRs. Pulsa Reproducir.');
  });

  vscode.postMessage({ type: 'ready' });
</script>
</body>
</html>`;
}
