// Authoritative game rules for OVERRIDE. Pure logic: no sockets, no storage.
import * as CITY from '../public/js/world/city.js';
//
// The city is a hexagon of districts. Each round every player plans actions in
// secret, then everything resolves at once. Nothing here depends on how fast
// anyone answered a math question.

export const COSTS = { power: 1, shield: 2, surge: 2, jam: 2, override: 0 };
export const RULES = {
  baseCharge: 1,     // everyone gets this each round, before missions
  maxBank: 9,        // most charge a player can hold
  maxLevel: 3,       // strongest a district can be
  hotspotBonus: 2,   // extra points for holding a hotspot
  linkCap: 6,        // most bonus points from one chain
  stationCap: 2,     // most bonus charge from power stations per round
  overrideTokens: 1, // per player, per match
  overrideLevel: 2,
};
export const VALUES = { core: 3, vault: 2, lab: 1, power: 1, std: 1 };

const DIRS = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];
const STD = [
  ['Neon Market', 'market'], ['Transit Hub', 'transit'], ['Media Tower', 'media'], ['Warehouse Row', 'warehouse'],
  ['Food District', 'food'], ['Data Center', 'data'], ['Night Market', 'market'], ['Metro Line', 'transit'],
  ['Studio Nine', 'media'], ['Cargo Bay', 'warehouse'], ['Noodle Alley', 'food'], ['Server Farm', 'data'],
  ['Vertex Mall', 'market'], ['Sky Bridge', 'transit'], ['Signal Yard', 'media'], ['Drone Dock', 'warehouse'],
  ['Corner Cafe', 'food'], ['The Archive', 'data'], ['Arcade Block', 'market'], ['Harbor Gate', 'transit'],
  ['Echo Stage', 'media'], ['Old Port', 'warehouse'], ['Taco Row', 'food'], ['Pixel Square', 'data'],
];
const VAULTS = ['Credit Vault', 'Exchange Tower', 'Financial District'];
const LABS = ['Tech Lab', 'Robotics Lab', 'Signal Lab'];
const COMPASS = ['Southwest', 'Southeast', 'East', 'Northeast', 'Northwest', 'West'];

// The walkable city (see public/js/world/city.js). Capture zones are its plazas.
export function buildCity() {
  const hexes = CITY.NODES.map((n) => ({ id: n.id, gx: n.gx, gy: n.gy, x: n.x, y: n.y, type: n.type, name: n.name, icon: n.icon, district: n.district, value: VALUES[n.type] }));
  return { radius: 0, layout: 'city', hexes, nbrs: CITY.NBRS };
}

// The original hex board (kept for the rules tests and any future board mode).
export function buildMap(radius) {
  const hexes = [];
  const add = (q, r, type, name, icon) => hexes.push({ id: hexes.length, q, r, type, name, icon: icon || type, value: VALUES[type] });
  add(0, 0, 'core', 'Central Core');
  let std = 0, v = 0, l = 0;
  for (let k = 1; k <= radius; k++) {
    let q = -k, r = k;
    for (let side = 0; side < 6; side++) {
      for (let j = 0; j < k; j++) {
        let type = 'std';
        if (k === 1) type = radius >= 3 ? (side % 2 === 0 ? 'vault' : 'lab') : ['vault', 'std', 'lab'][side % 3];
        else if (k === radius && j === 0) type = radius >= 3 || side % 2 === 0 ? 'power' : 'std';
        if (type === 'vault') add(q, r, type, VAULTS[v++ % VAULTS.length]);
        else if (type === 'lab') add(q, r, type, LABS[l++ % LABS.length]);
        else if (type === 'power') add(q, r, type, `${COMPASS[side]} Power`);
        else { const [name, icon] = STD[std++ % STD.length]; add(q, r, 'std', name, icon); }
        q += DIRS[side][0]; r += DIRS[side][1];
      }
    }
  }
  const at = new Map(hexes.map((h) => [`${h.q},${h.r}`, h.id]));
  const nbrs = hexes.map((h) => DIRS.map(([dq, dr]) => at.get(`${h.q + dq},${h.r + dr}`)).filter((x) => x !== undefined));
  return { radius, hexes, nbrs };
}

export const sideOf = (match, p) => (match.mode === 'teams' ? `T${p.team}` : p.id);
export const newStats = () => ({ captures: 0, clutch: 0, defended: 0, overrides: 0, spent: 0 });

