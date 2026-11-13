// OVERRIDE teacher command center. Separate from the student game: it signs in
// with the teacher PIN and is the only place academic data is ever shown.
import { $, $$, esc, Net } from './util.js';
import { avatarSVG } from './avatars.js';
import { renderVisual, renderChoice } from './visuals.js';
import { CityView } from './world/view.js';

const app = $('#app'), drawer = $('#drawer'), toast = $('#toast');
const T = {
  token: sessionStorage.getItem('ovr_teacher') || '', view: 'home', room: null, map: null, info: null, meta: null,
  roster: [], questions: [], summary: null, report: null, edit: null, resolve: null, playing: false, preview: null,
  form: { topic: 'money', level: 'A', prompt: '', short: '', emoji: '', text: '', choices: ['', '', '', ''], answer: 0, hint: '' },
  create: { mode: 'ffa', teamCount: 3, rounds: 4, missions: 4, topUp: true },
};
let city = null, net = null;
const TEAM = [['Cyan', '#2EE6F5'], ['Magenta', '#FF4FD8'], ['Lime', '#B6F23A'], ['Amber', '#FFA63D'], ['Violet', '#A98BFF']];
const LEVEL = { A: 'Foundational', B: 'Developing', C: 'Applied' };
const TOGGLES = [['readAloud', 'Read prompts aloud'], ['minimal', 'Shortest wording'], ['large', 'Larger pictures and text'], ['contrast', 'High contrast'], ['calm', 'Reduced distractions'], ['calculator', 'Calculator allowed'], ['hints', 'Hint button'], ['warp', 'Fast travel on the map']];
const STATUS = { first_try: 'Correct, first try', multi_try: 'Correct after retries', with_support: 'Correct with support', teacher_assist: 'Completed with teacher', incomplete: 'Not yet completed' };

