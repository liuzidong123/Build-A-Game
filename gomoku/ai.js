/* 五子棋 · 电脑对手（启发式评分 + 二步预判） */
(function (root) {
  'use strict';

  var Core = root.GomokuCore;
  var EMPTY = Core.EMPTY;

  var LEVELS = ['easy', 'normal', 'hard'];
  var WIN_SCORE = 100000000;

  /* 单方向棋型：x=我  o=对手/边线  .=空 */
  var PATTERNS = [
    { re: /xxxxx/, score: WIN_SCORE },
    { re: /\.xxxx\./, score: 10000000 },
    { re: /xxxx\.|\.xxxx|xx\.xx|x\.xxx|xxx\.x/, score: 500000 },
    { re: /\.xxx\./, score: 50000 },
    { re: /\.x\.xx\.|\.xx\.x\./, score: 40000 },
    { re: /xxx/, score: 4000 },
    { re: /\.xx\./, score: 2000 },
    { re: /xx/, score: 200 }
  ];

  function lineString(board, size, r, c, dr, dc, player) {
    var text = '';
    for (var k = -4; k <= 4; k += 1) {
      if (k === 0) { text += 'x'; continue; }
      var rr = r + dr * k;
      var cc = c + dc * k;
      if (rr < 0 || cc < 0 || rr >= size || cc >= size) { text += 'o'; continue; }
      var cell = board[rr][cc];
      text += cell === EMPTY ? '.' : (cell === player ? 'x' : 'o');
    }
    return text;
  }

  /* 假设 player 落在 (r,c)（要求该点为空），返回该点的进攻价值 */
  function scorePoint(board, size, r, c, player) {
    var total = 0;
    for (var i = 0; i < Core.DIRS.length; i += 1) {
      var text = lineString(board, size, r, c, Core.DIRS[i][0], Core.DIRS[i][1], player);
      for (var p = 0; p < PATTERNS.length; p += 1) {
        if (PATTERNS[p].re.test(text)) {
          total += PATTERNS[p].score;
          break;
        }
      }
    }
    return total;
  }

  function candidates(board, size, radius) {
    var hasStone = false;
    var list = [];
    for (var r = 0; r < size; r += 1) {
      for (var c = 0; c < size; c += 1) {
        if (!board[r][c]) continue;
        hasStone = true;
        for (var dr = -radius; dr <= radius; dr += 1) {
          for (var dc = -radius; dc <= radius; dc += 1) {
            var rr = r + dr;
            var cc = c + dc;
            if (rr < 0 || cc < 0 || rr >= size || cc >= size) continue;
            if (board[rr][cc] !== EMPTY) continue;
            list.push({ r: rr, c: cc });
          }
        }
      }
    }
    if (!hasStone) {
      var mid = Math.floor(size / 2);
      return [{ r: mid, c: mid }];
    }
    var seen = {};
    return list.filter(function (pt) {
      var key = pt.r + ':' + pt.c;
      if (seen[key]) return false;
      seen[key] = true;
      return true;
    });
  }

  function centerDistance(size, pt) {
    var mid = (size - 1) / 2;
    return Math.abs(pt.r - mid) + Math.abs(pt.c - mid);
  }

  function byScore(size) {
    return function (a, b) {
      if (b.score !== a.score) return b.score - a.score;
      return centerDistance(size, a) - centerDistance(size, b);
    };
  }

  /* 存在一手直接成五的点就返回它（多个时取评分最高的） */
  function findImmediate(board, size, player, list) {
    var best = null;
    for (var i = 0; i < list.length; i += 1) {
      var pt = list[i];
      if (board[pt.r][pt.c] !== EMPTY) continue;
      board[pt.r][pt.c] = player;
      var win = Core.checkWin(board, pt.r, pt.c);
      board[pt.r][pt.c] = EMPTY;
      if (win) {
        var score = scorePoint(board, size, pt.r, pt.c, player);
        if (!best || score > best.score) best = { r: pt.r, c: pt.c, score: score };
      }
    }
    return best;
  }

  function greedy(board, size, player, list, defWeight) {
    var opponent = Core.other(player);
    var scored = list.map(function (pt) {
      var atk = scorePoint(board, size, pt.r, pt.c, player);
      var def = scorePoint(board, size, pt.r, pt.c, opponent);
      return { r: pt.r, c: pt.c, score: atk + def * defWeight };
    });
    scored.sort(byScore(size));
    return scored;
  }

  /* 预判：我落子后，对手最好的一手值多少 */
  function bestReply(board, size, opponent, player) {
    var list = candidates(board, size, 2);
    var opp = greedy(board, size, opponent, list, 1);
    var own = greedy(board, size, player, list, 1);
    if (!opp.length) return 0;
    var defence = own.length ? own[0].score * 0.6 : 0;
    return opp[0].score + defence;
  }

  function pickMove(board, size, player, opts) {
    var options = opts || {};
    var level = LEVELS.indexOf(options.level) >= 0 ? options.level : 'normal';
    var rng = options.rng || Math.random;
    var opponent = Core.other(player);
    var list = candidates(board, size, level === 'easy' ? 1 : 2);

    if (!list.length) {
      var mid = Math.floor(size / 2);
      return { r: mid, c: mid, score: 0 };
    }

    var win = findImmediate(board, size, player, list);
    if (win) return win;

    var block = findImmediate(board, size, opponent, list);
    if (block) return { r: block.r, c: block.c, score: block.score };

    var scored = greedy(board, size, player, list, level === 'easy' ? 0.8 : 1.05);
    if (!scored.length) return { r: list[0].r, c: list[0].c, score: 0 };

    if (level === 'easy') {
      var pool = scored.slice(0, Math.min(4, scored.length));
      var pick = Math.min(pool.length - 1, Math.floor(rng() * pool.length));
      return pool[pick];
    }

    if (level === 'normal') return scored[0];

    var shortlist = scored.slice(0, Math.min(10, scored.length));
    var best = shortlist[0];
    var bestValue = -Infinity;
    for (var i = 0; i < shortlist.length; i += 1) {
      var pt = shortlist[i];
      board[pt.r][pt.c] = player;
      var reply = bestReply(board, size, opponent, player);
      board[pt.r][pt.c] = EMPTY;
      var value = pt.score - reply * 0.95;
      if (value > bestValue) {
        bestValue = value;
        best = pt;
      }
    }
    return best;
  }

  root.GomokuAI = {
    LEVELS: LEVELS,
    WIN_SCORE: WIN_SCORE,
    scorePoint: scorePoint,
    candidates: candidates,
    pickMove: pickMove
  };
})(typeof window !== 'undefined' ? window : globalThis);