export function createMatch({ players, mode = 'ffa', rounds = 4, board = 'city' }) {
  const { radius, hexes, nbrs, layout } = board === 'city' ? buildCity() : buildMap(players.length <= 6 ? 2 : 3);
  const match = {
    mode, rounds, round: 0, radius, layout, hexes, nbrs,
    own: hexes.map(() => null), lvl: hexes.map(() => 0), holder: hexes.map(() => null),
    hotspots: [], sides: {}, income: {},
  };
  for (const p of players) ensureSide(match, p);
  return match;
}

export function ensureSide(match, p) {
  const id = sideOf(match, p);
  if (!match.sides[id]) match.sides[id] = { id, score: 0, ranks: [], bestChain: 0 };
  return match.sides[id];
}

export function zoneCounts(match) {
  const z = {};
  for (const o of match.own) if (o) z[o] = (z[o] || 0) + 1;
  return z;
}

// Start a round: pick hotspots and hand out the charge everyone gets regardless of math.
export function startRound(match, players, rng) {
  match.round += 1;
  const count = match.hexes.length >= 25 ? 3 : 2;
  const pool = match.hexes.filter((h) => h.type !== 'core' && !match.hotspots.includes(h.id)).map((h) => h.id);
  match.hotspots = rng.sample(pool, count);

  // Comeback: the bottom third of the scoreboard gets backup power from round 2.
  const sides = Object.values(match.sides);
  const backup = new Set();
  if (match.round >= 2 && sides.length >= 2) {
    const sorted = [...sides].sort((a, b) => a.score - b.score);
    const top = sorted[sorted.length - 1].score;
    const n = Math.max(1, Math.floor(sides.length / 3));
    for (const s of sorted.slice(0, n)) if (s.score < top) backup.add(s.id);
  }
  for (const p of players) {
    const station = Math.min(RULES.stationCap, match.income[p.id] || 0);
    const extra = backup.has(sideOf(match, p)) ? 1 : 0;
    p.roundGain = { base: RULES.baseCharge, station, backup: extra };
    p.charge = Math.min(RULES.maxBank, p.charge + RULES.baseCharge + station + extra);
    p.plan = []; p.locked = false;
  }
  match.income = {};
}

// Keep only the actions this player is really allowed to take. The client sends
// its whole plan each time, so repeats can never stack up.
export function sanitizePlan(match, p, actions) {
  const side = sideOf(match, p);
  const out = [];
  const used = { shield: 0, surge: 0, jam: 0, override: 0 };
  let budget = p.charge;
  if (!Array.isArray(actions)) return out;
  for (const a of actions.slice(0, 24)) {
    if (!a || !(a.type in COSTS)) continue;
    const hex = Number(a.hex);
    if (!Number.isInteger(hex) || hex < 0 || hex >= match.hexes.length) continue;
    const owner = match.own[hex];
    const type = a.type;
    if ((type === 'shield' || type === 'surge') && (owner !== side || used[type] >= 1)) continue;
    if (type === 'jam' && (!owner || owner === side || used.jam >= 1)) continue;
    if (type === 'override' && (owner === side || used.override >= Math.min(1, p.tokens))) continue;
    if (COSTS[type] > budget) continue;
    budget -= COSTS[type];
    if (type !== 'power') used[type] += 1;
    out.push({ type, hex });
  }
  return out;
}
export const planCost = (plan) => plan.reduce((s, a) => s + COSTS[a.type], 0);

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

