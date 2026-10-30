// Real-time top-down duel simulation (host authoritative, no rendering here).
import { rng } from './rng.js';

export const ARENA = { w: 40, d: 24 };
const HW = ARENA.w / 2, HD = ARENA.d / 2;
export const DUEL_TIME = 75;
export const HP_MUL = 3; // duels use inflated HP so fights last longer

export const KINDS = {
  P: { r: 0.55, speed: 5.2, air: false, pref: 9,
    w: { dmg: 8, rate: 0.14, spd: 40, spread: 0.05, range: 24, kind: 'b' },
    ab: { id: 'grenade', cd: 5, name: 'Граната' } },
  N: { r: 0.55, speed: 6.6, air: false, pref: 5,
    w: { dmg: 6, rate: 0.08, spd: 38, spread: 0.1, range: 16, kind: 'b' },
    ab: { id: 'dash', cd: 2.5, name: 'Рывок' } },
  B: { r: 0.55, speed: 4.6, air: false, pref: 16,
    w: { dmg: 110, rate: 1.1, spd: 90, spread: 0.004, range: 45, kind: 's' },
    ab: { id: 'arty', cd: 9, name: 'Артналёт' } },
  R: { r: 1.45, speed: 3.9, air: false, pref: 10, armor: 0.55,
    w: { dmg: 6, rate: 0.1, spd: 38, spread: 0.07, range: 22, kind: 'b' },
    ab: { id: 'cannon', cd: 2.2, name: 'Пушка' } },
  Q: { r: 1.3, speed: 7.2, air: true, pref: 7,
    w: { dmg: 5, rate: 0.06, spd: 44, spread: 0.08, range: 20, kind: 'b' },
    ab: { id: 'rockets', cd: 5.5, name: 'НУРСы' } },
  K: { r: 0.55, speed: 5.0, air: false, pref: 8,
    w: { dmg: 16, rate: 0.3, spd: 36, spread: 0.04, range: 20, kind: 'b' },
    ab: { id: 'guards', cd: 999, name: 'Охрана' } },
  A: { r: 0.5, speed: 4.8, air: false, pref: 10,
    w: { dmg: 7, rate: 0.2, spd: 38, spread: 0.08, range: 22, kind: 'b' },
    ab: null },
};

export const THEMES = ['field', 'desert', 'winter', 'ruins'];

export function genArena(seed) {
  const R = rng(seed);
  const theme = THEMES[Math.floor(R() * THEMES.length)];
  const obs = [];
  let id = 0;
  const free = (x, z, w, d) => {
    if (Math.abs(x) > HW - 2 - w / 2 || Math.abs(z) > HD - 1.5 - d / 2) return false;
    if (Math.abs(x) > HW - 9 && Math.abs(z) < 5) return false; // spawn zones
    for (const o of obs) {
      if (Math.abs(o.x - x) < (o.w + w) / 2 + 1.6 && Math.abs(o.z - z) < (o.d + d) / 2 + 1.6) return false;
    }
    return true;
  };
  const place = (kind, w, d, hp, tries = 40) => {
    for (let t = 0; t < tries; t++) {
      const x = (R() * 2 - 1) * (HW - 3), z = (R() * 2 - 1) * (HD - 2);
      if (free(x, z, w, d)) { obs.push({ id: id++, kind, x, z, w, d, hp, maxHp: hp }); return true; }
    }
    return false;
  };
  // central structure
  if (R() < 0.6) {
    obs.push({ id: id++, kind: 'wall', x: 0, z: -3.5, w: 1, d: 5, hp: 1e9, maxHp: 1e9 });
    obs.push({ id: id++, kind: 'wall', x: 0, z: 4.5, w: 1, d: 4, hp: 1e9, maxHp: 1e9 });
  } else {
    obs.push({ id: id++, kind: 'wall', x: 0, z: 0, w: 4, d: 4, hp: 1e9, maxHp: 1e9 });
  }
  for (let i = 0; i < 4; i++) {
    const vertical = R() < 0.5;
    place('wall', vertical ? 1 : 3 + R() * 3, vertical ? 3 + R() * 3 : 1, 1e9);
  }
  for (let i = 0; i < 9; i++) place('crate', 1.8, 1.8, 60);
  for (let i = 0; i < 7; i++) {
    const vertical = R() < 0.5;
    place('sandbag', vertical ? 0.9 : 3, vertical ? 3 : 0.9, 1e9);
  }
  for (let i = 0; i < 3; i++) place('barrel', 1, 1, 20);
  // decorative trees (no collision) positions
  const deco = [];
  for (let i = 0; i < 26; i++) {
    const side = R() < 0.5 ? -1 : 1;
    deco.push({ x: (R() * 2 - 1) * (HW + 6), z: side * (HD + 1.5 + R() * 6), s: 0.7 + R() * 0.8 });
  }
  return { theme, obs, deco };
}

