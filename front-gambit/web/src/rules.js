// Core game rules: chess movement + military economy, logistics, abilities, cards and events.
// State is plain JSON so it can be sent over the network as-is.
import {
  SIDES, other, sq, rc, inB, cheb, around, SIDE_NAME, territory, terrShare, supplyMap, addLog, fx, alloc, spawn,
  damagePiece, killPiece, gainXp, hasPassive, rnd, VEHICLES, damageFactory, inSmoke, RANKS, ARMY_CAP, armySize,
} from './core.js';
import { UNITS, unitDef, customPrice } from './units.js';
import { ABILITIES, abilityTargetsFor, useAbility } from './abilities.js';
import { CARDS, playCard, offerCards, airStrikeArea } from './cards.js';
import { rollEvent } from './events.js';

export { ARMY_CAP, armySize, SIDES, other, sq, rc, inB, cheb, SIDE_NAME, territory, supplyMap, terrShare, UNITS, unitDef, RANKS, around };
export const MAX_TURNS = 60;

export const SHOP = {
  pawn:     { name: 'Пехота', price: 40, icon: 'unit_P', cat: 'army', target: 'deploy', desc: 'Пехотинец на ваших двух задних рядах.' },
  medic:    { name: 'Медик', price: 60, icon: 'unit_M', cat: 'army', target: 'deploy', desc: 'Лечит соседей, разворачивает госпиталь.' },
  engineer: { name: 'Инженер', price: 60, icon: 'unit_E', cat: 'army', target: 'deploy', desc: 'Строит ДОТы и ж/д, снимает мины.' },
  tank:     { name: 'Танк', price: 170, icon: 'unit_R', cat: 'tech', target: 'deployBack', desc: 'Новый танк с завода на задний ряд.' },
  aa:       { name: 'ПВО', price: 110, icon: 'unit_A', cat: 'tech', target: 'deployBack', desc: 'Зенитный комплекс: прикрывает от дронов и авиации.' },
  mlrs:     { name: 'РСЗО', price: 150, icon: 'unit_L', cat: 'tech', target: 'deployBack', desc: 'Реактивная артиллерия: залпы по площади.' },
  train:    { name: 'Бронепоезд', price: 200, icon: 'unit_T', cat: 'tech', target: 'railFree', desc: 'Ездит по вашим путям, бьёт бортовым залпом и снабжает.' },
  drone:    { name: 'FPV-дрон', price: 70, icon: 'shop_drone', cat: 'strike', action: true, desc: 'Ведите дрона-камикадзе сами. Перезарядка 2 хода. Радар −20.' },
  airstrike:{ name: 'Авиаудар', price: 150, icon: 'shop_airstrike', cat: 'strike', target: 'any', action: true, desc: '45 урона по площади 3×3. Перезарядка 2 хода. Аэродром −40.' },
  sabotage: { name: 'Диверсия', price: 70, icon: 'shop_sabotage', cat: 'strike', desc: 'Подрыв вражеского завода (55%) или ж/д.' },
  mine:     { name: 'Мина', price: 25, icon: 'shop_mine', cat: 'strike', target: 'mine', desc: 'Скрытая мина: 60 урона наступившему врагу.' },
  factory:  { name: 'Завод', price: 120, icon: 'factory', cat: 'rear', desc: '+20 к доходу каждый ход. Максимум 4.' },
  rail:     { name: 'Ж/д путь', price: 15, icon: 'shop_rail', cat: 'rear', target: 'rail', desc: 'Юниты на путях перебрасываются по сети за ход и снабжаются.' },
  ew:       { name: 'РЭБ', price: 80, icon: 'shop_ew', cat: 'rear', desc: 'Помехи вражеским дронам на вашей половине.' },
  blitz:    { name: 'Блицкриг', price: 100, icon: 'shop_blitz', cat: 'rear', desc: '+2 действия в этом ходу. Перезарядка 5 ходов.' },
};
const BUY_UNIT = { pawn: 'P', medic: 'M', engineer: 'E', tank: 'R', aa: 'A', mlrs: 'L', train: 'T' };

export const KEYPOINTS = {
  oil: { name: 'Нефтевышка', icon: 'kp_oil', desc: '+20 к доходу владельцу.' },
  radar: { name: 'Радар', icon: 'kp_radar', desc: 'Видны вражеские мины и замаскированные юниты, дрон дешевле на 20.' },
  airfield: { name: 'Аэродром', icon: 'kp_airfield', desc: 'Авиаудар дешевле на 40, B-2 перезаряжается быстрее.' },
};

