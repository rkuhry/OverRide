// End-to-end multiplayer check: a real server, one teacher and 15 student
// sockets that walk the city at legal speed and play a whole match.
// Run with: npm run simulate
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startServer } from '../server/index.js';
import { Walker, CITY } from '../tools/walker.mjs';

const N = 15;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'override-sim-'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const done = [];
const ok = (name) => { done.push(name); console.log(`  ok  ${name}`); };
const t0 = Date.now();

class Client {
  constructor(base) { this.base = base; this.msgs = []; this.state = null; this.you = null; this.map = null; this.pp = null; this.resolves = []; this.waiters = []; this.notes = []; }
  connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.base.replace('http', 'ws') + '/ws');
      this.ws.onopen = resolve; this.ws.onerror = reject;
      this.walker = new Walker((o) => this.send(o));
      this.ws.onmessage = (e) => {
        const m = JSON.parse(e.data);
        if (m.t === 'hb') return;
        this.msgs.push(m);
        if (m.t === 'state' || m.t === 't_state') this.state = m;
        if (m.t === 'you') this.you = m;
        if (m.t === 'map') this.map = m;
        if (m.t === 'pp') this.pp = m.p;
        if (m.t === 'note') this.notes.push(m.msg);
        if (m.t === 'resolve') this.resolves.push(m);
        if (m.t === 'joined') { this.joined = m; this.walker.place(m.x, m.y); }
        if (m.t === 'pos') this.walker.correct(m.x, m.y);
        this.waiters = this.waiters.filter((w) => { if (w.pred(m)) { w.resolve(m); return false; } return true; });
      };
    });
  }
  send(o) { if (this.ws.readyState === 1) this.ws.send(JSON.stringify(o)); }
  wait(pred, what = 'message', ms = 5000) {
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(`timed out waiting for ${what}`)), ms);
      this.waiters.push({ pred, resolve: (m) => { clearTimeout(t); resolve(m); } });
    });
  }
  async until(cond, what, ms = 6000) { const t = Date.now(); while (!cond()) { if (Date.now() - t > ms) throw new Error(`timed out: ${what}`); await sleep(15); } }
  posOf(id) { return this.pp?.find((p) => p[0] === id); }
  close() { this.walker.stop(); this.ws.close(); }
}

let srv = await startServer({ port: 0, dataDir: dir, pin: '4321', quiet: true });
const base = `http://localhost:${srv.port}`;
const api = (p, opts = {}, token) => fetch(base + p, { ...opts, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) } });

