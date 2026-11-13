// Multiplayer session management: rooms, players, phases, and who is told what.
// Game rules live in game.js; question content lives in curriculum/.
import crypto from 'node:crypto';
import { makeRng } from './curriculum/helpers.js';
import { makeQuestion, publicQuestion, cleanProfile, DEFAULT_PROFILE, validateCustom } from './curriculum/index.js';
import * as G from './game.js';
import * as CITY from '../public/js/world/city.js';

export const COLORS = ['#2EE6F5', '#FF4FD8', '#B6F23A', '#FFA63D', '#A98BFF', '#FF6B6B', '#3DF5A0', '#FFE14A',
  '#5C9DFF', '#FF8FB1', '#19C3B1', '#E0A8FF', '#F2F5FF', '#FF7A45', '#8DDB5A', '#7FD4FF'];
export const TEAMS = [
  { name: 'Team Cyan', color: '#2EE6F5' }, { name: 'Team Magenta', color: '#FF4FD8' }, { name: 'Team Lime', color: '#B6F23A' },
  { name: 'Team Amber', color: '#FFA63D' }, { name: 'Team Violet', color: '#A98BFF' },
];
const MAX_PLAYERS = 30;
const rid = (n = 6) => crypto.randomBytes(n).toString('hex');
const cleanName = (s) => String(s ?? '').replace(/[\u0000-\u001f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 14);
const clampInt = (v, lo, hi, d) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : d; };

export function cleanAvatar(a) {
  const n = (v, max) => clampInt(v, 0, max, 0);
  a = a && typeof a === 'object' ? a : {};
  return { skin: n(a.skin, 5), hair: n(a.hair, 9), tone: n(a.tone, 5), gear: n(a.gear, 5) };
}

function cleanOpts(o = {}, base = {}) {
  return {
    mode: o.mode === 'teams' || o.mode === 'ffa' ? o.mode : base.mode || 'ffa',
    teamCount: clampInt(o.teamCount, 2, 5, base.teamCount || 3),
    rounds: clampInt(o.rounds, 1, 8, base.rounds || 4),
    missions: clampInt(o.missions, 2, 6, base.missions || 4),
    topUp: typeof o.topUp === 'boolean' ? o.topUp : base.topUp ?? true,
    names: typeof o.names === 'boolean' ? o.names : base.names ?? true,
  };
}

class Room {
  constructor(code, store, opts) {
    this.code = code; this.store = store;
    this.opts = cleanOpts(opts);
    this.phase = 'lobby'; this.paused = false;
    this.players = new Map(); this.teachers = new Set();
    this.match = null; this.sessionId = null; this.lastResolve = null; this.final = null;
    this.rng = makeRng();
    this.touched = Date.now();
    this.timer = null;
    this.posDirty = false;
    this.posTimer = setInterval(() => this.flushPos(), 100); // 10 position updates a second, only when something moved
    this.spawnCount = 0;
  }
  dispose() { clearInterval(this.posTimer); clearTimeout(this.timer); }

  // ---------- connections ----------
  list() { return [...this.players.values()]; }
  defaults() { return cleanProfile(this.store.getKV('defaults')); }
  custom() { return this.store.questions.list(); }

