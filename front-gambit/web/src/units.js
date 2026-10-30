// Unit definitions, movement patterns and custom-unit point costs.

export const UNITS = {
  P: { name: 'Пехотинец', hp: 100, value: 1, move: 'pawn', weapon: 'rifle', duel: 'd_grenade', actives: ['dig', 'ambush'], passives: [],
    desc: 'Основа армии. Окапывается и устраивает засады.' },
  N: { name: 'Спецназ', hp: 140, value: 3, move: 'knight', weapon: 'smg', duel: 'd_dash', actives: ['raid', 'paradrop'], passives: [],
    desc: 'Ходит конём. Рейды в тыл и десант.' },
  B: { name: 'Снайпер', hp: 90, value: 3, move: 'bishop', weapon: 'sniper', duel: 'd_artycall', actives: ['arty', 'snipe'], passives: ['stealth'],
    desc: 'Ходит по диагонали. Наводит артиллерию, бьёт издалека, маскируется.' },
  R: { name: 'Танк', hp: 260, value: 5, move: 'rook', weapon: 'mg', duel: 'd_cannon', actives: ['shell', 'ram'], passives: ['armor'], vehicle: true,
    desc: 'Ходит по прямой. Бронирован, стреляет с места и таранит.' },
  Q: { name: 'Вертолёт', hp: 190, value: 9, move: 'queen', weapon: 'minigun', duel: 'd_rocketpods', actives: ['rockets', 'recon'], passives: [], air: true, vehicle: true,
    desc: 'Ходит как ферзь. Летает над укрытиями, ракетный залп и разведка.' },
  K: { name: 'Генерал', hp: 160, value: 100, move: 'king', weapon: 'pistol', duel: 'd_guards', actives: ['mobilize', 'inspire'], passives: ['fearless'],
    desc: 'Штаб в бункере: −50% урона от ударов. Погибнет — поражение.' },
  M: { name: 'Медик', hp: 90, value: 2, move: 'king', weapon: 'smg', duel: 'd_medkit', actives: ['heal', 'hospital'], passives: ['gasmask'],
    desc: 'Ходит на 1 клетку. Лечит соседей и разворачивает госпиталь.' },
  E: { name: 'Инженер', hp: 100, value: 2, move: 'king', weapon: 'rifle', duel: 'd_turret', actives: ['fortify', 'buildrail', 'demine'], passives: [],
    desc: 'Ходит на 1 клетку. Строит ДОТы и ж/д, разминирует.' },
  A: { name: 'ПВО', hp: 180, value: 4, move: 'rook2', weapon: 'flak', duel: 'd_smokenade', actives: ['flak', 'ewburst'], passives: ['aacover', 'armor'], vehicle: true,
    desc: 'Ходит на 2 клетки по прямой. Сбивает дроны и вертолёты, глушит связь.' },
  L: { name: 'РСЗО', hp: 150, value: 5, move: 'rook3', weapon: 'mg', duel: 'd_rocketpods', actives: ['grad', 'barrage'], passives: ['counterbat'], vehicle: true,
    desc: 'Ходит на 3 клетки по прямой. Залпы по площади и огневой вал.' },
  T: { name: 'Бронепоезд', hp: 320, value: 6, move: 'rail', weapon: 'mg', duel: 'd_cannon', actives: ['broadside', 'reinforce'], passives: ['armor', 'logistics'], vehicle: true, rail: true,
    desc: 'Ездит только по своим путям на любое расстояние. Бортовой залп и снабжение.' },
  D: { name: 'Диктатор', hp: 220, value: 8, move: 'king', weapon: 'pistol', duel: 'd_guards', actives: ['mobilize'], passives: ['fearless', 'regen'],
    desc: 'Мятежный диктатор. Враг для всех. Призывает фанатиков.' },
};

export const MOVES = {
  pawn: { name: 'Пешка', cost: 1 },
  king: { name: 'Король (1 клетка)', cost: 3 },
  rook2: { name: 'Прямо до 2', cost: 3 },
  knight: { name: 'Конь', cost: 3 },
  bishop: { name: 'Слон', cost: 4 },
  rook3: { name: 'Прямо до 3', cost: 4 },
  rook: { name: 'Ладья', cost: 5 },
  kingknight: { name: 'Король + конь', cost: 6 },
  archbishop: { name: 'Слон + конь', cost: 7 },
  chancellor: { name: 'Ладья + конь', cost: 8 },
  queen: { name: 'Ферзь', cost: 9 },
};

export const WEAPONS = {
  pistol: { name: 'Пистолет', cost: 0 },
  rifle: { name: 'Автомат', cost: 1 },
  smg: { name: 'Пистолет-пулемёт', cost: 1 },
  shotgun: { name: 'Дробовик', cost: 1 },
  sniper: { name: 'Снайперская винтовка', cost: 2 },
  mg: { name: 'Пулемёт', cost: 2 },
  flame: { name: 'Огнемёт', cost: 2 },
  minigun: { name: 'Миниган', cost: 3 },
  flak: { name: 'Зенитка', cost: 3 },
};

export const CUSTOM_BUDGET = 24;
export const MAX_ACTIVES = 3, MAX_PASSIVES = 2;

export function customPoints(def, abilityCost) {
  let p = (MOVES[def.move] || MOVES.king).cost;
  p += Math.max(0, Math.round((def.hp - 60) / 40));
  p += (WEAPONS[def.weapon] || WEAPONS.rifle).cost;
  if (def.air) p += 3;
  if (def.vehicle) p += 2;
  for (const a of def.actives || []) p += abilityCost(a);
  for (const a of def.passives || []) p += abilityCost(a);
  if (def.duel) p += abilityCost(def.duel);
  return p;
}

export function customPrice(points) { return 20 + points * 15; }

const FALLBACK = { ...UNITS.P, name: 'Неизвестный' };

export function unitDef(s, p) {
  if (p.t === 'C') {
    const d = s && s.customDefs && s.customDefs[p.cid];
    if (!d) return FALLBACK;
    return {
      name: d.name, hp: d.hp, value: Math.max(1, Math.round(d.points / 3)), move: d.move, weapon: d.weapon, duel: d.duel,
      actives: d.actives || [], passives: d.passives || [], air: !!d.air, vehicle: !!d.vehicle, custom: true,
      desc: 'Собственная разработка Мастерской.',
    };
  }
  return UNITS[p.t] || FALLBACK;
}

export function unitPassives(s, p) {
  const d = unitDef(s, p);
  return d.passives || [];
}

export function unitValue(s, p) { return unitDef(s, p).value; }
