/* 界面冒烟：node tests/ui.smoke.cjs（DOM + Canvas 桩，覆盖键位、暂停、结算、存档） */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

/* ---------------------------------------------------------------- DOM 桩 */
function matches(node, selector) {
  if (selector === 'button') return node.tagName === 'BUTTON';
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
    hidden: false,
    value: '',
    width: 0,
    height: 0,
    clientWidth: 0,
    style: {},
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
    appendChild(child) {
      child.parentNode = this;
      this.children.push(child);
      return child;
    },
    removeChild(child) {
      const at = this.children.indexOf(child);
      if (at >= 0) this.children.splice(at, 1);
      child.parentNode = null;
      return child;
    },
    contains(node) {
      let cur = node;
      while (cur) {
        if (cur === this) return true;
        cur = cur.parentNode;
      }
      return false;
    },
    closest(selector) {
      let node = this;
      while (node) {
        if (matches(node, selector)) return node;
        node = node.parentNode;
      }
      return null;
    },
    getBoundingClientRect() {
      return { left: 0, top: 0, right: this.clientWidth, bottom: this.clientHeight, width: this.clientWidth, height: this.clientHeight };
    },
    get className() { return Array.from(this.classList._set).join(' '); },
    set className(value) { this.classList._set = new Set(String(value).split(/\s+/).filter(Boolean)); },
    get textContent() {
      return this._text + this.children.map((child) => child.textContent).join('');
    },
    set textContent(value) {
      this._text = String(value);
      this.children = [];
    }
  };
  el.clientHeight = 0;
  return el;
}

const ids = Array.from(html.matchAll(/id="([^"]+)"/g), (m) => m[1]);
const registry = new Map(ids.map((id) => [id, makeEl('div')]));

function seedSeg(rowId, key, values, active) {
  const row = registry.get(rowId);
  values.forEach((value) => {
    const btn = makeEl('button');
    btn.dataset[key] = String(value);
    if (value === active) btn.classList.add('is-on');
    row.appendChild(btn);
  });
}
seedSeg('diffRow', 'diff', ['easy', 'normal', 'hard'], 'normal');
seedSeg('skinRow', 'skin', ['lime', 'cyan', 'gold'], 'lime');

const noopGradient = { addColorStop() {} };
const ctx = new Proxy({
  createLinearGradient: () => noopGradient,
  createRadialGradient: () => noopGradient,
  measureText: () => ({ width: 10 })
}, {
  get(target, key) {
    if (key in target) return target[key];
    return () => {};
  },
  set() { return true; }
});

const canvas = makeEl('canvas');
canvas.clientWidth = 480;
canvas.clientHeight = 576;
canvas.getContext = () => ctx;
registry.set('river', canvas);

const body = makeEl('body');
const handlers = {};
const rafQueue = [];
let rafTs = 0;

const document = {
  readyState: 'complete',
  hidden: false,
  activeElement: null,
  body,
  getElementById: (id) => registry.get(id) || null,
  createElement: (tag) => makeEl(tag),
  addEventListener(type, fn) { (handlers[type] = handlers[type] || []).push(fn); }
};

const store = new Map();
const sandbox = {
  console, Math, JSON, Date, Object, Array, Number, String, Map, Set, Promise,
  document,
  devicePixelRatio: 1,
  requestAnimationFrame: (fn) => { rafQueue.push(fn); return rafQueue.length; },
  localStorage: {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, String(value))
  },
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (id) => clearTimeout(id),
  addEventListener() {}
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
['logic.js', 'game.js'].forEach((file) => {
  vm.runInContext(fs.readFileSync(path.join(ROOT, file), 'utf8'), sandbox, { filename: file });
});

const app = sandbox.FrogGame;
const el = (id) => registry.get(id);
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function click(node) {
  (node._handlers.click || []).forEach((fn) => fn({ preventDefault() {}, target: node }));
}

function clickIn(row, btn) {
  (row._handlers.click || []).forEach((fn) => fn({ preventDefault() {}, target: btn }));
}

function pressKey(key) {
  (handlers.keydown || []).forEach((fn) => fn({ key, preventDefault() {} }));
}

function stepFrames(count) {
  for (let i = 0; i < count; i += 1) {
    const batch = rafQueue.splice(0, rafQueue.length);
    rafTs += 16;
    batch.forEach((fn) => fn(rafTs));
  }
}

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

