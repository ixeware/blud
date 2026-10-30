// Rear city: each side builds and upgrades buildings on plots behind its home rank.
import { sq, fx, addLog, spawn, heal, gainXp, SIDE_NAME, around, damageBuilding } from './core.js';

export const PLOTS = 10;

export function plotPos(side, i) {
  const row = Math.floor(i / 5), col = i % 5;
  const dir = side === 'w' ? 1 : -1;
  return { x: -20 + col * 10, z: dir * (22.2 + row * 5.6), row, col };
}

// cost: build price, up: upgrade prices to lvl2/lvl3, max: how many of this type a side may own
export const BUILDINGS = {
  factory: { name: 'Завод', icon: 'factory', cost: 120, up: [100, 140], max: 4, hp: 100, desc: '+20 дохода за каждый уровень.' },
  housing: { name: 'Жилой квартал', icon: 'city', cost: 60, up: [60, 80], max: 3, hp: 80, desc: '+2 к лимиту армии и +5 дохода за уровень.' },
  barracks: { name: 'Казармы', icon: 'people', cost: 90, up: [90, 120], max: 2, hp: 90, desc: 'Пехота дешевле на 10 за уровень. Бесплатный пехотинец раз в (4 − уровень) хода.' },
  tankworks: { name: 'Танковый завод', icon: 'unit_R', cost: 160, up: [140, 180], max: 1, hp: 120, desc: 'Техника дешевле на 15% за уровень. На 3-м уровне — бесплатный танк раз в 5 ходов.' },
  power: { name: 'Электростанция', icon: 'action', cost: 100, up: [90, 120], max: 1, hp: 90, desc: 'Каждый уровень заводов даёт ещё +5 за уровень станции.' },
  hospital: { name: 'Госпиталь', icon: 'heart', cost: 100, up: [80, 110], max: 1, hp: 80, desc: 'Все ваши юниты лечатся на 5 за уровень каждый ход.' },
  airbase: { name: 'Авиабаза', icon: 'kp_airfield', cost: 140, up: [120, 160], max: 1, hp: 100, desc: 'Авиаудар и дрон дешевле на 15 за уровень. На 3-м уровне их перезарядка короче.' },
  intel: { name: 'Штаб разведки', icon: 'kp_radar', cost: 110, up: [100, 130], max: 1, hp: 80, desc: 'Ур. 2: приказы каждые 2 хода. Ур. 3: видны все вражеские мины.' },
  aasite: { name: 'Зенитный дивизион', icon: 'unit_A', cost: 90, up: [80, 100], max: 2, hp: 100, desc: 'Сбивает дроны над городом (25% за уровень), диверсии реже удаются.' },
  bank: { name: 'Банк', icon: 'coin', cost: 120, up: [100, 140], max: 1, hp: 80, desc: 'Проценты: +5% от казны за уровень (до 15 за уровень в ход).' },
  academy: { name: 'Военная академия', icon: 'medal', cost: 150, up: [130, 170], max: 1, hp: 90, desc: 'Новые юниты приходят Ефрейторами. На 3-м уровне все юниты получают опыт каждый ход.' },
  depot: { name: 'Ж/д депо', icon: 'unit_T', cost: 80, up: [70, 90], max: 1, hp: 90, desc: 'Бесплатные участки ж/д (по уровню за ход), бронепоезд дешевле на 50.' },
};
export const BUILDING_IDS = Object.keys(BUILDINGS);

export function newCity() {
  const mk = () => {
    const c = new Array(PLOTS).fill(null);
    c[2] = { type: 'factory', lvl: 1, hp: 100, maxHp: 100, build: 0 };
    return c;
  };
  return { w: mk(), b: mk() };
}

const ready = (b) => b && b.build === 0;
export function level(s, side, type) {
  let n = 0;
  for (const b of s.city[side]) if (b && b.type === type) n += ready(b) ? b.lvl : b.lvl - 1;
  return n;
}
export function owned(s, side, type) { return s.city[side].filter((b) => b && b.type === type).length; }
export function factoryLevels(s, side) { return level(s, side, 'factory'); }

export function upgradeCost(b) { return BUILDINGS[b.type].up[b.lvl - 1]; }

export function canBuild(s, side, plot, type) {
  const B = BUILDINGS[type];
  if (!B) return 'Неизвестное здание';
  if (plot < 0 || plot >= PLOTS) return 'Нет участка';
  if (s.city[side][plot]) return 'Участок занят';
  if (owned(s, side, type) >= B.max) return `Не больше ${B.max}`;
  if (s.builtTurn[side] === s.turnNo) return 'Стройка уже идёт в этом ходу';
  if (s.money[side] < B.cost) return 'Не хватает денег';
  return null;
}

export function canUpgrade(s, side, plot) {
  const b = s.city[side][plot];
  if (!b) return 'Пусто';
  if (b.build > 0) return 'Идёт стройка';
  if (b.lvl >= 3) return 'Максимальный уровень';
  if (s.builtTurn[side] === s.turnNo) return 'Стройка уже идёт в этом ходу';
  if (s.money[side] < upgradeCost(b)) return 'Не хватает денег';
  return null;
}

