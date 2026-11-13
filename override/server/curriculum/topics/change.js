import { fmt, M, L, near, yesNo, itemAt } from '../helpers.js';

const skills = [];
const S = (id, level, name, gen) => skills.push({ id, level, name, gen });
const buy = (have, items, extra = {}) => ({ t: 'buy', have, items, ...extra });

S('change.left-small', 'A', 'Find the money left (small amounts)', (r) => {
  const w = r.int(2, 5), p = r.int(1, w - 1);
  const it = itemAt(r, p);
  return {
    prompt: `You have ${fmt(w * 100)}. The ${it.n} costs ${fmt(p * 100)}. How much is left?`, short: 'How much is left?',
    stim: buy(Array(w).fill(100), [it]),
    correct: L(fmt((w - p) * 100)), wrong: near(w - p, [w - p + 1, w - p - 1, p, w, w - p + 2], 1).map((v) => L(fmt(v * 100))),
    hint: { text: `Take away ${p}. Count what is left.`, vis: { t: 'takeaway', total: w, take: p } },
  };
});

S('change.back-yn', 'A', 'Know when you get change back', (r) => {
  const b = r.pick([5, 10]);
  const same = r.chance(0.35);
  const p = same ? b : r.int(1, b - 1);
  const it = itemAt(r, p);
  return {
    prompt: `You pay with a ${fmt(b * 100)} bill. The ${it.n} costs ${fmt(p * 100)}. Do you get change back?`, short: 'Change back?',
    stim: buy([b * 100], [it]), ...yesNo(p < b),
    hint: { text: 'If you pay more than the price, you get change back.' },
  };
});

S('change.whole', 'B', 'Calculate change (whole dollars)', (r) => {
  const b = r.pick([5, 10, 20]), p = r.int(1, b - 1);
  const it = itemAt(r, p);
  const c = b - p;
  return {
    prompt: `You pay with a ${fmt(b * 100)} bill. The ${it.n} costs ${fmt(p * 100)}. What is your change?`, short: 'Change?',
    stim: buy([b * 100], [it]), calc: true,
    correct: L(fmt(c * 100)), wrong: near(c, [c + 1, c - 1, c + 2, p, c + 10, c - 2], 1).map((v) => L(fmt(v * 100))),
    hint: { text: `Start at ${p}. Count up to ${b}.`, vis: { t: 'numline', from: p, to: b } },
  };
});

S('change.cents', 'C', 'Calculate change (dollars and cents)', (r) => {
  const b = r.pick([5, 10, 20]) * 100;
  const d = r.int(1, b / 100 - 1);
  const it = itemAt(r, d, [], r.pick([10, 25, 35, 40, 45, 50, 75, 89, 99]));
  const c = b - it.p;
  return {
    prompt: `You pay with a ${fmt(b)} bill. The ${it.n} costs ${fmt(it.p)}. What is your change?`, short: 'Change?',
    stim: buy([b], [it]), calc: true,
    correct: L(fmt(c)), wrong: near(c, [c + 100, c - 100, c + 10, c - 10, c + 50], 1).map((v) => L(fmt(v))),
    hint: { text: `Count up to the next dollar. Then count up to ${fmt(b)}.` },
  };
});

S('change.check', 'C', 'Check that your change is correct', (r) => {
  const b = r.pick([10, 20]) * 100;
  const d = r.int(2, b / 100 - 2);
  const it = itemAt(r, d, [], r.pick([0, 25, 50, 75]));
  const c = b - it.p;
  const right = r.chance(0.5);
  const given = right ? c : c + r.pick([100, -100, 50, -50]);
  return {
    prompt: `You pay ${fmt(b)}. The ${it.n} costs ${fmt(it.p)}. The cashier gives you ${fmt(given)}. Is that the correct change?`,
    short: `Cashier gives ${fmt(given)}. Correct?`,
    stim: buy([b], [it], { back: given }), calc: true, ...yesNo(right),
    hint: { text: `Work it out: ${fmt(b)} take away ${fmt(it.p)}.` },
  };
});

export default { id: 'change', name: 'Making change', blurb: 'Money left over, change back, checking change.', skills };