function segAabb(x1, z1, x2, z2, o, pad = 0) {
  // slab test
  const minX = o.x - o.w / 2 - pad, maxX = o.x + o.w / 2 + pad;
  const minZ = o.z - o.d / 2 - pad, maxZ = o.z + o.d / 2 + pad;
  let t0 = 0, t1 = 1;
  const dx = x2 - x1, dz = z2 - z1;
  for (const [p, d, mn, mx] of [[x1, dx, minX, maxX], [z1, dz, minZ, maxZ]]) {
    if (Math.abs(d) < 1e-9) { if (p < mn || p > mx) return false; }
    else {
      let a = (mn - p) / d, b = (mx - p) / d;
      if (a > b) [a, b] = [b, a];
      t0 = Math.max(t0, a); t1 = Math.min(t1, b);
      if (t0 > t1) return false;
    }
  }
  return true;
}

export class DuelSim {
  constructor(rt, opts) {
    this.rt = rt;
    this.opts = opts; // { ctrl: {att, def}, difficulty: 0..2 }
    this.R = rng(rt.seed ^ 0x9e3779b9);
    const a = genArena(rt.seed);
    this.theme = a.theme;
    this.obs = a.obs;
    this.time = DUEL_TIME;
    this.units = [];
    this.proj = [];
    this.events = [];
    this.destroyed = [];
    this.uid = 1;
    this.over = false;
    this.result = null;
    this.endDelay = 1.6;
    const att = this.addUnit(rt.att.t, 'att', -HW + 4, 0, rt.att.hp * HP_MUL, rt.att.maxHp * HP_MUL, true);
    att.dmgMul = rt.att.supplied ? 1 : 0.75;
    const def = this.addUnit(rt.def.t, 'def', HW - 4, 0, rt.def.hp * HP_MUL, rt.def.maxHp * HP_MUL, true);
    def.dmgMul = rt.def.supplied ? 1 : 0.75;
    def.takeMul = rt.def.dug ? 0.65 : 1;
    def.aim = Math.PI;
    this.main = { att, def };
    for (let i = 0; i < rt.att.allies; i++) this.addUnit('A', 'att', -HW + 3, i ? 4 : -4, 150, 150, false);
    for (let i = 0; i < rt.def.allies; i++) this.addUnit('A', 'def', HW - 3, i ? 4 : -4, 150, 150, false);
    const acc = [0.26, 0.13, 0.06][opts.difficulty ?? 1];
    for (const u of this.units) u.aiErr = acc;
  }

  addUnit(kind, team, x, z, hp, maxHp, isMain) {
    const K = KINDS[kind];
    const u = {
      id: this.uid++, kind, team, x, z, hp, maxHp, isMain,
      r: K.r, aim: team === 'att' ? 0 : Math.PI, body: team === 'att' ? 0 : Math.PI,
      cd: 0, abCd: 1.5, alive: true, dmgMul: 1, takeMul: 1, invuln: 0,
      dashT: 0, dashX: 0, dashZ: 0,
      ai: { strafe: 1, strafeT: 0, think: 0, tx: 0, tz: 0 },
      moving: false,
    };
    this.units.push(u);
    return u;
  }

  enemiesOf(u) { return this.units.filter((v) => v.alive && v.team !== u.team); }

  los(x1, z1, x2, z2, air) {
    if (air) return true;
    for (const o of this.obs) {
      if (o.hp <= 0 || o.kind === 'sandbag') continue;
      if (segAabb(x1, z1, x2, z2, o)) return false;
    }
    return true;
  }

  blocked(x, z, r, u) {
    if (Math.abs(x) > HW - r || Math.abs(z) > HD - r) return true;
    if (u && KINDS[u.kind].air) return false;
    for (const o of this.obs) {
      if (o.hp <= 0) continue;
      if (u && u.kind === 'R' && (o.kind === 'crate' || o.kind === 'sandbag' || o.kind === 'barrel')) continue;
      if (Math.abs(x - o.x) < o.w / 2 + r && Math.abs(z - o.z) < o.d / 2 + r) return true;
    }
    return false;
  }

