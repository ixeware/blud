// Registry of all unit abilities: board actives, passives and duel specials.
// Custom units combine any of them inside a point budget.
import {
  rc, sq, inB, cheb, around, fx, addLog, damagePiece, heal, stun, spawn, gainXp, hasPassive, rnd,
  SIDE_NAME, VEHICLES, territory, inSmoke,
} from './core.js';
import { unitDef } from './units.js';

const ORTH = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const DIAG = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
const KNIGHT = [[1, 2], [2, 1], [-1, 2], [-2, 1], [1, -2], [2, -1], [-1, -2], [-2, -1]];

function radarOwner(s, side) {
  return s.keypoints.some((k) => k.type === 'radar' && k.owner === side);
}

// can `from` target the piece at i with an ability?
export function targetable(s, from, i) {
  const user = s.board[from], q = s.board[i];
  if (!q || !user) return true;
  if (q.s === user.s) return true;
  const far = cheb(from, i) > 1;
  const stealthy = hasPassive(s, q, 'stealth') || q.st.stealth > 0;
  if (far && stealthy && !radarOwner(s, user.s)) return false;
  if (far && inSmoke(s, i)) return false;
  return true;
}

const enemyAt = (s, from, i) => {
  const p = s.board[from], q = s.board[i];
  return q && q.s !== p.s && targetable(s, from, i);
};
const allyAt = (s, from, i) => { const p = s.board[from], q = s.board[i]; return q && q.s === p.s; };
const inRange = (from, r, pred) => { const out = []; for (let i = 0; i < 64; i++) if (i !== from && cheb(i, from) <= r && pred(i)) out.push(i); return out; };

function areaDamage(s, from, center, dmgC, dmgS, kind = 'arty', radius = 1) {
  const p = s.board[from];
  const side = p ? p.s : null;
  const hits = [];
  for (const i of around(center, radius, true)) {
    const q = s.board[i];
    if (q && q.s !== side) hits.push([i, i === center ? dmgC : dmgS]);
  }
  let kills = 0;
  for (const [i, d] of hits) if (damagePiece(s, i, d, { src: from, side, kind })) kills++;
  return kills;
}

function line(s, from, dirs, max, stopAtPiece = true) {
  const [r, c] = rc(from);
  const out = [];
  for (const [dr, dc] of dirs) {
    for (let k = 1; k <= max; k++) {
      if (!inB(r + dr * k, c + dc * k)) break;
      const i = sq(r + dr * k, c + dc * k);
      if (s.board[i]) { out.push(i); if (stopAtPiece) break; }
    }
  }
  return out;
}

function setSqfx(s, i, key, n) {
  if (!s.sqfx[i]) s.sqfx[i] = {};
  s.sqfx[i][key] = Math.max(s.sqfx[i][key] || 0, n);
}

const isAir = (s, q) => !!unitDef(s, q).air;
const isVeh = (s, q) => VEHICLES.has(q.t) || !!unitDef(s, q).vehicle;
const name = (s, q) => unitDef(s, q).name;

