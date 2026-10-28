/* 油画大师 · 界面与交互
 * 画廊选画 → 分区填色 → 贴合度评分 → 攒星解锁道具 → 厚涂/金箔/罩染自由创作。
 * 逻辑全在 logic.js，这里只负责渲染与输入。
 */
(function (root) {
  'use strict';

  var doc = root.document;
  var Logic = root.OilLogic;
  var SVGNS = 'http://www.w3.org/2000/svg';
  var STORE_KEY = 'oil-painting.v1';
  var BLANK = '#f4ecdd';

  var TOOLS = [
    { id: 'fill', name: '填色', icon: '▣', prop: null, size: 0, tip: '点分区上色，颜色越接近参考色，贴合度越高。' },
    { id: 'impasto', name: '厚涂', icon: '🖌', prop: 'impasto', size: 7, tip: '按住拖动叠厚笔触，自带高光与肌理。' },
    { id: 'knife', name: '调色刀', icon: '🔪', prop: 'knife', size: 15, tip: '宽刃刮过，一次铺开一整块颜色。' },
    { id: 'gold', name: '金箔', icon: '✦', prop: 'gold', size: 4, tip: '点一下撒金粉，适合留给高光。' },
    { id: 'mixer', name: '自动混色', icon: '🎨', prop: 'mixer', size: 0, action: 'mix', tip: '点一下，剩下的分区按参考色一次补齐。' },
    { id: 'glaze', name: '罩染', icon: '☀', prop: 'glaze', size: 0, action: 'glaze', tip: '再点一次可撤掉，罩上暖金光晕。' }
  ];

  var app = {
    progress: Logic.createProgress(),
    art: null,
    session: null,
    tool: 'fill',
    brush: '#c9a227',
    reference: false,
    over: false,
    view: 'gallery',
    regionNodes: {},
    drawing: null
  };

  /* ---------------------------------------------------------- 小工具 */
  function el(id) { return doc.getElementById(id); }

  function starsText(n) {
    var on = Math.max(0, Math.min(3, n | 0));
    return '★★★☆☆☆'.slice(3 - on, 6 - on);
  }

  function starsHtml(n) {
    var on = Math.max(0, Math.min(3, n | 0));
    var out = '';
    for (var i = 0; i < 3; i += 1) {
      out += i < on ? '★' : '<span class="off">☆</span>';
    }
    return out;
  }

  function toolInfo(id) {
    for (var i = 0; i < TOOLS.length; i += 1) {
      if (TOOLS[i].id === id) return TOOLS[i];
    }
    return TOOLS[0];
  }

  /* ---------------------------------------------------------- 存档 */
  function loadProgress() {
    app.progress = Logic.createProgress();
    try {
      var raw = root.localStorage && root.localStorage.getItem(STORE_KEY);
      if (raw) app.progress = Logic.parseProgress(JSON.parse(raw));
    } catch (err) {
      app.progress = Logic.createProgress();
    }
    return app.progress;
  }

  function saveProgress() {
    try {
      if (!root.localStorage) return;
      root.localStorage.setItem(STORE_KEY, JSON.stringify(Logic.serializeProgress(app.progress)));
    } catch (err) { /* 本地存储不可用时静默降级 */ }
  }

  /* ---------------------------------------------------------- 画廊 */
  function thumbSvg(art) {
    var parts = ['<svg viewBox="0 0 400 400" aria-hidden="true"><rect width="400" height="400" fill="' + BLANK + '" fill-opacity="0.06"/>'];
    Logic.regionList(art).forEach(function (shape) {
      parts.push('<path d="' + shape[3] + '" fill="' + Logic.refColor(art, shape) + '"/>');
    });
    parts.push('</svg>');
    return parts.join('');
  }

  function renderGallery() {
    var grid = el('galleryGrid');
    if (!grid) return;
    var html = '';
    Logic.ARTWORKS.forEach(function (art, index) {
      var open = Logic.levelOpen(app.progress, index);
      var best = app.progress.best[art.id] | 0;
      html += '<button type="button" class="thumb' + (open ? '' : ' is-locked') +
        '" data-art="' + art.id + '" aria-label="' + art.title + (open ? '' : '（未解锁）') + '">' +
        '<div class="thumb-art">' + thumbSvg(art) +
        (open ? '' : '<div class="thumb-lock">🔒</div>') + '</div>' +
        '<div class="thumb-meta">' +
        '<span class="thumb-title">' + art.title + '</span>' +
        '<span class="thumb-stars">' + starsHtml(best) + '</span>' +
        '</div></button>';
    });
    grid.innerHTML = html;

    var note = el('galleryNote');
    if (note) {
      var done = Object.keys(app.progress.best).length;
      note.textContent = '前三幅直接开放，之后逐幅解锁；共 ' + Logic.ARTWORKS.length +
        ' 幅，已完成 ' + done + ' 幅。填得越像，星星越多。';
    }
  }

  function renderStats() {
    var stars = Logic.totalStars(app.progress);
    var props = Logic.unlockedProps(app.progress);
    var starEl = el('starStat');
    var propEl = el('propStat');
    if (starEl) starEl.textContent = stars;
    if (propEl) propEl.textContent = props.length;

    var list = el('propList');
    if (list) {
      list.innerHTML = Logic.PROPS.map(function (prop) {
        var on = props.indexOf(prop.id) !== -1;
        return '<li class="prop' + (on ? ' is-on' : '') + '">' +
          '<span class="prop-icon">' + prop.icon + '</span>' +
          '<div class="prop-body">' +
          '<span class="prop-name">' + prop.name + '</span>' +
          '<span class="prop-desc">' + prop.desc + '</span>' +
          '<span class="prop-state">' + (on ? '已解锁' : '需 ' + prop.stars + ' 星') + '</span>' +
          '</div></li>';
      }).join('');
    }

    var note = el('propNote');
    if (note) {
      var next = Logic.nextProp(app.progress);
      note.textContent = next
        ? '再得 ' + next.need + ' 星解锁' + next.prop.name
        : '六件专业道具已全部到手';
    }
  }

  /* ---------------------------------------------------------- 画布 */
  function buildArtwork(art) {
    var svg = el('artwork');
    if (!svg) return;
    svg.innerHTML = '';
    app.regionNodes = {};
    Logic.regionList(art).forEach(function (shape) {
      var path = doc.createElementNS(SVGNS, 'path');
      path.setAttribute('d', shape[3]);
      path.setAttribute('class', 'region');
      path.setAttribute('fill', BLANK);
      path.setAttribute('data-region', shape[0]);
      svg.appendChild(path);
      app.regionNodes[shape[0]] = path;
    });
  }

  function renderRegions() {
    if (!app.session) return;
    var art = app.art;
    var fills = app.session.fills;
    Logic.regionList(art).forEach(function (shape) {
      var node = app.regionNodes[shape[0]];
      if (!node) return;
      var color = app.reference ? Logic.refColor(art, shape) : (fills[shape[0]] || BLANK);
      node.setAttribute('fill', color);
    });
  }

  function renderPalette() {
    var box = el('palette');
    if (!box || !app.art) return;
    box.innerHTML = '';
    app.art.palette.forEach(function (hex) {
      var btn = doc.createElement('button');
      btn.type = 'button';
      btn.className = 'swatch' + (app.brush.toLowerCase() === hex.toLowerCase() ? ' is-on' : '');
      btn.style.background = hex;
      btn.setAttribute('data-color', hex);
      btn.setAttribute('aria-label', '颜色 ' + hex);
      box.appendChild(btn);
    });
    var input = el('colorInput');
    if (input && /^#[0-9a-f]{6}$/i.test(app.brush)) input.value = app.brush;
  }

  function renderTools() {
    var row = el('toolRow');
    if (!row) return;
    row.innerHTML = '';
    TOOLS.forEach(function (tool) {
      var locked = tool.prop ? !Logic.hasProp(app.progress, tool.prop) : false;
      var btn = doc.createElement('button');
      btn.type = 'button';
      btn.className = 'tool' + (app.tool === tool.id ? ' is-on' : '');
      btn.disabled = locked;
      btn.setAttribute('data-tool', tool.id);
      btn.innerHTML = '<i>' + tool.icon + '</i><span>' + tool.name +
        (locked ? '（未解锁）' : '') + '</span>';
      row.appendChild(btn);
    });

    var hint = el('propHint');
    if (hint) {
      var current = toolInfo(app.tool);
      if (current.prop && !Logic.hasProp(app.progress, current.prop)) {
        hint.textContent = '这件道具还没解锁，先把画面填满攒星。';
      } else if (app.session && app.session.strokes.length) {
        hint.textContent = current.tip + ' 已落 ' + app.session.strokes.length + ' 笔。';
      } else {
        hint.textContent = current.tip;
      }
    }

    var name = el('brushName');
    if (name) {
      name.textContent = app.tool === 'fill'
        ? '填色 ' + app.brush.toUpperCase()
        : toolInfo(app.tool).name + ' ' + app.brush.toUpperCase();
    }

    var layer = el('paintLayer');
    if (layer) layer.classList.toggle('is-active', app.tool !== 'fill' && !app.over);

    var glaze = el('glazeLayer');
    if (glaze) glaze.classList.toggle('is-on', !!(app.session && app.session.glaze));
  }

  function renderRegionList() {
    var box = el('regionList');
    if (!box || !app.session) return;
    var art = app.art;
    var note = el('regionNote');
    var filled = Object.keys(app.session.fills).length;
    var total = Logic.regionCount(art);
    if (note) note.textContent = filled + ' / ' + total;

    box.innerHTML = Logic.regionList(art).map(function (shape) {
      var got = app.session.fills[shape[0]];
      var want = Logic.refColor(art, shape);
      var chip = got || 'transparent';
      return '<div class="region-row" data-region="' + shape[0] + '">' +
        '<span class="region-chip" style="background:' + chip + '"></span>' +
        '<span class="region-name">' + (shape[1] || shape[0]) + '</span>' +
        '<span class="region-state">' + (got ? '已上色' : want.toUpperCase()) + '</span>' +
        '</div>';
    }).join('');
  }

  function renderHud() {
    if (!app.session) return;
    var result = Logic.evaluate(app.session);
    var pct = Math.round(result.fit * 100);
    var earned = Logic.starsForFit(result.fit, result.filled >= result.total);

    var fitVal = el('fitVal');
    if (fitVal) fitVal.textContent = pct + '%';
    var bar = el('fitBar');
    if (bar) bar.style.width = Math.max(0, Math.min(100, pct)) + '%';
    var starsEl = el('starsVal');
    if (starsEl) starsEl.innerHTML = starsHtml(earned);
    var fitNote = el('fitNote');
    if (fitNote) {
      fitNote.textContent = '已上色 ' + result.filled + ' / ' + result.total +
        (earned ? ' 块 · 本关 ' + earned + ' 星' : ' 块');
    }

    var undoBtn = el('undoBtn');
    if (undoBtn) undoBtn.disabled = !Logic.canUndo(app.session, app.progress);
    var doneBtn = el('doneBtn');
    if (doneBtn) doneBtn.disabled = app.over || result.filled === 0;

    renderRegionList();
    renderTools();
  }

  function renderStudio() {
    if (!app.art) return;
    var art = app.art;
    el('artTitle').textContent = art.title;
    el('artArtist').textContent = art.artist + ' · ' + art.year;
    el('artHint').textContent = art.hint || '';
    buildArtwork(art);
    renderRegions();
    renderPalette();
    clearLayer();
    redrawStrokes();
    renderHud();
    var result = el('result');
    if (result) result.hidden = true;
  }

  /* ---------------------------------------------------------- 视图切换 */
  function setView(view) {
    app.view = view;
    var shell = el('app');
    if (shell) shell.setAttribute('data-view', view);
    var gallery = el('galleryView');
    var studio = el('studioView');
    if (gallery) gallery.hidden = view !== 'gallery';
    if (studio) studio.hidden = view !== 'studio';
    if (view === 'gallery') {
      renderGallery();
      renderStats();
    }
  }

  function openArt(id) {
    var art = Logic.findArt(id);
    if (!art) return false;
    if (!Logic.levelOpen(app.progress, Logic.levelIndex(id))) return false;
    app.art = art;
    app.session = Logic.createSession(art);
    app.over = false;
    app.reference = false;
    app.tool = 'fill';
    app.brush = art.palette[0];
    var refBtn = el('refBtn');
    if (refBtn) refBtn.textContent = '看参考';
    setView('studio');
    renderStudio();
    return true;
  }

  function backToGallery() {
    app.over = false;
    app.art = null;
    app.session = null;
    setView('gallery');
  }

  /* ---------------------------------------------------------- 上色与工具 */
  function pickColor(hex) {
    if (!/^#[0-9a-fA-F]{6}$/.test(String(hex || ''))) return;
    app.brush = String(hex).toLowerCase();
    renderPalette();
    renderTools();
  }

  function setTool(id) {
    var tool = toolInfo(id);
    if (!tool) return;
    if (tool.prop && !Logic.hasProp(app.progress, tool.prop)) return;

    if (tool.action === 'mix') {
      if (!app.session || app.over) return;
      var added = Logic.autoFill(app.session);
      renderRegions();
      renderHud();
      var hint = el('propHint');
      if (hint) hint.textContent = added ? '自动补齐 ' + added + ' 块，点完成验收。' : '分区已经全部上色了。';
      return;
    }

    if (tool.action === 'glaze') {
      if (!app.session) return;
      app.session.glaze = !app.session.glaze;
      renderTools();
      return;
    }

    app.tool = id;
    renderTools();
  }

  function onRegionClick(regionId) {
    if (!app.session || app.over || app.reference) return;
    if (Logic.paint(app.session, regionId, app.brush)) {
      renderRegions();
      renderHud();
    }
  }

  /* ---------------------------------------------------------- 撤销 / 重画 / 参考 */
  function undo() {
    if (!app.session) return;
    if (!Logic.canUndo(app.session, app.progress)) return;
    if (!Logic.undo(app.session)) return;
    renderRegions();
    redrawStrokes();
    renderHud();
  }

  function reset() {
    if (!app.session) return;
    Logic.resetSession(app.session);
    app.over = false;
    var result = el('result');
    if (result) result.hidden = true;
    renderRegions();
    clearLayer();
    renderHud();
  }

  function toggleReference() {
    app.reference = !app.reference;
    var btn = el('refBtn');
    if (btn) btn.textContent = app.reference ? '回画布' : '看参考';
    renderRegions();
  }

  /* ---------------------------------------------------------- 笔触绘制 */
  function layerCtx() {
    var layer = el('paintLayer');
    return layer && layer.getContext ? layer.getContext('2d') : null;
  }

  function clearLayer() {
    var ctx = layerCtx();
    if (ctx) ctx.clearRect(0, 0, 800, 800);
  }

  function mix(hexA, hexB, t) {
    var a = Logic.hexToRgb(hexA);
    var b = Logic.hexToRgb(hexB);
    return Logic.rgbToHex([
      a[0] + (b[0] - a[0]) * t,
      a[1] + (b[1] - a[1]) * t,
      a[2] + (b[2] - a[2]) * t
    ]);
  }

  function paintSegment(ctx, stroke, a, b) {
    var p = [a[0] * 2, a[1] * 2];
    var q = [b[0] * 2, b[1] * 2];
    var w = stroke.size * 2;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    if (stroke.tool === 'gold') {
      var r = Math.max(7, w * 1.5);
      var grad = ctx.createRadialGradient(q[0], q[1], 0, q[0], q[1], r);
      grad.addColorStop(0, 'rgba(255, 244, 200, 0.95)');
      grad.addColorStop(0.45, 'rgba(232, 182, 76, 0.8)');
      grad.addColorStop(1, 'rgba(176, 126, 32, 0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(q[0], q[1], r, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      return;
    }

    ctx.globalAlpha = stroke.tool === 'knife' ? 0.78 : 0.9;
    ctx.strokeStyle = stroke.color;
    ctx.lineWidth = w;
    ctx.beginPath();
    ctx.moveTo(p[0], p[1]);
    ctx.lineTo(q[0], q[1]);
    if (p[0] === q[0] && p[1] === q[1]) ctx.lineTo(q[0] + 0.6, q[1] + 0.6);
    ctx.stroke();

    if (stroke.tool === 'impasto') {
      ctx.globalAlpha = 0.6;
      ctx.strokeStyle = mix(stroke.color, '#ffffff', 0.55);
      ctx.lineWidth = Math.max(1, w * 0.3);
      ctx.beginPath();
      ctx.moveTo(p[0] - w * 0.18, p[1] - w * 0.26);
      ctx.lineTo(q[0] - w * 0.18, q[1] - w * 0.26);
      ctx.stroke();

      ctx.globalAlpha = 0.26;
      ctx.strokeStyle = mix(stroke.color, '#130d07', 0.55);
      ctx.lineWidth = Math.max(1, w * 0.24);
      ctx.beginPath();
      ctx.moveTo(p[0] + w * 0.18, p[1] + w * 0.28);
      ctx.lineTo(q[0] + w * 0.18, q[1] + w * 0.28);
      ctx.stroke();
    }
    ctx.restore();
  }

  function redrawStrokes() {
    clearLayer();
    if (!app.session) return;
    var ctx = layerCtx();
    if (!ctx) return;
    app.session.strokes.forEach(function (stroke) {
      for (var i = 1; i < stroke.points.length; i += 1) {
        paintSegment(ctx, stroke, stroke.points[i - 1], stroke.points[i]);
      }
      if (stroke.points.length === 1) {
        paintSegment(ctx, stroke, stroke.points[0], stroke.points[0]);
      }
    });
  }

  /* ---------------------------------------------------------- 指针输入 */
  function pointFromEvent(ev) {
    var layer = el('paintLayer');
    if (!layer || !layer.getBoundingClientRect) return [0, 0];
    var rect = layer.getBoundingClientRect();
    if (!rect.width || !rect.height) return [0, 0];
    return [
      Math.max(0, Math.min(400, (ev.clientX - rect.left) / rect.width * 400)),
      Math.max(0, Math.min(400, (ev.clientY - rect.top) / rect.height * 400))
    ];
  }

  function onPointerDown(ev) {
    if (!app.session || app.over || app.reference) return;
    if (app.tool === 'fill') return;
    if (ev.button != null && ev.button !== 0) return;
    if (ev.preventDefault) ev.preventDefault();
    var p = pointFromEvent(ev);
    var tool = toolInfo(app.tool);
    var stroke = { tool: app.tool, color: app.brush, size: tool.size, points: [p] };
    app.drawing = stroke;
    var ctx = layerCtx();
    if (ctx) paintSegment(ctx, stroke, p, p);
    if (ev.target && ev.target.setPointerCapture && ev.pointerId != null) {
      try { ev.target.setPointerCapture(ev.pointerId); } catch (err) { /* 忽略 */ }
    }
  }

  function onPointerMove(ev) {
    if (!app.drawing) return;
    if (ev.preventDefault) ev.preventDefault();
    var stroke = app.drawing;
    var p = pointFromEvent(ev);
    var last = stroke.points[stroke.points.length - 1];
    if (Math.abs(p[0] - last[0]) + Math.abs(p[1] - last[1]) < 0.7) return;
    var ctx = layerCtx();
    if (ctx) paintSegment(ctx, stroke, last, p);
    stroke.points.push(p);
  }

  function onPointerUp() {
    if (!app.drawing) return;
    var stroke = app.drawing;
    app.drawing = null;
    if (!app.session) return;
    Logic.addStroke(app.session, stroke);
    renderHud();
  }

  /* ---------------------------------------------------------- 验收 */
  function propName(id) {
    for (var i = 0; i < Logic.PROPS.length; i += 1) {
      if (Logic.PROPS[i].id === id) return Logic.PROPS[i].name;
    }
    return id;
  }

  function finish() {
    if (!app.session || app.over) return;
    var result = Logic.evaluate(app.session);
    var note = el('fitNote');
    if (result.filled < result.total) {
      if (note) note.textContent = '还有 ' + (result.total - result.filled) + ' 块没上色，填满才能验收。';
      return;
    }

    var res = Logic.commit(app.progress, app.session);
    saveProgress();
    app.over = true;

    var earned = Logic.starsForFit(result.fit, true);
    var copy;
    if (earned === 3) copy = '几乎与参考一模一样，装裱师也挑不出毛病。';
    else if (earned === 2) copy = '整体气韵对了，少数分区的颜色还能更准。';
    else copy = '顺利收笔，颜色再贴近参考色就能拿到更高的星。';
    if (res.gainedStars > 0) copy += ' 本关新得 ' + res.gainedStars + ' 星。';
    if (res.unlocked.length) {
      copy += ' 解锁道具：' + res.unlocked.map(propName).join('、') + '。';
    }

    var starsEl = el('resultStars');
    if (starsEl) starsEl.textContent = starsText(earned);
    var titleEl = el('resultTitle');
    if (titleEl) titleEl.textContent = app.art.title + ' · 贴合度 ' + res.fit + '%';
    var copyEl = el('resultCopy');
    if (copyEl) copyEl.textContent = copy;
    var overlay = el('result');
    if (overlay) overlay.hidden = false;

    var next = Logic.ARTWORKS[Logic.levelIndex(app.art.id) + 1];
    var nextBtn = el('nextBtn');
    if (nextBtn) {
      nextBtn.textContent = next && Logic.levelOpen(app.progress, Logic.levelIndex(next.id)) ? '下一幅' : '回画廊';
    }

    renderHud();
    renderGallery();
    renderStats();
  }

  function nextArt() {
    if (!app.art) return backToGallery();
    var index = Logic.levelIndex(app.art.id);
    var next = Logic.ARTWORKS[index + 1];
    if (next && Logic.levelOpen(app.progress, index + 1)) openArt(next.id);
    else backToGallery();
  }

  /* ---------------------------------------------------------- 事件绑定 */
  function bind() {
    var grid = el('galleryGrid');
    if (grid) {
      grid.addEventListener('click', function (ev) {
        var card = ev.target && ev.target.closest ? ev.target.closest('[data-art]') : null;
        if (!card) return;
        var id = card.getAttribute('data-art');
        if (!openArt(id)) {
          renderGallery();
          var note = el('galleryNote');
          if (note) note.textContent = '这幅还锁着，先把上一幅画到一星以上。';
        }
      });
    }

    var palette = el('palette');
    if (palette) {
      palette.addEventListener('click', function (ev) {
        var chip = ev.target && ev.target.closest ? ev.target.closest('[data-color]') : null;
        if (chip) pickColor(chip.getAttribute('data-color'));
      });
    }

    var tools = el('toolRow');
    if (tools) {
      tools.addEventListener('click', function (ev) {
        var btn = ev.target && ev.target.closest ? ev.target.closest('[data-tool]') : null;
        if (btn && !btn.disabled) setTool(btn.getAttribute('data-tool'));
      });
    }

    var colorInput = el('colorInput');
    if (colorInput) {
      colorInput.addEventListener('input', function (ev) { pickColor(ev.target.value); });
    }

    var svg = el('artwork');
    if (svg) {
      svg.addEventListener('click', function (ev) {
        var path = ev.target && ev.target.closest ? ev.target.closest('[data-region]') : null;
        if (path) onRegionClick(path.getAttribute('data-region'));
      });
    }

    var layer = el('paintLayer');
    if (layer) {
      layer.addEventListener('pointerdown', onPointerDown);
      layer.addEventListener('pointermove', onPointerMove);
      layer.addEventListener('pointerup', onPointerUp);
      layer.addEventListener('pointercancel', onPointerUp);
      layer.addEventListener('pointerleave', onPointerUp);
    }

    var back = el('backBtn');
    if (back) back.addEventListener('click', backToGallery);
    var refBtn = el('refBtn');
    if (refBtn) refBtn.addEventListener('click', toggleReference);
    var undoBtn = el('undoBtn');
    if (undoBtn) undoBtn.addEventListener('click', undo);
    var resetBtn = el('resetBtn');
    if (resetBtn) resetBtn.addEventListener('click', reset);
    var doneBtn = el('doneBtn');
    if (doneBtn) doneBtn.addEventListener('click', finish);
    var nextBtn = el('nextBtn');
    if (nextBtn) nextBtn.addEventListener('click', nextArt);
    var retryBtn = el('retryBtn');
    if (retryBtn) retryBtn.addEventListener('click', reset);
    var resultGallery = el('resultGalleryBtn');
    if (resultGallery) resultGallery.addEventListener('click', backToGallery);

    doc.addEventListener('keydown', function (ev) {
      if (!app.session || ev.metaKey || ev.altKey) return;
      var key = String(ev.key || '').toLowerCase();
      if (key === 'u' || ((ev.ctrlKey || ev.metaKey) && key === 'z')) {
        ev.preventDefault();
        undo();
      } else if (key === 'r') {
        reset();
      } else if (key === 'escape') {
        backToGallery();
      } else if (key >= '1' && key <= '6' && app.art) {
        var idx = Number(key) - 1;
        if (app.art.palette[idx]) pickColor(app.art.palette[idx]);
      }
    });
  }

  function init() {
    loadProgress();
    setView('gallery');
    renderGallery();
    renderStats();
    bind();
  }

  root.OilPainting = {
    app: app,
    TOOLS: TOOLS,
    openArt: openArt,
    backToGallery: backToGallery,
    setView: setView,
    renderGallery: renderGallery,
    renderStats: renderStats,
    pickColor: pickColor,
    setTool: setTool,
    onRegionClick: onRegionClick,
    undo: undo,
    reset: reset,
    finish: finish,
    nextArt: nextArt,
    toggleReference: toggleReference,
    saveProgress: saveProgress
  };

  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', init);
  else init();
}(typeof window !== 'undefined' ? window : globalThis));
