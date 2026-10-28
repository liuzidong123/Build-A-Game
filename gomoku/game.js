/* 五子棋 · 界面渲染与对局流程 */
(function () {
  'use strict';

  var Core = window.GomokuCore;
  var AI = window.GomokuAI;
  var BLACK = Core.BLACK;
  var WHITE = Core.WHITE;
  var EMPTY = Core.EMPTY;

  var SETTINGS_KEY = 'gomoku.settings.v1';
  var STATS_KEY = 'gomoku.stats.v1';
  var AI_DELAY = 260;
  var STARS = [[3, 3], [3, 11], [11, 3], [11, 11], [7, 7]];

  function $(id) { return document.getElementById(id); }

  var ui = {
    canvas: $('board'), live: $('liveStatus'),
    turnDot: $('turnDot'), turnText: $('turnText'),
    moveVal: $('moveVal'), clockVal: $('clockVal'), recordVal: $('recordVal'),
    modeRow: $('modeRow'), sideRow: $('sideRow'), levelRow: $('levelRow'),
    sideGroup: $('sideGroup'), levelGroup: $('levelGroup'),
    restart: $('restartBtn'), undo: $('undoBtn'), resign: $('resignBtn'),
    tip: $('tipText'), result: $('result'), resultKicker: $('resultKicker'),
    resultTitle: $('resultTitle'), resultCopy: $('resultCopy'),
    again: $('againBtn'), closeResult: $('closeResultBtn')
  };

  function readJSON(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      if (!raw) return fallback;
      var value = JSON.parse(raw);
      return value && typeof value === 'object' ? value : fallback;
    } catch (e) { return fallback; }
  }

  function writeJSON(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* 隐私模式忽略 */ }
  }

  var settings = readJSON(SETTINGS_KEY, { mode: 'ai', side: BLACK, level: 'normal' });
  if (settings.side !== WHITE) settings.side = BLACK;
  if (AI.LEVELS.indexOf(settings.level) === -1) settings.level = 'normal';
  if (settings.mode !== 'pvp') settings.mode = 'ai';

  var stats = readJSON(STATS_KEY, { wins: 0, losses: 0, draws: 0 });
  ['wins', 'losses', 'draws'].forEach(function (key) {
    if (typeof stats[key] !== 'number' || stats[key] < 0) stats[key] = 0;
  });

  var game = Core.createGame({ size: 15 });
  var ctx = null;
  var geo = { size: 480, pad: 26, cell: 30 };
  var hover = null;
  var aiThinking = false;
  var aiTimer = null;
  var startedAt = Date.now();
  var finishedAt = 0;

  /* ------------------------------------------------------------ 基础工具 */
  function isAiMode() { return settings.mode === 'ai'; }

  function isHumanTurn() {
    return !isAiMode() || game.state.turn === settings.side;
  }

  function formatClock(seconds) {
    var total = Math.max(0, Math.round(seconds));
    var m = Math.floor(total / 60);
    var s = total % 60;
    return (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
  }

  function elapsedSeconds() {
    var end = finishedAt || Date.now();
    return Math.max(0, Math.round((end - startedAt) / 1000));
  }

  function colorName(player) {
    return player === BLACK ? '黑棋' : '白棋';
  }

  /* ------------------------------------------------------------ 画布尺寸 */
  function fitCanvas() {
    var rect = ui.canvas.getBoundingClientRect ? ui.canvas.getBoundingClientRect() : null;
    var cssWidth = Math.round((rect && rect.width) || ui.canvas.clientWidth || 480);
    cssWidth = Math.max(240, cssWidth);
    var dpr = window.devicePixelRatio || 1;
    ui.canvas.width = Math.round(cssWidth * dpr);
    ui.canvas.height = Math.round(cssWidth * dpr);
    if (ctx && ctx.setTransform) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    var n = game.state.size;
    var pad = Math.round(cssWidth * 0.055) + 2;
    var cell = (cssWidth - pad * 2) / (n - 1);
    geo = { size: cssWidth, pad: pad, cell: cell };
  }

  function cellCenter(r, c) {
    return {
      x: geo.pad + c * geo.cell,
      y: geo.pad + r * geo.cell
    };
  }

  function pointToCell(x, y) {
    var n = game.state.size;
    var c = Math.round((x - geo.pad) / geo.cell);
    var r = Math.round((y - geo.pad) / geo.cell);
    if (r < 0 || c < 0 || r >= n || c >= n) return null;
    var cx = geo.pad + c * geo.cell;
    var cy = geo.pad + r * geo.cell;
    var tolerance = Math.max(8, geo.cell * 0.62);
    if (Math.abs(x - cx) > tolerance || Math.abs(y - cy) > tolerance) return null;
    return { r: r, c: c };
  }

  /* ------------------------------------------------------------ 绘制 */
  function drawStone(r, c, player, alpha) {
    var pos = cellCenter(r, c);
    var radius = geo.cell * 0.44;
    ctx.save();
    if (alpha) ctx.globalAlpha = alpha;
    ctx.shadowColor = 'rgba(0, 0, 0, 0.35)';
    ctx.shadowBlur = geo.cell * 0.18;
    ctx.shadowOffsetY = geo.cell * 0.08;

    var grad = ctx.createRadialGradient(
      pos.x - radius * 0.35, pos.y - radius * 0.4, radius * 0.15,
      pos.x, pos.y, radius
    );
    if (player === BLACK) {
      grad.addColorStop(0, '#61697c');
      grad.addColorStop(0.55, '#232732');
      grad.addColorStop(1, '#080a0f');
    } else {
      grad.addColorStop(0, '#ffffff');
      grad.addColorStop(0.6, '#f3f5fa');
      grad.addColorStop(1, '#c6ccd8');
    }
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(pos.x, pos.y, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    if (player === WHITE) {
      ctx.save();
      ctx.strokeStyle = 'rgba(30, 34, 44, 0.18)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, radius, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }

  function drawBoardBase() {
    var size = geo.size;
    var n = game.state.size;
    ctx.clearRect(0, 0, size, size);

    var wood = ctx.createLinearGradient(0, 0, size, size);
    wood.addColorStop(0, '#f2dbaf');
    wood.addColorStop(0.5, '#e8c997');
    wood.addColorStop(1, '#d7b178');
    ctx.fillStyle = wood;
    ctx.fillRect(0, 0, size, size);

    ctx.save();
    ctx.globalAlpha = 0.05;
    ctx.strokeStyle = '#8a6437';
    ctx.lineWidth = 2;
    for (var i = 1; i < 18; i += 1) {
      var y = (i * size) / 18;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.bezierCurveTo(size * 0.3, y + 5, size * 0.68, y - 6, size, y + 2);
      ctx.stroke();
    }
    ctx.restore();

    ctx.strokeStyle = 'rgba(92, 64, 32, 0.55)';
    ctx.lineWidth = 1;
    for (var k = 0; k < n; k += 1) {
      var offset = geo.pad + k * geo.cell;
      ctx.beginPath();
      ctx.moveTo(geo.pad, offset);
      ctx.lineTo(geo.pad + geo.cell * (n - 1), offset);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(offset, geo.pad);
      ctx.lineTo(offset, geo.pad + geo.cell * (n - 1));
      ctx.stroke();
    }

    ctx.strokeStyle = 'rgba(74, 50, 24, 0.85)';
    ctx.lineWidth = 2;
    ctx.strokeRect(geo.pad, geo.pad, geo.cell * (n - 1), geo.cell * (n - 1));

    ctx.fillStyle = 'rgba(74, 50, 24, 0.85)';
    STARS.forEach(function (star) {
      var pos = cellCenter(star[0], star[1]);
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, Math.max(2, geo.cell * 0.09), 0, Math.PI * 2);
      ctx.fill();
    });
  }

  function drawWinLine(line) {
    if (!line || line.length < 2) return;
    var head = cellCenter(line[0][0], line[0][1]);
    var tail = cellCenter(line[line.length - 1][0], line[line.length - 1][1]);

    ctx.save();
    ctx.strokeStyle = 'rgba(255, 206, 106, 0.95)';
    ctx.lineWidth = Math.max(3, geo.cell * 0.16);
    ctx.lineCap = 'round';
    ctx.shadowColor = 'rgba(255, 196, 80, 0.85)';
    ctx.shadowBlur = geo.cell * 0.5;
    ctx.beginPath();
    ctx.moveTo(head.x, head.y);
    ctx.lineTo(tail.x, tail.y);
    ctx.stroke();
    ctx.restore();

    ctx.save();
    ctx.strokeStyle = 'rgba(255, 226, 150, 0.9)';
    ctx.lineWidth = 2;
    line.forEach(function (cell) {
      var pos = cellCenter(cell[0], cell[1]);
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, geo.cell * 0.44, 0, Math.PI * 2);
      ctx.stroke();
    });
    ctx.restore();
  }

  function draw() {
    if (!ctx) return;
    var state = game.state;
    drawBoardBase();

    var last = state.moves[state.moves.length - 1];
    var canPreview = hover && state.status === 'playing' && !aiThinking && isHumanTurn()
      && state.board[hover.r][hover.c] === EMPTY;
    if (canPreview) drawStone(hover.r, hover.c, state.turn, 0.34);

    state.moves.forEach(function (move) {
      drawStone(move.r, move.c, move.player, 1);
    });

    if (last && state.status === 'playing') {
      var pos = cellCenter(last.r, last.c);
      ctx.save();
      ctx.fillStyle = last.player === BLACK ? 'rgba(244, 196, 106, 0.95)' : 'rgba(124, 92, 255, 0.9)';
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, Math.max(2, geo.cell * 0.1), 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    drawWinLine(state.winLine);
  }

  /* ------------------------------------------------------------ 状态同步 */
  function syncStatus() {
    var state = game.state;
    var text;
    if (state.status !== 'playing') {
      text = '本局结束';
    } else if (aiThinking) {
      text = '电脑思考中…';
    } else if (!isHumanTurn()) {
      text = colorName(state.turn) + '（电脑）';
    } else {
      text = colorName(state.turn) + '落子';
    }
    ui.turnText.textContent = text;
    ui.turnDot.classList.toggle('is-white', state.turn === WHITE);
    ui.live.textContent = text;
  }

  function syncControls() {
    Array.prototype.forEach.call(ui.modeRow.querySelectorAll('[data-mode]'), function (btn) {
      btn.classList.toggle('is-on', btn.dataset.mode === settings.mode);
    });
    Array.prototype.forEach.call(ui.sideRow.querySelectorAll('[data-side]'), function (btn) {
      btn.classList.toggle('is-on', Number(btn.dataset.side) === settings.side);
    });
    Array.prototype.forEach.call(ui.levelRow.querySelectorAll('[data-level]'), function (btn) {
      btn.classList.toggle('is-on', btn.dataset.level === settings.level);
    });

    ui.sideGroup.hidden = !isAiMode();
    ui.levelGroup.hidden = !isAiMode();

    ui.moveVal.textContent = String(game.state.moves.length);
    ui.clockVal.textContent = formatClock(elapsedSeconds());
    ui.recordVal.textContent = stats.wins + ' 胜 ' + stats.losses + ' 负';

    var over = game.state.status !== 'playing';
    ui.undo.disabled = over || aiThinking || !game.canUndo();
    ui.resign.disabled = over;

    ui.tip.textContent = isAiMode()
      ? '我方落子后电脑自动应招；悔棋会退回你上一次落子之前。'
      : '两人共用一块棋盘轮流落子，黑棋先行。';
  }

  function renderAll() {
    draw();
    syncStatus();
    syncControls();
  }

  function tick() {
    if (game.state.status === 'playing') {
      ui.clockVal.textContent = formatClock(elapsedSeconds());
    }
  }

  /* ------------------------------------------------------------ 对局流程 */
  function clearAiTimer() {
    if (aiTimer) {
      clearTimeout(aiTimer);
      aiTimer = null;
    }
    aiThinking = false;
  }

  function hideResult() {
    ui.result.hidden = true;
  }

  function showResult(title, kicker, copy) {
    ui.resultTitle.textContent = title;
    ui.resultKicker.textContent = kicker;
    ui.resultCopy.textContent = copy;
    ui.result.hidden = false;
  }

  function recordResult(status, winner) {
    if (!isAiMode()) return;
    if (status === 'draw') stats.draws += 1;
    else if (winner === settings.side) stats.wins += 1;
    else stats.losses += 1;
    writeJSON(STATS_KEY, stats);
  }

  function finish(status, winner) {
    finishedAt = Date.now();
    clearAiTimer();
    recordResult(status, winner);
    renderAll();

    var title;
    var kicker = status === 'draw' ? '和棋' : '本局结束';
    if (status === 'draw') {
      title = '和棋';
    } else if (isAiMode()) {
      title = winner === settings.side ? '你赢了' : '电脑获胜';
    } else {
      title = colorName(winner) + '胜';
    }

    var summary = '共 ' + game.state.moves.length + ' 手 · 用时 ' + formatClock(elapsedSeconds());
    if (isAiMode()) {
      summary += ' · 人机战绩 ' + stats.wins + ' 胜 ' + stats.losses + ' 负';
    }
    showResult(title, kicker, summary);
  }

  function scheduleAi() {
    if (!isAiMode() || aiThinking || game.state.status !== 'playing') return;
    if (game.state.turn === settings.side) return;
    aiThinking = true;
    syncStatus();
    syncControls();
    aiTimer = setTimeout(function () {
      aiTimer = null;
      var res = AI.pickMove(game.state.board, game.state.size, game.state.turn, {
        level: settings.level
      });
      var played = game.play(res.r, res.c);
      aiThinking = false;
      renderAll();
      if (played.ok && played.status !== 'playing') finish(played.status, played.winner);
    }, AI_DELAY);
  }

  function playAt(r, c) {
    if (game.state.status !== 'playing') return false;
    if (aiThinking) return false;
    if (!isHumanTurn()) return false;
    var result = game.play(r, c);
    if (!result.ok) return false;
    hover = null;
    renderAll();
    if (result.status === 'playing') {
      if (isAiMode()) scheduleAi();
    } else {
      finish(result.status, result.winner);
    }
    return true;
  }

  function newGame() {
    clearAiTimer();
    hideResult();
    game.reset();
    hover = null;
    startedAt = Date.now();
    finishedAt = 0;
    renderAll();
    if (isAiMode() && game.state.turn !== settings.side) scheduleAi();
  }

  function undo() {
    if (aiThinking || game.state.status !== 'playing' || !game.canUndo()) return;
    if (!isAiMode()) {
      game.undo(1);
    } else {
      var guard = 0;
      do {
        game.undo(1);
        guard += 1;
      } while (game.state.moves.length && game.state.turn !== settings.side && guard < 3);
    }
    if (isAiMode() && game.state.turn !== settings.side) {
      scheduleAi();
    }
    renderAll();
  }

  function resign() {
    if (game.state.status !== 'playing') return;
    var loser = isAiMode() ? settings.side : game.state.turn;
    finish('won', Core.other(loser));
  }

  function setMode(mode) {
    settings.mode = mode === 'pvp' ? 'pvp' : 'ai';
    writeJSON(SETTINGS_KEY, settings);
    newGame();
  }

  function setSide(side) {
    settings.side = Number(side) === WHITE ? WHITE : BLACK;
    writeJSON(SETTINGS_KEY, settings);
    newGame();
  }

  function setLevel(level) {
    if (AI.LEVELS.indexOf(level) === -1) return;
    settings.level = level;
    writeJSON(SETTINGS_KEY, settings);
    syncControls();
  }

  /* ------------------------------------------------------------ 事件绑定 */
  function bindSegmented(row, handler) {
    if (!row) return;
    row.addEventListener('click', function (event) {
      var button = event.target.closest('button');
      if (!button || !row.contains(button)) return;
      handler(button);
    });
  }

  function localPoint(event) {
    var rect = ui.canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  function bindEvents() {
    ui.canvas.addEventListener('pointerdown', function (event) {
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      var point = localPoint(event);
      var cell = pointToCell(point.x, point.y);
      if (!cell) return;
      if (playAt(cell.r, cell.c) && ui.canvas.setPointerCapture && event.pointerId != null) {
        try { ui.canvas.setPointerCapture(event.pointerId); } catch (e) { /* 忽略 */ }
      }
    });

    ui.canvas.addEventListener('pointermove', function (event) {
      if (event.pointerType === 'touch') return;
      var point = localPoint(event);
      var cell = pointToCell(point.x, point.y);
      var changed = (cell && (!hover || hover.r !== cell.r || hover.c !== cell.c)) || (!cell && hover);
      hover = cell;
      if (changed) draw();
    });

    ui.canvas.addEventListener('pointerleave', function () {
      if (!hover) return;
      hover = null;
      draw();
    });

    bindSegmented(ui.modeRow, function (button) { setMode(button.dataset.mode); });
    bindSegmented(ui.sideRow, function (button) { setSide(button.dataset.side); });
    bindSegmented(ui.levelRow, function (button) { setLevel(button.dataset.level); });

    ui.restart.addEventListener('click', newGame);
    ui.again.addEventListener('click', newGame);
    ui.undo.addEventListener('click', undo);
    ui.resign.addEventListener('click', resign);
    ui.closeResult.addEventListener('click', hideResult);

    window.addEventListener('resize', function () {
      fitCanvas();
      draw();
    });
  }

  function init() {
    ctx = ui.canvas.getContext('2d');
    fitCanvas();
    bindEvents();
    newGame();
    setInterval(tick, 1000);
    if (window.requestAnimationFrame) {
      window.requestAnimationFrame(function () {
        fitCanvas();
        draw();
      });
    }
  }

  /* 自动化/调试入口：仅供 tests/ui.smoke.cjs 与手动排查使用 */
  window.GomokuApp = {
    state: function () { return game.state; },
    settings: settings,
    stats: stats,
    playAt: playAt,
    undo: undo,
    resign: resign,
    newGame: newGame,
    setMode: setMode,
    setSide: setSide,
    setLevel: setLevel,
    pointToCell: pointToCell,
    cellCenter: cellCenter
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
