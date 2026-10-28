/*
 * 青蛙过河 · 画面与交互
 * Canvas 绘制水面 / 荷叶 / 青蛙，键盘输入驱动 Logic。
 */
(function () {
  'use strict';

  var Logic = window.FrogLogic;
  var STORE_KEY = 'frog-typing.v1';
  var SKINS = {
    lime: { body: '#5fd47a', light: '#b6f79c', dark: '#2e8f4f', eye: '#f8ffef' },
    cyan: { body: '#4cc9d8', light: '#a6f2f8', dark: '#1d7488', eye: '#f0fcff' },
    gold: { body: '#e9c05a', light: '#ffe9a6', dark: '#a9741f', eye: '#fffaee' }
  };

  function $(id) { return document.getElementById(id); }

  var ui = {
    canvas: $('river'),
    scoreVal: $('scoreVal'), comboVal: $('comboVal'), coinVal: $('coinVal'), lifeVal: $('lifeVal'),
    levelChip: $('levelChip'), recordChip: $('recordChip'),
    timebar: $('timebar'), timeFill: $('timeFill'),
    promptKeys: $('promptKeys'), promptLabel: $('promptLabel'),
    banner: $('banner'), bannerText: $('bannerText'), liveStatus: $('liveStatus'),
    bestVal: $('bestVal'), bestComboVal: $('bestComboVal'), accuracyVal: $('accuracyVal'), progressVal: $('progressVal'),
    pauseBtn: $('pauseBtn'), restartBtn: $('restartBtn'), homeBtn: $('homeBtn'),
    startPanel: $('startPanel'), startBtn: $('startBtn'), diffRow: $('diffRow'), diffHint: $('diffHint'),
    skinRow: $('skinRow'), startMeta: $('startMeta'),
    result: $('result'), resultKicker: $('resultKicker'), resultTitle: $('resultTitle'),
    resultScore: $('resultScore'), resultCopy: $('resultCopy'), resultGrid: $('resultGrid'),
    resultBadges: $('resultBadges'), nextBtn: $('nextBtn'), againBtn: $('againBtn'), toHomeBtn: $('toHomeBtn'),
    pausePanel: $('pausePanel'), resumeBtn: $('resumeBtn'), quitBtn: $('quitBtn'), tipText: $('tipText')
  };

  var ctx = ui.canvas ? ui.canvas.getContext('2d') : null;
  var cssW = 360;
  var cssH = 432;
  var game = null;
  var frogAt = { row: 0, lane: 0 };
  var settings = { difficulty: 'normal', skin: 'lime' };
  var save = null;
  var lastTs = 0;
  var promptSig = '';
  var hudSig = '';
  var bannerTimer = 0;
  var audio = { ctx: null, enabled: true };

  var view = {
    time: 0,
    camRow: 0,
    hop: null,
    shake: 0,
    flash: 0,
    frogX: 0,
    frogY: 0,
    particles: [],
    floats: [],
    ripples: []
  };

  /* ------------------------------------------------------------ 存档 */
  function readJSON(key, fallback) {
    try {
      var raw = window.localStorage && window.localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (err) {
      return fallback;
    }
  }

  function writeJSON(key, value) {
    try {
      if (window.localStorage) window.localStorage.setItem(key, JSON.stringify(value));
    } catch (err) { /* 隐私模式忽略 */ }
  }

  function loadSave() {
    var raw = readJSON(STORE_KEY, null) || {};
    return {
      highScore: Number(raw.highScore) || 0,
      bestCombo: Number(raw.bestCombo) || 0,
      clears: Number(raw.clears) || 0,
      coins: Number(raw.coins) || 0,
      achievements: Array.isArray(raw.achievements)
        ? raw.achievements.filter(function (id) { return !!Logic.ACHIEVEMENTS[id]; })
        : [],
      difficulty: Logic.DIFFICULTIES[raw.difficulty] ? raw.difficulty : 'normal',
      skin: SKINS[raw.skin] ? raw.skin : 'lime'
    };
  }

  function persist() {
    save.difficulty = settings.difficulty;
    save.skin = settings.skin;
    writeJSON(STORE_KEY, save);
  }

  /* ------------------------------------------------------------ 音效 */
  function beep(freq, duration, type, gain) {
    if (!audio.enabled) return;
    var AC = window.AudioContext || window.webkitAudioContext;
    if (typeof AC !== 'function') return;
    try {
      if (!audio.ctx) audio.ctx = new AC();
      var ac = audio.ctx;
      if (ac.state === 'suspended' && ac.resume) ac.resume();
      var osc = ac.createOscillator();
      var vol = ac.createGain();
      osc.type = type || 'sine';
      osc.frequency.value = freq;
      vol.gain.setValueAtTime(0.0001, ac.currentTime);
      vol.gain.exponentialRampToValueAtTime(gain || 0.06, ac.currentTime + 0.012);
      vol.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + duration);
      osc.connect(vol);
      vol.connect(ac.destination);
      osc.start();
      osc.stop(ac.currentTime + duration + 0.03);
    } catch (err) { /* 音频不可用时静默 */ }
  }

  /* ------------------------------------------------------------ 尺寸 */
  function fitCanvas() {
    if (!ui.canvas) return;
    var rect = ui.canvas.getBoundingClientRect ? ui.canvas.getBoundingClientRect() : null;
    var width = ui.canvas.clientWidth || (rect && rect.width) || 360;
    width = Math.max(260, Math.round(width));
    var height = Math.round(ui.canvas.clientHeight || (rect && rect.height) || width);
    var dpr = Math.min(2, window.devicePixelRatio || 1);
    ui.canvas.width = Math.round(width * dpr);
    ui.canvas.height = Math.round(height * dpr);
    cssW = width;
    cssH = height;
    if (ctx && ctx.setTransform) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  /* ------------------------------------------------------------ 几何 */
  function rowStep() { return cssH * 0.185; }

  /* 视角跟着青蛙所在排滚动：青蛙固定停在画面下方，荷叶整体向下流动 */
  function yOf(rowNo) {
    return cssH * 0.78 - (rowNo - view.camRow) * rowStep();
  }

  function xOf(lane, count) {
    if (!count || count <= 1) return cssW / 2;
    var pad = cssW * 0.17;
    return pad + (cssW - pad * 2) * (lane / (count - 1));
  }

  /* ------------------------------------------------------------ 水面 */
  function drawWater() {
    var grad = ctx.createLinearGradient(0, 0, 0, cssH);
    grad.addColorStop(0, '#0a272b');
    grad.addColorStop(0.52, '#10403f');
    grad.addColorStop(1, '#08252a');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, cssW, cssH);

    ctx.save();
    ctx.globalAlpha = 0.14;
    ctx.strokeStyle = '#8ef0c6';
    ctx.lineWidth = 1.4;
    for (var i = 0; i < 10; i += 1) {
      var base = ((view.time * 16 + i * 76) % (cssH + 90)) - 45;
      ctx.beginPath();
      for (var x = -10; x <= cssW + 10; x += 22) {
        var y = base + Math.sin(x / 80 + view.time * 1.5 + i) * 5;
        if (x <= -10) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    ctx.restore();
  }

  /* ------------------------------------------------------------ 荷叶 */
  function drawLeaf(x, y, rx, leaf, active, focused) {
    var ry = rx * 0.4;
    var bob = Math.sin(view.time * 1.7 + x * 0.02) * 3;
    ctx.save();
    ctx.translate(x, y + bob);

    if (active) {
      ctx.shadowColor = focused ? 'rgba(61,220,151,0.85)' : 'rgba(61,220,151,0.45)';
      ctx.shadowBlur = focused ? 26 : 14;
    }

    ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
    ctx.beginPath();
    ctx.ellipse(0, ry * 0.7, rx * 0.94, ry * 0.5, 0, 0, Math.PI * 2);
    ctx.fill();

    var face = ctx.createLinearGradient(-rx, -ry, rx, ry);
    if (active) {
      face.addColorStop(0, '#3f9e63');
      face.addColorStop(1, '#1f6b45');
    } else {
      face.addColorStop(0, 'rgba(56,120,92,0.72)');
      face.addColorStop(1, 'rgba(24,70,58,0.72)');
    }
    ctx.fillStyle = face;
    ctx.beginPath();
    ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;

    ctx.strokeStyle = active ? 'rgba(180,255,220,0.4)' : 'rgba(150,220,200,0.16)';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
    ctx.stroke();

    if (active) {
      ctx.strokeStyle = 'rgba(220,255,240,0.2)';
      ctx.lineWidth = 1;
      for (var i = -2; i <= 2; i += 1) {
        ctx.beginPath();
        ctx.moveTo(-rx * 0.86, ry * 0.12 * i);
        ctx.lineTo(rx * 0.86, ry * 0.12 * i);
        ctx.stroke();
      }
    }

    var label = leaf.type === 'space' ? 'SPACE' : String(leaf.key).toUpperCase();
    var size = leaf.type === 'space' ? rx * 0.52 : rx * 0.95;
    ctx.font = '700 ' + Math.round(size) + 'px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = active ? (focused ? '#eaffdf' : '#d6fff0') : 'rgba(190,235,220,0.45)';
    ctx.fillText(label, 0, 1);

    if (leaf.type === 'coin') drawCoin(rx * 0.72, -ry * 1.25, rx * 0.24);
    if (leaf.type === 'item') drawItemIcon(leaf.item, rx * 0.72, -ry * 1.25, rx * 0.26);
    if (leaf.type === 'space') {
      ctx.fillStyle = 'rgba(244,196,106,0.9)';
      ctx.font = '600 ' + Math.round(rx * 0.26) + 'px system-ui, sans-serif';
      ctx.fillText('冲刺 ⏫', 0, -ry * 1.35);
    }
    ctx.restore();
  }

  function drawCoin(x, y, r) {
    ctx.save();
    ctx.translate(x, y + Math.sin(view.time * 3 + x) * 2);
    ctx.fillStyle = '#f4c46a';
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(120,80,10,0.55)';
    ctx.lineWidth = Math.max(1.4, r * 0.16);
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.72, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  function drawItemIcon(kind, x, y, r) {
    ctx.save();
    ctx.translate(x, y + Math.sin(view.time * 2.4 + x) * 2);
    if (kind === 'clock') {
      ctx.fillStyle = 'rgba(10,40,44,0.95)';
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#9ff0d0';
      ctx.lineWidth = Math.max(1.4, r * 0.16);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(0, -r * 0.55);
      ctx.moveTo(0, 0);
      ctx.lineTo(r * 0.45, r * 0.2);
      ctx.stroke();
    } else if (kind === 'shield') {
      ctx.fillStyle = 'rgba(120,200,255,0.92)';
      ctx.beginPath();
      ctx.moveTo(0, -r);
      ctx.lineTo(r * 0.82, -r * 0.45);
      ctx.lineTo(r * 0.62, r * 0.55);
      ctx.lineTo(0, r);
      ctx.lineTo(-r * 0.62, r * 0.55);
      ctx.lineTo(-r * 0.82, -r * 0.45);
      ctx.closePath();
      ctx.fill();
    } else {
      ctx.strokeStyle = 'rgba(180,240,255,0.95)';
      ctx.lineWidth = Math.max(1.6, r * 0.2);
      ctx.lineCap = 'round';
      for (var i = 0; i < 3; i += 1) {
        var a = (Math.PI / 3) * i + view.time * 0.6;
        ctx.beginPath();
        ctx.moveTo(Math.cos(a) * r, Math.sin(a) * r);
        ctx.lineTo(-Math.cos(a) * r, -Math.sin(a) * r);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  /* ------------------------------------------------------------ 青蛙 */
  function drawFrog(x, y, scale) {
    var skin = SKINS[settings.skin] || SKINS.lime;
    var hopLift = view.hop ? Math.sin(Math.PI * Math.min(1, view.hop.t / view.hop.dur)) : 0;
    var bob = Math.sin(view.time * 3.2) * 1.6;
    var size = Math.min(cssW * 0.085, 46) * scale;

    ctx.save();
    ctx.translate(x, y - hopLift * cssH * 0.07 + bob);

    ctx.fillStyle = 'rgba(0,0,0,0.26)';
    ctx.beginPath();
    ctx.ellipse(0, size * 0.85, size * 1.05, size * 0.34, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = skin.dark;
    ctx.beginPath();
    ctx.ellipse(-size * 0.95, size * 0.3, size * 0.5, size * 0.32, -0.5, 0, Math.PI * 2);
    ctx.ellipse(size * 0.95, size * 0.3, size * 0.5, size * 0.32, 0.5, 0, Math.PI * 2);
    ctx.fill();

    var body = ctx.createRadialGradient(-size * 0.3, -size * 0.5, size * 0.2, 0, 0, size * 1.3);
    body.addColorStop(0, skin.light);
    body.addColorStop(1, skin.body);
    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.ellipse(0, 0, size, size * 0.82, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = skin.body;
    [-1, 1].forEach(function (side) {
      ctx.beginPath();
      ctx.arc(side * size * 0.52, -size * 0.62, size * 0.36, 0, Math.PI * 2);
      ctx.fill();
    });

    [-1, 1].forEach(function (side) {
      ctx.fillStyle = skin.eye;
      ctx.beginPath();
      ctx.arc(side * size * 0.5, -size * 0.66, size * 0.22, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#12241c';
      ctx.beginPath();
      ctx.arc(side * size * 0.52, -size * 0.66, size * 0.1, 0, Math.PI * 2);
      ctx.fill();
    });

    ctx.strokeStyle = 'rgba(20,50,35,0.55)';
    ctx.lineWidth = Math.max(1.4, size * 0.09);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(0, size * 0.1, size * 0.34, 0.28 * Math.PI, 0.72 * Math.PI);
    ctx.stroke();

    ctx.restore();
  }

  /* ------------------------------------------------------------ 岸边 */
  function drawStartBank() {
    var y = yOf(0);
    if (y < -80 || y > cssH + 90) return;
    ctx.save();
    var grad = ctx.createLinearGradient(0, y - 20, 0, y + 90);
    grad.addColorStop(0, '#3b4a3f');
    grad.addColorStop(1, '#1d2a25');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(-10, y + 6);
    ctx.quadraticCurveTo(cssW * 0.5, y - 24, cssW + 10, y + 6);
    ctx.lineTo(cssW + 10, cssH + 10);
    ctx.lineTo(-10, cssH + 10);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = 'rgba(180, 210, 190, 0.18)';
    for (var i = 0; i < 6; i += 1) {
      var bx = cssW * (0.12 + i * 0.15);
      ctx.beginPath();
      ctx.ellipse(bx, y + 22 + (i % 2) * 8, 12, 5, 0.2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawGoalBank() {
    if (!game) return;
    var y = yOf(game.rows + 1);
    if (y < -140 || y > cssH + 40) return;
    ctx.save();
    var grad = ctx.createLinearGradient(0, y + 40, 0, y - 30);
    grad.addColorStop(0, '#2f7a52');
    grad.addColorStop(1, '#184a34');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(-10, y + 30);
    ctx.quadraticCurveTo(cssW * 0.5, y - 8, cssW + 10, y + 30);
    ctx.lineTo(cssW + 10, -20);
    ctx.lineTo(-10, -20);
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = 'rgba(160, 240, 200, 0.35)';
    ctx.lineWidth = 2;
    for (var i = 0; i < 9; i += 1) {
      var gx = cssW * (0.08 + i * 0.105);
      var sway = Math.sin(view.time * 1.6 + i) * 4;
      ctx.beginPath();
      ctx.moveTo(gx, y + 26);
      ctx.quadraticCurveTo(gx + sway, y - 4, gx + sway * 1.6, y - 34);
      ctx.stroke();
    }
    ctx.restore();
  }

  /* ------------------------------------------------------------ 场景 */
  function drawStage() {
    drawGoalBank();
    drawStartBank();

    var rows = game.rows;
    var top = Math.min(rows, Math.ceil(view.camRow + 4.4));
    var bottom = Math.floor(view.camRow) - 1;

    for (var rowNo = top; rowNo >= 1; rowNo -= 1) {
      if (rowNo < bottom) break;
      var y = yOf(rowNo);
      if (y < -140 || y > cssH + 140) continue;
      var lanes = game.lanes[rowNo - 1] || [];
      var isActive = game.status === 'playing' && rowNo === game.row + 1;
      // 三片荷叶的一行要缩小，避免相邻荷叶叠在一起
      var baseRx = Math.min(cssW * (lanes.length > 2 ? 0.115 : 0.15), 70);
      for (var i = 0; i < lanes.length; i += 1) {
        var leaf = lanes[i];
        if (leaf.taken) continue;
        var rx = baseRx * (leaf.type === 'space' ? 1.28 : 1);
        drawLeaf(xOf(i, lanes.length), y, rx, leaf, isActive, isActive && i === game.laneIndex);
      }
    }

    drawFrog(view.frogX, view.frogY, view.hop ? 1 + Math.sin(Math.PI * Math.min(1, view.hop.t / view.hop.dur)) * 0.08 : 1);

    if (game.status === 'paused') {
      ctx.save();
      ctx.fillStyle = 'rgba(4, 20, 22, 0.55)';
      ctx.fillRect(0, 0, cssW, cssH);
      ctx.fillStyle = '#d9fff0';
      ctx.font = '700 20px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('已暂停', cssW / 2, cssH / 2);
      ctx.restore();
    }
  }

  function drawIdleScene() {
    var demo = [
      { key: 'a', type: 'leaf' },
      { key: 's', type: 'coin' },
      { key: 'd', type: 'leaf' }
    ];
    for (var i = 0; i < demo.length; i += 1) {
      drawLeaf(xOf(i, demo.length), cssH * 0.5, Math.min(cssW * 0.125, 54), demo[i], true, i === 1);
    }
    drawFrog(cssW / 2, cssH * 0.8, 1);
  }

  /* ------------------------------------------------------------ 特效 */
  function burst(x, y, color, count) {
    for (var i = 0; i < count; i += 1) {
      var angle = Math.random() * Math.PI * 2;
      var speed = 40 + Math.random() * 120;
      view.particles.push({
        x: x,
        y: y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 40,
        life: 0.5 + Math.random() * 0.4,
        max: 0.9,
        size: 2 + Math.random() * 3,
        color: color
      });
    }
  }

  function addFloat(x, y, text, color) {
    view.floats.push({ x: x, y: y, text: text, color: color, life: 0.9, max: 0.9, size: 16 });
  }

  function addRipple(x, y, color) {
    view.ripples.push({ x: x, y: y, r: 6, speed: 90, life: 0.6, max: 0.6, color: color });
  }

  function updateFx(dt) {
    view.time += dt;
    if (view.shake > 0) view.shake = Math.max(0, view.shake - dt * 2.4);
    if (view.flash > 0) view.flash = Math.max(0, view.flash - dt * 2.8);

    var targetCam = game ? frogAt.row : 0;
    view.camRow += (targetCam - view.camRow) * Math.min(1, dt * 7);

    if (view.hop) {
      var hop = view.hop;
      hop.t += dt;
      var k = Math.min(1, hop.t / hop.dur);
      var ease = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
      view.frogX = hop.fromX + (hop.toX - hop.fromX) * ease;
      if (k >= 1) {
        view.hop = null;
        view.frogX = hop.toX;
      }
    } else if (game) {
      var tx = xOf(frogAt.lane, laneCountOf(frogAt.row));
      view.frogX += (tx - view.frogX) * Math.min(1, dt * 12);
    }
    if (game) view.frogY = yOf(frogAt.row);

    view.particles = view.particles.filter(function (p) {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += 460 * dt;
      p.life -= dt;
      return p.life > 0;
    });
    view.floats = view.floats.filter(function (f) {
      f.y -= 42 * dt;
      f.life -= dt;
      return f.life > 0;
    });
    view.ripples = view.ripples.filter(function (r) {
      r.r += r.speed * dt;
      r.life -= dt;
      return r.life > 0;
    });
  }

  function drawFx() {
    view.ripples.forEach(function (r) {
      ctx.beginPath();
      ctx.strokeStyle = r.color;
      ctx.globalAlpha = Math.max(0, r.life / r.max) * 0.8;
      ctx.lineWidth = 2;
      ctx.arc(r.x, r.y, r.r, 0, Math.PI * 2);
      ctx.stroke();
    });
    ctx.globalAlpha = 1;

    view.particles.forEach(function (p) {
      ctx.globalAlpha = Math.max(0, p.life / p.max);
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.globalAlpha = 1;

    ctx.textAlign = 'center';
    view.floats.forEach(function (f) {
      ctx.globalAlpha = Math.max(0, f.life / f.max);
      ctx.fillStyle = f.color;
      ctx.font = '700 ' + f.size + 'px ui-monospace, Menlo, Consolas, monospace';
      ctx.fillText(f.text, f.x, f.y);
    });
    ctx.globalAlpha = 1;
  }

  function draw() {
    if (!ctx) return;
    ctx.save();
    if (view.shake > 0) {
      var amount = view.shake * 9;
      ctx.translate((Math.random() - 0.5) * amount, (Math.random() - 0.5) * amount);
    }
    drawWater();
    if (game) drawStage();
    else drawIdleScene();
    drawFx();
    if (view.flash > 0) {
      ctx.fillStyle = 'rgba(255, 96, 96, ' + (view.flash * 0.4) + ')';
      ctx.fillRect(0, 0, cssW, cssH);
    }
    ctx.restore();
  }

  /* ------------------------------------------------------------ HUD */
  function setText(node, text) {
    if (node && node.textContent !== text) node.textContent = text;
  }

  function repeat(ch, times) {
    var out = '';
    for (var i = 0; i < times; i += 1) out += ch;
    return out;
  }

  function syncPrompt() {
    if (!ui.promptKeys) return;
    if (!game || game.status !== 'playing') {
      if (promptSig !== '') {
        promptSig = '';
        ui.promptKeys.textContent = '';
      }
      setText(ui.promptLabel, game && game.status === 'paused' ? '暂停中' : '敲下荷叶上的字母');
      return;
    }
    var row = Logic.activeRow(game);
    var sig = game.row + '|' + game.laneIndex + '|' + row.map(function (leaf) { return leaf.key; }).join(',');
    if (sig === promptSig) return;
    promptSig = sig;

    ui.promptKeys.textContent = '';
    row.forEach(function (leaf, index) {
      var em = document.createElement('em');
      em.textContent = leaf.type === 'space' ? 'SPACE' : String(leaf.key).toUpperCase();
      if (leaf.type === 'space') em.className = 'space';
      if (index === game.laneIndex) em.classList.add('on');
      ui.promptKeys.appendChild(em);
    });
    setText(ui.promptLabel, '敲下这行的字母');
    setText(ui.liveStatus, '第 ' + game.level + ' 关，第 ' + (game.row + 1) + ' 排荷叶：'
      + row.map(function (leaf) { return leaf.type === 'space' ? '空格' : leaf.key; }).join('、'));
  }

  function syncHud() {
    var sig = game
      ? [game.score, game.coins, game.combo, game.lives, game.level, Math.round(game.timeLeft * 10),
        game.bestCombo, Math.round(Logic.progress(game) * 100), Math.round(Logic.accuracy(game) * 100),
        save.highScore].join('/')
      : 'idle';
    if (sig === hudSig) {
      syncPrompt();
      return;
    }
    hudSig = sig;

    setText(ui.scoreVal, String(game ? game.score : 0));
    setText(ui.comboVal, '×' + (game ? Logic.multiplier(game) : 1).toFixed(1));
    setText(ui.coinVal, String(game ? game.coins : 0));
    setText(ui.lifeVal, game
      ? repeat('❤', game.lives) + repeat('♡', Math.max(0, Logic.MAX_LIVES - game.lives))
      : '❤❤❤');
    setText(ui.levelChip, '第 ' + (game ? game.level : 1) + ' 关');
    setText(ui.bestVal, String(save.highScore));
    setText(ui.recordChip, '最高 ' + save.highScore);
    setText(ui.bestComboVal, String(game ? game.bestCombo : 0));
    setText(ui.accuracyVal, Math.round((game ? Logic.accuracy(game) : 1) * 100) + '%');
    setText(ui.progressVal, Math.round((game ? Logic.progress(game) : 0) * 100) + '%');

    if (game && ui.timeFill) {
      var pct = Math.max(0, Math.min(1, game.timeLeft / game.timeLimit));
      ui.timeFill.style.width = (pct * 100).toFixed(1) + '%';
      if (ui.timebar && ui.timebar.classList) ui.timebar.classList.toggle('low', pct < 0.25);
    }
    syncPrompt();
  }

  function showBanner(text, ms) {
    if (!ui.banner) return;
    setText(ui.bannerText, text);
    ui.banner.hidden = false;
    clearTimeout(bannerTimer);
    bannerTimer = setTimeout(function () {
      if (ui.banner) ui.banner.hidden = true;
    }, ms || 1200);
  }

  function toast(text) {
    if (!document.body) return;
    var node = document.createElement('div');
    node.className = 'toast';
    node.textContent = text;
    document.body.appendChild(node);
    setTimeout(function () {
      if (node.parentNode) node.parentNode.removeChild(node);
    }, 1900);
  }

  /* ------------------------------------------------------------ 流程 */
  function laneCountOf(rowNo) {
    if (!game || rowNo < 1 || rowNo > game.rows) return 1;
    var row = game.lanes[rowNo - 1];
    return row ? row.length : 1;
  }

  function moveFrogTo(rowNo) {
    var fromX = view.frogX;
    var lane = Math.min(frogAt.lane, laneCountOf(rowNo) - 1);
    frogAt = { row: rowNo, lane: Math.max(0, lane) };
    view.hop = {
      t: 0,
      dur: Math.abs(rowNo - view.camRow) > 1 ? 0.3 : 0.24,
      fromX: fromX,
      toX: xOf(frogAt.lane, laneCountOf(rowNo))
    };
  }

  function handleEvents() {
    if (!game) return;
    Logic.drainEvents(game).forEach(function (ev) {
      if (ev.type === 'jump') {
        moveFrogTo(ev.to);
        var px = xOf(ev.lane, laneCountOf(ev.to));
        var py = yOf(ev.to);
        var color = ev.kind === 'coin' ? '#f4c46a' : (ev.kind === 'item' ? '#9ff0d0' : '#8ef0c6');
        addRipple(px, py, color);
        burst(px, py, color, ev.kind === 'space' ? 16 : 9);
        if (ev.gained > 0) addFloat(px, py - 26, '+' + ev.gained, color);
        if (ev.walk) addFloat(px, py - 26, '走一步', '#90b6b1');
        beep(ev.kind === 'space' ? 700 : 520, 0.09, 'sine', 0.05);
        if (ev.kind === 'space') showBanner('冲刺！跳过一行', 900);
      } else if (ev.type === 'coin') {
        beep(880, 0.1, 'triangle', 0.05);
      } else if (ev.type === 'item') {
        var meta = Logic.ITEMS[ev.item];
        beep(760, 0.12, 'triangle', 0.05);
        toast('拾取 ' + (meta ? meta.title : '道具') + ' · ' + (meta ? meta.copy : ''));
        showBanner(meta ? meta.icon + ' ' + meta.title : '获得道具', 1000);
      } else if (ev.type === 'miss') {
        view.shake = 0.4;
        view.flash = 0.35;
        addFloat(cssW / 2, cssH * 0.62, 'MISS', '#ff8080');
        beep(170, 0.14, 'sawtooth', 0.05);
      } else if (ev.type === 'guard') {
        toast('护盾挡住了这次失误');
        beep(320, 0.12, 'square', 0.04);
      } else if (ev.type === 'drown') {
        view.shake = 0.55;
        showBanner('落水！补 ' + Math.round(Logic.DROWN_TIME) + ' 秒', 1200);
        beep(140, 0.28, 'sawtooth', 0.06);
      } else if (ev.type === 'win') {
        beep(660, 0.12, 'sine', 0.06);
        setTimeout(function () { beep(880, 0.16, 'sine', 0.06); }, 120);
        moveFrogTo(game.rows + 1);
        finish(true);
      } else if (ev.type === 'lose') {
        beep(120, 0.4, 'sawtooth', 0.07);
        finish(false);
      } else if (ev.type === 'achievement') {
        var ach = Logic.ACHIEVEMENTS[ev.id];
        if (ach) {
          toast('成就解锁 · ' + ach.title);
          if (save.achievements.indexOf(ev.id) === -1) {
            save.achievements.push(ev.id);
            persist();
          }
        }
      }
    });
  }

  function startGame() {
    game = Logic.createGame({
      difficulty: settings.difficulty,
      seed: ((Date.now() ^ (Math.random() * 0xffffffff)) >>> 0)
    });
    Logic.start(game);
    frogAt = { row: 0, lane: 0 };
    view.camRow = 0;
    view.hop = null;
    view.particles = [];
    view.floats = [];
    view.ripples = [];
    view.shake = 0;
    view.flash = 0;
    view.frogX = cssW / 2;
    view.frogY = yOf(0);
    promptSig = '';
    hudSig = '';

    ui.startPanel.hidden = true;
    ui.result.hidden = true;
    ui.pausePanel.hidden = true;
    if (ui.pauseBtn) {
      ui.pauseBtn.hidden = false;
      ui.pauseBtn.textContent = '暂停';
    }
    if (ui.restartBtn) ui.restartBtn.hidden = false;
    if (ui.banner) ui.banner.hidden = true;
    blurActive();
    beep(560, 0.1, 'sine', 0.05);
    syncHud();
    draw();
  }

  function goNextLevel() {
    if (!game) return;
    Logic.nextLevel(game);
    frogAt = { row: 0, lane: 0 };
    view.camRow = 0;
    view.hop = null;
    view.frogX = cssW / 2;
    view.frogY = yOf(0);
    hudSig = '';
    promptSig = '';
    ui.result.hidden = true;
    showBanner('第 ' + game.level + ' 关', 1000);
    syncHud();
  }

  function finish(won) {
    if (!game) return;
    save.highScore = Math.max(save.highScore, game.score);
    save.bestCombo = Math.max(save.bestCombo, game.bestCombo);
    save.coins += game.coins;
    if (won) save.clears += 1;
    persist();
    hudSig = '';
    setTimeout(function () { presentResult(won); }, won ? 360 : 160);
  }

  function presentResult(won) {
    if (!game) return;
    ui.result.hidden = false;
    if (ui.nextBtn) ui.nextBtn.hidden = !won;
    setText(ui.resultKicker, won ? '第 ' + game.level + ' 关 · 渡河成功' : '本局结束');
    setText(ui.resultTitle, won ? '抵达对岸' : '落水了');
    setText(ui.resultScore, String(game.score));
    setText(ui.resultCopy, won
      ? '还剩 ' + game.timeLeft.toFixed(1) + ' 秒，结算奖励已计入。下一关河面更宽，注意别打错。'
      : '小青蛙没能撑到对岸。把常用字母的位置记熟，连击会明显更稳。');

    if (ui.resultGrid) {
      ui.resultGrid.textContent = '';
      var cells = [
        ['金币', String(game.coins)],
        ['最高连击', String(game.bestCombo)],
        ['正确率', Math.round(Logic.accuracy(game) * 100) + '%'],
        ['用时', game.spent.toFixed(1) + 's'],
        ['关卡', '第 ' + game.level + ' 关'],
        ['最高分', String(save.highScore)]
      ];
      cells.forEach(function (cell) {
        var box = document.createElement('div');
        var value = document.createElement('b');
        var label = document.createElement('span');
        value.textContent = cell[1];
        label.textContent = cell[0];
        box.appendChild(value);
        box.appendChild(label);
        ui.resultGrid.appendChild(box);
      });
    }

    if (ui.resultBadges) {
      ui.resultBadges.textContent = '';
      game.achievements.forEach(function (id) {
        var meta = Logic.ACHIEVEMENTS[id];
        if (!meta) return;
        var badge = document.createElement('span');
        badge.className = 'badge';
        badge.textContent = '成就 · ' + meta.title;
        ui.resultBadges.appendChild(badge);
      });
    }
    if (ui.pauseBtn) ui.pauseBtn.hidden = true;
    if (ui.restartBtn) ui.restartBtn.hidden = true;
  }

  function quitToHome() {
    game = null;
    view.hop = null;
    view.particles = [];
    view.floats = [];
    view.ripples = [];
    ui.startPanel.hidden = false;
    ui.result.hidden = true;
    ui.pausePanel.hidden = true;
    if (ui.pauseBtn) ui.pauseBtn.hidden = true;
    if (ui.restartBtn) ui.restartBtn.hidden = true;
    hudSig = '';
    promptSig = '';
    syncStartMeta();
    syncHud();
  }

  function togglePause() {
    if (!game) return;
    if (game.status === 'playing') {
      Logic.pause(game);
      ui.pausePanel.hidden = false;
      if (ui.pauseBtn) ui.pauseBtn.textContent = '继续';
    } else if (game.status === 'paused') {
      resumeGame();
    }
  }

  function resumeGame() {
    if (!game || game.status !== 'paused') return;
    Logic.resume(game);
    ui.pausePanel.hidden = true;
    if (ui.pauseBtn) ui.pauseBtn.textContent = '暂停';
    blurActive();
  }

  /* ------------------------------------------------------------ 设置 */
  function syncStartMeta() {
    var total = Object.keys(Logic.ACHIEVEMENTS).length;
    setText(ui.startMeta, '最高分 ' + save.highScore + ' · 已渡河 ' + save.clears + ' 次 · 成就 '
      + save.achievements.length + '/' + total);
  }

  function applySettingsUi() {
    if (ui.diffRow) {
      Array.prototype.forEach.call(ui.diffRow.children || [], function (node) {
        if (!node.dataset) return;
        var on = node.dataset.diff === settings.difficulty;
        if (node.classList) node.classList.toggle('is-on', on);
      });
    }
    if (ui.skinRow) {
      Array.prototype.forEach.call(ui.skinRow.children || [], function (node) {
        if (!node.dataset) return;
        var on = node.dataset.skin === settings.skin;
        if (node.classList) node.classList.toggle('is-on', on);
      });
    }
    var conf = Logic.DIFFICULTIES[settings.difficulty];
    setText(ui.diffHint, conf ? conf.hint : '');
  }

  function setDifficulty(key) {
    if (!Logic.DIFFICULTIES[key]) return;
    settings.difficulty = key;
    persist();
    applySettingsUi();
    beep(420, 0.06, 'triangle', 0.03);
  }

  function setSkin(key) {
    if (!SKINS[key]) return;
    settings.skin = key;
    persist();
    applySettingsUi();
    draw();
  }

  /* ------------------------------------------------------------ 输入 */
  function blurActive() {
    var active = document.activeElement;
    if (active && typeof active.blur === 'function') active.blur();
  }

  function applyResult() {
    handleEvents();
    syncHud();
  }

  function onKeyDown(event) {
    var key = event.key;

    if (key === 'Escape') {
      event.preventDefault();
      if (ui.startPanel.hidden) togglePause();
      return;
    }

    if (!ui.startPanel.hidden) {
      if (key === 'Enter') {
        event.preventDefault();
        startGame();
      }
      return;
    }

    if (!ui.result.hidden) {
      if (key === 'Enter') {
        event.preventDefault();
        if (game && game.status === 'won') goNextLevel();
        else startGame();
      }
      return;
    }

    if (!ui.pausePanel.hidden) {
      if (key === 'Enter') {
        event.preventDefault();
        resumeGame();
      }
      return;
    }

    if (!game || game.status !== 'playing') return;

    if (key === 'ArrowLeft' || key === 'ArrowRight') {
      event.preventDefault();
      Logic.selectLane(game, key === 'ArrowLeft' ? -1 : 1);
      syncPrompt();
      return;
    }
    if (key === 'ArrowUp') {
      event.preventDefault();
      applyResult(Logic.walkUp(game));
      return;
    }

    var ch = Logic.normalizeKey(key);
    if (!ch || !/^[a-z0-9 ]$/.test(ch)) return;
    event.preventDefault();
    applyResult(Logic.press(game, ch));
  }

  /* ------------------------------------------------------------ 主循环 */
  function loop(ts) {
    var dt = lastTs ? Math.min(0.05, (ts - lastTs) / 1000) : 0.016;
    lastTs = ts;
    if (game && game.status === 'playing') {
      var res = Logic.tick(game, dt);
      if (res.kind !== 'tick') handleEvents();
    }
    updateFx(dt);
    draw();
    syncHud();
    if (typeof window.requestAnimationFrame === 'function') window.requestAnimationFrame(loop);
    else setTimeout(function () { loop(Date.now()); }, 16);
  }

  function onResize() {
    fitCanvas();
    draw();
  }

  function onVisibility() {
    if (document.hidden && game && game.status === 'playing') togglePause();
  }

  function bindEvents() {
    if (ui.startBtn) ui.startBtn.addEventListener('click', startGame);
    if (ui.restartBtn) ui.restartBtn.addEventListener('click', startGame);
    if (ui.againBtn) ui.againBtn.addEventListener('click', startGame);
    if (ui.nextBtn) ui.nextBtn.addEventListener('click', goNextLevel);
    if (ui.toHomeBtn) ui.toHomeBtn.addEventListener('click', quitToHome);
    if (ui.homeBtn) ui.homeBtn.addEventListener('click', quitToHome);
    if (ui.pauseBtn) {
      ui.pauseBtn.addEventListener('click', function () {
        if (game && game.status === 'playing') togglePause();
        else resumeGame();
      });
    }
    if (ui.resumeBtn) ui.resumeBtn.addEventListener('click', resumeGame);
    if (ui.quitBtn) ui.quitBtn.addEventListener('click', quitToHome);
    if (ui.diffRow) {
      ui.diffRow.addEventListener('click', function (event) {
        var btn = event.target && event.target.closest ? event.target.closest('[data-diff]') : null;
        if (btn && btn.dataset) setDifficulty(btn.dataset.diff);
      });
    }
    if (ui.skinRow) {
      ui.skinRow.addEventListener('click', function (event) {
        var btn = event.target && event.target.closest ? event.target.closest('[data-skin]') : null;
        if (btn && btn.dataset) setSkin(btn.dataset.skin);
      });
    }
    document.addEventListener('keydown', onKeyDown);
    window.addEventListener('resize', onResize);
    document.addEventListener('visibilitychange', onVisibility);
  }

  function init() {
    save = loadSave();
    settings.difficulty = save.difficulty;
    settings.skin = save.skin;
    applySettingsUi();
    syncStartMeta();
    fitCanvas();
    view.frogX = cssW / 2;
    view.frogY = cssH * 0.78;
    bindEvents();
    syncHud();
    draw();
    if (typeof window.requestAnimationFrame === 'function') window.requestAnimationFrame(loop);
    else setTimeout(function () { loop(Date.now()); }, 16);
  }

  window.FrogGame = {
    state: function () { return game; },
    view: view,
    startGame: startGame,
    nextLevel: goNextLevel,
    quitToHome: quitToHome,
    start: startGame,
    settings: settings,
    save: function () { return save; },
    ui: ui,
    press: function (key) {
      if (!game) return null;
      var res = Logic.press(game, key);
      handleEvents();
      syncHud();
      return res;
    }
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
