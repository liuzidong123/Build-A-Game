/* 界面冒烟：node tests/ui.smoke.cjs（极简 DOM 桩，覆盖建盘 / 落子 / 提子 / 禁着 / 打劫 / 虚手数子 / 悔棋 / 认输 / 电脑） */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

/* ------------------------------------------------------------------ DOM 桩 */
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
    type: '',
    title: '',
    scrollTop: 0,
    scrollHeight: 0,
    _handlers: {},
    style: {
      _props: {},
      setProperty(name, value) { this._props[name] = String(value); },
      getPropertyValue(name) { return this._props[name] || ''; }
    },
    classList: {
      _set: new Set(),
      add(name) { this._set.add(name); },
      remove(name) { this._set.delete(name); },
      contains(name) { return this._set.has(name); },
      toggle(name, force) {
        const on = force === undefined ? !this._set.has(name) : !!force;
        if (on) this._set.add(name);
        else this._set.delete(name);
        return on;
      }
    },
    get firstChild() { return this.children[0] || null; },
    addEventListener(type, fn) { (this._handlers[type] = this._handlers[type] || []).push(fn); },
    removeEventListener(type, fn) {
      const list = this._handlers[type] || [];
      const at = list.indexOf(fn);
      if (at >= 0) list.splice(at, 1);
    },
    appendChild(child) { child.parentNode = this; this.children.push(child); return child; },
    removeChild(child) {
      const at = this.children.indexOf(child);
      if (at >= 0) this.children.splice(at, 1);
      return child;
    },
    setAttribute(name, value) { this.attrs[name] = String(value); },
    getAttribute(name) {
      return Object.prototype.hasOwnProperty.call(this.attrs, name) ? this.attrs[name] : null;
    },
    removeAttribute(name) { delete this.attrs[name]; },
    get textContent() {
      return this._text + this.children.map((child) => child.textContent).join('');
    },
    set textContent(value) {
      this._text = String(value);
      this.children = [];
    },
    set innerHTML(value) {
      this._text = '';
      this.children = [];
      if (String(value)) this._text = String(value);
    },
    get innerHTML() { return this._text; }
  };
  return el;
}

const ids = Array.from(html.matchAll(/id="([^"]+)"/g), (m) => m[1]);
const registry = new Map(ids.map((id) => [id, makeEl('div')]));

const document = {
  readyState: 'complete',
  hidden: false,
  _handlers: {},
  getElementById: (id) => registry.get(id) || null,
  addEventListener(type, fn) { (this._handlers[type] = this._handlers[type] || []).push(fn); },
  createElement: (tag) => makeEl(tag),
  createElementNS: (ns, tag) => makeEl(tag)
};

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
seedSeg('sideRow', 'side', ['b', 'w'], 'b');
seedSeg('levelRow', 'level', ['easy', 'normal', 'hard'], 'normal');

