// The OVERRIDE city. Pure data and geometry, shared by the server (to validate
// movement and reach) and by every client (to draw and to steer). No DOM here.
//
// Layout: a 5 x 5 grid of plazas joined by streets. The middle plaza is the
// Central Core; the other 24 belong to 8 districts of 3 plazas each. Every plaza
// has a capture ring. Blocks between streets hold buildings.

export const D = 560;            // distance between neighbouring plazas
export const N = 5;              // plazas per side
export const M = 330;            // margin from world origin to the first plaza
export const SIZE = M * 2 + D * (N - 1);
export const SPEED = 320;        // walking speed, world units per second
export const AV_R = 18;          // avatar collision radius
export const RING_R = 105;       // capture ring radius
export const CORE_R = 128;
export const TERM_REACH = 125;   // how close you must be to use a terminal
export const ZONE_PAD = 45;      // extra slack when the server checks you are in a ring
export const BLD_IN = 140;       // buildings start this far from plaza centres
export const BOUND = { x0: M - 230, y0: M - 230, x1: M + D * (N - 1) + 230, y1: M + D * (N - 1) + 230 };

export const nodePos = (gx, gy) => ({ x: M + gx * D, y: M + gy * D });

export const DISTRICTS = [
  { id: 'core', name: 'Central Core', color: '#EEF3FF', icon: 'core', topics: [] },
  { id: 'finance', name: 'Financial District', color: '#5C9DFF', icon: 'vault', topics: ['budget', 'money', 'change'], inner: [1, 1], outer: [[0, 0], [1, 0]] },
  { id: 'market', name: 'Market District', color: '#FF4FD8', icon: 'market', topics: ['shopping', 'money', 'change'], inner: [2, 1], outer: [[2, 0], [3, 0]] },
  { id: 'power', name: 'Power Station', color: '#FFE14A', icon: 'power', topics: ['measure', 'time', 'budget'], inner: [3, 1], outer: [[4, 0], [4, 1]] },
  { id: 'tech', name: 'Tech Lab', color: '#2EE6F5', icon: 'lab', topics: ['measure', 'time', 'work'], inner: [3, 2], outer: [[4, 2], [4, 3]] },
  { id: 'transit', name: 'Transit Hub', color: '#A98BFF', icon: 'transit', topics: ['time', 'work'], inner: [3, 3], outer: [[4, 4], [3, 4]] },
  { id: 'food', name: 'Food District', color: '#FFA63D', icon: 'food', topics: ['cooking', 'shopping', 'measure'], inner: [2, 3], outer: [[2, 4], [1, 4]] },
  { id: 'warehouse', name: 'Warehouse', color: '#3DF5A0', icon: 'warehouse', topics: ['work', 'measure', 'budget'], inner: [1, 3], outer: [[0, 4], [0, 3]] },
  { id: 'media', name: 'Media Tower', color: '#FF6B6B', icon: 'media', topics: ['time', 'work', 'money'], inner: [1, 2], outer: [[0, 2], [0, 1]] },
];
export const districtById = Object.fromEntries(DISTRICTS.map((d) => [d.id, d]));

// [type, name] for inner, outer1, outer2 of each district.
const PLAZAS = {
  finance: [['vault', 'Credit Vault'], ['std', 'Exchange Tower'], ['std', 'Bank Row']],
  market: [['vault', 'Market Square'], ['std', 'Night Market'], ['std', 'Neon Bazaar']],
  power: [['power', 'Power Station'], ['power', 'Solar Farm'], ['std', 'Coolant Plant']],
  tech: [['lab', 'Tech Lab'], ['std', 'Robotics Bay'], ['std', 'Server Farm']],
  transit: [['vault', 'Transit Hub'], ['std', 'Metro Line'], ['std', 'Sky Bridge']],
  food: [['vault', 'Food Court'], ['std', 'Noodle Alley'], ['std', 'Taco Row']],
  warehouse: [['lab', 'Warehouse'], ['std', 'Cargo Bay'], ['std', 'Drone Dock']],
  media: [['lab', 'Media Tower'], ['std', 'Studio Nine'], ['std', 'Signal Yard']],
};
const STD_ICON = { finance: 'data', market: 'market', power: 'warehouse', tech: 'data', transit: 'transit', food: 'food', warehouse: 'warehouse', media: 'media' };

