// UI sanity check: loads the real index.html in jsdom (headless DOM) and drives it
// with click events. Verifies highlights == chess.js legal moves, illegal clicks are
// ignored silently, the engine replies, and each game-end banner renders.
const path = require('path');
const { pathToFileURL } = require('url');
const { JSDOM, ResourceLoader, VirtualConsole } = require('jsdom');
const { Chess, rng, randomPosition, ROOT } = require('./lib');

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('  ok   ' + name); }
  catch (e) { failed++; console.log('  FAIL ' + name + '\n       ' + (e && e.stack || e)); }
}
function assert(c, m) { if (!c) throw new Error(m || 'assertion failed'); }
function eq(a, b, m) { if (a !== b) throw new Error((m || 'expected equal') + `: got ${JSON.stringify(a)}, expected ${JSON.stringify(b)}`); }
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function waitFor(cond, ms, what) {
  const t0 = Date.now();
  while (!cond()) { if (Date.now() - t0 > ms) throw new Error('timeout waiting for ' + what); await sleep(20); }
}

// Resource loader that records every fetch and refuses anything that isn't a local file.
const requested = [];
class OfflineLoader extends ResourceLoader {
  fetch(url, options) {
    requested.push(url);
    if (!url.startsWith('file:')) return Promise.reject(new Error('network access attempted: ' + url));
    return super.fetch(url, options);
  }
}

async function loadPage() {
  const errors = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', e => errors.push(e));
  vc.on('error', e => errors.push(e));
  const dom = await JSDOM.fromFile(path.join(ROOT, 'index.html'), {
    runScripts: 'dangerously', resources: new OfflineLoader(), pretendToBeVisual: true,
    url: pathToFileURL(path.join(ROOT, 'index.html')).href, virtualConsole: vc
  });
  await new Promise(r => dom.window.addEventListener('load', r));
  const w = dom.window;
  const dialogs = [];
  w.alert = m => dialogs.push(['alert', m]);
  w.confirm = m => { dialogs.push(['confirm', m]); return true; };
  w.prompt = m => { dialogs.push(['prompt', m]); return null; };
  return { dom, w, doc: w.document, UI: w.ChessUI, dialogs, errors };
}

