/* 围棋 · 纯规则内核（无 DOM，可被 node 直接加载做测试）
 * 19×19 交叉点，索引 0 = 左上（第 19 行 A 列），索引 360 = 右下（第 1 行 T 列）；
 * index = row * 19 + col，row 0 在最上方，黑棋 'b'、白棋 'w'、空点 null。
 *
 * 已实现：落子、提子、禁自杀、单劫（ko）、虚手、连续两次虚手后中国规则数子（子 + 空 + 贴目）、
 * 认输、逐步悔棋。计分只按盘面（数子法），提子数单独统计用于展示。
 */
(function (root) {
  'use strict';

  var SIZE = 19;
  var POINTS = SIZE * SIZE;
  var BLACK = 'b';
  var WHITE = 'w';
  var KOMI = 7.5;
  var LETTERS = 'ABCDEFGHJKLMNOPQRST'; /* 围棋坐标跳过字母 I */

  function other(color) { return color === BLACK ? WHITE : BLACK; }
  function colorName(color) { return color === BLACK ? '黑方' : '白方'; }
  function idxOf(col, row) { return row * SIZE + col; }
  function colOf(index) { return index % SIZE; }
  function rowOf(index) { return (index / SIZE) | 0; }
  function onBoard(col, row) { return col >= 0 && col < SIZE && row >= 0 && row < SIZE; }

  /* 盘的上下左右邻点，预先算好 */
  var NEIGHBORS = [];
  (function () {
    for (var i = 0; i < POINTS; i += 1) {
      var col = colOf(i);
      var row = rowOf(i);
      var list = [];
      if (col > 0) list.push(i - 1);
      if (col < SIZE - 1) list.push(i + 1);
      if (row > 0) list.push(i - SIZE);
      if (row < SIZE - 1) list.push(i + SIZE);
      NEIGHBORS.push(list);
    }
  })();

  /* --------------------------------------------------------------- 坐标 */
  function formatCoord(index) {
    if (index < 0 || index >= POINTS) return 'pass';
    return LETTERS.charAt(colOf(index)) + (SIZE - rowOf(index));
  }

  function parseCoord(text) {
    var raw = String(text == null ? '' : text).trim().toUpperCase();
    if (!raw) return -1;
    var col = LETTERS.indexOf(raw.charAt(0));
    var num = Number(raw.slice(1));
    if (col < 0 || !isFinite(num) || num < 1 || num > SIZE) return -1;
    return idxOf(col, SIZE - num);
  }

  /* --------------------------------------------------------------- 气与块 */
  function neighborsOf(index) { return NEIGHBORS[index] || []; }

  function groupAt(board, index) {
    var color = board[index];
    if (!color) return { color: null, stones: [], liberties: [] };
    var seen = {};
    var libSeen = {};
    var stones = [];
    var liberties = [];
    var stack = [index];
    seen[index] = true;
    while (stack.length) {
      var current = stack.pop();
      stones.push(current);
      var around = NEIGHBORS[current];
      for (var i = 0; i < around.length; i += 1) {
        var next = around[i];
        if (!board[next]) {
          if (!libSeen[next]) { libSeen[next] = true; liberties.push(next); }
        } else if (board[next] === color && !seen[next]) {
          seen[next] = true;
          stack.push(next);
        }
      }
    }
    return { color: color, stones: stones, liberties: liberties };
  }

  function libertiesOf(board, index) { return groupAt(board, index).liberties; }

  /* --------------------------------------------------------------- 局面 */
  function createState(options) {
    var opts = options || {};
    return {
      size: SIZE,
      board: new Array(POINTS).fill(null),
      turn: opts.turn === WHITE ? WHITE : BLACK,
      captures: { b: 0, w: 0 },
      ko: -1,
      passes: 0,
      last: -1,
      status: 'playing',
      winner: null,
      reason: null,
      komi: typeof opts.komi === 'number' ? opts.komi : KOMI,
      moveNumber: 0,
      history: []
    };
  }

  function cloneState(state) {
    return {
      size: SIZE,
      board: state.board.slice(),
      turn: state.turn,
      captures: { b: state.captures.b, w: state.captures.w },
      ko: state.ko,
      passes: state.passes,
      last: state.last,
      status: state.status,
      winner: state.winner,
      reason: state.reason,
      komi: state.komi,
      moveNumber: state.moveNumber,
      history: []
    };
  }

  function snapshot(state) {
    return {
      board: state.board.slice(),
      turn: state.turn,
      captures: { b: state.captures.b, w: state.captures.w },
      ko: state.ko,
      passes: state.passes,
      last: state.last,
      status: state.status,
      winner: state.winner,
      reason: state.reason,
      moveNumber: state.moveNumber
    };
  }

  function restoreSnapshot(state, snap) {
    state.board = snap.board.slice();
    state.turn = snap.turn;
    state.captures = { b: snap.captures.b, w: snap.captures.w };
    state.ko = snap.ko;
    state.passes = snap.passes;
    state.last = snap.last;
    state.status = snap.status;
    state.winner = snap.winner;
    state.reason = snap.reason;
    state.moveNumber = snap.moveNumber;
  }

  /* --------------------------------------------------------------- 落子 */
  /* 在棋盘副本上试下一子，返回 { board, captured, ko }，非法返回 null */
  function resolve(board, index, color, koPoint) {
    if (!(index >= 0 && index < POINTS)) return null;
    if (board[index]) return null;
    if (index === koPoint) return null;

    var enemy = other(color);
    var next = board.slice();
    next[index] = color;

    var captured = [];
    var around = NEIGHBORS[index];
    for (var i = 0; i < around.length; i += 1) {
      var point = around[i];
      if (next[point] !== enemy) continue;
      var enemyGroup = groupAt(next, point);
      if (enemyGroup.liberties.length) continue;
      for (var j = 0; j < enemyGroup.stones.length; j += 1) {
        var stone = enemyGroup.stones[j];
        if (next[stone] !== enemy) continue;
        next[stone] = null;
        captured.push(stone);
      }
    }

    var ownGroup = groupAt(next, index);
    /* 自己的块无气即自杀，除非这一手提到了对方的子 */
    if (!ownGroup.liberties.length && !captured.length) return null;

    /* 单劫：提一子、己方也是单子单气，对方立刻回提会还原局面 */
    var koPointAfter = -1;
    if (captured.length === 1 && ownGroup.stones.length === 1 && ownGroup.liberties.length === 1) {
      koPointAfter = captured[0];
    }

    return { board: next, captured: captured, ko: koPointAfter, liberties: ownGroup.liberties.length };
  }

  function isLegal(state, index) {
    if (state.status !== 'playing') return false;
    return !!resolve(state.board, index, state.turn, state.ko);
  }

  function legalPoints(state) {
    var out = [];
    for (var i = 0; i < POINTS; i += 1) {
      if (isLegal(state, i)) out.push(i);
    }
    return out;
  }

  function play(state, index) {
    if (state.status !== 'playing') return null;
    var result = resolve(state.board, index, state.turn, state.ko);
    if (!result) return null;

    var color = state.turn;
    var snap = snapshot(state);
    snap.move = { type: 'play', color: color, index: index, captured: result.captured.slice() };
    state.history.push(snap);
    state.board = result.board;
    state.captures[color] += result.captured.length;
    state.ko = result.ko;
    state.passes = 0;
    state.last = index;
    state.turn = other(color);
    state.moveNumber += 1;
    state.status = 'playing';
    state.winner = null;
    state.reason = null;
    refreshStatus(state);

    return {
      type: 'play',
      color: color,
      index: index,
      captured: result.captured.slice(),
      liberties: result.liberties,
      coord: formatCoord(index)
    };
  }

  function pass(state) {
    if (state.status !== 'playing') return null;
    var color = state.turn;
    var snap = snapshot(state);
    snap.move = { type: 'pass', color: color, index: -1, captured: [] };
    state.history.push(snap);
    state.ko = -1;
    state.last = -1;
    state.passes += 1;
    state.turn = other(color);
    state.moveNumber += 1;
    refreshStatus(state);
    return { type: 'pass', color: color, index: -1, captured: [], coord: 'pass' };
  }

  function undoMove(state) {
    if (!state.history.length) return false;
    var snap = state.history.pop();
    restoreSnapshot(state, snap);
    return true;
  }

  function resign(state, color) {
    if (state.status !== 'playing') return null;
    var loser = color || state.turn;
    state.status = 'resign';
    state.winner = other(loser);
    state.reason = 'resign';
    return { winner: state.winner, loser: loser };
  }

  /* --------------------------------------------------------------- 终局 */
  function score(state, komi) {
    var board = state.board;
    var seen = new Array(POINTS).fill(false);
    var blackStones = 0;
    var whiteStones = 0;
    var blackTerritory = 0;
    var whiteTerritory = 0;

    for (var i = 0; i < POINTS; i += 1) {
      seen[i] = !!board[i];
      if (board[i] === BLACK) blackStones += 1;
      else if (board[i] === WHITE) whiteStones += 1;
    }

    for (var start = 0; start < POINTS; start += 1) {
      if (seen[start]) continue;
      var region = [];
      var bordersBlack = false;
      var bordersWhite = false;
      var stack = [start];
      seen[start] = true;
      while (stack.length) {
        var point = stack.pop();
        region.push(point);
        var around = NEIGHBORS[point];
        for (var k = 0; k < around.length; k += 1) {
          var next = around[k];
          if (board[next] === BLACK) { bordersBlack = true; continue; }
          if (board[next] === WHITE) { bordersWhite = true; continue; }
          if (seen[next]) continue;
          seen[next] = true;
          stack.push(next);
        }
      }
      if (bordersBlack && !bordersWhite) blackTerritory += region.length;
      else if (bordersWhite && !bordersBlack) whiteTerritory += region.length;
    }

    var komiValue = typeof komi === 'number' ? komi : (typeof state.komi === 'number' ? state.komi : KOMI);
    var black = blackStones + blackTerritory;
    var white = whiteStones + whiteTerritory + komiValue;
    var diff = black - white;
    return {
      blackStones: blackStones,
      whiteStones: whiteStones,
      blackTerritory: blackTerritory,
      whiteTerritory: whiteTerritory,
      komi: komiValue,
      black: black,
      white: white,
      diff: diff,
      winner: diff > 0 ? BLACK : WHITE,
      margin: Math.abs(diff)
    };
  }

  function refreshStatus(state) {
    if (state.status !== 'playing') return state.status;
    if (state.passes >= 2) {
      var result = score(state);
      state.status = 'scored';
      state.winner = result.winner;
      state.reason = 'scored';
      state.score = result;
    }
    return state.status;
  }

  /* --------------------------------------------------------------- 文本盘 */
  function toAscii(state) {
    var rows = [];
    for (var row = 0; row < SIZE; row += 1) {
      var line = '';
      for (var col = 0; col < SIZE; col += 1) {
        var piece = state.board[idxOf(col, row)];
        line += piece === BLACK ? 'X' : piece === WHITE ? 'O' : '.';
      }
      rows.push(line);
    }
    return rows.join('\n');
  }

  function fromAscii(rows, turn) {
    var state = createState({ turn: turn });
    var list = Array.isArray(rows) ? rows : String(rows).split('\n');
    for (var row = 0; row < SIZE; row += 1) {
      var line = String(list[row] || '');
      for (var col = 0; col < SIZE; col += 1) {
        var ch = line.charAt(col);
        if (ch === 'X' || ch === 'x' || ch === '#') state.board[idxOf(col, row)] = BLACK;
        else if (ch === 'O' || ch === 'o' || ch === '@') state.board[idxOf(col, row)] = WHITE;
      }
    }
    return state;
  }

  root.GoCore = {
    SIZE: SIZE,
    POINTS: POINTS,
    BLACK: BLACK,
    WHITE: WHITE,
    KOMI: KOMI,
    LETTERS: LETTERS,
    other: other,
    colorName: colorName,
    idxOf: idxOf,
    colOf: colOf,
    rowOf: rowOf,
    onBoard: onBoard,
    neighborsOf: neighborsOf,
    groupAt: groupAt,
    libertiesOf: libertiesOf,
    formatCoord: formatCoord,
    parseCoord: parseCoord,
    createState: createState,
    cloneState: cloneState,
    resolve: resolve,
    isLegal: isLegal,
    legalPoints: legalPoints,
    play: play,
    pass: pass,
    undoMove: undoMove,
    resign: resign,
    score: score,
    refreshStatus: refreshStatus,
    toAscii: toAscii,
    fromAscii: fromAscii
  };

  if (typeof module === 'object' && module.exports) module.exports = root.GoCore;
})(typeof globalThis !== 'undefined' ? globalThis : this);
