// Minimal RFC 6455 WebSocket server (text frames only). No dependencies.
import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const MAX_PAYLOAD = 64 * 1024;

export class WSConn extends EventEmitter {
  constructor(socket) {
    super();
    this.socket = socket;
    this.buf = Buffer.alloc(0);
    this.frag = null;
    this.open = true;
    this.alive = true;
    socket.on('data', (d) => this._data(d));
    socket.on('close', () => this._closed());
    socket.on('error', () => this._closed());
    socket.setNoDelay(true);
  }
  _closed() {
    if (!this.open) return;
    this.open = false;
    this.emit('close');
  }
  _data(chunk) {
    this.buf = this.buf.length ? Buffer.concat([this.buf, chunk]) : chunk;
    while (this.open) {
      if (this.buf.length < 2) return;
      const b0 = this.buf[0], b1 = this.buf[1];
      const fin = (b0 & 0x80) !== 0, op = b0 & 0x0f, masked = (b1 & 0x80) !== 0;
      let len = b1 & 0x7f, off = 2;
      if (len === 126) {
        if (this.buf.length < 4) return;
        len = this.buf.readUInt16BE(2); off = 4;
      } else if (len === 127) {
        if (this.buf.length < 10) return;
        const big = this.buf.readBigUInt64BE(2);
        if (big > BigInt(MAX_PAYLOAD)) return this.terminate();
        len = Number(big); off = 10;
      }
      if (len > MAX_PAYLOAD || !masked) return this.terminate();
      if (this.buf.length < off + 4 + len) return;
      const mask = this.buf.subarray(off, off + 4);
      const payload = Buffer.from(this.buf.subarray(off + 4, off + 4 + len));
      for (let i = 0; i < len; i++) payload[i] ^= mask[i & 3];
      this.buf = this.buf.subarray(off + 4 + len);
      this._frame(fin, op, payload);
    }
  }
  _frame(fin, op, payload) {
    if (op === 0x8) { this._write(0x8, payload.subarray(0, 2)); this.socket.end(); return this._closed(); }
    if (op === 0x9) return this._write(0xA, payload);
    if (op === 0xA) { this.alive = true; return; }
    if (op === 0x1 || op === 0x2) {
      if (fin) return op === 0x1 && this.emit('message', payload.toString('utf8'));
      this.frag = { op, parts: [payload], size: payload.length };
      return;
    }
    if (op === 0x0 && this.frag) {
      this.frag.parts.push(payload);
      this.frag.size += payload.length;
      if (this.frag.size > MAX_PAYLOAD) return this.terminate();
      if (fin) {
        const f = this.frag; this.frag = null;
        if (f.op === 0x1) this.emit('message', Buffer.concat(f.parts).toString('utf8'));
      }
    }
  }
  _write(op, payload) {
    if (!this.open && op !== 0x8) return;
    const len = payload.length;
    let head;
    if (len < 126) head = Buffer.from([0x80 | op, len]);
    else if (len < 65536) { head = Buffer.alloc(4); head[0] = 0x80 | op; head[1] = 126; head.writeUInt16BE(len, 2); }
    else { head = Buffer.alloc(10); head[0] = 0x80 | op; head[1] = 127; head.writeBigUInt64BE(BigInt(len), 2); }
    try { this.socket.write(Buffer.concat([head, payload])); } catch { this._closed(); }
  }
  send(str) { this._write(0x1, Buffer.from(str, 'utf8')); }
  json(obj) { this.send(JSON.stringify(obj)); }
  ping() { this._write(0x9, Buffer.alloc(0)); }
  close() { this._write(0x8, Buffer.alloc(0)); try { this.socket.end(); } catch {} this._closed(); }
  terminate() { try { this.socket.destroy(); } catch {} this._closed(); }
}

export function acceptUpgrade(req, socket) {
  const key = req.headers['sec-websocket-key'];
  if (!key || (req.headers.upgrade || '').toLowerCase() !== 'websocket') { socket.destroy(); return null; }
  // Same-origin only: a page on another site must not be able to open a socket here.
  const origin = req.headers.origin;
  if (origin) {
    try { if (new URL(origin).host !== req.headers.host) { socket.destroy(); return null; } }
    catch { socket.destroy(); return null; }
  }
  const accept = crypto.createHash('sha1').update(key + GUID).digest('base64');
  socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n' +
    `Sec-WebSocket-Accept: ${accept}\r\n\r\n`);
  return new WSConn(socket);
}