  moveUnit(u, dx, dz) {
    // axis separated movement for sliding along walls
    if (!this.blocked(u.x + dx, u.z, u.r, u)) u.x += dx;
    if (!this.blocked(u.x, u.z + dz, u.r, u)) u.z += dz;
    // tanks crush crates / sandbags
    if (u.kind === 'R') {
      for (const o of this.obs) {
        if (o.hp <= 0 || o.kind === 'wall') continue;
        if (Math.abs(u.x - o.x) < o.w / 2 + u.r && Math.abs(u.z - o.z) < o.d / 2 + u.r) {
          this.damageObs(o, 1e9);
        }
      }
    }
    // unit separation
    for (const v of this.units) {
      if (v === u || !v.alive) continue;
      if (KINDS[v.kind].air !== KINDS[u.kind].air) continue;
      const ddx = u.x - v.x, ddz = u.z - v.z;
      const d = Math.hypot(ddx, ddz), min = u.r + v.r;
      if (d < min && d > 1e-4) {
        const push = (min - d) / 2;
        const nx = u.x + (ddx / d) * push, nz = u.z + (ddz / d) * push;
        if (!this.blocked(nx, nz, u.r, u)) { u.x = nx; u.z = nz; }
      }
    }
  }

  damageObs(o, dmg) {
    if (o.kind === 'wall' || o.kind === 'sandbag' || o.hp <= 0) return;
    o.hp -= dmg;
    if (o.hp <= 0) {
      this.destroyed.push(o.id);
      this.events.push({ k: 'debris', x: o.x, z: o.z, kind: o.kind });
      if (o.kind === 'barrel') this.explode(o.x, o.z, 3.5, 90, null);
    }
  }

  inCover(u) {
    for (const o of this.obs) {
      if (o.hp <= 0 || o.kind !== 'sandbag') continue;
      if (Math.abs(u.x - o.x) < o.w / 2 + 1.3 && Math.abs(u.z - o.z) < o.d / 2 + 1.3) return true;
    }
    return false;
  }

  hurt(u, dmg, explosive, srcTeam) {
    if (!u.alive || u.invuln > 0) return;
    let d = dmg * u.takeMul;
    if (!explosive && KINDS[u.kind].armor) d *= KINDS[u.kind].armor;
    if (!explosive && !KINDS[u.kind].air && this.inCover(u)) d *= 0.6;
    u.hp -= d;
    this.events.push({ k: 'hit', x: u.x, z: u.z, id: u.id });
    if (u.hp <= 0) {
      u.hp = 0;
      u.alive = false;
      this.events.push({ k: 'death', x: u.x, z: u.z, id: u.id, kind: u.kind, team: u.team });
      if (u.kind === 'R' || u.kind === 'Q') this.events.push({ k: 'boom', x: u.x, z: u.z, r: 4 });
    }
    void srcTeam;
  }

  explode(x, z, r, dmg, team, hitsAir = false) {
    this.events.push({ k: 'boom', x, z, r });
    for (const u of this.units) {
      if (!u.alive || u.team === team) continue;
      if (KINDS[u.kind].air && !hitsAir) continue; // ground blasts can't reach helicopters
      const d = Math.hypot(u.x - x, u.z - z);
      if (d < r + u.r) this.hurt(u, dmg * (1 - 0.5 * Math.min(1, d / r)), true, team);
    }
    for (const o of this.obs) {
      if (o.hp <= 0) continue;
      if (Math.abs(x - o.x) < o.w / 2 + r * 0.7 && Math.abs(z - o.z) < o.d / 2 + r * 0.7) this.damageObs(o, dmg);
    }
  }

  fire(u, ang, w, extra = {}) {
    const sp = (this.R() - 0.5) * 2 * w.spread;
    const a = ang + sp;
    const air = KINDS[u.kind].air;
    const ox = u.x + Math.cos(a) * (u.r + 0.3), oz = u.z + Math.sin(a) * (u.r + 0.3);
    this.proj.push({
      x: ox, z: oz, vx: Math.cos(a) * w.spd, vz: Math.sin(a) * w.spd,
      dmg: w.dmg * u.dmgMul, team: u.team, life: w.range / w.spd, kind: w.kind, air,
      splash: extra.splash || 0, tx: extra.tx, tz: extra.tz,
    });
    this.events.push({ k: 'shot', x: ox, z: oz, a, w: w.kind, team: u.team, id: u.id });
  }

