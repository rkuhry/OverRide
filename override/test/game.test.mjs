import test from 'node:test';
import assert from 'node:assert/strict';
import * as G from '../server/game.js';
import { makeRng } from '../server/curriculum/helpers.js';

const mk = (n, mode = 'ffa', teams = 3) => {
  const players = Array.from({ length: n }, (_, i) => ({ id: `p${i}`, team: mode === 'teams' ? i % teams : null, charge: 0, tokens: 1, plan: [], locked: false, stats: G.newStats() }));
  return { players, match: G.createMatch({ players, mode, rounds: 4 }) };
};
const P = (h, n = 1) => Array.from({ length: n }, () => ({ type: 'power', hex: h }));

test('the city map: 25 zones in 8 districts around the Core', () => {
  const city = G.buildCity();
  assert.equal(city.hexes.length, 25);
  assert.equal(city.hexes[0].type, 'core'); assert.equal(city.hexes[0].value, 3);
  assert.equal(city.hexes.filter((h) => h.type === 'power').length, 2);
  assert.equal(new Set(city.hexes.map((h) => h.name)).size, 25, 'zone names are unique');
  assert.equal(new Set(city.hexes.map((h) => h.district)).size, 9);
  assert.equal(city.nbrs[0].length, 4);
  assert.ok(city.nbrs.every((n) => n.length >= 2));
  assert.equal(mk(15).match.hexes.length, 25); assert.equal(mk(3).match.hexes.length, 25);
  // the old hex board still builds, for any future board mode
  assert.equal(G.buildMap(2).hexes.length, 19);
});

test('plans are limited by charge, ownership and one-use abilities', () => {
  const { players, match } = mk(3);
  const [a] = players;
  a.charge = 3;
  assert.equal(G.sanitizePlan(match, a, P(1, 10)).length, 3, 'cannot spend more than charge');
  assert.equal(G.sanitizePlan(match, a, [{ type: 'shield', hex: 1 }]).length, 0, 'cannot shield what you do not own');
  assert.equal(G.sanitizePlan(match, a, [{ type: 'jam', hex: 1 }]).length, 0, 'cannot jam an empty district');
  assert.equal(G.sanitizePlan(match, a, [{ type: 'power', hex: 999 }, { type: 'nuke', hex: 1 }, null, { type: 'power', hex: -1 }]).length, 0);
  match.own[1] = 'p0'; match.lvl[1] = 1;
  a.charge = 9;
  assert.equal(G.sanitizePlan(match, a, [{ type: 'shield', hex: 1 }, { type: 'shield', hex: 1 }, { type: 'surge', hex: 1 }]).length, 2, 'one shield, one surge');
  assert.equal(G.sanitizePlan(match, a, [{ type: 'override', hex: 2 }, { type: 'override', hex: 3 }]).length, 1, 'one override');
  a.tokens = 0;
  assert.equal(G.sanitizePlan(match, a, [{ type: 'override', hex: 2 }]).length, 0);
});

test('capture, defense, wear-down and firewall', () => {
  const { players, match } = mk(3);
  const [a, b] = players;
  const rng = makeRng(1);
  a.charge = 5; b.charge = 5;
  a.plan = P(7, 2); b.plan = P(8, 1);
  let res = G.resolveRound(match, players, rng);
  assert.equal(match.own[7], 'p0'); assert.equal(match.lvl[7], 2); assert.equal(match.own[8], 'p1');
  assert.equal(a.charge, 3); assert.equal(b.charge, 4);
  assert.equal(res.gains.find((g) => g.side === 'p0').zones, 1);
  // Equal power does not take a district, but wears it down.
  b.plan = P(7, 2);
  G.resolveRound(match, players, rng);
  assert.equal(match.own[7], 'p0'); assert.equal(match.lvl[7], 1);
  assert.equal(a.stats.defended, 1);
  // More power than its level takes it.
  b.plan = P(7, 2);
  G.resolveRound(match, players, rng);
  assert.equal(match.own[7], 'p1'); assert.equal(match.lvl[7], 1);
  // Labs have a firewall: +1 defense.
  const lab = match.hexes.find((h) => h.type === 'lab').id;
  match.own[lab] = 'p0'; match.lvl[lab] = 1; b.charge = 9;
  b.plan = P(lab, 2);
  G.resolveRound(match, players, rng);
  assert.equal(match.own[lab], 'p0', 'firewall holds against 2');
  b.plan = P(lab, 3);
  G.resolveRound(match, players, rng);
  assert.equal(match.own[lab], 'p1');
});

test('shield blocks attacks, jams and overrides; a blocked override keeps its token', () => {
  const { players, match } = mk(3);
  const [a, b, c] = players;
  match.own[5] = 'p0'; match.lvl[5] = 1; match.holder[5] = 'p0';
  a.charge = 9; b.charge = 9; c.charge = 9;
  a.plan = [{ type: 'shield', hex: 5 }];
  b.plan = [{ type: 'override', hex: 5 }, ...P(5, 4)];
  c.plan = [{ type: 'jam', hex: 5 }];
  const res = G.resolveRound(match, players, makeRng(2));
  assert.equal(match.own[5], 'p0');
  assert.equal(b.tokens, 1, 'token refunded');
  assert.ok(res.events.some((e) => e.k === 'blocked'));
  assert.ok(!res.jammed.includes(5));
  assert.ok(a.stats.defended >= 1);
});

