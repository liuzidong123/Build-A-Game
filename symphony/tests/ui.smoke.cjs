/* 界面冒烟：node tests/ui.smoke.cjs
 * 极简 DOM 桩 + 假 Web Audio，覆盖载入 / 写谱 / 时值 / 半音 / 橡皮 / 配器 / 混音 / 情感 / 播放 / 存档。
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
    value: '',
    scrollLeft: 0,
    clientWidth: 900,
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
    getBoundingClientRect() {
      const w = parseFloat(this.style._props.width || this.style.width) || 2000;
      return { left: 0, top: 0, width: w, height: 600 };
    },
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
  querySelector: () => null,
  querySelectorAll: () => [],
  addEventListener(type, fn) { (this._handlers[type] = this._handlers[type] || []).push(fn); },
  createElement: (tag) => makeEl(tag),
  createElementNS: (ns, tag) => makeEl(tag),
  createDocumentFragment: () => makeEl('fragment')
};

/* ------------------------------------------------------------------ 假音频 */
function FakeParam(value) { this.value = value; this.calls = []; }
FakeParam.prototype.setValueAtTime = function (v) {
  this.calls.push(['set', v]);
  this.value = v;
  return this;
};
FakeParam.prototype.linearRampToValueAtTime = function (v) {
  this.calls.push(['linear', v]);
  this.value = v;
  return this;
};
FakeParam.prototype.exponentialRampToValueAtTime = function (v) {
  if (!(v > 0)) throw new Error('exponentialRamp 目标值必须大于 0：' + v);
  this.calls.push(['exp', v]);
  this.value = v;
  return this;
};

const audioLog = { ctx: 0, osc: 0, noise: 0, freq: [], gains: [] };

function FakeAudioContext() {
  this.currentTime = 10;
  this.sampleRate = 44100;
  this.state = 'running';
  this.destination = { connect() {} };
  audioLog.ctx += 1;
}
FakeAudioContext.prototype.resume = function () { this.state = 'running'; };
FakeAudioContext.prototype.createGain = function () {
  const gain = new FakeParam(1);
  return { gain, connect() {} };
};
FakeAudioContext.prototype.createDynamicsCompressor = function () {
  return { threshold: new FakeParam(-24), ratio: new FakeParam(12), connect() {} };
};
FakeAudioContext.prototype.createAnalyser = function () {
  return {
    fftSize: 256,
    connect() {},
    getByteTimeDomainData(buf) { for (let i = 0; i < buf.length; i += 1) buf[i] = 128; }
  };
};
FakeAudioContext.prototype.createStereoPanner = function () {
  return { pan: new FakeParam(0), connect() {} };
};
FakeAudioContext.prototype.createBiquadFilter = function () {
  return { type: 'lowpass', frequency: new FakeParam(350), Q: new FakeParam(1), connect() {} };
};
FakeAudioContext.prototype.createPeriodicWave = function (real, imag) {
  return { real, imag };
};
FakeAudioContext.prototype.createBuffer = function (channels, len) {
  return { getChannelData: () => new Float32Array(len) };
};
FakeAudioContext.prototype.createBufferSource = function () {
  audioLog.noise += 1;
  return { buffer: null, connect() {}, start() {}, stop() {} };
};
FakeAudioContext.prototype.createOscillator = function () {
  audioLog.osc += 1;
  const node = {
    type: 'sine',
    frequency: new FakeParam(440),
    connect() {},
    start(when) { node.startedAt = when; },
    stop(when) { node.stoppedAt = when; },
    setPeriodicWave(wave) { node.wave = wave; }
  };
  audioLog.freq.push(node.frequency);
  return node;
};

/* ------------------------------------------------------------------ 沙箱 */
const store = new Map();
const timers = new Map();
let timerSeq = 0;
const rafQueue = new Map();
let rafSeq = 0;

function runPendingTimers() {
  Array.from(timers.entries()).forEach(([id, item]) => {
    timers.delete(id);
    if (typeof item.fn === 'function') item.fn();
  });
}

function flushRaf() {
  const list = Array.from(rafQueue.entries());
  rafQueue.clear();
  list.forEach(([, fn]) => { if (typeof fn === 'function') fn(0); });
}

const sandbox = {
  console, Math, JSON, Date, Object, Array, Number, String, Map, Set, Promise,
  Float32Array, Uint8Array, isFinite,
  document,
  AudioContext: FakeAudioContext,
  localStorage: {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, String(value))
  },
  navigator: { clipboard: { writeText: () => Promise.resolve() } },
  setTimeout: (fn) => { timerSeq += 1; timers.set(timerSeq, { fn }); return timerSeq; },
  setInterval: (fn) => { timerSeq += 1; timers.set(timerSeq, { fn }); return timerSeq; },
  clearTimeout: (id) => { timers.delete(id); },
  clearInterval: (id) => { timers.delete(id); },
  requestAnimationFrame: (fn) => { rafSeq += 1; rafQueue.set(rafSeq, fn); return rafSeq; },
  cancelAnimationFrame: (id) => { rafQueue.delete(id); },
  addEventListener() {}
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
['logic.js', 'game.js'].forEach((file) => {
  vm.runInContext(fs.readFileSync(path.join(ROOT, file), 'utf8'), sandbox, { filename: file });
});

/* ------------------------------------------------------------------ 断言与工具 */
const G = sandbox.window.Symphony;
const Core = sandbox.window.SymphonyLogic;
const app = () => G.app;
const el = (id) => registry.get(id);

