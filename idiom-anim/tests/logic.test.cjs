/* 逻辑回归：node tests/logic.test.cjs */
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
['data.js', 'logic.js'].forEach((file) => {
  vm.runInContext(fs.readFileSync(path.join(ROOT, file), 'utf8'), sandbox, { filename: file });
});

const BANK = sandbox.IDIOM_BANK;
const ANIMS = sandbox.IDIOM_ANIMS;
const Core = sandbox.IdiomCore;

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

console.log('题库完整性');
check('至少 60 条成语', () => assert.ok(BANK.length >= 60, '题库仅 ' + BANK.length + ' 条'));
check('每条都是四字成语', () => {
  BANK.forEach((item) => assert.strictEqual(item.w.length, 4, item.w + ' 不是四字'));
});
check('成语不重复', () => {
  const seen = new Set();
  BANK.forEach((item) => {
    assert.ok(!seen.has(item.w), '重复：' + item.w);
    seen.add(item.w);
  });
});
check('每字至少 1 个动图候选', () => {
  BANK.forEach((item) => {
    assert.strictEqual(item.h.length, 4, item.w + ' 候选组数不对');
    item.h.forEach((pics, i) => {
      assert.ok(Array.isArray(pics) && pics.length >= 1, item.w + ' 第 ' + (i + 1) + ' 字缺候选');
      pics.forEach((pic) => {
        assert.strictEqual(typeof pic, 'string');
        assert.ok(pic.trim().length > 0);
        assert.ok(!/\s/.test(pic), item.w + ' 候选含空白：' + pic);
      });
    });
  });
});
check('每字有释义标注', () => {
  BANK.forEach((item) => {
    assert.strictEqual(item.n.length, 4, item.w + ' 标注数量不对');
    item.n.forEach((note) => assert.ok(typeof note === 'string' && note.length >= 2, item.w + ' 标注过短'));
  });
});

console.log('答案归一化与判定');
check('去空格/标点', () => assert.strictEqual(Core.normalize('  画蛇 添足。'), '画蛇添足'));
check('全角标点归一', () => assert.strictEqual(Core.normalize('（一）石二鸟！'), '一石二鸟'));
check('全角数字归一', () => assert.strictEqual(Core.normalize('１２３'), '123'));
check('全角空格归一', () => assert.strictEqual(Core.normalize('亡羊\u3000补牢'), '亡羊补牢'));
check('完全匹配才算对', () => {
  assert.strictEqual(Core.isCorrect('画蛇添足', '画蛇添足'), true);
  assert.strictEqual(Core.isCorrect(' 画蛇添足!', '画蛇添足'), true);
  assert.strictEqual(Core.isCorrect('画蛇添', '画蛇添足'), false);
  assert.strictEqual(Core.isCorrect('画蛇添足足', '画蛇添足'), false);
  assert.strictEqual(Core.isCorrect('', '画蛇添足'), false);
  assert.strictEqual(Core.isCorrect(null, '画蛇添足'), false);
});

console.log('对局内核');
function newGame(seed) {
  return Core.createGame({ bank: BANK, anims: ANIMS, seconds: 900, rng: Core.mulberry32(seed || 7) });
}

check('抽题输出 4 个字块', () => {
  const g = newGame(1);
  const q = g.next();
  assert.strictEqual(q.tiles.length, 4);
  q.tiles.forEach((tile, i) => {
    assert.ok(q.idiom.h[i].includes(tile.pic), '图块不来自候选池');
    assert.ok(ANIMS.includes(tile.anim), '未知动效：' + tile.anim);
    assert.ok(tile.note.length >= 2);
  });
});

check('一轮内不重复抽题', () => {
  const g = newGame(2);
  const seen = new Set();
  for (let i = 0; i < BANK.length; i += 1) seen.add(g.next().idiom.w);
  assert.strictEqual(seen.size, BANK.length);
});

check('跨轮不出现连续同题', () => {
  const g = newGame(3);
  let last = null;
  for (let i = 0; i < BANK.length + 5; i += 1) {
    const q = g.next();
    assert.notStrictEqual(q.idiom.w, last, '连续两题相同：' + q.idiom.w);
    last = q.idiom.w;
  }
});

