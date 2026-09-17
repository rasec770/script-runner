# Conversores Notebook

Convierte notebooks entre **Markdown**, **Scala (Databricks)** y **Jupyter (`.ipynb`)**,
archivos **CSV** en tablas Markdown, exportaciones **MHTML de Jira** a Markdown y
tablas **Markdown ↔ Excel (`.xlsx`)** en ambos sentidos, y genera el **checklist de
revisión en Excel** de una incidencia de Jira, desde un formulario en la barra lateral
de VS Code.

**Sin Python. Sin dependencias externas.** Toda la lógica está escrita en TypeScript
y se ejecuta dentro del propio editor.

## Características

- 🔄 **Ocho conversiones**: Markdown → Jupyter, Scala Databricks → Jupyter, Jupyter → Markdown, CSV → tabla Markdown, Jira MHTML → Markdown, Jira MHTML → Checklist Excel, Markdown → Excel y Excel → Markdown
- 📂 Elige el archivo con **Examinar…** o usa directamente el **archivo activo del editor**
- 📝 La ruta de salida se **sugiere automáticamente** (y puedes editarla)
- 📊 En *Jupyter → Markdown*, opción de **incluir las salidas y errores** de las celdas
- 📡 **Transmisor QR**: convierte un archivo o carpeta en una secuencia animada de códigos QR para transferirlo filmando la pantalla
- ⚡ Arranque instantáneo: cero dependencias que instalar

## Conversiones disponibles

| Conversión                 | Origen   | Destino  |
| -------------------------- | -------- | -------- |
| Markdown → Jupyter         | `.md`    | `.ipynb` |
| Scala Databricks → Jupyter | `.scala` | `.ipynb` |
| Jupyter → Markdown         | `.ipynb` | `.md`    |
| CSV → tabla Markdown      | `.csv`, `.tsv` | `.md` |
| Jira MHTML → Markdown     | `.mhtml`, `.mht` | `.md` |
| Jira MHTML → Checklist Excel | `.mhtml`, `.mht` | `.xlsx` |
| Markdown (tablas) → Excel | `.md`    | `.xlsx` |
| Excel → Markdown (tablas) | `.xlsx`  | `.md`  |

## Uso

1. Abre el panel **Conversores** en la barra de actividad (icono de flechas).
2. Elige la conversión que quieras.
3. Indica el archivo de entrada: escribe la ruta, pulsa **Examinar…**, o usa
   **Usar archivo activo del editor** para tomar el que ya tienes abierto.
4. La ruta de salida se rellena sola; ajústala si lo necesitas.
5. Pulsa **Convertir**. El archivo se genera y se abre en el editor.

### Jupyter → Markdown

Hay una casilla para **incluir las salidas y errores** de las celdas en el Markdown
resultante. Para no sobrescribir un `.md` de origen, la salida se sugiere con el
sufijo `_reconstruido`.

### CSV → tabla Markdown

Genera una tabla GFM lista para pegar en cualquier documento. El delimitador se
detecta solo (coma, punto y coma, tabulación o barra vertical), respeta las comillas
de RFC 4180 —incluidos los saltos de línea dentro de un campo, que se convierten en
`<br>`— y escapa las barras verticales del dato para que no partan la columna.

### Jira MHTML → Markdown

Convierte una incidencia exportada desde Jira como MHTML y genera un Markdown con
el contexto, la descripción, las instrucciones de despliegue y la ventana de
ejecución. Las secciones ausentes o que sólo conservan texto de plantilla se omiten;
una nota real como «no aplica» sí se conserva.

El **contexto** recoge *todos* los campos de la incidencia en el orden en que aparecen
(estado, informador, responsables, campos personalizados…), además de la clave y las
fechas de creación y actualización del título. Los campos sin valor se omiten. Los
**enlaces de incidencias** y las **subtareas** se vuelcan como tablas; en los enlaces,
el grupo («Test», «OCD»…) pasa a ser una columna.

Las imágenes usadas por las instrucciones se decodifican desde MIME y se guardan en
una carpeta `<nombre>_assets` junto al Markdown. El conversor reescribe los enlaces
para que se muestren localmente y excluye navegación, scripts, estilos, avatares y
comentarios históricos de Jira.

### Jira MHTML → Checklist Excel

Genera el checklist de revisión de un pase a partir de la incidencia exportada de Jira.
La salida se sugiere como `CHECKLIST-<clave>.xlsx`.

**La plantilla es tuya y no viaja con la extensión.** La primera vez se te pide el
`.xlsx` que usas como plantilla (puede ser un checklist anterior ya relleno) y su ruta
queda guardada en el ajuste `conversoresNotebook.checklistTemplate`. El conversor solo
cambia el valor de algunas celdas: estilos, combinaciones, listas desplegables, tablas,
comentarios y el resto de hojas se conservan tal cual.

Las celdas se localizan por su etiqueta, no por posición fija:

- **Datos generales** — el valor se escribe a la derecha de cada etiqueta: `MVP` (clave
  de la incidencia), `OWNER` (Informador, o Persona asignada), `QA` (campo QE, o CL-QA),
  `DESCRIPCIÓN` (resumen) y `REVIEWER` (ajuste `conversoresNotebook.checklistReviewer`,
  o el campo CL-DEV si está vacío).
