// Headless self-test: plays AI-vs-AI games (auto-resolved duels, AI drones, events, cards, rebels).
// Run: node test/selftest.mjs [games] [map]
import { newGame, apply, finishDuel, finishDrone, autoResolve } from '../web/src/rules.js';
import { aiChoose } from '../web/src/ai.js';
import { DroneSim } from '../web/src/drone.js';
import { DuelSim } from '../web/src/duel.js';

const GAMES = +(process.argv[2] || 12);
const MAP = process.argv[3] || 'field';
const res = { w: 0, b: 0, byScore: 0 };
let turns = 0, events = 0, cards = 0, b2 = 0, rebels = 0, abil = 0, duels = 0;
const t0 = Date.now();
for (let g = 0; g < GAMES; g++) {
  const s = newGame({ map: g % 2 ? 'city' : MAP, seed: g * 7919 + 1 });
  let guard = 0;
  while (!s.winner && guard++ < 30000) {
    if (s.phase === 'duel') {
      duels++;
      if (process.env.SIMDUEL && guard % 4 === 0) {
        const sim = new DuelSim(s.rt, { ctrl: { att: 'ai', def: 'ai' }, difficulty: 1 });
        while (!sim.over) { sim.step(1 / 30, {}); sim.snapshot(); }
        finishDuel(s, sim.result);
      } else finishDuel(s, autoResolve(s.rt));
      continue;
    }
    if (s.phase === 'drone') {
      const d = new DroneSim(s, { ctrl: 'ai' });
      while (!d.over) d.step(1 / 30);
      finishDrone(s, d.result);
      continue;
    }
    const cmd = aiChoose(s, s.turn, 1);
    if (cmd.c === 'card') cards++;
    if (cmd.c === 'b2') b2++;
    if (cmd.c === 'ability') abil++;
    const err = apply(s, s.turn, cmd);
    if (err) apply(s, s.turn, { c: 'end' });
    if (s.board.some((p) => p && p.s === 'n')) rebels++;
    JSON.parse(JSON.stringify(s));
  }
  if (!s.winner) throw new Error('game did not finish');
  events += s.log.filter((l) => l.startsWith('СОБЫТИЕ')).length;
  res[s.winner]++;
  if (s.byScore) res.byScore++;
  turns += s.turnNo;
}
console.log(`OK: ${GAMES} games in ${((Date.now() - t0) / 1000).toFixed(1)}s, blue ${res.w} / red ${res.b} (by score ${res.byScore}), avg ${Math.round(turns / GAMES)} turns`);
console.log(`per game: events ${(events / GAMES).toFixed(1)}, cards ${(cards / GAMES).toFixed(1)}, abilities ${(abil / GAMES).toFixed(1)}, duels ${(duels / GAMES).toFixed(1)}, B-2 ${(b2 / GAMES).toFixed(1)}, steps with rebels ${(rebels / GAMES).toFixed(0)}`);
