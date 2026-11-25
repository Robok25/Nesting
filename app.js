import { parseDXF } from './dxf.js';
import { nest, centroid } from './nester.js';

const $ = (id) => document.getElementById(id);
const NS = 'http://www.w3.org/2000/svg';

// Estado solo en memoria. No se usa localStorage ni IndexedDB.
let pieces = []; // { name, qty, geom, error }
let result = null;
let params = null;

function el(tag, props = {}, children = []) {
  const n = document.createElement(tag);
  Object.assign(n, props);
  for (const c of children) n.append(c);
  return n;
}

// ---------- Carga de DXF ----------
$('dxf').addEventListener('change', async (e) => {
  pieces = [];
  for (const f of e.target.files) {
    const name = f.name.replace(/\.dxf$/i, '');
    try {
      const geom = parseDXF(await f.text());
      pieces.push({ name, qty: 1, geom, error: null });
    } catch (err) {
      pieces.push({ name, qty: 0, geom: null, error: err.message });
    }
  }
  renderPieces();
});

function renderPieces() {
  const body = $('pieces');
  body.replaceChildren();
  $('piecesBox').hidden = pieces.length === 0;
  for (const p of pieces) {
    const qty = el('input', { type: 'number', min: 0, step: 1, value: p.qty, disabled: !!p.error });
    qty.addEventListener('input', () => {
      p.qty = Math.max(0, parseInt(qty.value, 10) || 0);
    });
    body.append(
      el('tr', {}, [
        el('td', { textContent: p.name }),
        el('td', { textContent: p.geom ? Math.round(p.geom.area).toLocaleString() : '—' }),
        el('td', {}, [qty]),
        el('td', { textContent: p.error ? 'Error: ' + p.error : 'OK', className: p.error ? 'err' : 'ok' }),
      ])
    );
  }
}

// ---------- Cálculo ----------
function readParams() {
  const num = (id) => parseFloat($(id).value);
  const W = num('W'), H = num('H'), margin = num('margin'), gap = num('gap');
  const angles = $('angles').value
    .split(',')
    .map((s) => parseFloat(s))
    .filter((a) => Number.isFinite(a));
  if (!(W > 0 && H > 0) || !(margin >= 0) || !(gap >= 0) || !angles.length) {
    alert('Revisa tamaño de lámina, margen, gap y ángulos.');
    return null;
  }
  return { W, H, margin, gap, angles, calibre: $('calibre').value.trim() };
}

$('calc').addEventListener('click', async () => {
  const p = readParams();
  if (!p) return;
  const list = pieces
    .filter((x) => x.geom && x.qty > 0)
    .map((x) => ({ name: x.name, outer: x.geom.outer, area: x.geom.area, qty: x.qty }));
  if (!list.length) {
    alert('Sube al menos un DXF con cantidad mayor a 0.');
    return;
  }
  $('calc').disabled = true;
  $('status').textContent = 'Calculando…';
  try {
    result = await nest({
      pieces: list,
      W: p.W,
      H: p.H,
      margin: p.margin,
      gap: p.gap,
      angles: p.angles,
      onProgress: (i, t) => ($('status').textContent = `Acomodando pieza ${i} de ${t}…`),
    });
    params = p;
    renderResult();
  } finally {
    $('calc').disabled = false;
    $('status').textContent = '';
  }
});

function stats() {
  const { sheets } = result;
  const used = sheets.reduce((s, sh) => s + sh.items.reduce((a, it) => a + it.area, 0), 0);
  const total = sheets.length * params.W * params.H;
  return { count: sheets.length, util: total ? (used / total) * 100 : 0 };
}

function renderResult() {
  const out = $('results');
  out.replaceChildren();
  const { count, util } = stats();
  $('summary').replaceChildren(
    el('p', { textContent: `Láminas necesarias: ${count}`, className: 'big' }),
    el('p', { textContent: `Aprovechamiento promedio: ${util.toFixed(1)}%` })
  );
  if (result.unplaced.length) {
    $('summary').append(el('p', { className: 'err', textContent: `No caben en la lámina: ${result.unplaced.join(', ')}` }));
  }
  result.sheets.forEach((sh, i) => {
    const shUtil = (sh.items.reduce((a, it) => a + it.area, 0) / (params.W * params.H)) * 100;
    out.append(el('h3', { textContent: `Lámina ${i + 1} — ${sh.items.length} piezas — ${shUtil.toFixed(1)}%` }));
    out.append(sheetSVG(sh));
  });
  $('finalize').disabled = false;
}

