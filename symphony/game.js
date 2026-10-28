/* 交响乐工坊 · 界面、交互与 Web Audio 合成 */
(function () {
  'use strict';

  var Logic = window.SymphonyLogic;
  var STORE_KEY = 'symphony.v1';
  var SCORE_KEY = 'symphony.score.v1';
  var RULER_H = 26;
  var STEP_W = 14;              /* 十六分音符横向宽度，一拍 = 56px */
  var BEAT_W = STEP_W * 4;
  var PAD_LEFT = 46;            /* 谱号与拍号留白 */
  var HALF = 6;                 /* 相邻音级（线↔间）的纵向距离 */
  var LAYER_PAD = 14;           /* 每个分谱上下留白 */
  var MASTER_PAD = 14;          /* 主谱上下留白 */
  var MASTER_GAP = 34;          /* 大谱表两个谱表之间空出的距离（约三个音级） */
  var HEAD_W = 9;               /* 符头宽度，用来让符头中心压住拍点 */
  var TREBLE_TOP = 45;          /* 高音谱表第一线的音级 */
  var BASS_TOP = 33;            /* 低音谱表第一线的音级 */
  var STEP = Logic.STEP;
  var DURATION_LABELS = { 4: '全', 2: '二分', 1: '四分', 0.5: '八分', 0.25: '十六' };

  var app = {
    score: null,
    progress: null,
    activeTrackId: null,
    duration: 1,
    sharp: false,
    eraser: false,
    view: 'staff',
    selected: null,
    cursor: { t: 0 },
    hidden: {},
    playing: false,
    loop: false,
    metro: false
  };

  var AU = { ctx: null, master: null, comp: null, wet: null, dry: null, noise: null, waves: {}, chains: {} };
  var runner = { timer: null, raf: null, startAt: 0, fromBeat: 0, index: 0, beat: 0, timeline: null };
  var history = [];
  var saveTimer = null;
  var toastTimer = null;

  function el(id) { return document.getElementById(id); }
  function on(node, type, fn) { if (node) node.addEventListener(type, fn); }
  function clamp(value, lo, hi) { return Math.min(hi, Math.max(lo, value)); }
  function escapeHtml(text) {
    return String(text == null ? '' : text).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function fmtTime(sec) {
    var s = Math.max(0, Math.round(sec));
    return ('0' + Math.floor(s / 60)).slice(-2) + ':' + ('0' + (s % 60)).slice(-2);
  }
  function beatSec() { return Logic.beatSeconds(app.score); }
  function spanBeats() { return app.score.bars * Logic.BEATS_PER_BAR; }

  function readJSON(key, fallback) {
    try {
      var raw = window.localStorage && window.localStorage.getItem(key);
      if (!raw) return fallback;
      return JSON.parse(raw);
    } catch (err) { return fallback; }
  }
  function writeJSON(key, value) {
    try {
      if (window.localStorage) window.localStorage.setItem(key, JSON.stringify(value));
    } catch (err) { /* 隐私模式忽略 */ }
  }

  function loadProgress() {
    var saved = readJSON(STORE_KEY, null);
    var progress = Logic.createProgress();
    if (saved && saved.done && typeof saved.done === 'object') {
      Object.keys(saved.done).forEach(function (key) {
        if (saved.done[key]) progress.done[key] = true;
      });
    }
    return progress;
  }

  function loadScore() {
    var saved = readJSON(SCORE_KEY, null);
    if (!saved) return null;
    return Logic.parse(saved);
  }

  function saveScore(now) {
    if (!app.score) return;
    var data = JSON.parse(Logic.serialize(app.score));
    if (now) {
      writeJSON(SCORE_KEY, data);
      return;
    }
    if (saveTimer) window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(function () {
      writeJSON(SCORE_KEY, data);
    }, 350);
  }

  function toast(text) {
    var box = el('toast');
    if (!box) return;
    box.textContent = text;
    box.hidden = false;
    if (toastTimer) window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(function () { box.hidden = true; }, 2200);
  }

  /* ---------------- 统计 / 轨道 / 混音台 ---------------- */

  function renderStats() {
    var st = Logic.stats(app.score);
    if (el('starStat')) el('starStat').textContent = String(Logic.totalStars(app.progress));
    if (el('trackStat')) el('trackStat').textContent = String(st.tracksWithNotes);
    if (el('noteStat')) el('noteStat').textContent = String(st.notes);
    if (el('taskStars')) el('taskStars').textContent = Logic.totalStars(app.progress) + ' / ' + Logic.TASKS.length;
    if (el('scoreMeta')) {
      el('scoreMeta').textContent = st.notes + ' 个音 · ' + st.tracksWithNotes + ' 轨 · ' +
        fmtTime(st.seconds) + ' / 总长 ' + fmtTime(st.totalSeconds);
    }
  }

  function trackOf(id) { return Logic.findTrack(app.score, id); }

  function renderTracks() {
    var box = el('trackList');
    if (!box) return;
    if (!app.score.tracks.length) {
      box.innerHTML = '<p class="editor-hint">还没有乐器，点下面的按钮添加。</p>';
      return;
    }
    box.innerHTML = app.score.tracks.map(function (track) {
      var ins = Logic.findInstrument(track.instrument);
      var active = track.id === app.activeTrackId ? ' is-active' : '';
      var hidden = app.hidden[track.id] ? ' is-hidden' : '';
      return '' +
        '<div class="track-item' + active + hidden + '" data-track="' + track.id + '">' +
          '<span class="track-swatch" style="background:' + ins.color + '"></span>' +
          '<span class="track-name"><b>' + escapeHtml(ins.name) + '</b>' +
            '<small>' + ins.familyName + ' · ' + track.notes.length + ' 音</small></span>' +
          '<span class="track-tools">' +
            '<button type="button" data-act="hide" class="' + (app.hidden[track.id] ? 'on' : '') + '" title="显示/隐藏这层谱表">' +
              (app.hidden[track.id] ? '🙈' : '👁') + '</button>' +
            '<button type="button" data-act="mute" class="' + (track.mute ? 'on' : '') + '" title="静音">M</button>' +
            '<button type="button" data-act="solo" class="' + (track.solo ? 'on' : '') + '" title="独奏">S</button>' +
            '<button type="button" data-act="remove" class="kill" title="删除轨道">✕</button>' +
          '</span>' +
        '</div>';
    }).join('');
  }

  function renderMixer() {
    var box = el('mixer');
    if (!box) return;
    box.innerHTML = app.score.tracks.map(function (track) {
      var ins = Logic.findInstrument(track.instrument);
      var pct = Math.round((track.pan + 1) * 50);
      return '' +
        '<div class="mix-row" data-track="' + track.id + '">' +
          '<span class="mix-name"><i style="background:' + ins.color + '"></i>' + escapeHtml(ins.name) + '</span>' +
          '<span class="mix-vol"><input type="range" min="0" max="100" value="' + Math.round(track.volume * 100) + '" data-act="volume" aria-label="' + ins.name + '音量"></span>' +
          '<span class="mix-pan">L<input type="range" min="0" max="100" value="' + pct + '" data-act="pan" aria-label="' + ins.name + '声像">R</span>' +
          '<span class="meter"><span class="meter-fill" data-meter="' + track.id + '"></span></span>' +
        '</div>';
    }).join('');
  }

  function renderInstrumentPicker() {
    var box = el('instrumentPicker');
    if (!box) return;
    box.innerHTML = Logic.instrumentList(app.progress).map(function (ins) {
      var lock = ins.unlocked ? '' : ' disabled';
      var tag = ins.unlocked ? ins.familyName : ('需 ' + ins.unlock + '★');
      return '<button type="button" class="instrument-card" data-ins="' + ins.id + '"' + lock + '>' +
        '<b>' + escapeHtml(ins.name) + '</b><small>' + tag + ' · ' + escapeHtml(ins.desc) + '</small></button>';
    }).join('');
  }

  function renderEmotions() {
    var box = el('emotionList');
    if (!box) return;
    box.innerHTML = Logic.EMOTIONS.map(function (emo) {
      var active = app.score.emotion === emo.id ? ' is-on' : '';
      return '<button type="button" class="emotion-card' + active + '" data-emotion="' + emo.id + '">' +
        '<span class="emo-icon">' + emo.icon + '</span><b>' + emo.name + ' · ' + emo.tempo + ' BPM</b>' +
        '<small>' + escapeHtml(emo.desc) + '</small></button>';
    }).join('');
  }

  function renderTweaks() {
    var tw = app.score.tweaks;
    var bright = el('brightInput'), reverb = el('reverbInput'), vib = el('vibratoInput');
    if (bright) bright.value = String(Math.round(tw.bright * 100));
    if (reverb) reverb.value = String(Math.round(tw.reverb * 100));
    if (vib) vib.value = String(Math.round(tw.vibrato * 100));
    if (el('brightOut')) el('brightOut').textContent = String(Math.round(tw.bright * 100));
    if (el('reverbOut')) el('reverbOut').textContent = String(Math.round(tw.reverb * 100));
    if (el('vibratoOut')) el('vibratoOut').textContent = String(Math.round(tw.vibrato * 100));
  }

  function renderTasks() {
    var box = el('taskList');
    if (!box) return;
    box.innerHTML = Logic.taskList(app.score, app.progress).map(function (task) {
      var cls = 'task-item' + (task.done ? ' is-done' : task.ready ? ' is-ready' : '');
      var flag = task.done ? '★' : task.ready ? '☆' : '○';
      return '<li class="' + cls + '"><span class="flag">' + flag + '</span>' +
        '<span><b>' + task.title + '</b><small>' + escapeHtml(task.desc) + '</small></span></li>';
    }).join('');
  }

  function renderDurations() {
    var box = el('durationRow');
    if (!box) return;
    box.innerHTML = Logic.DURATIONS.map(function (value) {
      return '<button type="button" class="duration-btn' + (app.duration === value ? ' is-on' : '') +
        '" data-dur="' + value + '">' + DURATION_LABELS[value] + '</button>';
    }).join('');
  }

  function renderAll() {
    renderStats();
    renderTracks();
    renderMixer();
    renderInstrumentPicker();
    renderEmotions();
    renderTweaks();
    renderTasks();
    renderDurations();
    renderBoard();
    syncControls();
  }

  function syncControls() {
    if (el('titleInput')) el('titleInput').value = app.score.title;
    if (el('tempoInput')) el('tempoInput').value = String(app.score.tempo);
    if (el('barsSelect')) el('barsSelect').value = String(app.score.bars);
    if (el('staffBtn')) el('staffBtn').classList.toggle('is-on', app.view === 'staff');
    if (el('jianpuBtn')) el('jianpuBtn').classList.toggle('is-on', app.view === 'jianpu');
    if (el('loopBtn')) el('loopBtn').classList.toggle('is-on', app.loop);
    if (el('metroBtn')) el('metroBtn').classList.toggle('is-on', app.metro);
    if (el('sharpBtn')) el('sharpBtn').classList.toggle('is-on', app.sharp);
    if (el('eraserBtn')) el('eraserBtn').classList.toggle('is-on', app.eraser);
    if (el('hitLayer')) el('hitLayer').classList.toggle('is-erase', app.eraser);
    if (el('playBtn')) el('playBtn').textContent = app.playing ? '❚❚ 暂停' : '▶ 播放';
    if (el('playInfo')) {
      var sec = Logic.stats(app.score).totalSeconds;
      el('playInfo').textContent = fmtTime(playPosition() * beatSec()) + ' / ' + fmtTime(sec);
    }
    renderEditor();
  }

  /* ---------------- 标准乐谱（按乐器分谱） ---------------- */

  function boardWidth() { return PAD_LEFT + (spanBeats() / STEP) * STEP_W; }
  function xOfBeat(beat) { return PAD_LEFT + (beat / STEP) * STEP_W; }
  /* 符头以拍点为中轴：渲染时左移半个符头，符干/加线仍跟着符头走 */
  function xOfHead(beat) { return xOfBeat(beat) - HEAD_W / 2; }

  /* 每个可见分谱的纵向几何：起点、高度、谱表窗口 */
  function visibleTracks() {
    return app.score.tracks.filter(function (track) { return !app.hidden[track.id]; });
  }

  /* 主谱：一张大谱表（高音谱表 + 低音谱表），作为所有声部的底稿 */
  function masterTop() { return RULER_H; }
  function masterTrebleTop() { return masterTop() + MASTER_PAD; }
  function masterBassTop() { return masterTrebleTop() + 4 * HALF * 2 + MASTER_GAP; }
  /* 简谱模式不画主谱（简谱没有谱表），主谱高度归零，分谱整体上提 */
  function masterHeight() {
    if (app.view === 'jianpu') return 0;
    return MASTER_PAD * 2 + 4 * HALF * 2 * 2 + MASTER_GAP;
  }
  function masterAtY(y) { return y >= masterTop() && y < masterTop() + masterHeight(); }
  /* 主谱上的一条谱表：按谱号取几何，不绑定具体乐器 */
  function masterStaffOf(clefId) {
    var treble = clefId !== 'bass';
    return {
      isMaster: true,
      clefId: treble ? 'treble' : 'bass',
      staffTop: treble ? masterTrebleTop() : masterBassTop(),
      axisHi: treble ? TREBLE_TOP : BASS_TOP
    };
  }
  /* 主谱上离这个 y 最近的那张谱表 */
  function masterStaffAtY(y) {
    if (!masterAtY(y)) return null;
    var treble = masterStaffOf('treble');
    var bass = masterStaffOf('bass');
    var dT = Math.abs(y - (treble.staffTop + 4 * HALF));
    var dB = Math.abs(y - (bass.staffTop + 4 * HALF));
    return dT <= dB ? treble : bass;
  }
  /* 某件乐器在主谱上落在哪条谱表：按它自己的谱号（乐器记号）决定 */
  function masterStaff(instrumentId) {
    var win = Logic.staffWindow(instrumentId);
    var staff = masterStaffOf(win.clef.id);
    /* 主谱只落到谱表附近：远到会压到另一张谱表的音交给分谱去画 */
    staff.win = { clef: win.clef, lo: staff.axisHi - 12, hi: staff.axisHi + 12 };
    staff.top = masterTop();
    staff.height = masterHeight();
    return staff;
  }
  /* 主谱上每件乐器的几何 */
  function masterGeom() {
    var seen = {};
    if (!masterHeight()) return [];
    return visibleTracks().map(function (track) {
      var geom = masterStaff(track.instrument);
      geom.trackId = track.id;
      geom.instrument = track.instrument;
      if (!seen[geom.win.clef.id]) {
        seen[geom.win.clef.id] = true;
        geom.isFirstOfClef = true;
      }
      return geom;
    });
  }

  /* 分谱窗口：以五线为底，按实际音符向外自动撑开，写完立刻自适应 */
  function trackWindow(track) {
    var base = Logic.staffWindow(track.instrument);
    var lo = base.clef.bottom - 1;
    var hi = base.clef.top;
    track.notes.forEach(function (note) {
      var deg = noteDeg(note.m);
      if (deg - 1 < lo) lo = deg - 1;
      if (deg + 1 > hi) hi = deg + 1;
    });
    return { clef: base.clef, lo: lo, hi: hi, steps: hi - lo, base: base };
  }

  function layerGeom() {
    var y = RULER_H + masterHeight();
    return visibleTracks().map(function (track) {
      var win = trackWindow(track);
      var layer = {
        trackId: track.id, instrument: track.instrument,
        top: y, height: LAYER_PAD * 2 + win.steps * HALF, win: win,
        /* 五线钉在谱号第一线：窗口向上撑时谱表整体下移 */
        staffTop: y + LAYER_PAD + (win.hi - win.clef.top) * HALF,
        axisHi: win.clef.top
      };
      y += layer.height;
      return layer;
    });
  }
  function boardHeight() {
    var total = RULER_H + masterHeight();
    layerGeom().forEach(function (layer) { total += layer.height; });
    return total;
  }
  function yOfDeg(layer, deg) { return layer.staffTop + (layer.axisHi - deg) * HALF; }
  function layerOfTrack(trackId) {
    var found = null;
    layerGeom().forEach(function (layer) { if (layer.trackId === trackId) found = layer; });
    return found;
  }
  function layerAtY(y) {
    var found = null;
    layerGeom().forEach(function (layer) {
      if (y >= layer.top && y < layer.top + layer.height) found = layer;
    });
    return found;
  }
  function noteDeg(midi) { return Logic.degreeAbsolute(midi - Logic.degreeOf(midi).accidental); }
  function isSharp(midi) { return Logic.degreeOf(midi).accidental === 1; }

  /* 左侧分谱栏：每件乐器一行，对齐右手的谱表 */
  function renderRail() {
    var rail = el('layerRail');
    if (!rail) return;
    var layers = layerGeom();
    var html = '<div class="rail-pad">主谱 / 分谱</div>';
    if (masterHeight()) {
      html += '<div class="rail-row is-master" style="height:' + masterHeight() + 'px" ' +
        'title="主谱：在这里写音符，会自动落到对应乐器的分谱">' +
        '<span class="rail-clef">𝄞</span>' +
        '<span class="rail-text"><b>主谱·双谱表</b>' +
        '<small>' + layers.length + ' 声部 · 写谱自动分轨</small></span></div>';
    }
    if (!layers.length) html += '<div class="rail-empty">分谱全部隐藏</div>';
    html += layers.map(function (layer) {
      var track = trackOf(layer.trackId);
      var ins = Logic.findInstrument(layer.instrument);
      var active = layer.trackId === app.activeTrackId ? ' is-active' : '';
      var muted = track && track.mute ? ' is-muted' : '';
      return '<div class="rail-row' + active + muted + '" data-track="' + layer.trackId +
        '" style="height:' + layer.height + 'px" title="点击切到这件乐器（分谱用于查看与微调）">' +
        '<span class="rail-clef" style="--nc:' + ins.color + '">' + layer.win.clef.symbol + '</span>' +
        '<span class="rail-text"><b>' + escapeHtml(ins.name) + '</b>' +
        '<small>' + layer.win.clef.name + ' · ' + track.notes.length + ' 音</small></span>' +
        '<span class="rail-tools">' +
        '<button type="button" data-act="hide" title="隐藏这层谱表">👁</button>' +
        '<button type="button" data-act="mute" class="' + (track.mute ? 'on' : '') + '" title="静音">M</button>' +
        '</span></div>';
    }).join('');
    rail.innerHTML = html;
  }

  /* 主谱：一张连谱大谱表（高音谱表 + 低音谱表），作为所有声部的底稿 */
  function masterStaffHtml() {
    var width = boardWidth();
    var bars = app.score.bars;
    var staffH = 4 * HALF * 2;
    /* 主谱同样用相对自身的坐标 */
    var trebleTop = masterTrebleTop() - masterTop();
    var bassTop = masterBassTop() - masterTop();
    var musicW = Math.max(0, width - PAD_LEFT);
    var systemH = bassTop + staffH - trebleTop;
    var staffs = [trebleTop, bassTop];
    var html = '<div class="staff-layer is-master" style="top:' + masterTop() + 'px;height:' + masterHeight() + 'px">';
    staffs.forEach(function (lineTop) {
      for (var i = 0; i < 5; i += 1) {
        html += '<span class="staff-line" style="top:' + (lineTop + i * HALF * 2) +
          'px;left:' + PAD_LEFT + 'px;width:' + musicW + 'px"></span>';
      }
    });
    html += '<span class="master-brace" style="top:' + trebleTop + 'px;height:' + systemH + 'px"></span>';
    html += '<span class="master-label">主谱</span>';
    html += '<span class="staff-clef" style="top:' + trebleTop + 'px;height:' + staffH + 'px">' +
      Logic.CLEFS.treble.symbol + '</span>';
    html += '<span class="staff-clef" style="top:' + bassTop + 'px;height:' + staffH + 'px">' +
      Logic.CLEFS.bass.symbol + '</span>';
    html += '<span class="staff-time" style="top:' + (trebleTop + (staffH - 24) / 2) + 'px">4<i>4</i></span>';
    for (var bar = 0; bar <= bars; bar += 1) {
      var strong = bar === 0 || bar === bars;
      html += '<span class="bar-line' + (strong ? ' is-edge' : '') + '" style="left:' +
        (PAD_LEFT + bar * Logic.BEATS_PER_BAR * BEAT_W) + 'px;top:' + trebleTop +
        'px;height:' + systemH + 'px"></span>';
    }
    for (var beat = 1; beat < bars * Logic.BEATS_PER_BAR; beat += 1) {
      html += '<span class="beat-tick" style="left:' + (PAD_LEFT + beat * BEAT_W) +
        'px;top:' + trebleTop + 'px;height:' + systemH + 'px"></span>';
    }
    return html + '</div>';
  }

  /* 右手标准五线谱：主谱在最上，其下每件乐器一层分谱（五线 / 谱号 / 拍号 / 小节线 / 拍点） */
  function renderStaffLayers() {
    var box = el('staffLayers');
    if (!box) return;
    var width = boardWidth();
    var bars = app.score.bars;
    var html = masterHeight() ? masterStaffHtml() : '';
    layerGeom().forEach(function (layer) {
      var ins = Logic.findInstrument(layer.instrument);
      var clef = layer.win.clef;
      /* 分谱层里画线要用“相对本层”的坐标，否则会叠一层偏移 */
      var topLine = yOfDeg(layer, clef.top) - layer.top;
      var span = (clef.top - clef.bottom) * HALF;
      var active = layer.trackId === app.activeTrackId ? ' is-active' : '';
      html += '<div class="staff-layer' + active + '" data-track="' + layer.trackId +
        '" style="top:' + layer.top + 'px;height:' + layer.height + 'px;--nc:' + ins.color + '">';
      for (var i = 0; i < 5; i += 1) {
        html += '<span class="staff-line" style="top:' + (topLine + i * HALF * 2) +
          'px;left:' + PAD_LEFT + 'px;width:' + Math.max(0, width - PAD_LEFT) + 'px"></span>';
      }
      html += '<span class="staff-clef" style="top:' + topLine + 'px;height:' + span + 'px">' +
        clef.symbol + '</span>';
      html += '<span class="staff-time" style="top:' + (topLine + (span - 24) / 2) + 'px">4<i>4</i></span>';
      for (var bar = 0; bar <= bars; bar += 1) {
        var strong = bar === 0 || bar === bars;
        html += '<span class="bar-line' + (strong ? ' is-edge' : '') +
          '" style="left:' + (PAD_LEFT + bar * Logic.BEATS_PER_BAR * BEAT_W) +
          'px;top:' + topLine + 'px;height:' + span + 'px"></span>';
      }
      for (var beat = 1; beat < bars * Logic.BEATS_PER_BAR; beat += 1) {
        html += '<span class="beat-tick" style="left:' + (PAD_LEFT + beat * BEAT_W) +
          'px;top:' + topLine + 'px;height:' + span + 'px"></span>';
      }
      html += '</div>';
    });
    box.innerHTML = html;
  }

  function renderRuler() {
    var ruler = el('scoreRuler');
    if (!ruler) return;
    var bars = app.score.bars;
    var html = '';
    for (var bar = 0; bar < bars; bar += 1) {
      html += '<div class="bar-mark" style="left:' + (PAD_LEFT + bar * Logic.BEATS_PER_BAR * BEAT_W) + 'px">' +
        '<span>' + (bar + 1) + '</span></div>';
      for (var beat = 1; beat < Logic.BEATS_PER_BAR; beat += 1) {
        html += '<div class="beat-mark" style="left:' + (PAD_LEFT + (bar * Logic.BEATS_PER_BAR + beat) * BEAT_W) + 'px"></div>';
      }
    }
    ruler.innerHTML = html;
  }

  /* 超出五线的音要画加线 */
  function ledgerMarks(layer, deg, headTop) {
    var clef = layer.win.clef;
    var out = '';
    var step;
    if (deg > clef.top) {
      for (step = clef.top + 2; step <= deg; step += 2) {
        out += '<span class="ledger" style="top:' + (yOfDeg(layer, step) - headTop) + 'px"></span>';
      }
    } else if (deg < clef.bottom) {
      for (step = clef.bottom - 2; step >= deg; step -= 2) {
        out += '<span class="ledger" style="top:' + (yOfDeg(layer, step) - headTop) + 'px"></span>';
      }
    }
    return out;
  }

  /* 一个音符的全部记号：符头 / 符干 / 符尾 / 升降号 / 加线 / 简谱数字 */
  function noteHtml(geom, note, isMaster) {
    var deg = noteDeg(note.m);
    if (deg < geom.win.lo || deg > geom.win.hi) return '';
    var ins = Logic.findInstrument(geom.instrument);
    var midDeg = (geom.win.clef.top + geom.win.clef.bottom) / 2;
    var headY = yOfDeg(geom, deg);
    var headTop = headY - 8;
    var selected = app.selected && app.selected.trackId === geom.trackId &&
      Math.abs(app.selected.t - note.t) < 1e-6;
    var cls = 'note';
    if (isMaster) cls += ' on-master';
    if (note.d >= 2) cls += ' is-open';
    if (note.d >= 4) cls += ' is-whole';
    if (isSharp(note.m)) cls += ' is-sharp';
    if (selected) cls += ' is-selected';
    cls += deg >= midDeg ? ' stem-down' : ' stem-up';
    var width = Math.max(10, (note.d / STEP) * STEP_W - 3);
    var style = 'left:' + xOfHead(note.t) + 'px;top:' + headTop + 'px;width:' + width +
      'px;--nc:' + ins.color + ';';
    var inner = ledgerMarks(geom, deg, headTop);
    if (isSharp(note.m)) inner += '<span class="acc">♯</span>';
    if (app.view === 'jianpu') {
      var d = Logic.degreeOf(note.m);
      if (d.octave > 4) inner += '<span class="jp-dot up">' + new Array(d.octave - 3).join('·') + '</span>';
      if (d.octave < 4) inner += '<span class="jp-dot down">' + new Array(4 - d.octave).join('·') + '</span>';
      inner += '<span class="jp">' + d.degree + '</span>';
    } else {
      inner += '<span class="head"></span><span class="stem"></span>';
      if (note.d <= 0.5) inner += '<span class="flag f1"></span>';
      if (note.d <= 0.25) inner += '<span class="flag f2"></span>';
    }
    return '<div class="' + cls + '" data-track="' + geom.trackId + '" data-t="' + note.t + '"' +
      (isMaster ? ' data-master="1"' : '') + ' style="' + style + '" title="' +
      Logic.pitchName(note.m) + ' · ' + Logic.DURATION_NAMES[note.d] +
      '（拖动可改音高）">' + inner + '</div>';
  }

  function renderNotes() {
    var layerBox = el('noteLayer');
    if (!layerBox) return;
    var out = '';
    masterGeom().forEach(function (geom) {
      var track = trackOf(geom.trackId);
      if (!track) return;
      track.notes.forEach(function (note) { out += noteHtml(geom, note, true); });
    });
    layerGeom().forEach(function (geom) {
      var track = trackOf(geom.trackId);
      if (!track) return;
      track.notes.forEach(function (note) { out += noteHtml(geom, note, false); });
    });
    layerBox.innerHTML = out;
  }

  function renderBoard() {
    var board = el('scoreBoard');
    if (!board) return;
    board.style.width = boardWidth() + 'px';
    board.style.height = boardHeight() + 'px';
    board.classList.toggle('is-staff', app.view === 'staff');
    board.classList.toggle('is-jianpu', app.view === 'jianpu');
    renderRail();
    renderRuler();
    renderStaffLayers();
    renderNotes();
    renderPlayhead();
    renderCursor();
    renderEditor();
  }

  function renderPlayhead() {
    var head = el('playhead');
    if (!head) return;
    head.style.left = xOfBeat(currentBeat()) + 'px';
    head.classList.toggle('is-on', app.playing || currentBeat() > 0);
  }

  function renderCursor() {
    var info = el('cursorInfo');
    if (!info) return;
    var bar = Math.floor(app.cursor.t / Logic.BEATS_PER_BAR) + 1;
    var beat = Math.floor(app.cursor.t % Logic.BEATS_PER_BAR) + 1;
    var track = trackOf(app.activeTrackId);
    var ins = track ? Logic.findInstrument(track.instrument) : null;
    var name = app.cursor.midi ? Logic.pitchName(app.cursor.midi) : '—';
    info.textContent = (ins ? ins.name : '—') + ' · ' + name + ' · 第 ' + bar + ' 小节 第 ' + beat + ' 拍';
  }

  function selectedNote() {
    if (!app.selected) return null;
    var track = trackOf(app.selected.trackId);
    return track ? Logic.noteAt(track, app.selected.t) : null;
  }

  function renderEditor() {
    var note = selectedNote();
    var hint = el('editorHint');
    if (hint) {
      if (app.eraser) {
        hint.textContent = '橡皮模式：点音符即删除，点空白只提示';
      } else if (note) {
        hint.textContent = '已选中 ' + Logic.pitchName(note.m) + ' · ' + Logic.DURATION_NAMES[note.d] +
          '：拖拽/↑↓ 改音高，←→ 挪拍位';
      } else {
        hint.textContent = masterHeight()
          ? '点上方主谱写音符，自动落进对应乐器的分谱；拖动符头改音高'
          : '点谱表写音符，拖动符头改音高';
      }
    }
    ['pitchUpBtn', 'pitchDownBtn', 'delNoteBtn'].forEach(function (id) {
      var btn = el(id);
      if (btn) btn.disabled = !note;
    });
  }

  /* ---------------- 编辑操作 ---------------- */

  function snapshot() {
    history.push(Logic.serialize(app.score));
    if (history.length > 40) history.shift();
  }

  function undo() {
    var prev = history.pop();
    if (!prev) { toast('没有可撤销的编辑'); return; }
    var restored = Logic.parse(prev);
    if (!restored) return;
    app.score = restored;
    if (!trackOf(app.activeTrackId)) app.activeTrackId = app.score.tracks[0] ? app.score.tracks[0].id : null;
    app.selected = null;
    renderAll();
    saveScore();
    toast('已撤销上一步');
  }

  function activeTrack() {
    return trackOf(app.activeTrackId) || app.score.tracks[0] || null;
  }

  function selectTrack(id) {
    app.activeTrackId = id;
    renderTracks();
    renderRail();
    renderStaffLayers();
    renderCursor();
    renderEditor();
  }

  function afterEdit(keepSelection) {
    if (!keepSelection) app.selected = null;
    if (app.playing) halt();
    renderBoard();
    renderStats();
    renderTracks();
    renderMixer();
    checkTasks();
    saveScore();
  }

  /* 把点击坐标换算成某件乐器谱表上的拍位与音高 */
  function pointFromEvent(event) {
    var hit = el('hitLayer');
    if (!hit) return null;
    var rect = hit.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top, rect: rect };
  }

  /* 命中已有音符：主谱和分谱都能点中，返回 { trackId, t, note } */
  function noteHitAt(x, y, onlyMaster) {
    var geoms = onlyMaster ? masterGeom() : masterGeom().concat(layerGeom());
    var best = null;
    var bestDist = 1e9;
    geoms.forEach(function (geom) {
      var track = trackOf(geom.trackId);
      if (!track) return;
      track.notes.forEach(function (note) {
        var deg = noteDeg(note.m);
        if (deg < geom.win.lo || deg > geom.win.hi) return;
        var dx = Math.abs(x - xOfBeat(note.t));
        var dy = Math.abs(y - yOfDeg(geom, deg));
        if (dx > 8 || dy > 7) return;
        if (dx + dy < bestDist) {
          bestDist = dx + dy;
          best = { trackId: geom.trackId, t: note.t, note: note, deg: deg };
        }
      });
    });
    return best;
  }

  function masterHit(x, y) { return noteHitAt(x, y, true); }

  /* 主谱上这个音高该交给哪件乐器：同谱表优先，其次音域最近，再其次当前乐器 */
  function instrumentForDeg(clefId, deg) {
    var pick = null;
    var best = 1e9;
    visibleTracks().forEach(function (track) {
      var win = Logic.staffWindow(track.instrument);
      var same = win.clef.id === clefId;
      var dist = deg < win.lo ? win.lo - deg : (deg > win.hi ? deg - win.hi : 0);
      var mid = (win.hi + win.lo) / 2;
      var score = (same ? 0 : 60) + dist * 4 + Math.abs(deg - mid) * 0.005 +
        (track.id === app.activeTrackId ? -0.5 : 0);
      if (score < best) { best = score; pick = track; }
    });
    return pick;
  }

  /* 主谱上点一下 → 拍位 + 音高 + 落进哪件乐器 */
  function masterCell(x, y) {
    var staff = masterStaffAtY(y);
    if (!staff) return null;
    var deg = staff.axisHi - Math.round((y - staff.staffTop) / HALF);
    var track = instrumentForDeg(staff.clefId, deg);
    if (!track) return null;
    var row = Logic.nearestStaffRow(track.instrument, deg);
    if (!row) return null;
    var t = clamp(Math.round((x - PAD_LEFT) / STEP_W) * STEP, 0, spanBeats() - STEP);
    return { t: t, midi: row.midi, deg: row.deg, trackId: track.id, instrument: track.instrument };
  }

  function cellFromEvent(event) {
    var point = pointFromEvent(event);
    if (!point) return null;
    var rect = point.rect;
    var x = point.x;
    var y = point.y;
    if (x < 0 || y < RULER_H || x > rect.width || y > rect.height) return null;
    var layer = layerAtY(y);
    if (!layer) return null;
    var track = trackOf(layer.trackId);
    if (!track) return null;
    var deg = layer.axisHi - Math.round((y - layer.staffTop) / HALF);
    var row = Logic.nearestStaffRow(track.instrument, deg);
    if (!row) return null;
    var raw = ((x - PAD_LEFT) / STEP_W) * STEP;
    var t = clamp(Math.round(raw / STEP) * STEP, 0, spanBeats() - STEP);
    return { t: t, midi: row.midi, deg: row.deg, trackId: track.id };
  }

  function noteUnder(track, t) {
    var found = null;
    track.notes.forEach(function (note) {
      if (t >= note.t - 1e-6 && t < note.t + note.d - 1e-6) found = note;
    });
    return found;
  }

  function placeNote(t, midi, trackId) {
    var track = trackOf(trackId) || activeTrack();
    if (!track) { toast('先添加一条乐器轨'); return; }
    var target = noteUnder(track, t);
    if (target) {
      if (app.eraser) {
        snapshot();
        Logic.removeNote(app.score, track.id, target.t);
        afterEdit();
        return;
      }
      app.selected = { trackId: track.id, t: target.t };
      app.cursor = { t: target.t, midi: target.m };
      renderNotes();
      renderEditor();
      renderCursor();
      syncControls();
      return;
    }
    if (app.eraser) { toast('这里没有音符'); return; }
    snapshot();
    var pitch = app.sharp ? midi + 1 : midi;
    var note = Logic.addNote(app.score, track.id, { t: t, m: pitch, d: app.duration });
    if (!note && pitch !== midi) note = Logic.addNote(app.score, track.id, { t: t, m: midi, d: app.duration });
    if (!note) { history.pop(); toast('这里写不下这个音'); return; }
    app.selected = { trackId: track.id, t: note.t };
    app.cursor = { t: note.t, midi: note.m };
    afterEdit(true);
  }

  function changeDuration(value) {
    app.duration = value;
    renderDurations();
    if (selectedNote()) {
      snapshot();
      Logic.setNote(app.score, app.selected.trackId, app.selected.t, { d: value });
      afterEdit(true);
    }
  }

  function deleteSelected() {
    if (!app.selected) { toast('先用鼠标点一个音符'); return false; }
    snapshot();
    Logic.removeNote(app.score, app.selected.trackId, app.selected.t);
    afterEdit();
    return true;
  }

  /* 选中音符的键盘/按钮微调 */
  function pitchRange() {
    var rows = Logic.PITCH_ROWS;
    return { low: rows[rows.length - 1].midi, high: rows[0].midi };
  }

  function nudgePitch(delta) {
    var note = selectedNote();
    if (!note) { toast('先点一个音符再改音高'); return; }
    var range = pitchRange();
    var next = clamp(note.m + delta, range.low, range.high);
    if (next === note.m) { toast('已到写谱范围边缘'); return; }
    snapshot();
    Logic.setNote(app.score, app.selected.trackId, app.selected.t, { m: next });
    app.cursor = { t: note.t, midi: next };
    afterEdit(true);
    toast('音高改为 ' + Logic.pitchName(next));
  }

  function nudgeTime(delta) {
    var note = selectedNote();
    if (!note) { toast('先点一个音符再挪拍位'); return; }
    var nextT = clamp(note.t + delta, 0, Math.max(0, spanBeats() - note.d));
    if (Math.abs(nextT - note.t) < 1e-6) return;
    snapshot();
    var trackId = app.selected.trackId;
    var d = note.d;
    var v = note.v;
    Logic.removeNote(app.score, trackId, note.t);
    if (!Logic.addNote(app.score, trackId, { t: nextT, m: note.m, d: d, v: v })) {
      Logic.addNote(app.score, trackId, { t: note.t, m: note.m, d: d, v: v });
      history.pop();
      toast('这个拍位已有音符');
      return;
    }
    app.selected = { trackId: trackId, t: nextT };
    afterEdit(true);
  }

  /* 有选中音符时，♯ 切换它的升降号；否则切换写入模式 */
  function toggleSharp() {
    var note = selectedNote();
    if (!note) {
      app.sharp = !app.sharp;
      renderDurations();
      syncControls();
      return;
    }
    var next = isSharp(note.m) ? note.m - 1 : note.m + 1;
    snapshot();
    Logic.setNote(app.score, app.selected.trackId, app.selected.t, { m: next });
    afterEdit(true);
    toast('改为 ' + Logic.pitchName(next));
  }

  /* 拖动符头：纵向改音高，横向挪拍位 */
  var drag = null;

  function beginDrag(cell, note) {
    drag = {
      trackId: cell.trackId,
      t: note.t,
      midi: note.m,
      sharp: isSharp(note.m),
      moved: false,
      snapshot: false
    };
  }

  function dragTo(clientX, clientY) {
    if (!drag) return;
    var hit = el('hitLayer');
    var from = trackOf(drag.trackId);
    if (!hit || !from) return;
    var rect = hit.getBoundingClientRect();
    var y = clientY - rect.top;
    var x = clientX - rect.left;
    /* 在主谱上拖就按主谱换算，并允许纵向拖到另一张谱表换乐器 */
    var onMaster = masterAtY(y);
    var layer = onMaster ? masterStaffAtY(y) : layerOfTrack(drag.trackId);
    if (!layer) return;
    var deg = layer.axisHi - Math.round((y - layer.staffTop) / HALF);
    var to = onMaster ? (instrumentForDeg(layer.clefId, deg) || from) : from;
    var row = Logic.nearestStaffRow(to.instrument, deg);
    if (!row) return;
    var range = pitchRange();
    var want = row.midi + (drag.sharp ? 1 : 0);
    if (want > range.high) want = row.midi;
    var t = clamp(Math.round((x - PAD_LEFT) / STEP_W) * STEP, 0, spanBeats() - STEP);
    if (t === drag.t && want === drag.midi && to.id === drag.trackId) return;
    var note = Logic.noteAt(from, drag.t);
    if (!note) { drag = null; return; }
    if (!drag.snapshot) { snapshot(); drag.snapshot = true; }
    var d = note.d;
    var v = note.v;
    if (t !== note.t || to.id !== drag.trackId) {
      Logic.removeNote(app.score, from.id, note.t);
      if (!Logic.addNote(app.score, to.id, { t: t, m: want, d: d, v: v })) {
        Logic.addNote(app.score, from.id, { t: drag.t, m: note.m, d: d, v: v });
        return;
      }
      if (to.id !== drag.trackId) {
        drag.trackId = to.id;
        app.activeTrackId = to.id;
        renderRail();
        renderStaffLayers();
      }
      drag.t = t;
    } else if (want !== note.m) {
      Logic.setNote(app.score, from.id, note.t, { m: want });
    }
    drag.midi = want;
    drag.moved = true;
    app.selected = { trackId: drag.trackId, t: drag.t };
    app.cursor = { t: drag.t, midi: want };
    renderNotes();
    renderCursor();
    renderEditor();
    renderTracks();
  }

  function endDrag() {
    var moved = drag && drag.moved;
    drag = null;
    if (moved) afterEdit(true);
  }

  /* ---------------- 音频引擎 ---------------- */

  function ensureAudio() {
    if (AU.ctx) {
      if (AU.ctx.state === 'suspended' && AU.ctx.resume) AU.ctx.resume();
      return AU.ctx;
    }
    var Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) return null;
    var ctx = new Ctor();
    AU.ctx = ctx;
    AU.master = ctx.createGain();
    AU.master.gain.value = app.score.master;
    AU.comp = ctx.createDynamicsCompressor();
    AU.comp.threshold.value = -16;
    AU.comp.ratio.value = 4;
    AU.master.connect(AU.comp);
    AU.comp.connect(ctx.destination);
    AU.wet = ctx.createGain();
    AU.wet.gain.value = 0.8;
    AU.wet.connect(AU.master);
    return ctx;
  }

  function noiseBuffer() {
    if (AU.noise) return AU.noise;
    var ctx = AU.ctx;
    var len = Math.floor(ctx.sampleRate * 0.6);
    var buffer = ctx.createBuffer(1, len, ctx.sampleRate);
    var data = buffer.getChannelData(0);
    for (var i = 0; i < len; i += 1) data[i] = Math.random() * 2 - 1;
    AU.noise = buffer;
    return buffer;
  }

  function waveFor(harmonics, key) {
    if (AU.waves[key]) return AU.waves[key];
    var ctx = AU.ctx;
    var real = new Float32Array(harmonics.length + 1);
    var imag = new Float32Array(harmonics.length + 1);
    for (var i = 0; i < harmonics.length; i += 1) imag[i + 1] = harmonics[i];
    var wave = ctx.createPeriodicWave(real, imag, { disableNormalization: false });
    AU.waves[key] = wave;
    return wave;
  }

  function chainFor(trackId) {
    if (AU.chains[trackId]) return AU.chains[trackId];
    var ctx = AU.ctx;
    var input = ctx.createGain();
    input.gain.value = 1;
    var analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    var pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    var send = ctx.createGain();
    send.gain.value = 0.25;
    input.connect(analyser);
    if (pan) {
      analyser.connect(pan);
      pan.connect(AU.master);
    } else {
      analyser.connect(AU.master);
    }
    input.connect(send);
    send.connect(AU.wet);
    var chain = { input: input, analyser: analyser, pan: pan, send: send };
    AU.chains[trackId] = chain;
    return chain;
  }

  function playEvent(event, when) {
    var ctx = AU.ctx;
    if (!ctx || !isFinite(when)) return;
    if (when < ctx.currentTime - 0.08) return;
    var tim = event.timbre;
    var ins = tim.instrument;
    var freq = 440 * Math.pow(2, (event.midi - 69) / 12);
    var chain = chainFor(event.trackId);
    if (chain.pan) chain.pan.pan.setValueAtTime(clamp(event.pan, -1, 1), when);
    chain.send.gain.setValueAtTime(clamp(tim.reverb, 0, 0.9) * 0.7, when);

    var amp = ctx.createGain();
    amp.gain.value = 0.0001;
    var filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = clamp(tim.cutoff, 300, 14000);
    filter.Q.value = clamp(tim.q, 0.1, 12);
    amp.connect(filter);
    filter.connect(chain.input);

    var dur = Math.max(0.08, event.dur);
    var attack = Math.max(0.004, tim.attack);
    var release = Math.max(0.05, tim.release);
    var peak = clamp(event.gain, 0.0006, 0.85);
    var endAt = when + dur;
    var decay = Math.max(0.02, ins.decay);
    var g = amp.gain;
    g.setValueAtTime(0.0001, when);
    g.exponentialRampToValueAtTime(peak, when + attack);
    if (ins.pluck || ins.percussive) {
      g.exponentialRampToValueAtTime(Math.max(0.0002, peak * 0.2), when + Math.min(dur, attack + decay * 0.6));
    } else {
      g.linearRampToValueAtTime(peak * clamp(ins.sustain, 0.02, 1), when + attack + decay);
    }
    g.exponentialRampToValueAtTime(0.0001, endAt + release);

    var osc = ctx.createOscillator();
    osc.setPeriodicWave(waveFor(ins.harmonics, ins.id));
    osc.frequency.setValueAtTime(freq, when);
    if (ins.percussive) {
      osc.frequency.setValueAtTime(freq * 1.4, when);
      osc.frequency.exponentialRampToValueAtTime(freq, when + 0.07);
    }
    if (tim.vibratoDepth > 0.001 && tim.vibratoRate > 0) {
      var lfo = ctx.createOscillator();
      var depth = ctx.createGain();
      lfo.frequency.value = tim.vibratoRate;
      depth.gain.value = freq * tim.vibratoDepth * 0.018;
      lfo.connect(depth);
      depth.connect(osc.frequency);
      lfo.start(when);
      lfo.stop(endAt + release + 0.1);
    }
    osc.connect(amp);
    osc.start(when);
    osc.stop(endAt + release + 0.06);

    if (ins.noise) {
      var src = ctx.createBufferSource();
      src.buffer = noiseBuffer();
      var nf = ctx.createBiquadFilter();
      nf.type = 'lowpass';
      nf.frequency.value = ins.percussive ? 480 : 1600;
      var ng = ctx.createGain();
      ng.gain.setValueAtTime(ins.noise * peak * 1.4, when);
      ng.gain.exponentialRampToValueAtTime(0.0005, when + (ins.percussive ? 0.22 : 0.16));
      src.connect(nf);
      nf.connect(ng);
      ng.connect(chain.input);
      src.start(when);
      src.stop(when + 0.3);
    }
  }

  function click(when, accent) {
    var ctx = AU.ctx;
    var osc = ctx.createOscillator();
    var g = ctx.createGain();
    osc.type = 'square';
    osc.frequency.value = accent ? 1760 : 1200;
    g.gain.setValueAtTime(0.0001, when);
    g.gain.exponentialRampToValueAtTime(accent ? 0.12 : 0.06, when + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, when + 0.06);
    osc.connect(g);
    g.connect(AU.master);
    osc.start(when);
    osc.stop(when + 0.08);
  }

  function previewInstrument(instrumentId) {
    if (!ensureAudio()) return;
    var track = { instrument: instrumentId, volume: 0.9, pan: 0 };
    var tim = Logic.timbre(app.score, track);
    var start = AU.ctx.currentTime + 0.03;
    [60, 64, 67].forEach(function (midi, index) {
      playEvent({
        trackId: 'preview-' + instrumentId,
        instrument: instrumentId,
        midi: midi,
        time: 0,
        dur: 0.55,
        velocity: 0.8,
        gain: tim.gain * 0.9,
        pan: 0,
        timbre: tim
      }, start + index * 0.16);
    });
  }

  function currentBeat() {
    if (app.playing && AU.ctx && runner.timeline) {
      var elapsed = (AU.ctx.currentTime - runner.startAt) / runner.timeline.beatSec;
      return clamp(runner.fromBeat + elapsed, 0, spanBeats());
    }
    return clamp(app.position, 0, spanBeats());
  }
  function playPosition() { return currentBeat(); }

  function frame() {
    if (!app.playing) return;
    renderPlayhead();
    var info = el('playInfo');
    if (info) info.textContent = fmtTime(currentBeat() * beatSec()) + ' / ' + fmtTime(Logic.stats(app.score).totalSeconds);
    var scroll = el('scoreScroll');
    var board = el('scoreBoard');
    if (scroll && board) {
      var x = xOfBeat(currentBeat());
      if (x > scroll.scrollLeft + scroll.clientWidth - 40) scroll.scrollLeft = x - scroll.clientWidth * 0.4;
      else if (x < scroll.scrollLeft + 20) scroll.scrollLeft = Math.max(0, x - 40);
    }
    updateMeters();
    runner.raf = window.requestAnimationFrame(frame);
  }

  function updateMeters() {
    if (!AU.ctx) return;
    Object.keys(AU.chains).forEach(function (id) {
      var chain = AU.chains[id];
      var node = document.querySelector('[data-meter="' + id + '"]');
      if (!node) return;
      var buf = new Uint8Array(chain.analyser.fftSize);
      chain.analyser.getByteTimeDomainData(buf);
      var sum = 0;
      for (var i = 0; i < buf.length; i += 1) {
        var v = (buf[i] - 128) / 128;
        sum += v * v;
      }
      var rms = Math.sqrt(sum / buf.length);
      node.style.width = Math.min(100, rms * 180) + '%';
    });
  }

  function pump() {
    if (!app.playing || !AU.ctx || !runner.timeline) return;
    var tl = runner.timeline;
    var ctx = AU.ctx;
    var offset = runner.fromBeat * tl.beatSec;
    var elapsed = ctx.currentTime - runner.startAt;
    var horizon = elapsed + 0.4;
    while (runner.index < tl.events.length && tl.events[runner.index].time - offset <= horizon) {
      var event = tl.events[runner.index];
      var when = runner.startAt + (event.time - offset);
      playEvent(event, when);
      runner.index += 1;
    }
    if (app.metro) {
      var beatDur = tl.beatSec;
      while (runner.beat * beatDur <= elapsed + 0.3) {
        var at = runner.startAt + runner.beat * beatDur;
        if (at >= ctx.currentTime) click(at, runner.beat % Logic.BEATS_PER_BAR === 0);
        runner.beat += 1;
      }
    }
    if (elapsed >= (spanBeats() - runner.fromBeat) * tl.beatSec) {
      if (app.loop) {
        restartLoop();
      } else {
        halt();
        app.position = 0;
        renderPlayhead();
        syncControls();
        toast('全曲奏毕');
      }
    }
  }

  function restartLoop() {
    if (runner.timer) window.clearInterval(runner.timer);
    if (runner.raf) window.cancelAnimationFrame(runner.raf);
    runner.timer = null;
    runner.raf = null;
    startPlayback(0);
  }

  function startPlayback(fromBeat) {
    if (!ensureAudio()) { toast('当前浏览器不支持 Web Audio'); return; }
    if (runner.timer) window.clearInterval(runner.timer);
    if (runner.raf) window.cancelAnimationFrame(runner.raf);
    var tl = Logic.timeline(app.score);
    runner.timeline = tl;
    runner.fromBeat = clamp(fromBeat, 0, spanBeats() - STEP);
    runner.startAt = AU.ctx.currentTime + 0.12;
    runner.index = 0;
    runner.beat = Math.ceil(runner.fromBeat);
    var offset = runner.fromBeat * tl.beatSec;
    while (runner.index < tl.events.length && tl.events[runner.index].time < offset - 1e-6) runner.index += 1;
    if (AU.master) AU.master.gain.value = app.score.master;
    app.playing = true;
    syncControls();
    renderPlayhead();
    runner.timer = window.setInterval(pump, 40);
    runner.raf = window.requestAnimationFrame(frame);
    pump();
  }

  function halt() {
    var pos = currentBeat();
    if (runner.timer) window.clearInterval(runner.timer);
    if (runner.raf) window.cancelAnimationFrame(runner.raf);
    runner.timer = null;
    runner.raf = null;
    runner.timeline = null;
    app.playing = false;
    app.position = clamp(pos, 0, spanBeats());
    syncControls();
    renderPlayhead();
    updateMeters();
  }

  function stopPlayback() {
    halt();
    app.position = 0;
    renderPlayhead();
    syncControls();
  }

  function togglePlay() {
    if (app.playing) {
      halt();
      return;
    }
    startPlayback(app.position >= spanBeats() - STEP ? 0 : app.position);
  }

  function checkTasks() {
    var gained = Logic.evaluateTasks(app.score, app.progress);
    if (!gained.length) return;
    writeJSON(STORE_KEY, app.progress);
    renderTasks();
    renderStats();
    renderInstrumentPicker();
    var titles = gained.map(function (id) {
      var found = Logic.TASKS.filter(function (t) { return t.id === id; })[0];
      return found ? found.title : id;
    });
    toast('乐章任务达成：' + titles.join('、') + ' ★');
  }

  /* ---------------- 示范曲 / 导出 ---------------- */

  function openModal(title, html) {
    if (el('modalTitle')) el('modalTitle').textContent = title;
    if (el('modalBody')) el('modalBody').innerHTML = html;
    if (el('modal')) el('modal').hidden = false;
  }

  function closeModal() {
    if (el('modal')) el('modal').hidden = true;
  }

  function openDemos() {
    var list = Logic.demoList();
    var html = '<div class="demo-grid">' + list.map(function (demo) {
      return '<button type="button" class="demo-card" data-demo="' + demo.id + '">' +
        '<b>' + escapeHtml(demo.title) + '</b>' +
        '<span class="demo-meta">' + demo.tempo + ' BPM · ' + demo.tracks + ' 轨 · ' + demo.notes + ' 音 · ' +
          fmtTime(demo.seconds) + '</span>' +
        '<small>' + escapeHtml(demo.hint) + '</small>' +
        '</button>';
    }).join('') + '</div>' +
      '<p class="modal-hint">载入示范曲会替换当前作品；载入后可以直接播放，也可以增删音符改写。</p>';
    openModal('示范曲 · 从名曲开始', html);
  }

  function openExport() {
    var text = Logic.serialize(app.score);
    var html = '<textarea id="exportArea" class="export-area" spellcheck="false">' + escapeHtml(text) + '</textarea>' +
      '<p class="modal-hint">把这段 JSON 发给朋友，或用「导入」把粘贴的内容还原成乐谱。</p>' +
      '<div style="display:flex;gap:8px;margin-top:10px">' +
        '<button type="button" id="copyExport" class="ghost">复制</button>' +
        '<button type="button" id="importExport" class="ghost">导入</button>' +
      '</div>';
    openModal('导出 / 导入', html);
    var area = el('exportArea');
    if (area && area.select) area.select();
  }

  function copyText(text) {
    if (window.navigator && window.navigator.clipboard && window.navigator.clipboard.writeText) {
      window.navigator.clipboard.writeText(text).then(function () { toast('已复制到剪贴板'); },
        function () { toast('复制失败，请手动全选'); });
      return;
    }
    var area = el('exportArea');
    if (area && area.select) {
      area.select();
      toast('已全选，请按 Ctrl+C 复制');
    }
  }

  function importText() {
    var area = el('exportArea');
    if (!area) return;
    var parsed = Logic.parse(area.value);
    if (!parsed) { toast('这段内容不是有效的乐谱'); return; }
    snapshot();
    app.score = parsed;
    app.activeTrackId = app.score.tracks[0] ? app.score.tracks[0].id : null;
    app.position = 0;
    closeModal();
    renderAll();
    saveScore();
    toast('乐谱已导入');
  }

  function loadDemo(id) {
    var demo = Logic.DEMOS.filter(function (d) { return d.id === id; })[0];
    if (!demo) return;
    snapshot();
    app.score = demo.build();
    app.activeTrackId = app.score.tracks[0] ? app.score.tracks[0].id : null;
    app.selected = null;
    app.hidden = {};
    app.cursor = { t: 0 };
    app.position = 0;
    closeModal();
    renderAll();
    saveScore(true);
    toast('已载入《' + demo.title + '》');
  }

  function resizeBars(bars) {
    snapshot();
    var span = bars * Logic.BEATS_PER_BAR;
    app.score.bars = bars;
    app.score.tracks.forEach(function (track) {
      track.notes = track.notes.filter(function (note) { return note.t < span; });
      track.notes.forEach(function (note) {
        if (note.t + note.d > span) note.d = Math.max(STEP, span - note.t);
      });
    });
    app.position = Math.min(app.position, span);
    if (app.playing) halt();
    renderAll();
    saveScore();
  }

  /* ---------------- 事件绑定 ---------------- */

  function bind() {
    on(el('addTrackBtn'), 'click', function () {
      var picker = el('instrumentPicker');
      if (!picker) return;
      if (picker.hidden) renderInstrumentPicker();
      picker.hidden = !picker.hidden;
    });

    on(el('instrumentPicker'), 'click', function (event) {
      var card = event.target.closest ? event.target.closest('[data-ins]') : null;
      if (!card || card.disabled) return;
      var id = card.getAttribute('data-ins');
      if (!Logic.isInstrumentUnlocked(app.progress, id)) { toast('完成更多乐章任务即可解锁'); return; }
      if (app.score.tracks.length >= Logic.MAX_TRACKS) { toast('最多 8 条乐器轨'); return; }
      var track = Logic.addTrack(app.score, id);
      if (!track) return;
      app.activeTrackId = track.id;
      el('instrumentPicker').hidden = true;
      renderAll();
      saveScore();
      previewInstrument(id);
    });

    on(el('trackList'), 'click', function (event) {
      var row = event.target.closest ? event.target.closest('[data-track]') : null;
      if (!row) return;
      var id = row.getAttribute('data-track');
      var track = trackOf(id);
      if (!track) return;
      var act = event.target.closest('[data-act]');
      if (act) {
        var action = act.getAttribute('data-act');
        if (action === 'mute') { track.mute = !track.mute; renderTracks(); renderMixer(); saveScore(); }
        else if (action === 'solo') { track.solo = !track.solo; renderTracks(); renderMixer(); saveScore(); }
        else if (action === 'hide') {
          app.hidden[id] = !app.hidden[id];
          renderTracks();
          renderBoard();
          toast(app.hidden[id] ? '已隐藏这层谱表' : '已显示这层谱表');
        }
        else if (action === 'remove') {
          if (app.score.tracks.length <= 1) { toast('至少保留一条乐器轨'); return; }
          snapshot();
          Logic.removeTrack(app.score, id);
          if (app.activeTrackId === id) app.activeTrackId = app.score.tracks[0].id;
          renderAll();
          saveScore();
          toast('已删除轨道，可用 Ctrl+Z 撤销');
        }
        return;
      }
      selectTrack(id);
    });

    on(el('mixer'), 'input', function (event) {
      var input = event.target;
      var act = input.getAttribute ? input.getAttribute('data-act') : null;
      if (!act) return;
      var row = input.closest ? input.closest('[data-track]') : null;
      if (!row) return;
      var track = trackOf(row.getAttribute('data-track'));
      if (!track) return;
      var value = Number(input.value);
      if (act === 'volume') track.volume = clamp(value / 100, 0, 1);
      if (act === 'pan') track.pan = clamp((value - 50) / 50, -1, 1);
      saveScore();
    });

    on(el('emotionList'), 'click', function (event) {
      var card = event.target.closest ? event.target.closest('[data-emotion]') : null;
      if (!card) return;
      Logic.applyEmotion(app.score, card.getAttribute('data-emotion'));
      renderEmotions();
      renderTweaks();
      syncControls();
      renderBoard();
      saveScore();
      toast('已切换音色：' + (Logic.findEmotion(app.score.emotion) || {}).name);
    });

    ['bright', 'reverb', 'vibrato'].forEach(function (key) {
      on(el(key + 'Input'), 'input', function (event) {
        app.score.tweaks[key] = clamp(Number(event.target.value) / 100, key === 'reverb' ? -0.35 : -1, 1);
        renderTweaks();
        saveScore();
      });
    });

    on(el('durationRow'), 'click', function (event) {
      var btn = event.target.closest ? event.target.closest('[data-dur]') : null;
      if (!btn) return;
      changeDuration(Number(btn.getAttribute('data-dur')));
    });

    on(el('sharpBtn'), 'click', toggleSharp);
    on(el('pitchUpBtn'), 'click', function () { nudgePitch(1); });
    on(el('pitchDownBtn'), 'click', function () { nudgePitch(-1); });
    on(el('delNoteBtn'), 'click', function () { deleteSelected(); });

    on(el('eraserBtn'), 'click', function () {
      app.eraser = !app.eraser;
      syncControls();
    });

    /* 分谱栏：点一层切到该层写谱；眼睛隐藏；M 静音 */
    on(el('layerRail'), 'click', function (event) {
      var row = event.target.closest ? event.target.closest('[data-track]') : null;
      if (!row) return;
      var id = row.getAttribute('data-track');
      var act = event.target.closest('[data-act]');
      var track = trackOf(id);
      if (!track) return;
      if (act) {
        var action = act.getAttribute('data-act');
        if (action === 'hide') {
          app.hidden[id] = true;
          renderTracks();
          renderBoard();
          return;
        }
        if (action === 'mute') {
          track.mute = !track.mute;
          renderTracks();
          renderRail();
          renderMixer();
          saveScore();
          return;
        }
      }
      selectTrack(id);
    });

    on(el('hitLayer'), 'pointerdown', function (event) {
      var point = pointFromEvent(event);
      if (!point) return;
      /* 先命中已有音符：主谱 / 分谱点中都能选中、拖动、删除 */
      var hit = noteHitAt(point.x, point.y, false);
      if (hit) {
        if (event.preventDefault) event.preventDefault();
        if (app.activeTrackId !== hit.trackId) selectTrack(hit.trackId);
        app.cursor = { t: hit.t, midi: hit.note.m };
        if (app.eraser) {
          snapshot();
          Logic.removeNote(app.score, hit.trackId, hit.t);
          afterEdit();
          return;
        }
        app.selected = { trackId: hit.trackId, t: hit.t };
        beginDrag({ trackId: hit.trackId, t: hit.t }, hit.note);
        renderNotes();
        renderEditor();
        renderCursor();
        syncControls();
        return;
      }
      /* 空白处：主谱写新音符（自动落到对应乐器的分谱），分谱只做编辑 */
      var cell = masterCell(point.x, point.y);
      if (!cell) {
        if (app.eraser) { toast('这里没有音符'); return; }
        if (!masterHeight()) cell = cellFromEvent(event);   /* 简谱没有主谱，直接写分谱 */
      }
      if (!cell) {
        if (layerAtY(point.y)) toast('写音符请点上方主谱，分谱用于查看和微调');
        return;
      }
      if (event.preventDefault) event.preventDefault();
      if (app.eraser) { toast('这里没有音符'); return; }
      if (app.activeTrackId !== cell.trackId) selectTrack(cell.trackId);
      app.cursor = { t: cell.t, midi: cell.midi };
      placeNote(cell.t, cell.midi, cell.trackId);
      renderCursor();
    });

    on(document, 'pointermove', function (event) {
      if (!drag) return;
      dragTo(event.clientX, event.clientY);
    });
    on(document, 'pointerup', endDrag);
    on(document, 'pointercancel', endDrag);

    /* 竖向滚动时左侧分谱栏跟随 */
    on(el('scoreScroll'), 'scroll', function () {
      var rail = el('layerRail');
      if (rail && rail.scrollTop !== el('scoreScroll').scrollTop) rail.scrollTop = el('scoreScroll').scrollTop;
    });

    on(el('scoreRuler'), 'click', function (event) {
      var rect = event.currentTarget.getBoundingClientRect();
      var beat = clamp((event.clientX - rect.left - PAD_LEFT) / STEP_W * STEP, 0, spanBeats() - STEP);
      app.position = beat;
      if (app.playing) { halt(); startPlayback(beat); }
      renderPlayhead();
      syncControls();
    });

    on(el('playBtn'), 'click', togglePlay);
    on(el('stopBtn'), 'click', stopPlayback);
    on(el('loopBtn'), 'click', function () {
      app.loop = !app.loop;
      syncControls();
    });
    on(el('metroBtn'), 'click', function () {
      app.metro = !app.metro;
      syncControls();
    });

    on(el('tempoInput'), 'change', function (event) {
      app.score.tempo = clamp(Math.round(Number(event.target.value) || 120), Logic.TEMPO_RANGE[0], Logic.TEMPO_RANGE[1]);
      if (app.playing) { halt(); startPlayback(app.position); }
      syncControls();
      saveScore();
    });

    on(el('barsSelect'), 'change', function (event) {
      resizeBars(Number(event.target.value));
    });

    on(el('titleInput'), 'input', function (event) {
      app.score.title = String(event.target.value).slice(0, 40) || '未命名交响曲';
      saveScore();
    });

    on(el('staffBtn'), 'click', function () {
      app.view = 'staff';
      renderBoard();
      syncControls();
    });
    on(el('jianpuBtn'), 'click', function () {
      app.view = 'jianpu';
      renderBoard();
      syncControls();
    });

    on(el('demoBtn'), 'click', openDemos);
    on(el('exportBtn'), 'click', openExport);
    on(el('saveBtn'), 'click', function () {
      saveScore(true);
      toast('已保存到本机');
    });
    on(el('clearBtn'), 'click', function () {
      snapshot();
      app.score.tracks.forEach(function (track) { Logic.clearTrack(app.score, track.id); });
      stopPlayback();
      renderAll();
      saveScore();
      toast('画布已清空，可撤销');
    });

    on(el('modalClose'), 'click', closeModal);
    on(el('modal'), 'click', function (event) {
      if (event.target === el('modal')) closeModal();
    });
    on(el('modalBody'), 'click', function (event) {
      var target = event.target;
      var demo = target.closest ? target.closest('[data-demo]') : null;
      if (demo) { loadDemo(demo.getAttribute('data-demo')); return; }
      if (target.id === 'copyExport') { copyText(el('exportArea') ? el('exportArea').value : ''); return; }
      if (target.id === 'importExport') importText();
    });

    on(document, 'keydown', function (event) {
      var tag = (event.target && event.target.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
      if (event.key === 'Escape') {
        if (app.selected) {
          app.selected = null;
          renderNotes();
          renderEditor();
          syncControls();
        } else {
          closeModal();
        }
        return;
      }
      if (event.code === 'Space' || event.key === ' ') {
        event.preventDefault();
        togglePlay();
      } else if (event.key === 'Delete' || event.key === 'Backspace') {
        if (deleteSelected()) event.preventDefault();
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        nudgePitch(event.shiftKey ? 12 : 1);
      } else if (event.key === 'ArrowDown') {
        event.preventDefault();
        nudgePitch(event.shiftKey ? -12 : -1);
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault();
        nudgeTime(-STEP);
      } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        nudgeTime(STEP);
      } else if ((event.ctrlKey || event.metaKey) && String(event.key).toLowerCase() === 'z') {
        event.preventDefault();
        undo();
      }
    });

    on(window, 'beforeunload', function () { if (app.score) saveScore(true); });
  }

  /* ---------------- 启动 ---------------- */

  function init() {
    var saved = loadScore();
    app.score = saved || (Logic.DEMOS[0] ? Logic.DEMOS[0].build() : Logic.createScore());
    if (!app.score.tracks.length) Logic.addTrack(app.score, 'violin');
    app.progress = loadProgress();
    app.activeTrackId = app.score.tracks[0].id;
    app.position = 0;
    bind();
    renderAll();
    checkTasks();
    if (!saved) {
      saveScore(true);
      toast('已载入示范曲《' + app.score.title + '》，可直接播放或改写');
    }
  }

  window.Symphony = {
    app: app,
    Logic: Logic,
    renderAll: renderAll,
    renderBoard: renderBoard,
    loadDemo: loadDemo,
    placeNote: placeNote,
    undo: undo,
    halt: halt,
    stopPlayback: stopPlayback,
    startPlayback: startPlayback,
    togglePlay: togglePlay,
    checkTasks: checkTasks,
    saveScore: saveScore,
    previewInstrument: previewInstrument,
    setDuration: changeDuration,
    selectTrack: selectTrack,
    selectNote: function (trackId, t) {
      app.selected = { trackId: trackId, t: t };
      renderNotes();
      renderEditor();
      renderCursor();
    },
    nudgePitch: nudgePitch,
    nudgeTime: nudgeTime,
    deleteSelected: deleteSelected,
    toggleSharp: toggleSharp,
    cellFromEvent: cellFromEvent,
    layerGeom: layerGeom,
    masterGeom: masterGeom,
    masterHit: masterHit,
    noteHitAt: noteHitAt,
    masterCell: masterCell,
    masterStaffAtY: masterStaffAtY,
    instrumentForDeg: instrumentForDeg,
    trackWindow: trackWindow,
    masterAtY: masterAtY,
    masterHeight: masterHeight,
    masterTrebleTop: masterTrebleTop,
    masterBassTop: masterBassTop,
    boardHeight: boardHeight,
    boardWidth: boardWidth,
    xOfBeat: xOfBeat,
    xOfHead: xOfHead,
    yOfDeg: yOfDeg,
    beginDrag: beginDrag,
    dragTo: dragTo,
    endDrag: endDrag
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();

