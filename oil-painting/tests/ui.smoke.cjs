/* 界面冒烟：node tests/ui.smoke.cjs
 * 极简 DOM 桩，覆盖画廊 / 解锁 / 上色 / 贴合度 / 撤销 / 重画 / 参考 / 笔触 / 验收 / 道具。
 */
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
    className: '',
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
    closest(selector) {
      const key = String(selector).replace(/^\[|\]$/g, '');
      return Object.prototype.hasOwnProperty.call(this.attrs, key) ? this : null;
    },
    get textContent() {
      return this._text + this.children.map((child) => child.textContent).join('');
    },
    set textContent(value) {
      this._text = String(value);
      this.children = [];
    },
    set innerHTML(value) {
      this._text = String(value);
      this.children = [];
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
  createElementNS: (ns, tag) => makeEl(tag),
  createDocumentFragment: () => makeEl('fragment')
};

const store = new Map();
const sandbox = {
  console, Math, JSON, Date, Object, Array, Number, String, Map, Promise, Set,
  document,
  localStorage: {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, String(value))
  },
  addEventListener() {},
  requestAnimationFrame: (fn) => fn(0)
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
['artworks.js', 'logic.js', 'game.js'].forEach((file) => {
  vm.runInContext(fs.readFileSync(path.join(ROOT, file), 'utf8'), sandbox, { filename: file });
});

/* ------------------------------------------------------------------ 断言 */
const G = sandbox.window.OilPainting;
const Core = sandbox.window.OilLogic;
const el = (id) => registry.get(id);
const app = () => G.app;

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

function fire(node, type, init) {
  const ev = Object.assign({ preventDefault() {}, button: 0, pointerId: 1, currentTarget: node }, init);
  (node._handlers[type] || []).forEach((fn) => fn(ev));
}

function target(attrs) {
  return {
    _attrs: attrs,
    disabled: false,
    getAttribute: (name) => (attrs[name] == null ? null : attrs[name]),
    closest() { return this; }
  };
}

function clickWith(id, attrs) {
  fire(el(id), 'click', { target: target(attrs) });
}

function clickArt(id) { clickWith('galleryGrid', { 'data-art': id }); }

function clickRegion(regionId) {
  fire(el('artwork'), 'click', { target: target({ 'data-region': regionId }) });
}

function clickTool(toolId) { clickWith('toolRow', { 'data-tool': toolId }); }

function paintAllRef() {
  const art = app().art;
  Core.regionList(art).forEach((shape) => {
    G.pickColor(Core.refColor(art, shape));
    clickRegion(shape[0]);
  });
}

function countOf(text, needle) {
  return String(text).split(needle).length - 1;
}

/* ------------------------------------------------------------------ 用例 */
console.log('画廊与道具');

check('画廊渲染 30 张卡片，前三张开放、其余锁定', () => {
  const box = el('galleryGrid').innerHTML;
  assert.strictEqual(countOf(box, '<button type="button" class="thumb'), 30);
  assert.strictEqual(countOf(box, 'data-art="'), 30);
  assert.strictEqual(countOf(box, 'is-locked'), 27);
  assert.ok(box.indexOf('星月夜') >= 0, '应包含第一幅的标题');
  assert.strictEqual(el('starStat').textContent, '0');
  assert.strictEqual(el('propStat').textContent, '1', '厚涂笔刷 0 星即解锁');
});

check('道具面板列出 6 件，只解锁厚涂笔刷，并提示下一件', () => {
  const list = el('propList').innerHTML;
  assert.strictEqual(countOf(list, '<li class="prop'), 6);
  assert.strictEqual(countOf(list, '已解锁'), 1);
  assert.ok(list.indexOf('调色刀') >= 0);
  assert.strictEqual(el('propNote').textContent, '再得 4 星解锁调色刀');
});

check('点锁定画作不进画室并给出提示', () => {
  clickArt(Core.ARTWORKS[5].id);
  assert.strictEqual(app().art, null);
  assert.strictEqual(el('studioView').hidden, true);
  assert.ok(el('galleryNote').textContent.indexOf('锁着') >= 0);
});

console.log('进入画室');

