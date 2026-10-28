/* 围棋规则测试：node tests/logic.test.cjs */
'use strict';

const assert = require('assert');
const Core = require('../logic.js');

const B = Core.BLACK;
const W = Core.WHITE;

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

function at(text) {
  const index = Core.parseCoord(text);
  assert.ok(index >= 0, '坐标写错了：' + text);
  return index;
}

function board(rows, turn) { return Core.fromAscii(rows, turn); }

function emptyRows() {
  return new Array(Core.SIZE).fill('...................');
}

function withStones(list) {
  const rows = emptyRows();
  list.forEach((item) => {
    const index = at(item[0]);
    const row = Core.rowOf(index);
    const col = Core.colOf(index);
    const line = rows[row].split('');
    line[col] = item[1];
    rows[row] = line.join('');
  });
  return rows;
}

/* ------------------------------------------------------------------ 开局 */
console.log('棋盘与坐标');

check('19×19 空盘、黑先行、贴目 7.5', () => {
  const state = Core.createState();
  assert.strictEqual(state.board.length, 361);
  assert.strictEqual(state.board.filter(Boolean).length, 0);
  assert.strictEqual(state.turn, B);
  assert.strictEqual(state.komi, 7.5);
  assert.strictEqual(Core.legalPoints(state).length, 361);
});

check('坐标 A19 / Q16 / T1 互转', () => {
  assert.strictEqual(Core.formatCoord(at('A19')), 'A19');
  assert.strictEqual(Core.formatCoord(at('T1')), 'T1');
  assert.strictEqual(at('Q16'), Core.idxOf(15, 3));
  assert.strictEqual(Core.formatCoord(Core.idxOf(15, 3)), 'Q16');
  assert.strictEqual(Core.parseCoord('I5'), -1, '字母 I 不参与编号');
  assert.strictEqual(Core.formatCoord(-1), 'pass');
});

check('空盘天元只有 4 气，边角更少', () => {
  const state = Core.createState();
  Core.play(state, at('K10'));
  assert.strictEqual(Core.libertiesOf(state.board, at('K10')).length, 4);
  Core.play(state, at('A10'));
  assert.strictEqual(Core.libertiesOf(state.board, at('A10')).length, 3);
});

/* ------------------------------------------------------------------ 气与提子 */
console.log('气、提子与禁着');

check('四面包围提掉单子', () => {
  const state = board(withStones([['J10', 'O'], ['J11', 'X'], ['K10', 'X'], ['J9', 'X']]), B);
  const move = Core.play(state, at('H10'));
  assert.ok(move, '应当可以落子');
  assert.strictEqual(move.captured.length, 1);
  assert.strictEqual(state.board[at('J10')], null);
  assert.strictEqual(state.captures.b, 1);
  assert.strictEqual(state.turn, W);
});

check('连成一块共享气，提子要吃掉整块', () => {
  const state = board(withStones([['A19', 'O'], ['B19', 'O']]), B);
  assert.strictEqual(Core.groupAt(state.board, at('A19')).stones.length, 2);
  assert.strictEqual(Core.libertiesOf(state.board, at('A19')).length, 3, '两子共享 3 口气');
  Core.play(state, at('A18'));
  Core.play(state, at('T1'));
  Core.play(state, at('B18'));
  Core.play(state, at('T2'));
  const move = Core.play(state, at('C19'));
  assert.strictEqual(move.captured.length, 2);
  assert.strictEqual(state.captures.b, 2);
});

check('禁止自杀：填进对方虎口且提不到子', () => {
  const state = board(withStones([['A2', 'O'], ['B1', 'O']]), B);
  assert.strictEqual(Core.play(state, at('A1')), null);
  assert.strictEqual(state.board[at('A1')], null);
  assert.strictEqual(Core.isLegal(state, at('A1')), false);
});

check('能提子时不算自杀', () => {
  /* 黑落 J9：自己本来没气，但一手同时提掉四个只剩一口气的白子 */
  const state = board(withStones([
    ['J10', 'O'], ['J8', 'O'], ['H9', 'O'], ['K9', 'O'],
    ['J11', 'X'], ['H10', 'X'], ['K10', 'X'],
    ['J7', 'X'], ['H8', 'X'], ['K8', 'X'],
    ['G9', 'X'], ['L9', 'X']
  ]), B);
  const move = Core.play(state, at('J9'));
  assert.ok(move, '提子优先于自杀禁着');
  assert.strictEqual(move.captured.length, 4);
  assert.strictEqual(state.captures.b, 4);
});

/* ------------------------------------------------------------------ 劫 */
console.log('劫');

const koRows = [
  '.XO................',
  'XO.O...............',
  '.XO................'
].concat(new Array(16).fill('...................'));