  useAbility(u, tx, tz) {
    const K = KINDS[u.kind];
    if (!K.ab || u.abCd > 0) return;
    u.abCd = K.ab.cd;
    const ang = u.aim;
    switch (K.ab.id) {
      case 'grenade': {
        let d = Math.hypot(tx - u.x, tz - u.z);
        d = Math.max(3, Math.min(11, d));
        this.proj.push({ x: u.x, z: u.z, vx: Math.cos(ang) * d / 0.9, vz: Math.sin(ang) * d / 0.9, dmg: 90 * u.dmgMul, team: u.team,
          life: 0.9, kind: 'g', air: true, splash: 3.4 });
        this.events.push({ k: 'throw', x: u.x, z: u.z, id: u.id });
        break;
      }
      case 'dash': {
        u.dashT = 0.22;
        const mv = Math.hypot(u.lastMx || 0, u.lastMz || 0) > 0.2 ? Math.atan2(u.lastMz, u.lastMx) : ang;
        u.dashX = Math.cos(mv) * 30; u.dashZ = Math.sin(mv) * 30;
        u.invuln = 0.3;
        this.events.push({ k: 'dash', x: u.x, z: u.z, id: u.id });
        break;
      }
      case 'arty': {
        let d = Math.hypot(tx - u.x, tz - u.z);
        d = Math.max(4, Math.min(22, d));
        const px = u.x + Math.cos(ang) * d, pz = u.z + Math.sin(ang) * d;
        this.pending = this.pending || [];
        for (let i = 0; i < 4; i++) {
          this.pending.push({ t: 1.4 + i * 0.35, x: px + (this.R() - 0.5) * 4, z: pz + (this.R() - 0.5) * 4, r: 3.2, dmg: 70 * u.dmgMul, team: u.team });
        }
        this.events.push({ k: 'mark', x: px, z: pz, team: u.team });
        break;
      }
      case 'cannon': {
        let d = Math.hypot(tx - u.x, tz - u.z);
        this.fire(u, ang, { dmg: 110, spd: 32, spread: 0.01, range: Math.min(30, Math.max(6, d + 2)), kind: 'c' }, { splash: 3.2 });
        this.events.push({ k: 'cannon', x: u.x, z: u.z, id: u.id });
        break;
      }
      case 'rockets': {
        for (let i = 0; i < 4; i++) {
          this.fire(u, ang + (i - 1.5) * 0.08, { dmg: 55, spd: 26, spread: 0.03, range: 24, kind: 'r' }, { splash: 2.6 });
        }
        break;
      }
      case 'guards': {
        for (let i = 0; i < 2; i++) {
          const g = this.addUnit('A', u.team, u.x - Math.cos(ang) * 1.5, u.z + (i ? 1.6 : -1.6), 150, 150, false);
          g.aiErr = this.units[0].aiErr;
        }
        this.events.push({ k: 'guards', x: u.x, z: u.z });
        break;
      }
    }
  }