const MAPS = {
  field: {
    keypoints: [['oil', 3, 1], ['oil', 4, 6], ['radar', 3, 5], ['radar', 4, 2], ['airfield', 2, 7], ['airfield', 5, 0]],
    terrain: [],
  },
  city: {
    keypoints: [['radar', 3, 1], ['radar', 4, 6], ['oil', 2, 6], ['oil', 5, 1]],
    terrain: [['bld', 2, 1], ['bld', 5, 6], ['bld', 2, 5], ['bld', 5, 2], ['bld', 3, 3], ['bld', 4, 4], ['bld', 3, 7], ['bld', 4, 0],
      ['metro', 2, 3], ['metro', 5, 4], ['metro', 3, 6], ['metro', 4, 1]],
  },
};

let nextId = 1;
function mkPiece(t, s) {
  return { id: nextId++, t, s, hp: UNITS[t].hp, maxHp: UNITS[t].hp, moved: false, dug: false, stun: 0, cds: {}, xp: 0, rank: 0, st: {} };
}

export function newGame(opts = {}) {
  nextId = 1;
  const board = new Array(64).fill(null);
  const back = ['R', 'N', 'B', 'Q', 'K', 'B', 'N', 'R'];
  for (let c = 0; c < 8; c++) {
    board[sq(0, c)] = mkPiece(back[c], 'w');
    board[sq(1, c)] = mkPiece('P', 'w');
    board[sq(6, c)] = mkPiece('P', 'b');
    board[sq(7, c)] = mkPiece(back[c], 'b');
  }
  const map = opts.map === 'city' ? 'city' : 'field';
  const layout = MAPS[map];
  const terrain = new Array(64).fill(null);
  for (const [t, r, c] of layout.terrain) terrain[sq(r, c)] = t;
  const s = {
    v: 2,
    board, nextId,
    seed: (opts.seed ?? Math.floor(Math.random() * 2 ** 31)) >>> 0,
    turn: 'w', turnNo: 1,
    money: { w: 100, b: 100 },
    factories: { w: [{ hp: 100 }], b: [{ hp: 100 }] },
    rails: new Array(64).fill(null),
    mines: new Array(64).fill(null),
    revealed: new Array(64).fill(0),
    ew: { w: false, b: false },
    blitzCd: { w: 0, b: 0 }, droneCd: { w: 0, b: 0 }, airCd: { w: 0, b: 0 }, b2Cd: { w: 0, b: 0 }, b2Ready: { w: false, b: false },
    actionsLeft: 1, movedIds: [],
    phase: 'board', rt: null, winner: null,
    log: [], fx: [], fxSeq: 0, lastMove: null,
    autoDuel: !!opts.autoDuel,
    stats: { w: { kills: 0, duelsWon: 0, drones: 0 }, b: { kills: 0, duelsWon: 0, drones: 0 }, n: { kills: 0, duelsWon: 0, drones: 0 } },
    map, terrain,
    keypoints: layout.keypoints.map(([type, r, c]) => ({ sq: sq(r, c), type, owner: null })),
    sqfx: new Array(64).fill(null),
    loot: new Array(64).fill(0),
    effects: { mud: 0, blizzard: 0, depression: 0, ceasefire: 0, blackout: 0, metroflood: 0, supplycut: 0, counter: { w: 0, b: 0 } },
    ewZones: [], decoy: { w: 0, b: 0 }, lend: { w: 0, b: 0 },
    hands: { w: [], b: [] }, offer: { w: null, b: null },
    usedHistory: [], lastEventTurn: 0, popup: null,
    customDefs: opts.customDefs || {},
    opts: { events: opts.events !== false, cards: opts.cards !== false },
  };
  addLog(s, map === 'city' ? 'Бои в городе! Синие ходят первыми.' : 'Война началась! Синие ходят первыми.');
  return s;
}

// ---------- economy ----------

export function keypointCount(s, side, type) {
  return s.keypoints.filter((k) => k.owner === side && k.type === type).length;
}

export function income(s, side, terr = territory(s)) {
  if (side === 'n') return 0;
  const t = terr.filter((o) => o === side).length;
  let inc = 15 + 20 * s.factories[side].length + Math.floor(t / 2) + 20 * keypointCount(s, side, 'oil');
  s.board.forEach((p) => { if (p && p.s === side && hasPassive(s, p, 'fieldhq')) inc += 10; });
  if (s.lend[side] > 0) inc += 50;
  let mul = 1;
  if (s.effects.depression > 0) mul *= 0.6;
  if (s.effects.supplycut > 0) mul *= 0.5;
  if (s.effects.blackout > 0) mul *= 0.8;
  return Math.round(inc * mul);
}

export function price(s, side, item) {
  if (item.startsWith('custom:')) {
    const d = s.customDefs[item.slice(7)];
    return d ? customPrice(d.points) : 9999;
  }
  let p = SHOP[item].price;
  if (item === 'drone') p -= 20 * Math.min(1, keypointCount(s, side, 'radar'));
  if (item === 'airstrike') p -= 40 * Math.min(1, keypointCount(s, side, 'airfield'));
  return p;
}

