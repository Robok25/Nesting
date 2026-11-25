import { parseDXF } from './dxf.js';
import { nestGroup, centroid } from './nester.js';

const $ = (id) => document.getElementById(id);
const NS = 'http://www.w3.org/2000/svg';
const ANGLE_OPTIONS = [
  { value: '0,90', label: '0° y 90°' },
  { value: '0,45,90', label: '0°, 45° y 90°' },
];
const MATERIAL_OPTIONS = [
  'Acero al carbón',
  'Acero galvanizado',
  'Acero inoxidable 304',
  'Acero inoxidable 316',
  'Aluminio',
];
const CALIBRE_OPTIONS = [
  'Calibre 10', 'Calibre 11', 'Calibre 12', 'Calibre 14', 'Calibre 16',
  'Calibre 18', 'Calibre 20', 'Calibre 22', 'Calibre 24', 'Calibre 26', 'Calibre 28', 'Calibre 30',
  'Placa 1/8 in', 'Placa 3/16 in', 'Placa 1/4 in', 'Placa 3/8 in', 'Placa 1/2 in',
];

// Estado solo en memoria. No se usa localStorage ni IndexedDB.
let files = [];   // { name, qty, material, calibre, geom, error }
let defs = [];    // { id, material, calibre, W, H, margin, gap, angles }
let result = null;
let nextId = 1;
let labelScale = 1;   // 0.5 a 1.5, relativo al tamaño de cada pieza
let showLabels = true;
let unitMode = 'mm'; // La unidad es única para todos los DXF y láminas de esta sesión.

const unitLabel = () => unitMode === 'in' ? 'in' : 'mm';
const areaUnitLabel = () => unitMode === 'in' ? 'in²' : 'mm²';
const unitToMm = () => unitMode === 'in' ? 25.4 : 1;
// Muestra u oculta la capa de carga con el texto de progreso
const statusBox = {
  set textContent(t) {
    $('loading').hidden = !t;
    $('loadingText').textContent = t || '';
  },
};

const keyOf = (m, c) => `${m.trim().toUpperCase()}|${c.trim().toUpperCase()}`;
const defLabel = (d) => `${d.material.trim()} · ${d.calibre.trim()} · ${d.W} × ${d.H} ${unitLabel()}`;

function updateUnitsUI() {
  const u = unitLabel();
  $('areaHeader').textContent = `Área ${areaUnitLabel()}`;
  $('units').disabled = files.length > 0 || defs.length > 0;
  document.querySelectorAll('[data-unit-label]').forEach((n) => { n.textContent = u; });
}
const parseAngles = (s) => s.split(',').map(Number);

function el(tag, props = {}, children = []) {
  const n = document.createElement(tag);
  Object.assign(n, props);
  for (const c of children) n.append(c);
  return n;
}

function input(type, value, onInput, extra = {}) {
  const n = el('input', { type, value, ...extra });
  n.addEventListener('input', () => onInput(type === 'number' ? parseFloat(n.value) : n.value));
  return n;
}

function dropdown(value, options, onChange, placeholder = 'Seleccionar...', disabled = false) {
  const n = el('select', { disabled });
  n.append(el('option', { value: '', textContent: placeholder }));
  options.forEach((option) => n.append(el('option', { value: option, textContent: option })));
  if (value && !options.includes(value)) {
    n.append(el('option', { value, textContent: `Personalizado: ${value}` }));
  }
  n.append(el('option', { value: '__OTHER__', textContent: 'Otro (escribir...)' }));
  n.value = value || '';
  n.addEventListener('change', () => {
    if (n.value === '__OTHER__') {
      const custom = prompt('Escribe el valor personalizado:');
      if (custom && custom.trim()) {
        const v = custom.trim();
        if (![...n.options].some((o) => o.value === v)) n.insertBefore(el('option', { value: v, textContent: `Personalizado: ${v}` }), n.lastElementChild);
        n.value = v;
        onChange(v);
      } else n.value = value || '';
      return;
    }
    onChange(n.value);
  });
  return n;
}

// ---------- Aplicar material o calibre a todas las piezas ----------
function fillSelect(id, options) {
  const sel = $(id);
  sel.append(el('option', { value: '', textContent: 'Seleccionar...' }));
  options.forEach((o) => sel.append(el('option', { value: o, textContent: o })));
}
fillSelect('bulkMaterial', MATERIAL_OPTIONS);
fillSelect('bulkCalibre', CALIBRE_OPTIONS);

function applyBulk(field, value, label) {
  if (!value) { alert(`Elige primero un ${label}.`); return; }
  const targets = files.filter((f) => !f.error);
  if (!targets.length) { alert('No hay DXF cargados.'); return; }
  if (!confirm(`¿Asignar ${label} "${value}" a las ${targets.length} pieza(s)? Se reemplazan los valores actuales.`)) return;
  targets.forEach((f) => (f[field] = value));
  renderPieces();
  $('fileMsg').textContent = `${label} "${value}" aplicado a ${targets.length} pieza(s).`;
}
$('bulkMaterialBtn').addEventListener('click', () => applyBulk('material', $('bulkMaterial').value, 'material'));
$('bulkCalibreBtn').addEventListener('click', () => applyBulk('calibre', $('bulkCalibre').value, 'calibre'));

