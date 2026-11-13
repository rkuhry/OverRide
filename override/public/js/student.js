// OVERRIDE student game. The server decides everything that matters (position
// checks, missions, charge, ownership, score); this file draws the city, moves
// your avatar locally for smooth control, and sends taps and positions back.
import { $, $$, esc, sleep, load, save, Net } from './util.js';
import { play, unlock, sound, speak, primeSpeech } from './audio.js';
import { avatarSVG, PRESETS, COUNTS, HAIR_NAMES, GEAR_NAMES } from './avatars.js';
import { renderVisual, renderChoice, choiceSpeech } from './visuals.js';
import { GridMap } from './map.js';
import * as CITY from './world/city.js';
import { findPath } from './world/nav.js';
import { CityView } from './world/view.js';

const app = $('#app'), modal = $('#modal'), banner = $('#banner'), fx = $('#fx');
const COST = { power: 1, shield: 2, surge: 2, jam: 2, override: 0 };
const MAX_CHARGE = 9;
const I = (d, fill) => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${d}" ${fill ? 'fill="currentColor"' : 'fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"'}/></svg>`;
const ICON = {
  bolt: I('M13.5 1L4 13.5h6.5L9.5 23 20 9.5h-6.5Z', true),
  shield: I('M12 2l8 3v6c0 5-3.4 9-8 11-4.6-2-8-6-8-11V5z'),
  surge: I('M12 3v18M5 10l7-7 7 7M7 21h10'),
  jam: I('M3 12h3l2-6 4 12 3-9 2 3h4'),
  override: I('M12 2L22 12 12 22 2 12ZM12 7.5L16.5 12 12 16.5 7.5 12Z'),
  say: I('M4 9v6h4l5 4V5L8 9zM16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12'),
  gear: I('M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7zM19 12l2-1.5-2-3.4-2.3 1a7 7 0 0 0-1.7-1L14.6 4h-4l-.4 2.6a7 7 0 0 0-1.7 1l-2.3-1-2 3.4L6 12l-2 1.5 2 3.4 2.3-1a7 7 0 0 0 1.7 1l.4 2.6h4l.4-2.6a7 7 0 0 0 1.7-1l2.3 1 2-3.4z'),
  undo: I('M9 7L4 12l5 5M4 12h11a5 5 0 0 1 0 10h-3'),
  x: I('M6 6l12 12M18 6L6 18'),
  calc: I('M6 2h12a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1zM8 6h8v3H8zM8.5 13h.01M12 13h.01M15.5 13h.01M8.5 17h.01M12 17h.01M15.5 17h.01'),
  hint: I('M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.3 1 2.1h5c0-.8.4-1.6 1-2.1A6 6 0 0 0 12 3z'),
  map: I('M9 4L3 6v14l6-2 6 2 6-2V4l-6 2zM9 4v14M15 6v14'),
  term: I('M4 4h16v11H4zM8 20h8M12 15v5M8 9h2M12 9h4'),
  plus: I('M12 5v14M5 12h14'), minus: I('M5 12h14'),
  walk: I('M13 4a2 2 0 1 0 0-.01M9 21l2-6 3 3v3M7 12l3-4 4 1 3 3M11 15l1-5'),
};
const MODES = [
  { id: 'power', name: 'Power', cost: '1 charge', icon: ICON.bolt, help: 'Adds 1 power here. Send more than its level to take it.' },
  { id: 'shield', name: 'Shield', cost: '2 charge', icon: ICON.shield, help: 'Your zone. Nothing can take it this round.' },
  { id: 'surge', name: 'Surge', cost: '2 charge', icon: ICON.surge, help: 'Your zone. It scores double this round.' },
  { id: 'jam', name: 'Jam', cost: '2 charge', icon: ICON.jam, help: 'A rival zone. It scores nothing this round.' },
  { id: 'override', name: 'Override', cost: '1 use', icon: ICON.override, help: 'Take this zone whatever its level. One use each match.' },
];
const TYPE_LINE = { core: 'Worth 3 points every round', vault: 'Worth 2 points every round', lab: 'Firewall: +1 defense', power: 'Gives +1 charge next round', std: 'Worth 1 point every round' };

const S = {
  screen: '', code: '', room: null, name: '', rosterId: null, avatar: load('ovr_avatar', PRESETS[0]),
  me: load('ovr_session', null), joined: false, state: null, you: null, map: null,
  pos: null, path: null, arrive: null, input: { x: 0, y: 0 }, keys: new Set(), lastSent: null, sentAt: 0, stuck: { t: 0, x: 0, y: 0, n: 0 },
  overlay: null, resolve: null, playing: false, shownQ: null, busy: false, wrongOnce: false, lastTap: null, toastT: 0,
  prefs: load('ovr_prefs', { motion: !matchMedia('(prefers-reduced-motion: reduce)').matches, joystick: true }),
};
let view = null, overview = null;
const calm = () => !S.prefs.motion || !!S.you?.ui?.calm;

// ---------- network ----------
const net = new Net({
  onOpen: () => { if (S.me) net.send({ t: 'rejoin', code: S.me.code, token: S.me.token }); },
  onStatus: (on) => { banner.hidden = on || !S.me; banner.textContent = on ? '' : 'Reconnecting…'; },
  onMessage: (m) => {
    switch (m.t) {
      case 'joined':
        S.me = { code: m.code, token: m.token, id: m.id, name: m.name }; S.joined = true; S.err = ''; S.pending = false;
        S.pos = { x: m.x, y: m.y }; S.path = null; S.lastSent = { x: m.x, y: m.y };
        save('ovr_session', S.me);
        break;
      case 'join_error':
        if (m.msg === 'gone') { leave(); break; }
        S.err = m.msg; S.pending = false; go(S.rosterId || S.name ? 'name' : 'join'); break;
      case 'map': S.map = m; break;
      case 'state': S.state = m; onState(); break;
      case 'you': S.you = m; onYou(); break;
      case 'pp': if (view) view.positions(m.p); break;
      case 'pos': if (S.pos) { S.pos = { x: m.x, y: m.y }; S.lastSent = { x: m.x, y: m.y }; S.path = null; } break;
      case 'note': toast(m.msg); break;
      case 'feedback': onFeedback(m); break;
      case 'resolve': onResolve(m); break;
      case 'replaced': net.wanted = false; S.me = null; S.joined = false; S.err = 'This player is now open on another screen.'; go('join'); break;
      case 'removed': case 'closed': leave(m.t === 'closed' ? 'Your teacher closed the game.' : ''); break;
    }
  },
});
function leave(msg = '') {
  Object.assign(S, { me: null, joined: false, state: null, you: null, map: null, code: '', room: null, name: '', rosterId: null, pos: null, overlay: null });
  save('ovr_session', null); banner.hidden = true; S.err = msg; go('join');
}