const say = (msg) => { toast.textContent = msg; toast.hidden = false; clearTimeout(say.t); say.t = setTimeout(() => { toast.hidden = true; }, 3200); };
async function api(path, { method = 'GET', body } = {}) {
  const r = await fetch(path, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${T.token}` }, body: body ? JSON.stringify(body) : undefined });
  if (r.status === 401 && path !== '/api/teacher/login') { signOut(); throw new Error('Sign in again.'); }
  const data = r.headers.get('content-type')?.includes('json') ? await r.json() : await r.text();
  if (!r.ok) throw new Error(data.error || 'Something went wrong.');
  return data;
}
function signOut() { T.token = ''; sessionStorage.removeItem('ovr_teacher'); if (net) { net.wanted = false; net.ws?.close(); net = null; } renderLogin(); }

// ---------- sign in ----------
function renderLogin(err = '') {
  document.body.classList.remove('signed');
  app.innerHTML = `<main class="login"><h1 class="logo" data-text="OVERRIDE">OVERRIDE</h1><p class="tag">Command center</p>
    <form data-form="login"><label for="pin">Teacher PIN</label><input id="pin" type="password" inputmode="numeric" autocomplete="off" placeholder="PIN"><button class="primary">Sign in</button></form>
    <p class="err" role="alert">${esc(err)}</p><p class="fine">The PIN is printed in the terminal where the server was started.</p></main>`;
  $('#pin').focus();
}
async function boot() {
  if (!T.token) return renderLogin();
  try { [T.info, T.meta, T.roster, T.questions] = await Promise.all([api('/api/info'), api('/api/curriculum'), api('/api/roster'), api('/api/questions')]); } catch { return; }
  document.body.classList.add('signed');
  net = new Net({
    onOpen: () => net.send({ t: 't_auth', token: T.token }),
    onStatus: (on) => { $('#offline').hidden = on; },
    onMessage: onMsg,
  });
  go('home');
}
function onMsg(m) {
  switch (m.t) {
    case 't_ok': { const code = sessionStorage.getItem('ovr_room'); if (code) net.send({ t: 't_attach', code }); break; }
    case 't_denied': signOut(); break;
    case 't_noroom': T.room = null; T.map = null; sessionStorage.removeItem('ovr_room'); if (T.view === 'live') render(); break;
    case 'map': T.map = m; break;
    case 'pp': if (city) city.positions(m.p); break;
    case 't_state': {
      const first = !T.room;
      T.room = m; sessionStorage.setItem('ovr_room', m.code);
      if (m.phase === 'lobby') { T.map = null; T.resolve = null; }
      if (T.view === 'live') { if (first || !$('#liveHead')) render(); else updateLive(); }
      if (T.edit?.kind === 'player') { const p = m.priv.find((x) => x.id === T.edit.id); if (!p) closeDrawer(); }
      break;
    }
    case 'resolve': onResolve(m); break;
    case 'error': say(m.msg); break;
  }
}

// ---------- shell ----------
const NAV = [['home', 'Home'], ['live', 'Live game'], ['students', 'Students'], ['topics', 'Math topics'], ['progress', 'Progress']];
function go(view) { T.view = view; if (city) city.stop(); city = null; render(); if (view === 'progress') loadProgress(); }
function render() {
  const body = VIEWS[T.view]();
  app.innerHTML = `<nav class="rail"><div class="rail-logo"><span class="logo-sm">OVERRIDE</span><small>Command center</small></div>
    ${NAV.map(([id, n]) => `<button class="${T.view === id ? 'on' : ''}" data-act="nav" data-v="${id}">${n}${id === 'live' && T.room ? `<i>${T.room.code}</i>` : ''}</button>`).join('')}
    <button class="link" data-act="signout">Sign out</button></nav><main class="tmain view-${T.view}">${body}</main>`;
  if (T.view === 'live' && T.room) mountLive();
}

const stepper = (key, val, min, max, label) => `<div class="field"><span>${label}</span><div class="stepper"><button data-act="step" data-k="${key}" data-d="-1" ${val <= min ? 'disabled' : ''} aria-label="Less">−</button><b>${val}</b><button data-act="step" data-k="${key}" data-d="1" ${val >= max ? 'disabled' : ''} aria-label="More">+</button></div></div>`;
const seg = (act, opts, cur, extra = '') => `<div class="seg">${opts.map(([v, n]) => `<button data-act="${act}" data-v="${v}" ${extra} class="${String(cur) === String(v) ? 'on' : ''}" aria-pressed="${String(cur) === String(v)}">${n}</button>`).join('')}</div>`;
function optsForm(o, live) {
  return `<div class="opts">
    <div class="field"><span>Mode</span>${seg('opt-mode', [['ffa', 'Free-for-all'], ['teams', 'Teams']], o.mode)}</div>
    ${o.mode === 'teams' ? stepper('teamCount', o.teamCount, 2, 5, 'Teams') : ''}
    ${stepper('rounds', o.rounds, 1, 8, 'Rounds')}
    ${stepper('missions', o.missions, 2, 6, 'Missions each round')}
    <div class="field wide"><span>When you open the grid</span>${seg('opt-topup', [['true', 'Everyone is fully charged'], ['false', 'Only finished missions count']], String(o.topUp))}</div>
    <p class="fine wide">${o.topUp ? 'Recommended. No one is behind because they needed more time. Missions still record what each student did.' : 'Students who are still working get less charge. Use with care: this rewards speed.'} A match of ${o.rounds} ${o.rounds === 1 ? 'round' : 'rounds'} takes about ${o.rounds * 5} minutes.</p>
    ${live ? '' : '<button class="primary big wide" data-act="create">Create game</button>'}</div>`;
}

const VIEWS = {
  home: () => `<header class="thead"><h1>Command center</h1><p>${T.room ? `Game ${T.room.code} is open with ${T.room.players.length} ${T.room.players.length === 1 ? 'student' : 'students'}.` : 'No game is open yet.'}</p></header>
    <div class="tiles">
      <button data-act="nav" data-v="live" class="tile t1"><b>Create game</b><span>Open a room and get a 4-digit code for the board.</span></button>
      <button data-act="nav" data-v="live" class="tile t2"><b>Start session</b><span>Run the match: start, pause, advance each phase, end.</span></button>
      <button data-act="nav" data-v="topics" class="tile"><b>Select math topics</b><span>See every skill, try sample questions, add your own.</span></button>
      <button data-act="nav" data-v="students" class="tile"><b>Manage students</b><span>Save names with their topics, tiers and supports.</span></button>
      <button data-act="nav" data-v="progress" class="tile"><b>View progress</b><span>Accuracy by skill, supports used, trends, CSV export.</span></button>
    </div>
    <section class="note"><h2>Before using real student records</h2><p>This build is a classroom prototype. Use nicknames or first names only. It is not automatically FERPA compliant: see the README for the sign-in, hosting, encryption and district-approval steps that have to happen first.</p></section>`,

  live: () => (T.room ? `<div class="live">
      <header class="live-head" id="liveHead"></header>
      <div class="live-body">
        <section class="live-map"><div class="tcity-wrap"><canvas id="tcity" aria-label="Live city view"></canvas><div id="tboard"></div></div><p class="caption" id="tcap"></p><div id="standings" class="tstand"></div></section>
        <section class="live-side"><div id="liveOpts"></div><div id="liveTable"></div></section>
      </div></div>`
    : `<header class="thead"><h1>Create a game</h1><p>Students join at ${T.info.urls.length ? T.info.urls.map((u) => `<b>${esc(u)}</b>`).join(' or ') : `<b>${esc(location.origin)}</b>`} and type the code.</p></header>${optsForm(T.create, false)}`),

  students: () => `<header class="thead"><h1>Students</h1><p>Saved students tap their name to join, and their topics and supports are ready. Use nicknames or first names only.</p></header>
    <form class="add" data-form="roster"><input id="rname" maxlength="14" placeholder="Name or nickname" aria-label="Student name" autocomplete="off"><button class="primary">Add student</button><button type="button" data-act="edit-defaults">Class defaults</button></form>
    <div class="cards">${T.roster.length ? T.roster.map((r) => `<div class="card"><div class="card-face">${avatarSVG(r.avatar)}</div><div><b>${esc(r.name)}</b><span>${profileLine(r.settings)}</span></div><button data-act="edit-roster" data-id="${esc(r.id)}">Settings</button><button class="quiet" data-act="del-roster" data-id="${esc(r.id)}" aria-label="Remove ${esc(r.name)}">Remove</button></div>`).join('') : '<p class="empty">No saved students yet. Students can still join with a nickname and get the class defaults.</p>'}</div>`,

  topics: () => `<header class="thead"><h1>Math topics</h1><p>Tiers are instructional groupings, not grade levels. Students never see them, and every tier earns the same charge.</p></header>
    <div class="topics">${T.meta.topics.map((t) => `<section class="topic"><h2>${esc(t.name)}</h2><p>${esc(t.blurb)}</p>
      <div class="tiers">${['A', 'B', 'C'].map((lv) => `<div><h3>${lv} · ${LEVEL[lv]} <button class="mini" data-act="preview" data-topic="${t.id}" data-level="${lv}">Try one</button></h3><ul>${t.skills.filter((s) => s.level === lv).map((s) => `<li>${esc(s.name)}</li>`).join('')}${T.questions.filter((q) => q.topic === t.id && q.level === lv).map((q) => `<li class="custom">Yours: ${esc(q.prompt)}</li>`).join('')}</ul></div>`).join('')}</div>
      ${T.room ? `<div class="bulk"><span>Set for everyone in game ${T.room.code}</span>${seg('bulk', [['off', 'Off'], ['A', 'A'], ['B', 'B'], ['C', 'C']], '', `data-topic="${t.id}"`)}</div>` : ''}</section>`).join('')}</div>
    <section class="editor"><h2>Add your own question</h2>
      <form data-form="question" class="qform">
        <div class="field"><span>Topic</span><select id="f-topic">${T.meta.topics.map((t) => `<option value="${t.id}" ${T.form.topic === t.id ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}</select></div>
        <div class="field"><span>Tier</span><select id="f-level">${['A', 'B', 'C'].map((l) => `<option value="${l}" ${T.form.level === l ? 'selected' : ''}>${l} · ${LEVEL[l]}</option>`).join('')}</select></div>
        <div class="field wide"><span>Prompt</span><input id="f-prompt" maxlength="160" value="${esc(T.form.prompt)}" placeholder="Which bus goes to the library?"></div>
        <div class="field"><span>Short prompt (optional)</span><input id="f-short" maxlength="60" value="${esc(T.form.short)}" placeholder="Bus to library?"></div>
        <div class="field"><span>Hint (optional)</span><input id="f-hint" maxlength="120" value="${esc(T.form.hint)}" placeholder="Look at the sign on the front."></div>
        <div class="field"><span>Picture (one emoji, optional)</span><input id="f-emoji" maxlength="8" value="${esc(T.form.emoji)}" placeholder="🚌"></div>
        <div class="field"><span>Picture caption (optional)</span><input id="f-text" maxlength="60" value="${esc(T.form.text)}" placeholder="Route 12: Library"></div>
        <div class="field wide"><span>Choices. Mark the correct one. Leave extras blank.</span><div class="choices-in">${[0, 1, 2, 3].map((i) => `<label><input type="radio" name="f-answer" value="${i}" ${T.form.answer === i ? 'checked' : ''} aria-label="Choice ${i + 1} is correct"><input id="f-c${i}" maxlength="40" value="${esc(T.form.choices[i])}" placeholder="Choice ${i + 1}"></label>`).join('')}</div></div>
        <div class="wide row"><button type="button" data-act="preview-custom">Preview</button><button class="primary">Save question</button></div>
      </form>
      ${T.questions.length ? `<h3>Your questions</h3><ul class="qlist">${T.questions.map((q) => `<li><span><b>${esc(q.prompt)}</b>${esc(T.meta.topics.find((t) => t.id === q.topic)?.name || '')} · tier ${q.level} · answer: ${esc(q.choices[q.answer])}</span><button class="quiet" data-act="del-q" data-id="${esc(q.id)}">Delete</button></li>`).join('')}</ul><p class="fine">Students working on that topic and tier get your questions mixed in with the built-in ones.</p>` : ''}
    </section>`,

  progress: () => {
    if (T.report) return reportView(T.report);
    const s = T.summary;
    if (!s) return '<header class="thead"><h1>Progress</h1><p>Loading…</p></header>';
    return `<header class="thead"><h1>Progress</h1><p>Built from math missions only. Game score is never used here, and nothing on this page is shown to students.</p></header>
      <div class="row"><button data-act="export">Export all records (CSV)</button><button class="quiet" data-act="refresh">Refresh</button></div>
      ${s.students.length ? `<table class="data"><thead><tr><th>Student</th><th>Sessions</th><th>Questions</th><th>First-try accuracy</th><th>After retries</th><th>With support</th><th>With teacher</th><th>Not finished</th><th></th></tr></thead><tbody>
        ${s.students.map((x) => `<tr><td><b>${esc(x.name)}</b></td><td>${x.sessions}</td><td>${x.n}</td><td>${bar(x.firstPct, x.scored)}</td><td>${x.multi}</td><td>${x.support}</td><td>${x.assist}</td><td>${x.incomplete}</td><td><button class="mini" data-act="report" data-key="${esc(x.key)}">Details</button></td></tr>`).join('')}</tbody></table>`
    : '<p class="empty">No records yet. They appear here as soon as students answer missions in a game.</p>'}
      <h2>Sessions</h2>${s.sessions.length ? `<table class="data"><thead><tr><th>Date</th><th>Mode</th><th>Rounds</th><th>Players</th><th>Status</th></tr></thead><tbody>${s.sessions.map((x) => `<tr><td>${new Date(x.startedAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}</td><td>${x.mode === 'teams' ? 'Teams' : 'Free-for-all'}</td><td>${x.rounds}</td><td>${x.players.length}</td><td>${x.endedAt ? 'Finished' : 'Not finished'}</td></tr>`).join('')}</tbody></table>` : '<p class="empty">No sessions yet.</p>'}`;
  },
};
const bar = (pct, n) => (pct === null || !n ? '<span class="fine">no data</span>' : `<span class="meter"><i style="width:${pct}%"></i></span> ${pct}% <span class="fine">of ${n}</span>`);
const profileLine = (p) => `${Object.entries(p.topics).map(([id, lv]) => `${T.meta.topics.find((t) => t.id === id)?.name || id} ${lv}`).join(' · ')} · ${p.choices} choices${TOGGLES.filter(([k]) => p[k] && k !== 'hints').map(([, n]) => ` · ${n.toLowerCase()}`).join('')}`;

function reportView(r) {
  const date = (d) => new Date(d).toLocaleDateString([], { month: 'short', day: 'numeric' });
  return `<header class="thead"><button class="link" data-act="back-progress">‹ All students</button><h1>${esc(r.name)}</h1>
    <p>${r.n} questions in ${r.sessions.length} ${r.sessions.length === 1 ? 'session' : 'sessions'}. First-try accuracy ${r.firstPct === null ? 'not available yet' : `${r.firstPct}% of ${r.scored}`}. ${r.calculator ? `Calculator used on ${r.calculator}.` : ''}</p></header>
    <h2>By skill</h2><table class="data"><thead><tr><th>Skill</th><th>Tier</th><th>Questions</th><th>First try</th><th>By session</th><th>Retries</th><th>Support</th><th>Teacher</th><th>What the data shows</th></tr></thead><tbody>
    ${r.skills.map((s) => `<tr><td><b>${esc(s.name)}</b><span class="fine">${esc(T.meta.topics.find((t) => t.id === s.topic)?.name || s.topic)}</span></td><td>${s.level}</td><td>${s.n}</td><td>${bar(s.firstPct, s.scored)}</td>
      <td class="trend">${s.trend.map((t) => `<span title="${date(t.date)}: ${t.n} questions">${t.firstPct === null ? '–' : `${t.firstPct}%`}</span>`).join('<i>→</i>')}</td><td>${s.multi}</td><td>${s.support}</td><td>${s.assist}</td><td class="note-${s.note.tone}">${esc(s.note.text)}</td></tr>`).join('')}</tbody></table>
    <h2>Sessions</h2><table class="data"><thead><tr><th>Date</th><th>Questions</th><th>First-try accuracy</th><th>With support</th><th>Not finished</th></tr></thead><tbody>${r.sessions.map((s) => `<tr><td>${new Date(s.date).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}</td><td>${s.n}</td><td>${bar(s.firstPct, s.scored)}</td><td>${s.support}</td><td>${s.incomplete}</td></tr>`).join('')}</tbody></table>
    <h2>Latest questions</h2><table class="data"><thead><tr><th>Skill</th><th>Question</th><th>First response</th><th>Correct answer</th><th>Tries</th><th>Result</th></tr></thead><tbody>${r.recent.map((a) => `<tr><td>${esc(a.skill)}</td><td>${esc(a.prompt)}</td><td>${esc(a.first ?? '—')}</td><td>${esc(a.answer)}</td><td>${a.attempts}</td><td>${STATUS[a.status] || a.status}</td></tr>`).join('')}</tbody></table>
    <p class="fine">These are observations from a small number of game questions. They are a prompt for your own judgement, not a mastery decision.</p>`;
}
async function loadProgress() { try { T.summary = await api('/api/reports/summary'); if (T.view === 'progress') render(); } catch (e) { say(e.message); } }

// ---------- live game ----------
function mountLive() {
  if (city) city.stop();
  city = new CityView($('#tcity'), { mode: 'spectator' });
  city.start();
  updateLive();
}
const sideMap = () => new Map((T.room?.sides || []).map((s) => { const p = T.room.mode === 'teams' ? null : T.room.players.find((x) => x.id === s.id); return [s.id, { ...s, tag: p ? p.tag : (s.name.split(' ')[1] || s.name)[0] }]; }));
function nextStep(r) {
  const n = r.players.length, done = r.priv.filter((p) => p.total && p.done >= p.total).length, ready = r.players.filter((p) => p.ready).length;
  switch (r.phase) {
    case 'lobby': return { act: 't_start', label: 'Start session', sub: n ? `${n} ${n === 1 ? 'student is' : 'students are'} in the lobby.` : 'Waiting for students to join.', off: !n };
    case 'build': return { act: 't_advance', label: 'Open the grid', sub: `${done} of ${n} finished their missions.${r.opts.topUp ? ' Everyone will be fully charged.' : ''}` };
    case 'control': return { act: 't_advance', label: 'Resolve round', sub: `${ready} of ${n} locked in. Plans count even if not locked.` };
    case 'results': return r.round >= r.rounds ? { act: 't_advance', label: 'Show final results', sub: 'That was the last round.' } : { act: 't_advance', label: `Start round ${r.round + 1}`, sub: 'Students are looking at the scores.' };
    default: return { act: 't_reset', label: 'New match, same students', sub: 'The match is over. Records are saved.' };
  }
}
function updateLive() {
  const r = T.room; if (!r || !$('#liveHead')) return;
  const step = nextStep(r), inPlay = !['lobby', 'final'].includes(r.phase);
  $('.live').classList.toggle('bigmap', !!T.big);
  const phases = [['lobby', 'Lobby'], ['build', 'Power up'], ['control', 'Control'], ['results', 'Results'], ['final', 'Final']];
  $('#liveHead').innerHTML = `
    <div class="code-box"><small>Game code</small><b>${r.code}</b><span>${esc((T.info.urls[0] || location.origin).replace(/^https?:\/\//, ''))}</span></div>
    <div class="live-status"><div class="steps">${phases.map(([id, n]) => `<span class="${r.phase === id ? 'on' : ''}">${n}</span>`).join('')}</div>
      <p><b>${r.round ? `Round ${r.round} of ${r.rounds}` : `${r.players.length} joined`}</b> ${r.paused ? '· Paused' : ''} · ${esc(step.sub)}</p></div>
    <div class="live-ctl"><button class="primary big" data-act="send" data-t="${step.act}" ${step.off || r.paused ? 'disabled' : ''}>${step.label}</button>
      <button class="quiet" data-act="bigmap" title="Show only the city, for a projector">${T.big ? 'Dashboard' : 'Big screen'}</button><button class="quiet" data-act="names" title="Names over avatars on student screens">Names: ${r.names === false ? 'off' : 'on'}</button>${inPlay ? `<button data-act="send" data-t="t_pause" data-paused="${!r.paused}">${r.paused ? 'Resume' : 'Pause'}</button><button class="quiet" data-act="end">End game</button>` : `<button class="quiet" data-act="close">Close room</button>`}</div>`;
  $('#liveOpts').innerHTML = r.phase === 'lobby' ? `<details class="fold" ${T.optsOpen ? 'open' : ''}><summary>Game settings: ${r.opts.mode === 'teams' ? `${r.opts.teamCount} teams` : 'free-for-all'}, ${r.opts.rounds} rounds, ${r.opts.missions} missions</summary>${optsForm(r.opts, true)}</details>` : '';
  const teams = r.mode === 'teams' || r.opts.mode === 'teams';
  $('#liveTable').innerHTML = r.players.length ? `<table class="data players ${r.phase === 'build' ? 'assist' : ''}"><thead><tr><th>Student</th>${teams ? '<th class="w5">Team</th>' : ''}<th class="w1">Missions</th><th class="w2">${r.phase === 'control' ? 'Plan' : 'Charge'}</th><th class="w3" title="Private. First-try accuracy this session.">1st try</th><th class="w4"></th></tr></thead><tbody>
    ${r.players.map((p) => { const v = r.priv.find((x) => x.id === p.id); return `<tr class="${p.on ? '' : 'off'}">
      <td><span class="dot ${p.on ? 'on' : ''}" title="${p.on ? 'Connected' : 'Disconnected'}"></span><b style="color:${p.color}">${esc(p.name)}</b>${v.at ? `<span class="fine" title="${esc(v.skill || '')}">At ${esc(v.at)}${v.tries ? ` · ${v.tries} ${v.tries === 1 ? 'try' : 'tries'}` : ''}${v.skill ? ` · ${esc(v.skill)}` : ''}</span>` : v.skill ? `<span class="fine" title="${esc(v.skill)}">Mission waiting · ${esc(v.skill)}</span>` : !p.on ? '<span class="fine">Disconnected. They can rejoin with the same name.</span>' : ''}</td>
      ${teams ? `<td>${r.phase === 'lobby' ? `<button class="mini team" data-act="team" data-id="${p.id}" style="--c:${p.team === null ? '#9DAEDA' : TEAM[p.team][1]}">${p.team === null ? 'Auto' : TEAM[p.team][0]}</button>` : `<span style="color:${p.color}">${p.team === null ? '—' : TEAM[p.team][0]}</span>`}</td>` : ''}
      <td>${v.total ? `<span class="mpips">${Array.from({ length: v.total }, (_, i) => `<i class="${i < v.done ? 'on' : ''}"></i>`).join('')}</span>` : '—'}</td>
      <td>${r.phase === 'control' ? (v.locked ? '<span class="ok">Locked</span>' : `${v.planned} moves`) : v.charge}</td>
      <td>${v.answered ? `${v.first}/${v.answered}` : '—'}</td>
      <td class="acts">${r.phase === 'build' && v.at ? `<button class="mini" data-act="assist" data-id="${p.id}" title="Mark this mission done with your help">Assist</button>` : ''}<button class="mini" data-act="edit-player" data-id="${p.id}">Settings</button></td></tr>`; }).join('')}</tbody></table>`
    : '<p class="empty">No students yet. They appear here as they join.</p>';
  $('#tboard').innerHTML = r.phase === 'lobby' ? `<div class="join-card"><p>Students open Safari and go to</p><p class="board">${esc((T.info.urls[0] || location.origin).replace(/^https?:\/\//, ''))}</p><p>and type the code <b>${r.code}</b></p></div>` : '';
  $('#tboard').hidden = r.phase !== 'lobby';
  const ranked = [...r.sides].sort((a, b) => b.score - a.score || b.zones - a.zones);
  $('#standings').innerHTML = r.map ? ranked.map((s, i) => `<span class="chip" style="--c:${s.color}"><i>${i + 1}</i><span>${esc(s.name)}</span><b>${s.score}</b></span>`).join('') : '';
  if (city) {
    city.setPlayers(r.players);
    city.setState({ sides: sideMap(), phase: r.phase, names: true, used: [], missionsLeft: r.phase === 'build' ? 1 : 0 });
    if (!T.playing) city.setState({ own: r.map?.own || [], lvl: r.map?.lvl || [], hot: r.map?.hot || [], jammed: r.phase === 'results' ? T.resolve?.jammed || [] : [], surged: r.phase === 'results' ? T.resolve?.surged || [] : [] });
  }
  if (r.phase === 'final' && r.final) $('#tcap').textContent = `Match over. ${r.final.awards.map((a) => `${a.title}: ${sideMap().get(a.id)?.name || r.players.find((p) => p.id === a.id)?.name || ''}`).join(' · ')}`;
  else if (!T.playing && r.phase !== 'results') $('#tcap').textContent = r.map ? 'Yellow rings are hotspots worth 2 extra points this round.' : '';
}
async function onResolve(m) {
  T.resolve = m;
  if (T.view !== 'live' || !city || !m.replay) { if (T.view === 'live') updateLive(); return; }
  T.playing = true;
  const sides = sideMap(), cap = $('#tcap'), hexes = T.map.hexes;
  await city.playResolve(m, (e) => {
    const who = sides.get(e.side)?.name || '', hx = hexes[e.h].name;
    if (cap) cap.textContent = { capture: `${who} took ${hx}`, reinforce: `${who} reinforced ${hx}`, hold: `${who} held ${hx}`, blocked: `${who} shielded ${hx}`, override: `OVERRIDE: ${who} took ${hx}`, jam: `${hx} was jammed`, surge: `${who} surged ${hx}` }[e.k];
    return e.k === 'override' ? 2300 : 0;
  });
  T.playing = false;
  if (cap) cap.textContent = `Round ${m.round} resolved.`;
  updateLive();
}

// ---------- settings drawer ----------
function profileEditor(p) {
  return `<h3>Topics and tiers</h3><div class="pt">${T.meta.topics.map((t) => `<div class="pt-row"><span>${esc(t.name)}</span>${seg('p-topic', [['off', 'Off'], ['A', 'A'], ['B', 'B'], ['C', 'C']], p.topics[t.id] || 'off', `data-topic="${t.id}"`)}</div>`).join('')}</div>
    <p class="fine">A Foundational · B Developing · C Applied. Missions rotate through the topics that are on.</p>
    <h3>Answer choices</h3>${seg('p-choices', [[2, '2'], [3, '3'], [4, '4']], p.choices)}
    <h3>Supports</h3><div class="toggles">${TOGGLES.map(([k, n]) => `<button class="tog ${p[k] ? 'on' : ''}" data-act="p-toggle" data-k="${k}" aria-pressed="${!!p[k]}"><i></i>${n}</button>`).join('')}</div>
    <p class="fine">Supports never reduce what a student earns in the game. Retries and a hint after a wrong answer are always on. Fast travel lets a student tap the city map to jump to a place instead of steering there.</p>`;
}
function openDrawer(edit) { T.edit = edit; drawDrawer(); drawer.hidden = false; }
function closeDrawer() { T.edit = null; drawer.hidden = true; drawer.innerHTML = ''; }
function drawDrawer() {
  const e = T.edit; if (!e) return;
  const pl = e.kind === 'player' ? T.room?.priv.find((x) => x.id === e.id) : null;
  drawer.innerHTML = `<aside class="sheet-side" role="dialog" aria-label="Settings for ${esc(e.title)}"><header><div><small>${e.kind === 'defaults' ? 'Used for new students' : e.kind === 'roster' ? 'Saved student' : 'In this game'}</small><h2>${esc(e.title)}</h2></div><button data-act="close-drawer">Done</button></header>
    <div class="sheet-body">${profileEditor(e.profile)}
    ${e.kind === 'player' ? `<div class="row">${pl && !pl.rosterId ? '<button data-act="save-player">Save to my students</button>' : '<span class="fine">Saved student: changes are kept for next time.</span>'}<button class="quiet" data-act="kick">Remove from game</button></div>` : ''}</div></aside>`;
}
async function commitProfile() {
  const e = T.edit;
  try {
    if (e.kind === 'player') net.send({ t: 't_set', playerId: e.id, profile: e.profile });
    else if (e.kind === 'roster') { const saved = await api('/api/roster', { method: 'POST', body: { id: e.id, name: e.title, settings: e.profile } }); T.roster = T.roster.map((r) => (r.id === saved.id ? saved : r)); }
    else T.info.defaults = await api('/api/defaults', { method: 'PUT', body: e.profile });
  } catch (err) { say(err.message); }
  drawDrawer();
}

// ---------- preview ----------
async function showPreview(body) {
  try {
    const q = await api('/api/questions/preview', { method: 'POST', body });
    drawer.hidden = false; T.edit = null;
    drawer.innerHTML = `<aside class="sheet-side wide" role="dialog" aria-label="Question preview"><header><div><small>What the student sees</small><h2>${esc(q.skillName)}</h2></div><button data-act="close-drawer">Done</button></header>
      <div class="sheet-body"><div class="preview"><h1 class="q-prompt">${esc(q.prompt)}</h1>${q.stim ? `<div class="q-stim">${renderVisual(q.stim)}</div>` : ''}
      <div class="q-choices n${q.choices.length}">${q.choices.map((c) => `<div class="choice ${c.id === q.answerId ? 'right' : ''}">${renderChoice(c)}</div>`).join('')}</div></div>
      <p class="fine">The correct answer is outlined in green here only. Hint after a wrong answer: "${esc(q.hint.text)}"</p>
      ${body.custom ? '' : `<button data-act="preview" data-topic="${body.topic}" data-level="${body.level}">Show another</button>`}</div></aside>`;
  } catch (e) { say(e.message); }
}
function readForm() {
  T.form = { topic: $('#f-topic').value, level: $('#f-level').value, prompt: $('#f-prompt').value, short: $('#f-short').value, emoji: $('#f-emoji').value, text: $('#f-text').value, hint: $('#f-hint').value,
    choices: [0, 1, 2, 3].map((i) => $(`#f-c${i}`).value), answer: Number($('input[name="f-answer"]:checked')?.value || 0) };
  const filled = T.form.choices.map((c, i) => [c.trim(), i]).filter(([c]) => c);
  return { ...T.form, choices: filled.map(([c]) => c), answer: filled.findIndex(([, i]) => i === T.form.answer) };
}

// ---------- actions ----------
const ACTS = {
  nav: (b) => { T.report = null; go(b.dataset.v); },
  signout: signOut,
  step: (b) => { const live = !!T.room; const o = live ? { ...T.room.opts } : T.create; o[b.dataset.k] += Number(b.dataset.d); if (live) { T.optsOpen = true; net.send({ t: 't_opts', opts: o }); } else render(); },
  'opt-mode': (b) => { if (T.room) { T.optsOpen = true; net.send({ t: 't_opts', opts: { ...T.room.opts, mode: b.dataset.v } }); } else { T.create.mode = b.dataset.v; render(); } },
  'opt-topup': (b) => { const v = b.dataset.v === 'true'; if (T.room) { T.optsOpen = true; net.send({ t: 't_opts', opts: { ...T.room.opts, topUp: v } }); } else { T.create.topUp = v; render(); } },
  bigmap: () => { T.big = !T.big; updateLive(); },
  names: () => net.send({ t: 't_names', on: T.room.names === false }),
  create: () => { if (!net.send({ t: 't_create', opts: T.create })) say('Not connected to the server yet. Try again in a moment.'); },
  send: (b) => { const m = { t: b.dataset.t }; if (b.dataset.paused) m.paused = b.dataset.paused === 'true'; net.send(m); },
  end: () => { if (confirm('End the game now and show final results?')) net.send({ t: 't_end' }); },
  close: () => { if (confirm('Close this room? Students will be sent back to the code screen. Saved records stay.')) net.send({ t: 't_close' }); },
  team: (b) => { const p = T.room.players.find((x) => x.id === b.dataset.id); const next = p.team === null ? 0 : p.team + 1 >= T.room.opts.teamCount ? null : p.team + 1; net.send({ t: 't_team', playerId: p.id, team: next }); },
  assist: (b) => net.send({ t: 't_assist', playerId: b.dataset.id }),
  'edit-player': (b) => { const p = T.room.players.find((x) => x.id === b.dataset.id), v = T.room.priv.find((x) => x.id === b.dataset.id); openDrawer({ kind: 'player', id: p.id, title: p.name, profile: structuredCloneSafe(v.profile) }); },
  'edit-roster': (b) => { const r = T.roster.find((x) => x.id === b.dataset.id); openDrawer({ kind: 'roster', id: r.id, title: r.name, profile: structuredCloneSafe(r.settings) }); },
  'edit-defaults': () => openDrawer({ kind: 'defaults', title: 'Class defaults', profile: structuredCloneSafe(T.info.defaults) }),
  'close-drawer': () => { const wasRoster = T.edit?.kind === 'roster'; closeDrawer(); if (wasRoster && T.view === 'students') render(); },
  'p-topic': (b) => { const p = T.edit.profile, id = b.dataset.topic, v = b.dataset.v; if (v === 'off') { if (Object.keys(p.topics).length <= 1 && p.topics[id]) return say('Keep at least one topic on.'); delete p.topics[id]; } else p.topics[id] = v; commitProfile(); },
  'p-choices': (b) => { T.edit.profile.choices = Number(b.dataset.v); commitProfile(); },
  'p-toggle': (b) => { T.edit.profile[b.dataset.k] = !T.edit.profile[b.dataset.k]; commitProfile(); },
  'save-player': () => { net.send({ t: 't_save', playerId: T.edit.id }); say('Saved. They can tap their name to join next time.'); setTimeout(async () => { T.roster = await api('/api/roster'); drawDrawer(); }, 300); },
  kick: () => { if (confirm(`Remove ${T.edit.title} from this game?`)) { net.send({ t: 't_kick', playerId: T.edit.id }); closeDrawer(); } },
  'del-roster': async (b) => { const r = T.roster.find((x) => x.id === b.dataset.id); if (!confirm(`Remove ${r.name} from your saved students? Their progress records are kept.`)) return; await api(`/api/roster/${r.id}`, { method: 'DELETE' }); T.roster = T.roster.filter((x) => x.id !== r.id); render(); },
  bulk: (b) => { const id = b.dataset.topic, v = b.dataset.v; let n = 0; for (const p of T.room.priv) { const topics = { ...p.profile.topics }; if (v === 'off') { if (Object.keys(topics).length <= 1 && topics[id]) continue; delete topics[id]; } else topics[id] = v; net.send({ t: 't_set', playerId: p.id, profile: { ...p.profile, topics } }); n++; } say(`${T.meta.topics.find((t) => t.id === id).name} ${v === 'off' ? 'turned off' : `set to tier ${v}`} for ${n} ${n === 1 ? 'student' : 'students'}.`); },
  preview: (b) => showPreview({ topic: b.dataset.topic, level: b.dataset.level }),
  'preview-custom': () => showPreview({ custom: readForm() }),
  'del-q': async (b) => { await api(`/api/questions/${b.dataset.id}`, { method: 'DELETE' }); T.questions = T.questions.filter((q) => q.id !== b.dataset.id); render(); },
  export: async () => { try { const csv = await api('/api/reports/export.csv'); const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); a.download = `override-progress-${new Date().toISOString().slice(0, 10)}.csv`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); } catch (e) { say(e.message); } },
  refresh: loadProgress,
  report: async (b) => { try { T.report = await api(`/api/reports/student?key=${encodeURIComponent(b.dataset.key)}`); render(); $('.tmain').scrollTop = 0; } catch (e) { say(e.message); } },
  'back-progress': () => { T.report = null; render(); },
};
const structuredCloneSafe = (o) => JSON.parse(JSON.stringify(o));

document.addEventListener('click', (e) => {
  if (e.target === drawer) return ACTS['close-drawer']();
  const b = e.target.closest('[data-act]');
  if (b && ACTS[b.dataset.act] && !b.disabled) ACTS[b.dataset.act](b);
});
document.addEventListener('toggle', (e) => { if (e.target.classList?.contains('fold')) T.optsOpen = e.target.open; }, true);
document.addEventListener('submit', async (e) => {
  e.preventDefault();
  const kind = e.target.dataset.form;
  try {
    if (kind === 'login') {
      const r = await fetch('/api/teacher/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pin: $('#pin').value.trim() }) });
      const d = await r.json();
      if (!r.ok) return renderLogin(d.error);
      T.token = d.token; sessionStorage.setItem('ovr_teacher', d.token); boot();
    } else if (kind === 'roster') {
      const saved = await api('/api/roster', { method: 'POST', body: { name: $('#rname').value } });
      T.roster = [...T.roster, saved].sort((a, b) => a.name.localeCompare(b.name)); render(); $('#rname').focus();
    } else if (kind === 'question') {
      const saved = await api('/api/questions', { method: 'POST', body: readForm() });
      T.questions = [...T.questions, saved]; T.form = { ...T.form, prompt: '', short: '', emoji: '', text: '', choices: ['', '', '', ''], answer: 0, hint: '' };
      render(); say('Question saved.');
    }
  } catch (err) { say(err.message); }
});
boot();
