/* 中国象棋 · 电脑对手（negamax + alpha-beta + 吃子延伸）
 * 依赖 logic.js 暴露的 XiangqiCore；纯计算，不碰 DOM。
 */
(function (root) {
  'use strict';

  var Core = root.XiangqiCore;
  var RED = 'r';
  var BLACK = 'b';
  var MATE = 90000;

  var VALUE = { K: 100000, R: 900, C: 450, N: 400, B: 200, A: 200, P: 100 };

  var LEVELS = {
    easy: { depth: 1, time: 260, noise: 70, quiesce: 2 },
    normal: { depth: 2, time: 520, noise: 16, quiesce: 3 },
    hard: { depth: 3, time: 1100, noise: 0, quiesce: 4 }
  };

  function pieceScore(piece, index) {
    var type = Core.typeOf(piece);
    var color = Core.colorOf(piece);
    var score = VALUE[type] || 0;
    var row = Core.rowOf(index);
    var col = Core.colOf(index);

    if (type === 'P') {
      /* 兵越靠前越值钱，过河后再加一笔 */
      var step = color === RED ? 6 - row : row - 3;
      score += Math.max(0, step) * 12;
      if (Core.crossedRiver(index, color)) score += 34;
    } else if (type === 'R' || type === 'C' || type === 'N') {
      /* 靠近中路更灵活 */
      score += (4 - Math.abs(col - 4)) * 4;
    }
    return score;
  }

  /* 红方视角的静态分 */
  function evaluate(state) {
    var total = 0;
    for (var i = 0; i < Core.COLS * Core.ROWS; i += 1) {
      var piece = state.board[i];
      if (!piece) continue;
      var value = pieceScore(piece, i);
      total += Core.colorOf(piece) === RED ? value : -value;
    }
    return total;
  }

  /* 伪合法着法里剔除送将的，和 logic.legalMoves 同义但少一次棋盘复制 */
  function movesFor(state, side) {
    var pseudo = Core.pseudoMoves(state, side);
    var out = [];
    var kingBefore = Core.kingSquare(state, side);
    var enemy = side === RED ? BLACK : RED;
    for (var i = 0; i < pseudo.length; i += 1) {
      var move = pseudo[i];
      if (move.captured === enemy + 'K') continue;
      var undo = Core.play(state, move);
      var king = move.piece === side + 'K' ? move.to : kingBefore;
      var safe = king >= 0 && !Core.kingsFacing(state) && !Core.attacked(state, king, enemy);
      Core.restore(state, undo);
      if (safe) out.push(move);
    }
    return out;
  }

  function orderMoves(moves) {
    moves.sort(function (a, b) {
      var av = a.captured ? (VALUE[Core.typeOf(a.captured)] || 0) - (VALUE[Core.typeOf(a.piece)] || 0) / 10 : 0;
      var bv = b.captured ? (VALUE[Core.typeOf(b.captured)] || 0) - (VALUE[Core.typeOf(b.piece)] || 0) / 10 : 0;
      return bv - av;
    });
    return moves;
  }

  /* 静搜：只跟着吃子走，避免「贪一步被白吃」的短视 */
  function quiesce(state, side, alpha, beta, limit, ctx) {
    if (Date.now() > ctx.deadline) { ctx.expired = true; return evaluate(state) * (side === RED ? 1 : -1); }
    var stand = evaluate(state) * (side === RED ? 1 : -1);
    if (limit <= 0) return stand;
    if (stand >= beta) return beta;
    if (stand > alpha) alpha = stand;

    var captures = movesFor(state, side).filter(function (move) { return !!move.captured; });
    captures = orderMoves(captures);
    for (var i = 0; i < captures.length; i += 1) {
      var undo = Core.play(state, captures[i]);
      var score = -quiesce(state, side === RED ? BLACK : RED, -beta, -alpha, limit - 1, ctx);
      Core.restore(state, undo);
      if (ctx.expired) return alpha;
      if (score >= beta) return beta;
      if (score > alpha) alpha = score;
    }
    return alpha;
  }

  function negamax(state, side, depth, alpha, beta, ply, ctx) {
    if (DepthGuard.exceeded(ctx)) { ctx.expired = true; return evaluate(state) * (side === RED ? 1 : -1); }

    var moves = movesFor(state, side);
    if (!moves.length) return -MATE + ply;      /* 无路可走：被将死或困毙，都算输 */

    if (depth <= 0) return quiesce(state, side, alpha, beta, ctx.level.quiesce, ctx);

    orderMoves(moves);
    for (var i = 0; i < moves.length; i += 1) {
      var undo = Core.play(state, moves[i]);
      var score = -negamax(state, side === RED ? BLACK : RED, depth - 1, -beta, -alpha, ply + 1, ctx);
      Core.restore(state, undo);
      if (ctx.expired) return alpha;
      if (score >= beta) return beta;
      if (score > alpha) alpha = score;
    }
    return alpha;
  }

  /* 每访问若干节点看一次表，避免 Date.now 成为热点 */
  var DepthGuard = {
    exceeded: function (ctx) {
      ctx.nodes += 1;
      if ((ctx.nodes & 1023) !== 0) return false;
      return Date.now() > ctx.deadline;
    }
  };

  function chooseMove(state, options) {
    var opts = options || {};
    var level = LEVELS[opts.level] || LEVELS.normal;
    var side = opts.color || state.turn;
    var enemy = side === RED ? BLACK : RED;
    var king = Core.kingSquare(state, side);
    if (king < 0) return null;

    var ctx = {
      level: level,
      nodes: 0,
      expired: false,
      deadline: Date.now() + (opts.time || level.time)
    };

    var candidates = movesFor(state, side);
    if (!candidates.length) return null;
    orderMoves(candidates);

    var best = [];
    var bestScore = -Infinity;
    for (var i = 0; i < candidates.length; i += 1) {
      var undo = Core.play(state, candidates[i]);
      /* 根节点用全窗口，避免剪枝把分数压成上界后与最优着法并列 */
      var score = -negamax(state, enemy, level.depth - 1, -Infinity, Infinity, 1, ctx);
      Core.restore(state, undo);

      if (ctx.expired && best.length) break;
      score += level.noise ? Math.floor(Math.random() * level.noise) : 0;

      if (score > bestScore + 0.0001) {
        bestScore = score;
        best = [candidates[i]];
      } else if (score > bestScore - 0.0001) {
        best.push(candidates[i]);
      }
    }

    if (!best.length) return null;
    var pick;
    if (opts.rng) pick = best[Math.floor(opts.rng() * best.length)];
    else if (level.noise) pick = best[Math.floor(Math.random() * best.length)];
    else pick = best[0];
    return {
      from: pick.from,
      to: pick.to,
      piece: pick.piece,
      captured: pick.captured,
      san: Core.notation(pick)
    };
  }

  root.XiangqiAI = {
    LEVELS: LEVELS,
    value: VALUE,
    evaluate: evaluate,
    chooseMove: chooseMove
  };
})(typeof window !== 'undefined' ? window : globalThis);
