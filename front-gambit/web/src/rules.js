// Core game rules: chess movement + military economy, logistics and abilities.
// State is plain JSON so it can be sent over the network as-is.

export const SIDES = ['w', 'b'];
export const other = (s) => (s === 'w' ? 'b' : 'w');
export const sq = (r, c) => r * 8 + c;
export const rc = (i) => [Math.floor(i / 8), i % 8];
export const inB = (r, c) => r >= 0 && r < 8 && c >= 0 && c < 8;
export const cheb = (a, b) => {
  const [r1, c1] = rc(a), [r2, c2] = rc(b);
  return Math.max(Math.abs(r1 - r2), Math.abs(c1 - c2));
};

export const SIDE_NAME = { w: 'Синие', b: 'Красные' };
export const MAX_TURNS = 60;

export const UNITS = {
  P: { name: 'Пехотинец', hp: 100, value: 1, glyph: '♟', ability: 'dig', abilityName: 'Окопаться', cd: 0,
    desc: 'Штурмовая винтовка, граната. Окоп даёт +50% к обороне.' },
  N: { name: 'Спецназ', hp: 120, value: 3, glyph: '♞', ability: 'raid', abilityName: 'Диверсионный рейд', cd: 2,
    desc: 'Ходит конём. ПП и рывок. Рейд: оглушает врага на ход и наносит 25 урона.' },
  B: { name: 'Снайпер', hp: 90, value: 3, glyph: '♝', ability: 'arty', abilityName: 'Артудар', cd: 3,
    desc: 'Ходит по диагонали. Снайперская винтовка, вызов артналёта. Артудар в радиусе 3 клеток.' },
  R: { name: 'Танк', hp: 260, value: 5, glyph: '♜', ability: 'shell', abilityName: 'Огонь с места', cd: 2,
    desc: 'Ходит по прямой. Пулемёт и пушка. Стреляет по линии на 4 клетки без движения.' },
  Q: { name: 'Вертолёт', hp: 190, value: 9, glyph: '♛', ability: 'rockets', abilityName: 'Ракетный залп', cd: 3,
    desc: 'Ходит как ферзь. Летает над укрытиями. Миниган и НУРСы.' },
  K: { name: 'Генерал', hp: 160, value: 100, glyph: '♚', ability: 'mobilize', abilityName: 'Мобилизация', cd: 4,
    desc: 'Штаб в бункере: −50% урона от ударов, дронов и мин. Если генерал погиб — поражение. Мобилизация призывает пехоту.' },
};

export const SHOP = {
  pawn:     { name: 'Пехота',          price: 40,  icon: '🪖', target: 'deploy', desc: 'Высадить пехотинца на своих двух задних рядах.' },
  tank:     { name: 'Танк',            price: 170, icon: '🛡️', target: 'deployBack', desc: 'Новый танк с завода на задний ряд.' },
  drone:    { name: 'FPV-дрон',        price: 70,  icon: '🛸', target: null, action: true, desc: 'Управляй камикадзе-дроном и порази цель. Тратит действие. Перезарядка 2 хода.' },
  factory:  { name: 'Завод',           price: 120, icon: '🏭', target: null, desc: '+20 к доходу каждый ход. Максимум 4.' },
  rail:     { name: 'Ж/д путь',        price: 15,  icon: '🛤️', target: 'rail', desc: 'Участок железной дороги на своей территории. Юниты на ж/д перебрасываются по сети за ход и снабжаются.' },
  mine:     { name: 'Мина',            price: 25,  icon: '💣', target: 'mine', desc: 'Скрытая мина на пустой клетке. 60 урона наступившему врагу.' },
  sabotage: { name: 'Диверсия',        price: 70,  icon: '🧨', target: null, desc: 'Диверсанты подрывают вражеский завод (55%) или ж/д пути.' },
  ew:       { name: 'РЭБ',             price: 80,  icon: '📡', target: null, desc: 'Радиоэлектронная борьба: помехи вражеским дронам на вашей половине.' },
  blitz:    { name: 'Блицкриг',        price: 100, icon: '⚡', target: null, desc: 'Ещё +2 действия в этом ходу. Перезарядка 5 ходов.' },
  airstrike:{ name: 'Авиаудар',        price: 130, icon: '✈️', target: 'any', action: true, desc: '45 урона по площади 3×3 по врагам. Тратит действие.' },
};