  join(conn, msg) {
    const rosterEntry = msg.rosterId ? this.store.roster.get(String(msg.rosterId)) : null;
    let name = cleanName(rosterEntry ? rosterEntry.name : msg.name);
    if (!name) return { error: 'Enter a name to join.' };
    const entry = rosterEntry || this.store.roster.list().find((r) => r.name.toLowerCase() === name.toLowerCase()) || null;
    const key = entry ? entry.id : `nick:${name.toLowerCase()}`;
    const existing = this.list().find((p) => p.key === key);
    if (existing) {
      if (existing.on) return { error: 'That name is already playing. Pick another.' };
      return this.attach(existing, conn); // same student coming back on a fresh device or tab
    }
    if (this.players.size >= MAX_PLAYERS) return { error: 'This game is full.' };
    const used = new Set(this.list().map((p) => p.colorIdx));
    let colorIdx = 0; while (used.has(colorIdx)) colorIdx++;
    const p = {
      id: rid(4), token: rid(16), name, key, rosterId: entry ? entry.id : null,
      avatar: cleanAvatar(msg.avatar || entry?.avatar), colorIdx: colorIdx % COLORS.length, team: null,
      profile: cleanProfile(entry?.settings, this.defaults()),
      conn: null, on: false, charge: 0, tokens: G.RULES.overrideTokens, plan: [], locked: false,
      stats: G.newStats(), session: { first: 0, total: 0 }, m: { done: 0, total: 0, q: null, t: null, recent: [], slot: 0, offset: 0, used: [] },
      roundGain: null, busy: null, mvAt: Date.now(), stuckAt: 0,
    };
    [p.x, p.y] = CITY.spawnPoint(this.spawnCount++);
    p.tag = this.makeTag(name);
    this.players.set(p.id, p);
    if (this.match) {
      if (this.match.mode === 'teams') p.team = this.smallestTeam();
      G.ensureSide(this.match, p);
      p.charge = G.RULES.baseCharge;
      if (this.phase === 'build') this.initMissions(p);
    }
    return this.attach(p, conn);
  }

  makeTag(name) {
    const tags = new Set(this.list().map((p) => p.tag));
    const base = name.replace(/[^\p{L}\p{N}]/gu, '').toUpperCase() || 'P';
    const tries = [base.slice(0, 2), ...[...base].slice(2).map((ch) => base[0] + ch), ...[...'23456789ABCDEFGHJKLMNPQRSTUVWXYZ'].map((d) => base[0] + d)];
    return tries.find((t) => t && !tags.has(t)) || base.slice(0, 2);
  }

  rejoin(conn, token) {
    const p = this.list().find((x) => x.token === token);
    return p ? this.attach(p, conn) : { error: 'gone' };
  }

  attach(p, conn) {
    if (p.conn && p.conn !== conn) { try { p.conn.json({ t: 'replaced' }); p.conn.close(); } catch {} }
    p.conn = conn; p.on = true;
    conn.json({ t: 'joined', id: p.id, token: p.token, code: this.code, name: p.name, x: p.x, y: p.y });
    if (this.match) conn.json(this.mapMsg());
    conn.json(this.publicState());
    conn.json(this.posMsg());
    this.sendYou(p);
    this.posDirty = true;
    if (this.phase === 'results' && this.lastResolve) conn.json({ t: 'resolve', replay: false, ...this.lastResolve });
    this.dirty();
    return { player: p };
  }

  detach(conn) {
    for (const p of this.players.values()) if (p.conn === conn) { p.conn = null; p.on = false; this.dirty(); }
    this.teachers.delete(conn);
  }

  attachTeacher(conn) {
    this.teachers.add(conn);
    if (this.match) conn.json(this.mapMsg());
    conn.json(this.teacherState());
    conn.json(this.posMsg());
    if (this.phase === 'results' && this.lastResolve) conn.json({ t: 'resolve', replay: false, ...this.lastResolve });
  }

  // ---------- broadcasting ----------
  dirty() {
    this.touched = Date.now();
    if (this.timer) return;
    this.timer = setTimeout(() => { this.timer = null; this.flush(); }, 50);
  }
  flush() {
    const s = JSON.stringify(this.publicState());
    for (const p of this.players.values()) if (p.conn) p.conn.send(s);
    if (this.teachers.size) { const t = JSON.stringify(this.teacherState()); for (const c of this.teachers) c.send(t); }
  }
  everyone(obj) {
    const s = JSON.stringify(obj);
    for (const p of this.players.values()) if (p.conn) p.conn.send(s);
    for (const c of this.teachers) c.send(s);
  }
  mapMsg() { return { t: 'map', radius: this.match.radius, layout: this.match.layout, hexes: this.match.hexes, nbrs: this.match.nbrs }; }
  // Positions travel separately from the rest of the state, compactly: [id, x, y, atTerminal].
  posMsg() { return { t: 'pp', p: this.list().map((p) => [p.id, Math.round(p.x), Math.round(p.y), p.busy !== null ? 1 : 0]) }; }
  flushPos() {
    if (!this.posDirty) return;
    this.posDirty = false;
    const s = JSON.stringify(this.posMsg());
    for (const p of this.players.values()) if (p.conn) p.conn.send(s);
    for (const c of this.teachers) c.send(s);
  }
  colorOf(p) { return (this.match ? this.match.mode : this.opts.mode) === 'teams' && p.team !== null ? TEAMS[p.team].color : COLORS[p.colorIdx]; }

