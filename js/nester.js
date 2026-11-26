// Motor de nesting: heurística bottom-left con índice espacial y posiciones candidatas.
// Se ejecuta por grupo (material + calibre). Las piezas se comparan por su contorno exterior:
// los agujeros no permiten anidar otra pieza (criterio conservador).
const EPS = 1e-9;
// Cuántas piezas recientes se usan como referencia para generar posiciones (equilibrio velocidad/precisión)
const RECENT = 60;

export function bbox(p) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of p) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return { minX, minY, maxX, maxY };
}

export function rotate(p, deg) {
  const r = (deg * Math.PI) / 180;
  const c = Math.cos(r), s = Math.sin(r);
  return p.map(([x, y]) => [x * c - y * s, x * s + y * c]);
}

export function normalize(p) {
  const b = bbox(p);
  return p.map(([x, y]) => [x - b.minX, y - b.minY]);
}

export function centroid(p) {
  const n = p.length;
  return [p.reduce((s, q) => s + q[0], 0) / n, p.reduce((s, q) => s + q[1], 0) / n];
}

function translate(p, dx, dy) {
  return p.map(([x, y]) => [x + dx, y + dy]);
}

function rectGap(a, b) {
  const dx = Math.max(0, b.minX - a.maxX, a.minX - b.maxX);
  const dy = Math.max(0, b.minY - a.maxY, a.minY - b.maxY);
  return Math.hypot(dx, dy);
}

function segInter(a, b, c, d) {
  const o = (p, q, r) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  const o1 = o(a, b, c), o2 = o(a, b, d), o3 = o(c, d, a), o4 = o(c, d, b);
  return o1 * o2 < 0 && o3 * o4 < 0;
}