- **Historial de versiones** (hoja con una columna `FECHA`): la primera fila de datos
  recibe la fecha de hoy y el revisor.

**El checklist sale respondido como la plantilla.** Casi todos los pases comparten
estructura, así que los `CUMPLE` / `NO APLICA`, las observaciones y la tabla de ambientes
(`DESA`, `CERT`, `PROD`) se conservan, y quien revisa solo corrige lo que cambie en ese
pase. Usa como plantilla un checklist ya respondido de un pase típico. La opción de
`MALLA` (que se señala con color de relleno) tampoco se toca.

Si prefieres partir de cero, desactiva el ajuste
`conversoresNotebook.checklistKeepAnswers`: se vacían las respuestas y, cuando el título
de una sección nombra una tecnología (Cosmos, Kafka, PowerShell, servicios compartidos,
Data Factory, Databricks) que no aparece en el resumen, la descripción ni las
instrucciones del pase, sus validaciones se marcan `NO APLICA` con la observación
«Automático: el pase no menciona …». En ese modo el conversor nunca marca `CUMPLE`.

### Markdown (tablas) → Excel

Cada tabla GFM del documento se convierte en una **hoja** del libro, nombrada con el
encabezado (`#`, `##`, `###`…) más cercano que la precede; si dos tablas comparten
encabezado, la segunda recibe el sufijo `(2)`. La primera fila queda en negrita, con
fondo, panel congelado y autofiltro; el ancho de columna se ajusta al contenido.

Dentro de las celdas se quitan las marcas inline (`` `código` ``, `**negrita**`,
`*cursiva*`), `<br>` pasa a salto de línea real, `\|` a `|`, y los valores que son
un número limpio (`1300`, `-3.5`) se guardan como numéricos. Una celda que contiene
solo un enlace `[texto](destino)` se convierte en **hipervínculo**. El texto fuera
de las tablas (párrafos, listas) no se conserva.

### Excel → Markdown (tablas)

Cada hoja con datos se convierte en una tabla GFM; la primera fila no vacía es el
encabezado. Con más de una hoja, cada tabla va precedida de `## <nombre de hoja>`.
Se leen cadenas compartidas y en línea, números, booleanos, fechas (se escriben como
`AAAA-MM-DD`) e hipervínculos, que vuelven a ser `[texto](destino)`. Las fórmulas se
sustituyen por su último valor calculado; estilos, combinaciones y gráficos se ignoran.

## Transmisor QR

En el mismo panel **Conversores** hay una segunda vista, **Transmisor QR**, que
convierte cualquier archivo o carpeta en una secuencia de códigos QR:

1. Elige el **origen** (archivo o carpeta). Se comprime en ZIP en memoria.
2. El ZIP se parte en fragmentos (por defecto 2500 bytes) y cada fragmento se
   codifica como un QR con cabecera `P:ii/nn|`, precedido por un QR de
   sincronización `SYNC|n`.
3. Pulsa **Preparar y abrir reproductor**: se abre un panel en el editor que
   reproduce la secuencia en bucle (SYNC → datos → SYNC…).

En el reproductor puedes ajustar los **ms por QR**, los **segundos de SYNC** y
**excluir frames** ya capturados con rangos tipo `0-5,12-69` (útil para repetir
solo los que faltaron al escanear).

## Requisitos

VS Code **1.85.0** o superior. Nada más.

## Desarrollo

```bash
npm install
npm run compile   # o npm run watch
```

Pulsa **F5** para abrir una ventana de desarrollo con la extensión cargada.

### Estructura

```
src/
├── extension.ts            # webview del formulario + lectura/escritura de archivos
├── converters/
│   ├── index.ts            # registro de conversores (alimenta el formulario)
│   ├── types.ts            # ConvertResult + fábrica de notebook
│   ├── helpers.ts          # regex y utilidades compartidas
│   ├── mdToIpynb.ts
│   ├── scalaToIpynb.ts
│   ├── ipynbToMd.ts
│   ├── csvToMd.ts
│   ├── mhtmlToMd.ts
│   ├── mhtmlToChecklist.ts # Jira → checklist sobre una plantilla del usuario
│   ├── xlsxPatch.ts        # edición de celdas de un .xlsx existente
│   ├── xlsxFile.ts         # lectura/escritura .xlsx (ZIP con fflate + XML)
│   ├── mdToXlsx.ts
│   └── xlsxToMd.ts
└── qr/
    ├── encoder.ts          # ZIP (fflate) → fragmentos → QRs SVG (qrcode)
    ├── formView.ts         # vista lateral "Transmisor QR"
    └── playerPanel.ts      # panel reproductor de la secuencia
```

## Ideas para próximas versiones

- Convertir varios archivos a la vez (selección múltiple o carpeta)
- Recordar la última carpeta usada
- Vista previa del resultado antes de escribir

## Problemas y sugerencias

¿Algo no funciona o echas de menos una conversión?
Abre un issue en [GitHub](https://github.com/rasec770/script-runner/issues).

## Licencia

[MIT](LICENSE) © Cesar Pablo Anco Jove
