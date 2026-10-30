// Real-time top-down duel simulation (host authoritative, no rendering here).
import { rng } from './rng.js';

export const ARENA = { w: 40, d: 24 };
const HW = ARENA.w / 2, HD = ARENA.d / 2;
export const DUEL_TIME = 75;

// duel HP = board HP x multiplier (keeps fights 10-25 s long)
const HP_MUL = { P: 1.4, N: 1.8, B: 1.5, R: 2.2, Q: 2.0, K: 2.0, M: 1.5, E: 1.6, A: 2.0, L: 2.0, T: 2.0, D: 2.0, C: 1.8 };

export const WEAPONS = {
  pistol: { dmg: 14, rate: 0.32, spd: 36, spread: 0.05, range: 20, mag: 12, reload: 1.1, kind: 'b' },
  rifle: { dmg: 7, rate: 0.13, spd: 40, spread: 0.06, range: 24, mag: 30, reload: 1.8, kind: 'b' },
  smg: { dmg: 6, rate: 0.075, spd: 40, spread: 0.08, range: 18, mag: 35, reload: 1.5, kind: 'b' },
  shotgun: { dmg: 6, rate: 0.75, spd: 34, spread: 0.26, range: 11, mag: 6, reload: 2.2, kind: 'b', pellets: 7 },
  sniper: { dmg: 70, rate: 1.2, spd: 90, spread: 0.004, range: 45, mag: 5, reload: 2.4, kind: 's', crit: 0.25 },
  mg: { dmg: 6, rate: 0.09, spd: 38, spread: 0.08, range: 22, mag: 80, reload: 3.0, kind: 'b' },
  minigun: { dmg: 5, rate: 0.055, spd: 44, spread: 0.09, range: 20, mag: 150, reload: 3.5, kind: 'b' },
  flame: { dmg: 4, rate: 0.05, spd: 14, spread: 0.22, range: 6.5, mag: 60, reload: 2.5, kind: 'f' },
  flak: { dmg: 9, rate: 0.15, spd: 50, spread: 0.05, range: 26, mag: 40, reload: 2.6, kind: 'b', airMul: 2.5 },
};

// body stats per duel kind
export const BODIES = {
  P: { r: 0.55, speed: 5.0, pref: 9 },
  N: { r: 0.55, speed: 7.0, pref: 6, armor: 0.85 }, // spec-ops: body armour, fastest infantry
  B: { r: 0.55, speed: 4.6, pref: 16 },
  R: { r: 1.45, speed: 3.8, pref: 10, armor: 0.55, vehicle: true },
  Q: { r: 1.3, speed: 7.0, pref: 7, air: true, vehicle: true },
  K: { r: 0.55, speed: 4.8, pref: 8 },
  M: { r: 0.55, speed: 5.2, pref: 8 },
  E: { r: 0.55, speed: 4.9, pref: 8 },
  A: { r: 1.4, speed: 3.6, pref: 12, armor: 0.6, vehicle: true },
  L: { r: 1.4, speed: 4.2, pref: 12, armor: 0.7, vehicle: true },
  T: { r: 1.7, speed: 4.5, pref: 12, armor: 0.5, vehicle: true, rail: true },
  D: { r: 0.6, speed: 4.6, pref: 8 },
  S: { r: 0.5, speed: 4.6, pref: 10 },
  U: { r: 0.7, speed: 0, pref: 14 }, // deployed turret
  C: { r: 0.55, speed: 5.0, pref: 9 },
};

export const SPECIALS = {
  d_grenade: { cd: 5, name: 'Граната' },
  d_dash: { cd: 2.0, name: 'Рывок' },
  d_artycall: { cd: 9, name: 'Артналёт' },
  d_cannon: { cd: 2.2, name: 'Пушка' },
  d_rocketpods: { cd: 5.5, name: 'НУРСы' },
  d_guards: { cd: 999, name: 'Охрана' },
  d_medkit: { cd: 12, name: 'Аптечка' },
  d_smokenade: { cd: 8, name: 'Дым' },
  d_turret: { cd: 14, name: 'Турель' },
  d_mine: { cd: 6, name: 'Мина' },
  d_shield: { cd: 9, name: 'Щит' },
  d_flame: { cd: 6, name: 'Огнемёт' },
  d_sprint: { cd: 7, name: 'Спринт' },
  d_c4: { cd: 8, name: 'C4' },
};

export const THEMES = ['field', 'desert', 'winter', 'ruins'];

