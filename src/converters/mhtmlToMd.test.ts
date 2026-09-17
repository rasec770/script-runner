import * as assert from "node:assert/strict";
import { test } from "node:test";
import * as path from "path";
import { mhtmlToMd } from "./mhtmlToMd";

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2n0kAAAAASUVORK5CYII=", "base64");

function fixture(): string {
  const html = `<!doctype html><html><body>
<nav>Irrelevante</nav><script>alert(1)</script>
<table>
<tr><td colspan="2"><h3 class="formtitle">[OCD-1]&nbsp;<a href="https://jira.test/browse/OCD-1">Conversión</a>
<span class="subText">Creada: 17/sep/26 &nbsp;Actualizada: 18/sep/26</span></h3></td></tr>
<tr><td><b>Estado:</b></td><td>READY</td></tr>
<tr><td><b>Informador:</b></td><td><a href="https://jira.test/u/1">Ana Pérez</a></td><td><b>Votos:</b></td><td>0</td></tr>
<tr><td><b>Etiquetas:</b></td><td></td></tr>
<tr><td><b>Adjuntos:</b></td><td><img src="https://jira.test/icons/excel.gif" alt="Microsoft Word"> CHECKLIST.xlsx &nbsp;</td></tr>
<tr><td><b>Enlaces de incidencias:</b></td><td><table>
<tr><td colspan="4"><b>Test</b><br></td></tr>
<tr><td>is tested by</td><td><a href="https://jira.test/browse/SHCL-2">SHCL-2</a></td><td>Resumen: enlazado</td><td>En ejecución</td></tr>
</table></td></tr>
<tr><td><b>Subtareas:</b></td><td><table>
<tr><td><b>Clave</b><br></td><td><b>Resumen</b><br></td><td><b>Estado</b><br></td></tr>
<tr><td><a href="https://jira.test/browse/OCD-2">OCD-2</a></td><td>Revisión</td><td>Complete</td></tr>
</table></td></tr>
<tr><td><b>Aplicación / Grupo AgileOps:</b></td><td>    SHCL
- Agrupacion Samay02
</td></tr>
<tr><td><b>CL-QA:</b></td><td>Sara Rojas</td></tr>
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
  assert.equal(result.assets?.[0].relativePath, path.join("salida_assets", "captura.png"));
  assert.deepEqual(result.assets?.[0].content, PNG);
});

test("incluye todos los campos de la incidencia, no solo una lista fija", () => {
  const md = mhtmlToMd(fixture(), "salida.md").content;
  const contexto = md.slice(md.indexOf("## Contexto"), md.indexOf("## Descripción"));
  assert.match(contexto, /- \*\*Clave:\*\* \[OCD-1\]\(https:\/\/jira\.test\/browse\/OCD-1\)/);
  assert.match(contexto, /- \*\*Creada:\*\* 17\/sep\/26\n- \*\*Actualizada:\*\* 18\/sep\/26/);
  assert.match(contexto, /- \*\*Informador:\*\* \[Ana Pérez\]\(https:\/\/jira\.test\/u\/1\)/);
  assert.match(contexto, /- \*\*Votos:\*\* 0/);
  assert.match(contexto, /- \*\*CL-QA:\*\* Sara Rojas/);
  // Un salto de línea del código fuente HTML no parte el valor.
  assert.match(contexto, /- \*\*Aplicación \/ Grupo AgileOps:\*\* SHCL - Agrupacion Samay02/);
  // El icono del adjunto no está en el MIME: se ignora sin abortar ni generar recursos.
  assert.match(contexto, /- \*\*Adjuntos:\*\* CHECKLIST\.xlsx/);
  // Campo sin valor: se omite. Descripción: va en su sección, no en el contexto.
  assert.doesNotMatch(contexto, /Etiquetas|Descripción útil/);
  // Las filas de la tabla anidada no se confunden con campos ("Resumen: enlazado").
  assert.doesNotMatch(contexto, /\*\*is tested by:\*\*|\*\*Resumen:\*\*/);
  assert.ok(contexto.includes("### Enlaces de incidencias\n\n| Grupo | Relación | Incidencia | Resumen | Estado |"));
  assert.ok(contexto.includes("| Test | is tested by | [SHCL-2](https://jira.test/browse/SHCL-2) | Resumen: enlazado | En ejecución |"));
  assert.ok(contexto.includes("### Subtareas\n\n| Clave | Resumen | Estado |\n| --- | --- | --- |\n| [OCD-2](https://jira.test/browse/OCD-2) | Revisión | Complete |"));
  // Instrucciones y ventana siguen en sus secciones propias.
  assert.doesNotMatch(contexto, /Instrucciones para|Inicio de pase/);
  assert.match(md, /## Ventana de ejecución\n\n- \*\*Inicio de pase a producción:\*\* 01\/ene\/26 8:00 PM/);
});

test("falla si una imagen útil no está incluida en MIME", () => {
  const broken = fixture().replace("Content-Location: https://example.test/image/1", "Content-Location: https://example.test/image/missing");
  assert.throws(() => mhtmlToMd(broken, "salida.md"), /imagen referenciada no existe/i);
});
