// Reusable visual templates for math activities: money, prices, clocks,
// schedules, containers, rulers and counts. Each takes a small data spec from
// the question engine and returns markup. Question data never contains markup.
import { esc, fmtMoney } from './util.js';

const COIN = { 1: { d: 44, c: '#C77B4A', e: '#8E4F2A', n: 'penny' }, 5: { d: 50, c: '#CBD3E3', e: '#8791AB', n: 'nickel' }, 10: { d: 40, c: '#D5DCEA', e: '#8791AB', n: 'dime' }, 25: { d: 58, c: '#CBD3E3', e: '#8791AB', n: 'quarter' } };

function bill(c, cls = '') {
  const n = c / 100;
  return `<svg class="bill ${cls}" viewBox="0 0 132 60" role="img" aria-label="${n} dollar bill">
    <rect x="1.5" y="1.5" width="129" height="57" rx="6" fill="#CFE8D4" stroke="#2E6B48" stroke-width="3"/>
    <rect x="8" y="8" width="116" height="44" rx="3" fill="none" stroke="#2E6B48" stroke-width="1" opacity=".6"/>
    <ellipse cx="66" cy="30" rx="26" ry="18" fill="#9CC9A8"/>
    <text x="66" y="39" text-anchor="middle" font-size="25" font-weight="800" fill="#14432A">$${n}</text>
    ${[[18, 23], [114, 23], [18, 49], [114, 49]].map(([x, y]) => `<text x="${x}" y="${y}" text-anchor="middle" font-size="13" font-weight="800" fill="#14432A">${n}</text>`).join('')}</svg>`;
}
function coin(c, cls = '') {
  const k = COIN[c];
  return `<svg class="coin ${cls}" style="--d:${k.d}px" viewBox="0 0 60 60" role="img" aria-label="${k.n}">
    <circle cx="30" cy="30" r="28" fill="${k.c}" stroke="${k.e}" stroke-width="3"/><circle cx="30" cy="30" r="22" fill="none" stroke="${k.e}" stroke-width="1" opacity=".6"/>
    <text x="30" y="37" text-anchor="middle" font-size="${c === 10 ? 21 : 19}" font-weight="800" fill="#1C2233">${c}¢</text></svg>`;
}
const piece = (c, cls) => (c >= 100 ? bill(c, cls) : coin(c, cls));
function money(v) {
  const many = v.items.length > 5 ? ' many' : '';
  return `<div class="v-money${many}">${v.label ? `<small>${esc(v.label)}</small>` : ''}<div class="v-pieces">${v.items.map((c) => piece(c)).join('')}</div></div>`;
}

function clockFace(h, m) {
  const ha = ((h % 12) + m / 60) * 30, ma = m * 6;
  const nums = Array.from({ length: 12 }, (_, i) => { const a = ((i + 1) * 30 - 90) * Math.PI / 180; return `<text x="${60 + 42 * Math.cos(a)}" y="${60 + 42 * Math.sin(a) + 5}" text-anchor="middle" font-size="14" font-weight="800" fill="#101835">${i + 1}</text>`; }).join('');
  const ticks = Array.from({ length: 60 }, (_, i) => (i % 5 ? `<line x1="60" y1="5" x2="60" y2="8" stroke="#8791AB" stroke-width="1" transform="rotate(${i * 6} 60 60)"/>` : '')).join('');
  return `<svg class="v-clock" viewBox="0 0 120 120" role="img" aria-label="clock">
    <circle cx="60" cy="60" r="57" fill="#F4F7FF" stroke="#2EE6F5" stroke-width="3.5"/>${ticks}${nums}
    <line x1="60" y1="60" x2="60" y2="33" stroke="#101835" stroke-width="5.5" stroke-linecap="round" transform="rotate(${ha} 60 60)"/>
    <line x1="60" y1="60" x2="60" y2="17" stroke="#E0218A" stroke-width="3.5" stroke-linecap="round" transform="rotate(${ma} 60 60)"/>
    <circle cx="60" cy="60" r="4.5" fill="#101835"/></svg>`;
}
const digital = (h, m) => `<span class="v-digital">${h}:${String(m).padStart(2, '0')}</span>`;
const clock = (v) => (v.mode === 'digital' ? digital(v.h, v.m) : clockFace(v.h, v.m));

