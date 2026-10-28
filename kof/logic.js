/*
 * 拳皇 · 对战规则内核（无 DOM，可直接 Node require 回归）
 * 状态编号沿用原有课程代码：0 idle / 1 前进 / 2 后退 / 3 跳跃 / 4 攻击 / 5 受击 / 6 倒地
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.KofLogic = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var CONFIG = {
    width: 1280,
    height: 720,
    groundY: 450,        // 脚底接地高度
    wall: 64,            // 左右边界
    gravity: 2600,
    jumpVy: -1080,
    walkSpeed: 340,
    backSpeed: 260,
    bodyWidth: 96,       // 受击框宽
    bodyHeight: 200,     // 受击框高
    roundTime: 60,
    roundsToWin: 2,
    roundEndDelay: 2.4
  };

  var ATTACKS = {
    light: { startup: 0.09, active: 0.09, recovery: 0.20, damage: 7, reach: 118, push: 26, stun: 0.30, name: '轻拳' },
    heavy: { startup: 0.16, active: 0.10, recovery: 0.34, damage: 13, reach: 142, push: 46, stun: 0.42, name: '重腿' }
  };

  var AI_LEVELS = {
    easy: { think: 0.26, attack: 0.42, block: 0.22, jump: 0.05, gap: 150 },
    normal: { think: 0.17, attack: 0.62, block: 0.40, jump: 0.10, gap: 132 },
    hard: { think: 0.11, attack: 0.82, block: 0.62, jump: 0.18, gap: 120 }
  };

  /* -------------------------------------------------------------- 工具 */
  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function emptyInput() {
    return { left: false, right: false, up: false, light: false, heavy: false, block: false };
  }

  function makeFighter(id, x, facing) {
    return {
      id: id,
      x: x,
      y: CONFIG.groundY,
      vx: 0,
      vy: 0,
      facing: facing,
      onGround: true,
      hp: 100,
      maxHp: 100,
      state: 'idle',
      stateNo: 0,
      stateTime: 0,
      attack: null,
      hasHit: false,
      stun: 0,
      blocking: false,
      combo: 0,
      comboTimer: 0,
      damage: 0,
      hits: 0,
      blockCount: 0,
      lastInput: emptyInput(),
      ai: { timer: 0, intent: 'approach', holdBlock: 0, holdAttack: 0 }
    };
  }

  /* ------------------------------------------------------------ 生命周期 */
  function createMatch(options) {
    var opts = options || {};
    var match = {
      round: 1,
      wins: [0, 0],
      timer: Number(opts.roundTime) > 0 ? Number(opts.roundTime) : CONFIG.roundTime,
      roundTime: Number(opts.roundTime) > 0 ? Number(opts.roundTime) : CONFIG.roundTime,
      roundsToWin: Number(opts.roundsToWin) > 0 ? Number(opts.roundsToWin) : CONFIG.roundsToWin,
      phase: 'fight',
      phaseTime: 0,
      roundWinner: -1,
      matchWinner: -1,
      events: [],
      rng: mulberry32((Number(opts.seed) || 20220420) >>> 0),
      fighters: [
        makeFighter(0, CONFIG.width * 0.32, 1),
        makeFighter(1, CONFIG.width * 0.68, -1)
      ]
    };
    return match;
  }

  function startRound(match) {
    match.fighters = [
      makeFighter(0, CONFIG.width * 0.32, 1),
      makeFighter(1, CONFIG.width * 0.68, -1)
    ];
    match.timer = match.roundTime;
    match.phase = 'fight';
    match.phaseTime = 0;
    match.roundWinner = -1;
    match.events.push({ type: 'roundStart', round: match.round });
  }

  function resetMatch(match) {
    match.round = 1;
    match.wins = [0, 0];
    match.matchWinner = -1;
    startRound(match);
  }

  /* --------------------------------------------------------------- 战斗 */
  function setState(fighter, name, no) {
    if (fighter.state === name) return;
    fighter.state = name;
    fighter.stateNo = no;
    fighter.stateTime = 0;
  }

  function canAct(fighter) {
    return fighter.state !== 'hit' && fighter.state !== 'ko' && fighter.state !== 'win'
      && !(fighter.state === 'attack');
  }

  function attackSpec(fighter) {
    return fighter.attack ? ATTACKS[fighter.attack] : null;
  }

  function isActive(fighter) {
    var spec = attackSpec(fighter);
    if (!spec) return false;
    return fighter.stateTime >= spec.startup && fighter.stateTime < spec.startup + spec.active;
  }

  function hurtBox(fighter) {
    return {
      x1: fighter.x - CONFIG.bodyWidth / 2,
      x2: fighter.x + CONFIG.bodyWidth / 2,
      y1: fighter.y - CONFIG.bodyHeight,
      y2: fighter.y
    };
  }

  function attackBox(fighter) {
    var spec = attackSpec(fighter);
    if (!spec) return null;
    var front = fighter.x + fighter.facing * CONFIG.bodyWidth / 2;
    var near = fighter.facing > 0 ? front - 10 : front - spec.reach + 10;
    return {
      x1: near,
      x2: near + spec.reach,
      y1: fighter.y - CONFIG.bodyHeight + 40,
      y2: fighter.y - 90
    };
  }

  function overlap(a, b) {
    return Math.max(a.x1, b.x1) <= Math.min(a.x2, b.x2)
      && Math.max(a.y1, b.y1) <= Math.min(a.y2, b.y2);
  }

  function pushEvent(match, event) { match.events.push(event); }

  function applyHit(match, attacker, defender) {
    var spec = attackSpec(attacker);
    if (!spec) return;

    var guard = defender.state === 'block'
      || (defender.blocking && (defender.state === 'idle' || defender.state === 'walk'));

    attacker.hasHit = true;

    if (guard) {
      var chip = Math.max(1, Math.round(spec.damage * 0.15));
      defender.hp = Math.max(0, defender.hp - chip);
      defender.blockCount += 1;
      defender.stun = 0.12;
      defender.vx = attacker.facing * spec.push * 0.6;
      setState(defender, 'block', 0);
      pushEvent(match, {
        type: 'block', from: attacker.id, to: defender.id,
        damage: chip, x: defender.x, y: defender.y - 130
      });
    } else {
      defender.hp = Math.max(0, defender.hp - spec.damage);
      defender.stun = spec.stun;
      defender.vx = attacker.facing * spec.push * 6;
      defender.vy = defender.onGround ? -260 : defender.vy;
      defender.onGround = false;
      defender.combo = 0;
      defender.comboTimer = 0;
      setState(defender, 'hit', 5);
      attacker.hits += 1;
      attacker.damage += spec.damage;
      attacker.combo += 1;
      attacker.comboTimer = 1.25;
      pushEvent(match, {
        type: 'hit', from: attacker.id, to: defender.id, damage: spec.damage,
        combo: attacker.combo, heavy: attacker.attack === 'heavy',
        x: defender.x, y: defender.y - 150
      });
    }

    if (defender.hp <= 0) {
      defender.hp = 0;
      defender.vx = attacker.facing * 210;
      defender.vy = -320;
      defender.onGround = false;
      setState(defender, 'ko', 6);
    }
  }

  /* ----------------------------------------------------------- 单帧更新 */
  function updateFighter(match, fighter, input, dt) {
    var other = match.fighters[1 - fighter.id];

    if (fighter.state === 'ko') {
      fighter.stateTime += dt;
    } else if (fighter.state === 'hit') {
      fighter.stateTime += dt;
      if (fighter.stateTime >= fighter.stun) setState(fighter, 'idle', 0);
    } else if (fighter.state === 'attack') {
      var spec = attackSpec(fighter);
      fighter.stateTime += dt;
      fighter.hasHit = fighter.hasHit || false;
      if (fighter.stateTime >= spec.startup + spec.active + spec.recovery) {
        fighter.attack = null;
        fighter.hasHit = false;
        setState(fighter, 'idle', 0);
      }
    } else {
      // 自由状态：走 / 跳 / 出招 / 防御
      var move = (input.right ? 1 : 0) - (input.left ? 1 : 0);
      fighter.blocking = false;

      if (input.block && fighter.onGround) {
        fighter.blocking = true;
        fighter.vx = 0;
        setState(fighter, 'block', 0);
      } else if ((input.light || input.heavy) && fighter.onGround) {
        var kind = input.heavy ? 'heavy' : 'light';
        var before = fighter.stateTime;
        fighter.attack = kind;
        fighter.hasHit = false;
        fighter.vx = 0;
        setState(fighter, 'attack', 4);
        fighter.stateTime = 0;
        void before;
        pushEvent(match, { type: 'swing', from: fighter.id, kind: kind });
      } else if (input.up && fighter.onGround) {
        fighter.vy = CONFIG.jumpVy;
        fighter.onGround = false;
        fighter.vx = move * CONFIG.walkSpeed;
        setState(fighter, 'jump', 3);
      } else if (move !== 0) {
        fighter.vx = move * (move === fighter.facing ? CONFIG.walkSpeed : CONFIG.backSpeed);
        if (fighter.onGround) setState(fighter, move === fighter.facing ? 'walk' : 'walkBack', move === fighter.facing ? 1 : 2);
      } else {
        fighter.vx = 0;
        if (fighter.onGround) setState(fighter, 'idle', 0);
      }
    }

    // 物理
    if (!fighter.onGround) {
      fighter.vy += CONFIG.gravity * dt;
    }
    fighter.x += fighter.vx * dt;
    fighter.y += fighter.vy * dt;

    if (fighter.y >= CONFIG.groundY) {
      fighter.y = CONFIG.groundY;
      fighter.vy = 0;
      if (!fighter.onGround) {
        fighter.onGround = true;
        if (fighter.state === 'jump') setState(fighter, 'idle', 0);
        if (fighter.state === 'ko') fighter.stateTime = 0;
      }
    }

    fighter.x = clamp(fighter.x, CONFIG.wall, CONFIG.width - CONFIG.wall);

    // 地面摩擦 + 受击位移收敛
    if (fighter.onGround && (fighter.state === 'hit' || fighter.state === 'block')) {
      fighter.vx *= Math.max(0, 1 - dt * 8);
    }

    // 面向：自由状态时自动朝向对手
    if (canAct(fighter) && fighter.state !== 'ko' && other) {
      fighter.facing = other.x >= fighter.x ? 1 : -1;
    }

    // 连击计时
    if (fighter.comboTimer > 0) {
      fighter.comboTimer -= dt;
      if (fighter.comboTimer <= 0) fighter.combo = 0;
    }
  }

  function separate(match) {
    var a = match.fighters[0];
    var b = match.fighters[1];
    if (a.state === 'ko' || b.state === 'ko') return;
    var minGap = CONFIG.bodyWidth * 0.82;
    var diff = b.x - a.x;
    if (Math.abs(diff) >= minGap) return;
    var push = (minGap - Math.abs(diff)) / 2;
    var dir = diff >= 0 ? 1 : -1;
    a.x -= dir * push;
    b.x += dir * push;
    a.x = clamp(a.x, CONFIG.wall, CONFIG.width - CONFIG.wall);
    b.x = clamp(b.x, CONFIG.wall, CONFIG.width - CONFIG.wall);
  }

  function update(match, dt, input0, input1) {
    if (!match) return match;
    var step = clamp(Number(dt) || 0, 0, 0.05);
    if (step <= 0) return match;

    match.phaseTime += step;

    if (match.phase === 'fight') {
      match.timer = Math.max(0, match.timer - step);

      var inputs = [input0 || emptyInput(), input1 || emptyInput()];
      var a = match.fighters[0];
      var b = match.fighters[1];

      updateFighter(match, a, inputs[0], step);
      updateFighter(match, b, inputs[1], step);
      separate(match);

      if (isActive(a) && !a.hasHit) {
        var boxA = attackBox(a);
        if (boxA && overlap(boxA, hurtBox(b))) applyHit(match, a, b);
      }
      if (isActive(b) && !b.hasHit) {
        var boxB = attackBox(b);
        if (boxB && overlap(boxB, hurtBox(a))) applyHit(match, b, a);
      }

      if (a.hp <= 0 || b.hp <= 0) {
        finishRound(match, a.hp <= 0 ? (b.hp <= 0 ? -1 : 1) : 0, 'ko');
      } else if (match.timer <= 0) {
        var winner = a.hp === b.hp ? -1 : (a.hp > b.hp ? 0 : 1);
        finishRound(match, winner, 'time');
      }
    } else if (match.phase === 'roundEnd') {
      var w = match.fighters[match.roundWinner >= 0 ? match.roundWinner : 0];
      if (w && w.hp > 0) {
        setState(w, 'win', 0);
        w.stateTime += step;
      }
      if (match.phaseTime >= CONFIG.roundEndDelay) {
        if (match.wins[0] >= match.roundsToWin || match.wins[1] >= match.roundsToWin) {
          match.phase = 'matchEnd';
          match.phaseTime = 0;
          match.matchWinner = match.wins[0] > match.wins[1] ? 0 : 1;
          pushEvent(match, { type: 'match', winner: match.matchWinner, wins: match.wins.slice() });
        } else {
          match.round += 1;
          startRound(match);
        }
      }
    }

    return match;
  }

  function finishRound(match, winner, reason) {
    if (match.phase !== 'fight') return;
    match.phase = 'roundEnd';
    match.phaseTime = 0;
    match.roundWinner = winner;
    if (winner >= 0) match.wins[winner] += 1;
    var loser = winner >= 0 ? match.fighters[1 - winner] : null;
    if (loser && loser.hp > 0 && reason === 'time') {
      setState(loser, 'hit', 5);
      loser.stun = 99;
    }
    pushEvent(match, {
      type: 'roundEnd', winner: winner, reason: reason,
      wins: match.wins.slice(), round: match.round
    });
  }

  /* --------------------------------------------------------------- 电脑 */
  function aiInput(match, index, level) {
    var cfg = AI_LEVELS[level] || AI_LEVELS.normal;
    var me = match.fighters[index];
    var you = match.fighters[1 - index];
    var input = emptyInput();
    var ai = me.ai;

    if (match.phase !== 'fight' || me.state === 'ko' || me.state === 'hit') return input;

    var dist = Math.abs(you.x - me.x);
    var toward = you.x >= me.x ? 'right' : 'left';

    if (!you.onGround && dist < 200 && match.rng() < cfg.attack * 0.5) {
      input.light = true;
      return input;
    }

    // 对手正在出招且距离够近 → 高概率防御
    if (you.state === 'attack' && dist < 190 && match.rng() < cfg.block) {
      input.block = true;
      return input;
    }

    if (ai.holdBlock > 0) {
      ai.holdBlock -= 1;
      input.block = true;
      return input;
    }

    if (ai.holdAttack > 0) {
      ai.holdAttack -= 1;
      if (ai.intent === 'heavy') {
        input.heavy = ai.holdAttack === 1;
      } else {
        input.light = ai.holdAttack === 1;
      }
      return input;
    }

    ai.timer -= 1 / 60;
    if (ai.timer > 0) {
      if (ai.intent === 'approach') {
        if (toward === 'right') input.right = true; else input.left = true;
      } else if (ai.intent === 'retreat') {
        if (toward === 'right') input.left = true; else input.right = true;
      } else if (ai.intent === 'guard') {
        input.block = true;
      }
      return input;
    }

    ai.timer = cfg.think;

    if (dist <= cfg.gap) {
      var r = match.rng();
      if (r < cfg.attack) {
        ai.intent = r < cfg.attack * 0.35 ? 'heavy' : 'light';
        ai.holdAttack = 2;
        if (ai.intent === 'heavy') input.heavy = true; else input.light = true;
      } else if (r < cfg.attack + 0.12) {
        ai.intent = 'guard';
        ai.holdBlock = 6;
        input.block = true;
      } else {
        ai.intent = 'retreat';
        if (toward === 'right') input.left = true; else input.right = true;
      }
    } else if (dist > cfg.gap + 90) {
      ai.intent = 'approach';
      if (toward === 'right') input.right = true; else input.left = true;
      if (match.rng() < cfg.jump) input.up = true;
    } else {
      ai.intent = match.rng() < 0.5 ? 'approach' : 'guard';
      if (ai.intent === 'guard') input.block = true;
      else if (toward === 'right') input.right = true; else input.left = true;
    }

    return input;
  }

  /* --------------------------------------------------------------- 输出 */
  function drainEvents(match) {
    var list = match.events.slice();
    match.events.length = 0;
    return list;
  }

  function resultText(match) {
    if (match.phase !== 'matchEnd') return '';
    if (match.matchWinner === 0) return 'YOU WIN';
    return 'YOU LOSE';
  }

  return {
    CONFIG: CONFIG,
    ATTACKS: ATTACKS,
    AI_LEVELS: AI_LEVELS,
    createMatch: createMatch,
    resetMatch: resetMatch,
    startRound: startRound,
    update: update,
    aiInput: aiInput,
    drainEvents: drainEvents,
    resultText: resultText,
    emptyInput: emptyInput,
    attackBox: attackBox,
    hurtBox: hurtBox
  };
}));
