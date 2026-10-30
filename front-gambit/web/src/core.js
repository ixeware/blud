// Low-level state helpers shared by rules, abilities, cards and events.
import { unitDef, unitPassives } from './units.js';

export const SIDES = ['w', 'b'];
export const other = (s) => (s === 'w' ? 'b' : 'w');
export const sq = (r, c) => r * 8 + c;
export const rc = (i) => [Math.floor(i / 8), i % 8];
export const inB = (r, c) => r >= 0 && r < 8 && c >= 0 && c < 8;
export const cheb = (a, b) => {
  const [r1, c1] = rc(a), [r2, c2] = rc(b);
  return Math.max(Math.abs(r1 - r2), Math.abs(c1 - c2));
};
export const SIDE_NAME = { w: 'Синие', b: 'Красные', n: 'Мятежники' };
export const RANKS = ['Рядовой', 'Ефрейтор', 'Сержант', 'Ветеран'];
export const RANK_XP = [0, 3, 7, 12];
export const VEHICLES = new Set(['R', 'Q', 'A', 'L', 'T']);

export function rnd(s) {
  // deterministic-enough PRNG stored in state so host decisions are reproducible
  s.seed = (Math.imul(s.seed ^ (s.seed >>> 15), 0x2c1b3c6d) + 0x6d2b79f5) >>> 0;
  return (s.seed >>> 8) / 16777216;
}
export function pick(s, arr) { return arr[Math.floor(rnd(s) * arr.length)]; }

export function addLog(s, msg) {
  s.log.push(msg);
  if (s.log.length > 50) s.log.shift();
}

export function fx(s, e) {
  e.id = ++s.fxSeq;
  s.fx.push(e);
  if (s.fx.length > 40) s.fx.shift();
}

export function around(i, r = 1, self = false) {
  const [pr, pc] = rc(i);
  const out = [];
  for (let dr = -r; dr <= r; dr++) for (let dc = -r; dc <= r; dc++) {
    if (!self && !dr && !dc) continue;
    if (inB(pr + dr, pc + dc)) out.push(sq(pr + dr, pc + dc));
  }
  return out;
}

export function isEnemy(a, b) { return !!a && !!b && a.s !== b.s; }

export function hasPassive(s, p, id) {
  return !!p && unitPassives(s, p).includes(id);
}

// ---------- territory & supply ----------

export function territory(s) {
  const own = new Array(64).fill(null);
  const pw = [], pb = [];
  s.board.forEach((p, i) => { if (p) { if (p.s === 'w') pw.push(i); else if (p.s === 'b') pb.push(i); } });
  for (let i = 0; i < 64; i++) {
    let dw = 99, db = 99;
    for (const j of pw) dw = Math.min(dw, cheb(i, j));
    for (const j of pb) db = Math.min(db, cheb(i, j));
    const [r] = rc(i);
    if (r === 0) dw -= 1;
    if (r === 7) db -= 1;
    own[i] = dw < db ? 'w' : db < dw ? 'b' : null;
  }
  return own;
}

export function terrShare(s, side, terr = territory(s)) {
  const a = terr.filter((o) => o === side).length, b = terr.filter((o) => o === other(side)).length;
  return a / Math.max(1, a + b);
}

export function supplyMap(s, terr = territory(s)) {
  const res = { w: new Array(64).fill(false), b: new Array(64).fill(false), n: new Array(64).fill(true) };
  for (const side of SIDES) {
    const home = side === 'w' ? 0 : 7;
    const pass = (i) => terr[i] === side || s.rails[i] === side;
    const q = [];
    for (let c = 0; c < 8; c++) {
      const i = sq(home, c);
      if (pass(i)) { res[side][i] = true; q.push(i); }
    }
    while (q.length) {
      const i = q.shift();
      const [r, c] = rc(i);
      for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        if (!inB(r + dr, c + dc)) continue;
        const j = sq(r + dr, c + dc);
        if (!res[side][j] && pass(j)) { res[side][j] = true; q.push(j); }
      }
    }
    for (let i = 0; i < 64; i++) {
      if (s.rails[i] === side && res[side][i]) for (const j of around(i)) res[side][j] = true;
    }
    // logistics passive & forced supply
    s.board.forEach((p, i) => {
      if (!p || p.s !== side) return;
      if (p.st && p.st.supplied > 0) res[side][i] = true;
      if (hasPassive(s, p, 'logistics')) { res[side][i] = true; for (const j of around(i)) res[side][j] = true; }
    });
  }
  return res;
}

// ---------- pieces ----------

export function alloc(s, t, side, extra = {}) {
  const def = unitDef(s, { t, cid: extra.cid });
  return {
    id: s.nextId++, t, s: side, hp: def.hp, maxHp: def.hp, moved: true, dug: false, stun: 0,
    cds: {}, xp: 0, rank: 0, st: {}, ...extra,
  };
}

export const ARMY_CAP = 18;
export const armySize = (s, side) => s.board.filter((p) => p && p.s === side).length;

export function spawn(s, i, t, side, extra) {
  if (s.board[i]) return null;
  if (side !== 'n' && armySize(s, side) >= ARMY_CAP) { addLog(s, `${SIDE_NAME[side]}: достигнут лимит армии (${ARMY_CAP}).`); return null; }
  const p = alloc(s, t, side, extra);
  s.board[i] = p;
  fx(s, { k: 'spawn', sq: i });
  return p;
}

