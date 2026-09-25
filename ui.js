/*
 * ui.js — board rendering, click interaction, live engine log, difficulty,
 * game-end banners, and idle attract mode.
 *
 * All legality comes from chess.js: highlighted destinations are exactly
 * chess.moves({ square, verbose: true }). Clicks that aren't a legal action
 * are ignored silently.
 */
(function () {
  'use strict';

  var DIFFICULTY = {
    EASY:   { depth: 2, timeMs: 15000 },
    MEDIUM: { depth: 4, timeMs: 15000 },
    HARD:   { depth: 6, timeMs: 8000 }
  };
  var ATTRACT = { depth: 2, moveDelayMs: 700, restartDelayMs: 6000, maxPlies: 300 };
  var IDLE_MS_IDLE_BOARD = 45000;  // new or finished game
  var IDLE_MS_MID_GAME = 120000;   // visitor may still be thinking
  var FILES = 'abcdefgh';
  var VS15 = '︎'; // force text (not emoji) presentation of the pawn glyphs
  var GLYPH = {
    w: { k: '♔', q: '♕', r: '♖', b: '♗', n: '♘', p: '♙' },
    b: { k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟' }
  };

  var $ = function (id) { return document.getElementById(id); };
  var boardEl = $('board'), logEl = $('log'), historyEl = $('history'), statusEl = $('status');
  var bannerEl = $('banner'), promoEl = $('promo');

  var state = {
    chess: new Chess(),
    human: 'w',
    difficulty: 'MEDIUM',
    selected: null,       // square name
    dests: [],            // verbose moves from the selected square
    pendingPromo: null,   // {from, to} awaiting piece choice
    thinking: false,
    over: null,           // Engine.gameResult() once the game ends
    attract: false,
    token: 0,             // bumps on every new game; stale async work checks it
    idleTimer: null
  };

  // ---- log ------------------------------------------------------------------

  function log(text, cls) {
    var line = document.createElement('div');
    if (cls) line.className = cls;
    line.textContent = text;
    logEl.appendChild(line);
    while (logEl.childNodes.length > 300) logEl.removeChild(logEl.firstChild);
    logEl.scrollTop = logEl.scrollHeight;
    return line;
  }

  function append(line, text, cls) {
    var span = document.createElement('span');
    if (cls) span.className = cls;
    span.textContent = text;
    line.appendChild(span);
    logEl.scrollTop = logEl.scrollHeight;
  }

  // ---- rendering ------------------------------------------------------------

  function orientation() { return state.human; }

  function squareAt(row, col) {
    // row/col are screen positions (0 = top/left)
    return orientation() === 'w'
      ? FILES[col] + (8 - row)
      : FILES[7 - col] + (row + 1);
  }

  function buildBoard() {
    boardEl.innerHTML = '';
    for (var row = 0; row < 8; row++) {
      for (var col = 0; col < 8; col++) {
        var sq = squareAt(row, col);
        var cell = document.createElement('div');
        var fileIdx = FILES.indexOf(sq[0]), rank = Number(sq[1]);
        cell.className = 'sq ' + ((fileIdx + rank) % 2 === 1 ? 'light' : 'dark');
        cell.dataset.square = sq;
        cell.setAttribute('role', 'gridcell');
        boardEl.appendChild(cell);
      }
    }
    var ranks = $('ranks'), files = $('files');
    ranks.innerHTML = ''; files.innerHTML = '';
    for (var i = 0; i < 8; i++) {
      var r = document.createElement('span');
      r.textContent = squareAt(i, 0)[1];
      ranks.appendChild(r);
      var f = document.createElement('span');
      f.textContent = squareAt(7, i)[0];
      files.appendChild(f);
    }
  }

  function render() {
    var chess = state.chess;
    var hist = chess.history({ verbose: true });
    var last = hist.length ? hist[hist.length - 1] : null;
    var destSet = {};
    state.dests.forEach(function (m) { destSet[m.to] = m; });
    var checkSq = null;
    if (chess.inCheck()) checkSq = findKing(chess, chess.turn());

    var cells = boardEl.children;
    for (var i = 0; i < cells.length; i++) {
      var cell = cells[i], sq = cell.dataset.square;
      var p = chess.get(sq);
      cell.innerHTML = '';
      if (p) {
        var span = document.createElement('span');
        span.className = 'pc-' + p.color;
        span.textContent = GLYPH[p.color][p.type] + VS15;
        cell.appendChild(span);
      }
      cell.classList.toggle('selected', sq === state.selected);
      cell.classList.toggle('dest', !!destSet[sq]);
      cell.classList.toggle('capture', !!destSet[sq] && !!p);
      cell.classList.toggle('last', !!last && (sq === last.from || sq === last.to));
      cell.classList.toggle('check', sq === checkSq);
    }
    boardEl.classList.toggle('locked', !canHumanAct());
    renderHistory(hist);
    renderStatus();
  }

  function findKing(chess, color) {
    var rows = chess.board();
    for (var r = 0; r < 8; r++) for (var f = 0; f < 8; f++) {
      var p = rows[r][f];
      if (p && p.type === 'k' && p.color === color) return p.square;
    }
    return null;
  }

  function renderHistory(hist) {
    historyEl.innerHTML = '';
    // "1. e4 e5  2. Nf3 Nc6 ..." numbered from the starting FEN's move counter
    var moveNo = hist.length ? (Number(hist[0].before.split(' ')[5]) || 1) : 1;
    for (var i = 0; i < hist.length; i++) {
      var m = hist[i];
      if (m.color === 'w' || i === 0) {
        var num = document.createElement('span');
        num.className = 'num';
        num.textContent = (i > 0 ? '  ' : '') + moveNo + (m.color === 'w' ? '. ' : '... ');
        historyEl.appendChild(num);
      }
      historyEl.appendChild(document.createTextNode(m.san + ' '));
      if (m.color === 'b') moveNo++;
    }
    historyEl.scrollTop = historyEl.scrollHeight;
  }

  function renderStatus() {
    var s;
    if (state.attract) s = '> demo: engine vs engine';
    else if (state.over) s = '> game over. click [NEW GAME] to play again';
    else if (state.thinking) s = '> engine thinking';
    else if (state.pendingPromo) s = '> choose promotion piece';
    else if (state.chess.turn() === state.human) s = '> your move (' + (state.human === 'w' ? 'white' : 'black') + ')';
    else s = '> waiting';
    statusEl.textContent = s + ' ';
    var cur = document.createElement('span');
    cur.className = 'cursor';
    cur.textContent = '█';
    statusEl.appendChild(cur);
  }

  function showBanner(text, attract) {
    bannerEl.textContent = text;
    bannerEl.classList.toggle('attract', !!attract);
    bannerEl.hidden = false;
  }
  function hideBanner() { bannerEl.hidden = true; bannerEl.textContent = ''; }

  // ---- human interaction ----------------------------------------------------

  function canHumanAct() {
    return !state.thinking && !state.over && !state.attract && !state.pendingPromo &&
      state.chess.turn() === state.human;
  }

  function clearSelection() { state.selected = null; state.dests = []; }

  function onSquare(sq) {
    if (!canHumanAct()) return;
    var chess = state.chess;
    var target = null;
    for (var i = 0; i < state.dests.length; i++) if (state.dests[i].to === sq) target = state.dests[i];

    if (state.selected && target) {
      if (target.promotion) {
        state.pendingPromo = { from: state.selected, to: sq };
        promoEl.hidden = false;
        render();
        return;
      }
      humanMove({ from: state.selected, to: sq });
      return;
    }
    var p = chess.get(sq);
    if (p && p.color === state.human && sq !== state.selected) {
      state.selected = sq;
      state.dests = chess.moves({ square: sq, verbose: true });
    } else {
      clearSelection(); // any other click: quietly deselect
    }
    render();
  }

  function onPromo(choice) {
    var pend = state.pendingPromo;
    if (!pend) return;
    state.pendingPromo = null;
    promoEl.hidden = true;
    if (choice === 'cancel') { clearSelection(); render(); return; }
    humanMove({ from: pend.from, to: pend.to, promotion: choice });
  }

  function humanMove(mv) {
    var m;
    try { m = state.chess.move(mv); } catch (e) { m = null; } // never happens for listed dests
    clearSelection();
    if (!m) { render(); return; }
    log('> you played: ' + m.san, 'hi');
    render();
    if (!checkGameEnd()) engineTurn();
  }

  // ---- engine turn ----------------------------------------------------------

  function engineTurn() {
    var token = state.token;
    var chess = state.chess;
    var cfg = DIFFICULTY[state.difficulty];
    state.thinking = true;
    render();
    log('> engine thinking [' + state.difficulty + ': depth ' + cfg.depth + ', cap ' + (cfg.timeMs / 1000) + 's]', 'dim');
    var line = null;
    return Engine.iterativeDeepening(chess, {
      maxDepth: cfg.depth,
      timeMs: cfg.timeMs,
      onStart: function (d) { if (token === state.token) line = log('> depth ' + d + '... '); },
      onDepth: function (r) {
        if (token !== state.token || !line) return;
        append(line, 'best: ' + r.san + ' (' + Engine.formatScore(r.score) + ')');
        append(line, '  ' + r.nodes.toLocaleString('en-US') + ' nodes, ' + (r.timeMs / 1000).toFixed(2) + 's', 'dim');
      },
      onAbort: function (d) {
        if (token === state.token && line) append(line, 'time cap reached — keeping depth ' + (d - 1), 'dim');
      }
    }).then(function (res) {
      if (token !== state.token) return; // new game started meanwhile
      state.thinking = false;
      var m = chess.move(res.move);
      log('> move played: ' + m.san, 'hi');
      render();
      checkGameEnd();
    }).catch(function (e) {
      state.thinking = false;
      log('> engine error: ' + (e && e.message), 'warn');
      render();
    });
  }

  function checkGameEnd() {
    var res = Engine.gameResult(state.chess);
    if (!res) return false;
    state.over = res;
    clearSelection();
    showBanner(res.text, false);
    log('> ' + res.text, 'hi');
    if (!state.attract) log('> type [NEW GAME] to restart', 'dim');
    render();
    armIdle();
    return true;
  }

  // ---- game control ---------------------------------------------------------

  function newGame(opts) {
    opts = opts || {};
    state.token++;
    state.chess = opts.fen ? new Chess(opts.fen) : new Chess();
    state.human = opts.human || 'w';
    state.thinking = false;
    state.over = null;
    state.pendingPromo = null;
    promoEl.hidden = true;
    clearSelection();
    hideBanner();
    buildBoard();
    if (!opts.quiet) {
      logEl.innerHTML = '';
      log('> ./play --engine=alphabeta --difficulty=' + state.difficulty, 'dim');
      log('> new game. you are ' + (state.human === 'w' ? 'WHITE' : 'BLACK') + '. click a piece to move.');
    }
    render();
    if (!state.attract) {
      if (!checkGameEnd() && state.chess.turn() !== state.human && opts.engineMoves !== false) engineTurn();
    }
    armIdle();
  }

  function setDifficulty(name) {
    if (!DIFFICULTY[name]) return;
    state.difficulty = name;
    var btns = document.querySelectorAll('.diff');
    for (var i = 0; i < btns.length; i++) {
      var on = btns[i].dataset.diff === name;
      btns[i].classList.toggle('active', on);
      btns[i].textContent = on ? '> ' + name + '_' : '[' + btns[i].dataset.diff + ']';
    }
    var cfg = DIFFICULTY[name];
    log('> set difficulty ' + name + ' (depth ' + cfg.depth + ')', 'dim');
  }

  function toggleTheme() {
    var root = document.documentElement;
    var amber = root.getAttribute('data-theme') !== 'amber';
    if (amber) root.setAttribute('data-theme', 'amber'); else root.removeAttribute('data-theme');
    try { localStorage.setItem('chess-theme', amber ? 'amber' : 'green'); } catch (e) { /* ignore */ }
  }

  // ---- attract mode (idle self-play) ----------------------------------------

  function armIdle() {
    clearTimeout(state.idleTimer);
    if (state.attract) return;
    var midGame = !state.over && state.chess.history().length > 0;
    state.idleTimer = setTimeout(startAttract, midGame ? IDLE_MS_MID_GAME : IDLE_MS_IDLE_BOARD);
  }

  function startAttract() {
    if (state.thinking) { armIdle(); return; }
    state.attract = true;
    attractGame();
  }

  function attractGame() {
    newGame({ quiet: true });
    logEl.innerHTML = '';
    log('> attract mode: engine vs engine (depth ' + ATTRACT.depth + ')', 'dim');
    showBanner('ATTRACT MODE — CLICK ANYWHERE TO PLAY', true);
    var token = state.token;
    var plies = 0;
    function step() {
      if (!state.attract || token !== state.token) return;
      var chess = state.chess;
      var res = Engine.gameResult(chess);
      if (res || plies >= ATTRACT.maxPlies) {
        log('> ' + (res ? res.text : 'demo game ended'), 'hi');
        showBanner((res ? res.text + '  —  ' : '') + 'CLICK ANYWHERE TO PLAY', true);
        setTimeout(function () { if (state.attract && token === state.token) attractGame(); }, ATTRACT.restartDelayMs);
        return;
      }
      var mv;
      if (plies < 2) { // random opening plies so demo games differ
        var ms = chess.moves({ verbose: true });
        mv = ms[Math.floor(Math.random() * ms.length)];
      } else {
        mv = Engine.iterativeDeepeningSync(chess, { maxDepth: ATTRACT.depth, timeMs: 2000 }).move;
      }
      var m = chess.move({ from: mv.from, to: mv.to, promotion: mv.promotion });
      plies++;
      log('> ' + (m.color === 'w' ? 'white' : 'black') + ': ' + m.san, 'dim');
      render();
      setTimeout(step, ATTRACT.moveDelayMs);
    }
    setTimeout(step, ATTRACT.moveDelayMs);
  }

  function stopAttract() {
    state.attract = false;
    newGame();
  }

  // ---- wiring ---------------------------------------------------------------

  // Capture phase: the first click during attract mode only wakes the app.
  document.addEventListener('pointerdown', function (e) {
    if (state.attract) { e.preventDefault(); e.stopPropagation(); stopAttract(); state.swallowClick = true; return; }
    armIdle();
  }, true);
  document.addEventListener('click', function (e) {
    if (state.swallowClick) { state.swallowClick = false; e.stopPropagation(); e.preventDefault(); }
  }, true);
  document.addEventListener('keydown', function (e) {
    armIdle();
    if (e.key === 'Escape' && state.pendingPromo) onPromo('cancel');
  });

  boardEl.addEventListener('click', function (e) {
    var cell = e.target.closest ? e.target.closest('.sq') : null;
    if (cell) onSquare(cell.dataset.square);
  });
  promoEl.addEventListener('click', function (e) {
    var b = e.target.closest ? e.target.closest('[data-promo]') : null;
    if (b) onPromo(b.dataset.promo);
  });
  Array.prototype.forEach.call(document.querySelectorAll('.diff'), function (b) {
    b.addEventListener('click', function () { setDifficulty(b.dataset.diff); });
  });
  $('newgame').addEventListener('click', function () { newGame(); });
  $('theme').addEventListener('click', toggleTheme);

  try { if (localStorage.getItem('chess-theme') === 'amber') document.documentElement.setAttribute('data-theme', 'amber'); } catch (e) { /* ignore */ }

  newGame();
  setDifficulty('MEDIUM');

  // Test / debugging hooks (used by tests/ui.test.js).
  window.ChessUI = {
    state: state,
    game: function () { return state.chess; },
    newGame: newGame,
    // Load a position; the human plays the side to move; the engine does not auto-move.
    loadFen: function (fen) { newGame({ fen: fen, human: fen.split(' ')[1], engineMoves: false }); },
    // Replay SAN moves from the start without engine replies, then check for game end.
    loadMoves: function (sans) {
      newGame({ engineMoves: false });
      sans.forEach(function (s) { state.chess.move(s); });
      if (!state.chess.isGameOver()) state.human = state.chess.turn();
      buildBoard(); render(); checkGameEnd();
    },
    clickSquare: onSquare,
    setDifficulty: setDifficulty,
    startAttract: startAttract,
    stopAttract: stopAttract,
    DIFFICULTY: DIFFICULTY
  };
})();
