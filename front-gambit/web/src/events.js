// Random front, historical and city events.
import { sq, rc, around, fx, addLog, damagePiece, spawn, rnd, pick, SIDE_NAME, other, territory, damageBuilding, VEHICLES } from './core.js';
import { cityScore, pickSabotageTarget } from './city.js';
import { unitDef } from './units.js';

function score(s, side) {
  let pts = 0;
  s.board.forEach((p) => { if (p && p.s === side && p.t !== 'K') pts += unitDef(s, p).value * (p.hp / p.maxHp); });
  return pts + cityScore(s, side) / 2;
}
const leader = (s) => (score(s, 'w') >= score(s, 'b') ? 'w' : 'b');
const pieces = (s, pred) => s.board.map((p, i) => (p && pred(p, i) ? i : -1)).filter((i) => i >= 0);
const emptyMid = (s) => { const o = []; for (let r = 2; r <= 5; r++) for (let c = 0; c < 8; c++) if (!s.board[sq(r, c)]) o.push(sq(r, c)); return o; };

export const EVENTS = {
  // ---------- front (common) ----------
  ev_mud: { kind: 'front', title: 'Распутица', text: 'Дороги размыло. Два хода фигуры ходят не дальше чем на 2 клетки, техника — на 1.',
    apply: (s) => { s.effects.mud = 2; } },
  ev_blizzard: { kind: 'front', title: 'Метель', text: 'Нелётная погода: два хода дроны, авиаудары и B-2 недоступны.',
    apply: (s) => { s.effects.blizzard = 2; } },
  ev_defector: { kind: 'front', title: 'Перебежчик', text: 'Солдат лидирующей армии перешёл линию фронта к отстающим.',
    can: (s) => pieces(s, (p) => p.s === leader(s) && p.t === 'P').length > 1,
    apply: (s) => {
      const L = leader(s);
      const i = pick(s, pieces(s, (p) => p.s === L && p.t === 'P'));
      s.board[i].s = other(L); s.board[i].dug = false;
      fx(s, { k: 'convert', sq: i });
    } },
  ev_supplycut: { kind: 'front', title: 'Перебои со снабжением', text: 'Составы сошли с рельсов. Доход обеих сторон в этом раунде урезан вдвое.',
    apply: (s) => { s.effects.supplycut = 1; } },
  ev_aid: { kind: 'front', title: 'Гуманитарная помощь', text: 'Отстающая сторона получает 90 на восстановление.',
    apply: (s) => { s.money[other(leader(s))] += 90; } },
  ev_epidemic: { kind: 'front', title: 'Эпидемия', text: 'В окопах болезнь: вся пехота теряет по 15 HP (не ниже 1).',
    apply: (s) => { s.board.forEach((p, i) => { if (p && !VEHICLES.has(p.t)) { p.hp = Math.max(1, p.hp - 15); fx(s, { k: 'dmg', sq: i, v: 15 }); } }); } },
  ev_cache: { kind: 'front', title: 'Трофейный склад', text: 'Найден брошенный склад. Кто первым займёт клетку — получит 120.',
    can: (s) => emptyMid(s).length > 0,
    apply: (s) => { const i = pick(s, emptyMid(s)); s.loot[i] = 120; fx(s, { k: 'ring', sq: i, c: 'gold' }); } },
  ev_partisans: { kind: 'front', title: 'Партизанское движение', text: 'Обе стороны получают отряд партизан у линии фронта.',
    apply: (s) => {
      const terr = territory(s);
      for (const side of ['w', 'b']) {
        const opts = pieces(s, () => false);
        for (let i = 0; i < 64; i++) if (!s.board[i] && terr[i] === side) opts.push(i);
        opts.sort((a, b) => (side === 'w' ? rc(b)[0] - rc(a)[0] : rc(a)[0] - rc(b)[0]));
        if (opts.length) spawn(s, opts[0], 'P', side);
      }
    } },
  // ---------- historical (rare, once per game) ----------
  ev_civilwar: { kind: 'history', title: 'Гражданская война', text: 'В армии лидера раскол! Два подразделения подняли мятеж и воюют против всех.',
    can: (s) => pieces(s, (p) => p.s === leader(s) && !['K'].includes(p.t) && unitDef(s, p).value <= 5).length > 4,
    apply: (s) => {
      const L = leader(s);
      const opts = pieces(s, (p) => p.s === L && p.t !== 'K' && unitDef(s, p).value <= 5);
      for (let k = 0; k < 2 && opts.length; k++) {
        const i = opts.splice(Math.floor(rnd(s) * opts.length), 1)[0];
        s.board[i].s = 'n'; s.board[i].dug = false;
        fx(s, { k: 'convert', sq: i });
      }
    } },
  ev_reich: { kind: 'history', title: 'Возрождение рейха', text: 'Ефрейтор объявил себя фюрером и поднял фанатиков! Его режим — враг для всех. Свергните диктатора — награда 150.',
    can: (s) => pieces(s, (p) => p.t === 'P' && p.s !== 'n').length > 3,
    apply: (s) => {
      const opts = pieces(s, (p, i) => p.t === 'P' && p.s !== 'n' && rc(i)[0] >= 2 && rc(i)[0] <= 5);
      const all = opts.length ? opts : pieces(s, (p) => p.t === 'P' && p.s !== 'n');
      const i = pick(s, all);
      const p = s.board[i];
      p.t = 'D'; p.s = 'n'; p.maxHp = 220; p.hp = 220; p.dug = false; p.cds = {};
      fx(s, { k: 'dictator', sq: i });
      let n = 0;
      for (const j of around(i)) if (!s.board[j] && n < 2) { spawn(s, j, 'P', 'n'); n++; }
    } },
  ev_lendlease: { kind: 'history', title: 'Ленд-лиз', text: 'Союзники прислали помощь отстающей стороне: 200 и танк.',
    apply: (s) => {
      const side = other(leader(s));
      s.money[side] += 200;
      const r = side === 'w' ? 0 : 7;
      for (let c = 0; c < 8; c++) if (!s.board[sq(r, c)]) { spawn(s, sq(r, c), 'R', side); break; }
    } },
  ev_depression: { kind: 'history', title: 'Великая депрессия', text: 'Мировой кризис: три раунда доход обеих сторон −40%.',
    apply: (s) => { s.effects.depression = 3; } },
  ev_pact: { kind: 'history', title: 'Пакт о ненападении', text: 'Один раунд перемирия: никаких атак и ударов.',
    apply: (s) => { s.effects.ceasefire = 1; } },
  ev_revolution: { kind: 'history', title: 'Революция в тылу', text: 'У лидера бастуют рабочие: одно здание в его тылу разрушено.',
    can: (s) => s.city[leader(s)].some((b) => b),
    apply: (s) => { const L = leader(s); const plot = pickSabotageTarget(s, L, true); if (plot >= 0) damageBuilding(s, L, plot, 999); } },
  ev_breakthrough: { kind: 'history', title: 'Технологический прорыв', text: 'Конструкторы отстающих создали новую броню: вся их техника +50 к максимальному HP.',
    apply: (s) => {
      const side = other(leader(s));
      s.board.forEach((p) => { if (p && p.s === side && VEHICLES.has(p.t)) { p.maxHp += 50; p.hp += 50; } });
    } },
  ev_bigmob: { kind: 'history', title: 'Всеобщая мобилизация', text: 'Обе стороны призывают по два пехотинца.',
    apply: (s) => {
      for (const side of ['w', 'b']) {
        let n = 0;
        for (const r of side === 'w' ? [0, 1] : [7, 6]) for (let c = 0; c < 8 && n < 2; c++) if (!s.board[sq(r, c)]) { spawn(s, sq(r, c), 'P', side); n++; }
      }
    } },
  // ---------- city map ----------
  ev_blackout: { kind: 'city', title: 'Авария на ТЭЦ', text: 'Город обесточен. Два раунда бои идут в темноте, доход −20%.',
    apply: (s) => { s.effects.blackout = 2; } },
  ev_crash: { kind: 'city', title: 'Взрыв бензовоза', text: 'На перекрёстке взорвался бензовоз: 40 урона всем в квадрате 3×3.',
    apply: (s) => {
      const roads = []; for (let i = 0; i < 64; i++) if (s.terrain[i] !== 'bld') roads.push(i);
      const t = pick(s, roads);
      fx(s, { k: 'boom', sq: t, big: true });
      for (const i of around(t, 1, true)) if (s.board[i]) damagePiece(s, i, 40, { kind: 'direct' });
    } },
  ev_collapse: { kind: 'city', title: 'Обрушение здания', text: 'Многоэтажка рухнула: юнит внутри получает 60 урона, здание превращается в руины.',
    can: (s) => s.terrain.includes('bld'),
    apply: (s) => {
      const blds = []; s.terrain.forEach((t, i) => { if (t === 'bld') blds.push(i); });
      const occ = blds.filter((i) => s.board[i]);
      const i = pick(s, occ.length ? occ : blds);
      s.terrain[i] = 'ruin';
      fx(s, { k: 'collapse', sq: i });
      if (s.board[i]) damagePiece(s, i, 60, { kind: 'direct', pierce: true });
    } },
  ev_chem: { kind: 'city', title: 'Утечка на химзаводе', text: 'Ядовитое облако накрыло квартал на 2 раунда.',
    apply: (s) => {
      const t = sq(3 + Math.floor(rnd(s) * 2), 1 + Math.floor(rnd(s) * 6));
      fx(s, { k: 'gas', sq: t });
      for (const i of around(t, 1, true)) { s.sqfx[i] = s.sqfx[i] || {}; s.sqfx[i].gas = 2; }
    } },
  ev_metroflood: { kind: 'city', title: 'Затопление метро', text: 'Прорвало водопровод: метро не работает 3 раунда.',
    apply: (s) => { s.effects.metroflood = 3; } },
  ev_fire: { kind: 'city', title: 'Городской пожар', text: 'Кварталы горят: огонь на 3 клетках на 2 раунда.',
    apply: (s) => {
      const opts = []; for (let i = 16; i < 48; i++) opts.push(i);
      for (let k = 0; k < 3; k++) { const i = opts.splice(Math.floor(rnd(s) * opts.length), 1)[0]; s.sqfx[i] = s.sqfx[i] || {}; s.sqfx[i].fire = 2; fx(s, { k: 'napalm', from: -1, to: i }); }
    } },
};

