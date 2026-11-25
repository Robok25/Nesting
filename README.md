# Nesting de láminas (PWA)

Aplicación web para calcular cuántas láminas necesitas para cortar un conjunto de piezas DXF. Corre completamente en el navegador: no hay servidor ni instalación de Python.

## Qué hace

- Carga archivos DXF con el contorno de cada pieza (una pieza por archivo).
- Captura cantidad por pieza, calibre, tamaño de lámina, margen, gap entre piezas y ángulos permitidos.
- Acomoda las piezas con una heurística bottom-left y rotaciones configurables (por defecto 0°, 45° y 90°).
- Muestra el número de láminas, el aprovechamiento y un dibujo de cada lámina.
- Botón **Finalizar cálculo y generar PDF**: descarga un PDF con los resultados y borra de la memoria el cálculo y los DXF.

## Entrada DXF

- Unidades: milímetros.
- Se leen las entidades LINE, LWPOLYLINE, CIRCLE y ARC.
- Las entidades en la capa `BEND` se ignoran.
- Los agujeros interiores se restan del área del material, pero el acomodo usa solo el contorno exterior. Esto es conservador: otras piezas no se colocan dentro de los agujeros.

Limitaciones de la versión 1:
- Los arcos "bulge" dentro de polilíneas se aproximan con segmentos rectos.
- Las entidades POLYLINE/VERTEX (formato antiguo) no se leen; expórtalas como LWPOLYLINE.
- Si un archivo contiene dos piezas separadas, la app lo rechaza para que las separes.

## Privacidad

- Los DXF se leen en tu navegador y no se suben a ningún servidor.
- No se usa `localStorage` ni `IndexedDB`. Al finalizar o descartar, la app borra los datos de memoria y limpia el selector de archivos.
- El service worker solo guarda en caché los archivos de la app (HTML, JS, ícono), nunca tus piezas ni tus cálculos.
- El PDF se descarga a la carpeta de descargas de tu equipo; esa copia la administras tú.

## Uso local

Como la app usa módulos de JavaScript, ábrela con un servidor local (abrir el `index.html` directamente puede bloquear los módulos):

```bash
python3 -m http.server 8000
```

Luego visita `http://localhost:8000`.

## Publicar en GitHub Pages

1. El repositorio debe ser público (GitHub Pages gratuito lo requiere).
2. Sube estos archivos a la raíz del repositorio `Robok25/Nesting`.
3. En GitHub, entra a **Settings → Pages**.
4. En *Source* elige **Deploy from a branch**, rama `main` y carpeta `/ (root)`. Guarda.
5. Espera un par de minutos. La URL será `https://robok25.github.io/Nesting/`.
6. En el celular, ábrela en el navegador y usa **Agregar a pantalla de inicio**. En computadora, Chrome o Edge muestran un ícono de instalación en la barra de direcciones.

## Estructura

```
index.html            interfaz
manifest.webmanifest  configuración PWA
sw.js                 caché offline de la app
js/dxf.js             lectura de DXF y contornos
js/nester.js          colocación y colisiones con gap
js/app.js             interfaz, dibujo SVG y PDF
icons/icon.svg        ícono
```

## Licencia

MIT. Ver `LICENSE`.