  aiInput(u, dt) {
    const en = this.enemiesOf(u);
    const inp = { mx: 0, mz: 0, ax: Math.cos(u.aim), az: Math.sin(u.aim), fire: false, ab: false, tx: u.x, tz: u.z };
    if (!en.length) return inp;
    // target: prefer main unit if visible, else nearest
    let best = null, bd = 1e9;
    for (const v of en) {
      const d = Math.hypot(v.x - u.x, v.z - u.z) * (v.isMain ? 0.8 : 1);
      if (d < bd) { bd = d; best = v; }
    }
    const t = best;
    const dx = t.x - u.x, dz = t.z - u.z;
    const dist = Math.hypot(dx, dz);
    const air = KINDS[u.kind].air || KINDS[t.kind].air;
    const vis = this.los(u.x, u.z, t.x, t.z, air);
    const K = KINDS[u.kind];
    const ai = u.ai;
    ai.strafeT -= dt;
    if (ai.strafeT <= 0) { ai.strafe = this.R() < 0.5 ? -1 : 1; ai.strafeT = 1 + this.R() * 2; }
    let want;
    const toT = Math.atan2(dz, dx);
    if (!vis) want = toT + ai.strafe * 0.5;
    else if (dist > K.pref + 2) want = toT + ai.strafe * 0.35;
    else if (dist < K.pref - 3) want = toT + Math.PI + ai.strafe * 0.4;
    else want = toT + ai.strafe * Math.PI / 2;
    // obstacle avoidance by sampling
    let bestA = want, bestS = -1e9;
    for (let i = 0; i < 12; i++) {
      const a = want + ((i % 2 ? 1 : -1) * Math.ceil(i / 2) * Math.PI) / 6;
      const px = u.x + Math.cos(a) * 1.8, pz = u.z + Math.sin(a) * 1.8;
      let sc = Math.cos(a - want);
      if (this.blocked(px, pz, u.r, u)) sc -= 3;
      if (sc > bestS) { bestS = sc; bestA = a; }
    }
    inp.mx = Math.cos(bestA); inp.mz = Math.sin(bestA);
    // lead target slightly
    const lead = dist / K.w.spd;
    const lx = t.x + (t.vx || 0) * lead, lz = t.z + (t.vz || 0) * lead;
    ai.err = ai.err === undefined ? 0 : ai.err;
    ai.think -= dt;
    if (ai.think <= 0) { ai.think = 0.3; ai.err = (this.R() - 0.5) * 2 * u.aiErr; }
    const aimA = Math.atan2(lz - u.z, lx - u.x) + ai.err;
    inp.ax = Math.cos(aimA); inp.az = Math.sin(aimA);
    inp.fire = vis && dist < K.w.range * 0.95;
    inp.tx = t.x; inp.tz = t.z;
    if (K.ab && u.abCd <= 0) {
      const id = K.ab.id;
      if (id === 'grenade' && dist > 4 && dist < 11 && this.R() < dt * 0.8) inp.ab = true;
      if (id === 'dash' && dist < 9 && this.R() < dt * 0.6) inp.ab = true;
      if (id === 'arty' && dist > 6 && this.R() < dt * 0.5) inp.ab = true;
      if (id === 'cannon' && vis && dist < 22) inp.ab = true;
      if (id === 'rockets' && vis && dist < 18) inp.ab = true;
      if (id === 'guards' && dist < 14) inp.ab = true;
    }
    return inp;
  }