// HTML 里带 hidden 属性的节点，桩里默认是可见的，先对齐初始状态
['instrumentPicker', 'toast', 'modal'].forEach((id) => { el(id).hidden = true; });

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

function target(attrs, extra) {
  return Object.assign({
    disabled: false,
    getAttribute: (name) => (attrs[name] == null ? null : attrs[name]),
    closest() { return this; }
  }, extra);
}

function clickWith(id, attrs, extra) {
  fire(el(id), 'click', { target: target(attrs, extra) });
}

const PAD_LEFT = 46;
const STEP_W = 14;
const HALF = 6;

/* 某一层谱表的几何与坐标换算（与 game.js 同一套规则） */
function layerOf(trackId) {
  return G.layerGeom().filter((layer) => layer.trackId === trackId)[0] || null;
}
function degOf(midi) {
  return Core.degreeAbsolute(midi - Core.degreeOf(midi).accidental);
}
function xOfBeat(beat) { return PAD_LEFT + (beat / Core.STEP) * STEP_W; }
function yOfDeg(trackId, deg) {
  const layer = layerOf(trackId);
  return layer.staffTop + (layer.axisHi - deg) * HALF;
}
/* 主谱上某条谱表里的纵向位置 */
function yOnMaster(clefId, deg) {
  const geom = G.masterGeom().filter((g) => g.win.clef.id === clefId)[0];
  return geom.staffTop + (geom.axisHi - deg) * HALF;
}

/* 在该乐器那一层的分谱上点一下：用于点中 / 编辑已有音符 */
function clickCell(trackId, beat, midi) {
  fire(el('hitLayer'), 'pointerdown', {
    clientX: xOfBeat(beat) + 3,
    clientY: yOfDeg(trackId, degOf(midi))
  });
}

/* 在主谱上点一下写音符：只给拍位与音高，乐器由程序按谱表 / 音域自动分配 */
function clickMaster(beat, midi, clefId) {
  fire(el('hitLayer'), 'pointerdown', {
    clientX: xOfBeat(beat) + 3,
    clientY: yOnMaster(clefId || 'treble', degOf(midi))
  });
}

/* 分谱栏里的深色按钮（眼睛 / M）：行与按钮是两个不同的目标节点 */
function railTarget(trackId, act) {
  const row = { getAttribute: (name) => (name === 'data-track' ? trackId : null) };
  const btn = { getAttribute: (name) => (name === 'data-act' ? act : null) };
  return {
    getAttribute: () => null,
    closest: (selector) => (String(selector).indexOf('data-act') >= 0 ? btn : row)
  };
}

function activeTrack() {
  return Core.findTrack(app().score, app().activeTrackId) || app().score.tracks[0];
}

function notesOf(trackId) {
  const track = Core.findTrack(app().score, trackId);
  return track ? track.notes : [];
}

function noteAtBeat(trackId, t) {
  return notesOf(trackId).filter((note) => Math.abs(note.t - t) < 1e-6)[0] || null;
}

function countOf(text, needle) {
  return String(text).split(needle).length - 1;
}

function clickEmotion(id) { clickWith('emotionList', { 'data-emotion': id }); }
function clickInstrument(id) {
  clickWith('instrumentPicker', { 'data-ins': id }, { disabled: false });
}
function clickDemo(id) { clickWith('modalBody', { 'data-demo': id }); }
function clickDuration(value) { clickWith('durationRow', { 'data-dur': String(value) }); }

/* ------------------------------------------------------------------ 用例 */
console.log('载入与布局');

check('启动载入示范曲《欢乐颂》，三条乐器轨与控件就绪', () => {
  assert.strictEqual(app().score.title, '欢乐颂');
  assert.strictEqual(app().score.tracks.length, 3);
  assert.strictEqual(el('titleInput').value, '欢乐颂');
  assert.strictEqual(el('tempoInput').value, '138');
  assert.strictEqual(el('barsSelect').value, '8');
  assert.strictEqual(countOf(el('trackList').innerHTML, 'data-track="'), 3);
  assert.strictEqual(countOf(el('mixer').innerHTML, 'mix-row'), 3);
  assert.strictEqual(countOf(el('emotionList').innerHTML, 'emotion-card'), 6);
  assert.strictEqual(countOf(el('durationRow').innerHTML, 'duration-btn'), 5);
});

