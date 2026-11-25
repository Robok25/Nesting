import { parseDXF } from './dxf.js';
import { nestGroup, centroid } from './nester.js';

const $ = (id) => document.getElementById(id);
const NS = 'http://www.w3.org/2000/svg';
const ANGLE_OPTIONS = [
  { value: '0,90', label: '0° y 90°' },
  { value: '0,45,90', label: '0°, 45° y 90°' },
];

// Estado solo en memoria. No se usa localStorage ni IndexedDB.
let files = [];   // { name, qty, material, calibre, geom, error }
let defs = [];    // { id, material, calibre, W, H, margin, gap, angles }
let result = null;
let nextId = 1;

const keyOf = (m, c) => `${m.trim().toUpperCase()}|${c.trim().toUpperCase()}`;
const defLabel = (d) => `${d.material.trim()} · ${d.calibre.trim()} · ${d.W} × ${d.H} mm`;
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
        el('td', { textContent: f.geom ? Math.round(f.geom.area).toLocaleString() : '—' }),
        el('td', {}, [input('number', f.qty, (v) => (f.qty = Math.max(0, parseInt(v, 10) || 0)), { min: 0, step: 1, disabled })]),
        el('td', {}, [input('text', f.material, (v) => (f.material = v), { placeholder: 'Ej. Acero', disabled })]),
        el('td', {}, [input('text', f.calibre, (v) => (f.calibre = v), { placeholder: 'Ej. CAL 16', disabled })]),
        el('td', { textContent: f.error ? 'Error: ' + f.error : 'OK', className: f.error ? 'err' : 'ok' }),
        el('td', {}, [el('button', { type: 'button', className: 'danger small', textContent: 'Quitar', onclick: () => {
          if (confirm(`¿Quitar el archivo "${f.name}" de la lista?`)) { files = files.filter((item) => item !== f); renderPieces(); }
        } })]),
      ])
    );
  }
}

// ---------- 3. Láminas disponibles ----------
$('addDef').addEventListener('click', () => {
  defs.push({ id: nextId++, material: '', calibre: '', W: 1220, H: 2440, margin: 10, gap: 3, angles: '0,90' });
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
          el('label', {}, [el('span', { textContent: 'Material' }), input('text', d.material, (v) => (d.material = v), { placeholder: 'Ej. Acero' })]),
          el('label', {}, [el('span', { textContent: 'Calibre' }), input('text', d.calibre, (v) => (d.calibre = v), { placeholder: 'Ej. CAL 16' })]),
          el('label', {}, [el('span', { textContent: 'Ancho (mm)' }), input('number', d.W, (v) => (d.W = v), { min: 1 })]),
          el('label', {}, [el('span', { textContent: 'Alto (mm)' }), input('number', d.H, (v) => (d.H = v), { min: 1 })]),
          el('label', {}, [el('span', { textContent: 'Margen (mm)' }), input('number', d.margin, (v) => (d.margin = v), { min: 0 })]),
          el('label', {}, [el('span', { textContent: 'Gap (mm)' }), input('number', d.gap, (v) => (d.gap = v), { min: 0, step: 0.1 })]),
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
      $('status').textContent = `Acomodando ${k.split('|').join(' · ')}…`;
      const r = await nestGroup({
        pieces: pcs,
        defs: gdefs,
        onProgress: (i, t) => ($('status').textContent = `${k.split('|').join(' · ')}: pieza ${i} de ${t}`),
      });
      result.sections.push(...r.sheets.map((s) => s));
      result.unplaced.push(...r.unplaced.map((n) => `${n} (${k.split('|').join(' · ')})`));
    }
    renderResult();
  } finally {
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
    const t = add('text', { x: cx.toFixed(2), y: (H - cy).toFixed(2), 'font-size': Math.max(Math.min(W, H) / 28, 13), class: 'label' });
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
  let y = 105;
  doc.setTextColor(...blue);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.text('RESUMEN DE MATERIAL REQUERIDO', 15, y);
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
    if (y > 275) { doc.addPage(); y = 22; }
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
    doc.setTextColor(180, 0, 0);
    doc.text(`No caben: ${result.unplaced.join(', ')}`, 15, y, { maxWidth: 180 });
    doc.setTextColor(0, 0, 0);
  }

  // Una página por lámina
  let pageNo = 0;
  for (const r of rows) {
    r.sheets.forEach((sh, i) => {
      doc.addPage();
      pageNo++;
      const { W, H } = sh.def;
      const scale = Math.min(180 / W, 180 / H);
      const y0 = 42;
      const X = (x) => 15 + x * scale;
      const Y = (yy) => y0 + (H - yy) * scale;

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
      doc.setFontSize(9);
      const sheetUse = sh.items.reduce((a, it) => a + it.area, 0) / (W * H) * 100;
      doc.text(`Uso: ${sheetUse.toFixed(1)}% | Merma: ${Math.max(0, 100 - sheetUse).toFixed(1)}% | Margen: ${sh.def.margin} mm | Gap: ${sh.def.gap} mm`, 15, 33);

      doc.setLineWidth(0.4);
      doc.rect(X(0), Y(H), W * scale, H * scale);
      doc.setLineWidth(0.2);
      for (const it of sh.items) {
        const p = it.poly;
        for (let k = 0; k < p.length; k++) {
          const a = p[k], b = p[(k + 1) % p.length];
          doc.line(X(a[0]), Y(a[1]), X(b[0]), Y(b[1]));
        }
        for (const hole of (it.holes || [])) {
          for (let k = 0; k < hole.length; k++) {
            const a = hole[k], b = hole[(k + 1) % hole.length];
            doc.line(X(a[0]), Y(a[1]), X(b[0]), Y(b[1]));
          }
        }
        const [cx, cy] = centroid(p);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(10);
        doc.text(String(sh.items.indexOf(it) + 1), X(cx), Y(cy), { align: 'center' });
      }

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(9);
      let ty = y0 + H * scale + 9;
      doc.text('IDENTIFICACIÓN DE PIEZAS', 15, ty);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      sh.items.forEach((it, index) => {
        ty += 5;
        if (ty > 285) { doc.addPage(); ty = 20; }
        doc.text(`${index + 1}. ${it.name}`, 18, ty, { maxWidth: 175 });
      });
      doc.setTextColor(110, 120, 130);
      doc.setFontSize(7);
      doc.text(`Generado por Nesting · ${new Date().toLocaleDateString()}`, 15, 290);
    });
  }
  // Si no hubo láminas, deja un aviso en la primera página
  if (pageNo === 0) doc.text('Sin láminas calculadas.', 15, 60);

  doc.setTextColor(110, 120, 130);
  doc.setFontSize(7);
  doc.text('Documento de apoyo para cotización y planeación de corte. Verificar material, espesor y medidas antes de liberar a producción.', 15, 285, { maxWidth: 180 });
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
  const safeProject = project.replace(/[^a-z0-9-_]+/gi, '_').slice(0, 40);
  doc.save(`nesting_${safeProject}_${stamp}.pdf`);
}

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
  $('fileMsg').textContent = '';
  $('pieces').replaceChildren();
  $('piecesBox').hidden = true;
  $('defs').replaceChildren();
  $('results').replaceChildren();
  $('summary').replaceChildren();
  $('finalize').disabled = true;
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