// ---------- moves ----------

function slideDirs(move) {
  const ORTH = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  const DIAG = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
  switch (move) {
    case 'bishop': case 'archbishop': return [DIAG, 8];
    case 'rook': case 'chancellor': return [ORTH, 8];
    case 'rook2': return [ORTH, 2];
    case 'rook3': return [ORTH, 3];
    case 'queen': return [ORTH.concat(DIAG), 8];
  }
  return null;
}
const KNIGHT = [[1, 2], [2, 1], [-1, 2], [-2, 1], [1, -2], [2, -1], [-1, -2], [-2, -1]];

export function pieceMoves(s, from) {
  const p = s.board[from];
  if (!p) return [];
  const def = unitDef(s, p);
  const out = [];
  const [r, c] = rc(from);
  const add = (nr, nc, onlyEmpty = false, onlyCapture = false) => {
    if (!inB(nr, nc)) return false;
    const to = sq(nr, nc);
    const q = s.board[to];
    if (q && q.s === p.s) return false;
    if (q && onlyEmpty) return false;
    if (!q && onlyCapture) return true;
    if (!out.some((m) => m.to === to)) out.push({ from, to, capture: !!q });
    return !q;
  };
  let move = def.move;
  if (move === 'pawn' && p.s === 'n') move = 'king';
  const veh = VEHICLES.has(p.t) || def.vehicle;
  if (move === 'pawn') {
    const d = p.s === 'w' ? 1 : -1;
    if (inB(r + d, c) && !s.board[sq(r + d, c)]) {
      out.push({ from, to: sq(r + d, c), capture: false });
      const startRow = p.s === 'w' ? 1 : 6;
      if (r === startRow && !s.effects.mud && inB(r + 2 * d, c) && !s.board[sq(r + 2 * d, c)]) out.push({ from, to: sq(r + 2 * d, c), capture: false });
    }
    add(r + d, c - 1, false, true);
    add(r + d, c + 1, false, true);
  }
  if (move === 'king' || move === 'kingknight') {
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) if (dr || dc) add(r + dr, c + dc);
  }
  if (move === 'knight' || move === 'kingknight' || move === 'archbishop' || move === 'chancellor') {
    for (const [dr, dc] of KNIGHT) add(r + dr, c + dc);
  }
  const sl = slideDirs(move);
  if (sl) {
    let [dirs, max] = sl;
    if (s.effects.mud > 0) max = Math.min(max, veh ? 1 : 2);
    const jumper = hasPassive(s, p, 'jumper');
    for (const [dr, dc] of dirs) {
      let jumped = false;
      for (let k = 1; k <= max; k++) {
        const nr = r + dr * k, nc = c + dc * k;
        if (!inB(nr, nc)) break;
        const q = s.board[sq(nr, nc)];
        if (q) {
          if (q.s !== p.s) add(nr, nc);
          if (jumper && !jumped) { jumped = true; continue; }
          break;
        }
        add(nr, nc);
      }
    }
  }
  // railway: trains move only along own rails; other units can transfer along rails
  const ORTH = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  if (s.rails[from] === p.s || move === 'rail') {
    const seen = new Set([from]);
    const q = [from];
    while (q.length) {
      const i = q.shift();
      const [ir, ic] = rc(i);
      for (const [dr, dc] of ORTH) {
        if (!inB(ir + dr, ic + dc)) continue;
        const j = sq(ir + dr, ic + dc);
        if (seen.has(j) || s.rails[j] !== p.s) continue;
        seen.add(j);
        const occ = s.board[j];
        if (occ) {
          if (move === 'rail' && occ.s !== p.s && !out.some((m) => m.to === j)) out.push({ from, to: j, capture: true, rail: true });
          continue;
        }
        q.push(j);
        if (!out.some((m) => m.to === j)) out.push({ from, to: j, capture: false, rail: true });
      }
    }
  }
  // metro (city): infantry can travel between stations
  if (s.terrain[from] === 'metro' && !veh && !s.effects.metroflood) {
    s.terrain.forEach((t, j) => {
      if (t === 'metro' && j !== from && !s.board[j] && !out.some((m) => m.to === j)) out.push({ from, to: j, capture: false, metro: true });
    });
  }
  if (s.effects.ceasefire > 0) return out.filter((m) => !m.capture);
  return out;
}

export function legalMovesFor(s, from) {
  const p = s.board[from];
  if (!p || p.stun > 0) return [];
  if (s.movedIds.includes(p.id) && !s.blitzActive) return [];
  return pieceMoves(s, from);
}

export function abilityList(s, from) {
  const p = s.board[from];
  if (!p) return [];
  return unitDef(s, p).actives.map((id) => ({ id, targets: abilityTargetsFor(s, from, id), cd: p.cds[id] || 0 }));
}