(async () => {
  const { w, doc, UI, dialogs, errors } = await loadPage();
  const cell = sq => doc.querySelector(`.sq[data-square="${sq}"]`);
  const click = sq => cell(sq).dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  const highlighted = () => [...doc.querySelectorAll('.sq.dest')].map(c => c.dataset.square).sort();
  const selected = () => [...doc.querySelectorAll('.sq.selected')].map(c => c.dataset.square);
  const banner = () => doc.getElementById('banner');
  const logText = () => doc.getElementById('log').textContent;
  const SQUARES = [];
  for (const f of 'abcdefgh') for (let r = 1; r <= 8; r++) SQUARES.push(f + r);

  await test('page loads with no script errors, only local files requested', async () => {
    eq(errors.length, 0, 'script errors: ' + errors.map(e => e.message).join('; '));
    assert(requested.length >= 5, 'expected css + 4 scripts');
    assert(requested.every(u => u.startsWith('file:')), 'non-local request: ' + requested.join(', '));
    eq(doc.querySelectorAll('.sq').length, 64, 'board cells');
    eq(doc.querySelectorAll('.sq span').length, 32, 'pieces rendered');
    assert(cell('e1').textContent.startsWith('♔') && cell('e8').textContent.startsWith('♚'), 'king glyphs');
  });

  await test('clicking any square highlights exactly chess.js legal destinations (120 positions x 64 squares)', async () => {
    const rand = rng(2024);
    let checkedPieces = 0;
    for (let i = 0; i < 120; i++) {
      const pos = randomPosition(rand, Math.floor(rand() * 90));
      if (pos.isGameOver()) continue;
      const fen = pos.fen();
      UI.loadFen(fen);
      const ref = new Chess(fen);
      for (const sq of SQUARES) {
        click(sq);
        const p = ref.get(sq);
        const expected = (p && p.color === ref.turn())
          ? [...new Set(ref.moves({ square: sq, verbose: true }).map(m => m.to))].sort() : [];
        eq(highlighted().join(','), expected.join(','), `highlights for ${sq} in ${fen}`);
        if (p && p.color === ref.turn()) { eq(selected().join(), sq, 'selected'); checkedPieces++; }
        else eq(selected().length, 0, 'nothing selected for empty/opponent square ' + sq);
        click(sq); // click again: deselects
        eq(highlighted().length, 0, 'deselect clears highlights');
        eq(UI.game().fen(), fen, 'position unchanged by selection clicks');
      }
    }
    console.log(`       verified ${checkedPieces} piece selections`);
  });

  await test('illegal destination clicks are ignored silently (no move, no dialog)', async () => {
    const rand = rng(7);
    for (let i = 0; i < 60; i++) {
      const pos = randomPosition(rand, Math.floor(rand() * 60));
      if (pos.isGameOver()) continue;
      const fen = pos.fen();
      UI.loadFen(fen);
      const movable = [...new Set(pos.moves({ verbose: true }).map(m => m.from))];
      const from = movable[Math.floor(rand() * movable.length)];
      const legalTo = new Set(pos.moves({ square: from, verbose: true }).map(m => m.to));
      const illegal = SQUARES.filter(s => !legalTo.has(s) && s !== from);
      click(from);
      click(illegal[Math.floor(rand() * illegal.length)]);
      eq(UI.game().fen(), fen, 'illegal click changed the position');
    }
    eq(dialogs.length, 0, 'dialogs shown: ' + JSON.stringify(dialogs));
  });

  await test('legal move by clicking, then engine replies with live depth log', async () => {
    UI.newGame();
    UI.setDifficulty('EASY');
    click('e2'); click('e4');
    assert(UI.game().history()[0] === 'e4', 'e4 played');
    assert(logText().includes('> you played: e4'), 'human move logged');
    click('d2'); // board is locked while engine thinks (or it is black's turn) -> ignored
    eq(selected().length, 0, 'no selection while engine to move');
    await waitFor(() => UI.game().history().length === 2 && !UI.state.thinking, 10000, 'engine reply');
    const log = logText();
    assert(/> depth 1\.\.\. best: \S+ \([+-]\d/.test(log), 'depth 1 line:\n' + log);
    assert(/> depth 2\.\.\. best: /.test(log), 'depth 2 line');
    assert(/> move played: \S+/.test(log), 'move played line');
    const hist = doc.getElementById('history').textContent;
    assert(/^1\. e4 \S+/.test(hist.trim()), 'history format: ' + hist);
    assert(banner().hidden, 'no banner mid-game');
  });

  await test('promotion via click shows prompt and promotes to chosen piece', async () => {
    UI.loadFen('7k/P7/8/8/8/8/8/K7 w - - 0 1');
    click('a7');
    eq(highlighted().join(), 'a8');
    click('a8');
    assert(!doc.getElementById('promo').hidden, 'promotion prompt shown');
    doc.querySelector('[data-promo="n"]').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
    eq(UI.game().get('a8').type, 'n');
    UI.state.token++; // cancel the engine reply for this test
  });

  const BANNERS = [
    ['checkmate by clicking (white mates)', () => { UI.loadFen('6k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 1'); click('d1'); click('d8'); }, 'CHECKMATE — WHITE WINS'],
    ['checkmate (scholar\'s mate)', () => UI.loadMoves(['e4', 'e5', 'Bc4', 'Nc6', 'Qh5', 'Nf6', 'Qxf7#']), 'CHECKMATE — WHITE WINS'],
    ['checkmate (fool\'s mate, black wins)', () => UI.loadMoves(['f3', 'e5', 'g4', 'Qh4#']), 'CHECKMATE — BLACK WINS'],
    ['stalemate', () => UI.loadFen('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1'), 'STALEMATE — DRAW'],
    ['stalemate by clicking', () => { UI.loadFen('7k/8/5QK1/8/8/8/8/8 w - - 0 1'); click('f6'); click('f7'); }, 'STALEMATE — DRAW'],
    ['insufficient material', () => UI.loadFen('8/8/8/8/8/8/2k5/K1N5 w - - 0 1'), 'DRAW — INSUFFICIENT MATERIAL'],
    ['threefold repetition', () => UI.loadMoves(['Nf3', 'Nf6', 'Ng1', 'Ng8', 'Nf3', 'Nf6', 'Ng1', 'Ng8']), 'DRAW — THREEFOLD REPETITION'],
    ['fifty-move rule', () => UI.loadFen('8/8/8/8/8/2k5/8/K1R5 w - - 100 80'), 'DRAW — FIFTY-MOVE RULE'],
  ];
  for (const [name, setup, text] of BANNERS) {
    await test(`banner: ${name} -> "${text}"`, async () => {
      setup();
      assert(!banner().hidden, 'banner visible');
      eq(banner().textContent, text);
      assert(logText().includes('> ' + text), 'log line');
      const fen = UI.game().fen();
      click('a1'); click('e1'); click('h8');
      eq(UI.game().fen(), fen, 'board frozen after game end');
      eq(highlighted().length, 0, 'no highlights after game end');
    });
  }

  await test('new game clears banner', async () => {
    doc.getElementById('newgame').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
    assert(banner().hidden, 'banner hidden');
    eq(UI.game().fen(), new Chess().fen());
  });

  await test('difficulty buttons map to depths 2 / 4 / 6', async () => {
    const D = UI.DIFFICULTY;
    eq(D.EASY.depth, 2); eq(D.MEDIUM.depth, 4); eq(D.HARD.depth, 6);
    doc.querySelector('[data-diff="HARD"]').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
    eq(UI.state.difficulty, 'HARD');
    assert(doc.querySelector('[data-diff="HARD"]').classList.contains('active'));
    eq(doc.querySelectorAll('.diff.active').length, 1);
  });

  await test('attract mode plays engine-vs-engine and any click hands control back', async () => {
    UI.startAttract();
    assert(UI.state.attract, 'attract on');
    assert(banner().textContent.includes('ATTRACT MODE'), 'attract banner');
    await waitFor(() => UI.game().history().length >= 3, 8000, 'demo moves');
    doc.body.dispatchEvent(new w.Event('pointerdown', { bubbles: true }));
    assert(!UI.state.attract, 'attract off after click');
    eq(UI.game().history().length, 0, 'fresh game for the visitor');
    assert(banner().hidden, 'banner cleared');
  });

  eq(dialogs.length, 0);
  console.log(`ui: ${passed} passed, ${failed} failed`);
  if (failed) process.exitCode = 1;
  w.close();
  process.exit(process.exitCode || 0);
})();
