/* 交响乐工坊 · 规则层（无 DOM / 无音频），可被浏览器与 Node 同时加载 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.SymphonyLogic = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var VERSION = 1;
  var BEATS_PER_BAR = 4;
  var STEP = 0.25;
  var MAX_TRACKS = 8;
  var MIN_BARS = 2;
  var MAX_BARS = 16;
  var TEMPO_RANGE = [40, 208];
  var GRID_LOW = 48;
  var GRID_HIGH = 77;
  var DURATIONS = [4, 2, 1, 0.5, 0.25];
  var DURATION_NAMES = { 4: '全音符', 2: '二分音符', 1: '四分音符', 0.5: '八分音符', 0.25: '十六分音符' };
  var WHITE = [0, 2, 4, 5, 7, 9, 11];
  var NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  var FAMILY_NAMES = { strings: '弦乐', woodwind: '木管', brass: '铜管', pluck: '拨弦', keys: '键盘', percussion: '打击' };

  /* 乐器：harmonics 为泛音配比，pluck 为拨/击弦衰减，percussive 加入噪声起音 */
  var INSTRUMENTS = [
    { id: 'violin', name: '小提琴', family: 'strings', color: '#f0a44a', range: [55, 93], gain: 0.4,
      harmonics: [1, 0.62, 0.44, 0.3, 0.22, 0.16, 0.11], attack: 0.1, decay: 0.18, sustain: 0.82, release: 0.22,
      cutoff: 3200, q: 1.1, vibrato: 5.6, vibDepth: 0.1, desc: '弓弦明亮，擅长歌唱性主旋律' },
    { id: 'cello', name: '大提琴', family: 'strings', color: '#c8833f', range: [36, 76], gain: 0.46,
      harmonics: [1, 0.7, 0.5, 0.36, 0.26, 0.18, 0.12], attack: 0.13, decay: 0.24, sustain: 0.8, release: 0.3,
      cutoff: 1800, q: 1, vibrato: 4.8, vibDepth: 0.09, desc: '低沉厚实，和声与低音的骨架' },
    { id: 'flute', name: '长笛', family: 'woodwind', color: '#7fd3c0', range: [60, 96], gain: 0.34,
      harmonics: [1, 0.16, 0.08, 0.04, 0.02], attack: 0.05, decay: 0.12, sustain: 0.9, release: 0.18,
      cutoff: 5200, q: 0.8, vibrato: 5.2, vibDepth: 0.07, breath: 0.04, desc: '通透轻盈，像风掠过天空' },
    { id: 'clarinet', name: '单簧管', family: 'woodwind', color: '#8fb8ea', range: [50, 86], gain: 0.36,
      harmonics: [1, 0.08, 0.42, 0.05, 0.2, 0.03, 0.1], attack: 0.05, decay: 0.14, sustain: 0.86, release: 0.2,
      cutoff: 2800, q: 1.4, vibrato: 4.6, vibDepth: 0.05, desc: '中空而圆，中低音温润' },
    { id: 'trumpet', name: '小号', family: 'brass', color: '#f2cc58', range: [55, 88], gain: 0.38,
      harmonics: [1, 0.75, 0.6, 0.48, 0.36, 0.26, 0.2], attack: 0.04, decay: 0.12, sustain: 0.78, release: 0.16,
      cutoff: 4200, q: 1.2, vibrato: 5.8, vibDepth: 0.06, desc: '嘹亮有穿透力，适合号角式主题' },
    { id: 'horn', name: '圆号', family: 'brass', color: '#d9a15c', range: [48, 77], gain: 0.4,
      harmonics: [1, 0.55, 0.38, 0.26, 0.18, 0.12, 0.08], attack: 0.09, decay: 0.2, sustain: 0.84, release: 0.28,
      cutoff: 2000, q: 1, vibrato: 4.4, vibDepth: 0.05, desc: '圆润温暖，连接木管与铜管' },
    { id: 'harp', name: '竖琴', family: 'pluck', color: '#c9a6e8', range: [48, 96], gain: 0.34,
      harmonics: [1, 0.5, 0.3, 0.2, 0.14, 0.1, 0.07], attack: 0.005, decay: 1.1, sustain: 0.1, release: 0.5,
      cutoff: 5000, q: 1, vibrato: 0, vibDepth: 0, pluck: true, desc: '晶莹的琶音，为和声添上光' },
    { id: 'piano', name: '钢琴', family: 'keys', color: '#9fd08a', range: [36, 96], gain: 0.42,
      harmonics: [1, 0.7, 0.5, 0.34, 0.24, 0.16, 0.11], attack: 0.004, decay: 1.4, sustain: 0.16, release: 0.4,
      cutoff: 4200, q: 0.9, vibrato: 0, vibDepth: 0, pluck: true, desc: '颗粒清晰，可旋律也可铺和声' },
    { id: 'timpani', name: '定音鼓', family: 'percussion', color: '#e07575', range: [36, 60], gain: 0.5,
      harmonics: [1, 0.5, 0.3, 0.15], attack: 0.004, decay: 1.1, sustain: 0.02, release: 0.5,
      cutoff: 900, q: 1.2, vibrato: 0, vibDepth: 0, percussive: true, noise: 0.5, unlock: 2,
      desc: '定音的滚雷，为高潮奠基' },
    { id: 'organ', name: '管风琴', family: 'keys', color: '#b8c9e8', range: [36, 84], gain: 0.34,
      harmonics: [1, 0.8, 0.6, 0.45, 0.34, 0.25, 0.18], attack: 0.06, decay: 0.1, sustain: 0.95, release: 0.35,
      cutoff: 2600, q: 0.7, vibrato: 3.8, vibDepth: 0.04, unlock: 4,
      desc: '宏大庄严，铺满整个大厅' },
    { id: 'contrabass', name: '低音提琴', family: 'strings', color: '#a9825c', range: [28, 60], gain: 0.5,
      harmonics: [1, 0.66, 0.46, 0.32, 0.22, 0.15, 0.1], attack: 0.16, decay: 0.26, sustain: 0.78, release: 0.34,
      cutoff: 1200, q: 1.1, vibrato: 4.2, vibDepth: 0.08, unlock: 6,
      desc: '最低声部，撑起交响的地基' }
  ];

  var EMOTIONS = [
    { id: 'lively', name: '轻快', tempo: 138, dynamics: 0.92, gate: 0.7, bright: 0.45, reverb: 0.16, vibrato: 0.5,
      desc: '跳跃断奏、高频明亮，像春日舞步', icon: '🌤' },
    { id: 'tender', name: '温柔', tempo: 76, dynamics: 0.62, gate: 0.96, bright: -0.3, reverb: 0.5, vibrato: 1.2,
      desc: '连奏绵长、混响柔和，像耳边低语', icon: '🌙' },
    { id: 'grand', name: '壮丽', tempo: 96, dynamics: 1, gate: 0.99, bright: 0.2, reverb: 0.62, vibrato: 0.95,
      desc: '全奏饱满、厅堂开阔，像日出群山', icon: '🏛' },
    { id: 'melancholy', name: '忧郁', tempo: 62, dynamics: 0.55, gate: 0.9, bright: -0.6, reverb: 0.45, vibrato: 0.75,
      desc: '暗色弱奏、尾音拖长，像雨落窗台', icon: '🌧' },
    { id: 'mysterious', name: '神秘', tempo: 88, dynamics: 0.7, gate: 0.85, bright: -0.2, reverb: 0.72, vibrato: 1.35,
      desc: '揉弦摇曳、混响悠远，像雾中灯影', icon: '🔮' },
    { id: 'passionate', name: '激昂', tempo: 152, dynamics: 1, gate: 0.66, bright: 0.6, reverb: 0.24, vibrato: 1.15,
      desc: '强奏断音、铜管锋利，像烈火奔涌', icon: '🔥' }
  ];

  function clamp(value, lo, hi) { return Math.min(hi, Math.max(lo, value)); }
  function roundStep(t) { return Math.round(t / STEP) * STEP; }
  function isWhite(m) { return WHITE.indexOf(((m % 12) + 12) % 12) >= 0; }
  function pitchName(m) { return NAMES[((m % 12) + 12) % 12] + (Math.floor(m / 12) - 1); }
  function degreeOf(m) {
    var pc = ((m % 12) + 12) % 12;
    var idx = WHITE.indexOf(pc);
    var accidental = 0;
    if (idx < 0) { idx = WHITE.indexOf(pc - 1); accidental = 1; }
    return { degree: idx + 1, accidental: accidental, octave: Math.floor(m / 12) - 1 };
  }
  function degreeAbsolute(m) { return Math.floor(m / 12) * 7 + degreeOf(m).degree - 1; }
  function pitchRows() {
    var rows = [];
    for (var m = GRID_HIGH; m >= GRID_LOW; m -= 1) {
      if (!isWhite(m)) continue;
      var d = degreeOf(m);
      rows.push({ midi: m, name: pitchName(m), degree: d.degree, octave: d.octave, label: String(d.degree) });
    }
    return rows;
  }
  /* ---- 标准谱表：以绝对音级（每八度 7 级）为纵坐标，C4 = 35 ---- */
  var CLEFS = {
    treble: { id: 'treble', symbol: '𝄞', name: '高音谱号', top: 45, bottom: 37 },
    bass: { id: 'bass', symbol: '𝄢', name: '低音谱号', top: 33, bottom: 25 }
  };
  var BASS_CLEF_IDS = ['cello', 'timpani', 'contrabass'];

  function clefFor(instrumentId) { return BASS_CLEF_IDS.indexOf(instrumentId) >= 0 ? 'bass' : 'treble'; }

  /* 每件乐器的谱表窗口：乐器音域与写谱网格的交集，再撑开到包含五条线 */
  function staffWindow(instrumentId) {
    var ins = findInstrument(instrumentId) || INSTRUMENTS[0];
    var clef = CLEFS[clefFor(ins.id)];
    var gLo = degreeAbsolute(GRID_LOW);
    var gHi = degreeAbsolute(GRID_HIGH);
    var lo = Math.max(gLo, degreeAbsolute(ins.range[0]));
    var hi = Math.min(gHi, degreeAbsolute(ins.range[1]));
    if (lo > hi) { lo = gLo; hi = gHi; }
    lo = Math.min(lo, clef.bottom);
    hi = Math.max(hi, clef.top);
    return { clef: clef, lo: lo, hi: hi, steps: hi - lo };
  }

  /* 该乐器谱表上可点写的白键，从上到下 */
  function staffRows(instrumentId) {
    var win = staffWindow(instrumentId);
    var rows = [];
    for (var m = GRID_HIGH; m >= GRID_LOW; m -= 1) {
      if (!isWhite(m)) continue;
      var deg = degreeAbsolute(m);
      if (deg < win.lo || deg > win.hi) continue;
      rows.push({ midi: m, deg: deg, name: pitchName(m) });
    }
    return rows;
  }

  function nearestStaffRow(instrumentId, deg) {
    var rows = staffRows(instrumentId);
    var best = rows[0] || null;
    rows.forEach(function (row) {
      if (Math.abs(row.deg - deg) < Math.abs(best.deg - deg)) best = row;
    });
    return best;
  }

  function findInstrument(id) {
    for (var i = 0; i < INSTRUMENTS.length; i += 1) if (INSTRUMENTS[i].id === id) return INSTRUMENTS[i];
    return null;
  }
  function findEmotion(id) {
    for (var i = 0; i < EMOTIONS.length; i += 1) if (EMOTIONS[i].id === id) return EMOTIONS[i];
    return null;
  }
  function isInstrumentUnlocked(progress, id) {
    var ins = findInstrument(id);
    if (!ins) return false;
    return totalStars(progress) >= (ins.unlock || 0);
  }
  function instrumentList(progress) {
    return INSTRUMENTS.map(function (ins) {
      return { id: ins.id, name: ins.name, family: ins.family, familyName: FAMILY_NAMES[ins.family],
        color: ins.color, desc: ins.desc, unlock: ins.unlock || 0,
        unlocked: isInstrumentUnlocked(progress, ins.id) };
    });
  }
  function nearestDuration(d) {
    var best = DURATIONS[0];
    DURATIONS.forEach(function (x) { if (Math.abs(x - d) < Math.abs(best - d)) best = x; });
    return best;
  }
  function fitRange(ins, m) {
    var lo = ins.range[0], hi = ins.range[1];
    var value = m;
    while (value < lo) value += 12;
    while (value > hi) value -= 12;
    return value;
  }

  var seq = 0;
  function uid(prefix) { seq += 1; return prefix + seq.toString(36); }

  function createTrack(instrument, opts) {
    var ins = findInstrument(instrument) || INSTRUMENTS[0];
    var o = opts || {};
    return {
      id: o.id || uid('trk'),
      instrument: ins.id,
      volume: o.volume == null ? 0.8 : clamp(o.volume, 0, 1),
      pan: clamp(o.pan == null ? 0 : o.pan, -1, 1),
      mute: !!o.mute,
      solo: !!o.solo,
      notes: []
    };
  }

  function createScore(overrides) {
    var base = {
      version: VERSION,
      title: '未命名交响曲',
      emotion: 'lively',
      tempo: 138,
      bars: 8,
      master: 0.8,
      tweaks: { bright: 0, reverb: 0, vibrato: 0 },
      tracks: []
    };
    var o = overrides || {};
    var score = base;
    ['title', 'emotion', 'tempo', 'bars', 'master'].forEach(function (key) {
      if (o[key] != null) score[key] = o[key];
    });
    score.emotion = (findEmotion(score.emotion) || EMOTIONS[0]).id;
    score.tempo = clamp(Math.round(score.tempo), TEMPO_RANGE[0], TEMPO_RANGE[1]);
    score.bars = clamp(Math.round(score.bars), MIN_BARS, MAX_BARS);
    score.tweaks = { bright: 0, reverb: 0, vibrato: 0 };
    if (o.tweaks) {
      ['bright', 'reverb', 'vibrato'].forEach(function (k) {
        score.tweaks[k] = clamp(Number(o.tweaks[k]) || 0, k === 'reverb' ? -0.35 : -1, 1);
      });
    }
    if (Array.isArray(o.tracks)) score.tracks = o.tracks;
    return score;
  }

  function applyEmotion(score, emotionId) {
    var emo = findEmotion(emotionId);
    if (!emo) return null;
    score.emotion = emo.id;
    score.tempo = emo.tempo;
    score.tweaks = { bright: 0, reverb: 0, vibrato: 0 };
    return emo;
  }

  function findTrack(score, trackId) {
    for (var i = 0; i < score.tracks.length; i += 1) if (score.tracks[i].id === trackId) return score.tracks[i];
    return null;
  }

  function addTrack(score, instrumentId) {
    if (score.tracks.length >= MAX_TRACKS) return null;
    var ins = findInstrument(instrumentId) || INSTRUMENTS[0];
    var track = createTrack(ins.id);
    var same = score.tracks.filter(function (t) { return t.instrument === ins.id; }).length;
    track.volume = clamp(0.82 - same * 0.08, 0.4, 0.9);
    score.tracks.push(track);
    return track;
  }

  function removeTrack(score, trackId) {
    var before = score.tracks.length;
    score.tracks = score.tracks.filter(function (t) { return t.id !== trackId; });
    return score.tracks.length < before;
  }

  function sortNotes(track) { track.notes.sort(function (a, b) { return a.t - b.t || a.m - b.m; }); }

  function addNote(score, trackId, note) {
    var track = findTrack(score, trackId);
    if (!track || !note) return null;
    var ins = findInstrument(track.instrument) || INSTRUMENTS[0];
    var span = score.bars * BEATS_PER_BAR;
    var t = roundStep(Number(note.t) || 0);
    if (t < 0 || t > span - STEP) return null;
    var d = nearestDuration(Number(note.d) || 1);
    if (t + d > span) d = nearestDuration(span - t);
    var m = Math.round(Number(note.m));
    if (!(m >= GRID_LOW && m <= GRID_HIGH)) return null;
    m = fitRange(ins, m);
    var entry = {
      t: t, m: m, d: d,
      v: clamp(note.v == null ? 0.78 : Number(note.v), 0.15, 1)
    };
    track.notes = track.notes.filter(function (n) { return Math.abs(n.t - t) > 1e-6; });
    track.notes.push(entry);
    sortNotes(track);
    return entry;
  }

  function removeNote(score, trackId, t) {
    var track = findTrack(score, trackId);
    if (!track) return false;
    var before = track.notes.length;
    track.notes = track.notes.filter(function (n) { return Math.abs(n.t - t) > 1e-6; });
    return track.notes.length < before;
  }

  function setNote(score, trackId, t, patch) {
    var track = findTrack(score, trackId);
    if (!track) return null;
    var target = null;
    track.notes.forEach(function (n) { if (Math.abs(n.t - t) < 1e-6) target = n; });
    if (!target) return null;
    if (patch && patch.d != null) target.d = nearestDuration(patch.d);
    if (patch && patch.v != null) target.v = clamp(Number(patch.v), 0.15, 1);
    if (patch && patch.m != null) target.m = fitRange(findInstrument(track.instrument), Math.round(patch.m));
    var span = score.bars * BEATS_PER_BAR;
    if (target.t + target.d > span) target.d = nearestDuration(span - target.t);
    return target;
  }

  function noteAt(track, t) {
    if (!track) return null;
    for (var i = 0; i < track.notes.length; i += 1) {
      if (Math.abs(track.notes[i].t - t) < 1e-6) return track.notes[i];
    }
    return null;
  }

  function clearTrack(score, trackId) {
    var track = findTrack(score, trackId);
    if (!track) return false;
    track.notes = [];
    return true;
  }

  function totalNotes(score) {
    return score.tracks.reduce(function (sum, t) { return sum + t.notes.length; }, 0);
  }

  function activeTracks(score) {
    var soloed = score.tracks.filter(function (t) { return t.solo; });
    return score.tracks.filter(function (t) {
      if (t.mute) return false;
      return soloed.length === 0 || t.solo;
    });
  }

  function mixPlan(score) {
    var active = activeTracks(score);
    return score.tracks.map(function (track) {
      var audible = active.indexOf(track) >= 0;
      return {
        trackId: track.id,
        gain: audible ? clamp(track.volume, 0, 1) : 0,
        pan: track.pan,
        audible: audible,
        notes: track.notes.length
      };
    });
  }

  function timbre(score, track) {
    var ins = findInstrument(track.instrument) || INSTRUMENTS[0];
    var emo = findEmotion(score.emotion) || EMOTIONS[0];
    var tw = score.tweaks || {};
    var attackScale = emo.id === 'lively' ? 0.6 : emo.id === 'tender' ? 1.25 : 1;
    return {
      instrument: ins,
      attack: Math.max(0.003, ins.attack * attackScale),
      release: Math.max(0.05, ins.release * (emo.gate > 0.9 ? 1.2 : 0.85)),
      cutoff: clamp(ins.cutoff * Math.pow(2, emo.bright + (tw.bright || 0)), 300, 14000),
      q: ins.q,
      vibratoRate: ins.vibrato,
      vibratoDepth: ins.vibDepth * (0.45 + emo.vibrato) * (1 + (tw.vibrato || 0)),
      gain: ins.gain * (0.5 + 0.5 * emo.dynamics),
      reverb: clamp(emo.reverb + (tw.reverb || 0), 0, 0.9),
      gate: emo.gate,
      pluck: !!ins.pluck,
      percussive: !!ins.percussive,
      noise: ins.noise || 0,
      breath: ins.breath || 0,
      harmonics: ins.harmonics
    };
  }

  function beatSeconds(score) {
    return 60 / clamp(score.tempo, TEMPO_RANGE[0], TEMPO_RANGE[1]);
  }

  function timeline(score) {
    var beatSec = beatSeconds(score);
    var events = [];
    activeTracks(score).forEach(function (track) {
      var tim = timbre(score, track);
      track.notes.forEach(function (note) {
        events.push({
          trackId: track.id,
          instrument: track.instrument,
          midi: note.m,
          time: note.t * beatSec,
          dur: Math.max(0.06, note.d * beatSec * tim.gate),
          velocity: note.v,
          gain: tim.gain * track.volume * note.v,
          pan: track.pan,
          timbre: tim
        });
      });
    });
    events.sort(function (a, b) { return a.time - b.time || a.midi - b.midi; });
    return { events: events, beatSec: beatSec, seconds: score.bars * BEATS_PER_BAR * beatSec };
  }

  function tracksWithNotes(score) {
    return score.tracks.filter(function (t) { return t.notes.length > 0; });
  }

  function stats(score) {
    var used = tracksWithNotes(score);
    var instruments = [];
    var families = [];
    used.forEach(function (t) {
      if (instruments.indexOf(t.instrument) < 0) instruments.push(t.instrument);
      var ins = findInstrument(t.instrument);
      if (ins && families.indexOf(ins.family) < 0) families.push(ins.family);
    });
    var last = 0;
    used.forEach(function (t) {
      t.notes.forEach(function (n) { last = Math.max(last, n.t + n.d); });
    });
    return {
      tracks: score.tracks.length,
      tracksWithNotes: used.length,
      notes: totalNotes(score),
      instruments: instruments,
      families: families,
      bars: score.bars,
      lastBeat: last,
      seconds: last * beatSeconds(score),
      totalSeconds: score.bars * BEATS_PER_BAR * beatSeconds(score)
    };
  }

  function createProgress() { return { version: VERSION, done: {} }; }
  function totalStars(progress) {
    var done = (progress && progress.done) || {};
    return Object.keys(done).filter(function (key) { return !!done[key]; }).length;
  }
  function completeTask(progress, taskId) {
    if (!progress.done) progress.done = {};
    if (progress.done[taskId]) return false;
    progress.done[taskId] = true;
    return true;
  }

  function lowVoice(score) {
    var lows = ['cello', 'contrabass', 'timpani'];
    return tracksWithNotes(score).some(function (t) {
      return lows.indexOf(t.instrument) >= 0 && t.notes.length >= 6;
    });
  }

  var TASKS = [
    { id: 'duet', title: '双声部', desc: '两条乐器轨各写 6 个音以上，让旋律有伴',
      check: function (s) { return tracksWithNotes(s).length >= 2 && totalNotes(s) >= 12; } },
    { id: 'bass', title: '低音奠基', desc: '三条轨以上，其中大提琴 / 低音提琴 / 定音鼓写满 6 个音',
      check: function (s) { return tracksWithNotes(s).length >= 3 && lowVoice(s); } },
    { id: 'lively', title: '轻快舞曲', desc: '用「轻快」情感，速度 ≥120，至少 24 个音',
      check: function (s) { return s.emotion === 'lively' && s.tempo >= 120 && totalNotes(s) >= 24; } },
    { id: 'tender', title: '温柔夜曲', desc: '用「温柔」情感，三条轨以上，至少 16 个音',
      check: function (s) { return s.emotion === 'tender' && tracksWithNotes(s).length >= 3 && totalNotes(s) >= 16; } },
    { id: 'grand', title: '壮丽终章', desc: '用「壮丽」情感，四条轨以上、8 小节、至少 32 个音',
      check: function (s) {
        return s.emotion === 'grand' && tracksWithNotes(s).length >= 4 && s.bars >= 8 && totalNotes(s) >= 32;
      } },
    { id: 'symphony', title: '我的交响曲', desc: '五条轨以上、跨三个乐器组、至少 48 个音',
      check: function (s) {
        var st = stats(s);
        return st.tracksWithNotes >= 5 && st.families.length >= 3 && st.notes >= 48;
      } }
  ];

  function taskList(score, progress) {
    var done = (progress && progress.done) || {};
    return TASKS.map(function (task) {
      var ready = false;
      try { ready = !!task.check(score); } catch (err) { ready = false; }
      return { id: task.id, title: task.title, desc: task.desc, done: !!done[task.id], ready: ready };
    });
  }

  function evaluateTasks(score, progress) {
    var gained = [];
    TASKS.forEach(function (task) {
      if (progress.done && progress.done[task.id]) return;
      if (task.check(score)) {
        completeTask(progress, task.id);
        gained.push(task.id);
      }
    });
    return gained;
  }

  function serialize(score) {
    return JSON.stringify({
      version: VERSION,
      title: score.title,
      emotion: score.emotion,
      tempo: score.tempo,
      bars: score.bars,
      master: score.master,
      tweaks: score.tweaks,
      tracks: score.tracks.map(function (t) {
        return {
          instrument: t.instrument, volume: t.volume, pan: t.pan, mute: t.mute, solo: t.solo,
          notes: t.notes.map(function (n) { return [n.t, n.m, n.d, n.v]; })
        };
      })
    });
  }

  function parse(text) {
    var raw;
    try { raw = typeof text === 'string' ? JSON.parse(text) : text; } catch (err) { return null; }
    if (!raw || typeof raw !== 'object' || !Array.isArray(raw.tracks)) return null;
    var score = createScore({
      title: typeof raw.title === 'string' ? raw.title.slice(0, 40) : '未命名交响曲',
      emotion: raw.emotion,
      tempo: Number(raw.tempo) || 120,
      bars: Number(raw.bars) || 8,
      master: Number(raw.master) || 0.8,
      tweaks: raw.tweaks
    });
    raw.tracks.slice(0, MAX_TRACKS).forEach(function (item) {
      if (!item || !findInstrument(item.instrument)) return;
      var track = createTrack(item.instrument, {
        id: 'trk' + (score.tracks.length + 1),
        volume: item.volume, pan: item.pan, mute: item.mute, solo: item.solo
      });
      score.tracks.push(track);
      var list = Array.isArray(item.notes) ? item.notes.slice(0, 400) : [];
      list.forEach(function (n) {
        if (!Array.isArray(n)) return;
        addNote(score, track.id, { t: n[0], m: n[1], d: n[2], v: n[3] });
      });
    });
    return score;
  }

  function midiOf(name) {
    var m = /^([A-G])(#?)(-?\d)$/.exec(String(name).trim());
    if (!m) return null;
    var base = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[m[1]];
    return 12 * (Number(m[3]) + 1) + base + (m[2] ? 1 : 0);
  }

  function lay(track, text, velocity) {
    var ins = findInstrument(track.instrument);
    var beat = 0;
    String(text).trim().split(/\s+/).forEach(function (token) {
      if (!token) return;
      var bits = token.split(':');
      var length = Number(bits[1]) || 1;
      if (bits[0] !== 'r' && bits[0] !== '-') {
        var midi = midiOf(bits[0]);
        if (midi != null) {
          track.notes.push({
            t: beat, m: fitRange(ins, midi), d: nearestDuration(length),
            v: velocity == null ? 0.78 : velocity
          });
        }
      }
      beat += length;
    });
    sortNotes(track);
    return track;
  }

  function demoScore(cfg) {
    var score = createScore({ title: cfg.title, emotion: cfg.emotion, tempo: cfg.tempo, bars: cfg.bars || 8 });
    cfg.tracks.forEach(function (item) {
      var track = addTrack(score, item.instrument);
      if (!track) return;
      track.volume = item.volume == null ? 0.78 : item.volume;
      track.pan = item.pan == null ? 0 : item.pan;
      lay(track, item.line, item.velocity);
    });
    return score;
  }

  var DEMOS = [
    {
      id: 'ode', title: '欢乐颂', hint: '贝多芬 · 弦乐主旋律 + 钢琴和声 + 大提琴低音',
      build: function () {
        return demoScore({
          title: '欢乐颂', emotion: 'lively', tempo: 138, tracks: [
            { instrument: 'violin', volume: 0.82, line: 'E4:1 E4:1 F4:1 G4:1 G4:1 F4:1 E4:1 D4:1 C4:1 C4:1 D4:1 E4:1 E4:1 D4:1 D4:2 E4:1 E4:1 F4:1 G4:1 G4:1 F4:1 E4:1 D4:1 C4:1 C4:1 D4:1 E4:1 D4:1 C4:1 C4:2' },
            { instrument: 'piano', volume: 0.6, line: 'C4:2 E4:2 G3:2 B3:2 C4:2 E4:2 G3:2 B3:2 C4:2 E4:2 G3:2 B3:2 C4:2 E4:2 C4:2 E4:2' },
            { instrument: 'cello', volume: 0.78, line: 'C3:4 G3:4 C3:4 G3:4 C3:4 G3:4 C3:4 C3:4' }
          ]
        });
      }
    },
    {
      id: 'star', title: '小星星', hint: '法国民谣 · 长笛主奏、钢琴分解和弦、大提琴铺底',
      build: function () {
        return demoScore({
          title: '小星星', emotion: 'tender', tempo: 76, tracks: [
            { instrument: 'flute', volume: 0.85, line: 'C4:1 C4:1 G4:1 G4:1 A4:1 A4:1 G4:2 F4:1 F4:1 E4:1 E4:1 D4:1 D4:1 C4:2 G4:1 G4:1 F4:1 F4:1 E4:1 E4:1 D4:2 G4:1 G4:1 F4:1 F4:1 E4:1 E4:1 D4:2' },
            { instrument: 'piano', volume: 0.55, line: 'C3:2 G3:2 F3:2 C4:2 C3:2 G3:2 G3:2 B3:2 C3:2 G3:2 F3:2 C4:2 C3:2 G3:2 G3:2 C5:2' },
            { instrument: 'cello', volume: 0.7, line: 'C3:4 F3:4 C3:4 G3:4 C3:4 F3:4 C3:4 C3:4' }
          ]
        });
      }
    },
    {
      id: 'canon', title: '卡农片段', hint: '帕赫贝尔 · 三声部层叠，壮丽而秩序井然',
      build: function () {
        return demoScore({
          title: '卡农片段', emotion: 'grand', tempo: 96, tracks: [
            { instrument: 'violin', volume: 0.86, line: 'G4:2 E4:1 G4:1 C5:2 B4:1 A4:1 G4:2 E4:1 G4:1 C5:2 E5:1 D5:1 C5:2 G4:1 E4:1 F4:2 G4:1 A4:1 B4:2 G4:1 B4:1 C5:4' },
            { instrument: 'harp', volume: 0.5, line: 'C4:2 E4:2 G3:2 B3:2 A3:2 C4:2 E3:2 G3:2 F3:2 A3:2 C4:2 E4:2 F3:2 A3:2 G3:2 B3:2' },
            { instrument: 'cello', volume: 0.8, line: 'C3:4 G3:4 A3:4 E3:4 F3:4 C3:4 F3:4 G3:4' }
          ]
        });
      }
    },
    {
      id: 'lullaby', title: '摇篮曲', hint: '圆号与钢琴的温柔对话，适合「温柔」情感',
      build: function () {
        return demoScore({
          title: '摇篮曲', emotion: 'tender', tempo: 66, tracks: [
            { instrument: 'horn', volume: 0.8, line: 'F3:2 A3:2 C4:2 A3:2 F3:2 G3:2 A3:4 F3:2 A3:2 C4:2 D4:2 C4:2 A3:2 A3:4' },
            { instrument: 'piano', volume: 0.5, line: 'F3:2 C4:2 D3:2 A3:2 A#3:2 D4:2 C3:2 G3:2 F3:2 C4:2 D3:2 A3:2 A#3:2 D4:2 C3:2 G3:2' },
            { instrument: 'cello', volume: 0.62, line: 'F3:4 D3:4 A#3:4 C3:4 F3:4 D3:4 A#3:4 C3:4' }
          ]
        });
      }
    },
    {
      id: 'march', title: '凯旋进行曲', hint: '小号吹响主题，圆号和声，大提琴与钢琴稳住脚步',
      build: function () {
        return demoScore({
          title: '凯旋进行曲', emotion: 'grand', tempo: 104, tracks: [
            { instrument: 'trumpet', volume: 0.82, line: 'C4:1 C4:1 G3:1 C4:1 E4:2 D4:2 C4:1 E4:1 G4:2 E4:1 D4:1 C4:2 G3:1 C4:1 E4:1 G4:1 C4:2 G3:2 E4:1 D4:1 C4:1 B3:1 C4:4' },
            { instrument: 'horn', volume: 0.62, line: 'E4:4 D4:4 C4:4 G3:4 E4:4 D4:4 E4:4 C4:4' },
            { instrument: 'piano', volume: 0.55, line: 'C4:2 E4:2 G3:2 B3:2 F3:2 A3:2 C3:2 E3:2 C4:2 E4:2 G3:2 B3:2 F3:2 G3:2 C4:2 E4:2' },
            { instrument: 'cello', volume: 0.8, line: 'C3:2 G3:2 C3:2 G3:2 A3:2 E3:2 F3:2 G3:2 C3:2 G3:2 C3:2 G3:2 F3:2 G3:2 C3:4' }
          ]
        });
      }
    },
    {
      id: 'mist', title: '雾中回响', hint: '单簧管与竖琴的朦胧色彩，试试「神秘」情感',
      build: function () {
        return demoScore({
          title: '雾中回响', emotion: 'mysterious', tempo: 88, tracks: [
            { instrument: 'clarinet', volume: 0.8, line: 'A3:2 C4:2 E4:2 D4:2 C4:2 A3:2 G3:4 A3:2 C4:2 E4:2 G4:2 F4:2 E4:2 D4:4' },
            { instrument: 'harp', volume: 0.6, line: 'A3:1 E4:1 C4:1 E4:1 F3:1 C4:1 A3:1 C4:1 A3:1 E4:1 C4:1 E4:1 D4:1 A3:1 F3:1 A3:1' },
            { instrument: 'cello', volume: 0.66, line: 'A3:4 F3:4 C3:4 G3:4 A3:4 F3:4 D3:4 E3:4' }
          ]
        });
      }
    }
  ];

  function demoList() {
    return DEMOS.map(function (d) {
      var score = d.build();
      var st = stats(score);
      return { id: d.id, title: d.title, hint: d.hint, emotion: d.emotion, tempo: score.tempo,
        tracks: st.tracksWithNotes, notes: st.notes, seconds: Math.round(st.seconds) };
    });
  }

  return {
    VERSION: VERSION,
    BEATS_PER_BAR: BEATS_PER_BAR,
    STEP: STEP,
    MAX_TRACKS: MAX_TRACKS,
    MIN_BARS: MIN_BARS,
    MAX_BARS: MAX_BARS,
    TEMPO_RANGE: TEMPO_RANGE,
    GRID_LOW: GRID_LOW,
    GRID_HIGH: GRID_HIGH,
    DURATIONS: DURATIONS,
    DURATION_NAMES: DURATION_NAMES,
    INSTRUMENTS: INSTRUMENTS,
    EMOTIONS: EMOTIONS,
    PITCH_ROWS: pitchRows(),
    CLEFS: CLEFS,
    clefFor: clefFor,
    staffWindow: staffWindow,
    staffRows: staffRows,
    nearestStaffRow: nearestStaffRow,
    clamp: clamp,
    isWhite: isWhite,
    pitchName: pitchName,
    degreeOf: degreeOf,
    degreeAbsolute: degreeAbsolute,
    pitchRows: pitchRows,
    findInstrument: findInstrument,
    findEmotion: findEmotion,
    instrumentList: instrumentList,
    isInstrumentUnlocked: isInstrumentUnlocked,
    nearestDuration: nearestDuration,
    fitRange: fitRange,
    createTrack: createTrack,
    createScore: createScore,
    applyEmotion: applyEmotion,
    findTrack: findTrack,
    addTrack: addTrack,
    removeTrack: removeTrack,
    addNote: addNote,
    removeNote: removeNote,
    setNote: setNote,
    noteAt: noteAt,
    clearTrack: clearTrack,
    totalNotes: totalNotes,
    activeTracks: activeTracks,
    mixPlan: mixPlan,
    timbre: timbre,
    beatSeconds: beatSeconds,
    timeline: timeline,
    stats: stats,
    tracksWithNotes: tracksWithNotes,
    createProgress: createProgress,
    totalStars: totalStars,
    completeTask: completeTask,
    TASKS: TASKS,
    taskList: taskList,
    evaluateTasks: evaluateTasks,
    serialize: serialize,
    parse: parse,
    midiOf: midiOf,
    lay: lay,
    demoScore: demoScore,
    DEMOS: DEMOS,
    demoList: demoList
  };
});
