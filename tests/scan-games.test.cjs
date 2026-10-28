/* 扫描器回归：node apps/games/tests/scan-games.test.cjs */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const { scanGames, buildManifest, renderJs, writeManifest } = require('../tools/scan-games.cjs');

let passed = 0;
function check(name, fn) {
  try {
    fn();
    passed += 1;
    console.log('  PASS  ' + name);
  } catch (err) {
    console.log('  FAIL  ' + name + '\n        ' + err.message);
    process.exitCode = 1;
  }
}

function makeGame(root, id, files) {
  const dir = path.join(root, id);
  fs.mkdirSync(dir, { recursive: true });
  Object.keys(files).forEach((name) => {
    fs.writeFileSync(path.join(dir, name), files[name], 'utf8');
  });
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'games-scan-'));

makeGame(root, 'game-a', {
  'index.html': '<!doctype html><html><head><title>页面里的标题</title></head><body>A</body></html>',
  'game.json': JSON.stringify({
    id: 'game-a',
    title: '甲游戏',
    subtitle: '带元数据的游戏',
    tags: ['策略', '双人', '第三个', '第四个', '第五个会被截断'],
    cover: '🎯',
    accent: '#4cc9f0'
  })
});

makeGame(root, 'game-b', {
  'index.html': '<!doctype html><html><head><title>乙游戏</title>'
    + '<meta name="description" content="只靠 index.html 推断"></head><body>B</body></html>'
});

makeGame(root, 'game-c', {
  'game.json': JSON.stringify({ title: '坏掉的游戏' })
});

fs.mkdirSync(path.join(root, 'tools'), { recursive: true });
fs.writeFileSync(path.join(root, 'tools', 'x.js'), '', 'utf8');
fs.mkdirSync(path.join(root, '.hidden'), { recursive: true });
fs.writeFileSync(path.join(root, 'readme.md'), '# 说明', 'utf8');

const { games, warnings } = scanGames(root);
const byId = new Map(games.map((g) => [g.id, g]));

console.log('扫描与元数据');
check('只收录含 index.html 的一级目录', () => {
  assert.deepStrictEqual(games.map((g) => g.id), ['game-a', 'game-b']);
});
check('跳过 tools / 隐藏目录 / 普通文件', () => {
  assert.ok(!byId.has('tools'));
  assert.ok(!byId.has('.hidden'));
  assert.ok(!byId.has('readme.md'));
});
check('缺 index.html 时给出警告', () => {
  assert.ok(warnings.some((line) => line.indexOf('game-c') === 0), warnings.join(' | '));
});
check('game.json 优先，标签截断到 4 个', () => {
  const game = byId.get('game-a');
  assert.strictEqual(game.title, '甲游戏');
  assert.strictEqual(game.subtitle, '带元数据的游戏');
  assert.strictEqual(game.tags.length, 4);
  assert.strictEqual(game.cover, '🎯');
  assert.strictEqual(game.accent, '#4cc9f0');
});
check('无 game.json 时回退到 title / description', () => {
  const game = byId.get('game-b');
  assert.strictEqual(game.title, '乙游戏');
  assert.strictEqual(game.subtitle, '只靠 index.html 推断');
  assert.strictEqual(game.accent, '#ffd166');
  assert.deepStrictEqual(game.tags, []);
});
check('updatedAt 取文件时间', () => {
  assert.ok(byId.get('game-a').updatedAt > 0);
  assert.ok(byId.get('game-b').updatedAt > 0);
});

console.log('清单生成');
const manifest = buildManifest(root, games);
check('清单统计正确', () => {
  assert.strictEqual(manifest.count, 2);
  assert.strictEqual(manifest.games.length, 2);
  assert.ok(manifest.generatedAt);
});

check('games.js 可被浏览器直接执行', () => {
  const sandbox = { window: {} };
  vm.createContext(sandbox);
  vm.runInContext(renderJs(manifest), sandbox, { filename: 'games.js' });
  assert.strictEqual(sandbox.window.GAMES_MANIFEST.count, 2);
  assert.strictEqual(sandbox.window.GAMES_MANIFEST.games[0].id, 'game-a');
});

check('writeManifest 同时写出 games.js 与 games.json', () => {
  writeManifest(root, games);
  const js = fs.readFileSync(path.join(root, 'games.js'), 'utf8');
  const json = JSON.parse(fs.readFileSync(path.join(root, 'games.json'), 'utf8'));
  assert.ok(js.indexOf('window.GAMES_MANIFEST') === 0 || js.indexOf('window.GAMES_MANIFEST') > 0);
  assert.strictEqual(json.count, 2);
});

check('空目录扫描为空清单', () => {
  const emptyRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'games-empty-'));
  const result = scanGames(emptyRoot);
  assert.deepStrictEqual(result.games, []);
  assert.deepStrictEqual(result.warnings, []);
  fs.rmSync(emptyRoot, { recursive: true, force: true });
});

fs.rmSync(root, { recursive: true, force: true });

console.log('\n' + (process.exitCode ? '存在失败用例' : '全部通过：' + passed + ' 项'));
if (process.exitCode) process.exit(process.exitCode);
