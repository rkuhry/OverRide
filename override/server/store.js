// Persistent storage. Uses Node's built-in SQLite when available (Node 22.5+),
// otherwise falls back to a JSON file so the game still runs on older Node.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const ATTEMPT_COLS = ['session_id', 'student_key', 'student_name', 'ts', 'round', 'topic', 'skill', 'skill_name',
  'level', 'question_id', 'prompt', 'correct_answer', 'first_response', 'first_correct', 'final_correct',
  'attempts', 'hints', 'guided', 'calculator', 'read_aloud', 'choices', 'status'];

function sqliteStore(file, DatabaseSync) {
  const db = new DatabaseSync(file);
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS roster (id TEXT PRIMARY KEY, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, started_at INTEGER, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS questions (id TEXT PRIMARY KEY, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS attempts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT, student_key TEXT, student_name TEXT, ts INTEGER, round INTEGER,
      topic TEXT, skill TEXT, skill_name TEXT, level TEXT, question_id TEXT, prompt TEXT,
      correct_answer TEXT, first_response TEXT, first_correct INTEGER, final_correct INTEGER,
      attempts INTEGER, hints INTEGER, guided INTEGER, calculator INTEGER, read_aloud INTEGER,
      choices INTEGER, status TEXT);
    CREATE INDEX IF NOT EXISTS attempts_student ON attempts (student_key, ts);
    CREATE INDEX IF NOT EXISTS attempts_session ON attempts (session_id);
  `);
  const coll = (table, extra) => ({
    list: () => db.prepare(`SELECT data FROM ${table}${extra ? ' ORDER BY ' + extra : ''}`).all().map((r) => JSON.parse(r.data)),
    get: (id) => { const r = db.prepare(`SELECT data FROM ${table} WHERE id = ?`).get(id); return r ? JSON.parse(r.data) : null; },
    remove: (id) => { db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(id); },
  });
  const insAttempt = db.prepare(`INSERT INTO attempts (${ATTEMPT_COLS.join(',')}) VALUES (${ATTEMPT_COLS.map(() => '?').join(',')})`);
  return {
    kind: 'sqlite',
    getKV: (k) => { const r = db.prepare('SELECT value FROM kv WHERE key = ?').get(k); return r ? JSON.parse(r.value) : undefined; },
    setKV: (k, v) => { db.prepare('INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(k, JSON.stringify(v)); },
    roster: { ...coll('roster'), save: (o) => { db.prepare('INSERT INTO roster (id, data) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data').run(o.id, JSON.stringify(o)); } },
    questions: { ...coll('questions'), save: (o) => { db.prepare('INSERT INTO questions (id, data) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data').run(o.id, JSON.stringify(o)); } },
    sessions: { ...coll('sessions', 'started_at DESC'), save: (o) => { db.prepare('INSERT INTO sessions (id, started_at, data) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data').run(o.id, o.startedAt, JSON.stringify(o)); } },
    attempts: {
      add: (rec) => { insAttempt.run(...ATTEMPT_COLS.map((c) => rec[c] ?? null)); },
      all: () => db.prepare('SELECT * FROM attempts ORDER BY ts ASC, id ASC').all(),
    },
    close: () => db.close(),
  };
}

function jsonStore(file) {
  let data = { kv: {}, roster: {}, sessions: {}, questions: {}, attempts: [] };
  try { data = { ...data, ...JSON.parse(fs.readFileSync(file, 'utf8')) }; } catch {}
  let timer = null;
  const flush = () => { timer = null; const tmp = file + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(data)); fs.renameSync(tmp, file); };
  const touch = () => { if (!timer) timer = setTimeout(flush, 300); };
  const coll = (name, sort) => ({
    list: () => { const a = Object.values(data[name]); return sort ? a.sort(sort) : a; },
    get: (id) => data[name][id] || null,
    save: (o) => { data[name][o.id] = o; touch(); },
    remove: (id) => { delete data[name][id]; touch(); },
  });
  return {
    kind: 'json',
    getKV: (k) => data.kv[k],
    setKV: (k, v) => { data.kv[k] = v; touch(); },
    roster: coll('roster'),
    questions: coll('questions'),
    sessions: coll('sessions', (a, b) => b.startedAt - a.startedAt),
    attempts: {
      add: (rec) => { const row = { id: data.attempts.length + 1 }; for (const c of ATTEMPT_COLS) row[c] = rec[c] ?? null; data.attempts.push(row); touch(); },
      all: () => data.attempts.slice(),
    },
    close: () => { if (timer) { clearTimeout(timer); flush(); } },
  };
}

export function openStore(dir) {
  fs.mkdirSync(dir, { recursive: true });
  try {
    const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite');
    return sqliteStore(path.join(dir, 'override.db'), DatabaseSync);
  } catch {
    return jsonStore(path.join(dir, 'override.json'));
  }
}
export { ATTEMPT_COLS };