check('打开第一幅：标题、作者、调色板、分区与工具就绪', () => {
  clickArt(Core.ARTWORKS[0].id);
  assert.strictEqual(app().art.id, Core.ARTWORKS[0].id);
  assert.strictEqual(el('studioView').hidden, false);
  assert.strictEqual(el('galleryView').hidden, true);
  assert.strictEqual(el('artTitle').textContent, '星月夜');
  assert.ok(el('artArtist').textContent.indexOf('梵高') >= 0);
  assert.strictEqual(el('palette').children.length, 6);
  assert.strictEqual(el('toolRow').children.length, 6);
  const total = Core.regionCount(app().art);
  assert.strictEqual(Object.keys(app().regionNodes).length, total);
  assert.strictEqual(el('fitVal').textContent, '0%');
  assert.strictEqual(el('fitNote').textContent, '已上色 0 / ' + total + ' 块');
  assert.strictEqual(el('doneBtn').disabled, true, '一块没画不能验收');
});

check('默认填色工具，笔触层不接管指针', () => {
  assert.strictEqual(app().tool, 'fill');
  assert.strictEqual(el('paintLayer').classList.contains('is-active'), false);
});

console.log('上色与评分');

check('点分区上色：fills、贴合度、分区清单同步', () => {
  const shape = Core.regionList(app().art)[0];
  G.pickColor(Core.refColor(app().art, shape));
  clickRegion(shape[0]);
  assert.strictEqual(app().session.fills[shape[0]], Core.refColor(app().art, shape));
  assert.strictEqual(app().regionNodes[shape[0]].getAttribute('fill'), Core.refColor(app().art, shape));
  assert.strictEqual(el('regionNote').textContent, '1 / ' + Core.regionCount(app().art));
  assert.strictEqual(el('undoBtn').disabled, false);
  assert.ok(Number(el('fitVal').textContent.replace('%', '')) > 0);
});

check('换个颜色再点同一分区会覆盖，撤销回到上一个颜色', () => {
  const shape = Core.regionList(app().art)[1];
  G.pickColor(app().art.palette[0]);
  clickRegion(shape[0]);
  const first = app().session.fills[shape[0]];
  G.pickColor('#123456');
  clickRegion(shape[0]);
  assert.strictEqual(app().session.fills[shape[0]], '#123456');
  G.undo();
  assert.strictEqual(app().session.fills[shape[0]], first);
});

check('看参考时显示参考色，回画布恢复玩家配色', () => {
  const shape = Core.regionList(app().art)[2];
  G.pickColor('#00ff00');
  clickRegion(shape[0]);
  G.toggleReference();
  assert.strictEqual(el('refBtn').textContent, '回画布');
  assert.strictEqual(app().regionNodes[shape[0]].getAttribute('fill'), Core.refColor(app().art, shape));
  G.toggleReference();
  assert.strictEqual(el('refBtn').textContent, '看参考');
  assert.strictEqual(app().regionNodes[shape[0]].getAttribute('fill'), '#00ff00');
});

console.log('笔触工具');

check('厚涂：指针拖动记一笔，撤销后清空', () => {
  G.setTool('impasto');
  assert.strictEqual(app().tool, 'impasto');
  assert.strictEqual(el('paintLayer').classList.contains('is-active'), true);
  fire(el('paintLayer'), 'pointerdown', { clientX: 10, clientY: 10 });
  fire(el('paintLayer'), 'pointermove', { clientX: 40, clientY: 36 });
  fire(el('paintLayer'), 'pointerup', {});
  assert.strictEqual(app().session.strokes.length, 1);
  assert.ok(app().session.strokes[0].points.length >= 1);
  G.undo();
  assert.strictEqual(app().session.strokes.length, 0);
});

check('未解锁的调色刀点不动，只能继续用填色', () => {
  const knife = el('toolRow').children.filter((btn) => btn.getAttribute('data-tool') === 'knife')[0];
  assert.strictEqual(knife.disabled, true);
  clickTool('knife');
  assert.notStrictEqual(app().tool, 'knife');
  G.setTool('fill');
  assert.strictEqual(el('paintLayer').classList.contains('is-active'), false);
});

