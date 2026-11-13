// Practice bots for trying OVERRIDE without a full class. They are test players,
// clearly named "Bot ...", and are never added automatically. They walk the city
// at normal speed, visit terminals, answer (sometimes wrongly), and contest rings.
//
//   npm run bots -- 1234 8                         join room 1234 with 8 bots
//   npm run bots -- 1234 8 http://192.168.1.20:3000
import { Walker, CITY } from './walker.mjs';

const [code, countArg = '6', base = `http://localhost:${process.env.PORT || 3000}`] = process.argv.slice(2);
if (!/^\d{4}$/.test(code || '')) { console.log('Usage: npm run bots -- <room code> [how many] [server url]'); process.exit(1); }
const NAMES = ['Nova', 'Jett', 'Rio', 'Zed', 'Kai', 'Lux', 'Echo', 'Ash', 'Onyx', 'Vex', 'Sol', 'Rune', 'Pixel', 'Blaze', 'Koda', 'Wren', 'Juno', 'Axel'];
const rnd = (n) => Math.floor(Math.random() * n);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function bot(i) {
  const name = `Bot ${NAMES[i % NAMES.length]}`;
  const ws = new WebSocket(base.replace(/^http/, 'ws') + '/ws');
  const send = (o) => ws.readyState === 1 && ws.send(JSON.stringify(o));
  const w = new Walker(send);
  const b = { you: null, state: null, busy: false, round: -1, phase: '' };
  ws.onopen = () => send({ t: 'join', code, name, avatar: { skin: rnd(6), hair: rnd(10), tone: rnd(6), gear: rnd(6) } });
  ws.onclose = () => { w.stop(); console.log(`${name} left`); };

  async function wander() { // lobby: stroll between plazas
    while (b.phase === 'lobby' && ws.readyState === 1) { const n = CITY.NODES[rnd(CITY.NODES.length)]; await w.walkTo(n.x + rnd(80) - 40, n.y + rnd(80) - 40, 0.6); await sleep(1500 + rnd(3000)); }
  }
  async function missions() {
    const round = b.state.round;
    while (b.phase === 'build' && b.state.round === round && ws.readyState === 1) {
      const you = b.you; if (!you) { await sleep(300); continue; }
      if (you.missions.done >= you.missions.total) { await w.walkTo(CITY.NODES[rnd(25)].x, CITY.NODES[rnd(25)].y, 0.5); return; }
      if (you.q) { await answer(); continue; }
      const free = CITY.TERMINALS.filter((t) => !you.used.includes(t.id));
      const t = free.sort((a, c) => Math.hypot(a.x - w.x, a.y - w.y) - Math.hypot(c.x - w.x, c.y - w.y))[rnd(Math.min(3, free.length))];
      await w.walkTo(...Walker.terminalSpot(t));
      if (b.phase !== 'build') return;
      send({ t: 'use', term: t.id });
      await sleep(600);
    }
  }
  async function answer() {
    await sleep(2000 + rnd(4000)); // bots think too
    const q = b.you?.q; if (!q) return;
    const open = q.choices.filter((c) => !(q.disabled || []).includes(c.id));
    const pick = q.reveal && Math.random() < 0.9 ? q.reveal : open[rnd(open.length)].id;
    send({ t: 'answer', qid: q.id, choice: pick });
    await sleep(1300);
  }
  async function control() {
    await sleep(1000 + rnd(3000));
    const targets = [];
    const hot = b.state.map.hot;
    for (let k = 0; k < 3; k++) targets.push(Math.random() < 0.35 && hot.length ? hot[rnd(hot.length)] : rnd(CITY.NODES.length));
    for (const h of targets) {
      if (b.phase !== 'control') return;
      const n = CITY.NODES[h];
      await w.walkTo(...Walker.ringSpot(n));
      const mine = b.state.map.own[h] === b.you.side;
      if (!mine && b.you.tokens && Math.random() < 0.25) send({ t: 'act', type: 'override', hex: h });
      else if (mine && Math.random() < 0.5) send({ t: 'act', type: 'shield', hex: h });
      for (let k = 0; k < 1 + rnd(3); k++) { send({ t: 'act', type: 'power', hex: h }); await sleep(250); }
      await sleep(500);
    }
    send({ t: 'lock', locked: true });
  }
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.t === 'join_error') { console.log(`${name}: ${m.msg}`); ws.close(); }
    if (m.t === 'joined') w.place(m.x, m.y);
    if (m.t === 'pos') w.correct(m.x, m.y);
    if (m.t === 'you') b.you = m;
    if (m.t === 'feedback' && !m.correct && b.you?.q) { b.you.q.disabled = m.disabled; b.you.q.reveal = m.reveal; }
    if (m.t === 'state') {
      const changed = m.phase !== b.phase || m.round !== b.state?.round;
      b.state = m; b.phase = m.phase;
      if (!changed) return;
      w.stop();
      if (m.phase === 'lobby') wander();
      if (m.phase === 'build') missions();
      if (m.phase === 'control') control();
    }
  };
}
const n = Math.max(1, Math.min(29, Number(countArg) || 6));
for (let i = 0; i < n; i++) { bot(i); await sleep(250); }
console.log(`${n} practice bots joining room ${code} at ${base}. Press Ctrl+C to remove them.`);