check('乐谱板＝主谱大谱表 + 三条分谱，谱号 / 五线 / 小节线齐备', () => {
  const layers = G.layerGeom();
  const tracks = app().score.tracks.length;
  assert.strictEqual(el('scoreBoard').style.width, '1838px', '46px 谱号留白 + 8 小节 × 4 拍 × 56px');
  /* 标尺 26 + 主谱 158 + 三条按内容自适应的分谱 */
  assert.strictEqual(G.masterHeight(), 158);
  assert.strictEqual(el('scoreBoard').style.height, G.boardHeight() + 'px');
  assert.strictEqual(G.layerGeom()[0].height, 28 + (G.layerGeom()[0].win.hi - G.layerGeom()[0].win.lo) * 6);
  assert.strictEqual(layers.map((layer) => layer.instrument).join(','), 'violin,piano,cello');
  /* 主谱一行 + 每件乐器一行，左右两侧逐行对齐 */
  assert.strictEqual(countOf(el('layerRail').innerHTML, 'rail-row'), tracks + 1);
  assert.strictEqual(countOf(el('layerRail').innerHTML, 'rail-row is-master'), 1);
  assert.strictEqual(layers[0].top, G.masterHeight() + 26, '第一层分谱压在主谱下面');
  assert.strictEqual(countOf(el('staffLayers').innerHTML, 'staff-layer'), tracks + 1);
  assert.strictEqual(countOf(el('staffLayers').innerHTML, 'staff-line'), (tracks + 2) * 5, '主谱两谱表 + 每层五线');
  assert.strictEqual(countOf(el('staffLayers').innerHTML, 'staff-clef'), tracks + 2);
  assert.strictEqual(countOf(el('staffLayers').innerHTML, 'staff-time'), tracks + 1);
  assert.strictEqual(countOf(el('staffLayers').innerHTML, 'bar-line'), (tracks + 1) * 9, '每层 8 小节 + 收尾线');
  assert.strictEqual(countOf(el('staffLayers').innerHTML, 'beat-tick'), (tracks + 1) * 31, '每层 31 个拍点');
  assert.strictEqual(countOf(el('staffLayers').innerHTML, 'staff-layer is-active'), 1);
  assert.strictEqual(countOf(el('layerRail').innerHTML, 'rail-row is-active'), 1);
  assert.ok(el('staffLayers').innerHTML.indexOf('𝄢') >= 0, '大提琴走低音谱号');
  assert.ok(el('staffLayers').innerHTML.indexOf('master-brace') >= 0, '大谱表连谱括号');
  assert.strictEqual(countOf(el('scoreRuler').innerHTML, 'bar-mark'), 8);
  assert.strictEqual(countOf(el('scoreRuler').innerHTML, 'beat-mark'), 24);
  assert.ok(el('scoreBoard').classList.contains('is-staff'));
  assert.ok(el('noteLayer').innerHTML.indexOf('stem-up') >= 0, '符干与符头按音高落位');
});

check('主谱把每个声部按它自己的谱号并到大谱表上', () => {
  const geoms = G.masterGeom();
  assert.strictEqual(geoms.length, app().score.tracks.length);
  assert.strictEqual(G.masterBassTop() - G.masterTrebleTop(), 48 + 34, '两张谱表之间留出间距');
  geoms.forEach((geom) => {
    const bass = Core.clefFor(geom.instrument) === 'bass';
    assert.strictEqual(geom.staffTop, bass ? G.masterBassTop() : G.masterTrebleTop());
    assert.strictEqual(geom.axisHi, bass ? Core.CLEFS.bass.top : Core.CLEFS.treble.top);
  });
  /* 主谱把高音声部画在高音谱表、低音声部画在低音谱表 */
  const cello = G.masterGeom().filter((g) => g.instrument === 'cello')[0];
  const violin = G.masterGeom().filter((g) => g.instrument === 'violin')[0];
  const lowMidi = 48;
  const highMidi = 67;
  const lowY = G.yOfDeg(cello, Core.degreeAbsolute(lowMidi));
  const highY = G.yOfDeg(violin, Core.degreeAbsolute(highMidi));
  assert.ok(lowY > G.masterBassTop() - 1 && lowY < G.masterBassTop() + 49, 'C3 落在低音谱表内');
  assert.ok(highY >= G.masterTrebleTop() - 1 && highY < G.masterTrebleTop() + 49, 'G4 落在高音谱表内');
  assert.ok(countOf(el('noteLayer').innerHTML, 'data-master="1"') > 0, '主谱上同样画出所有音符');
  assert.ok(countOf(el('noteLayer').innerHTML, 'on-master') > 0);
});

check('符头中心压在拍点上，不左右偏移', () => {
  const track = app().score.tracks[0];
  const note = track.notes[track.notes.length - 1];
  const hit = el('noteLayer').innerHTML.match(
    new RegExp('data-t="' + note.t + '"[^>]*style="left:([\\d.]+)px')
  );
  assert.ok(hit, '应画出这颗音');
  assert.strictEqual(parseFloat(hit[1]) + 4.5, G.xOfBeat(note.t), '符头中心对齐拍线');
  assert.strictEqual(G.xOfHead(note.t), G.xOfBeat(note.t) - 4.5);
});

check('主谱上点音符即选中那件乐器的那颗音', () => {
  const track = app().score.tracks[2];
  const note = track.notes[0];
  const geom = G.masterGeom().filter((g) => g.trackId === track.id)[0];
  const x = G.xOfBeat(note.t);
  const y = G.yOfDeg(geom, Core.degreeAbsolute(note.m - Core.degreeOf(note.m).accidental));
  const hit = G.masterHit(x, y);
  assert.ok(hit, '主谱上应能命中符头');
  assert.strictEqual(hit.trackId, track.id);
  assert.strictEqual(hit.t, note.t);
  fire(el('hitLayer'), 'pointerdown', { clientX: x, clientY: y });
  assert.strictEqual(app().selected.trackId, track.id);
  assert.strictEqual(app().selected.t, note.t);
  assert.strictEqual(app().activeTrackId, track.id, '点主谱会自动切到那件乐器');
  assert.strictEqual(noteAtBeat(track.id, note.t).m, note.m, '主谱上点击只选中，不改音符');
});

check('主谱空白处点击不写音符，写谱仍走分谱', () => {
  const before = Core.totalNotes(app().score);
  fire(el('hitLayer'), 'pointerdown', { clientX: G.xOfBeat(6) + 3, clientY: G.masterTrebleTop() + 48 + 4 });
  assert.strictEqual(Core.totalNotes(app().score), before, '主谱空白不落音符');
  assert.ok(G.masterAtY(G.masterTrebleTop() + 48 + 4));
});

