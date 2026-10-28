/* 游戏中心界面冒烟：node apps/games/tests/center.smoke.cjs
 * 用极简 DOM 桩 + mock fetch，验证扫描渲染、点赞收藏、游玩计时与关闭结算。
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const ROOT = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

/* ------------------------------------------------------------------ DOM 桩 */
function matches(node, selector) {
  if (selector.startsWith('.')) return node.classList.contains(selector.slice(1));
  if (selector.startsWith('[') && selector.endsWith(']')) {
    const raw = selector.slice(1, -1);
    const key = raw.indexOf('data-') === 0 ? raw.slice(5) : raw;
    return Object.prototype.hasOwnProperty.call(node.dataset, key);
  }
  return node.tagName === selector.toUpperCase();
}

function makeEl(tag) {
  const el = {
    tagName: String(tag || 'div').toUpperCase(),
    children: [],
    parentNode: null,
    _text: '',
    dataset: {},
    attrs: {},
    hidden: false,
    disabled: false,
    value: '',
    src: '',
    title: '',
    type: '',
    style: { setProperty() {} },
    _handlers: {},
    classList: {
      _set: new Set(),
      add() { for (const name of arguments) this._set.add(name); },
      remove() { for (const name of arguments) this._set.delete(name); },
      toggle(name, force) {
        const on = force === undefined ? !this._set.has(name) : !!force;
        if (on) this._set.add(name); else this._set.delete(name);
        return on;
      },
      contains(name) { return this._set.has(name); }
    },
    addEventListener(type, fn) { (this._handlers[type] = this._handlers[type] || []).push(fn); },
    setAttribute(name, value) { this.attrs[name] = String(value); },
    appendChild(child) { child.parentNode = this; this.children.push(child); return child; },
    querySelectorAll(selector) {
      const out = [];
      const walk = (node) => node.children.forEach((child) => {
        if (matches(child, selector)) out.push(child);
        walk(child);
      });
      walk(this);
      return out;
    },
    closest(selector) {
      let node = this;
      while (node) {
        if (matches(node, selector)) return node;
        node = node.parentNode;
      }
      return null;
    },
    get className() { return Array.from(this.classList._set).join(' '); },
    set className(value) {
      this.classList._set = new Set(String(value).split(/\s+/).filter(Boolean));
    },
    get textContent() {
      return this._text + this.children.map((child) => child.textContent).join('');
    },
    set textContent(value) {
      this._text = String(value);
      this.children = [];
    }
  };
  return el;
}

const ids = Array.from(html.matchAll(/id="([^"]+)"/g), (m) => m[1]);
const registry = new Map(ids.map((id) => [id, makeEl('div')]));

['all', 'fav', 'played'].forEach((name) => {
  const chip = makeEl('button');
  chip.className = 'chip' + (name === 'all' ? ' is-on' : '');
  chip.dataset.filter = name;
  registry.get('filters').appendChild(chip);
});

const viewButtons = ['grid', 'list'].map((view) => {
  const button = makeEl('button');
  button.className = 'seg-btn' + (view === 'grid' ? ' is-on' : '');
  button.dataset.view = view;
  registry.get('viewSwitch').appendChild(button);
  return button;
});
const body = makeEl('body');
const document = {
  hidden: false,
  body,
  fullscreenElement: null,
  getElementById: (id) => registry.get(id) || null,
  createElement: (tag) => makeEl(tag),
  addEventListener() {},
  exitFullscreen: () => Promise.resolve()
};

/* ------------------------------------------------------------- mock 服务端 */
const server = { games: {} };
const calls = [];

function snapshot() {
  return {
    updatedAt: new Date().toISOString(),
    games: JSON.parse(JSON.stringify(server.games))
  };
}

function applyServerEvent(body) {
  const row = server.games[body.gameId] || (server.games[body.gameId] = {
    plays: 0, seconds: 0, people: 0, likes: 0, favs: 0, players: [], likers: [], favors: []
  });
  const pid = body.playerId;
  if (row.players.indexOf(pid) === -1) {
    row.players.push(pid);
    row.people = row.players.length;
  }
  if (body.type === 'open') row.plays += 1;
  if (body.type === 'close') row.seconds += Math.max(0, Number(body.seconds) || 0);
  if (body.type === 'like' && row.likers.indexOf(pid) === -1) { row.likers.push(pid); row.likes = row.likers.length; }
  if (body.type === 'unlike') { row.likers = row.likers.filter((x) => x !== pid); row.likes = row.likers.length; }
  if (body.type === 'favorite' && row.favors.indexOf(pid) === -1) { row.favors.push(pid); row.favs = row.favors.length; }
  if (body.type === 'unfavorite') { row.favors = row.favors.filter((x) => x !== pid); row.favs = row.favors.length; }
  return snapshot();
}

