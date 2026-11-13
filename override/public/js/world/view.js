// The city renderer: one <canvas>, isometric 2.5D, drawn every frame.
// Shared by the student game (follow camera) and the teacher's live view (whole city).
import * as C from './city.js';
import { avatarFrame, SPR_W, SPR_H } from './sprites.js';

const K = 0.7071;
const FONT = '"Avenir Next Condensed","Bahnschrift","DIN Condensed","Roboto Condensed","Arial Narrow",sans-serif';
export const iso = (x, y, z = 0) => [(x - y) * K, (x + y) * K * 0.5 - z];
const unIso = (sx, sy) => { const a = sx / K, b = (2 * sy) / K; return [(a + b) / 2, (b - a) / 2]; };
const lerp = (a, b, t) => a + (b - a) * t;
const ease = (t) => 1 - (1 - t) ** 3;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rgba = (hex, a) => { const n = parseInt(hex.slice(1), 16); return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`; };
const DCOL = Object.fromEntries(C.DISTRICTS.map((d) => [d.id, d.color]));
const TERM_GLYPH = { finance: '$', market: '$', power: '⚡', tech: '⌚', transit: '⌚', food: '⚖', warehouse: '⚖', media: '⌚', core: '◆' };
const AV_SCALE = 1.05;
const TYPE_TAG = { core: '3 PTS', vault: '2 PTS', lab: '+1 DEF', power: '+1 CHARGE', std: '1 PT' };

export class CityView {
  constructor(canvas, { mode = 'player', onTap = null, reduced = false } = {}) {
    this.cv = canvas; this.g = canvas.getContext('2d');
    this.mode = mode; this.onTap = onTap; this.reduced = reduced;
    this.players = new Map();
    this.selfId = null; this.self = null; // { x, y } driven by the game each frame
    this.state = { own: [], lvl: [], hot: [], sides: new Map(), mySide: null, plan: [], phase: 'lobby', used: [], names: true, missionsLeft: 0 };
    this.cam = { x: 0, y: 0, z: 1 }; this.overview = mode !== 'player'; this.userZoom = 1;
    this.fx = []; this.path = null; this.target = null;
    this.onFrame = null; this.time = 0; this.running = false;
    this.resize();
    new ResizeObserver(() => this.resize()).observe(canvas);
    this.bindInput();
    const c = C.nodePos(2, 2); const [sx, sy] = iso(c.x, c.y); this.cam.x = sx; this.cam.y = sy;
  }

  // ---------- data in ----------
  setPlayers(list) {
    const seen = new Set();
    for (const p of list) {
      seen.add(p.id);
      const cur = this.players.get(p.id) || { snaps: [], x: null, y: null, back: false, frame: -1, walk: 0 };
      this.players.set(p.id, Object.assign(cur, { id: p.id, name: p.name, tag: p.tag, color: p.color, avatar: p.avatar, on: p.on }));
    }
    for (const id of [...this.players.keys()]) if (!seen.has(id)) this.players.delete(id);
  }
  positions(arr) {
    const now = performance.now();
    for (const [id, x, y, busy] of arr) {
      const p = this.players.get(id) || { id, snaps: [], name: '', color: '#888', avatar: {}, on: true, back: false, frame: -1, walk: 0 };
      if (!this.players.has(id)) this.players.set(id, p);
      p.busy = !!busy;
      p.snaps.push({ t: now, x, y });
      if (p.snaps.length > 12) p.snaps.shift();
      if (p.x === null || p.x === undefined || Math.hypot(p.x - x, p.y - y) > 600) { p.x = x; p.y = y; p.snaps = [{ t: now, x, y }]; }
    }
  }
  setState(patch) { Object.assign(this.state, patch); }

  // ---------- camera ----------
  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, this.reduced ? 1.25 : 2);
    const w = this.cv.clientWidth || 800, h = this.cv.clientHeight || 600;
    this.w = w; this.h = h; this.dpr = dpr;
    this.cv.width = Math.round(w * dpr); this.cv.height = Math.round(h * dpr);
  }
  followZoom() { return Math.max(0.55, Math.min(1.4, Math.min(this.w / 1120, this.h / 780))) * this.userZoom; }
  overviewCam() {
    const b = C.BOUND;
    const [lx] = iso(b.x0, b.y1), [rx] = iso(b.x1, b.y0), [, ty] = iso(b.x0, b.y0, 260), [, by] = iso(b.x1, b.y1);
    const z = Math.min(this.w / (rx - lx + 40), this.h / (by - ty + 40));
    return { x: (lx + rx) / 2, y: (ty + by) / 2 + 20, z };
  }
  toScreen(x, y, z = 0) { const [sx, sy] = iso(x, y, z); return [(sx - this.cam.x) * this.cam.z + this.w / 2, (sy - this.cam.y) * this.cam.z + this.h / 2]; }
  toWorld(px, py) { return unIso((px - this.w / 2) / this.cam.z + this.cam.x, (py - this.h / 2) / this.cam.z + this.cam.y); }

  // ---------- input ----------
  bindInput() {
    let down = null;
    this.cv.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY, t: performance.now() }; });
    this.cv.addEventListener('pointerup', (e) => {
      if (!down || !this.onTap) return;
      const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y), dt = performance.now() - down.t;
      down = null;
      if (moved > 18 || dt > 900) return;
      const r = this.cv.getBoundingClientRect();
      this.onTap(this.hit(e.clientX - r.left, e.clientY - r.top));
    });
  }
  hit(px, py) {
    const [x, y] = this.toWorld(px, py);
    let term = null, bd = 70;
    for (const t of C.TERMINALS) {
      const [sx, sy] = this.toScreen(t.x, t.y, 34);
      const d = Math.hypot(sx - px, sy - py) / this.cam.z;
      if (d < bd) { bd = d; term = t; }
    }
    return { x, y, term, node: C.nodeAtPoint(x, y, 10) };
  }

  // ---------- effects ----------
  burst(h, color, big = false) { const n = C.NODES[h]; this.fx.push({ k: 'ring', x: n.x, y: n.y, r: C.ringRadius(n), color, t: 0, d: big ? 1.4 : 0.9, big }); }
  float(h, text, color) { const n = C.NODES[h]; this.fx.push({ k: 'text', x: n.x, y: n.y, text, color, t: 0, d: 1.8 }); }
  pulseAt(x, y, color = '#FFFFFF') { this.fx.push({ k: 'dot', x, y, color, t: 0, d: 0.6 }); }

  async playResolve(res, onEvent) {
    const was = this.overview;
    this.overview = true;
    const own = [...res.before.own], lvl = [...res.before.lvl];
    const jammed = [], surged = [];
    this.state = { ...this.state, own, lvl, jammed, surged, plan: [] };
    await sleep(900);
    const per = Math.max(420, Math.min(1000, 11000 / Math.max(1, res.events.length)));
    for (const e of res.events) {
      if (e.k === 'capture' || e.k === 'override') own[e.h] = e.side;
      if (e.k === 'jam') jammed.push(e.h);
      if (e.k === 'surge') surged.push(e.h);
      lvl[e.h] = res.after.lvl[e.h];
      const color = this.state.sides.get(e.side)?.color || '#EEF3FF';
      this.burst(e.h, color, e.k === 'override');
      this.float(e.h, { capture: e.from ? 'TAKEN' : 'CLAIMED', reinforce: 'REINFORCED', hold: 'HELD', blocked: 'SHIELDED', override: 'OVERRIDE', jam: 'JAMMED', surge: '×2 SURGE' }[e.k], color);
      const wait = onEvent ? await onEvent(e) : 0;
      await sleep(wait || per);
    }
    this.state = { ...this.state, own: res.after.own, lvl: res.after.lvl, jammed: res.jammed, surged: res.surged };
    await sleep(600);
    this.overview = was;
  }

  // ---------- loop ----------
  start() {
    if (this.running) return;
    this.running = true;
    let last = performance.now();
    const tick = (now) => {
      if (!this.running) return;
      const dt = Math.min(0.05, (now - last) / 1000); last = now;
      this.time += dt;
      if (this.onFrame) this.onFrame(dt);
      this.step(dt, now);
      this.draw();
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }
  stop() { this.running = false; }

  step(dt, now) {
    const renderT = now - 130;
    for (const p of this.players.values()) {
      if (p.id === this.selfId && this.self) { p.vx = this.self.x - (p.x ?? this.self.x); p.vy = this.self.y - (p.y ?? this.self.y); p.x = this.self.x; p.y = this.self.y; }
      else if (p.snaps.length) {
        const s = p.snaps; let a = s[0], b = s[s.length - 1];
        for (let i = s.length - 1; i > 0; i--) if (s[i - 1].t <= renderT) { a = s[i - 1]; b = s[i]; break; }
        const t = b.t === a.t ? 1 : Math.max(0, Math.min(1, (renderT - a.t) / (b.t - a.t)));
        const nx = lerp(a.x, b.x, t), ny = lerp(a.y, b.y, t);
        p.vx = nx - (p.x ?? nx); p.vy = ny - (p.y ?? ny); p.x = nx; p.y = ny;
      }
      const sp = Math.hypot(p.vx || 0, p.vy || 0) / Math.max(dt, 0.001);
      if (sp > 30) {
        p.walk += dt * 9;
        p.frame = Math.floor(p.walk) % 4;
        const svy = (p.vx + p.vy) * 0.5, svx = p.vx - p.vy;
        if (Math.abs(svy) > Math.abs(svx) * 0.25) p.back = svy < 0;
      } else p.frame = -1;
    }
    const goal = this.overview ? this.overviewCam() : (() => {
      const me = this.self || (this.selfId && this.players.get(this.selfId)) || C.nodePos(2, 2);
      const [sx, sy] = iso(me.x, me.y, 40); return { x: sx, y: sy, z: this.followZoom() };
    })();
    const k = this.reduced ? 1 : 1 - Math.pow(0.002, dt);
    this.cam.x = lerp(this.cam.x, goal.x, k); this.cam.y = lerp(this.cam.y, goal.y, k); this.cam.z = lerp(this.cam.z, goal.z, k);
    for (const f of this.fx) f.t += dt;
    this.fx = this.fx.filter((f) => f.t < f.d);
  }

  // ---------- drawing ----------
  poly(pts, fill, stroke, lw) {
    const g = this.g; g.beginPath();
    pts.forEach(([x, y, z], i) => { const [sx, sy] = this.toScreen(x, y, z); i ? g.lineTo(sx, sy) : g.moveTo(sx, sy); });
    g.closePath();
    if (fill) { g.fillStyle = fill; g.fill(); }
    if (stroke) { g.strokeStyle = stroke; g.lineWidth = lw; g.stroke(); }
  }
  ellipse(x, y, r, z = 0) { const [sx, sy] = this.toScreen(x, y, z); this.g.beginPath(); this.g.ellipse(sx, sy, r * this.cam.z, r * this.cam.z * 0.5, 0, 0, Math.PI * 2); }

  draw() {
    const g = this.g, z = this.cam.z, st = this.state, T = this.time;
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.fillStyle = '#070B1C'; g.fillRect(0, 0, this.w, this.h);
    const b = C.BOUND;

    for (const s of C.SKYLINE) this.box(s, '#0C1230', '#0A0F28', '#101838', null, 0.55);

    // ground
    this.poly([[b.x0, b.y0], [b.x1, b.y0], [b.x1, b.y1], [b.x0, b.y1]], '#0D1430', '#2A3A6B', 2 * z);
    for (let i = 0; i < C.N - 1; i++) for (let j = 0; j < C.N - 1; j++) {
      const x0 = C.M + i * C.D + 72, y0 = C.M + j * C.D + 72, x1 = C.M + (i + 1) * C.D - 72, y1 = C.M + (j + 1) * C.D - 72;
      this.poly([[x0, y0], [x1, y0], [x1, y1], [x0, y1]], '#141C3C', 'rgba(46,230,245,.10)', 1.5 * z);
    }
    g.setLineDash([18 * z, 16 * z]); g.strokeStyle = 'rgba(46,230,245,.18)'; g.lineWidth = 2.5 * z;
    for (let i = 0; i < C.N; i++) {
      const a = C.nodePos(i, 0), c = C.nodePos(i, C.N - 1), d = C.nodePos(0, i), e = C.nodePos(C.N - 1, i);
      g.beginPath(); g.moveTo(...this.toScreen(a.x, a.y)); g.lineTo(...this.toScreen(c.x, c.y)); g.moveTo(...this.toScreen(d.x, d.y)); g.lineTo(...this.toScreen(e.x, e.y)); g.stroke();
    }
    g.setLineDash([]);
    // plazas
    for (const n of C.NODES) {
      const col = DCOL[n.district];
      this.ellipse(n.x, n.y, C.ringRadius(n) + 34); g.fillStyle = '#18224A'; g.fill();
      g.strokeStyle = rgba(col, 0.25); g.lineWidth = 2 * z; g.stroke();
    }
    // capture rings
    const inRing = this.self ? C.nodeAtPoint(this.self.x, this.self.y) : null;
    const ringsLive = st.phase === 'control';
    for (const n of C.NODES) {
      const owner = st.own[n.id], side = owner ? st.sides.get(owner) : null, col = side ? side.color : '#7F93C9';
      const r = C.ringRadius(n);
      this.ellipse(n.x, n.y, r);
      g.fillStyle = side ? rgba(col, (st.jammed || []).includes(n.id) ? 0.06 : owner === st.mySide ? 0.34 : 0.22) : 'rgba(127,147,201,.06)'; g.fill();
      g.lineWidth = (side ? 6 : 3.5) * z; g.strokeStyle = side ? col : 'rgba(127,147,201,.55)';
      if ((st.jammed || []).includes(n.id)) g.setLineDash([6 * z, 9 * z]);
      g.stroke(); g.setLineDash([]);
      this.ellipse(n.x, n.y, r - 16); g.lineWidth = 1.5 * z; g.strokeStyle = side ? rgba(col, 0.6) : 'rgba(127,147,201,.25)'; g.stroke();
      if (ringsLive && !this.reduced) { const p = (T * 0.7 + n.id * 0.13) % 1; this.ellipse(n.x, n.y, r * (0.3 + p * 0.7)); g.lineWidth = 2 * z; g.strokeStyle = rgba(side ? col : '#2EE6F5', 0.35 * (1 - p)); g.stroke(); }
      if (st.hot.includes(n.id)) { this.ellipse(n.x, n.y, r + 18); g.setLineDash([12 * z, 9 * z]); g.lineDashOffset = -T * 30 * z; g.lineWidth = 4 * z; g.strokeStyle = '#FFE14A'; g.stroke(); g.setLineDash([]); g.lineDashOffset = 0; }
      if (inRing === n && this.mode === 'player') { this.ellipse(n.x, n.y, r + 6); g.lineWidth = 3 * z; g.strokeStyle = '#FFFFFF'; g.stroke(); }
    }
    // terminal floor glow
    const termsLive = st.phase === 'build' && st.missionsLeft > 0;
    for (const t of C.TERMINALS) {
      const used = st.used.includes(t.id), live = termsLive && !used;
      this.ellipse(t.x, t.y, live ? 46 + Math.sin(T * 3) * 4 : 34);
      g.fillStyle = live ? 'rgba(46,230,245,.20)' : 'rgba(46,230,245,.05)'; g.fill();
      g.lineWidth = (live ? 3 : 1.5) * z; g.strokeStyle = live ? '#2EE6F5' : 'rgba(46,230,245,.3)'; g.stroke();
    }
    // tap-to-move path
    if (this.path && this.self) {
      g.fillStyle = 'rgba(255,255,255,.55)';
      let [px, py] = [this.self.x, this.self.y];
      for (const [qx, qy] of this.path) {
        const L = Math.hypot(qx - px, qy - py);
        for (let d = 30; d < L; d += 42) { const [sx, sy] = this.toScreen(px + ((qx - px) * d) / L, py + ((qy - py) * d) / L); g.beginPath(); g.arc(sx, sy, 3.5 * z, 0, Math.PI * 2); g.fill(); }
        [px, py] = [qx, qy];
      }
      const [lx, ly] = this.path[this.path.length - 1];
      this.ellipse(lx, ly, 20 + Math.sin(T * 5) * 3); g.lineWidth = 3 * z; g.strokeStyle = '#FFFFFF'; g.stroke();
    }

    // depth-sorted things
    const items = [];
    for (const bd of C.BUILDINGS) items.push({ k: (bd.x0 + bd.x1 + bd.y0 + bd.y1) / 2, b: bd });
    for (const t of C.TREES) items.push({ k: t.x + t.y, tree: t });
    for (const t of C.TERMINALS) items.push({ k: t.x + t.y + 1, term: t });
    const core = C.NODES[0]; items.push({ k: core.x + core.y - 1, core: true });
    for (const p of this.players.values()) if (p.x !== null && p.x !== undefined) items.push({ k: p.x + p.y + 2, p });
    items.sort((a, b2) => a.k - b2.k);
    const me = this.selfId && this.players.get(this.selfId);
    const meS = me && me.x !== null ? this.toScreen(me.x, me.y) : null;
    let meDrawn = false;
    for (const it of items) {
      if (it.b) {
        const bd = it.b;
        let alpha = 1;
        if (meDrawn && meS) { const [lx] = this.toScreen(bd.x0, bd.y1), [rx] = this.toScreen(bd.x1, bd.y0), [, ty] = this.toScreen(bd.x0, bd.y0, bd.h), [, by] = this.toScreen(bd.x1, bd.y1); if (meS[0] > lx && meS[0] < rx && meS[1] - 60 * z < by && meS[1] > ty) alpha = 0.38; }
        this.box(bd, '#1C2852', '#111A38', '#172148', DCOL[bd.district], alpha);
      } else if (it.tree) this.tree(it.tree);
      else if (it.term) this.terminal(it.term, termsLive && !st.used.includes(it.term.id));
      else if (it.core) this.coreBeacon(core);
      else if (it.p) { this.avatar(it.p); if (it.p === me) meDrawn = true; }
    }
    if (me && me.x !== null) { g.globalAlpha = 0.35; this.avatar(me, true); g.globalAlpha = 1; }
    // holographic ring outlines above everything, so a zone behind a building never disappears
    g.setLineDash([10 * z, 10 * z]);
    for (const n of C.NODES) {
      const owner = st.own[n.id], side = owner ? st.sides.get(owner) : null;
      this.ellipse(n.x, n.y, C.ringRadius(n)); g.lineWidth = 2 * z; g.strokeStyle = side ? rgba(side.color, 0.4) : 'rgba(127,147,201,.22)'; g.stroke();
    }
    g.setLineDash([]);

    // effects
    for (const f of this.fx) {
      const t = f.t / f.d;
      if (f.k === 'ring') { this.ellipse(f.x, f.y, f.r * (1 + ease(t) * (f.big ? 1.8 : 0.9))); g.lineWidth = (f.big ? 12 : 7) * z * (1 - t); g.strokeStyle = rgba(f.color, 1 - t); g.stroke(); if (t < 0.4) { this.ellipse(f.x, f.y, f.r); g.fillStyle = rgba(f.color, 0.5 * (1 - t / 0.4)); g.fill(); } }
      if (f.k === 'dot') { this.ellipse(f.x, f.y, 10 + t * 30); g.lineWidth = 3 * z; g.strokeStyle = rgba(f.color, 1 - t); g.stroke(); }
      if (f.k === 'text') {
        const [sx, sy] = this.toScreen(f.x, f.y, 90 + ease(t) * 70);
        g.globalAlpha = t > 0.75 ? (1 - t) / 0.25 : 1;
        g.font = `800 ${Math.round(Math.max(16, 30 * z))}px ${FONT}`; g.textAlign = 'center';
        g.lineWidth = 6; g.strokeStyle = '#070B1C'; g.strokeText(f.text, sx, sy); g.fillStyle = f.color; g.fillText(f.text, sx, sy);
        g.globalAlpha = 1;
      }
    }

    // screen-space labels: ring chips, district signs, names
    this.labels(inRing);
  }

  box(b, top, left, right, trim, alpha) {
    const g = this.g, z = this.cam.z;
    g.globalAlpha = alpha;
    const { x0, y0, x1, y1, h } = b;
    this.poly([[x0, y1, 0], [x1, y1, 0], [x1, y1, h], [x0, y1, h]], left);
    this.poly([[x1, y0, 0], [x1, y1, 0], [x1, y1, h], [x1, y0, h]], right);
    this.poly([[x0, y0, h], [x1, y0, h], [x1, y1, h], [x0, y1, h]], top, trim ? rgba(trim, 0.85) : null, 2 * z);
    if (trim) {
      if (!this.reduced && z > 0.42) {
        g.setLineDash([9 * z, 7 * z]); g.lineWidth = 5 * z; g.strokeStyle = rgba(trim, 0.32);
        for (let k = 40; k < h - 14; k += 28) {
          g.beginPath(); g.moveTo(...this.toScreen(x0 + 12, y1, k)); g.lineTo(...this.toScreen(x1 - 12, y1, k));
          g.moveTo(...this.toScreen(x1, y0 + 12, k)); g.lineTo(...this.toScreen(x1, y1 - 12, k)); g.stroke();
        }
        g.setLineDash([]);
      }
      this.poly([[x0 + 10, y1, 4], [x1 - 10, y1, 4], [x1 - 10, y1, 26], [x0 + 10, y1, 26]], rgba(trim, 0.22));
      this.poly([[x1, y0 + 10, 4], [x1, y1 - 10, 4], [x1, y1 - 10, 26], [x1, y0 + 10, 26]], rgba(trim, 0.22));
      g.lineWidth = 2.5 * z; g.strokeStyle = rgba(trim, 0.9);
      g.beginPath(); g.moveTo(...this.toScreen(x0, y1, h)); g.lineTo(...this.toScreen(x1, y1, h)); g.lineTo(...this.toScreen(x1, y0, h)); g.stroke();
    }
    g.globalAlpha = 1;
  }

  tree(t) {
    const g = this.g, z = this.cam.z;
    this.ellipse(t.x, t.y, 22); g.fillStyle = 'rgba(0,0,0,.35)'; g.fill();
    const [bx, by] = this.toScreen(t.x, t.y), [tx, ty] = this.toScreen(t.x, t.y, 44);
    g.strokeStyle = '#3A2E4A'; g.lineWidth = 5 * z; g.beginPath(); g.moveTo(bx, by); g.lineTo(tx, ty); g.stroke();
    for (const [dx, dy, r, c] of [[-12, 6, 20, '#8E3FD0'], [12, 4, 19, '#B44FE0'], [0, -12, 22, '#D46AF0']]) { g.fillStyle = c; g.beginPath(); g.arc(tx + dx * z, ty + dy * z, r * z, 0, Math.PI * 2); g.fill(); }
  }

  terminal(t, live) {
    const g = this.g, z = this.cam.z, s = 15;
    const col = live ? '#2EE6F5' : '#4C5E92';
    this.box({ x0: t.x - s, y0: t.y - s, x1: t.x + s, y1: t.y + s, h: 62 }, '#22305E', '#141C3C', '#1A2550', null, 1);
    this.poly([[t.x + s, t.y - s + 4, 26], [t.x + s, t.y + s - 4, 26], [t.x + s, t.y + s - 4, 56], [t.x + s, t.y - s + 4, 56]], live ? 'rgba(46,230,245,.85)' : 'rgba(76,94,146,.6)');
    this.poly([[t.x - s + 4, t.y + s, 26], [t.x + s - 4, t.y + s, 26], [t.x + s - 4, t.y + s, 56], [t.x - s + 4, t.y + s, 56]], live ? 'rgba(46,230,245,.6)' : 'rgba(76,94,146,.45)');
    const bob = live && !this.reduced ? Math.sin(this.time * 2.5 + t.id) * 6 : 0;
    const [sx, sy] = this.toScreen(t.x, t.y, 98 + bob);
    g.font = `800 ${Math.round(30 * z)}px ${FONT}`; g.textAlign = 'center';
    g.fillStyle = col; g.fillText(TERM_GLYPH[t.district] || '$', sx, sy);
    if (this.state.used.includes(t.id) && this.mode === 'player') { g.fillStyle = '#3DF5A0'; g.font = `800 ${Math.round(22 * z)}px ${FONT}`; g.fillText('✓', sx + 20 * z, sy - 14 * z); }
  }

  coreBeacon(n) {
    const g = this.g, z = this.cam.z;
    const [bx, by] = this.toScreen(n.x, n.y), [tx, ty] = this.toScreen(n.x, n.y, 230);
    const grad = g.createLinearGradient(bx, by, tx, ty);
    grad.addColorStop(0, 'rgba(46,230,245,.45)'); grad.addColorStop(1, 'rgba(255,79,216,0)');
    g.fillStyle = grad; g.fillRect(bx - 16 * z, ty, 32 * z, by - ty);
    const owner = this.state.own[0], col = owner ? this.state.sides.get(owner)?.color || '#EEF3FF' : '#2EE6F5';
    const s = 26 * z, rot = this.reduced ? 0 : this.time * 0.8, cy = ty + 40 * z;
    g.save(); g.translate(tx, cy); g.scale(Math.cos(rot) || 0.01, 1);
    g.beginPath(); g.moveTo(0, -s); g.lineTo(s, 0); g.lineTo(0, s); g.lineTo(-s, 0); g.closePath();
    g.fillStyle = rgba(col, 0.35); g.fill(); g.lineWidth = 3 * z; g.strokeStyle = col; g.stroke(); g.restore();
  }

  avatar(p, ghost = false) {
    const g = this.g, z = this.cam.z;
    const [sx, sy] = this.toScreen(p.x, p.y);
    if (!ghost) {
      g.globalAlpha = p.on === false ? 0.35 : 1;
      this.ellipse(p.x, p.y, 20); g.fillStyle = 'rgba(0,0,0,.45)'; g.fill();
      if (p.id === this.selfId) { this.ellipse(p.x, p.y, 30 + (this.reduced ? 0 : Math.sin(this.time * 4) * 3)); g.lineWidth = 3 * z; g.strokeStyle = '#FFFFFF'; g.stroke(); }
      else { this.ellipse(p.x, p.y, 24); g.lineWidth = 3 * z; g.strokeStyle = p.color; g.stroke(); }
    }
    const img = avatarFrame(p.avatar || {}, p.color, p.back, p.on === false ? -1 : p.frame);
    const s = AV_SCALE * z * (this.overview ? 1.45 : 1);
    g.drawImage(img, sx - (SPR_W / 2) * s, sy - (SPR_H - 6) * s, SPR_W * s, SPR_H * s);
    if (!ghost) g.globalAlpha = 1;
  }

  labels(inRing) {
    const g = this.g, z = this.cam.z, st = this.state;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    const pill = (cx, cy, text, { bg = 'rgba(7,11,28,.86)', fg = '#EEF3FF', border = null, size = 14, pad = 9 } = {}) => {
      g.font = `700 ${size}px ${FONT}`;
      const w = g.measureText(text).width + pad * 2, h = size + 10;
      g.fillStyle = bg; g.beginPath(); g.roundRect ? g.roundRect(cx - w / 2, cy - h / 2, w, h, 5) : g.rect(cx - w / 2, cy - h / 2, w, h); g.fill();
      if (border) { g.lineWidth = 2; g.strokeStyle = border; g.stroke(); }
      g.fillStyle = fg; g.fillText(text, cx, cy + 1);
      return w;
    };
    // district signs on rooftops
    for (const bd of C.BUILDINGS) {
      if (!bd.sign || (this.mode !== 'player' && z < 0.3)) continue;
      const d = C.districtById[bd.sign];
      const [sx, sy] = this.toScreen((bd.x0 + bd.x1) / 2, (bd.y0 + bd.y1) / 2, bd.h + 34);
      g.globalAlpha = 0.95;
      pill(sx, sy, d.name.toUpperCase(), { fg: d.color, border: d.color, size: Math.round(Math.max(12, 24 * z)), pad: 12 });
      g.globalAlpha = 1;
    }
    // ring chips
    const me = this.self;
    const plan = new Map();
    for (const a of st.plan || []) { if (!plan.has(a.hex)) plan.set(a.hex, { power: 0, tags: [] }); const e = plan.get(a.hex); if (a.type === 'power') e.power += 1; else e.tags.push(a.type.toUpperCase()); }
    for (const n of C.NODES) {
      const owner = st.own[n.id], side = owner ? st.sides.get(owner) : null;
      const near = this.mode === 'player' && me && Math.hypot(me.x - n.x, me.y - n.y) < 420;
      const [sx, sy] = this.toScreen(n.x, n.y, 0);
      const cy = sy + (C.ringRadius(n) * 0.5 + 16) * z;
      const lvl = st.lvl[n.id] || 0;
      const parts = [side ? side.tag || side.name : 'OPEN', lvl ? '▮'.repeat(lvl) + '▯'.repeat(3 - lvl) : ''];
      const close = near || inRing === n;
      if (!side && !close) { /* keep the streets clean: open rings far away get no label */ }
      else {
      const text = close ? `${n.name.toUpperCase()}  ·  ${TYPE_TAG[n.type]}${side ? `  ·  ${parts.filter(Boolean).join(' ')}` : ''}` : parts.filter(Boolean).join(' ');
      const size = Math.round(Math.max(11, (near ? 16 : 13) * Math.min(1.2, z * 1.1)));
      pill(sx, cy, text, { border: side ? side.color : 'rgba(127,147,201,.5)', fg: side ? side.color : '#C6D2F2', size });
      }
      if (st.hot.includes(n.id)) pill(sx + (C.ringRadius(n) * 0.85) * z, sy - 8 * z, '+2', { bg: '#FFE14A', fg: '#0B1228', size: Math.round(Math.max(11, 15 * z)), pad: 6 });
      const pl = plan.get(n.id);
      if (pl) pill(sx, sy - (C.ringRadius(n) * 0.5 + 18) * z, [pl.power ? `⚡${pl.power}` : '', ...pl.tags].filter(Boolean).join(' '), { bg: '#FFFFFF', fg: '#0B1228', size: Math.round(Math.max(12, 16 * z)), pad: 8 });
    }
    // names
    for (const p of this.players.values()) {
      if (p.x === null || p.x === undefined) continue;
      const isMe = p.id === this.selfId;
      const [sx, sy] = this.toScreen(p.x, p.y);
      const top = sy - (SPR_H - 4) * AV_SCALE * z * (this.overview ? 1.45 : 1) - 12;
      if (st.names || isMe || this.mode !== 'player') {
        g.globalAlpha = p.on === false ? 0.5 : 1;
        pill(sx, top, isMe && this.mode === 'player' ? 'YOU' : p.name, { border: p.color, size: Math.round(Math.max(this.mode === 'player' ? 11 : 10, 15 * Math.min(1.15, z))), pad: z < 0.4 ? 5 : 9, bg: isMe ? '#FFFFFF' : 'rgba(7,11,28,.86)', fg: isMe ? '#0B1228' : '#EEF3FF' });
        g.globalAlpha = 1;
      } else { g.fillStyle = p.color; g.beginPath(); g.arc(sx, top + 4, 6, 0, Math.PI * 2); g.fill(); }
      if (p.busy) pill(sx + 30 * Math.max(0.7, z), top - 20, '▣', { fg: '#2EE6F5', size: 13, pad: 5 });
    }
    g.textBaseline = 'alphabetic';
  }
}
