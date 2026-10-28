/* 界面冒烟：node tests/ui.smoke.cjs（极简 DOM 桩，验证建盘 / 点选落子 / 吃子 / 悔棋 / 翻转 / 结算 / 电脑） */
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
seedSeg('sideRow', 'side', ['r', 'b'], 'r');
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
const G = sandbox.window.XiangqiGame;
const Core = sandbox.window.XiangqiCore;
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

function at(name) {
  return Core.idxOf('abcdefghi'.indexOf(name.charAt(0)), 10 - Number(name.slice(1)));
}
function fire(node, type, init) {
  const ev = Object.assign({ preventDefault() {}, button: 0, currentTarget: node }, init);
  (node._handlers[type] || []).forEach((fn) => fn(ev));
}
function points() { return el('pieces').children; }
function pointAt(index) {
  const found = points().filter((child) => child.dataset.i === String(index));
  assert.ok(found.length === 1, '没有找到交叉点 ' + index);
  return found[0];
}
function clickAt(index) { fire(pointAt(index), 'click', {}); }
function clickButton(id) { fire(el(id), 'click', {}); }
function clickSeg(rowId, key, value) {
  const row = el(rowId);
  const btn = row.children.filter((child) => child.dataset[key] === String(value))[0];
  assert.ok(btn, '没有找到 ' + rowId + ' 的 ' + value);
  fire(row, 'click', { target: { closest: () => btn } });
}
function styleOf(index, key) { return pointAt(index).style.getPropertyValue(key); }

