/* 界面冒烟：node tests/ui.smoke.cjs（极简 DOM + Canvas 桩，验证人机/双人全流程） */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

/* ------------------------------------------------------------------ DOM 桩 */
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
    attrs: {},
    hidden: false,
    disabled: false,
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
    appendChild(child) { child.parentNode = this; this.children.push(child); return child; },
    contains(node) {
      let cur = node;
      while (cur) {
        if (cur === this) return true;
        cur = cur.parentNode;
      }
      return false;
    },
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
    getBoundingClientRect() {
      return { left: 0, top: 0, right: this.clientWidth, bottom: this.clientWidth, width: this.clientWidth, height: this.clientWidth };
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

const noopGradient = { addColorStop() {} };
const ctx = new Proxy({
  createLinearGradient: () => noopGradient,
  createRadialGradient: () => noopGradient,
  measureText: () => ({ width: 8 })
}, {
  get(target, key) {
    if (key in target) return target[key];
    return () => {};
  },
  set() { return true; }
});

const canvas = makeEl('canvas');
canvas.clientWidth = 480;
canvas.getContext = () => ctx;
canvas.setPointerCapture = () => {};
registry.set('board', canvas);

const document = {
  readyState: 'complete',
  hidden: false,
  getElementById: (id) => registry.get(id) || null,
  addEventListener() {},
  createElement: (tag) => makeEl(tag)
};

['filters'].forEach((id) => { if (!registry.has(id)) registry.set(id, makeEl('div')); });

/* 棋盘上的三档按钮（真实页面里由 HTML 声明） */
function seedSeg(rowId, key, values, active) {
  const row = registry.get(rowId);
  values.forEach((value) => {
    const btn = makeEl('button');
    btn.dataset[key] = String(value);
    if (value === active) btn.classList.add('is-on');
    row.appendChild(btn);
  });
}
seedSeg('modeRow', 'mode', ['ai', 'pvp'], 'ai');
seedSeg('sideRow', 'side', ['1', '2'], '1');
seedSeg('levelRow', 'level', ['easy', 'normal', 'hard'], 'normal');

const store = new Map();
const sandbox = {
  console, Math, JSON, Date, Object, Array, Number, String, Map, Promise, Set,
  document,
  devicePixelRatio: 1,
  requestAnimationFrame: (fn) => setTimeout(fn, 0),
  localStorage: {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, String(value))
  },
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (id) => clearTimeout(id),
  setInterval: (fn, ms) => setInterval(fn, ms),
  clearInterval: (id) => clearInterval(id),
  addEventListener() {}
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
['logic.js', 'ai.js', 'game.js'].forEach((file) => {
  vm.runInContext(fs.readFileSync(path.join(ROOT, file), 'utf8'), sandbox, { filename: file });
});
sandbox.GomokuApp = sandbox.window.GomokuApp;

/* ------------------------------------------------------------------ 断言 */
const app = sandbox.GomokuApp;
const el = (id) => registry.get(id);
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function fire(node, type, init) {
  (node._handlers[type] || []).forEach((fn) => fn(Object.assign({
    preventDefault() {},
    pointerType: 'touch',
    pointerId: 1,
    button: 0
  }, init)));
}

function tapCell(r, c) {
  const point = app.cellCenter(r, c);
  fire(canvas, 'pointerdown', { clientX: point.x, clientY: point.y });
}

function tapButton(id) {
  fire(el(id), 'click', {});
}

function tapSeg(rowId, key, value) {
  const btn = el(rowId).children.filter((child) => child.dataset[key] === String(value))[0];
  assert.ok(btn, `没有找到 ${rowId} 的 ${value} 按钮`);
  fire(el(rowId), 'click', { target: btn });
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
  const state = () => app.state();

  console.log('初始化与人机对战');
  check('默认人机对战、我方执黑、空盘', () => {
    assert.strictEqual(app.settings.mode, 'ai');
    assert.strictEqual(state().turn, sandbox.GomokuCore.BLACK);
    assert.strictEqual(state().moves.length, 0);
    assert.strictEqual(el('moveVal').textContent, '0');
  });

  tapCell(7, 7);
  check('点交叉点落下黑子', () => {
    assert.strictEqual(state().moves.length, 1);
    assert.strictEqual(state().board[7][7], sandbox.GomokuCore.BLACK);
    assert.strictEqual(el('moveVal').textContent, '1');
  });

  await wait(600);
  check('电脑自动应招', () => {
    assert.strictEqual(state().moves.length, 2);
    assert.strictEqual(state().drawing, undefined);
    assert.strictEqual(state().turn, sandbox.GomokuCore.BLACK);
  });

  const before = state().moves.length;
  tapCell(7, 7);
  check('不能落在已有棋子上', () => {
    assert.strictEqual(state().moves.length, before);
  });

  tapButton('undoBtn');
  check('悔棋退回我方落子之前', () => {
    assert.strictEqual(state().moves.length, 0);
    assert.strictEqual(el('moveVal').textContent, '0');
  });

  console.log('双人对战');
  tapSeg('modeRow', 'mode', 'pvp');
  check('切换双人模式后重新开局', () => {
    assert.strictEqual(app.settings.mode, 'pvp');
    assert.strictEqual(state().moves.length, 0);
    assert.strictEqual(el('sideGroup').hidden, true);
  });

  const winSeq = [[7, 3], [0, 0], [7, 4], [0, 1], [7, 5], [0, 2], [7, 6], [0, 3], [7, 7]];
  winSeq.forEach(([r, c]) => tapCell(r, c));
  check('双人模式黑白轮流落子并判定胜负', () => {
    assert.strictEqual(state().status, 'won');
    assert.strictEqual(state().winLine.length, 5);
    assert.strictEqual(el('result').hidden, false);
    assert.strictEqual(el('resultTitle').textContent, '黑棋胜');
  });

  const locked = state().moves.length;
  tapCell(5, 5);
  check('终局后棋盘不再响应落子', () => {
    assert.strictEqual(state().moves.length, locked);
  });

  tapButton('closeResultBtn');
  check('可以收起结算面板查看棋盘', () => {
    assert.strictEqual(el('result').hidden, true);
  });

  tapButton('restartBtn');
  check('重新开始清空棋盘', () => {
    assert.strictEqual(state().moves.length, 0);
    assert.strictEqual(state().status, 'playing');
    assert.strictEqual(el('result').hidden, true);
  });

  console.log('人机执白与战绩');
  tapSeg('modeRow', 'mode', 'ai');
  tapSeg('sideRow', 'side', '2');
  await wait(600);
  check('执白后手时电脑先落天元', () => {
    assert.strictEqual(state().moves.length, 1);
    assert.strictEqual(state().moves[0].r, 7);
    assert.strictEqual(state().moves[0].c, 7);
    assert.strictEqual(state().turn, sandbox.GomokuCore.WHITE);
  });

  tapButton('resignBtn');
  check('认输结算并记录战绩', () => {
    assert.strictEqual(el('result').hidden, false);
    assert.strictEqual(el('resultTitle').textContent, '电脑获胜');
    const saved = JSON.parse(store.get('gomoku.stats.v1'));
    assert.strictEqual(saved.losses, 1);
    assert.strictEqual(el('recordVal').textContent, '0 胜 1 负');
  });

  check('设置已持久化，下次打开沿用', () => {
    const saved = JSON.parse(store.get('gomoku.settings.v1'));
    assert.strictEqual(saved.mode, 'ai');
    assert.strictEqual(saved.side, 2);
  });

  console.log('\n' + (process.exitCode ? '存在失败用例' : '界面冒烟通过：' + pass + ' 项'));
  process.exit(process.exitCode || 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
