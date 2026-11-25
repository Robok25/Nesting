# Nesting de láminas (PWA)

Aplicación web para calcular cuántas láminas necesitas para cortar un conjunto de piezas DXF. Corre completamente en el navegador: no hay servidor ni instalación.

## Flujo

1. **Selecciona los DXF** a nestear (se listan por nombre).
2. **Asigna a cada pieza** cantidad, material y calibre.
3. **Define los tipos de lámina**: material, calibre, ancho, alto, margen, gap y rotaciones (0° y 90°, o 0°, 45° y 90°). Puedes agregar varios tipos. Cada pieza solo se acomoda en las láminas de su mismo material y calibre.
4. **Calcula.** El resultado muestra cuántas láminas se usan de cada tipo, su aprovechamiento y un dibujo de cada lámina.
5. **Finalizar cálculo y generar PDF** descarga el PDF y borra todo de la memoria. **Descartar y crear nuevo** borra todo sin PDF.

## Entrada DXF

- Unidades: milímetros.
- Se leen LINE, LWPOLYLINE, CIRCLE y ARC. Las entidades en la capa `BEND` se ignoran.
- Cada archivo debe contener una sola pieza.
- Los agujeros se restan del área del material, pero el acomodo usa solo el contorno exterior (conservador).

Limitaciones de la versión 1:
- Los arcos "bulge" dentro de polilíneas se aproximan con segmentos rectos.
- Las POLYLINE del formato antiguo no se leen; expórtalas como LWPOLYLINE.
- La heurística bottom-left no garantiza el mejor aprovechamiento posible.

## Privacidad

- Los DXF se leen en tu navegador y no se suben a ningún servidor.
- No se usa `localStorage` ni `IndexedDB`. Al finalizar o descartar, la app borra los datos de memoria y limpia el selector de archivos.
- El service worker solo guarda en caché los archivos de la app, nunca tus piezas ni tus cálculos.
- El PDF se descarga a la carpeta de descargas de tu equipo; esa copia la administras tú.

## Uso local

Los módulos de JavaScript requieren un servidor local (abrir `index.html` directamente puede bloquearlos):

```bash
python3 -m http.server 8000
```

Luego visita `http://localhost:8000`.

## Publicar en GitHub Pages

1. El repositorio debe ser público.
2. Sube los archivos a la raíz del repositorio `Robok25/Nesting`.
3. En GitHub, entra a **Settings → Pages**.
4. En *Source* elige **Deploy from a branch**, rama `main`, carpeta `/ (root)`, y guarda.
5. Espera un par de minutos. La URL será `https://robok25.github.io/Nesting/`.
6. En el celular ábrela en el navegador y elige **Agregar a pantalla de inicio**.

## Estructura

```
index.html            interfaz por etapas
manifest.webmanifest  configuración PWA
sw.js                 caché offline de la app
js/dxf.js             lectura de DXF y contornos
js/nester.js          colocación con colisiones y gap, por grupo material+calibre
js/app.js             interfaz, resumen, dibujo SVG y PDF
icons/icon.svg        ícono
```

## Licencia

MIT. Ver `LICENSE`.
