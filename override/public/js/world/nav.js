// Tap-to-move and "go to" pathfinding: A* on a coarse grid, then smoothed into
// straight walkable segments. Pure logic, also usable from Node for tests.
import { BOUND, blocked, clearLine, nearestWalkable } from './city.js';

const CELL = 30;
const W = Math.ceil((BOUND.x1 - BOUND.x0) / CELL), H = Math.ceil((BOUND.y1 - BOUND.y0) / CELL);
let grid = null;
function build() {
  grid = new Uint8Array(W * H);
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) grid[j * W + i] = blocked(BOUND.x0 + (i + 0.5) * CELL, BOUND.y0 + (j + 0.5) * CELL) ? 1 : 0;
}
const toCell = (x, y) => [Math.max(0, Math.min(W - 1, Math.floor((x - BOUND.x0) / CELL))), Math.max(0, Math.min(H - 1, Math.floor((y - BOUND.y0) / CELL)))];
const center = (i, j) => [BOUND.x0 + (i + 0.5) * CELL, BOUND.y0 + (j + 0.5) * CELL];

function nearestOpen(i, j) {
  if (!grid[j * W + i]) return [i, j];
  for (let r = 1; r < 40; r++) for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) {
    if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
    const a = i + di, b = j + dj;
    if (a >= 0 && b >= 0 && a < W && b < H && !grid[b * W + a]) return [a, b];
  }
  return [i, j];
}

// Returns a list of [x, y] waypoints from (sx, sy) to near (tx, ty), or [] if already there.
export function findPath(sx, sy, tx, ty) {
  if (!grid) build();
  [tx, ty] = nearestWalkable(tx, ty);
  if (clearLine(sx, sy, tx, ty)) return [[tx, ty]];
  const [si, sj] = nearestOpen(...toCell(sx, sy)), [ti, tj] = nearestOpen(...toCell(tx, ty));
  const start = sj * W + si, goal = tj * W + ti;
  const g = new Float32Array(W * H).fill(Infinity), from = new Int32Array(W * H).fill(-1), closed = new Uint8Array(W * H);
  const heap = [];
  const push = (k, f) => { heap.push([f, k]); let c = heap.length - 1; while (c > 0) { const p = (c - 1) >> 1; if (heap[p][0] <= heap[c][0]) break; [heap[p], heap[c]] = [heap[c], heap[p]]; c = p; } };
  const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let c = 0; for (;;) { const l = c * 2 + 1, r = l + 1; let m = c; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === c) break; [heap[m], heap[c]] = [heap[c], heap[m]]; c = m; } } return top; };
  const hEst = (i, j) => Math.hypot(i - ti, j - tj);
  g[start] = 0; push(start, hEst(si, sj));
  while (heap.length) {
    const [, k] = pop();
    if (closed[k]) continue;
    if (k === goal) break;
    closed[k] = 1;
    const i = k % W, j = (k / W) | 0;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      if (!di && !dj) continue;
      const a = i + di, b = j + dj;
      if (a < 0 || b < 0 || a >= W || b >= H) continue;
      const n = b * W + a;
      if (grid[n] || closed[n]) continue;
      if (di && dj && (grid[j * W + a] || grid[b * W + i])) continue; // no corner cutting
      const ng = g[k] + (di && dj ? 1.4142 : 1);
      if (ng < g[n]) { g[n] = ng; from[n] = k; push(n, ng + hEst(a, b)); }
    }
  }
  if (from[goal] === -1 && goal !== start) return [[tx, ty]];
  const cells = [];
  for (let k = goal; k !== -1 && k !== start; k = from[k]) cells.push(center(k % W, (k / W) | 0));
  cells.reverse();
  cells.push([tx, ty]);
  // Smooth: skip any waypoint that can be seen directly.
  const out = [];
  let cx = sx, cy = sy, idx = 0;
  while (idx < cells.length) {
    let far = idx;
    for (let k = cells.length - 1; k > idx; k--) if (clearLine(cx, cy, cells[k][0], cells[k][1])) { far = k; break; }
    out.push(cells[far]);
    [cx, cy] = cells[far];
    idx = far + 1;
  }
  return out;
}
