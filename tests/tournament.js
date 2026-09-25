// Depth-vs-depth tournament: proves the engine gets stronger with depth.
// Games are played in pairs: same random opening, colors swapped, so neither side
// benefits from a lucky opening or from the white first-move advantage.
//
//   node tests/tournament.js [--strong 4] [--weak 2] [--pairs 100] [--workers N] [--seed 5000] [--cap ms]
const { runJobs, arg, saveResults, fmtDuration } = require('./pool');

const STRONG = +arg('strong', 4), WEAK = +arg('weak', 2);
const PAIRS = +arg('pairs', 100);
const WORKERS = +arg('workers', 14);
const SEED = +arg('seed', 5000);
// By default no time cap: each side always searches its full nominal depth.
// --cap applies a per-move time cap to both sides (e.g. 8000 to match HARD in the UI).
const CAP = +arg('cap', 0);
const S = { depth: STRONG, timeMs: CAP }, W = { depth: WEAK, timeMs: CAP };

(async () => {
  const jobs = [];
  for (let p = 0; p < PAIRS; p++) {
    jobs.push({ id: 2 * p, pair: p, seed: SEED + p, label: `d${STRONG} white`, white: S, black: W });
    jobs.push({ id: 2 * p + 1, pair: p, seed: SEED + p, label: `d${STRONG} black`, white: W, black: S });
  }
  const t0 = Date.now();
  console.log(`== tournament: depth ${STRONG} vs depth ${WEAK}, ${PAIRS} pairs = ${jobs.length} games` +
    (CAP ? `, ${CAP / 1000}s cap per move` : '') + ' ==');
  const results = await runJobs(jobs, {
    workers: WORKERS,
    onResult: (r, done, total) => {
      if (!r.ok) console.log(`  FAIL game ${r.id} seed ${r.seed}: ${r.error}`);
      if (done % 20 === 0 || done === total) console.log(`  ${done}/${total} games  (${fmtDuration(Date.now() - t0)})`);
    }
  });

  let win = 0, draw = 0, loss = 0;
  const reasons = {};
  const byColor = { white: { w: 0, d: 0, l: 0 }, black: { w: 0, d: 0, l: 0 } };
  const failures = results.filter(r => !r.ok);
  for (const r of results.filter(r => r.ok)) {
    const strongColor = r.white.depth === STRONG ? 'w' : 'b';
    const bucket = byColor[strongColor === 'w' ? 'white' : 'black'];
    reasons[r.reason] = (reasons[r.reason] || 0) + 1;
    if (!r.winner) { draw++; bucket.d++; }
    else if (r.winner === strongColor) { win++; bucket.w++; }
    else { loss++; bucket.l++; }
  }
  const played = win + draw + loss;
  const scorePct = 100 * (win + draw / 2) / played;
  const decisiveWinPct = 100 * win / Math.max(1, win + loss);
  // Elo difference implied by the score (logistic model), for context.
  const p = Math.min(0.999, Math.max(0.001, scorePct / 100));
  const elo = Math.round(-400 * Math.log10(1 / p - 1));

  console.log(`\ndepth ${STRONG} results over ${played} games (vs depth ${WEAK}):`);
  console.log(`  wins ${win}  draws ${draw}  losses ${loss}`);
  console.log(`  win rate ${(100 * win / played).toFixed(1)}%  |  score ${scorePct.toFixed(1)}%  |  wins among decisive games ${decisiveWinPct.toFixed(1)}%`);
  console.log(`  as white: ${JSON.stringify(byColor.white)}  as black: ${JSON.stringify(byColor.black)}`);
  console.log(`  end reasons: ${JSON.stringify(reasons)}`);
  console.log(`  implied Elo difference: ~${elo > 0 ? '+' : ''}${elo}`);
  console.log(`  failures (crash/illegal/no end): ${failures.length}`);

  const pass = failures.length === 0 && win > played / 2 && win > 3 * loss;
  const file = saveResults(`tournament-d${STRONG}-vs-d${WEAK}.json`, {
    strong: STRONG, weak: WEAK, pairs: PAIRS, seed: SEED, capMs: CAP, wins: win, draws: draw, losses: loss,
    scorePct, decisiveWinPct, elo, byColor, reasons, failures, wallTime: fmtDuration(Date.now() - t0)
  });
  console.log(`saved ${file}`);
  console.log(pass ? `TOURNAMENT: PASS (depth ${STRONG} wins a clear majority)` : 'TOURNAMENT: FAIL');
  process.exitCode = pass ? 0 : 1;
})();
