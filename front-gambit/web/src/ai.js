// Board-level AI commander (also drives the neutral rebel faction).
import {
  other, rc, sq, inB, cheb, pieceMoves, legalMovesFor, shopTargets, canBuy, territory, supplyMap,
  apply, abilityList, b2Available, unitDef, around, SHOP, duelOdds, inCheck, generalSquare, armyCap, armySize,
} from './rules.js';
import { aiCityChoice, cityScore } from './city.js';
import { CARDS, cardTargets } from './cards.js';
import { ABILITIES } from './abilities.js';

const val = (s, p) => (p.t === 'K' ? 40 : p.t === 'D' ? 12 : unitDef(s, p).value);

function evaluate(s, side) {
  if (s.winner) return s.winner === side ? 1e5 : -1e5;
  let e = 0;
  s.board.forEach((p) => {
    if (!p) return;
    let v = val(s, p) * 10 * (0.35 + 0.65 * p.hp / p.maxHp);
    if (p.stun > 0) v -= 2;
    if (p.st.marked > 0) v -= 1.5;
    if (p.dug) v += 0.8;
    if (p.st.shield > 0) v += 1.2;
    if (p.st.buff > 0) v += 0.3;
    e += p.s === side ? v : -v * (p.s === 'n' ? 0.6 : 1);
  });
  const terr = territory(s);
  const opp = side === 'n' ? null : other(side);
  if (opp && inCheck(s, side)) e -= 35;
  if (opp) {
    e += (terr.filter((o) => o === side).length - terr.filter((o) => o === opp).length) * 0.4;
    e += (s.money[side] - s.money[opp]) * 0.03;
    e += (cityScore(s, side) - cityScore(s, opp)) * 1.2;
    for (let i = 0; i < 64; i++) if (s.rails[i] === side) e += 0.3;
  }
  return e;
}

function simulate(s, side, cmd) {
  const c = JSON.parse(JSON.stringify(s));
  c.seed = (c.seed ^ Math.floor(Math.random() * 1e9)) >>> 0;
  c.actionsLeft = 9;
  c.autoDuel = true;
  if (apply(c, side, cmd)) return null;
  return evaluate(c, side);
}

function threatMap(s, side) {
  const t = new Array(64).fill(0);
  s.board.forEach((p, i) => {
    if (!p || p.s !== side) return;
    if (unitDef(s, p).move === 'pawn' && p.s !== 'n') {
      const [r, c] = rc(i);
      const d = side === 'w' ? 1 : -1;
      for (const dc of [-1, 1]) if (inB(r + d, c + dc)) t[sq(r + d, c + dc)]++;
      return;
    }
    for (const m of pieceMoves(s, i)) t[m.to]++;
    // protection of own pieces nearby
    for (const j of around(i)) if (s.board[j] && s.board[j].s === side) t[j] += 0.5;
  });
  return t;
}

function winProb(s, from, to, sup) { return duelOdds(s, from, to, sup); }

// would the general of `side` be attacked after moving from -> to (non-capture)?
function exposesGeneral(s, side, from, to) {
  const a = s.board[from], b = s.board[to];
  s.board[to] = a; s.board[from] = null;
  const r = inCheck(s, side);
  s.board[from] = a; s.board[to] = b;
  return r;
}

const turnBuys = { key: '', n: 0 };

