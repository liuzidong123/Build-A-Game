/* 国际象棋 · 电脑对手（浅层迭代加深 + alpha-beta + 吃子静搜）
 * 依赖 logic.js 暴露的 ChessCore；棋子走法一律来自同一份规则，避免 AI 走出假棋。
 */
(function (root) {
  'use strict';

  var Core = root.ChessCore;
  var WHITE = Core.WHITE;
  var BLACK = Core.BLACK;
  var MATE = 100000;

  var VALUE = { P: 100, N: 320, B: 330, R: 500, Q: 900, K: 0 };

  /* 位置分（白方视角，行 0 = 第 8 横线），数值来自常见简化表 */
  var PST = {
    P: [
      0, 0, 0, 0, 0, 0, 0, 0,
      50, 50, 50, 50, 50, 50, 50, 50,
      10, 10, 20, 30, 30, 20, 10, 10,
      5, 5, 10, 25, 25, 10, 5, 5,
      0, 0, 0, 20, 20, 0, 0, 0,
      5, -5, -10, 0, 0, -10, -5, 5,
      5, 10, 10, -20, -20, 10, 10, 5,
      0, 0, 0, 0, 0, 0, 0, 0
    ],
    N: [
      -50, -40, -30, -30, -30, -30, -40, -50,
      -40, -20, 0, 0, 0, 0, -20, -40,
      -30, 0, 10, 15, 15, 10, 0, -30,
      -30, 5, 15, 20, 20, 15, 5, -30,
      -30, 0, 15, 20, 20, 15, 0, -30,
      -30, 5, 10, 15, 15, 10, 5, -30,
      -40, -20, 0, 5, 5, 0, -20, -40,
      -50, -40, -30, -30, -30, -30, -40, -50
    ],
    B: [
      -20, -10, -10, -10, -10, -10, -10, -20,
      -10, 0, 0, 0, 0, 0, 0, -10,
      -10, 0, 5, 10, 10, 5, 0, -10,
      -10, 5, 5, 10, 10, 5, 5, -10,
      -10, 0, 10, 10, 10, 10, 0, -10,
      -10, 10, 10, 10, 10, 10, 10, -10,
      -10, 5, 0, 0, 0, 0, 5, -10,
      -20, -10, -10, -10, -10, -10, -10, -20
    ],
    R: [
      0, 0, 0, 0, 0, 0, 0, 0,
      5, 10, 10, 10, 10, 10, 10, 5,
      -5, 0, 0, 0, 0, 0, 0, -5,
      -5, 0, 0, 0, 0, 0, 0, -5,
      -5, 0, 0, 0, 0, 0, 0, -5,
      -5, 0, 0, 0, 0, 0, 0, -5,
      -5, 0, 0, 0, 0, 0, 0, -5,
      0, 0, 0, 5, 5, 0, 0, 0
    ],
    Q: [
      -20, -10, -10, -5, -5, -10, -10, -20,
      -10, 0, 0, 0, 0, 0, 0, -10,
      -10, 0, 5, 5, 5, 5, 0, -10,
      -5, 0, 5, 5, 5, 5, 0, -5,
      0, 0, 5, 5, 5, 5, 0, -5,
      -10, 5, 5, 5, 5, 5, 0, -10,
      -10, 0, 5, 0, 0, 0, 0, -10,
      -20, -10, -10, -5, -5, -10, -10, -20
    ],
    K: [
      -30, -40, -40, -50, -50, -40, -40, -30,
      -30, -40, -40, -50, -50, -40, -40, -30,
      -30, -40, -40, -50, -50, -40, -40, -30,
      -30, -40, -40, -50, -50, -40, -40, -30,
      -20, -30, -30, -40, -40, -30, -30, -20,
      -10, -20, -20, -20, -20, -20, -20, -10,
      20, 20, 0, 0, 0, 0, 20, 20,
      20, 30, 10, 0, 0, 10, 30, 20
    ]
  };

  function mirrored(index) {
    return (7 - (index >> 3)) * 8 + (index & 7);
  }

  /* 白方视角的静态评估；黑方棋子取相反符号 */
  function evaluate(state) {
    var score = 0;
    for (var i = 0; i < 64; i += 1) {
      var piece = state.board[i];
      if (!piece) continue;
      var color = Core.colorOf(piece);
      var type = Core.typeOf(piece);
      var square = color === WHITE ? i : mirrored(i);
      var value = VALUE[type] + PST[type][square];
      score += color === WHITE ? value : -value;
    }
    return score;
  }

  /* 走法排序：吃大子优先，升变次之，让 alpha-beta 剪得更狠 */
  function orderMoves(moves) {
    return moves.slice().sort(function (a, b) {
      var sa = (a.captured ? VALUE[Core.typeOf(a.captured)] * 10 - VALUE[Core.typeOf(a.piece)] : 0)
        + (a.promotion ? VALUE[a.promotion] : 0);
      var sb = (b.captured ? VALUE[Core.typeOf(b.captured)] * 10 - VALUE[Core.typeOf(b.piece)] : 0)
        + (b.promotion ? VALUE[b.promotion] : 0);
      return sb - sa;
    });
  }

  function makeSearch(deadline) {
    var nodes = 0;
    var stop = false;

    function outOfTime() {
      if (stop) return true;
      if (nodes % 512 === 0 && Date.now() > deadline) stop = true;
      return stop;
    }

    function quiesce(state, alpha, beta, depth) {
      nodes += 1;
      if (outOfTime()) return alpha;
      var stand = state.turn === WHITE ? evaluate(state) : -evaluate(state);
      if (stand >= beta) return beta;
      if (stand > alpha) alpha = stand;
      if (depth <= 0) return alpha;

      var moves = Core.pseudoMoves(state, state.turn).filter(function (move) {
        return move.captured || move.promotion;
      });
      moves = orderMoves(moves);
      for (var i = 0; i < moves.length; i += 1) {
        var next = Core.cloneMeta(state);
        if (Core.kingSquare(next, state.turn) < 0) continue;
        Core.play(next, moves[i]);
        if (Core.kingSquare(next, next.turn) < 0) return MATE - 1;
        var score = -quiesce(next, -beta, -alpha, depth - 1);
        if (score >= beta) return beta;
        if (score > alpha) alpha = score;
      }
      return alpha;
    }

    function negamax(state, depth, alpha, beta, ply) {
      nodes += 1;
      if (outOfTime()) return alpha;
      if (Core.kingSquare(state, state.turn) < 0) return -MATE + ply;
      if (depth <= 0) return quiesce(state, alpha, beta, 2);

      var moves = orderMoves(Core.pseudoMoves(state, state.turn));
      var best = -MATE * 2;
      var legal = 0;
      for (var i = 0; i < moves.length; i += 1) {
        var next = Core.cloneMeta(state);
        Core.play(next, moves[i]);
        legal += 1;
        var score = -negamax(next, depth - 1, -beta, -alpha, ply + 1);
        if (score > best) best = score;
        if (score > alpha) alpha = score;
        if (alpha >= beta) break;
      }
      if (!legal) {
        return Core.inCheck(state, state.turn) ? -MATE + ply : 0;
      }
      return best;
    }

    return {
      root: function (state, depth) {
        var moves = orderMoves(Core.legalMoves(state, state.turn));
        var best = null;
        var alpha = -MATE * 2;
        for (var i = 0; i < moves.length; i += 1) {
          var next = Core.cloneMeta(state);
          Core.play(next, moves[i]);
          var score = -negamax(next, depth - 1, -MATE * 2, -alpha, 1);
          if (best === null || score > alpha) {
            alpha = score;
            best = moves[i];
          }
          if (stop) break;
        }
        return { move: best, score: alpha, nodes: nodes };
      },
      nodes: function () { return nodes; },
      stopped: function () { return stop; }
    };
  }

  /* 会被三次重复/50 回合截断的对局不再深算，直接按和棋处理 */
  function finished(state) {
    return state.status && state.status !== 'playing' && state.status !== 'check';
  }

  function chooseMove(state, options) {
    var opts = options || {};
    var level = opts.level || 'normal';
    var timeMs = opts.timeMs || (level === 'hard' ? 900 : level === 'easy' ? 120 : 420);
    var maxDepth = level === 'easy' ? 1 : level === 'hard' ? 3 : 2;
    if (finished(state)) return null;

    var legal = Core.legalMoves(state, state.turn);
    if (!legal.length) return null;
    if (legal.length === 1) return legal[0];

    var search = makeSearch(Date.now() + timeMs);
    var best = null;
    for (var depth = 1; depth <= maxDepth; depth += 1) {
      var result = search.root(state, depth);
      if (result.move) best = result.move;
      if (search.stopped()) break;
    }

    // 简单难度留出随机性，免得每局都走成一模一样
    if (level === 'easy' && Math.random() < 0.45) {
      return legal[Math.floor(Math.random() * legal.length)];
    }
    return best || legal[Math.floor(Math.random() * legal.length)];
  }

  root.ChessAI = {
    VALUE: VALUE,
    evaluate: evaluate,
    chooseMove: chooseMove
  };
})(typeof window !== 'undefined' ? window : globalThis);
