/* 规则回归：node tests/logic.test.cjs */
'use strict';

const assert = require('assert');
const path = require('path');
const Logic = require(path.join(__dirname, '..', 'logic.js'));

const DT = 1 / 60;
const IDLE = { left: false, right: false, up: false, light: false, heavy: false, block: false };
const press = (extra) => Object.assign({}, IDLE, extra || {});

let pass = 0;
let failed = 0;

function check(name, fn) {
  try {
    fn();
    pass += 1;
    console.log('  PASS  ' + name);
  } catch (err) {
    failed += 1;
    process.exitCode = 1;
    console.log('  FAIL  ' + name + '\n        ' + err.message);
  }
}

function run(match, seconds, in0, in1) {
  const frames = Math.round(seconds / DT);
  for (let i = 0; i < frames; i += 1) {
    Logic.update(match, DT, typeof in0 === 'function' ? in0(i) : in0, typeof in1 === 'function' ? in1(i) : in1);
  }
  return match;
}

function face(match, gap) {
  const a = match.fighters[0];
  const b = match.fighters[1];
  a.x = 640 - gap / 2;
  b.x = 640 + gap / 2;
  a.y = b.y = Logic.CONFIG.groundY;
  a.facing = 1;
  b.facing = -1;
}

console.log('对局初始化');

check('初始双方满血、计时 60 秒、比分 0:0', () => {
  const m = Logic.createMatch({ seed: 7 });
  assert.strictEqual(m.fighters[0].hp, 100);
  assert.strictEqual(m.fighters[1].hp, 100);
  assert.strictEqual(m.timer, 60);
  assert.deepStrictEqual(m.wins, [0, 0]);
  assert.strictEqual(m.phase, 'fight');
  assert.strictEqual(m.fighters[0].facing, 1);
  assert.strictEqual(m.fighters[1].facing, -1);
});

check('startRound 会重置血量并广播回合开始事件', () => {
  const m = Logic.createMatch({ seed: 7 });
  m.fighters[0].hp = 20;
  Logic.startRound(m);
  assert.strictEqual(m.fighters[0].hp, 100);
  const events = Logic.drainEvents(m);
  assert.strictEqual(events.length, 1);
  assert.strictEqual(events[0].type, 'roundStart');
  assert.strictEqual(events[0].round, 1);
});

console.log('移动与跳跃');

check('按右移动到对手方向并受墙体钳制', () => {
  const m = Logic.createMatch({ seed: 3 });
  const startX = m.fighters[0].x;
  run(m, 0.4, press({ right: true }), IDLE);
  assert.ok(m.fighters[0].x > startX + 50, '没有前进：' + m.fighters[0].x);

  m.fighters[0].x = Logic.CONFIG.wall + 4;
  m.fighters[1].x = 1100;
  run(m, 0.5, press({ left: true }), IDLE);
  assert.ok(m.fighters[0].x >= Logic.CONFIG.wall, '越过左边界：' + m.fighters[0].x);
});

check('跳跃离地后能落回地面', () => {
  const m = Logic.createMatch({ seed: 3 });
  const f = m.fighters[0];
  Logic.update(m, DT, press({ up: true }), IDLE);
  assert.strictEqual(f.onGround, false);
  assert.ok(f.y < Logic.CONFIG.groundY);
  run(m, 1.4, IDLE, IDLE);
  assert.strictEqual(f.onGround, true);
  assert.strictEqual(f.y, Logic.CONFIG.groundY);
});

check('两人不会重叠（自动分开）', () => {
  const m = Logic.createMatch({ seed: 3 });
  m.fighters[0].x = 600;
  m.fighters[1].x = 610;
  run(m, 0.1, IDLE, IDLE);
  const gap = Math.abs(m.fighters[1].x - m.fighters[0].x);
  assert.ok(gap > 60, '仍然重叠：' + gap);
});

console.log('攻击判定');

check('近距离轻拳命中扣 7 血', () => {
  const m = Logic.createMatch({ seed: 11 });
  face(m, 150);
  Logic.update(m, DT, press({ light: true }), IDLE);
  run(m, 0.4, IDLE, IDLE);
  assert.strictEqual(m.fighters[1].hp, 93, '伤害异常：' + m.fighters[1].hp);
  assert.strictEqual(m.fighters[0].hits, 1);
});