export const ABILITIES = {
  // ======================= ACTIVE (board) =======================
  dig: { name: 'Окопаться', type: 'active', cd: 1, cost: 1,
    desc: 'Юнит окапывается: −30% урона и бонус в обороне, пока не сдвинется.',
    targets: (s, f) => (s.board[f].dug ? [] : [f]),
    apply: (s, f) => { s.board[f].dug = true; fx(s, { k: 'dig', sq: f }); } },
  ambush: { name: 'Засада', type: 'active', cd: 3, cost: 2,
    desc: 'Первый враг, закончивший ход в 2 клетках, получает 35 урона.',
    targets: (s, f) => [f],
    apply: (s, f) => { s.board[f].st.overwatch = 3; fx(s, { k: 'ring', sq: f, c: 'gold' }); } },
  raid: { name: 'Диверсионный рейд', type: 'active', cd: 2, cost: 3, harm: true,
    desc: 'Враг на клетке хода коня или рядом: 25 урона и оглушение на ход.',
    targets: (s, f) => {
      const [r, c] = rc(f);
      return KNIGHT.concat(ORTH).filter(([dr, dc]) => inB(r + dr, c + dc)).map(([dr, dc]) => sq(r + dr, c + dc)).filter((i) => enemyAt(s, f, i));
    },
    apply: (s, f, t) => { fx(s, { k: 'raid', from: f, to: t }); stun(s, t, 2); damagePiece(s, t, 25, { src: f, side: s.board[f].s, kind: 'direct' }); } },
  paradrop: { name: 'Десант', type: 'active', cd: 4, cost: 3,
    desc: 'Перебросить юнит на пустую клетку в 4 клетках: на свою территорию или рядом с союзником.',
    targets: (s, f) => {
      const p = s.board[f], terr = territory(s);
      return inRange(f, 4, (i) => !s.board[i] && (terr[i] === p.s || around(i).some((j) => j !== f && allyAt(s, f, j))));
    },
    apply: (s, f, t) => { fx(s, { k: 'para', from: f, to: t }); s.board[t] = s.board[f]; s.board[f] = null; s.board[t].dug = false; } },
  arty: { name: 'Артудар', type: 'active', cd: 3, cost: 3, harm: true,
    desc: 'Удар по клетке в радиусе 3: 50 урона в центр и 15 вокруг.',
    targets: (s, f) => inRange(f, 3, () => true),
    apply: (s, f, t) => { fx(s, { k: 'arty', from: f, to: t }); areaDamage(s, f, t, 50, 15); } },
  snipe: { name: 'Прицельный выстрел', type: 'active', cd: 2, cost: 2, harm: true,
    desc: 'Враг на линии до 4 клеток: 40 урона, игнорирует окопы и броню.',
    targets: (s, f) => line(s, f, ORTH.concat(DIAG), 4).filter((i) => enemyAt(s, f, i)),
    apply: (s, f, t) => { fx(s, { k: 'snipe', from: f, to: t }); damagePiece(s, t, 40, { src: f, side: s.board[f].s, kind: 'direct', pierce: true }); } },
  shell: { name: 'Огонь с места', type: 'active', cd: 2, cost: 2, harm: true,
    desc: 'Выстрел по прямой до 4 клеток: 55 урона (40 по технике).',
    targets: (s, f) => line(s, f, ORTH, 4).filter((i) => enemyAt(s, f, i)),
    apply: (s, f, t) => { fx(s, { k: 'shell', from: f, to: t }); damagePiece(s, t, isVeh(s, s.board[t]) ? 40 : 55, { src: f, side: s.board[f].s, kind: 'direct' }); } },
  ram: { name: 'Таран', type: 'active', cd: 2, cost: 2, harm: true,
    desc: 'Враг рядом по прямой отброшен на клетку и получает 30. Если некуда — 50.',
    targets: (s, f) => { const [r, c] = rc(f); return ORTH.filter(([dr, dc]) => inB(r + dr, c + dc)).map(([dr, dc]) => sq(r + dr, c + dc)).filter((i) => enemyAt(s, f, i)); },
    apply: (s, f, t) => {
      const [r, c] = rc(f), [tr, tc] = rc(t);
      const nr = tr + (tr - r), nc = tc + (tc - c);
      fx(s, { k: 'ram', from: f, to: t });
      const side = s.board[f].s;
      if (inB(nr, nc) && !s.board[sq(nr, nc)]) {
        s.board[sq(nr, nc)] = s.board[t]; s.board[t] = null;
        damagePiece(s, sq(nr, nc), 30, { src: f, side, kind: 'direct' });
      } else damagePiece(s, t, 50, { src: f, side, kind: 'direct' });
    } },
  rockets: { name: 'Ракетный залп', type: 'active', cd: 3, cost: 3, harm: true,
    desc: 'Враг в радиусе 2: 45 урона и 15 вокруг.',
    targets: (s, f) => inRange(f, 2, (i) => enemyAt(s, f, i)),
    apply: (s, f, t) => { fx(s, { k: 'rockets', from: f, to: t }); areaDamage(s, f, t, 45, 15); } },
  recon: { name: 'Разведдрон', type: 'active', cd: 3, cost: 1,
    desc: 'Разведка квадрата 5×5 в радиусе 4: вскрывает мины и помечает сильнейшего врага.',
    targets: (s, f) => inRange(f, 4, () => true),
    apply: (s, f, t) => {
      const p = s.board[f];
      fx(s, { k: 'recon', from: f, to: t });
      let best = -1, bv = -1;
      for (const i of around(t, 2, true)) {
        if (s.mines[i] && s.mines[i] !== p.s) { s.revealed[i] = 1; }
        const q = s.board[i];
        if (q && q.s !== p.s && unitDef(s, q).value > bv) { bv = unitDef(s, q).value; best = i; }
      }
      if (best >= 0) { s.board[best].st.marked = 2; fx(s, { k: 'mark', sq: best }); }
    } },
  mobilize: { name: 'Мобилизация', type: 'active', cd: 5, cost: 3,
    desc: 'Призвать пехотинца на соседнюю пустую клетку.',
    targets: (s, f) => around(f).filter((i) => !s.board[i]),
    apply: (s, f, t) => { const p = s.board[f]; spawn(s, t, 'P', p.s); addLog(s, `${SIDE_NAME[p.s]}: мобилизация.`); } },
  inspire: { name: 'Боевой дух', type: 'active', cd: 3, cost: 2,
    desc: 'Союзники рядом получают +25% урона в боях на 2 хода.',
    targets: (s, f) => [f],
    apply: (s, f) => { for (const i of around(f, 1, true)) if (allyAt(s, f, i)) s.board[i].st.buff = 2; fx(s, { k: 'inspire', sq: f }); } },
  heal: { name: 'Перевязка', type: 'active', cd: 2, cost: 2,
    desc: 'Вылечить союзника рядом (или себя) на 45.',
    targets: (s, f) => around(f, 1, true).filter((i) => allyAt(s, f, i) && s.board[i].hp < s.board[i].maxHp),
    apply: (s, f, t) => { heal(s, t, 45); } },
  hospital: { name: 'Полевой госпиталь', type: 'active', cd: 4, cost: 3,
    desc: 'Все союзники рядом +25 HP, снимает огонь и газ.',
    targets: (s, f) => [f],
    apply: (s, f) => { fx(s, { k: 'hospital', sq: f }); for (const i of around(f, 1, true)) if (allyAt(s, f, i)) heal(s, i, 25); } },
  fortify: { name: 'Укрепление', type: 'active', cd: 2, cost: 2,
    desc: 'Построить ДОТ: союзник рядом окопан и получает +20 HP.',
    targets: (s, f) => around(f, 1, true).filter((i) => allyAt(s, f, i)),
    apply: (s, f, t) => { s.board[t].dug = true; heal(s, t, 20); fx(s, { k: 'fortify', sq: t }); } },
  buildrail: { name: 'Путейцы', type: 'active', cd: 1, cost: 1,
    desc: 'Бесплатно проложить ж/д на соседней клетке своей или ничейной территории.',
    targets: (s, f) => { const terr = territory(s), p = s.board[f]; return around(f, 1, true).filter((i) => !s.rails[i] && terr[i] !== (p.s === 'w' ? 'b' : 'w')); },
    apply: (s, f, t) => { s.rails[t] = s.board[f].s; fx(s, { k: 'build', sq: t }); } },
  demine: { name: 'Разминирование', type: 'active', cd: 2, cost: 1,
    desc: 'Снять вражеские мины и потушить пожары в радиусе 2.',
    targets: (s, f) => [f],
    apply: (s, f) => {
      const p = s.board[f]; let n = 0;
      for (const i of around(f, 2, true)) {
        if (s.mines[i] && s.mines[i] !== p.s) { s.mines[i] = null; n++; fx(s, { k: 'ring', sq: i, c: 'white' }); }
        if (s.sqfx[i]) s.sqfx[i].fire = 0;
      }
      addLog(s, `${SIDE_NAME[p.s]}: сапёры обезвредили мин: ${n}.`);
    } },
  laymine: { name: 'Минирование', type: 'active', cd: 2, cost: 1,
    desc: 'Поставить скрытую мину на соседнюю пустую клетку.',
    targets: (s, f) => around(f).filter((i) => !s.board[i] && !s.mines[i]),
    apply: (s, f, t) => { s.mines[t] = s.board[f].s; } },
  grad: { name: 'Залп «Град»', type: 'active', cd: 3, cost: 4, harm: true,
    desc: 'Квадрат 3×3 в радиусе 5: по 30 урона каждому врагу.',
    targets: (s, f) => inRange(f, 5, () => true),
    apply: (s, f, t) => { fx(s, { k: 'grad', from: f, to: t }); areaDamage(s, f, t, 30, 30); } },
  barrage: { name: 'Огневой вал', type: 'active', cd: 3, cost: 3, harm: true,
    desc: 'Полоса из 5 клеток в ряду цели (радиус 4): по 35 урона.',
    targets: (s, f) => inRange(f, 4, () => true),
    apply: (s, f, t) => {
      const [tr, tc] = rc(t), side = s.board[f].s;
      fx(s, { k: 'barrage', from: f, to: t });
      for (let c = tc - 2; c <= tc + 2; c++) {
        if (!inB(tr, c)) continue;
        const i = sq(tr, c), q = s.board[i];
        if (q && q.s !== side) damagePiece(s, i, 35, { src: f, side, kind: 'arty' });
      }
    } },
  flak: { name: 'Заградогонь', type: 'active', cd: 2, cost: 2, harm: true,
    desc: 'Все вражеские воздушные цели в радиусе 3 получают 60 урона.',
    targets: (s, f) => (inRange(f, 3, (i) => enemyAt(s, f, i) && isAir(s, s.board[i])).length ? [f] : []),
    apply: (s, f) => {
      fx(s, { k: 'flak', sq: f });
      for (const i of inRange(f, 3, (j) => enemyAt(s, f, j) && isAir(s, s.board[j]))) damagePiece(s, i, 60, { src: f, side: s.board[f].s, kind: 'direct' });
    } },
  ewburst: { name: 'Импульс РЭБ', type: 'active', cd: 4, cost: 2,
    desc: 'На 2 хода вражеские дроны, авиаудары и B-2 в радиусе 2 не наносят урона.',
    targets: (s, f) => [f],
    apply: (s, f) => { s.ewZones.push({ sq: f, side: s.board[f].s, t: 2 }); fx(s, { k: 'ew', sq: f }); } },
  broadside: { name: 'Бортовой залп', type: 'active', cd: 2, cost: 3, harm: true,
    desc: 'Все враги в радиусе 2 получают 25 урона.',
    targets: (s, f) => (inRange(f, 2, (i) => enemyAt(s, f, i)).length ? [f] : []),
    apply: (s, f) => {
      fx(s, { k: 'broadside', sq: f });
      for (const i of inRange(f, 2, (j) => enemyAt(s, f, j))) damagePiece(s, i, 25, { src: f, side: s.board[f].s, kind: 'arty' });
    } },
  reinforce: { name: 'Вызов подкрепления', type: 'active', cd: 4, cost: 3,
    desc: 'Пехотинец прибывает на свободную клетку заднего ряда.',
    targets: (s, f) => { const p = s.board[f], r = p.s === 'w' ? 0 : 7; const out = []; for (let c = 0; c < 8; c++) if (!s.board[sq(r, c)]) out.push(sq(r, c)); return out; },
    apply: (s, f, t) => { spawn(s, t, 'P', s.board[f].s); fx(s, { k: 'train', to: t }); } },
  napalm: { name: 'Напалм', type: 'active', cd: 3, cost: 3, harm: true,
    desc: 'Поджечь клетку и соседей по ряду (радиус 3): 20 урона и пожар на 2 хода.',
    targets: (s, f) => inRange(f, 3, () => true),
    apply: (s, f, t) => {
      const [tr, tc] = rc(t), side = s.board[f].s;
      fx(s, { k: 'napalm', from: f, to: t });
      for (let c = tc - 1; c <= tc + 1; c++) {
        if (!inB(tr, c)) continue;
        const i = sq(tr, c);
        setSqfx(s, i, 'fire', 2);
        const q = s.board[i];
        if (q && q.s !== side && !hasPassive(s, q, 'gasmask')) damagePiece(s, i, 20, { src: f, side, kind: 'fire' });
      }
    } },
  gas: { name: 'Газовая атака', type: 'active', cd: 4, cost: 3, harm: true,
    desc: 'Облако газа 3×3 в радиусе 3 на 2 хода: 10 урона сразу и 12 каждый ход.',
    targets: (s, f) => inRange(f, 3, () => true),
    apply: (s, f, t) => {
      const side = s.board[f].s;
      fx(s, { k: 'gas', sq: t });
      for (const i of around(t, 1, true)) {
        setSqfx(s, i, 'gas', 2);
        const q = s.board[i];
        if (q && q.s !== side && !hasPassive(s, q, 'gasmask')) damagePiece(s, i, 10, { src: f, side, kind: 'gas' });
      }
    } },
  smoke: { name: 'Дымовая завеса', type: 'active', cd: 3, cost: 2,
    desc: 'Дым 3×3 в радиусе 3 на 2 хода: юниты в дыму не видны для дальних ударов, +30% к обороне.',
    targets: (s, f) => inRange(f, 3, () => true).concat([f]),
    apply: (s, f, t) => { fx(s, { k: 'smoke', sq: t }); for (const i of around(t, 1, true)) setSqfx(s, i, 'smoke', 2); } },
  emp: { name: 'ЭМИ', type: 'active', cd: 4, cost: 3, harm: true,
    desc: 'Импульс в радиусе 3: враги в 3×3 оглушены (техника — на 2 хода).',
    targets: (s, f) => inRange(f, 3, () => true),
    apply: (s, f, t) => {
      fx(s, { k: 'emp', sq: t });
      for (const i of around(t, 1, true)) { const q = s.board[i]; if (q && q.s !== s.board[f].s) stun(s, i, isVeh(s, q) ? 3 : 2); }
    } },
  terror: { name: 'Психатака', type: 'active', cd: 3, cost: 2, harm: true,
    desc: 'Враг в радиусе 2 в панике и пропускает ход.',
    targets: (s, f) => inRange(f, 2, (i) => enemyAt(s, f, i)),
    apply: (s, f, t) => { fx(s, { k: 'terror', sq: t }); stun(s, t, 2); } },
  hack: { name: 'Взлом', type: 'active', cd: 3, cost: 2, harm: true,
    desc: 'Враг в радиусе 3: все перезарядки +2, снимает его бонусы.',
    targets: (s, f) => inRange(f, 3, (i) => enemyAt(s, f, i)),
    apply: (s, f, t) => {
      const q = s.board[t];
      for (const a of unitDef(s, q).actives) q.cds[a] = (q.cds[a] || 0) + 2;
      q.st.buff = 0; q.st.overwatch = 0; q.st.shield = 0;
      fx(s, { k: 'hack', sq: t });
    } },
  mark: { name: 'Целеуказание', type: 'active', cd: 2, cost: 1,
    desc: 'Враг в радиусе 4 помечен на 2 хода: получает +50% урона отовсюду.',
    targets: (s, f) => inRange(f, 4, (i) => enemyAt(s, f, i)),
    apply: (s, f, t) => { s.board[t].st.marked = 2; fx(s, { k: 'mark', sq: t }); } },
  supplydrop: { name: 'Сброс припасов', type: 'active', cd: 3, cost: 2,
    desc: 'Любой союзник: +30 HP и снабжение на 2 хода.',
    targets: (s, f) => { const out = []; for (let i = 0; i < 64; i++) if (allyAt(s, f, i)) out.push(i); return out; },
    apply: (s, f, t) => { fx(s, { k: 'drop', sq: t }); heal(s, t, 30); s.board[t].st.supplied = 2; } },
  kamikaze: { name: 'Самоподрыв', type: 'active', cd: 0, cost: 3, harm: true,
    desc: 'Юнит взрывается: 60 урона всем врагам рядом.',
    targets: (s, f) => (s.board[f].t === 'K' ? [] : [f]),
    apply: (s, f) => {
      const p = s.board[f];
      const hits = around(f).filter((i) => s.board[i] && s.board[i].s !== p.s);
      s.board[f] = null;
      fx(s, { k: 'boom', sq: f, big: true });
      addLog(s, `${SIDE_NAME[p.s]}: самоподрыв!`);
      for (const i of hits) damagePiece(s, i, 60, { side: p.s, kind: 'direct' });
    } },
  swap: { name: 'Рокировка', type: 'active', cd: 2, cost: 1,
    desc: 'Поменяться местами с союзником рядом.',
    targets: (s, f) => around(f).filter((i) => allyAt(s, f, i)),
    apply: (s, f, t) => { const a = s.board[f]; s.board[f] = s.board[t]; s.board[t] = a; fx(s, { k: 'swap', from: f, to: t }); } },
  hook: { name: 'Захват', type: 'active', cd: 3, cost: 2, harm: true,
    desc: 'Притянуть врага с линии (до 3 клеток) вплотную: 15 урона.',
    targets: (s, f) => line(s, f, ORTH.concat(DIAG), 3).filter((i) => enemyAt(s, f, i) && cheb(i, f) > 1 && !isVeh(s, s.board[i])),
    apply: (s, f, t) => {
      const [r, c] = rc(f), [tr, tc] = rc(t);
      const dr = Math.sign(tr - r), dc = Math.sign(tc - c);
      const dest = sq(r + dr, c + dc);
      fx(s, { k: 'hook', from: f, to: t });
      if (!s.board[dest]) { s.board[dest] = s.board[t]; s.board[t] = null; damagePiece(s, dest, 15, { src: f, side: s.board[f].s, kind: 'direct' }); }
    } },
  loot: { name: 'Реквизиция', type: 'active', cd: 3, cost: 1,
    desc: 'Если рядом враг — забрать у противника 40 денег.',
    targets: (s, f) => (around(f).some((i) => enemyAt(s, f, i)) ? [f] : []),
    apply: (s, f) => {
      const p = s.board[f];
      const en = around(f).map((i) => s.board[i]).find((q) => q && q.s !== p.s);
      const take = en && s.money[en.s] !== undefined ? Math.min(40, s.money[en.s]) : 40;
      if (en && s.money[en.s] !== undefined) s.money[en.s] -= take;
      s.money[p.s] += take;
      fx(s, { k: 'cash', sq: f, v: take });
    } },
  propaganda: { name: 'Пропаганда', type: 'active', cd: 5, cost: 4,
    desc: 'Лёгкий враг рядом (ценность до 3) с шансом 45% переходит на вашу сторону.',
    targets: (s, f) => around(f).filter((i) => enemyAt(s, f, i) && !['K', 'D'].includes(s.board[i].t) && unitDef(s, s.board[i]).value <= 3),
    apply: (s, f, t) => {
      const p = s.board[f], q = s.board[t];
      fx(s, { k: 'propaganda', from: f, to: t });
      if (rnd(s) < 0.45) { addLog(s, `${name(s, q)} перешёл на сторону: ${SIDE_NAME[p.s]}!`); q.s = p.s; q.dug = false; fx(s, { k: 'convert', sq: t }); }
      else addLog(s, 'Пропаганда не подействовала.');
    } },
  shieldally: { name: 'Щит', type: 'active', cd: 2, cost: 2,
    desc: 'Союзник рядом (или сам) полностью блокирует следующий удар.',
    targets: (s, f) => around(f, 1, true).filter((i) => allyAt(s, f, i)),
    apply: (s, f, t) => { s.board[t].st.shield = 1; fx(s, { k: 'shield', sq: t }); } },
  cutrail: { name: 'Подрыв путей', type: 'active', cd: 2, cost: 1, harm: true,
    desc: 'Уничтожить вражескую ж/д в квадрате 3×3 в радиусе 3.',
    targets: (s, f) => inRange(f, 3, () => true),
    apply: (s, f, t) => { const side = s.board[f].s; for (const i of around(t, 1, true)) if (s.rails[i] && s.rails[i] !== side) { s.rails[i] = null; fx(s, { k: 'boom', sq: i }); } } },
  trenchline: { name: 'Линия окопов', type: 'active', cd: 3, cost: 2,
    desc: 'Все союзники в этом ряду в пределах 2 клеток окапываются.',
    targets: (s, f) => [f],
    apply: (s, f) => {
      const [r, c] = rc(f);
      for (let cc = c - 2; cc <= c + 2; cc++) { if (!inB(r, cc)) continue; const i = sq(r, cc); if (allyAt(s, f, i)) { s.board[i].dug = true; fx(s, { k: 'dig', sq: i }); } }
    } },
  repair: { name: 'Ремонт', type: 'active', cd: 2, cost: 2,
    desc: 'Техника рядом (или сам) +60 HP.',
    targets: (s, f) => around(f, 1, true).filter((i) => allyAt(s, f, i) && isVeh(s, s.board[i]) && s.board[i].hp < s.board[i].maxHp),
    apply: (s, f, t) => { heal(s, t, 60); fx(s, { k: 'repair', sq: t }); } },
  overdrive: { name: 'Форсаж', type: 'active', cd: 4, cost: 3,
    desc: '+1 действие в этом ходу и юнит может снова ходить. Стоит 15 HP.',
    targets: (s, f) => (s.board[f].hp > 20 ? [f] : []),
    apply: (s, f) => { const p = s.board[f]; s.actionsLeft += 2; s.movedIds = s.movedIds.filter((x) => x !== p.id); p.hp -= 15; fx(s, { k: 'overdrive', sq: f }); } },
  march: { name: 'Марш-бросок', type: 'active', cd: 3, cost: 2,
    desc: 'Переместиться на свободную клетку в радиусе 2.',
    targets: (s, f) => inRange(f, 2, (i) => !s.board[i]),
    apply: (s, f, t) => { s.board[t] = s.board[f]; s.board[f] = null; s.board[t].dug = false; fx(s, { k: 'ring', sq: t, c: 'white' }); } },
  rally: { name: 'Сбор', type: 'active', cd: 3, cost: 2,
    desc: 'Сам +30 HP; соседние союзники выходят из оглушения, перезарядки −1.',
    targets: (s, f) => [f],
    apply: (s, f) => {
      heal(s, f, 30);
      for (const i of around(f)) if (allyAt(s, f, i)) { const q = s.board[i]; q.stun = 0; for (const k in q.cds) q.cds[k] = Math.max(0, q.cds[k] - 1); }
      fx(s, { k: 'inspire', sq: f });
    } },

  // ======================= PASSIVE =======================
  armor: { name: 'Броня', type: 'passive', cost: 3, desc: '−25% урона от ударов и пуль.' },
  regen: { name: 'Регенерация', type: 'passive', cost: 2, desc: '+10 HP каждый ход, даже без снабжения.' },
  stealth: { name: 'Маскировка', type: 'passive', cost: 2, desc: 'Нельзя выбрать целью издалека (кроме владельца радара).' },
  aacover: { name: 'Зонтик ПВО', type: 'passive', cost: 3, desc: 'Союзники рядом получают половину урона от авиации и дронов. Сбивает дроны.' },
  instructor: { name: 'Инструктор', type: 'passive', cost: 2, desc: 'Союзники рядом получают двойной опыт.' },
  logistics: { name: 'Тыловик', type: 'passive', cost: 2, desc: 'Сам и соседи всегда снабжены.' },
  counterbat: { name: 'Контрбатарея', type: 'passive', cost: 2, desc: 'Отвечает 20 урона по тому, кто ударил.' },
  gasmask: { name: 'Противогаз', type: 'passive', cost: 1, desc: 'Иммунитет к газу и огню.' },
  fieldhq: { name: 'Полевой штаб', type: 'passive', cost: 3, desc: '+10 к доходу каждый ход.' },
  fearless: { name: 'Бесстрашие', type: 'passive', cost: 2, desc: 'Иммунитет к оглушению.' },
  trophies: { name: 'Трофеи', type: 'passive', cost: 1, desc: '+25 денег за каждое уничтожение.' },
  jumper: { name: 'Прыгун', type: 'passive', cost: 3, desc: 'При ходе по линии перепрыгивает одну фигуру.' },

  // ======================= DUEL SPECIALS =======================
  d_grenade: { name: 'Граната', type: 'duel', cost: 1, desc: 'Бросок гранаты по площади.' },
  d_dash: { name: 'Рывок', type: 'duel', cost: 1, desc: 'Быстрый рывок с неуязвимостью.' },
  d_artycall: { name: 'Артналёт', type: 'duel', cost: 2, desc: 'Вызов 4 снарядов в точку прицела.' },
  d_cannon: { name: 'Пушка', type: 'duel', cost: 2, desc: 'Мощный снаряд с уроном по площади.' },
  d_rocketpods: { name: 'НУРСы', type: 'duel', cost: 2, desc: 'Залп из 4 ракет.' },
  d_guards: { name: 'Охрана', type: 'duel', cost: 2, desc: 'Вызов двух бойцов (один раз).' },
  d_medkit: { name: 'Аптечка', type: 'duel', cost: 1, desc: 'Восстановить 35% здоровья.' },
  d_smokenade: { name: 'Дымовая граната', type: 'duel', cost: 1, desc: 'Облако дыма скрывает от выстрелов.' },
  d_turret: { name: 'Турель', type: 'duel', cost: 2, desc: 'Поставить автоматическую турель.' },
  d_mine: { name: 'Мина', type: 'duel', cost: 1, desc: 'Бросить мину-ловушку под ноги.' },
  d_shield: { name: 'Щит', type: 'duel', cost: 1, desc: 'На 3 секунды почти неуязвим спереди.' },
  d_flame: { name: 'Огнемёт', type: 'duel', cost: 2, desc: 'Струя огня поджигает всё впереди.' },
  d_sprint: { name: 'Спринт', type: 'duel', cost: 1, desc: 'Скорость ×1.8 на 3 секунды.' },
  d_c4: { name: 'C4', type: 'duel', cost: 2, desc: 'Заряд взрывается через 2 секунды.' },
};

