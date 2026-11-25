# Nesting de láminas (PWA)

Aplicación web para calcular cuántas láminas necesitas para cortar un conjunto de piezas DXF. Corre completamente en el navegador: no hay servidor ni instalación.

## Flujo

1. **Selecciona la unidad de trabajo** (mm o pulgadas) antes de cargar archivos. La misma unidad se aplica a todos los DXF y a todas las medidas de lámina; no se mezclan unidades dentro de un cálculo.
2. **Selecciona los DXF** a nestear (se listan por nombre).
3. **Asigna a cada pieza** cantidad, material y calibre.
4. **Define los tipos de lámina**: material, calibre, ancho, alto, margen, gap y rotaciones (0° y 90°, o 0°, 45° y 90°). Puedes agregar varios tipos. Cada pieza solo se acomoda en las láminas de su mismo material y calibre.
5. **Calcula** desde el apartado de láminas. El resultado muestra cuántas láminas se usan de cada tipo, su aprovechamiento y un dibujo de cada lámina.
6. En resultados puedes **guardar el PDF** o **exportar el nesting a DXF** (contornos de lámina, piezas y recortes interiores) sin borrar el cálculo. **Crear nuevo cálculo** limpia los datos de la sesión.

## Entrada DXF

- Unidades: milímetros o pulgadas, seleccionadas globalmente antes de cargar archivos. Las medidas de lámina, margen y gap deben capturarse en esa misma unidad.
- El DXF exportado declara la unidad seleccionada en `$INSUNITS` y separa las láminas en el eje X.
- Se leen LINE, LWPOLYLINE, POLYLINE, CIRCLE y ARC. Las entidades en la capa `BEND` se ignoran.
- Cada archivo debe contener una sola pieza.
- Los barrenos y recortes interiores cerrados se detectan, se descuentan del área y se consideran como espacios libres al comprobar colisiones durante el acomodo. También se muestran en la vista previa y el PDF.

Limitaciones de la versión 1:
- Los arcos "bulge" dentro de polilíneas se aproximan con segmentos rectos.
- La heurística bottom-left no garantiza el mejor aprovechamiento posible.

## Privacidad

- Los DXF se leen en tu navegador y no se suben a ningún servidor.
- No se usa `localStorage` ni `IndexedDB`. Los datos permanecen en memoria mientras la app está abierta; al cerrar la app o elegir **Crear nuevo cálculo**, se eliminan.
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
js/app.js             interfaz, resumen, dibujo SVG, PDF y DXF
icons/icon.svg        ícono
```

## Licencia

MIT. Ver `LICENSE`.
