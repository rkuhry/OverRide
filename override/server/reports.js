// Academic progress reports. Built only from question attempts, never from game score.
// Language is descriptive: these are observations for a teacher, not mastery claims.
import { ATTEMPT_COLS } from './store.js';

const pct = (a, b) => (b ? Math.round((a / b) * 100) : null);
const tally = (rows) => {
  const scored = rows.filter((r) => r.first_correct !== null && r.first_correct !== undefined);
  return {
    n: rows.length,
    first: scored.filter((r) => r.first_correct === 1).length,
    scored: scored.length,
    firstPct: pct(scored.filter((r) => r.first_correct === 1).length, scored.length),
    multi: rows.filter((r) => r.status === 'multi_try').length,
    support: rows.filter((r) => r.status === 'with_support').length,
    assist: rows.filter((r) => r.status === 'teacher_assist').length,
    incomplete: rows.filter((r) => r.status === 'incomplete').length,
    calculator: rows.filter((r) => r.calculator === 1).length,
  };
};
const groupBy = (rows, f) => { const m = new Map(); for (const r of rows) { const k = f(r); if (!m.has(k)) m.set(k, []); m.get(k).push(r); } return m; };

export function classSummary(rows) {
  return [...groupBy(rows, (r) => r.student_key)].map(([key, rs]) => ({
    key, name: rs.at(-1).student_name, sessions: new Set(rs.map((r) => r.session_id)).size, last: rs.at(-1).ts, ...tally(rs),
  })).sort((a, b) => a.name.localeCompare(b.name));
}

function note(sessions, all) {
  if (all.scored < 5) return { tone: 'none', text: `Not enough data yet (${all.scored} scored ${all.scored === 1 ? 'question' : 'questions'}).` };
  const notes = [];
  let tone = 'steady';
  if (sessions.length >= 2) {
    const last = sessions.at(-1), prev = tally(sessions.slice(0, -1).flatMap((s) => s.rows));
    if (last.scored >= 3 && prev.scored >= 3) {
      const d = last.firstPct - prev.firstPct;
      if (d >= 20) { tone = 'up'; notes.push(`First-try accuracy rose from ${prev.firstPct}% to ${last.firstPct}% in the latest session.`); }
      else if (d <= -20) { tone = 'down'; notes.push(`First-try accuracy fell from ${prev.firstPct}% to ${last.firstPct}% in the latest session.`); }
    }
  }
  if (all.firstPct < 50) { tone = tone === 'up' ? 'up' : 'down'; notes.push(`First-try accuracy is ${all.firstPct}% across ${all.scored} questions. More instruction may help.`); }
  else if (all.firstPct >= 80 && all.scored >= 8 && sessions.length >= 2) notes.push(`First-try accuracy is ${all.firstPct}% across ${all.scored} questions in ${sessions.length} sessions.`);
  if (!notes.length) notes.push(`First-try accuracy is ${all.firstPct}% across ${all.scored} questions.`);
  return { tone, text: notes.join(' ') };
}

export function studentReport(rows, key, sessionsMeta = []) {
  const mine = rows.filter((r) => r.student_key === key);
  if (!mine.length) return null;
  const when = (id) => sessionsMeta.find((s) => s.id === id)?.startedAt;
  const perSession = (rs) => [...groupBy(rs, (r) => r.session_id)].map(([id, x]) => ({ id, date: when(id) || x[0].ts, rows: x, ...tally(x) })).sort((a, b) => a.date - b.date);
  const skills = [...groupBy(mine, (r) => r.skill)].map(([skill, rs]) => {
    const sessions = perSession(rs);
    const all = tally(rs);
    return {
      skill, name: rs[0].skill_name, topic: rs[0].topic, level: rs.at(-1).level, ...all,
      trend: sessions.map((s) => ({ date: s.date, firstPct: s.firstPct, n: s.scored })),
      note: note(sessions, all),
    };
  }).sort((a, b) => a.topic.localeCompare(b.topic) || a.level.localeCompare(b.level) || a.name.localeCompare(b.name));
  return {
    key, name: mine.at(-1).student_name, ...tally(mine), skills,
    sessions: perSession(mine).map(({ rows: _r, ...s }) => s),
    recent: mine.slice(-25).reverse().map((r) => ({ ts: r.ts, skill: r.skill_name, prompt: r.prompt, first: r.first_response, answer: r.correct_answer, status: r.status, attempts: r.attempts })),
  };
}

export function toCSV(rows) {
  const cols = ['id', 'date', ...ATTEMPT_COLS];
  const cell = (v) => {
    if (v === null || v === undefined) return '';
    let s = String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; // stop spreadsheet formula injection from typed names
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [cols.join(',')];
  for (const r of rows) lines.push(cols.map((c) => cell(c === 'date' ? new Date(r.ts).toISOString() : r[c])).join(','));
  return lines.join('\n') + '\n';
}
