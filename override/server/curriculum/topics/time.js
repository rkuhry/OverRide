import { L, near, clock, tm, addMin, dur, table } from '../helpers.js';

const skills = [];
const S = (id, level, name, gen) => skills.push({ id, level, name, gen });
const mins = (h, m) => (h % 12) * 60 + m;
const fromMins = (t) => addMin(12, 0, t);
// Distinct clock times other than (h, m), in priority order.
const otherTimes = (h, m, cands) => {
  const seen = [mins(h, m)], out = [];
  for (const [ch, cm] of cands) { const k = mins(ch, cm); if (!seen.includes(k)) { seen.push(k); out.push([ch, cm]); } }
  return out;
};
const wrap = (h) => ((h - 1 + 12) % 12) + 1;

S('time.find-digital', 'A', 'Identify digital time', (r) => {
  const h = r.int(1, 12), m = r.pick([0, 0, 30]);
  const w = otherTimes(h, m, [[wrap(h + 1), m], [h, m === 0 ? 30 : 0], [wrap(h + 5), m], [wrap(h - 1), m]]);
  return {
    prompt: `Find ${tm(h, m)}.`, short: `Find ${tm(h, m)}.`,
    correct: { vis: clock(h, m, 'digital') }, wrong: w.map(([a, b]) => ({ vis: clock(a, b, 'digital') })),
    hint: { text: `Look for ${h} first. Then ${String(m).padStart(2, '0')}.` },
  };
});

S('time.hour', 'A', 'Tell time to the hour', (r) => {
  const h = r.int(1, 12);
  const w = otherTimes(h, 0, [[wrap(h + 1), 0], [wrap(h - 1), 0], [h, 30], [wrap(h + 6), 0]]);
  return {
    prompt: 'What time is it?', short: 'What time?', stim: clock(h, 0),
    correct: L(tm(h, 0)), wrong: w.map(([a, b]) => L(tm(a, b))),
    hint: { text: 'The short hand points to the hour.' },
  };
});

S('time.half-quarter', 'B', 'Tell time to the half and quarter hour', (r) => {
  const h = r.int(1, 12), m = r.pick([30, 30, 15, 45]);
  const w = otherTimes(h, m, [[m / 5, (h * 5) % 60], [wrap(h + 1), m], [h, m === 30 ? 15 : 30], [wrap(h - 1), m]]);
  return {
    prompt: 'What time is it?', short: 'What time?', stim: clock(h, m),
    correct: L(tm(h, m)), wrong: w.map(([a, b]) => L(tm(a, b))),
    hint: { text: 'Short hand: hour. Long hand: minutes. Count by fives.' },
  };
});

S('time.match-analog', 'B', 'Match digital and analog time', (r) => {
  const h = r.int(1, 12), m = r.pick([0, 30, 15, 45]);
  const w = otherTimes(h, m, [[wrap(h + 1), m], [h, (m + 30) % 60], [wrap(h - 1), m], [wrap(h + 3), m]]);
  return {
    prompt: `Find the clock that shows ${tm(h, m)}.`, short: 'Same time?', stim: clock(h, m, 'digital'),
    correct: { vis: clock(h, m) }, wrong: w.map(([a, b]) => ({ vis: clock(a, b) })),
    hint: { text: `The short hand should point to ${h}${m ? ' or just past it' : ''}.` },
  };
});

const STOPS = ['Market', 'Tech Lab', 'Transit Hub', 'Central Core', 'Food District', 'Media Tower', 'Data Center'];

S('time.schedule', 'B', 'Read a schedule', (r) => {
  const stops = r.sample(STOPS, 4);
  let t = r.int(7, 9) * 60 + r.pick([0, 15, 30]);
  const rows = stops.map((s) => { const [h, m] = fromMins(t); t += r.pick([20, 30, 45]); return [s, tm(h, m)]; });
  const i = r.int(0, 3);
  return {
    prompt: `When does the bus to ${rows[i][0]} leave?`, short: `Bus to ${rows[i][0]}?`,
    stim: { ...table('GRID Transit', ['Bus to', 'Leaves'], rows), ask: i },
    correct: L(rows[i][1]), wrong: r.shuffle(rows.filter((_, j) => j !== i)).map((x) => L(x[1])),
    hint: { text: `Find ${rows[i][0]}. Read across to the time.` },
  };
});

