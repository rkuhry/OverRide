// Checks every built-in skill many times over: one correct answer, distinct
// plausible choices, and independently recomputed arithmetic where possible.
import test from 'node:test';
import assert from 'node:assert/strict';
import { TOPICS, makeQuestion, publicQuestion, cleanProfile, DEFAULT_PROFILE, validateCustom } from '../server/curriculum/index.js';
import { makeRng } from '../server/curriculum/helpers.js';

const money = (s) => Math.round(Number(String(s).replace(/[$,]/g, '')) * 100);

test('every topic has all three tiers', () => {
  for (const t of TOPICS) for (const lv of ['A', 'B', 'C']) assert.ok(t.skills.some((s) => s.level === lv), `${t.id} ${lv}`);
});

test('every skill generates valid, unambiguous questions at 2, 3 and 4 choices', () => {
  const rng = makeRng(42);
  let total = 0;
  for (const t of TOPICS) for (const s of t.skills) for (const n of [2, 3, 4]) for (let i = 0; i < 150; i++) {
    const others = t.skills.filter((x) => x.level === s.level && x.id !== s.id).map((x) => x.id);
    const q = makeQuestion({ topic: t.id, level: s.level, n, avoid: others, rng });
    assert.equal(q.skill, s.id);
    assert.ok(q.prompt && q.short && q.hint?.text, `${s.id} text`);
    assert.ok(q.choices.length >= 2 && q.choices.length <= Math.max(n, 2), `${s.id} has ${q.choices.length} choices for n=${n}`);
    const keys = q.choices.map((c) => JSON.stringify([c.label || null, c.vis || null]));
    assert.equal(new Set(keys).size, keys.length, `${s.id} duplicate choices: ${keys}`);
    const said = q.choices.map((c) => q.describe(c.id));
    assert.equal(new Set(said).size, said.length, `${s.id} choices read the same: ${said}`);
    assert.ok(q.choices.some((c) => c.id === q.answerId));
    assert.ok(!/NaN|undefined|null|\$-|:6\d/.test(JSON.stringify([q.prompt, q.short, said, q.hint])), `${s.id} bad text: ${q.prompt} ${said}`);
    const pub = publicQuestion(q, DEFAULT_PROFILE);
    assert.ok(!('answerId' in pub) && !('hint' in pub) && !('answerText' in pub), 'answer must not reach the student device');
    total++;
  }
  assert.ok(total > 10000);
});

test('arithmetic is right (recomputed from the prompt)', () => {
  const rng = makeRng(7);
  const gen = (topic, level, skill) => {
    const t = TOPICS.find((x) => x.id === topic);
    return makeQuestion({ topic, level, n: 4, avoid: t.skills.filter((s) => s.id !== skill).map((s) => s.id), rng });
  };
  const nums = (s) => (s.match(/\$?\d+(?:\.\d\d)?/g) || []).map(money);
  for (let i = 0; i < 300; i++) {
    let q = gen('change', 'B', 'change.whole'); let [pay, price] = nums(q.prompt);
    assert.equal(money(q.answerText), pay - price, q.prompt);
    q = gen('change', 'C', 'change.cents'); [pay, price] = nums(q.prompt);
    assert.equal(money(q.answerText), pay - price, q.prompt);
    q = gen('change', 'C', 'change.check'); let [p2, pr2, given] = nums(q.prompt);
    assert.equal(q.answerText, p2 - pr2 === given ? 'YES' : 'NO', q.prompt);
    q = gen('shopping', 'A', 'shop.enough'); let [have, cost] = nums(q.prompt);
    assert.equal(q.answerText, have >= cost ? 'YES' : 'NO', q.prompt);
    q = gen('shopping', 'B', 'shop.total2');
    assert.equal(money(q.answerText), q.stim.items.reduce((s, x) => s + x.p, 0), q.prompt);
    q = gen('shopping', 'C', 'shop.total3');
    assert.equal(money(q.answerText), q.stim.items.reduce((s, x) => s + x.p, 0), q.prompt);
    q = gen('shopping', 'C', 'shop.sale'); let [full, off] = nums(q.prompt);
    assert.equal(money(q.answerText), full - off, q.prompt);
    q = gen('budget', 'B', 'budget.both'); let [lim] = nums(q.prompt);
    assert.equal(q.answerText, q.stim.items.reduce((s, x) => s + x.p, 0) <= lim ? 'YES' : 'NO', q.prompt);
    q = gen('budget', 'C', 'budget.save'); let [wk, weeks] = nums(q.prompt);
    assert.equal(money(q.answerText), wk * weeks / 100, q.prompt);
    q = gen('budget', 'C', 'budget.need-more'); let [goal, saved] = nums(q.prompt);
    assert.equal(money(q.answerText), goal - saved, q.prompt);
    q = gen('work', 'C', 'work.earn'); let [rate, hrs] = nums(q.prompt);
    assert.equal(money(q.answerText), rate * hrs / 100, q.prompt);
    q = gen('money', 'B', 'money.count-bills');
    assert.equal(money(q.answerText), q.stim.items.reduce((a, b) => a + b, 0), 'count bills');
    q = gen('money', 'C', 'money.count-mixed');
    assert.equal(money(q.answerText), q.stim.items.reduce((a, b) => a + b, 0), 'count mixed');
    q = gen('time', 'C', 'time.elapsed');
    const [a, b] = [q.stim.from, q.stim.to].map(([h, m]) => (h % 12) * 60 + m);
    const d = ((b - a) % 720 + 720) % 720;
    const m = q.answerText.match(/(?:(\d+) (?:hr|hours?))?\s*(?:(\d+) min)?/);
    assert.equal((Number(m[1] || 0)) * 60 + Number(m[2] || 0), d, q.prompt + ' -> ' + q.answerText);
    q = gen('budget', 'C', 'budget.pair'); [lim] = nums(q.prompt);
    for (const c of q.choices) {
      const tot = c.vis.items.reduce((s, x) => s + x.p, 0);
      assert.equal(tot <= lim, c.id === q.answerId, `pair ${tot} vs ${lim}`);
    }
    q = gen('shopping', 'B', 'shop.under'); [lim] = nums(q.prompt);
    for (const c of q.choices) assert.equal(c.vis.p < lim, c.id === q.answerId, 'under limit');
  }
});

test('profiles and custom questions are sanitised', () => {
  const p = cleanProfile({ topics: { money: 'A', bogus: 'C', time: 'Z' }, choices: 9, readAloud: 'yes', calculator: true });
  assert.deepEqual(p.topics, { money: 'A' });
  assert.equal(p.choices, 3); assert.equal(p.readAloud, false); assert.equal(p.calculator, true);
  assert.equal(validateCustom({ prompt: 'x', choices: ['a'], answer: 0 }), null);
  assert.equal(validateCustom({ prompt: 'x', choices: ['a', 'a'], answer: 0 }), null);
  const c = validateCustom({ prompt: 'Which bus goes downtown?', choices: ['Bus 4', 'Bus 9', 'Bus 12'], answer: 1, topic: 'time', level: 'B', emoji: '🚌' });
  assert.ok(c);
  const q = makeQuestion({ topic: 'time', level: 'B', n: 2, custom: [{ ...c, id: 'x1' }], avoid: TOPICS.flatMap((t) => t.skills.map((s) => s.id)) });
  assert.equal(q.skill, 'custom.x1'); assert.equal(q.answerText, 'Bus 9'); assert.equal(q.choices.length, 2);
});