async function main() {
  console.log('初始界面');

  check('首次进入显示开始面板与默认中级难度', () => {
    assert.strictEqual(el('startPanel').hidden, false);
    assert.strictEqual(app.settings.difficulty, 'normal');
    assert.strictEqual(app.state(), null);
    assert.strictEqual(el('levelChip').textContent, '第 1 关');
  });

  check('难度按钮切换并更新提示文案', () => {
    const hard = el('diffRow').children.filter((btn) => btn.dataset.diff === 'hard')[0];
    clickIn(el('diffRow'), hard);
    assert.strictEqual(app.settings.difficulty, 'hard');
    assert.ok(hard.classList.contains('is-on'));
    assert.ok(el('diffHint').textContent.length > 0);
    const easy = el('diffRow').children.filter((btn) => btn.dataset.diff === 'easy')[0];
    clickIn(el('diffRow'), easy);
    assert.strictEqual(app.settings.difficulty, 'easy');
  });

  console.log('对局流程');
  click(el('startBtn'));
  check('开始游戏后进入对局并隐藏设置面板', () => {
    const state = app.state();
    assert.ok(state, '状态未创建');
    assert.strictEqual(state.status, 'playing');
    assert.strictEqual(el('startPanel').hidden, true);
    assert.strictEqual(el('pauseBtn').hidden, false);
    assert.strictEqual(state.rows, 8);
  });

  check('敲对下一排字母会前进一排', () => {
    const state = app.state();
    const key = state.lanes[state.row][0].key;
    pressKey(key);
    // 首片荷叶可能是 SPACE（一次两排），因此只断言前进且未跳过终点
    assert.ok(state.row >= 1 && state.row <= 2, '未前进：' + state.row);
    assert.strictEqual(state.hits, 1);
    assert.ok(Number(el('scoreVal').textContent) > 0);
  });

  check('敲错字母扣时间并清零连击', () => {
    const state = app.state();
    const before = state.timeLeft;
    pressKey('1');
    assert.strictEqual(state.misses, 1);
    assert.strictEqual(state.combo, 0);
    assert.ok(state.timeLeft < before || state.lives < 3);
  });

  check('方向键切换候选荷叶', () => {
    const state = app.state();
    const start = state.laneIndex;
    pressKey('ArrowRight');
    assert.notStrictEqual(state.laneIndex, start);
    pressKey('ArrowLeft');
    assert.strictEqual(state.laneIndex, start);
  });

  check('提示栏渲染当前排的按键徽标', () => {
    const badges = el('promptKeys').children;
    assert.ok(badges.length >= 1);
    assert.ok(/^[A-Z0-9]$|^SPACE$/.test(badges[0].textContent), '按键提示异常：' + badges[0].textContent);
  });

  check('主循环推进时间且不报错', () => {
    const state = app.state();
    const before = state.timeLeft;
    stepFrames(4);
    assert.ok(state.timeLeft < before, '时间未推进');
  });

  check('镜头跟随青蛙所在排，后段字母继续更新', () => {
    const state = app.state();
    for (let guard = 0; guard < 12 && state.row < 6; guard += 1) {
      pressKey(state.lanes[state.row][0].key);
    }
    stepFrames(60);
    assert.ok(state.row >= 6, '未推进到第 6 排：' + state.row);
    assert.ok(Math.abs(app.view.camRow - state.row) < 0.3, '镜头未跟随当前排：' + app.view.camRow);
    assert.strictEqual(el('promptKeys').children.length, state.lanes[state.row].length);
  });

  check('暂停与继续', () => {
    pressKey('Escape');
    assert.strictEqual(app.state().status, 'paused');
    assert.strictEqual(el('pausePanel').hidden, false);
    click(el('resumeBtn'));
    assert.strictEqual(app.state().status, 'playing');
    assert.strictEqual(el('pausePanel').hidden, true);
  });

  console.log('通关结算');
  check('抵达对岸即判定通关', () => {
    const state = app.state();
    state.rows = 2;
    state.lanes = [
      [{ key: 'a', type: 'leaf', item: null, taken: false }],
      [{ key: 'a', type: 'leaf', item: null, taken: false }]
    ];
    state.timeLimit = state.timeLeft = 30;
    state.row = 0;
    state.stageMisses = 0;
    pressKey('a');
    pressKey('a');
    assert.strictEqual(state.status, 'won');
  });

  await wait(450);
  check('结算面板展示分数并给出下一关入口', () => {
    assert.strictEqual(el('result').hidden, false);
    assert.strictEqual(el('resultTitle').textContent, '抵达对岸');
    assert.ok(Number(el('resultScore').textContent) > 0);
    assert.strictEqual(el('nextBtn').hidden, false);
    assert.ok(el('resultGrid').children.length >= 4);
  });

  check('最高分写入本地存档', () => {
    const saved = JSON.parse(store.get('frog-typing.v1'));
    assert.ok(saved.highScore > 0);
    assert.strictEqual(saved.difficulty, 'easy');
  });

  click(el('nextBtn'));
  check('进入下一关后棋盘复位', () => {
    const state = app.state();
    assert.strictEqual(state.level, 2);
    assert.strictEqual(state.row, 0);
    assert.strictEqual(state.status, 'playing');
    assert.strictEqual(el('result').hidden, true);
  });

  check('重开本关重置分数与进度', () => {
    pressKey(app.state().lanes[0][0].key);
    assert.ok(app.state().row > 0);
    click(el('restartBtn'));
    assert.strictEqual(app.state().row, 0);
    assert.strictEqual(app.state().score, 0);
    assert.strictEqual(app.state().level, 1);
  });

  check('回到设置面板可以换难度', () => {
    click(el('homeBtn'));
    assert.strictEqual(el('startPanel').hidden, false);
    assert.strictEqual(app.state(), null);
    assert.strictEqual(el('pauseBtn').hidden, true);
  });

  console.log('成就存档');
  check('通关成就已记录到存档', () => {
    const saved = JSON.parse(store.get('frog-typing.v1'));
    assert.ok(saved.achievements.indexOf('clear_1') !== -1, '未记录 clear_1：' + saved.achievements);
    assert.ok(saved.achievements.indexOf('perfect') !== -1, '未记录 perfect：' + saved.achievements);
    assert.ok(saved.clears >= 1);
  });

  console.log('\n' + (process.exitCode ? '存在失败用例' : '界面冒烟通过：' + pass + ' 项'));
  process.exit(process.exitCode || 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
