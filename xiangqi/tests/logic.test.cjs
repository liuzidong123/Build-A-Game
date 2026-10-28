/* 中国象棋 · 规则测试（node tests/logic.test.cjs） */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const ROOT = path.join(__dirname, '..');
const sandbox = {};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'logic.js'), 'utf8'), sandbox, { filename: 'logic.js' });

const Core = sandbox.XiangqiCore;
const RED = Core.RED;
const BLACK = Core.BLACK;

let pass = 0;
function check(name, fn) {
  try {
    fn();
    pass += 1;
    console.log('  PASS  ' + name);
  } catch (err) {
    console.log('  FAIL  ' + name + '\n        ' + err.message);
    process.exitCode = 1;
  }
}

/* 'a1' 是红方左下角 */
function at(name) {
  return Core.idxOf('abcdefghi'.indexOf(name.charAt(0)), 10 - Number(name.slice(1)));
}
function fenOf(rows, turn) {
  return rows.join('/') + ' ' + (turn || 'w') + ' - - 0 1';
}
function boardAfter(rows, turn) {
  return Core.fromFEN(fenOf(rows, turn));
}
function names(list) {
  return list.map((i) => Core.squareName(i)).sort().join(' ');
}
function expectTargets(state, square, expected) {
  assert.strictEqual(names(Core.targetsFrom(state, at(square))), expected.slice().sort().join(' '));
}
function emptyRows() {
  return ['9', '9', '9', '9', '9', '9', '9', '9', '9', '9'];
}

console.log('棋盘与走法');

check('初始局面：红先、双方各 16 子、红方在下', () => {
  const state = Core.createState();
  assert.strictEqual(state.turn, RED);
  assert.strictEqual(state.board.length, 90);
  assert.strictEqual(state.board.filter(Boolean).length, 32);
  assert.strictEqual(state.board[at('a1')], 'rR');
  assert.strictEqual(state.board[at('e1')], 'rK');
  assert.strictEqual(state.board[at('e10')], 'bK');
  assert.strictEqual(state.board[at('b3')], 'rC');
  assert.strictEqual(state.board[at('a4')], 'rP');
  assert.strictEqual(state.board[at('e7')], 'bP');
  const count = {};
  state.board.forEach((p) => { if (p) count[p] = (count[p] || 0) + 1; });
  assert.strictEqual(count.rP, 5);
  assert.strictEqual(count.bC, 2);
  assert.strictEqual(count.rK, 1);
  assert.strictEqual(count.bK, 1);
});

check('初始局面 44 步合法走法，perft 44 / 1920', () => {
  const state = Core.createState();
  assert.strictEqual(Core.legalMoves(state).length, 44);
  assert.strictEqual(Core.perft(state, 1), 44);
  assert.strictEqual(Core.perft(state, 2), 1920);
});