// ---------- Dibujo ----------
function sheetSVG(sh) {
  const { W, H } = params;
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('class', 'sheet');
  const add = (tag, attrs) => {
    const n = document.createElementNS(NS, tag);
    for (const k in attrs) n.setAttribute(k, attrs[k]);
    svg.append(n);
    return n;
  };
  add('rect', { x: 0, y: 0, width: W, height: H, class: 'bg' });
  for (const it of sh.items) {
    const d = it.poly
      .map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(2)} ${(H - y).toFixed(2)}`)
      .join(' ') + ' Z';
    add('path', { d, class: 'piece' });
    const [cx, cy] = centroid(it.poly);
    const t = add('text', {
      x: cx.toFixed(2),
      y: (H - cy).toFixed(2),
      'font-size': Math.max(W / 60, 4),
      class: 'label',
    });
    t.textContent = `${it.name} (${it.angle}°)`;
  }
  return svg;
}

// ---------- PDF ----------
function exportPDF() {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const { W, H } = params;
  const { count, util } = stats();
  const scale = Math.min(180 / W, 180 / H);
  const drawW = W * scale;

  doc.setFontSize(14);
  doc.text('Cálculo de nesting', 15, 15);
  doc.setFontSize(9);
  [
    `Fecha: ${new Date().toLocaleString()}`,
    `Calibre: ${params.calibre || '—'}`,
    `Lámina: ${W} x ${H} mm | Margen: ${params.margin} mm | Gap: ${params.gap} mm`,
    `Ángulos: ${params.angles.join(', ')}°`,
    `Láminas necesarias: ${count} | Aprovechamiento promedio: ${util.toFixed(1)}%`,
  ].forEach((t, i) => doc.text(t, 15, 22 + i * 5));

  result.sheets.forEach((sh, i) => {
    if (i > 0) doc.addPage();
    const y0 = i === 0 ? 52 : 25;
    doc.setFontSize(11);
    doc.text(`Lámina ${i + 1} de ${count}`, 15, i === 0 ? 45 : 15);

    const X = (x) => 15 + x * scale;
    const Y = (y) => y0 + (H - y) * scale;
    doc.setLineWidth(0.4);
    doc.rect(X(0), Y(H), drawW, H * scale);

    doc.setLineWidth(0.2);
    for (const it of sh.items) {
      const p = it.poly;
      for (let k = 0; k < p.length; k++) {
        const a = p[k], b = p[(k + 1) % p.length];
        doc.line(X(a[0]), Y(a[1]), X(b[0]), Y(b[1]));
      }
      const [cx, cy] = centroid(p);
      doc.setFontSize(6);
      doc.text(`${it.name} ${it.angle}°`, X(cx), Y(cy), { align: 'center' });
    }

    // Conteo de piezas por lámina
    const counts = {};
    for (const it of sh.items) counts[it.name] = (counts[it.name] || 0) + 1;
    doc.setFontSize(9);
    let ty = y0 + H * scale + 10;
    doc.text('Piezas en esta lámina:', 15, ty);
    for (const [name, n] of Object.entries(counts)) {
      ty += 5;
      doc.text(`${name}: ${n}`, 20, ty);
    }
  });

  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
  doc.save(`nesting_${stamp}.pdf`);
}

// ---------- Finalizar / descartar ----------
$('finalize').addEventListener('click', () => {
  if (!result) return;
  exportPDF();
  clearAll('Cálculo finalizado. El PDF se descargó y los datos se borraron de la memoria.');
});

$('discard').addEventListener('click', () => {
  if (confirm('¿Descartar el cálculo y los DXF cargados?')) {
    clearAll('Cálculo descartado.');
  }
});

function clearAll(message) {
  pieces = [];
  result = null;
  params = null;
  $('dxf').value = '';
  $('pieces').replaceChildren();
  $('piecesBox').hidden = true;
  $('results').replaceChildren();
  $('summary').replaceChildren();
  $('finalize').disabled = true;
  $('status').textContent = message;
}

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js');
}
