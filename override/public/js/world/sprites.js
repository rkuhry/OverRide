// Full-body walking avatars, drawn in code from the same four choices as the
// portrait avatars (skin, hair, hair/fabric colour, gear). Frames are cached.
const SKIN = ['#F6D7C3', '#EEBF9F', '#D9A076', '#B97A50', '#8A5A3A', '#5C3A26'];
const TONE = ['#16131C', '#3A2A22', '#6E4A2E', '#D6B06A', '#A8452C', null];
const FABRIC = ['#1C2440', '#5A2A52', '#0F4A4A', '#D8D2C4', '#7A2330', null];
const PANTS = '#1A2036', SHOE = '#E9EEF9', DARK = '#202B52';
export const SPR_W = 64, SPR_H = 120, SPR_SCALE = 1.5; // logical size; feet at (32, 114)

const shade = (hex, f) => {
  const n = parseInt(hex.slice(1), 16);
  const c = (v) => Math.max(0, Math.min(255, Math.round(v * f)));
  return `rgb(${c(n >> 16)},${c((n >> 8) & 255)},${c(n & 255)})`;
};
function rr(g, x, y, w, h, r) { g.beginPath(); g.roundRect ? g.roundRect(x, y, w, h, r) : g.rect(x, y, w, h); g.fill(); }
const circle = (g, x, y, r) => { g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill(); };

