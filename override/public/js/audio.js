// All sound is synthesised in the browser: no audio files, nothing to license.
// Sound is never required to understand the game.
import { load, save } from './util.js';

const prefs = load('ovr_sound', { on: true, music: false, vol: 0.6 });
let ctx = null, master = null, musicNodes = null;

function ensure() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = prefs.on ? prefs.vol : 0;
    master.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}
// Browsers only allow audio after a touch. Call this from any tap.
export function unlock() { ensure(); if (prefs.music && !musicNodes) startMusic(); }

function tone(freq, t0, dur, { type = 'sine', vol = 0.2, to = null, attack = 0.008 } = {}) {
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type; o.frequency.setValueAtTime(freq, t0);
  if (to) o.frequency.exponentialRampToValueAtTime(to, t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(vol, t0 + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g); g.connect(master);
  o.start(t0); o.stop(t0 + dur + 0.05);
}
function noise(t0, dur, vol = 0.08, freq = 1800) {
  const len = Math.floor(ctx.sampleRate * dur), buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
  src.buffer = buf; f.type = 'bandpass'; f.frequency.value = freq; g.gain.value = vol;
  src.connect(f); f.connect(g); g.connect(master); src.start(t0);
}

const SOUNDS = {
  tap: (t) => tone(660, t, 0.06, { type: 'triangle', vol: 0.08 }),
  select: (t) => { tone(520, t, 0.07, { type: 'triangle', vol: 0.1 }); tone(780, t + 0.05, 0.08, { type: 'triangle', vol: 0.1 }); },
  correct: (t) => { tone(523, t, 0.12, { vol: 0.16 }); tone(784, t + 0.09, 0.14, { vol: 0.16 }); tone(1047, t + 0.18, 0.22, { vol: 0.14 }); },
  retry: (t) => tone(330, t, 0.16, { type: 'sine', vol: 0.09, to: 300 }), // soft and neutral, never a buzzer
  charge: (t) => tone(300, t, 0.25, { type: 'sawtooth', vol: 0.06, to: 1200 }),
  lock: (t) => { tone(220, t, 0.09, { type: 'square', vol: 0.07 }); tone(440, t + 0.08, 0.14, { type: 'square', vol: 0.07 }); },
  capture: (t) => { noise(t, 0.12, 0.06, 2400); tone(392, t, 0.1, { type: 'triangle', vol: 0.14 }); tone(587, t + 0.07, 0.16, { type: 'triangle', vol: 0.14 }); },
  hold: (t) => { tone(196, t, 0.16, { type: 'square', vol: 0.06 }); noise(t, 0.08, 0.05, 900); },
  jam: (t) => { noise(t, 0.3, 0.07, 500); tone(160, t, 0.3, { type: 'sawtooth', vol: 0.05, to: 90 }); },
  surge: (t) => tone(440, t, 0.3, { type: 'sawtooth', vol: 0.06, to: 1760 }),
  override: (t) => {
    tone(110, t, 0.7, { type: 'sawtooth', vol: 0.1, to: 880 }); noise(t + 0.65, 0.5, 0.12, 700);
    tone(55, t + 0.68, 0.9, { type: 'sine', vol: 0.3, to: 35 });
    [523, 659, 784, 1047].forEach((f, i) => tone(f, t + 0.7 + i * 0.07, 0.5, { type: 'triangle', vol: 0.1 }));
  },
  round: (t) => [392, 523, 659, 784].forEach((f, i) => tone(f, t + i * 0.11, 0.3, { type: 'triangle', vol: 0.12 })),
  final: (t) => [392, 523, 659, 784, 1047, 1319].forEach((f, i) => tone(f, t + i * 0.13, i === 5 ? 1.2 : 0.35, { type: 'triangle', vol: 0.13 })),
};
export function play(name) {
  if (!prefs.on || !ensure() || !SOUNDS[name]) return;
  try { SOUNDS[name](ctx.currentTime + 0.01); } catch {}
}

function startMusic() {
  if (!ensure() || musicNodes) return;
  const g = ctx.createGain(); g.gain.value = 0.035; g.connect(master);
  const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 500; f.connect(g);
  const lfo = ctx.createOscillator(), lg = ctx.createGain(); lfo.frequency.value = 0.07; lg.gain.value = 260; lfo.connect(lg); lg.connect(f.frequency); lfo.start();
  const oscs = [55, 82.4, 110.3, 164.8].map((hz, i) => { const o = ctx.createOscillator(); o.type = i % 2 ? 'sawtooth' : 'triangle'; o.frequency.value = hz; o.detune.value = i * 4; o.connect(f); o.start(); return o; });
  musicNodes = { g, oscs: [...oscs, lfo] };
}
function stopMusic() { if (!musicNodes) return; musicNodes.oscs.forEach((o) => { try { o.stop(); } catch {} }); musicNodes.g.disconnect(); musicNodes = null; }

export const sound = {
  get prefs() { return prefs; },
  set(patch) {
    Object.assign(prefs, patch); save('ovr_sound', prefs);
    if (master) master.gain.value = prefs.on ? prefs.vol : 0;
    if (prefs.music && prefs.on) startMusic(); else stopMusic();
  },
  quietMusic(q) { if (q) stopMusic(); else if (prefs.music && prefs.on && ctx) startMusic(); },
};

// Read-aloud uses the device's built-in voice.
export function speak(text) {
  if (!('speechSynthesis' in window) || !text) return;
  try {
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text.replace(/\$(\d+)\.(\d\d)/g, '$1 dollars and $2 cents').replace(/¢/g, ' cents'));
    u.rate = 0.9; u.lang = 'en-US';
    speechSynthesis.speak(u);
  } catch {}
}
export function primeSpeech() { try { if ('speechSynthesis' in window) speechSynthesis.speak(new SpeechSynthesisUtterance('')); } catch {} }