let nextId = 1;
function mkPiece(t, s) {
  return { id: nextId++, t, s, hp: UNITS[t].hp, maxHp: UNITS[t].hp, moved: false, dug: false, cd: 0, stun: 0 };
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
  const s = {
    v: 1,
    board,
    nextId,
    turn: 'w',
    turnNo: 1,
    money: { w: 100, b: 100 },
    factories: { w: 1, b: 1 },
    rails: new Array(64).fill(null),
    mines: new Array(64).fill(null),
    ew: { w: false, b: false },
    blitzCd: { w: 0, b: 0 },
    droneCd: { w: 0, b: 0 },
    actionsLeft: 1,
    movedIds: [],
    phase: 'board',
    rt: null, // realtime phase info (duel / drone)
    winner: null,
    log: [],
    fx: [],
    fxSeq: 0,
    lastMove: null,
    autoDuel: !!opts.autoDuel,
    stats: { w: { kills: 0, duelsWon: 0, drones: 0 }, b: { kills: 0, duelsWon: 0, drones: 0 } },
  };
  // initial rails at home
  s.rails[sq(0, 0)] = null;
  addLog(s, 'Война началась! Синие ходят первыми.');
  return s;
}

export function addLog(s, msg) {
  s.log.push(msg);
  if (s.log.length > 40) s.log.shift();
}

export function fx(s, e) {
  e.id = ++s.fxSeq;
  s.fx.push(e);
  if (s.fx.length > 30) s.fx.shift();
}

function alloc(s, t, side) {
  const p = { id: s.nextId++, t, s: side, hp: UNITS[t].hp, maxHp: UNITS[t].hp, moved: true, dug: false, cd: 0, stun: 0 };
  return p;
}

// ---------- Territory, front line, supply ----------

export function territory(s) {
  const own = new Array(64).fill(null);
  const pw = [], pb = [];
  s.board.forEach((p, i) => { if (p) (p.s === 'w' ? pw : pb).push(i); });
  for (let i = 0; i < 64; i++) {
    let dw = 99, db = 99;
    for (const j of pw) dw = Math.min(dw, cheb(i, j));
    for (const j of pb) db = Math.min(db, cheb(i, j));
    // home ranks are always held unless enemy is right there
    const [r] = rc(i);
    if (r === 0) dw -= 1;
    if (r === 7) db -= 1;
    own[i] = dw < db ? 'w' : db < dw ? 'b' : null;
  }
  return own;
}

export function supplyMap(s, terr = territory(s)) {
  const res = { w: new Array(64).fill(false), b: new Array(64).fill(false) };
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
        const nr = r + dr, nc = c + dc;
        if (!inB(nr, nc)) continue;
        const j = sq(nr, nc);
        if (!res[side][j] && pass(j)) { res[side][j] = true; q.push(j); }
      }
    }
    // pieces adjacent to supplied rail also count
    for (let i = 0; i < 64; i++) {
      if (s.rails[i] === side && res[side][i]) {
        const [r, c] = rc(i);
        for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
          if (inB(r + dr, c + dc)) res[side][sq(r + dr, c + dc)] = true;
        }
      }
    }
  }
  return res;
}

export function income(s, side, terr = territory(s)) {
  const t = terr.filter((o) => o === side).length;
  return 15 + 20 * s.factories[side] + Math.floor(t / 2);
}

// ---------- Moves ----------