S('time.five-min', 'C', 'Tell time to five minutes', (r) => {
  const h = r.int(1, 12), m = r.pick([5, 10, 20, 25, 35, 40, 50, 55]);
  const w = otherTimes(h, m, [[m / 5, (h * 5) % 60], addMin(h, m, 5), addMin(h, m, -5), [wrap(h + 1), m], [wrap(h - 1), m]]);
  return {
    prompt: 'What time is it?', short: 'What time?', stim: clock(h, m),
    correct: L(tm(h, m)), wrong: w.map(([a, b]) => L(tm(a, b))),
    hint: { text: 'Count by fives around the clock for the long hand.' },
  };
});

S('time.elapsed', 'C', 'Find elapsed time', (r) => {
  const h = r.int(1, 8), m = r.pick([0, 15, 30, 45]);
  const d = r.pick([30, 45, 60, 75, 90, 105, 120, 150]);
  const [eh, em] = addMin(h, m, d);
  return {
    prompt: `You start at ${tm(h, m)}. You finish at ${tm(eh, em)}. How much time passes?`, short: 'How long?',
    stim: { t: 'span', from: [h, m], to: [eh, em], labels: ['Start', 'Finish'] }, calc: true,
    correct: L(dur(d)), wrong: near(d, [d + 30, d - 30, d + 15, d - 15, d + 60], 15).map((v) => L(dur(v))),
    hint: { text: 'Count the full hours first. Then count the extra minutes.' },
  };
});

S('time.end', 'C', 'Find an end time', (r) => {
  const h = r.int(1, 9), m = r.pick([0, 15, 30, 45]);
  const d = r.pick([15, 30, 45, 60, 75, 90]);
  const what = r.pick(['The movie', 'Practice', 'Your class', 'The bus ride', 'Your break']);
  const [eh, em] = addMin(h, m, d);
  const w = otherTimes(eh, em, [addMin(h, m, d + 15), addMin(h, m, d - 15), addMin(h, m, d + 60), addMin(h, m, d + 30), [h, m]]);
  return {
    prompt: `${what} starts at ${tm(h, m)}. It lasts ${dur(d)}. When does it end?`, short: `Starts ${tm(h, m)}. Lasts ${dur(d)}. Ends?`,
    stim: { t: 'span', from: [h, m], to: null, labels: ['Start', 'End'], mid: dur(d) }, calc: true,
    correct: L(tm(eh, em)), wrong: w.map(([a, b]) => L(tm(a, b))),
    hint: { text: `Start at ${tm(h, m)}. Count forward ${dur(d)}.` },
  };
});

S('time.next-bus', 'C', 'Use a schedule to plan', (r) => {
  let t = r.int(1, 4) * 60 + r.pick([0, 10, 20]);
  const times = [0, 1, 2, 3].map(() => { const v = t; t += r.pick([20, 30, 40]); return v; });
  const i = r.int(1, 3);
  const now = times[i] - r.pick([5, 10, 15]);
  const f = (v) => tm(...fromMins(v));
  return {
    prompt: `It is ${f(now)}. When is the next bus?`, short: `It is ${f(now)}. Next bus?`,
    stim: table('Bus times', ['Leaves'], times.map((v) => [f(v)])),
    correct: L(f(times[i])), wrong: [times[i - 1], ...times.filter((_, j) => j > i), times[0]].filter((v, j, a) => v !== times[i] && a.indexOf(v) === j).map((v) => L(f(v))),
    hint: { text: `Find the first time that comes after ${f(now)}.` },
  };
});

export default { id: 'time', name: 'Time', blurb: 'Digital and analog clocks, schedules, elapsed time.', skills };
