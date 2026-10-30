// Procedural WebAudio sound effects (no asset files needed).
let ctx = null, master = null, noiseBuf = null;
let enabled = true;
const last = {};

export function initAudio() {
  if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
  try {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain();
    master.gain.value = 0.5;
    master.connect(ctx.destination);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 1.5, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  } catch (e) { ctx = null; }
}

export function setSound(on) { enabled = on; }

function noise(dur, freq, q, vol, type = 'lowpass', attack = 0.002) {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;
  const f = ctx.createBiquadFilter();
  f.type = type; f.frequency.value = freq; f.Q.value = q;
  const g = ctx.createGain();
  const t = ctx.currentTime;
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(vol, t + attack);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  src.connect(f); f.connect(g); g.connect(master);
  src.start(t, Math.random() * 0.5);
  src.stop(t + dur + 0.05);
  return f;
}

function tone(freq, dur, vol, type = 'sine', slide = 0) {
  const o = ctx.createOscillator();
  o.type = type;
  const t = ctx.currentTime;
  o.frequency.setValueAtTime(freq, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq * slide), t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g); g.connect(master);
  o.start(t); o.stop(t + dur + 0.05);
}

export function sfx(name, vol = 1) {
  if (!ctx || !enabled) return;
  const now = performance.now();
  const minGap = { shot: 45, hit: 60, boom: 70, smoke: 100 }[name] || 30;
  if (last[name] && now - last[name] < minGap) return;
  last[name] = now;
  switch (name) {
    case 'shot': noise(0.09, 2500, 0.7, 0.35 * vol); tone(140, 0.06, 0.2 * vol, 'square', 0.5); break;
    case 'sniper': noise(0.35, 1800, 0.5, 0.6 * vol); tone(90, 0.25, 0.4 * vol, 'sawtooth', 0.3); break;
    case 'cannon': noise(0.6, 600, 0.6, 0.9 * vol); tone(60, 0.4, 0.6 * vol, 'sine', 0.4); break;
    case 'rocket': noise(0.5, 3000, 2, 0.3 * vol, 'bandpass', 0.05); break;
    case 'boom': noise(1.1, 400, 0.5, 1.0 * vol); tone(50, 0.7, 0.7 * vol, 'sine', 0.3); break;
    case 'hit': tone(900, 0.04, 0.12 * vol, 'square', 0.5); break;
    case 'death': tone(300, 0.3, 0.2 * vol, 'triangle', 0.4); break;
    case 'crate': noise(0.25, 900, 1, 0.4 * vol); break;
    case 'dash': noise(0.2, 4000, 1, 0.2 * vol, 'highpass', 0.05); break;
    case 'throw': tone(500, 0.12, 0.1 * vol, 'sine', 1.6); break;
    case 'radio': tone(1200, 0.08, 0.12 * vol, 'square'); setTimeout(() => tone(900, 0.08, 0.12 * vol, 'square'), 110); break;
    case 'arty': tone(1400, 0.9, 0.12 * vol, 'sine', 0.3); break;
    case 'jet': noise(2.2, 1200, 0.8, 0.5 * vol, 'lowpass', 0.8); break;
    case 'train': tone(330, 0.3, 0.15 * vol, 'square'); setTimeout(() => tone(262, 0.4, 0.15 * vol, 'square'), 320); break;
    case 'build': tone(600, 0.08, 0.15 * vol, 'triangle'); setTimeout(() => tone(800, 0.1, 0.15 * vol, 'triangle'), 90); break;
    case 'click': tone(1000, 0.03, 0.1 * vol, 'square'); break;
    case 'select': tone(700, 0.05, 0.1 * vol, 'triangle', 1.3); break;
    case 'error': tone(200, 0.15, 0.15 * vol, 'square'); break;
    case 'turn': tone(520, 0.12, 0.15 * vol, 'triangle'); setTimeout(() => tone(780, 0.18, 0.15 * vol, 'triangle'), 130); break;
    case 'win': [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => tone(f, 0.3, 0.2, 'triangle'), i * 150)); break;
    case 'lose': [400, 330, 260, 200].forEach((f, i) => setTimeout(() => tone(f, 0.35, 0.2, 'triangle'), i * 180)); break;
    case 'alarm': tone(880, 0.25, 0.15 * vol, 'sawtooth'); setTimeout(() => tone(660, 0.25, 0.15 * vol, 'sawtooth'), 260); break;
    case 'cash': tone(1300, 0.06, 0.12 * vol, 'square'); setTimeout(() => tone(1700, 0.1, 0.12 * vol, 'square'), 70); break;
  }
}

// continuous drone buzz
let buzz = null;
export function droneBuzz(on, pitch = 1) {
  if (!ctx || !enabled) { if (buzz) { buzz.o.stop(); buzz = null; } return; }
  if (on && !buzz) {
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    const g = ctx.createGain();
    g.gain.value = 0.05;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = 1200;
    o.connect(f); f.connect(g); g.connect(master);
    o.start();
    buzz = { o, g };
  }
  if (buzz) {
    if (!on) { buzz.o.stop(); buzz = null; return; }
    buzz.o.frequency.setTargetAtTime(170 * pitch, ctx.currentTime, 0.05);
  }
}