  sides() {
    if (!this.match) return [];
    const zones = G.zoneCounts(this.match);
    return Object.values(this.match.sides).map((s) => {
      if (this.match.mode === 'teams') { const t = TEAMS[Number(s.id.slice(1))]; return { id: s.id, name: t.name, color: t.color, score: s.score, zones: zones[s.id] || 0 }; }
      const p = this.players.get(s.id);
      return { id: s.id, name: p ? p.name : '—', color: p ? COLORS[p.colorIdx] : '#888', score: s.score, zones: zones[s.id] || 0 };
    });
  }

  // Everything in here is safe for every student to see. No math data, ever.
  publicState() {
    const m = this.match;
    return {
      t: 'state', code: this.code, phase: this.phase, paused: this.paused, mode: m ? m.mode : this.opts.mode, names: this.opts.names,
      round: m ? m.round : 0, rounds: m ? m.rounds : this.opts.rounds,
      players: this.list().map((p) => ({
        id: p.id, name: p.name, tag: p.tag, avatar: p.avatar, color: this.colorOf(p), team: p.team, on: p.on,
        side: m ? G.sideOf(m, p) : p.id, ready: this.phase === 'control' && p.locked,
      })),
      sides: this.sides(),
      map: m ? { own: m.own, lvl: m.lvl, hot: m.hotspots } : null,
      final: this.final,
    };
  }

  teacherState() {
    return {
      ...this.publicState(), t: 't_state', opts: this.opts,
      priv: this.list().map((p) => ({
        id: p.id, key: p.key, rosterId: p.rosterId, profile: p.profile, charge: p.charge, tokens: p.tokens,
        done: p.m.done, total: p.m.total, planned: p.plan.length, locked: p.locked,
        first: p.session.first, answered: p.session.total,
        skill: p.m.q ? p.m.q.skillName : null, tries: p.m.t ? p.m.t.attempts : 0,
        at: p.busy !== null ? CITY.TERMINALS[p.busy].name : null,
      })),
    };
  }

  sendYou(p) {
    if (!p.conn) return;
    const q = p.m.q, t = p.m.t;
    p.conn.json({
      t: 'you', id: p.id, side: this.match ? G.sideOf(this.match, p) : p.id,
      charge: p.charge, tokens: p.tokens, gain: p.roundGain,
      missions: { done: p.m.done, total: p.m.total },
      term: p.busy !== null ? { id: p.busy, name: CITY.TERMINALS[p.busy].name } : null,
      used: p.m.used || [],
      q: q && this.phase === 'build' && p.busy !== null ? { ...publicQuestion(q, p.profile), disabled: t.disabled, hint: t.attempts > 0 || t.hints > 0 ? q.hint : null, reveal: t.guided ? q.answerId : null } : null,
      plan: p.plan, locked: p.locked,
      ui: { readAloud: p.profile.readAloud, large: p.profile.large, contrast: p.profile.contrast, calm: p.profile.calm, calculator: p.profile.calculator, hints: p.profile.hints, warp: p.profile.warp },
    });
  }

