// OVERRIDE server: static files, teacher API, and the WebSocket game channel.
// No npm dependencies. Run with: npm start
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { acceptUpgrade } from './ws.js';
import { openStore } from './store.js';
import { Rooms, validateCustom, cleanProfile, cleanAvatar } from './rooms.js';
import { curriculumMeta, makeQuestion, publicQuestion, DEFAULT_PROFILE } from './curriculum/index.js';
import { classSummary, studentReport, toCSV } from './reports.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Tiny .env loader so nothing extra needs installing.
try {
  for (const line of fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/);
    if (m && m[2] && !(m[1] in process.env)) process.env[m[1]] = m[2];
  }
} catch {}

export function startServer({ port = Number(process.env.PORT) || 3000, dataDir = process.env.DATA_DIR || path.join(ROOT, 'data'), pin = process.env.TEACHER_PIN, quiet = false } = {}) {
  const store = openStore(path.resolve(ROOT, dataDir));
  const rooms = new Rooms(store);
  const PUBLIC = path.join(ROOT, 'public');

  if (!pin) {
    pin = store.getKV('pin');
    if (!pin) { pin = String(crypto.randomInt(100000, 1000000)); store.setKV('pin', pin); }
  }
  pin = String(pin);

  // ---------- teacher auth ----------
  const tokens = new Map(); // token -> expiry
  const tries = new Map();  // ip -> [timestamps]
  const isTeacher = (token) => { const exp = tokens.get(token); if (!exp) return false; if (exp < Date.now()) { tokens.delete(token); return false; } return true; };
  const bearer = (req) => (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const samePin = (a) => { const x = Buffer.from(String(a)), y = Buffer.from(pin); return x.length === y.length && crypto.timingSafeEqual(x, y); };

  // ---------- http helpers ----------
  const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json', '.png': 'image/png', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json' };
  const send = (res, code, body, type = 'application/json') => {
    const data = typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body);
    res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' });
    res.end(data);
  };
  const readBody = (req) => new Promise((resolve, reject) => {
    let size = 0; const parts = [];
    req.on('data', (c) => { size += c.length; if (size > 100_000) { reject(new Error('too large')); req.destroy(); } else parts.push(c); });
    req.on('end', () => { try { resolve(parts.length ? JSON.parse(Buffer.concat(parts).toString('utf8')) : {}); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
  const lanUrls = () => {
    const out = [];
    for (const list of Object.values(os.networkInterfaces())) for (const i of list || []) if (i.family === 'IPv4' && !i.internal) out.push(`http://${i.address}:${server.address().port}`);
    return out;
  };

  function serveStatic(req, res, pathname) {
    if (pathname === '/') pathname = '/index.html';
    if (pathname === '/teacher') pathname = '/teacher.html';
    const file = path.normalize(path.join(PUBLIC, pathname));
    if (!file.startsWith(PUBLIC + path.sep)) return send(res, 403, 'Forbidden', 'text/plain');
    fs.readFile(file, (err, data) => {
      if (err) return send(res, 404, 'Not found', 'text/plain');
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' });
      res.end(data);
    });
  }

  async function api(req, res, url) {
    const p = url.pathname, m = req.method;
    // Public: only what a student needs to join. No assessment data here.
    if (m === 'GET' && p.startsWith('/api/room/')) {
      const room = rooms.get(p.slice(10));
      if (!room) return send(res, 404, { error: 'No game with that code.' });
      const taken = new Set(room.list().filter((x) => x.on).map((x) => x.key));
      return send(res, 200, { code: room.code, phase: room.phase, roster: store.roster.list().filter((r) => !taken.has(r.id)).map((r) => ({ id: r.id, name: r.name, avatar: r.avatar })).sort((a, b) => a.name.localeCompare(b.name)) });
    }
    if (m === 'POST' && p === '/api/teacher/login') {
      const ip = req.socket.remoteAddress || '?';
      const now = Date.now();
      const recent = (tries.get(ip) || []).filter((t) => now - t < 60_000);
      if (recent.length >= 8) return send(res, 429, { error: 'Too many tries. Wait a minute.' });
      const body = await readBody(req);
      if (!samePin(body.pin ?? '')) { recent.push(now); tries.set(ip, recent); return send(res, 401, { error: 'That PIN is not correct.' }); }
      const token = crypto.randomBytes(24).toString('hex');
      tokens.set(token, now + 12 * 3600e3);
      return send(res, 200, { token });
    }

    // Everything below is teacher-only.
    if (!isTeacher(bearer(req))) return send(res, 401, { error: 'Sign in again.' });

    if (m === 'GET' && p === '/api/info') return send(res, 200, { urls: lanUrls(), storage: store.kind, defaults: cleanProfile(store.getKV('defaults')), rooms: [...rooms.rooms.keys()] });
    if (m === 'GET' && p === '/api/curriculum') return send(res, 200, curriculumMeta());
    if (m === 'PUT' && p === '/api/defaults') { const d = cleanProfile(await readBody(req), DEFAULT_PROFILE); store.setKV('defaults', d); return send(res, 200, d); }

    if (p === '/api/roster' && m === 'GET') return send(res, 200, store.roster.list().sort((a, b) => a.name.localeCompare(b.name)));
    if (p === '/api/roster' && m === 'POST') {
      const b = await readBody(req);
      const name = String(b.name ?? '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 14);
      if (!name) return send(res, 400, { error: 'Enter a name.' });
      const prev = b.id ? store.roster.get(String(b.id)) : null;
      if (store.roster.list().some((r) => r.name.toLowerCase() === name.toLowerCase() && r.id !== prev?.id)) return send(res, 400, { error: 'That name is already on the roster.' });
      const e = { id: prev ? prev.id : crypto.randomBytes(5).toString('hex'), name, avatar: cleanAvatar(b.avatar ?? prev?.avatar), settings: cleanProfile(b.settings ?? prev?.settings, cleanProfile(store.getKV('defaults'))) };
      store.roster.save(e);
      return send(res, 200, e);
    }
    if (p.startsWith('/api/roster/') && m === 'DELETE') { store.roster.remove(p.slice(12)); return send(res, 200, { ok: true }); }

    if (p === '/api/questions' && m === 'GET') return send(res, 200, store.questions.list());
    if (p === '/api/questions' && m === 'POST') {
      const q = validateCustom(await readBody(req));
      if (!q) return send(res, 400, { error: 'A question needs a prompt, 2 to 4 different choices, and one correct answer.' });
      q.id = q.id && store.questions.get(q.id) ? q.id : crypto.randomBytes(5).toString('hex');
      store.questions.save(q);
      return send(res, 200, q);
    }
    if (p === '/api/questions/preview' && m === 'POST') {
      const b = await readBody(req);
      const custom = b.custom ? validateCustom({ ...b.custom, id: 'preview' }) : null;
      if (b.custom && !custom) return send(res, 400, { error: 'Fill in the prompt, choices and correct answer first.' });
      const profile = cleanProfile(b.profile);
      const q = custom
        ? makeQuestion({ topic: custom.topic, level: custom.level, n: profile.choices, custom: [custom], avoid: curriculumMeta().topics.flatMap((t) => t.skills.map((s) => s.id)) })
        : makeQuestion({ topic: b.topic, level: b.level, n: profile.choices });
      return send(res, 200, { ...publicQuestion(q, profile), skillName: q.skillName, answerId: q.answerId, hint: q.hint });
    }
    if (p.startsWith('/api/questions/') && m === 'DELETE') { store.questions.remove(p.slice(15)); return send(res, 200, { ok: true }); }

    if (p === '/api/reports/summary' && m === 'GET') return send(res, 200, { students: classSummary(store.attempts.all()), sessions: store.sessions.list().slice(0, 40) });
    if (p === '/api/reports/student' && m === 'GET') {
      const r = studentReport(store.attempts.all(), url.searchParams.get('key') || '', store.sessions.list());
      return r ? send(res, 200, r) : send(res, 404, { error: 'No records for that student yet.' });
    }
    if (p === '/api/reports/export.csv' && m === 'GET') {
      res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="override-progress.csv"', 'Cache-Control': 'no-store' });
      return res.end(toCSV(store.attempts.all()));
    }
    return send(res, 404, { error: 'Not found' });
  }

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    if (url.pathname.startsWith('/api/')) return api(req, res, url).catch(() => { if (!res.headersSent) send(res, 400, { error: 'Bad request' }); });
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed', 'text/plain');
    serveStatic(req, res, decodeURIComponent(url.pathname));
  });

  // ---------- websocket ----------
  const conns = new Set();
  server.on('upgrade', (req, socket) => {
    if (new URL(req.url, 'http://x').pathname !== '/ws') return socket.destroy();
    const conn = acceptUpgrade(req, socket);
    if (!conn) return;
    conns.add(conn);
    let room = null, player = null, teacher = false, bucket = 40, last = Date.now();
    conn.on('message', (raw) => {
      const now = Date.now();
      bucket = Math.min(40, bucket + (now - last) / 50); last = now; // about 20 messages a second
      if (bucket < 1) return;
      bucket -= 1;
      let msg; try { msg = JSON.parse(raw); } catch { return; }
      if (!msg || typeof msg.t !== 'string') return;
      try {
        if (msg.t === 'join' || msg.t === 'rejoin') {
          const r = rooms.get(msg.code);
          if (!r) return conn.json({ t: 'join_error', msg: msg.t === 'rejoin' ? 'gone' : 'No game with that code.' });
          if (room && room !== r) room.detach(conn);
          const out = msg.t === 'join' ? r.join(conn, msg) : r.rejoin(conn, String(msg.token || ''));
          if (out.error) return conn.json({ t: 'join_error', msg: out.error });
          room = r; player = out.player; teacher = false;
          return;
        }
        if (msg.t === 't_auth') {
          if (!isTeacher(String(msg.token || ''))) return conn.json({ t: 't_denied' });
          teacher = true;
          return conn.json({ t: 't_ok' });
        }
        if (msg.t.startsWith('t_')) {
          if (!teacher) return conn.json({ t: 't_denied' });
          if (msg.t === 't_create') {
            if (room) room.detach(conn);
            room = rooms.create(msg.opts); player = null;
            return room.attachTeacher(conn);
          }
          if (msg.t === 't_attach') {
            const r = rooms.get(msg.code);
            if (!r) return conn.json({ t: 't_noroom' });
            if (room && room !== r) room.detach(conn);
            room = r; player = null;
            return room.attachTeacher(conn);
          }
          if (msg.t === 't_close') { if (room) { rooms.close(room.code); room = null; } return conn.json({ t: 't_noroom' }); }
          if (room && room.teachers.has(conn)) room.handleTeacher(conn, msg);
          return;
        }
        if (room && player && room.players.get(player.id) === player && player.conn === conn) room.handleStudent(player, msg);
      } catch (e) {
        if (!quiet) console.error('message error', e);
      }
    });
    conn.on('close', () => { conns.delete(conn); if (room) room.detach(conn); });
  });
  const beat = setInterval(() => {
    for (const c of conns) {
      if (!c.alive) { c.terminate(); continue; }
      c.alive = false; c.ping(); c.send('{"t":"hb"}');
    }
  }, 10_000);
  beat.unref();

  return new Promise((resolve) => {
    server.listen(port, () => {
      const actual = server.address().port;
      if (!quiet) {
        console.log('\n  OVERRIDE is running.\n');
        console.log(`  Teacher command center:  http://localhost:${actual}/teacher`);
        console.log(`  Teacher PIN:             ${pin}`);
        for (const u of lanUrls()) console.log(`  Students join at:        ${u}`);
        console.log(`  Records saved with:      ${store.kind === 'sqlite' ? 'SQLite' : 'JSON file'} in ${path.resolve(ROOT, dataDir)}\n`);
      }
      resolve({ server, port: actual, pin, store, rooms, close: () => new Promise((r) => { clearInterval(beat); for (const c of conns) c.terminate(); server.close(() => { store.close(); r(); }); }) });
    });
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) startServer();
