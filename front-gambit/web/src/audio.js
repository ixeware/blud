// Procedural chiptune music and sound effects (WebAudio, no asset files).
let ctx = null, master = null, sfxBus = null, musicBus = null, noiseBuf = null;
let sfxVol = 0.8, musicVol = 0.6, muted = false;
const last = {};

export function initAudio() {
  if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
  try {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain();
    master.connect(ctx.destination);
    sfxBus = ctx.createGain(); sfxBus.connect(master);
    musicBus = ctx.createGain(); musicBus.connect(master);
    const comp = ctx.createDynamicsCompressor();
    master.disconnect(); master.connect(comp); comp.connect(ctx.destination);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 1.5, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    applyVolumes();
    if (pendingTrack) playMusic(pendingTrack);
  } catch (e) { ctx = null; }
}

function applyVolumes() {
  if (!ctx) return;
  sfxBus.gain.value = muted ? 0 : sfxVol * 0.55;
  musicBus.gain.value = muted ? 0 : musicVol * 0.28;
}
export function suspendAudio() { if (ctx && ctx.state === 'running') ctx.suspend(); }
export function resumeAudio() { if (ctx && ctx.state === 'suspended') ctx.resume(); }
export function setVolumes(music, sfx) { musicVol = music; sfxVol = sfx; applyVolumes(); }
export function setMuted(m) { muted = m; applyVolumes(); }
export function isMuted() { return muted; }

function noise(dur, freq, q, vol, type = 'lowpass', attack = 0.002, when = 0, bus = sfxBus) {
  const t = ctx.currentTime + when;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;
  const f = ctx.createBiquadFilter();
  f.type = type; f.frequency.value = freq; f.Q.value = q;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(vol, t + attack);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  src.connect(f); f.connect(g); g.connect(bus);
  src.start(t, Math.random() * 0.5);
  src.stop(t + dur + 0.05);
}

function tone(freq, dur, vol, type = 'square', slide = 0, when = 0, bus = sfxBus) {
  const t = ctx.currentTime + when;
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq * slide), t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g); g.connect(bus);
  o.start(t); o.stop(t + dur + 0.05);
}
const arp = (notes, step, dur, vol, type = 'square') => notes.forEach((f, i) => tone(f, dur, vol, type, 0, i * step));

