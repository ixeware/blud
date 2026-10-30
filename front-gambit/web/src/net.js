// Online multiplayer over WebRTC using the free public PeerJS cloud broker (0.peerjs.com).
import { Peer } from 'peerjs';

const PREFIX = 'frontgambit-v1-';
const ICE = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:global.stun.twilio.com:3478' },
    { urls: 'turn:openrelay.metered.ca:80', username: 'openrelayproject', credential: 'openrelayproject' },
    { urls: 'turn:openrelay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayproject' },
    { urls: 'turn:openrelay.metered.ca:443?transport=tcp', username: 'openrelayproject', credential: 'openrelayproject' },
  ],
};

function code() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 5; i++) s += A[Math.floor(Math.random() * A.length)];
  return s;
}

export class Net {
  constructor() {
    this.peer = null;
    this.conn = null;
    this.onMessage = () => {};
    this.onClose = () => {};
    this.onOpen = () => {};
    this.ping = 0;
  }

  host(onCode, onError) {
    const c = code();
    this.peer = new Peer(PREFIX + c, { config: ICE, debug: 0 });
    this.peer.on('open', () => onCode(c));
    this.peer.on('error', (e) => {
      if (e.type === 'unavailable-id') { this.destroy(); this.host(onCode, onError); return; }
      onError(e.type || String(e));
    });
    this.peer.on('connection', (conn) => {
      if (this.conn) { conn.close(); return; }
      this.attach(conn);
    });
  }

  join(c, onError) {
    this.peer = new Peer({ config: ICE, debug: 0 });
    this.peer.on('open', () => {
      const conn = this.peer.connect(PREFIX + c.trim().toUpperCase(), { reliable: true, serialization: 'json' });
      this.attach(conn);
      setTimeout(() => { if (!this.opened) onError('Не удалось подключиться (таймаут). Проверьте код.'); }, 20000);
    });
    this.peer.on('error', (e) => onError(e.type === 'peer-unavailable' ? 'Комната не найдена' : (e.type || String(e))));
  }

  attach(conn) {
    this.conn = conn;
    conn.on('open', () => {
      this.opened = true;
      this.onOpen();
      this.pingTimer = setInterval(() => this.send({ t: 'ping', at: performance.now() }), 2000);
    });
    conn.on('data', (d) => {
      if (d.t === 'ping') { this.send({ t: 'pong', at: d.at }); return; }
      if (d.t === 'pong') { this.ping = Math.round(performance.now() - d.at); return; }
      this.onMessage(d);
    });
    conn.on('close', () => this.onClose());
    conn.on('error', () => this.onClose());
  }

  send(msg) {
    if (this.conn && this.conn.open) this.conn.send(msg);
  }

  destroy() {
    clearInterval(this.pingTimer);
    try { if (this.conn) this.conn.close(); } catch (e) { /* ignore */ }
    try { if (this.peer) this.peer.destroy(); } catch (e) { /* ignore */ }
    this.conn = null; this.peer = null; this.opened = false;
  }
}
