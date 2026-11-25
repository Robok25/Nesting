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
let unitMode = 'mm'; // La unidad es única para todos los DXF y láminas de esta sesión.

const unitLabel = () => unitMode === 'in' ? 'in' : 'mm';
const areaUnitLabel = () => unitMode === 'in' ? 'in²' : 'mm²';
const unitToMm = () => unitMode === 'in' ? 25.4 : 1;
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

let bulkMaterialValue = '';
let bulkCalibreValue = '';

function applyBulkValue(kind, value) {
  if (!value) {
    alert(`Selecciona un ${kind === 'material' ? 'material' : 'calibre'} antes de aplicar.`);
    return;
  }
  files.forEach((file) => { file[kind] = value; });
  renderPieces();
  $('fileMsg').textContent = `${kind === 'material' ? 'Material' : 'Calibre'} "${value}" aplicado a ${files.length} archivo(s).`;
}

function setupBulkAssignment() {
  const materialSelect = dropdown('', MATERIAL_OPTIONS, (value) => { bulkMaterialValue = value; }, 'Seleccionar material...');
  const calibreSelect = dropdown('', CALIBRE_OPTIONS, (value) => { bulkCalibreValue = value; }, 'Seleccionar calibre...');
  const materialButton = el('button', { type: 'button', className: 'secondary', textContent: 'Aplicar a todas', onclick: () => applyBulkValue('material', bulkMaterialValue) });
  const calibreButton = el('button', { type: 'button', className: 'secondary', textContent: 'Aplicar a todas', onclick: () => applyBulkValue('calibre', bulkCalibreValue) });
  $('bulkAssignment').replaceChildren(
    el('div', { className: 'bulk-control' }, [
      el('label', {}, [el('span', { textContent: 'Material para todas las piezas' }), materialSelect]),
      materialButton,
    ]),
    el('div', { className: 'bulk-control' }, [
      el('label', {}, [el('span', { textContent: 'Calibre para todas las piezas' }), calibreSelect]),
      calibreButton,
    ])
  );
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

setupBulkAssignment();

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

  const overlay = $('loadingOverlay');
  const loadingMessage = $('loadingMessage');
  $('calc').disabled = true;
  overlay.hidden = false;
  overlay.setAttribute('aria-hidden', 'false');
  document.body.classList.add('calculating');
  document.activeElement?.blur();
  result = { sections: [], unplaced: [] };
  try {
    // Permite que el navegador pinte la pantalla de carga antes de iniciar el trabajo.
    await new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 80)));
    let groupIndex = 0;
    for (const [k, pcs] of groups) {
      groupIndex++;
      const gdefs = defs
        .filter((d) => keyOf(d.material, d.calibre) === k)
        .map((d) => ({ ...d, angles: parseAngles(d.angles) }));
      const total = pcs.reduce((sum, pc) => sum + pc.qty, 0);
      loadingMessage.textContent = `Material/calibre ${groupIndex} de ${groups.size}: ${k.split('|').join(' · ')}. Preparando ${total} piezas…`;
      $('status').textContent = `Acomodando ${k.split('|').join(' · ')}…`;
      const r = await nestGroup({
        pieces: pcs,
        defs: gdefs,
        onProgress: (i, t) => {
          const pct = t ? Math.round((i / t) * 100) : 100;
          loadingMessage.textContent = `${k.split('|').join(' · ')}: acomodando pieza ${i} de ${t} (${pct}%)`;
          $('status').textContent = `Grupo ${groupIndex}/${groups.size} · pieza ${i} de ${t}`;
        },
      });
      result.sections.push(...r.sheets.map((sheet) => sheet));
      result.unplaced.push(...r.unplaced.map((n) => `${n} (${k.split('|').join(' · ')})`));
    }
    renderResult();
  } catch (error) {
    console.error(error);
    $('status').textContent = `No se pudo completar el cálculo: ${error.message || error}`;
    alert(`Ocurrió un error al calcular el nesting: ${error.message || error}`);
  } finally {
    overlay.hidden = true;
    overlay.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('calculating');
    $('calc').disabled = false;
    $('status').textContent = '';
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
      add('path', { d: hd, fill: '#fff', stroke: '#1f4e79', 'stroke-width': 1.4, 'vector-effect': 'non-scaling-stroke' });
    }
    const [cx, cy] = centroid(it.poly);
    const xs = it.poly.map((p) => p[0]), ys = it.poly.map((p) => p[1]);
    const pieceW = Math.max(...xs) - Math.min(...xs);
    const pieceH = Math.max(...ys) - Math.min(...ys);
    const minPieceSide = Math.min(pieceW, pieceH);
    const labelSize = Math.max(unitMode === 'in' ? 0.025 : 0.55,
      Math.min(minPieceSide * 0.085, Math.min(W, H) * 0.0065));
    const t = add('text', { x: cx.toFixed(2), y: (H - cy).toFixed(2), 'font-size': labelSize.toFixed(3), class: 'label' });
    t.textContent = String(it.displayNumber || sh.items.indexOf(it) + 1);
  }
  return svg;
}

