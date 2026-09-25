/*
 * engine.js — classical search: minimax, alpha-beta with move ordering,
 * iterative deepening. No machine learning; just game-tree search over the
 * static evaluation in evaluation.js.
 *
 * All scores are centipawns from WHITE's point of view (white maximizes,
 * black minimizes). Mate scores are +/-(MATE - ply), so shorter mates score
 * higher and the engine prefers the fastest win / slowest loss.
 *
 * Move legality comes entirely from chess.js. For speed the search talks to
 * chess.js's internal move generator (_moves / _makeMove / _undoMove) instead
 * of the public move()/undo(), which rebuild SAN strings and FENs for every
 * move (~85x slower). The adapter below mirrors exactly what the public
 * move()/undo() do (including the repetition counter), and
 * tests/perft.test.js checks it against chess.js's own perft counts.
 */
(function (root) {
  'use strict';

  var Evaluation = (typeof module !== 'undefined' && module.exports)
    ? require('./evaluation.js') : root.Evaluation;
  var evaluate = Evaluation.evaluate;
  var PIECE_VALUE = Evaluation.PIECE_VALUE;

  var MATE = 100000;
  var MATE_THRESHOLD = MATE - 1000;
  var INF = 1e9;
  var BITS_CAPTURE = 2, BITS_EP_CAPTURE = 8;

  // ---- chess.js adapter (pinned to bundled v1.4.0) ------------------------

  function legalMoves(chess) { return chess._moves({ legal: true }); }

  function make(chess, m) {
    chess._makeMove(m);
    chess._incPositionCount();
  }

  function unmake(chess) {
    var hash = chess._hash;
    chess._undoMove();
    chess._decPositionCount(hash);
  }

  function inCheck(chess) { return chess._isKingAttacked(chess._turn); }

  // Draws by rule (threefold repetition, fifty-move rule, insufficient material).
  // Stalemate is handled where the legal move list is generated.
  function drawByRule(chess) {
    return chess._halfMoves >= 100 ||
      chess._getPositionCount(chess._hash) >= 3 ||
      chess.isInsufficientMaterial();
  }

  // Score for the side to move being checkmated at this ply.
  function matedScore(chess, ply) {
    return chess._turn === 'w' ? -(MATE - ply) : (MATE - ply);
  }

  function squareName(sq) { return 'abcdefgh'[sq & 15] + (8 - (sq >> 4)); }

  function sameMove(a, b) {
    return !!a && !!b && a.from === b.from && a.to === b.to &&
      (a.promotion || null) === (b.promotion || null);
  }

  // ---- node bookkeeping ---------------------------------------------------

  // `heuristics` (killers + history) may be shared across iterative-deepening
  // iterations so each depth starts with what the previous one learned.
  function newHeuristics() {
    return {
      killers: [],                         // per ply: up to 2 quiet moves that caused a cutoff
      history: new Int32Array(128 * 128)   // quiet-move cutoff counts, indexed from*128+to
    };
  }

  function newContext(deadline, heuristics) {
    var h = heuristics || newHeuristics();
    return { nodes: 0, deadline: deadline || Infinity, stopped: false,
      killers: h.killers, history: h.history };
  }

  function isQuiet(m) { return !(m.flags & (BITS_CAPTURE | BITS_EP_CAPTURE)) && !m.promotion; }

  function sameInternal(a, b) {
    return !!a && a.from === b.from && a.to === b.to && a.promotion === b.promotion;
  }

  // Remember a quiet move that refuted this node (killer + history heuristics).
  function recordCutoff(ctx, m, ply, depth) {
    if (!isQuiet(m)) return;
    var k = ctx.killers[ply] || (ctx.killers[ply] = []);
    if (!sameInternal(k[0], m)) { k[1] = k[0]; k[0] = m; }
    ctx.history[m.from * 128 + m.to] += depth * depth;
  }

  function tick(ctx) {
    ctx.nodes++;
    if ((ctx.nodes & 1023) === 0 && ctx.deadline !== Infinity && Date.now() > ctx.deadline) {
      ctx.stopped = true;
    }
  }

  /*
   * Horizon node (depth 0). Checkmate is detected here when the side to move
   * is in check. Stalemate is detected at interior nodes only (checking it at
   * every leaf would need a full move generation per leaf). The move actually
   * played is always an interior child at depth >= 2, so it is never misjudged.
   */
  function leafScore(chess, ply) {
    if (inCheck(chess) && legalMoves(chess).length === 0) return matedScore(chess, ply);
    if (drawByRule(chess)) return 0;
    return evaluate(chess);
  }

  // ---- step 3: plain minimax ----------------------------------------------

  function minimax(chess, depth, ply, ctx) {
    tick(ctx);
    if (depth === 0) return leafScore(chess, ply);
    var moves = legalMoves(chess);
    if (moves.length === 0) return inCheck(chess) ? matedScore(chess, ply) : 0;
    if (ply > 0 && drawByRule(chess)) return 0;

    var white = chess._turn === 'w';
    var best = white ? -INF : INF;
    for (var i = 0; i < moves.length; i++) {
      make(chess, moves[i]);
      var s = minimax(chess, depth - 1, ply + 1, ctx);
      unmake(chess);
      if (ctx.stopped) return 0;
      if (white ? s > best : s < best) best = s;
    }
    return best;
  }

  // ---- step 4: move ordering + alpha-beta ---------------------------------

  /*
   * Order: previous-iteration best move, then captures by MVV-LVA (most
   * valuable victim, least valuable attacker), then promotions, then checking
   * moves, then killer moves, then remaining quiet moves by history score.
   * Ties keep chess.js's generation order. Ordering never changes the value
   * alpha-beta returns, only how much of the tree it can skip.
   */
  function orderMoves(chess, moves, pvMove, ctx, ply) {
    var killers = ctx && ctx.killers[ply];
    var scored = new Array(moves.length);
    for (var i = 0; i < moves.length; i++) {
      var m = moves[i];
      var key = 0;
      if (pvMove && sameMove({ from: squareName(m.from), to: squareName(m.to), promotion: m.promotion }, pvMove)) {
        key = 1000000;
      } else if (m.flags & (BITS_CAPTURE | BITS_EP_CAPTURE)) {
        var victim = m.captured ? PIECE_VALUE[m.captured] : PIECE_VALUE.p;
        var attacker = m.piece === 'k' ? 1000 : PIECE_VALUE[m.piece];
        key = 100000 + victim * 10 - attacker;
      } else if (m.promotion) {
        key = 50000 + PIECE_VALUE[m.promotion];
      } else {
        chess._makeMove(m);
        if (chess._isKingAttacked(chess._turn)) key = 10000;
        chess._undoMove();
        if (key === 0 && killers) {
          if (sameInternal(killers[0], m)) key = 9000;
          else if (sameInternal(killers[1], m)) key = 8000;
        }
        if (key === 0 && ctx) key = Math.min(7999, ctx.history[m.from * 128 + m.to]);
      }
      scored[i] = { m: m, key: key };
    }
    scored.sort(function (a, b) { return b.key - a.key; });
    for (var j = 0; j < scored.length; j++) moves[j] = scored[j].m;
    return moves;
  }

  function alphaBeta(chess, depth, alpha, beta, ply, ctx) {
    tick(ctx);
    if (depth === 0) return leafScore(chess, ply);
    var moves = legalMoves(chess);
    if (moves.length === 0) return inCheck(chess) ? matedScore(chess, ply) : 0;
    if (ply > 0 && drawByRule(chess)) return 0;
    orderMoves(chess, moves, null, ctx, ply);

    var white = chess._turn === 'w';
    var best = white ? -INF : INF;
    for (var i = 0; i < moves.length; i++) {
      make(chess, moves[i]);
      var s = alphaBeta(chess, depth - 1, alpha, beta, ply + 1, ctx);
      unmake(chess);
      if (ctx.stopped) return 0;
      if (white) {
        if (s > best) best = s;
        if (best > alpha) alpha = best;
      } else {
        if (s < best) best = s;
        if (best < beta) beta = best;
      }
      if (alpha >= beta) { recordCutoff(ctx, moves[i], ply, depth); break; }
    }
    return best;
  }

  // ---- root search --------------------------------------------------------

  /*
   * search(chess, depth, opts) -> { move, san, score, nodes, timeMs, depth, completed }
   *   opts.algorithm: 'alphabeta' (default) or 'minimax'
   *   opts.deadline:  absolute ms timestamp; search aborts (completed=false) past it
   *   opts.pvMove:    {from,to,promotion} to try first (from a previous iteration)
   *   opts.heuristics: killer/history tables to reuse (from a previous iteration)
   * `move` is a public-API move object {from, to, promotion} usable with chess.move().
   * The position is always restored before returning.
   */
  function search(chess, depth, opts) {
    opts = opts || {};
    var useMinimax = opts.algorithm === 'minimax';
    var ctx = newContext(opts.deadline, opts.heuristics);
    var t0 = Date.now();
    var historyLen = chess._history.length;

    var moves = legalMoves(chess);
    if (moves.length === 0) {
      return { move: null, san: null, score: inCheck(chess) ? matedScore(chess, 0) : 0,
        nodes: 1, timeMs: 0, depth: depth, completed: true };
    }
    if (!useMinimax) orderMoves(chess, moves, opts.pvMove || null, ctx, 0);

    var white = chess._turn === 'w';
    var best = white ? -INF : INF, bestMove = null;
    var alpha = -INF, beta = INF;
    ctx.nodes++;
    for (var i = 0; i < moves.length; i++) {
      make(chess, moves[i]);
      var s = useMinimax
        ? minimax(chess, depth - 1, 1, ctx)
        : alphaBeta(chess, depth - 1, alpha, beta, 1, ctx);
      unmake(chess);
      if (ctx.stopped) break;
      if (white ? s > best : s < best) { best = s; bestMove = moves[i]; }
      if (!useMinimax) {
        if (white && best > alpha) alpha = best;
        if (!white && best < beta) beta = best;
      }
    }

    if (chess._history.length !== historyLen) throw new Error('search left the board modified');

    var result = { move: null, san: null, score: best, nodes: ctx.nodes,
      timeMs: Date.now() - t0, depth: depth, completed: !ctx.stopped };
    if (bestMove) {
      result.move = { from: squareName(bestMove.from), to: squareName(bestMove.to) };
      if (bestMove.promotion) result.move.promotion = bestMove.promotion;
      result.san = sanFor(chess, result.move);
    }
    return result;
  }

  // SAN for a legal move via the public API (once per search, so speed is irrelevant).
  function sanFor(chess, move) {
    var list = chess.moves({ verbose: true });
    for (var i = 0; i < list.length; i++) {
      if (sameMove(list[i], move)) return list[i].san;
    }
    throw new Error('engine produced a move chess.js does not list as legal: ' + JSON.stringify(move));
  }

  // ---- step 5: iterative deepening ----------------------------------------

  /*
   * Generator: runs depth 1, 2, ... maxDepth. Yields events
   *   { type: 'start', depth }          before each depth begins
   *   { type: 'done', result }          when a depth completes
   *   { type: 'abort', depth }          when the time cap cuts a depth short
   * An unfinished depth is discarded; the last completed one stands. Also
   * stops once a forced mate is found (deeper search cannot improve on it).
   */
  function* deepen(chess, opts) {
    var maxDepth = opts.maxDepth || 3;
    var t0 = Date.now();
    var deadline = opts.timeMs ? t0 + opts.timeMs : Infinity;
    var best = null;
    var heuristics = newHeuristics();
    for (var d = 1; d <= maxDepth; d++) {
      if (Date.now() >= deadline) break;
      yield { type: 'start', depth: d };
      var r = search(chess, d, { deadline: deadline, pvMove: best && best.move, heuristics: heuristics });
      if (!r.completed) { yield { type: 'abort', depth: d }; break; }
      best = r;
      yield { type: 'done', result: r };
      if (!r.move || Math.abs(r.score) >= MATE_THRESHOLD) break;
    }
    if (!best) best = search(chess, 1, {}); // time cap too tight for depth 1: finish it anyway
    best.totalMs = Date.now() - t0;
    return best;
  }

  function dispatch(opts, ev) {
    if (ev.type === 'start' && opts.onStart) opts.onStart(ev.depth);
    else if (ev.type === 'done' && opts.onDepth) opts.onDepth(ev.result);
    else if (ev.type === 'abort' && opts.onAbort) opts.onAbort(ev.depth);
  }

  // Synchronous iterative deepening (used by the headless test harness).
  // opts: { maxDepth, timeMs, onStart(depth), onDepth(result), onAbort(depth) }
  function iterativeDeepeningSync(chess, opts) {
    opts = opts || {};
    var it = deepen(chess, opts);
    for (;;) {
      var step = it.next();
      if (step.done) return step.value;
      dispatch(opts, step.value);
    }
  }

  // Async iterative deepening for the browser: yields to the event loop between
  // events so the log panel repaints ("depth 6..." shows before depth 6 runs).
  function iterativeDeepening(chess, opts) {
    opts = opts || {};
    var it = deepen(chess, opts);
    return new Promise(function (resolve, reject) {
      function pump() {
        try {
          var step = it.next();
          if (step.done) return resolve(step.value);
          dispatch(opts, step.value);
          setTimeout(pump, 0);
        } catch (e) { reject(e); }
      }
      setTimeout(pump, 0);
    });
  }

  /*
   * Classify a finished game using chess.js's own rule checks.
   * Returns null if the game is not over, else
   * { reason: 'checkmate'|'stalemate'|'insufficient'|'threefold'|'fifty-move', winner: 'w'|'b'|null, text }
   * Throws if chess.js says the game is over but no known reason applies.
   */
  function gameResult(chess) {
    if (!chess.isGameOver()) return null;
    if (chess.isCheckmate()) {
      var winner = chess.turn() === 'w' ? 'b' : 'w';
      return { reason: 'checkmate', winner: winner,
        text: 'CHECKMATE — ' + (winner === 'w' ? 'WHITE' : 'BLACK') + ' WINS' };
    }
    if (chess.isStalemate()) return { reason: 'stalemate', winner: null, text: 'STALEMATE — DRAW' };
    if (chess.isInsufficientMaterial()) return { reason: 'insufficient', winner: null, text: 'DRAW — INSUFFICIENT MATERIAL' };
    if (chess.isThreefoldRepetition()) return { reason: 'threefold', winner: null, text: 'DRAW — THREEFOLD REPETITION' };
    if (chess.isDrawByFiftyMoves()) return { reason: 'fifty-move', winner: null, text: 'DRAW — FIFTY-MOVE RULE' };
    throw new Error('game over for an unrecognized reason: ' + chess.fen());
  }

  // "+0.30", "-1.25", "+M3" (white mates in 3), "-M2" (black mates in 2).
  function formatScore(score) {
    if (Math.abs(score) >= MATE_THRESHOLD) {
      var moves = Math.ceil((MATE - Math.abs(score)) / 2);
      return (score > 0 ? '+M' : '-M') + moves;
    }
    var p = score / 100;
    return (p >= 0 ? '+' : '') + p.toFixed(2);
  }

  var Engine = {
    MATE: MATE,
    search: search,
    minimax: minimax,
    alphaBeta: alphaBeta,
    orderMoves: orderMoves,
    iterativeDeepening: iterativeDeepening,
    iterativeDeepeningSync: iterativeDeepeningSync,
    gameResult: gameResult,
    formatScore: formatScore,
    // exposed for tests
    _adapter: { legalMoves: legalMoves, make: make, unmake: unmake, squareName: squareName }
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = Engine;
  else root.Engine = Engine;
})(typeof globalThis !== 'undefined' ? globalThis : this);
