/* 五子棋 · 纯规则内核（无 DOM，可被 node 直接加载做测试） */
(function (root) {
  'use strict';

  var SIZE = 15;
  var EMPTY = 0;
  var BLACK = 1;
  var WHITE = 2;
  var DIRS = [[0, 1], [1, 0], [1, 1], [1, -1]];

  function createBoard(size) {
    var n = size || SIZE;
    var board = [];
    for (var r = 0; r < n; r += 1) {
      var row = [];
      for (var c = 0; c < n; c += 1) row.push(EMPTY);
      board.push(row);
    }
    return board;
  }

  function cloneBoard(board) {
    return board.map(function (row) { return row.slice(); });
  }

  function inBounds(board, r, c) {
    return r >= 0 && c >= 0 && r < board.length && c < board[0].length;
  }

  function isEmpty(board, r, c) {
    return inBounds(board, r, c) && board[r][c] === EMPTY;
  }

  function other(player) {
    return player === BLACK ? WHITE : BLACK;
  }

  function countStones(board) {
    var total = 0;
    for (var r = 0; r < board.length; r += 1) {
      for (var c = 0; c < board[r].length; c += 1) if (board[r][c]) total += 1;
    }
    return total;
  }

  /* 从 (r,c) 出发，收集 dir 方向上的连续同色棋串 */
  function collect(board, r, c, dr, dc, player) {
    var cells = [[r, c]];
    var rr = r + dr;
    var cc = c + dc;
    while (inBounds(board, rr, cc) && board[rr][cc] === player) {
      cells.push([rr, cc]);
      rr += dr;
      cc += dc;
    }
    rr = r - dr;
    cc = c - dc;
    while (inBounds(board, rr, cc) && board[rr][cc] === player) {
      cells.unshift([rr, cc]);
      rr -= dr;
      cc -= dc;
    }
    return cells;
  }

  /* 判断落在 (r,c) 的子是否连成五（自由规则，长连同样算胜） */
  function checkWin(board, r, c) {
    if (!inBounds(board, r, c)) return null;
    var player = board[r][c];
    if (!player) return null;
    for (var i = 0; i < DIRS.length; i += 1) {
      var cells = collect(board, r, c, DIRS[i][0], DIRS[i][1], player);
      if (cells.length >= 5) {
        return { player: player, dir: DIRS[i], cells: cells, length: cells.length };
      }
    }
    return null;
  }

  function isFull(board) {
    return countStones(board) === board.length * board[0].length;
  }

  function createGame(opts) {
    var size = (opts && opts.size) || SIZE;
    var state = {
      size: size,
      board: createBoard(size),
      turn: BLACK,
      moves: [],
      status: 'playing',
      winner: EMPTY,
      winLine: null
    };

    function reset() {
      state.board = createBoard(size);
      state.turn = BLACK;
      state.moves = [];
      state.status = 'playing';
      state.winner = EMPTY;
      state.winLine = null;
      return state;
    }

    function play(r, c) {
      if (state.status !== 'playing') return { ok: false, reason: 'over' };
      if (!inBounds(state.board, r, c)) return { ok: false, reason: 'out' };
      if (state.board[r][c] !== EMPTY) return { ok: false, reason: 'taken' };

      var player = state.turn;
      state.board[r][c] = player;
      var move = { r: r, c: c, player: player, n: state.moves.length + 1 };
      state.moves.push(move);

      var win = checkWin(state.board, r, c);
      if (win) {
        state.status = 'won';
        state.winner = player;
        state.winLine = win.cells;
      } else if (isFull(state.board)) {
        state.status = 'draw';
        state.winner = EMPTY;
      } else {
        state.turn = other(player);
      }
      return {
        ok: true,
        player: player,
        move: move,
        status: state.status,
        winner: state.winner,
        winLine: state.winLine
      };
    }

    /* 撤销 steps 手；返回实际撤销的数量 */
    function undo(steps) {
      var count = Math.max(0, steps || 1);
      var removed = 0;
      while (removed < count && state.moves.length) {
        var move = state.moves.pop();
        state.board[move.r][move.c] = EMPTY;
        state.turn = move.player;
        state.status = 'playing';
        state.winner = EMPTY;
        state.winLine = null;
        removed += 1;
      }
      return removed;
    }

    function last() {
      return state.moves[state.moves.length - 1] || null;
    }

    function canUndo() {
      return state.moves.length > 0;
    }

    return {
      state: state,
      play: play,
      undo: undo,
      reset: reset,
      last: last,
      canUndo: canUndo
    };
  }

  root.GomokuCore = {
    SIZE: SIZE,
    EMPTY: EMPTY,
    BLACK: BLACK,
    WHITE: WHITE,
    DIRS: DIRS,
    createBoard: createBoard,
    cloneBoard: cloneBoard,
    inBounds: inBounds,
    isEmpty: isEmpty,
    other: other,
    countStones: countStones,
    checkWin: checkWin,
    isFull: isFull,
    createGame: createGame
  };
})(typeof window !== 'undefined' ? window : globalThis);