check('统计随乐谱更新，示范曲自动达成前三个乐章任务', () => {
  assert.strictEqual(el('trackStat').textContent, '3');
  assert.strictEqual(el('noteStat').textContent, '54');
  assert.strictEqual(el('starStat').textContent, '3');
  assert.strictEqual(el('taskStars').textContent, '3 / 6');
  assert.strictEqual(countOf(el('taskList').innerHTML, '<li class="task-item'), 6);
  assert.strictEqual(countOf(el('taskList').innerHTML, 'is-done'), 3);
  assert.ok(el('scoreMeta').textContent.indexOf('54 个音') >= 0);
});

check('示范曲弹窗列出 6 首，载入《卡农片段》替换当前作品', () => {
  fire(el('demoBtn'), 'click', {});
  assert.strictEqual(el('modal').hidden, false);
  assert.strictEqual(countOf(el('modalBody').innerHTML, 'demo-card'), 6);
  assert.strictEqual(countOf(el('modalBody').innerHTML, 'data-demo="'), 6);
  clickDemo('canon');
  assert.strictEqual(el('modal').hidden, true);
  assert.strictEqual(app().score.title, '卡农片段');
  assert.strictEqual(app().score.tempo, 96);
  assert.strictEqual(app().score.emotion, 'grand');
  assert.strictEqual(app().score.tracks.length, 3);
  assert.strictEqual(el('tempoInput').value, '96');
  assert.strictEqual(el('titleInput').value, '卡农片段');
});

console.log('写谱与编辑');

check('清空按钮抹掉所有音符，撤销可回滚', () => {
  const before = Core.totalNotes(app().score);
  assert.ok(before > 0);
  fire(el('clearBtn'), 'click', {});
  assert.strictEqual(Core.totalNotes(app().score), 0);
  assert.strictEqual(el('noteStat').textContent, '0');
  G.undo();
  assert.strictEqual(Core.totalNotes(app().score), before);
});

check('主谱上点一下写音符，自动落进当前乐器的分谱', () => {
  fire(el('clearBtn'), 'click', {});
  clickDuration(1);
  const trackId = activeTrack().id;
  const before = notesOf(trackId).length;
  clickMaster(9, 60);
  const note = noteAtBeat(trackId, 9);
  assert.ok(note, '第 9 拍应有音符');
  assert.strictEqual(note.m, 60);
  assert.strictEqual(note.d, 1);
  assert.strictEqual(notesOf(trackId).length, before + 1);
  assert.strictEqual(el('noteStat').textContent, String(Core.totalNotes(app().score)));
  assert.ok(el('noteLayer').innerHTML.indexOf('data-t="9"') >= 0);
  assert.ok(el('noteLayer').innerHTML.indexOf('class="head"') >= 0, '符头');
  assert.ok(el('noteLayer').innerHTML.indexOf('class="stem"') >= 0, '符干');
  assert.ok(el('cursorInfo').textContent.indexOf('第 3 小节') >= 0);
});

check('点已有音符只选中不重复写入', () => {
  const trackId = activeTrack().id;
  const before = notesOf(trackId).length;
  clickCell(trackId, 9, 60);
  assert.strictEqual(notesOf(trackId).length, before);
  assert.strictEqual(app().selected.trackId, trackId);
  assert.strictEqual(app().selected.t, 9);
  assert.ok(el('noteLayer').innerHTML.indexOf('is-selected') >= 0);
  assert.strictEqual(el('pitchUpBtn').disabled, false, '选中后音高按钮可用');
});

check('选中音符改时值为二分音符，撤销回到四分', () => {
  const trackId = activeTrack().id;
  clickDuration(2);
  assert.strictEqual(nodeAt(9).d, 2);
  assert.strictEqual(app().duration, 2);
  G.undo();
  assert.strictEqual(nodeAt(9).d, 1);
  clickDuration(1);
  function nodeAt(t) { return noteAtBeat(trackId, t); }
});

check('升号写出半音，音符标为升号并错开半行', () => {
  fire(el('sharpBtn'), 'click', {});
  assert.strictEqual(app().sharp, true);
  assert.ok(el('sharpBtn').classList.contains('is-on'));
  const trackId = activeTrack().id;
  clickMaster(11, 60);
  const note = noteAtBeat(trackId, 11);
  assert.ok(note);
  assert.strictEqual(note.m, 61);
  assert.ok(el('noteLayer').innerHTML.indexOf('is-sharp') >= 0);
  assert.ok(el('noteLayer').innerHTML.indexOf('class="acc"') >= 0, '升号记号');
  fire(document, 'keydown', { key: 'Escape', target: { tagName: 'DIV' } });
  fire(el('sharpBtn'), 'click', {});
  assert.strictEqual(app().sharp, false, '取消选中后 ♯ 回到写入模式');
  assert.strictEqual(noteAtBeat(trackId, 11).m, 61, '已写下的升号音不受影响');
});