check('答对 +1，答错 -1', () => {
  const g = newGame(4);
  let q = g.next();
  const right = g.submit(q.idiom.w);
  assert.strictEqual(right.status, 'correct');
  assert.strictEqual(right.score, 1);
  assert.strictEqual(right.answer, q.idiom.w);
  assert.strictEqual(right.streak, 1);
  q = g.next();
  const wrong = g.submit('绝对不对的答案');
  assert.strictEqual(wrong.status, 'wrong');
  assert.strictEqual(wrong.score, 0);
  assert.strictEqual(wrong.streak, 0);
});

check('分数可以为负', () => {
  const g = newGame(5);
  for (let i = 0; i < 5; i += 1) {
    g.next();
    g.submit('错');
  }
  assert.strictEqual(g.state.score, -5);
  assert.strictEqual(g.summary().score, -5);
});

check('连对与断连', () => {
  const g = newGame(6);
  for (let i = 0; i < 3; i += 1) g.submit(g.next().idiom.w);
  assert.strictEqual(g.state.streak, 3);
  g.next();
  g.submit('错一次');
  assert.strictEqual(g.state.streak, 0);
  assert.strictEqual(g.state.bestStreak, 3);
});

check('看答案扣 1 分并返回答案', () => {
  const g = newGame(8);
  const q = g.next();
  const res = g.reveal();
  assert.strictEqual(res.status, 'revealed');
  assert.strictEqual(res.answer, q.idiom.w);
  assert.strictEqual(res.score, -1);
  assert.strictEqual(g.state.wrong, 1);
});

check('汇总正确率', () => {
  const g = newGame(9);
  g.submit(g.next().idiom.w);
  g.submit(g.next().idiom.w);
  g.next();
  g.submit('x');
  g.next();
  g.submit('y');
  const s = g.summary();
  assert.strictEqual(s.score, 0);
  assert.strictEqual(s.correct, 2);
  assert.strictEqual(s.wrong, 2);
  assert.strictEqual(s.accuracy, 50);
});

check('倒计时格式', () => {
  assert.strictEqual(Core.formatClock(900), '15:00');
  assert.strictEqual(Core.formatClock(61), '01:01');
  assert.strictEqual(Core.formatClock(9), '00:09');
  assert.strictEqual(Core.formatClock(0), '00:00');
  assert.strictEqual(Core.formatClock(-3), '00:00');
});

check('排行榜：分数优先，再比答对，再比先到', () => {
  const rows = [
    { name: 'A', score: 12, correct: 14, wrong: 2, at: 300 },
    { name: 'B', score: 12, correct: 15, wrong: 3, at: 400 },
    { name: 'C', score: 9, correct: 9, wrong: 0, at: 100 },
    { name: 'D', score: 12, correct: 14, wrong: 2, at: 200 }
  ];
  const ranked = Core.rankEntries(rows).map((r) => r.name);
  assert.deepStrictEqual(ranked, ['B', 'D', 'A', 'C']);
});

check('名次标签', () => {
  assert.strictEqual(Core.podiumLabel(0), '冠军');
  assert.strictEqual(Core.podiumLabel(1), '亚军');
  assert.strictEqual(Core.podiumLabel(2), '季军');
  assert.strictEqual(Core.podiumLabel(5), '第 6 名');
});

console.log('界面装配（静态）');
check('game.js 引用的元素 id 都存在', () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const js = fs.readFileSync(path.join(ROOT, 'game.js'), 'utf8');
  const declared = new Set(Array.from(html.matchAll(/id="([^"]+)"/g), (m) => m[1]));
  const used = Array.from(js.matchAll(/\$\('([^']+)'\)/g), (m) => m[1]);
  const missing = used.filter((id) => !declared.has(id));
  assert.deepStrictEqual(missing, [], '缺少 id：' + missing.join(', '));
});

check('index.html 脚本顺序：data → logic → game', () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const order = Array.from(html.matchAll(/<script src="([^"]+)"/g), (m) => m[1]);
  assert.deepStrictEqual(order, ['data.js', 'logic.js', 'game.js']);
});

console.log('\n' + (process.exitCode ? '存在失败用例' : '全部通过：' + pass + ' 项'));
if (process.exitCode) process.exit(process.exitCode);