export function pieceMoves(s, from) {
  const p = s.board[from];
  if (!p) return [];
  const out = [];
  const [r, c] = rc(from);
  const add = (nr, nc, onlyEmpty = false, onlyCapture = false) => {
    if (!inB(nr, nc)) return false;
    const to = sq(nr, nc);
    const q = s.board[to];
    if (q && q.s === p.s) return false;
    if (q && onlyEmpty) return false;
    if (!q && onlyCapture) return true;
    out.push({ from, to, capture: !!q });
    return !q;
  };
  const slide = (dirs, max = 8) => {
    for (const [dr, dc] of dirs) {
      for (let k = 1; k <= max; k++) {
        if (!add(r + dr * k, c + dc * k)) break;
      }
    }
  };
  const ORTH = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  const DIAG = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
  switch (p.t) {
    case 'P': {
      const d = p.s === 'w' ? 1 : -1;
      if (inB(r + d, c) && !s.board[sq(r + d, c)]) {
        out.push({ from, to: sq(r + d, c), capture: false });
        const startRow = p.s === 'w' ? 1 : 6;
        if (r === startRow && inB(r + 2 * d, c) && !s.board[sq(r + 2 * d, c)]) out.push({ from, to: sq(r + 2 * d, c), capture: false });
      }
      add(r + d, c - 1, false, true);
      add(r + d, c + 1, false, true);
      break;
    }
    case 'N':
      for (const [dr, dc] of [[1, 2], [2, 1], [-1, 2], [-2, 1], [1, -2], [2, -1], [-1, -2], [-2, -1]]) add(r + dr, c + dc);
      break;
    case 'B': slide(DIAG); break;
    case 'R': slide(ORTH); break;
    case 'Q': slide(ORTH.concat(DIAG)); break;
    case 'K': slide(ORTH.concat(DIAG), 1); break;
  }
  // railway transfer
  if (s.rails[from] === p.s) {
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
        if (s.board[j]) continue; // blocked
        q.push(j);
        if (!out.some((m) => m.to === j)) out.push({ from, to: j, capture: false, rail: true });
      }
    }
  }
  return out;
}

export function canAct(s, side) {
  return s.phase === 'board' && s.turn === side && s.actionsLeft > 0 && !s.winner;
}

export function legalMovesFor(s, from) {
  const p = s.board[from];
  if (!p || p.stun > 0) return [];
  if (s.movedIds.includes(p.id) && !s.blitzActive) return [];
  return pieceMoves(s, from);
}

// targets for piece abilities
export function abilityTargets(s, from) {
  const p = s.board[from];
  if (!p || p.cd > 0 || p.stun > 0) return null;
  const [r, c] = rc(from);
  const res = [];
  switch (p.t) {
    case 'P': return p.dug ? null : [from];
    case 'N':
      for (const [dr, dc] of [[1, 2], [2, 1], [-1, 2], [-2, 1], [1, -2], [2, -1], [-1, -2], [-2, -1], [1, 0], [-1, 0], [0, 1], [0, -1]]) {
        if (!inB(r + dr, c + dc)) continue;
        const t = sq(r + dr, c + dc);
        if (s.board[t] && s.board[t].s !== p.s) res.push(t);
      }
      return res;
    case 'B':
      for (let i = 0; i < 64; i++) if (cheb(i, from) <= 3 && i !== from) res.push(i);
      return res;
    case 'R':
      for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        for (let k = 1; k <= 4; k++) {
          if (!inB(r + dr * k, c + dc * k)) break;
          const t = sq(r + dr * k, c + dc * k);
          if (s.board[t]) { if (s.board[t].s !== p.s) res.push(t); break; }
        }
      }
      return res;
    case 'Q':
      for (let i = 0; i < 64; i++) if (cheb(i, from) <= 2 && s.board[i] && s.board[i].s !== p.s) res.push(i);
      return res;
    case 'K':
      for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
        if (inB(r + dr, c + dc) && !s.board[sq(r + dr, c + dc)]) res.push(sq(r + dr, c + dc));
      }
      return res;
  }
  return null;
}

