/* 界面控制层冒烟：自带极简 DOM 桩，验证「开局 → 答错 → 看答案 → 答对 → 结算 → 上榜 → 超时」无异常 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

function makeEl(id) {
  const el = {
    id,
    children: [],
    _html: '',
    _text: '',
    hidden: false,
    disabled: false,
    value: '',
    offsetWidth: 120,
    _handlers: {},
    style: { setProperty() {} },
    classList: {
      _set: new Set(),
      add() { for (const c of arguments) this._set.add(c); },
      remove() { for (const c of arguments) this._set.delete(c); },
      toggle(c, force) {
        const on = force === undefined ? !this._set.has(c) : !!force;
        if (on) this._set.add(c); else this._set.delete(c);
        return on;
      },
      contains(c) { return this._set.has(c); }
    },
    addEventListener(type, fn) { (this._handlers[type] = this._handlers[type] || []).push(fn); },
    appendChild(child) { this.children.push(child); return child; },
    removeChild(child) {
      const i = this.children.indexOf(child);
      if (i >= 0) this.children.splice(i, 1);
      return child;
    },
    get firstChild() { return this.children[0] || null; },
    get className() { return Array.from(this.classList._set).join(' '); },
    set className(value) {
      this.classList._set = new Set(String(value).split(/\s+/).filter(Boolean));
    },
    focus() {}, select() {}, click() {},
    getContext() { return null; },
    set innerHTML(value) {
      this._html = String(value);
      this.children = Array.from(this._html.matchAll(/<span class="([^"]*)"/g), (m) => {
        const child = makeEl('span');
        child.className = m[1];
        return child;
      });
    },
    get innerHTML() { return this._html; },
    set textContent(value) { this._text = String(value); },
    get textContent() { return this._text; }
  };
  return el;
}

const ids = Array.from(html.matchAll(/id="([^"]+)"/g), (m) => m[1]);
const registry = new Map(ids.map((id) => [id, makeEl(id)]));

const store = new Map();
let fakeNow = 1760000000000;
function FakeDate() { return new Date(fakeNow); }
FakeDate.now = function () { return fakeNow; };
FakeDate.prototype = Date.prototype;

const timers = [];
const sandbox = {
  console,
  Math,
  JSON,
  Date: FakeDate,
  String,
  Number,
  parseInt,
  performance: { now: () => fakeNow },
  devicePixelRatio: 2,
  innerWidth: 390,
  innerHeight: 844,
  scrollTo() {},
  confirm: () => true,
  requestAnimationFrame: () => 0,
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (id) => clearTimeout(id),
  setInterval: (fn) => { sandbox.__tick = fn; return 1; },
  clearInterval() {},
  localStorage: {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v))
  },
  document: {
    hidden: false,
    body: makeEl('body'),
    getElementById: (id) => registry.get(id) || null,
    addEventListener() {},
    createElement: (tag) => makeEl(tag)
  },
  addEventListener() {}
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
vm.createContext(sandbox);

['data.js', 'logic.js', 'game.js'].forEach((file) => {
  vm.runInContext(fs.readFileSync(path.join(ROOT, file), 'utf8'), sandbox, { filename: file });
});

const BANK = sandbox.IDIOM_BANK;
const el = (id) => registry.get(id);
const fire = (id, type, event) => {
  const handlers = (el(id)._handlers[type] || []).slice();
  handlers.forEach((fn) => fn(event || { preventDefault() {} }));
};
const flush = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function check(name, fn) {
  try {
    fn();
    console.log('  PASS  ' + name);
  } catch (err) {
    console.log('  FAIL  ' + name + '\n        ' + err.message);
    process.exitCode = 1;
  }
}

async function main() {
  console.log('启动与开局');
  check('首屏在开始页、HUD 隐藏', () => {
    assert.strictEqual(el('startScreen').hidden, false);
    assert.strictEqual(el('playScreen').hidden, true);
    assert.strictEqual(el('hud').hidden, true);
  });

  el('nameInput').value = '测试玩家';
  fire('startBtn', 'click');
  check('进入对局并显示 15:00', () => {
    assert.strictEqual(el('playScreen').hidden, false);
    assert.strictEqual(el('hud').hidden, false);
    assert.strictEqual(el('clockVal').textContent, '15:00');
    assert.strictEqual(el('scoreVal').textContent, '0');
  });

  check('渲染 4 个字块与 4 个答案格', () => {
    assert.strictEqual((el('tiles').innerHTML.match(/class="tile /g) || []).length, 4);
    assert.strictEqual(el('slots').children.length, 4);
  });

  console.log('答错 / 看答案 / 答对');
  el('guessInput').value = '瞎猜一个';
  fire('guessForm', 'submit');
  check('答错扣 1 分并留痕', () => {
    assert.strictEqual(el('scoreVal').textContent, '-1');
    assert.strictEqual(el('guessLog').children.length, 1);
  });

  fire('revealBtn', 'click');
  check('看答案再扣 1 分并填满答案格', () => {
    assert.strictEqual(el('scoreVal').textContent, '-2');
    const cells = el('slots').children;
    assert.ok(cells.every((c) => /right/.test(c.className)), '答案格未标绿');
    assert.ok(cells.every((c) => c.textContent.length === 1), '答案格未填字');
    assert.ok(el('tiles').classList.contains('is-right'));
  });

  await flush(1800);
  check('看答案后自动进入下一题', () => {
    assert.strictEqual(el('qIndex').textContent, '第 2 题');
    assert.ok(!el('tiles').classList.contains('is-right'));
    assert.strictEqual(el('guessLog').children.length, 0);
  });

  const before = Number(el('scoreVal').textContent);
  el('guessInput').value = '绝不可能对的答案';
  fire('guessForm', 'submit');
  const afterWrong = Number(el('scoreVal').textContent);
  check('普通答错再扣 1 分', () => assert.strictEqual(afterWrong, before - 1));

  // 依次尝试题库，直到分数 +1（模拟玩家蒙对）
  let hit = false;
  for (let i = 0; i < BANK.length && !hit; i += 1) {
    const prev = Number(el('scoreVal').textContent);
    el('guessInput').value = BANK[i].w;
    fire('guessForm', 'submit');
    hit = Number(el('scoreVal').textContent) === prev + 1;
  }
  check('命中后 +1', () => assert.ok(hit, '题库全部试过仍未出现 +1，判分可能失效'));

  await flush(1300);
  console.log('结算与排行榜');
  fire('endBtn', 'click');
  check('结算页展示本局分数', () => {
    assert.strictEqual(el('overScreen').hidden, false);
    assert.strictEqual(el('finalScore').textContent, el('scoreVal').textContent);
    assert.strictEqual(el('finalScore').textContent, String(Number(el('scoreVal').textContent)));
  });

  el('saveName').value = '测试玩家';
  fire('saveBtn', 'click');
  check('提交成绩写入本地排行榜', () => {
    const saved = JSON.parse(store.get('idiom-anim.board.v1'));
    assert.strictEqual(saved.length, 1, JSON.stringify(saved));
    assert.strictEqual(saved[0].name, '测试玩家');
    assert.strictEqual(saved[0].score, Number(el('finalScore').textContent));
    assert.ok(/is-new/.test(el('overBoard').innerHTML), '新成绩未高亮');
    assert.ok(el('overBoard').innerHTML.includes('测试玩家'), '榜单未渲染昵称');
    assert.strictEqual(el('saveBtn').disabled, true);
  });

  fire('saveBtn', 'click');
  check('重复提交被拦截', () => {
    assert.strictEqual(JSON.parse(store.get('idiom-anim.board.v1')).length, 1);
  });

  console.log('重开与超时结算');
  fire('restartBtn', 'click');
  check('再来一局分数归零', () => {
    assert.strictEqual(el('scoreVal').textContent, '0');
    assert.strictEqual(el('clockVal').textContent, '15:00');
    assert.strictEqual(el('playScreen').hidden, false);
  });

  fakeNow += 901 * 1000;
  sandbox.__tick();
  check('倒计时归零自动结算', () => {
    assert.strictEqual(el('clockVal').textContent, '00:00');
    assert.strictEqual(el('overScreen').hidden, false);
    assert.strictEqual(el('finalRank').textContent, '15 分钟时间到');
  });

  console.log('\n' + (process.exitCode ? '存在失败用例' : '界面冒烟通过'));
  if (process.exitCode) process.exit(process.exitCode);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
