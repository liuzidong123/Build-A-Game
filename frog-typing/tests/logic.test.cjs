/* 规则回归：node tests/logic.test.cjs */
'use strict';

const path = require('path');
const assert = require('assert');
const Logic = require(path.join(__dirname, '..', 'logic.js'));

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

function rig(state, rowIndex, defs) {
  state.lanes[rowIndex] = defs.map((def) => ({
    key: def.key,
    type: def.type || 'leaf',
    item: def.item || null,
    taken: false
  }));
}

function newGame(difficulty, seed) {
  const state = Logic.createGame({ difficulty: difficulty || 'easy', seed: seed || 11 });
  Logic.start(state);
  return state;
}

function fillAll(state, key) {
  state.lanes.forEach((_, index) => rig(state, index, [{ key: key }]));
}

console.log('关卡生成');
check('每行荷叶数等于难度设定，字母不重复', () => {
  const state = Logic.createGame({ difficulty: 'normal', seed: 7 });
  assert.strictEqual(state.lanes.length, state.rows);
  state.lanes.forEach((row) => {
    assert.strictEqual(row.length, state.choices);
    const keys = row.map((leaf) => leaf.key);
    assert.strictEqual(new Set(keys).size, keys.length, '同排出现重复字母：' + keys);
    keys.forEach((key) => {
      if (key !== ' ') assert.ok(state.keyset.indexOf(key) !== -1, '字母越界：' + key);
    });
  });
});

check('同一种子生成完全一致的河面', () => {
  const a = Logic.createGame({ difficulty: 'hard', seed: 42 });
  const b = Logic.createGame({ difficulty: 'hard', seed: 42 });
  assert.deepStrictEqual(a.lanes, b.lanes);
  const c = Logic.createGame({ difficulty: 'hard', seed: 43 });
  assert.notDeepStrictEqual(a.lanes, c.lanes);
});

check('三档难度的宽度与时限递增', () => {
  const easy = Logic.createGame({ difficulty: 'easy' });
  const normal = Logic.createGame({ difficulty: 'normal' });
  const hard = Logic.createGame({ difficulty: 'hard' });
  assert.ok(easy.rows < normal.rows && normal.rows < hard.rows);
  assert.ok(easy.choices < hard.choices);
  assert.ok(easy.timeLimit > hard.timeLimit);
});

console.log('打字判定');
check('敲对字母前进一排并累计连击', () => {
  const state = newGame('normal', 21);
  const key = Logic.activeRow(state)[0].key;
  const res = Logic.press(state, key);
  assert.strictEqual(res.kind, 'jump');
  assert.strictEqual(state.row, 1);
  assert.strictEqual(state.combo, 1);
  assert.strictEqual(state.hits, 1);
  assert.ok(state.score > 0);
});

check('敲错字母清零连击并扣时间', () => {
  const state = newGame('normal', 22);
  const before = state.timeLeft;
  const res = Logic.press(state, '1');
  assert.strictEqual(res.kind, 'miss');
  assert.strictEqual(state.combo, 0);
  assert.strictEqual(state.misses, 1);
  assert.ok(state.timeLeft < before);
});

check('大小写与空格都能正确识别', () => {
  const state = newGame('easy', 23);
  rig(state, 0, [{ key: 'k' }]);
  assert.strictEqual(Logic.normalizeKey('K'), 'k');
  assert.strictEqual(Logic.press(state, 'K').kind, 'jump');
  rig(state, 1, [{ key: ' ', type: 'space' }]);
  assert.strictEqual(Logic.press(state, 'Spacebar').kind, 'jump');
});

check('金币荷叶加分并计数', () => {
  const state = newGame('easy', 24);
  rig(state, 0, [{ key: 'q', type: 'coin' }]);
  Logic.press(state, 'q');
  assert.strictEqual(state.coins, 1);
  assert.ok(state.score >= 60, '金币未加分：' + state.score);
});

check('SPACE 大荷叶一次跳两排', () => {
  const state = newGame('easy', 25);
  rig(state, 0, [{ key: ' ', type: 'space' }]);
  rig(state, 1, [{ key: 'x' }]);
  const res = Logic.press(state, ' ');
  assert.strictEqual(res.kind, 'jump');
  assert.strictEqual(state.row, 2);
  assert.strictEqual(state.boost > 0, true);
});

check('道具按类型生效', () => {
  const clock = newGame('easy', 26);
  clock.timeLeft = 20;
  rig(clock, 0, [{ key: 'c', type: 'item', item: 'clock' }]);
  Logic.press(clock, 'c');
  assert.ok(clock.timeLeft > 20);

  const shield = newGame('easy', 27);
  rig(shield, 0, [{ key: 's', type: 'item', item: 'shield' }]);
  Logic.press(shield, 's');
  assert.strictEqual(shield.shield, 1);
  const before = shield.timeLeft;
  const guarded = Logic.press(shield, '1');
  assert.strictEqual(guarded.kind, 'guarded');
  assert.strictEqual(shield.timeLeft, before);
  assert.strictEqual(shield.shield, 0);

  const slow = newGame('easy', 28);
  rig(slow, 0, [{ key: 'w', type: 'item', item: 'slow' }]);
  Logic.press(slow, 'w');
  assert.strictEqual(slow.slow, 8);
  const t0 = slow.timeLeft;
  Logic.tick(slow, 0.5);
  assert.ok(Math.abs(t0 - slow.timeLeft - 0.3) < 0.001, '缓流未生效：' + (t0 - slow.timeLeft));
});