export function shopTargets(s, side, item) {
  const terr = territory(s);
  const res = [];
  const home = side === 'w' ? [0, 1] : [7, 6];
  switch (SHOP[item].target) {
    case 'deploy':
      for (const r of home) for (let c = 0; c < 8; c++) if (!s.board[sq(r, c)]) res.push(sq(r, c));
      return res;
    case 'deployBack':
      for (let c = 0; c < 8; c++) if (!s.board[sq(home[0], c)]) res.push(sq(home[0], c));
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
  const it = SHOP[item];
  if (s.money[side] < it.price) return 'Не хватает денег';
  if (it.action && s.actionsLeft <= 0) return 'Нет действий';
  if (item === 'factory' && s.factories[side] >= 4) return 'Максимум заводов';
  if (item === 'ew' && s.ew[side]) return 'РЭБ уже есть';
  if (item === 'blitz' && s.blitzCd[side] > 0) return `Перезарядка ${s.blitzCd[side]}`;
  if (item === 'drone' && s.droneCd && s.droneCd[side] > 0) return `Перезарядка ${s.droneCd[side]}`;
  if (it.target) {
    const t = shopTargets(s, side, item);
    if (!t || !t.length) return 'Нет места';
  }
  return null;
}

// ---------- Damage helpers ----------

function damagePiece(s, i, dmg, src) {
  const p = s.board[i];
  if (!p) return false;
  let eff = p.dug ? Math.round(dmg * 0.7) : dmg;
  if (p.t === 'K') eff = Math.round(eff * 0.5); // bunker
  p.hp -= eff;
  fx(s, { k: 'dmg', sq: i, v: eff });
  if (p.hp <= 0) {
    killPiece(s, i, src);
    return true;
  }
  return false;
}

function killPiece(s, i, bySide) {
  const p = s.board[i];
  if (!p) return;
  s.board[i] = null;
  fx(s, { k: 'boom', sq: i, big: p.t === 'R' || p.t === 'Q' });
  if (bySide && bySide !== p.s) s.stats[bySide].kills++;
  addLog(s, `${SIDE_NAME[p.s]}: ${UNITS[p.t].name} уничтожен.`);
  if (p.t === 'K') {
    s.winner = other(p.s);
    s.phase = 'over';
    addLog(s, `ПОБЕДА: ${SIDE_NAME[s.winner]}!`);
  }
}

// ---------- Commands ----------
// apply(s, side, cmd) mutates state, returns error string or null.

export function apply(s, side, cmd) {
  if (s.winner) return 'Игра окончена';
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
    if (m.capture) {
      startDuel(s, cmd.from, cmd.to);
    } else {
      doMove(s, cmd.from, cmd.to, m.rail);
      afterAction(s);
    }
    return null;
  }

  if (cmd.c === 'ability') {
    if (s.actionsLeft <= 0) return 'Нет действий';
    const p = s.board[cmd.from];
    if (!p || p.s !== side) return 'Нет юнита';
    const t = abilityTargets(s, cmd.from);
    if (!t || !t.includes(cmd.target)) return 'Нельзя';
    s.actionsLeft--;
    useAbility(s, cmd.from, cmd.target);
    afterAction(s);
    return null;
  }

  if (cmd.c === 'buy') {
    const err = canBuy(s, side, cmd.item);
    if (err) return err;
    const it = SHOP[cmd.item];
    if (it.target) {
      const t = shopTargets(s, side, cmd.item);
      if (!t.includes(cmd.target)) return 'Неверная цель';
    }
    s.money[side] -= it.price;
    buy(s, side, cmd.item, cmd.target, cmd.sub);
    if (it.action) {
      s.actionsLeft--;
      if (s.phase === 'board') afterAction(s);
    }
    return null;
  }
  return 'Неизвестная команда';
}

