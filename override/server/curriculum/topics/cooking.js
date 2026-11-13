import { L, near, yesNo, big, table, tm, addMin } from '../helpers.js';

const skills = [];
const S = (id, level, name, gen) => skills.push({ id, level, name, gen });
const FOODS = [{ n: 'eggs', e: '🥚' }, { n: 'tomatoes', e: '🍅' }, { n: 'carrots', e: '🥕' }, { n: 'lemons', e: '🍋' }, { n: 'potatoes', e: '🥔' }];

S('cook.more', 'A', 'Compare ingredient amounts', (r, { n }) => {
  const all = [[0.25, '1/4 cup'], [0.5, '1/2 cup'], [0.75, '3/4 cup'], [1, '1 cup']];
  const set = r.sample(all, Math.max(2, n));
  const top = set.reduce((a, b) => (b[0] > a[0] ? b : a));
  const c = ([f, label]) => ({ label, vis: { t: 'container', kind: 'cup', scale: 0.8, fill: f, label } });
  return {
    prompt: 'Which is the most?', short: 'Which is more?',
    correct: c(top), wrong: r.shuffle(set.filter((x) => x !== top)).map(c),
    hint: { text: 'Look at how full each cup is.' },
  };
});

S('cook.count', 'A', 'Count out a quantity', (r) => {
  const f = r.pick(FOODS), k = r.int(2, 6);
  const c = (v) => ({ vis: { t: 'count', e: f.e, n: v } });
  return {
    prompt: `The recipe needs ${k} ${f.n}. Find ${k}.`, short: `Find ${k} ${f.n}.`,
    correct: c(k), wrong: near(k, [k + 1, k - 1, k + 2, k - 2], 1).map(c),
    hint: { text: `Count each group. Stop at ${k}.` },
  };
});

S('cook.enough', 'B', 'Check if you have enough of an ingredient', (r) => {
  const f = r.pick(FOODS), need = r.int(2, 6);
  let have = need + r.pick([-2, -1, 1, 2, 0]);
  if (have < 1) have = 1;
  return {
    prompt: `The recipe needs ${need} ${f.n}. You have ${have}. Do you have enough?`, short: `Need ${need}. Enough?`,
    stim: { t: 'count', e: f.e, n: have, label: `You have ${have}` }, ...yesNo(have >= need),
    hint: { text: `Is ${have} the same as or more than ${need}?` },
  };
});

S('cook.read', 'B', 'Read amounts from a recipe', (r) => {
  const ings = r.sample(['Flour', 'Sugar', 'Milk', 'Rice', 'Butter', 'Oil', 'Water'], 4);
  const amts = r.sample(['2 cups', '1 cup', '1/2 cup', '3 cups', '1/4 cup', '2 tablespoons', '1 teaspoon'], 4);
  const rows = ings.map((x, i) => [x, amts[i]]);
  const i = r.int(0, 3);
  return {
    prompt: `How much ${ings[i].toLowerCase()} does the recipe need?`, short: `How much ${ings[i].toLowerCase()}?`,
    stim: { ...table('Recipe', ['Ingredient', 'Amount'], rows), ask: i },
    correct: L(amts[i]), wrong: r.shuffle(amts.filter((_, j) => j !== i)).map(L),
    hint: { text: `Find ${ings[i]}. Read across to the amount.` },
  };
});

const KITCHEN = [
  { task: 'Add 1 teaspoon of salt', n: 'Measuring spoon', e: '🥄' }, { task: 'Add 2 cups of milk', n: 'Measuring cup', e: '🥛' },
  { task: 'Bake for 20 minutes', n: 'Timer', e: '⏱️' }, { task: 'Weigh 1 pound of meat', n: 'Kitchen scale', e: '⚖️' },
];

S('cook.tool', 'B', 'Select a measuring tool', (r) => {
  const t = r.pick(KITCHEN);
  const c = (x) => ({ label: x.n, vis: big(x.e, x.n) });
  return {
    prompt: `The recipe says: "${t.task}." Which tool do you use?`, short: `${t.task}. Which tool?`,
    correct: c(t), wrong: r.shuffle(KITCHEN.filter((x) => x !== t)).map(c),
    hint: { text: 'Match the tool to the word in the recipe.' },
  };
});

const AMOUNTS = [['cups', 'rice'], ['cups', 'flour'], ['tablespoons', 'oil'], ['', 'eggs'], ['cups', 'water']];
const amt = (v, unit) => (unit ? `${v} ${v === 1 ? unit.replace(/s$/, '') : unit}` : `${v}`);

S('cook.double', 'C', 'Double a recipe amount', (r) => {
  const [unit, food] = r.pick(AMOUNTS), x = r.int(1, 4);
  return {
    prompt: `The recipe uses ${amt(x, unit)} ${unit ? 'of ' : ''}${food}. You double the recipe. How much ${food} now?`, short: `Double ${amt(x, unit)}.`,
    stim: big('🍲', `${amt(x, unit)} ${food}`, 'Make double'), calc: true,
    correct: L(amt(2 * x, unit)), wrong: near(2 * x, [x + 1, x, 3 * x, 2 * x + 1, 2 * x + 2], 1).map((v) => L(amt(v, unit))),
    hint: { text: `Double means two times: ${x} + ${x}.` },
  };
});

S('cook.half', 'C', 'Halve a recipe amount', (r) => {
  const [unit, food] = r.pick(AMOUNTS), x = r.pick([2, 4, 6, 8]);
  return {
    prompt: `The recipe uses ${amt(x, unit)} ${unit ? 'of ' : ''}${food}. You make half. How much ${food} now?`, short: `Half of ${amt(x, unit)}.`,
    stim: big('🍲', `${amt(x, unit)} ${food}`, 'Make half'), calc: true,
    correct: L(amt(x / 2, unit)), wrong: near(x / 2, [x, x / 2 + 1, x * 2, x / 2 - 1, x - 1], 1).map((v) => L(amt(v, unit))),
    hint: { text: `Split ${x} into two equal groups.` },
  };
});

S('cook.timer', 'C', 'Work out when food is done', (r) => {
  const h = r.int(1, 11), m = r.pick([0, 5, 10, 15, 20, 30, 40, 45]);
  const d = r.pick([15, 20, 25, 30, 35, 45]);
  const end = addMin(h, m, d);
  const key = (t) => t[0] * 60 + t[1];
  const w = [addMin(h, m, d + 10), addMin(h, m, d - 10), addMin(h, m, d + 60), addMin(h, m, d + 5)]
    .filter((t, i, a) => key(t) !== key(end) && a.findIndex((u) => key(u) === key(t)) === i);
  return {
    prompt: `You put the food in at ${tm(h, m)}. It bakes for ${d} minutes. When is it done?`, short: `In at ${tm(h, m)}. ${d} minutes. Done?`,
    stim: { t: 'span', from: [h, m], to: null, labels: ['In', 'Done'], mid: `${d} min` }, calc: true,
    correct: L(tm(...end)), wrong: w.map((t) => L(tm(...t))),
    hint: { text: `Start at ${tm(h, m)}. Count forward ${d} minutes.` },
  };
});

export default { id: 'cooking', name: 'Cooking math', blurb: 'Quantities, measuring tools, recipes and timing.', skills };
