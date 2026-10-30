// Order cards: drawn every 3rd turn, played for free.
import { rc, sq, inB, around, fx, addLog, damagePiece, heal, spawn, gainXp, rnd, pick, SIDE_NAME, other, territory } from './core.js';
import { unitDef } from './units.js';

function homeEmpty(s, side, rows = 2) {
  const rs = side === 'w' ? [0, 1, 2].slice(0, rows) : [7, 6, 5].slice(0, rows);
  const out = [];
  for (const r of rs) for (let c = 0; c < 8; c++) if (!s.board[sq(r, c)]) out.push(sq(r, c));
  return out;
}
const own = (s, side) => s.board.map((p, i) => (p && p.s === side ? i : -1)).filter((i) => i >= 0);
const enemies = (s, side) => s.board.map((p, i) => (p && p.s !== side ? i : -1)).filter((i) => i >= 0);

export function airDefended(s, side, i) {
  // decoys and EW zones of the defender negate air attacks
  return s.ewZones.some((z) => z.side === side && Math.max(Math.abs(rc(z.sq)[0] - rc(i)[0]), Math.abs(rc(z.sq)[1] - rc(i)[1])) <= 2);
}

export function airStrikeArea(s, side, target, dmg, squares) {
  const en = other(side);
  if (s.decoy[en] > 0) {
    s.decoy[en] = 0;
    addLog(s, `${SIDE_NAME[side]}: удар пришёлся по ложным целям!`);
    fx(s, { k: 'decoy', sq: target });
    return;
  }
  for (const i of squares) {
    const q = s.board[i];
    if (!q || q.s === side) continue;
    if (airDefended(s, q.s, i)) { fx(s, { k: 'ew', sq: i }); continue; }
    damagePiece(s, i, dmg, { side, kind: 'air' });
  }
}