function doMove(s, from, to, rail) {
  const p = s.board[from];
  s.board[to] = p;
  s.board[from] = null;
  p.moved = true;
  p.dug = false;
  s.lastMove = { from, to, rail: !!rail };
  if (rail) fx(s, { k: 'rail', from, to });
  // promotion
  const [r] = rc(to);
  if (p.t === 'P' && ((p.s === 'w' && r === 7) || (p.s === 'b' && r === 0))) {
    p.t = 'Q';
    const ratio = p.hp / p.maxHp;
    p.maxHp = UNITS.Q.hp;
    p.hp = Math.max(1, Math.round(UNITS.Q.hp * ratio));
    addLog(s, `${SIDE_NAME[p.s]}: пехотинец получил вертолёт!`);
    fx(s, { k: 'promo', sq: to });
  }
  // mines
  if (s.mines[to] && s.mines[to] !== p.s) {
    const owner = s.mines[to];
    s.mines[to] = null;
    addLog(s, `${SIDE_NAME[p.s]} подорвались на мине!`);
    fx(s, { k: 'mine', sq: to });
    damagePiece(s, to, 60, owner);
  }
}

function useAbility(s, from, target) {
  const p = s.board[from];
  const u = UNITS[p.t];
  p.cd = u.cd;
  switch (p.t) {
    case 'P':
      p.dug = true;
      fx(s, { k: 'dig', sq: from });
      addLog(s, `${SIDE_NAME[p.s]}: пехота окопалась.`);
      break;
    case 'N': {
      const t = s.board[target];
      t.stun = 2;
      fx(s, { k: 'raid', from, to: target });
      addLog(s, `${SIDE_NAME[p.s]}: спецназ провёл рейд — ${UNITS[t.t].name} оглушён.`);
      damagePiece(s, target, 25, p.s);
      break;
    }
    case 'B': {
      fx(s, { k: 'arty', from, to: target });
      addLog(s, `${SIDE_NAME[p.s]}: артиллерийский удар!`);
      const [tr, tc] = rc(target);
      const hits = [];
      for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
        if (!inB(tr + dr, tc + dc)) continue;
        const i = sq(tr + dr, tc + dc);
        const q = s.board[i];
        if (q && q.s !== p.s) hits.push([i, dr === 0 && dc === 0 ? 50 : 15]);
      }
      for (const [i, d] of hits) damagePiece(s, i, d, p.s);
      break;
    }
    case 'R':
      fx(s, { k: 'shell', from, to: target });
      addLog(s, `${SIDE_NAME[p.s]}: танк ведёт огонь с места.`);
      damagePiece(s, target, s.board[target].t === 'R' ? 40 : 55, p.s);
      break;
    case 'Q': {
      fx(s, { k: 'rockets', from, to: target });
      addLog(s, `${SIDE_NAME[p.s]}: ракетный залп вертолёта!`);
      const [tr, tc] = rc(target);
      const hits = [];
      for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
        if (!inB(tr + dr, tc + dc)) continue;
        const i = sq(tr + dr, tc + dc);
        const q = s.board[i];
        if (q && q.s !== p.s) hits.push([i, dr === 0 && dc === 0 ? 45 : 15]);
      }
      for (const [i, d] of hits) damagePiece(s, i, d, p.s);
      break;
    }
    case 'K':
      s.board[target] = alloc(s, 'P', p.s);
      fx(s, { k: 'spawn', sq: target });
      addLog(s, `${SIDE_NAME[p.s]}: мобилизация — новый пехотинец.`);
      break;
  }
}