export const ACTIVE_IDS = Object.keys(ABILITIES).filter((k) => ABILITIES[k].type === 'active');
export const PASSIVE_IDS = Object.keys(ABILITIES).filter((k) => ABILITIES[k].type === 'passive');
export const DUEL_IDS = Object.keys(ABILITIES).filter((k) => ABILITIES[k].type === 'duel');
export const abilityCost = (id) => (ABILITIES[id] ? ABILITIES[id].cost : 0);

export function abilityTargetsFor(s, from, id) {
  const p = s.board[from];
  const a = ABILITIES[id];
  if (!p || !a || a.type !== 'active') return [];
  if (!unitDef(s, p).actives.includes(id)) return [];
  if ((p.cds[id] || 0) > 0 || p.stun > 0) return [];
  if (a.harm && s.effects.ceasefire > 0) return [];
  return a.targets(s, from, p) || [];
}

export function useAbility(s, from, id, target) {
  const p = s.board[from];
  const a = ABILITIES[id];
  p.cds[id] = a.cd;
  addLog(s, `${SIDE_NAME[p.s]}: ${unitDef(s, p).name} — «${a.name}».`);
  fx(s, { k: 'ability', id, sq: from, to: target, side: p.s });
  a.apply(s, from, target, p);
  if (a.harm && s.board.includes(p)) gainXp(s, p, 1);
}
