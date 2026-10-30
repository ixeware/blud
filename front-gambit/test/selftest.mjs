// Headless self-test: plays AI-vs-AI games with auto-resolved duels and AI drones.
// Run: node test/selftest.mjs
import { newGame, apply, finishDuel, finishDrone, autoResolve } from '../web/src/rules.js';
import { aiChoose } from '../web/src/ai.js';
import { DroneSim } from '../web/src/drone.js';
import { DuelSim } from '../web/src/duel.js';

const GAMES = 20;
const res = { w: 0, b: 0, byScore: 0 };
let turns = 0;
for (let g = 0; g < GAMES; g++) {
  const s = newGame();
  let guard = 0;
  while (!s.winner && guard++ < 20000) {
    if (s.phase === 'duel') {
      // every 4th duel is fully simulated to exercise the real-time sim
      if (guard % 4 === 0) {
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
    if (apply(s, s.turn, cmd)) apply(s, s.turn, { c: 'end' });
    JSON.parse(JSON.stringify(s)); // state must stay serializable for multiplayer
  }
  if (!s.winner) throw new Error('game did not finish');
  res[s.winner]++;
  if (s.byScore) res.byScore++;
  turns += s.turnNo;
}
console.log(`OK: ${GAMES} games, blue ${res.w} / red ${res.b} (by score: ${res.byScore}), avg ${Math.round(turns / GAMES)} turns`);