// ---------- 1 y 2. Archivos y piezas ----------
$('dxf').addEventListener('change', async (e) => {
  const selected = Array.from(e.target.files || []);
  e.target.value = '';
  let added = 0, replaced = 0, skipped = 0, cancelled = 0;
  for (const file of selected) {
    if (!/\.dxf$/i.test(file.name)) { skipped++; continue; }
    const name = file.name.replace(/\.dxf$/i, '');
    const index = files.findIndex((item) => item.name.toLocaleLowerCase() === name.toLocaleLowerCase());
    let previous = null;
    if (index >= 0) {
      const answer = confirm('Ya existe "' + name + '".\n\n¿Deseas reemplazar el DXF existente?\nAceptar = reemplazar · Cancelar = omitir este archivo');
      if (!answer) { cancelled++; continue; }
      previous = files[index];
    }
    statusBox.textContent = `Leyendo ${name}…`;
    await new Promise((r) => setTimeout(r, 0));
    let entry;
    try {
      entry = { name, qty: previous ? previous.qty : 1, material: previous ? previous.material : '', calibre: previous ? previous.calibre : '', geom: parseDXF(await file.text()), error: null };
    } catch (err) {
      entry = { name, qty: previous ? previous.qty : 0, material: previous ? previous.material : '', calibre: previous ? previous.calibre : '', geom: null, error: err.message };
    }
    if (index >= 0) { files[index] = entry; replaced++; } else { files.push(entry); added++; }
  }
  files.sort((x, y) => x.name.localeCompare(y.name, 'es', { numeric: true }));
  updateUnitsUI();
  const messages = [];
  if (added) messages.push(`${added} agregado(s)`);
  if (replaced) messages.push(`${replaced} reemplazado(s)`);
  if (cancelled) messages.push(`${cancelled} duplicado(s) omitido(s)`);
  if (skipped) messages.push(`${skipped} archivo(s) no DXF ignorado(s)`);
  $('fileMsg').textContent = messages.join(' · ') || 'No se agregaron archivos.';
  renderPieces();
});

function renderPieces() {
  const body = $('pieces');
  body.replaceChildren();
  $('piecesBox').hidden = files.length === 0;
  for (const f of files) {
    const disabled = !!f.error;
    body.append(
      el('tr', {}, [
        el('td', { textContent: f.name }),
        el('td', { textContent: f.geom ? f.geom.area.toLocaleString('es-MX', { maximumFractionDigits: unitMode === 'in' ? 2 : 0 }) : '—' }),
        el('td', {}, [input('number', f.qty, (v) => (f.qty = Math.max(0, parseInt(v, 10) || 0)), { min: 0, step: 1, disabled })]),
        el('td', {}, [dropdown(f.material, MATERIAL_OPTIONS, (v) => (f.material = v), 'Material...', disabled)]),
        el('td', {}, [dropdown(f.calibre, CALIBRE_OPTIONS, (v) => (f.calibre = v), 'Calibre...', disabled)]),
        el('td', { textContent: f.error ? 'Error: ' + f.error : 'OK', className: f.error ? 'err' : 'ok' }),
        el('td', {}, [el('button', { type: 'button', className: 'danger small', textContent: 'Quitar', onclick: () => {
          if (confirm(`¿Quitar el archivo "${f.name}" de la lista?`)) { files = files.filter((item) => item !== f); renderPieces(); updateUnitsUI(); }
        } })]),
      ])
    );
  }
}

// ---------- 3. Láminas disponibles ----------
$('units').addEventListener('change', () => {
  if (files.length || defs.length) {
    alert('Para cambiar de unidad debes iniciar un cálculo nuevo. Todos los archivos y láminas deben usar la misma unidad.');
    $('units').value = unitMode;
    return;
  }
  unitMode = $('units').value === 'in' ? 'in' : 'mm';
  updateUnitsUI();
  renderDefs();
});

$('addDef').addEventListener('click', () => {
  const inch = unitMode === 'in';
  defs.push({ id: nextId++, material: '', calibre: '', W: inch ? 48 : 1220, H: inch ? 96 : 2440, margin: inch ? 0.4 : 10, gap: inch ? 0.12 : 3, angles: '0,90' });
  updateUnitsUI();
  renderDefs();
});