function applyUi() {
  const ui = S.you?.ui || {};
  document.body.classList.toggle('ui-large', !!ui.large);
  document.body.classList.toggle('ui-contrast', !!ui.contrast);
  document.body.classList.toggle('ui-calm', calm());
  sound.quietMusic(!!ui.calm);
  if (view) view.reduced = calm();
}

// ---------- screens ----------
function go(screen) {
  S.screen = screen;
  if (screen !== 'world') { if (view) view.stop(); view = null; closeOverlay(); }
  app.className = `screen-${screen}`;
  app.innerHTML = VIEWS[screen]();
  if (screen === 'world') mountWorld();
  update();
  if (screen === 'name') $('#nick')?.focus({ preventScroll: true });
}
function update() { const u = UPDATES[S.screen]; if (u) u(); }
function onState() {
  if (!S.joined || !S.state) return;
  if (S.screen !== 'world' && !S.editing) go('world');
  $('#paused').hidden = !S.state.paused;
  if (view) {
    view.setPlayers(S.state.players);
    if (!S.playing) view.setState({ own: S.state.map?.own || [], lvl: S.state.map?.lvl || [], hot: S.state.map?.hot || [] });
    view.setState({ sides: sideMap(), phase: S.state.phase, names: S.state.names !== false });
  }
  if (S.state.phase !== 'results' && S.state.phase !== 'final') hideScores();
  if (S.state.phase === 'build' && S.lastPhase !== 'build') { play('round'); toast(`Round ${S.state.round}. Terminals are open.`); }
  if (S.state.phase === 'control' && S.lastPhase !== 'control') { play('charge'); toast('The grid is open. Walk into rings to place your charge.'); if (S.overlay === 'terminal') closeOverlay(); }
  if (S.state.phase === 'final' && S.lastPhase !== 'final') showFinal();
  if (S.state.phase === 'lobby' && S.lastPhase === 'final') closeOverlay();
  S.lastPhase = S.state.phase;
  update();
}
function onYou() {
  applyUi();
  if (view) view.setState({ plan: S.you.plan, used: S.you.used, mySide: S.you.side, missionsLeft: S.you.missions.total - S.you.missions.done });
  if (S.you.q && S.screen === 'world') openTerminal();
  else if (S.overlay === 'terminal' && !S.busy) closeOverlay();
  update();
}

const me = () => S.state?.players.find((p) => p.id === S.me?.id);
const sideMap = () => new Map((S.state?.sides || []).map((s) => {
  const p = S.state.mode === 'teams' ? null : S.state.players.find((x) => x.id === s.id);
  return [s.id, { ...s, tag: p ? p.tag : (s.name.split(' ')[1] || s.name).slice(0, 3).toUpperCase() }];
}));
const planCost = (plan) => plan.reduce((s, a) => s + COST[a.type], 0);
const ranked = () => [...(S.state?.sides || [])].sort((a, b) => b.score - a.score || b.zones - a.zones);

// ---------- views ----------
const VIEWS = {
  join: () => `<main class="join">
    <section class="hero"><h1 class="logo" data-text="OVERRIDE">OVERRIDE</h1><p class="tag">Control the grid.</p><p class="lede">Type the game code from the board.</p></section>
    <section class="pad-wrap">
      <div class="code" id="code" aria-live="polite"></div>
      <p class="err" id="err" role="alert"></p>
      <div class="pad">${[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => `<button data-act="digit" data-d="${n}">${n}</button>`).join('')}<button data-act="back" aria-label="Delete">${ICON.undo}</button><button data-act="digit" data-d="0">0</button><span></span></div>
    </section></main>`,
  name: () => `<main class="who">
    <button class="link" data-act="restart">Change game code</button>
    <h1>Who is playing?</h1>
    <p class="err" id="err" role="alert"></p>
    ${S.room?.roster?.length ? `<div class="roster">${S.room.roster.map((r) => `<button data-act="pick" data-id="${esc(r.id)}">${esc(r.name)}</button>`).join('')}</div><p class="or">Not on the list? Type a nickname.</p>` : '<p class="or">Type a nickname. First name or a made-up name is fine.</p>'}
    <form class="nick" data-form="nick"><input id="nick" maxlength="14" autocomplete="off" autocapitalize="words" spellcheck="false" placeholder="Nickname" aria-label="Nickname"><button class="primary">Next</button></form></main>`,
  avatar: () => `<main class="look">
    <section class="look-me"><div class="pedestal" id="avBig"></div><h2>${esc(S.name)}</h2><button class="primary big" data-act="enter" id="enter">Enter the city</button>${S.joined ? '' : '<button class="link" data-act="toName">Not you? Go back</button>'}</section>
    <section class="look-pick">
      <h1>Choose your look</h1>
      <div class="presets" id="presets"></div>
      <div class="cyclers">${[['hair', 'Hair'], ['tone', 'Color'], ['skin', 'Skin'], ['gear', 'Gear']].map(([k, n]) => `<div class="cycler"><button data-act="cycle" data-k="${k}" data-d="-1" aria-label="Previous ${n}">‹</button><span>${n}<b id="cy-${k}"></b></span><button data-act="cycle" data-k="${k}" data-d="1" aria-label="Next ${n}">›</button></div>`).join('')}</div>
    </section></main>`,
  world: () => `<div class="world">
    <canvas id="city" aria-label="The city. Use the joystick or tap a place to walk there."></canvas>
    <header class="hud">
      <div class="hud-left"><span class="logo-sm">OVERRIDE</span><span class="phase" id="phase"></span></div>
      <div class="hud-task" id="task" aria-live="polite"></div>
      <div class="hud-right"><div class="charge" id="charge" role="img"></div>
        <button class="hud-btn" data-act="map" aria-label="City map">${ICON.map}<span>Map</span></button>
        <button class="icon-btn" data-act="settings" aria-label="Settings">${ICON.gear}</button></div>
    </header>
    <div class="strip" id="strip"></div>
    <div class="joy" id="joy" aria-label="Joystick"><div class="joy-ring"><div class="joy-knob" id="knob"></div></div></div>
    <div class="zoom"><button data-act="zoom" data-d="1" aria-label="Zoom in">${ICON.plus}</button><button data-act="zoom" data-d="-1" aria-label="Zoom out">${ICON.minus}</button></div>
    <aside class="ctx" id="ctx"></aside>
    <p class="caption" id="caption" aria-live="polite"></p>
    <aside class="scores" id="scores" hidden></aside>
    <div class="toast" id="toast" role="status" hidden></div>
    <div class="overlay" id="overlay" hidden></div>
  </div>`,
};

