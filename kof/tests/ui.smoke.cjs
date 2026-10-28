/* 界面冒烟：node tests/ui.smoke.cjs（DOM + Canvas 桩，覆盖开局、操作、暂停、KO、结算、存档） */
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
  if (selector.indexOf('.') === 0) return node.classList.contains(selector.slice(1));
  if (selector.indexOf('[') === 0 && selector.indexOf(']') === selector.length - 1) {
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
    clientWidth: 1280,
    clientHeight: 720,
    offsetWidth: 0,
    style: {},
    _handlers: {},
    classList: {
      _set: new Set(),
      add() { for (let i = 0; i < arguments.length; i += 1) this._set.add(arguments[i]); },
      remove() { for (let i = 0; i < arguments.length; i += 1) this._set.delete(arguments[i]); },
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
    closest(selector) {
      let node = this;
      while (node) {
        if (matches(node, selector)) return node;
        node = node.parentNode;
      }
      return null;
    },
    getBoundingClientRect() { return { left: 0, top: 0, width: 640, height: 360 }; },
    get className() { return Array.from(this.classList._set).join(' '); },
    set className(value) { this.classList._set = new Set(String(value).split(/\s+/).filter(Boolean)); },
    get textContent() { return this._text + this.children.map((c) => c.textContent).join(''); },
    set textContent(value) { this._text = String(value); this.children = []; }
  };
  return el;
}

const ids = Array.from(html.matchAll(/id="([^"]+)"/g), (m) => m[1]);
const registry = new Map(ids.map((id) => [id, makeEl('div')]));

function seedSeg(rowId, key, values, active) {
  const row = registry.get(rowId);
  values.forEach((value) => {
    const btn = makeEl('button');
    btn.dataset[key] = value;
    if (value === active) btn.classList.add('is-on');
    row.appendChild(btn);
  });
}
seedSeg('diffRow', 'diff', ['easy', 'normal', 'hard'], 'normal');
seedSeg('modeRow', 'mode', ['cpu', 'vs'], 'cpu');

const noopGradient = { addColorStop() {} };
const ctx = new Proxy({
  createLinearGradient: () => noopGradient,
  createRadialGradient: () => noopGradient,
  measureText: () => ({ width: 10 })
}, {
  get(target, key) { return key in target ? target[key] : () => {}; },
  set() { return true; }
});

const canvas = registry.get('screen');
canvas.getContext = () => ctx;

const handlers = {};
const rafQueue = [];
let rafTs = 0;