function renderDefs() {
  const box = $('defs');
  box.replaceChildren();
  defs.forEach((d, i) => {
    const angles = el('select', {}, ANGLE_OPTIONS.map((o) => el('option', { value: o.value, textContent: o.label })));
    angles.value = d.angles;
    angles.addEventListener('change', () => (d.angles = angles.value));
    box.append(
      el('div', { className: 'defcard' }, [
        el('div', { className: 'defhead', textContent: `Lámina tipo ${i + 1}` }),
        el('div', { className: 'grid' }, [
          el('label', {}, [el('span', { textContent: 'Material' }), dropdown(d.material, MATERIAL_OPTIONS, (v) => (d.material = v), 'Material...')]),
          el('label', {}, [el('span', { textContent: 'Calibre' }), dropdown(d.calibre, CALIBRE_OPTIONS, (v) => (d.calibre = v), 'Calibre...')]),
          el('label', {}, [el('span', { textContent: `Ancho (${unitLabel()})` }), input('number', d.W, (v) => (d.W = v), { min: 1, step: 'any' })]),
          el('label', {}, [el('span', { textContent: `Alto (${unitLabel()})` }), input('number', d.H, (v) => (d.H = v), { min: 1, step: 'any' })]),
          el('label', {}, [el('span', { textContent: `Margen (${unitLabel()})` }), input('number', d.margin, (v) => (d.margin = v), { min: 0, step: 'any' })]),
          el('label', {}, [el('span', { textContent: `Gap (${unitLabel()})` }), input('number', d.gap, (v) => (d.gap = v), { min: 0, step: 'any' })]),
          el('label', {}, [el('span', { textContent: 'Rotaciones' }), angles]),
        ]),
        el('button', {
          className: 'danger small',
          textContent: 'Quitar',
          onclick: () => { defs.splice(i, 1); renderDefs(); },
        }),
      ])
    );
  });
  updateUnitsUI();
}

// ---------- 4. Cálculo ----------
function validate() {
  const used = files.filter((f) => f.geom && f.qty > 0);
  if (!used.length) return 'Sube al menos un DXF y asigna cantidad mayor a 0.';
  const noMat = used.filter((f) => !f.material.trim() || !f.calibre.trim()).map((f) => f.name);
  if (noMat.length) return `Falta material o calibre en: ${noMat.join(', ')}`;
  const keys = new Set(used.map((f) => keyOf(f.material, f.calibre)));
  for (const k of keys) {
    if (!defs.some((d) => keyOf(d.material, d.calibre) === k)) {
      const [m, c] = k.split('|');
      return `No hay lámina definida para ${m} · ${c}. Agrégala en el paso 3.`;
    }
  }
  for (const d of defs) {
    if (!(d.W > 0 && d.H > 0) || !(d.margin >= 0) || !(d.gap >= 0)) {
      return `Revisa las medidas de la lámina ${d.material || ''} ${d.calibre || ''}.`;
    }
  }
  return null;
}

$('calc').addEventListener('click', async () => {
  const err = validate();
  if (err) { alert(err); return; }

  const groups = new Map();
  for (const f of files) {
    if (!f.geom || f.qty <= 0) continue;
    const k = keyOf(f.material, f.calibre);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push({ name: f.name, outer: f.geom.outer, holes: f.geom.holes || [], area: f.geom.area, qty: f.qty });
  }

  $('calc').disabled = true;
  result = { sections: [], unplaced: [] };
  try {
    for (const [k, pcs] of groups) {
      const gdefs = defs
        .filter((d) => keyOf(d.material, d.calibre) === k)
        .map((d) => ({ ...d, angles: parseAngles(d.angles) }));
      statusBox.textContent = `Acomodando ${k.split('|').join(' · ')}…`;
      const r = await nestGroup({
        pieces: pcs,
        defs: gdefs,
        onProgress: (i, t) => (statusBox.textContent = `${k.split('|').join(' · ')}: pieza ${i} de ${t}`),
      });
      result.sections.push(...r.sheets.map((s) => s));
      result.unplaced.push(...r.unplaced.map((n) => `${n} (${k.split('|').join(' · ')})`));
    }
    renderResult();
  } finally {
    $('calc').disabled = false;
    statusBox.textContent = '';
  }
});

// Resumen por definición de lámina: cuántas láminas de cada tipo se usan.
function summaryRows() {
  return defs.map((d) => {
    const sheets = result.sections.filter((s) => s.def.id === d.id);
    const used = sheets.reduce((a, s) => a + s.items.reduce((b, it) => b + it.area, 0), 0);
    const total = sheets.length * d.W * d.H;
    const util = total ? (used / total) * 100 : 0;
    return { def: d, sheets, util, waste: Math.max(0, 100 - util) };
  });
}