test('override takes a strong district; ties go to the underdog', () => {
  const { players, match } = mk(3);
  const [a, b, c] = players;
  match.own[0] = 'p0'; match.lvl[0] = 3; match.holder[0] = 'p0';
  match.sides.p1.score = 10; match.sides.p2.score = 2;
  b.plan = [{ type: 'override', hex: 0 }]; c.plan = [{ type: 'override', hex: 0 }];
  G.resolveRound(match, players, makeRng(3));
  assert.equal(match.own[0], 'p2', 'lower score wins the tie');
  assert.equal(c.tokens, 0); assert.equal(b.tokens, 1, 'loser keeps the token');
  assert.equal(match.lvl[0], 2);
  // Equal bids on an empty district: underdog again, every time.
  for (let s = 0; s < 20; s++) {
    const g = mk(2); g.match.sides.p0.score = 5;
    g.players[0].charge = 2; g.players[1].charge = 2;
    g.players[0].plan = P(3, 2); g.players[1].plan = P(3, 2);
    G.resolveRound(g.match, g.players, makeRng(s));
    assert.equal(g.match.own[3], 'p1');
  }
});

test('scoring: values, hotspots, surge, jam, links and station income', () => {
  const { players, match } = mk(3);
  const [a, b] = players;
  const station = match.hexes.find((h) => h.type === 'power').id;
  const vault = match.nbrs[0].find((h) => match.hexes[h].type === 'vault');
  match.own[0] = 'p0'; match.lvl[0] = 1; match.holder[0] = 'p0';           // core: 3
  match.own[vault] = 'p0'; match.lvl[vault] = 1; match.holder[vault] = 'p0'; // vault: 2, touches core
  match.own[station] = 'p1'; match.lvl[station] = 1; match.holder[station] = 'p1';
  match.hotspots = [station];
  a.charge = 4; b.charge = 4;
  a.plan = [{ type: 'surge', hex: vault }];
  let res = G.resolveRound(match, players, makeRng(4));
  const ga = res.gains.find((g) => g.side === 'p0'), gb = res.gains.find((g) => g.side === 'p1');
  assert.equal(ga.pts, 3 + 4); assert.equal(ga.link, 1); assert.equal(ga.total, 8);
  assert.equal(gb.pts, 1 + 2);
  assert.equal(match.income.p1, 1);
  G.startRound(match, players, makeRng(5));
  assert.equal(b.roundGain.station, 1);
  match.hotspots = [];
  a.plan = [{ type: 'jam', hex: station }];
  res = G.resolveRound(match, players, makeRng(6));
  assert.equal(res.gains.find((g) => g.side === 'p1').pts, 0, 'jammed district scores nothing');
  assert.equal(match.income.p1, undefined, 'jammed station gives no charge');
});

test('comeback power goes to the bottom third only', () => {
  const { players, match } = mk(6);
  match.round = 1;
  players.forEach((p, i) => { match.sides[p.id].score = i * 3; });
  G.startRound(match, players, makeRng(1));
  assert.deepEqual(players.map((p) => p.roundGain.backup), [1, 1, 0, 0, 0, 0]);
  assert.equal(players[0].charge, 2); assert.equal(players[5].charge, 1);
  assert.equal(match.hotspots.length, 3);
});

test('teams share districts and pool power', () => {
  const { players, match } = mk(6, 'teams', 3);
  players.forEach((p) => { p.charge = 3; });
  players[0].plan = P(4, 1); players[3].plan = P(4, 1); // same team: T0
  players[1].plan = P(4, 1);                             // T1 alone
  G.resolveRound(match, players, makeRng(1));
  assert.equal(match.own[4], 'T0'); assert.equal(match.lvl[4], 2);
  assert.equal(Object.keys(match.sides).length, 3);
});

test('a full 15-player match ends with a ranking and several different awards', () => {
  const { players, match } = mk(15);
  const rng = makeRng(99);
  for (let round = 0; round < 4; round++) {
    G.startRound(match, players, rng);
    for (const p of players) {
      p.charge = Math.min(G.RULES.maxBank, p.charge + 4);
      const acts = [];
      for (let i = 0; i < 4; i++) acts.push({ type: rng.pick(['power', 'power', 'power', 'shield', 'jam', 'surge', 'override']), hex: rng.int(0, 24) });
      p.plan = G.sanitizePlan(match, p, acts);
    }
    const res = G.resolveRound(match, players, rng);
    for (const p of players) assert.ok(p.charge >= 0 && p.charge <= G.RULES.maxBank);
    assert.ok(match.lvl.every((l, i) => (match.own[i] ? l >= 1 && l <= 3 : l === 0)));
    assert.equal(res.gains.length, 15);
  }
  const fin = G.finalize(match, players);
  assert.equal(fin.ranking.length, 15);
  assert.equal(fin.ranking[0].rank, 1);
  assert.ok(fin.awards.length >= 4);
  assert.ok(new Set(fin.awards.map((a) => a.id)).size >= 3, 'awards are spread out');
});