const UPDATES = {
  join() {
    $('#code').innerHTML = [0, 1, 2, 3].map((i) => `<span class="${S.code[i] ? 'on' : ''}">${S.code[i] || ''}</span>`).join('');
    $('#err').textContent = S.err || '';
  },
  name() { $('#err').textContent = S.err || ''; },
  avatar() {
    $('#avBig').innerHTML = avatarSVG(S.avatar);
    $('#presets').innerHTML = PRESETS.map((p, i) => `<button data-act="preset" data-i="${i}" class="${JSON.stringify(p) === JSON.stringify(S.avatar) ? 'on' : ''}" aria-label="Look ${i + 1}">${avatarSVG(p)}</button>`).join('');
    $('#cy-hair').textContent = HAIR_NAMES[S.avatar.hair]; $('#cy-gear').textContent = GEAR_NAMES[S.avatar.gear];
    $('#cy-tone').textContent = S.avatar.tone + 1; $('#cy-skin').textContent = S.avatar.skin + 1;
    $('#enter').disabled = !!S.pending; $('#enter').textContent = S.pending ? 'Joining…' : S.joined ? 'Back to the city' : 'Enter the city';
  },
  world() {
    if (!S.state || !S.you) return;
    const st = S.state, you = S.you, phase = st.phase;
    $('#phase').textContent = st.round ? `Round ${st.round}/${st.rounds} · ${{ build: 'Power up', control: 'Control', results: 'Results', final: 'Final' }[phase] || ''}` : 'Lobby';
    const planned = phase === 'control' ? planCost(you.plan) : 0;
    const c = $('#charge'), have = you.charge;
    c.setAttribute('aria-label', `${have - planned} charge`);
    c.innerHTML = `<span class="charge-ico">${ICON.bolt}</span><span class="cells">${Array.from({ length: MAX_CHARGE }, (_, i) => `<i class="${i < have - planned ? 'on' : i < have ? 'used' : ''}"></i>`).join('')}</span><b>${have - planned}</b>`;
    c.hidden = phase === 'lobby';
    $('#task').innerHTML = taskLine();
    $('#strip').innerHTML = phase === 'control' || phase === 'build' ? scoreStrip() : '';
    $('#joy').hidden = !S.prefs.joystick || S.playing;
    renderCtx();
    if (S.overlay === 'map') drawOverview();
  },
};

function taskLine() {
  const st = S.state, you = S.you, n = st.players.length;
  if (S.playing) return '<b>Watch the city.</b> Every move resolves at once.';
  switch (st.phase) {
    case 'lobby': return `<b>Waiting for your teacher.</b> Explore the city. ${n} ${n === 1 ? 'player' : 'players'} here.`;
    case 'build': {
      const { done, total } = you.missions;
      const pips = `<span class="pips">${Array.from({ length: total }, (_, i) => `<i class="${i < done ? 'on' : ''}"></i>`).join('')}</span>`;
      return done >= total ? `<b>Fully charged.</b> Scout the rings for the next phase.${pips}` : `<b>Find a glowing terminal.</b> ${done} of ${total} missions done.${pips}`;
    }
    case 'control': return you.locked ? '<b>Locked in.</b> Waiting for the others.' : `<b>Walk into a ring</b> to place charge. ${you.charge - planCost(you.plan)} left.`;
    case 'results': return '<b>Round results.</b> Next round starts soon.';
    case 'final': return '<b>Match over.</b>';
  }
  return '';
}
function scoreStrip() {
  const r = ranked(), mine = S.you?.side;
  const idx = r.findIndex((s) => s.id === mine);
  const show = r.slice(0, 3);
  if (idx > 2) show[2] = r[idx];
  return show.map((s) => `<span class="chip ${s.id === mine ? 'me' : ''}" style="--c:${s.color}"><i>${r.indexOf(s) + 1}</i><span>${esc(s.name)}</span><b>${s.score}</b></span>`).join('');
}

// ---------- the context card (bottom right) ----------
function renderCtx() {
  const el = $('#ctx'); if (!el) return;
  const st = S.state, you = S.you, pos = S.pos;
  if (!st || !you || !pos || S.playing || st.phase === 'results' || st.phase === 'final') { el.hidden = true; return; }
  el.hidden = false;
  let html = '';
  if (st.phase === 'lobby') {
    html = `<h2>How to play</h2><ol class="howto">
      <li><span>${ICON.term}</span><div><b>Power up</b>Walk to glowing terminals. Each mission earns 1 charge.</div></li>
      <li><span>${ICON.bolt}</span><div><b>Control</b>Walk into rings and spend charge to take zones.</div></li>
      <li><span>${ICON.shield}</span><div><b>Score</b>Every zone you hold scores each round.</div></li></ol>
      <p class="fine">Move with the joystick, or tap a place on the street.</p><button data-act="relook">Change my look</button>`;
  } else if (st.phase === 'build') {
    const term = CITY.terminalNear(pos.x, pos.y);
    const left = you.missions.total - you.missions.done;
    if (left <= 0) html = `<h2>Fully charged</h2><p>You have ${you.charge} charge. When the grid opens, walk into rings to use it.</p>`;
    else if (term) {
      const used = you.used.includes(term.id);
      html = `<h2>${esc(term.name)}</h2>${used ? `<p>Done this round. Try a different terminal.</p><button data-act="nearest">${ICON.walk} Go to the next one</button>` : `<button class="primary big interact" data-act="use" data-term="${term.id}">${ICON.term} Use terminal</button>`}`;
    } else html = `<h2>Missions: ${you.missions.done} of ${you.missions.total}</h2><p>Glowing <b class="glow">$</b> terminals give missions. Each one earns 1 charge.</p><button class="primary" data-act="nearest">${ICON.walk} Go to a terminal</button>`;
  } else if (st.phase === 'control') {
    const node = CITY.nodeAtPoint(pos.x, pos.y);
    if (you.locked) html = `<h2>Locked in</h2><p>${you.plan.length} ${you.plan.length === 1 ? 'move' : 'moves'} placed.</p><button data-act="unlock">Change plan</button>`;
    else if (node) html = zoneCard(node);
    else html = `<h2>Your plan</h2>${planList(null)}<p class="fine">Walk into any ring to act there. You can place moves in several rings.</p>
      <div class="ctx-foot"><button data-act="map">${ICON.map} Map</button><button class="primary" data-act="lock">Lock in</button></div>`;
  }
  el.innerHTML = html;
}
function zoneCard(node) {
  const st = S.state, you = S.you, sides = sideMap();
  const owner = st.map.own[node.id], lvl = st.map.lvl[node.id], side = owner ? sides.get(owner) : null;
  const mine = owner && owner === you.side;
  const left = you.charge - planCost(you.plan);
  const has = (t) => you.plan.some((a) => a.type === t);
  const here = you.plan.filter((a) => a.hex === node.id && a.type === 'power').length;
  const need = owner && !mine ? lvl + (node.type === 'lab' ? 1 : 0) + 1 : null;
  const can = {
    power: left >= 1,
    shield: mine && left >= 2 && !has('shield'),
    surge: mine && left >= 2 && !has('surge'),
    jam: owner && !mine && left >= 2 && !has('jam'),
    override: !mine && you.tokens > 0 && !has('override'),
  };
  const show = MODES.filter((m) => (mine ? ['power', 'shield', 'surge'] : owner ? ['power', 'jam', 'override'] : ['power', 'override']).includes(m.id));
  return `<div class="zone-head" style="--c:${side ? side.color : '#7F93C9'}"><h2>${esc(node.name)}</h2>
      <p>${TYPE_LINE[node.type]}${st.map.hot.includes(node.id) ? ' · <b class="hot">Hotspot +2</b>' : ''}</p>
      <p class="owner">${side ? `${mine ? 'Yours' : `Held by ${esc(side.name)}`} · level ${lvl}` : 'Open: nobody holds it'}</p>
      ${need ? `<p class="need">Send ${need} power to take it${node.type === 'lab' ? ' (firewall)' : ''}. You placed ${here}.</p>` : !owner ? `<p class="need">Most power takes it. You placed ${here}.</p>` : here ? `<p class="need">+${here} reinforcing.</p>` : ''}</div>
    <div class="acts">${show.map((m) => `<button class="mode m-${m.id}" data-act="act" data-type="${m.id}" data-hex="${node.id}" ${can[m.id] ? '' : 'aria-disabled="true"'}>${m.icon}<span>${m.id === 'power' ? 'Power +1' : m.name}</span><small>${m.id === 'override' && you.tokens < 1 ? 'used' : m.cost}</small></button>`).join('')}</div>
    ${planList(node.id)}
    <div class="ctx-foot"><button data-act="undo" ${you.plan.length ? '' : 'disabled'}>${ICON.undo} Undo</button><button class="primary" data-act="lock">Lock in</button></div>`;
}
function planList(only) {
  const groups = [];
  S.you.plan.forEach((a, i) => { if (only !== null && a.hex !== only) return; const g = groups.find((x) => x.type === a.type && x.hex === a.hex); if (g) { g.n += 1; g.i = i; } else groups.push({ ...a, n: 1, i }); });
  if (!groups.length) return only !== null ? '' : '<p class="empty">No moves yet.</p>';
  return `<div class="plan">${groups.map((g) => { const m = MODES.find((x) => x.id === g.type); return `<div class="act m-${g.type}">${m.icon}<span><b>${m.name}${g.n > 1 ? ` ×${g.n}` : ''}</b>${esc(CITY.NODES[g.hex].name)}</span><button data-act="unact" data-i="${g.i}" aria-label="Remove">${ICON.x}</button></div>`; }).join('')}</div>`;
}