export function resolveRound(match, players, rng) {
  const byId = new Map(players.map((p) => [p.id, p]));
  const sideOfId = (pid) => sideOf(match, byId.get(pid));
  const { own, lvl, holder, hexes } = match;
  const before = { own: [...own], lvl: [...lvl] };
  const events = [];
  const power = hexes.map(() => new Map());
  const shield = new Map(), surge = new Map(), jam = new Map(), over = new Map();
  const push = (m, k, v) => { if (!m.has(k)) m.set(k, []); m.get(k).push(v); };

  for (const p of players) {
    const plan = sanitizePlan(match, p, p.plan);
    const spent = planCost(plan);
    p.charge -= spent; p.stats.spent += spent;
    const side = sideOf(match, p);
    for (const a of plan) {
      if (a.type === 'power') {
        const m = power[a.hex];
        if (!m.has(side)) m.set(side, { total: 0, by: new Map() });
        const e = m.get(side); e.total += 1; e.by.set(p.id, (e.by.get(p.id) || 0) + 1);
      } else if (a.type === 'shield') shield.set(a.hex, p.id);
      else if (a.type === 'surge') surge.set(a.hex, p.id);
      else if (a.type === 'jam') push(jam, a.hex, p.id);
      else if (a.type === 'override') push(over, a.hex, p.id);
    }
    p.plan = []; p.locked = false;
  }

  const zones = zoneCounts(match);
  const take = (h, side, pid) => {
    if (own[h]) zones[own[h]] -= 1;
    own[h] = side; holder[h] = pid; zones[side] = (zones[side] || 0) + 1;
  };
  // Ties go to the underdog: lower score first, then fewer districts.
  const underdog = (sides) => rng.shuffle(sides).sort((a, b) =>
    (match.sides[a].score - match.sides[b].score) || ((zones[a] || 0) - (zones[b] || 0)))[0];
  const topPid = (entry) => [...entry.by.entries()].sort((a, b) => b[1] - a[1])[0][0];
  const stat = (pid, k) => { const p = byId.get(pid); if (p) p.stats[k] += 1; };

  for (const h of rng.shuffle(hexes.map((x) => x.id))) {
    const owner = own[h];
    const pw = power[h];
    const ownP = owner && pw.has(owner) ? pw.get(owner).total : 0;
    const ov = (over.get(h) || []).filter((pid) => sideOfId(pid) !== owner);
    if (ov.length && shield.has(h)) {
      events.push({ k: 'blocked', h, how: 'override', side: owner });
      stat(shield.get(h), 'defended');
      lvl[h] = Math.min(RULES.maxLevel, lvl[h] + ownP);
      continue;
    }
    if (ov.length) {
      const win = underdog([...new Set(ov.map(sideOfId))]);
      const pid = ov.find((x) => sideOfId(x) === win);
      byId.get(pid).tokens -= 1;
      const extra = pw.has(win) ? pw.get(win).total : 0;
      events.push({ k: 'override', h, side: win, pid, from: owner });
      take(h, win, pid);
      lvl[h] = Math.min(RULES.maxLevel, RULES.overrideLevel + extra);
      stat(pid, 'overrides'); stat(pid, 'captures'); stat(pid, 'clutch');
      continue;
    }
    const atk = [...pw.entries()].filter(([s]) => s !== owner);
    if (!owner) {
      if (!atk.length) continue;
      const best = Math.max(...atk.map(([, e]) => e.total));
      const tied = atk.filter(([, e]) => e.total === best).map(([s]) => s);
      const win = tied.length > 1 ? underdog(tied) : tied[0];
      const pid = topPid(pw.get(win));
      take(h, win, pid);
      lvl[h] = Math.min(RULES.maxLevel, best);
      events.push({ k: 'capture', h, side: win, pid, from: null, rivals: atk.length - 1 });
      stat(pid, 'captures'); if (atk.length > 1) stat(pid, 'clutch');
      continue;
    }
    const base = lvl[h] + ownP;
    if (!atk.length) {
      if (ownP) { lvl[h] = Math.min(RULES.maxLevel, base); events.push({ k: 'reinforce', h, side: owner }); }
      continue;
    }
    if (shield.has(h)) {
      lvl[h] = Math.min(RULES.maxLevel, base);
      events.push({ k: 'blocked', h, how: 'attack', side: owner });
      stat(shield.get(h), 'defended');
      continue;
    }
    const def = base + (hexes[h].type === 'lab' ? 1 : 0);
    const best = Math.max(...atk.map(([, e]) => e.total));
    const tied = atk.filter(([, e]) => e.total === best).map(([s]) => s);
    const win = tied.length > 1 ? underdog(tied) : tied[0];
    if (best > def) {
      const pid = topPid(pw.get(win));
      events.push({ k: 'capture', h, side: win, pid, from: owner, rivals: atk.length - 1 });
      take(h, win, pid);
      lvl[h] = clamp(best - def, 1, RULES.maxLevel);
      stat(pid, 'captures'); stat(pid, 'clutch');
    } else {
      lvl[h] = clamp(base - best, 1, RULES.maxLevel);
      events.push({ k: 'hold', h, side: owner });
      if (holder[h]) stat(holder[h], 'defended');
    }
  }

  const jammed = new Set(), surged = new Set();
  for (const [h, pids] of jam) {
    const foes = pids.filter((pid) => own[h] && sideOfId(pid) !== own[h]);
    if (!foes.length) continue;
    if (shield.has(h)) { events.push({ k: 'blocked', h, how: 'jam', side: own[h] }); stat(shield.get(h), 'defended'); continue; }
    jammed.add(h); events.push({ k: 'jam', h, pid: foes[0], side: sideOfId(foes[0]) });
  }
  for (const [h, pid] of surge) {
    if (own[h] !== sideOfId(pid)) continue;
    surged.add(h); events.push({ k: 'surge', h, pid, side: own[h] });
  }

  // Scoring.
  const gains = [];
  for (const s of Object.values(match.sides)) {
    let pts = 0, count = 0;
    for (const hx of hexes) {
      if (own[hx.id] !== s.id) continue;
      count += 1;
      if (jammed.has(hx.id)) continue;
      const v = hx.value + (match.hotspots.includes(hx.id) ? RULES.hotspotBonus : 0);
      pts += surged.has(hx.id) ? v * 2 : v;
    }
    const chain = largestChain(match, s.id);
    const link = Math.min(RULES.linkCap, Math.max(0, chain - 1));
    s.bestChain = Math.max(s.bestChain, chain);
    s.score += pts + link;
    gains.push({ side: s.id, zones: count, pts, link, total: pts + link, score: s.score });
  }
  const ranked = [...Object.values(match.sides)].sort((a, b) => b.score - a.score);
  ranked.forEach((s, i) => s.ranks.push(i > 0 && ranked[i - 1].score === s.score ? ranked[i - 1].ranks.at(-1) : i + 1));

  match.income = {};
  for (const hx of hexes) {
    if (hx.type === 'power' && own[hx.id] && !jammed.has(hx.id) && holder[hx.id]) match.income[holder[hx.id]] = (match.income[holder[hx.id]] || 0) + 1;
  }

  const order = { reinforce: 0, capture: 1, blocked: 2, hold: 3, takeover: 4, override: 5, jam: 6, surge: 7 };
  const rank = (e) => order[e.k === 'capture' && e.from ? 'takeover' : e.k];
  events.sort((a, b) => rank(a) - rank(b));
  return { round: match.round, events, before, after: { own: [...own], lvl: [...lvl] }, jammed: [...jammed], surged: [...surged], gains };
}

