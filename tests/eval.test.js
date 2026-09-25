// Step 2 verification: evaluation sign, symmetry, material scale, table lookups.
const { Chess, Evaluation, test, assert, eq, done, rng, randomPosition } = require('./lib');
const { evaluate, evaluateReference } = Evaluation;

// Color-flip a FEN: mirror ranks, swap piece colors, side to move, castling rights, ep square.
function flipFen(fen) {
  const [board, side, castle, ep, half, full] = fen.split(' ');
  const swap = s => s.replace(/[a-zA-Z]/g, ch => ch === ch.toUpperCase() ? ch.toLowerCase() : ch.toUpperCase());
  const b = swap(board.split('/').reverse().join('/'));
  const c = castle === '-' ? '-' : swap(castle).split('').sort((x, y) => 'KQkq'.indexOf(x) - 'KQkq'.indexOf(y)).join('');
  const e = ep === '-' ? '-' : ep[0] + (9 - Number(ep[1]));
  return [b, side === 'w' ? 'b' : 'w', c, e, half, full].join(' ');
}

test('start position evaluates to 0', () => eq(evaluate(new Chess()), 0));

test('every published table has 64 entries', () => {
  for (const k of Object.keys(Evaluation.PST)) eq(Evaluation.PST[k].length, 64, k);
});

test('known table lookups (knight e4 = +20, knight a1 = -50)', () => {
  // lone kings on symmetric squares cancel; only the knight differs
  eq(evaluate(new Chess('4k3/8/8/8/4N3/8/8/4K3 w - - 0 1')), 300 + 20);
  eq(evaluate(new Chess('4k3/8/8/8/8/8/8/N3K3 w - - 0 1')), 300 - 50);
});

test('extra white queen scores about +9', () => {
  const s = evaluate(new Chess('rnb1kbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'));
  assert(s >= 850 && s <= 950, 'got ' + s);
});

test('extra black rook scores about -5', () => {
  const s = evaluate(new Chess('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/1NBQKBNR w Kkq - 0 1'));
  assert(s <= -450 && s >= -550, 'got ' + s);
});

test('endgame king table used when queens are off', () => {
  // centralized king is good in the endgame table (+40 on e4/d4) but bad in middlegame
  const end = evaluate(new Chess('7k/8/8/8/4K3/8/8/8 w - - 0 1'));
  const endRef = 40 - (-50); // white king e4 (+40), black king h8 (kEnd corner -50)
  eq(end, endRef);
});

const rand = rng(12345);
test('color-flipped positions give exactly negated scores (300 random positions)', () => {
  for (let i = 0; i < 300; i++) {
    const c = randomPosition(rand, 5 + Math.floor(rand() * 80));
    const f = new Chess(flipFen(c.fen()));
    eq(evaluate(f), -evaluate(c), 'position ' + c.fen());
  }
});

test('fast evaluate() matches public-API evaluateReference() (500 random positions)', () => {
  for (let i = 0; i < 500; i++) {
    const c = randomPosition(rand, Math.floor(rand() * 120));
    eq(evaluate(c), evaluateReference(c), c.fen());
  }
});

module.exports = done('evaluation');