console.log('验收与解锁');

check('填满全图且全部贴合参考色：100% 三星', () => {
  paintAllRef();
  assert.strictEqual(el('fitVal').textContent, '100%');
  assert.strictEqual(el('starsVal').innerHTML, '★★★');
  assert.strictEqual(el('doneBtn').disabled, false);
});

check('点完成结算，写档并更新星数', () => {
  fire(el('doneBtn'), 'click', {});
  assert.strictEqual(el('result').hidden, false);
  assert.strictEqual(el('resultStars').textContent, '★★★');
  assert.ok(el('resultTitle').textContent.indexOf('贴合度 100%') >= 0);
  assert.strictEqual(app().over, true);
  assert.strictEqual(Core.totalStars(app().progress), 3);
  assert.strictEqual(el('starStat').textContent, '3');
  const raw = JSON.parse(store.get('oil-painting.v1'));
  assert.strictEqual(raw.best['starry-night'], 3);
});

check('再画一次清空画布并收起结算', () => {
  fire(el('retryBtn'), 'click', {});
  assert.strictEqual(el('result').hidden, true);
  assert.strictEqual(app().over, false);
  assert.strictEqual(Object.keys(app().session.fills).length, 0);
  assert.strictEqual(el('fitVal').textContent, '0%');
});

check('第二幅画完拿到 6 星，解锁调色刀', () => {
  G.backToGallery();
  clickArt(Core.ARTWORKS[1].id);
  paintAllRef();
  fire(el('doneBtn'), 'click', {});
  assert.strictEqual(el('starStat').textContent, '6');
  assert.strictEqual(el('propStat').textContent, '2');
  assert.ok(Core.hasProp(app().progress, 'knife'));
  const knife = el('toolRow').children.filter((btn) => btn.getAttribute('data-tool') === 'knife')[0];
  assert.strictEqual(knife.disabled, false, '调色刀应可用');
  const gold = el('toolRow').children.filter((btn) => btn.getAttribute('data-tool') === 'gold')[0];
  assert.strictEqual(gold.disabled, true, '金箔还需 8 星');
  clickTool('knife');
  assert.strictEqual(app().tool, 'knife');
  assert.ok(el('propHint').textContent.length > 0);
});

check('第三幅结算后第四幅解锁', () => {
  G.backToGallery();
  clickArt(Core.ARTWORKS[2].id);
  paintAllRef();
  fire(el('doneBtn'), 'click', {});
  assert.strictEqual(Core.totalStars(app().progress), 9);
  G.backToGallery();
  assert.strictEqual(countOf(el('galleryGrid').innerHTML, 'is-locked'), 26);
  clickArt(Core.ARTWORKS[3].id);
  assert.strictEqual(app().art.id, Core.ARTWORKS[3].id);
});

check('混色道具按参考色补齐剩余分区', () => {
  app().progress.best = {};
  [0, 1, 2, 3].forEach((i) => { app().progress.best[Core.ARTWORKS[i].id] = 3; });
  G.renderStats();
  G.renderGallery();
  G.backToGallery();
  clickArt(Core.ARTWORKS[4].id);
  assert.strictEqual(Core.hasProp(app().progress, 'mixer'), true);
  const total = Core.regionCount(app().art);
  clickTool('mixer');
  assert.strictEqual(Object.keys(app().session.fills).length, total);
  assert.strictEqual(el('fitVal').textContent, '100%');
  assert.ok(el('propHint').textContent.indexOf('自动补齐') >= 0);
});

check('罩染开关切换光晕层', () => {
  app().progress.best = {};
  Core.ARTWORKS.slice(0, 7).forEach((art) => { app().progress.best[art.id] = 3; });
  G.renderStats();
  clickTool('glaze');
  assert.strictEqual(app().session.glaze, true);
  assert.strictEqual(el('glazeLayer').classList.contains('is-on'), true);
  clickTool('glaze');
  assert.strictEqual(app().session.glaze, false);
  assert.strictEqual(el('glazeLayer').classList.contains('is-on'), false);
});

console.log('\n' + (process.exitCode ? '存在失败用例' : '界面冒烟通过：' + pass + ' 项'));
