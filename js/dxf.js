// Lector DXF. Soporta LINE, LWPOLYLINE, POLYLINE, CIRCLE y ARC.
// Ignora la capa BEND. Cada archivo debe contener una sola pieza.
// Barrenos y contornos interiores cerrados se conservan como huecos. Los arcos "bulge" se aproximan como segmentos rectos.

const EPS = 0.01;
const SEG = 48;
const SKIP_LAYERS = ['BEND'];

const near = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]) < EPS;
const num = (d, code, def = 0) => {
  const p = d.find((q) => q.c === code);
  return p ? parseFloat(p.v) : def;
};

export function area(pts) {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[(i + 1) % pts.length];
    a += x1 * y2 - x2 * y1;
  }
  return Math.abs(a) / 2;
}

function inside(pt, poly) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > pt[1] !== yj > pt[1] && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}

export function parseDXF(text) {
  const raw = text.split(/\r?\n/);
  const pairs = [];
  for (let i = 0; i + 1 < raw.length; i += 2) {
    pairs.push({ c: parseInt(raw[i].trim(), 10), v: raw[i + 1].trim() });
  }

  const s = pairs.findIndex(
    (p, i) => p.c === 0 && p.v === 'SECTION' && pairs[i + 1] && pairs[i + 1].v === 'ENTITIES'
  );
  if (s < 0) throw new Error('No hay sección ENTITIES (¿es un DXF válido?)');

  const ents = [];
  let cur = null;
  for (let i = s + 2; i < pairs.length; i++) {
    const p = pairs[i];
    if (p.c === 0) {
      if (p.v === 'ENDSEC') break;
      cur = { type: p.v, data: [] };
      ents.push(cur);
    } else if (cur) {
      cur.data.push(p);
    }
  }

  const open = [];
  const closed = [];
  for (let i = 0; i < ents.length; i++) {
    const e = ents[i];
    const layer = (e.data.find((p) => p.c === 8)?.v || '0').toUpperCase();
    if (SKIP_LAYERS.includes(layer)) continue;

    // POLYLINE/VERTEX/SEQEND es la representación clásica de polilíneas DXF.
    if (e.type === 'POLYLINE') {
      const pts = [];
      let j = i + 1;
      while (j < ents.length && ents[j].type === 'VERTEX') {
        pts.push([num(ents[j].data, 10), num(ents[j].data, 20)]);
        j++;
      }
      if (j < ents.length && ents[j].type === 'SEQEND') i = j;
      else i = j - 1;
      if (pts.length > 2) {
        const isClosed = (num(e.data, 70) & 1) === 1;
        (isClosed ? closed : open).push(pts);
      }
      continue;
    }

    // Los registros VERTEX y SEQEND pertenecen a su POLYLINE y no son contornos independientes.
    if (e.type === 'VERTEX' || e.type === 'SEQEND') continue;
    const path = toPath(e);
    if (!path) continue;
    (path.closed ? closed : open).push(path.pts);
  }

  const loops = chain(open).concat(closed.map(clean)).filter((l) => l.length >= 3);
  if (!loops.length) throw new Error('No se encontró ningún contorno cerrado');

  loops.sort((a, b) => area(b) - area(a));
  const outer = loops[0];
  const holes = [];
  for (const l of loops.slice(1)) {
    if (inside(l[0], outer)) holes.push(l);
    else throw new Error('El archivo tiene más de una pieza; sepáralas en archivos distintos');
  }

  const outerS = simplifyLoop(outer);
  const holesS = holes.map(simplifyLoop);
  const material = area(outerS) - holesS.reduce((s, h) => s + area(h), 0);
  return { outer: outerS, holes: holesS, area: material };
}

