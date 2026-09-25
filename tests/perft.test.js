// Step 1 verification: the rules layer (chess.js) and the engine's fast adapter
// over it both reproduce the published perft node counts.
const { Chess, Engine, test, assert, eq, done } = require('./lib');
const A = Engine._adapter;

// Reference counts: chessprogramming.org/Perft_Results
const POSITIONS = [
  ['start', 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', [20, 400, 8902, 197281]],
  ['kiwipete', 'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1', [48, 2039, 97862]],
  ['pos3 (ep/pins)', '8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1', [14, 191, 2812, 43238]],
  ['pos4 (promo/castle)', 'r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1', [6, 264, 9467]],
  ['pos5', 'rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8', [44, 1486, 62379]],
  ['pos6', 'r4rk1/1pp1qppp/p1np1n2/2b1p1B1/2B1P1b1/P1NP1N2/1PP1QPPP/R4RK1 w - - 0 10', [46, 2079, 89890]],
];

function adapterPerft(c, d) {
  if (d === 0) return 1;
  let n = 0;
  for (const m of A.legalMoves(c)) { A.make(c, m); n += adapterPerft(c, d - 1); A.unmake(c); }
  return n;
}

for (const [name, fen, counts] of POSITIONS) {
  counts.forEach((expected, i) => {
    const d = i + 1;
    test(`perft ${name} depth ${d} = ${expected}`, () => {
      const c = new Chess(fen);
      eq(c.perft(d), expected, 'chess.js perft');
      eq(adapterPerft(c, d), expected, 'engine adapter perft');
      eq(c.fen(), fen, 'position restored');
    });
  });
}

test('adapter make/unmake keeps repetition counts identical to public move/undo', () => {
  const a = new Chess(), b = new Chess();
  const seq = ['Nf3', 'Nf6', 'Ng1', 'Ng8', 'Nf3', 'Nf6', 'Ng1'];
  for (const san of seq) {
    a.move(san);
    const m = A.legalMoves(b).find(x => b._moveToSan(x, A.legalMoves(b)) === san);
    A.make(b, m);
  }
  assert(!a.isThreefoldRepetition() && !b.isThreefoldRepetition(), 'not yet threefold');
  a.move('Ng8');
  const m = A.legalMoves(b).find(x => b._moveToSan(x, A.legalMoves(b)) === 'Ng8');
  A.make(b, m);
  assert(a.isThreefoldRepetition(), 'public API sees threefold');
  assert(b.isThreefoldRepetition(), 'adapter sees threefold');
  A.unmake(b);
  assert(!b.isThreefoldRepetition(), 'unmake removes the repetition');
});

// ---- rule-specific checks through the public API the UI uses ----
test('castling both sides available and executes', () => {
  const c = new Chess('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1');
  const sans = c.moves();
  assert(sans.includes('O-O') && sans.includes('O-O-O'), 'castles listed');
  c.move('O-O');
  eq(c.get('g1').type, 'k'); eq(c.get('f1').type, 'r');
});
test('cannot castle through check', () => {
  const c = new Chess('r3k2r/8/8/8/8/8/5r2/R3K2R w KQkq - 0 1'); // f2 rook... attacks f1
  assert(!c.moves().includes('O-O'), 'O-O illegal through attacked f1');
});
test('en passant capture', () => {
  const c = new Chess('rnbqkbnr/ppp1p1pp/8/3pPp2/8/8/PPPP1PPP/RNBQKBNR w KQkq f6 0 3');
  const m = c.move({ from: 'e5', to: 'f6' });
  assert(m.flags.includes('e'), 'ep flag');
  assert(!c.get('f5'), 'captured pawn removed');
});
test('promotion offers all four pieces', () => {
  const c = new Chess('8/P7/8/8/8/8/8/k6K w - - 0 1');
  const promos = c.moves({ square: 'a7', verbose: true }).map(m => m.promotion).sort().join('');
  eq(promos, 'bnqr');
});
test('checkmate detected (fool\'s mate)', () => {
  const c = new Chess();
  ['f3', 'e5', 'g4', 'Qh4#'].forEach(m => c.move(m));
  assert(c.isCheckmate() && c.isGameOver());
});
test('stalemate detected', () => {
  const c = new Chess('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1');
  assert(c.isStalemate() && c.isDraw() && !c.isCheckmate());
});
test('insufficient material detected', () => {
  assert(new Chess('8/8/8/8/8/8/2k5/K1N5 w - - 0 1').isInsufficientMaterial());
});
test('fifty-move rule detected', () => {
  assert(new Chess('8/8/8/8/8/2k5/8/K1R5 w - - 100 80').isDrawByFiftyMoves());
});

module.exports = done('perft/rules');