check('提子后形成劫，对方不能立刻回提', () => {
  const state = board(koRows, B);
  const move = Core.play(state, at('C18'));
  assert.ok(move, '黑在 C18 提子');
  assert.strictEqual(move.captured.length, 1);
  assert.strictEqual(state.ko, at('B18'), '劫点在 B18');
  assert.strictEqual(Core.isLegal(state, at('B18')), false, '白不能立即回提');
});

check('劫在别处落子后解除', () => {
  const state = board(koRows, B);
  Core.play(state, at('C18'));
  assert.ok(Core.play(state, at('T1')), '白在别处落子');
  assert.strictEqual(state.ko, -1, '劫已解除');
  assert.ok(Core.play(state, at('T19')), '黑方另下一手');
  assert.ok(Core.play(state, at('B18')), '白可以回提');
  assert.strictEqual(state.captures.w, 1);
});

check('打劫过程可悔棋', () => {
  const state = board(koRows, B);
  const before = state.board.slice();
  Core.play(state, at('C18'));
  assert.ok(Core.undoMove(state));
  assert.deepStrictEqual(state.board, before);
  assert.strictEqual(state.ko, -1);
  assert.strictEqual(state.captures.b, 0);
  assert.strictEqual(state.turn, B);
});

/* ------------------------------------------------------------------ 终局与计分 */
console.log('终局与计分');

check('连续两次虚手后数子终局', () => {
  const state = board(withStones([['D16', 'X'], ['Q4', 'O']]), B);
  Core.pass(state);
  assert.strictEqual(state.status, 'playing');
  Core.pass(state);
  assert.strictEqual(state.status, 'scored');
  assert.strictEqual(state.reason, 'scored');
  assert.ok(state.score);
  assert.strictEqual(state.score.blackStones, 1);
  assert.strictEqual(state.score.whiteStones, 1);
  assert.strictEqual(state.score.komi, 7.5);
  assert.strictEqual(state.winner, W, '子数相同，白方靠贴目获胜');
});

check('数子法：子 + 围空，白方加贴目', () => {
  /* 黑四子围住天元一点，白在别处有一子；其余空区双方共有，不计 */
  const state = board(withStones([
    ['K11', 'X'], ['J10', 'X'], ['L10', 'X'], ['K9', 'X'], ['Q4', 'O']
  ]), B);
  const result = Core.score(state);
  assert.strictEqual(result.blackStones, 4);
  assert.strictEqual(result.blackTerritory, 1, '天元被黑四面包围');
  assert.strictEqual(result.whiteTerritory, 0);
  assert.strictEqual(result.black, 5);
  assert.strictEqual(result.white, 8.5);
  assert.strictEqual(result.winner, W);
});

check('双方共有的空区不计入任何一方', () => {
  const state = board(withStones([['D16', 'X'], ['Q4', 'O']]), B);
  const result = Core.score(state);
  assert.strictEqual(result.blackTerritory, 0);
  assert.strictEqual(result.whiteTerritory, 0);
});

check('认输直接判负', () => {
  const state = Core.createState();
  const out = Core.resign(state, B);
  assert.strictEqual(out.winner, W);
  assert.strictEqual(state.status, 'resign');
  assert.strictEqual(Core.play(state, at('K10')), null, '终局后不能再落子');
});

check('虚手与落子都能逐步悔棋', () => {
  const state = Core.createState();
  Core.play(state, at('Q16'));
  Core.pass(state);
  Core.play(state, at('D4'));
  assert.strictEqual(state.history.length, 3);
  Core.undoMove(state);
  assert.strictEqual(state.last, -1, '回到虚手后的局面');
  assert.strictEqual(state.passes, 1);
  Core.undoMove(state);
  assert.strictEqual(state.passes, 0);
  assert.strictEqual(state.turn, W);
  Core.undoMove(state);
  assert.strictEqual(state.history.length, 0);
  assert.strictEqual(state.board.filter(Boolean).length, 0);
  assert.strictEqual(state.moveNumber, 0);
});

check('两次虚手判终局后可悔棋继续下', () => {
  const state = Core.createState();
  Core.play(state, at('Q16'));
  Core.pass(state);
  Core.pass(state);
  assert.strictEqual(state.status, 'scored');
  Core.undoMove(state);
  assert.strictEqual(state.status, 'playing');
  assert.ok(Core.play(state, at('D4')));
});

check('文本盘往返', () => {
  const state = Core.createState();
  Core.play(state, at('Q16'));
  Core.play(state, at('D4'));
  const text = Core.toAscii(state);
  const lines = text.split('\n');
  assert.strictEqual(lines.length, 19);
  assert.strictEqual(lines[3].charAt(15), 'X');
  const again = Core.fromAscii(lines, B);
  assert.deepStrictEqual(again.board, state.board);
});

console.log('\n' + (process.exitCode ? '存在失败用例' : '规则测试通过：' + pass + ' 项'));
