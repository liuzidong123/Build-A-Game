/* 中国象棋 · 纯规则内核（无 DOM，可被 node 直接加载做测试）
 * 棋盘 9 列 × 10 行共 90 个交叉点，索引 0 = 左上（黑方底线），索引 89 = 右下（红方底线）；
 * index = row * 9 + col，棋子形如 'rK' / 'bP'，空点为 null。
 * 红方 r 在下（row 5~9），黑方 b 在上（row 0~4），红先走。
 */
(function (root) {
  'use strict';

  var RED = 'r';
  var BLACK = 'b';
  var START_FEN = 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1';

  var COLS = 9;
  var ROWS = 10;

  var ORTHO = [[0, 1], [0, -1], [1, 0], [-1, 0]];
  var DIAG = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
  /* 马：先直后斜，[腿, 目标] */
  var HORSE = [
    [[0, 1], [1, 2]], [[0, 1], [-1, 2]],
    [[0, -1], [1, -2]], [[0, -1], [-1, -2]],
    [[1, 0], [2, 1]], [[1, 0], [2, -1]],
    [[-1, 0], [-2, 1]], [[-1, 0], [-2, -1]]
  ];
  /* 象：田字，[象眼, 目标] */
  var ELEPHANT = [
    [[1, 1], [2, 2]], [[1, -1], [2, -2]],
    [[-1, 1], [-2, 2]], [[-1, -1], [-2, -2]]
  ];

  function other(color) { return color === RED ? BLACK : RED; }
  function colorOf(piece) { return piece ? piece.charAt(0) : ''; }
  function typeOf(piece) { return piece ? piece.charAt(1) : ''; }

  function idxOf(col, row) { return row * COLS + col; }
  function colOf(index) { return index % COLS; }
  function rowOf(index) { return (index / COLS) | 0; }
  function onBoard(col, row) { return col >= 0 && col < COLS && row >= 0 && row < ROWS; }
  function squareName(index) { return 'abcdefghi'.charAt(colOf(index)) + (10 - rowOf(index)); }

  /* 九宫：黑方 row 0~2，红方 row 7~9，col 3~5 */
  function inPalace(index, color) {
    var col = colOf(index);
    var row = rowOf(index);
    if (col < 3 || col > 5) return false;
    return color === RED ? (row >= 7 && row <= 9) : (row >= 0 && row <= 2);
  }

  function ownHalf(index, color) {
    return color === RED ? rowOf(index) >= 5 : rowOf(index) <= 4;
  }

  /* 红方向上（row 减小）走，黑方反之 */
  function forward(color) { return color === RED ? -1 : 1; }
  function crossedRiver(index, color) {
    return color === RED ? rowOf(index) <= 4 : rowOf(index) >= 5;
  }

  function emptyBoard() {
    var board = [];
    for (var i = 0; i < COLS * ROWS; i += 1) board.push(null);
    return board;
  }

  function initialBoard() {
    var board = emptyBoard();
    var back = ['R', 'N', 'B', 'A', 'K', 'A', 'B', 'N', 'R'];
    for (var c = 0; c < COLS; c += 1) {
      board[idxOf(c, 0)] = BLACK + back[c];
      board[idxOf(c, 9)] = RED + back[c];
    }
    board[idxOf(1, 2)] = BLACK + 'C';
    board[idxOf(7, 2)] = BLACK + 'C';
    board[idxOf(1, 7)] = RED + 'C';
    board[idxOf(7, 7)] = RED + 'C';
    for (var i = 0; i < 9; i += 2) {
      board[idxOf(i, 3)] = BLACK + 'P';
      board[idxOf(i, 6)] = RED + 'P';
    }
    return board;
  }

  /* ------------------------------------------------------------ 攻击判定 */
  function attacked(state, target, by) {
    var board = state.board;
    var col = colOf(target);
    var row = rowOf(target);
    var i;

    /* 车 / 炮 / 将帅：沿直线找第一个子与第二个子 */
    for (i = 0; i < ORTHO.length; i += 1) {
      var dc = ORTHO[i][0];
      var dr = ORTHO[i][1];
      var c = col + dc;
      var r = row + dr;
      var first = null;
      var firstIndex = -1;
      while (onBoard(c, r)) {
        var piece = board[idxOf(c, r)];
        if (piece) { first = piece; firstIndex = idxOf(c, r); break; }
        c += dc;
        r += dr;
      }
      if (first) {
        if (colorOf(first) === by) {
          var type = typeOf(first);
          if (type === 'R') return true;
          /* 将帅只在九宫内、且仅对同列的远处目标成立（飞将） */
          if (type === 'K' && dc === 0 && Math.abs(row - rowOf(firstIndex)) > 1) return true;
        }
        /* 炮：越过炮架后打到的第一个子 */
        c += dc;
        r += dr;
        while (onBoard(c, r)) {
          var behind = board[idxOf(c, r)];
          if (behind) {
            if (colorOf(behind) === by && typeOf(behind) === 'C') return true;
            break;
          }
          c += dc;
          r += dr;
        }
      }
    }

    /* 马：反推马位，马腿紧贴马、位于马与目标之间 */
    for (i = 0; i < HORSE.length; i += 1) {
      var leg = HORSE[i][0];
      var jump = HORSE[i][1];
      var hc = col - jump[0];
      var hr = row - jump[1];
      if (!onBoard(hc, hr)) continue;
      if (board[idxOf(hc, hr)] !== by + 'N') continue;
      if (!board[idxOf(hc + leg[0], hr + leg[1])]) return true;
    }

    /* 兵 / 卒 */
    var pawnRow = row - forward(by) * 1;
    /* 向前走一格的兵：by 方兵从 pawnRow 前进到 row */
    if (onBoard(col, pawnRow) && board[idxOf(col, pawnRow)] === by + 'P') return true;
    /* 过河后可横吃：同一行左右相邻 */
    if (onBoard(col - 1, row) && board[idxOf(col - 1, row)] === by + 'P' && crossedRiver(idxOf(col - 1, row), by)) return true;
    if (onBoard(col + 1, row) && board[idxOf(col + 1, row)] === by + 'P' && crossedRiver(idxOf(col + 1, row), by)) return true;

    /* 士：九宫内斜邻点 */
    for (i = 0; i < DIAG.length; i += 1) {
      var ac = col + DIAG[i][0];
      var ar = row + DIAG[i][1];
      if (!onBoard(ac, ar)) continue;
      var advisor = board[idxOf(ac, ar)];
      if (advisor === by + 'A') return true;
    }

    /* 象：田字，象眼为空 */
    for (i = 0; i < ELEPHANT.length; i += 1) {
      var eye = ELEPHANT[i][0];
      var spot = ELEPHANT[i][1];
      var ec = col + eye[0];
      var er = row + eye[1];
      var sc = col + spot[0];
      var sr = row + spot[1];
      if (!onBoard(sc, sr) || !onBoard(ec, er)) continue;
      if (board[idxOf(ec, er)]) continue;
      if (board[idxOf(sc, sr)] === by + 'B') return true;
    }

    /* 将帅贴身一格（九宫内） */
    for (i = 0; i < ORTHO.length; i += 1) {
      var kc = col + ORTHO[i][0];
      var kr = row + ORTHO[i][1];
      if (!onBoard(kc, kr)) continue;
      if (board[idxOf(kc, kr)] === by + 'K') return true;
    }

    return false;
  }

  function kingSquare(state, color) {
    var target = color + 'K';
    for (var i = 0; i < COLS * ROWS; i += 1) if (state.board[i] === target) return i;
    return -1;
  }

  /* 将帅照面：同列且中间无子，双方都算被将 */
  function kingsFacing(state) {
    var a = kingSquare(state, RED);
    var b = kingSquare(state, BLACK);
    if (a < 0 || b < 0) return false;
    if (colOf(a) !== colOf(b)) return false;
    var lo = Math.min(rowOf(a), rowOf(b));
    var hi = Math.max(rowOf(a), rowOf(b));
    for (var r = lo + 1; r < hi; r += 1) {
      if (state.board[idxOf(colOf(a), r)]) return false;
    }
    return true;
  }

  function inCheck(state, color) {
    var king = kingSquare(state, color);
    if (king < 0) return true;
    if (kingsFacing(state)) return true;
    return attacked(state, king, other(color));
  }

  /* ------------------------------------------------------------ 走法生成 */
  function pushMove(list, state, from, to) {
    var move = {
      from: from,
      to: to,
      piece: state.board[from],
      captured: state.board[to] || null
    };
    list.push(move);
    return move;
  }

  function addStep(state, from, color, list, dc, dr) {
    var col = colOf(from) + dc;
    var row = rowOf(from) + dr;
    if (!onBoard(col, row)) return;
    var target = idxOf(col, row);
    var piece = state.board[target];
    if (piece && colorOf(piece) === color) return;
    pushMove(list, state, from, target);
  }

  function addKing(state, from, color, list) {
    for (var i = 0; i < ORTHO.length; i += 1) {
      var col = colOf(from) + ORTHO[i][0];
      var row = rowOf(from) + ORTHO[i][1];
      if (!onBoard(col, row)) continue;
      var target = idxOf(col, row);
      if (!inPalace(target, color)) continue;
      var piece = state.board[target];
      if (piece && colorOf(piece) === color) continue;
      pushMove(list, state, from, target);
    }
  }

  function addAdvisor(state, from, color, list) {
    for (var i = 0; i < DIAG.length; i += 1) {
      var col = colOf(from) + DIAG[i][0];
      var row = rowOf(from) + DIAG[i][1];
      if (!onBoard(col, row)) continue;
      var target = idxOf(col, row);
      if (!inPalace(target, color)) continue;
      var piece = state.board[target];
      if (piece && colorOf(piece) === color) continue;
      pushMove(list, state, from, target);
    }
  }

  function addElephant(state, from, color, list) {
    for (var i = 0; i < ELEPHANT.length; i += 1) {
      var col = colOf(from) + ELEPHANT[i][1][0];
      var row = rowOf(from) + ELEPHANT[i][1][1];
      if (!onBoard(col, row)) continue;
      var target = idxOf(col, row);
      if (!ownHalf(target, color)) continue;          /* 象不过河 */
      var eyeCol = colOf(from) + ELEPHANT[i][0][0];
      var eyeRow = rowOf(from) + ELEPHANT[i][0][1];
      if (state.board[idxOf(eyeCol, eyeRow)]) continue; /* 塞象眼 */
      var piece = state.board[target];
      if (piece && colorOf(piece) === color) continue;
      pushMove(list, state, from, target);
    }
  }

  function addHorse(state, from, color, list) {
    for (var i = 0; i < HORSE.length; i += 1) {
      var legCol = colOf(from) + HORSE[i][0][0];
      var legRow = rowOf(from) + HORSE[i][0][1];
      if (!onBoard(legCol, legRow)) continue;
      if (state.board[idxOf(legCol, legRow)]) continue;  /* 蹩马腿 */
      var col = colOf(from) + HORSE[i][1][0];
      var row = rowOf(from) + HORSE[i][1][1];
      if (!onBoard(col, row)) continue;
      var target = idxOf(col, row);
      var piece = state.board[target];
      if (piece && colorOf(piece) === color) continue;
      pushMove(list, state, from, target);
    }
  }

  function addRook(state, from, color, list) {
    for (var i = 0; i < ORTHO.length; i += 1) {
      var col = colOf(from) + ORTHO[i][0];
      var row = rowOf(from) + ORTHO[i][1];
      while (onBoard(col, row)) {
        var target = idxOf(col, row);
        var piece = state.board[target];
        if (piece) {
          if (colorOf(piece) !== color) pushMove(list, state, from, target);
          break;
        }
        pushMove(list, state, from, target);
        col += ORTHO[i][0];
        row += ORTHO[i][1];
      }
    }
  }

  function addCannon(state, from, color, list) {
    for (var i = 0; i < ORTHO.length; i += 1) {
      var col = colOf(from) + ORTHO[i][0];
      var row = rowOf(from) + ORTHO[i][1];
      var screen = false;
      while (onBoard(col, row)) {
        var target = idxOf(col, row);
        var piece = state.board[target];
        if (!screen) {
          if (piece) screen = true;
          else pushMove(list, state, from, target);
        } else if (piece) {
          if (colorOf(piece) !== color) pushMove(list, state, from, target);
          break;
        }
        col += ORTHO[i][0];
        row += ORTHO[i][1];
      }
    }
  }

  function addPawn(state, from, color, list) {
    addStep(state, from, color, list, 0, forward(color));
    if (crossedRiver(from, color)) {
      addStep(state, from, color, list, -1, 0);
      addStep(state, from, color, list, 1, 0);
    }
  }

  function pseudoMoves(state, color) {
    var board = state.board;
    var list = [];
    for (var i = 0; i < COLS * ROWS; i += 1) {
      var piece = board[i];
      if (!piece || colorOf(piece) !== color) continue;
      var type = typeOf(piece);
      if (type === 'K') addKing(state, i, color, list);
      else if (type === 'A') addAdvisor(state, i, color, list);
      else if (type === 'B') addElephant(state, i, color, list);
      else if (type === 'N') addHorse(state, i, color, list);
      else if (type === 'R') addRook(state, i, color, list);
      else if (type === 'C') addCannon(state, i, color, list);
      else if (type === 'P') addPawn(state, i, color, list);
    }
    return list;
  }

  /* ------------------------------------------------------------ 落子与悔棋 */
  function cloneMeta(state) {
    return {
      board: state.board.slice(),
      turn: state.turn,
      halfmove: state.halfmove,
      fullmove: state.fullmove,
      history: [],
      keys: (state.keys || []).slice(),
      status: state.status,
      winner: state.winner,
      reason: state.reason,
      checkSquare: state.checkSquare
    };
  }

  function play(state, move) {
    var undo = {
      turn: state.turn,
      from: move.from,
      to: move.to,
      piece: move.piece,
      captured: move.captured,
      halfmove: state.halfmove,
      fullmove: state.fullmove
    };
    state.board[move.to] = move.piece;
    state.board[move.from] = null;
    state.halfmove = move.captured ? 0 : state.halfmove + 1;
    if (state.turn === BLACK) state.fullmove += 1;
    state.turn = other(state.turn);
    return undo;
  }

  function restore(state, undo) {
    state.board[undo.from] = undo.piece;
    state.board[undo.to] = undo.captured;
    state.halfmove = undo.halfmove;
    state.fullmove = undo.fullmove;
    state.turn = undo.turn;
  }

  function legalMoves(state, color) {
    var side = color || state.turn;
    var pseudo = pseudoMoves(state, side);
    var out = [];
    for (var i = 0; i < pseudo.length; i += 1) {
      var next = cloneMeta(state);
      play(next, pseudo[i]);
      if (next.board[kingSquare(next, side)] === side + 'K'
        && !kingsFacing(next) && !attacked(next, kingSquare(next, side), other(side))) {
        out.push(pseudo[i]);
      }
    }
    return out;
  }

  function movesFrom(state, from, color) {
    return legalMoves(state, color).filter(function (move) { return move.from === from; });
  }

  function targetsFrom(state, from, color) {
    var seen = {};
    var list = [];
    movesFrom(state, from, color).forEach(function (move) {
      if (seen[move.to]) return;
      seen[move.to] = true;
      list.push(move.to);
    });
    return list;
  }

  function moveAt(state, from, to) {
    var list = legalMoves(state, state.turn);
    for (var i = 0; i < list.length; i += 1) {
      if (list[i].from === from && list[i].to === to) return list[i];
    }
    return null;
  }

  /* ------------------------------------------------------------ 记谱与状态 */
  var NAME = { K: '帅', A: '仕', B: '相', N: '马', R: '车', C: '炮', P: '兵' };
  var NAME_BLACK = { K: '将', A: '士', B: '象', N: '马', R: '车', C: '炮', P: '卒' };

  function pieceName(piece) {
    if (!piece) return '空';
    var table = colorOf(piece) === RED ? NAME : NAME_BLACK;
    return table[typeOf(piece)] || '?';
  }

  /* 简记：炮 b2-e2 / 车 a1xa4，足够回看，不做传统的中文记谱 */
  function notation(move) {
    return pieceName(move.piece) + ' ' + squareName(move.from)
      + (move.captured ? 'x' : '-') + squareName(move.to);
  }

  function positionKey(state) {
    var parts = [];
    for (var i = 0; i < COLS * ROWS; i += 1) parts.push(state.board[i] || '.');
    parts.push(state.turn);
    return parts.join('');
  }

  function repetitionCount(state) {
    var keys = state.keys || [];
    if (!keys.length) return 1;
    var last = keys[keys.length - 1];
    var count = 0;
    for (var i = 0; i < keys.length; i += 1) if (keys[i] === last) count += 1;
    return count;
  }

  /* 困毙（无子可走）在中国象棋里同样判负，只有重复局面与长期无吃子算和 */
  function refreshStatus(state) {
    var side = state.turn;
    var moves = legalMoves(state, side);
    var check = inCheck(state, side);
    state.checkSquare = check ? kingSquare(state, side) : -1;
    state.legalCount = moves.length;

    if (!moves.length) {
      state.status = 'checkmate';
      state.winner = other(side);
      state.reason = check ? 'checkmate' : 'stalemate';
      return state.status;
    }
    if (state.halfmove >= 120) {
      state.status = 'draw';
      state.winner = null;
      state.reason = 'noCapture';
    } else if (repetitionCount(state) >= 3) {
      state.status = 'draw';
      state.winner = null;
      state.reason = 'repetition';
    } else {
      state.status = check ? 'check' : 'playing';
      state.winner = null;
      state.reason = null;
    }
    return state.status;
  }

  function createState() {
    var state = {
      board: initialBoard(),
      turn: RED,
      halfmove: 0,
      fullmove: 1,
      history: [],
      keys: [],
      status: 'playing',
      winner: null,
      reason: null,
      checkSquare: -1,
      legalCount: 0
    };
    state.keys.push(positionKey(state));
    return state;
  }

  function applyMove(state, move) {
    if (!move) return null;
    var text = notation(move);
    var undo = play(state, move);
    state.keys.push(positionKey(state));
    state.history.push({ move: move, san: text, undo: undo, color: colorOf(move.piece) });
    refreshStatus(state);
    var suffix = state.status === 'checkmate' ? '#' : (state.status === 'check' ? '+' : '');
    var full = text + suffix;
    state.history[state.history.length - 1].san = full;
    return { move: move, san: full, status: state.status, winner: state.winner, reason: state.reason };
  }

  function undoMove(state) {
    var last = state.history.pop();
    if (!last) return null;
    restore(state, last.undo);
    state.keys.pop();
    refreshStatus(state);
    return last;
  }

  /* ------------------------------------------------------------ FEN 与 perft */
  function toFEN(state) {
    var rows = [];
    for (var r = 0; r < ROWS; r += 1) {
      var line = '';
      var empty = 0;
      for (var c = 0; c < COLS; c += 1) {
        var piece = state.board[idxOf(c, r)];
        if (!piece) { empty += 1; continue; }
        if (empty) { line += empty; empty = 0; }
        var type = typeOf(piece);
        line += colorOf(piece) === RED ? type : type.toLowerCase();
      }
      if (empty) line += empty;
      rows.push(line);
    }
    return rows.join('/') + ' ' + (state.turn === RED ? 'w' : 'b')
      + ' - - ' + state.halfmove + ' ' + state.fullmove;
  }

  function fromFEN(fen) {
    var parts = String(fen).trim().split(/\s+/);
    var board = emptyBoard();
    var rows = parts[0].split('/');
    for (var r = 0; r < rows.length && r < ROWS; r += 1) {
      var c = 0;
      for (var i = 0; i < rows[r].length; i += 1) {
        var ch = rows[r].charAt(i);
        if (ch >= '1' && ch <= '9') { c += Number(ch); continue; }
        var color = ch === ch.toUpperCase() ? RED : BLACK;
        board[idxOf(c, r)] = color + ch.toUpperCase();
        c += 1;
      }
    }
    var state = {
      board: board,
      turn: parts[1] === 'b' ? BLACK : RED,
      halfmove: Number(parts[4] || 0),
      fullmove: Number(parts[5] || 1),
      history: [],
      keys: [],
      status: 'playing',
      winner: null,
      reason: null,
      checkSquare: -1,
      legalCount: 0
    };
    state.keys.push(positionKey(state));
    refreshStatus(state);
    return state;
  }

  function perft(state, depth) {
    var moves = legalMoves(state, state.turn);
    if (depth <= 1) return moves.length;
    var total = 0;
    for (var i = 0; i < moves.length; i += 1) {
      var next = cloneMeta(state);
      play(next, moves[i]);
      total += perft(next, depth - 1);
    }
    return total;
  }

  root.XiangqiCore = {
    RED: RED,
    BLACK: BLACK,
    COLS: COLS,
    ROWS: ROWS,
    START_FEN: START_FEN,
    NAMES: { r: NAME, b: NAME_BLACK },
    other: other,
    colorOf: colorOf,
    typeOf: typeOf,
    idxOf: idxOf,
    colOf: colOf,
    rowOf: rowOf,
    onBoard: onBoard,
    squareName: squareName,
    inPalace: inPalace,
    crossedRiver: crossedRiver,
    initialBoard: initialBoard,
    createState: createState,
    cloneMeta: cloneMeta,
    positionKey: positionKey,
    attacked: attacked,
    kingsFacing: kingsFacing,
    inCheck: inCheck,
    kingSquare: kingSquare,
    pseudoMoves: pseudoMoves,
    legalMoves: legalMoves,
    movesFrom: movesFrom,
    targetsFrom: targetsFrom,
    moveAt: moveAt,
    play: play,
    restore: restore,
    applyMove: applyMove,
    undoMove: undoMove,
    refreshStatus: refreshStatus,
    notation: notation,
    pieceName: pieceName,
    toFEN: toFEN,
    fromFEN: fromFEN,
    perft: perft
  };
})(typeof window !== 'undefined' ? window : globalThis);