check('橡皮模式点音符即删除，再点空格给出提示', () => {
  fire(el('eraserBtn'), 'click', {});
  assert.strictEqual(app().eraser, true);
  assert.ok(el('hitLayer').classList.contains('is-erase'));
  assert.ok(el('editorHint').textContent.indexOf('橡皮') >= 0);
  const trackId = activeTrack().id;
  clickCell(trackId, 11, 60);
  assert.strictEqual(noteAtBeat(trackId, 11), null);
  clickCell(trackId, 12, 60);
  assert.strictEqual(el('toast').hidden, false);
  assert.ok(el('toast').textContent.indexOf('没有音符') >= 0);
  fire(el('eraserBtn'), 'click', {});
  assert.strictEqual(app().eraser, false);
  assert.strictEqual(el('hitLayer').classList.contains('is-erase'), false);
});

console.log('分层谱表与音符编辑');

check('主谱低音谱表写音符：自动分配到低音乐器，分谱联动', () => {
  const celloTrack = app().score.tracks[2];
  assert.strictEqual(celloTrack.instrument, 'cello');
  assert.strictEqual(layerOf(celloTrack.id).win.clef.id, 'bass', '大提琴层是低音谱号');
  clickMaster(0, 48, 'bass');
  assert.strictEqual(app().activeTrackId, celloTrack.id, '自动切到低音谱表对应的乐器');
  const note = noteAtBeat(celloTrack.id, 0);
  assert.ok(note, '音符写进大提琴轨');
  assert.strictEqual(note.m, 48);
  assert.ok(el('noteLayer').innerHTML.indexOf('data-track="' + celloTrack.id + '"') >= 0);
  assert.strictEqual(countOf(el('staffLayers').innerHTML, 'staff-layer is-active'), 1);
  assert.ok(el('staffLayers').innerHTML.indexOf('staff-layer is-active" data-track="' + celloTrack.id) >= 0);
  assert.ok(el('layerRail').innerHTML.indexOf('rail-row is-active" data-track="' + celloTrack.id) >= 0);
  assert.ok(countOf(el('noteLayer').innerHTML, 'data-master="1"') > 0, '主谱和分谱同时出现这颗音');
});

check('分谱空白处不再写音符，只提示回主谱创作', () => {
  clickDuration(1);
  const trackId = app().score.tracks[2].id;
  const before = notesOf(trackId).length;
  clickCell(trackId, 16, 48);
  assert.strictEqual(notesOf(trackId).length, before, '分谱空白不落音符');
  assert.strictEqual(el('toast').hidden, false);
  assert.ok(el('toast').textContent.indexOf('主谱') >= 0);
});



check('拖动符头：纵向改音高、横向挪拍位，一次拖动一步撤销', () => {
  const trackId = app().activeTrackId;
  const before = noteAtBeat(trackId, 0);
  assert.ok(before);
  clickCell(trackId, 0, 48);
  fire(document, 'pointermove', { clientX: xOfBeat(4) + 3, clientY: yOfDeg(trackId, degOf(55)) });
  fire(document, 'pointerup', {});
  const moved = noteAtBeat(trackId, 4);
  assert.ok(moved, '挪到第 5 拍');
  assert.strictEqual(moved.m, 55, 'C3 拖成 G3');
  assert.strictEqual(noteAtBeat(trackId, 0), null);
  assert.strictEqual(app().selected.t, 4);
  assert.ok(el('noteLayer').innerHTML.indexOf('is-selected') >= 0);
  G.undo();
  assert.ok(noteAtBeat(trackId, 0), '撤销回到原位');
  assert.strictEqual(noteAtBeat(trackId, 0).m, 48);
  assert.strictEqual(noteAtBeat(trackId, 4), null);
});

check('▲▼ 与 ↑↓ 改音高，Shift 走八度且到边缘给提示', () => {
  const trackId = app().activeTrackId;
  G.selectNote(trackId, 0);
  const base = noteAtBeat(trackId, 0).m;
  fire(el('pitchUpBtn'), 'click', {});
  assert.strictEqual(noteAtBeat(trackId, 0).m, base + 1);
  fire(el('pitchDownBtn'), 'click', {});
  assert.strictEqual(noteAtBeat(trackId, 0).m, base);
  fire(document, 'keydown', { key: 'ArrowUp', shiftKey: true, target: { tagName: 'DIV' } });
  assert.strictEqual(noteAtBeat(trackId, 0).m, base + 12);
  fire(document, 'keydown', { key: 'ArrowDown', target: { tagName: 'DIV' } });
  assert.strictEqual(noteAtBeat(trackId, 0).m, base + 11);
  fire(el('pitchDownBtn'), 'click', {});
  assert.strictEqual(noteAtBeat(trackId, 0).m, base + 10);
});

check('←→ 按十六分挪拍位，选中状态跟着走', () => {
  const trackId = app().activeTrackId;
  const pitch = noteAtBeat(trackId, 0).m;
  G.selectNote(trackId, 0);
  fire(document, 'keydown', { key: 'ArrowRight', target: { tagName: 'DIV' } });
  assert.strictEqual(noteAtBeat(trackId, 0), null);
  assert.ok(noteAtBeat(trackId, 0.25), '挪到下一个十六分');
  assert.strictEqual(noteAtBeat(trackId, 0.25).m, pitch);
  assert.strictEqual(app().selected.t, 0.25);
  fire(document, 'keydown', { key: 'ArrowLeft', target: { tagName: 'DIV' } });
  assert.ok(noteAtBeat(trackId, 0), '再挪回来');
  assert.strictEqual(app().selected.t, 0);
});

