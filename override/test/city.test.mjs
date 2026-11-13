// The shared city: geometry, reachability and the movement rules the server enforces.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as C from '../public/js/world/city.js';
import { findPath } from '../public/js/world/nav.js';

test('every zone, terminal and spawn point is open ground', () => {
  for (const n of C.NODES) assert.ok(C.walkable(n.x, n.y), n.name);
  for (const t of C.TERMINALS) { assert.ok(C.walkable(t.x, t.y), t.name); assert.equal(C.nodeAtPoint(t.x, t.y), null, `${t.name} sits outside rings`); }
  for (let k = 0; k < 30; k++) assert.ok(C.walkable(...C.spawnPoint(k)));
  assert.equal(C.TERMINALS.length, 10);
  assert.ok(C.DISTRICTS.slice(1).every((d) => C.TERMINALS.some((t) => t.district === d.id)), 'a terminal in every district');
});

test('every zone and terminal can be reached by a clear path from every spawn', () => {
  for (const k of [0, 5, 13, 29]) {
    const [sx, sy] = C.spawnPoint(k);
    for (const t of [...C.NODES, ...C.TERMINALS]) {
      const path = findPath(sx, sy, t.x, t.y);
      let [cx, cy] = [sx, sy];
      for (const [x, y] of path) { assert.ok(C.clearLine(cx, cy, x, y), `blocked leg to ${t.name}`); [cx, cy] = [x, y]; }
      assert.ok(Math.hypot(cx - t.x, cy - t.y) < 2, `reaches ${t.name}`);
    }
  }
});

test('walls hold: sliding never enters a building and lines through buildings are refused', () => {
  const b = C.BUILDINGS[0];
  const mx = (b.x0 + b.x1) / 2;
  assert.equal(C.walkable(mx, (b.y0 + b.y1) / 2), false);
  let [x, y] = [mx, b.y0 - 60];
  for (let i = 0; i < 200; i++) [x, y] = C.slide(x, y, 0, 5);
  assert.ok(C.walkable(x, y) && y < b.y0, 'stopped at the wall');
  assert.equal(C.clearLine(mx, b.y0 - 60, mx, b.y1 + 60), false);
  assert.equal(C.walkable(C.BOUND.x0 - 5, C.BOUND.y0 + 300), false, 'edge of the city');
});