export function aiChoose(s, side, difficulty = 1) {
  if (side === 'n') return neutralChoose(s);
  const noise = [3.5, 1.5, 0.4][difficulty];
  const R = () => (Math.random() - 0.5) * noise;
  const en = other(side);
  const key = s.turnNo + side;
  if (turnBuys.key !== key) { turnBuys.key = key; turnBuys.n = 0; }

  // card offer: take the first useful one
  if (s.offer[side]) return { c: 'pick', card: s.offer[side][Math.floor(Math.random() * s.offer[side].length)] };

  const terr = territory(s);
  const sup = supplyMap(s, terr);
  const enemyThreat = threatMap(s, en);
  const ownThreat = threatMap(s, side);
  const money = s.money[side];
  const pieces = [];
  s.board.forEach((p, i) => { if (p && p.s === side) pieces.push(i); });
  const enemies = [];
  s.board.forEach((p, i) => { if (p && p.s !== side) enemies.push(i); });
  const base = evaluate(s, side);

  // ---- purchases (free) ----
  if (turnBuys.n < 3) {
    const tryBuy = (item, target, sub) => {
      if (canBuy(s, side, item)) return null;
      turnBuys.n++;
      return { c: 'buy', item, target, sub };
    };
    const count = (t) => pieces.filter((i) => s.board[i].t === t).length;
    const pick = (item) => { const t = shopTargets(s, side, item); return t && t.length ? t.sort((x, y) => enemyThreat[x] - enemyThreat[y])[0] : null; };
    let b = null;
    const city = aiCityChoice(s, side);
    if (city) { turnBuys.n++; return city; }
    if (!b && s.stats[en].drones > 0 && !s.ew[side] && money >= 90) b = tryBuy('ew');
    if (!b && count('P') < 4 && money >= 60 && armySize(s, side) < armyCap(s, side)) b = tryBuy('pawn', pick('pawn'));
    if (!b && count('M') < 1 && s.turnNo > 6 && money >= 110) b = tryBuy('medic', pick('medic'));
    if (!b && count('A') < 1 && (s.stats[en].drones > 1 || enemies.some((i) => s.board[i].t === 'Q')) && money >= 170 && s.turnNo > 8) b = tryBuy('aa', pick('aa'));
    if (!b && count('L') < 1 && money >= 230 && s.turnNo > 10) b = tryBuy('mlrs', pick('mlrs'));
    if (!b && count('E') < 1 && money >= 160 && s.turnNo > 5 && Math.random() < 0.3) b = tryBuy('engineer', pick('engineer'));
    if (!b && count('T') < 1 && money >= 280 && Math.random() < 0.4) b = tryBuy('train', pick('train'));
    if (!b && money >= 300 && s.turnNo > 6 && Math.random() < 0.4) b = tryBuy('tank', pick('tank'));
    if (!b && money >= 260) {
      const customs = Object.keys(s.customDefs || {});
      if (customs.length && Math.random() < 0.35) {
        const item = 'custom:' + customs[Math.floor(Math.random() * customs.length)];
        if (!canBuy(s, side, item)) b = tryBuy(item, pick('pawn'));
      }
    }
    if (!b && money >= 230 && s.city[en].filter((x) => x).length > 2 && Math.random() < 0.3) b = tryBuy('sabotage', null, 'factory');
    if (!b && money >= 200 && Math.random() < 0.25) {
      const t = (shopTargets(s, side, 'mine') || []).filter((i) => { const [r] = rc(i); return side === 'w' ? r >= 2 && r <= 4 : r >= 3 && r <= 5; });
      if (t.length) b = tryBuy('mine', t[Math.floor(Math.random() * t.length)]);
    }
    if (!b && money >= 220 && Math.random() < 0.35) {
      const t = (shopTargets(s, side, 'rail') || []).filter((i) => { const [r] = rc(i); return side === 'w' ? r <= 2 : r >= 5; });
      if (t.length) b = tryBuy('rail', t[Math.floor(Math.random() * t.length)]);
    }
    if (b) return b;
  }

  const cands = [];
  // ---- cards (free) ----
  for (const id of s.hands[side]) {
    const tg = cardTargets(s, side, id);
    const list = tg === null ? [undefined] : tg.slice(0, 64).filter((i) => CARDS[id].target !== 'any' || around(i, 1, true).some((j) => s.board[j] && s.board[j].s !== side));
    for (const t of list.slice(0, 24)) {
      const v = simulate(s, side, { c: 'card', card: id, target: t });
      if (v !== null && v - base > 3) return { c: 'card', card: id, target: t };
    }
  }

  // ---- moves ----
  const enemyKing = s.board.findIndex((p) => p && p.s === en && p.t === 'K');
  const myKing = generalSquare(s, side);
  const checked = inCheck(s, side);
  for (const from of pieces) {
    const p = s.board[from];
    const v = val(s, p);
    const threatenedNow = enemyThreat[from] > 0;
    for (const m of legalMovesFor(s, from)) {
      let sc = 0;
      if (m.capture) {
        const d = s.board[m.to];
        const wp = winProb(s, from, m.to, sup);
        sc += wp * val(s, d) * 10 - (1 - wp) * v * 10 + 6 + Math.min(8, s.turnNo / 5);
        if (d.t === 'K') sc += wp * 60;
        // the general only attacks when it is nearly a sure thing — losing him loses the war
        if (p.t === 'K') sc -= (1 - wp) * 400 + (wp < 0.85 ? 120 : 0);
        if (checked && d && d.s !== side && pieceMoves(s, m.to).some((x) => x.to === myKing && x.capture)) sc += 40 * wp;
      } else {
        const [r, c] = rc(m.to);
        const adv = side === 'w' ? r : 7 - r;
        if (p.t === 'P') sc += adv * 0.6 + (adv >= 6 ? 6 : 0);
        else if (p.t !== 'K') sc += adv * 0.15;
        sc += (3.5 - Math.abs(c - 3.5)) * 0.15;
        if (p.t === 'K') sc -= 2 + adv;
        if (s.turnNo > 12 && p.t !== 'K' && enemyKing >= 0) sc += (cheb(from, enemyKing) - cheb(m.to, enemyKing)) * Math.min(3, s.turnNo / 12);
        const kp = s.keypoints.find((k) => k.sq === m.to);
        if (kp && kp.owner !== side) sc += 5;
        if (s.loot[m.to] > 0) sc += 6;
        if (s.sqfx[m.to] && (s.sqfx[m.to].fire || s.sqfx[m.to].gas)) sc -= 4;
      }
      if (enemyThreat[m.to] > 0) sc -= v * 10 * (ownThreat[m.to] > 0 ? 0.25 : 0.55);
      if (!m.capture) {
        const exposed = exposesGeneral(s, side, from, m.to);
        if (p.t === 'K' && exposed) sc -= 150;
        else if (exposed && !checked) sc -= 60;
        if (checked && !exposed) sc += 45;
        if (checked && exposed) sc -= 50;
      }
      if (threatenedNow && enemyThreat[m.to] === 0) sc += v * 10 * 0.45;
      cands.push({ sc: sc + 1.5 + R(), cmd: { c: 'move', from, to: m.to } });
    }
    // ---- abilities: simulated ----
    for (const ab of abilityList(s, from)) {
      if (!ab.targets.length) continue;
      const A = ABILITIES[ab.id];
      let tg = ab.targets;
      if (A.harm) tg = tg.filter((t) => around(t, 1, true).some((j) => s.board[j] && s.board[j].s !== side));
      if (tg.length > 16) tg = tg.sort(() => Math.random() - 0.5).slice(0, 16);
      for (const t of tg) {
        const v2 = simulate(s, side, { c: 'ability', from, id: ab.id, target: t });
        if (v2 === null) continue;
        let gain = v2 - base;
        if (!A.harm) gain -= 0.5; // prefer real progress over utility
        cands.push({ sc: gain + R(), cmd: { c: 'ability', from, id: ab.id, target: t } });
      }
    }
  }
  // ---- drone ----
  if (s.money[side] >= 110 && enemies.length && !canBuy(s, side, 'drone')) {
    let best = 0;
    for (const i of enemies) {
      const p = s.board[i];
      const dmg = p.t === 'R' ? 120 : p.t === 'Q' ? 95 : p.t === 'K' ? 40 : 80;
      best = Math.max(best, val(s, p) * (dmg / 60) + (p.hp <= dmg ? val(s, p) * 8 : 0));
    }
    cands.push({ sc: best * (s.ew[en] ? 0.6 : 0.85) + R() - 4, cmd: { c: 'buy', item: 'drone' } });
  }
  // ---- airstrike / B-2 ----
  const areaTargets = enemies.filter(() => true);
  if (s.money[side] >= 200 && !canBuy(s, side, 'airstrike')) {
    for (const t of areaTargets) {
      const v2 = simulate(s, side, { c: 'buy', item: 'airstrike', target: t });
      if (v2 !== null) cands.push({ sc: v2 - base - 10 + R(), cmd: { c: 'buy', item: 'airstrike', target: t } });
    }
  }
  if (b2Available(s, side)) {
    for (const t of areaTargets) {
      const v2 = simulate(s, side, { c: 'b2', target: t });
      if (v2 !== null) cands.push({ sc: v2 - base + R(), cmd: { c: 'b2', target: t } });
    }
  }
  cands.sort((a, b) => b.sc - a.sc);
  if (s.blitzCd[side] === 0 && s.money[side] >= 160 && cands.length > 2 && cands[0].sc > 12 && cands[1].sc > 8 && !canBuy(s, side, 'blitz') && turnBuys.n < 4) {
    turnBuys.n++;
    return { c: 'buy', item: 'blitz' };
  }
  if (!cands.length || cands[0].sc < -15) return { c: 'end' };
  void SHOP;
  return cands[0].cmd;
}

function neutralChoose(s) {
  const mine = [];
  s.board.forEach((p, i) => { if (p && p.s === 'n') mine.push(i); });
  let best = null, bs = -1e9;
  const sup = { w: new Array(64).fill(true), b: new Array(64).fill(true) };
  for (const from of mine) {
    const p = s.board[from];
    for (const m of legalMovesFor(s, from)) {
      let sc;
      if (m.capture) sc = winProb(s, from, m.to, sup) * val(s, s.board[m.to]) * 10 + 5;
      else {
        let nd = 99;
        s.board.forEach((q, j) => { if (q && q.s !== 'n') nd = Math.min(nd, cheb(m.to, j)); });
        sc = -nd + Math.random();
      }
      if (sc > bs) { bs = sc; best = { c: 'move', from, to: m.to }; }
    }
    for (const ab of abilityList(s, from)) {
      if (ab.targets.length && (ab.id === 'mobilize' || ABILITIES[ab.id].harm)) {
        const sc = ab.id === 'mobilize' ? 6 : 4;
        if (sc > bs) { bs = sc; best = { c: 'ability', from, id: ab.id, target: ab.targets[0] }; }
      }
    }
    void p;
  }
  return best || { c: 'end' };
}