function renderResult() {
  $('pdfStatus').textContent = '';
  const out = $('results');
  out.replaceChildren();
  const ctl = el('div', { className: 'label-controls' });
  const chk = el('input', { type: 'checkbox', checked: showLabels });
  chk.addEventListener('change', () => { showLabels = chk.checked; renderResult(); });
  ctl.append(
    el('label', { className: 'inline' }, [chk, el('span', { textContent: 'Mostrar números' })])
  );
  out.append(ctl);
  const rows = summaryRows();
  const totalSheets = rows.reduce((a, r) => a + r.sheets.length, 0);

  $('summary').replaceChildren(
    el('p', { className: 'big', textContent: `Láminas necesarias en total: ${totalSheets}` }),
    el('table', {}, [
      el('thead', {}, [el('tr', {}, ['Lámina', 'Láminas necesarias', 'Uso', 'Merma'].map((t) => el('th', { textContent: t })))]),
      el('tbody', {}, rows.map((r) =>
        el('tr', {}, [
          el('td', { textContent: defLabel(r.def) }),
          el('td', { textContent: String(r.sheets.length) }),
          el('td', { textContent: r.sheets.length ? `${r.util.toFixed(1)}%` : '—' }),
          el('td', { textContent: r.sheets.length ? `${r.waste.toFixed(1)}%` : '—' }),
        ])
      )),
    ])
  );
  if (result.unplaced.length) {
    $('summary').append(el('p', { className: 'err', textContent: `No caben: ${result.unplaced.join(', ')}` }));
  }

  for (const r of rows) {
    if (!r.sheets.length) continue;
    out.append(el('h3', { textContent: defLabel(r.def) }));
    r.sheets.forEach((sh, i) => {
      const usedArea = sh.items.reduce((a, it) => a + it.area, 0);
      const totalArea = sh.def.W * sh.def.H;
      const usePct = totalArea ? usedArea / totalArea * 100 : 0;
      const wastePct = Math.max(0, 100 - usePct);
      const heading = el('p', { className: 'small metric', textContent: `Lámina ${i + 1} de ${r.sheets.length} · ${sh.items.length} piezas · Uso ${usePct.toFixed(1)}% · Merma ${wastePct.toFixed(1)}%` });
      const list = el('ol', { className: 'piece-list' });
      sh.items.forEach((it, index) => {
        it.displayNumber = index + 1;
        list.append(el('li', { textContent: it.name }));
      });
      const preview = el('div', { className: 'sheet-preview' }, [sheetSVG(sh)]);
      const detail = el('div', {}, [el('div', { className: 'metric', textContent: 'Piezas utilizadas' }), el('p', { className: 'muted', textContent: 'El número dentro del plano corresponde al número de esta lista.' }), list]);
      out.append(heading, el('div', { className: 'result-sheet' }, [preview, detail]));
    });
  }
  $('finalize').disabled = false;
  $('exportDxf').disabled = false;
  showPanel('resultPanel');
}