function buy(s, side, item, target, sub) {
  const name = SHOP[item].name;
  switch (item) {
    case 'pawn':
      s.board[target] = alloc(s, 'P', side);
      fx(s, { k: 'spawn', sq: target });
      addLog(s, `${SIDE_NAME[side]}: прибыло подкрепление.`);
      break;
    case 'tank':
      s.board[target] = alloc(s, 'R', side);
      fx(s, { k: 'spawn', sq: target });
      addLog(s, `${SIDE_NAME[side]}: с завода прибыл танк!`);
      break;
    case 'factory':
      s.factories[side]++;
      fx(s, { k: 'factory', side });
      addLog(s, `${SIDE_NAME[side]}: построен завод (${s.factories[side]}).`);
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
      const wantFactory = sub === 'rail' ? false : sub === 'factory' ? true : s.factories[en] > 0;
      if (wantFactory && s.factories[en] > 0) {
        if (Math.random() < 0.55) {
          s.factories[en]--;
          fx(s, { k: 'factoryBoom', side: en });
          addLog(s, `${SIDE_NAME[side]}: диверсия удалась — вражеский завод взорван!`);
        } else {
          addLog(s, `${SIDE_NAME[side]}: диверсанты схвачены у завода.`);
        }
      } else if (enemyRails.length) {
        for (let k = 0; k < 3 && enemyRails.length; k++) {
          const j = enemyRails.splice(Math.floor(Math.random() * enemyRails.length), 1)[0];
          s.rails[j] = null;
          fx(s, { k: 'boom', sq: j });
        }
        addLog(s, `${SIDE_NAME[side]}: подорваны вражеские железные дороги!`);
      } else {
        // steal money instead
        const st = Math.min(60, s.money[en]);
        s.money[en] -= st;
        s.money[side] += st;
        addLog(s, `${SIDE_NAME[side]}: диверсанты ограбили склад (+${st}).`);
      }
      break;
    }
    case 'airstrike': {
      fx(s, { k: 'air', sq: target, side });
      addLog(s, `${SIDE_NAME[side]}: авиаудар!`);
      const [tr, tc] = rc(target);
      for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
        if (!inB(tr + dr, tc + dc)) continue;
        const i = sq(tr + dr, tc + dc);
        if (s.board[i] && s.board[i].s !== side) damagePiece(s, i, 45, side);
      }
      break;
    }
    case 'drone': {
      s.stats[side].drones++;
      s.droneCd[side] = 2;
      s.phase = 'drone';
      s.rt = { kind: 'drone', side, seed: Math.floor(Math.random() * 1e9), ew: s.ew[other(side)] };
      addLog(s, `${SIDE_NAME[side]}: запуск FPV-дрона!`);
      break;
    }
  }
  void name;
}

function afterAction(s) {
  if (s.winner) return;
  if (s.actionsLeft <= 0 && s.phase === 'board') endTurn(s);
}

export function endTurn(s) {
  if (s.winner) return;
  const prev = s.turn;
  s.turn = other(prev);
  if (s.turn === 'w') s.turnNo++;
  if (s.turnNo > MAX_TURNS) { endByScore(s); return; }
  s.movedIds = [];
  s.blitzActive = false;
  s.actionsLeft = 1;
  const side = s.turn;
  const terr = territory(s);
  const sup = supplyMap(s, terr);
  const inc = income(s, side, terr);
  s.money[side] += inc;
  if (s.blitzCd[side] > 0) s.blitzCd[side]--;
  if (s.droneCd[side] > 0) s.droneCd[side]--;
  s.board.forEach((p, i) => {
    if (!p || p.s !== side) return;
    if (p.cd > 0) p.cd--;
    if (p.stun > 0) p.stun--;
    if (sup[side][i] && p.hp < p.maxHp) p.hp = Math.min(p.maxHp, p.hp + 15);
  });
  // stun counts down on the turn of the owner; enemy pieces' stun applied on their turn
  fx(s, { k: 'turn', side });
}

export function score(s, side) {
  const terr = territory(s);
  let pts = terr.filter((o) => o === side).length * 2 + s.factories[side] * 5;
  s.board.forEach((p) => { if (p && p.s === side && p.t !== 'K') pts += UNITS[p.t].value * 3 * (p.hp / p.maxHp); });
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
  const [r, c] = rc(sqTarget);
  let n = 0;
  for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
    if (!dr && !dc) continue;
    if (!inB(r + dr, c + dc)) continue;
    const i = sq(r + dr, c + dc);
    if (i === exclude) continue;
    const p = s.board[i];
    if (p && p.s === side) n++;
  }
  return Math.min(2, n);
}

