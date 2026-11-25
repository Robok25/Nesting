// Lector DXF mínimo. Soporta LINE, LWPOLYLINE, CIRCLE y ARC.
// Ignora la capa BEND. Cada archivo debe contener una sola pieza.
// Nota: los arcos "bulge" dentro de polilíneas se aproximan como segmentos rectos.

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
  for (const e of ents) {
    const layer = (e.data.find((p) => p.c === 8)?.v || '0').toUpperCase();
    if (SKIP_LAYERS.includes(layer)) continue;
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

  const material = area(outer) - holes.reduce((s, h) => s + area(h), 0);
  return { outer, holes, area: material };
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

// Une líneas y arcos abiertos formando contornos cerrados.
function chain(paths) {
  const loops = [];
  const rest = paths.slice();
  while (rest.length) {
    let cur = rest.pop();
    let grew = true;
    while (grew && !near(cur[0], cur[cur.length - 1])) {
      grew = false;
      for (let j = 0; j < rest.length && !grew; j++) {
        const q = rest[j];
        const f = cur[0];
        const l = cur[cur.length - 1];
        const qs = q[0];
        const qe = q[q.length - 1];
        let next = null;
        if (near(l, qs)) next = cur.concat(q.slice(1));
        else if (near(l, qe)) next = cur.concat(q.slice(0, -1).reverse());
        else if (near(f, qe)) next = q.concat(cur.slice(1));
        else if (near(f, qs)) next = q.slice().reverse().concat(cur.slice(1));
        if (next) {
          cur = next;
          rest.splice(j, 1);
          grew = true;
        }
      }
    }
    if (near(cur[0], cur[cur.length - 1]) && cur.length >= 4) loops.push(clean(cur));
  }
  return loops;
}
