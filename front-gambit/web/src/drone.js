// FPV kamikaze drone mission over the board (host authoritative).
import { rng, sqToWorld, TILE } from './rng.js';
import { unitDef } from './units.js';
import { hasPassive } from './core.js';

import { plotPos, level } from './city.js';

export const DRONE_BATTERY = 20;
const SPEED = 10;

export function pieceTop(t, air) {
  if (t === 'Q' || air) return 3.6;
  return { R: 2.0, A: 2.3, L: 2.5, T: 2.7 }[t] || 2.1;
}
export function pieceBottom(t, air) {
  return t === 'Q' || air ? 1.6 : 0;
}

export class DroneSim {
  constructor(state, opts) {
    const rt = state.rt;
    this.side = rt.side;
    this.ctrl = opts.ctrl; // 'local'|'remote'|'ai'
    this.R = rng(rt.seed);
    this.jam = !!rt.ew;
    this.decoy = !!rt.decoy;
    this.aaT = 0;
    const home = this.side === 'w' ? 1 : -1;
    this.x = (this.R() - 0.5) * 8;
    this.z = home * (4.5 * TILE);
    this.y = 7;
    this.yaw = this.side === 'w' ? -Math.PI / 2 : Math.PI / 2; // forward = (cos yaw, sin yaw)
    this.pitch = 0;
    this.roll = 0;
    this.battery = DRONE_BATTERY;
    this.boost = 0;
    this.over = false;
    this.endDelay = 1.4;
    this.result = null;
    this.events = [];
    this.noise = 0;
    // snapshot of piece positions
    this.pieces = [];
    state.board.forEach((p, i) => {
      if (!p) return;
      const w = sqToWorld(i);
      const d = unitDef(state, p);
      this.pieces.push({ sq: i, t: p.t, s: p.s, x: w.x, z: w.z, v: d.value, air: !!d.air, aa: hasPassive(state, p, 'aacover') });
    });
    const opp = this.side === 'w' ? 'b' : 'w';
    this.buildings = [];
    (state.city ? state.city[opp] : []).forEach((b, plot) => { if (b) this.buildings.push({ ...plotPos(opp, plot), plot, side: opp, h: 3 + b.lvl }); });
    this.cityAA = state.city ? level(state, opp, 'aasite') : 0;
    this.cityAAT = 0;
    // AI target
    const en = this.pieces.filter((p) => p.s !== this.side);
    en.sort((a, b) => (b.v === 100 ? 6 : b.v) - (a.v === 100 ? 6 : a.v) + (this.R() - 0.5) * 3);
    this.aiTarget = en[0] || null;
  }

  aiInput() {
    const t = this.aiTarget;
    if (!t) return { mx: 0, my: 0 };
    const dx = t.x - this.x, dz = t.z - this.z;
    const want = Math.atan2(dz, dx);
    let d = want - this.yaw;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    const dist = Math.hypot(dx, dz);
    const targetY = dist < 9 ? (pieceTop(t.t, t.air) + pieceBottom(t.t, t.air)) / 2 : 4;
    return { mx: Math.max(-1, Math.min(1, d * 2)), my: Math.max(-1, Math.min(1, (targetY - this.y) * 0.8)), ab: dist > 20 };
  }