export function sfx(name, vol = 1) {
  if (!ctx || muted) return;
  const now = performance.now();
  const minGap = { shot: 40, hit: 55, boom: 60, ricochet: 80, flame: 90 }[name] || 25;
  if (last[name] && now - last[name] < minGap) return;
  last[name] = now;
  const v = vol;
  switch (name) {
    case 'shot': noise(0.08, 2600, 0.7, 0.4 * v); tone(160, 0.05, 0.18 * v, 'square', 0.4); break;
    case 'sniper': noise(0.35, 1800, 0.5, 0.65 * v); tone(110, 0.25, 0.35 * v, 'sawtooth', 0.3); break;
    case 'cannon': noise(0.6, 600, 0.6, 0.9 * v); tone(70, 0.45, 0.5 * v, 'square', 0.35); break;
    case 'rocket': noise(0.5, 3000, 2, 0.3 * v, 'bandpass', 0.05); tone(600, 0.4, 0.06 * v, 'sawtooth', 0.5); break;
    case 'boom': noise(1.1, 420, 0.5, 1.0 * v); tone(55, 0.7, 0.6 * v, 'triangle', 0.3); noise(0.4, 2000, 0.3, 0.2 * v, 'highpass', 0.002, 0.05); break;
    case 'hit': tone(900, 0.04, 0.12 * v, 'square', 0.5); break;
    case 'crit': tone(1500, 0.06, 0.2, 'square', 0.6); tone(2200, 0.1, 0.15, 'square', 0.8, 0.05); noise(0.15, 3000, 1, 0.2); break;
    case 'ricochet': tone(2400, 0.18, 0.06 * v, 'sine', 0.4); break;
    case 'death': tone(320, 0.35, 0.2 * v, 'square', 0.3); break;
    case 'crate': noise(0.25, 900, 1, 0.4 * v); tone(140, 0.12, 0.15, 'square', 0.6); break;
    case 'collapse': noise(1.6, 300, 0.4, 0.9); tone(40, 1.2, 0.5, 'triangle', 0.5); break;
    case 'dash': noise(0.2, 4000, 1, 0.22 * v, 'highpass', 0.05); tone(300, 0.15, 0.08, 'square', 3); break;
    case 'throw': tone(500, 0.12, 0.1 * v, 'square', 1.6); break;
    case 'radio': tone(1200, 0.07, 0.1 * v, 'square'); tone(900, 0.07, 0.1 * v, 'square', 0, 0.1); noise(0.2, 2500, 2, 0.06, 'bandpass', 0.01, 0.02); break;
    case 'arty': tone(1400, 0.9, 0.1 * v, 'sine', 0.3); break;
    case 'jet': noise(2.2, 1200, 0.8, 0.5 * v, 'lowpass', 0.8); tone(200, 2, 0.05, 'sawtooth', 0.6); break;
    case 'b2': noise(3.2, 500, 0.8, 0.6, 'lowpass', 1.2); tone(90, 3, 0.12, 'sawtooth', 0.7); break;
    case 'train': arp([392, 330, 392, 330], 0.18, 0.16, 0.12); noise(0.8, 300, 1, 0.2, 'lowpass', 0.1); break;
    case 'metro': arp([523, 659, 784], 0.1, 0.12, 0.1, 'triangle'); break;
    case 'build': arp([600, 800], 0.08, 0.1, 0.13, 'triangle'); noise(0.08, 3000, 1, 0.1, 'highpass', 0.002, 0.05); break;
    case 'dig': noise(0.15, 700, 1, 0.3); noise(0.15, 700, 1, 0.3, 'lowpass', 0.002, 0.2); break;
    case 'click': tone(1000, 0.03, 0.1 * v, 'square'); break;
    case 'select': tone(700, 0.05, 0.1 * v, 'square', 1.3); break;
    case 'error': tone(180, 0.15, 0.15 * v, 'square'); tone(140, 0.15, 0.15 * v, 'square', 0, 0.12); break;
    case 'turn': arp([523, 659, 784], 0.1, 0.15, 0.14, 'square'); break;
    case 'win': arp([523, 659, 784, 1046, 784, 1046], 0.13, 0.3, 0.18, 'square'); break;
    case 'lose': arp([400, 330, 262, 196], 0.2, 0.4, 0.18, 'triangle'); break;
    case 'alarm': tone(880, 0.22, 0.14 * v, 'square'); tone(660, 0.22, 0.14 * v, 'square', 0, 0.25); tone(880, 0.22, 0.14 * v, 'square', 0, 0.5); break;
    case 'cash': arp([1300, 1700], 0.07, 0.1, 0.12); break;
    case 'heal': arp([523, 784, 1046], 0.07, 0.15, 0.1, 'triangle'); break;
    case 'reload': noise(0.06, 2000, 2, 0.25, 'bandpass'); noise(0.06, 1400, 2, 0.25, 'bandpass', 0.002, 0.3); break;
    case 'flame': noise(0.3, 900, 0.4, 0.25 * v, 'lowpass', 0.05); break;
    case 'fire': noise(1.0, 800, 0.4, 0.5, 'lowpass', 0.1); break;
    case 'gas': noise(1.2, 1500, 0.4, 0.3, 'highpass', 0.3); break;
    case 'smoke': noise(0.9, 1200, 0.4, 0.3, 'highpass', 0.2); break;
    case 'shield': tone(300, 0.3, 0.12, 'sine', 2.5); break;
    case 'lock': tone(1800, 0.05, 0.1, 'square'); tone(1800, 0.05, 0.1, 'square', 0, 0.09); break;
    case 'radar': tone(1200, 0.4, 0.08, 'sine', 0.5); tone(1200, 0.4, 0.06, 'sine', 0.5, 0.45); break;
    case 'ew': for (let i = 0; i < 6; i++) tone(200 + Math.random() * 2000, 0.06, 0.06, 'sawtooth', 1, i * 0.05); break;
    case 'emp': tone(80, 0.6, 0.3, 'sawtooth', 8); noise(0.6, 4000, 1, 0.2, 'highpass'); break;
    case 'rally': arp([392, 523, 659, 784], 0.11, 0.2, 0.13, 'square'); break;
    case 'engine': tone(60, 0.8, 0.2, 'sawtooth', 2.2); break;
    case 'para': noise(0.8, 600, 0.6, 0.18, 'lowpass', 0.3); break;
    case 'sneak': arp([196, 233, 196], 0.25, 0.22, 0.1, 'triangle'); break;
    case 'rank': arp([659, 784, 988, 1318], 0.08, 0.2, 0.14, 'square'); break;
    case 'capture': arp([440, 554, 659], 0.09, 0.2, 0.13, 'square'); break;
    case 'card': noise(0.12, 4000, 0.5, 0.2, 'highpass', 0.01); tone(900, 0.06, 0.08, 'triangle', 1.5, 0.05); break;
    case 'flak': for (let i = 0; i < 5; i++) noise(0.2, 800, 0.6, 0.35, 'lowpass', 0.002, i * 0.12); break;
    case 'blitz': arp([262, 330, 392, 523, 659], 0.06, 0.15, 0.13, 'square'); noise(1.2, 300, 0.5, 0.4, 'lowpass', 0.2); break;
    case 'event': arp([330, 392, 494, 659], 0.12, 0.3, 0.14, 'triangle'); break;
    case 'vs': noise(0.6, 600, 0.6, 0.5); arp([131, 196, 262], 0.08, 0.4, 0.2, 'square'); break;
  }
}

