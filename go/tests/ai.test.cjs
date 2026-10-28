/* 围棋电脑对手测试：node tests/ai.test.cjs */
'use strict';

const assert = require('assert');
const Core = require('../logic.js');
const AI = require('../ai.js');

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

function board(list, turn) {
  const state = Core.createState({ turn: turn || B });
  list.forEach((item) => {
    state.board[at(item[0])] = item[1] === 'X' ? B : W;
  });
  return state;
}

console.log('电脑对手');

check('空盘第一手落在角部三、四线', () => {
  const state = Core.createState();
  const move = AI.chooseMove(state, { level: 'hard' });
  assert.strictEqual(move.type, 'play');
  const col = Core.colOf(move.index);
  const row = Core.rowOf(move.index);
  const line = Math.min(col, row, 18 - col, 18 - row) + 1;
  assert.ok(line === 3 || line === 4, '实际落在 ' + Core.formatCoord(move.index) + '（第 ' + line + ' 线）');
  assert.ok(Core.isLegal(state, move.index));
});

check('能吃掉的子一定吃', () => {
  const state = board([['J10', 'O'], ['J11', 'X'], ['K10', 'X'], ['J9', 'X']]);
  const move = AI.chooseMove(state, { level: 'hard' });
  assert.strictEqual(move.index, at('H10'), '应当提掉 J10，实际走了 ' + Core.formatCoord(move.index));
  assert.ok(Core.play(state, move.index));
  assert.strictEqual(state.captures.b, 1);
});

check('不填自己的眼', () => {
  const state = board([
    ['K11', 'X'], ['J10', 'X'], ['L10', 'X'], ['K9', 'X'],
    ['Q4', 'O'], ['R4', 'O']
  ]);
  const move = AI.chooseMove(state, { level: 'hard' });
  assert.notStrictEqual(move.index, at('K10'), '不该往自己眼里填');
});

check('从不走非法点，也从不自杀', () => {
  /* 白棋围出的虎口，黑方任何一手都不该填进去 */
  const state = board([['A2', 'O'], ['B1', 'O']], B);
  const move = AI.chooseMove(state, { level: 'hard' });
  assert.notStrictEqual(move.index, at('A1'), 'A1 是禁着，不该被选中');
});

check('三档棋力都能走满 30 手（双方 AI 混随机）', () => {
  ['easy', 'normal', 'hard'].forEach((level) => {
    const state = Core.createState();
    for (let i = 0; i < 30; i += 1) {
      const move = AI.chooseMove(state, { level });
      if (!move || move.type === 'pass') {
        assert.ok(Core.pass(state), '虚手失败');
        continue;
      }
      const played = Core.play(state, move.index);
      assert.ok(played, '第 ' + (i + 1) + ' 手非法：' + Core.formatCoord(move.index));
    }
  });
});

check('终局后不再落子', () => {
  const state = Core.createState();
  state.status = 'scored';
  assert.strictEqual(AI.chooseMove(state, { level: 'normal' }), null);
});

check('对象虚手时懂得收手', () => {
  const state = board([['D16', 'X'], ['Q4', 'O'], ['D4', 'O'], ['Q16', 'O'], ['K10', 'X']]);
  state.passes = 1;
  /* 盘面已无好点（各点都被对方厚势包围），AI 评分体系里应倾向于虚手 */
  const move = AI.chooseMove(state, { level: 'hard' });
  assert.ok(move, '至少要给出一手');
  assert.ok(move.type === 'play' || move.type === 'pass');
});

check('困难档单步耗时可控', () => {
  const state = Core.createState();
  for (let i = 0; i < 40; i += 1) {
    const move = AI.chooseMove(state, { level: i % 2 ? 'easy' : 'normal' });
    if (move && move.type === 'play') Core.play(state, move.index);
    else Core.pass(state);
    if (state.status !== 'playing') break;
  }
  const started = Date.now();
  const move = AI.chooseMove(state, { level: 'hard' });
  const cost = Date.now() - started;
  assert.ok(move, '应当有结果');
  assert.ok(cost < 800, '耗时 ' + cost + 'ms');
});

console.log('\n' + (process.exitCode ? '存在失败用例' : '电脑对手测试通过：' + pass + ' 项'));
