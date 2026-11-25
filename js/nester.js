// Motor de nesting: heurística bottom-left sobre candidatos que "tocan" piezas ya colocadas.
// Se ejecuta por grupo (material + calibre). Cada grupo usa las láminas definidas para ese grupo.
// Las piezas se tratan por su contorno exterior; los agujeros no bloquean el acomodo.

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

function translate(p, dx, dy) {
  return p.map(([x, y]) => [x + dx, y + dy]);
}

export function centroid(p) {
  const n = p.length;
  return [p.reduce((s, q) => s + q[0], 0) / n, p.reduce((s, q) => s + q[1], 0) / n];
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

function pointInMaterial(pt, shape) {
  return inside(pt, shape.outer) && !(shape.holes || []).some((h) => inside(pt, h));
}

function boundaryLoops(shape) {
  return [shape.outer, ...(shape.holes || [])];
}

function shapesOverlap(A, B) {
  const aLoops = boundaryLoops(A), bLoops = boundaryLoops(B);
  for (const a of aLoops) for (const b of bLoops) {
    for (let i = 0; i < a.length; i++) {
      for (let j = 0; j < b.length; j++) {
        if (segInter(a[i], a[(i + 1) % a.length], b[j], b[(j + 1) % b.length])) return true;
      }
    }
  }
  if (A.outer.some((p) => pointInMaterial(p, B))) return true;
  if (B.outer.some((p) => pointInMaterial(p, A))) return true;
  return false;
}

function boundaryDistance(A, B) {
  let d = Infinity;
  for (const a of boundaryLoops(A)) for (const b of boundaryLoops(B)) {
    for (let i = 0; i < a.length; i++) {
      const a1 = a[i], a2 = a[(i + 1) % a.length];
      for (let j = 0; j < b.length; j++) {
        const b1 = b[j], b2 = b[(j + 1) % b.length];
        d = Math.min(d, segDist(a1, b1, b2), segDist(a2, b1, b2), segDist(b1, a1, a2), segDist(b2, a1, a2));
        if (d === 0) return 0;
      }
    }
  }
  return d;
}

function collides(cand, bb, items, g) {
  for (const it of items) {
    if (rectGap(bb, it.bb) >= g) continue;
    const existing = { outer: it.poly, holes: it.holes || [] };
    if (shapesOverlap(cand, existing) || boundaryDistance(cand, existing) < g) return true;
  }
  return false;
}

// Variantes (rotaciones normalizadas) de una pieza para una definición de lámina.
function variantsFor(inst, def) {
  const key = def.angles.join(',');
  if (!inst.cache.has(key)) {
    inst.cache.set(
      key,
      def.angles.map((a) => {
        const rotatedOuter = rotate(inst.outer, a);
        const bounds = bbox(rotatedOuter);
        const poly = rotatedOuter.map(([x, y]) => [x - bounds.minX, y - bounds.minY]);
        const holes = (inst.holes || []).map((h) =>
          rotate(h, a).map(([x, y]) => [x - bounds.minX, y - bounds.minY])
        );
        return { angle: a, poly, holes, bb: bbox(poly) };
      })
    );
  }
  return inst.cache.get(key);
}

function firstFreePosition(sh, v) {
  const { W, H, margin, g } = sh.ctx;
  const xs = [margin], ys = [margin];
  for (const it of sh.items) {
    xs.push(it.bb.maxX + g);
    ys.push(it.bb.maxY + g);
  }
  const X = [...new Set(xs)].sort((a, b) => a - b);
  const Y = [...new Set(ys)].sort((a, b) => a - b);
  for (const y of Y) {
    for (const x of X) {
      if (x + v.bb.maxX > W - margin || y + v.bb.maxY > H - margin) continue;
      const bb = { minX: x, minY: y, maxX: x + v.bb.maxX, maxY: y + v.bb.maxY };
      const candidate = { outer: translate(v.poly, x, y), holes: v.holes.map((h) => translate(h, x, y)) };
      if (collides(candidate, bb, sh.items, g)) continue;
      return { x, y };
    }
  }
  return null;
}

function bestPlacement(sh, inst) {
  let best = null;
  for (const v of variantsFor(inst, sh.def)) {
    const pos = firstFreePosition(sh, v);
    if (!pos) continue;
    if (!best || pos.y < best.y - 1e-9 || (Math.abs(pos.y - best.y) < 1e-9 && pos.x < best.x)) {
      best = { ...pos, v };
    }
  }
  if (!best) return null;
  const { x, y, v } = best;
  return {
    name: inst.name,
    area: inst.area,
    angle: v.angle,
    poly: translate(v.poly, x, y),
    holes: v.holes.map((h) => translate(h, x, y)),
    bb: { minX: x, minY: y, maxX: x + v.bb.maxX, maxY: y + v.bb.maxY },
  };
}

// pieces: [{ name, outer, area, qty }]   defs: [{ id, W, H, margin, gap, angles }]
// Devuelve sheets: [{ def, items }] y unplaced: [nombres de piezas que no caben].
export async function nestGroup({ pieces, defs, onProgress }) {
  const instances = [];
  for (const pc of pieces) {
    for (let k = 0; k < pc.qty; k++) {
      instances.push({ name: pc.name, area: pc.area, outer: pc.outer, holes: pc.holes || [], cache: new Map() });
    }
  }
  // Piezas grandes primero: normalmente mejora el aprovechamiento.
  instances.sort((a, b) => b.area - a.area);

  const sheets = [];
  const unplaced = [];
  for (let i = 0; i < instances.length; i++) {
    const inst = instances[i];
    let placed = false;

    for (const sh of sheets) {
      const pl = bestPlacement(sh, inst);
      if (pl) {
        sh.items.push(pl);
        placed = true;
        break;
      }
    }

    if (!placed) {
      for (const def of defs) {
        const sh = {
          def,
          ctx: { W: def.W, H: def.H, margin: def.margin, g: Math.max(def.gap, 0.01) },
          items: [],
        };
        const pl = bestPlacement(sh, inst);
        if (pl) {
          sh.items.push(pl);
          sheets.push(sh);
          placed = true;
          break;
        }
      }
    }

    if (!placed) unplaced.push(inst.name);
    if (onProgress) onProgress(i + 1, instances.length);
    await new Promise((r) => setTimeout(r, 0));
  }
  return { sheets, unplaced };
}