// ---------- drone buzz ----------
let buzz = null;
export function droneBuzz(on, pitch = 1) {
  if (!ctx || muted) { if (buzz) { buzz.o.stop(); buzz = null; } return; }
  if (on && !buzz) {
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    const g = ctx.createGain(); g.gain.value = 0.05;
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 1200;
    o.connect(f); f.connect(g); g.connect(sfxBus);
    o.start();
    buzz = { o, g };
  }
  if (buzz) {
    if (!on) { buzz.o.stop(); buzz = null; return; }
    buzz.o.frequency.setTargetAtTime(170 * pitch, ctx.currentTime, 0.05);
  }
}

// ---------- chiptune music ----------
const NOTE = { C: 0, 'C#': 1, D: 2, 'D#': 3, E: 4, F: 5, 'F#': 6, G: 7, 'G#': 8, A: 9, 'A#': 10, B: 11 };
function freq(n) {
  const m = /^([A-G]#?)(\d)$/.exec(n);
  if (!m) return 0;
  return 440 * Math.pow(2, (NOTE[m[1]] + (+m[2] + 1) * 12 - 69) / 12);
}
const P = (s) => s.trim().split(/\s+/);

// each step is an 8th note; '.' rest, '-' hold
const TRACKS = {
  menu: { bpm: 104, loop: true,
    lead: P(`C5 - G4 - C5 D5 D#5 - D5 - C5 - A#4 - G4 - G#4 - G#4 G4 F4 - D#4 - F4 G4 - - . . . .
             C5 - G4 - C5 D5 D#5 - F5 - D#5 - D5 - C5 - A#4 - A#4 C5 D5 - D#5 - D5 C5 - - . . . .`),
    bass: P(`C3 . C3 . C3 . G2 . G#2 . G#2 . A#2 . A#2 . F2 . F2 . G2 . G2 . C3 . G2 . C3 . C3 .
             C3 . C3 . C3 . G2 . G#2 . G#2 . A#2 . A#2 . F2 . G2 . G#2 . A#2 . C3 . G2 . C3 . . .`),
    drum: P(`k . h . s . h . k . h . s . h h k . h . s . h . k k h . s . h .
             k . h . s . h . k . h . s . h h k . h . s . h . k k h . s s s s`) },
  board: { bpm: 88, loop: true,
    lead: P(`. . E4 - G4 - A4 - . . G4 - E4 - D4 - . . E4 - G4 - B4 - A4 - - - . . . .
             . . E4 - G4 - A4 - . . C5 - B4 - A4 - G4 - E4 - D4 - E4 - - - . . . .`),
    bass: P(`A2 - - - A2 - - - F2 - - - F2 - - - C3 - - - C3 - - - G2 - - - E2 - - -
             A2 - - - A2 - - - F2 - - - F2 - - - C3 - - - G2 - - - A2 - - - A2 - - -`),
    drum: P(`k . . . h . . . k . . . h . . . k . . . h . . . k . . . h . h .
             k . . . h . . . k . . . h . . . k . . . h . . . k . k . s . . .`) },
  duel: { bpm: 152, loop: true,
    lead: P(`E5 E5 . E5 . D5 E5 . G5 - E5 - D5 - B4 - E5 E5 . E5 . D5 E5 . A5 - G5 - E5 - D5 -
             C5 C5 . C5 . B4 C5 . E5 - C5 - B4 - G4 - A4 A4 . B4 . C5 D5 . E5 - - - . . . .`),
    bass: P(`E2 E3 E2 E3 E2 E3 E2 E3 E2 E3 E2 E3 G2 G3 G2 G3 E2 E3 E2 E3 E2 E3 E2 E3 A2 A3 A2 A3 G2 G3 B2 B3
             C3 C4 C3 C4 C3 C4 C3 C4 G2 G3 G2 G3 G2 G3 G2 G3 A2 A3 A2 A3 B2 B3 B2 B3 E2 E3 E2 E3 E2 E3 E2 E3`),
    drum: P(`k h s h k k s h k h s h k k s s k h s h k k s h k h s h k s s s
             k h s h k k s h k h s h k k s s k h s h k k s h k s k s s s s s`) },
  drone: { bpm: 128, loop: true,
    lead: P(`A4 . C5 . E5 . C5 . A4 . C5 . F5 . C5 . G4 . B4 . D5 . B4 . G4 . B4 . E5 . B4 .`),
    bass: P(`A2 A2 A2 A2 A2 A2 A2 A2 F2 F2 F2 F2 F2 F2 F2 F2 G2 G2 G2 G2 G2 G2 G2 G2 E2 E2 E2 E2 E2 E2 E2 E2`),
    drum: P(`k . h . k . h . k . h . k . h h k . h . k . h . k . h . k s h s`) },
  victory: { bpm: 140, loop: false,
    lead: P(`C5 E5 G5 C6 - - G5 - C6 - - - . . . .`),
    bass: P(`C3 - G3 - C3 - G3 - C3 - - - . . . .`),
    drum: P(`k . s . k . s . k k s s k . . .`) },
  defeat: { bpm: 90, loop: false,
    lead: P(`G4 - F4 - D#4 - D4 - C4 - - - . . . .`),
    bass: P(`C3 - - - G2 - - - C2 - - - . . . .`),
    drum: P(`k . . . k . . . k . . . . . . .`) },
};

let current = null, pendingTrack = null, timer = null, step = 0, nextT = 0;

export function playMusic(name) {
  pendingTrack = name;
  if (!ctx) return;
  if (current && current.name === name) return;
  stopMusic();
  const tr = TRACKS[name];
  if (!tr) return;
  current = { name, tr };
  step = 0;
  nextT = ctx.currentTime + 0.1;
  timer = setInterval(schedule, 30);
}

export function stopMusic() {
  if (timer) clearInterval(timer);
  timer = null;
  current = null;
}

function schedule() {
  if (!current || !ctx) return;
  const tr = current.tr;
  const stepDur = 60 / tr.bpm / 2;
  const len = tr.lead.length;
  while (nextT < ctx.currentTime + 0.15) {
    const i = step % len;
    if (!tr.loop && step >= len) { stopMusic(); return; }
    const when = nextT - ctx.currentTime;
    playStep(tr.lead, i, stepDur, 'square', 0.16, when);
    playStep(tr.bass, i % tr.bass.length, stepDur, 'triangle', 0.32, when);
    const d = tr.drum[i % tr.drum.length];
    if (d === 'k') { tone(140, 0.12, 0.45, 'sine', 0.3, when, musicBus); }
    else if (d === 's') noise(0.12, 1800, 0.8, 0.22, 'bandpass', 0.002, when, musicBus);
    else if (d === 'h') noise(0.04, 7000, 1, 0.08, 'highpass', 0.002, when, musicBus);
    nextT += stepDur;
    step++;
  }
}

function playStep(seq, i, stepDur, type, vol, when) {
  const n = seq[i];
  if (!n || n === '.' || n === '-') return;
  let holds = 1;
  for (let k = i + 1; k < seq.length && seq[k] === '-'; k++) holds++;
  const f = freq(n);
  if (!f) return;
  const t = ctx.currentTime + when;
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(f, t);
  if (type === 'square') { const lfo = ctx.createOscillator(); const lg = ctx.createGain(); lfo.frequency.value = 6; lg.gain.value = f * 0.006; lfo.connect(lg); lg.connect(o.frequency); lfo.start(t); lfo.stop(t + holds * stepDur + 0.05); }
  const g = ctx.createGain();
  const dur = holds * stepDur * 0.95;
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(vol, t + 0.01);
  g.gain.setValueAtTime(vol * 0.7, t + Math.min(dur, 0.08));
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g); g.connect(musicBus);
  o.start(t); o.stop(t + dur + 0.05);
}