// ---------- the world ----------
function mountWorld() {
  view = new CityView($('#city'), { mode: 'player', reduced: calm(), onTap: tapWorld });
  view.selfId = S.me.id;
  view.onFrame = frame;
  view.userZoom = S.prefs.zoom || 1;
  if (S.state) { view.setPlayers(S.state.players); view.setState({ own: S.state.map?.own || [], lvl: S.state.map?.lvl || [], hot: S.state.map?.hot || [], sides: sideMap(), phase: S.state.phase, names: S.state.names !== false }); }
  if (S.you) view.setState({ plan: S.you.plan, used: S.you.used, mySide: S.you.side, missionsLeft: S.you.missions.total - S.you.missions.done });
  view.start();
  bindJoystick();
  if (S.you?.q) openTerminal();
}

function frame(dt) {
  if (!S.pos || !view) return;
  view.self = S.pos;
  const st = S.state;
  const frozen = !st || st.paused || S.playing || S.overlay === 'terminal' || S.you?.term || st.phase === 'final';
  let ix = S.input.x, iy = S.input.y;
  if (S.keys.size) {
    ix += (S.keys.has('right') ? 1 : 0) - (S.keys.has('left') ? 1 : 0);
    iy += (S.keys.has('down') ? 1 : 0) - (S.keys.has('up') ? 1 : 0);
  }
  let vx = 0, vy = 0;
  const mag = Math.hypot(ix, iy);
  if (!frozen && mag > 0.15) {
    S.path = null; S.arrive = null; view.path = null;
    const k = Math.min(1, mag) / mag;
    // screen right = world (+x, -y); screen down = world (+x, +y)
    vx = ((ix + iy) * k) / Math.SQRT2; vy = ((iy - ix) * k) / Math.SQRT2;
  } else if (!frozen && S.path) {
    const [tx, ty] = S.path[0];
    const d = Math.hypot(tx - S.pos.x, ty - S.pos.y);
    if (d < 6) {
      S.path.shift();
      if (!S.path.length) { S.path = null; view.path = null; arrived(); }
    } else { vx = (tx - S.pos.x) / d; vy = (ty - S.pos.y) / d; if (d < CITY.SPEED * dt) { vx *= d / (CITY.SPEED * dt); vy *= d / (CITY.SPEED * dt); } }
  }
  if (vx || vy) {
    const [nx, ny] = CITY.slide(S.pos.x, S.pos.y, vx * CITY.SPEED * dt, vy * CITY.SPEED * dt);
    S.pos = { x: nx, y: ny };
    // anti-stuck: if a walk makes no progress, re-plan; if that fails too, ask the server for a hop
    const now = performance.now();
    if (now - S.stuck.t > 1000) {
      if (S.path && Math.hypot(nx - S.stuck.x, ny - S.stuck.y) < 8) {
        S.stuck.n += 1;
        const end = S.path[S.path.length - 1];
        if (S.stuck.n >= 3) { net.send({ t: 'unstick' }); S.path = null; view.path = null; S.stuck.n = 0; } else { S.path = findPath(nx, ny, end[0], end[1]); view.path = S.path; }
      } else S.stuck.n = 0;
      S.stuck = { ...S.stuck, t: now, x: nx, y: ny };
    }
  }
  // send position at most 10 times a second, and once more when we stop
  const now = performance.now();
  if (S.lastSent && (S.pos.x !== S.lastSent.x || S.pos.y !== S.lastSent.y) && now - S.sentAt >= 100) {
    if (net.send({ t: 'mv', x: Math.round(S.pos.x * 10) / 10, y: Math.round(S.pos.y * 10) / 10 })) { S.lastSent = { ...S.pos }; S.sentAt = now; }
  }
  // the context card depends on where we stand
  const key = `${CITY.nodeAtPoint(S.pos.x, S.pos.y)?.id ?? '-'}|${CITY.terminalNear(S.pos.x, S.pos.y)?.id ?? '-'}`;
  if (key !== S.ctxKey) { S.ctxKey = key; renderCtx(); }
}
function walkTo(x, y, arrive = null) {
  if (!S.pos) return;
  S.path = findPath(S.pos.x, S.pos.y, x, y);
  S.arrive = arrive; S.stuck = { t: performance.now(), x: S.pos.x, y: S.pos.y, n: 0 };
  if (view) { view.path = S.path; view.pulseAt(x, y); }
}
function arrived() {
  const a = S.arrive; S.arrive = null;
  if (a?.term !== undefined && S.state?.phase === 'build') ACTS.use({ dataset: { term: a.term } });
}
function tapWorld(hit) {
  unlock();
  if (S.overlay || S.playing || !S.state || S.state.paused) return;
  if (hit.term && S.state.phase === 'build') { const t = hit.term; return walkTo(t.x + Math.sign(CITY.NODES[0].x - t.x) * 30, t.y + Math.sign(CITY.NODES[0].y - t.y) * 30, { term: t.id }); }
  if (hit.node && S.state.phase === 'control') return walkTo(hit.node.x, hit.node.y + 20);
  walkTo(hit.x, hit.y);
}
function nearestTerminal() {
  const used = S.you?.used || [];
  let best = null, bd = Infinity;
  for (const t of CITY.TERMINALS) { if (used.includes(t.id)) continue; const d = Math.hypot(t.x - S.pos.x, t.y - S.pos.y); if (d < bd) { bd = d; best = t; } }
  return best;
}

