/* 电脑棋力回归：node tests/ai.test.cjs */
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
['logic.js', 'ai.js'].forEach((file) => {
  vm.runInContext(fs.readFileSync(path.join(ROOT, file), 'utf8'), sandbox, { filename: file });
});

const Core = sandbox.GomokuCore;
const AI = sandbox.GomokuAI;
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

function boardWith(cells, player) {
  const board = Core.createBoard(15);
  cells.forEach(([r, c]) => { board[r][c] = player; });
  return board;
}

function snapshot(board) {
  return board.map((row) => row.slice());
}

function wouldWin(board, r, c, player) {
  board[r][c] = player;
  const win = Core.checkWin(board, r, c);
  board[r][c] = 0;
  return !!win;
}

console.log('开局与基本策略');
check('空盘落天元', () => {
  const board = Core.createBoard(15);
  const move = AI.pickMove(board, 15, BLACK, { level: 'normal' });
  assert.deepStrictEqual({ r: move.r, c: move.c }, { r: 7, c: 7 });
});

check('己方有四连时直接收官', () => {
  const board = boardWith([[7, 3], [7, 4], [7, 5], [7, 6]], BLACK);
  boardWith([[0, 0], [0, 2], [0, 4]], WHITE).forEach((row, r) => {
    row.forEach((cell, c) => { if (cell) board[r][c] = cell; });
  });
  const move = AI.pickMove(board, 15, BLACK, { level: 'normal' });
  assert.ok(wouldWin(board, move.r, move.c, BLACK),
    `电脑没有收官，落在 (${move.r}, ${move.c})`);
});

check('简单难度同样会抓五连', () => {
  const board = boardWith([[6, 4], [6, 5], [6, 6], [6, 7]], BLACK);
  const move = AI.pickMove(board, 15, BLACK, { level: 'easy', rng: () => 0 });
  assert.ok(wouldWin(board, move.r, move.c, BLACK));
});

check('对手四连时必须封堵', () => {
  const board = boardWith([[7, 4], [7, 5], [7, 6], [7, 7]], WHITE);
  boardWith([[5, 5], [5, 6]], BLACK).forEach((row, r) => {
    row.forEach((cell, c) => { if (cell) board[r][c] = cell; });
  });
  const move = AI.pickMove(board, 15, BLACK, { level: 'normal' });
  assert.ok((move.r === 7 && move.c === 3) || (move.r === 7 && move.c === 8),
    `没有封堵四连，落在 (${move.r}, ${move.c})`);
});

check('困难难度会封堵活三', () => {
  const board = boardWith([[7, 5], [7, 6], [7, 7]], WHITE);
  boardWith([[5, 5], [6, 6]], BLACK).forEach((row, r) => {
    row.forEach((cell, c) => { if (cell) board[r][c] = cell; });
  });
  const move = AI.pickMove(board, 15, BLACK, { level: 'hard' });
  const near = Math.abs(move.r - 7) <= 1 && move.c >= 3 && move.c <= 9;
  assert.ok(near, `没有限制活三，落在 (${move.r}, ${move.c})`);
});

console.log('评分与稳定性');
check('活三评分高于活二', () => {
  const board = boardWith([[7, 5], [7, 6]], BLACK);
  const openThree = AI.scorePoint(board, 15, 7, 7, BLACK);
  const two = AI.scorePoint(board, 15, 7, 7, WHITE) + AI.scorePoint(board, 15, 5, 5, BLACK);
  assert.ok(openThree > two, `活三 ${openThree} 未明显高于对比值 ${two}`);
});

check('评分函数不会污染棋盘', () => {
  const board = boardWith([[7, 7], [8, 8]], BLACK);
  const before = snapshot(board);
  AI.scorePoint(board, 15, 7, 8, WHITE);
  AI.pickMove(board, 15, BLACK, { level: 'hard' });
  assert.deepStrictEqual(board, before);
});

check('同一局面结果可复现且落在空点', () => {
  const board = boardWith([[7, 7], [7, 8], [8, 8], [6, 6]], BLACK);
  board[5][5] = WHITE;
  const a = AI.pickMove(board, 15, WHITE, { level: 'normal' });
  const b = AI.pickMove(board, 15, WHITE, { level: 'normal' });
  assert.deepStrictEqual({ r: a.r, c: a.c }, { r: b.r, c: b.c });
  assert.strictEqual(board[a.r][a.c], Core.EMPTY);
});

check('三档难度都只落在已有棋子 2 格内', () => {
  const board = boardWith([[7, 7], [8, 8], [6, 7]], BLACK);
  board[7][8] = WHITE;
  AI.LEVELS.forEach((level) => {
    const move = AI.pickMove(board, 15, WHITE, { level, rng: () => 0.5 });
    const near = Math.max(Math.abs(move.r - 7), Math.abs(move.c - 7)) <= 3;
    assert.ok(near, `${level} 落子过于分散：( ${move.r}, ${move.c} )`);
  });
});

check('候选点全部落在空位', () => {
  const board = boardWith([[7, 7], [7, 8], [8, 8], [6, 7], [9, 9]], BLACK);
  const list = AI.candidates(board, 15, 2);
  assert.ok(list.length > 0);
  list.forEach((pt) => assert.strictEqual(board[pt.r][pt.c], Core.EMPTY));
  assert.strictEqual(new Set(list.map((pt) => pt.r + ':' + pt.c)).size, list.length);
});

check('AI 自对弈 60 手全部合法', () => {
  const game = Core.createGame();
  for (let i = 0; i < 60 && game.state.status === 'playing'; i += 1) {
    const level = i % 2 === 0 ? 'normal' : 'easy';
    const move = AI.pickMove(game.state.board, 15, game.state.turn, { level, rng: () => 0.42 });
    const before = game.state.moves.length;
    const result = game.play(move.r, move.c);
    assert.strictEqual(result.ok, true, `第 ${i + 1} 手非法：(${move.r}, ${move.c})`);
    assert.strictEqual(game.state.moves.length, before + 1);
  }
  assert.ok(game.state.moves.length >= 20, '自对弈提前中断');
});

console.log('\n' + (process.exitCode ? '存在失败用例' : '全部通过：' + pass + ' 项'));
if (process.exitCode) process.exit(process.exitCode);