check('一次挥拳只结算一次伤害', () => {
  const m = Logic.createMatch({ seed: 11 });
  face(m, 150);
  Logic.update(m, DT, press({ light: true }), IDLE);
  run(m, 1.2, IDLE, IDLE);
  assert.strictEqual(m.fighters[1].hp, 93, '重复结算：' + m.fighters[1].hp);
});

check('距离过远挥空不掉血', () => {
  const m = Logic.createMatch({ seed: 11 });
  face(m, 420);
  Logic.update(m, DT, press({ light: true }), IDLE);
  run(m, 0.5, IDLE, IDLE);
  assert.strictEqual(m.fighters[1].hp, 100);
  assert.strictEqual(m.fighters[0].hits, 0);
});

check('重腿伤害高于轻拳', () => {
  const light = Logic.createMatch({ seed: 5 });
  face(light, 140);
  Logic.update(light, DT, press({ light: true }), IDLE);
  run(light, 0.5, IDLE, IDLE);

  const heavy = Logic.createMatch({ seed: 5 });
  face(heavy, 140);
  Logic.update(heavy, DT, press({ heavy: true }), IDLE);
  run(heavy, 0.7, IDLE, IDLE);

  assert.ok(heavy.fighters[1].hp < light.fighters[1].hp, '重腿没有更痛');
});

check('防御把伤害压到 15% 并记录格挡', () => {
  const m = Logic.createMatch({ seed: 11 });
  face(m, 150);
  run(m, 0.2, IDLE, press({ block: true }));
  assert.strictEqual(m.fighters[1].state, 'block');
  Logic.update(m, DT, press({ light: true }), press({ block: true }));
  run(m, 0.4, IDLE, press({ block: true }));
  assert.strictEqual(m.fighters[1].hp, 99, '格挡伤害异常：' + m.fighters[1].hp);
  assert.strictEqual(m.fighters[1].blockCount, 1);
});

check('受击硬直期间无法出招', () => {
  const m = Logic.createMatch({ seed: 11 });
  face(m, 150);
  Logic.update(m, DT, press({ light: true }), IDLE);
  run(m, 0.25, IDLE, IDLE);
  assert.strictEqual(m.fighters[1].state, 'hit');
  Logic.update(m, DT, IDLE, press({ light: true }));
  assert.strictEqual(m.fighters[1].attack, null, '硬直中仍能出招');
  assert.strictEqual(m.fighters[1].state, 'hit');
});

check('双方自动面向对手', () => {
  const m = Logic.createMatch({ seed: 2 });
  m.fighters[0].x = 900;
  m.fighters[1].x = 300;
  run(m, 0.05, IDLE, IDLE);
  assert.strictEqual(m.fighters[0].facing, -1);
  assert.strictEqual(m.fighters[1].facing, 1);
});

console.log('回合与比赛');

check('血量归零判定 KO 并计入比分', () => {
  const m = Logic.createMatch({ seed: 11 });
  face(m, 150);
  m.fighters[1].hp = 5;
  Logic.update(m, DT, press({ heavy: true }), IDLE);
  run(m, 0.5, IDLE, IDLE);
  assert.strictEqual(m.fighters[1].hp, 0);
  assert.strictEqual(m.fighters[1].state, 'ko');
  assert.strictEqual(m.phase, 'roundEnd');
  assert.deepStrictEqual(m.wins, [1, 0]);
  const events = Logic.drainEvents(m).map((e) => e.type);
  assert.ok(events.indexOf('roundEnd') !== -1, '缺少 roundEnd 事件：' + events.join(','));
});

check('时间耗尽按血量判胜', () => {
  const m = Logic.createMatch({ seed: 4 });
  m.fighters[0].hp = 80;
  m.fighters[1].hp = 40;
  m.timer = 0.005;
  run(m, 0.05, IDLE, IDLE);
  assert.strictEqual(m.phase, 'roundEnd');
  assert.strictEqual(m.roundWinner, 0);
  assert.strictEqual(m.wins[0], 1);
  const ev = Logic.drainEvents(m).filter((e) => e.type === 'roundEnd')[0];
  assert.strictEqual(ev.reason, 'time');
});

