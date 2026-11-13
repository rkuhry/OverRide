import { fmt, M, L, near, yesNo, itemAt, product, breakdown, table } from '../helpers.js';

const skills = [];
const S = (id, level, name, gen) => skills.push({ id, level, name, gen });

S('budget.can-buy', 'A', 'Stay within a spending limit', (r) => {
  const lim = r.pick([5, 10, 20]);
  let p = r.int(Math.max(1, lim - 5), lim + 5);
  if (p === lim) p += 1;
  const it = itemAt(r, p);
  return {
    prompt: `Your spending limit is ${fmt(lim * 100)}. The ${it.n} costs ${fmt(p * 100)}. Can you buy it?`, short: 'Can you buy it?',
    stim: { t: 'buy', have: breakdown(lim * 100), items: [it], haveLabel: 'Limit' }, ...yesNo(p <= lim),
    hint: { text: `Is ${p} the same as or less than ${lim}?` },
  };
});

S('budget.pick', 'A', 'Choose what you can afford', (r) => {
  const h = r.pick([5, 10]);
  const used = [];
  const ok = itemAt(r, r.int(1, h), used);
  const over = r.sample([1, 2, 3, 5, 8], 3).map((x) => itemAt(r, h + x, used));
  return {
    prompt: `You have ${fmt(h * 100)}. Which one can you buy?`, short: `You have ${fmt(h * 100)}. Pick one.`,
    stim: M(breakdown(h * 100), 'You have'),
    correct: { vis: product(ok) }, wrong: over.map((i) => ({ vis: product(i) })),
    hint: { text: `Find a price that is ${h} or less.` },
  };
});

S('budget.both', 'B', 'Check if two items fit a limit', (r) => {
  const lim = r.pick([10, 15, 20, 25]);
  const used = [];
  const a = itemAt(r, r.int(2, lim - 3), used);
  const b = itemAt(r, r.int(2, Math.max(3, lim - a.p / 100 + 4)), used);
  const t = (a.p + b.p) / 100;
  return {
    prompt: `Your limit is ${fmt(lim * 100)}. Can you buy both?`, short: `Limit ${fmt(lim * 100)}. Buy both?`,
    stim: { t: 'buy', have: breakdown(lim * 100), items: [a, b], haveLabel: 'Limit' }, calc: true, ...yesNo(t <= lim),
    hint: { text: `Add the prices: ${a.p / 100} + ${b.p / 100}. Compare with ${lim}.` },
  };
});

S('budget.left', 'B', 'Find what is left after spending', (r) => {
  const h = r.pick([10, 20, 30, 40, 50]);
  const s = r.int(2, h - 2);
  const what = r.pick(['lunch', 'a bus pass', 'groceries', 'a haircut', 'a phone bill']);
  return {
    prompt: `You have ${fmt(h * 100)}. You spend ${fmt(s * 100)} on ${what}. How much is left?`, short: 'How much is left?',
    stim: table('Your money', ['', ''], [['You have', fmt(h * 100)], [`Spend on ${what}`, fmt(s * 100)]]), calc: true,
    correct: L(fmt((h - s) * 100)), wrong: near(h - s, [h - s + 1, h - s - 1, h - s + 10, s, h - s + 2, h - s - 10], 1).map((v) => L(fmt(v * 100))),
    hint: { text: `Take ${s} away from ${h}.` },
  };
});

S('budget.plan-left', 'C', 'Plan expenses within a budget', (r) => {
  const b = r.pick([40, 50, 60, 80, 100]);
  const a = r.int(8, Math.floor(b / 2) - 2), c = r.int(5, Math.floor(b / 2) - 4);
  const [n1, n2] = r.sample(['Food', 'Bus pass', 'Phone', 'Laundry', 'Movie', 'Haircut'], 2);
  const left = b - a - c;
  return {
    prompt: 'How much is left in your budget this week?', short: 'How much is left?',
    stim: table('This week', ['', ''], [['Budget', fmt(b * 100)], [n1, fmt(a * 100)], [n2, fmt(c * 100)]]), calc: true,
    correct: L(fmt(left * 100)), wrong: near(left, [b - a, b - c, a + c, left + 10, left - 10, left + 5], 1).map((v) => L(fmt(v * 100))),
    hint: { text: `Add what you spent: ${a} + ${c}. Take that away from ${b}.` },
  };
});

S('budget.save', 'C', 'Plan savings over several weeks', (r) => {
  const w = r.pick([5, 10, 15, 20, 25]), k = r.int(3, 8);
  const t = w * k;
  return {
    prompt: `You save ${fmt(w * 100)} each week. How much do you have after ${k} weeks?`, short: `${fmt(w * 100)} a week. ${k} weeks. Total?`,
    stim: { t: 'big', e: '🏦', text: `${fmt(w * 100)} each week`, sub: `${k} weeks` }, calc: true,
    correct: L(fmt(t * 100)), wrong: near(t, [t + w, t - w, w + k, t + 10, t - 10], 1).map((v) => L(fmt(v * 100))),
    hint: { text: `Multiply: ${w} × ${k}. Or add ${w} again and again, ${k} times.` },
  };
});

S('budget.need-more', 'C', 'Find how much more you need', (r) => {
  const p = r.int(5, 14) * 5;
  const it = itemAt(r, p);
  const have = r.int(2, p / 5 - 1) * 5;
  const need = p - have;
  return {
    prompt: `The ${it.n} costs ${fmt(p * 100)}. You saved ${fmt(have * 100)}. How much more do you need?`, short: 'How much more?',
    stim: { t: 'buy', have: breakdown(have * 100), items: [it], haveLabel: 'Saved' }, calc: true,
    correct: L(fmt(need * 100)), wrong: near(need, [need + 5, need - 5, p + have, need + 10, have], 1).map((v) => L(fmt(v * 100))),
    hint: { text: `Start at ${have}. Count up to ${p}.` },
  };
});

S('budget.pair', 'C', 'Choose a pair of items within a limit', (r) => {
  const lim = r.pick([10, 15, 20]);
  const pair = (a, b) => { const used = []; return { vis: { t: 'pair', items: [itemAt(r, a, used), itemAt(r, b, used)] } }; };
  const a = r.int(2, lim - 3), b = r.int(2, lim - a);
  const wrong = [1, 2, 4].map((over) => { const x = r.int(3, lim - 1); return pair(x, lim - x + over); });
  return {
    prompt: `Your limit is ${fmt(lim * 100)}. Which pair can you buy?`, short: `Limit ${fmt(lim * 100)}. Which pair?`, calc: true,
    correct: pair(a, b), wrong,
    hint: { text: `Add each pair. Find a total of ${lim} or less.` },
  };
});

export default { id: 'budget', name: 'Budgeting', blurb: 'Spending limits, money left, saving and planning.', skills };