export function genArena(seed, opts = {}) {
  const R = rng(seed);
  const theme = opts.urban ? 'city' : THEMES[Math.floor(R() * THEMES.length)];
  const obs = [];
  let id = 0;
  const free = (x, z, w, d) => {
    if (Math.abs(x) > HW - 2 - w / 2 || Math.abs(z) > HD - 1.5 - d / 2) return false;
    if (Math.abs(x) > HW - 9 && Math.abs(z) < 5) return false; // spawn zones
    if (opts.train && Math.abs(z) < 2 + d / 2) return false; // keep the rail line clear
    for (const o of obs) if (Math.abs(o.x - x) < (o.w + w) / 2 + 1.6 && Math.abs(o.z - z) < (o.d + d) / 2 + 1.6) return false;
    return true;
  };
  const place = (kind, w, d, hp, tries = 40) => {
    for (let t = 0; t < tries; t++) {
      const x = (R() * 2 - 1) * (HW - 3), z = (R() * 2 - 1) * (HD - 2);
      if (free(x, z, w, d)) { obs.push({ id: id++, kind, x, z, w, d, hp, maxHp: hp, rot: R() }); return true; }
    }
    return false;
  };
  if (opts.urban) {
    for (let i = 0; i < 7; i++) place('house', 4.5 + R() * 2.5, 3.5 + R() * 1.5, 260);
    for (let i = 0; i < 4; i++) place('car', 2.4, 1.3, 60);
    for (let i = 0; i < 5; i++) place('crate', 1.8, 1.8, 60);
    for (let i = 0; i < 4; i++) { const v = R() < 0.5; place('sandbag', v ? 0.9 : 3, v ? 3 : 0.9, 1e9); }
    for (let i = 0; i < 2; i++) place('barrel', 1, 1, 20);
  } else {
    if (!opts.train) {
      if (R() < 0.6) {
        obs.push({ id: id++, kind: 'wall', x: 0, z: -3.5, w: 1, d: 5, hp: 1e9, maxHp: 1e9 });
        obs.push({ id: id++, kind: 'wall', x: 0, z: 4.5, w: 1, d: 4, hp: 1e9, maxHp: 1e9 });
      } else obs.push({ id: id++, kind: 'wall', x: 0, z: 0, w: 4, d: 4, hp: 1e9, maxHp: 1e9 });
    }
    for (let i = 0; i < 4; i++) { const v = R() < 0.5; place('wall', v ? 1 : 3 + R() * 3, v ? 3 + R() * 3 : 1, 1e9); }
    if (R() < 0.6) place('house', 5, 4, 260);
    for (let i = 0; i < 9; i++) place('crate', 1.8, 1.8, 60);
    for (let i = 0; i < 7; i++) { const v = R() < 0.5; place('sandbag', v ? 0.9 : 3, v ? 3 : 0.9, 1e9); }
    for (let i = 0; i < 3; i++) place('barrel', 1, 1, 20);
  }
  const deco = [];
  for (let i = 0; i < 26; i++) {
    const side = R() < 0.5 ? -1 : 1;
    deco.push({ x: (R() * 2 - 1) * (HW + 6), z: side * (HD + 1.5 + R() * 6), s: 0.7 + R() * 0.8 });
  }
  return { theme, obs, deco };
}