  step(dt, inp) {
    if (this.over) { this.endDelay -= dt; return; }
    if (this.ctrl === 'ai') inp = this.aiInput();
    inp = inp || { mx: 0, my: 0 };
    const enemyHalf = this.side === 'w' ? this.z < 0 : this.z > 0;
    const jammed = this.jam && enemyHalf;
    let turn = inp.mx || 0;
    if (jammed) {
      this.noise += dt;
      turn += Math.sin(this.noise * 7.3) * 0.6 + Math.sin(this.noise * 13.1) * 0.4;
    }
    this.yaw += turn * 1.9 * dt;
    this.roll += (turn * 0.6 - this.roll) * Math.min(1, dt * 6);
    const climb = inp.my || 0;
    this.y += climb * 4.2 * dt;
    this.pitch += (-climb * 0.35 - this.pitch) * Math.min(1, dt * 5);
    this.y = Math.min(12, this.y);
    if (inp.ab && this.boost <= 0) this.boost = 1.2;
    let spd = SPEED;
    if (this.boost > 0) { this.boost -= dt; spd *= 1.8; }
    this.x += Math.cos(this.yaw) * spd * dt;
    this.z += Math.sin(this.yaw) * spd * dt;
    this.battery -= dt * (jammed ? 1.7 : 1) * (this.boost > 0 ? 1.5 : 1);
    this.jammed = jammed;
    // collisions
    // enemy air defence can shoot the drone down
    for (const p of this.pieces) {
      if (!p.aa || p.s === this.side) continue;
      if (Math.hypot(p.x - this.x, p.z - this.z) < 7 && this.y < 7) {
        this.aaT += dt;
        if (this.aaT > 0.25) { this.aaT = 0; this.events.push({ k: 'flak', x: this.x, y: this.y, z: this.z }); if (this.R() < 0.18) return this.shotDown(); }
      }
    }
    // anti-aircraft division protects the enemy rear city
    if (this.cityAA && Math.abs(this.z) > 18 && Math.sign(this.z) === (this.side === 'w' ? -1 : 1)) {
      this.cityAAT += dt;
      if (this.cityAAT > 0.4) {
        this.cityAAT = 0;
        this.events.push({ k: 'flak', x: this.x, y: this.y, z: this.z });
        if (this.R() < 0.06 * this.cityAA) return this.shotDown();
      }
    }
    for (const f of this.buildings) {
      if (Math.abs(f.x - this.x) < 3.4 && Math.abs(f.z - this.z) < 2.2 && this.y < f.h) return this.explodeFactory(f);
    }
    const LIM = 8.6 * TILE;
    if (Math.abs(this.x) > LIM || Math.abs(this.z) > LIM) {
      return this.finish([], 'Дрон улетел за пределы связи');
    }
    for (const p of this.pieces) {
      if (p.s === this.side) continue;
      const d = Math.hypot(p.x - this.x, p.z - this.z);
      if (d < 1.4 && this.y < pieceTop(p.t, p.air) && this.y > pieceBottom(p.t, p.air) - 0.3) {
        return this.explodeAt(p);
      }
    }
    if (this.y <= 0.1) return this.explodeAt(null);
    if (this.battery <= 0) return this.finish([], 'Батарея разряжена');
  }

  shotDown() {
    this.events.push({ k: 'boom', x: this.x, y: this.y, z: this.z });
    this.finish([], 'Дрон сбит ПВО!');
  }

  explodeFactory(f) {
    this.events.push({ k: 'boom', x: this.x, y: this.y, z: this.z });
    if (this.decoy) return this.finish([], 'Это был макет здания!');
    this.over = true;
    this.result = { hits: [], building: { side: f.side, plot: f.plot, dmg: 60 } };
    this.msg = 'Здание в тылу поражено!';
  }

  explodeAt(direct) {
    if (this.decoy) { this.events.push({ k: 'boom', x: this.x, y: this.y, z: this.z }); return this.finish([], 'Дрон ушёл в ложную цель!'); }
    const hits = [];
    if (direct) hits.push({ sq: direct.sq, dmg: direct.t === 'R' ? 120 : direct.t === 'Q' ? 95 : 80 });
    for (const p of this.pieces) {
      if (p === direct || p.s === this.side) continue;
      const d = Math.hypot(p.x - this.x, p.z - this.z);
      if (d < 3) hits.push({ sq: p.sq, dmg: direct ? 20 : 35 });
    }
    this.events.push({ k: 'boom', x: this.x, y: this.y, z: this.z });
    return this.finish(hits, direct ? 'Прямое попадание!' : hits.length ? 'Взрыв рядом с целью' : 'Промах');
  }

  finish(hits, msg) {
    this.over = true;
    this.result = { hits };
    this.msg = msg;
  }

  get done() { return this.over && this.endDelay <= 0; }

  snapshot() {
    const ev = this.events;
    this.events = [];
    return {
      x: this.x, y: this.y, z: this.z, yaw: this.yaw, pitch: this.pitch, roll: this.roll,
      bat: this.battery, jam: this.jammed ? 1 : 0, boost: this.boost > 0 ? 1 : 0,
      ev, over: this.over ? this.result : null, msg: this.msg || null,
    };
  }
}