const listing = '<!doctype html><html><body><h1>Directory listing</h1>'
  + '<a href="alpha/">alpha/</a><a href="beta/">beta/</a><a href="games.js">games.js</a>'
  + '<a href="tools/">tools/</a><a href="index.html">index.html</a></body></html>';

function mockFetch(url, options) {
  const method = (options && options.method) || 'GET';
  const body = options && options.body ? JSON.parse(options.body) : null;
  calls.push({ url, method, body });
  if (url === './api/stats' && method === 'POST') {
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(applyServerEvent(body)) });
  }
  if (url === './api/stats') {
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(snapshot()) });
  }
  if (url === './') {
    return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(listing) });
  }
  if (url === 'alpha/game.json') {
    return Promise.resolve({
      ok: true, status: 200,
      json: () => Promise.resolve({ id: 'alpha', title: '甲游戏', subtitle: '带元数据', tags: ['策略'] })
    });
  }
  if (url === 'alpha/index.html') {
    return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve('<title>甲</title>') });
  }
  if (url === 'beta/game.json') return Promise.resolve({ ok: false, status: 404 });
  if (url === 'beta/index.html') {
    return Promise.resolve({
      ok: true, status: 200,
      text: () => Promise.resolve('<html><head><title>乙游戏</title>'
        + '<meta name="description" content="只有页面标题"></head></html>')
    });
  }
  if (/^tools\//.test(url)) return Promise.resolve({ ok: false, status: 404 });
  return Promise.resolve({ ok: false, status: 404 });
}

/* ------------------------------------------------------------------ 沙箱 */
let fakeNow = 1760000000000;
function FakeDate() { return new Date(fakeNow); }
FakeDate.now = () => fakeNow;
FakeDate.prototype = Date.prototype;

const store = new Map();
const intervals = new Map();
let intervalSeq = 0;

const sandbox = {
  console,
  Math,
  JSON,
  Object,
  Array,
  Number,
  String,
  Date: FakeDate,
  Map,
  Promise,
  document,
  fetch: mockFetch,
  localStorage: {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, String(value))
  },
  setTimeout: () => 0,
  clearTimeout: () => {},
  setInterval: (fn) => { intervalSeq += 1; intervals.set(intervalSeq, fn); return intervalSeq; },
  clearInterval: (id) => intervals.delete(id),
  addEventListener: () => {},
  location: { href: 'http://localhost/' }
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
sandbox.window.GAMES_MANIFEST = { games: [{ id: 'alpha', title: '甲游戏', subtitle: '清单里的副标题', tags: ['策略'] }] };
sandbox.window.GAME_CENTER_CONFIG = { statsEndpoint: './api/stats', refreshMs: 0, scan: true };
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'center.js'), 'utf8'), sandbox, { filename: 'center.js' });

/* ------------------------------------------------------------------ 断言 */
const el = (id) => registry.get(id);
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function byClass(node, name) {
  for (const child of node.children) {
    if (child.classList.contains(name)) return child;
    const hit = byClass(child, name);
    if (hit) return hit;
  }
  return null;
}

function allByClass(node, name, out) {
  const acc = out || [];
  node.children.forEach((child) => {
    if (child.classList.contains(name)) acc.push(child);
    allByClass(child, name, acc);
  });
  return acc;
}

function cardTitles() {
  return allByClass(el('board'), 'card-title').map((node) => node.textContent);
}

function cardByTitle(title) {
  return allByClass(el('board'), 'card').filter((card) => {
    const head = byClass(card, 'card-title');
    return head && head.textContent === title;
  })[0] || null;
}

function rows() { return allByClass(el('board'), 'game-row'); }
function rowOf(id) { return rows().filter((row) => row.dataset.game === id)[0] || null; }
function rowTitles() { return rows().map((row) => byClass(row, 'cell-title').textContent); }

function click(node) {
  (node._handlers.click || []).forEach((fn) => fn({ preventDefault() {} }));
}

function clickFilter(name) {
  const chip = Array.from(el('filters').children).filter((child) => child.dataset.filter === name)[0];
  assert.ok(chip, '缺少筛选项 ' + name);
  const handlers = el('filters')._handlers.click || [];
  assert.strictEqual(handlers.length, 1, '筛选事件未绑定');
  handlers.forEach((fn) => fn({ target: chip }));
}

function clickView(view) {
  const button = viewButtons.filter((node) => node.dataset.view === view)[0];
  assert.ok(button, '缺少展示方式按钮 ' + view);
  const handlers = el('viewSwitch')._handlers.click || [];
  assert.strictEqual(handlers.length, 1, '展示方式事件未绑定');
  handlers.forEach((fn) => fn({ target: button }));
}

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