export function shopTargets(s, side, item) {
  const terr = territory(s);
  const res = [];
  const home = side === 'w' ? [0, 1] : [7, 6];
  let target = item.startsWith('custom:') ? 'deploy' : SHOP[item].target;
  switch (target) {
    case 'deploy':
      for (const r of home) for (let c = 0; c < 8; c++) if (!s.board[sq(r, c)]) res.push(sq(r, c));
      return res;
    case 'deployBack':
      for (let c = 0; c < 8; c++) if (!s.board[sq(home[0], c)]) res.push(sq(home[0], c));
      return res;
    case 'railFree':
      for (let i = 0; i < 64; i++) if (s.rails[i] === side && !s.board[i]) res.push(i);
      return res;
    case 'rail':
      for (let i = 0; i < 64; i++) if (terr[i] === side && !s.rails[i]) res.push(i);
      return res;
    case 'mine':
      for (let i = 0; i < 64; i++) if (!s.board[i] && !s.mines[i] && terr[i] !== other(side)) res.push(i);
      return res;
    case 'any':
      for (let i = 0; i < 64; i++) res.push(i);
      return res;
  }
  return null;
}

export function canBuy(s, side, item) {
  const custom = item.startsWith('custom:');
  if (custom && !s.customDefs[item.slice(7)]) return 'Нет чертежа';
  const it = custom ? { target: 'deploy' } : SHOP[item];
  if (!it) return 'Неизвестно';
  if ((custom || BUY_UNIT[item]) && armySize(s, side) >= ARMY_CAP) return `Лимит армии ${ARMY_CAP}`;
  if (s.money[side] < price(s, side, item)) return 'Не хватает денег';
  if (it.action && s.actionsLeft <= 0) return 'Нет действий';
  if (item === 'factory' && s.factories[side].length >= 4) return 'Максимум заводов';
  if (item === 'ew' && s.ew[side]) return 'РЭБ уже есть';
  if (item === 'blitz' && s.blitzCd[side] > 0) return `Перезарядка ${s.blitzCd[side]}`;
  if (item === 'drone' && s.droneCd[side] > 0) return `Перезарядка ${s.droneCd[side]}`;
  if (item === 'airstrike' && s.airCd[side] > 0) return `Перезарядка ${s.airCd[side]}`;
  if ((item === 'drone' || item === 'airstrike') && s.effects.blizzard > 0) return 'Нелётная погода';
  if ((item === 'airstrike' || item === 'sabotage') && s.effects.ceasefire > 0) return 'Перемирие';
  if (it.target) {
    const t = shopTargets(s, side, item);
    if (!t || !t.length) return item === 'train' ? 'Нужны свободные пути' : 'Нет места';
  }
  return null;
}

export function b2Available(s, side) {
  return s.b2Ready[side] && s.b2Cd[side] === 0 && !s.effects.blizzard && !s.effects.ceasefire;
}

// ---------- commands ----------
export function apply(s, side, cmd) {
  if (s.winner) return 'Игра окончена';
  if (cmd.c === 'pick') {
    const off = s.offer[side];
    if (!off || !off.includes(cmd.card)) return 'Нет предложения';
    s.hands[side].push(cmd.card);
    s.offer[side] = null;
    return null;
  }
  if (cmd.c === 'end') {
    if (s.turn !== side || s.phase !== 'board') return 'Не ваш ход';
    endTurn(s);
    return null;
  }
  if (s.turn !== side) return 'Не ваш ход';
  if (s.phase !== 'board') return 'Идёт бой';

  if (cmd.c === 'move') {
    if (s.actionsLeft <= 0) return 'Нет действий';
    const m = legalMovesFor(s, cmd.from).find((x) => x.to === cmd.to);
    const p = s.board[cmd.from];
    if (!m || !p || p.s !== side) return 'Недопустимый ход';
    s.actionsLeft--;
    s.movedIds.push(p.id);
    if (m.capture) startDuel(s, cmd.from, cmd.to);
    else {
      doMove(s, cmd.from, cmd.to, m.rail ? 'rail' : m.metro ? 'metro' : null);
      afterAction(s);
    }
    return null;
  }

  if (cmd.c === 'ability') {
    if (s.actionsLeft <= 0) return 'Нет действий';
    const p = s.board[cmd.from];
    if (!p || p.s !== side) return 'Нет юнита';
    const t = abilityTargetsFor(s, cmd.from, cmd.id);
    if (!t.includes(cmd.target)) return 'Нельзя';
    s.actionsLeft--;
    useAbility(s, cmd.from, cmd.id, cmd.target);
    afterAction(s);
    return null;
  }

  if (cmd.c === 'card') {
    const err = playCard(s, side, cmd.card, cmd.target);
    if (err) return err;
    afterAction(s, true);
    return null;
  }

  if (cmd.c === 'b2') {
    if (!b2Available(s, side)) return 'B-2 недоступен';
    if (s.actionsLeft <= 0) return 'Нет действий';
    s.actionsLeft--;
    b2Strike(s, side, cmd.target);
    afterAction(s);
    return null;
  }

  if (cmd.c === 'buy') {
    const err = canBuy(s, side, cmd.item);
    if (err) return err;
    const custom = cmd.item.startsWith('custom:');
    const it = custom ? { target: 'deploy' } : SHOP[cmd.item];
    if (it.target && !shopTargets(s, side, cmd.item).includes(cmd.target)) return 'Неверная цель';
    s.money[side] -= price(s, side, cmd.item);
    buy(s, side, cmd.item, cmd.target, cmd.sub);
    if (it.action) {
      s.actionsLeft--;
      if (s.phase === 'board') afterAction(s);
    }
    return null;
  }
  return 'Неизвестная команда';
}

