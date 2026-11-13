// Question and curriculum engine.
// Topics are plain data modules: { id, name, blurb, skills: [{ id, level, name, gen }] }.
// A generator returns a description of one question. It never touches the UI.
import money from './topics/money.js';
import change from './topics/change.js';
import shopping from './topics/shopping.js';
import budget from './topics/budget.js';
import time from './topics/time.js';
import measure from './topics/measure.js';
import cooking from './topics/cooking.js';
import work from './topics/work.js';
import { fmt, coin, tm, sum, makeRng } from './helpers.js';

export const TOPICS = [money, change, shopping, budget, time, measure, cooking, work];
export const LEVELS = { A: 'Foundational', B: 'Developing', C: 'Applied' };
const TOPIC_IDS = TOPICS.map((t) => t.id);

export const DEFAULT_PROFILE = {
  topics: { money: 'B', shopping: 'B', time: 'B' }, // topic id -> tier; missing = off
  choices: 3,        // 2, 3 or 4 answer choices
  readAloud: false,  // read prompts aloud automatically
  minimal: false,    // shortest wording
  large: false,      // larger visuals and text
  contrast: false,   // high-contrast presentation
  calm: false,       // reduced distractions (no background motion or music)
  calculator: false, // on-screen calculator allowed
  hints: true,       // student can ask for a hint
  warp: false,       // fast travel: tap a place on the map to jump there
};

export function cleanProfile(p, base = DEFAULT_PROFILE) {
  const out = { ...base, topics: { ...base.topics } };
  if (!p || typeof p !== 'object') return out;
  if (p.topics && typeof p.topics === 'object') {
    const t = {};
    for (const id of TOPIC_IDS) if (['A', 'B', 'C'].includes(p.topics[id])) t[id] = p.topics[id];
    if (Object.keys(t).length) out.topics = t;
  }
  if ([2, 3, 4].includes(Number(p.choices))) out.choices = Number(p.choices);
  for (const k of ['readAloud', 'minimal', 'large', 'contrast', 'calm', 'calculator', 'hints', 'warp']) if (typeof p[k] === 'boolean') out[k] = p[k];
  return out;
}

export function curriculumMeta() {
  return {
    levels: LEVELS,
    topics: TOPICS.map((t) => ({ id: t.id, name: t.name, blurb: t.blurb, skills: t.skills.map((s) => ({ id: s.id, level: s.level, name: s.name })) })),
  };
}

function describe(c) {
  if (c.label) return c.label;
  const v = c.vis || {};
  if (v.t === 'money') { const t = sum(v.items); return t < 100 ? coin(t) : fmt(t); }
  if (v.t === 'clock') return tm(v.h, v.m);
  if (v.t === 'product') return `${v.n} (${fmt(v.p)})`;
  if (v.t === 'pair') return v.items.map((i) => `${i.n} ${fmt(i.p)}`).join(' + ');
  if (v.t === 'container') return v.label || `container size ${v.scale}`;
  if (v.t === 'bar') return `length ${v.len}`;
  if (v.t === 'count') return `${v.n}`;
  if (v.t === 'big') return v.text;
  return 'picture';
}
const keyOf = (c) => JSON.stringify([c.label || null, c.vis || null]);

export function validateCustom(q) {
  if (!q || typeof q !== 'object') return null;
  const str = (s, n) => String(s ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, n);
  const choices = (Array.isArray(q.choices) ? q.choices : []).map((c) => str(c, 40)).filter(Boolean).slice(0, 4);
  const answer = Number(q.answer);
  const prompt = str(q.prompt, 160);
  if (!prompt || choices.length < 2 || !(answer >= 0 && answer < choices.length)) return null;
  if (new Set(choices).size !== choices.length) return null;
  return {
    id: str(q.id, 40) || null, topic: TOPIC_IDS.includes(q.topic) ? q.topic : 'money', level: ['A', 'B', 'C'].includes(q.level) ? q.level : 'A',
    prompt, short: str(q.short, 60), emoji: str(q.emoji, 8), text: str(q.text, 60), choices, answer, hint: str(q.hint, 120),
  };
}

const customSkill = (q) => ({
  id: `custom.${q.id}`, level: q.level, name: `Teacher question: ${q.prompt.slice(0, 40)}`,
  gen: () => ({
    prompt: q.prompt, short: q.short || q.prompt,
    stim: q.emoji || q.text ? { t: 'big', e: q.emoji || '', text: q.text || '' } : null,
    correct: { label: q.choices[q.answer] }, wrong: q.choices.filter((_, i) => i !== q.answer).map((label) => ({ label })),
    hint: q.hint ? { text: q.hint } : null,
  }),
});

let counter = 0;

// Build one question for a topic and tier, shaped by the number of answer choices.
export function makeQuestion({ topic, level, n = 3, avoid = [], custom = [], rng = makeRng() }) {
  const t = TOPICS.find((x) => x.id === topic) || TOPICS[0];
  let pool = [...t.skills.filter((s) => s.level === level), ...custom.filter((q) => q.topic === t.id && q.level === level).map(customSkill)];
  if (!pool.length) pool = t.skills;
  const fresh = pool.filter((s) => !avoid.includes(s.id));
  const skill = rng.pick(fresh.length ? fresh : pool);
  const raw = skill.gen(rng, { n });
  let choices, answer;
  if (raw.choices) {
    choices = raw.choices; answer = raw.answer;
  } else {
    const seen = new Set([keyOf(raw.correct)]);
    const wrong = [];
    for (const w of raw.wrong) { const k = keyOf(w); if (!seen.has(k)) { seen.add(k); wrong.push(w); } }
    choices = rng.shuffle([raw.correct, ...wrong.slice(0, Math.max(1, n - 1))]);
    answer = choices.indexOf(raw.correct);
  }
  choices = choices.map((c, i) => ({ id: `c${i}`, ...c }));
  return {
    id: `q${Date.now().toString(36)}${(counter++).toString(36)}`,
    topic: t.id, level: skill.level, skill: skill.id, skillName: skill.name,
    prompt: raw.prompt, short: raw.short || raw.prompt, stim: raw.stim || null, calc: !!raw.calc,
    choices, answerId: choices[answer].id, answerText: describe(choices[answer]),
    hint: raw.hint || { text: 'Take your time. Look at each choice.' },
    describe: (id) => { const c = choices.find((x) => x.id === id); return c ? describe(c) : ''; },
  };
}

// What the student device is allowed to see: no answer, no hint until earned.
export function publicQuestion(q, profile) {
  return {
    id: q.id, prompt: profile.minimal ? q.short : q.prompt, stim: q.stim, calc: q.calc,
    choices: q.choices.map(({ id, label, vis, icon }) => ({ id, label, vis, icon })),
  };
}
