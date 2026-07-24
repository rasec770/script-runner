# Conversores Notebook

Convierte notebooks entre **Markdown**, **Scala (Databricks)** y **Jupyter (`.ipynb`)**
desde un formulario en la barra lateral de VS Code.

**Sin Python. Sin dependencias externas.** Toda la lógica está escrita en TypeScript
y se ejecuta dentro del propio editor.

## Características

- 🔄 **Tres conversiones**: Markdown → Jupyter, Scala Databricks → Jupyter, Jupyter → Markdown
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
│   └── ipynbToMd.ts
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
