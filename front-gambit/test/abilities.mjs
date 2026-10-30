// Every board ability: build a small scene where it has targets, use it through the rules, check it did something.
// Run: node test/abilities.mjs
import { newGame, apply, abilityList } from '../web/src/rules.js';
import { ABILITIES, ACTIVE_IDS, abilityBlock, abilityArea } from '../web/src/abilities.js';
import { sq, alloc } from '../web/src/core.js';

const FIELDS = (s) => JSON.stringify([s.board, s.rails, s.mines, s.sqfx, s.money, s.ewZones, s.revealed, s.actionsLeft]);
let ok = 0;
const fails = [];
for (const id of ACTIVE_IDS) {
  const s = newGame({ map: 'field', seed: 5 });
  s.board.fill(null);
  s.mines.fill(null);
  s.turn = 'w';
  s.phase = 'board';
  s.actionsLeft = 2;
  s.effects.ceasefire = 0;
  s.customDefs.t1 = { name: 'Тест', hp: 120, points: 9, move: 'king', weapon: 'rifle', duel: 'd_grenade', actives: [id], passives: [], air: false, vehicle: false };
  const put = (i, t, side, extra) => { const p = alloc(s, t, side, extra); s.board[i] = p; return p; };
  put(sq(0, 0), 'K', 'w');
  put(sq(7, 7), 'K', 'b');
  const me = sq(3, 3);
  const user = put(me, 'C', 'w', { cid: 't1' });
  // context: a wounded ally beside, a damaged vehicle ally, enemies in a line, near and in the air, rails, mines
  put(sq(3, 4), 'P', 'w').hp = 40;
  put(sq(2, 2), 'R', 'w').hp = 100;
  put(sq(5, 3), 'P', 'b');
  put(sq(4, 4), 'P', 'b');
  put(sq(3, 6), 'Q', 'b');
  s.rails[sq(4, 2)] = 'b'; s.rails[sq(4, 3)] = 'b';
  s.mines[sq(2, 4)] = 'b';
  user.hp = 100;
  const list = abilityList(s, me).find((a) => a.id === id);
  const block = abilityBlock(s, me, id);
  const area = abilityArea(s, me, id);
  if (!list || !list.targets.length) { fails.push(`${id}: no targets (${block})`); continue; }
  if (block) { fails.push(`${id}: blocked but has targets: ${block}`); continue; }
  if (!Array.isArray(area) || !area.length) { fails.push(`${id}: empty area`); continue; }
  // prefer an enemy-occupied target, then any other square
  const t = list.targets.find((i) => s.board[i] && s.board[i].s === 'b') ?? list.targets.find((i) => i !== me) ?? list.targets[0];
  const before = FIELDS(s);
  let err;
  try { err = apply(s, 'w', { c: 'ability', from: me, id, target: t }); } catch (e) { err = 'THROW ' + e.stack; }
  if (err) { fails.push(`${id}: ${err}`); continue; }
  const fxKinds = s.fx.map((e) => e.k);
  if (!s.fx.some((e) => e.k === 'ability' && e.ab === id)) { fails.push(`${id}: no ability fx`); continue; }
  if (FIELDS(s) === before) { fails.push(`${id}: no state change`); continue; }
  // second use must be blocked by the cooldown (unless cd 0) and explained
  const p = s.board.find((q) => q && q.cid === 't1');
  if (p && ABILITIES[id].cd > 0 && !abilityBlock(s, s.board.indexOf(p), id)) { fails.push(`${id}: cooldown not reported`); continue; }
  JSON.parse(JSON.stringify(s));
  ok++;
}
console.log(`abilities OK ${ok}/${ACTIVE_IDS.length}`);
if (fails.length) { console.log(fails.join('\n')); process.exit(1); }
