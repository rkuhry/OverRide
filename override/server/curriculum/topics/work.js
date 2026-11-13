import { fmt, L, near, big, table, tm, addMin, dur } from '../helpers.js';

const skills = [];
const S = (id, level, name, gen) => skills.push({ id, level, name, gen });
const JOBS = ['Grocery store', 'Movie theater', 'Coffee shop', 'Pet store', 'Warehouse', 'Library'];
const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

S('work.start', 'A', 'Read a shift start or end time', (r) => {
  const h = r.pick([7, 8, 9, 10, 11, 1, 2, 3]), len = r.int(3, 5);
  const [eh] = addMin(h, 0, len * 60);
  const start = r.chance(0.5);
  const ans = start ? h : eh, other = start ? eh : h;
  const w = [other, addMin(ans, 0, 60)[0], addMin(ans, 0, -60)[0]].filter((v, i, a) => v !== ans && a.indexOf(v) === i);
  return {
    prompt: start ? 'When does your shift start?' : 'When does your shift end?', short: start ? 'Shift starts?' : 'Shift ends?',
    stim: { t: 'span', from: [h, 0], to: [eh, 0], labels: ['Start', 'End'], title: 'Your shift' },
    correct: L(tm(ans, 0)), wrong: w.map((v) => L(tm(v, 0))),
    hint: { text: start ? 'The start time comes first.' : 'The end time comes last.' },
  };
});

S('work.pay-more', 'A', 'Compare hourly pay', (r, { n }) => {
  const rates = r.sample([11, 12, 13, 14, 15, 16, 18, 20], Math.max(2, n));
  const jobs = r.sample(JOBS, rates.length);
  const top = Math.max(...rates);
  const c = (rate) => ({ label: `${fmt(rate * 100)} an hour`, vis: big('💵', `${fmt(rate * 100)} an hour`, jobs[rates.indexOf(rate)]) });
  return {
    prompt: 'Which job pays the most for each hour?', short: 'Pays more?',
    correct: c(top), wrong: r.shuffle(rates.filter((x) => x !== top)).map(c),
    hint: { text: 'Compare the dollar amounts. Find the biggest.' },
  };
});

S('work.schedule', 'B', 'Read a work schedule', (r) => {
  const days = r.sample(DAYS, 4).sort((a, b) => DAYS.indexOf(a) - DAYS.indexOf(b));
  const starts = r.sample([7, 8, 9, 10, 11, 12, 1, 2, 3], 4);
  const rows = days.map((d, i) => [d, `${tm(starts[i], 0)} – ${tm(addMin(starts[i], 0, 240)[0], 0)}`]);
  const i = r.int(0, 3);
  return {
    prompt: `When do you start work on ${days[i]}?`, short: `${days[i]} start?`,
    stim: { ...table('Work schedule', ['Day', 'Shift'], rows), ask: i },
    correct: L(tm(starts[i], 0)), wrong: r.shuffle(starts.filter((_, j) => j !== i)).map((s) => L(tm(s, 0))),
    hint: { text: `Find ${days[i]}. The first time is the start.` },
  };
});

S('work.hours', 'B', 'Count the hours in a shift', (r) => {
  const h = r.int(7, 11), len = r.int(2, 6);
  const [eh] = addMin(h, 0, len * 60);
  return {
    prompt: `You work from ${tm(h, 0)} to ${tm(eh, 0)}. How many hours is that?`, short: `${tm(h, 0)} to ${tm(eh, 0)}. Hours?`,
    stim: { t: 'span', from: [h, 0], to: [eh, 0], labels: ['Start', 'End'], title: 'Your shift' }, calc: true,
    correct: L(dur(len * 60)), wrong: near(len, [len + 1, len - 1, len + 2, len - 2], 1).map((v) => L(dur(v * 60))),
    hint: { text: `Count the hours from ${h} to ${eh}, one at a time.` },
  };
});

S('work.one-hour', 'B', 'Understand hourly pay', (r) => {
  const rate = r.int(11, 18), hrs = r.pick([1, 2]);
  const v = rate * hrs;
  return {
    prompt: `You earn ${fmt(rate * 100)} for each hour. How much do you earn in ${dur(hrs * 60)}?`, short: `${fmt(rate * 100)} an hour. ${dur(hrs * 60)}?`,
    stim: big('💵', `${fmt(rate * 100)} an hour`), calc: true,
    correct: L(fmt(v * 100)), wrong: near(v, [rate + hrs, hrs === 1 ? rate * 2 : rate, v + 1, v + 10, v - 1], 1).map((x) => L(fmt(x * 100))),
    hint: { text: hrs === 1 ? 'One hour pays the hourly amount.' : `Two hours: ${rate} + ${rate}.` },
  };
});

S('work.earn', 'C', 'Calculate earnings', (r) => {
  const rate = r.int(10, 18), hrs = r.int(3, 8);
  const v = rate * hrs;
  return {
    prompt: `You earn ${fmt(rate * 100)} an hour. You work ${hrs} hours. How much do you earn?`, short: `${fmt(rate * 100)} × ${hrs} hours?`,
    stim: big('💵', `${fmt(rate * 100)} an hour`, `${hrs} hours`), calc: true,
    correct: L(fmt(v * 100)), wrong: near(v, [rate * (hrs + 1), rate * (hrs - 1), rate + hrs, v + 10, v - 10], 1).map((x) => L(fmt(x * 100))),
    hint: { text: `Multiply: ${rate} × ${hrs}.` },
  };
});

S('work.shift-len', 'C', 'Find the length of a shift', (r) => {
  const h = r.int(7, 11), m = r.pick([0, 30]);
  const d = r.pick([150, 210, 270, 330, 390]);
  const [eh, em] = addMin(h, m, d);
  return {
    prompt: `Your shift is ${tm(h, m)} to ${tm(eh, em)}. How long is your shift?`, short: 'How long is the shift?',
    stim: { t: 'span', from: [h, m], to: [eh, em], labels: ['Start', 'End'], title: 'Your shift' }, calc: true,
    correct: L(dur(d)), wrong: near(d, [d + 30, d - 30, d + 60, d - 60], 30).map((v) => L(dur(v))),
    hint: { text: 'Count the full hours first. Then add the extra minutes.' },
  };
});

S('work.paycheck', 'C', 'Find take-home pay', (r) => {
  const gross = r.int(8, 30) * 10, tax = r.int(2, 8) * 4;
  const net = gross - tax;
  return {
    prompt: `You earned ${fmt(gross * 100)}. Taxes take out ${fmt(tax * 100)}. What is your take-home pay?`, short: 'Take-home pay?',
    stim: table('Pay stub', ['', ''], [['Earned', fmt(gross * 100)], ['Taxes', `− ${fmt(tax * 100)}`]]), calc: true,
    correct: L(fmt(net * 100)), wrong: near(net, [gross + tax, net + 10, net - 10, net + 2, tax], 1).map((x) => L(fmt(x * 100))),
    hint: { text: `Take ${tax} away from ${gross}.` },
  };
});

export default { id: 'work', name: 'Employment math', blurb: 'Shifts, schedules, hourly pay and earnings.', skills };
