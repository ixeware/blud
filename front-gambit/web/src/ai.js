// Board-level AI commander.
import {
  UNITS, SHOP, other, rc, sq, inB, cheb, pieceMoves, legalMovesFor, abilityTargets,
  shopTargets, canBuy, territory, supplyMap, duelSupport,
} from './rules.js';

const VAL = { P: 1, N: 3, B: 3, R: 5, Q: 9, K: 40 };
const POWER = { P: 1, N: 1.25, B: 1.1, R: 1.6, Q: 1.8, K: 1.0 };

function threatMap(s, side) {
  // squares that `side` can strike next turn
  const t = new Array(64).fill(0);
  s.board.forEach((p, i) => {
    if (!p || p.s !== side) return;
    if (p.t === 'P') {
      const [r, c] = rc(i);
      const d = side === 'w' ? 1 : -1;
      for (const dc of [-1, 1]) if (inB(r + d, c + dc)) t[sq(r + d, c + dc)]++;
      return;
    }
    // treat all own pieces as empty to see defended squares too
    const fake = { ...s, board: s.board.slice() };
    for (const m of pieceMoves(fake, i)) t[m.to]++;
    // squares protected (own pieces): recompute sliding ignoring own color stop
    const [r, c] = rc(i);
    const dirs = p.t === 'N' ? [[1, 2], [2, 1], [-1, 2], [-2, 1], [1, -2], [2, -1], [-1, -2], [-2, -1]]
      : p.t === 'B' ? [[1, 1], [1, -1], [-1, 1], [-1, -1]]
        : p.t === 'R' ? [[1, 0], [-1, 0], [0, 1], [0, -1]]
          : [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
    const max = p.t === 'N' || p.t === 'K' ? 1 : 8;
    for (const [dr, dc] of dirs) {
      for (let k = 1; k <= max; k++) {
        const nr = r + dr * k, nc = c + dc * k;
        if (!inB(nr, nc)) break;
        const j = sq(nr, nc);
        if (s.board[j]) { if (s.board[j].s === side) t[j]++; break; }
      }
    }
  });
  return t;
}

function winProb(s, from, to, sup) {
  const a = s.board[from], d = s.board[to];
  const pa = a.hp * POWER[a.t] * (sup[a.s][from] ? 1 : 0.75) * (1 + 0.25 * duelSupport(s, to, a.s, from));
  const pd = d.hp * POWER[d.t] * (sup[d.s][to] ? 1 : 0.75) * (d.dug ? 1.5 : 1) * (1 + 0.25 * duelSupport(s, to, d.s, to)) * 1.1;
  return pa / (pa + pd);
}

const turnBuys = { key: '', n: 0 };

export function aiChoose(s, side, difficulty = 1) {
  const noise = [3.5, 1.5, 0.4][difficulty];
  const R = () => (Math.random() - 0.5) * noise;
  const en = other(side);
  const key = s.turnNo + side;
  if (turnBuys.key !== key) { turnBuys.key = key; turnBuys.n = 0; }

  const terr = territory(s);
  const sup = supplyMap(s, terr);
  const enemyThreat = threatMap(s, en);
  const ownThreat = threatMap(s, side);
  const money = s.money[side];
  const pieces = [];
  s.board.forEach((p, i) => { if (p && p.s === side) pieces.push(i); });
  const enemies = [];
  s.board.forEach((p, i) => { if (p && p.s === en) enemies.push(i); });

  // ---- purchases (free) ----
  if (turnBuys.n < 3) {
    const tryBuy = (item, target, sub) => {
      if (canBuy(s, side, item)) return null;
      turnBuys.n++;
      return { c: 'buy', item, target, sub };
    };
    const pawns = pieces.filter((i) => s.board[i].t === 'P').length;
    let b = null;
    if (!b && s.factories[side] < 3 && money >= 140 && s.turnNo <= 20) b = tryBuy('factory');
    if (!b && s.stats[en].drones > 0 && !s.ew[side] && money >= 90) b = tryBuy('ew');
    if (!b && pawns < 4 && money >= 60) {
      const t = shopTargets(s, side, 'pawn');
      if (t && t.length) b = tryBuy('pawn', t.sort((x, y) => enemyThreat[x] - enemyThreat[y])[0]);
    }
    if (!b && money >= 280 && s.turnNo > 6 && Math.random() < 0.5) {
      const t = shopTargets(s, side, 'tank');
      if (t && t.length) b = tryBuy('tank', t[Math.floor(Math.random() * t.length)]);
    }
    if (!b && money >= 230 && s.factories[en] > 1 && Math.random() < 0.35) b = tryBuy('sabotage', null, 'factory');
    if (!b && money >= 200 && Math.random() < 0.3) {
      const t = (shopTargets(s, side, 'mine') || []).filter((i) => {
        const [r] = rc(i);
        return side === 'w' ? r >= 2 && r <= 4 : r >= 3 && r <= 5;
      });
      if (t.length) b = tryBuy('mine', t[Math.floor(Math.random() * t.length)]);
    }
    if (!b && money >= 260 && Math.random() < 0.3) {
      const t = (shopTargets(s, side, 'rail') || []).filter((i) => {
        const [r] = rc(i);
        return side === 'w' ? r <= 2 : r >= 5;
      });
      if (t.length) b = tryBuy('rail', t[Math.floor(Math.random() * t.length)]);
    }
    if (b) return b;
  }

  // ---- actions ----
  const cands = [];
  const enemyKing = s.board.findIndex((p) => p && p.s === en && p.t === 'K');
  for (const from of pieces) {
    const p = s.board[from];
    const v = VAL[p.t];
    const threatenedNow = enemyThreat[from] > 0;
    for (const m of legalMovesFor(s, from)) {
      let sc = 0;
      if (m.capture) {
        const d = s.board[m.to];
        const wp = winProb(s, from, m.to, sup);
        sc += wp * VAL[d.t] * 10 - (1 - wp) * v * 10 + 4 + Math.min(6, s.turnNo / 6);
        if (d.t === 'K') sc += wp * 60;
      } else {
        const [r] = rc(m.to);
        const adv = side === 'w' ? r : 7 - r;
        if (p.t === 'P') sc += adv * 0.6 + (adv >= 6 ? 6 : 0);
        else if (p.t !== 'K') sc += adv * 0.15;
        const [, c] = rc(m.to);
        sc += (3.5 - Math.abs(c - 3.5)) * 0.15;
        if (p.t === 'K') sc -= 2 + adv;
        // later in the war push toward the enemy HQ
        if (s.turnNo > 12 && p.t !== 'K' && enemyKing >= 0) {
          sc += (cheb(from, enemyKing) - cheb(m.to, enemyKing)) * Math.min(3, s.turnNo / 12);
        }
        if (s.mines[m.to] === en) sc -= 0; // AI cannot see enemy mines
      }
      if (enemyThreat[m.to] > 0) {
        const defended = ownThreat[m.to] > 0;
        sc -= v * 10 * (defended ? 0.25 : 0.55);
      }
      if (threatenedNow && enemyThreat[m.to] === 0) sc += v * 10 * 0.45;
      if (!s.movedIds.includes(p.id) && p.t !== 'K') sc += 0.3;
      cands.push({ sc: sc + R(), cmd: { c: 'move', from, to: m.to } });
    }
    const at = abilityTargets(s, from);
    if (at && at.length) {
      for (const t of at) {
        let sc = -1;
        const q = s.board[t];
        switch (p.t) {
          case 'P': sc = threatenedNow ? 4 : 0.5; break;
          case 'N': if (q) sc = VAL[q.t] * 2.5 + (q.hp <= 25 ? VAL[q.t] * 10 : 0); break;
          case 'R': if (q) sc = VAL[q.t] * 3 + (q.hp <= 55 ? VAL[q.t] * 10 : 0); break;
          case 'B':
          case 'Q': {
            const [tr, tc] = rc(t);
            sc = -1;
            for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
              if (!inB(tr + dr, tc + dc)) continue;
              const x = s.board[sq(tr + dr, tc + dc)];
              if (!x) continue;
              const dmg = dr === 0 && dc === 0 ? 45 : 15;
              if (x.s === en) sc += VAL[x.t] * (dmg / 25) + (x.hp <= dmg ? VAL[x.t] * 10 : 0);
            }
            break;
          }
          case 'K': sc = enemyThreat[t] ? -2 : pieces.length < 12 ? 2.5 : 0.2; break;
        }
        cands.push({ sc: sc + R(), cmd: { c: 'ability', from, target: t } });
      }
    }
  }
  // drone strike
  if (money >= 70 + 40 && enemies.length && !canBuy(s, side, 'drone')) {
    let best = 0;
    for (const i of enemies) {
      const p = s.board[i];
      const dmg = p.t === 'R' ? 120 : p.t === 'Q' ? 95 : p.t === 'K' ? 40 : 80;
      const val = VAL[p.t] * (dmg / 60) + (p.hp <= dmg ? VAL[p.t] * 8 : 0);
      best = Math.max(best, val);
    }
    const ew = s.ew[en] ? 0.6 : 0.85;
    cands.push({ sc: best * ew + R() - 4, cmd: { c: 'buy', item: 'drone' } });
  }
  // airstrike
  if (money >= 130 + 50) {
    for (let i = 0; i < 64; i++) {
      const [tr, tc] = rc(i);
      let sc = -8;
      for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
        if (!inB(tr + dr, tc + dc)) continue;
        const x = s.board[sq(tr + dr, tc + dc)];
        if (x && x.s === en) sc += VAL[x.t] * 1.8 + (x.hp <= 45 ? VAL[x.t] * 9 : 0);
      }
      if (sc > 0) cands.push({ sc: sc + R(), cmd: { c: 'buy', item: 'airstrike', target: i } });
    }
  }
  cands.sort((a, b) => b.sc - a.sc);
  // blitzkrieg if several strong options
  if (s.blitzCd[side] === 0 && money >= 100 + 60 && cands.length > 2 && cands[0].sc > 12 && cands[1].sc > 8 && !canBuy(s, side, 'blitz') && turnBuys.n < 4) {
    turnBuys.n++;
    return { c: 'buy', item: 'blitz' };
  }
  if (!cands.length || cands[0].sc < -15) return { c: 'end' };
  void cheb; void SHOP; void UNITS;
  return cands[0].cmd;
}
