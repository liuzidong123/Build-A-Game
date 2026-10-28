/*
 * 拳皇 · 画面与操作层
 * 复用 static/images 下素材：背景用 CSS 动画 GIF，角色用 static/images/player/kyo/*.gif。
 * 角色精灵有两条渲染路径：
 *   A. <img> 直接播放 GIF，由浏览器原生驱动动画（file:// 直开也能看到动画）
 *   B. 内置解码器逐帧解码，可量出每帧可见边界做贴地对齐（http 下优先）
 * 两条都不可用时退化为矢量角色，保证始终可玩。
 */
(function () {
  'use strict';

  var Logic = window.KofLogic;
  var CONFIG = Logic ? Logic.CONFIG : { width: 1280, height: 720, groundY: 450, bodyWidth: 96, bodyHeight: 200 };
  var STORE_KEY = 'kof.v1';

  // 顺序沿用原 kyo.js：0 idle / 1 前进 / 2 后退 / 3 跳跃 / 4 攻击 / 5 受击 / 6 倒地
  var SPRITE = {
    dir: './static/images/player/kyo/',
    target: 300,  // 站立时想占用的可见像素高度（画布 720 高）
    feet: 640,    // 贴地时角色脚底所在高度
    rates: [5, 5, 5, 4, 5, 5, 5]
  };

  var SKINS = [
    { aura: 'rgba(96,208,255,0.95)', body: '#4a7fd4', trim: '#cfe6ff' },
    { aura: 'rgba(255,118,96,0.95)', body: '#c2493f', trim: '#ffd9cf' }
  ];

  var ui = {};
  var keys = Object.create(null);
  var touch = { left: false, right: false, up: false, light: false, heavy: false, block: false };

  var view = { time: 0, shake: 0, hitStop: 0, flash: 0, particles: [], floats: [], sprites: [null, null] };
  var scratch = { p0: null, p1: null };  // 2P 染色用的临时画布

  var app = {
    match: null, mode: 'cpu', difficulty: 'normal',
    running: false, paused: false, locked: false,
    stats: { hits: 0, damage: 0, blocks: 0, bestCombo: 0 },
    record: { wins: 0, loses: 0, bestCombo: 0, matches: 0 }
  };

  /* --------------------------------------------------------------- 存档 */
  function loadStore() {
    try {
      var data = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
      if (data && data.record) app.record = Object.assign(app.record, data.record);
      if (data && data.difficulty) app.difficulty = data.difficulty;
      if (data && data.mode) app.mode = data.mode;
    } catch (e) { /* 忽略损坏存档 */ }
  }

  function saveStore() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({
        record: app.record, difficulty: app.difficulty, mode: app.mode, ts: Date.now()
      }));
    } catch (e) { /* 隐私模式忽略 */ }
  }

  /* --------------------------------------------------------------- 音效 */
  var audio = { ctx: null, on: true };

  function beep(freq, dur, type, gain) {
    if (!audio.on) return;
    try {
      if (!audio.ctx) {
        var AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) { audio.on = false; return; }
        audio.ctx = new AC();
      }
      var c = audio.ctx;
      if (c.state === 'suspended' && c.resume) c.resume();
      var osc = c.createOscillator();
      var g = c.createGain();
      osc.type = type || 'square';
      osc.frequency.value = freq;
      g.gain.value = gain == null ? 0.045 : gain;
      osc.connect(g);
      g.connect(c.destination);
      var now = c.currentTime;
      g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
      osc.start(now);
      osc.stop(now + dur + 0.02);
    } catch (e) { audio.on = false; }
  }

  /* --------------------------------------------------------------- 精灵 */
  function hasDecoder() {
    return typeof window.KofGifDecoder === 'function'
      && typeof XMLHttpRequest === 'function'
      && typeof location !== 'undefined'
      && /^https?:$/.test(location.protocol || '');
  }

  /* 取一帧的不透明像素上下边界，用来把不同姿态的脚底对齐 */
  function alphaBounds(canvas) {
    var c2 = canvas.getContext && canvas.getContext('2d');
    if (!c2 || !c2.getImageData) return null;
    var w = canvas.width;
    var h = canvas.height;
    var data;
    try { data = c2.getImageData(0, 0, w, h).data; } catch (e) { return null; }
    var top = -1;
    var bottom = -1;
    for (var y = 0; y < h; y += 1) {
      var hit = false;
      for (var x = 0; x < w; x += 1) {
        if (data[(y * w + x) * 4 + 3] > 8) { hit = true; break; }
      }
      if (hit) { if (top < 0) top = y; bottom = y; }
    }
    return top < 0 ? null : { top: top, bottom: bottom };
  }

  function tinted(src, color) {
    var cv = document.createElement('canvas');
    cv.width = src.width;
    cv.height = src.height;
    var c2 = cv.getContext && cv.getContext('2d');
    if (!c2) return src;
    c2.drawImage(src, 0, 0);
    c2.globalCompositeOperation = 'source-atop';
    c2.fillStyle = color;
    c2.fillRect(0, 0, cv.width, cv.height);
    return cv;
  }

  function buildSet(gif, color) {
    var frames = [];
    var bottoms = [];
    var widest = 0;
    for (var i = 0; i < gif.frames.length; i += 1) {
      var src = gif.frames[i] && gif.frames[i].image;
      if (!src) continue;
      var box = alphaBounds(src);
      frames.push(color ? tinted(src, color) : src);
      bottoms.push(box ? box.bottom : src.height);
      if (!widest && box) widest = box.bottom - box.top + 1;
    }
    return { frames: frames, bottoms: bottoms, height: widest };
  }

  function clampScale(v) {
    return Math.max(0.4, Math.min(6, v || 1));
  }

  // 同一动作位可能先被 <img> 原生动画占位，再被解码器逐帧数据覆盖
  function setAnim(id, index, patch) {
    view.sprites[id] = view.sprites[id] || {};
    var anim = view.sprites[id][index] || {};
    for (var key in patch) {
      if (Object.prototype.hasOwnProperty.call(patch, key)) anim[key] = patch[key];
    }
    view.sprites[id][index] = anim;
    return anim;
  }

  // 2P 染色：把当前 GIF 帧画到临时画布再叠色；file:// 下 canvas 被污染也不影响绘制
  function tintFrame(img, color, id) {
    var key = 'p' + id;
    var w = img.naturalWidth || img.width;
    var h = img.naturalHeight || img.height;
    if (!w || !h) return img;
    var cv = scratch[key];
    if (!cv) {
      cv = document.createElement('canvas');
      scratch[key] = cv;
    }
    if (cv.width !== w || cv.height !== h) {
      cv.width = w;
      cv.height = h;
    }
    var c2 = cv.getContext && cv.getContext('2d');
    if (!c2) return img;
    c2.clearRect(0, 0, w, h);
    c2.drawImage(img, 0, 0);
    c2.globalCompositeOperation = 'source-atop';
    c2.fillStyle = color;
    c2.fillRect(0, 0, w, h);
    c2.globalCompositeOperation = 'source-over';
    return cv;
  }

  // 路径 A：<img> 直接加载 GIF，动画由浏览器原生播放，不需要 XHR
  function loadImages() {
    if (imagesLoading || typeof Image !== 'function') return;
    imagesLoading = true;
    SPRITE.rates.forEach(function (rate, index) {
      var img = new Image();
      img.onload = function () {
        if (!img.naturalWidth) return;
        var foot = img.naturalHeight;
        if (index === 0 && !view.scaleMeasured) {
          view.spriteScale = clampScale(SPRITE.target / foot);
        }
        setAnim(0, index, { img: img, rate: rate, foot: foot });
        setAnim(1, index, { img: img, rate: rate, foot: foot, tint: 'rgba(255,86,66,0.42)' });
      };
      img.src = SPRITE.dir + index + '.gif';
    });
  }

  // 路径 B：内置解码器逐帧取像素，顺便量出每帧可见边界用于贴地对齐
  function loadSprites() {
    if (!hasDecoder()) return;
    var Decoder = window.KofGifDecoder;
    SPRITE.rates.forEach(function (rate, index) {
      var gif = Decoder();
      gif.load(SPRITE.dir + index + '.gif');
      gif.onload = function () {
        var base = buildSet(gif, null);
        if (!base.frames.length) return;
        var red = buildSet(gif, 'rgba(255,86,66,0.5)');

        setAnim(0, index, { frames: base.frames, bottoms: base.bottoms, rate: rate });
        setAnim(1, index, { frames: red.frames, bottoms: red.bottoms, rate: rate });

        // 站立帧的可见高度决定整体缩放，保证各姿态大小一致
        if (index === 0 && base.height > 0) {
          view.spriteScale = clampScale(SPRITE.target / base.height);
          view.scaleMeasured = true;
        }
      };
    });
  }

  function spriteOf(id, stateNo) {
    var set = view.sprites[id];
    var anim = set && set[stateNo];
    if (!anim) return null;
    if (anim.frames && anim.frames.length) return anim;
    if (anim.img && anim.img.complete && anim.img.naturalWidth) return anim;
    return null;
  }

  function stateNoOf(fighter) {
    switch (fighter.state) {
      case 'walk': return 1;
      case 'walkBack': return 2;
      case 'jump': return 3;
      case 'attack': return 4;
      case 'hit': return 5;
      case 'ko': return 6;
      default: return 0;
    }
  }

  /* --------------------------------------------------------------- 绘制 */
  function drawSprite(fighter, anim) {
    var img;
    var foot;
    if (anim.frames && anim.frames.length) {
      var index = Math.floor(fighter.stateTime * 60 / anim.rate) % anim.frames.length;
      img = anim.frames[index];
      if (!img) return false;
      foot = anim.bottoms[index] >= 0 ? anim.bottoms[index] : img.height;
    } else {
      // 原生 GIF：浏览器自己推进帧，这里只负责排版与染色
      img = anim.img;
      if (!img || !img.complete || !img.naturalWidth) return false;
      foot = anim.foot || img.naturalHeight;
      if (anim.tint) img = tintFrame(img, anim.tint, fighter.id);
    }

    var s = view.spriteScale || 1;
    var w = (img.naturalWidth || img.width) * s;
    var h = (img.naturalHeight || img.height) * s;
    var feetY = SPRITE.feet + (fighter.y - CONFIG.groundY);
    var ctx = ui.ctx;

    ctx.save();
    if (fighter.facing < 0) {
      ctx.translate(fighter.x * 2, 0);
      ctx.scale(-1, 1);
    }
    if (fighter.state === 'hit' || fighter.state === 'ko') ctx.globalAlpha = 0.95;
    ctx.drawImage(img, fighter.x - w / 2, feetY - foot * s, w, h);
    ctx.restore();
    return true;
  }

  /* 精灵不可用时的矢量角色 */
  function drawVectorFighter(fighter) {
    var ctx = ui.ctx;
    var skin = SKINS[fighter.id] || SKINS[0];
    var h = 260;
    var w = CONFIG.bodyWidth;
    var t = fighter.stateTime;
    var attack = fighter.state === 'attack';
    var swing = attack ? Math.sin(Math.min(1, t / 0.2) * Math.PI) : 0;
    var legs = fighter.state === 'walk' ? Math.sin(t * 14) * 16 : 0;
    var crouch = fighter.state === 'hit' ? 14 : 0;
    var feetY = SPRITE.feet + (fighter.y - CONFIG.groundY);

    ctx.save();
    ctx.translate(fighter.x, feetY);
    ctx.scale(fighter.facing, 1);

    ctx.fillStyle = skin.body;
    ctx.strokeStyle = skin.trim;
    ctx.lineWidth = 3;

    ctx.beginPath();
    ctx.moveTo(-8, -h * 0.42);
    ctx.lineTo(-16 - legs, -4);
    ctx.moveTo(8, -h * 0.42);
    ctx.lineTo(16 + legs, -4);
    ctx.stroke();

    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(-w * 0.24, -h * 0.86 + crouch, w * 0.48, h * 0.46, 12);
    else ctx.rect(-w * 0.24, -h * 0.86 + crouch, w * 0.48, h * 0.46);
    ctx.fill();
    ctx.stroke();

    ctx.lineWidth = 9;
    ctx.beginPath();
    ctx.moveTo(0, -h * 0.74 + crouch);
    if (swing > 0) ctx.lineTo(w * 0.46 * swing, -h * 0.6 + crouch);
    else ctx.lineTo(w * 0.2, -h * 0.48 + crouch);
    ctx.stroke();

    ctx.fillStyle = '#f0d3b0';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(0, -h * 0.93 + crouch, w * 0.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  function drawShadow(fighter) {
    var ctx = ui.ctx;
    var air = Math.max(0, CONFIG.groundY - fighter.y);
    var alpha = Math.max(0.06, 0.26 - air / 900);
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,' + alpha.toFixed(3) + ')';
    ctx.beginPath();
    ctx.ellipse(fighter.x, SPRITE.feet + 6, 62 - air * 0.03, 14, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawAura(fighter) {
    if (fighter.state === 'ko') return;
    var ctx = ui.ctx;
    var skin = SKINS[fighter.id] || SKINS[0];
    ctx.save();
    var g = ctx.createRadialGradient
      ? ctx.createRadialGradient(fighter.x, fighter.y - 40, 10, fighter.x, fighter.y - 40, 130)
      : null;
    if (g && g.addColorStop) {
      g.addColorStop(0, skin.aura);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.globalAlpha = 0.16;
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.ellipse(fighter.x, CONFIG.groundY + 190, 90, 30, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawFighter(fighter) {
    drawShadow(fighter);
    var anim = spriteOf(fighter.id, stateNoOf(fighter));
    if (!anim || !drawSprite(fighter, anim)) drawVectorFighter(fighter);
  }

  /* --------------------------------------------------------------- 特效 */
  function burst(x, y, color, count) {
    for (var i = 0; i < count; i += 1) {
      var a = Math.random() * Math.PI * 2;
      var sp = 90 + Math.random() * 320;
      view.particles.push({
        x: x, y: y,
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 60,
        life: 0.3 + Math.random() * 0.28, max: 0.58,
        size: 2 + Math.random() * 4, color: color
      });
    }
  }

  function addFloat(x, y, text, color, size) {
    view.floats.push({ x: x, y: y, text: text, color: color || '#fff', life: 0.85, max: 0.85, size: size || 26 });
  }

  function updateFx(dt) {
    view.time += dt;
    if (view.shake > 0) view.shake = Math.max(0, view.shake - dt * 3.2);
    if (view.flash > 0) view.flash = Math.max(0, view.flash - dt * 3.4);
    view.particles = view.particles.filter(function (p) {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += 900 * dt;
      p.life -= dt;
      return p.life > 0;
    });
    view.floats = view.floats.filter(function (f) {
      f.y -= 60 * dt;
      f.life -= dt;
      return f.life > 0;
    });
  }

  function drawFx() {
    var ctx = ui.ctx;
    var i;
    for (i = 0; i < view.particles.length; i += 1) {
      var p = view.particles[i];
      ctx.globalAlpha = Math.max(0, p.life / p.max);
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    for (i = 0; i < view.floats.length; i += 1) {
      var f = view.floats[i];
      ctx.globalAlpha = Math.max(0, f.life / f.max);
      ctx.fillStyle = f.color;
      ctx.font = '700 ' + f.size + 'px "Segoe UI", system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(f.text, f.x, f.y);
    }
    ctx.globalAlpha = 1;
  }

  function renderScene() {
    var ctx = ui.ctx;
    var w = CONFIG.width;
    var h = CONFIG.height;
    ctx.save();
    ctx.clearRect(0, 0, w, h);

    if (view.shake > 0) {
      ctx.translate((Math.random() - 0.5) * view.shake * 16, (Math.random() - 0.5) * view.shake * 12);
    }

    // 地面光影
    var g = ctx.createLinearGradient ? ctx.createLinearGradient(0, 420, 0, 720) : null;
    if (g && g.addColorStop) {
      g.addColorStop(0, 'rgba(4, 8, 14, 0)');
      g.addColorStop(1, 'rgba(4, 8, 14, 0.66)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 420, w, 300);
    }

    if (app.match) {
      var list = app.match.fighters.slice().sort(function (a, b) { return a.y - b.y; });
      list.forEach(function (fighter) { drawAura(fighter); drawFighter(fighter); });
    }
    drawFx();

    if (view.flash > 0) {
      ctx.fillStyle = 'rgba(255,255,255,' + (view.flash * 0.5).toFixed(3) + ')';
      ctx.fillRect(0, 0, w, h);
    }
    ctx.restore();
  }

  /* --------------------------------------------------------------- HUD */
  var uiIds = ['screen', 'hp0', 'hp1', 'hpGhost0', 'hpGhost1', 'timer', 'pips0', 'pips1',
    'combo0', 'combo1', 'name1', 'banner', 'bannerMain', 'bannerSub', 'menu', 'startBtn',
    'diffRow', 'modeRow', 'diffHint', 'modeHint', 'pausePanel', 'resumeBtn', 'restartBtn',
    'quitBtn', 'result', 'resultTitle', 'resultSub', 'statHits', 'statDamage', 'statBlocks',
    'statCombo', 'againBtn', 'menuBtn', 'recWins', 'recLoses', 'recCombo', 'recMatches',
    'touchPad', 'playHint'];

  function cacheDom() {
    uiIds.forEach(function (id) { ui[id] = document.getElementById(id); });
    ui.canvas = ui.screen;
    ui.ctx = ui.screen && ui.screen.getContext ? ui.screen.getContext('2d') : null;
  }

  var ghost = [100, 100];
  var bannerTimer = null;
  var hudCache = {};

  function setText(node, key, value) {
    if (hudCache[key] === value) return;
    hudCache[key] = value;
    if (node) node.textContent = value;
  }

  function setWidth(node, key, value) {
    if (hudCache[key] === value) return;
    hudCache[key] = value;
    if (node) node.style.width = Math.max(0, Math.min(100, value)) + '%';
  }

  function syncHud(dt) {
    var match = app.match;
    if (!match) return;
    var f0 = match.fighters[0];
    var f1 = match.fighters[1];

    ghost[0] += (f0.hp - ghost[0]) * Math.min(1, dt * 3.2);
    ghost[1] += (f1.hp - ghost[1]) * Math.min(1, dt * 3.2);
    if (Math.abs(ghost[0] - f0.hp) < 0.4) ghost[0] = f0.hp;
    if (Math.abs(ghost[1] - f1.hp) < 0.4) ghost[1] = f1.hp;

    setWidth(ui.hp0, 'w0', f0.hp);
    setWidth(ui.hp1, 'w1', f1.hp);
    setWidth(ui.hpGhost0, 'g0', Math.round(ghost[0]));
    setWidth(ui.hpGhost1, 'g1', Math.round(ghost[1]));

    setText(ui.timer, 'timer', String(Math.ceil(match.timer)));
    setText(ui.combo0, 'c0', f0.combo >= 2 ? f0.combo + ' HIT' : '');
    setText(ui.combo1, 'c1', f1.combo >= 2 ? f1.combo + ' HIT' : '');
    setText(ui.name1, 'n1', app.mode === 'cpu' ? 'CPU · 草薙 京' : '2P · 草薙 京');

    setPips(ui.pips0, match.wins[0]);
    setPips(ui.pips1, match.wins[1]);
  }

  function setPips(host, wins) {
    if (!host || !host.children) return;
    for (var i = 0; i < host.children.length; i += 1) {
      host.children[i].classList.toggle('on', i < wins);
    }
  }

  function showBanner(main, sub, ms) {
    if (!ui.banner) return;
    if (ui.bannerMain) ui.bannerMain.textContent = main || '';
    if (ui.bannerSub) ui.bannerSub.textContent = sub || '';
    ui.banner.hidden = false;
    ui.banner.classList.remove('pop');
    void ui.banner.offsetWidth;
    ui.banner.classList.add('pop');
    clearTimeout(bannerTimer);
    bannerTimer = setTimeout(function () { ui.banner.hidden = true; }, ms || 1100);
  }

  /* --------------------------------------------------------------- 事件 */
  function handleEvents(list) {
    for (var i = 0; i < list.length; i += 1) {
      var ev = list[i];
      if (ev.type === 'hit') {
        var color = ev.from === 0 ? '#8ef0ff' : '#ffb08e';
        burst(ev.x, ev.y + 20, color, ev.heavy ? 22 : 14);
        addFloat(ev.x, ev.y - 20, '-' + ev.damage, '#ffe6a6', ev.heavy ? 34 : 26);
        if (ev.combo >= 2) addFloat(ev.x + 40, ev.y - 70, ev.combo + ' HIT', color, 22);
        view.shake = Math.min(1, view.shake + (ev.heavy ? 0.6 : 0.32));
        view.hitStop = 0.05;
        beep(ev.heavy ? 150 : 210, 0.09, 'square', 0.05);
        if (ev.from === 0) {
          app.stats.hits += 1;
          app.stats.damage += ev.damage;
          app.stats.bestCombo = Math.max(app.stats.bestCombo, ev.combo);
        }
      } else if (ev.type === 'block') {
        burst(ev.x, ev.y + 30, '#9fe8ff', 8);
        addFloat(ev.x, ev.y - 10, 'GUARD', '#9fe8ff', 20);
        beep(520, 0.05, 'triangle', 0.03);
        if (ev.to === 0) app.stats.blocks += 1;
      } else if (ev.type === 'swing') {
        beep(ev.kind === 'heavy' ? 320 : 420, 0.03, 'sine', 0.02);
      } else if (ev.type === 'roundStart') {
        showBanner('第 ' + ev.round + ' 回合', 'FIGHT!', 1200);
        ghost = [100, 100];
        beep(660, 0.08, 'square', 0.04);
      } else if (ev.type === 'roundEnd') {
        var who = ev.winner < 0 ? 'DRAW' : (ev.winner === 0 ? 'YOU WIN' : 'YOU LOSE');
        showBanner(ev.reason === 'time' ? 'TIME UP' : 'K.O.', who, 1600);
        view.flash = 1;
        beep(ev.winner === 0 ? 720 : 180, 0.22, 'sawtooth', 0.05);
      } else if (ev.type === 'match') {
        finishMatch(ev.winner);
      }
    }
  }

  /* --------------------------------------------------------------- 流程 */
  function hide(node) { if (node) node.hidden = true; }
  function show(node) { if (node) node.hidden = false; }

  function startMatch() {
    app.match = Logic.createMatch({ seed: (Date.now() & 0xffffff) + 1, roundTime: 60, roundsToWin: 2 });
    Logic.startRound(app.match);
    app.stats = { hits: 0, damage: 0, blocks: 0, bestCombo: 0 };
    app.running = true;
    app.paused = false;
    app.locked = false;
    ghost = [100, 100];
    view.particles = [];
    view.floats = [];
    hide(ui.menu);
    hide(ui.result);
    hide(ui.pausePanel);
    handleEvents(Logic.drainEvents(app.match));
    syncHud(0.016);
    beep(520, 0.1, 'square', 0.04);
  }

  function finishMatch(winner) {
    var win = winner === 0;
    app.running = false;
    app.record.matches += 1;
    if (win) app.record.wins += 1; else app.record.loses += 1;
    app.record.bestCombo = Math.max(app.record.bestCombo, app.stats.bestCombo);
    saveStore();
    syncRecord();

    if (ui.resultTitle) ui.resultTitle.textContent = win ? 'WINNER' : 'YOU LOSE';
    if (ui.resultSub) {
      ui.resultSub.textContent = win
        ? '你守住了擂台，' + app.match.wins[0] + ' : ' + app.match.wins[1] + ' 拿下本场'
        : '对手赢下本场，再来一局？';
    }
    if (ui.statHits) ui.statHits.textContent = String(app.stats.hits);
    if (ui.statDamage) ui.statDamage.textContent = String(app.stats.damage);
    if (ui.statBlocks) ui.statBlocks.textContent = String(app.stats.blocks);
    if (ui.statCombo) ui.statCombo.textContent = String(app.stats.bestCombo);
    setTimeout(function () { if (!app.match || app.match.phase === 'matchEnd') show(ui.result); }, 900);
  }

  function togglePause() {
    if (!app.match || app.match.phase === 'matchEnd') return;
    app.paused = !app.paused;
    if (app.paused) show(ui.pausePanel); else hide(ui.pausePanel);
  }

  function quitToMenu() {
    app.match = null;
    app.running = false;
    app.paused = false;
    hide(ui.pausePanel);
    hide(ui.result);
    show(ui.menu);
  }

  function syncRecord() {
    if (ui.recWins) ui.recWins.textContent = String(app.record.wins);
    if (ui.recLoses) ui.recLoses.textContent = String(app.record.loses);
    if (ui.recCombo) ui.recCombo.textContent = String(app.record.bestCombo);
    if (ui.recMatches) ui.recMatches.textContent = String(app.record.matches);
  }

  function syncMenu() {
    if (ui.diffRow && ui.diffRow.children) {
      Array.prototype.forEach.call(ui.diffRow.children, function (btn) {
        btn.classList.toggle('is-on', btn.dataset && btn.dataset.diff === app.difficulty);
      });
    }
    if (ui.modeRow && ui.modeRow.children) {
      Array.prototype.forEach.call(ui.modeRow.children, function (btn) {
        btn.classList.toggle('is-on', btn.dataset && btn.dataset.mode === app.mode);
      });
    }
    if (ui.diffHint) {
      ui.diffHint.textContent = app.mode === 'cpu'
        ? ({ easy: '电脑出手慢，适合熟悉操作', normal: '电脑会攻防切换，练连招', hard: '电脑压迫感强，考验防守' })[app.difficulty]
        : '同屏对战：1P 用 A/D/W/J/K/L，2P 用方向键与 1/2/3';
    }
    if (ui.modeHint) {
      ui.modeHint.textContent = app.mode === 'cpu' ? '人机对战' : '双人对战';
    }
  }

  /* --------------------------------------------------------------- 输入 */
  function held(code) { return !!keys[code]; }

  function readInput(id) {
    if (id === 0) {
      return {
        left: held('KeyA') || touch.left, right: held('KeyD') || touch.right,
        up: held('KeyW') || touch.up, light: held('KeyJ') || touch.light,
        heavy: held('KeyK') || touch.heavy, block: held('KeyL') || touch.block
      };
    }
    if (app.mode === 'cpu' && Logic) return Logic.aiInput(app.match, 1, app.difficulty);
    return {
      left: held('ArrowLeft'), right: held('ArrowRight'), up: held('ArrowUp'),
      light: held('Numpad1') || held('Comma'), heavy: held('Numpad2') || held('Period'),
      block: held('Numpad3') || held('Slash')
    };
  }

  function onKeyDown(e) {
    keys[e.code || e.key] = true;
    if (e.key === 'Escape') { togglePause(); }
    if (e.key === 'Enter' && ui.menu && !ui.menu.hidden) startMatch();
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space'].indexOf(e.key) !== -1
      && e.preventDefault) e.preventDefault();
  }

  function onKeyUp(e) { keys[e.code || e.key] = false; }

  function bindEvents() {
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', function () { keys = Object.create(null); });

    if (ui.startBtn) ui.startBtn.addEventListener('click', startMatch);
    if (ui.resumeBtn) ui.resumeBtn.addEventListener('click', togglePause);
    if (ui.restartBtn) ui.restartBtn.addEventListener('click', startMatch);
    if (ui.quitBtn) ui.quitBtn.addEventListener('click', quitToMenu);
    if (ui.againBtn) ui.againBtn.addEventListener('click', startMatch);
    if (ui.menuBtn) ui.menuBtn.addEventListener('click', quitToMenu);

    if (ui.diffRow) {
      ui.diffRow.addEventListener('click', function (e) {
        var btn = e.target && e.target.closest ? e.target.closest('[data-diff]') : null;
        if (!btn) return;
        app.difficulty = btn.dataset.diff;
        syncMenu();
        saveStore();
      });
    }
    if (ui.modeRow) {
      ui.modeRow.addEventListener('click', function (e) {
        var btn = e.target && e.target.closest ? e.target.closest('[data-mode]') : null;
        if (!btn) return;
        app.mode = btn.dataset.mode;
        syncMenu();
        saveStore();
      });
    }

    if (ui.touchPad) {
      var stop = function (e) { if (e.preventDefault) e.preventDefault(); };
      ui.touchPad.addEventListener('pointerdown', function (e) {
        var btn = e.target && e.target.closest ? e.target.closest('[data-key]') : null;
        if (!btn) return;
        stop(e);
        touch[btn.dataset.key] = true;
        btn.classList.add('is-on');
      });
      ['pointerup', 'pointercancel', 'pointerleave'].forEach(function (type) {
        ui.touchPad.addEventListener(type, function (e) {
          var btn = e.target && e.target.closest ? e.target.closest('[data-key]') : null;
          if (!btn) return;
          touch[btn.dataset.key] = false;
          btn.classList.remove('is-on');
        });
      });
    }

    if (typeof document.addEventListener === 'function') {
      document.addEventListener('visibilitychange', function () {
        if (document.hidden && app.running && !app.paused) togglePause();
      });
    }
  }

  /* --------------------------------------------------------------- 主循环 */
  function fitCanvas() {
    if (!ui.canvas || !ui.ctx || !ui.ctx.setTransform) return;
    var dpr = Math.min(2, window.devicePixelRatio || 1);
    ui.canvas.width = CONFIG.width * dpr;
    ui.canvas.height = CONFIG.height * dpr;
    ui.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function step(dt) {
    if (view.hitStop > 0) { view.hitStop -= dt; updateFx(dt); return; }
    if (app.match && app.running && !app.paused) {
      Logic.update(app.match, dt, readInput(0), readInput(1));
      handleEvents(Logic.drainEvents(app.match));
    }
    updateFx(dt);
    if (app.match) syncHud(dt);
  }

  function loop(ts) {
    requestAnimationFrame(loop);
    var dt = app.lastTs ? Math.min(0.05, (ts - app.lastTs) / 1000) : 0.016;
    app.lastTs = ts;
    step(dt);
    if (ui.ctx) renderScene();
  }

  var spritesLoading = false;
  var imagesLoading = false;

  function onDecoderReady() {
    if (spritesLoading) return;
    spritesLoading = true;
    loadSprites();
  }

  // 解码器通过 module 脚本注入，注册必须早于模块执行
  if (typeof window.addEventListener === 'function') {
    window.addEventListener('kof:gif-ready', onDecoderReady);
  }

  function boot() {
    cacheDom();
    loadStore();
    fitCanvas();
    bindEvents();
    syncMenu();
    syncRecord();
    loadImages();          // 原生 GIF 动画先上，任何协议下都能看到角色
    requestAnimationFrame(loop);
    if (window.KofGifDecoder) onDecoderReady();
  }

  window.KofGame = {
    get match() { return app.match; },
    get sprites() { return view.sprites; },   // 调试/测试用：查看两条渲染路径的加载结果
    app: app,
    settings: app,
    ui: ui,
    start: startMatch,
    pause: togglePause,
    quit: quitToMenu,
    step: step,
    press: function (code) { keys[code] = true; },
    release: function (code) { keys[code] = false; },
    readInput: readInput,
    render: function () { if (ui.ctx) renderScene(); }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