function afterMoveTriggers(s, to) {
  const p = s.board[to];
  if (!p) return;
  // mines
  if (s.mines[to] && s.mines[to] !== p.s) {
    const owner = s.mines[to];
    s.mines[to] = null;
    s.revealed[to] = 0;
    addLog(s, `${SIDE_NAME[p.s]} подорвались на мине!`);
    fx(s, { k: 'mine', sq: to });
    if (damagePiece(s, to, 60, { side: owner, kind: 'mine' })) return;
  }
  // loot cache
  if (s.loot[to] > 0 && p.s !== 'n') {
    s.money[p.s] += s.loot[to];
    fx(s, { k: 'cash', sq: to, v: s.loot[to] });
    addLog(s, `${SIDE_NAME[p.s]} захватили трофейный склад (+${s.loot[to]}).`);
    s.loot[to] = 0;
  }
  // key points
  const kp = s.keypoints.find((k) => k.sq === to);
  if (kp && p.s !== 'n' && kp.owner !== p.s) {
    kp.owner = p.s;
    fx(s, { k: 'capture', sq: to, side: p.s });
    addLog(s, `${SIDE_NAME[p.s]} захватили объект: ${KEYPOINTS[kp.type].name}.`);
  }
  // ambush / overwatch reactions
  for (let i = 0; i < 64; i++) {
    const q = s.board[i];
    if (!q || q.s === p.s || !(q.st.overwatch > 0) || cheb(i, to) > 2) continue;
    q.st.overwatch = 0;
    fx(s, { k: 'snipe', from: i, to });
    addLog(s, `${SIDE_NAME[q.s]}: засада сработала!`);
    if (damagePiece(s, to, 35, { src: i, side: q.s, kind: 'direct' })) return;
  }
}

function doMove(s, from, to, via) {
  const p = s.board[from];
  s.board[to] = p;
  s.board[from] = null;
  p.moved = true;
  p.dug = false;
  s.lastMove = { from, to, via };
  if (via === 'rail') fx(s, { k: 'rail', from, to, side: p.s, t: p.t });
  if (via === 'metro') fx(s, { k: 'metro', from, to });
  // promotion
  const [r] = rc(to);
  if (p.t === 'P' && ((p.s === 'w' && r === 7) || (p.s === 'b' && r === 0))) {
    p.t = 'Q';
    const ratio = p.hp / p.maxHp;
    p.maxHp = UNITS.Q.hp;
    p.hp = Math.max(1, Math.round(UNITS.Q.hp * ratio));
    p.cds = {};
    addLog(s, `${SIDE_NAME[p.s]}: пехотинец получил вертолёт!`);
    fx(s, { k: 'promo', sq: to });
  }
  afterMoveTriggers(s, to);
}