check('回合结束 2.4 秒后进入下一回合并回满血', () => {
  const m = Logic.createMatch({ seed: 4 });
  face(m, 150);
  m.fighters[1].hp = 5;
  Logic.update(m, DT, press({ heavy: true }), IDLE);
  run(m, 0.5, IDLE, IDLE);
  assert.strictEqual(m.phase, 'roundEnd');
  run(m, Logic.CONFIG.roundEndDelay + 0.2, IDLE, IDLE);
  assert.strictEqual(m.phase, 'fight');
  assert.strictEqual(m.round, 2);
  assert.strictEqual(m.fighters[1].hp, 100);
  // 新回合从 60 秒重新计时，测试多跑的帧会消耗掉一点
  assert.ok(m.timer > 59, '计时未重置：' + m.timer);
});

check('先赢两回合即结束整场并广播 match 事件', () => {
  const m = Logic.createMatch({ seed: 4 });
  const winRound = () => {
    face(m, 150);
    m.fighters[1].hp = 5;
    Logic.update(m, DT, press({ heavy: true }), IDLE);
    run(m, 0.5, IDLE, IDLE);
    run(m, (Logic.CONFIG.roundEndDelay + 0.1), IDLE, IDLE);
  };
  winRound();
  assert.strictEqual(m.wins[0], 1);
  winRound();
  assert.strictEqual(m.phase, 'matchEnd');
  assert.strictEqual(m.matchWinner, 0);
  assert.strictEqual(m.wins[0], 2);
  const types = Logic.drainEvents(m).map((e) => e.type);
  assert.ok(types.indexOf('match') !== -1, '缺少 match 事件：' + types.join(','));
  assert.strictEqual(Logic.resultText(m), 'YOU WIN');
});

check('平局不计分（双方血量相同且时间到）', () => {
  const m = Logic.createMatch({ seed: 4 });
  m.fighters[0].hp = 60;
  m.fighters[1].hp = 60;
  m.timer = 0.005;
  run(m, 0.05, IDLE, IDLE);
  assert.strictEqual(m.roundWinner, -1);
  assert.deepStrictEqual(m.wins, [0, 0]);
});

console.log('电脑对手');

check('电脑会主动接近对手', () => {
  const m = Logic.createMatch({ seed: 9 });
  m.fighters[0].x = 200;
  m.fighters[1].x = 1000;
  const before = Math.abs(m.fighters[1].x - m.fighters[0].x);
  run(m, 1.2, IDLE, () => Logic.aiInput(m, 1, 'normal'));
  const after = Math.abs(m.fighters[1].x - m.fighters[0].x);
  assert.ok(after < before - 40, '没有靠近：' + before + ' → ' + after);
});

check('贴身时电脑会出招', () => {
  const m = Logic.createMatch({ seed: 21 });
  face(m, 120);
  run(m, 2.5, IDLE, () => Logic.aiInput(m, 1, 'hard'));
  assert.ok(m.fighters[0].hp < 100, '电脑没有造成伤害');
});

check('高难度出招更频繁', () => {
  const damage = (level) => {
    const m = Logic.createMatch({ seed: 33 });
    face(m, 120);
    run(m, 6, IDLE, () => Logic.aiInput(m, 1, level));
    return 100 - m.fighters[0].hp;
  };
  assert.ok(damage('hard') >= damage('easy'), '难度没有体现差异');
});

check('同一种子下电脑行为可复现', () => {
  const sim = () => {
    const m = Logic.createMatch({ seed: 99 });
    run(m, 3, () => Logic.aiInput(m, 0, 'normal'), () => Logic.aiInput(m, 1, 'normal'));
    return m.fighters.map((f) => Math.round(f.x * 100) / 100).join('|');
  };
  assert.strictEqual(sim(), sim());
});

console.log('事件队列');

check('drainEvents 取空队列', () => {
  const m = Logic.createMatch({ seed: 8 });
  face(m, 150);
  run(m, 0.2, press({ light: true }), IDLE);
  const events = Logic.drainEvents(m);
  assert.ok(events.length > 0);
  assert.strictEqual(m.events.length, 0);
  assert.strictEqual(Logic.drainEvents(m).length, 0);
});

check('暂停语义：dt 为 0 时状态不变', () => {
  const m = Logic.createMatch({ seed: 8 });
  const before = m.timer;
  Logic.update(m, 0, press({ right: true }), IDLE);
  assert.strictEqual(m.timer, before);
});

console.log('\n' + (failed ? '存在失败用例：' + failed + ' 项' : '全部通过：' + pass + ' 项'));
process.exit(process.exitCode || 0);