  // ---------- missions (the math) ----------
  initMissions(p) {
    p.m = { done: 0, total: this.opts.missions, q: null, t: null, recent: p.m?.recent || [], slot: 0, offset: this.rng.int(0, 7), used: [] };
  }
  // A terminal leans towards its district's topics, but only among the topics
  // the teacher assigned to this student. Otherwise it rotates through them.
  nextQuestion(p, hint = []) {
    if (p.m.done >= p.m.total) { p.m.q = null; p.m.t = null; return; }
    const assigned = Object.keys(p.profile.topics);
    const themed = assigned.filter((t) => hint.includes(t));
    const topics = themed.length ? themed : assigned;
    const topic = topics[(p.m.offset + p.m.slot++) % topics.length];
    p.m.hint = hint;
    p.m.q = makeQuestion({ topic, level: p.profile.topics[topic], n: p.profile.choices, avoid: p.m.recent, custom: this.custom(), rng: this.rng });
    p.m.recent = [...p.m.recent, p.m.q.skill].slice(-2);
    p.m.t = { attempts: 0, first: null, firstCorrect: null, hints: 0, guided: false, calc: false, read: false, disabled: [] };
  }
  record(p, status) {
    const q = p.m.q, t = p.m.t;
    if (!q) return;
    this.store.attempts.add({
      session_id: this.sessionId, student_key: p.key, student_name: p.name, ts: Date.now(), round: this.match ? this.match.round : 0,
      topic: q.topic, skill: q.skill, skill_name: q.skillName, level: q.level, question_id: q.id, prompt: q.prompt,
      correct_answer: q.answerText, first_response: t.first, first_correct: t.firstCorrect === null ? null : t.firstCorrect ? 1 : 0,
      final_correct: ['first_try', 'multi_try', 'with_support'].includes(status) ? 1 : 0,
      attempts: t.attempts, hints: t.hints, guided: t.guided ? 1 : 0, calculator: t.calc ? 1 : 0, read_aloud: t.read ? 1 : 0,
      choices: q.choices.length, status,
    });
  }
  complete(p, status) {
    const qid = p.m.q.id;
    this.record(p, status);
    p.m.done += 1;
    p.charge = Math.min(G.RULES.maxBank, p.charge + 1); // same reward for every tier, support and number of tries
    p.session.total += 1; if (status === 'first_try') p.session.first += 1;
    if (p.busy !== null && !p.m.used.includes(p.busy)) p.m.used.push(p.busy);
    p.m.q = null; p.m.t = null; p.busy = null; this.posDirty = true; // back out into the city
    if (p.conn) p.conn.json({ t: 'feedback', qid, correct: true });
    this.sendYou(p);
    this.dirty();
  }
  answer(p, msg) {
    const q = p.m.q, t = p.m.t;
    if (this.phase !== 'build' || this.paused || !q || msg.qid !== q.id || p.busy === null) return;
    const choice = String(msg.choice);
    if (!q.choices.some((c) => c.id === choice) || t.disabled.includes(choice)) return;
    t.attempts += 1;
    const correct = choice === q.answerId;
    if (t.attempts === 1) { t.first = q.describe(choice); t.firstCorrect = correct; }
    if (correct) return this.complete(p, t.guided || t.hints > 0 ? 'with_support' : t.attempts === 1 ? 'first_try' : 'multi_try');
    t.disabled.push(choice);
    const left = q.choices.length - t.disabled.length;
    if (t.attempts >= 2 && left > 1) t.guided = true; // show the answer rather than let anyone get stuck
    if (p.conn) p.conn.json({ t: 'feedback', qid: q.id, correct: false, disabled: t.disabled, hint: q.hint, reveal: t.guided ? q.answerId : null });
    this.dirty();
  }
  closeBuild() {
    for (const p of this.players.values()) {
      if (p.m.q && p.m.t.attempts > 0) this.record(p, 'incomplete');
      if (this.opts.topUp) p.charge = Math.min(G.RULES.maxBank, p.charge + Math.max(0, p.m.total - p.m.done));
      p.m.q = null; p.m.t = null; p.busy = null;
    }
    this.posDirty = true;
  }

