// Worker thread: plays one engine-vs-engine game per job and reports the outcome.
// Every invariant is checked here; any violation is reported as an error, never hidden.
const { parentPort } = require('worker_threads');
const { Chess, Engine, rng } = require('./lib');

const PLY_CAP = 600; // safety net only: reaching it counts as a FAILURE (a "hang"), not a draw

function playGame(job) {
  const rand = rng(job.seed);
  const chess = new Chess();
  const stats = { moves: 0, maxMoveMs: 0, totalMs: 0, depthCounts: {} };

  // Random opening plies so games differ (the engine itself is deterministic).
  const openingPlies = 2 + Math.floor(rand() * 3); // 2..4
  const opening = [];
  for (let i = 0; i < openingPlies && !chess.isGameOver(); i++) {
    const ms = chess.moves();
    const san = ms[Math.floor(rand() * ms.length)];
    chess.move(san);
    opening.push(san);
  }

  while (true) {
    const result = Engine.gameResult(chess); // throws if over for an unknown reason
    if (result) {
      return { ok: true, reason: result.reason, winner: result.winner, text: result.text,
        plies: chess.history().length, opening, stats, pgnTail: chess.history().slice(-6).join(' ') };
    }
    if (chess.history().length >= PLY_CAP) {
      return { ok: false, error: `ply cap ${PLY_CAP} reached without a game end`, fen: chess.fen(), opening, stats };
    }
    const side = chess.turn() === 'w' ? job.white : job.black;
    const fenBefore = chess.fen();
    const histBefore = chess.history().length;
    const r = Engine.iterativeDeepeningSync(chess, { maxDepth: side.depth, timeMs: side.timeMs || 0 });
    if (chess.fen() !== fenBefore || chess.history().length !== histBefore) {
      return { ok: false, error: 'search did not restore the position', fen: fenBefore, opening, stats };
    }
    if (!r.move) return { ok: false, error: 'engine returned no move in a live position', fen: fenBefore, opening, stats };
    const legal = chess.moves({ verbose: true }).some(m => m.from === r.move.from && m.to === r.move.to &&
      (m.promotion || null) === (r.move.promotion || null));
    if (!legal) return { ok: false, error: 'illegal engine move ' + JSON.stringify(r.move), fen: fenBefore, opening, stats };
    chess.move(r.move);
    stats.moves++;
    stats.totalMs += r.totalMs;
    stats.maxMoveMs = Math.max(stats.maxMoveMs, r.totalMs);
    stats.depthCounts[r.depth] = (stats.depthCounts[r.depth] || 0) + 1;
  }
}

parentPort.on('message', job => {
  let out;
  try { out = playGame(job); }
  catch (e) { out = { ok: false, error: 'exception: ' + (e && e.stack || e) }; }
  parentPort.postMessage(Object.assign({ id: job.id, seed: job.seed, label: job.label, white: job.white, black: job.black, pair: job.pair }, out));
});
