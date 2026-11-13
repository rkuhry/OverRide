// A headless player for bots and tests. It moves exactly like a real client:
// along a path, at walking speed, sending its position 10 times a second.
import * as CITY from '../public/js/world/city.js';
import { findPath } from '../public/js/world/nav.js';

export class Walker {
  constructor(send) { this.send = send; this.x = 0; this.y = 0; this.path = null; this.timer = null; this.resolve = null; }
  place(x, y) { this.x = x; this.y = y; }
  // The server snapped us back: plan again from where it says we are.
  correct(x, y) { this.x = x; this.y = y; if (this.path && this.path.length) { const [tx, ty] = this.path[this.path.length - 1]; this.path = findPath(x, y, tx, ty); } }
  // Walk to (x, y). Resolves when there. speedFactor < 1 walks slower than the limit.
  walkTo(x, y, speedFactor = 0.95) {
    this.stop();
    this.path = findPath(this.x, this.y, x, y);
    return new Promise((resolve) => {
      this.resolve = resolve;
      this.timer = setInterval(() => {
        let budget = CITY.SPEED * 0.1 * speedFactor;
        while (budget > 0 && this.path && this.path.length) {
          const [tx, ty] = this.path[0];
          const d = Math.hypot(tx - this.x, ty - this.y);
          if (d <= budget) { this.x = tx; this.y = ty; budget -= d; this.path.shift(); }
          else { this.x += ((tx - this.x) / d) * budget; this.y += ((ty - this.y) / d) * budget; budget = 0; }
        }
        this.send({ t: 'mv', x: Math.round(this.x * 10) / 10, y: Math.round(this.y * 10) / 10 });
        if (!this.path || !this.path.length) { const r = this.resolve; this.stop(); r && r(); }
      }, 100);
    });
  }
  stop() { clearInterval(this.timer); this.timer = null; this.path = null; this.resolve = null; }
  // Spots just outside a terminal and in the middle of a ring.
  static terminalSpot(t) { const c = CITY.NODES[0]; return [t.x + Math.sign(c.x - t.x) * 30, t.y + Math.sign(c.y - t.y) * 30]; }
  static ringSpot(n) { return [n.x, n.y + 15]; }
}
export { CITY };
