// Steps 3-5 verification: minimax legality/tactics, alpha-beta == minimax,
// alpha-beta speedup, iterative deepening behaviour.
const { Chess, Engine, test, assert, eq, done, rng, randomPosition } = require('./lib');

function isLegal(chess, move) {
  return chess.moves({ verbose: true }).some(m => m.from === move.from && m.to === move.to &&
    (m.promotion || null) === (move.promotion || null));
}

const TACTICS = [
  // [name, fen, expected SAN (any of)]
  ['white mate in 1 (back rank)', '6k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 1', ['Rd8#']],
  ['black mate in 1 (back rank)', '3r2k1/5ppp/8/8/8/8/5PPP/6K1 b - - 0 1', ['Rd1#']],
  ['white wins hanging queen', 'rnb1kbnr/pppp1ppp/8/4p1q1/3P4/8/PPP1PPPP/RNBQKBNR w KQkq - 0 3', ['Bxg5']],
  ['black wins hanging queen', 'rnbqkb1r/pppppppp/5n2/8/4Q3/8/PPPP1PPP/RNB1KBNR b KQkq - 0 3', ['Nxe4']],
  ['white mate in 2 (depth 3)', 'r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4', ['Qxf7#']],
];

for (const algorithm of ['minimax', 'alphabeta']) {
  for (const [name, fen, expected] of TACTICS) {
    test(`${algorithm} depth 3: ${name}`, () => {
      const c = new Chess(fen);
      const r = Engine.search(c, 3, { algorithm });
      assert(isLegal(c, r.move), 'legal move');
      assert(expected.includes(r.san), `played ${r.san} (${Engine.formatScore(r.score)}), expected ${expected}`);
      eq(c.fen(), fen, 'position restored');
    });
  }
}

test('minimax depth 3 from start returns a legal move with a sane score', () => {
  const c = new Chess();
  const r = Engine.search(c, 3, { algorithm: 'minimax' });
  assert(isLegal(c, r.move));
  assert(Math.abs(r.score) < 100, 'opening score within a pawn: ' + r.score);
  console.log(`       minimax d3 start: ${r.san} ${Engine.formatScore(r.score)} nodes=${r.nodes} ${r.timeMs}ms`);
});

test('mate score reported as +M1 / -M1', () => {
  eq(Engine.formatScore(Engine.search(new Chess(TACTICS[0][1]), 2).score), '+M1');
  eq(Engine.formatScore(Engine.search(new Chess(TACTICS[1][1]), 2).score), '-M1');
});

test('no legal moves: checkmated / stalemated root returns null move', () => {
  const mated = Engine.search(new Chess('rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3'), 3);
  eq(mated.move, null); eq(mated.score, -Engine.MATE);
  const stale = Engine.search(new Chess('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1'), 3);
  eq(stale.move, null); eq(stale.score, 0);
});

test('alpha-beta score == minimax score, depth 3, 60 varied positions; fewer nodes', () => {
  const rand = rng(777);
  let mmNodes = 0, abNodes = 0, mmMs = 0, abMs = 0, sameMove = 0;
  const positions = TACTICS.map(t => new Chess(t[1]));
  while (positions.length < 60) {
    const c = randomPosition(rand, 4 + Math.floor(rand() * 60));
    if (!c.isGameOver()) positions.push(c);
  }
  for (const c of positions) {
    const fen = c.fen();
    const mm = Engine.search(c, 3, { algorithm: 'minimax' });
    const ab = Engine.search(c, 3, { algorithm: 'alphabeta' });
    eq(ab.score, mm.score, 'score mismatch at ' + fen);
    assert(isLegal(c, ab.move), 'legal');
    eq(c.fen(), fen, 'restored');
    if (ab.san === mm.san) sameMove++;
    mmNodes += mm.nodes; abNodes += ab.nodes; mmMs += mm.timeMs; abMs += ab.timeMs;
  }
  console.log(`       minimax:   ${mmNodes} nodes, ${mmMs} ms`);
  console.log(`       alphabeta: ${abNodes} nodes, ${abMs} ms  -> ${(mmNodes / abNodes).toFixed(1)}x fewer nodes, ${(mmMs / Math.max(1, abMs)).toFixed(1)}x faster`);
  console.log(`       identical move chosen in ${sameMove}/60 (others are equal-score ties)`);
  assert(abNodes * 2 < mmNodes, 'alpha-beta should search far fewer nodes');
});

test('alpha-beta best move always has the minimax-optimal value', () => {
  // For a tie, check the alpha-beta move scores the same as minimax's best when searched by minimax.
  const rand = rng(99);
  for (let i = 0; i < 25; i++) {
    const c = randomPosition(rand, 6 + Math.floor(rand() * 40));
    if (c.isGameOver()) continue;
    const mm = Engine.search(c, 3, { algorithm: 'minimax' });
    const ab = Engine.search(c, 3);
    c.move(ab.move);
    const after = c.isGameOver() ? null : Engine.search(c, 2, { algorithm: 'minimax' });
    let val;
    if (after) val = after.score;
    else if (c.isCheckmate()) val = c.turn() === 'w' ? -(Engine.MATE - 1) : Engine.MATE - 1;
    else val = 0;
    // child searched from ply 0: mate distances shift by one ply
    if (Math.abs(val) >= Engine.MATE - 1000 && after) val += val > 0 ? -1 : 1;
    c.undo();
    eq(val, mm.score, 'value of alpha-beta move at ' + c.fen());
  }
});

test('iterative deepening streams depths 1..N and ends at maxDepth', () => {
  const seen = [];
  const r = Engine.iterativeDeepeningSync(new Chess(), { maxDepth: 4, onDepth: d => seen.push(d.depth) });
  eq(seen.join(','), '1,2,3,4');
  eq(r.depth, 4);
});

test('iterative deepening respects the time cap and keeps last completed depth', () => {
  const c = new Chess(TACTICS[2][1]);
  const t0 = Date.now();
  const r = Engine.iterativeDeepeningSync(c, { maxDepth: 20, timeMs: 300 });
  const took = Date.now() - t0;
  assert(took < 1500, 'took ' + took + 'ms');
  assert(r.depth >= 2 && r.depth < 20 && r.move, 'depth ' + r.depth);
  eq(c.fen(), TACTICS[2][1], 'restored after abort');
});

test('iterative deepening stops early once mate is found', () => {
  const r = Engine.iterativeDeepeningSync(new Chess(TACTICS[0][1]), { maxDepth: 6 });
  eq(r.san, 'Rd8#'); eq(r.depth, 1);
});

test('depth 4 and 6 timing from a middlegame position', () => {
  for (const d of [4, 6]) {
    const c = new Chess('r1bqkb1r/pppp1ppp/2n2n2/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4');
    const r = Engine.iterativeDeepeningSync(c, { maxDepth: d });
    console.log(`       ID to depth ${d}: ${r.san} ${Engine.formatScore(r.score)} nodes(last iter)=${r.nodes} total ${r.totalMs}ms`);
  }
});

module.exports = done('search');