function buy(s, side, item, target, sub) {
  if (item.startsWith('custom:')) {
    const cid = item.slice(7);
    s.board[target] = alloc(s, 'C', side, { cid });
    fx(s, { k: 'spawn', sq: target, custom: true });
    addLog(s, `${SIDE_NAME[side]}: в строю «${s.customDefs[cid].name}».`);
    return;
  }
  if (BUY_UNIT[item]) {
    s.board[target] = alloc(s, BUY_UNIT[item], side);
    fx(s, { k: item === 'train' ? 'trainArrive' : 'spawn', sq: target, side, t: BUY_UNIT[item] });
    addLog(s, `${SIDE_NAME[side]}: прибыл юнит «${UNITS[BUY_UNIT[item]].name}».`);
    return;
  }
  switch (item) {
    case 'factory':
      s.factories[side].push({ hp: 100 });
      fx(s, { k: 'factory', side, idx: s.factories[side].length - 1 });
      addLog(s, `${SIDE_NAME[side]}: построен завод (${s.factories[side].length}).`);
      break;
    case 'rail':
      s.rails[target] = side;
      fx(s, { k: 'build', sq: target });
      break;
    case 'mine':
      s.mines[target] = side;
      break;
    case 'ew':
      s.ew[side] = true;
      fx(s, { k: 'ew', side });
      addLog(s, `${SIDE_NAME[side]}: развёрнута РЭБ.`);
      break;
    case 'blitz':
      s.actionsLeft += 2;
      s.blitzCd[side] = 5;
      s.blitzActive = true;
      fx(s, { k: 'blitz', side });
      addLog(s, `${SIDE_NAME[side]}: БЛИЦКРИГ! +2 действия.`);
      break;
    case 'sabotage': {
      const en = other(side);
      const enemyRails = [];
      s.rails.forEach((o, i) => { if (o === en) enemyRails.push(i); });
      const wantFactory = sub === 'rail' ? false : sub === 'factory' ? true : s.factories[en].length > 0;
      fx(s, { k: 'sabotage', side, target: wantFactory ? 'factory' : 'rail' });
      if (wantFactory && s.factories[en].length > 0) {
        if (rnd(s) < 0.55) {
          damageFactory(s, en, s.factories[en].length - 1, 999);
          addLog(s, `${SIDE_NAME[side]}: диверсия удалась — вражеский завод взорван!`);
        } else addLog(s, `${SIDE_NAME[side]}: диверсанты схвачены у завода.`);
      } else if (enemyRails.length) {
        for (let k = 0; k < 3 && enemyRails.length; k++) {
          const j = enemyRails.splice(Math.floor(rnd(s) * enemyRails.length), 1)[0];
          s.rails[j] = null;
          fx(s, { k: 'boom', sq: j });
        }
        addLog(s, `${SIDE_NAME[side]}: подорваны вражеские железные дороги!`);
      } else {
        const st = Math.min(60, s.money[en]);
        s.money[en] -= st;
        s.money[side] += st;
        addLog(s, `${SIDE_NAME[side]}: диверсанты ограбили склад (+${st}).`);
      }
      break;
    }
    case 'airstrike':
      s.airCd[side] = 2;
      fx(s, { k: 'air', sq: target, side });
      addLog(s, `${SIDE_NAME[side]}: авиаудар!`);
      airStrikeArea(s, side, target, 45, around(target, 1, true));
      break;
    case 'drone':
      s.stats[side].drones++;
      s.droneCd[side] = 2;
      s.phase = 'drone';
      s.rt = { kind: 'drone', side, seed: Math.floor(rnd(s) * 1e9), ew: s.ew[other(side)], decoy: s.decoy[other(side)] > 0 };
      if (s.decoy[other(side)] > 0) s.decoy[other(side)] = 0;
      addLog(s, `${SIDE_NAME[side]}: запуск FPV-дрона!`);
      break;
  }
}

function b2Strike(s, side, target) {
  const [tr, tc] = rc(target);
  const squares = [];
  for (let c = tc - 2; c <= tc + 2; c++) if (inB(tr, c)) squares.push(sq(tr, c));
  fx(s, { k: 'b2', sq: target, side });
  addLog(s, `${SIDE_NAME[side]}: B-2 выходит на цель!`);
  s.b2Ready[side] = false;
  s.b2Cd[side] = keypointCount(s, side, 'airfield') ? 4 : 6;
  airStrikeArea(s, side, target, 45, squares);
  for (const i of squares) {
    if (s.rails[i] && s.rails[i] !== side) s.rails[i] = null;
    if (s.mines[i] && s.mines[i] !== side) s.mines[i] = null;
  }
}

export function b2Targets() { const o = []; for (let i = 0; i < 64; i++) o.push(i); return o; }

function afterAction(s, free) {
  if (s.winner) return;
  if (!free && s.actionsLeft <= 0 && s.phase === 'board') endTurn(s);
}

const hasNeutral = (s) => s.board.some((p) => p && p.s === 'n');

export function endTurn(s) {
  if (s.winner) return;
  const prev = s.turn;
  if (prev !== 'n') s.effects.counter[prev] = 0;
  s.blitzActive = false;
  let next;
  if (prev === 'w') next = 'b';
  else if (prev === 'b') next = hasNeutral(s) ? 'n' : 'w';
  else next = 'w';
  s.turn = next;
  s.movedIds = [];
  if (next === 'w') {
    s.turnNo++;
    if (s.turnNo > MAX_TURNS) { endByScore(s); return; }
    roundStart(s);
    if (s.winner) return;
  }
  s.actionsLeft = next === 'n' ? Math.min(2, s.board.filter((p) => p && p.s === 'n').length) : 1;
  sideStart(s, next);
  fx(s, { k: 'turn', side: next });
}

