// Shared helpers for question generators. All money is in cents.

export function makeRng(seed = (Math.random() * 2 ** 32) >>> 0) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const r = {
    next,
    int: (lo, hi) => lo + Math.floor(next() * (hi - lo + 1)),
    pick: (arr) => arr[Math.floor(next() * arr.length)],
    chance: (p) => next() < p,
    shuffle: (arr) => {
      const a2 = arr.slice();
      for (let i = a2.length - 1; i > 0; i--) { const j = Math.floor(next() * (i + 1)); [a2[i], a2[j]] = [a2[j], a2[i]]; }
      return a2;
    },
    sample: (arr, n) => r.shuffle(arr).slice(0, n),
  };
  return r;
}

export const fmt = (c) => (c % 100 === 0 ? `$${c / 100}` : `$${(c / 100).toFixed(2)}`);
export const coin = (c) => `${c}¢`;
export const DENOMS = [2000, 1000, 500, 100, 25, 10, 5, 1];
export const breakdown = (c) => { const out = []; for (const d of DENOMS) while (c >= d) { out.push(d); c -= d; } return out; };
export const sum = (a) => a.reduce((x, y) => x + y, 0);

// Visual specs. The client owns how these look; generators only describe them.
export const M = (items, label) => ({ t: 'money', items, ...(label ? { label } : {}) });
export const L = (label) => ({ label: String(label) });
export const clock = (h, m, mode = 'analog') => ({ t: 'clock', h, m, mode });
export const big = (e, text, sub) => ({ t: 'big', e, text, ...(sub ? { sub } : {}) });
export const table = (title, head, rows) => ({ t: 'table', title, head, rows });

export const tm = (h, m) => `${h}:${String(m).padStart(2, '0')}`;
export const addMin = (h, m, add) => {
  let t = (((h % 12) * 60 + m + add) % 720 + 720) % 720;
  const hh = Math.floor(t / 60);
  return [hh === 0 ? 12 : hh, t % 60];
};
export const dur = (min) => {
  const h = Math.floor(min / 60), m = min % 60;
  if (h && m) return `${h} hr ${m} min`;
  if (h) return `${h} ${h === 1 ? 'hour' : 'hours'}`;
  return `${m} minutes`;
};

// Unique, valid distractor values in priority order.
export function near(correct, cands, min = 0) {
  const out = [];
  for (const c of cands) if (c !== correct && c >= min && Number.isFinite(c) && !out.includes(c)) out.push(c);
  return out;
}

export const yesNo = (yes) => ({ choices: [{ label: 'YES', icon: 'yes' }, { label: 'NO', icon: 'no' }], answer: yes ? 0 : 1 });

// Things a teenager or young adult actually buys. Prices in whole dollars (lo..hi).
export const ITEMS = [
  { n: 'pizza slice', e: '🍕', lo: 2, hi: 5 }, { n: 'burger', e: '🍔', lo: 4, hi: 9 }, { n: 'taco', e: '🌮', lo: 2, hi: 4 },
  { n: 'soda', e: '🥤', lo: 1, hi: 3 }, { n: 'coffee', e: '☕', lo: 2, hi: 5 }, { n: 'sandwich', e: '🥪', lo: 4, hi: 8 },
  { n: 'order of fries', e: '🍟', lo: 2, hi: 4 }, { n: 'carton of milk', e: '🥛', lo: 2, hi: 5 }, { n: 'loaf of bread', e: '🍞', lo: 2, hi: 4 },
  { n: 'carton of eggs', e: '🥚', lo: 2, hi: 5 }, { n: 'bag of apples', e: '🍎', lo: 2, hi: 6 }, { n: 'bus pass', e: '🚌', lo: 2, hi: 6 },
  { n: 'bottle of shampoo', e: '🧴', lo: 3, hi: 8 }, { n: 'pack of socks', e: '🧦', lo: 4, hi: 10 }, { n: 'movie ticket', e: '🎟️', lo: 8, hi: 14 },
  { n: 'phone charger', e: '🔌', lo: 8, hi: 20 }, { n: 'T-shirt', e: '👕', lo: 8, hi: 22 }, { n: 'hat', e: '🧢', lo: 10, hi: 24 },
  { n: 'umbrella', e: '☂️', lo: 9, hi: 18 }, { n: 'backpack', e: '🎒', lo: 20, hi: 45 }, { n: 'headset', e: '🎧', lo: 15, hi: 60 },
  { n: 'pair of sneakers', e: '👟', lo: 30, hi: 80 }, { n: 'video game', e: '🎮', lo: 20, hi: 60 }, { n: 'jacket', e: '🧥', lo: 30, hi: 80 },
];

// An item whose usual price range includes `dollars`. `p` is in cents.
export function itemAt(r, dollars, used = [], centsPart = 0) {
  let pool = ITEMS.filter((i) => i.lo <= dollars && dollars <= i.hi && !used.includes(i.n));
  if (!pool.length) pool = ITEMS.filter((i) => !used.includes(i.n));
  pool.sort((a, b) => Math.abs((a.lo + a.hi) / 2 - dollars) - Math.abs((b.lo + b.hi) / 2 - dollars));
  const i = r.pick(pool.slice(0, 4));
  used.push(i.n);
  return { e: i.e, n: i.n, p: dollars * 100 + centsPart };
}
export const product = (it) => ({ t: 'product', e: it.e, n: it.n, p: it.p, ...(it.tag ? { tag: it.tag } : {}) });
export const products = (items) => ({ t: 'products', items });