async function main() {
  await wait(60);

  console.log('扫描与看板');
  check('清单内 + 目录新发现的游戏都上榜', () => {
    assert.deepStrictEqual(cardTitles().sort(), ['乙游戏', '甲游戏']);
  });

  check('服务端统计已接入', () => {
    assert.strictEqual(el('sourceBadge').dataset.mode, 'server');
    assert.strictEqual(el('countAll').textContent, '2');
  });

  check('新发现的游戏用 index.html 推断标题与描述', () => {
    const card = cardByTitle('乙游戏');
    assert.ok(card, '乙游戏未渲染');
    assert.strictEqual(byClass(card, 'card-sub').textContent, '只有页面标题');
  });

  check('卡片展示 6 项指标', () => {
    const card = cardByTitle('甲游戏');
    const metrics = allByClass(card, 'metric');
    assert.strictEqual(metrics.length, 6);
    const labels = metrics.map((node) => node.children[1].textContent);
    assert.deepStrictEqual(labels, ['游玩次数', '累计时长', '人数', '点赞', '收藏', '我的时长']);
  });

  console.log('游玩会话');
  server.games.alpha = {
    plays: 5, seconds: 600, people: 3, likes: 2, favs: 1,
    players: [], likers: [], favors: []
  };
  const beforeOpen = calls.length;
  click(byClass(cardByTitle('甲游戏'), 'play'));

  check('打开内嵌播放器并记录开局', () => {
    assert.strictEqual(el('player').hidden, false);
    assert.ok(el('playerFrame').src.indexOf('alpha/index.html') !== -1, el('playerFrame').src);
    assert.strictEqual(el('playerTitle').textContent, '甲游戏');
    const posts = calls.slice(beforeOpen).filter((c) => c.method === 'POST');
    assert.ok(posts.some((c) => c.body.type === 'open' && c.body.gameId === 'alpha'));
  });

  fakeNow += 65000;
  const tick = Array.from(intervals.values()).pop();
  tick();
  check('播放器内的计时器累计时长', () => {
    assert.strictEqual(el('playerClock').textContent, '01:05');
  });

  click(el('playerClose'));
  check('关闭时上报时长并收起播放器', () => {
    const post = calls.filter((c) => c.method === 'POST' && c.body.type === 'close').pop();
    assert.ok(post, '没有收到 close 事件');
    assert.strictEqual(post.body.seconds, 65);
    assert.strictEqual(el('player').hidden, true);
    assert.strictEqual(el('playerFrame').src, 'about:blank');
  });

  check('本机也留存时长，断网仍可展示', () => {
    const saved = JSON.parse(store.get('game-center.stats.v1'));
    assert.strictEqual(saved.alpha.seconds, 65);
    assert.strictEqual(saved.alpha.plays, 1);
  });

  console.log('点赞 / 收藏 / 筛选');
  click(byClass(cardByTitle('甲游戏'), 'icon-btn'));
  check('点赞后按钮高亮并上报', () => {
    const saved = JSON.parse(store.get('game-center.stats.v1'));
    assert.strictEqual(saved.alpha.liked, true);
    const like = byClass(cardByTitle('甲游戏'), 'icon-btn');
    assert.ok(like.classList.contains('is-on'));
    assert.ok(calls.some((c) => c.body && c.body.type === 'like'));
  });

  click(allByClass(cardByTitle('甲游戏'), 'icon-btn')[1]);
  check('收藏后可以按收藏筛选', () => {
    clickFilter('fav');
    assert.deepStrictEqual(cardTitles(), ['甲游戏']);
    clickFilter('all');
    assert.strictEqual(cardTitles().length, 2);
  });

  check('搜索命中标题或标签', () => {
    el('search').value = '策略';
    (el('search')._handlers.input || []).forEach((fn) => fn({}));
    assert.deepStrictEqual(cardTitles(), ['甲游戏']);
    el('search').value = '';
    (el('search')._handlers.input || []).forEach((fn) => fn({}));
  });

  check('默认按热度排序（甲 6 局 > 乙 0 局）', () => {
    assert.deepStrictEqual(cardTitles(), ['甲游戏', '乙游戏']);
  });

  check('按点赞排序稳定可用', () => {
    el('sort').value = 'likes';
    (el('sort')._handlers.change || []).forEach((fn) => fn({}));
    const titles = cardTitles();
    assert.strictEqual(titles.length, 2);
    assert.ok(titles.indexOf('甲游戏') !== -1 && titles.indexOf('乙游戏') !== -1);
  });

  console.log('九宫格 / 表格双视图');
  check('默认九宫格：只有卡片，没有表格', () => {
    assert.strictEqual(viewButtons[0].classList.contains('is-on'), true);
    assert.strictEqual(el('board').classList.contains('is-list'), false);
    assert.strictEqual(cardTitles().length, 2);
    assert.strictEqual(allByClass(el('board'), 'game-table').length, 0);
  });

  check('切到表格：表头齐全，一行一个游戏', () => {
    clickView('list');
    assert.strictEqual(el('board').classList.contains('is-list'), true);
    assert.strictEqual(viewButtons[1].classList.contains('is-on'), true);
    assert.strictEqual(cardTitles().length, 0, '表格模式不再渲染卡片');
    const table = allByClass(el('board'), 'game-table')[0];
    assert.ok(table, '没有渲染表格');
    assert.strictEqual(allByClass(el('board'), 'table-wrap').length, 1, '窄屏可横向滚动');
    const heads = allByClass(table, 'col').map((node) => node.textContent);
    assert.deepStrictEqual(heads,
      ['游戏', '标签', '游玩次数', '累计时长', '人数', '点赞', '收藏', '我的时长', '操作']);
    assert.strictEqual(rows().length, 2);
    assert.deepStrictEqual(rowTitles().sort(), ['乙游戏', '甲游戏']);
  });

  check('表格行内是完整详情：封面、简介、标签、六项指标、三个操作', () => {
    const alpha = rowOf('alpha');
    assert.ok(alpha, '甲游戏缺行');
    assert.ok(byClass(alpha, 'cover'), '缺封面');
    assert.strictEqual(byClass(alpha, 'cell-title').textContent, '甲游戏');
    assert.strictEqual(byClass(alpha, 'cell-sub').textContent, '清单里的副标题');
    assert.deepStrictEqual(allByClass(alpha, 'tag').map((node) => node.textContent), ['策略']);
    assert.strictEqual(allByClass(alpha, 'num').length, 6, '六项指标各一格');
    assert.strictEqual(byClass(alpha, 'play').textContent, '继续', '玩过的显示继续');
    assert.strictEqual(allByClass(alpha, 'icon-btn').length, 2);

    const beta = rowOf('beta');
    assert.strictEqual(byClass(beta, 'cell-sub').textContent, '只有页面标题');
    assert.strictEqual(byClass(beta, 'play').textContent, '开始');
    assert.strictEqual(allByClass(beta, 'tag').length, 0, '没有标签');
    assert.ok(alpha.classList.contains('is-played'));
    assert.ok(!beta.classList.contains('is-played'));
  });

  check('表格模式下搜索 / 筛选 / 排序仍作用到行', () => {
    clickFilter('played');
    assert.deepStrictEqual(rowTitles(), ['甲游戏']);
    clickFilter('all');
    assert.strictEqual(rows().length, 2);
    el('search').value = '策略';
    (el('search')._handlers.input || []).forEach((fn) => fn({}));
    assert.deepStrictEqual(rowTitles(), ['甲游戏']);
    el('search').value = '';
    (el('search')._handlers.input || []).forEach((fn) => fn({}));
    assert.strictEqual(rows().length, 2);
  });

  check('表格行内直接点赞 / 开局', () => {
    const likeBtn = allByClass(rowOf('alpha'), 'icon-btn')[0];
    const wasOn = likeBtn.classList.contains('is-on');
    click(likeBtn);
    assert.strictEqual(JSON.parse(store.get('game-center.stats.v1')).alpha.liked, !wasOn);
    assert.strictEqual(allByClass(rowOf('alpha'), 'icon-btn')[0].classList.contains('is-on'), !wasOn);
    click(byClass(rowOf('alpha'), 'play'));
    assert.strictEqual(el('player').hidden, false);
    assert.ok(el('playerFrame').src.indexOf('alpha/index.html') !== -1);
    click(el('playerClose'));
    assert.strictEqual(el('player').hidden, true);
    click(byClass(rowOf('alpha'), 'icon-btn')[0]);
  });

  check('展示方式记在本机，切回九宫格恢复卡片', () => {
    assert.strictEqual(store.get('game-center.view.v1'), '"list"');
    clickView('grid');
    assert.strictEqual(el('board').classList.contains('is-list'), false);
    assert.strictEqual(cardTitles().length, 2);
    assert.strictEqual(allByClass(el('board'), 'game-table').length, 0);
    assert.strictEqual(store.get('game-center.view.v1'), '"grid"');
    assert.strictEqual(viewButtons[0].classList.contains('is-on'), true);
    assert.strictEqual(viewButtons[1].classList.contains('is-on'), false);
  });

  console.log('\n' + (process.exitCode ? '存在失败用例' : '界面冒烟通过：' + passed + ' 项'));
  if (process.exitCode) process.exit(process.exitCode);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