function segAabb(x1, z1, x2, z2, o, pad = 0) {
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

function segCircle(x1, z1, x2, z2, cx, cz, r) {
  const dx = x2 - x1, dz = z2 - z1;
  const l2 = dx * dx + dz * dz || 1;
  let t = ((cx - x1) * dx + (cz - z1) * dz) / l2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(x1 + dx * t - cx, z1 + dz * t - cz) < r;
}

const BLOCKS_LOS = new Set(['wall', 'crate', 'house', 'car', 'barrel']);
const VEH_PASS = new Set(['crate', 'sandbag', 'barrel', 'car']);

export function rtHasTrain(rt) {
  return [rt.att, rt.def].some((f) => f.t === 'T' || (f.sup || []).some((x) => x.t === 'T'));
}

// coarse navigation grid used by bots to path around walls and houses
const CELL = 1;
const GW = Math.ceil(ARENA.w / CELL), GH = Math.ceil(ARENA.d / CELL);
const cellOf = (x, z) => [Math.max(0, Math.min(GW - 1, Math.floor((x + HW) / CELL))), Math.max(0, Math.min(GH - 1, Math.floor((z + HD) / CELL)))];
const cellCenter = (cx, cz) => [(cx + 0.5) * CELL - HW, (cz + 0.5) * CELL - HD];

export class DuelSim {
  constructor(rt, opts) {
    this.rt = rt;
    this.opts = opts; // { ctrl: {att, def}, difficulty: 0..2 }
    this.R = rng(rt.seed ^ 0x9e3779b9);
    const a = genArena(rt.seed, { urban: rt.urban, train: rtHasTrain(rt) });
    this.theme = a.theme;
    this.obs = a.obs;
    this.time = DUEL_TIME;
    this.units = [];
    this.proj = [];
    this.objs = []; // mines, c4, smoke clouds
    this.events = [];
    this.destroyed = [];
    this.uid = 1;
    this.oid = 1;
    this.over = false;
    this.result = null;
    this.endDelay = 1.8;
    const d = opts.difficulty ?? 1;
    this.ai = {
      err: [0.32, 0.2, 0.11][d] * (rt.night ? 1.4 : 1),
      react: [0.7, 0.45, 0.25][d],
      burst: [0.8, 1.0, 1.4][d],
      pause: [0.9, 0.6, 0.35][d],
      speed: [0.8, 0.9, 1.0][d],
      lead: d > 0,
    };
    this.nav = { dirty: true, grids: {}, fields: new Map() };
    const att = this.addMain(rt.att, 'att', -HW + 4, 0, true);
    const def = this.addMain(rt.def, 'def', HW - 4, 0, true);
    def.aim = Math.PI; def.body = Math.PI;
    if (rt.def.dug) def.takeMul *= 0.65;
    if (rt.def.smoke || rt.def.bld) def.takeMul *= 0.8;
    this.main = { att, def };
    // pieces protecting / attacking the square join the fight with their own weapons
    const slots = [[-3, -6], [-5, 6], [-2, -10], [-6, 10]];
    for (const team of ['att', 'def']) {
      (rt[team].sup || []).forEach((f, idx) => {
        const [dx, dz] = slots[idx % slots.length];
        const x = team === 'att' ? -HW + 4 + dx * -1 - 2 : HW - 4 + dx;
        const z = f.t === 'T' ? 0 : dz;
        const u = this.addMain(f, team, f.t === 'T' ? (team === 'att' ? -HW + 9 + idx : HW - 9 - idx) : x, z, false);
        u.supIdx = idx;
        u.aim = u.body = team === 'att' ? 0 : Math.PI;
      });
    }
    for (const u of this.units) this.placeFree(u);
  }

  placeFree(u) {
    if (!this.blocked(u.x, u.z, u.r, u)) return;
    for (let rad = 1; rad < 14; rad += 0.7) {
      for (let k = 0; k < 16; k++) {
        const a = (k / 16) * Math.PI * 2;
        const x = u.x + Math.cos(a) * rad, z = u.rail ? u.z : u.z + Math.sin(a) * rad;
        if (!this.blocked(x, z, u.r, u)) { u.x = x; u.z = z; u.railZ = z; return; }
      }
    }
  }

  addMain(f, team, x, z, isMain = true) {
    const mul = HP_MUL[f.t] || 1.6;
    const u = this.addUnit(f.t, team, x, z, f.hp * mul, f.maxHp * mul, isMain, f.weapon || 'rifle', f.duel);
    u.hpMul = mul;
    u.cid = f.cid || '';
    if (f.t === 'C') {
      u.air = !!f.air; u.vehicle = !!f.vehicle;
      u.r = f.vehicle ? 1.35 : 0.55;
      u.speed = f.air ? 6.5 : f.vehicle ? 4.0 : 5.0;
      if (f.vehicle) u.armor = 0.7;
      if (f.armor) u.armor = (u.armor || 1) * 0.8;
    }
    u.dmgMul = (f.supplied ? 1 : 0.75) * (1 + 0.08 * (f.rank || 0)) * (f.buff ? 1.25 : 1) * (f.penal ? 2 : 1) * (f.counter ? 1.3 : 1);
    if (f.penal) u.takeMul *= 1.3;
    if (f.marked) u.takeMul *= 1.3;
    if (f.shield) u.takeMul *= 0.7;
    if (f.armor && f.t !== 'C' && !u.armor) u.armor = 0.8;
    return u;
  }

  addUnit(kind, team, x, z, hp, maxHp, isMain, weapon = 'rifle', special = null) {
    const B = BODIES[kind] || BODIES.C;
    const W = WEAPONS[weapon] || WEAPONS.rifle;
    const u = {
      id: this.uid++, kind, team, x, z, hp, maxHp, isMain, weapon, special,
      r: B.r, speed: B.speed, air: !!B.air, vehicle: !!B.vehicle, armor: B.armor || 0, rail: !!B.rail, pref: B.pref,
      aim: team === 'att' ? 0 : Math.PI, body: team === 'att' ? 0 : Math.PI,
      cd: 0, abCd: 1.5, alive: true, dmgMul: 1, takeMul: 1, invuln: 0,
      ammo: W.mag, reloadT: 0, dashT: 0, dashX: 0, dashZ: 0, shieldT: 0, sprintT: 0, flameT: 0, burnT: 0, guardsUsed: false,
      railZ: z,
      ai: { strafe: 1, strafeT: 0, think: 0, err: 0, seeT: 0, burstT: 0, pauseT: 0 },
      moving: false,
    };
    if (kind === 'S') u.dmgMul = 0.8;
    this.units.push(u);
    return u;
  }

  enemiesOf(u) { return this.units.filter((v) => v.alive && v.team !== u.team); }

  smokeBlocks(x1, z1, x2, z2) {
    for (const o of this.objs) if (o.type === 'smoke' && segCircle(x1, z1, x2, z2, o.x, o.z, o.r)) return true;
    return false;
  }

  los(x1, z1, x2, z2, air) {
    if (this.smokeBlocks(x1, z1, x2, z2)) return false;
    if (air) return true;
    for (const o of this.obs) {
      if (o.hp <= 0 || !BLOCKS_LOS.has(o.kind)) continue;
      if (segAabb(x1, z1, x2, z2, o)) return false;
    }
    return true;
  }

  blocked(x, z, r, u) {
    if (Math.abs(x) > HW - r || Math.abs(z) > HD - r) return true;
    if (u && u.air) return false;
    for (const o of this.obs) {
      if (o.hp <= 0) continue;
      if (u && u.vehicle && (o.kind === 'crate' || o.kind === 'sandbag' || o.kind === 'barrel' || o.kind === 'car')) continue;
      if (Math.abs(x - o.x) < o.w / 2 + r && Math.abs(z - o.z) < o.d / 2 + r) return true;
    }
    return false;
  }

  moveUnit(u, dx, dz) {
    if (u.rail) dz = (u.railZ - u.z) * 0.2;
    if (!this.blocked(u.x + dx, u.z, u.r, u)) u.x += dx;
    if (!this.blocked(u.x, u.z + dz, u.r, u)) u.z += dz;
    if (u.vehicle && !u.air) {
      for (const o of this.obs) {
        if (o.hp <= 0 || o.kind === 'wall' || o.kind === 'house') continue;
        if (Math.abs(u.x - o.x) < o.w / 2 + u.r && Math.abs(u.z - o.z) < o.d / 2 + u.r) this.damageObs(o, 1e9);
      }
    }
    for (const v of this.units) {
      if (v === u || !v.alive || v.air !== u.air) continue;
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
      this.nav.dirty = true;
      this.destroyed.push(o.id);
      this.events.push({ k: o.kind === 'house' ? 'collapse' : 'debris', x: o.x, z: o.z, kind: o.kind, id: o.id });
      if (o.kind === 'barrel' || o.kind === 'car') this.explode(o.x, o.z, 3.5, 60, null);
    } else if (o.kind === 'house') this.events.push({ k: 'chip', x: o.x, z: o.z, id: o.id, f: o.hp / o.maxHp });
  }

  inCover(u) {
    for (const o of this.obs) {
      if (o.hp <= 0 || o.kind !== 'sandbag') continue;
      if (Math.abs(u.x - o.x) < o.w / 2 + 1.3 && Math.abs(u.z - o.z) < o.d / 2 + 1.3) return true;
    }
    for (const o of this.objs) if (o.type === 'smoke' && Math.hypot(u.x - o.x, u.z - o.z) < o.r) return true;
    return false;
  }

  hurt(u, dmg, explosive, src, angle) {
    if (!u.alive || u.invuln > 0) return;
    let d = dmg * u.takeMul;
    if (!explosive && u.armor) d *= u.armor;
    if (!explosive && !u.air && this.inCover(u)) d *= 0.6;
    if (u.shieldT > 0 && angle !== undefined) {
      let da = Math.abs(((angle + Math.PI - u.aim) % (Math.PI * 2) + Math.PI * 3) % (Math.PI * 2) - Math.PI);
      if (da < 1.2) d *= 0.1;
    }
    // headshots only land on soldiers: vehicles, aircraft and turrets have no head
    const crit = !!(src && src.crit) && !u.vehicle && !u.air && u.kind !== 'U';
    if (crit) d *= src.critMul;
    u.hp -= d;
    this.events.push({ k: crit ? 'crit' : 'hit', x: u.x, z: u.z, id: u.id, v: Math.round(d), veh: u.vehicle || u.kind === 'U' });
    if (u.hp <= 0) {
      u.hp = 0;
      u.alive = false;
      this.events.push({ k: 'death', x: u.x, z: u.z, id: u.id, kind: u.kind, team: u.team });
      if (u.vehicle || u.kind === 'U') this.events.push({ k: 'boom', x: u.x, z: u.z, r: 4 });
    }
  }

  explode(x, z, r, dmg, team, hitsAir = false) {
    this.events.push({ k: 'boom', x, z, r });
    for (const u of this.units) {
      if (!u.alive || u.team === team) continue;
      if (u.air && !hitsAir) continue;
      const d = Math.hypot(u.x - x, u.z - z);
      if (d < r + u.r) this.hurt(u, dmg * (1 - 0.5 * Math.min(1, d / r)), true);
    }
    for (const o of this.obs) {
      if (o.hp <= 0) continue;
      if (Math.abs(x - o.x) < o.w / 2 + r * 0.7 && Math.abs(z - o.z) < o.d / 2 + r * 0.7) this.damageObs(o, dmg);
    }
  }

  fire(u, ang, w, extra = {}) {
    const n = w.pellets || 1;
    for (let k = 0; k < n; k++) {
      const a = ang + (this.R() - 0.5) * 2 * w.spread;
      const ox = u.x + Math.cos(a) * (u.r + 0.3), oz = u.z + Math.sin(a) * (u.r + 0.3);
      const critC = w.crit || 0.06;
      const crit = !extra.splash && w.kind !== 'f' && this.R() < critC;
      this.proj.push({
        x: ox, z: oz, vx: Math.cos(a) * w.spd, vz: Math.sin(a) * w.spd,
        dmg: w.dmg * u.dmgMul, team: u.team, life: w.range / w.spd, kind: w.kind, air: u.air,
        splash: extra.splash || 0, hitsAir: !!extra.hitsAir, airMul: w.airMul || 1,
        crit, critMul: w.kind === 's' ? 2 : 1.5,
      });
    }
    if (w.kind !== 'f' || this.R() < 0.3) this.events.push({ k: 'shot', x: u.x + Math.cos(ang) * (u.r + 0.3), z: u.z + Math.sin(ang) * (u.r + 0.3), a: ang, w: w.kind, team: u.team, id: u.id });
  }

  useSpecial(u, tx, tz) {
    const id = u.special;
    const S = SPECIALS[id];
    if (!S || u.abCd > 0) return;
    if (id === 'd_guards' && u.guardsUsed) return;
    u.abCd = S.cd;
    const ang = u.aim;
    const dist = (lo, hi) => Math.max(lo, Math.min(hi, Math.hypot(tx - u.x, tz - u.z)));
    switch (id) {
      case 'd_grenade': {
        const d = dist(3, 11);
        this.proj.push({ x: u.x, z: u.z, vx: Math.cos(ang) * d / 0.9, vz: Math.sin(ang) * d / 0.9, dmg: 60 * u.dmgMul, team: u.team, life: 0.9, kind: 'g', air: true, splash: 3.4 });
        this.events.push({ k: 'throw', x: u.x, z: u.z, id: u.id });
        break;
      }
      case 'd_dash': {
        u.dashT = 0.22;
        const mv = Math.hypot(u.lastMx || 0, u.lastMz || 0) > 0.2 ? Math.atan2(u.lastMz, u.lastMx) : ang;
        u.dashX = Math.cos(mv) * 30; u.dashZ = Math.sin(mv) * 30;
        u.invuln = 0.3;
        this.events.push({ k: 'dash', x: u.x, z: u.z, id: u.id });
        break;
      }
      case 'd_artycall': {
        const d = dist(4, 22);
        const px = u.x + Math.cos(ang) * d, pz = u.z + Math.sin(ang) * d;
        this.pending = this.pending || [];
        for (let i = 0; i < 4; i++) this.pending.push({ t: 1.4 + i * 0.35, x: px + (this.R() - 0.5) * 4, z: pz + (this.R() - 0.5) * 4, r: 3.2, dmg: 45 * u.dmgMul, team: u.team });
        this.events.push({ k: 'mark', x: px, z: pz, team: u.team });
        break;
      }
      case 'd_cannon':
        this.fire(u, ang, { dmg: 85, spd: 32, spread: 0.01, range: Math.min(30, Math.max(6, Math.hypot(tx - u.x, tz - u.z) + 2)), kind: 'c' }, { splash: 3.0 });
        this.events.push({ k: 'cannon', x: u.x, z: u.z, id: u.id });
        break;
      case 'd_rocketpods':
        for (let i = 0; i < 4; i++) this.fire(u, ang + (i - 1.5) * 0.08, { dmg: 40, spd: 26, spread: 0.03, range: 24, kind: 'r' }, { splash: 2.4, hitsAir: true });
        break;
      case 'd_guards':
        u.guardsUsed = true;
        for (let i = 0; i < 2; i++) this.addUnit('S', u.team, u.x - Math.cos(ang) * 1.5, u.z + (i ? 1.6 : -1.6), 90, 90, false, 'rifle');
        this.events.push({ k: 'guards', x: u.x, z: u.z });
        break;
      case 'd_medkit': {
        const h = u.maxHp * 0.35;
        u.hp = Math.min(u.maxHp, u.hp + h);
        this.events.push({ k: 'heal', x: u.x, z: u.z, id: u.id, v: Math.round(h) });
        break;
      }
      case 'd_smokenade': {
        const d = dist(2, 10);
        this.objs.push({ id: this.oid++, type: 'smoke', x: u.x + Math.cos(ang) * d, z: u.z + Math.sin(ang) * d, r: 3.6, t: 7 });
        this.events.push({ k: 'smoke', x: u.x + Math.cos(ang) * d, z: u.z + Math.sin(ang) * d });
        break;
      }
      case 'd_turret': {
        const t = this.addUnit('U', u.team, u.x + Math.cos(ang) * 1.6, u.z + Math.sin(ang) * 1.6, 90, 90, false, 'mg');
        t.dmgMul = 0.6; t.aim = ang;
        this.events.push({ k: 'build', x: t.x, z: t.z });
        break;
      }
      case 'd_mine':
        this.objs.push({ id: this.oid++, type: 'mine', x: u.x, z: u.z, team: u.team, t: 60, arm: 1 });
        this.events.push({ k: 'drop', x: u.x, z: u.z });
        break;
      case 'd_shield':
        u.shieldT = 3;
        this.events.push({ k: 'shield', x: u.x, z: u.z, id: u.id });
        break;
      case 'd_flame':
        u.flameT = 2.5;
        this.events.push({ k: 'flameOn', x: u.x, z: u.z, id: u.id });
        break;
      case 'd_sprint':
        u.sprintT = 3;
        this.events.push({ k: 'dash', x: u.x, z: u.z, id: u.id });
        break;
      case 'd_c4': {
        const d = dist(1, 4);
        this.objs.push({ id: this.oid++, type: 'c4', x: u.x + Math.cos(ang) * d, z: u.z + Math.sin(ang) * d, team: u.team, t: 2, dmg: 110 * u.dmgMul });
        this.events.push({ k: 'drop', x: u.x, z: u.z });
        break;
      }
    }
  }

  navGrid(veh) {
    const key = veh ? 'veh' : 'inf';
    if (this.nav.dirty) { this.nav.grids = {}; this.nav.fields.clear(); this.nav.dirty = false; }
    if (this.nav.grids[key]) return this.nav.grids[key];
    const g = new Uint8Array(GW * GH);
    const r = veh ? 1.5 : 0.65;
    for (let cz = 0; cz < GH; cz++) for (let cx = 0; cx < GW; cx++) {
      const [x, z] = cellCenter(cx, cz);
      if (Math.abs(x) > HW - r || Math.abs(z) > HD - r) { g[cz * GW + cx] = 1; continue; }
      for (const o of this.obs) {
        if (o.hp <= 0 || (veh && VEH_PASS.has(o.kind))) continue;
        if (Math.abs(x - o.x) < o.w / 2 + r && Math.abs(z - o.z) < o.d / 2 + r) { g[cz * GW + cx] = 1; break; }
      }
    }
    this.nav.grids[key] = g;
    return g;
  }

  // BFS distance field toward a target cell (cached per target cell for a short time)
  navField(veh, tx, tz) {
    const [gx, gz] = cellOf(tx, tz);
    const key = (veh ? 'v' : 'i') + gx + ',' + gz;
    const c = this.nav.fields.get(key);
    if (c && this.time - c.t > -0.6 && c.t - this.time < 0.6) return c.d;
    const g = this.navGrid(veh);
    const d = new Int16Array(GW * GH).fill(-1);
    const q = [gz * GW + gx];
    d[q[0]] = 0;
    for (let h = 0; h < q.length; h++) {
      const i = q[h], cx = i % GW, cz = (i / GW) | 0;
      for (const [ox, oz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = cx + ox, nz = cz + oz;
        if (nx < 0 || nz < 0 || nx >= GW || nz >= GH) continue;
        const j = nz * GW + nx;
        if (d[j] >= 0 || g[j]) continue;
        d[j] = d[i] + 1;
        q.push(j);
      }
    }
    this.nav.fields.set(key, { d, t: this.time });
    if (this.nav.fields.size > 40) this.nav.fields.delete(this.nav.fields.keys().next().value);
    return d;
  }

  // direction (angle) to walk from u toward (tx, tz) following the distance field
  pathDir(u, tx, tz) {
    const d = this.navField(u.vehicle, tx, tz);
    const [cx, cz] = cellOf(u.x, u.z);
    let best = null, bv = d[cz * GW + cx] >= 0 ? d[cz * GW + cx] : 1e9;
    for (let oz = -1; oz <= 1; oz++) for (let ox = -1; ox <= 1; ox++) {
      if (!ox && !oz) continue;
      const nx = cx + ox, nz = cz + oz;
      if (nx < 0 || nz < 0 || nx >= GW || nz >= GH) continue;
      const v = d[nz * GW + nx];
      if (v < 0) continue;
      // diagonal steps only if both orthogonal neighbours are open (no corner cutting)
      if (ox && oz && (d[cz * GW + nx] < 0 || d[nz * GW + cx] < 0)) continue;
      if (v < bv) { bv = v; best = [nx, nz]; }
    }
    if (!best) return null;
    const [x, z] = cellCenter(best[0], best[1]);
    return Math.atan2(z - u.z, x - u.x);
  }

  aiInput(u, dt) {
    const en = this.enemiesOf(u);
    const inp = { mx: 0, mz: 0, ax: Math.cos(u.aim), az: Math.sin(u.aim), fire: false, ab: false };
    if (!en.length) return inp;
    let best = null, bd = 1e9;
    for (const v of en) {
      const d = Math.hypot(v.x - u.x, v.z - u.z) * (v.isMain ? 0.8 : 1);
      if (d < bd) { bd = d; best = v; }
    }
    const t = best;
    const dx = t.x - u.x, dz = t.z - u.z;
    const dist = Math.hypot(dx, dz);
    const air = u.air || t.air;
    const vis = this.los(u.x, u.z, t.x, t.z, air);
    const ai = u.ai, A = this.ai;
    ai.strafeT -= dt;
    if (ai.strafeT <= 0) { ai.strafe = this.R() < 0.5 ? -1 : 1; ai.strafeT = 1 + this.R() * 2; }
    if (u.speed > 0) {
      let want;
      const toT = Math.atan2(dz, dx);
      const path = !u.air && (!vis || dist > u.pref + 2) ? this.pathDir(u, t.x, t.z) : null;
      if (path !== null) want = path + (vis ? ai.strafe * 0.25 : 0);
      else if (!vis) want = toT + ai.strafe * 0.5;
      else if (dist > u.pref + 2) want = toT + ai.strafe * 0.35;
      else if (dist < u.pref - 3) want = toT + Math.PI + ai.strafe * 0.4;
      else want = toT + ai.strafe * Math.PI / 2;
      let bestA = want, bestS = -1e9;
      for (let i = 0; i < 12; i++) {
        const a = want + ((i % 2 ? 1 : -1) * Math.ceil(i / 2) * Math.PI) / 6;
        let sc = Math.cos(a - want);
        if (this.blocked(u.x + Math.cos(a) * 1.8, u.z + Math.sin(a) * 1.8, u.r, u)) sc -= 3;
        if (sc > bestS) { bestS = sc; bestA = a; }
      }
      // stuck detection: no progress for a second while trying to move -> wriggle out
      ai.chkT = (ai.chkT || 0) + dt;
      if (ai.chkT > 1.0) {
        const moved = Math.hypot(u.x - (ai.lx ?? u.x), u.z - (ai.lz ?? u.z));
        if (moved < 0.35 && !ai.unstuckT) { ai.unstuckT = 0.9; ai.unstuckA = bestA + Math.PI + (this.R() - 0.5) * 2; }
        ai.chkT = 0; ai.lx = u.x; ai.lz = u.z;
      }
      if (ai.unstuckT > 0) {
        ai.unstuckT = Math.max(0, ai.unstuckT - dt);
        let a2 = ai.unstuckA;
        for (let i = 0; i < 12 && this.blocked(u.x + Math.cos(a2) * 1.2, u.z + Math.sin(a2) * 1.2, u.r, u); i++) a2 += Math.PI / 6;
        bestA = a2;
        if (ai.unstuckT === 0) ai.unstuckT = 0;
      }
      inp.mx = Math.cos(bestA) * A.speed; inp.mz = Math.sin(bestA) * A.speed;
    }
    const lead = A.lead ? dist / (WEAPONS[u.weapon] || WEAPONS.rifle).spd : 0;
    const lx = t.x + (t.vx || 0) * lead, lz = t.z + (t.vz || 0) * lead;
    ai.think -= dt;
    if (ai.think <= 0) { ai.think = 0.3; ai.err = (this.R() - 0.5) * 2 * A.err; }
    const aimA = Math.atan2(lz - u.z, lx - u.x) + ai.err;
    inp.ax = Math.cos(aimA); inp.az = Math.sin(aimA);
    // reaction time + burst discipline
    ai.seeT = vis ? ai.seeT + dt : 0;
    if (ai.pauseT > 0) ai.pauseT -= dt;
    const W = WEAPONS[u.weapon] || WEAPONS.rifle;
    const canShoot = vis && ai.seeT > A.react && ai.pauseT <= 0 && dist < W.range * 0.95;
    if (canShoot) {
      ai.burstT += dt;
      if (ai.burstT > A.burst) { ai.burstT = 0; ai.pauseT = A.pause * (0.6 + this.R() * 0.8); }
      inp.fire = true;
    }
    inp.tx = t.x; inp.tz = t.z;
    if (u.special && u.abCd <= 0 && this.R() < dt * 0.9) {
      switch (u.special) {
        case 'd_grenade': inp.ab = dist > 4 && dist < 11; break;
        case 'd_dash': case 'd_sprint': inp.ab = dist < 9; break;
        case 'd_artycall': inp.ab = dist > 6; break;
        case 'd_cannon': case 'd_rocketpods': inp.ab = vis && dist < 20; break;
        case 'd_guards': case 'd_turret': inp.ab = dist < 15; break;
        case 'd_medkit': inp.ab = u.hp < u.maxHp * 0.5; break;
        case 'd_smokenade': case 'd_shield': inp.ab = vis && u.hp < u.maxHp * 0.7; break;
        case 'd_mine': case 'd_c4': inp.ab = dist < 5; break;
        case 'd_flame': inp.ab = dist < 6; break;
      }
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
    if (this.pending) {
      for (const p of this.pending) { p.t -= dt; if (p.t <= 0) this.explode(p.x, p.z, p.r, p.dmg, p.team); }
      this.pending = this.pending.filter((p) => p.t > 0);
    }
    // ground objects
    for (const o of this.objs) {
      o.t -= dt;
      if (o.type === 'mine') {
        o.arm -= dt;
        if (o.arm <= 0) for (const u of this.units) {
          if (u.alive && u.team !== o.team && !u.air && Math.hypot(u.x - o.x, u.z - o.z) < 1.3) { this.explode(o.x, o.z, 2.6, 70, o.team); o.t = 0; break; }
        }
      }
      if (o.type === 'c4' && o.t <= 0) this.explode(o.x, o.z, 3.6, o.dmg, o.team);
    }
    this.objs = this.objs.filter((o) => o.t > 0);
    for (const u of this.units) {
      if (!u.alive) continue;
      let inp;
      if (u.isMain) {
        const ctrl = this.opts.ctrl[u.team];
        inp = ctrl === 'ai' ? this.aiInput(u, dt) : inputs[u.team];
      } else inp = this.aiInput(u, dt);
      if (!inp) inp = { mx: 0, mz: 0, ax: 0, az: 0, fire: false };
      u.cd -= dt; u.abCd -= dt; u.invuln -= dt; u.shieldT -= dt; u.sprintT -= dt; u.flameT -= dt;
      if (u.burnT > 0) { u.burnT -= dt; this.hurt(u, 6 * dt, true); }
      let mx = inp.mx || 0, mz = inp.mz || 0;
      const ml = Math.hypot(mx, mz);
      if (ml > 1) { mx /= ml; mz /= ml; }
      u.lastMx = mx; u.lastMz = mz;
      const ox = u.x, oz = u.z;
      const spd = u.speed * (u.sprintT > 0 ? 1.8 : 1) * (u.shieldT > 0 ? 0.6 : 1);
      if (u.dashT > 0) { u.dashT -= dt; this.moveUnit(u, u.dashX * dt, u.dashZ * dt); }
      else if (spd > 0) this.moveUnit(u, mx * spd * dt, mz * spd * dt);
      u.vx = (u.x - ox) / dt; u.vz = (u.z - oz) / dt;
      u.moving = ml > 0.1 && spd > 0;
      if (u.moving) {
        const target = u.rail ? (mx >= 0 ? 0 : Math.PI) : Math.atan2(mz, mx);
        let d = target - u.body;
        while (d > Math.PI) d -= Math.PI * 2;
        while (d < -Math.PI) d += Math.PI * 2;
        const rate = u.vehicle ? 2.5 : 12;
        u.body += Math.max(-rate * dt, Math.min(rate * dt, d));
      }
      const al = Math.hypot(inp.ax || 0, inp.az || 0);
      if (al > 0.05) {
        const target = Math.atan2(inp.az, inp.ax);
        if (u.vehicle && !u.air) {
          let d = target - u.aim;
          while (d > Math.PI) d -= Math.PI * 2;
          while (d < -Math.PI) d += Math.PI * 2;
          u.aim += Math.max(-4 * dt, Math.min(4 * dt, d));
        } else u.aim = target;
      }
      // reload
      const W = u.flameT > 0 ? WEAPONS.flame : WEAPONS[u.weapon] || WEAPONS.rifle;
      if (u.reloadT > 0) {
        u.reloadT -= dt;
        if (u.reloadT <= 0) { u.ammo = (WEAPONS[u.weapon] || WEAPONS.rifle).mag; this.events.push({ k: 'reloaded', id: u.id }); }
      } else if ((inp.reload && u.ammo < (WEAPONS[u.weapon] || WEAPONS.rifle).mag) || u.ammo <= 0) {
        u.reloadT = (WEAPONS[u.weapon] || WEAPONS.rifle).reload;
        this.events.push({ k: 'reload', x: u.x, z: u.z, id: u.id });
      }
      if (inp.fire && u.cd <= 0 && (u.flameT > 0 || (u.reloadT <= 0 && u.ammo > 0))) {
        u.cd = W.rate;
        if (u.flameT <= 0) u.ammo--;
        this.fire(u, u.aim, W);
      }
      if (inp.ab) {
        let tx = inp.tx, tz = inp.tz;
        if (tx === undefined || tz === undefined) {
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
        this.useSpecial(u, tx, tz);
      }
    }
    this.stepProjectiles(dt);
    const A = this.main.att, D = this.main.def;
    if (!A.alive || !D.alive || this.time <= 0) {
      this.over = true;
      const ha = A.hp / A.hpMul, hd = D.hp / D.hpMul;
      if (!D.alive && A.alive) this.result = { winner: 'att', attHp: ha, defHp: 0 };
      else if (!A.alive && D.alive) this.result = { winner: 'def', attHp: 0, defHp: hd };
      else if (!A.alive && !D.alive) this.result = { winner: 'def', attHp: 0, defHp: 1 };
      else this.result = { winner: 'timeout', attHp: ha, defHp: hd };
      this.result.sup = this.units.filter((u) => u.supIdx !== undefined).map((u) => ({ role: u.team, idx: u.supIdx, hp: u.hp / u.hpMul, alive: u.alive }));
      this.events.push({ k: 'over', w: this.result.winner });
    }
  }

  stepProjectiles(dt) {
    const sub = 3;
    for (const p of this.proj) {
      for (let k = 0; k < sub && p.life > 0; k++) {
        const h = dt / sub;
        const nx = p.x + p.vx * h, nz = p.z + p.vz * h;
        p.life -= h;
        if (p.kind === 'g') { p.x = nx; p.z = nz; if (p.life <= 0) this.explode(p.x, p.z, p.splash, p.dmg, p.team); continue; }
        let hitObs = null;
        if (!p.air) {
          for (const o of this.obs) {
            if (o.hp <= 0 || !BLOCKS_LOS.has(o.kind)) continue;
            if (segAabb(p.x, p.z, nx, nz, o)) { hitObs = o; break; }
          }
        }
        if (Math.abs(nx) > HW + 2 || Math.abs(nz) > HD + 2) { p.life = 0; break; }
        let hitU = null;
        for (const u of this.units) {
          if (!u.alive || u.team === p.team) continue;
          if (u.air && (p.kind === 'c' || p.kind === 'g' || p.kind === 'f')) continue;
          if (Math.hypot(u.x - nx, u.z - nz) < u.r + 0.15) { hitU = u; break; }
        }
        if (hitU) {
          if (p.splash) this.explode(nx, nz, p.splash, p.dmg, p.team, p.hitsAir);
          else {
            this.hurt(hitU, p.dmg * (hitU.air ? p.airMul : 1), false, p, Math.atan2(p.vz, p.vx));
            if (p.kind === 'f') hitU.burnT = Math.max(hitU.burnT, 2.5);
          }
          p.life = 0;
          break;
        }
        if (hitObs) {
          if (p.splash) this.explode(nx, nz, p.splash, p.dmg, p.team, p.hitsAir);
          else { this.damageObs(hitObs, p.dmg); if (p.kind !== 'f') this.events.push({ k: 'spark', x: nx, z: nz }); }
          p.life = 0;
          break;
        }
        p.x = nx; p.z = nz;
        if (p.life <= 0 && p.splash) this.explode(p.x, p.z, p.splash, p.dmg, p.team, p.hitsAir);
      }
    }
    this.proj = this.proj.filter((p) => p.life > 0);
  }

  get done() { return this.over && this.endDelay <= 0; }

  snapshot() {
    const ev = this.events;
    this.events = [];
    const od = this.destroyed;
    this.destroyed = [];
    return {
      t: Math.max(0, this.time),
      u: this.units.map((u) => {
        const W = WEAPONS[u.weapon] || WEAPONS.rifle;
        const flags = (u.shieldT > 0 ? 1 : 0) | (u.sprintT > 0 ? 2 : 0) | (u.burnT > 0 ? 4 : 0) | (u.invuln > 0 ? 8 : 0) | (u.flameT > 0 ? 16 : 0);
        return [u.id, u.kind, u.team, +u.x.toFixed(2), +u.z.toFixed(2), +u.aim.toFixed(2), Math.ceil(u.hp), Math.round(u.maxHp),
          u.alive ? 1 : 0, +u.body.toFixed(2), u.moving ? 1 : 0, Math.max(0, +u.abCd.toFixed(1)), u.isMain ? 1 : 0,
          u.ammo, W.mag, u.reloadT > 0 ? 1 : 0, flags, u.cid || '', u.supIdx !== undefined ? 1 : 0];
      }),
      p: this.proj.map((p) => [+p.x.toFixed(2), +p.z.toFixed(2), p.kind, +Math.atan2(p.vz, p.vx).toFixed(2), p.life]),
      o: this.objs.map((o) => [o.id, o.type, +o.x.toFixed(2), +o.z.toFixed(2), +o.t.toFixed(1), o.team || '']),
      ev, od,
      over: this.over ? this.result : null,
    };
  }
}
