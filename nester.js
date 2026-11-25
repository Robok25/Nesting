// Motor de nesting por heurística bottom-left sobre candidatos "tocando" piezas ya colocadas.
// Las piezas se tratan como contornos exteriores (los agujeros no bloquean el acomodo).

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

function collides(cand, bb, items, g) {
  for (const it of items) {
    if (rectGap(bb, it.bb) >= g) continue;
    if (polyDistance(cand, it.poly) < g) return true;
  }
  return false;
}

function firstFreePosition(sh, v, ctx) {
  const { W, H, margin, g } = ctx;
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
      if (collides(translate(v.poly, x, y), bb, sh.items, g)) continue;
      return { x, y };
    }
  }
  return null;
}

function bestPlacement(sh, inst, ctx) {
  let best = null;
  for (const v of inst.variants) {
    const pos = firstFreePosition(sh, v, ctx);
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
    bb: { minX: x, minY: y, maxX: x + v.bb.maxX, maxY: y + v.bb.maxY },
  };
}

// pieces: [{ name, outer, area, qty }]
export async function nest({ pieces, W, H, margin, gap, angles, onProgress }) {
  const ctx = { W, H, margin, g: Math.max(gap, 0.01) };
  const instances = [];
  for (const pc of pieces) {
    const variants = angles.map((a) => {
      const poly = normalize(rotate(pc.outer, a));
      return { angle: a, poly, bb: bbox(poly) };
    });
    for (let k = 0; k < pc.qty; k++) {
      instances.push({ name: pc.name, area: pc.area, variants });
    }
  }
  // Piezas grandes primero: suele mejorar el aprovechamiento.
  instances.sort((a, b) => b.area - a.area);

  const sheets = [];
  const unplaced = [];
  for (let i = 0; i < instances.length; i++) {
    const inst = instances[i];
    let done = false;
    for (const sh of sheets) {
      const pl = bestPlacement(sh, inst, ctx);
      if (pl) {
        sh.items.push(pl);
        done = true;
        break;
      }
    }
    if (!done) {
      const sh = { items: [] };
      const pl = bestPlacement(sh, inst, ctx);
      if (pl) {
        sh.items.push(pl);
        sheets.push(sh);
      } else {
        unplaced.push(inst.name);
      }
    }
    if (onProgress) onProgress(i + 1, instances.length);
    await new Promise((r) => setTimeout(r, 0));
  }
  return { sheets, unplaced, W, H };
}