export function largestChain(match, side) {
  const seen = new Set();
  let best = 0;
  for (const h of match.hexes) {
    if (match.own[h.id] !== side || seen.has(h.id)) continue;
    let size = 0;
    const stack = [h.id]; seen.add(h.id);
    while (stack.length) {
      const x = stack.pop(); size += 1;
      for (const n of match.nbrs[x]) if (match.own[n] === side && !seen.has(n)) { seen.add(n); stack.push(n); }
    }
    best = Math.max(best, size);
  }
  return best;
}

// Final standings and awards. Awards recognise different kinds of play and are
// spread across as many players as possible. None of them look at math results.
export function finalize(match, players) {
  const zones = zoneCounts(match);
  const sides = Object.values(match.sides).map((s) => ({ side: s.id, score: s.score, zones: zones[s.id] || 0 }))
    .sort((a, b) => b.score - a.score || b.zones - a.zones);
  sides.forEach((s, i) => { s.rank = i > 0 && sides[i - 1].score === s.score && sides[i - 1].zones === s.zones ? sides[i - 1].rank : i + 1; });

  const awards = [];
  const taken = new Set();
  const give = (title, cands, desc) => {
    const sorted = cands.filter((c) => c.v > 0).sort((a, b) => b.v - a.v);
    if (!sorted.length) return;
    const c = sorted.find((x) => !taken.has(x.id)) || sorted[0];
    taken.add(c.id);
    awards.push({ title, id: c.id, desc: desc(c.v) });
  };
  for (const s of sides.filter((x) => x.rank === 1)) { awards.push({ title: 'Master of the GRID', id: s.side, desc: `${s.score} control points` }); taken.add(s.side); }
  const P = (k) => players.map((p) => ({ id: p.id, v: p.stats[k] }));
  give('Most Zones Secured', P('captures'), (v) => `${v} ${v === 1 ? 'zone' : 'zones'} captured`);
  give('Strongest Defense', P('defended'), (v) => `${v} ${v === 1 ? 'attack' : 'attacks'} stopped`);
  give('Top Strategist', P('clutch'), (v) => `${v} contested ${v === 1 ? 'win' : 'wins'}`);
  give('Best Comeback', Object.values(match.sides).map((s) => {
    const fin = sides.find((x) => x.side === s.id).rank;
    return { id: s.id, v: Math.max(0, ...s.ranks) - fin };
  }), (v) => `climbed ${v} ${v === 1 ? 'place' : 'places'}`);
  give('Link Master', Object.values(match.sides).map((s) => ({ id: s.id, v: s.bestChain >= 3 ? s.bestChain : 0 })), (v) => `chain of ${v} linked zones`);
  give('Override Ace', P('overrides'), (v) => `${v} successful ${v === 1 ? 'override' : 'overrides'}`);
  return { ranking: sides, awards };
}
