/* 界面冒烟：node tests/ui.smoke.cjs（极简 DOM 桩，验证建盘 / 点选落子 / 升变 / 将死 / 认输全流程） */
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
    style: {},
    _handlers: {},
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
    getAttribute(name) { return Object.prototype.hasOwnProperty.call(this.attrs, name) ? this.attrs[name] : null; },
    removeAttribute(name) { delete this.attrs[name]; },
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

const document = {
  readyState: 'complete',
  hidden: false,
  _handlers: {},
  getElementById: (id) => registry.get(id) || null,
  addEventListener(type, fn) { (this._handlers[type] = this._handlers[type] || []).push(fn); },
  createElement: (tag) => makeEl(tag)
};

/* 侧栏三档按钮（真实页面里的 HTML 声明，桩里手动补上） */
function seedSeg(rowId, key, values, active) {
  const row = registry.get(rowId);
  values.forEach((value) => {
    const btn = makeEl('button');
    btn.dataset[key] = String(value);
    if (value === active) btn.className = 'seg-btn is-on';
    row.appendChild(btn);
  });
}
seedSeg('modeRow', 'mode', ['ai', 'pvp'], 'ai');
seedSeg('sideRow', 'side', ['w', 'b'], 'w');
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
const G = sandbox.window.ChessGame;
const Core = sandbox.window.ChessCore;
const el = (id) => registry.get(id);
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function fire(node, type, init) {
  (node._handlers[type] || []).forEach((fn) => fn(Object.assign({ preventDefault() {}, button: 0 }, init)));
}

function squares() { return el('board').children; }

function squareAt(index) {
  const found = squares().filter((child) => child.dataset.i === String(index));
  assert.ok(found.length === 1, '没有找到格 ' + index);
  return found[0];
}

function clickSquare(index) { fire(squareAt(index), 'click', {}); }

function clickButton(id) {
  const node = el(id);
  assert.ok(node, '缺少按钮 ' + id);
  fire(node, 'click', {});
}

function clickSeg(rowId, key, value) {
  const btn = el(rowId).children.filter((child) => child.dataset[key] === String(value))[0];
  assert.ok(btn, '没有找到 ' + rowId + ' 的 ' + value + ' 按钮');
  fire(btn, 'click', {});
}

function pressKey(key) { (document._handlers.keydown || []).forEach((fn) => fn({ key: key, preventDefault() {} })); }

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

const FILES = 'abcdefgh';
const at = (name) => Core.idxOf(FILES.indexOf(name.charAt(0)), Number(name.charAt(1)));