check('♯ 有选中时只改这个音的升降号，🗑 与 Delete 删除', () => {
  const trackId = app().activeTrackId;
  G.placeNote(8, 48, trackId);
  G.selectNote(trackId, 8);
  assert.strictEqual(noteAtBeat(trackId, 8).m, 48);
  fire(el('sharpBtn'), 'click', {});
  assert.strictEqual(noteAtBeat(trackId, 8).m, 49, '选中音符升半音');
  assert.strictEqual(app().sharp, false, '不切写入模式');
  assert.ok(el('noteLayer').innerHTML.indexOf('is-sharp') >= 0);
  assert.ok(el('noteLayer').innerHTML.indexOf('class="acc"') >= 0, '画出升号');
  fire(el('sharpBtn'), 'click', {});
  assert.strictEqual(noteAtBeat(trackId, 8).m, 48, '再点还原成白键');

  fire(el('delNoteBtn'), 'click', {});
  assert.strictEqual(noteAtBeat(trackId, 8), null);
  assert.strictEqual(app().selected, null);
  assert.strictEqual(el('delNoteBtn').disabled, true, '没有选中时删除按钮禁用');
  assert.strictEqual(el('pitchUpBtn').disabled, true);
  assert.ok(el('editorHint').textContent.indexOf('拖动符头') >= 0);

  G.placeNote(10, 48, trackId);
  G.selectNote(trackId, 10);
  fire(document, 'keydown', { key: 'Delete', target: { tagName: 'DIV' } });
  assert.strictEqual(noteAtBeat(trackId, 10), null, 'Delete 键也能删');

  G.placeNote(10, 48, trackId);
  G.selectNote(trackId, 10);
  fire(document, 'keydown', { key: 'Escape', target: { tagName: 'DIV' } });
  assert.strictEqual(app().selected, null, 'Esc 取消选中');
  assert.ok(noteAtBeat(trackId, 10), 'Esc 不删音符');
  G.undo();
});

check('分谱栏的眼睛隐藏一层，谱表与分谱行一起收起', () => {
  const trackId = app().score.tracks[1].id;
  const heightBefore = parseFloat(el('scoreBoard').style.height);
  const rowsBefore = countOf(el('layerRail').innerHTML, 'rail-row');
  fire(el('layerRail'), 'click', { target: railTarget(trackId, 'hide') });
  assert.strictEqual(app().hidden[trackId], true);
  assert.strictEqual(countOf(el('layerRail').innerHTML, 'rail-row'), rowsBefore - 1);
  assert.strictEqual(countOf(el('staffLayers').innerHTML, 'staff-layer'), rowsBefore - 1);
  assert.ok(parseFloat(el('scoreBoard').style.height) < heightBefore, '谱面变矮');
  clickWith('trackList', { 'data-track': trackId, 'data-act': 'hide' });
  assert.strictEqual(countOf(el('layerRail').innerHTML, 'rail-row'), rowsBefore, '可以再显示回来');
  assert.strictEqual(parseFloat(el('scoreBoard').style.height), heightBefore);
});

console.log('配器与混音');

check('添加长笛轨：候选中挑一件乐器，轨数 +1 并自动选中', () => {
  fire(el('addTrackBtn'), 'click', {});
  assert.strictEqual(el('instrumentPicker').hidden, false);
  assert.strictEqual(countOf(el('instrumentPicker').innerHTML, 'instrument-card'), 11);
  const before = app().score.tracks.length;
  clickInstrument('flute');
  assert.strictEqual(app().score.tracks.length, before + 1);
  assert.strictEqual(el('instrumentPicker').hidden, true);
  const added = app().score.tracks[app().score.tracks.length - 1];
  assert.strictEqual(added.instrument, 'flute');
  assert.strictEqual(app().activeTrackId, added.id);
  assert.strictEqual(countOf(el('trackList').innerHTML, 'data-track="'), before + 1);
});

check('星数不足的管风琴、低音提琴保持锁定，定音鼓已解锁', () => {
  fire(el('addTrackBtn'), 'click', {});
  const picker = el('instrumentPicker').innerHTML;
  assert.ok(picker.indexOf('data-ins="organ" disabled') >= 0, '管风琴需 4 星');
  assert.ok(picker.indexOf('data-ins="contrabass" disabled') >= 0, '低音提琴需 6 星');
  assert.strictEqual(Core.isInstrumentUnlocked(app().progress, 'timpani'), true);
  const before = app().score.tracks.length;
  clickInstrument('organ');
  assert.strictEqual(app().score.tracks.length, before, '锁定的乐器点不动');
});

check('删除轨道：从属轨移出并提示可撤销', () => {
  const before = app().score.tracks.length;
  const doomed = app().score.tracks[before - 1];
  clickWith('trackList', { 'data-track': doomed.id, 'data-act': 'remove' });
  assert.strictEqual(app().score.tracks.length, before - 1);
  assert.strictEqual(Core.findTrack(app().score, doomed.id), null);
  assert.ok(el('toast').textContent.indexOf('已删除轨道') >= 0);
});

check('静音与独奏改变混音计划', () => {
  const first = app().score.tracks[0];
  const second = app().score.tracks[1];
  clickWith('trackList', { 'data-track': first.id, 'data-act': 'mute' });
  assert.strictEqual(first.mute, true);
  assert.ok(el('trackList').innerHTML.indexOf('"mute" class="on"') >= 0);
  let plan = Core.mixPlan(app().score);
  assert.strictEqual(plan.filter((row) => row.trackId === first.id)[0].gain, 0);
  assert.ok(plan.filter((row) => row.trackId === second.id)[0].gain > 0);
  clickWith('trackList', { 'data-track': first.id, 'data-act': 'mute' });
  assert.strictEqual(first.mute, false);

  clickWith('trackList', { 'data-track': second.id, 'data-act': 'solo' });
  assert.strictEqual(second.solo, true);
  plan = Core.mixPlan(app().score);
  assert.ok(plan.filter((row) => row.trackId === second.id)[0].audible);
  assert.strictEqual(plan.filter((row) => row.trackId === first.id)[0].audible, false);
  clickWith('trackList', { 'data-track': second.id, 'data-act': 'solo' });
  assert.strictEqual(second.solo, false);
});

