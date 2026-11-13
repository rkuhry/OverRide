// The shared city map: a hexagon of districts drawn as one SVG.
// Used by the student game and the teacher command center.
import { esc, sleep } from './util.js';

const S = 50, W = Math.sqrt(3) * S;
const pts = (s) => Array.from({ length: 6 }, (_, i) => { const a = (Math.PI / 180) * (60 * i - 90); return `${(s * Math.cos(a)).toFixed(1)},${(s * Math.sin(a)).toFixed(1)}`; }).join(' ');
const stroke = (d) => `<path d="${d}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`;
const ICONS = {
  core: '<path d="M12 1L23 12 12 23 1 12Z" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 6.5L17.5 12 12 17.5 6.5 12Z" fill="currentColor"/>',
  power: '<path d="M13.5 1L4 13.5h6.5L9.5 23 20 9.5h-6.5Z" fill="currentColor"/>',
  vault: stroke('M3 6h18v13H3zM3 10h18') + '<circle cx="12" cy="14.5" r="2.4" fill="currentColor"/>',
  lab: stroke('M9 2h6M10 2v6l-5.5 10.5A2 2 0 0 0 6.3 21.5h11.4a2 2 0 0 0 1.8-3L14 8V2M7.5 15h9'),
  market: stroke('M5 8h14l1 13H4zM9 8V6a3 3 0 0 1 6 0v2'),
  transit: stroke('M7 3h10a2 2 0 0 1 2 2v10a3 3 0 0 1-3 3H8a3 3 0 0 1-3-3V5a2 2 0 0 1 2-2zM5 11h14M8 18l-2 3M16 18l2 3'),
  media: stroke('M12 8v14M8 22h8M7.5 11a6 6 0 0 1 0-8M16.5 11a6 6 0 0 0 0-8') + '<circle cx="12" cy="7" r="2" fill="currentColor"/>',
  warehouse: stroke('M3 10l9-6 9 6v11H3zM8 21v-6h8v6'),
  food: stroke('M4 12h16a8 8 0 0 1-16 0zM8 4v4M12 3v5M16 4v4'),
  data: stroke('M5 4h14v5H5zM5 10h14v5H5zM5 16h14v5H5zM8 6.5h.01M8 12.5h.01M8 18.5h.01'),
};
const SUB = { core: '3 pts', vault: '2 pts', lab: '+1 def', power: '+1 charge' };
export const TYPE_INFO = {
  core: 'Central Core. Worth 3 points every round.',
  vault: 'Vault district. Worth 2 points every round.',
  lab: 'Lab district. Its firewall adds 1 to defense.',
  power: 'Power station. Gives its holder 1 extra charge next round.',
  std: 'City district. Worth 1 point every round.',
};
const PLAN_LABEL = { shield: 'SHIELD', surge: '×2', jam: 'JAM', override: 'OVERRIDE' };

