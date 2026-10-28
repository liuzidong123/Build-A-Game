/* 国际象棋 · 纯规则内核（无 DOM，可被 node 直接加载做测试）
 * 棋盘用 64 格数组表示，索引 0 = a8（左上），索引 63 = h1（右下）；
 * 格子值形如 'wK' / 'bP'，空格为 null。
 */
(function (root) {
  'use strict';

  var WHITE = 'w';
  var BLACK = 'b';
  var START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

  var KNIGHT_STEPS = [[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]];
  var KING_STEPS = [[0, 1], [1, 1], [1, 0], [1, -1], [0, -1], [-1, -1], [-1, 0], [-1, 1]];
  var ROOK_DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  var BISHOP_DIRS = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
  var QUEEN_DIRS = ROOK_DIRS.concat(BISHOP_DIRS);
  var PROMOTIONS = ['Q', 'R', 'B', 'N'];

  function other(color) { return color === WHITE ? BLACK : WHITE; }
  function colorOf(piece) { return piece ? piece.charAt(0) : ''; }
  function typeOf(piece) { return piece ? piece.charAt(1) : ''; }

  function idxOf(file, rank) { return (8 - rank) * 8 + file; }
  function fileOf(index) { return index & 7; }
  function rankOf(index) { return 8 - (index >> 3); }
  function squareName(index) { return 'abcdefgh'.charAt(index & 7) + rankOf(index); }

  function onBoard(file, rank) { return file >= 0 && file < 8 && rank >= 1 && rank <= 8; }

  function emptyBoard() {
    var board = [];
    for (var i = 0; i < 64; i += 1) board.push(null);
    return board;
  }

  function initialBoard() {
    var back = ['R', 'N', 'B', 'Q', 'K', 'B', 'N', 'R'];
    var board = emptyBoard();
    for (var f = 0; f < 8; f += 1) {
      board[idxOf(f, 8)] = BLACK + back[f];
      board[idxOf(f, 1)] = WHITE + back[f];
      board[idxOf(f, 7)] = BLACK + 'P';
      board[idxOf(f, 2)] = WHITE + 'P';
    }
    return board;
  }

  function createState() {
    var state = {
      board: initialBoard(),
      turn: WHITE,
      castling: { wK: true, wQ: true, bK: true, bQ: true },
      ep: null,
      halfmove: 0,
      fullmove: 1,
      history: [],
      keys: [],
      status: 'playing',
      winner: null,
      reason: null,
      checkSquare: -1
    };
    state.keys.push(positionKey(state));
    return state;
  }

  function cloneMeta(state) {
    return {
      board: state.board.slice(),
      turn: state.turn,
      castling: {
        wK: state.castling.wK, wQ: state.castling.wQ,
        bK: state.castling.bK, bQ: state.castling.bQ
      },
      ep: state.ep,
      halfmove: state.halfmove,
      fullmove: state.fullmove,
      history: [],
      keys: (state.keys || []).slice()
    };
  }

  /* 局面指纹：用于三次重复；吃过路兵的机会也计入，否则重复判定会偏松 */
  function positionKey(state) {
    var parts = [];
    for (var i = 0; i < 64; i += 1) parts.push(state.board[i] || '.');
    parts.push(state.turn);
    parts.push(state.castling.wK ? 'K' : '-');
    parts.push(state.castling.wQ ? 'Q' : '-');
    parts.push(state.castling.bK ? 'k' : '-');
    parts.push(state.castling.bQ ? 'q' : '-');
    parts.push(state.ep == null ? '-' : squareName(state.ep));
    return parts.join('');
  }

  /* ------------------------------------------------------------ 攻击判定 */
  function attacked(state, target, by) {
    var board = state.board;
    var file = fileOf(target);
    var rank = rankOf(target);
    var step;
    var i;

    // 兵：白兵向上走，所以攻击 target 的白兵位于目标下一行
    var pawnRank = by === WHITE ? rank - 1 : rank + 1;
    if (onBoard(file - 1, pawnRank) && board[idxOf(file - 1, pawnRank)] === by + 'P') return true;
    if (onBoard(file + 1, pawnRank) && board[idxOf(file + 1, pawnRank)] === by + 'P') return true;

    for (i = 0; i < KNIGHT_STEPS.length; i += 1) {
      step = KNIGHT_STEPS[i];
      if (!onBoard(file + step[0], rank + step[1])) continue;
      if (board[idxOf(file + step[0], rank + step[1])] === by + 'N') return true;
    }

    for (i = 0; i < KING_STEPS.length; i += 1) {
      step = KING_STEPS[i];
      if (!onBoard(file + step[0], rank + step[1])) continue;
      if (board[idxOf(file + step[0], rank + step[1])] === by + 'K') return true;
    }

    for (i = 0; i < ROOK_DIRS.length; i += 1) {
      step = ROOK_DIRS[i];
      var rf = file + step[0];
      var rr = rank + step[1];
      while (onBoard(rf, rr)) {
        var rp = board[idxOf(rf, rr)];
        if (rp) {
          if (colorOf(rp) === by && (typeOf(rp) === 'R' || typeOf(rp) === 'Q')) return true;
          break;
        }
        rf += step[0];
        rr += step[1];
      }
    }

    for (i = 0; i < BISHOP_DIRS.length; i += 1) {
      step = BISHOP_DIRS[i];
      var bf = file + step[0];
      var br = rank + step[1];
      while (onBoard(bf, br)) {
        var bp = board[idxOf(bf, br)];
        if (bp) {
          if (colorOf(bp) === by && (typeOf(bp) === 'B' || typeOf(bp) === 'Q')) return true;
          break;
        }
        bf += step[0];
        br += step[1];
      }
    }

    return false;
  }

  function kingSquare(state, color) {
    var board = state.board;
    var target = color + 'K';
    for (var i = 0; i < 64; i += 1) if (board[i] === target) return i;
    return -1;
  }

  function inCheck(state, color) {
    var king = kingSquare(state, color);
    return king >= 0 && attacked(state, king, other(color));
  }

  /* ------------------------------------------------------------ 走法生成 */
  function pushMove(list, state, from, to, extra) {
    var move = {
      from: from,
      to: to,
      piece: state.board[from],
      captured: state.board[to] || null,
      promotion: null,
      castle: null,
      ep: false
    };
    if (extra) {
      for (var key in extra) {
        if (Object.prototype.hasOwnProperty.call(extra, key)) move[key] = extra[key];
      }
    }
    list.push(move);
    return move;
  }

  function addSteps(state, from, color, steps, list) {
    var board = state.board;
    var file = fileOf(from);
    var rank = rankOf(from);
    for (var i = 0; i < steps.length; i += 1) {
      var nf = file + steps[i][0];
      var nr = rank + steps[i][1];
      if (!onBoard(nf, nr)) continue;
      var target = idxOf(nf, nr);
      var piece = board[target];
      if (piece && colorOf(piece) === color) continue;
      pushMove(list, state, from, target);
    }
  }

  function addSlides(state, from, color, dirs, list) {
    var board = state.board;
    var file = fileOf(from);
    var rank = rankOf(from);
    for (var i = 0; i < dirs.length; i += 1) {
      var nf = file + dirs[i][0];
      var nr = rank + dirs[i][1];
      while (onBoard(nf, nr)) {
        var target = idxOf(nf, nr);
        var piece = board[target];
        if (piece) {
          if (colorOf(piece) !== color) pushMove(list, state, from, target);
          break;
        }
        pushMove(list, state, from, target);
        nf += dirs[i][0];
        nr += dirs[i][1];
      }
    }
  }

  function addPawn(state, from, color, list) {
    var board = state.board;
    var file = fileOf(from);
    var rank = rankOf(from);
    var dir = color === WHITE ? 1 : -1;
    var startRank = color === WHITE ? 2 : 7;
    var promoRank = color === WHITE ? 8 : 1;
    var OneRank = rank + dir;

    function addTo(target, extra) {
      if (!onBoard(fileOf(target), rankOf(target))) return;
      if (rankOf(target) === promoRank) {
        for (var k = 0; k < PROMOTIONS.length; k += 1) {
          var extraPromo = { promotion: PROMOTIONS[k] };
          if (extra) for (var key in extra) extraPromo[key] = extra[key];
          pushMove(list, state, from, target, extraPromo);
        }
      } else {
        pushMove(list, state, from, target, extra);
      }
    }

    var oneSquare = idxOf(file, OneRank);
    if (onBoard(file, OneRank) && !board[oneSquare]) {
      addTo(oneSquare);
      var twoRank = rank + dir * 2;
      if (rank === startRank && !board[idxOf(file, twoRank)]) {
        pushMove(list, state, from, idxOf(file, twoRank), { double: true });
      }
    }

    for (var d = -1; d <= 1; d += 2) {
      var cf = file + d;
      if (!onBoard(cf, OneRank)) continue;
      var target = idxOf(cf, OneRank);
      var victim = board[target];
      if (victim && colorOf(victim) !== color) addTo(target);
      else if (!victim && state.ep === target) {
        pushMove(list, state, from, target, {
          captured: other(color) + 'P',
          ep: true,
          capturedSquare: idxOf(cf, rank)
        });
      }
    }
  }

  function addCastles(state, color, list) {
    var board = state.board;
    var rank = color === WHITE ? 1 : 8;
    var kingSq = idxOf(4, rank);
    if (board[kingSq] !== color + 'K') return;
    if (attacked(state, kingSq, other(color))) return;

    var kingSide = color === WHITE ? state.castling.wK : state.castling.bK;
    var queenSide = color === WHITE ? state.castling.wQ : state.castling.bQ;

    if (kingSide && board[idxOf(7, rank)] === color + 'R'
      && !board[idxOf(5, rank)] && !board[idxOf(6, rank)]
      && !attacked(state, idxOf(5, rank), other(color))
      && !attacked(state, idxOf(6, rank), other(color))) {
      pushMove(list, state, kingSq, idxOf(6, rank), { castle: 'K' });
    }

    if (queenSide && board[idxOf(0, rank)] === color + 'R'
      && !board[idxOf(1, rank)] && !board[idxOf(2, rank)] && !board[idxOf(3, rank)]
      && !attacked(state, idxOf(3, rank), other(color))
      && !attacked(state, idxOf(2, rank), other(color))) {
      pushMove(list, state, kingSq, idxOf(2, rank), { castle: 'Q' });
    }
  }

  function pseudoMoves(state, color) {
    var board = state.board;
    var list = [];
    for (var i = 0; i < 64; i += 1) {
      var piece = board[i];
      if (!piece || colorOf(piece) !== color) continue;
      var type = typeOf(piece);
      if (type === 'P') addPawn(state, i, color, list);
      else if (type === 'N') addSteps(state, i, color, KNIGHT_STEPS, list);
      else if (type === 'K') addSteps(state, i, color, KING_STEPS, list);
      else if (type === 'R') addSlides(state, i, color, ROOK_DIRS, list);
      else if (type === 'B') addSlides(state, i, color, BISHOP_DIRS, list);
      else if (type === 'Q') addSlides(state, i, color, QUEEN_DIRS, list);
    }
    addCastles(state, color, list);
    return list;
  }

  /* ------------------------------------------------------------ 落子与悔棋 */
  function clearCastling(state, color, side) {
    var prefix = color === WHITE ? 'w' : 'b';
    if (side === 'K') state.castling[prefix + 'K'] = false;
    else state.castling[prefix + 'Q'] = false;
  }

  function clearCastlingBySquare(state, square) {
    for (var color of [WHITE, BLACK]) {
      var rank = color === WHITE ? 1 : 8;
      if (square === idxOf(0, rank)) clearCastling(state, color, 'Q');
      if (square === idxOf(7, rank)) clearCastling(state, color, 'K');
    }
  }

  /* 执行一步棋，返回复原所需信息；不写历史，供搜索与悔棋共用 */
  function play(state, move) {
    var board = state.board;
    var color = colorOf(move.piece);
    var type = typeOf(move.piece);
    var rank = rankOf(move.from);
    var undo = {
      turn: state.turn,
      from: move.from,
      to: move.to,
      piece: move.piece,
      captured: move.captured,
      capturedSquare: move.capturedSquare != null ? move.capturedSquare : move.to,
      promotion: move.promotion,
      castle: move.castle,
      ep: state.ep,
      castling: {
        wK: state.castling.wK, wQ: state.castling.wQ,
        bK: state.castling.bK, bQ: state.castling.bQ
      },
      halfmove: state.halfmove,
      fullmove: state.fullmove
    };

    board[move.to] = move.promotion ? color + move.promotion : move.piece;
    board[move.from] = null;
    if (move.ep) board[undo.capturedSquare] = null;

    if (move.castle === 'K') {
      board[idxOf(5, rank)] = board[idxOf(7, rank)];
      board[idxOf(7, rank)] = null;
    } else if (move.castle === 'Q') {
      board[idxOf(3, rank)] = board[idxOf(0, rank)];
      board[idxOf(0, rank)] = null;
    }

    if (type === 'K') {
      clearCastling(state, color, 'K');
      clearCastling(state, color, 'Q');
    }
    if (type === 'R') clearCastlingBySquare(state, move.from);
    if (undo.captured && typeOf(undo.captured) === 'R') clearCastlingBySquare(state, undo.capturedSquare);

    var epSquare = move.double
      ? idxOf(fileOf(move.from), (rankOf(move.from) + rankOf(move.to)) / 2)
      : null;
    // 只有旁边（刚推到的这一横线）真站着能吃过路兵的敌兵时才记录目标格
    if (epSquare != null) {
      var epFile = fileOf(epSquare);
      var pawnRank = rankOf(move.to);
      var enemyPawn = other(color) + 'P';
      var canCapture = (epFile > 0 && board[idxOf(epFile - 1, pawnRank)] === enemyPawn)
        || (epFile < 7 && board[idxOf(epFile + 1, pawnRank)] === enemyPawn);
      if (!canCapture) epSquare = null;
    }
    state.ep = epSquare;
    state.halfmove = (type === 'P' || move.captured) ? 0 : state.halfmove + 1;
    if (color === BLACK) state.fullmove += 1;
    state.turn = other(color);
    return undo;
  }

  function restore(state, undo) {
    var board = state.board;
    board[undo.from] = undo.piece;
    board[undo.to] = undo.ep ? null : undo.captured;
    if (undo.ep) board[undo.capturedSquare] = undo.captured;

    if (undo.castle) {
      var rank = rankOf(undo.from);
      if (undo.castle === 'K') {
        board[idxOf(7, rank)] = board[idxOf(5, rank)];
        board[idxOf(5, rank)] = null;
      } else {
        board[idxOf(0, rank)] = board[idxOf(3, rank)];
        board[idxOf(3, rank)] = null;
      }
    }

    state.castling = undo.castling;
    state.ep = undo.ep;
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
      var king = kingSquare(next, side);
      if (king >= 0 && !attacked(next, king, other(side))) out.push(pseudo[i]);
    }
    return out;
  }

  function movesFrom(state, from, color) {
    return legalMoves(state, color).filter(function (move) { return move.from === from; });
  }

  /* 同一落点可能有多条（升变），UI 只需要去重后的目标集合 */
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

  function moveAt(state, from, to, promotion) {
    var list = legalMoves(state, state.turn);
    for (var i = 0; i < list.length; i += 1) {
      if (list[i].from !== from || list[i].to !== to) continue;
      if (list[i].promotion && promotion && list[i].promotion !== promotion) continue;
      return list[i];
    }
    return null;
  }

  /* ------------------------------------------------------------ 记谱与状态 */
  function sanNotation(state, move) {
    if (move.castle) return move.castle === 'K' ? 'O-O' : 'O-O-O';
    var type = typeOf(move.piece);
    var target = squareName(move.to);
    var text = '';

    if (type === 'P') {
      text = (move.captured ? 'abcdefgh'.charAt(fileOf(move.from)) + 'x' : '') + target;
      if (move.promotion) text += '=' + move.promotion;
      return text;
    }

    var rivals = pseudoMoves(state, colorOf(move.piece)).filter(function (other2) {
      return other2.to === move.to && other2.from !== move.from && typeOf(other2.piece) === type;
    });

    text = type;
    if (rivals.length) {
      var sameFile = rivals.some(function (r) { return fileOf(r.from) === fileOf(move.from); });
      var sameRank = rivals.some(function (r) { return rankOf(r.from) === rankOf(move.from); });
      if (!sameFile) text += 'abcdefgh'.charAt(fileOf(move.from));
      else if (!sameRank) text += rankOf(move.from);
      else text += squareName(move.from);
    }
    if (move.captured) text += 'x';
    return text + target;
  }

  function checkSuffix(state) {
    var side = state.turn;
    if (!inCheck(state, side)) return '';
    return legalMoves(state, side).length ? '+' : '#';
  }

  function insufficientMaterial(state) {
    var counts = { w: 0, b: 0 };
    var bishops = { w: [], b: [] };
    for (var i = 0; i < 64; i += 1) {
      var piece = state.board[i];
      if (!piece) continue;
      var type = typeOf(piece);
      if (type === 'P' || type === 'R' || type === 'Q') return false;
      if (type === 'K') continue;
      var color = colorOf(piece);
      counts[color] += 1;
      if (type === 'B') bishops[color].push((fileOf(i) + rankOf(i)) % 2);
    }
    if (counts.w <= 1 && counts.b <= 1) return true;
    if (counts.w === 1 && counts.b === 1
      && bishops.w.length === 1 && bishops.b.length === 1
      && bishops.w[0] === bishops.b[0]) return true;
    return false;
  }

  function repetitionCount(state) {
    var keys = state.keys || [];
    if (!keys.length) return 1;
    var last = keys[keys.length - 1];
    var count = 0;
    for (var i = 0; i < keys.length; i += 1) if (keys[i] === last) count += 1;
    return count;
  }

  function refreshStatus(state) {
    var side = state.turn;
    var moves = legalMoves(state, side);
    var check = inCheck(state, side);
    state.checkSquare = check ? kingSquare(state, side) : -1;
    state.legalCount = moves.length;

    if (!moves.length) {
      if (check) {
        state.status = 'checkmate';
        state.winner = other(side);
        state.reason = 'checkmate';
      } else {
        state.status = 'stalemate';
        state.winner = null;
        state.reason = 'stalemate';
      }
      return state.status;
    }
    if (state.halfmove >= 100) {
      state.status = 'draw';
      state.winner = null;
      state.reason = 'fifty';
    } else if (insufficientMaterial(state)) {
      state.status = 'draw';
      state.winner = null;
      state.reason = 'insufficient';
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

  function applyMove(state, move) {
    if (!move) return null;
    var san = sanNotation(state, move);
    var undo = play(state, move);
    state.keys.push(positionKey(state));
    state.history.push({ move: move, san: san, undo: undo, color: colorOf(move.piece) });
    refreshStatus(state);
    var full = san + checkSuffix(state);
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
    for (var r = 0; r < 8; r += 1) {
      var line = '';
      var empty = 0;
      for (var f = 0; f < 8; f += 1) {
        var piece = state.board[r * 8 + f];
        if (!piece) { empty += 1; continue; }
        if (empty) { line += empty; empty = 0; }
        line += colorOf(piece) === WHITE ? typeOf(piece) : typeOf(piece).toLowerCase();
      }
      if (empty) line += empty;
      rows.push(line);
    }
    var castling = (state.castling.wK ? 'K' : '') + (state.castling.wQ ? 'Q' : '')
      + (state.castling.bK ? 'k' : '') + (state.castling.bQ ? 'q' : '');
    return rows.join('/') + ' ' + state.turn + ' ' + (castling || '-')
      + ' ' + (state.ep == null ? '-' : squareName(state.ep))
      + ' ' + state.halfmove + ' ' + state.fullmove;
  }

  function fromFEN(fen) {
    var parts = String(fen).trim().split(/\s+/);
    var board = emptyBoard();
    var rows = parts[0].split('/');
    for (var r = 0; r < 8; r += 1) {
      var f = 0;
      for (var i = 0; i < rows[r].length; i += 1) {
        var ch = rows[r].charAt(i);
        if (ch >= '1' && ch <= '8') { f += Number(ch); continue; }
        var color = ch === ch.toUpperCase() ? WHITE : BLACK;
        board[r * 8 + f] = color + ch.toUpperCase();
        f += 1;
      }
    }
    var rights = parts[2] || '-';
    var epParts = parts[3] || '-';
    var state = {
      board: board,
      turn: parts[1] === 'b' ? BLACK : WHITE,
      castling: {
        wK: rights.indexOf('K') >= 0, wQ: rights.indexOf('Q') >= 0,
        bK: rights.indexOf('k') >= 0, bQ: rights.indexOf('q') >= 0
      },
      ep: epParts === '-' ? null : idxOf(epParts.charCodeAt(0) - 97, Number(epParts.charAt(1))),
      halfmove: Number(parts[4] || 0),
      fullmove: Number(parts[5] || 1),
      history: [],
      keys: [],
      status: 'playing',
      winner: null,
      reason: null,
      checkSquare: -1
    };
    state.keys.push(positionKey(state));
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

  root.ChessCore = {
    WHITE: WHITE,
    BLACK: BLACK,
    START_FEN: START_FEN,
    PROMOTIONS: PROMOTIONS,
    other: other,
    colorOf: colorOf,
    typeOf: typeOf,
    idxOf: idxOf,
    fileOf: fileOf,
    rankOf: rankOf,
    squareName: squareName,
    initialBoard: initialBoard,
    createState: createState,
    cloneMeta: cloneMeta,
    positionKey: positionKey,
    attacked: attacked,
    inCheck: inCheck,
    kingSquare: kingSquare,
    pseudoMoves: pseudoMoves,
    legalMoves: legalMoves,
    movesFrom: movesFrom,
    targetsFrom: targetsFrom,
    moveAt: moveAt,
    play: play,
    applyMove: applyMove,
    undoMove: undoMove,
    refreshStatus: refreshStatus,
    sanNotation: sanNotation,
    insufficientMaterial: insufficientMaterial,
    toFEN: toFEN,
    fromFEN: fromFEN,
    perft: perft
  };
})(typeof window !== 'undefined' ? window : globalThis);
