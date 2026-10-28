/* 中国象棋 · 电脑对手测试（node tests/ai.test.cjs） */
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
['logic.js', 'ai.js'].forEach((file) => {
  vm.runInContext(fs.readFileSync(path.join(ROOT, file), 'utf8'), sandbox, { filename: file });
});

const Core = sandbox.XiangqiCore;
const AI = sandbox.XiangqiAI;

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

function at(name) {
  return Core.idxOf('abcdefghi'.indexOf(name.charAt(0)), 10 - Number(name.slice(1)));
}

check('三档难度都能给出合法走法', () => {
  ['easy', 'normal', 'hard'].forEach((level) => {
    const state = Core.createState();
    const move = AI.chooseMove(state, { level });
    assert.ok(move, level + ' 没有返回走法');
    assert.ok(Core.moveAt(state, move.from, move.to), level + ' 返回了不合法的走法');
  });
});

check('困难档能吃掉白送的车', () => {
  const state = Core.fromFEN('3k5/9/9/9/9/2r6/4N4/9/9/4K4 w - - 0 1');
  const move = AI.chooseMove(state, { level: 'hard' });
  assert.strictEqual(Core.squareName(move.from), 'e4');
  assert.strictEqual(Core.squareName(move.to), 'c5');
});

check('能发现一步杀', () => {
  const state = Core.fromFEN('4k4/3R1R3/3R5/9/9/9/9/9/9/K8 w - - 0 1');
  const move = AI.chooseMove(state, { level: 'hard' });
  assert.ok(move, '没有返回走法');
  const outcome = Core.applyMove(state, Core.moveAt(state, move.from, move.to));
  assert.strictEqual(outcome.status, 'checkmate');
  assert.strictEqual(outcome.winner, Core.RED);
});

check('被将军时必须应将', () => {
  const state = Core.fromFEN('4k4/9/9/9/9/9/9/9/4R4/K8 b - - 0 1');
  assert.ok(Core.inCheck(state, Core.BLACK), '黑方应当正在被将');
  const move = AI.chooseMove(state, { level: 'normal' });
  assert.ok(move, '没有返回走法');
  Core.applyMove(state, Core.moveAt(state, move.from, move.to));
  assert.strictEqual(Core.inCheck(state, Core.BLACK), false);
});

check('不会走出送将的棋', () => {
  const state = Core.fromFEN('4k4/9/9/9/9/9/9/9/4R4/K8 b - - 0 1');
  for (let i = 0; i < 3; i += 1) {
    const move = AI.chooseMove(state, { level: 'easy' });
    assert.ok(move, '没有返回走法');
    assert.ok(Core.moveAt(state, move.from, move.to), '给了非法走法');
  }
});

check('思考时间在上限附近，不会卡死', () => {
  const state = Core.createState();
  const levels = [['easy', 900], ['normal', 1400], ['hard', 2600]];
  levels.forEach((pair) => {
    const started = Date.now();
    AI.chooseMove(state, { level: pair[0] });
    const spent = Date.now() - started;
    assert.ok(spent < pair[1], pair[0] + ' 用了 ' + spent + 'ms，超过预期');
  });
});

check('评估函数：子力多的一方分数更高', () => {
  const even = Core.createState();
  assert.strictEqual(Math.abs(AI.evaluate(even)) < 30, true, '开局应当大致均衡');
  const redUp = Core.fromFEN('4k4/9/9/9/9/9/9/9/9/3RK4 w - - 0 1');
  assert.ok(AI.evaluate(redUp) > 600, '红方多一车应领先');
});

check('同一局面连续调用也不会改坏棋局', () => {
  const state = Core.createState();
  const before = Core.toFEN(state);
  for (let i = 0; i < 4; i += 1) AI.chooseMove(state, { level: 'normal' });
  assert.strictEqual(Core.toFEN(state), before);
  assert.strictEqual(state.history.length, 0);
});

console.log('\n' + (process.exitCode ? '存在失败用例' : '电脑对手测试通过：' + pass + ' 项'));