// Called at the start of each round (before Blue moves).
export function rollEvent(s) {
  if (!s.opts.events || s.turnNo < 3 || s.winner) return;
  if (s.lastEventTurn && s.turnNo - s.lastEventTurn < 3) return;
  const r = rnd(s);
  let kind = null;
  if (s.turnNo >= 8 && s.usedHistory.length < 3 && r < 0.06) kind = 'history';
  else if (s.map === 'city' && r < 0.2) kind = 'city';
  else if (r < 0.34) kind = 'front';
  if (!kind) return;
  const opts = Object.keys(EVENTS).filter((id) => {
    const e = EVENTS[id];
    if (e.kind !== kind) return false;
    if (kind === 'history' && s.usedHistory.includes(id)) return false;
    return !e.can || e.can(s);
  });
  if (!opts.length) return;
  const id = pick(s, opts);
  triggerEvent(s, id);
}

export function triggerEvent(s, id) {
  const e = EVENTS[id];
  if (e.kind === 'history') s.usedHistory.push(id);
  s.lastEventTurn = s.turnNo;
  e.apply(s);
  s.popup = { id, seq: (s.popup ? s.popup.seq : 0) + 1 };
  addLog(s, `СОБЫТИЕ: ${e.title}.`);
  fx(s, { k: 'event', id });
}
void SIDE_NAME;