// frame: -1 idle, 0..3 walk cycle. back: seen from behind.
function draw(g, a, color, back, frame) {
  const skin = SKIN[a.skin % 6] || SKIN[2];
  const cloth = a.hair === 8 || a.hair === 9;
  const hairC = (cloth ? FABRIC : TONE)[a.tone % 6] || color;
  const gear = a.gear ?? 0;
  const swing = frame < 0 ? 0 : [1, 0, -1, 0][frame];
  const bob = frame < 0 ? 0 : [0, -1.5, 0, -1.5][frame];
  const body = gear === 1 || gear === 2 ? DARK : color;
  const sleeve = gear === 3 ? skin : body;
  g.save();
  g.translate(0, bob);
  // backpack (seen from behind) and long hair sit behind the body
  if (back) { g.fillStyle = '#141B33'; rr(g, 20, 50, 24, 28, 6); g.fillStyle = color; rr(g, 28, 58, 8, 10, 3); }
  if (!back && (a.hair === 5 || a.hair === 6)) { g.fillStyle = hairC; rr(g, 17, 26, 30, a.hair === 5 ? 36 : 40, 10); }
  if (!back && a.hair === 4) { g.fillStyle = hairC; circle(g, 32, 31, 18); }
  // legs and shoes
  g.fillStyle = PANTS;
  rr(g, 24, 78 + swing * 2, 7.5, 32 - swing * 2, 3.5);
  rr(g, 32.5, 78 - swing * 2, 7.5, 32 + swing * 2, 3.5);
  g.fillStyle = SHOE;
  rr(g, 22.5, 107 + Math.max(0, -swing) * -2, 10, 6, 3);
  rr(g, 31.5, 107 + Math.max(0, swing) * -2, 10, 6, 3);
  // arms (behind the torso edge)
  g.fillStyle = sleeve === skin ? body : sleeve;
  rr(g, 12, 50 - swing * 2, 7, gear === 3 ? 10 : 26, 3.5);
  rr(g, 45, 50 + swing * 2, 7, gear === 3 ? 10 : 26, 3.5);
  g.fillStyle = skin;
  if (gear === 3) { rr(g, 12.5, 59 - swing * 2, 6, 18, 3); rr(g, 45.5, 59 + swing * 2, 6, 18, 3); }
  circle(g, 15.5, 77 - swing * 2, 3.6); circle(g, 48.5, 77 + swing * 2, 3.6);
  // torso
  g.fillStyle = body; rr(g, 17, 46, 30, 36, 9);
  if (!back) {
    if (gear === 0 || gear === 4 || gear === 5) { g.fillStyle = shade(color, 0.72); rr(g, 23, 66, 18, 9, 3); }
    if (gear === 1) { g.fillStyle = color; rr(g, 29, 48, 6, 33, 2); g.fillStyle = shade(DARK, 1.5); rr(g, 22, 46, 6, 10, 2); rr(g, 36, 46, 6, 10, 2); }
    if (gear === 2) { g.strokeStyle = color; g.lineWidth = 3.5; g.beginPath(); g.moveTo(21, 48); g.lineTo(27, 80); g.moveTo(43, 48); g.lineTo(37, 80); g.stroke(); g.fillStyle = color; rr(g, 26, 60, 12, 6, 2); }
  } else if (gear === 0) { g.fillStyle = shade(color, 0.75); rr(g, 22, 44, 20, 12, 6); }
  // neck and head
  g.fillStyle = skin; rr(g, 28, 40, 8, 9, 3);
  if (a.hair === 8) { g.fillStyle = hairC; rr(g, 16, 16, 32, 38, 15); }
  g.fillStyle = skin; circle(g, 32, 31, a.hair === 8 ? 10.5 : 13);
  // hair
  g.fillStyle = hairC;
  if (back && a.hair !== 8 && a.hair !== 0) { circle(g, 32, 30, 13.6); if (a.hair === 5) rr(g, 18, 28, 28, 26, 9); if (a.hair === 6) rr(g, 18, 28, 28, 30, 8); }
  switch (a.hair) {
    case 0: g.globalAlpha = 0.55; g.beginPath(); g.arc(32, 31, 13.3, Math.PI * 1.05, Math.PI * 1.95); g.fill(); g.globalAlpha = 1; break;
    case 1: g.beginPath(); g.arc(32, 30, 13.8, Math.PI, 0); g.fill(); break;
    case 2: g.beginPath(); g.arc(32, 30, 13.8, Math.PI, 0); g.fill(); g.beginPath(); g.ellipse(36, 19, 12, 6, -0.3, 0, Math.PI * 2); g.fill(); break;
    case 3: for (const [x, y, r] of [[22, 25, 6], [28, 19, 6.5], [36, 19, 6.5], [42, 25, 6], [32, 17, 6]]) circle(g, x, y, r); break;
    case 4: circle(g, 32, 24, 14); break;
    case 5: case 6: g.beginPath(); g.arc(32, 30, 14, Math.PI, 0); g.fill(); break;
    case 7: g.beginPath(); g.arc(32, 30, 13.8, Math.PI, 0); g.fill(); circle(g, 32, 13, 7); break;
    case 8: break;
    default: g.beginPath(); g.arc(32, 29, 14.5, Math.PI, 0); g.fill(); g.fillStyle = color; rr(g, 17, 24, 30, 6, 2); circle(g, 32, 13, 4); break;
  }
  if (!back) {
    if (gear === 4) { g.fillStyle = color; rr(g, 20, 29, 24, 7, 3.5); g.fillStyle = 'rgba(255,255,255,.6)'; rr(g, 23, 30.5, 9, 2, 1); }
    else { g.fillStyle = '#16121E'; rr(g, 26.5, 31, 3.2, 4.6, 1.6); rr(g, 34.3, 31, 3.2, 4.6, 1.6); }
  }
  if (gear === 5) {
    g.strokeStyle = '#0B1228'; g.lineWidth = 3; g.beginPath(); g.arc(32, 31, 15, Math.PI * 1.05, Math.PI * 1.95); g.stroke();
    g.fillStyle = color; rr(g, 15, 27, 6, 11, 3); rr(g, 43, 27, 6, 11, 3);
  }
  g.restore();
}

const cache = new Map();
export function avatarFrame(a, color, back, frame) {
  const key = `${a.skin}${a.hair}${a.tone}${a.gear}${color}${back ? 1 : 0}${frame}`;
  let c = cache.get(key);
  if (!c) {
    if (cache.size > 600) cache.clear();
    c = document.createElement('canvas');
    c.width = SPR_W * SPR_SCALE; c.height = SPR_H * SPR_SCALE;
    const g = c.getContext('2d');
    g.scale(SPR_SCALE, SPR_SCALE);
    draw(g, a, color, back, frame);
    cache.set(key, c);
  }
  return c;
}