check('混音台推子写入音量与声像', () => {
  const track = app().score.tracks[0];
  fire(el('mixer'), 'input', { target: mixerTarget(55, 'volume', track.id) });
  assert.strictEqual(track.volume, 0.55);
  fire(el('mixer'), 'input', { target: mixerTarget(25, 'pan', track.id) });
  assert.strictEqual(track.pan, -0.5);
  fire(el('mixer'), 'input', { target: mixerTarget(75, 'pan', track.id) });
  assert.strictEqual(track.pan, 0.5);
  assert.strictEqual(countOf(el('mixer').innerHTML, 'meter-fill'), app().score.tracks.length);
});

function mixerTarget(value, act, trackId) {
  const row = { getAttribute: (name) => (name === 'data-track' ? trackId : null) };
  return {
    value: String(value),
    getAttribute: (name) => (name === 'data-act' ? act : null),
    closest: (selector) => (String(selector).indexOf('data-track') >= 0 ? row : null)
  };
}

console.log('情感与音色');

check('切到「温柔」：速度、微调、音色截止频率一起变化', () => {
  const before = Core.timbre(app().score, app().score.tracks[0]).cutoff;
  clickEmotion('tender');
  assert.strictEqual(app().score.emotion, 'tender');
  assert.strictEqual(app().score.tempo, 76);
  assert.strictEqual(el('tempoInput').value, '76');
  assert.strictEqual(app().score.tweaks.bright, 0);
  assert.strictEqual(app().score.tweaks.reverb, 0);
  assert.strictEqual(app().score.tweaks.vibrato, 0);
  assert.strictEqual(el('brightOut').textContent, '0');
  assert.strictEqual(countOf(el('emotionList').innerHTML, 'is-on'), 1);
  assert.ok(el('emotionList').innerHTML.indexOf('data-emotion="tender"') >= 0);
  const after = Core.timbre(app().score, app().score.tracks[0]).cutoff;
  assert.ok(after < before, '温柔应比壮丽更暗：' + after + ' < ' + before);
  assert.ok(el('toast').textContent.indexOf('温柔') >= 0);
});

check('微调明亮度 / 混响 / 揉弦逐项生效', () => {
  const base = Core.timbre(app().score, app().score.tracks[0]);
  fire(el('brightInput'), 'input', { target: { value: '50' } });
  assert.strictEqual(app().score.tweaks.bright, 0.5);
  assert.strictEqual(el('brightOut').textContent, '50');
  const brighter = Core.timbre(app().score, app().score.tracks[0]);
  assert.ok(brighter.cutoff > base.cutoff);
  fire(el('reverbInput'), 'input', { target: { value: '-20' } });
  assert.strictEqual(app().score.tweaks.reverb, -0.2);
  assert.strictEqual(el('reverbOut').textContent, '-20');
  fire(el('vibratoInput'), 'input', { target: { value: '80' } });
  assert.strictEqual(app().score.tweaks.vibrato, 0.8);
  assert.strictEqual(el('vibratoOut').textContent, '80');
  const wobble = Core.timbre(app().score, app().score.tracks[0]);
  assert.ok(wobble.vibratoDepth > base.vibratoDepth);
});

check('播放：建振荡器、走播放头，停止后归零', () => {
  G.loadDemo('lullaby');
  assert.strictEqual(app().score.title, '摇篮曲');
  audioLog.osc = 0;
  fire(el('playBtn'), 'click', {});
  assert.strictEqual(app().playing, true);
  assert.strictEqual(el('playBtn').textContent, '❚❚ 暂停');
  assert.ok(el('playhead').classList.contains('is-on'));
  assert.ok(audioLog.osc >= 3, '应排入振荡器，实际 ' + audioLog.osc);
  assert.ok(audioLog.freq.some((f) => f.value > 60 && f.value < 1600));
  flushRaf();
  assert.ok(/^\d\d:\d\d \/ \d\d:\d\d$/.test(el('playInfo').textContent));
  fire(el('loopBtn'), 'click', {});
  assert.strictEqual(app().loop, true);
  assert.ok(el('loopBtn').classList.contains('is-on'));
  fire(el('metroBtn'), 'click', {});
  assert.strictEqual(app().metro, true);
  fire(el('stopBtn'), 'click', {});
  assert.strictEqual(app().playing, false);
  assert.strictEqual(app().position, 0);
  assert.strictEqual(el('playBtn').textContent, '▶ 播放');
  assert.strictEqual(el('playhead').classList.contains('is-on'), false);
});

console.log('存档与导入导出');

check('保存写入本机存档，含曲名与当前调音', () => {
  fire(el('saveBtn'), 'click', {});
  const raw = JSON.parse(store.get('symphony.score.v1'));
  assert.strictEqual(raw.title, app().score.title);
  assert.strictEqual(raw.emotion, 'tender');
  assert.strictEqual(raw.tracks.length, app().score.tracks.length);
  assert.ok(el('toast').textContent.indexOf('已保存') >= 0);
  const progress = JSON.parse(store.get('symphony.v1'));
  assert.strictEqual(Object.keys(progress.done).length, 3);
});

