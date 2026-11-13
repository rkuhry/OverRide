import { fmt, L, near, yesNo, itemAt, product, products, breakdown } from '../helpers.js';

const skills = [];
const S = (id, level, name, gen) => skills.push({ id, level, name, gen });

S('shop.read-price', 'A', 'Read a price tag', (r) => {
  const d = r.int(1, 15);
  const it = itemAt(r, d);
  return {
    prompt: `How much is the ${it.n}?`, short: 'How much?', stim: product(it),
    correct: L(fmt(it.p)), wrong: near(d, [d + 1, d - 1, d + 10, d + 2, d - 2], 1).map((v) => L(fmt(v * 100))),
    hint: { text: 'Read the number on the price tag.' },
  };
});

S('shop.enough', 'A', 'Decide if you have enough money', (r) => {
  const h = r.pick([1, 5, 5, 10, 10, 20]);
  let p = r.int(Math.max(1, h - 6), h + 6);
  if (p === h) p += r.chance(0.5) && h > 1 ? -1 : 1;
  const it = itemAt(r, p);
  return {
    prompt: `You have ${fmt(h * 100)}. The ${it.n} costs ${fmt(p * 100)}. Do you have enough money?`, short: 'Enough money?',
    stim: { t: 'buy', have: breakdown(h * 100), items: [it] }, ...yesNo(h >= p),
    hint: { text: `Is ${h} the same as or more than ${p}?` },
  };
});

S('shop.cheaper', 'A', 'Compare two prices', (r, { n }) => {
  const used = [];
  const prices = r.sample([1, 2, 3, 4, 5, 6, 8, 9, 10, 12], Math.max(2, n));
  const items = prices.map((d) => itemAt(r, d, used));
  const low = Math.min(...prices);
  return {
    prompt: n > 2 ? 'Which one costs the least?' : 'Which one costs less?', short: n > 2 ? 'Costs the least?' : 'Costs less?',
    correct: { vis: product(items.find((i) => i.p === low * 100)) },
    wrong: items.filter((i) => i.p !== low * 100).map((i) => ({ vis: product(i) })),
    hint: { text: 'Find the smallest price.' },
  };
});

S('shop.under', 'B', 'Choose an item under a price limit', (r) => {
  const lim = r.pick([3, 5, 10, 20]);
  const used = [];
  const ok = itemAt(r, r.int(1, lim - 1), used);
  const over = r.sample([1, 2, 3, 4, 5, 7], 3).map((x) => itemAt(r, lim + x, used));
  return {
    prompt: `Choose one that costs under ${fmt(lim * 100)}.`, short: `Under ${fmt(lim * 100)}?`,
    correct: { vis: product(ok) }, wrong: over.map((i) => ({ vis: product(i) })),
    hint: { text: `Find a price smaller than ${lim}.` },
  };
});

S('shop.total2', 'B', 'Total two items', (r) => {
  const used = [];
  const a = itemAt(r, r.int(1, 9), used), b = itemAt(r, r.int(1, 9), used);
  const t = (a.p + b.p) / 100;
  return {
    prompt: `You buy the ${a.n} and the ${b.n}. What is the total?`, short: 'Total?', stim: products([a, b]), calc: true,
    correct: L(fmt(t * 100)),
    wrong: near(t, [t + 1, t - 1, t + 2, Math.max(a.p, b.p) / 100, t + 10, t - 2], 1).map((v) => L(fmt(v * 100))),
    hint: { text: `Add the two prices: ${a.p / 100} + ${b.p / 100}.` },
  };
});

S('shop.next-dollar', 'B', 'Round up to the next dollar', (r) => {
  const d = r.int(1, 14);
  const it = itemAt(r, d, [], r.pick([19, 25, 49, 50, 79, 89, 99]));
  const up = d + 1;
  return {
    prompt: `The ${it.n} costs ${fmt(it.p)}. You pay with dollar bills. What is the next dollar up?`, short: 'Next dollar up?',
    stim: product(it),
    correct: L(fmt(up * 100)), wrong: near(up, [d, up + 1, up + 9, d - 1], 1).map((v) => L(fmt(v * 100))),
    hint: { text: `There are cents after ${d}. Go up one more dollar.` },
  };
});

S('shop.total3', 'C', 'Total several items with cents', (r) => {
  const used = [];
  const items = [0, 1, 2].map(() => itemAt(r, r.int(1, 12), used, r.pick([0, 25, 50, 75, 50])));
  const t = items.reduce((s, i) => s + i.p, 0);
  return {
    prompt: 'You buy all three. What is the total?', short: 'Total?', stim: products(items), calc: true,
    correct: L(fmt(t)), wrong: near(t, [t + 100, t - 100, t + 25, t - 50, t + 50, t - 25], 25).map((v) => L(fmt(v))),
    hint: { text: 'Add the dollars first. Then add the cents.' },
  };
});

S('shop.sale', 'C', 'Find a sale price', (r) => {
  const d = r.int(4, 16) * 5;
  const off = r.pick([5, 10, 15, 20].filter((o) => o < d));
  const it = { ...itemAt(r, d), tag: `${fmt(off * 100)} OFF` };
  const s = d - off;
  return {
    prompt: `The ${it.n} costs ${fmt(d * 100)}. It is ${fmt(off * 100)} off today. What is the sale price?`, short: 'Sale price?',
    stim: product(it), calc: true,
    correct: L(fmt(s * 100)), wrong: near(s, [d + off, s + 5, s - 5, off, s + 10], 1).map((v) => L(fmt(v * 100))),
    hint: { text: `Take ${off} away from ${d}.` },
  };
});

S('shop.better-deal', 'C', 'Compare deals by unit price', (r) => {
  const thing = r.pick([{ n: 'sodas', e: '🥤' }, { n: 'water bottles', e: '💧' }, { n: 'pairs of socks', e: '🧦' }, { n: 'energy bars', e: '🍫' }]);
  const [u1, u2] = r.sample([1, 2, 3, 4], 2);
  const [n1, n2] = r.sample([2, 3, 4, 5, 6], 2);
  const deal = (n, u) => ({ label: `${n} for ${fmt(n * u * 100)}`, vis: { t: 'big', e: thing.e, text: `${n} for ${fmt(n * u * 100)}` } });
  return {
    prompt: `You need ${thing.n}. Which deal has the lower price for each one?`, short: 'Better deal?', calc: true,
    choices: [deal(n1, u1), deal(n2, u2)], answer: u1 < u2 ? 0 : 1,
    hint: { text: 'Divide the price by how many you get. Compare the price for one.' },
  };
});

export default { id: 'shopping', name: 'Shopping', blurb: 'Price tags, comparing prices, totals and deals.', skills };