function startDuel(s, from, to) {
  const a = s.board[from], d = s.board[to];
  const terr = territory(s);
  const sup = supplyMap(s, terr);
  s.phase = 'duel';
  s.rt = {
    kind: 'duel',
    from, to,
    att: { t: a.t, s: a.s, hp: a.hp, maxHp: a.maxHp, supplied: sup[a.s][from], allies: duelSupport(s, to, a.s, from) },
    def: { t: d.t, s: d.s, hp: d.hp, maxHp: d.maxHp, supplied: sup[d.s][to], dug: d.dug, allies: duelSupport(s, to, d.s, to) },
    seed: Math.floor(Math.random() * 1e9),
  };
  addLog(s, `БОЙ: ${UNITS[a.t].name} (${SIDE_NAME[a.s]}) атакует ${UNITS[d.t].name}!`);
  if (s.autoDuel) {
    finishDuel(s, autoResolve(s.rt));
  }
}

const POWER = { P: 1, N: 1.25, B: 1.1, R: 1.6, Q: 1.8, K: 1.0 };

export function autoResolve(rt) {
  const pa = rt.att.hp * POWER[rt.att.t] * (rt.att.supplied ? 1 : 0.75) * (1 + 0.25 * rt.att.allies);
  const pd = rt.def.hp * POWER[rt.def.t] * (rt.def.supplied ? 1 : 0.75) * (rt.def.dug ? 1.5 : 1) * (1 + 0.25 * rt.def.allies) * 1.1;
  const pw = pa / (pa + pd);
  const attWins = Math.random() < pw;
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
  if (res.winner === 'att') {
    s.stats[a.s].duelsWon++;
    a.hp = Math.max(1, Math.min(a.maxHp, Math.round(res.attHp)));
    s.board[rt.to] = null;
    fx(s, { k: 'boom', sq: rt.to, big: d.t === 'R' || d.t === 'Q' });
    s.stats[a.s].kills++;
    addLog(s, `${SIDE_NAME[a.s]} победили в бою! ${UNITS[d.t].name} уничтожен.`);
    if (d.t === 'K') {
      s.board[rt.to] = a;
      s.board[rt.from] = null;
      s.winner = a.s;
      s.phase = 'over';
      addLog(s, `ГЕНЕРАЛ ПОВЕРЖЕН. ПОБЕДА: ${SIDE_NAME[a.s]}!`);
      return;
    }
    doMove(s, rt.from, rt.to, false);
  } else if (res.winner === 'def') {
    s.stats[d.s].duelsWon++;
    s.stats[d.s].kills++;
    d.hp = Math.max(1, Math.min(d.maxHp, Math.round(res.defHp)));
    s.board[rt.from] = null;
    fx(s, { k: 'boom', sq: rt.from, big: a.t === 'R' || a.t === 'Q' });
    addLog(s, `${SIDE_NAME[d.s]} отбили атаку! ${UNITS[a.t].name} уничтожен.`);
    if (a.t === 'K') {
      s.winner = d.s;
      s.phase = 'over';
      addLog(s, `ГЕНЕРАЛ ПОВЕРЖЕН. ПОБЕДА: ${SIDE_NAME[d.s]}!`);
      return;
    }
  } else {
    a.hp = Math.max(1, Math.round(res.attHp));
    d.hp = Math.max(1, Math.round(res.defHp));
    addLog(s, 'Время вышло — атака захлебнулась, войска отошли.');
  }
  afterAction(s);
}

// ---------- Drone ----------
// res: {hits:[{sq, dmg}]}
export function finishDrone(s, res) {
  const rt = s.rt;
  if (!rt || rt.kind !== 'drone') return;
  s.phase = 'board';
  s.rt = null;
  if (!res.hits.length) {
    addLog(s, `${SIDE_NAME[rt.side]}: дрон потерян.`);
  }
  for (const h of res.hits) {
    const p = s.board[h.sq];
    if (!p || p.s === rt.side) continue;
    addLog(s, `${SIDE_NAME[rt.side]}: дрон поразил ${UNITS[p.t].name}!`);
    damagePiece(s, h.sq, h.dmg, rt.side);
  }
  if (res.hits.length) fx(s, { k: 'boom', sq: res.hits[0].sq, big: true });
  afterAction(s);
}

export function clone(s) {
  return JSON.parse(JSON.stringify(s));
}