function bindJoystick() {
  const joy = $('#joy'), knob = $('#knob');
  let pid = null, cx = 0, cy = 0, R = 60;
  const set = (x, y) => {
    let dx = x - cx, dy = y - cy; const d = Math.hypot(dx, dy);
    if (d > R) { dx *= R / d; dy *= R / d; }
    knob.style.transform = `translate(${dx}px,${dy}px)`;
    S.input = { x: dx / R, y: dy / R };
  };
  joy.addEventListener('pointerdown', (e) => {
    unlock();
    const r = joy.querySelector('.joy-ring').getBoundingClientRect();
    cx = r.left + r.width / 2; cy = r.top + r.height / 2; R = r.width * 0.36;
    pid = e.pointerId; joy.setPointerCapture(pid); set(e.clientX, e.clientY); e.preventDefault();
  });
  joy.addEventListener('pointermove', (e) => { if (e.pointerId === pid) set(e.clientX, e.clientY); });
  const end = (e) => { if (e.pointerId !== pid) return; pid = null; knob.style.transform = ''; S.input = { x: 0, y: 0 }; };
  joy.addEventListener('pointerup', end); joy.addEventListener('pointercancel', end);
}

// ---------- terminals and missions ----------
function openTerminal() {
  const q = S.you.q;
  if (S.overlay !== 'terminal') {
    S.overlay = 'terminal'; S.path = null; S.input = { x: 0, y: 0 };
    const o = $('#overlay'); o.hidden = false; o.className = 'overlay terminal';
    o.innerHTML = `<div class="term-sheet" role="dialog" aria-label="${esc(S.you.term?.name || 'Terminal')}">
      <header><span class="term-name">${ICON.term} ${esc(S.you.term?.name || 'Terminal')}</span><span class="fine">No timer. Take your time.</span><button data-act="leave">${ICON.x} Leave</button></header>
      <div class="build" id="build"></div></div>`;
    S.shownQ = null;
  }
  if (S.shownQ !== q.id && !S.busy) renderQuestion(q);
}
function closeOverlay() {
  const o = $('#overlay'); if (o) { o.hidden = true; o.innerHTML = ''; }
  S.overlay = null; S.shownQ = null; S.busy = false;
  if ('speechSynthesis' in window) try { speechSynthesis.cancel(); } catch {}
}
function renderQuestion(q) {
  S.shownQ = q.id; S.wrongOnce = (q.disabled || []).length > 0;
  const ui = S.you.ui;
  $('#build').innerHTML = `<section class="q ${q.stim ? '' : 'nostim'}">
    <div class="q-head"><h1 class="q-prompt">${esc(q.prompt)}</h1><button class="say" data-act="say" aria-label="Read aloud">${ICON.say}</button></div>
    ${q.stim ? `<div class="q-stim">${renderVisual(q.stim)}</div>` : ''}
    <div class="q-choices n${q.choices.length} ${q.choices.every((c) => !c.vis) ? 'text' : 'pics'}">${q.choices.map((c) => `<button class="choice" data-act="answer" data-c="${c.id}">${renderChoice(c)}</button>`).join('')}</div>
    <div class="q-foot"><div class="q-msg" id="qmsg" aria-live="polite"></div>
      <div class="q-tools">${ui.hints ? `<button data-act="hint">${ICON.hint} Hint</button>` : ''}${ui.calculator ? `<button data-act="calc">${ICON.calc} Calculator</button>` : ''}</div></div></section>`;
  markChoices(q.disabled || [], q.reveal);
  if (q.hint) showHint(q.hint);
  if (ui.readAloud) sayQuestion(false);
}
function sayQuestion(log = true) {
  const q = S.you?.q; if (!q) return;
  const labels = q.choices.map(choiceSpeech).filter(Boolean);
  speak(`${q.prompt} ${labels.length === q.choices.length ? `Your choices are: ${labels.join(', or ')}.` : ''}`);
  if (log) net.send({ t: 'support', qid: q.id, kind: 'read' });
}
function markChoices(disabled, reveal) {
  $$('.choice').forEach((b) => { const off = disabled.includes(b.dataset.c); b.classList.toggle('off', off); b.disabled = off; b.classList.toggle('reveal', reveal === b.dataset.c); });
}
function showHint(hint) {
  const el = $('#qmsg'); if (!el || !hint) return;
  el.innerHTML = `<div class="hint"><b>${S.wrongOnce ? 'Not that one. Try again.' : 'Hint'}</b><span>${esc(hint.text)}</span>${hint.vis ? renderVisual(hint.vis) : ''}</div>`;
}
async function onFeedback(m) {
  if (S.overlay !== 'terminal' || m.qid !== S.shownQ) return;
  if (m.correct) {
    S.busy = true;
    const btn = S.lastTap && $(`.choice[data-c="${S.lastTap}"]`);
    $$('.choice').forEach((b) => { b.disabled = true; });
    if (btn) { btn.classList.remove('reveal'); btn.classList.add('right'); btn.insertAdjacentHTML('beforeend', `<span class="plus">${ICON.bolt}+1</span>`); }
    $('#qmsg').innerHTML = '<div class="hint good"><b>Charge earned</b></div>';
    play('correct');
    await sleep(calm() ? 700 : 1100);
    S.busy = false;
    if (S.you?.q) { S.shownQ = null; openTerminal(); } else closeOverlay();
    update();
    return;
  }
  if (!m.soft) { S.wrongOnce = true; play('retry'); }
  markChoices(m.disabled || [], m.reveal);
  showHint(m.hint);
  if (m.reveal) $('#qmsg .hint b').textContent = 'Here is the answer. Tap the glowing one.';
  if (S.you.ui.readAloud && m.hint) speak(m.hint.text);
}