function segDist(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const L = dx * dx + dy * dy;
  let t = L ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

function inside(pt, poly) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if (yi > pt[1] !== yj > pt[1] && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}

// Distancia mínima entre dos polígonos. Devuelve 0 si se intersectan.
export function polyDistance(A, B) {
  for (let i = 0; i < A.length; i++) {
    const a1 = A[i], a2 = A[(i + 1) % A.length];
    for (let j = 0; j < B.length; j++) {
      if (segInter(a1, a2, B[j], B[(j + 1) % B.length])) return 0;
    }
  }
  if (inside(A[0], B) || inside(B[0], A)) return 0;
  let d = Infinity;
  for (let i = 0; i < A.length; i++) {
    for (const v of B) d = Math.min(d, segDist(v, A[i], A[(i + 1) % A.length]));
  }
  for (let i = 0; i < B.length; i++) {
    for (const v of A) d = Math.min(d, segDist(v, B[i], B[(i + 1) % B.length]));
  }
  return d;
}

// Muestra de vértices para generar posiciones "pegadas" vértice con vértice.
function sampleVerts(poly, max = 6) {
  if (poly.length <= max) return poly;
  const step = poly.length / max;
  const out = [];
  for (let i = 0; i < max; i++) out.push(poly[Math.floor(i * step)]);
  return out;
}

// Variantes (rotaciones) de una pieza para una definición de lámina.
function variantsFor(inst, def) {
  const key = def.id + ':' + def.angles.join(',');
  if (!inst.cache.has(key)) {
    inst.cache.set(
      key,
      def.angles.map((a) => {
        const rot = rotate(inst.outer, a);
        const b = bbox(rot);
        const poly = rot.map(([x, y]) => [x - b.minX, y - b.minY]);
        const holes = inst.holes.map((h) => translate(rotate(h, a), -b.minX, -b.minY));
        return { angle: a, poly, holes, bb: bbox(poly) };
      })
    );
  }
  return inst.cache.get(key);
}

// ---------- Índice espacial de la lámina ----------
function newSheet(def) {
  const cs = Math.max(10, Math.min(def.W, def.H) / 25);
  return {
    def,
    ctx: { W: def.W, H: def.H, margin: def.margin, g: Math.max(def.gap, 0.01) },
    items: [],
    grid: new Map(),
    cs,
    used: 0,
    fail: new Set(), // piezas que ya no caben aquí (las láminas solo se llenan, nunca se vacían)
  };
}

function cellRange(bb, cs) {
  return [Math.floor(bb.minX / cs), Math.floor(bb.maxX / cs), Math.floor(bb.minY / cs), Math.floor(bb.maxY / cs)];
}

function addItem(sh, pl) {
  const idx = sh.items.length;
  sh.items.push(pl);
  sh.used += pl.area;
  const [i0, i1, j0, j1] = cellRange(pl.bb, sh.cs);
  for (let i = i0; i <= i1; i++) {
    for (let j = j0; j <= j1; j++) {
      const key = i * 100003 + j;
      let list = sh.grid.get(key);
      if (!list) { list = []; sh.grid.set(key, list); }
      list.push(idx);
    }
  }
}

function nearItems(sh, bb, g) {
  const [i0, i1, j0, j1] = cellRange(
    { minX: bb.minX - g, maxX: bb.maxX + g, minY: bb.minY - g, maxY: bb.maxY + g },
    sh.cs
  );
  // Marca de visita por índice para no repetir piezas que ocupan varias celdas
  sh.stamp = (sh.stamp || 0) + 1;
  if (!sh.seen || sh.seen.length < sh.items.length) sh.seen = new Int32Array(sh.items.length + 64);
  const out = [];
  for (let i = i0; i <= i1; i++) {
    for (let j = j0; j <= j1; j++) {
      const list = sh.grid.get(i * 100003 + j);
      if (!list) continue;
      for (const idx of list) {
        if (sh.seen[idx] !== sh.stamp) { sh.seen[idx] = sh.stamp; out.push(idx); }
      }
    }
  }
  return out;
}

// ¿Cabe la pieza con su esquina inferior izquierda en (x, y)?
function feasible(sh, v, x, y) {
  const { W, H, margin, g } = sh.ctx;
  if (x < margin - EPS || y < margin - EPS) return false;
  if (x + v.bb.maxX > W - margin + EPS || y + v.bb.maxY > H - margin + EPS) return false;
  const bb = { minX: x, minY: y, maxX: x + v.bb.maxX, maxY: y + v.bb.maxY };
  let cand = null;
  for (const idx of nearItems(sh, bb, g)) {
    const it = sh.items[idx];
    if (rectGap(bb, it.bb) >= g) continue;
    if (!cand) cand = translate(v.poly, x, y);
    if (polyDistance(cand, it.poly) < g) return false;
  }
  return true;
}

const before = (a, b) => a.y < b.y - EPS || (Math.abs(a.y - b.y) < EPS && a.x < b.x);

// Posición más baja (y), luego más a la izquierda (x), que cumple las distancias.
function findPosition(sh, v) {
  const { W, H, margin, g } = sh.ctx;
  const xs = new Set([margin]), ys = new Set([margin]);
  const refs = sh.items.length > RECENT ? sh.items.slice(-RECENT) : sh.items;
  for (const it of refs) {
    const b = it.bb;
    xs.add(b.maxX + g); xs.add(b.minX - v.bb.maxX - g); xs.add(b.minX);
    ys.add(b.maxY + g); ys.add(b.minY - v.bb.maxY - g); ys.add(b.minY);
  }
  const X = [...xs].filter((x) => x >= margin - EPS && x <= W - margin - v.bb.maxX + EPS).sort((a, b) => a - b);
  const Y = [...ys].filter((y) => y >= margin - EPS && y <= H - margin - v.bb.maxY + EPS).sort((a, b) => a - b);

  let best = null;
  outer: for (const y of Y) {
    for (const x of X) {
      if (feasible(sh, v, x, y)) { best = { x, y }; break outer; }
    }
  }

  // Posiciones donde un vértice de la pieza toca un vértice de una pieza colocada
  const pv = sampleVerts(v.poly);
  const vc = [];
  for (const it of refs) {
    for (const [ax, ay] of sampleVerts(it.poly)) {
      for (const [px, py] of pv) {
        const x0 = ax - px, y0 = ay - py;
        vc.push(
          { x: x0 + g, y: y0 }, { x: x0, y: y0 + g }, { x: x0 + g, y: y0 + g },
          { x: x0 - g, y: y0 }, { x: x0, y: y0 - g }
        );
      }
    }
  }
  vc.sort((p, q) => (p.y - q.y) || (p.x - q.x));
  for (const c of vc) {
    if (best && !before(c, best)) break;
    if (feasible(sh, v, c.x, c.y)) { best = { x: c.x, y: c.y }; break; }
  }
  return best;
}

function bestPlacement(sh, inst) {
  let best = null;
  for (const v of variantsFor(inst, sh.def)) {
    const pos = findPosition(sh, v);
    if (!pos) continue;
    if (!best || before(pos, best.pos)) best = { pos, v };
  }
  if (!best) return null;
  const { x, y } = best.pos, v = best.v;
  return {
    name: inst.name,
    area: inst.area,
    angle: v.angle,
    poly: translate(v.poly, x, y),
    holes: v.holes.map((h) => translate(h, x, y)),
    bb: { minX: x, minY: y, maxX: x + v.bb.maxX, maxY: y + v.bb.maxY },
  };
}

// pieces: [{ name, outer, holes, area, qty }]   defs: [{ id, W, H, margin, gap, angles }]
// Devuelve sheets: [{ def, items }] y unplaced: nombres de piezas que no caben.
export async function nestGroup({ pieces, defs, onProgress }) {
  const instances = [];
  for (const pc of pieces) {
    for (let k = 0; k < pc.qty; k++) {
      instances.push({ name: pc.name, area: pc.area, outer: pc.outer, holes: pc.holes || [], cache: new Map() });
    }
  }
  // Piezas grandes primero, sin importar el orden en que se subieron
  instances.sort((a, b) => b.area - a.area);

  const sheets = [];
  const unplaced = [];
  let last = performance.now();
  for (let i = 0; i < instances.length; i++) {
    const inst = instances[i];
    let placed = false;

    for (const sh of sheets) {
      if (sh.fail.has(inst.name)) continue;
      if (inst.area > sh.ctx.W * sh.ctx.H - sh.used) { sh.fail.add(inst.name); continue; }
      const pl = bestPlacement(sh, inst);
      if (pl) { addItem(sh, pl); placed = true; break; }
      sh.fail.add(inst.name);
    }

    if (!placed) {
      for (const def of defs) {
        const sh = newSheet(def);
        const pl = bestPlacement(sh, inst);
        if (pl) { addItem(sh, pl); sheets.push(sh); placed = true; break; }
      }
    }

    if (!placed) unplaced.push(inst.name);
    if (onProgress) onProgress(i + 1, instances.length);
    // Cede el control al navegador para que no se congele
    if (performance.now() - last > 40) {
      await new Promise((r) => setTimeout(r, 0));
      last = performance.now();
    }
  }
  return { sheets: sheets.map((s) => ({ def: s.def, items: s.items })), unplaced };
}