const store = new Map();
const sandbox = {
  console, Math, JSON, Date, Object, Array, Number, String, Map, Promise, Set,
  document,
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
['logic.js', 'ai.js', 'game.js'].forEach((file) => {
  vm.runInContext(fs.readFileSync(path.join(ROOT, file), 'utf8'), sandbox, { filename: file });
});

/* ------------------------------------------------------------------ 断言 */
const G = sandbox.window.GoGame;
const Core = sandbox.window.GoCore;
const el = (id) => registry.get(id);
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const st = () => G.state;

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

function at(name) { return Core.parseCoord(name); }
function fire(node, type, init) {
  const ev = Object.assign({ preventDefault() {}, button: 0, currentTarget: node }, init);
  (node._handlers[type] || []).forEach((fn) => fn(ev));
}
function points() { return el('points').children; }
function pointAt(index) {
  const found = points().filter((child) => child.dataset.i === String(index));
  assert.ok(found.length === 1, '没有找到交叉点 ' + index);
  return found[0];
}
function stoneAt(index) { return pointAt(index).firstChild; }
function clickAt(index) { fire(pointAt(index), 'click', {}); }
function clickButton(id) { fire(el(id), 'click', {}); }
function clickSeg(rowId, key, value) {
  const row = el(rowId);
  const btn = row.children.filter((child) => child.dataset[key] === String(value))[0];
  assert.ok(btn, '没有找到 ' + rowId + ' 的 ' + value);
  fire(row, 'click', { target: { closest: () => btn } });
}

/* 直接把局面摆到棋盘上，然后重绘 */
function setup(list, turn) {
  G.newGame();
  G.setMode('pvp');
  const state = st();
  state.board.fill(null);
  list.forEach((item) => { state.board[at(item[0])] = item[1] === 'X' ? Core.BLACK : Core.WHITE; });
  state.turn = turn || Core.BLACK;
  G.render();
  G.syncAll();
  return state;
}

async function main() {
  console.log('建盘与渲染');

  check('棋盘画出 361 个交叉点与 47 条线（含 9 个星位）', () => {
    assert.strictEqual(points().length, 361);
    assert.strictEqual(el('grid').children.length, 47);
  });

  check('开局空盘、黑先、状态与按钮就绪', () => {
    G.newGame();
    const state = st();
    assert.strictEqual(state.board.filter(Boolean).length, 0);
    assert.strictEqual(state.turn, Core.BLACK);
    assert.strictEqual(el('statusText').textContent, '黑方落子');
    assert.strictEqual(el('moveCount').textContent, '0 手');
    assert.strictEqual(el('capB').textContent, '0');
    assert.strictEqual(el('result').hidden, true);
    assert.strictEqual(stoneAt(at('K10')).classList.contains('empty'), true);
  });

  console.log('落子与提子');

  check('点空点落子，黑白交替并能悔棋', () => {
    G.setMode('pvp');
    G.newGame();
    clickAt(at('Q16'));
    assert.strictEqual(st().board[at('Q16')], Core.BLACK);
    assert.strictEqual(stoneAt(at('Q16')).classList.contains('b'), true);
    assert.strictEqual(pointAt(at('Q16')).classList.contains('is-last'), true);
    assert.strictEqual(el('statusText').textContent, '白方落子');
    clickAt(at('D4'));
    assert.strictEqual(st().board[at('D4')], Core.WHITE);
    assert.strictEqual(st().history.length, 2);
    assert.strictEqual(el('moveList').children.length, 2);
    clickButton('undoBtn');
    assert.strictEqual(st().history.length, 1);
    assert.strictEqual(st().board[at('D4')], null);
  });

  check('棋子已有子时点击无效并提示', () => {
    G.setMode('pvp');
    G.newGame();
    clickAt(at('Q16'));
    clickAt(at('Q16'));
    assert.strictEqual(st().history.length, 1);
    assert.ok(el('statusText').textContent.indexOf('已经有子') >= 0);
  });

  check('提子后计数、棋谱与提子标记同步', () => {
    setup([['J10', 'O'], ['J11', 'X'], ['K10', 'X'], ['J9', 'X']], Core.BLACK);
    clickAt(at('H10'));
    assert.strictEqual(st().captures.b, 1);
    assert.strictEqual(st().board[at('J10')], null);
    assert.strictEqual(el('capB').textContent, '1');
    assert.strictEqual(el('scoreNote').textContent, '黑提 1 · 白提 0');
    assert.ok(el('moveList').children[0].textContent.indexOf('提1') >= 0);
  });

  console.log('禁着与打劫');

  check('自杀点被拒绝并提示', () => {
    setup([['A2', 'O'], ['B1', 'O']], Core.BLACK);
    clickAt(at('A1'));
    assert.strictEqual(st().board[at('A1')], null);
    assert.strictEqual(st().history.length, 0);
    assert.ok(el('statusText').textContent.indexOf('不能自杀') >= 0);
  });

  check('劫点被拒绝，换处落子后解除', () => {
    setup([
      ['C19', 'O'], ['B19', 'X'],
      ['A18', 'X'], ['B18', 'O'], ['D18', 'O'],
      ['C17', 'O'], ['B17', 'X']
    ], Core.BLACK);
    clickAt(at('C18'));
    assert.strictEqual(st().captures.b, 1);
    assert.strictEqual(st().ko, at('B18'));
    assert.strictEqual(pointAt(at('B18')).classList.contains('is-ko'), true);
    clickAt(at('B18'));
    assert.strictEqual(st().history.length, 1, '回提被拒绝');
    assert.ok(el('statusText').textContent.indexOf('劫禁') >= 0);
  });

  console.log('虚手与终局');

  check('虚手一次换手，两次后数子结算', () => {
    setup([['D16', 'X'], ['Q4', 'O']], Core.BLACK);
    clickButton('passBtn');
    assert.strictEqual(st().passes, 1);
    assert.strictEqual(st().turn, Core.WHITE);
    assert.ok(el('statusText').textContent.indexOf('对方已虚手') >= 0);
    clickButton('passBtn');
    assert.strictEqual(st().status, 'scored');
    assert.strictEqual(el('result').hidden, false);
    assert.strictEqual(el('resultKicker').textContent, '数子结果');
    assert.strictEqual(el('resultTitle').textContent, '白方胜');
    assert.strictEqual(G.app.over, true);
  });

  check('数子终局后可以悔棋继续下', () => {
    clickButton('undoBtn');
    assert.strictEqual(st().status, 'playing');
    assert.strictEqual(el('result').hidden, true);
    assert.strictEqual(G.app.over, false);
  });

  check('认输直接结束', () => {
    G.setMode('pvp');
    G.newGame();
    clickAt(at('Q16'));
    clickButton('resignBtn');
    assert.strictEqual(st().status, 'resign');
    assert.strictEqual(el('resultTitle').textContent, '黑方胜', '轮到白方认输，黑方胜');
    assert.strictEqual(el('result').hidden, false);
  });

  console.log('模式与电脑');

  check('切双人隐藏执子与棋力', () => {
    clickSeg('modeRow', 'mode', 'pvp');
    assert.strictEqual(el('sideGroup').hidden, true);
    assert.strictEqual(el('levelGroup').hidden, true);
  });

  clickSeg('modeRow', 'mode', 'ai');
  clickSeg('sideRow', 'side', 'w');
  check('人机执白时电脑开始思考', () => {
    assert.strictEqual(G.app.thinking, true);
    assert.strictEqual(el('statusText').textContent, '电脑思考中…');
  });

  await wait(800);

  check('电脑先手落子后轮到玩家', () => {
    assert.strictEqual(st().history.length, 1, '电脑应落下一子');
    assert.strictEqual(st().turn, Core.WHITE, '轮到玩家执白');
    assert.strictEqual(G.app.thinking, false);
    assert.strictEqual(el('moveList').children.length, 1);
  });

  check('三档棋力可以切换', () => {
    clickSeg('levelRow', 'level', 'easy');
    assert.strictEqual(G.app.level, 'easy');
    clickSeg('levelRow', 'level', 'hard');
    assert.strictEqual(G.app.level, 'hard');
  });

  console.log('\n' + (process.exitCode ? '存在失败用例' : '界面冒烟通过：' + pass + ' 项'));
}

main();