function roundStart(s) {
  const E = s.effects;
  for (const k of ['mud', 'blizzard', 'depression', 'ceasefire', 'blackout', 'metroflood', 'supplycut']) if (E[k] > 0) E[k]--;
  s.ewZones = s.ewZones.filter((z) => --z.t > 0);
  for (let i = 0; i < 64; i++) {
    const f = s.sqfx[i];
    if (!f) continue;
    for (const k of ['smoke', 'fire', 'gas']) if (f[k] > 0) f[k]--;
    if (!f.smoke && !f.fire && !f.gas) s.sqfx[i] = null;
  }
  for (const side of SIDES) if (s.decoy[side] > 0) s.decoy[side]--;
  rollEvent(s);
}

function sideStart(s, side) {
  const terr = territory(s);
  if (side !== 'n') {
    s.money[side] += income(s, side, terr);
    if (s.lend[side] > 0) s.lend[side]--;
    for (const k of ['blitzCd', 'droneCd', 'b2Cd', 'airCd']) if (s[k][side] > 0) s[k][side]--;
    const share = terrShare(s, side, terr);
    const was = s.b2Ready[side];
    s.b2Ready[side] = share <= 0.39 && s.b2Cd[side] === 0;
    if (s.b2Ready[side] && !was) {
      fx(s, { k: 'b2ready', side });
      addLog(s, `${SIDE_NAME[side]}: линия фронта ${Math.round(share * 100)}% — командование выделило бомбардировщик B-2!`);
    }
    if (s.opts.cards && s.turnNo >= 3 && s.turnNo % 3 === 0 && !s.offer[side]) offerCards(s, side);
  }
  const sup = supplyMap(s, terr);
  s.board.forEach((p, i) => {
    if (!p || p.s !== side) return;
    for (const k in p.cds) if (p.cds[k] > 0) p.cds[k]--;
    if (p.stun > 0) p.stun--;
    for (const k of ['stealth', 'buff', 'marked', 'supplied', 'penal', 'overwatch']) if (p.st[k] > 0) p.st[k]--;
    if (sup[side][i] && p.hp < p.maxHp) p.hp = Math.min(p.maxHp, p.hp + 15);
    if (hasPassive(s, p, 'regen')) p.hp = Math.min(p.maxHp, p.hp + 10);
  });
  // burning / gas squares hurt units of the side starting its turn
  for (let i = 0; i < 64; i++) {
    const p = s.board[i], f = s.sqfx[i];
    if (!p || p.s !== side || !f) continue;
    if ((f.fire > 0 || f.gas > 0) && !hasPassive(s, p, 'gasmask')) damagePiece(s, i, 12, { kind: f.fire ? 'fire' : 'gas', pierce: true });
  }
}

export function score(s, side) {
  const terr = territory(s);
  let pts = terr.filter((o) => o === side).length * 2 + s.factories[side].length * 5 + s.keypoints.filter((k) => k.owner === side).length * 4;
  s.board.forEach((p) => { if (p && p.s === side && p.t !== 'K') pts += unitDef(s, p).value * 3 * (p.hp / p.maxHp); });
  return Math.round(pts);
}

function endByScore(s) {
  s.turnNo = MAX_TURNS;
  const w = score(s, 'w'), b = score(s, 'b');
  s.winner = w >= b ? 'w' : 'b';
  s.phase = 'over';
  s.byScore = { w, b };
  addLog(s, `Перемирие! Итог по очкам: Синие ${w} — Красные ${b}.`);
}

// ---------- Duels ----------

export function duelSupport(s, sqTarget, side, exclude) {
  let n = 0;
  for (const i of around(sqTarget)) {
    if (i === exclude) continue;
    const p = s.board[i];
    if (p && p.s === side) n++;
  }
  return Math.min(2, n);
}

function fighter(s, i, sup, role, exclude) {
  const p = s.board[i];
  const d = unitDef(s, p);
  return {
    t: p.t, s: p.s, cid: p.cid || null, hp: p.hp, maxHp: p.maxHp, rank: p.rank,
    supplied: p.s === 'n' ? true : sup[p.s][i],
    allies: duelSupport(s, role === 'att' ? exclude : i, p.s, role === 'att' ? i : i),
    dug: role === 'def' && p.dug, smoke: role === 'def' && inSmoke(s, i), bld: role === 'def' && s.terrain[i] === 'bld',
    buff: p.st.buff > 0, penal: p.st.penal > 0, marked: p.st.marked > 0, shield: p.st.shield > 0,
    counter: p.s !== 'n' && s.effects.counter[p.s] > 0,
    weapon: d.weapon, duel: d.duel, air: !!d.air, vehicle: VEHICLES.has(p.t) || !!d.vehicle,
    armor: hasPassive(s, p, 'armor'), name: d.name,
  };
}