// ---------- Dibujo ----------
function sheetSVG(sh) {
  const { W, H } = sh.def;
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
    for (const hole of (it.holes || [])) {
      const hd = hole.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(2)} ${(H - y).toFixed(2)}`).join(' ') + ' Z';
      add('path', { d: hd, fill: '#fff', stroke: '#0066b3', 'stroke-width': 1.4, 'vector-effect': 'non-scaling-stroke' });
    }
    if (showLabels && labelScale > 0) {
      const [cx, cy] = centroid(it.poly);
      const minDim = Math.min(it.bb.maxX - it.bb.minX, it.bb.maxY - it.bb.minY);
      const base = Math.min(W, H);
      const fs = Math.max(base * 0.008, Math.min(minDim * 0.42, base / 14)) * labelScale;
      if (fs >= base * 0.004) {
        const t = add('text', { x: cx.toFixed(2), y: (H - cy).toFixed(2), 'font-size': fs.toFixed(2), class: 'label' });
        t.textContent = String(it.displayNumber || sh.items.indexOf(it) + 1);
      }
    }
  }
  return svg;
}

// ---------- PDF ----------
// Página 1: datos generales y resumen. Páginas siguientes: una por lámina con plano y lista.
let logoCache = null;
async function getLogoData() {
  if (logoCache) return logoCache;
  try {
    const blob = await (await fetch('./icons/logo.png')).blob();
    logoCache = await new Promise((resolve) => {
      const fr = new FileReader();
      fr.onload = () => resolve(fr.result);
      fr.readAsDataURL(blob);
    });
  } catch (e) {
    logoCache = null;
  }
  return logoCache;
}

async function exportPDF() {
  statusBox.textContent = 'Generando PDF…';
  const logo = await getLogoData();
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const rows = summaryRows();
  const totalSheets = rows.reduce((a, r) => a + r.sheets.length, 0);
  const project = $('projectName')?.value.trim() || 'Proyecto sin nombre';
  const assembly = $('assemblyName')?.value.trim() || 'No especificado';
  const prepared = $('preparedBy')?.value.trim() || 'No especificado';
  const stamp = new Date().toLocaleString();
  const usedFiles = files.filter((f) => f.geom && f.qty > 0);
  const totalPieces = usedFiles.reduce((a, f) => a + f.qty, 0);

  const blue = [0, 102, 179], dark = [11, 31, 51], muted = [98, 110, 122];
  const light = [234, 244, 252], rule = [214, 223, 232];
  const PW = 210, M = 14, CW = PW - 2 * M, BOTTOM = 276, FOOT_Y = 289;

  const setText = (size, style, color) => {
    doc.setFont('helvetica', style);
    doc.setFontSize(size);
    doc.setTextColor(...color);
  };
  // Recorta un texto de una línea para que quepa en el ancho dado.
  const fit = (t, w) => {
    const s0 = String(t);
    if (doc.getTextWidth(s0) <= w) return s0;
    let s = s0;
    while (s.length > 1 && doc.getTextWidth(s + '…') > w) s = s.slice(0, -1);
    return s + '…';
  };
  const band = (title, sub, tw = CW) => {
    doc.setFillColor(...blue);
    doc.rect(0, 0, PW, 26, 'F');
    setText(13, 'bold', [255, 255, 255]);
    doc.text(fit(title, tw), M, 11);
    setText(8.5, 'normal', [255, 255, 255]);
    doc.text(fit(sub, tw), M, 19);
  };
  const newPage = (title, sub) => {
    doc.addPage();
    band(title, sub);
    return 36;
  };
  // Si el bloque no cabe en la hoja actual, pasa a una hoja nueva y regresa la posición inicial.
  const ensure = (y, h, title, sub) => (y + h > BOTTOM ? newPage(title, sub) : y);

  // Tabla con encabezado que se repite al cambiar de hoja.
  const table = (cols, data, startY, title, sub) => {
    let ty = startY;
    const drawHeader = () => {
      doc.setFillColor(...blue);
      doc.rect(M, ty - 4.5, CW, 7, 'F');
      setText(7.5, 'bold', [255, 255, 255]);
      cols.forEach((c) => doc.text(c.label, c.x, ty, { align: c.align }));
      ty += 7;
    };
    drawHeader();
    for (const row of data) {
      setText(8, 'normal', dark);
      const cells = cols.map((c, i) => doc.splitTextToSize(String(row[i]), c.w));
      const h = Math.max(...cells.map((l) => l.length)) * 3.8 + 3;
      if (ty + h > BOTTOM) {
        newPage(title, sub);
        ty = 36;
        drawHeader();
        setText(8, 'normal', dark);
      }
      cells.forEach((lines, i) => doc.text(lines, cols[i].x, ty + 3.5, { align: cols[i].align }));
      doc.setDrawColor(...rule);
      doc.line(M, ty + h - 0.5, PW - M, ty + h - 0.5);
      ty += h;
    }
    return ty + 4;
  };

  // ---------- Página 1: datos generales ----------
  band('REPORTE DE NESTING', 'Optimización de corte de lámina', CW - 34);
  if (logo) {
    // Logo solo en la primera hoja
    doc.setFillColor(255, 255, 255);
    doc.roundedRect(PW - M - 30, 1, 30, 24, 2, 2, 'F');
    doc.addImage(logo, 'PNG', PW - M - 28, 3, 26, 21.1);
  }
  let y = 38;
  setText(16, 'bold', dark);
  doc.text(fit(project, CW), M, y);
  y += 9;

  const info = [
    ['Ensamble', assembly], ['Elaboró', prepared],
    ['Fecha de emisión', stamp], ['Unidades de trabajo', unitLabel()],
  ];
  info.forEach(([label, value], idx) => {
    const x = M + (idx % 2) * (CW / 2);
    const yy = y + Math.floor(idx / 2) * 12;
    setText(7.5, 'normal', muted);
    doc.text(label, x, yy);
    setText(9.5, 'normal', dark);
    doc.text(fit(value, CW / 2 - 6), x, yy + 5);
  });
  y += 26;

  // Indicadores
  const sheetArea = rows.reduce((a, r) => a + r.sheets.length * r.def.W * r.def.H, 0);
  const usedArea = rows.reduce((a, r) => a + r.sheets.reduce((b, s) => b + s.items.reduce((c, it) => c + it.area, 0), 0), 0);
  const overallUse = sheetArea ? (usedArea / sheetArea) * 100 : 0;
  const kpis = [
    ['Láminas requeridas', String(totalSheets)],
    ['Piezas a fabricar', String(totalPieces)],
    ['Uso promedio', `${overallUse.toFixed(1)}%`],
  ];
  const bw = (CW - 8) / 3;
  kpis.forEach(([label, value], idx) => {
    const x = M + idx * (bw + 4);
    doc.setFillColor(...light);
    doc.roundedRect(x, y, bw, 22, 3, 3, 'F');
    setText(7.5, 'normal', muted);
    doc.text(label, x + 5, y + 7);
    setText(15, 'bold', blue);
    doc.text(value, x + 5, y + 17);
  });
  y += 32;

  // Material requerido por tipo de lámina
  setText(10.5, 'bold', blue);
  doc.text('MATERIAL REQUERIDO', M, y);
  const matCols = [
    { label: 'Tipo de lámina', x: M + 3, w: 96, align: 'left' },
    { label: 'Láminas', x: M + 121, w: 20, align: 'right' },
    { label: 'Uso', x: M + 146, w: 14, align: 'right' },
    { label: 'Merma', x: PW - M - 3, w: 18, align: 'right' },
  ];
  const matData = rows.map((r) => [
    defLabel(r.def),
    String(r.sheets.length),
    r.sheets.length ? `${r.util.toFixed(1)}%` : '—',
    r.sheets.length ? `${r.waste.toFixed(1)}%` : '—',
  ]);
  y = table(matCols, matData, y + 8, 'REPORTE DE NESTING', 'Material requerido (continuación)');

  // Piezas del proyecto
  y = ensure(y, 20, 'REPORTE DE NESTING', 'Piezas del proyecto (continuación)');
  setText(10.5, 'bold', blue);
  doc.text('PIEZAS DEL PROYECTO', M, y);
  const pieceCols = [
    { label: 'Pieza', x: M + 3, w: 72, align: 'left' },
    { label: 'Material', x: M + 78, w: 44, align: 'left' },
    { label: 'Calibre', x: M + 124, w: 40, align: 'left' },
    { label: 'Cant.', x: PW - M - 3, w: 14, align: 'right' },
  ];
  const pieceData = usedFiles.map((f) => [f.name, f.material, f.calibre, String(f.qty)]);
  y = table(pieceCols, pieceData, y + 8, 'REPORTE DE NESTING', 'Piezas del proyecto (continuación)');

  if (result.unplaced.length) {
    const lines = doc.splitTextToSize(`No caben en la lámina: ${result.unplaced.join(', ')}`, CW);
    y = ensure(y, lines.length * 4 + 4, 'REPORTE DE NESTING', 'Advertencias');
    setText(8.5, 'bold', [180, 0, 0]);
    doc.text(lines, M, y);
  }

  // ---------- Páginas de láminas ----------
  for (const r of rows) {
    r.sheets.forEach((sh, i) => {
      const { W, H } = sh.def;
      const title = defLabel(sh.def);
      const sub = `Lámina ${i + 1} de ${r.sheets.length} · ${project} · Ensamble: ${assembly}`;
      newPage(title, sub);

      const usedA = sh.items.reduce((a, it) => a + it.area, 0);
      const usePct = (usedA / (W * H)) * 100;
      setText(8.5, 'normal', dark);
      const infoLine = `Uso ${usePct.toFixed(1)}%  ·  Merma ${Math.max(0, 100 - usePct).toFixed(1)}%  ·  Piezas ${sh.items.length}  ·  Margen ${sh.def.margin} ${unitLabel()}  ·  Gap ${sh.def.gap} ${unitLabel()}  ·  Rotaciones ${sh.def.angles.join('°, ')}°`;
      const infoLines = doc.splitTextToSize(infoLine, CW);
      doc.text(infoLines, M, 35);

      const labelY = 35 + infoLines.length * 4 + 5;
      const top = labelY + 4;
      // Lista en columnas con nombre completo: se elige el espacio mínimo que quepa
      const flowList = (cols, areaH, force = false) => {
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(7.5);
        const textW = CW / cols - 9;
        const out = [];
        let col = 0, y = 0;
        for (let i = 0; i < sh.items.length; i++) {
          const lines = doc.splitTextToSize(sh.items[i].name, textW);
          const h = lines.length * 3.6 + 2.6;
          if (y + h > areaH) {
            if (col + 1 >= cols) {
              if (!force) return null;
            } else {
              col++;
              y = 0;
            }
          }
          out.push({ idx: i, col, y, lines });
          y += h;
        }
        return { cols, items: out };
      };
      let layout = null, areaH = 0;
      for (const ah of [30, 45, 60, 75, 95]) {
        for (const cols of [3, 4, 5, 6]) {
          const l = flowList(cols, ah);
          if (l) { layout = l; areaH = ah; break; }
        }
        if (layout) break;
      }
      if (!layout) { areaH = 95; layout = flowList(6, 95, true); }
      const maxH = Math.max(40, BOTTOM - top - areaH - 20);
      const k = Math.min(CW / W, maxH / H); // mm por unidad de trabajo
      const X = (x) => M + x * k;
      const Y = (yy) => top + (H - yy) * k;

      setText(9, 'bold', blue);
      doc.text('PLANO DE CORTE', M, labelY);
      doc.setFillColor(255, 255, 255);
      doc.setDrawColor(...blue);
      doc.setLineWidth(0.6);
      doc.rect(M, top, W * k, H * k, 'FD');

      const drawLoop = (poly, fill, stroke, lw) => {
        if (!poly || poly.length < 3) return;
        const deltas = [];
        for (let q = 1; q < poly.length; q++) {
          deltas.push([poly[q][0] - poly[q - 1][0], poly[q][1] - poly[q - 1][1]]);
        }
        doc.setFillColor(...fill);
        doc.setDrawColor(...stroke);
        doc.setLineWidth(lw);
        doc.lines(deltas, X(poly[0][0]), Y(poly[0][1]), [k, -k], 'FD', true);
      };

      sh.items.forEach((it, idx) => {
        drawLoop(it.poly, [218, 232, 244], blue, 0.3);
        (it.holes || []).forEach((hole) => drawLoop(hole, [255, 255, 255], blue, 0.25));
        const [cx, cy] = centroid(it.poly);
        const minMM = Math.min(it.bb.maxX - it.bb.minX, it.bb.maxY - it.bb.minY) * k;
        const fsPt = Math.max(4.5, Math.min(8, minMM * 0.45 * 2.835));
        setText(fsPt, 'bold', dark);
        doc.text(String(idx + 1), X(cx), Y(cy) + fsPt * 0.124, { align: 'center' });
      });

      // Piezas utilizadas: nombre completo, en columnas
      const listY = top + H * k + 12;
      setText(9.5, 'bold', blue);
      doc.text('PIEZAS UTILIZADAS', M, listY);
      const colW = CW / layout.cols;
      layout.items.forEach(({ idx, col, y, lines }) => {
        const x = M + col * colW;
        const yy = listY + 7 + y;
        doc.setFillColor(...blue);
        doc.roundedRect(x, yy - 3.4, 5, 4.4, 0.8, 0.8, 'F');
        setText(7, 'bold', [255, 255, 255]);
        doc.text(String(idx + 1), x + 2.5, yy - 0.2, { align: 'center' });
        setText(7.5, 'normal', dark);
        doc.text(lines, x + 7, yy);
      });
    });
  }

  // Pie de página y numeración en todas las hojas
  const total = doc.getNumberOfPages();
  for (let pg = 1; pg <= total; pg++) {
    doc.setPage(pg);
    setText(7, 'normal', muted);
    doc.text(`Generado por Nesting · ${stamp}`, M, FOOT_Y);
    doc.text(`Página ${pg} de ${total}`, PW - M, FOOT_Y, { align: 'right' });
  }

  const stampFile = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
  const safeProject = project.replace(/[^a-z0-9-_]+/gi, '_').slice(0, 40);
  doc.save(`nesting_${safeProject}_${stampFile}.pdf`);
  statusBox.textContent = '';
}

// ---------- Exportar DXF del nesting ----------
function exportDXF() {
  if (!result || !result.sections.length) {
    alert('Primero calcula el nesting para generar el DXF.');
    return;
  }

  const cleanText = (value) => String(value || '').replace(/[\r\n\t]/g, ' ').replace(/[<>]/g, '').trim();
  const pair = (code, value) => `${code}\n${value}\n`;
  const layers = [
    ['SHEETS', 5],
    ['PARTS', 5],
    ['HOLES', 1],
    ['LABELS', 3],
  ];
  let dxf = '';
  // Formato R12 (AC1009): el más compatible con AutoCAD y otros programas
  dxf += pair(0, 'SECTION') + pair(2, 'HEADER');
  dxf += pair(9, '$ACADVER') + pair(1, 'AC1009');
  dxf += pair(9, '$INSUNITS') + pair(70, unitMode === 'in' ? 1 : 4);
  dxf += pair(9, '$MEASUREMENT') + pair(70, unitMode === 'in' ? 0 : 1);
  dxf += pair(0, 'ENDSEC');
  dxf += pair(0, 'SECTION') + pair(2, 'TABLES');
  dxf += pair(0, 'TABLE') + pair(2, 'LTYPE') + pair(70, 1);
  dxf += pair(0, 'LTYPE') + pair(2, 'CONTINUOUS') + pair(70, 0) + pair(3, 'Solid line') + pair(72, 65) + pair(73, 0) + pair(40, 0);
  dxf += pair(0, 'ENDTAB');
  dxf += pair(0, 'TABLE') + pair(2, 'LAYER') + pair(70, layers.length);
  for (const [name, color] of layers) {
    dxf += pair(0, 'LAYER') + pair(2, name) + pair(70, 0) + pair(62, color) + pair(6, 'CONTINUOUS');
  }
  dxf += pair(0, 'ENDTAB') + pair(0, 'ENDSEC');
  dxf += pair(0, 'SECTION') + pair(2, 'ENTITIES');

  const finite = (pts) => pts.every(([x, y]) => Number.isFinite(x) && Number.isFinite(y));
  const addPolyline = (points, layer, offsetX = 0) => {
    if (!points || points.length < 3 || !finite(points)) return;
    dxf += pair(0, 'POLYLINE') + pair(8, layer) + pair(66, 1) + pair(10, 0) + pair(20, 0) + pair(30, 0) + pair(70, 1);
    for (const [x, y] of points) {
      dxf += pair(0, 'VERTEX') + pair(8, layer) + pair(10, (x + offsetX).toFixed(6)) + pair(20, y.toFixed(6)) + pair(30, 0);
    }
    dxf += pair(0, 'SEQEND') + pair(8, layer);
  };
  const addText = (x, y, height, value) => {
    if (![x, y, height].every(Number.isFinite)) return;
    dxf += pair(0, 'TEXT') + pair(8, 'LABELS');
    dxf += pair(10, x.toFixed(6)) + pair(20, y.toFixed(6)) + pair(30, 0);
    dxf += pair(40, height.toFixed(6)) + pair(1, cleanText(value)) + pair(50, 0);
  };

  const project = cleanText($('projectName').value) || 'Proyecto';
  const sheetGap = Math.max(unitMode === 'in' ? 4 : 100, ...result.sections.map((sh) => sh.def.gap * 10));
  let offsetX = 0;
  result.sections.forEach((sh, sheetIndex) => {
    const { W, H } = sh.def;
    addPolyline([[0, 0], [W, 0], [W, H], [0, H]], 'SHEETS', offsetX);
    addText(offsetX, H + (unitMode === 'in' ? 1 : 25), unitMode === 'in' ? 0.18 : 4.5,
      `LAMINA ${sheetIndex + 1} | ${sh.def.material} | ${sh.def.calibre} | ${W} x ${H} ${unitLabel()}`);
    sh.items.forEach((it, index) => {
      addPolyline(it.poly, 'PARTS', offsetX);
      (it.holes || []).forEach((hole) => addPolyline(hole, 'HOLES', offsetX));
      const [cx, cy] = centroid(it.poly);
      const labelHeight = Math.max(Math.min(W, H) * 0.012, unitMode === 'in' ? 0.08 : 2.5);
      addText(offsetX + cx, cy, labelHeight, `${index + 1} - ${it.name}`);
    });
    offsetX += W + sheetGap;
  });
  dxf += pair(0, 'ENDSEC') + pair(0, 'EOF');

  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
  const safeProject = project.replace(/[^a-z0-9-_]+/gi, '_').slice(0, 40);
  const blob = new Blob([dxf], { type: 'application/dxf;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `nesting_${safeProject}_${unitMode}_${stamp}.dxf`;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  $('pdfStatus').textContent = `DXF generado con ${result.sections.length} lámina(s), contornos y recortes interiores. Unidades: ${unitLabel()}.`;
}

$('exportDxf').addEventListener('click', exportDXF);

// ---------- Finalizar / descartar ----------
$('finalize').addEventListener('click', () => {
  if (!result) return;
  exportPDF();
  $('pdfStatus').textContent = 'PDF generado. El cálculo permanece guardado en esta sesión; puedes seguir editando y recalcular.';
});

$('discard').addEventListener('click', () => {
  if (confirm('¿Descartar el cálculo, los DXF y las láminas para empezar uno nuevo?')) {
    clearAll('Cálculo descartado. Puedes crear un nuevo nesting.');
  }
});

function clearAll(message) {
  files = [];
  defs = [];
  result = null;
  $('dxf').value = '';
  $('projectName').value = '';
  $('assemblyName').value = '';
  $('preparedBy').value = '';
  $('pdfStatus').textContent = '';
  $('fileMsg').textContent = '';
  $('pieces').replaceChildren();
  $('piecesBox').hidden = true;
  $('defs').replaceChildren();
  nextId = 1;
  $('results').replaceChildren();
  $('summary').replaceChildren();
  $('finalize').disabled = true;
  $('exportDxf').disabled = true;
  unitMode = 'mm';
  $('units').value = 'mm';
  updateUnitsUI();
  $('status').textContent = message;
  showPanel('filesPanel');
}

// ---------- Pantalla inicial ----------
function showScreen(name) {
  $('homeScreen').hidden = name !== 'home';
  $('sheetApp').hidden = name !== 'sheets';
  window.scrollTo(0, 0);
}
$('openSheets').addEventListener('click', () => showScreen('sheets'));
$('goHome').addEventListener('click', () => showScreen('home'));
showScreen('home');

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js');
}


function showPanel(panelId) {
  document.querySelectorAll('.panel').forEach((panel) => { panel.hidden = panel.id !== panelId; });
  document.querySelectorAll('.nav button[data-panel]').forEach((button) => {
    const active = button.dataset.panel === panelId;
    button.classList.toggle('active', active);
    button.setAttribute('aria-current', active ? 'step' : 'false');
  });
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
document.querySelectorAll('.nav button[data-panel]').forEach((button) => {
  button.addEventListener('click', () => showPanel(button.dataset.panel));
});