check('导出面板给出 JSON，导入后替换乐谱', () => {
  fire(el('exportBtn'), 'click', {});
  assert.strictEqual(el('modal').hidden, false);
  assert.ok(el('modalBody').innerHTML.indexOf('export-area') >= 0);
  assert.ok(el('modalBody').innerHTML.indexOf('importExport') >= 0);

  registry.set('exportArea', makeEl('textarea'));
  el('exportArea').value = Core.serialize(Core.DEMOS[1].build());
  fire(el('modalBody'), 'click', { target: { id: 'importExport', closest: () => null } });
  assert.strictEqual(el('modal').hidden, true);
  assert.strictEqual(app().score.title, '小星星');
  assert.strictEqual(app().score.tracks.length, 3);
  assert.strictEqual(el('titleInput').value, '小星星');
  assert.ok(el('toast').textContent.indexOf('已导入') >= 0);
});

check('切回五线谱 / 简谱互不影响音符数据', () => {
  const notes = Core.totalNotes(app().score);
  fire(el('jianpuBtn'), 'click', {});
  assert.strictEqual(app().view, 'jianpu');
  assert.ok(el('scoreBoard').classList.contains('is-jianpu'));
  assert.ok(el('scoreBoard').classList.contains('is-staff') === false);
  assert.strictEqual(Core.totalNotes(app().score), notes);
  /* 简谱没有谱表：主谱收起，只剩分谱行，谱面上提到标尺下方 */
  assert.strictEqual(countOf(el('layerRail').innerHTML, 'rail-row'), app().score.tracks.length);
  assert.strictEqual(countOf(el('staffLayers').innerHTML, 'staff-layer is-master'), 0);
  assert.strictEqual(G.layerGeom()[0].top, 26);
  assert.strictEqual(countOf(el('noteLayer').innerHTML, 'data-master="1"'), 0);
  assert.ok(el('noteLayer').innerHTML.indexOf('class="jp"') >= 0, '简谱出数字');
  fire(el('staffBtn'), 'click', {});
  assert.ok(el('scoreBoard').classList.contains('is-staff'));
  assert.strictEqual(countOf(el('staffLayers').innerHTML, 'staff-layer is-master'), 1, '切回五线谱主谱回来');
  assert.strictEqual(G.layerGeom()[0].top, 26 + G.masterHeight());
});

console.log('主谱创作与分谱联动');

check('分谱高度随实际音符自动调整：写低音就往下撑高，五线不动', () => {
  fire(el('clearBtn'), 'click', {});
  const band = app().score.tracks.filter((t) => t.instrument === 'piano')[0];
  const base = Core.staffWindow(band.instrument);
  assert.ok(base.hi - base.lo > 10, '钢琴音域宽，才有自适应空间');
  const empty = layerOf(band.id);
  G.placeNote(0, 48, band.id);
  const note = noteAtBeat(band.id, 0);
  assert.ok(note, '低音写下');
  assert.strictEqual(note.m, 48, 'C3 没被夹走');
  const after = layerOf(band.id);
  assert.strictEqual(after.staffTop, empty.staffTop, '谱表线位置不动');
  assert.ok(after.height > empty.height, '这一层自动变高');
  assert.strictEqual(after.height, 28 + (after.win.hi - after.win.lo) * 6);
  const y = after.staffTop + (after.axisHi - Core.degreeAbsolute(48)) * 6;
  assert.ok(y > after.top && y < after.top + after.height, '音符仍在层内');
  assert.strictEqual(parseFloat(el('scoreBoard').style.height), G.boardHeight());
  G.undo();
  assert.strictEqual(layerOf(band.id).height, empty.height, '撤销后层高复原');
});

check('主谱上纵向拖到另一张谱表，音符自动换到那件乐器', () => {
  fire(el('clearBtn'), 'click', {});
  clickMaster(4, 60);
  const from = app().score.tracks.filter((t) => noteAtBeat(t.id, 4))[0];
  assert.ok(from, '先写进高音谱表对应的乐器');
  assert.strictEqual(Core.clefFor(from.instrument), 'treble');
  fire(el('hitLayer'), 'pointerdown', { clientX: xOfBeat(4) + 3, clientY: yOnMaster('treble', degOf(60)) });
  fire(document, 'pointermove', { clientX: xOfBeat(4) + 3, clientY: yOnMaster('bass', degOf(48)) });
  fire(document, 'pointerup', {});
  assert.strictEqual(noteAtBeat(from.id, 4), null, '原乐器那边清空');
  const cello = app().score.tracks.filter((t) => Core.clefFor(t.instrument) === 'bass')[0];
  const moved = noteAtBeat(cello.id, 4);
  assert.ok(moved, '落到低音谱表对应的乐器');
  assert.strictEqual(moved.m, 48);
  assert.strictEqual(app().activeTrackId, cello.id, '活动乐器跟着联动');
  assert.ok(el('layerRail').innerHTML.indexOf('rail-row is-active" data-track="' + cello.id) >= 0);
  G.undo();
  assert.ok(noteAtBeat(from.id, 4), '一次撤销回到原乐器');
  assert.strictEqual(noteAtBeat(cello.id, 4), null);
});

console.log('\n' + (process.exitCode ? '存在失败用例' : '界面冒烟通过：' + pass + ' 项'));