// ---------- overview map ----------
function openMap() {
  S.overlay = 'map'; S.path = null;
  const o = $('#overlay'); o.hidden = false; o.className = 'overlay mapview';
  const warp = !!S.you?.ui?.warp;
  o.innerHTML = `<div class="map-sheet" role="dialog" aria-label="City map"><header><h2>City map</h2><p>${warp ? 'Tap a place to jump there.' : 'Tap a place and your avatar walks there.'}</p><button data-act="close-overlay">${ICON.x} Close</button></header>
    <div class="map-body"><div id="omap" class="map"></div>
    <div class="map-side">${S.state?.phase === 'build' ? `<button class="primary" data-act="nearest">${ICON.term} Nearest terminal</button>` : ''}
      <button data-act="goto" data-node="0">Central Core</button>
      <div class="legend">${CITY.DISTRICTS.slice(1).map((d) => `<button data-act="goto" data-node="${CITY.NODES.find((n) => n.district === d.id).id}" style="--c:${d.color}">${esc(d.name)}</button>`).join('')}</div></div></div></div>`;
  overview = new GridMap($('#omap'), { onTap: (h) => gotoNode(h) });
  overview.onTerm = (id) => gotoTerm(id);
  overview.setMap({ layout: 'city', radius: 0, hexes: CITY.NODES, nbrs: CITY.NBRS });
  drawOverview();
}
function drawOverview() {
  if (!overview || !S.state) return;
  overview.update({ own: S.state.map?.own || CITY.NODES.map(() => null), lvl: S.state.map?.lvl || CITY.NODES.map(() => 0), hot: S.state.map?.hot || [], sides: sideMap(), mySide: S.you?.side, plan: S.you?.plan || [] });
  overview.setTerms(CITY.TERMINALS, S.you?.used || [], S.state.phase === 'build');
  overview.setDots([...(view ? [...view.players.values()].filter((p) => p.id !== S.me.id && p.x != null).map((p) => ({ x: p.x, y: p.y, color: p.color })) : []), { ...S.pos, me: true }]);
}
function gotoNode(h) {
  const n = CITY.NODES[h]; closeOverlay();
  if (S.you?.ui?.warp) return net.send({ t: 'warp', node: h });
  walkTo(n.x, n.y + 20);
}
function gotoTerm(id) {
  const t = CITY.TERMINALS[id]; closeOverlay();
  if (S.you?.ui?.warp) { net.send({ t: 'warp', term: id }); setTimeout(() => { if (S.state?.phase === 'build') ACTS.use({ dataset: { term: id } }); }, 400); return; }
  walkTo(t.x + Math.sign(CITY.NODES[0].x - t.x) * 30, t.y + Math.sign(CITY.NODES[0].y - t.y) * 30, { term: id });
}

// ---------- round resolution ----------
function caption(e, sides) {
  const hex = CITY.NODES[e.h].name, who = sides.get(e.side)?.name || 'Someone', from = e.from ? sides.get(e.from)?.name : null;
  switch (e.k) {
    case 'capture': return from ? `${who} took ${hex} from ${from}` : e.rivals ? `${who} won the race for ${hex}` : `${who} claimed ${hex}`;
    case 'reinforce': return `${who} reinforced ${hex}`;
    case 'hold': return `${who} held ${hex}`;
    case 'blocked': return `Shield up. ${who} protected ${hex}`;
    case 'override': return `${who} overrode ${hex}`;
    case 'jam': return `${hex} was jammed`;
    case 'surge': return `${who} surged ${hex}`;
  }
  return '';
}
async function onResolve(m) {
  S.resolve = m;
  if (S.screen !== 'world' || !view) return;
  if (S.overlay && S.overlay !== 'final') closeOverlay();
  if (!m.replay) { showScores(); return; }
  S.playing = true; S.path = null; view.path = null; hideScores(); update();
  const sides = sideMap(), cap = $('#caption');
  if (calm()) { view.setState({ own: m.after.own, lvl: m.after.lvl, jammed: m.jammed, surged: m.surged }); cap.textContent = `${m.events.length} moves resolved.`; await sleep(600); }
  else await view.playResolve(m, async (e) => {
    cap.textContent = caption(e, sides);
    if (e.k === 'override') {
      play('override');
      fx.innerHTML = `<div class="ovr" style="--c:${sides.get(e.side)?.color || '#FF4FD8'}"><span data-text="OVERRIDE">OVERRIDE</span><b>${esc(caption(e, sides))}</b></div>`;
      setTimeout(() => { fx.innerHTML = ''; }, 2300);
      return 2300;
    }
    play({ capture: 'capture', hold: 'hold', blocked: 'hold', jam: 'jam', surge: 'surge', reinforce: 'tap' }[e.k]);
    return 0;
  });
  if (S.resolve !== m || !view) return;
  S.playing = false; cap.textContent = '';
  play('round');
  showScores(); update();
}
function showScores() {
  const el = $('#scores'), m = S.resolve; if (!el || !m) return;
  const sides = sideMap();
  const rows = [...m.gains].sort((a, b) => b.score - a.score || b.zones - a.zones);
  el.hidden = false;
  el.innerHTML = `<h2>Round ${m.round} scores</h2><ol class="score-list">${rows.map((g, i) => {
    const s = sides.get(g.side) || { name: '—', color: '#888' };
    return `<li class="${g.side === S.you?.side ? 'me' : ''}" style="--c:${s.color}"><i>${i + 1}</i><span>${esc(s.name)}<small>${g.zones} ${g.zones === 1 ? 'zone' : 'zones'}${g.link ? ` · link +${g.link}` : ''}</small></span><em>+${g.total}</em><b>${g.score}</b></li>`;
  }).join('')}</ol><p class="wait">${S.state && S.state.round >= S.state.rounds ? 'Final results are next.' : 'Next round starts soon.'}</p>`;
}
function hideScores() { const el = $('#scores'); if (el) el.hidden = true; }

