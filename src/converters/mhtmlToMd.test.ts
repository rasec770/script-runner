import * as assert from "node:assert/strict";
import { test } from "node:test";
import { mhtmlToMd } from "./mhtmlToMd";

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2n0kAAAAASUVORK5CYII=", "base64");

function fixture(): string {
  const html = `<!doctype html><html><body>
<nav>Irrelevante</nav><script>alert(1)</script>
<table>
<tr><td>Estado:</td><td>READY</td></tr>
<tr><td>Aplicación:</td><td>APP</td></tr>
<tr><td>Instrucciones para certificación:</td><td><h1>CERTIFICACIÓN</h1><p>Nota: no aplica en certificación.</p></td></tr>
<tr><td>Instrucciones para producción:</td><td><h1>PRODUCCIÓN</h1><ol start="2"><li>Paso real</li></ol><img src="https://example.test/image/1" alt="captura.png"></td></tr>
<tr><td>Instrucciones post deploy:</td><td><h1>POST DEPLOY - MONITOREO SINTÉTICO</h1><p>Colocar instrucciones a partir de aquí, no borrar el título</p></td></tr>
<tr><td>Instrucciones Automatizadas:</td><td><h1>AUTOMATIZADAS</h1></td></tr>
<tr><td>Inicio de pase a producción:</td><td>01/ene/26 8:00 PM</td></tr>
</table>
<table><tr><td>Descripción:</td><td id="descriptionArea"><p>Descripción útil.</p></td></tr></table>
<table><tr id="comment-body-1"><td>Comentario histórico que debe omitirse.</td></tr></table>
</body></html>`;
  const boundary = "----fixture-boundary";
  return [
    "From: <Saved by Blink>",
    "Subject: =?utf-8?Q?[#OCD-1]=20Conversi=C3=B3n?=",
    "MIME-Version: 1.0",
    `Content-Type: multipart/related; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    "Content-Type: text/html",
    "Content-Transfer-Encoding: 8bit",
    "Content-Location: https://jira.example.test/OCD-1",
    "",
    html,
    `--${boundary}`,
    "Content-Type: image/png",
    "Content-Transfer-Encoding: base64",
    "Content-Location: https://example.test/image/1",
    "",
    PNG.toString("base64"),
    `--${boundary}--`,
    "",
  ].join("\r\n");
}

test("convierte contenido útil, conserva notas reales y extrae imágenes", () => {
  const result = mhtmlToMd(fixture(), "salida.md");
  assert.match(result.content, /^# \[#OCD-1\] Conversión/m);
  assert.match(result.content, /Descripción útil/);
  assert.match(result.content, /Nota: no aplica en certificación/);
  assert.match(result.content, /2\. Paso real/);
  assert.match(result.content, /salida_assets\/captura\.png/);
  assert.doesNotMatch(result.content, /Comentario histórico|Irrelevante|alert\(1\)/);
  assert.doesNotMatch(result.content, /Instrucciones post deploy|Instrucciones Automatizadas|Colocar instrucciones/);
  assert.equal(result.assets?.length, 1);
  assert.equal(result.assets?.[0].relativePath, "salida_assets\\captura.png");
  assert.deepEqual(result.assets?.[0].content, PNG);
});

test("falla si una imagen útil no está incluida en MIME", () => {
  const broken = fixture().replace("Content-Location: https://example.test/image/1", "Content-Location: https://example.test/image/missing");
  assert.throws(() => mhtmlToMd(broken, "salida.md"), /imagen referenciada no existe/i);
});