export function gainXp(s, p, n) {
  if (!p || p.rank >= 3) return;
  let mult = 1;
  const i = s.board.indexOf(p);
  if (i >= 0) for (const j of around(i)) { const q = s.board[j]; if (q && q.s === p.s && hasPassive(s, q, 'instructor')) mult = 2; }
  p.xp += n * mult;
  while (p.rank < 3 && p.xp >= RANK_XP[p.rank + 1]) {
    p.rank++;
    p.maxHp = Math.round(p.maxHp * 1.1);
    p.hp = Math.min(p.maxHp, p.hp + 20);
    if (i >= 0) fx(s, { k: 'rankup', sq: i, rank: p.rank });
    addLog(s, `${SIDE_NAME[p.s]}: ${unitDef(s, p).name} получает звание «${RANKS[p.rank]}»!`);
  }
}

export function inSmoke(s, i) { return s.sqfx[i] && s.sqfx[i].smoke > 0; }

// opts: {src: square of attacker piece, side: attacking side, kind: 'arty'|'air'|'drone'|'mine'|'fire'|'direct', pierce}
export function damagePiece(s, i, dmg, opts = {}) {
  const p = s.board[i];
  if (!p || dmg <= 0) return false;
  if (p.st.shield > 0 && opts.kind !== 'fire' && opts.kind !== 'gas') {
    p.st.shield = 0;
    fx(s, { k: 'shieldhit', sq: i });
    return false;
  }
  let eff = dmg;
  if (!opts.pierce) {
    if (p.dug) eff *= 0.7;
    if (hasPassive(s, p, 'armor')) eff *= 0.75;
    if (s.terrain[i] === 'bld') eff *= 0.8;
  }
  if (p.st.marked > 0) eff *= 1.5;
  if (p.t === 'K' || p.t === 'D') eff *= 0.5; // bunker
  if ((opts.kind === 'air' || opts.kind === 'drone') && aaCovered(s, i, p.s)) eff *= 0.5;
  eff = Math.max(1, Math.round(eff));
  p.hp -= eff;
  fx(s, { k: 'dmg', sq: i, v: eff });
  // counter-battery
  if (opts.src !== undefined && opts.src >= 0 && hasPassive(s, p, 'counterbat') && (opts.kind === 'arty' || opts.kind === 'direct')) {
    const a = s.board[opts.src];
    if (a && a.s !== p.s && !opts.noRetaliate) {
      fx(s, { k: 'shell', from: i, to: opts.src });
      damagePiece(s, opts.src, 20, { kind: 'direct', noRetaliate: true });
    }
  }
  if (p.hp <= 0) {
    const killer = opts.src !== undefined && opts.src >= 0 ? s.board[opts.src] : null;
    killPiece(s, i, opts.side, killer);
    return true;
  }
  return false;
}

export function aaCovered(s, i, side) {
  for (const j of around(i, 1, true)) {
    const q = s.board[j];
    if (q && q.s === side && hasPassive(s, q, 'aacover')) return true;
  }
  return false;
}

export function heal(s, i, n) {
  const p = s.board[i];
  if (!p || n <= 0) return;
  const before = p.hp;
  p.hp = Math.min(p.maxHp, p.hp + n);
  if (p.hp > before) fx(s, { k: 'heal', sq: i, v: p.hp - before });
}

export function stun(s, i, n) {
  const p = s.board[i];
  if (!p) return;
  if (hasPassive(s, p, 'fearless')) { fx(s, { k: 'resist', sq: i }); return; }
  p.stun = Math.max(p.stun, n);
}

export function killPiece(s, i, bySide, killer) {
  const p = s.board[i];
  if (!p) return;
  s.board[i] = null;
  fx(s, { k: 'boom', sq: i, big: VEHICLES.has(p.t) });
  if (bySide && bySide !== p.s && s.stats[bySide]) s.stats[bySide].kills++;
  if (killer) {
    gainXp(s, killer, 2);
    if (hasPassive(s, killer, 'trophies') && s.money[killer.s] !== undefined) s.money[killer.s] += 25;
  }
  addLog(s, `${SIDE_NAME[p.s]}: ${unitDef(s, p).name} уничтожен.`);
  if (p.t === 'K' && p.s !== 'n') {
    s.winner = other(p.s);
    s.phase = 'over';
    addLog(s, `ПОБЕДА: ${SIDE_NAME[s.winner]}!`);
  }
  if (p.t === 'D') {
    const side = bySide && bySide !== 'n' ? bySide : null;
    if (side) s.money[side] += 150;
    s.popup = { id: 'ev_dictator_down', seq: (s.popup ? s.popup.seq : 0) + 1, side };
    addLog(s, 'Диктатор повержен! Режим пал.' + (side ? ` ${SIDE_NAME[side]} получают 150.` : ''));
  }
}

export function factoryCount(s, side) { return s.factories[side].length; }

export function damageFactory(s, side, idx, dmg) {
  const f = s.factories[side][idx];
  if (!f) return false;
  f.hp -= dmg;
  fx(s, { k: 'factoryHit', side, idx });
  if (f.hp <= 0) {
    fx(s, { k: 'factoryBoom', side, idx });
    s.factories[side].splice(idx, 1);
    addLog(s, `${SIDE_NAME[side]}: завод уничтожен!`);
    return true;
  }
  return false;
}