function startDuel(s, from, to) {
  const sup = supplyMap(s, territory(s));
  s.phase = 'duel';
  const att = fighter(s, from, sup, 'att', to);
  att.allies = duelSupport(s, to, s.board[from].s, from);
  const def = fighter(s, to, sup, 'def');
  def.allies = duelSupport(s, to, s.board[to].s, to);
  s.rt = {
    kind: 'duel', from, to, att, def,
    seed: Math.floor(rnd(s) * 1e9),
    urban: s.terrain[to] === 'bld' || (s.map === 'city' && rnd(s) < 0.5),
    night: s.effects.blackout > 0,
  };
  addLog(s, `БОЙ: ${att.name} (${SIDE_NAME[att.s]}) атакует ${def.name}!`);
  fx(s, { k: 'duel', from, to });
  if (s.autoDuel) finishDuel(s, autoResolve(s.rt));
}

const POWER = { P: 1, N: 1.25, B: 1.1, R: 1.6, Q: 1.8, K: 1.0, M: 0.9, E: 1.0, A: 1.4, L: 1.3, T: 1.7, D: 1.3, C: 1.3 };

function fpower(f, defending) {
  let p = f.hp * (POWER[f.t] || 1) * (f.supplied ? 1 : 0.75) * (1 + 0.25 * f.allies) * (1 + 0.08 * f.rank);
  if (f.buff) p *= 1.25;
  if (f.penal) p *= 1.5;
  if (f.counter) p *= 1.3;
  if (f.marked) p *= 0.7;
  if (defending) {
    if (f.dug) p *= 1.5;
    if (f.smoke) p *= 1.3;
    if (f.bld) p *= 1.3;
    p *= 1.1;
  }
  return p;
}

export function autoResolve(rt) {
  const pa = fpower(rt.att, false), pd = fpower(rt.def, true);
  const attWins = Math.random() < pa / (pa + pd);
  const frac = 1 - Math.min(0.9, (attWins ? pd / pa : pa / pd) * 0.7);
  return attWins
    ? { winner: 'att', attHp: Math.max(1, Math.round(rt.att.hp * frac)), defHp: 0 }
    : { winner: 'def', attHp: 0, defHp: Math.max(1, Math.round(rt.def.hp * frac)) };
}

// result: {winner:'att'|'def'|'timeout', attHp, defHp}
export function finishDuel(s, res) {
  const rt = s.rt;
  if (!rt || rt.kind !== 'duel') return;
  const a = s.board[rt.from], d = s.board[rt.to];
  s.phase = 'board';
  s.rt = null;
  if (!a || !d) { afterAction(s); return; }
  a.st.penal = 0; d.st.penal = 0;
  if (res.winner === 'att') {
    s.stats[a.s].duelsWon++;
    a.hp = Math.max(1, Math.min(a.maxHp, Math.round(res.attHp)));
    killPiece(s, rt.to, a.s, a);
    gainXp(s, a, 2);
    if (s.winner) return;
    if (d.t === 'K') return;
    doMove(s, rt.from, rt.to, null);
    fx(s, { k: 'capture', sq: rt.to, side: a.s });
  } else if (res.winner === 'def') {
    s.stats[d.s].duelsWon++;
    d.hp = Math.max(1, Math.min(d.maxHp, Math.round(res.defHp)));
    killPiece(s, rt.from, d.s, d);
    gainXp(s, d, 2);
    if (s.winner) return;
  } else {
    a.hp = Math.max(1, Math.round(res.attHp));
    d.hp = Math.max(1, Math.round(res.defHp));
    addLog(s, 'Время вышло — атака захлебнулась, войска отошли.');
  }
  afterAction(s);
}

// ---------- Drone ----------
// res: {hits:[{sq, dmg}], factory:{side, idx, dmg}?}
export function finishDrone(s, res) {
  const rt = s.rt;
  if (!rt || rt.kind !== 'drone') return;
  s.phase = 'board';
  s.rt = null;
  if (!res.hits.length && !res.factory) addLog(s, `${SIDE_NAME[rt.side]}: дрон потерян.`);
  if (res.factory) {
    addLog(s, `${SIDE_NAME[rt.side]}: дрон поразил вражеский завод!`);
    damageFactory(s, res.factory.side, res.factory.idx, res.factory.dmg);
  }
  for (const h of res.hits) {
    const p = s.board[h.sq];
    if (!p || p.s === rt.side) continue;
    addLog(s, `${SIDE_NAME[rt.side]}: дрон поразил цель — ${unitDef(s, p).name}!`);
    damagePiece(s, h.sq, h.dmg, { side: rt.side, kind: 'drone' });
  }
  afterAction(s);
}

export function clone(s) {
  return JSON.parse(JSON.stringify(s));
}
void ABILITIES; void CARDS; void killPiece;
