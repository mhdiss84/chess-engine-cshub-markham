// Headless self-play: the engine plays itself at each difficulty (same settings as the UI).
// Asserts: no crashes, only legal moves, the position is always restored after search,
// and every game reaches a proper end state (checkmate / stalemate / draw by rule).
//
//   node tests/selfplay.js [--easy 300] [--medium 200] [--hard 24] [--workers N] [--hard-workers 6] [--seed 1000]
const { runJobs, arg, saveResults, fmtDuration } = require('./pool');

// Mirrors DIFFICULTY in ui.js.
const LEVELS = {
  EASY:   { depth: 2, timeMs: 15000 },
  MEDIUM: { depth: 4, timeMs: 15000 },
  HARD:   { depth: 6, timeMs: 8000 },
};
const COUNTS = { EASY: +arg('easy', 300), MEDIUM: +arg('medium', 200), HARD: +arg('hard', 24) };
const WORKERS = +arg('workers', 14);
// HARD uses a wall-clock cap, so it runs on fewer threads (~ the performance-core count)
// to keep per-move thinking time close to what one booth machine gets.
const HARD_WORKERS = +arg('hard-workers', 6);
const SEED = +arg('seed', 1000);

(async () => {
  const summary = {};
  let anyFail = false;
  for (const level of Object.keys(LEVELS)) {
    const n = COUNTS[level];
    if (!n) continue;
    const cfg = LEVELS[level];
    const jobs = Array.from({ length: n }, (_, i) => ({ id: i, seed: SEED + i, label: level, white: cfg, black: cfg }));
    const t0 = Date.now();
    console.log(`\n== ${level} (depth ${cfg.depth}, cap ${cfg.timeMs / 1000}s): ${n} games ==`);
    const results = await runJobs(jobs, {
      workers: level === 'HARD' ? HARD_WORKERS : WORKERS,
      onResult: (r, done, total) => {
        if (!r.ok) console.log(`  FAIL game ${r.id} seed ${r.seed}: ${r.error}`);
        if (done % Math.max(1, Math.floor(total / 10)) === 0 || done === total) {
          console.log(`  ${done}/${total} games  (${fmtDuration(Date.now() - t0)})`);
        }
      }
    });
    const reasons = {}, winners = { w: 0, b: 0, draw: 0 };
    const depthCounts = {};
    let plies = 0, maxPly = 0, maxMoveMs = 0, moves = 0, moveMs = 0;
    const failures = results.filter(r => !r.ok);
    for (const r of results.filter(r => r.ok)) {
      reasons[r.reason] = (reasons[r.reason] || 0) + 1;
      winners[r.winner || 'draw']++;
      plies += r.plies; maxPly = Math.max(maxPly, r.plies);
      maxMoveMs = Math.max(maxMoveMs, r.stats.maxMoveMs);
      moves += r.stats.moves; moveMs += r.stats.totalMs;
      for (const [d, c] of Object.entries(r.stats.depthCounts)) depthCounts[d] = (depthCounts[d] || 0) + c;
    }
    const ok = results.length - failures.length;
    summary[level] = {
      games: n, completedCleanly: ok, failures: failures.length, endReasons: reasons,
      whiteWins: winners.w, blackWins: winners.b, draws: winners.draw,
      avgPlies: +(plies / Math.max(1, ok)).toFixed(1), maxPlies: maxPly,
      avgMoveMs: Math.round(moveMs / Math.max(1, moves)), maxMoveMs,
      depthReached: depthCounts, wallTime: fmtDuration(Date.now() - t0),
      failureDetails: failures.map(f => ({ id: f.id, seed: f.seed, error: f.error, fen: f.fen }))
    };
    if (failures.length) anyFail = true;
    const s = summary[level];
    console.log(`  clean endings: ${ok}/${n}   failures: ${failures.length}`);
    console.log(`  end reasons: ${JSON.stringify(reasons)}`);
    console.log(`  results: white ${winners.w}, black ${winners.b}, draws ${winners.draw}`);
    console.log(`  plies avg ${s.avgPlies} max ${s.maxPlies}; think time avg ${s.avgMoveMs}ms max ${s.maxMoveMs}ms`);
    console.log(`  depth reached per move: ${JSON.stringify(depthCounts)}`);
  }
  const file = saveResults('selfplay.json', { seed: SEED, levels: LEVELS, summary });
  console.log(`\nsaved ${file}`);
  console.log(anyFail ? 'SELF-PLAY: FAILURES FOUND' : 'SELF-PLAY: ALL GAMES ENDED CLEANLY');
  process.exitCode = anyFail ? 1 : 0;
})();