async function main() {
  const st = () => G.state;
  const board = () => G.state.board;

  console.log('建盘与初始局面');
  check('生成 64 个格子', () => {
    assert.strictEqual(squares().length, 64);
  });

  check('右下角是白格（浅色），a1 是深色', () => {
    assert.ok(squareAt(63).className.indexOf('dark') < 0, 'h1 应为白格');
    assert.ok(squareAt(56).className.indexOf('dark') >= 0, 'a1 应为黑格');
  });

  check('双方各 16 子，底线车马象后王、次线 8 兵', () => {
    const pieces = board().filter(Boolean);
    assert.strictEqual(pieces.length, 32);
    assert.strictEqual(board()[at('a1')], 'wR');
    assert.strictEqual(board()[at('b1')], 'wN');
    assert.strictEqual(board()[at('c1')], 'wB');
    assert.strictEqual(board()[at('d1')], 'wQ');
    assert.strictEqual(board()[at('e1')], 'wK');
    assert.strictEqual(board()[at('a8')], 'bR');
    assert.strictEqual(board()[at('d8')], 'bQ');
    assert.strictEqual(board()[at('e8')], 'bK');
    for (let f = 0; f < 8; f += 1) {
      assert.strictEqual(board()[at(FILES.charAt(f) + '2')], 'wP');
      assert.strictEqual(board()[at(FILES.charAt(f) + '7')], 'bP');
    }
  });

  check('白先走，状态栏提示轮到自己', () => {
    assert.strictEqual(st().turn, Core.WHITE);
    assert.ok(el('statusText').textContent.indexOf('白方走棋') === 0, el('statusText').textContent);
    assert.strictEqual(el('moveCount').textContent, '0 手');
  });

  console.log('点选与落子');
  check('点 e2 兵高亮并给出 e3 / e4 两个落点', () => {
    clickSquare(at('e2'));
    assert.strictEqual(G.selected(), at('e2'));
    const targets = G.targets().slice().sort((a, b) => a - b);
    const expect = [at('e3'), at('e4')].sort((a, b) => a - b);
    assert.strictEqual(targets.join(','), expect.join(','), '落点应为 ' + expect.join(','));
    assert.ok(squareAt(at('e2')).className.indexOf('sel') >= 0);
  });

  check('Esc 取消选择', () => {
    pressKey('Escape');
    assert.strictEqual(G.selected(), -1);
    assert.strictEqual(G.targets().length, 0);
  });

  check('点白兵以外的空格不会选中', () => {
    clickSquare(at('e5'));
    assert.strictEqual(G.selected(), -1);
  });

  clickSquare(at('e2'));
  clickSquare(at('e4'));
  check('落子后轮换走棋方并写入棋谱', () => {
    assert.strictEqual(st().history.length, 1);
    assert.strictEqual(board()[at('e4')], 'wP');
    assert.strictEqual(board()[at('e2')], null);
    assert.strictEqual(el('moveCount').textContent, '1 手');
    assert.ok(el('moveList').textContent.indexOf('e4') >= 0, el('moveList').textContent);
    assert.strictEqual(G.thinking, true);
  });

  await wait(1600);
  check('电脑自动应招后轮到自己', () => {
    assert.strictEqual(st().history.length, 2);
    assert.strictEqual(st().turn, Core.WHITE);
    assert.strictEqual(G.thinking, false);
    assert.ok(el('moveList').textContent.length > 2);
  });

  clickButton('undoBtn');
  check('悔棋一次退回自己落子之前', () => {
    assert.strictEqual(st().history.length, 0);
    assert.strictEqual(el('moveCount').textContent, '0 手');
  });

  clickSquare(at('d2'));
  clickSquare(at('d4'));
  check('落子后电脑进入思考', () => {
    assert.strictEqual(G.thinking, true);
    assert.strictEqual(st().history.length, 1);
  });

  clickButton('newBtn');
  await wait(1200);
  check('思考中重开不会留下幽灵落子', () => {
    assert.strictEqual(st().history.length, 0);
    assert.strictEqual(st().turn, Core.WHITE);
    assert.strictEqual(G.thinking, false);
  });

  console.log('兵升变');
  clickSeg('modeRow', 'mode', 'pvp');
  check('切换双人模式后重新开局', () => {
    assert.strictEqual(G.app.mode, 'pvp');
    assert.strictEqual(st().history.length, 0);
    assert.strictEqual(el('sideGroup').hidden, true);
    assert.strictEqual(el('levelGroup').hidden, true);
  });

  G.app.state = Core.fromFEN('4k3/1P6/8/8/8/8/8/4K3 w - - 0 1');
  G.render();
  clickSquare(at('b7'));
  clickSquare(at('b8'));
  check('兵到底线弹出四选一升变', () => {
    assert.strictEqual(el('promote').hidden, false);
    assert.strictEqual(el('promoRow').children.length, 4);
    assert.strictEqual(st().history.length, 0);
  });

  fire(el('promoRow').children[1], 'click', {});
  check('选择车后兵升变为车', () => {
    assert.strictEqual(el('promote').hidden, true);
    assert.strictEqual(board()[at('b8')], 'wR');
    assert.strictEqual(st().history.length, 1);
    assert.ok(el('moveList').textContent.indexOf('=R') >= 0, el('moveList').textContent);
  });

  console.log('将死判定');
  clickButton('newBtn');
  check('新开一局清空局面', () => {
    assert.strictEqual(st().history.length, 0);
    assert.strictEqual(el('moveCount').textContent, '0 手');
    assert.strictEqual(el('result').hidden, true);
  });

  const fool = ['f2', 'f3', 'e7', 'e5', 'g2', 'g4', 'd8', 'h4'];
  fool.forEach((name) => clickSquare(at(name)));
  check('双人模式走出四步杀，判黑方将死取胜', () => {
    assert.strictEqual(st().status, 'checkmate');
    assert.strictEqual(st().winner, Core.BLACK);
    assert.strictEqual(st().reason, 'checkmate');
    assert.strictEqual(G.over, true);
    assert.strictEqual(el('result').hidden, false);
    assert.strictEqual(el('resultTitle').textContent, '黑方胜');
    assert.ok(el('resultCopy').textContent.indexOf('将死') >= 0);
  });

  const locked = st().history.length;
  clickSquare(at('a2'));
  check('终局后棋盘不再响应', () => {
    assert.strictEqual(st().history.length, locked);
  });

  clickButton('reviewBtn');
  check('可以收起结算面板回看棋盘', () => {
    assert.strictEqual(el('result').hidden, true);
  });

  console.log('认输与设置');
  clickSeg('modeRow', 'mode', 'ai');
  clickButton('resignBtn');
  check('认输结算并写入战绩', () => {
    assert.strictEqual(el('result').hidden, false);
    assert.strictEqual(el('resultTitle').textContent, '你认输了');
    assert.strictEqual(G.record.losses, 1);
    assert.strictEqual(el('recVal').textContent, '0 胜 0 和 1 负');
    const saved = JSON.parse(store.get('chess.v1'));
    assert.strictEqual(saved.record.losses, 1);
    assert.strictEqual(saved.mode, 'ai');
  });

  clickSeg('sideRow', 'side', 'b');
  check('执黑后行时棋盘翻转', () => {
    assert.strictEqual(G.app.side, 'b');
    assert.strictEqual(G.app.flipped, true);
    assert.strictEqual(squares()[0].dataset.i, '63');
    assert.strictEqual(st().history.length, 0);
  });

  await wait(1600);
  check('电脑执白先行落子', () => {
    assert.strictEqual(st().history.length, 1);
    assert.strictEqual(st().turn, Core.BLACK);
    assert.strictEqual(el('statusText').textContent.indexOf('黑方走棋'), 0);
  });

  clickButton('flipBtn');
  check('翻转按钮恢复正常视角', () => {
    assert.strictEqual(G.app.flipped, false);
    assert.strictEqual(squares()[0].dataset.i, '0');
  });

  clickButton('undoBtn');
  check('执黑悔棋后电脑重新进入思考', () => {
    assert.strictEqual(st().history.length, 0);
    assert.strictEqual(G.thinking, true);
  });

  await wait(1600);
  check('电脑补回先手的一步棋', () => {
    assert.strictEqual(st().history.length, 1);
    assert.strictEqual(st().turn, Core.BLACK);
  });

  check('设置已持久化', () => {
    const saved = JSON.parse(store.get('chess.v1'));
    assert.strictEqual(saved.side, 'b');
    assert.strictEqual(saved.level, 'normal');
  });

  console.log('\n' + (process.exitCode ? '存在失败用例' : '界面冒烟通过：' + pass + ' 项'));
  process.exit(process.exitCode || 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