// ---------- plazas (capture zones) ----------
export const NODES = [];
{
  const add = (gx, gy, type, name, district, icon) => NODES.push({ id: NODES.length, gx, gy, ...nodePos(gx, gy), type, name, district, icon });
  add(2, 2, 'core', 'Central Core', 'core', 'core');
  for (const d of DISTRICTS.slice(1)) {
    const spots = [d.inner, ...d.outer];
    PLAZAS[d.id].forEach(([type, name], i) => add(spots[i][0], spots[i][1], type, name, d.id, type === 'std' ? STD_ICON[d.id] : type));
  }
}
const nodeAt = new Map(NODES.map((n) => [`${n.gx},${n.gy}`, n.id]));
export const NBRS = NODES.map((n) => [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dy]) => nodeAt.get(`${n.gx + dx},${n.gy + dy}`)).filter((x) => x !== undefined));
export const ringRadius = (n) => (n.type === 'core' ? CORE_R : RING_R);

// ---------- buildings ----------
const hash = (a, b, s = 0) => { let h = (a * 374761393 + b * 668265263 + s * 2147483647) >>> 0; h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0; return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
const nearestDistrict = (x, y) => {
  let best = null, bd = Infinity;
  for (const d of DISTRICTS.slice(1)) { const p = nodePos(...d.inner); const dd = (p.x - x) ** 2 + (p.y - y) ** 2; if (dd < bd) { bd = dd; best = d.id; } }
  return best;
};
const SIGN_CELL = { '0,0': 'finance', '2,0': 'market', '3,0': 'power', '3,2': 'tech', '3,3': 'transit', '1,3': 'food', '0,3': 'warehouse', '0,1': 'media' };
export const BUILDINGS = [];
export const TREES = [];
{
  for (let i = 0; i < N - 1; i++) for (let j = 0; j < N - 1; j++) {
    const x0 = M + i * D + BLD_IN, x1 = M + (i + 1) * D - BLD_IN, y0 = M + j * D + BLD_IN, y1 = M + (j + 1) * D - BLD_IN;
    const district = nearestDistrict((x0 + x1) / 2, (y0 + y1) / 2);
    const sign = SIGN_CELL[`${i},${j}`] || null;
    const r = hash(i, j), h = Math.round(80 + hash(i, j, 1) * 110);
    const touchesCore = (i === 1 || i === 2) && (j === 1 || j === 2);
    if (touchesCore) {
      // Keep the Core square open: one small building in the far corner, trees elsewhere.
      const fx = i === 1 ? x0 : x1 - 150, fy = j === 1 ? y0 : y1 - 150;
      BUILDINGS.push({ x0: fx, y0: fy, x1: fx + 150, y1: fy + 150, h: 90 + Math.round(r * 40), district, sign: null });
      TREES.push({ x: i === 1 ? x1 - 50 : x0 + 50, y: j === 1 ? y1 - 50 : y0 + 50 });
      continue;
    }
    if (sign || r < 0.45) BUILDINGS.push({ x0, y0, x1, y1, h: sign ? Math.max(h, 140) : h, district, sign });
    else if (r < 0.72) {
      const mid = (x0 + x1) / 2;
      BUILDINGS.push({ x0, y0, x1: mid - 15, y1, h, district, sign: null }, { x0: mid + 15, y0, x1, y1, h: Math.round(60 + hash(i, j, 2) * 90), district, sign: null });
    } else {
      const mid = (y0 + y1) / 2;
      BUILDINGS.push({ x0, y0, x1, y1: mid - 15, h, district, sign: null }, { x0, y0: mid + 15, x1, y1, h: Math.round(60 + hash(i, j, 3) * 90), district, sign: null });
    }
    if (hash(i, j, 4) < 0.6) TREES.push({ x: x1 + 32, y: (y0 + y1) / 2 + (hash(i, j, 5) - 0.5) * 120 });
    if (hash(i, j, 6) < 0.5) TREES.push({ x: (x0 + x1) / 2 + (hash(i, j, 7) - 0.5) * 120, y: y1 + 32 });
  }
}
// Skyline behind the city (never in front of it, so it can't hide anything).
export const SKYLINE = [];
for (let k = 0; k < 9; k++) {
  const w = 150 + hash(k, 9) * 120, h = 260 + hash(k, 10) * 260;
  SKYLINE.push({ x0: BOUND.x0 - 120 - w, y0: BOUND.y0 + k * 320, x1: BOUND.x0 - 120, y1: BOUND.y0 + k * 320 + 240, h });
  SKYLINE.push({ x0: BOUND.x0 + k * 320, y0: BOUND.y0 - 120 - w, x1: BOUND.x0 + k * 320 + 240, y1: BOUND.y0 - 120, h: 240 + hash(k, 11) * 280 });
}

// ---------- terminals ----------
export const TERMINALS = [];
{
  const add = (x, y, district, name) => TERMINALS.push({ id: TERMINALS.length, x, y, district, name, topics: districtById[district].topics });
  const core = nodePos(2, 2);
  for (const d of DISTRICTS.slice(1)) {
    const p = nodePos(...d.inner);
    const sx = Math.sign(p.x - core.x) || 1, sy = Math.sign(p.y - core.y) || 1;
    add(p.x + sx * 100, p.y + sy * 100, d.id, `${d.name.split(' ')[0]} Terminal`);
  }
  add(core.x + 118, core.y - 118, 'core', 'Core Terminal East');
  add(core.x - 118, core.y + 118, 'core', 'Core Terminal West');
}

// ---------- collision ----------
export function blocked(x, y, r = AV_R) {
  if (x < BOUND.x0 + r || y < BOUND.y0 + r || x > BOUND.x1 - r || y > BOUND.y1 - r) return true;
  for (const b of BUILDINGS) if (x > b.x0 - r && x < b.x1 + r && y > b.y0 - r && y < b.y1 + r) return true;
  return false;
}
export const walkable = (x, y) => Number.isFinite(x) && Number.isFinite(y) && !blocked(x, y);

// Move with wall sliding. Returns the new position.
export function slide(x, y, dx, dy) {
  if (!blocked(x + dx, y + dy)) return [x + dx, y + dy];
  if (dx && !blocked(x + dx, y)) return [x + dx, y];
  if (dy && !blocked(x, y + dy)) return [x, y + dy];
  return [x, y];
}

// Is the straight line between two points clear? Exact test (no sampling), so the
// server and the path planner always agree. Used for movement checks and path smoothing.
export function clearLine(ax, ay, bx, by, r = AV_R) {
  if (blocked(ax, ay, r) || blocked(bx, by, r)) return false; // the city edge is convex: both ends inside is enough
  const dx = bx - ax, dy = by - ay;
  for (const b of BUILDINGS) {
    let t0 = 0, t1 = 1, hit = true;
    for (const [p, d, lo, hi] of [[ax, dx, b.x0 - r, b.x1 + r], [ay, dy, b.y0 - r, b.y1 + r]]) {
      if (Math.abs(d) < 1e-9) { if (!(p > lo && p < hi)) { hit = false; break; } continue; }
      let e = (lo - p) / d, x = (hi - p) / d;
      if (e > x) [e, x] = [x, e];
      t0 = Math.max(t0, e); t1 = Math.min(t1, x);
      if (t0 >= t1) { hit = false; break; }
    }
    if (hit) return false;
  }
  return true;
}

export function nearestWalkable(x, y) {
  if (walkable(x, y)) return [x, y];
  for (let r = 10; r < 900; r += 10) for (let a = 0; a < 16; a++) {
    const px = x + Math.cos((a / 16) * Math.PI * 2) * r, py = y + Math.sin((a / 16) * Math.PI * 2) * r;
    if (walkable(px, py)) return [px, py];
  }
  const c = nodePos(2, 2); return [c.x, c.y + 160];
}

// Spawn spots around the Core, spread along the four streets.
export function spawnPoint(k) {
  const c = nodePos(2, 2);
  const dirs = [[0, 1], [1, 0], [0, -1], [-1, 0]];
  const [dx, dy] = dirs[k % 4];
  const along = 175 + (Math.floor(k / 8) % 4) * 52;
  const side = (Math.floor(k / 4) % 2 ? 1 : -1) * 48;
  return nearestWalkable(c.x + dx * along + dy * side, c.y + dy * along + dx * side);
}

export const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
export const nodeAtPoint = (x, y, pad = 0) => NODES.find((n) => Math.hypot(n.x - x, n.y - y) <= ringRadius(n) + pad) || null;
export const terminalNear = (x, y, reach = TERM_REACH) => {
  let best = null, bd = Infinity;
  for (const t of TERMINALS) { const d = Math.hypot(t.x - x, t.y - y); if (d <= reach && d < bd) { bd = d; best = t; } }
  return best;
};