check('FEN 往返一致', () => {
  const state = Core.createState();
  const fen = Core.toFEN(state);
  assert.strictEqual(fen.split(' ')[0], 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR');
  assert.strictEqual(Core.toFEN(Core.fromFEN(fen)), fen);
});

check('车：直线任意格，遇子即停', () => {
  const state = boardAfter(['3k5', '9', '9', '9', '9', '9', '9', '9', '9', '3RK4']);
  expectTargets(state, 'd1', ['d2', 'd3', 'd4', 'd5', 'd6', 'd7', 'd8', 'd9', 'd10', 'c1', 'b1', 'a1']);
});

check('炮：不吃子同车，吃子必须隔一个炮架', () => {
  const rows = emptyRows();
  rows[0] = '2k6';
  rows[2] = '3p5';
  rows[6] = '3P5';
  rows[9] = '3C1K3';
  const state = boardAfter(rows);
  expectTargets(state, 'd1', ['d2', 'd3', 'd8', 'c1', 'b1', 'a1', 'e1']);
});

check('炮：越过一个炮架后只能吃第一个子，不能吃两个炮架外的', () => {
  const rows = emptyRows();
  rows[0] = '2k6';
  rows[3] = '3p5';
  rows[4] = '3p5';
  rows[6] = '3P5';
  rows[9] = '3C1K3';
  const state = boardAfter(rows);
  expectTargets(state, 'd1', ['d2', 'd3', 'd6', 'c1', 'b1', 'a1', 'e1']);
});

check('马：走日字，蹩马腿的方向不能走', () => {
  const rows = emptyRows();
  rows[0] = '4k4';
  rows[6] = '4P4';
  rows[7] = '4N4';
  rows[9] = '4K4';
  const state = boardAfter(rows);
  expectTargets(state, 'e3', ['c4', 'g4', 'd1', 'f1', 'c2', 'g2']);
});

check('象：走田字，塞象眼不能走', () => {
  const rows = emptyRows();
  rows[0] = '3k5';
  rows[8] = '3p5';
  rows[9] = '2B1K4';
  const state = boardAfter(rows);
  expectTargets(state, 'c1', ['a3']);
});

check('象：不能过河', () => {
  const rows = emptyRows();
  rows[0] = '3k5';
  rows[5] = '2B6';
  rows[9] = '4K4';
  const state = boardAfter(rows);
  expectTargets(state, 'c5', ['a3', 'e3']);
});

check('士：九宫内斜走一格', () => {
  const rows = emptyRows();
  rows[0] = '3k5';
  rows[8] = '4A4';
  rows[9] = 'K8';
  const state = boardAfter(rows);
  expectTargets(state, 'e2', ['d1', 'd3', 'f1', 'f3']);

  const rows2 = emptyRows();
  rows2[0] = '3k5';
  rows2[9] = 'K2A5';
  const second = boardAfter(rows2);
  expectTargets(second, 'd1', ['e2']);
});

check('兵：过河前只能向前，过河后可横走，不能后退', () => {
  const rows = emptyRows();
  rows[0] = '3k5';
  rows[6] = 'P8';
  rows[9] = '4K4';
  expectTargets(boardAfter(rows), 'a4', ['a5']);

  const rows2 = emptyRows();
  rows2[0] = '3k5';
  rows2[4] = 'P8';
  rows2[9] = '4K4';
  expectTargets(boardAfter(rows2), 'a6', ['a7', 'b6']);
});

check('将帅：只能在九宫内走一格', () => {
  const rows = emptyRows();
  rows[0] = '4k4';
  rows[9] = 'K8';
  const state = boardAfter(rows);
  assert.strictEqual(names(Core.targetsFrom(state, at('e10'), BLACK)), 'd10 e9 f10');
});

check('将帅不能照面：挡在中间的棋子不能走开', () => {
  const rows = emptyRows();
  rows[0] = '4k4';
  rows[5] = '4R4';
  rows[9] = '4K4';
  const state = boardAfter(rows);
  assert.ok(Core.kingsFacing(boardAfter(['4k4', '9', '9', '9', '9', '9', '9', '9', '9', '4K4'])));
  expectTargets(state, 'e5', ['e2', 'e3', 'e4', 'e6', 'e7', 'e8', 'e9', 'e10']);
});

console.log('胜负判定');

check('将死：黑将无路可逃', () => {
  const state = boardAfter(['4k4', '9', '9', '9', '4R4', '9', '9', '3R1R3', '4R4', 'K8'], 'b');
  assert.strictEqual(state.status, 'checkmate');
  assert.strictEqual(state.reason, 'checkmate');
  assert.strictEqual(state.winner, RED);
  assert.strictEqual(Core.legalMoves(state).length, 0);
  assert.ok(Core.inCheck(state, BLACK));
});

check('困毙：无子可走也算输', () => {
  const state = boardAfter(['4k4', '3P1P3', '4P4', '9', '9', '9', '9', '9', '9', 'K8'], 'b');
  assert.strictEqual(state.reason, 'stalemate');
  assert.strictEqual(state.winner, RED);
  assert.strictEqual(Core.inCheck(state, BLACK), false);
  assert.strictEqual(Core.legalMoves(state).length, 0);
});

check('重复局面三次判和', () => {
  const state = boardAfter(['4k3r', '9', '9', '9', '9', '9', '9', '9', '9', 'R2K5']);
  const path = [['a1', 'a2'], ['i10', 'i9'], ['a2', 'a1'], ['i9', 'i10'],
    ['a1', 'a2'], ['i10', 'i9'], ['a2', 'a1'], ['i9', 'i10']];
  path.forEach((pair) => {
    const move = Core.moveAt(state, at(pair[0]), at(pair[1]));
    assert.ok(move, pair.join('-') + ' 应当可走');
    Core.applyMove(state, move);
  });
  assert.strictEqual(state.status, 'draw');
  assert.strictEqual(state.reason, 'repetition');
});

check('长时间无吃子判和', () => {
  const state = boardAfter(['4k4', '9', '9', '9', '9', '9', '9', '9', '9', '3RK4']);
  state.halfmove = 120;
  Core.refreshStatus(state);
  assert.strictEqual(state.status, 'draw');
  assert.strictEqual(state.reason, 'noCapture');
});

console.log('落子、记谱与悔棋');

check('记谱形如「炮 b3-b4」，吃子用 x', () => {
  assert.strictEqual(Core.notation({ piece: 'rC', from: at('b3'), to: at('b4'), captured: null }), '炮 b3-b4');
  assert.strictEqual(Core.notation({ piece: 'rR', from: at('a1'), to: at('a4'), captured: 'bP' }), '车 a1xa4');
  assert.strictEqual(Core.notation({ piece: 'bP', from: at('e7'), to: at('e6'), captured: null }), '卒 e7-e6');
});

check('applyMove 记录历史并在将军时加后缀', () => {
  const state = Core.fromFEN('4k4/9/9/9/4R4/9/9/9/9/3K5 w - - 0 1');
  const move = Core.moveAt(state, at('e6'), at('e10'));
  assert.ok(move, '车应当可以吃到 e10');
  const applied = Core.applyMove(state, move);
  assert.strictEqual(state.history.length, 1);
  assert.strictEqual(applied.san, '车 e6xe10#');
  assert.strictEqual(applied.status, 'checkmate');
  assert.strictEqual(state.turn, BLACK);
});

check('悔棋逐步复原到开局', () => {
  const state = Core.createState();
  const before = Core.toFEN(state);
  const seq = [['b3', 'b4'], ['b8', 'b7'], ['h3', 'h4'], ['h8', 'h7']];
  seq.forEach((pair) => {
    const move = Core.moveAt(state, at(pair[0]), at(pair[1]));
    assert.ok(move, pair.join('-') + ' 应当可走');
    Core.applyMove(state, move);
  });
  assert.strictEqual(state.history.length, 4);
  for (let i = 0; i < 4; i += 1) Core.undoMove(state);
  assert.strictEqual(state.history.length, 0);
  assert.strictEqual(Core.toFEN(state), before);
  assert.strictEqual(state.turn, RED);
});

console.log('\n' + (process.exitCode ? '存在失败用例' : '规则测试通过：' + pass + ' 项'));
