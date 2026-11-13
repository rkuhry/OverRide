import { fmt, coin, M, L, near, breakdown, sum, itemAt, product } from '../helpers.js';

const BILLS = [100, 500, 1000, 2000];
const COINS = [1, 5, 10, 25];
const COIN_NAME = { 1: 'penny', 5: 'nickel', 10: 'dime', 25: 'quarter' };
const skills = [];
const S = (id, level, name, gen) => skills.push({ id, level, name, gen });

S('money.id-bill', 'A', 'Identify bills', (r) => {
  const c = r.pick(BILLS);
  return {
    prompt: `Find the ${fmt(c)} bill.`, short: `Find ${fmt(c)}.`,
    correct: { vis: M([c]) }, wrong: r.shuffle(BILLS.filter((b) => b !== c)).map((b) => ({ vis: M([b]) })),
    hint: { text: `Look for the number ${c / 100} on the bill.` },
  };
});

S('money.id-coin', 'A', 'Identify coins', (r) => {
  const c = r.pick(COINS);
  return {
    prompt: `Find the ${COIN_NAME[c]}.`, short: `Find the ${COIN_NAME[c]}.`,
    correct: { vis: M([c]) }, wrong: r.shuffle(COINS.filter((b) => b !== c)).map((b) => ({ vis: M([b]) })),
    hint: { text: `A ${COIN_NAME[c]} is worth ${coin(c)}.` },
  };
});

S('money.value', 'A', 'Match money to its value', (r) => {
  const bills = r.chance(0.6);
  const pool = bills ? BILLS : COINS;
  const c = r.pick(pool);
  const f = bills ? fmt : coin;
  return {
    prompt: 'How much is this worth?', short: 'How much?', stim: M([c]),
    correct: L(f(c)), wrong: r.shuffle(pool.filter((b) => b !== c)).map((b) => L(f(b))),
    hint: { text: bills ? 'Read the number in the corner.' : `This coin is a ${COIN_NAME[c]}.` },
  };
});

S('money.more', 'A', 'Compare amounts of money', (r, { n }) => {
  const pool = r.chance(0.65) ? BILLS : COINS;
  const set = r.sample(pool, Math.min(pool.length, Math.max(2, n)));
  const top = Math.max(...set);
  return {
    prompt: 'Which one is worth the most?', short: 'Which is more?',
    correct: { vis: M([top]) }, wrong: r.shuffle(set.filter((b) => b !== top)).map((b) => ({ vis: M([b]) })),
    hint: { text: 'Compare the numbers. The bigger number is worth more.' },
  };
});

S('money.count-bills', 'B', 'Count bills', (r) => {
  const k = r.int(2, 4);
  const items = Array.from({ length: k }, () => r.pick([100, 100, 100, 500, 500, 1000])).sort((a, b) => b - a);
  const t = sum(items);
  return {
    prompt: 'How much money is here?', short: 'How much?', stim: M(items), calc: true,
    correct: L(fmt(t)), wrong: near(t, [t + 100, t - 100, k * 100, t + 500, t - 500, t + 200], 100).map((v) => L(fmt(v))),
    hint: { text: 'Start with the biggest bill. Then count up.' },
  };
});

S('money.count-coins', 'B', 'Count coins', (r) => {
  const k = r.int(2, 4);
  const items = Array.from({ length: k }, () => r.pick([25, 25, 10, 10, 5])).sort((a, b) => b - a);
  const t = sum(items);
  return {
    prompt: 'How much money is here?', short: 'How much?', stim: M(items), calc: true,
    correct: L(coin(t)), wrong: near(t, [t + 5, t - 5, t + 10, t - 10, k * 10, t + 25], 5).map((v) => L(coin(v))),
    hint: { text: 'Quarter is 25. Dime is 10. Nickel is 5. Add them.' },
  };
});

S('money.match-price', 'B', 'Match money to a price', (r) => {
  const d = r.int(2, 18);
  const it = itemAt(r, d);
  const p = it.p;
  return {
    prompt: `The ${it.n} costs ${fmt(p)}. Which money pays the exact price?`, short: `Pay ${fmt(p)}.`,
    stim: product(it), calc: true,
    correct: { vis: M(breakdown(p)) },
    wrong: near(p, [p + 100, p - 100, p + 500, p - 500, p + 200], 100).map((v) => ({ vis: M(breakdown(v)) })),
    hint: { text: `Count each group. Find ${fmt(p)}.` },
  };
});

S('money.count-mixed', 'C', 'Count bills and coins together', (r) => {
  const bills = Array.from({ length: r.int(1, 3) }, () => r.pick([100, 100, 500, 1000]));
  const coins = Array.from({ length: r.int(1, 3) }, () => r.pick([25, 25, 10, 5]));
  const items = [...bills, ...coins].sort((a, b) => b - a);
  const t = sum(items);
  return {
    prompt: 'How much money is here?', short: 'How much?', stim: M(items), calc: true,
    correct: L(fmt(t)),
    wrong: near(t, [t + 10, t - 10, t + 100, t - 100, t + 25, sum(bills) + coins.length], 5).map((v) => L(fmt(v))),
    hint: { text: 'Count the bills first. Then add the coins.' },
  };
});

S('money.pay-exact', 'C', 'Pay an exact price with bills and coins', (r) => {
  const d = r.int(1, 14);
  const it = itemAt(r, d, [], r.pick([10, 25, 30, 35, 50, 60, 75, 85]));
  const p = it.p;
  return {
    prompt: `The ${it.n} costs ${fmt(p)}. Which money pays the exact price?`, short: `Pay ${fmt(p)}.`,
    stim: product(it), calc: true,
    correct: { vis: M(breakdown(p)) },
    wrong: near(p, [p + 25, p - 25, p + 100, p - 10, p + 10, p - 100], 5).map((v) => ({ vis: M(breakdown(v)) })),
    hint: { text: 'Count the bills first. Then add the coins.' },
  };
});

export default { id: 'money', name: 'Money', blurb: 'Identify, compare and count bills and coins.', skills };