export function doBuild(s, side, plot, type) {
  const B = BUILDINGS[type];
  s.money[side] -= B.cost;
  s.city[side][plot] = { type, lvl: 1, hp: B.hp, maxHp: B.hp, build: 1 };
  s.builtTurn[side] = s.turnNo;
  fx(s, { k: 'cityBuild', side, plot, type });
  addLog(s, `${SIDE_NAME[side]}: заложено здание «${B.name}».`);
}

export function doUpgrade(s, side, plot) {
  const b = s.city[side][plot];
  s.money[side] -= upgradeCost(b);
  b.lvl++;
  b.build = 1;
  b.maxHp += 50;
  b.hp = b.maxHp;
  s.builtTurn[side] = s.turnNo;
  fx(s, { k: 'cityBuild', side, plot, type: b.type, up: true });
  addLog(s, `${SIDE_NAME[side]}: «${BUILDINGS[b.type].name}» модернизируется до ${b.lvl} уровня.`);
}

export function cityIncome(s, side) {
  const f = level(s, side, 'factory');
  let inc = 20 * f + 5 * f * level(s, side, 'power') + 5 * level(s, side, 'housing');
  const bank = level(s, side, 'bank');
  if (bank) inc += Math.min(15 * bank, Math.floor(s.money[side] * 0.05 * bank));
  return inc;
}

export function cardPeriod(s, side) { return level(s, side, 'intel') >= 2 ? 2 : 3; }

// called at the start of the side's turn (after income)
export function cityTurn(s, side) {
  const C = s.city[side];
  C.forEach((b, plot) => {
    if (!b || b.build <= 0) return;
    b.build--;
    if (b.build === 0) {
      fx(s, { k: 'cityDone', side, plot, type: b.type, lvl: b.lvl });
      addLog(s, `${SIDE_NAME[side]}: «${BUILDINGS[b.type].name}» ${b.lvl > 1 ? `улучшено до ${b.lvl} уровня` : 'построено'}.`);
    }
  });
  const T = s.cityT[side];
  const home = side === 'w' ? [0, 1] : [7, 6];
  const freeHome = (rows) => { const o = []; for (const r of rows) for (let c = 0; c < 8; c++) if (!s.board[sq(r, c)]) o.push(sq(r, c)); return o; };
  const bar = level(s, side, 'barracks');
  if (bar) {
    T.barracks = (T.barracks || 0) + 1;
    if (T.barracks >= Math.max(1, 4 - bar)) {
      const f = freeHome(home);
      if (f.length && spawn(s, f[Math.floor(f.length / 2)], 'P', side)) { T.barracks = 0; addLog(s, `${SIDE_NAME[side]}: казармы прислали пехотинца.`); }
    }
  }
  if (level(s, side, 'tankworks') >= 3) {
    T.tankworks = (T.tankworks || 0) + 1;
    if (T.tankworks >= 5) {
      const f = freeHome([home[0]]);
      if (f.length && spawn(s, f[0], 'R', side)) { T.tankworks = 0; addLog(s, `${SIDE_NAME[side]}: с танкового завода вышел танк.`); }
    }
  }
  const hosp = level(s, side, 'hospital');
  const acad = level(s, side, 'academy');
  s.board.forEach((p, i) => {
    if (!p || p.s !== side) return;
    if (hosp) heal(s, i, 5 * hosp);
    if (acad >= 3) gainXp(s, p, 1);
  });
  if (level(s, side, 'intel') >= 3) for (let i = 0; i < 64; i++) if (s.mines[i] && s.mines[i] !== side) s.revealed[i] = 1;
  s.freeRails[side] = level(s, side, 'depot');
}

// AI helper: which building to put up next (or null)
export function aiCityChoice(s, side) {
  if (s.builtTurn[side] === s.turnNo) return null;
  const money = s.money[side];
  const free = s.city[side].findIndex((b) => !b);
  const want = [];
  const f = owned(s, side, 'factory');
  if (f < 2) want.push('factory');
  if (owned(s, side, 'housing') < 1) want.push('housing');
  if (owned(s, side, 'barracks') < 1) want.push('barracks');
  if (f < 3) want.push('factory');
  want.push('power', 'hospital', 'bank', 'aasite', 'airbase', 'tankworks', 'academy', 'intel', 'depot', 'housing', 'factory');
  for (const type of want) {
    if (free >= 0 && !canBuild(s, side, free, type) && money - BUILDINGS[type].cost >= 60) return { c: 'build', plot: free, type };
  }
  // upgrades
  let best = null;
  s.city[side].forEach((b, plot) => {
    if (!b || canUpgrade(s, side, plot)) return;
    const prio = { factory: 3, power: 2, housing: 2, barracks: 1.5, bank: 1.5 }[b.type] || 1;
    if (money - upgradeCost(b) >= 80 && (!best || prio > best.prio)) best = { plot, prio };
  });
  return best ? { c: 'upgrade', plot: best.plot } : null;
}

export function cityScore(s, side) {
  return s.city[side].reduce((a, b) => a + (b ? b.lvl * 4 : 0), 0);
}

// enemy sabotage / drone strike on the city
export function pickSabotageTarget(s, side, preferFactory) {
  const list = s.city[side].map((b, i) => (b ? i : -1)).filter((i) => i >= 0);
  if (!list.length) return -1;
  if (preferFactory) {
    const f = list.filter((i) => s.city[side][i].type === 'factory');
    if (f.length) return f[f.length - 1];
  }
  return list[Math.floor(Math.random() * list.length)];
}
void around; void damageBuilding;
