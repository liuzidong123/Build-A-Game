/* 围棋 · 电脑对手（启发式，无搜索树）
 * 打分依据：提子、己方气数、打吃、与双方棋子的距离、边线层次、角部价值、不填自己的眼。
 * 三档棋力只调节噪声与最终挑选范围：简单偏随机，普通有噪声，困难取最高分并多看一眼对方的应手。
 */
(function (root) {
  'use strict';

  var Core = root.GoCore;
  var SIZE = 19;

  var LEVELS = {
    easy: { noise: 9, pool: 0.4, reply: 0 },
    normal: { noise: 2.5, pool: 0.14, reply: 0 },
    hard: { noise: 0, pool: 0, reply: 6 }
  };

  function lineOf(index) {
    var col = Core.colOf(index);
    var row = Core.rowOf(index);
    return Math.min(col, row, SIZE - 1 - col, SIZE - 1 - row) + 1;
  }

  function cornerDistance(index) {
    var col = Core.colOf(index);
    var row = Core.rowOf(index);
    return Math.min(col, SIZE - 1 - col) + Math.min(row, SIZE - 1 - row);
  }

  function neighboursCount(board, index, color) {
    var list = Core.neighborsOf(index);
    var count = 0;
    for (var i = 0; i < list.length; i += 1) {
      if (board[list[i]] === color) count += 1;
    }
    return count;
  }

  /* 周围两格内有多少己方 / 对方棋子，用来判断"贴着下"还是"另开战场" */
  function nearby(board, index, color) {
    var col = Core.colOf(index);
    var row = Core.rowOf(index);
    var mine = 0;
    var theirs = 0;
    for (var dc = -2; dc <= 2; dc += 1) {
      for (var dr = -2; dr <= 2; dr += 1) {
        if (!dc && !dr) continue;
        var c = col + dc;
        var r = row + dr;
        if (!Core.onBoard(c, r)) continue;
        var piece = board[Core.idxOf(c, r)];
        if (piece === color) mine += 1;
        else if (piece) theirs += 1;
      }
    }
    return { mine: mine, theirs: theirs };
  }

  function evaluateMove(board, index, color, ko) {
    var result = Core.resolve(board, index, color, ko);
    if (!result) return null;

    var score = 0;
    var captured = result.captured.length;
    if (captured) score += 14 * captured + 4;

    /* 落子后己方一块的气 */
    var liberties = result.liberties;
    score += liberties >= 4 ? 4 : liberties === 3 ? 2 : liberties === 2 ? -1 : -9;

    var own = Core.groupAt(result.board, index);
    if (own.stones.length >= 3) score += 2;

    /* 打吃对方：让相邻的对方块只剩一口气 */
    var enemy = Core.other(color);
    var pressure = 0;
    var around = Core.neighborsOf(index);
    for (var i = 0; i < around.length; i += 1) {
      if (result.board[around[i]] !== enemy) continue;
      var enemyGroup = Core.groupAt(result.board, around[i]);
      if (enemyGroup.liberties.length === 1) pressure += 1;
    }
    score += pressure * 6;

    /* 填自己的眼是坏棋 */
    if (neighboursCount(result.board, index, color) >= 4) score -= 30;

    var near = nearby(result.board, index, color);
    score += Math.min(near.mine, 6) * 0.8;
    score += Math.min(near.theirs, 6) * 0.6;

    var line = lineOf(index);
    if (line === 1) score -= 8;
    else if (line === 2) score -= 3;
    else if (line === 3) score += 2.5;
    else if (line === 4) score += 3;

    score += Math.max(0, 6 - cornerDistance(index)) * 0.7;

    /* 别在对方厚势里硬碰：两格内对方明显多，扣一点 */
    if (near.theirs > near.mine * 2 + 1) score -= 2.5;

    return { index: index, score: score, captured: captured, result: result };
  }

  function candidates(state) {
    var board = state.board;
    var color = state.turn;
    var list = [];
    for (var i = 0; i < Core.POINTS; i += 1) {
      if (board[i]) continue;
      var scored = evaluateMove(board, i, color, state.ko);
      if (scored) list.push(scored);
    }
    list.sort(function (a, b) { return b.score - a.score; });
    return list;
  }

  /* 困难档：多看一步——如果对方能立刻在别处大赚（吃子 / 打吃），这手就不那么值钱 */
  function replyPenalty(state, top, color) {
    var probe = Core.cloneState(state);
    probe.board = top.result.board;
    probe.turn = Core.other(color);
    probe.ko = top.result.ko;
    probe.passes = 0;
    var best = -Infinity;
    for (var i = 0; i < Core.POINTS; i += 1) {
      if (probe.board[i]) continue;
      var scored = evaluateMove(probe.board, i, probe.turn, probe.ko);
      if (!scored) continue;
      if (scored.score > best) best = scored.score;
    }
    if (best === -Infinity) return 0;
    return Math.max(0, best) * 0.35;
  }

  function chooseMove(state, options) {
    var opts = options || {};
    var level = LEVELS[opts.level] ? LEVELS[opts.level] : LEVELS.normal;
    if (!state || state.status !== 'playing') return null;

    var list = candidates(state);
    if (!list.length) return { type: 'pass', index: -1 };

    var best = list[0].score;
    /* 收官阶段对方虚手，自己也该收手 */
    if (state.passes >= 1 && best < -1) return { type: 'pass', index: -1 };
    if (state.moveNumber > 320 && best < 0.5) return { type: 'pass', index: -1 };

    var pool = level.pool > 0 ? Math.max(1, Math.ceil(list.length * level.pool)) : 1;
    var shortlist = list.slice(0, Math.min(pool, list.length));

    if (level.reply > 0) {
      var scouted = list.slice(0, Math.min(level.reply, list.length)).map(function (item) {
        return {
          index: item.index,
          value: item.score - replyPenalty(state, item, state.turn)
        };
      });
      scouted.sort(function (a, b) { return b.value - a.value; });
      shortlist = scouted;
    }

    var pick = shortlist[0];
    if (level.noise > 0) {
      var noisy = shortlist.map(function (item) {
        var raw = item.value === undefined ? item.score : item.value;
        return { index: item.index, value: raw + Math.random() * level.noise };
      });
      noisy.sort(function (a, b) { return b.value - a.value; });
      pick = noisy[0];
    }

    return { type: 'play', index: pick.index };
  }

  root.GoAI = {
    LEVELS: LEVELS,
    evaluateMove: evaluateMove,
    candidates: candidates,
    chooseMove: chooseMove
  };

  if (typeof module === 'object' && module.exports) module.exports = root.GoAI;
})(typeof globalThis !== 'undefined' ? globalThis : this);
