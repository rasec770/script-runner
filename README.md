# Conversores Notebook (Contactabilidad)

Extensión de VS Code que convierte entre **Markdown**, **Scala (Databricks)** y
**Jupyter (.ipynb)** desde un formulario en la barra lateral. Toda la lógica está
portada a TypeScript: **no requiere Python** ni ninguna dependencia externa.

## Qué hace (versión 0.1.0)

Panel **Conversores** en la barra lateral con un formulario:

1. Eliges la conversión.
2. Indicas el archivo a convertir (campo de texto o botón **Examinar…**).
3. La ruta de salida se sugiere sola (editable).
4. Botón **Convertir** → genera el archivo y lo abre en el editor.

### Conversiones disponibles

| Conversión                          | Origen     | Destino    |
| ----------------------------------- | ---------- | ---------- |
| Markdown → Jupyter                  | `.md`      | `.ipynb`   |
| Scala Databricks → Jupyter          | `.scala`   | `.ipynb`   |
| Jupyter → Markdown                  | `.ipynb`   | `.md`      |

En *Jupyter → Markdown* hay una casilla para **incluir las salidas y errores** de
las celdas. Para no pisar el `.md` fuente, la salida se sugiere con sufijo
`_reconstruido`.

## Equivalencia con los scripts Python

Los conversores son un port fiel de `convert_md_to_ipynb.py`,
`convert_scala_to_ipynb.py` y `convert_ipynb_to_md.py`. Se verificó que producen
salida **byte a byte idéntica** a los scripts originales sobre los notebooks reales
de `Documentos/Analisis`.

## Desarrollo

```bash
npm install
npm run compile   # o npm run watch
```

Pulsa **F5** para abrir una ventana de desarrollo con la extensión cargada.

## Estructura

```
src/
├── extension.ts            # webview del formulario + lectura/escritura de archivos
└── converters/
    ├── index.ts            # registro de conversores (alimenta el formulario)
    ├── types.ts            # ConvertResult + fábrica de notebook
    ├── helpers.ts          # regex y utilidades compartidas
    ├── mdToIpynb.ts
    ├── scalaToIpynb.ts
    └── ipynbToMd.ts
```

## Siguientes pasos (ideas)

- Convertir varios archivos a la vez (selección múltiple / carpeta).
- Recordar la última carpeta usada.
- Vista previa del resultado antes de escribir.
- Empaquetar como `.vsix` (`vsce package`) para instalarlo fijo.