// ---------- PDF ----------
function exportPDF() {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const rows = summaryRows();
  const totalSheets = rows.reduce((a, r) => a + r.sheets.length, 0);

  const project = $('projectName')?.value.trim() || 'Proyecto sin nombre';
  const assembly = $('assemblyName')?.value.trim() || 'No especificado';
  const prepared = $('preparedBy')?.value.trim() || 'No especificado';
  const blue = [31, 78, 121];
  const dark = [31, 45, 58];
  const light = [239, 244, 248];
  doc.setFillColor(...blue);
  doc.rect(0, 0, 210, 34, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(19);
  doc.text('REPORTE DE NESTING', 15, 16);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.text('OPTIMIZACIÓN DE CORTE DE LÁMINA', 15, 24);
  doc.setTextColor(...dark);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(15);
  doc.text(project, 15, 45, { maxWidth: 180 });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.text(`Ensamble: ${assembly}`, 15, 54, { maxWidth: 180 });
  doc.text(`Elaboró: ${prepared}`, 15, 60);
  doc.text(`Fecha de emisión: ${new Date().toLocaleString()}`, 15, 66);
  doc.setFillColor(...light);
  doc.roundedRect(15, 73, 180, 20, 3, 3, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text(`Láminas requeridas: ${totalSheets}`, 22, 85);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.text(`Piezas procesadas: ${files.filter(f => f.geom && f.qty > 0).reduce((a, f) => a + f.qty, 0)}`, 112, 85);
  doc.text(`Unidades de trabajo: ${unitLabel()}`, 22, 90);
  let y = 105;
  doc.setTextColor(...blue);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.text('ÍNDICE Y RESUMEN DEL NESTING', 15, y);
  y += 8;
  doc.setTextColor(255, 255, 255);
  doc.setFillColor(...blue);
  doc.rect(15, y - 5, 180, 8, 'F');
  doc.setFontSize(8);
  doc.text('MATERIAL / CALIBRE / MEDIDA', 18, y);
  doc.text('CANT.', 130, y);
  doc.text('USO', 151, y);
  doc.text('MERMA', 174, y);
  y += 8;
  doc.setTextColor(...dark);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  for (const r of rows) {
    if (y > 275) {
      doc.addPage();
      doc.setFillColor(...blue);
      doc.rect(0, 0, 210, 22, 'F');
      doc.setTextColor(255, 255, 255);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(10);
      doc.text('ÍNDICE DEL NESTING · CONTINUACIÓN', 15, 14);
      y = 34;
      doc.setFillColor(...blue);
      doc.rect(15, y - 5, 180, 8, 'F');
      doc.setTextColor(255, 255, 255);
      doc.setFontSize(8);
      doc.text('MATERIAL / CALIBRE / MEDIDA', 18, y);
      doc.text('CANT.', 130, y);
      doc.text('USO', 151, y);
      doc.text('MERMA', 174, y);
      y += 8;
      doc.setTextColor(...dark);
      doc.setFont('helvetica', 'normal');
    }
    doc.text(defLabel(r.def), 18, y, { maxWidth: 105 });
    doc.text(String(r.sheets.length), 132, y);
    doc.text(r.sheets.length ? r.util.toFixed(1) + '%' : '—', 151, y);
    doc.text(r.sheets.length ? r.waste.toFixed(1) + '%' : '—', 174, y);
    doc.setDrawColor(220, 228, 235);
    doc.line(15, y + 3, 195, y + 3);
    y += 9;
  }
  if (result.unplaced.length) {
    y += 3;
    if (y > 280) { doc.addPage(); y = 25; }
    doc.setTextColor(180, 0, 0);
    doc.text(`No caben: ${result.unplaced.join(', ')}`, 15, y, { maxWidth: 180 });
    doc.setTextColor(0, 0, 0);
  }

  // El índice queda separado de los planos. Después, una página por lámina,
  // conservando el mismo diseño azul, plano y lista de piezas de la aplicación.
  let pageNo = 0;
  if (totalSheets > 0) doc.addPage();
  for (const r of rows) {
    r.sheets.forEach((sh, i) => {
      if (pageNo > 0) doc.addPage();
      pageNo++;
      const { W, H } = sh.def;
      const factor = unitToMm();
      const scale = Math.min(105 / (W * factor), 205 / (H * factor));
      const x0 = 15, y0 = 48;
      const X = (x) => x0 + x * scale * factor;
      const Y = (yy) => y0 + (H - yy) * scale * factor;

      doc.setFillColor(...blue);
      doc.rect(0, 0, 210, 27, 'F');
      doc.setTextColor(255, 255, 255);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(11);
      doc.text(`${project} — ${defLabel(sh.def)}`, 15, 12, { maxWidth: 180 });
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      doc.text(`Lámina ${i + 1} de ${r.sheets.length} · Ensamble: ${assembly}`, 15, 19, { maxWidth: 180 });
      doc.setTextColor(...dark);
      doc.setFontSize(8);
      const sheetUse = sh.items.reduce((a, it) => a + it.area, 0) / (W * H) * 100;
      doc.text(`Uso ${sheetUse.toFixed(1)}% · Merma ${Math.max(0, 100 - sheetUse).toFixed(1)}% · ${W} × ${H} ${unitLabel()}`, 15, 35);

      const sheetW = W * scale * factor, sheetH = H * scale * factor;
      doc.setFillColor(255, 255, 255);
      doc.setDrawColor(...blue);
      doc.setLineWidth(0.7);
      doc.rect(x0, y0, sheetW, sheetH, 'FD');

      const drawLoop = (poly, fill, stroke) => {
        if (!poly || poly.length < 3) return;
        const deltas = [];
        let prev = poly[0];
        for (let k = 1; k < poly.length; k++) {
          const p = poly[k];
          deltas.push([p[0] - prev[0], p[1] - prev[1]]);
          prev = p;
        }
        doc.setFillColor(...fill);
        doc.setDrawColor(...stroke);
        doc.setLineWidth(0.35);
        doc.lines(deltas, X(poly[0][0]), Y(poly[0][1]), [scale * factor, -scale * factor], 'FD', true);
      };

      sh.items.forEach((it, index) => {
        drawLoop(it.poly, [218, 232, 244], blue);
        (it.holes || []).forEach((hole) => drawLoop(hole, [255, 255, 255], blue));
        const [cx, cy] = centroid(it.poly);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(9);
        doc.setTextColor(...dark);
        doc.text(String(index + 1), X(cx), Y(cy), { align: 'center' });
      });

      const listX = 128;
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(10);
      doc.setTextColor(...blue);
      doc.text('PIEZAS UTILIZADAS', listX, 48);
      let ty = 57;
      sh.items.forEach((it, index) => {
        const lines = doc.splitTextToSize(it.name, 57);
        const rowH = Math.max(8, lines.length * 4.2 + 3);
        if (ty + rowH > 282) {
          doc.addPage();
          doc.setFillColor(...blue);
          doc.rect(0, 0, 210, 22, 'F');
          doc.setTextColor(255, 255, 255);
          doc.setFont('helvetica', 'bold');
          doc.setFontSize(10);
          doc.text('PIEZAS UTILIZADAS · CONTINUACIÓN', 15, 14);
          ty = 32;
        }
        doc.setFillColor(247, 250, 252);
        doc.setDrawColor(224, 231, 238);
        doc.roundedRect(listX, ty - 5, 72, rowH, 1.5, 1.5, 'FD');
        doc.setFillColor(...blue);
        doc.roundedRect(listX + 3, ty - 2.5, 5.5, 5.5, 1, 1, 'F');
        doc.setTextColor(255, 255, 255);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(7.5);
        doc.text(String(index + 1), listX + 5.75, ty + 1.2, { align: 'center' });
        doc.setTextColor(...dark);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(8);
        doc.text(lines, listX + 11, ty + 1, { maxWidth: 58 });
        ty += rowH + 2;
      });
      doc.setTextColor(110, 120, 130);
      doc.setFontSize(7);
      doc.text(`Generado por Nesting · Unidades: ${unitLabel()} · ${new Date().toLocaleDateString()}`, 15, 290);
    });
  }
  // Si no hubo láminas, deja un aviso en la primera página
  if (pageNo === 0) doc.text('Sin láminas calculadas.', 15, 60);

  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
  const safeProject = project.replace(/[^a-z0-9-_]+/gi, '_').slice(0, 40);
  doc.save(`nesting_${safeProject}_${stamp}.pdf`);
}

// ---------- Exportar DXF del nesting ----------
function exportDXF() {
  if (!result || !result.sections.length) {
    alert('Primero calcula el nesting para generar el DXF.');
    return;
  }

  // DXF ASCII R12 (AC1009): POLYLINE/VERTEX ofrece mayor compatibilidad
  // con AutoCAD y programas CAM que el LWPOLYLINE minimalista anterior.
  const cleanText = (value) => String(value || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[\r\n\t]/g, ' ').replace(/[^\x20-\x7E]/g, '?')
    .replace(/[<>]/g, '').trim();
  const pair = (code, value) => `${code}\r\n${value}\r\n`;
  const fmt = (n) => Number.isFinite(n) ? Number(n).toFixed(6) : '0';
  const layers = [['0', 7], ['SHEETS', 5], ['PARTS', 5], ['HOLES', 1], ['LABELS', 3]];
  const sheetGap = Math.max(unitMode === 'in' ? 4 : 100, ...result.sections.map((sh) => sh.def.gap * 10));
  const drawingWidth = result.sections.reduce((sum, sh, i) => sum + sh.def.W + (i ? sheetGap : 0), 0);
  const drawingHeight = Math.max(...result.sections.map((sh) => sh.def.H + (unitMode === 'in' ? 1 : 25)));
  let dxf = '';

  dxf += pair(0, 'SECTION') + pair(2, 'HEADER');
  dxf += pair(9, '$ACADVER') + pair(1, 'AC1009');
  dxf += pair(9, '$LUNITS') + pair(70, 2);
  dxf += pair(9, '$LUPREC') + pair(70, 4);
  dxf += pair(9, '$INSBASE') + pair(10, 0) + pair(20, 0) + pair(30, 0);
  dxf += pair(9, '$EXTMIN') + pair(10, 0) + pair(20, 0) + pair(30, 0);
  dxf += pair(9, '$EXTMAX') + pair(10, fmt(drawingWidth)) + pair(20, fmt(drawingHeight)) + pair(30, 0);
  dxf += pair(9, '$LIMMIN') + pair(10, 0) + pair(20, 0);
  dxf += pair(9, '$LIMMAX') + pair(10, fmt(drawingWidth)) + pair(20, fmt(drawingHeight));
  dxf += pair(9, '$CLAYER') + pair(8, '0');
  dxf += pair(9, '$TEXTSTYLE') + pair(7, 'STANDARD');
  dxf += pair(9, '$LTSCALE') + pair(40, 1);
  dxf += pair(9, '$CECOLOR') + pair(62, 256);
  // R12 no define $INSUNITS; se conserva la unidad como comentario DXF
  // y las coordenadas permanecen 1:1 en mm o pulgadas.
  dxf += pair(999, `UNIDADES DEL DIBUJO: ${unitMode === 'in' ? 'PULGADAS' : 'MILIMETROS'} (1 unidad = 1 ${unitMode === 'in' ? 'in' : 'mm'})`);
  dxf += pair(0, 'ENDSEC');

  dxf += pair(0, 'SECTION') + pair(2, 'TABLES');
  dxf += pair(0, 'TABLE') + pair(2, 'LTYPE') + pair(70, 1);
  dxf += pair(0, 'LTYPE') + pair(2, 'CONTINUOUS') + pair(70, 0) + pair(3, 'Solid line') + pair(72, 65) + pair(73, 0) + pair(40, 0);
  dxf += pair(0, 'ENDTAB');
  dxf += pair(0, 'TABLE') + pair(2, 'LAYER') + pair(70, layers.length);
  for (const [name, color] of layers) {
    dxf += pair(0, 'LAYER') + pair(2, name) + pair(70, 0) + pair(62, color) + pair(6, 'CONTINUOUS');
  }
  dxf += pair(0, 'ENDTAB');
  dxf += pair(0, 'TABLE') + pair(2, 'STYLE') + pair(70, 1);
  dxf += pair(0, 'STYLE') + pair(2, 'STANDARD') + pair(70, 0) + pair(40, 0) + pair(41, 1) + pair(50, 0) + pair(71, 0) + pair(42, 2.5) + pair(3, 'txt') + pair(4, '');
  dxf += pair(0, 'ENDTAB') + pair(0, 'ENDSEC');

  dxf += pair(0, 'SECTION') + pair(2, 'BLOCKS');
  for (const blockName of ['*MODEL_SPACE', '*PAPER_SPACE']) {
    dxf += pair(0, 'BLOCK') + pair(8, '0') + pair(2, blockName) + pair(70, 0);
    dxf += pair(10, 0) + pair(20, 0) + pair(30, 0) + pair(3, blockName) + pair(1, '');
    dxf += pair(0, 'ENDBLK') + pair(8, '0');
  }
  dxf += pair(0, 'ENDSEC');
  dxf += pair(0, 'SECTION') + pair(2, 'ENTITIES');

  const addPolyline = (points, layer, offsetX = 0) => {
    if (!points || points.length < 3) return;
    dxf += pair(0, 'POLYLINE') + pair(8, layer) + pair(66, 1) + pair(70, 1);
    dxf += pair(10, 0) + pair(20, 0) + pair(30, 0);
    for (const [x, y] of points) {
      dxf += pair(0, 'VERTEX') + pair(8, layer);
      dxf += pair(10, fmt(x + offsetX)) + pair(20, fmt(y)) + pair(30, 0) + pair(70, 0);
    }
    dxf += pair(0, 'SEQEND') + pair(8, layer);
  };
  const addText = (x, y, height, value) => {
    let label = cleanText(value);
    if (label.length > 240) label = label.slice(0, 237) + '...';
    dxf += pair(0, 'TEXT') + pair(8, 'LABELS') + pair(10, fmt(x)) + pair(20, fmt(y)) + pair(30, 0);
    dxf += pair(40, fmt(height)) + pair(1, label) + pair(50, 0) + pair(7, 'STANDARD');
  };

  const project = cleanText($('projectName').value) || 'Proyecto';
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
      const xs = it.poly.map((p) => p[0]), ys = it.poly.map((p) => p[1]);
      const pieceSize = Math.min(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
      const labelHeight = Math.max(unitMode === 'in' ? 0.035 : 0.9, Math.min(pieceSize * 0.12, Math.min(W, H) * 0.01));
      addText(offsetX + cx, cy, labelHeight, `${index + 1} - ${it.name}`);
    });
    offsetX += W + sheetGap;
  });
  dxf += pair(0, 'ENDSEC') + pair(0, 'EOF');

  // Comprobaciones mínimas antes de entregar el archivo.
  if (!dxf.startsWith('0\r\nSECTION\r\n') || !dxf.trimEnd().endsWith('0\r\nEOF')) {
    throw new Error('No se pudo validar la estructura del DXF generado.');
  }
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
  const safeProject = project.replace(/[^a-z0-9-_]+/gi, '_').slice(0, 40);
  const fileName = `nesting_${safeProject}_${unitMode}_${stamp}.dxf`;
  const blob = new Blob([dxf], { type: 'image/vnd.dxf' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.type = 'image/vnd.dxf';
  link.style.display = 'none';
  document.body.append(link);
  link.click();
  link.remove();
  // No revocar inmediatamente: algunos navegadores móviles aún no han iniciado la descarga.
  window.setTimeout(() => URL.revokeObjectURL(url), 2000);
  $('pdfStatus').textContent = `DXF R12 generado: ${result.sections.length} lámina(s), contornos, piezas y huecos. Unidades de dibujo: ${unitLabel()} (escala 1:1).`;
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