export const CARDS = {
  c_smoke: { name: 'Дымовая завеса', target: 'any', desc: 'Дым 3×3 на 2 хода в любом месте.',
    apply: (s, side, t) => { fx(s, { k: 'smoke', sq: t }); for (const i of around(t, 1, true)) { s.sqfx[i] = s.sqfx[i] || {}; s.sqfx[i].smoke = 2; } } },
  c_counter: { name: 'Контрудар', target: null, desc: 'В этом ходу ваши бойцы наносят +30% урона в боях.',
    apply: (s, side) => { s.effects.counter[side] = 1; } },
  c_reserves: { name: 'Резервы', target: null, desc: 'Два пехотинца на ваших задних рядах.',
    apply: (s, side) => { const e = homeEmpty(s, side); for (let k = 0; k < 2 && e.length; k++) spawn(s, e.splice(Math.floor(rnd(s) * e.length), 1)[0], 'P', side); } },
  c_camo: { name: 'Маскировка', target: 'own', desc: 'Ваш юнит невидим для дальних ударов 3 хода.',
    apply: (s, side, t) => { s.board[t].st.stealth = 3; fx(s, { k: 'ring', sq: t, c: 'green' }); } },
  c_loot: { name: 'Трофейный обоз', target: null, desc: '+100 денег.',
    apply: (s, side) => { s.money[side] += 100; } },
  c_march: { name: 'Ускоренный марш', target: null, desc: '+1 действие в этом ходу.',
    apply: (s) => { s.actionsLeft += 1; } },
  c_hospital: { name: 'Госпиталь', target: null, desc: 'Все ваши юниты +25 HP.',
    apply: (s, side) => { for (const i of own(s, side)) heal(s, i, 25); } },
  c_partisans: { name: 'Партизаны', target: null, desc: 'Пехотинец появляется в тылу врага.',
    apply: (s, side) => {
      const rows = side === 'w' ? [4, 5, 6] : [1, 2, 3];
      const opts = [];
      for (const r of rows) for (let c = 0; c < 8; c++) {
        const i = sq(r, c);
        if (!s.board[i] && !around(i).some((j) => s.board[j] && s.board[j].t === 'K' && s.board[j].s !== side)) opts.push(i);
      }
      if (opts.length) spawn(s, pick(s, opts), 'P', side); else s.money[side] += 60;
    } },
  c_artprep: { name: 'Артподготовка', target: null, desc: 'Три случайных вражеских юнита получают по 30 урона.',
    apply: (s, side) => {
      const e = enemies(s, side);
      for (let k = 0; k < 3 && e.length; k++) { const i = e.splice(Math.floor(rnd(s) * e.length), 1)[0]; fx(s, { k: 'arty', from: -1, to: i }); damagePiece(s, i, 30, { side, kind: 'arty' }); }
    } },
  c_minefield: { name: 'Минное поле', target: null, desc: 'Три мины на своей территории у линии фронта.',
    apply: (s, side) => {
      const terr = territory(s);
      const opts = [];
      for (let i = 0; i < 64; i++) if (terr[i] === side && !s.board[i] && !s.mines[i]) opts.push(i);
      opts.sort((a, b) => (side === 'w' ? rc(b)[0] - rc(a)[0] : rc(a)[0] - rc(b)[0]));
      for (const i of opts.slice(0, 3)) s.mines[i] = side;
    } },
  c_decoy: { name: 'Ложные цели', target: null, desc: 'Следующий вражеский дрон, авиаудар или B-2 уйдёт в пустоту.',
    apply: (s, side) => { s.decoy[side] = 4; } },
  c_penal: { name: 'Штрафбат', target: 'ownPawn', desc: 'Пехотинец наносит ×2 урона в следующем бою, но и получает больше.',
    apply: (s, side, t) => { s.board[t].st.penal = 3; fx(s, { k: 'ring', sq: t, c: 'red' }); } },
  c_propaganda: { name: 'Агитбригада', target: 'enemyLight', desc: 'Лёгкий враг рядом с вашими войсками: 60% перейдёт к вам.',
    apply: (s, side, t) => {
      const q = s.board[t];
      if (rnd(s) < 0.6) { q.s = side; q.dug = false; fx(s, { k: 'convert', sq: t }); addLog(s, `${unitDef(s, q).name} перешёл на сторону: ${SIDE_NAME[side]}!`); }
      else addLog(s, 'Агитация провалилась.');
    } },
  c_lendlease: { name: 'Ленд-лиз', target: null, desc: '+50 к доходу на 3 хода.',
    apply: (s, side) => { s.lend[side] = 3; } },
  c_tankdrop: { name: 'Танк с конвейера', target: null, desc: 'Бесплатный танк на задний ряд.',
    apply: (s, side) => { const e = homeEmpty(s, side, 1); if (e.length) spawn(s, pick(s, e), 'R', side); else s.money[side] += 150; } },
  c_engineers: { name: 'Железнодорожные войска', target: null, desc: 'До 5 участков ж/д рядом с вашей сетью.',
    apply: (s, side) => {
      const terr = territory(s);
      for (let k = 0; k < 5; k++) {
        const opts = [];
        for (let i = 0; i < 64; i++) {
          if (s.rails[i] || terr[i] !== side) continue;
          const [r] = rc(i);
          const home = (side === 'w' && r === 0) || (side === 'b' && r === 7);
          if (home || around(i).some((j) => s.rails[j] === side && Math.abs(rc(j)[0] - r) + Math.abs(rc(j)[1] - rc(i)[1]) === 1)) opts.push(i);
        }
        if (!opts.length) break;
        opts.sort((a, b) => Math.abs(rc(a)[1] - 3.5) - Math.abs(rc(b)[1] - 3.5));
        const i = opts[0];
        s.rails[i] = side;
        fx(s, { k: 'build', sq: i });
      }
    } },
  c_bombers: { name: 'Бомбардировщики', target: 'any', desc: 'Бесплатный авиаудар 3×3 по 40 урона.',
    apply: (s, side, t) => { fx(s, { k: 'air', sq: t, side }); airStrikeArea(s, side, t, 40, around(t, 1, true)); } },
  c_spy: { name: 'Шпион', target: null, desc: 'Украсть карту врага (или +50) и вскрыть его мины.',
    apply: (s, side) => {
      const en = other(side);
      if (s.hands[en].length && s.hands[side].length < 4) s.hands[side].push(s.hands[en].splice(Math.floor(rnd(s) * s.hands[en].length), 1)[0]);
      else s.money[side] += 50;
      for (let i = 0; i < 64; i++) if (s.mines[i] === en) s.revealed[i] = 1;
    } },
  c_veteran: { name: 'Награждение', target: 'own', desc: 'Юнит сразу получает следующее звание.',
    apply: (s, side, t) => { const p = s.board[t]; const need = [3, 7, 12][p.rank] || 0; gainXp(s, p, Math.max(1, need - p.xp)); } },
  c_supply: { name: 'Колонна снабжения', target: null, desc: 'Все ваши юниты снабжены 2 хода и выходят из оглушения.',
    apply: (s, side) => { for (const i of own(s, side)) { s.board[i].st.supplied = 2; s.board[i].stun = 0; } fx(s, { k: 'supply', side }); } },
};

export const CARD_IDS = Object.keys(CARDS);

export function cardTargets(s, side, id) {
  const c = CARDS[id];
  const out = [];
  switch (c.target) {
    case null: return null;
    case 'any': for (let i = 0; i < 64; i++) out.push(i); return out;
    case 'own': return own(s, side);
    case 'ownPawn': return own(s, side).filter((i) => s.board[i].t === 'P');
    case 'enemyLight':
      return enemies(s, side).filter((i) => {
        const q = s.board[i];
        return !['K', 'D'].includes(q.t) && unitDef(s, q).value <= 3 && around(i).some((j) => s.board[j] && s.board[j].s === side);
      });
  }
  return out;
}

export function playCard(s, side, id, target) {
  const c = CARDS[id];
  const idx = s.hands[side].indexOf(id);
  if (idx < 0) return 'Нет такой карты';
  if (c.target) {
    const t = cardTargets(s, side, id);
    if (!t.includes(target)) return 'Неверная цель';
  }
  s.hands[side].splice(idx, 1);
  addLog(s, `${SIDE_NAME[side]}: приказ «${c.name}».`);
  fx(s, { k: 'card', id, side, sq: target });
  c.apply(s, side, target);
  return null;
}

export function offerCards(s, side) {
  if (s.hands[side].length >= 3) return;
  const pool = CARD_IDS.filter((id) => !s.hands[side].includes(id));
  const offer = [];
  while (offer.length < 3 && pool.length) offer.push(pool.splice(Math.floor(rnd(s) * pool.length), 1)[0]);
  s.offer[side] = offer;
}
void inB;
