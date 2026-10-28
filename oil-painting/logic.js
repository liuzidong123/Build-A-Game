/* 油画大师 · 对局逻辑
 * 纯数据模型：填色记录、贴合度评分、星级、道具解锁、撤销与存档。
 * 不碰 DOM，便于 Node 单测。
 */
(function (root) {
  'use strict';

  var data = root.OilArt || (typeof require === 'function' ? require('./artworks.js') : null);
  if (!data) throw new Error('油画大师：缺少 artworks.js');

  var ARTWORKS = data.ARTWORKS;
  var PROPS = data.PROPS;
  var FREE_LEVELS = 3;      // 前 3 幅直接开放
  var FREE_STROKES = 20;    // 每关可撤销步数（无限撤销道具解锁后不限）

  /* ---------------------------------------------------------- 颜色工具 */
  function hexToRgb(hex) {
    var text = String(hex || '').replace('#', '');
    if (text.length === 3) {
      text = text[0] + text[0] + text[1] + text[1] + text[2] + text[2];
    }
    if (!/^[0-9a-fA-F]{6}$/.test(text)) return [0, 0, 0];
    return [
      parseInt(text.slice(0, 2), 16),
      parseInt(text.slice(2, 4), 16),
      parseInt(text.slice(4, 6), 16)
    ];
  }

  function rgbToHex(rgb) {
    var out = '#';
    for (var i = 0; i < 3; i += 1) {
      var v = Math.max(0, Math.min(255, Math.round(rgb[i])));
      out += (v < 16 ? '0' : '') + v.toString(16);
    }
    return out;
  }

  function rgbToHsl(rgb) {
    var r = rgb[0] / 255;
    var g = rgb[1] / 255;
    var b = rgb[2] / 255;
    var max = Math.max(r, g, b);
    var min = Math.min(r, g, b);
    var l = (max + min) / 2;
    var d = max - min;
    var h = 0;
    var s = 0;
    if (d) {
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
      else if (max === g) h = ((b - r) / d + 2) / 6;
      else h = ((r - g) / d + 4) / 6;
    }
    return [h * 360, s * 100, l * 100];
  }

  /* 色相环最短距离，0..180 */
  function hueGap(a, b) {
    var d = Math.abs(a - b) % 360;
    return d > 180 ? 360 - d : d;
  }

  /* 颜色接近度 0..1：RGB 占七成，色相占三成（同色相不同明度也算像） */
  function similarity(hexA, hexB) {
    var a = hexToRgb(hexA);
    var b = hexToRgb(hexB);
    var dr = a[0] - b[0];
    var dg = a[1] - b[1];
    var db = a[2] - b[2];
    var rgbGap = Math.sqrt(dr * dr + dg * dg + db * db) / 441.67;
    var ha = rgbToHsl(a);
    var hb = rgbToHsl(b);
    var hue = hueGap(ha[0], hb[0]) / 180;
    var light = Math.abs(ha[2] - hb[2]) / 100;
    var colorGap = hue * 0.7 + light * 0.3;
    var gap = rgbGap * 0.7 + colorGap * 0.3;
    return Math.max(0, 1 - gap);
  }

  /* ---------------------------------------------------------- 关卡清单 */
  function regionList(art) {
    return art.regions || art.shapes;
  }

  function regionIds(art) {
    return regionList(art).map(function (item) { return item[0]; });
  }

  function refColor(art, shape) {
    return art.palette[shape[2]] || art.palette[0];
  }

  function findArt(id) {
    for (var i = 0; i < ARTWORKS.length; i += 1) {
      if (ARTWORKS[i].id === id) return ARTWORKS[i];
    }
    return null;
  }

  /* 第几关：0 基下标 */
  function levelIndex(id) {
    for (var i = 0; i < ARTWORKS.length; i += 1) {
      if (ARTWORKS[i].id === id) return i;
    }
    return -1;
  }

  /* ---------------------------------------------------------- 进度存档 */
  function createProgress() {
    return { best: {}, fit: {}, props: [] };
  }

  function totalStars(progress) {
    var sum = 0;
    var best = progress && progress.best;
    if (!best) return 0;
    Object.keys(best).forEach(function (id) {
      sum += Math.max(0, Math.min(3, best[id] | 0));
    });
    return sum;
  }

  function starsForFit(fit, filledAll) {
    if (!filledAll) return 0;
    if (fit >= 0.82) return 3;
    if (fit >= 0.55) return 2;
    return 1;
  }

  /* 关卡是否开放：前 FREE_LEVELS 关直接开，其余要求上一关已得星 */
  function levelOpen(progress, index) {
    if (index < FREE_LEVELS) return true;
    var prev = ARTWORKS[index - 1];
    return !!(progress && progress.best && (progress.best[prev.id] | 0) > 0);
  }

  function unlockedProps(progress) {
    var stars = totalStars(progress);
    return PROPS.filter(function (prop) { return stars >= prop.stars; })
      .map(function (prop) { return prop.id; });
  }

  function nextProp(progress) {
    var stars = totalStars(progress);
    for (var i = 0; i < PROPS.length; i += 1) {
      if (stars < PROPS[i].stars) {
        return { prop: PROPS[i], need: PROPS[i].stars - stars };
      }
    }
    return null;
  }

  function hasProp(progress, id) {
    return unlockedProps(progress).indexOf(id) !== -1;
  }

  /* ---------------------------------------------------------- 画布会话 */
  function createSession(art) {
    return {
      art: art,
      fills: {},
      ops: [],
      strokes: [],
      glaze: false,
      dirty: true
    };
  }

  function regionCount(art) {
    return regionList(art).length;
  }

  function fillRatio(session) {
    var total = regionCount(session.art);
    if (!total) return 0;
    return Object.keys(session.fills).length / total;
  }

  function isFilled(session) {
    return Object.keys(session.fills).length >= regionCount(session.art);
  }

  /* 逐区贴合度，返回 { fit, filled, total, perRegion } */
  function evaluate(session) {
    var art = session.art;
    var list = regionList(art);
    var sum = 0;
    var perRegion = {};
    for (var i = 0; i < list.length; i += 1) {
      var id = list[i][0];
      var want = art.palette[list[i][2]];
      var got = session.fills[id];
      var score = got ? similarity(got, want) : 0;
      perRegion[id] = score;
      sum += score;
    }
    return {
      fit: list.length ? sum / list.length : 0,
      filled: Object.keys(session.fills).length,
      total: list.length,
      perRegion: perRegion
    };
  }

  function stars(session) {
    var result = evaluate(session);
    return starsForFit(result.fit, result.filled >= result.total);
  }

  /* 填色：返回是否产生了变化 */
  function paint(session, regionId, color) {
    if (!regionId || !color) return false;
    var exists = false;
    for (var i = 0; i < regionList(session.art).length; i += 1) {
      if (regionList(session.art)[i][0] === regionId) { exists = true; break; }
    }
    if (!exists) return false;
    var prev = session.fills[regionId];
    if (prev === color) return false;
    if (prev == null) delete session.fills[regionId];
    session.ops.push({ type: 'paint', regionId: regionId, prev: prev == null ? null : prev });
    session.fills[regionId] = color;
    session.dirty = true;
    return true;
  }

  function addStroke(session, stroke) {
    session.strokes.push(stroke);
    session.ops.push({ type: 'stroke' });
    session.dirty = true;
  }

  function canUndo(session, progress) {
    if (!session.ops.length) return false;
    if (hasProp(progress, 'undo')) return true;
    return session.ops.length <= FREE_STROKES;
  }

  function undo(session) {
    var op = session.ops.pop();
    if (!op) return false;
    if (op.type === 'paint') {
      if (op.prev == null) delete session.fills[op.regionId];
      else session.fills[op.regionId] = op.prev;
    } else if (op.type === 'stroke') {
      session.strokes.pop();
    }
    session.dirty = true;
    return true;
  }

  function resetSession(session) {
    session.fills = {};
    session.ops = [];
    session.strokes = [];
    session.glaze = false;
    session.dirty = true;
  }

  /* 自动混色：按参考色把剩余分区补齐 */
  function autoFill(session) {
    var list = regionList(session.art);
    var count = 0;
    for (var i = 0; i < list.length; i += 1) {
      var id = list[i][0];
      if (session.fills[id]) continue;
      if (paint(session, id, session.art.palette[list[i][2]])) count += 1;
    }
    return count;
  }

  /* 玩家配色是否与参考一致（用于"忠实还原"徽记） */
  function faithful(session) {
    var result = evaluate(session);
    return result.filled >= result.total && result.fit >= 0.9;
  }

  /* 提交结果，写回进度；返回本次解锁信息 */
  function commit(progress, session) {
    var art = session.art;
    var result = evaluate(session);
    var gained = starsForFit(result.fit, result.filled >= result.total);
    var pct = Math.round(result.fit * 100);
    var before = totalStars(progress);
    var prevBest = (progress.best[art.id] | 0);

    if (gained > prevBest) progress.best[art.id] = gained;
    if (pct > (progress.fit[art.id] | 0)) progress.fit[art.id] = pct;

    var after = totalStars(progress);
    var newly = PROPS.filter(function (prop) {
      return prop.stars > before && prop.stars <= after;
    }).map(function (prop) { return prop.id; });

    return {
      stars: gained,
      best: progress.best[art.id] | 0,
      fit: pct,
      gainedStars: gained > prevBest ? gained - prevBest : 0,
      totalStars: after,
      unlocked: newly
    };
  }

  /* ---------------------------------------------------------- 序列化 */
  function serializeProgress(progress) {
    return {
      best: Object.assign({}, progress.best || {}),
      fit: Object.assign({}, progress.fit || {})
    };
  }

  function parseProgress(raw) {
    var progress = createProgress();
    if (!raw || typeof raw !== 'object') return progress;
    if (raw.best && typeof raw.best === 'object') {
      Object.keys(raw.best).forEach(function (id) {
        var value = raw.best[id] | 0;
        if (value > 0 && value <= 3 && findArt(id)) progress.best[id] = value;
      });
    }
    if (raw.fit && typeof raw.fit === 'object') {
      Object.keys(raw.fit).forEach(function (id) {
        var value = raw.fit[id] | 0;
        if (value > 0 && findArt(id)) progress.fit[id] = Math.min(100, value);
      });
    }
    return progress;
  }

  root.OilLogic = {
    FREE_LEVELS: FREE_LEVELS,
    FREE_STROKES: FREE_STROKES,
    PROPS: PROPS,
    ARTWORKS: ARTWORKS,
    hexToRgb: hexToRgb,
    rgbToHex: rgbToHex,
    rgbToHsl: rgbToHsl,
    similarity: similarity,
    findArt: findArt,
    levelIndex: levelIndex,
    regionList: regionList,
    regionIds: regionIds,
    refColor: refColor,
    createProgress: createProgress,
    totalStars: totalStars,
    starsForFit: starsForFit,
    levelOpen: levelOpen,
    unlockedProps: unlockedProps,
    nextProp: nextProp,
    hasProp: hasProp,
    createSession: createSession,
    regionCount: regionCount,
    fillRatio: fillRatio,
    isFilled: isFilled,
    evaluate: evaluate,
    stars: stars,
    paint: paint,
    addStroke: addStroke,
    canUndo: canUndo,
    undo: undo,
    resetSession: resetSession,
    autoFill: autoFill,
    faithful: faithful,
    commit: commit,
    serializeProgress: serializeProgress,
    parseProgress: parseProgress
  };

  if (typeof module === 'object' && module.exports) module.exports = root.OilLogic;
})(typeof window !== 'undefined' ? window : globalThis);
