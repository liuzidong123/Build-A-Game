/*
 * 青蛙过河打字游戏 · 规则内核
 * 纯逻辑、无 DOM、可确定性重放：node 里可直接 require 做回归测试。
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FrogLogic = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var DIFFICULTIES = {
    easy: {
      key: 'easy', label: '初级', hint: '左手 Home row，慢慢来',
      rows: 8, choices: 2, keyset: 'asdfjkl', time: 55, penalty: 1,
      coinRate: 0.24, itemRate: 0.1, spaceRate: 0.1
    },
    normal: {
      key: 'normal', label: '中级', hint: '全字母混合，节奏加快',
      rows: 12, choices: 2, keyset: 'asdfghjklqwertyuiop', time: 50, penalty: 1.5,
      coinRate: 0.2, itemRate: 0.1, spaceRate: 0.12
    },
    hard: {
      key: 'hard', label: '高级', hint: '三选一荷叶，容错更低',
      rows: 16, choices: 3, keyset: 'abcdefghijklmnopqrstuvwxyz', time: 45, penalty: 2,
      coinRate: 0.18, itemRate: 0.12, spaceRate: 0.14
    }
  };

  var ITEMS = {
    clock: { key: 'clock', icon: '⏱', title: '时间沙漏', copy: '剩余时间 +5 秒' },
    shield: { key: 'shield', icon: '🛡', title: '荷叶护盾', copy: '挡下一次按错的惩罚' },
    slow: { key: 'slow', icon: '❄', title: '缓流之息', copy: '8 秒内时间流逝减速' }
  };

  var ACHIEVEMENTS = {
    first_jump: { title: '初出茅庐', copy: '完成第一次跳跃' },
    combo_15: { title: '蜻蜓点水', copy: '单局连击达到 15' },
    coin_10: { title: '满袋金币', copy: '单局收集 10 枚金币' },
    clear_1: { title: '成功渡河', copy: '首次抵达对岸' },
    perfect: { title: '滴水不漏', copy: '零失误通过一关' },
    speed_60: { title: '风驰电掣', copy: '60 秒内通过一关' },
    score_2000: { title: '高分蛙王', copy: '单局得分达到 2000' }
  };

  var ITEM_KEYS = Object.keys(ITEMS);
  var MAX_LIVES = 3;
  var MAX_ROWS = 24;
  var DROWN_TIME = 12;

  /* ------------------------------------------------------------ 随机数 */
  function rand(state) {
    var t = (state.seed = (state.seed + 0x6D2B79F5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /* 从剩余槽位里取一个，保证金币/道具/SPACE 不落在同一片荷叶上 */
  function takeSlot(state, slots) {
    if (!slots.length) return -1;
    var at = (rand(state) * slots.length) | 0;
    return slots.splice(at, 1)[0];
  }

  function shuffleTake(state, source, count) {
    var pool = source.split('');
    var out = [];
    while (out.length < count && pool.length) {
      var at = (rand(state) * pool.length) | 0;
      out.push(pool.splice(at, 1)[0]);
    }
    return out;
  }

  /* ------------------------------------------------------------ 关卡生成 */
  function buildLanes(state) {
    var lanes = [];
    for (var r = 0; r < state.rows; r += 1) {
      var keys = shuffleTake(state, state.keyset, state.choices);
      var row = keys.map(function (key) {
        return { key: key, type: 'leaf', item: null, taken: false };
      });
      var slots = row.map(function (_, i) { return i; });

      if (slots.length && rand(state) < state.rates.coin) {
        var coinAt = takeSlot(state, slots);
        row[coinAt].type = 'coin';
      }
      if (slots.length && rand(state) < state.rates.item) {
        var itemAt = takeSlot(state, slots);
        row[itemAt].type = 'item';
        row[itemAt].item = ITEM_KEYS[(rand(state) * ITEM_KEYS.length) | 0];
      }
      if (slots.length && rand(state) < state.rates.space) {
        var spaceAt = takeSlot(state, slots);
        row[spaceAt].type = 'space';
        row[spaceAt].key = ' ';
        row[spaceAt].item = null;
      }
      lanes.push(row);
    }
    return lanes;
  }

  function createGame(options) {
    var opts = options || {};
    var key = DIFFICULTIES[opts.difficulty] ? opts.difficulty : 'normal';
    var conf = DIFFICULTIES[key];
    var state = {
      status: 'idle',
      difficulty: key,
      level: 1,
      rows: conf.rows,
      choices: conf.choices,
      keyset: conf.keyset,
      timeLimit: conf.time,
      penalty: conf.penalty,
      rates: { coin: conf.coinRate, item: conf.itemRate, space: conf.spaceRate },

      timeLeft: conf.time,
      row: 0,
      lanes: [],
      laneIndex: 0,

      score: 0,
      coins: 0,
      combo: 0,
      bestCombo: 0,
      hits: 0,
      misses: 0,
      walks: 0,

      lives: MAX_LIVES,
      shield: 0,
      slow: 0,
      boost: 0,

      spent: 0,
      stageSpent: 0,
      stageMisses: 0,

      seed: (opts.seed == null ? 20261024 : opts.seed) >>> 0,
      achievements: [],
      events: [],
      finishReason: ''
    };
    state.lanes = buildLanes(state);
    return state;
  }

  function start(state) {
    state.status = 'playing';
    state.events.push({ type: 'start' });
    return state;
  }

  function nextLevel(state) {
    state.level += 1;
    state.rows = Math.min(MAX_ROWS, state.rows + 2);
    state.timeLimit = Math.min(70, state.timeLimit + 2);
    state.timeLeft = state.timeLimit;
    state.row = 0;
    state.laneIndex = 0;
    state.stageMisses = 0;
    state.stageSpent = 0;
    state.slow = 0;
    state.boost = 0;
    state.shield = 0;
    state.lives = Math.min(MAX_LIVES, state.lives + 1);
    state.status = 'playing';
    state.lanes = buildLanes(state);
    state.events.push({ type: 'level', level: state.level });
    return state;
  }

  /* ------------------------------------------------------------ 查询 */
  function activeRow(state) {
    return state.lanes[state.row] || [];
  }

  function activeLane(state) {
    return activeRow(state)[state.laneIndex] || null;
  }

  function previewRows(state, count) {
    var out = [];
    for (var i = 0; i < (count || 3); i += 1) {
      out.push(state.lanes[state.row + i] || null);
    }
    return out;
  }

  function multiplier(state) {
    return Math.min(2, 1 + state.combo * 0.05);
  }

  function progress(state) {
    return state.rows ? Math.min(1, state.row / state.rows) : 0;
  }

  function accuracy(state) {
    var total = state.hits + state.misses;
    return total ? state.hits / total : 1;
  }

  function unlock(state, id) {
    if (!ACHIEVEMENTS[id] || state.achievements.indexOf(id) !== -1) return false;
    state.achievements.push(id);
    state.events.push({ type: 'achievement', id: id });
    return true;
  }

  function checkAchievements(state) {
    unlock(state, 'first_jump');
    if (state.bestCombo >= 15) unlock(state, 'combo_15');
    if (state.coins >= 10) unlock(state, 'coin_10');
    if (state.score >= 2000) unlock(state, 'score_2000');
  }

  /* ------------------------------------------------------------ 输入 */
  function normalizeKey(key) {
    if (key == null) return '';
    var raw = String(key);
    if (raw === ' ' || raw === 'Space' || raw === 'Spacebar' || raw === 'space') return ' ';
    if (raw.length !== 1) return '';
    return raw.toLowerCase();
  }

  function selectLane(state, dir) {
    var row = activeRow(state);
    if (!row.length) return null;
    state.laneIndex = (state.laneIndex + dir + row.length) % row.length;
    return row[state.laneIndex];
  }

  function applyItem(state, leaf) {
    var item = ITEMS[leaf.item];
    if (!item) return null;
    if (item.key === 'clock') state.timeLeft = Math.min(state.timeLimit + 15, state.timeLeft + 5);
    else if (item.key === 'shield') state.shield = Math.min(2, state.shield + 1);
    else if (item.key === 'slow') state.slow = 8;
    return item;
  }

  function jump(state, index, byWalk) {
    var row = activeRow(state);
    var leaf = row[index];
    if (!leaf || leaf.taken) return { ok: false, kind: 'ignored' };

    leaf.taken = true;
    var isSpace = leaf.type === 'space';
    var dest = Math.min(state.rows, state.row + (isSpace ? 2 : 1));

    var gained = 0;
    if (!byWalk) {
      state.hits += 1;
      state.combo += 1;
      if (state.combo > state.bestCombo) state.bestCombo = state.combo;
      var base = 10 * (isSpace ? 3 : 1);
      gained = Math.round(base * multiplier(state));
      if (state.combo % 5 === 0) gained += 20;
    } else {
      state.walks += 1;
      state.combo = 0;
      gained = -10;
      state.timeLeft -= 2;
    }

    var extras = [];
    if (leaf.type === 'coin') {
      state.coins += 1;
      gained += 50;
      extras.push({ type: 'coin' });
    }
    if (leaf.type === 'item') {
      var picked = applyItem(state, leaf);
      if (picked) extras.push({ type: 'item', item: picked.key });
    }

    state.score = Math.max(0, state.score + gained);
    var fromRow = state.row;
    state.row = dest;
    state.laneIndex = 0;
    state.boost = isSpace ? 0.6 : 0;

    state.events.push({
      type: 'jump',
      kind: leaf.type,
      from: fromRow,
      to: dest,
      lane: index,
      gained: gained,
      walk: !!byWalk
    });
    extras.forEach(function (ev) { state.events.push(ev); });

    if (state.timeLeft <= 0) return drown(state);
    if (state.row >= state.rows) return finishStage(state);

    checkAchievements(state);
    return {
      ok: true,
      kind: byWalk ? 'walk' : 'jump',
      gained: gained,
      leaf: leaf,
      dest: dest
    };
  }

  function drown(state) {
    state.lives -= 1;
    state.combo = 0;
    state.events.push({ type: 'drown', lives: state.lives });
    if (state.lives <= 0) {
      state.lives = 0;
      state.status = 'lost';
      state.finishReason = 'timeout';
      state.events.push({ type: 'lose' });
      return { ok: false, kind: 'lost' };
    }
    state.timeLeft = Math.min(DROWN_TIME, state.timeLimit);
    return { ok: false, kind: 'drown', lives: state.lives, refill: state.timeLeft };
  }

  function finishStage(state) {
    var bonus = Math.round(state.timeLeft * 4);
    if (state.stageMisses === 0) bonus += 200;
    state.score += bonus;
    state.status = 'won';
    state.finishReason = 'clear';
    state.combo = 0;
    unlock(state, 'clear_1');
    if (state.stageMisses === 0) unlock(state, 'perfect');
    if (state.stageSpent <= 60) unlock(state, 'speed_60');
    checkAchievements(state);
    state.events.push({ type: 'win', bonus: bonus });
    return { ok: true, kind: 'win', bonus: bonus };
  }

  function miss(state, key) {
    state.misses += 1;
    state.stageMisses += 1;
    state.combo = 0;
    state.events.push({ type: 'miss', key: key || '' });
    if (state.shield > 0) {
      state.shield -= 1;
      state.events.push({ type: 'guard' });
      return { ok: false, kind: 'guarded' };
    }
    state.timeLeft -= state.penalty;
    if (state.timeLeft <= 0) {
      state.timeLeft = 0;
      return drown(state);
    }
    return { ok: false, kind: 'miss', penalty: state.penalty };
  }

  function press(state, key) {
    if (state.status !== 'playing') return { ok: false, kind: 'ignored' };
    var ch = normalizeKey(key);
    if (!ch) return { ok: false, kind: 'ignored' };

    var row = activeRow(state);
    for (var i = 0; i < row.length; i += 1) {
      if (row[i].key === ch && !row[i].taken) return jump(state, i, false);
    }
    return miss(state, ch);
  }

  /* 方向键前进：能走，但不算连击、还要扣时间，鼓励用键盘字母 */
  function walkUp(state) {
    if (state.status !== 'playing') return { ok: false, kind: 'ignored' };
    if (!activeRow(state).length) return { ok: false, kind: 'ignored' };
    return jump(state, state.laneIndex, true);
  }

  function tick(state, dt) {
    if (state.status !== 'playing') return { kind: 'idle' };
    var step = Math.max(0, Math.min(dt, 0.5));
    var rate = state.slow > 0 ? 0.6 : 1;
    if (state.slow > 0) state.slow = Math.max(0, state.slow - step);
    if (state.boost > 0) state.boost = Math.max(0, state.boost - step);
    state.timeLeft -= step * rate;
    state.spent += step;
    state.stageSpent += step;
    if (state.timeLeft <= 0) {
      state.timeLeft = 0;
      return drown(state);
    }
    return { kind: 'tick' };
  }

  function pause(state) {
    if (state.status !== 'playing') return false;
    state.status = 'paused';
    return true;
  }

  function resume(state) {
    if (state.status !== 'paused') return false;
    state.status = 'playing';
    return true;
  }

  function drainEvents(state) {
    var out = state.events.slice();
    state.events.length = 0;
    return out;
  }

  return {
    DIFFICULTIES: DIFFICULTIES,
    ITEMS: ITEMS,
    ACHIEVEMENTS: ACHIEVEMENTS,
    MAX_LIVES: MAX_LIVES,
    DROWN_TIME: DROWN_TIME,
    createGame: createGame,
    start: start,
    nextLevel: nextLevel,
    press: press,
    walkUp: walkUp,
    selectLane: selectLane,
    tick: tick,
    pause: pause,
    resume: resume,
    activeRow: activeRow,
    activeLane: activeLane,
    previewRows: previewRows,
    multiplier: multiplier,
    progress: progress,
    accuracy: accuracy,
    drainEvents: drainEvents,
    normalizeKey: normalizeKey
  };
});