// ---------- final ----------
const ordinal = (n) => `${n}${['th', 'st', 'nd', 'rd'][n % 100 > 10 && n % 100 < 14 ? 0 : Math.min(n % 10, 4) % 4]}`;
function showFinal() {
  const f = S.state.final; if (!f || !$('#overlay')) return;
  closeOverlay(); hideScores();
  S.overlay = 'final';
  const sides = sideMap();
  const who = (id) => sides.get(id) || (() => { const p = S.state.players.find((x) => x.id === id); return p ? { name: p.name, color: p.color, avatar: p.avatar } : { name: '—', color: '#888' }; })();
  const face = (w) => { const p = w.avatar ? w : S.state.players.find((x) => x.id === w.id); return p?.avatar ? avatarSVG(p.avatar, w.color) : `<span class="team-dot" style="background:${w.color}"></span>`; };
  const top = f.ranking.filter((r) => r.rank === 1).map((r) => who(r.side));
  const mine = f.ranking.find((r) => r.side === S.you?.side);
  const myAwards = f.awards.filter((a) => a.id === S.me.id || a.id === S.you?.side);
  const o = $('#overlay'); o.hidden = false; o.className = 'overlay finalview';
  o.innerHTML = `<main class="final">
    <section class="champ"><p class="eyebrow">Master of the GRID</p><div class="champ-faces">${top.map((w) => `<div style="--c:${w.color}">${face(w)}<h1>${esc(w.name)}</h1></div>`).join('')}</div>
      <p class="you-line">${mine ? `You finished ${ordinal(mine.rank)} with ${mine.score} points and ${mine.zones} ${mine.zones === 1 ? 'zone' : 'zones'}.` : ''}${myAwards.length ? ` You won ${myAwards.map((a) => a.title).join(' and ')}.` : ''}</p></section>
    <section class="awards"><h2>Awards</h2><div class="award-grid">${f.awards.filter((a) => a.title !== 'Master of the GRID').map((a) => { const w = who(a.id); return `<div class="award" style="--c:${w.color}">${face(w)}<div><b>${esc(a.title)}</b><span>${esc(w.name)}</span><small>${esc(a.desc)}</small></div></div>`; }).join('')}</div></section>
    <section class="standings"><h2>Final standings</h2><ol class="${f.ranking.length <= 6 ? 'few' : ''}">${f.ranking.map((r) => { const w = who(r.side); return `<li class="${r.side === S.you?.side ? 'me' : ''}" style="--c:${w.color}"><i>${r.rank}</i><span>${esc(w.name)}</span><small>${r.zones} ${r.zones === 1 ? 'zone' : 'zones'}</small><b>${r.score}</b></li>`; }).join('')}</ol></section></main>`;
  play('final');
}

// ---------- small things ----------
function toast(msg) {
  const el = $('#toast'); if (!el) return;
  el.textContent = msg; el.hidden = false;
  clearTimeout(S.toastT); S.toastT = setTimeout(() => { el.hidden = true; }, 3200);
}
function openSettings() {
  const p = sound.prefs;
  modal.hidden = false;
  modal.innerHTML = `<div class="sheet" role="dialog" aria-label="Settings"><h2>Settings</h2>
    <label class="row"><span>Sound</span><button class="toggle ${p.on ? 'on' : ''}" data-act="set" data-k="on" aria-pressed="${p.on}">${p.on ? 'On' : 'Off'}</button></label>
    <label class="row"><span>Volume</span><input type="range" min="0" max="1" step="0.1" value="${p.vol}" id="vol" aria-label="Volume"></label>
    <label class="row"><span>Background music</span><button class="toggle ${p.music ? 'on' : ''}" data-act="set" data-k="music" aria-pressed="${p.music}">${p.music ? 'On' : 'Off'}</button></label>
    <label class="row"><span>Animations and effects</span><button class="toggle ${S.prefs.motion ? 'on' : ''}" data-act="set" data-k="motion" aria-pressed="${S.prefs.motion}">${S.prefs.motion ? 'On' : 'Off'}</button></label>
    <label class="row"><span>Joystick</span><button class="toggle ${S.prefs.joystick ? 'on' : ''}" data-act="set" data-k="joystick" aria-pressed="${S.prefs.joystick}">${S.prefs.joystick ? 'On' : 'Off'}</button></label>
    <p class="fine">With the joystick off, tap a place on the street or use the map to walk there.</p>
    <div class="sheet-foot">${S.joined ? '<button data-act="leave-game">Leave game</button>' : ''}<button class="primary" data-act="close">Done</button></div></div>`;
}
function closeModal() { modal.hidden = true; modal.innerHTML = ''; }
function openCalc() {
  const q = S.you?.q; if (q) net.send({ t: 'support', qid: q.id, kind: 'calc' });
  S.calc = { cur: '0', prev: null, op: null, fresh: true };
  modal.hidden = false;
  modal.innerHTML = `<div class="sheet calc" role="dialog" aria-label="Calculator"><output id="cout">0</output><div class="keys">${['7', '8', '9', '÷', '4', '5', '6', '×', '1', '2', '3', '−', '0', '.', '=', '+'].map((k) => `<button data-act="key" data-k="${k}" class="${/[0-9.]/.test(k) ? '' : 'op'}">${k}</button>`).join('')}</div>
    <div class="sheet-foot"><button data-act="key" data-k="C">Clear</button><button class="primary" data-act="close">Close</button></div></div>`;
}
function calcKey(k) {
  const c = S.calc;
  const run = () => { const a = parseFloat(c.prev), b = parseFloat(c.cur); const r = c.op === '+' ? a + b : c.op === '−' ? a - b : c.op === '×' ? a * b : b === 0 ? NaN : a / b; return Number.isFinite(r) ? String(Math.round(r * 100) / 100) : 'Error'; };
  if (k === 'C') Object.assign(c, { cur: '0', prev: null, op: null, fresh: true });
  else if (/[0-9.]/.test(k)) { if (c.fresh || c.cur === 'Error') { c.cur = k === '.' ? '0.' : k; c.fresh = false; } else if (!(k === '.' && c.cur.includes('.')) && c.cur.length < 10) c.cur = c.cur === '0' && k !== '.' ? k : c.cur + k; }
  else if (k === '=') { if (c.op && c.prev !== null) { c.cur = run(); c.prev = null; c.op = null; c.fresh = true; } }
  else { if (c.op && c.prev !== null && !c.fresh) c.cur = run(); c.prev = c.cur; c.op = k; c.fresh = true; }
  $('#cout').textContent = c.cur;
}

// ---------- joining ----------
async function checkCode() {
  S.err = '';
  try {
    const r = await fetch(`/api/room/${S.code}`);
    if (!r.ok) { S.err = 'No game with that code. Check the board and try again.'; S.code = ''; play('retry'); return update(); }
    S.room = await r.json(); go('name');
  } catch { S.err = 'Cannot reach the game. Check the Wi-Fi.'; S.code = ''; update(); }
}
function join() {
  if (S.pending) return;
  S.pending = true; S.err = ''; net.wanted = true;
  save('ovr_avatar', S.avatar);
  primeSpeech();
  if (!net.send({ t: 'join', code: S.code, name: S.name, rosterId: S.rosterId, avatar: S.avatar })) { S.pending = false; S.err = 'Cannot reach the game. Check the Wi-Fi.'; net.connect(true); }
  update();
  setTimeout(() => { if (S.pending) { S.pending = false; if (S.screen === 'avatar') update(); } }, 4000);
}