async function main() {
  console.log('建盘与渲染');

  check('棋盘画出 90 个交叉点与 30 条线', () => {
    assert.strictEqual(points().length, 90);
    /* 10 横 + 左右两边线 + 中间 7 条各断两段 + 4 条九宫斜线 */
    assert.strictEqual(el('grid').children.length, 30);
  });

  check('开局红方在下、黑将在上', () => {
    assert.strictEqual(styleOf(at('e1'), '--row'), '9');
    assert.strictEqual(styleOf(at('e1'), '--col'), '4');
    assert.strictEqual(styleOf(at('e10'), '--row'), '0');
    assert.strictEqual(pointAt(at('e1')).firstChild.textContent, '帅');
    assert.strictEqual(pointAt(at('e10')).firstChild.textContent, '将');
    assert.strictEqual(pointAt(at('a1')).firstChild.textContent, '车');
    assert.strictEqual(pointAt(at('b3')).firstChild.textContent, '炮');
    assert.strictEqual(el('statusText').textContent, '红方走棋');
    assert.strictEqual(el('moveCount').textContent, '0 手');
  });

  check('点自己的棋子会高亮可走点', () => {
    clickAt(at('b3'));
    const targets = G.targets();
    assert.ok(targets.indexOf(at('b4')) >= 0, '炮应当能上一步');
    assert.ok(targets.indexOf(at('a3')) >= 0, '炮应当能左移');
    assert.ok(targets.indexOf(at('b2')) >= 0, '炮应当能退一步');
    assert.ok(targets.indexOf(at('b8')) < 0, '没炮架时不能吃黑炮');
    assert.ok(pointAt(at('b3')).classList.contains('is-sel'));
    assert.ok(pointAt(at('b4')).classList.contains('is-target'));
  });

  check('点空格取消选择', () => {
    clickAt(at('e5'));
    assert.strictEqual(G.targets().length, 0);
    assert.strictEqual(pointAt(at('b3')).classList.contains('is-sel'), false);
  });

  console.log('双人对弈');

  clickSeg('modeRow', 'mode', 'pvp');

  check('切到双人模式会重开一局', () => {
    assert.strictEqual(G.app.mode, 'pvp');
    assert.strictEqual(st().history.length, 0);
    assert.strictEqual(el('sideGroup').hidden, true);
    assert.strictEqual(el('levelGroup').hidden, true);
  });

  check('红炮平走一步后轮到黑方', () => {
    clickAt(at('b3'));
    clickAt(at('b4'));
    assert.strictEqual(st().history.length, 1);
    assert.strictEqual(st().turn, Core.BLACK);
    assert.strictEqual(el('moveCount').textContent, '1 手');
    assert.strictEqual(el('moveList').children[0].textContent, '红炮 b3-b4');
    assert.strictEqual(el('statusText').textContent, '黑方走棋');
  });

  check('黑方走子后棋谱累加', () => {
    clickAt(at('b8'));
    clickAt(at('b7'));
    assert.strictEqual(st().history.length, 2);
    assert.strictEqual(st().turn, Core.RED);
    assert.strictEqual(el('moveList').children[1].textContent, '黑炮 b8-b7');
  });

  check('吃子进入被吃子栏并算子力', () => {
    clickAt(at('e4'));
    clickAt(at('e5'));
    clickAt(at('e7'));
    clickAt(at('e6'));
    clickAt(at('e5'));
    clickAt(at('e6'));
    assert.strictEqual(st().history.length, 5);
    assert.strictEqual(st().history[4].move.captured, 'bP');
    assert.strictEqual(el('capturedR').textContent, '卒');
    assert.strictEqual(el('capturedB').textContent, '—');
    assert.strictEqual(el('materialNote').textContent, '红方多 100');
  });

  check('悔棋回退一步并恢复棋子', () => {
    clickButton('undoBtn');
    assert.strictEqual(st().history.length, 4);
    assert.strictEqual(st().board[at('e6')], 'bP');
    assert.strictEqual(el('capturedR').textContent, '—');
  });

  check('翻转棋盘后红帅移到顶端', () => {
    clickButton('flipBtn');
    assert.strictEqual(G.app.flipped, true);
    assert.strictEqual(styleOf(at('e1'), '--row'), '0');
    assert.strictEqual(styleOf(at('e10'), '--row'), '9');
  });

  check('认输立即结算', () => {
    clickButton('resignBtn');
    assert.strictEqual(G.app.over, true);
    assert.strictEqual(el('result').hidden, false);
    assert.strictEqual(el('resultTitle').textContent, '黑方胜');
    assert.ok(el('resultCopy').textContent.indexOf('认输') >= 0);
  });

  check('再来一局会清空棋盘状态', () => {
    clickButton('againBtn');
    assert.strictEqual(st().history.length, 0);
    assert.strictEqual(G.app.over, false);
    assert.strictEqual(el('result').hidden, true);
    assert.strictEqual(st().board[at('e6')], null);
    assert.strictEqual(pointAt(at('e6')).firstChild.textContent, '');
  });

  console.log('人机对战');

  clickSeg('modeRow', 'mode', 'ai');
  clickSeg('sideRow', 'side', 'b');

  check('执黑时棋盘自动翻转并轮到电脑先行', () => {
    assert.strictEqual(G.app.mode, 'ai');
    assert.strictEqual(G.app.side, 'b');
    assert.strictEqual(G.app.flipped, true);
    assert.strictEqual(G.app.thinking, true);
    assert.strictEqual(st().history.length, 0);
  });

  await wait(1200);

  check('电脑替红方走出第一步', () => {
    assert.strictEqual(st().history.length, 1);
    assert.strictEqual(st().turn, Core.BLACK);
    assert.strictEqual(G.app.thinking, false);
    assert.strictEqual(el('moveList').children.length, 1);
  });

  check('玩家执黑可以正常落子', () => {
    const piece = Core.legalMoves(st())[0];
    clickAt(piece.from);
    clickAt(piece.to);
    assert.strictEqual(st().history.length, 2);
    assert.strictEqual(st().turn, Core.RED);
  });

  clickButton('newBtn');
  await wait(1200);
  check('重开后仍是电脑先走，且不残留旧计时器落子', () => {
    assert.strictEqual(st().history.length, 1);
    assert.strictEqual(st().turn, Core.BLACK);
    assert.strictEqual(G.app.over, false);
  });

  check('人机执黑悔棋后电脑补回先手', () => {
    clickButton('undoBtn');
    assert.strictEqual(st().history.length, 0);
    assert.strictEqual(G.app.thinking, true);
  });

  await wait(1200);
  check('电脑重新走回第一步', () => {
    assert.strictEqual(st().history.length, 1);
    assert.strictEqual(st().turn, Core.BLACK);
  });

  check('设置已写入存档', () => {
    const saved = JSON.parse(store.get('xiangqi.v1'));
    assert.strictEqual(saved.mode, 'ai');
    assert.strictEqual(saved.side, 'b');
    assert.strictEqual(saved.level, 'normal');
    assert.ok(saved.record);
  });

  console.log('\n' + (process.exitCode ? '存在失败用例' : '界面冒烟通过：' + pass + ' 项'));
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