function toPath({ type, data: d }) {
  switch (type) {
    case 'LINE':
      return { pts: [[num(d, 10), num(d, 20)], [num(d, 11), num(d, 21)]], closed: false };
    case 'LWPOLYLINE': {
      const pts = [];
      for (const p of d) {
        if (p.c === 10) pts.push([parseFloat(p.v), 0]);
        else if (p.c === 20 && pts.length) pts[pts.length - 1][1] = parseFloat(p.v);
      }
      return pts.length > 1 ? { pts, closed: (num(d, 70) & 1) === 1 } : null;
    }
    case 'CIRCLE':
      return { pts: arcPts(num(d, 10), num(d, 20), num(d, 40), 0, 360), closed: true };
    case 'ARC':
      return {
        pts: arcPts(num(d, 10), num(d, 20), num(d, 40), num(d, 50), num(d, 51)),
        closed: false,
      };
    default:
      return null;
  }
}

function arcPts(cx, cy, r, a0, a1) {
  let end = a1;
  if (end <= a0) end += 360;
  const n = Math.max(8, Math.ceil((SEG * (end - a0)) / 360));
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const a = ((a0 + ((end - a0) * i) / n) * Math.PI) / 180;
    pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  return pts;
}

function clean(pts) {
  return pts.length > 1 && near(pts[0], pts[pts.length - 1]) ? pts.slice(0, -1) : pts;
}

// Une líneas y arcos abiertos formando contornos cerrados. Tiempo casi lineal.
function chain(paths) {
  const key = (p) => `${Math.round(p[0] * 100)},${Math.round(p[1] * 100)}`;
  const idx = new Map();
  paths.forEach((p, i) => {
    for (const e of [p[0], p[p.length - 1]]) {
      const k = key(e);
      if (!idx.has(k)) idx.set(k, []);
      idx.get(k).push(i);
    }
  });
  const used = new Array(paths.length).fill(false);
  const takeFrom = (pt) => {
    const list = idx.get(key(pt)) || [];
    while (list.length) {
      const j = list.pop();
      if (!used[j]) return j;
    }
    return -1;
  };
  const extendTail = (cur) => {
    for (;;) {
      if (cur.length > 3 && near(cur[cur.length - 1], cur[0])) return;
      const j = takeFrom(cur[cur.length - 1]);
      if (j < 0) return;
      used[j] = true;
      const q = paths[j];
      if (near(q[0], cur[cur.length - 1])) {
        for (let k = 1; k < q.length; k++) cur.push(q[k]);
      } else {
        for (let k = q.length - 2; k >= 0; k--) cur.push(q[k]);
      }
    }
  };
  const loops = [];
  for (let i = 0; i < paths.length; i++) {
    if (used[i]) continue;
    used[i] = true;
    const cur = paths[i].slice();
    extendTail(cur);
    cur.reverse();
    extendTail(cur);
    cur.reverse();
    if (cur.length >= 4 && near(cur[0], cur[cur.length - 1])) loops.push(clean(cur));
  }
  return loops;
}

// Simplificación (Ramer-Douglas-Peucker) para que el acomodo sea rápido sin perder forma.
function segD(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const L = dx * dx + dy * dy;
  let t = L ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}
function rdp(p, tol) {
  if (p.length < 3) return p;
  const a = p[0], b = p[p.length - 1];
  let maxD = -1, idx = 0;
  for (let i = 1; i < p.length - 1; i++) {
    const d = segD(p[i], a, b);
    if (d > maxD) { maxD = d; idx = i; }
  }
  if (maxD > tol) {
    const l = rdp(p.slice(0, idx + 1), tol);
    const r = rdp(p.slice(idx), tol);
    return l.slice(0, -1).concat(r);
  }
  return [a, b];
}
function simplifyLoop(pts) {
  if (pts.length < 12) return pts;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of pts) { minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); }
  const tol = 2e-5 * Math.hypot(maxX - minX, maxY - minY);
  let far = 1, best = -1;
  for (let i = 1; i < pts.length; i++) {
    const d = Math.hypot(pts[i][0] - pts[0][0], pts[i][1] - pts[0][1]);
    if (d > best) { best = d; far = i; }
  }
  const a = rdp(pts.slice(0, far + 1), tol);
  const b = rdp(pts.slice(far).concat([pts[0]]), tol);
  const out = a.slice(0, -1).concat(b.slice(0, -1));
  return out.length >= 3 ? out : pts;
}
