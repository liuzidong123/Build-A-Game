/* 规则回归：node tests/logic.test.cjs */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const ROOT = path.join(__dirname, '..');
const sandbox = { console, Math, Date, JSON };
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
['logic.js'].forEach((file) => {
  vm.runInContext(fs.readFileSync(path.join(ROOT, file), 'utf8'), sandbox, { filename: file });
});
const Core = sandbox.GomokuCore;
const BLACK = Core.BLACK;
const WHITE = Core.WHITE;

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

function put(board, cells, player) {
  cells.forEach(([r, c]) => { board[r][c] = player; });
  return board;
}

function playSeq(game, cells) {
  return cells.map(([r, c]) => game.play(r, c));
}

console.log('开局与落子');
check('空盘 15×15，黑棋先行', () => {
  const game = Core.createGame();
  assert.strictEqual(game.state.size, 15);
  assert.strictEqual(game.state.turn, BLACK);
  assert.strictEqual(game.state.board.length, 15);
  assert.strictEqual(game.state.board[0].length, 15);
  assert.strictEqual(Core.countStones(game.state.board), 0);
  assert.strictEqual(game.state.status, 'playing');
});

check('落子后黑白交替', () => {
  const game = Core.createGame();
  const first = game.play(7, 7);
  assert.strictEqual(first.ok, true);
  assert.strictEqual(first.player, BLACK);
  assert.strictEqual(game.state.turn, WHITE);
  const second = game.play(7, 8);
  assert.strictEqual(second.player, WHITE);
  assert.strictEqual(game.state.turn, BLACK);
});

check('越界 / 占位 / 终局后落子被拒绝', () => {
  const game = Core.createGame({ size: 5 });
  assert.strictEqual(game.play(-1, 0).reason, 'out');
  assert.strictEqual(game.play(0, 5).reason, 'out');
  game.play(0, 0);
  assert.strictEqual(game.play(0, 0).reason, 'taken');
  game.play(1, 0);
  game.play(0, 1);
  game.play(1, 1);
  game.play(0, 2);
  game.play(1, 2);
  game.play(0, 3);
  game.play(1, 3);
  const win = game.play(0, 4);
  assert.strictEqual(win.status, 'won');
  assert.strictEqual(game.play(4, 4).reason, 'over');
});

console.log('胜负判定');
check('横向五连', () => {
  const board = put(Core.createBoard(15), [[7, 3], [7, 4], [7, 5], [7, 6], [7, 7]], BLACK);
  const win = Core.checkWin(board, 7, 7);
  assert.ok(win, '未判出横向五连');
  assert.strictEqual(win.player, BLACK);
  assert.strictEqual(win.cells.length, 5);
  assert.deepStrictEqual(Array.from(win.dir), [0, 1]);
});

check('纵向五连', () => {
  const board = put(Core.createBoard(15), [[3, 9], [4, 9], [5, 9], [6, 9], [7, 9]], WHITE);
  const win = Core.checkWin(board, 5, 9);
  assert.ok(win);
  assert.strictEqual(win.player, WHITE);
  assert.deepStrictEqual(Array.from(win.dir), [1, 0]);
});

check('主对角线五连', () => {
  const board = put(Core.createBoard(15), [[2, 2], [3, 3], [4, 4], [5, 5], [6, 6]], BLACK);
  const win = Core.checkWin(board, 4, 4);
  assert.ok(win);
  assert.deepStrictEqual(Array.from(win.dir), [1, 1]);
});

check('反对角线五连', () => {
  const board = put(Core.createBoard(15), [[2, 8], [3, 7], [4, 6], [5, 5], [6, 4]], WHITE);
  const win = Core.checkWin(board, 5, 5);
  assert.ok(win);
  assert.deepStrictEqual(Array.from(win.dir), [1, -1]);
});

check('六连长连同样算胜（自由规则）', () => {
  const board = put(Core.createBoard(15),
    [[6, 2], [6, 3], [6, 4], [6, 5], [6, 6], [6, 7]], BLACK);
  const win = Core.checkWin(board, 6, 5);
  assert.ok(win);
  assert.strictEqual(win.cells.length, 6);
});

check('四连不算胜、空点不算胜', () => {
  const board = put(Core.createBoard(15), [[7, 3], [7, 4], [7, 5], [7, 6]], BLACK);
  assert.strictEqual(Core.checkWin(board, 7, 6), null);
  assert.strictEqual(Core.checkWin(board, 0, 0), null);
  assert.strictEqual(Core.checkWin(board, -1, 0), null);
});

check('被对手隔断的棋子不连线', () => {
  const board = Core.createBoard(15);
  put(board, [[7, 3], [7, 4]], BLACK);
  put(board, [[7, 5]], WHITE);
  put(board, [[7, 6], [7, 7]], BLACK);
  assert.strictEqual(Core.checkWin(board, 7, 7), null);
});

check('棋盘填满判和棋', () => {
  const game = Core.createGame({ size: 4 });
  for (let r = 0; r < 4; r += 1) {
    for (let c = 0; c < 4; c += 1) game.play(r, c);
  }
  assert.strictEqual(game.state.status, 'draw');
  assert.strictEqual(game.state.winner, Core.EMPTY);
  assert.strictEqual(Core.isFull(game.state.board), true);
});

console.log('悔棋与重置');
check('悔棋恢复棋盘与行棋方', () => {
  const game = Core.createGame();
  game.play(7, 7);
  game.play(7, 8);
  game.play(8, 8);
  assert.strictEqual(game.state.moves.length, 3);
  const removed = game.undo(2);
  assert.strictEqual(removed, 2);
  assert.strictEqual(game.state.moves.length, 1);
  assert.strictEqual(game.state.board[7][8], Core.EMPTY);
  assert.strictEqual(game.state.board[8][8], Core.EMPTY);
  assert.strictEqual(game.state.board[7][7], BLACK);
  assert.strictEqual(game.state.turn, WHITE);
  assert.strictEqual(game.last().r, 7);
});

check('悔棋可撤销胜利状态', () => {
  const game = Core.createGame({ size: 5 });
  const seq = [[0, 0], [1, 0], [0, 1], [1, 1], [0, 2], [1, 2], [0, 3], [1, 3], [0, 4]];
  playSeq(game, seq);
  assert.strictEqual(game.state.status, 'won');
  game.undo(1);
  assert.strictEqual(game.state.status, 'playing');
  assert.strictEqual(game.state.winner, Core.EMPTY);
  assert.deepStrictEqual(game.state.winLine, null);
  assert.strictEqual(game.state.turn, BLACK);
});

check('重置清空所有状态', () => {
  const game = Core.createGame();
  game.play(7, 7);
  game.play(7, 8);
  game.reset();
  assert.strictEqual(game.state.moves.length, 0);
  assert.strictEqual(Core.countStones(game.state.board), 0);
  assert.strictEqual(game.state.turn, BLACK);
  assert.strictEqual(game.state.status, 'playing');
});

check('canUndo 与 last 边界', () => {
  const game = Core.createGame();
  assert.strictEqual(game.canUndo(), false);
  assert.strictEqual(game.last(), null);
  game.play(3, 3);
  assert.strictEqual(game.canUndo(), true);
  assert.deepStrictEqual({ r: game.last().r, c: game.last().c }, { r: 3, c: 3 });
});

console.log('\n' + (process.exitCode ? '存在失败用例' : '全部通过：' + pass + ' 项'));
if (process.exitCode) process.exit(process.exitCode);