try {
  // ----- teacher auth -----
  assert.equal((await api('/api/teacher/login', { method: 'POST', body: JSON.stringify({ pin: '0000' }) })).status, 401);
  const token = (await (await api('/api/teacher/login', { method: 'POST', body: JSON.stringify({ pin: '4321' }) })).json()).token;
  for (const p of ['/api/roster', '/api/reports/summary', '/api/reports/export.csv', '/api/info', '/api/questions']) assert.equal((await api(p)).status, 401, p);
  ok('teacher API rejects requests without a valid sign-in');

  const rosterKid = await (await api('/api/roster', { method: 'POST', body: JSON.stringify({ name: 'Rosa', settings: { topics: { money: 'A' }, choices: 2, readAloud: true } }) }, token)).json();

  const rogue = new Client(base); await rogue.connect();
  rogue.send({ t: 't_create', opts: {} }); await rogue.wait((m) => m.t === 't_denied', 'teacher denial');
  ok('a student socket cannot use teacher controls');

  const teacher = new Client(base); await teacher.connect();
  teacher.send({ t: 't_auth', token }); await teacher.wait((m) => m.t === 't_ok');
  teacher.send({ t: 't_create', opts: { mode: 'ffa', rounds: 2, missions: 3 } });
  const code = (await teacher.wait((m) => m.t === 't_state', 'room')).code;
  rogue.send({ t: 'join', code: '0000', name: 'Nobody' });
  assert.equal((await rogue.wait((m) => m.t === 'join_error')).msg, 'No game with that code.');
  rogue.close();
  ok(`teacher creates room ${code}; a wrong code is refused`);

  // ----- joining: 15 avatars in one city -----
  const kids = [];
  for (let i = 0; i < N; i++) {
    const c = new Client(base); await c.connect();
    c.send(i === 0 ? { t: 'join', code, rosterId: rosterKid.id } : { t: 'join', code, name: `Player${i}`, avatar: { skin: i % 6, hair: i % 10, tone: i % 6, gear: i % 6 } });
    await c.wait((m) => m.t === 'joined', `join ${i}`);
    kids.push(c);
  }
  await Promise.all([...kids, teacher].map((c) => c.until(() => c.state?.players.length === N && c.pp?.length === N, 'everyone sees 15 avatars')));
  const id = (i) => kids[i].joined.id;
  for (const c of kids) assert.ok(CITY.walkable(c.joined.x, c.joined.y), 'spawned on open ground');
  assert.equal(new Set(kids.map((c) => `${c.joined.x},${c.joined.y}`)).size, N, 'nobody spawns on top of anyone');
  ok(`${N} clients join one room; every client and the teacher see all ${N} avatars`);

  // ----- real-time movement -----
  const a = kids[1], b = kids[2];
  const start = [a.walker.x, a.walker.y];
  const dest = CITY.NODES[9];
  const tWalk = Date.now();
  const walking = a.walker.walkTo(dest.x, dest.y + 10);
  await sleep(700);
  const mid = b.posOf(id(1));
  assert.ok(Math.hypot(mid[1] - start[0], mid[2] - start[1]) > 80, 'another client sees the avatar moving while it walks');
  await walking;
  await b.until(() => { const p = b.posOf(id(1)); return Math.hypot(p[1] - dest.x, p[2] - dest.y - 10) < 2; }, 'arrival seen by others');
  await teacher.until(() => { const p = teacher.posOf(id(1)); return Math.hypot(p[1] - dest.x, p[2] - dest.y - 10) < 2; }, 'arrival seen by teacher');
  ok(`walking is shared live: another student saw the avatar mid-walk and at its destination (${((Date.now() - tWalk) / 1000).toFixed(1)}s walk)`);

  // cheating movement is refused
  const here = [a.walker.x, a.walker.y];
  a.send({ t: 'mv', x: here[0] + 900, y: here[1] });
  const fix = await a.wait((m) => m.t === 'pos', 'teleport correction');
  assert.deepEqual([fix.x, fix.y], here.map((v) => Math.round(v * 10) / 10));
  const bld = CITY.BUILDINGS.find((x) => x.x1 - x.x0 > 200);
  a.send({ t: 'mv', x: (bld.x0 + bld.x1) / 2, y: (bld.y0 + bld.y1) / 2 });
  await a.wait((m) => m.t === 'pos', 'wall correction');
  await sleep(150);
  assert.ok(Math.hypot(b.posOf(id(1))[1] - here[0], b.posOf(id(1))[2] - here[1]) < 2, 'others never saw the jump');
  ok('teleporting and walking into buildings are refused by the server and snapped back');

  // ----- differentiation (private) -----
  teacher.send({ t: 't_set', playerId: id(1), profile: { topics: { time: 'C', budget: 'C' }, choices: 4, calculator: true } });
  teacher.send({ t: 't_set', playerId: id(2), profile: { topics: { shopping: 'A' }, choices: 2, minimal: true } });
  teacher.send({ t: 't_set', playerId: id(3), profile: { warp: true } });
  await sleep(150);

  // terminals are closed in the lobby
  const t0term = CITY.TERMINALS[8];
  kids[4].send({ t: 'use', term: t0term.id });
  await kids[4].until(() => kids[4].notes.some((n) => /open when/.test(n)), 'closed terminal note');

  teacher.send({ t: 't_start' });
  await Promise.all(kids.map((c) => c.until(() => c.state?.phase === 'build' && c.you?.missions.total === 3 && c.map, 'round 1')));
  assert.equal(kids[0].map.hexes.length, 25);
  assert.ok(kids.every((c) => !c.you.q), 'nobody gets a question until they reach a terminal');

  // far from a terminal: refused
  const farTerm = CITY.TERMINALS.reduce((x, y) => (Math.hypot(y.x - kids[5].walker.x, y.y - kids[5].walker.y) > Math.hypot(x.x - kids[5].walker.x, x.y - kids[5].walker.y) ? y : x));
  kids[5].send({ t: 'use', term: farTerm.id });
  await kids[5].until(() => kids[5].notes.some((n) => /Walk up/.test(n)), 'too far note');
  ok('terminals are closed in the lobby and refuse anyone not standing at them');

  // fast travel: only with the support switched on
  kids[4].send({ t: 'warp', node: 20 }); await sleep(200);
  assert.ok(Math.hypot(kids[4].walker.x - CITY.NODES[20].x, kids[4].walker.y - CITY.NODES[20].y) > 200, 'no fast travel without the support');
  kids[3].send({ t: 'warp', term: 5 });
  await kids[3].wait((m) => m.t === 'pos', 'warp');
  assert.ok(Math.hypot(kids[3].walker.x - CITY.TERMINALS[5].x, kids[3].walker.y - CITY.TERMINALS[5].y) < CITY.TERM_REACH);
  ok('fast travel works only for a student whose teacher turned it on');

  // ----- missions: walk to terminals, answer, retries, supports -----
  async function useNearest(c) {
    const free = CITY.TERMINALS.filter((t) => !c.you.used.includes(t.id)).sort((x, y) => Math.hypot(x.x - c.walker.x, x.y - c.walker.y) - Math.hypot(y.x - c.walker.x, y.y - c.walker.y));
    const t = free[0];
    if (Math.hypot(t.x - c.walker.x, t.y - c.walker.y) > CITY.TERM_REACH) await c.walker.walkTo(...Walker.terminalSpot(t));
    c.send({ t: 'use', term: t.id });
    await c.until(() => c.you.q, 'question at terminal');
    return t;
  }
  async function solve(c, { hintFirst = false, calc = false } = {}) {
    const q = c.you.q; let tries = 0, disabled = [];
    if (hintFirst) { c.send({ t: 'hint', qid: q.id }); await c.wait((m) => m.t === 'feedback' && m.soft, 'hint'); }
    if (calc) c.send({ t: 'support', qid: q.id, kind: 'calc' });
    for (const ch of q.choices) {
      if (disabled.includes(ch.id)) continue;
      tries++;
      c.send({ t: 'answer', qid: q.id, choice: ch.id });
      const fb = await c.wait((m) => m.t === 'feedback' && m.qid === q.id && !m.soft, 'feedback');
      if (fb.correct) return tries;
      assert.ok(fb.hint?.text, 'a wrong answer gets a calm hint');
      disabled = fb.disabled;
      if (tries >= 2 && q.choices.length - disabled.length > 1) assert.ok(fb.reveal, 'the answer is shown after two misses');
    }
    throw new Error('no correct choice found');
  }
  // Player 1: tier C, 4 choices. Player 2: tier A, 2 choices. Rosa: roster settings.
  const tA = await useNearest(kids[1]);
  assert.equal(kids[1].you.q.choices.length, 4); assert.equal(kids[1].you.ui.calculator, true);
  assert.equal(kids[1].you.term.id, tA.id);
  assert.ok(kids[2].you.missions && true);
  // moving while at a terminal is refused (movement pauses for that student)
  const p1 = [kids[1].walker.x, kids[1].walker.y];
  kids[1].send({ t: 'mv', x: p1[0] + 10, y: p1[1] });
  await kids[1].wait((m) => m.t === 'pos', 'frozen at terminal');
  // leaving keeps the same question: no shopping for an easier one
  const q1 = kids[1].you.q.id;
  kids[1].send({ t: 'leave' }); await kids[1].until(() => !kids[1].you.q, 'left');
  kids[1].send({ t: 'use', term: tA.id }); await kids[1].until(() => kids[1].you.q, 'back');
  assert.equal(kids[1].you.q.id, q1, 'same question comes back');
  ok('a terminal opens the student\'s own question, pauses their movement, and keeps the question if they leave');

  await useNearest(kids[2]);
  assert.equal(kids[2].you.q.choices.length, 2);
  await useNearest(kids[0]);
  assert.equal(kids[0].you.q.choices.length, 2); assert.equal(kids[0].you.ui.readAloud, true);
  for (const c of kids) {
    const raw = JSON.stringify(c.msgs);
    assert.ok(!raw.includes('answerId') && !raw.includes('"profile"') && !raw.includes('"priv"') && !raw.includes('skillName'), 'no private data on student sockets');
    assert.ok(!JSON.stringify(c.state).match(/level|topics|choices|missions|"done"/), 'public state has no academic fields');
  }
  ok('each student gets their own tier and number of choices; levels and supports never reach other students');

  // Double tap: three copies of every answer pay once.
  const k3 = kids[3];
  await useNearest(k3);
  const q3 = k3.you.q, before3 = k3.you.charge;
  for (const ch of q3.choices) for (let r = 0; r < 3; r++) k3.send({ t: 'answer', qid: q3.id, choice: ch.id });
  await k3.until(() => k3.you.missions.done === 1, 'k3 mission');
  await sleep(200);
  assert.equal(k3.you.missions.done, 1); assert.equal(k3.you.charge, before3 + 1);
  // the same terminal cannot be used twice in a round
  k3.send({ t: 'use', term: k3.you.used[0] });
  await k3.until(() => k3.notes.some((n) => /different one/.test(n)), 'used terminal note');
  ok('repeated answers pay once, and each terminal gives one mission per student per round');

  // Player 4 never plays. Player 5 gets teacher help at a terminal. Everyone else finishes.
  await useNearest(kids[5]);
  teacher.send({ t: 't_assist', playerId: id(5) });
  await kids[5].until(() => kids[5].you.missions.done === 1 && !kids[5].you.q, 'assist');
  const tries = [];
  await Promise.all(kids.map(async (c, i) => {
    if (i === 4) return;
    while (c.you.missions.done < c.you.missions.total) {
      if (!c.you.q) await useNearest(c);
      const qid = c.you.q.id;
      tries.push(await solve(c, { hintFirst: i === 6, calc: i === 1 }));
      await c.until(() => !c.you.q || c.you.q.id !== qid, 'mission closed');
    }
  }));
  assert.ok(tries.some((t) => t > 1) && tries.some((t) => t === 1));
  await teacher.until(() => teacher.state.priv.filter((p) => p.done === 3).length === N - 1, 'teacher sees progress');
  teacher.send({ t: 't_advance' });
  await Promise.all(kids.map((c) => c.until(() => c.state.phase === 'control' && !c.you.q, 'control phase')));
  const charges = kids.map((c) => c.you.charge);
  assert.ok(charges.every((x) => x === 4), `equal charge for everyone: ${charges}`);
  ok('tier A and C, retries, hints, calculator, teacher help and a student who did nothing all end with the same charge (4)');

  // ----- control: actions only inside a ring -----
  const core = CITY.NODES[0];
  kids[0].send({ t: 'act', type: 'power', hex: 24 });
  await kids[0].until(() => kids[0].notes.some((n) => /Step into the ring/.test(n)), 'outside ring note');
  assert.equal(kids[0].you.plan.length, 0);
  ok('zone actions are refused unless the student is standing in that ring');

  teacher.send({ t: 't_pause', paused: true });
  await kids[1].until(() => kids[1].state.paused, 'pause');
  teacher.send({ t: 't_advance' }); await sleep(150);
  assert.equal(teacher.state.phase, 'control', 'advance ignored while paused');
  teacher.send({ t: 't_pause', paused: false });
  await Promise.all(kids.map((c) => c.until(() => !c.state.paused, 'resume')));
  ok('pause and resume reach every client; advancing is blocked while paused');

  // Everyone walks to a ring and plays. Player 1 overrides the Core.
  const targets = kids.map((_, i) => (i === 1 ? 0 : 1 + ((i * 3) % 24)));
  await Promise.all(kids.map(async (c, i) => {
    const n = CITY.NODES[targets[i]];
    await c.walker.walkTo(...Walker.ringSpot(n));
    if (i === 1) { c.send({ t: 'act', type: 'override', hex: 0 }); c.send({ t: 'act', type: 'power', hex: 0 }); }
    else for (let k = 0; k < 6; k++) c.send({ t: 'act', type: 'power', hex: n.id }); // 6 asked, 4 affordable
    await c.until(() => c.you.plan.length === (i === 1 ? 2 : 4), `plan for ${i}`);
    c.send({ t: 'lock', locked: true });
  }));
  assert.ok(kids.filter((c, i) => i !== 1).every((c) => c.you.charge - c.you.plan.length === 0), 'nobody spends more than they have');
  // remove and re-add
  kids[2].send({ t: 'lock', locked: false }); await kids[2].until(() => !kids[2].you.locked, 'unlocked');
  kids[2].send({ t: 'unact', i: 0 }); await kids[2].until(() => kids[2].you.plan.length === 3, 'unact');
  kids[2].send({ t: 'act', type: 'power', hex: targets[2] }); await kids[2].until(() => kids[2].you.plan.length === 4, 're-add');
  kids[2].send({ t: 'lock', locked: true });
  await teacher.until(() => teacher.state.players.every((p) => p.ready), 'all ready');
  ok('all 15 walked to rings and placed moves; plans are trimmed to real charge; moves can be removed and re-added');

  // Reconnect mid-phase: drop a socket, come back with the saved token.
  const old = kids[7]; const saved = { token: old.joined.token, charge: old.you.charge, plan: old.you.plan, x: old.walker.x, y: old.walker.y };
  old.close();
  await teacher.until(() => teacher.state.players.find((p) => p.id === old.joined.id).on === false, 'teacher sees disconnect');
  const back = new Client(base); await back.connect();
  back.send({ t: 'rejoin', code, token: saved.token });
  await back.wait((m) => m.t === 'joined');
  await back.until(() => back.you && back.state && back.map && back.pp, 'state restored');
  assert.equal(back.joined.id, old.joined.id); assert.equal(back.you.charge, saved.charge);
  assert.deepEqual(back.you.plan, saved.plan); assert.equal(back.you.locked, true);
  assert.ok(Math.hypot(back.joined.x - saved.x, back.joined.y - saved.y) < 1, 'back where they were standing');
  assert.equal(teacher.state.players.length, N, 'no duplicate player');
  kids[7] = back;
  ok('a dropped iPad rejoins as the same player, where it stood, with its charge and plan');

  teacher.send({ t: 't_advance' });
  await Promise.all([...kids, teacher].map((c) => c.until(() => c.resolves.length === 1 && c.state.phase === 'results', 'resolve')));
  const ref = JSON.stringify(teacher.state.map);
  for (const c of kids) assert.equal(JSON.stringify(c.state.map), ref, 'identical map on every client');
  assert.ok(teacher.resolves[0].events.some((e) => e.k === 'override' && e.h === 0), 'override landed');
  assert.equal(teacher.state.map.own[0], id(1));
  const owned = teacher.state.map.own.filter(Boolean).length;
  assert.ok(owned >= 8, `zones taken: ${owned}`);
  ok(`one resolution, identical on all ${N + 1} screens (${owned} zones taken)`);

  // ----- round 2 and the end -----
  teacher.send({ t: 't_advance' });
  await Promise.all(kids.map((c) => c.until(() => c.state.phase === 'build' && c.state.round === 2 && c.you.used.length === 0, 'round 2')));
  const low = [...teacher.state.sides].sort((x, y) => x.score - y.score)[0];
  assert.equal(kids.find((c) => c.joined.id === low.id).you.gain.backup, 1, 'last place gets backup power');
  teacher.send({ t: 't_advance' });
  await Promise.all(kids.map((c) => c.until(() => c.state.phase === 'control', 'control 2')));
  teacher.send({ t: 't_advance' });
  await teacher.until(() => teacher.state.phase === 'results' && teacher.resolves.length === 2, 'results 2');
  teacher.send({ t: 't_advance' });
  await Promise.all([...kids, teacher].map((c) => c.until(() => c.state.phase === 'final' && c.state.final, 'final')));
  const fin = teacher.state.final;
  assert.equal(fin.ranking.length, N); assert.ok(fin.awards.length >= 3);
  assert.ok(!JSON.stringify(fin).match(/accuracy|first_try|level/), 'final screen has no academic data');
  ok(`match ends with a shared ranking and ${fin.awards.length} awards: ${fin.awards.map((x) => x.title).join(', ')}`);

  // ----- records -----
  const sum = await (await api('/api/reports/summary', {}, token)).json();
  assert.equal(sum.sessions.length, 1); assert.ok(sum.sessions[0].endedAt);
  assert.equal(sum.students.length, N - 1, 'the student who never played has no records');
  const rosa = sum.students.find((s) => s.name === 'Rosa');
  assert.equal(rosa.key, rosterKid.id); assert.equal(rosa.n, 3);
  const rep6 = await (await api(`/api/reports/student?key=${encodeURIComponent('nick:player6')}`, {}, token)).json();
  assert.equal(rep6.support, 3, 'hint use recorded as support');
  const rep5 = await (await api(`/api/reports/student?key=${encodeURIComponent('nick:player5')}`, {}, token)).json();
  assert.equal(rep5.assist, 1, 'teacher assistance recorded');
  const csv = await (await api('/api/reports/export.csv', {}, token)).text();
  const lines = csv.trim().split('\n');
  assert.equal(lines.length - 1, sum.students.reduce((s, x) => s + x.n, 0));
  assert.ok(csv.includes('teacher_assist') && csv.includes('first_try') && csv.includes('with_support'));
  ok(`attempts recorded: ${lines.length - 1} rows with first response, tries, supports and status; CSV exports`);

  for (const c of [...kids, teacher]) c.close();
  await srv.close();
  srv = await startServer({ port: 0, dataDir: dir, pin: '4321', quiet: true });
  const base2 = `http://localhost:${srv.port}`;
  const t2 = (await (await fetch(base2 + '/api/teacher/login', { method: 'POST', body: JSON.stringify({ pin: '4321' }) })).json()).token;
  const sum2 = await (await fetch(base2 + '/api/reports/summary', { headers: { Authorization: `Bearer ${t2}` } })).json();
  assert.equal(sum2.students.length, N - 1); assert.equal(sum2.sessions.length, 1);
  ok(`records survive a server restart (${srv.store.kind})`);

  console.log(`\n  All ${done.length} checks passed with ${N} walking clients in ${((Date.now() - t0) / 1000).toFixed(0)}s.\n`);
} catch (e) {
  console.error('\n  FAILED:', e.message, '\n', e.stack);
  process.exitCode = 1;
} finally {
  await srv.close();
  fs.rmSync(dir, { recursive: true, force: true });
  setTimeout(() => process.exit(), 100);
}
