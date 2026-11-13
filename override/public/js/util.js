// Small shared helpers for both the student game and the teacher command center.
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const load = (k, d) => { try { const v = JSON.parse(localStorage.getItem(k)); return v ?? d; } catch { return d; } };
export const save = (k, v) => { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)); } catch {} };
export const fmtMoney = (c) => (c % 100 === 0 ? `$${c / 100}` : `$${(c / 100).toFixed(2)}`);

// Reconnecting WebSocket. Messages sent while offline are dropped on purpose:
// the server is the source of truth and sends full state after a rejoin.
export class Net {
  constructor({ onMessage, onOpen, onStatus }) {
    this.onMessage = onMessage; this.onOpen = onOpen; this.onStatus = onStatus || (() => {});
    this.ws = null; this.delay = 400; this.lastSeen = Date.now(); this.wanted = true;
    setInterval(() => { if (this.isOpen() && Date.now() - this.lastSeen > 25000) this.ws.close(); }, 5000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden && !this.isOpen()) this.connect(true); });
    window.addEventListener('online', () => { if (!this.isOpen()) this.connect(true); });
    this.connect();
  }
  isOpen() { return this.ws && this.ws.readyState === 1; }
  connect(now = false) {
    if (this.ws && this.ws.readyState <= 1) return;
    clearTimeout(this.retry);
    if (now) this.delay = 400;
    const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
    this.ws = ws;
    ws.onopen = () => { this.delay = 400; this.lastSeen = Date.now(); this.onStatus(true); this.onOpen && this.onOpen(); };
    ws.onmessage = (e) => {
      this.lastSeen = Date.now();
      let m; try { m = JSON.parse(e.data); } catch { return; }
      if (m.t !== 'hb') this.onMessage(m);
    };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.onStatus(false);
      if (this.wanted) this.retry = setTimeout(() => this.connect(), this.delay);
      this.delay = Math.min(4000, this.delay * 1.6);
    };
    ws.onerror = () => {};
  }
  send(obj) { if (this.isOpen()) { this.ws.send(JSON.stringify(obj)); return true; } return false; }
}