// ---------- taps ----------
const ACTS = {
  digit: (b) => { if (S.code.length < 4) { S.code += b.dataset.d; S.err = ''; play('tap'); update(); if (S.code.length === 4) checkCode(); } },
  back: () => { S.code = S.code.slice(0, -1); update(); },
  restart: () => { S.code = ''; S.room = null; S.err = ''; go('join'); },
  pick: (b) => { const r = S.room.roster.find((x) => x.id === b.dataset.id); S.rosterId = r.id; S.name = r.name; if (r.avatar) S.avatar = r.avatar; S.err = ''; go('avatar'); },
  toName: () => { S.rosterId = null; S.name = ''; go('name'); },
  preset: (b) => { S.avatar = { ...PRESETS[b.dataset.i] }; play('tap'); update(); },
  cycle: (b) => { const k = b.dataset.k; S.avatar = { ...S.avatar, [k]: (S.avatar[k] + Number(b.dataset.d) + COUNTS[k]) % COUNTS[k] }; play('tap'); update(); },
  enter: () => { if (!S.joined) return join(); S.editing = false; save('ovr_avatar', S.avatar); net.send({ t: 'avatar', avatar: S.avatar }); go('world'); },
  relook: () => { S.editing = true; S.name = S.me.name; S.avatar = me()?.avatar || S.avatar; go('avatar'); },
  use: (b) => { if (S.you?.term) return; net.send({ t: 'use', term: Number(b.dataset.term) }); play('tap'); },
  leave: () => { net.send({ t: 'leave' }); closeOverlay(); toast('Your mission will be waiting at the next terminal.'); },
  nearest: () => { const t = nearestTerminal(); if (!t) return toast('No terminals left this round.'); gotoTerm(t.id); },
  map: () => openMap(),
  goto: (b) => gotoNode(Number(b.dataset.node)),
  'close-overlay': () => closeOverlay(),
  zoom: (b) => { if (!view) return; view.userZoom = Math.max(0.6, Math.min(1.6, view.userZoom * (b.dataset.d === '1' ? 1.2 : 1 / 1.2))); S.prefs.zoom = view.userZoom; save('ovr_prefs', S.prefs); },
  say: () => sayQuestion(true),
  hint: () => { const q = S.you?.q; if (q) net.send({ t: 'hint', qid: q.id }); },
  calc: openCalc,
  key: (b) => calcKey(b.dataset.k),
  answer: (b) => { const q = S.you?.q; if (!q || S.busy || b.disabled || S.state?.paused) return; S.lastTap = b.dataset.c; play('tap'); net.send({ t: 'answer', qid: q.id, choice: b.dataset.c }); },
  act: (b) => {
    if (b.getAttribute('aria-disabled') === 'true') {
      const m = b.dataset.type, left = S.you.charge - planCost(S.you.plan), used = S.you.plan.some((a) => a.type === m);
      toast(m === 'override' ? 'You have used your override.' : used ? `One ${m} each round.` : `${m === 'power' ? 'Power needs 1 charge' : `That needs ${COST[m]} charge`}. You have ${left} left.`);
      play('retry'); return;
    }
    net.send({ t: 'act', type: b.dataset.type, hex: Number(b.dataset.hex) });
    play(b.dataset.type === 'override' ? 'charge' : 'select');
    if (view) view.burst(Number(b.dataset.hex), '#FFFFFF');
  },
  unact: (b) => { net.send({ t: 'unact', i: Number(b.dataset.i) }); play('tap'); },
  undo: () => { if (S.you.plan.length) net.send({ t: 'unact', i: S.you.plan.length - 1 }); play('tap'); },
  lock: () => { net.send({ t: 'lock', locked: true }); play('lock'); },
  unlock: () => net.send({ t: 'lock', locked: false }),
  settings: openSettings,
  close: closeModal,
  set: (b) => {
    const k = b.dataset.k;
    if (k === 'motion' || k === 'joystick') { S.prefs[k] = !S.prefs[k]; save('ovr_prefs', S.prefs); applyUi(); update(); }
    else sound.set({ [k]: !sound.prefs[k] });
    openSettings();
  },
  'leave-game': () => { if (window.confirm('Leave this game?')) { closeModal(); net.wanted = false; net.ws?.close(); net.wanted = true; leave(); net.connect(true); } },
};

document.addEventListener('click', (e) => {
  unlock();
  if (e.target === modal) return closeModal();
  const b = e.target.closest('[data-act]');
  if (b && ACTS[b.dataset.act]) ACTS[b.dataset.act](b);
});
document.addEventListener('submit', (e) => {
  e.preventDefault();
  const v = $('#nick').value.replace(/\s+/g, ' ').trim();
  if (!v) { S.err = 'Type a nickname first.'; return update(); }
  S.name = v.slice(0, 14); S.rosterId = null; S.err = ''; go('avatar');
});
document.addEventListener('input', (e) => { if (e.target.id === 'vol') sound.set({ vol: Number(e.target.value) }); });
const KEYMAP = { ArrowUp: 'up', KeyW: 'up', ArrowDown: 'down', KeyS: 'down', ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right' };
document.addEventListener('keydown', (e) => {
  if (S.screen === 'join' && /^[0-9]$/.test(e.key)) ACTS.digit({ dataset: { d: e.key } });
  if (S.screen === 'join' && e.key === 'Backspace') ACTS.back();
  if (e.key === 'Escape') { if (!modal.hidden) closeModal(); else if (S.overlay === 'map') closeOverlay(); }
  if (S.screen === 'world' && KEYMAP[e.code] && e.target.tagName !== 'INPUT') { S.keys.add(KEYMAP[e.code]); e.preventDefault(); }
  if (S.screen === 'world' && (e.key === 'e' || e.key === 'Enter') && !S.overlay) $('#ctx .interact')?.click();
});
document.addEventListener('keyup', (e) => { if (KEYMAP[e.code]) S.keys.delete(KEYMAP[e.code]); });
window.addEventListener('blur', () => { S.keys.clear(); S.input = { x: 0, y: 0 }; });

// ---------- start ----------
applyUi();
const urlCode = new URLSearchParams(location.search).get('code');
if (S.me) { app.className = 'screen-join'; app.innerHTML = `<main class="join"><section class="hero"><h1 class="logo" data-text="OVERRIDE">OVERRIDE</h1><p class="tag">Control the grid.</p><p class="lede">Returning to game ${esc(S.me.code)}…</p><button class="link" id="fresh">Join a different game</button></section></main>`; $('#fresh').addEventListener('click', () => leave()); }
else { go('join'); if (urlCode && /^\d{4}$/.test(urlCode)) { S.code = urlCode; update(); checkCode(); } }