  // ---------- the city ----------
  note(p, msg) { p.conn?.json({ t: 'note', msg }); }
  correct(p) { p.conn?.json({ t: 'pos', x: p.x, y: p.y }); }
  place(p, x, y) { [p.x, p.y] = CITY.nearestWalkable(x, y); p.mvAt = Date.now(); this.correct(p); this.posDirty = true; }
  move(p, msg) {
    const x = Number(msg.x), y = Number(msg.y);
    if (p.busy !== null || !CITY.walkable(x, y)) return this.correct(p);
    const now = Date.now(), dt = Math.min(0.6, (now - p.mvAt) / 1000);
    const allowed = CITY.SPEED * Math.max(dt, 0.05) * 1.4 + 30; // generous for Wi-Fi jitter, too small to skip anywhere
    // A step that slid around a corner may cut it diagonally: accept it if the same step taken as an L is clear.
    const clear = CITY.clearLine(p.x, p.y, x, y) || (CITY.clearLine(p.x, p.y, x, p.y) && CITY.clearLine(x, p.y, x, y)) || (CITY.clearLine(p.x, p.y, p.x, y) && CITY.clearLine(p.x, y, x, y));
    if (Math.hypot(x - p.x, y - p.y) > allowed || !clear) return this.correct(p);
    if (x !== p.x || y !== p.y) { p.x = x; p.y = y; this.posDirty = true; }
    p.mvAt = now;
  }
  useTerminal(p, id) {
    const term = CITY.TERMINALS[Number(id)];
    if (!term) return;
    if (this.phase !== 'build') return this.note(p, this.phase === 'control' ? 'Terminals are closed. Walk into a ring to place your charge.' : 'Terminals open when your teacher starts the round.');
    if (this.paused || p.busy !== null) return;
    if (Math.hypot(term.x - p.x, term.y - p.y) > CITY.TERM_REACH + 30) return this.note(p, 'Walk up to the terminal first.');
    if (p.m.done >= p.m.total) return this.note(p, 'All your missions are done this round.');
    if (p.m.used.includes(term.id)) return this.note(p, 'You used this terminal this round. Try a different one.');
    if (!p.m.q) this.nextQuestion(p, term.topics); // a question left unfinished comes back, so there is nothing to gain by leaving
    p.busy = term.id; this.posDirty = true;
    this.sendYou(p); this.dirty();
  }
  act(p, msg) {
    if (this.phase !== 'control' || this.paused || p.locked) return this.sendYou(p);
    const n = this.match.hexes[Number(msg.hex)];
    if (!n) return;
    const node = CITY.NODES[n.id];
    if (Math.hypot(node.x - p.x, node.y - p.y) > CITY.ringRadius(node) + CITY.ZONE_PAD) return this.note(p, 'Step into the ring first.');
    const next = G.sanitizePlan(this.match, p, [...p.plan, { type: msg.type, hex: n.id }]);
    if (next.length > p.plan.length) p.plan = next; else this.note(p, 'That move is not available here.');
    this.sendYou(p); this.dirty();
  }

  handleStudent(p, msg) {
    switch (msg.t) {
      case 'avatar': if (this.phase === 'lobby') { p.avatar = cleanAvatar(msg.avatar); this.dirty(); } break;
      case 'answer': this.answer(p, msg); break;
      case 'hint': {
        const q = p.m.q;
        if (this.phase !== 'build' || this.paused || !q || msg.qid !== q.id || !p.profile.hints) break;
        p.m.t.hints += 1;
        p.conn?.json({ t: 'feedback', qid: q.id, correct: false, soft: true, disabled: p.m.t.disabled, hint: q.hint, reveal: p.m.t.guided ? q.answerId : null });
        break;
      }
      case 'support':
        if (p.m.q && msg.qid === p.m.q.id) { if (msg.kind === 'calc' && p.profile.calculator) p.m.t.calc = true; if (msg.kind === 'read') p.m.t.read = true; }
        break;
      case 'mv': this.move(p, msg); break;
      case 'use': this.useTerminal(p, msg.term); break;
      case 'leave': if (p.busy !== null) { p.busy = null; this.posDirty = true; this.sendYou(p); this.dirty(); } break;
      case 'act': this.act(p, msg); break;
      case 'unact': {
        const i = Number(msg.i);
        if (this.phase !== 'control' || this.paused || p.locked || !(i >= 0 && i < p.plan.length)) { this.sendYou(p); break; }
        p.plan = G.sanitizePlan(this.match, p, p.plan.filter((_, k) => k !== i));
        this.sendYou(p); this.dirty();
        break;
      }
      case 'warp': { // fast travel: a teacher-enabled support
        if (!p.profile.warp || p.busy !== null) break;
        const node = msg.term !== undefined ? CITY.TERMINALS[Number(msg.term)] : CITY.NODES[Number(msg.node)];
        if (!node) break;
        const near = msg.term !== undefined ? CITY.NODES.reduce((a, b) => (Math.hypot(b.x - node.x, b.y - node.y) < Math.hypot(a.x - node.x, a.y - node.y) ? b : a)) : null;
        this.place(p, near ? node.x + Math.sign(near.x - node.x) * 40 : node.x, near ? node.y + Math.sign(near.y - node.y) * 40 : node.y + 30);
        break;
      }
      case 'unstick': { // anti-stuck: hop to the nearest plaza
        const now = Date.now();
        if (now - p.stuckAt < 3000 || p.busy !== null) break;
        p.stuckAt = now;
        const n = CITY.NODES.reduce((a, b) => (Math.hypot(b.x - p.x, b.y - p.y) < Math.hypot(a.x - p.x, a.y - p.y) ? b : a));
        this.place(p, n.x, n.y + CITY.ringRadius(n) + 30);
        break;
      }
      case 'lock':
        if (this.phase !== 'control' || this.paused) break;
        p.locked = !!msg.locked;
        this.sendYou(p); this.dirty();
        break;
    }
  }

