/*
 * evaluation.js — static position scoring.
 *
 * evaluate(chess) returns a score in centipawns from WHITE's point of view:
 * positive favors white, negative favors black. (UI divides by 100 for display.)
 *
 * Score = material + piece-square bonus.
 *   Material: pawn 100, knight 300, bishop 300, rook 500, queen 900 (the 1/3/3/5/9 scale).
 *   Piece-square tables: Tomasz Michniewski's "Simplified Evaluation Function"
 *   (chessprogramming.org/Simplified_Evaluation_Function), copied verbatim.
 *   Tables are written from white's side, rank 8 on the first row, file a first.
 *   Black pieces read the table vertically mirrored.
 */
(function (root) {
  'use strict';

  var PIECE_VALUE = { p: 100, n: 300, b: 300, r: 500, q: 900, k: 0 };

  var PST = {
    p: [
       0,  0,  0,  0,  0,  0,  0,  0,
      50, 50, 50, 50, 50, 50, 50, 50,
      10, 10, 20, 30, 30, 20, 10, 10,
       5,  5, 10, 25, 25, 10,  5,  5,
       0,  0,  0, 20, 20,  0,  0,  0,
       5, -5,-10,  0,  0,-10, -5,  5,
       5, 10, 10,-20,-20, 10, 10,  5,
       0,  0,  0,  0,  0,  0,  0,  0
    ],
    n: [
      -50,-40,-30,-30,-30,-30,-40,-50,
      -40,-20,  0,  0,  0,  0,-20,-40,
      -30,  0, 10, 15, 15, 10,  0,-30,
      -30,  5, 15, 20, 20, 15,  5,-30,
      -30,  0, 15, 20, 20, 15,  0,-30,
      -30,  5, 10, 15, 15, 10,  5,-30,
      -40,-20,  0,  5,  5,  0,-20,-40,
      -50,-40,-30,-30,-30,-30,-40,-50
    ],
    b: [
      -20,-10,-10,-10,-10,-10,-10,-20,
      -10,  0,  0,  0,  0,  0,  0,-10,
      -10,  0,  5, 10, 10,  5,  0,-10,
      -10,  5,  5, 10, 10,  5,  5,-10,
      -10,  0, 10, 10, 10, 10,  0,-10,
      -10, 10, 10, 10, 10, 10, 10,-10,
      -10,  5,  0,  0,  0,  0,  5,-10,
      -20,-10,-10,-10,-10,-10,-10,-20
    ],
    r: [
        0,  0,  0,  0,  0,  0,  0,  0,
        5, 10, 10, 10, 10, 10, 10,  5,
       -5,  0,  0,  0,  0,  0,  0, -5,
       -5,  0,  0,  0,  0,  0,  0, -5,
       -5,  0,  0,  0,  0,  0,  0, -5,
       -5,  0,  0,  0,  0,  0,  0, -5,
       -5,  0,  0,  0,  0,  0,  0, -5,
        0,  0,  0,  5,  5,  0,  0,  0
    ],
    q: [
      -20,-10,-10, -5, -5,-10,-10,-20,
      -10,  0,  0,  0,  0,  0,  0,-10,
      -10,  0,  5,  5,  5,  5,  0,-10,
       -5,  0,  5,  5,  5,  5,  0, -5,
        0,  0,  5,  5,  5,  5,  0, -5,
      -10,  5,  5,  5,  5,  5,  0,-10,
      -10,  0,  5,  0,  0,  0,  0,-10,
      -20,-10,-10, -5, -5,-10,-10,-20
    ],
    kMid: [
      -30,-40,-40,-50,-50,-40,-40,-30,
      -30,-40,-40,-50,-50,-40,-40,-30,
      -30,-40,-40,-50,-50,-40,-40,-30,
      -30,-40,-40,-50,-50,-40,-40,-30,
      -20,-30,-30,-40,-40,-30,-30,-20,
      -10,-20,-20,-20,-20,-20,-20,-10,
       20, 20,  0,  0,  0,  0, 20, 20,
       20, 30, 10,  0,  0, 10, 30, 20
    ],
    kEnd: [
      -50,-40,-30,-20,-20,-30,-40,-50,
      -30,-20,-10,  0,  0,-10,-20,-30,
      -30,-10, 20, 30, 30, 20,-10,-30,
      -30,-10, 30, 40, 40, 30,-10,-30,
      -30,-10, 30, 40, 40, 30,-10,-30,
      -30,-10, 20, 30, 30, 20,-10,-30,
      -30,-30,  0,  0,  0,  0,-30,-30,
      -50,-30,-30,-30,-30,-30,-30,-50
    ]
  };

  // Table index for a piece on (row, file), row 0 = rank 8.
  function pstIndex(color, row, file) {
    return color === 'w' ? row * 8 + file : (7 - row) * 8 + file;
  }

  // Michniewski's endgame rule: both sides have no queen, or every side that
  // has a queen has at most one minor piece and no rooks besides it.
  function sideIsEndgame(c) {
    return c.q === 0 || (c.r === 0 && c.n + c.b <= 1);
  }

  /*
   * Straightforward scorer over a list of {type, color, row, file}. Used by
   * evaluateReference(); evaluate() below is an allocation-free rewrite of the
   * same formula, and tests assert the two always agree.
   */
  function scorePieces(squares) {
    var score = 0;
    var counts = { w: { q: 0, r: 0, n: 0, b: 0 }, b: { q: 0, r: 0, n: 0, b: 0 } };
    var kings = [];
    for (var i = 0; i < squares.length; i++) {
      var s = squares[i];
      if (s.type === 'k') { kings.push(s); continue; }
      var v = PIECE_VALUE[s.type] + PST[s.type][pstIndex(s.color, s.row, s.file)];
      score += s.color === 'w' ? v : -v;
      if (s.type !== 'p') counts[s.color][s.type]++;
    }
    var endgame = sideIsEndgame(counts.w) && sideIsEndgame(counts.b);
    var kTable = endgame ? PST.kEnd : PST.kMid;
    for (var k = 0; k < kings.length; k++) {
      var kv = kTable[pstIndex(kings[k].color, kings[k].row, kings[k].file)];
      score += kings[k].color === 'w' ? kv : -kv;
    }
    return score;
  }

  /*
   * Fast path used by the search: reads chess.js's internal 0x88 board
   * (chess._board, 128 slots, index = row * 16 + file, row 0 = rank 8).
   * Pinned to the bundled chess.js v1.4.0; tests/eval.test.js checks it
   * against evaluateReference(), which uses only the public API.
   */
  function evaluate(chess) {
    var board = chess._board;
    var score = 0;
    var wq = 0, wr = 0, wm = 0, bq = 0, br = 0, bm = 0;
    var wk = -1, bk = -1;
    for (var sq = 0; sq < 128; sq++) {
      if (sq & 0x88) { sq += 7; continue; }
      var p = board[sq];
      if (!p) continue;
      var row = sq >> 4, file = sq & 7;
      if (p.color === 'w') {
        if (p.type === 'k') { wk = row * 8 + file; continue; }
        score += PIECE_VALUE[p.type] + PST[p.type][row * 8 + file];
        if (p.type === 'q') wq++; else if (p.type === 'r') wr++; else if (p.type !== 'p') wm++;
      } else {
        if (p.type === 'k') { bk = (7 - row) * 8 + file; continue; }
        score -= PIECE_VALUE[p.type] + PST[p.type][(7 - row) * 8 + file];
        if (p.type === 'q') bq++; else if (p.type === 'r') br++; else if (p.type !== 'p') bm++;
      }
    }
    var endgame = (wq === 0 || (wr === 0 && wm <= 1)) && (bq === 0 || (br === 0 && bm <= 1));
    var kTable = endgame ? PST.kEnd : PST.kMid;
    if (wk >= 0) score += kTable[wk];
    if (bk >= 0) score -= kTable[bk];
    return score;
  }

  // Reference implementation via the public chess.board() API (tests only).
  function evaluateReference(chess) {
    var rows = chess.board();
    var list = [];
    for (var r = 0; r < 8; r++) {
      for (var f = 0; f < 8; f++) {
        var p = rows[r][f];
        if (p) list.push({ type: p.type, color: p.color, row: r, file: f });
      }
    }
    return scorePieces(list);
  }

  var Evaluation = {
    evaluate: evaluate,
    evaluateReference: evaluateReference,
    PIECE_VALUE: PIECE_VALUE,
    PST: PST
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = Evaluation;
  else root.Evaluation = Evaluation;
})(typeof globalThis !== 'undefined' ? globalThis : this);