const document = {
  readyState: 'complete',
  hidden: false,
  body: makeEl('body'),
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
  addEventListener(type, fn) { (handlers[type] = handlers[type] || []).push(fn); }
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
['logic.js', 'game.js'].forEach((file) => {
  vm.runInContext(fs.readFileSync(path.join(ROOT, file), 'utf8'), sandbox, { filename: file });
});

const app = sandbox.KofGame;
const el = (id) => registry.get(id);
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function click(node) {
  (node._handlers.click || []).forEach((fn) => fn({ preventDefault() {}, target: node }));
}

function clickIn(row, btn) {
  (row._handlers.click || []).forEach((fn) => fn({ preventDefault() {}, target: btn }));
}

function keyDown(code, key) {
  (handlers.keydown || []).forEach((fn) => fn({ code, key: key || code, preventDefault() {} }));
}

function keyUp(code) {
  (handlers.keyup || []).forEach((fn) => fn({ code, key: code }));
}

function frames(count) {
  for (let i = 0; i < count; i += 1) {
    const batch = rafQueue.splice(0, rafQueue.length);
    rafTs += 16;
    batch.forEach((fn) => fn(rafTs));
  }
}

function steps(count) {
  for (let i = 0; i < count; i += 1) app.step(1 / 60);
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

  check('首次进入显示菜单、无对局、默认中级', () => {
    assert.strictEqual(el('menu').hidden, false);
    assert.strictEqual(app.match, null);
    assert.strictEqual(app.settings.difficulty, 'normal');
    assert.strictEqual(app.settings.mode, 'cpu');
  });

  check('难度与模式按钮切换并更新说明', () => {
    clickIn(el('diffRow'), el('diffRow').children[2]);
    assert.strictEqual(app.settings.difficulty, 'hard');
    assert.ok(el('diffRow').children[2].classList.contains('is-on'));
    assert.ok(el('diffHint').textContent.length > 0);

    clickIn(el('modeRow'), el('modeRow').children[1]);
    assert.strictEqual(app.settings.mode, 'vs');
    assert.strictEqual(el('modeHint').textContent, '双人对战');

    clickIn(el('diffRow'), el('diffRow').children[1]);
    assert.strictEqual(app.settings.difficulty, 'normal');
    // 后续流程固定在双人模式，避免电脑乱入干扰断言
  });

  console.log('开局与操作');
  click(el('startBtn'));

  check('开始对战后进入第一回合', () => {
    const m = app.match;
    assert.ok(m, '未创建对局');
    assert.strictEqual(m.phase, 'fight');
    assert.strictEqual(m.round, 1);
    assert.strictEqual(m.fighters[0].hp, 100);
    assert.strictEqual(el('menu').hidden, true);
    assert.strictEqual(el('hp0').style.width, '100%');
    assert.strictEqual(el('hp1').style.width, '100%');
    assert.ok(el('name1').textContent.indexOf('2P') === 0, '2P 名牌未更新：' + el('name1').textContent);
  });

  check('主循环推进计时', () => {
    const before = app.match.timer;
    frames(6);
    assert.ok(app.match.timer < before, '计时未推进');
    assert.ok(Number(el('timer').textContent) <= 60);
  });

  check('按 D 前进、按 A 后退', () => {
    const f = app.match.fighters[0];
    const startX = f.x;
    keyDown('KeyD', 'd');
    steps(20);
    assert.ok(f.x > startX + 30, '没有前进：' + f.x);
    keyUp('KeyD');
    const midX = f.x;
    keyDown('KeyA', 'a');
    steps(20);
    assert.ok(f.x < midX, '没有后退：' + f.x);
    keyUp('KeyA', 'a');
  });

  check('按 J 出轻拳、按 K 出重腿', () => {
    const f = app.match.fighters[0];
    keyDown('KeyJ', 'j');
    app.step(1 / 60);
    assert.strictEqual(f.state, 'attack');
    assert.strictEqual(f.attack, 'light');
    keyUp('KeyJ');
    steps(40);

    keyDown('KeyK', 'k');
    app.step(1 / 60);
    assert.strictEqual(f.attack, 'heavy');
    keyUp('KeyK');
    steps(50);
  });

  check('暂停与继续', () => {
    keyDown('Escape', 'Escape');
    assert.strictEqual(app.settings.paused, true);
    assert.strictEqual(el('pausePanel').hidden, false);
    const timer = app.match.timer;
    frames(10);
    assert.strictEqual(app.match.timer, timer, '暂停后仍在计时');

    click(el('resumeBtn'));
    assert.strictEqual(app.settings.paused, false);
    assert.strictEqual(el('pausePanel').hidden, true);
  });

  console.log('KO 与结算');

  check('打空血触发 K.O. 并计分', () => {
    const m = app.match;
    m.fighters[0].x = 600;
    m.fighters[1].x = 690;
    m.fighters[1].hp = 5;
    keyDown('KeyK', 'k');
    steps(40);
    keyUp('KeyK');
    assert.strictEqual(m.fighters[1].hp, 0);
    assert.strictEqual(m.wins[0], 1);
    assert.strictEqual(el('bannerMain').textContent, 'K.O.');
    assert.ok(Number(el('statHits').textContent) >= 0);
  });

  check('回合结束后自动进入第二回合', () => {
    steps(160);
    const m = app.match;
    assert.strictEqual(m.round, 2);
    assert.strictEqual(m.fighters[1].hp, 100);
    assert.strictEqual(el('hp1').style.width, '100%');
  });

  check('再赢一回合后整场结束', () => {
    const m = app.match;
    m.fighters[0].x = 600;
    m.fighters[1].x = 690;
    m.fighters[1].hp = 5;
    m.timer = 30;
    keyDown('KeyK', 'k');
    steps(60);
    keyUp('KeyK');
    steps(200);
    assert.strictEqual(m.phase, 'matchEnd');
    assert.strictEqual(m.matchWinner, 0);
  });

  await wait(1000);

  check('结算面板展示胜负与数据', () => {
    assert.strictEqual(el('result').hidden, false);
    assert.strictEqual(el('resultTitle').textContent, 'WINNER');
    assert.ok(Number(el('statDamage').textContent) > 0);
    assert.ok(Number(el('statCombo').textContent) >= 1);
  });

  check('战绩写入本地存档', () => {
    const saved = JSON.parse(store.get('kof.v1'));
    assert.strictEqual(saved.record.matches, 1);
    assert.strictEqual(saved.record.wins, 1);
    assert.strictEqual(saved.record.loses, 0);
    assert.strictEqual(el('recWins').textContent, '1');
  });

  check('再战一场会开新对局', () => {
    click(el('againBtn'));
    assert.strictEqual(el('result').hidden, true);
    assert.strictEqual(app.match.round, 1);
    assert.strictEqual(app.match.wins[0], 0);
    assert.strictEqual(app.match.phase, 'fight');
  });

  check('返回菜单清空对局', () => {
    app.pause();
    assert.strictEqual(el('pausePanel').hidden, false);
    click(el('quitBtn'));
    assert.strictEqual(app.match, null);
    assert.strictEqual(el('menu').hidden, false);
    assert.strictEqual(el('pausePanel').hidden, true);
  });

  check('渲染不抛错（精灵缺失时用矢量角色兜底）', () => {
    app.start();
    frames(4);
    assert.ok(app.match);
    app.quit();
  });

  console.log('\n' + (process.exitCode ? '存在失败用例' : '界面冒烟通过：' + pass + ' 项'));
  process.exit(process.exitCode || 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