  // ---------- teacher-controlled phases ----------
  smallestTeam() {
    const n = Array(this.opts.teamCount).fill(0);
    for (const p of this.players.values()) if (p.team !== null && p.team < n.length) n[p.team] += 1;
    return n.indexOf(Math.min(...n));
  }
  start() {
    if (this.phase !== 'lobby') return 'The game has already started.';
    if (!this.players.size) return 'Wait for at least one student to join.';
    const ps = this.list();
    if (this.opts.mode === 'teams') {
      for (const p of ps) if (p.team !== null && p.team >= this.opts.teamCount) p.team = null;
      for (const p of this.rng.shuffle(ps.filter((x) => x.team === null))) p.team = this.smallestTeam();
    } else for (const p of ps) p.team = null;
    this.match = G.createMatch({ players: ps, mode: this.opts.mode, rounds: this.opts.rounds });
    for (const p of ps) { p.charge = 0; p.tokens = G.RULES.overrideTokens; p.stats = G.newStats(); p.session = { first: 0, total: 0 }; p.plan = []; p.locked = false; }
    this.sessionId = crypto.randomUUID();
    this.session = { id: this.sessionId, code: this.code, startedAt: Date.now(), endedAt: null, mode: this.opts.mode, rounds: this.opts.rounds, players: ps.map((p) => p.name) };
    this.store.sessions.save(this.session);
    this.final = null; this.lastResolve = null; this.paused = false;
    this.everyone(this.mapMsg());
    this.beginBuild();
    return null;
  }
  beginBuild() {
    const ps = this.list();
    G.startRound(this.match, ps, this.rng);
    this.phase = 'build';
    for (const p of ps) { this.initMissions(p); p.busy = null; }
    this.posDirty = true;
    for (const p of ps) this.sendYou(p);
    this.dirty();
  }
  advance() {
    if (this.phase === 'lobby') return this.start();
    if (this.phase === 'build') {
      this.closeBuild(); this.phase = 'control';
    } else if (this.phase === 'control') {
      this.lastResolve = G.resolveRound(this.match, this.list(), this.rng);
      this.phase = 'results';
      this.everyone({ t: 'resolve', replay: true, ...this.lastResolve });
    } else if (this.phase === 'results') {
      if (this.match.round >= this.match.rounds) this.finish(); else return void this.beginBuild();
    } else return 'The match is over.';
    for (const p of this.players.values()) this.sendYou(p);
    this.dirty();
    return null;
  }
  finish() {
    this.final = G.finalize(this.match, this.list());
    this.phase = 'final'; this.paused = false;
    if (this.session) {
      this.session.endedAt = Date.now();
      this.session.result = this.final.ranking.map((r) => ({ name: this.sides().find((s) => s.id === r.side)?.name, score: r.score, zones: r.zones }));
      this.store.sessions.save(this.session);
    }
  }
  end() {
    if (!this.match || this.phase === 'final' || this.phase === 'lobby') return;
    if (this.phase === 'build') this.closeBuild();
    this.finish();
    for (const p of this.players.values()) this.sendYou(p);
    this.dirty();
  }
  reset() {
    this.phase = 'lobby'; this.match = null; this.final = null; this.lastResolve = null; this.paused = false; this.session = null; this.sessionId = null;
    for (const p of this.players.values()) { p.charge = 0; p.plan = []; p.locked = false; p.busy = null; p.m = { done: 0, total: 0, q: null, t: null, recent: [], slot: 0, offset: 0, used: [] }; p.roundGain = null; this.sendYou(p); }
    this.posDirty = true;
    this.dirty();
  }