const product = (v) => `<div class="v-product">${v.tag ? `<span class="v-tag">${esc(v.tag)}</span>` : ''}<span class="v-emoji">${v.e}</span><span class="v-name">${esc(v.n)}</span><span class="v-price">${fmtMoney(v.p)}</span></div>`;
const products = (v) => `<div class="v-row">${v.items.map(product).join('')}</div>`;
const pair = (v) => `<div class="v-pair">${v.items.map((i) => `<span class="v-mini"><span class="v-emoji">${i.e}</span><b>${fmtMoney(i.p)}</b></span>`).join('<i>+</i>')}</div>`;

function buy(v) {
  const total = v.have.reduce((a, b) => a + b, 0);
  return `<div class="v-buy">
    <div class="v-wallet"><small>${esc(v.haveLabel || (v.back !== undefined ? 'You pay' : 'You have'))}</small>${money({ items: v.have })}<b>${fmtMoney(total)}</b></div>
    <div class="v-row">${v.items.map(product).join('')}</div>
    ${v.back !== undefined ? `<div class="v-wallet"><small>Cashier gives you</small><b>${fmtMoney(v.back)}</b></div>` : ''}</div>`;
}

const table = (v) => `<table class="v-table"><caption>${esc(v.title)}</caption>${v.head.some(Boolean) ? `<thead><tr>${v.head.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead>` : ''}
  <tbody>${v.rows.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;

const span = (v) => `<div class="v-span">${v.title ? `<small class="v-span-title">${esc(v.title)}</small>` : ''}
  <div><small>${esc(v.labels[0])}</small>${digital(...v.from)}</div>
  <div class="v-arrow">${v.mid ? `<b>${esc(v.mid)}</b>` : ''}<svg viewBox="0 0 80 16"><path d="M2 8h70M64 2l8 6-8 6" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg></div>
  <div><small>${esc(v.labels[1])}</small>${v.to ? digital(...v.to) : '<span class="v-digital q">?</span>'}</div></div>`;

function container(v) {
  const f = Math.max(0, Math.min(1, v.fill ?? 0.8));
  let shape, liquid;
  if (v.kind === 'jug') {
    const y = 112 - f * 88;
    shape = '<path d="M25 20h62v92H25z M87 40c18 0 18 36 0 36" fill="none"/>'; liquid = `<rect x="27" y="${y}" width="58" height="${112 - y - 2}"/>`;
  } else if (v.kind === 'bottle') {
    const y = 112 - f * 64;
    shape = '<path d="M50 8h20v30c8 4 14 10 14 20v54H36V58c0-10 6-16 14-20z" fill="none"/>'; liquid = `<rect x="38" y="${y}" width="44" height="${112 - y - 2}"/>`;
  } else {
    const y = 110 - f * 96, dx = ((110 - y) / 100) * 10;
    shape = '<path d="M20 10h80l-10 100H30z" fill="none"/>'; liquid = `<path d="M${30 - dx + 2} ${y}h${60 + 2 * dx - 4}L88 108H32z"/>`;
  }
  return `<div class="v-container"><svg viewBox="0 0 120 120" style="--sc:${v.scale ?? 1}" role="img" aria-label="container"><g fill="#2EE6F5" opacity=".75">${liquid}</g><g stroke="#EEF3FF" stroke-width="4" stroke-linejoin="round">${shape}</g></svg>${v.label ? `<b>${esc(v.label)}</b>` : ''}</div>`;
}

const bar = (v) => `<div class="v-bar"><i style="width:${v.len}%"></i></div>`;
const count = (v) => `<div class="v-count">${v.label ? `<small>${esc(v.label)}</small>` : ''}<div>${Array.from({ length: v.n }, () => `<span class="v-emoji">${v.e}</span>`).join('')}</div></div>`;
const big = (v) => `<div class="v-big">${v.e ? `<span class="v-emoji">${esc(v.e)}</span>` : ''}${v.text ? `<b>${esc(v.text)}</b>` : ''}${v.sub ? `<small>${esc(v.sub)}</small>` : ''}</div>`;

function ruler(v) {
  const u = 38, x0 = 22;
  const ticks = Array.from({ length: v.max + 1 }, (_, i) => `<line x1="${x0 + i * u}" y1="58" x2="${x0 + i * u}" y2="76" stroke="#101835" stroke-width="2.5"/><text x="${x0 + i * u}" y="94" text-anchor="middle" font-size="15" font-weight="800" fill="#101835">${i}</text>${i < v.max ? `<line x1="${x0 + i * u + u / 2}" y1="58" x2="${x0 + i * u + u / 2}" y2="68" stroke="#101835" stroke-width="1.5"/>` : ''}`).join('');
  return `<svg class="v-ruler" viewBox="0 0 ${x0 * 2 + v.max * u} 104" role="img" aria-label="ruler">
    <rect x="${x0}" y="16" width="${v.len * u}" height="18" rx="9" fill="#FF4FD8"/><rect x="${x0 + v.len * u - 10}" y="12" width="10" height="26" rx="3" fill="#EEF3FF"/><rect x="${x0}" y="12" width="10" height="26" rx="3" fill="#EEF3FF"/>
    <line x1="${x0 + v.len * u}" y1="40" x2="${x0 + v.len * u}" y2="56" stroke="#FF4FD8" stroke-width="2" stroke-dasharray="3 3"/>
    <rect x="6" y="56" width="${x0 * 2 + v.max * u - 12}" height="44" rx="5" fill="#FFE14A"/>${ticks}</svg>`;
}

const takeaway = (v) => `<div class="v-money"><div class="v-pieces">${Array.from({ length: v.total }, (_, i) => bill(100, i < v.take ? 'gone' : '')).join('')}</div></div>`;
function numline(v) {
  const n = v.to - v.from, u = Math.min(56, 440 / Math.max(1, n)), x0 = 24;
  const pts = Array.from({ length: n + 1 }, (_, i) => `<line x1="${x0 + i * u}" y1="40" x2="${x0 + i * u}" y2="52" stroke="#EEF3FF" stroke-width="2.5"/><text x="${x0 + i * u}" y="72" text-anchor="middle" font-size="${n > 10 ? 12 : 16}" font-weight="800" fill="${i === 0 || i === n ? '#FFE14A' : '#EEF3FF'}">${v.from + i}</text>`).join('');
  const hops = Array.from({ length: n }, (_, i) => `<path d="M${x0 + i * u} 38Q${x0 + i * u + u / 2} ${38 - Math.min(26, u * 0.6)} ${x0 + (i + 1) * u} 38" fill="none" stroke="#2EE6F5" stroke-width="2.5"/>`).join('');
  return `<svg class="v-numline" viewBox="0 0 ${x0 * 2 + n * u} 80" role="img" aria-label="number line">${hops}<line x1="${x0}" y1="46" x2="${x0 + n * u}" y2="46" stroke="#EEF3FF" stroke-width="2.5"/>${pts}</svg>`;
}

const R = { money, clock, product, products, pair, buy, table, span, container, bar, count, big, ruler, takeaway, numline };
export const renderVisual = (v) => (v && R[v.t] ? R[v.t](v) : '');

const ICONS = {
  yes: '<svg class="c-icon" viewBox="0 0 32 32"><circle cx="16" cy="16" r="13" fill="none" stroke="currentColor" stroke-width="3"/><path d="M10 16.5l4.5 4.5L23 12" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  no: '<svg class="c-icon" viewBox="0 0 32 32"><circle cx="16" cy="16" r="13" fill="none" stroke="currentColor" stroke-width="3"/><path d="M8 24L24 8" stroke="currentColor" stroke-width="3.5" stroke-linecap="round"/></svg>',
};
export function renderChoice(c) {
  if (c.vis) return renderVisual(c.vis);
  return `${c.icon ? ICONS[c.icon] : ''}<span class="c-label">${esc(c.label)}</span>`;
}
// Plain-language reading of a choice for read-aloud. Never reveals more than the label shows.
export const choiceSpeech = (c) => (c.label ? c.label : c.vis?.t === 'product' ? `${c.vis.n}, ${fmtMoney(c.vis.p)}` : '');