console.log('生命与关卡');
check('时间耗尽扣一条命并补时', () => {
  const state = newGame('easy', 31);
  state.timeLeft = 0.2;
  state.penalty = 1;
  const res = Logic.press(state, '1');
  assert.strictEqual(res.kind, 'drown');
  assert.strictEqual(state.lives, 2);
  assert.ok(state.timeLeft > 1);
  assert.strictEqual(state.status, 'playing');
});

check('三次落水结束本局', () => {
  const state = newGame('easy', 32);
  for (let i = 0; i < 3; i += 1) {
    state.timeLeft = 0.1;
    Logic.press(state, '1');
  }
  assert.strictEqual(state.lives, 0);
  assert.strictEqual(state.status, 'lost');
  assert.strictEqual(state.finishReason, 'timeout');
});

check('抵达对岸判定通关并结算奖励', () => {
  const state = newGame('easy', 33);
  fillAll(state, 'a');
  let res = null;
  for (let i = 0; i < state.rows; i += 1) res = Logic.press(state, 'a');
  assert.strictEqual(res.kind, 'win');
  assert.strictEqual(state.status, 'won');
  assert.ok(res.bonus > 0);
  assert.ok(state.achievements.indexOf('perfect') !== -1, '零失误未解锁成就');
  assert.ok(state.achievements.indexOf('clear_1') !== -1);
  assert.ok(state.achievements.indexOf('speed_60') !== -1);
});

check('失误后不再算零失误通关', () => {
  const state = newGame('easy', 34);
  fillAll(state, 'a');
  Logic.press(state, '1');
  for (let i = 0; i < state.rows; i += 1) Logic.press(state, 'a');
  assert.strictEqual(state.status, 'won');
  assert.strictEqual(state.achievements.indexOf('perfect'), -1);
});

check('通关后进入下一关：河面更宽、状态复位', () => {
  const state = newGame('easy', 35);
  fillAll(state, 'a');
  for (let i = 0; i < state.rows; i += 1) Logic.press(state, 'a');
  const rowsBefore = state.rows;
  Logic.nextLevel(state);
  assert.strictEqual(state.level, 2);
  assert.ok(state.rows > rowsBefore);
  assert.strictEqual(state.row, 0);
  assert.strictEqual(state.status, 'playing');
  assert.strictEqual(state.timeLeft, state.timeLimit);
  assert.strictEqual(state.lanes.length, state.rows);
  assert.ok(state.lives >= 1);
});

console.log('辅助操作与成就');
check('左右方向键循环切换目标', () => {
  const state = newGame('normal', 41);
  assert.strictEqual(state.laneIndex, 0);
  Logic.selectLane(state, 1);
  assert.strictEqual(state.laneIndex, 1);
  Logic.selectLane(state, 1);
  assert.strictEqual(state.laneIndex, 0);
  Logic.selectLane(state, -1);
  assert.strictEqual(state.laneIndex, state.choices - 1);
});

check('向上走一步：扣时间、不给连击', () => {
  const state = newGame('easy', 42);
  const time = state.timeLeft;
  const res = Logic.walkUp(state);
  assert.strictEqual(res.kind, 'walk');
  assert.strictEqual(state.row, 1);
  assert.strictEqual(state.combo, 0);
  assert.strictEqual(state.walks, 1);
  assert.ok(state.timeLeft < time - 1);
});

check('连击与金币成就不重复累计', () => {
  const state = newGame('hard', 43);
  fillAll(state, 'a');
  for (let i = 0; i < 15; i += 1) Logic.press(state, 'a');
  assert.strictEqual(state.bestCombo, 15);
  const count = state.achievements.filter((id) => id === 'combo_15').length;
  assert.strictEqual(count, 1);
});

check('单局收集 10 金币解锁成就', () => {
  const state = newGame('hard', 44);
  state.lanes.forEach((_, index) => rig(state, index, [{ key: 'a', type: 'coin' }]));
  for (let i = 0; i < 10; i += 1) Logic.press(state, 'a');
  assert.strictEqual(state.coins, 10);
  assert.ok(state.achievements.indexOf('coin_10') !== -1);
});

check('事件队列可被消费且不清空棋盘状态', () => {
  const state = newGame('easy', 45);
  Logic.press(state, Logic.activeRow(state)[0].key);
  const events = Logic.drainEvents(state);
  assert.ok(events.some((ev) => ev.type === 'jump'));
  assert.strictEqual(Logic.drainEvents(state).length, 0);
  assert.strictEqual(state.row, 1);
});

check('暂停时不再消耗时间', () => {
  const state = newGame('easy', 46);
  Logic.pause(state);
  const before = state.timeLeft;
  Logic.tick(state, 2);
  assert.strictEqual(state.timeLeft, before);
  Logic.resume(state);
  Logic.tick(state, 1);
  assert.ok(state.timeLeft < before);
});

console.log('\n' + (process.exitCode ? '存在失败用例' : '全部通过：' + pass + ' 项'));
if (process.exitCode) process.exit(process.exitCode);