export class GridMap {
  constructor(root, { onTap } = {}) {
    this.root = root; this.onTap = onTap; this.hexes = []; this.n = 0;
    root.addEventListener('click', (e) => {
      const t = e.target.closest('[data-term]'); if (t && this.onTerm) return this.onTerm(Number(t.dataset.term));
      const g = e.target.closest('[data-hex]'); if (g && this.onTap) this.onTap(Number(g.dataset.hex));
    });
    root.addEventListener('keydown', (e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target.dataset.hex && this.onTap) { e.preventDefault(); this.onTap(Number(e.target.dataset.hex)); } });
  }
  setMap(map) {
    if (!map) return;
    // The walkable city is drawn in the same isometric direction as the 3D view,
    // so the overview and the street view line up.
    this.city = map.layout === 'city';
    const G = 128, KK = 0.7071;
    if (this.city) {
      this.project = (x, y) => { const fx = (x - 330) / 560, fy = (y - 330) / 560; return [(fx - fy) * G * KK, (fx + fy - 4) * G * KK / 2]; };
      this.hexes = map.hexes.map((h) => { const [x, y] = [(h.gx - h.gy) * G * KK, (h.gx + h.gy - 4) * G * KK / 2]; return { ...h, x, y }; });
    } else this.hexes = map.hexes.map((h) => ({ ...h, x: W * (h.q + h.r / 2), y: 1.5 * S * h.r }));
    this.n = this.hexes.length;
    let ext = map.radius * 1.5 * S + S + 10, wx = (map.radius + 0.5) * W + 12;
    if (this.city) { wx = Math.max(...this.hexes.map((h) => Math.abs(h.x))) + 70; ext = Math.max(...this.hexes.map((h) => Math.abs(h.y))) + 70; }
    const DC = { finance: '#5C9DFF', market: '#FF4FD8', power: '#FFE14A', tech: '#2EE6F5', transit: '#A98BFF', food: '#FFA63D', warehouse: '#3DF5A0', media: '#FF6B6B', core: '#EEF3FF' };
    const hexes = this.hexes.map((h) => `<g class="hex t-${h.type}" ${h.district ? `style="--d:${DC[h.district]}"` : ''} data-hex="${h.id}" transform="translate(${h.x.toFixed(1)},${h.y.toFixed(1)})${this.city ? ' scale(.86)' : ''}" tabindex="0" role="button" aria-label="${esc(h.name)}">
      <polygon class="hx" points="${pts(S - 3)}"/><polygon class="hx-me" points="${pts(S - 9)}"/><polygon class="hx-hot" points="${pts(S - 1)}"/>
      <text class="hx-tag" y="-25"></text>
      <g class="hx-icon" transform="translate(-13,-19) scale(1.08)">${ICONS[h.icon] || ICONS.market}</g>
      ${SUB[h.type] ? `<text class="hx-sub" y="21">${SUB[h.type]}</text>` : ''}
      <g class="hx-pips" transform="translate(-17,${SUB[h.type] ? 28 : 22})">${[0, 1, 2].map((i) => `<rect x="${i * 12}" width="10" height="6" rx="1.5"/>`).join('')}</g>
      <text class="hx-fx" y="6"></text>
    </g>`).join('');
    this.root.innerHTML = `<svg class="grid-map" viewBox="${-wx} ${-ext} ${wx * 2} ${ext * 2}" preserveAspectRatio="xMidYMid meet">
      <g class="links"></g><g class="hexes">${hexes}</g><g class="terms"></g><g class="dots"></g><g class="badges"></g><g class="fx"></g></svg>`;
    this.els = [...this.root.querySelectorAll('.hex')];
    this.links = this.root.querySelector('.links'); this.badges = this.root.querySelector('.badges'); this.fxLayer = this.root.querySelector('.fx');
    this.termLayer = this.root.querySelector('.terms'); this.dotLayer = this.root.querySelector('.dots');
    this.edges = [];
    if (map.nbrs) map.nbrs.forEach((list, a) => list.forEach((b) => { if (a < b) this.edges.push([a, b]); }));
    else {
      const at = new Map(this.hexes.map((h) => [`${h.q},${h.r}`, h.id]));
      for (const h of this.hexes) for (const [dq, dr] of [[1, 0], [0, 1], [-1, 1]]) { const o = at.get(`${h.q + dq},${h.r + dr}`); if (o !== undefined) this.edges.push([h.id, o]); }
    }
  }
  // Terminals and people on the overview (city layout only). Positions are world coordinates.
  setTerms(terms, used = [], live = false) {
    if (!this.project || !this.termLayer) return;
    this.termLayer.innerHTML = terms.map((t) => { const [x, y] = this.project(t.x, t.y); const on = live && !used.includes(t.id);
      return `<g class="term ${on ? 'live' : ''} ${used.includes(t.id) ? 'used' : ''}" data-term="${t.id}" transform="translate(${x.toFixed(1)},${y.toFixed(1)})" role="button" tabindex="0" aria-label="${esc(t.name)}"><rect x="-13" y="-13" width="26" height="26" rx="5"/><text y="6">${used.includes(t.id) ? '✓' : '$'}</text></g>`; }).join('');
  }
  setDots(list) {
    if (!this.project || !this.dotLayer) return;
    this.dotLayer.innerHTML = list.map((d) => { const [x, y] = this.project(d.x, d.y);
      return d.me ? `<g class="me-dot" transform="translate(${x.toFixed(1)},${y.toFixed(1)})"><circle r="14"/><text y="-20">YOU</text></g>` : `<circle class="dot" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="6" fill="${d.color}"/>`; }).join('');
  }
  // view: { own, lvl, hot, sides: Map(id -> {color, tag}), mySide, plan, jammed, surged, pick }
  update(v) {
    if (!this.n || !v || !v.own) return;
    this.view = v;
    const hot = new Set(v.hot || []), jam = new Set(v.jammed || []), surge = new Set(v.surged || []);
    this.els.forEach((el, i) => {
      const owner = v.own[i], side = owner ? v.sides.get(owner) : null;
      el.classList.toggle('owned', !!owner);
      el.classList.toggle('mine', !!owner && owner === v.mySide);
      el.classList.toggle('hot', hot.has(i));
      el.classList.toggle('jammed', jam.has(i));
      el.classList.toggle('surged', surge.has(i));
      el.classList.toggle('pick', !!v.pick && v.pick(i));
      el.style.setProperty('--c', side ? side.color : '#2A3A6B');
      el.querySelector('.hx-tag').textContent = side ? side.tag : '';
      el.querySelector('.hx-fx').textContent = jam.has(i) ? 'JAMMED' : surge.has(i) ? '×2' : '';
      el.querySelectorAll('.hx-pips rect').forEach((r, k) => r.classList.toggle('on', k < (v.lvl[i] || 0)));
      el.setAttribute('aria-label', `${this.hexes[i].name}${side ? `, held by ${side.name}, level ${v.lvl[i]}` : ', empty'}${hot.has(i) ? ', hotspot' : ''}`);
    });
    this.links.innerHTML = this.edges.filter(([a, b]) => v.own[a] && v.own[a] === v.own[b]).map(([a, b]) => {
      const A = this.hexes[a], B = this.hexes[b], c = v.sides.get(v.own[a])?.color || '#fff';
      return `<line x1="${A.x.toFixed(1)}" y1="${A.y.toFixed(1)}" x2="${B.x.toFixed(1)}" y2="${B.y.toFixed(1)}" stroke="${c}"/>`;
    }).join('');
    const by = new Map();
    for (const a of v.plan || []) { if (!by.has(a.hex)) by.set(a.hex, { power: 0, tags: [] }); const e = by.get(a.hex); if (a.type === 'power') e.power += 1; else e.tags.push(PLAN_LABEL[a.type]); }
    this.badges.innerHTML = [...by.entries()].map(([id, e]) => {
      const h = this.hexes[id], label = [e.power ? String(e.power) : '', ...e.tags].filter(Boolean).join(' ');
      const bolt = e.power ? 16 : 0, w = label.length * 8.8 + 16 + bolt;
      return `<g class="badge" transform="translate(${h.x.toFixed(1)},${(h.y - S + 6).toFixed(1)})"><rect x="${-w / 2}" y="-13" width="${w}" height="26" rx="5"/>${bolt ? `<path d="M13.5 1L4 13.5h6.5L9.5 23 20 9.5h-6.5Z" transform="translate(${-w / 2 + 4},-9.5) scale(.8)"/>` : ''}<text x="${bolt / 2}" y="5.5">${label}</text></g>`;
    }).join('') + [...hot].map((id) => { const h = this.hexes[id]; return `<g class="hot-tag" transform="translate(${(h.x + W / 2 - 13).toFixed(1)},${(h.y - 20).toFixed(1)})"><circle r="12"/><text y="4.5">+2</text></g>`; }).join('');
  }
  burst(id, color, cls = '') {
    const h = this.hexes[id];
    if (!h) return;
    const g = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
    g.setAttribute('points', pts(S - 3)); g.setAttribute('transform', `translate(${h.x.toFixed(1)},${h.y.toFixed(1)})`);
    g.setAttribute('class', `ring ${cls}`); g.style.setProperty('--c', color);
    this.fxLayer.appendChild(g);
    setTimeout(() => g.remove(), 1200);
    const el = this.els[id]; el.classList.remove('pop'); void el.getBoundingClientRect(); el.classList.add('pop');
  }
  // Replay a round's resolution one event at a time.
  async play(res, base, { onEvent, pace = 1 } = {}) {
    const cur = { own: [...res.before.own], lvl: [...res.before.lvl] };
    const jammed = [], surged = [];
    const view = () => ({ ...base, own: cur.own, lvl: cur.lvl, plan: [], jammed, surged, pick: null });
    this.update(view());
    await sleep(500 * pace);
    const per = Math.max(380, Math.min(1000, 11000 / Math.max(1, res.events.length))) * pace;
    for (const e of res.events) {
      if (e.k === 'capture' || e.k === 'override') cur.own[e.h] = e.side;
      if (e.k === 'jam') jammed.push(e.h);
      if (e.k === 'surge') surged.push(e.h);
      cur.lvl[e.h] = res.after.lvl[e.h];
      const wait = onEvent ? await onEvent(e) : 0;
      this.update(view());
      this.burst(e.h, base.sides.get(e.side)?.color || '#EEF3FF', e.k);
      await sleep((wait || per));
    }
    this.update({ ...base, own: res.after.own, lvl: res.after.lvl, plan: [], jammed: res.jammed, surged: res.surged, pick: null });
  }
}
