/* 围棋 · 界面与对局流程（依赖 logic.js / ai.js） */
(function (root) {
  'use strict';

  var doc = root.document;
  var Core = root.GoCore;
  var AI = root.GoAI;
  var STORE_KEY = 'go.v1';
  var SVG_NS = 'http://www.w3.org/2000/svg';

  var app = {
    state: Core.createState(),
    mode: 'ai',
    side: Core.BLACK,
    level: 'normal',
    over: false,
    thinking: false,
    notice: '',
    record: { win: 0, draw: 0, loss: 0 }
  };

  var points = [];

  function el(id) { return doc.getElementById(id); }

  /* --------------------------------------------------------------- 棋盘 */
  function addLine(svg, x1, y1, x2, y2, isEdge) {
    var line = doc.createElementNS(SVG_NS, 'line');
    line.setAttribute('x1', x1.toFixed(2));
    line.setAttribute('y1', y1.toFixed(2));
    line.setAttribute('x2', x2.toFixed(2));
    line.setAttribute('y2', y2.toFixed(2));
    line.setAttribute('class', isEdge ? 'edge' : 'line');
    svg.appendChild(line);
  }

  function buildGrid() {
    var svg = el('grid');
    if (!svg || svg.children.length) return;
    var step = 900 / 19;
    var pad = step / 2;
    var far = 900 - pad;
    for (var i = 0; i < 19; i += 1) {
      var offset = pad + i * step;
      var edge = i === 0 || i === 18;
      addLine(svg, pad, offset, far, offset, edge);
      addLine(svg, offset, pad, offset, far, edge);
    }
    [[3, 3], [9, 3], [15, 3], [3, 9], [9, 9], [15, 9], [3, 15], [9, 15], [15, 15]].forEach(function (pair) {
      var star = doc.createElementNS(SVG_NS, 'circle');
      star.setAttribute('cx', (pad + pair[0] * step).toFixed(2));
      star.setAttribute('cy', (pad + pair[1] * step).toFixed(2));
      star.setAttribute('r', '5.5');
      star.setAttribute('class', 'star');
      svg.appendChild(star);
    });
  }

  function buildPoints() {
    var box = el('points');
    if (!box) return;
    points = [];
    for (var i = 0; i < Core.POINTS; i += 1) {
      var btn = doc.createElement('button');
      btn.type = 'button';
      btn.className = 'pt';
      btn.dataset.i = String(i);
      btn.setAttribute('role', 'gridcell');
      var stone = doc.createElement('span');
      stone.className = 'stone empty';
      btn.appendChild(stone);
      btn.addEventListener('click', onPointClick);
      box.appendChild(btn);
      points.push(btn);
    }
  }

  /* --------------------------------------------------------------- 渲染 */
  function statusLine() {
    if (app.over) return '本局结束';
    if (app.thinking) return '电脑思考中…';
    if (app.notice) return app.notice;
    var who = app.state.turn === Core.BLACK ? '黑方' : '白方';
    return who + '落子' + (app.state.passes === 1 ? '（对方已虚手）' : '');
  }

  function render() {
    var state = app.state;
    var color = state.turn;
    var locked = app.over || app.thinking || (app.mode === 'ai' && state.turn !== app.side);

    for (var i = 0; i < points.length; i += 1) {
      var btn = points[i];
      var col = Core.colOf(i);
      var row = Core.rowOf(i);
      btn.style.setProperty('--col', String(col));
      btn.style.setProperty('--row', String(row));

      var piece = state.board[i];
      var stone = btn.firstChild;
      stone.classList.toggle('b', piece === Core.BLACK);
      stone.classList.toggle('w', piece === Core.WHITE);
      stone.classList.toggle('empty', !piece);
      btn.classList.toggle('has-piece', !!piece);
      btn.classList.toggle('is-last', state.last === i);
      btn.classList.toggle('is-ko', state.ko === i && !piece);
      btn.title = Core.formatCoord(i) || '虚手';
      btn.setAttribute('aria-label', Core.formatCoord(i) +
        (piece ? (piece === Core.BLACK ? ' 黑子' : ' 白子') : ' 空点'));
    }

    var box = el('points');
    box.classList.toggle('turn-b', color === Core.BLACK);
    box.classList.toggle('turn-w', color === Core.WHITE);
    box.classList.toggle('is-locked', locked);

    var text = statusLine();
    el('statusText').textContent = text;
    el('liveStatus').textContent = text;
    el('turnDot').classList.toggle('is-white', color === Core.WHITE);
    el('passBtn').disabled = locked;
    el('undoBtn').disabled = app.thinking || !state.history.length;
  }

  function syncMoves() {
    var list = el('moveList');
    var history = app.state.history;
    list.innerHTML = '';
    if (!history.length) {
      var empty = doc.createElement('li');
      empty.className = 'moves-empty';
      empty.textContent = '还没有落子';
      list.appendChild(empty);
    } else {
      history.forEach(function (item) {
        var move = item.move;
        if (!move) return;
        var li = doc.createElement('li');
        li.className = 'ply';
        var who = doc.createElement('span');
        who.className = 'who ' + move.color;
        who.textContent = move.color === Core.BLACK ? '黑' : '白';
        var txt = doc.createElement('span');
        txt.className = 'txt';
        if (move.type === 'pass') {
          txt.textContent = '虚手';
        } else {
          txt.textContent = Core.formatCoord(move.index);
          if (move.captured.length) {
            var cap = doc.createElement('span');
            cap.className = 'cap';
            cap.textContent = ' 提' + move.captured.length;
            txt.appendChild(cap);
          }
        }
        li.appendChild(who);
        li.appendChild(txt);
        list.appendChild(li);
      });
      list.scrollTop = list.scrollHeight;
    }
    el('moveCount').textContent = history.length + ' 手';
  }

  function syncCaptures() {
    var captures = app.state.captures;
    el('capB').textContent = String(captures.b);
    el('capW').textContent = String(captures.w);
    el('scoreNote').textContent = '黑提 ' + captures.b + ' · 白提 ' + captures.w;
  }

  function syncEstimate() {
    var result = Core.score(app.state);
    el('estimateVal').textContent = '黑 ' + result.black + ' · 白 ' + result.white;
  }

  function syncRecord() {
    el('recVal').textContent = app.record.win + ' 胜 ' + app.record.draw + ' 和 ' + app.record.loss + ' 负';
  }

  function syncSettings() {
    Array.prototype.forEach.call(el('modeRow').children, function (btn) {
      btn.classList.toggle('is-on', btn.dataset.mode === app.mode);
    });
    Array.prototype.forEach.call(el('sideRow').children, function (btn) {
      btn.classList.toggle('is-on', btn.dataset.side === app.side);
    });
    Array.prototype.forEach.call(el('levelRow').children, function (btn) {
      btn.classList.toggle('is-on', btn.dataset.level === app.level);
    });
    var aiOnly = app.mode === 'ai';
    el('sideGroup').hidden = !aiOnly;
    el('levelGroup').hidden = !aiOnly;
  }

  function syncAll() {
    syncMoves();
    syncCaptures();
    syncEstimate();
    syncRecord();
  }

  /* --------------------------------------------------------------- 结算 */
  function showResult(kicker, title, copy) {
    el('resultKicker').textContent = kicker;
    el('resultTitle').textContent = title;
    el('resultCopy').textContent = copy;
    el('result').hidden = false;
  }

  function bumpRecord(kind) {
    if (!kind) return;
    if (kind === 'win') app.record.win += 1;
    else if (kind === 'draw') app.record.draw += 1;
    else app.record.loss += 1;
    saveSettings();
  }

  function settle() {
    var state = app.state;
    if (state.status === 'playing') return;
    app.over = true;
    app.thinking = false;

    if (state.status === 'scored') {
      var result = state.score || Core.score(state);
      var winner = result.winner;
      showResult('数子结果', Core.colorName(winner) + '胜',
        '黑 ' + result.black + ' 目，白 ' + result.white + ' 目（含贴目 ' + result.komi + '）；' +
        Core.colorName(winner) + '胜 ' + result.margin + ' 目。');
      bumpRecord(app.mode === 'ai' ? (winner === app.side ? 'win' : 'loss') : null);
      return;
    }

    if (state.status === 'resign') {
      var winnerSide = state.winner;
      showResult('认输', Core.colorName(winnerSide) + '胜',
        Core.colorName(Core.other(winnerSide)) + '认输，本局结束。');
      bumpRecord(app.mode === 'ai' ? (winnerSide === app.side ? 'win' : 'loss') : null);
    }
  }

  /* --------------------------------------------------------------- 落子 */
  function flashBad(index) {
    var btn = points[index];
    if (!btn) return;
    btn.classList.remove('is-bad');
    /* 强制重排，保证连续点击也能重播动画 */
    void btn.offsetWidth;
    btn.classList.add('is-bad');
    if (root.setTimeout) {
      root.setTimeout(function () { btn.classList.remove('is-bad'); }, 320);
    }
  }

  function onPointClick(ev) {
    handleClick(Number(ev.currentTarget.dataset.i));
  }

  function handleClick(index) {
    if (app.over || app.thinking) return;
    if (app.mode === 'ai' && app.state.turn !== app.side) return;

    var state = app.state;
    if (state.board[index]) {
      app.notice = '这里已经有子了';
      render();
      flashBad(index);
      setTimeoutNotice();
      return;
    }
    if (!Core.isLegal(state, index)) {
      app.notice = index === state.ko ? '劫禁：不能立即回提' : '禁着：不能自杀';
      render();
      flashBad(index);
      setTimeoutNotice();
      return;
    }
    doPlay(index);
  }

  var noticeTimer = null;
  function setTimeoutNotice() {
    if (!root.setTimeout) return;
    if (noticeTimer) root.clearTimeout(noticeTimer);
    noticeTimer = root.setTimeout(function () {
      app.notice = '';
      render();
    }, 1600);
  }


  function doPlay(index) {
    var move = Core.play(app.state, index);
    if (!move) return false;
    app.notice = '';
    afterMove();
    return true;
  }

  function doPass() {
    if (app.over || app.thinking) return;
    if (app.mode === 'ai' && app.state.turn !== app.side) return;
    if (!Core.pass(app.state)) return;
    app.notice = '';
    afterMove();
  }

  function afterMove() {
    render();
    syncAll();
    settle();
    if (!app.over) scheduleAI();
  }

  /* --------------------------------------------------------------- 电脑 */
  var aiTimer = null;
  var aiToken = 0;

  function stopAI() {
    aiToken += 1;
    if (aiTimer != null && root.clearTimeout) root.clearTimeout(aiTimer);
    aiTimer = null;
    app.thinking = false;
  }

  function scheduleAI() {
    if (app.over || app.mode !== 'ai' || app.state.turn === app.side) return;
    aiToken += 1;
    var token = aiToken;
    app.thinking = true;
    render();

    var run = function () {
      aiTimer = null;
      if (token !== aiToken) return;
      var choice = null;
      try {
        choice = AI.chooseMove(app.state, { level: app.level });
      } catch (err) {
        choice = null;
      }
      if (token !== aiToken) return;
      app.thinking = false;
      if (app.over) { render(); return; }
      if (!choice) { render(); return; }
      if (choice.type === 'pass' || choice.index < 0) Core.pass(app.state);
      else if (!Core.play(app.state, choice.index)) Core.pass(app.state);
      app.notice = '';
      afterMove();
    };

    if (root.setTimeout) aiTimer = root.setTimeout(run, 260);
    else run();
  }

  /* --------------------------------------------------------------- 指令 */
  function newGame() {
    stopAI();
    app.state = Core.createState();
    app.over = false;
    app.notice = '';
    el('result').hidden = true;
    render();
    syncAll();
    if (app.mode === 'ai' && app.state.turn !== app.side) scheduleAI();
  }

  function undo() {
    if (app.thinking) return;
    if (!app.state.history.length) return;
    stopAI();
    app.over = false;
    app.notice = '';
    el('result').hidden = true;
    Core.undoMove(app.state);
    if (app.mode === 'ai' && app.state.history.length && app.state.turn !== app.side) {
      Core.undoMove(app.state);
    }
    render();
    syncAll();
    if (app.mode === 'ai' && app.state.turn !== app.side) scheduleAI();
  }

  function resign() {
    if (app.over) return;
    stopAI();
    Core.resign(app.state, app.state.turn);
    render();
    settle();
    syncAll();
  }

  function setMode(mode) {
    if (mode !== 'ai' && mode !== 'pvp') return;
    app.mode = mode;
    syncSettings();
    saveSettings();
    newGame();
  }

  function setSide(side) {
    if (side !== Core.BLACK && side !== Core.WHITE) return;
    app.side = side;
    syncSettings();
    saveSettings();
    newGame();
  }

  function setLevel(level) {
    if (!AI.LEVELS[level]) return;
    app.level = level;
    syncSettings();
    saveSettings();
  }

  /* --------------------------------------------------------------- 存档 */
  function loadSettings() {
    try {
      var raw = root.localStorage && root.localStorage.getItem(STORE_KEY);
      if (!raw) return;
      var data = JSON.parse(raw);
      if (data.mode === 'ai' || data.mode === 'pvp') app.mode = data.mode;
      if (data.side === Core.BLACK || data.side === Core.WHITE) app.side = data.side;
      if (AI.LEVELS[data.level]) app.level = data.level;
      if (data.record) {
        app.record.win = data.record.win | 0;
        app.record.draw = data.record.draw | 0;
        app.record.loss = data.record.loss | 0;
      }
    } catch (err) {
      /* 存档坏了就当没有 */
    }
  }

  function saveSettings() {
    try {
      if (!root.localStorage) return;
      root.localStorage.setItem(STORE_KEY, JSON.stringify({
        mode: app.mode,
        side: app.side,
        level: app.level,
        record: app.record
      }));
    } catch (err) {
      /* 隐私模式写不进去也不影响对局 */
    }
  }

  /* --------------------------------------------------------------- 绑定 */
  function bindControls() {
    el('modeRow').addEventListener('click', function (ev) {
      var btn = ev.target.closest ? ev.target.closest('[data-mode]') : null;
      if (btn) setMode(btn.dataset.mode);
    });
    el('sideRow').addEventListener('click', function (ev) {
      var btn = ev.target.closest ? ev.target.closest('[data-side]') : null;
      if (btn) setSide(btn.dataset.side);
    });
    el('levelRow').addEventListener('click', function (ev) {
      var btn = ev.target.closest ? ev.target.closest('[data-level]') : null;
      if (btn) setLevel(btn.dataset.level);
    });
    el('newBtn').addEventListener('click', newGame);
    el('againBtn').addEventListener('click', newGame);
    el('undoBtn').addEventListener('click', undo);
    el('passBtn').addEventListener('click', doPass);
    el('resignBtn').addEventListener('click', resign);
    el('reviewBtn').addEventListener('click', function () {
      el('result').hidden = true;
    });

    doc.addEventListener('keydown', function (ev) {
      if (ev.key === 'u' || ev.key === 'U') undo();
      else if (ev.key === 'p' || ev.key === 'P') doPass();
    });
  }

  function init() {
    loadSettings();
    buildGrid();
    buildPoints();
    bindControls();
    syncSettings();
    newGame();
    render();
    syncAll();
  }

  root.GoGame = {
    get state() { return app.state; },
    get app() { return app; },
    pointEls: function () { return points; },
    click: handleClick,
    pass: doPass,
    newGame: newGame,
    undo: undo,
    resign: resign,
    render: render,
    syncAll: syncAll,
    setMode: setMode,
    setSide: setSide,
    setLevel: setLevel,
    el: el
  };

  if (doc.readyState === 'loading') {
    doc.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})(typeof window !== 'undefined' ? window : globalThis);
