import { L, near, yesNo, big } from '../helpers.js';

const skills = [];
const S = (id, level, name, gen) => skills.push({ id, level, name, gen });

S('measure.holds-more', 'A', 'Compare container sizes', (r, { n }) => {
  const kind = r.pick(['cup', 'jug', 'bottle']);
  const sizes = r.sample([0.45, 0.65, 0.85, 1.1], Math.max(2, n));
  const top = Math.max(...sizes);
  const c = (s) => ({ vis: { t: 'container', kind, scale: s, fill: 0.8 } });
  return {
    prompt: 'Which one holds the most?', short: 'Holds more?',
    correct: c(top), wrong: r.shuffle(sizes.filter((s) => s !== top)).map(c),
    hint: { text: 'The biggest container holds the most.' },
  };
});

S('measure.longer', 'A', 'Compare lengths', (r, { n }) => {
  const lens = r.sample([25, 45, 65, 85, 100], Math.max(2, n));
  const longer = r.chance(0.6);
  const target = longer ? Math.max(...lens) : Math.min(...lens);
  const c = (len) => ({ vis: { t: 'bar', len } });
  return {
    prompt: longer ? 'Which cable is the longest?' : 'Which cable is the shortest?', short: longer ? 'Longest?' : 'Shortest?',
    correct: c(target), wrong: r.shuffle(lens.filter((x) => x !== target)).map(c),
    hint: { text: longer ? 'Look for the one that reaches the farthest.' : 'Look for the one that ends first.' },
  };
});

const TOOLS = [
  { e: '📏', n: 'Ruler', q: 'how long something is' }, { e: '⚖️', n: 'Scale', q: 'how heavy something is' },
  { e: '🌡️', n: 'Thermometer', q: 'how hot or cold it is' }, { e: '⏱️', n: 'Timer', q: 'how much time passes' },
];

S('measure.tool', 'A', 'Identify measurement tools', (r) => {
  const t = r.pick(TOOLS);
  const c = (x) => ({ label: x.n, vis: big(x.e, x.n) });
  return {
    prompt: `Which tool measures ${t.q}?`, short: `Measures ${t.q}?`,
    correct: c(t), wrong: r.shuffle(TOOLS.filter((x) => x !== t)).map(c),
    hint: { text: `Think about what a ${t.n.toLowerCase()} is used for.` },
  };
});

S('measure.ruler', 'B', 'Measure a length with a ruler', (r) => {
  const len = r.int(2, 10);
  return {
    prompt: 'How long is the cable?', short: 'How long?', stim: { t: 'ruler', len, max: 12, unit: 'in' },
    correct: L(`${len} inches`), wrong: near(len, [len + 1, len - 1, len + 2, 12], 1).map((v) => L(`${v} inches`)),
    hint: { text: 'Find where the cable ends. Read the number below it.' },
  };
});

const UNITS = [['milk', 'gallons'], ['a road trip', 'miles'], ['your height', 'feet and inches'], ['a bag of rice', 'pounds'],
  ['the heat of an oven', 'degrees'], ['the length of a TV show', 'minutes']];

S('measure.unit', 'B', 'Choose a sensible unit', (r) => {
  const [what, unit] = r.pick(UNITS);
  return {
    prompt: `What do we use to measure ${what}?`, short: `Measure ${what}?`,
    correct: L(unit), wrong: r.shuffle(UNITS.filter((u) => u[1] !== unit)).map((u) => L(u[1])),
    hint: { text: 'Think about where you have seen this measured.' },
  };
});

const FACTS = [['foot', 'feet', 'inches', 12], ['pound', 'pounds', 'ounces', 16], ['hour', 'hours', 'minutes', 60],
  ['yard', 'yards', 'feet', 3], ['gallon', 'gallons', 'quarts', 4], ['cup', 'cups', 'ounces', 8]];

S('measure.convert', 'C', 'Convert between units', (r) => {
  const [one, many, small, k] = r.pick(FACTS);
  const n = r.int(2, 5);
  const v = n * k;
  return {
    prompt: `How many ${small} are in ${n} ${many}?`, short: `${n} ${many} = ? ${small}`,
    stim: big('📐', `1 ${one} = ${k} ${small}`), calc: true,
    correct: L(`${v} ${small}`), wrong: near(v, [(n + 1) * k, (n - 1) * k, n + k, k, v + 2], 1).map((x) => L(`${x} ${small}`)),
    hint: { text: `Multiply: ${n} × ${k}.` },
  };
});

S('measure.fits', 'C', 'Decide if something fits', (r) => {
  const space = r.int(24, 40);
  const obj = space + r.pick([-8, -5, -2, 2, 4, 7]);
  const thing = r.pick([{ n: 'TV', e: '📺' }, { n: 'desk', e: '🪑' }, { n: 'shelf', e: '🗄️' }, { n: 'fridge', e: '🧊' }]);
  return {
    prompt: `The space is ${space} inches wide. The ${thing.n} is ${obj} inches wide. Will it fit?`, short: 'Will it fit?',
    stim: big(thing.e, `${thing.n}: ${obj} in`, `Space: ${space} in`), ...yesNo(obj <= space),
    hint: { text: `It fits if ${obj} is the same as or less than ${space}.` },
  };
});

export default { id: 'measure', name: 'Measurement', blurb: 'Sizes, tools, rulers and units.', skills };