  step(dt, inputs) {
    if (this.over) {
      this.endDelay -= dt;
      for (const p of this.proj) { p.x += p.vx * dt; p.z += p.vz * dt; p.life -= dt; }
      this.proj = this.proj.filter((p) => p.life > 0);
      return;
    }
    this.time -= dt;
    // pending artillery
    if (this.pending) {
      for (const p of this.pending) {
        p.t -= dt;
        if (p.t <= 0) this.explode(p.x, p.z, p.r, p.dmg, p.team);
      }
      this.pending = this.pending.filter((p) => p.t > 0);
    }
    for (const u of this.units) {
      if (!u.alive) continue;
      const K = KINDS[u.kind];
      let inp;
      if (u.isMain) {
        const ctrl = this.opts.ctrl[u.team];
        inp = ctrl === 'ai' ? this.aiInput(u, dt) : inputs[u.team];
      } else inp = this.aiInput(u, dt);
      if (!inp) inp = { mx: 0, mz: 0, ax: Math.cos(u.aim), az: Math.sin(u.aim), fire: false };
      u.cd -= dt; u.abCd -= dt; u.invuln -= dt;
      let mx = inp.mx || 0, mz = inp.mz || 0;
      const ml = Math.hypot(mx, mz);
      if (ml > 1) { mx /= ml; mz /= ml; }
      u.lastMx = mx; u.lastMz = mz;
      const ox = u.x, oz = u.z;
      if (u.dashT > 0) {
        u.dashT -= dt;
        this.moveUnit(u, u.dashX * dt, u.dashZ * dt);
      } else {
        this.moveUnit(u, mx * K.speed * dt, mz * K.speed * dt);
      }
      u.vx = (u.x - ox) / dt; u.vz = (u.z - oz) / dt;
      u.moving = ml > 0.1;
      if (ml > 0.1) {
        const target = Math.atan2(mz, mx);
        let d = target - u.body;
        while (d > Math.PI) d -= Math.PI * 2;
        while (d < -Math.PI) d += Math.PI * 2;
        const rate = u.kind === 'R' ? 2.5 : 12;
        u.body += Math.max(-rate * dt, Math.min(rate * dt, d));
      }
      const al = Math.hypot(inp.ax || 0, inp.az || 0);
      if (al > 0.05) {
        const target = Math.atan2(inp.az, inp.ax);
        if (u.kind === 'R') {
          let d = target - u.aim;
          while (d > Math.PI) d -= Math.PI * 2;
          while (d < -Math.PI) d += Math.PI * 2;
          u.aim += Math.max(-4 * dt, Math.min(4 * dt, d));
        } else u.aim = target;
      }
      if (inp.fire && u.cd <= 0) {
        u.cd = K.w.rate;
        this.fire(u, u.aim, K.w);
      }
      if (inp.ab) {
        let tx = inp.tx, tz = inp.tz;
        if (tx === undefined || tz === undefined) {
          // smart targeting: nearest enemy roughly in aim direction
          tx = u.x + Math.cos(u.aim) * 10; tz = u.z + Math.sin(u.aim) * 10;
          let bd = 1e9;
          for (const v of this.enemiesOf(u)) {
            const a = Math.atan2(v.z - u.z, v.x - u.x);
            let da = Math.abs(a - u.aim) % (Math.PI * 2);
            if (da > Math.PI) da = Math.PI * 2 - da;
            const d = Math.hypot(v.x - u.x, v.z - u.z);
            if (da < 0.6 && d < bd) { bd = d; tx = v.x; tz = v.z; }
          }
        }
        this.useAbility(u, tx, tz);
      }
    }
    // projectiles
    const sub = 3;
    for (const p of this.proj) {
      for (let k = 0; k < sub && p.life > 0; k++) {
        const h = dt / sub;
        const nx = p.x + p.vx * h, nz = p.z + p.vz * h;
        p.life -= h;
        if (p.kind === 'g') { p.x = nx; p.z = nz; if (p.life <= 0) this.explode(p.x, p.z, p.splash, p.dmg, p.team); continue; }
        // obstacles
        let hitObs = null;
        if (!p.air) {
          for (const o of this.obs) {
            if (o.hp <= 0 || o.kind === 'sandbag') continue;
            if (segAabb(p.x, p.z, nx, nz, o)) { hitObs = o; break; }
          }
        }
        if (Math.abs(nx) > HW + 2 || Math.abs(nz) > HD + 2) { p.life = 0; break; }
        // units
        let hitU = null;
        for (const u of this.units) {
          if (!u.alive || u.team === p.team) continue;
          if (KINDS[u.kind].air && (p.kind === 'c' || p.kind === 'g')) continue;
          const d = Math.hypot(u.x - nx, u.z - nz);
          if (d < u.r + 0.15) { hitU = u; break; }
        }
        if (hitU) {
          if (p.splash) this.explode(nx, nz, p.splash, p.dmg, p.team, p.kind === 'r');
          else this.hurt(hitU, p.dmg, false, p.team);
          p.life = 0;
          break;
        }
        if (hitObs) {
          if (p.splash) this.explode(nx, nz, p.splash, p.dmg, p.team);
          else { this.damageObs(hitObs, p.dmg); this.events.push({ k: 'spark', x: nx, z: nz }); }
          p.life = 0;
          break;
        }
        p.x = nx; p.z = nz;
        if (p.life <= 0 && p.splash) this.explode(p.x, p.z, p.splash, p.dmg, p.team);
      }
    }
    this.proj = this.proj.filter((p) => p.life > 0);
    // end conditions
    const A = this.main.att, D = this.main.def;
    if (!A.alive || !D.alive || this.time <= 0) {
      this.over = true;
      if (!D.alive && A.alive) this.result = { winner: 'att', attHp: A.hp / HP_MUL, defHp: 0 };
      else if (!A.alive && D.alive) this.result = { winner: 'def', attHp: 0, defHp: D.hp / HP_MUL };
      else if (!A.alive && !D.alive) this.result = { winner: 'def', attHp: 0, defHp: 1 };
      else this.result = { winner: 'timeout', attHp: A.hp / HP_MUL, defHp: D.hp / HP_MUL };
      this.events.push({ k: 'over', w: this.result.winner });
    }
  }

  get done() { return this.over && this.endDelay <= 0; }

  snapshot() {
    const ev = this.events;
    this.events = [];
    const od = this.destroyed;
    this.destroyed = [];
    return {
      t: Math.max(0, this.time),
      u: this.units.map((u) => [u.id, u.kind, u.team, +u.x.toFixed(2), +u.z.toFixed(2), +u.aim.toFixed(2), Math.ceil(u.hp), u.maxHp,
        u.alive ? 1 : 0, +u.body.toFixed(2), u.moving ? 1 : 0, Math.max(0, +u.abCd.toFixed(1)), u.isMain ? 1 : 0]),
      p: this.proj.map((p) => [+p.x.toFixed(2), +p.z.toFixed(2), p.kind, +Math.atan2(p.vz, p.vx).toFixed(2)]),
      ev, od,
      over: this.over ? this.result : null,
    };
  }
}