  setProfile(p, profile) {
    p.profile = cleanProfile(profile, p.profile);
    if (p.rosterId) { const e = this.store.roster.get(p.rosterId); if (e) this.store.roster.save({ ...e, settings: p.profile }); }
    if (this.phase === 'build' && p.m.q && p.m.t.attempts === 0 && p.m.t.hints === 0) { p.m.slot -= 1; p.m.recent.pop(); this.nextQuestion(p, p.m.hint || []); }
    this.sendYou(p);
  }

  handleTeacher(conn, msg) {
    const p = msg.playerId ? this.players.get(String(msg.playerId)) : null;
    let err = null;
    switch (msg.t) {
      case 't_start': err = this.start(); break;
      case 't_advance': if (!this.paused) err = this.advance(); break;
      case 't_pause': if (this.phase !== 'lobby' && this.phase !== 'final') { this.paused = !!msg.paused; this.dirty(); } break;
      case 't_end': this.end(); break;
      case 't_reset': this.reset(); break;
      case 't_opts': if (this.phase === 'lobby') { this.opts = cleanOpts(msg.opts, this.opts); this.dirty(); } break;
      case 't_names': this.opts.names = !!msg.on; this.dirty(); break;
      case 't_set': if (p) { this.setProfile(p, msg.profile); this.dirty(); } break;
      case 't_setall':
        for (const x of this.players.values()) this.setProfile(x, { ...x.profile, ...msg.patch, topics: msg.patch?.topics || x.profile.topics });
        this.dirty(); break;
      case 't_team': if (p && this.phase === 'lobby') { p.team = msg.team === null ? null : clampInt(msg.team, 0, this.opts.teamCount - 1, 0); this.dirty(); } break;
      case 't_assist':
        if (p && this.phase === 'build' && p.m.q) this.complete(p, 'teacher_assist');
        break;
      case 't_save': // keep a nickname player's settings for next time
        if (p && !p.rosterId) {
          const e = { id: rid(5), name: p.name, avatar: p.avatar, settings: p.profile };
          this.store.roster.save(e); p.rosterId = e.id; this.dirty();
        }
        break;
      case 't_kick':
        if (p) {
          try { p.conn?.json({ t: 'removed' }); p.conn?.close(); } catch {}
          this.players.delete(p.id); this.posDirty = true;
          if (this.match && this.match.mode === 'ffa') {
            this.match.own = this.match.own.map((o, i) => { if (o === p.id) { this.match.lvl[i] = 0; this.match.holder[i] = null; return null; } return o; });
            delete this.match.sides[p.id];
          }
          this.dirty();
        }
        break;
    }
    if (err) conn.json({ t: 'error', msg: err });
  }
}

export class Rooms {
  constructor(store) {
    this.store = store; this.rooms = new Map();
    setInterval(() => {
      const now = Date.now();
      for (const [code, r] of this.rooms) {
        const idle = now - r.touched > 3 * 3600e3 && !r.teachers.size && !r.list().some((p) => p.on);
        if (idle) { r.dispose(); this.rooms.delete(code); }
      }
    }, 600e3).unref();
  }
  create(opts) {
    let code;
    do { code = String(crypto.randomInt(1000, 10000)); } while (this.rooms.has(code));
    const room = new Room(code, this.store, opts);
    this.rooms.set(code, room);
    return room;
  }
  get(code) { return this.rooms.get(String(code || '').trim()) || null; }
  close(code) {
    const r = this.get(code);
    if (!r) return;
    r.everyone({ t: 'closed' });
    for (const p of r.list()) try { p.conn?.close(); } catch {}
    r.dispose();
    this.rooms.delete(r.code);
  }
}
export { validateCustom, DEFAULT_PROFILE, cleanProfile };
