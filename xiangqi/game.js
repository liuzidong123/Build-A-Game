/* 中国象棋 · 界面与对局流程（依赖 logic.js / ai.js） */
(function (root) {
  'use strict';

  var doc = root.document;
  var Core = root.XiangqiCore;
  var AI = root.XiangqiAI;
  var STORE_KEY = 'xiangqi.v1';
  var LEVEL_LABEL = { easy: '简单', normal: '普通', hard: '困难' };

  function el(id) { return doc.getElementById(id); }

  var app = {
    state: Core.createState(),
    mode: 'ai',
    side: 'r',
    level: 'normal',
    flipped: false,
    selected: -1,
    targets: [],
    last: null,
    over: false,
    thinking: false,
    record: { win: 0, draw: 0, loss: 0 }
  };

  var points = [];

  /* --------------------------------------------------------------- 静态棋盘 */
  function buildGrid() {
    var svg = el('grid');
    if (!svg || svg.children.length) return;
    var ns = 'http://www.w3.org/2000/svg';
    function line(x1, y1, x2, y2, cls) {
      var node = doc.createElementNS(ns, 'line');
      node.setAttribute('x1', x1);
      node.setAttribute('y1', y1);
      node.setAttribute('x2', x2);
      node.setAttribute('y2', y2);
      if (cls) node.setAttribute('class', cls);
      svg.appendChild(node);
    }
    var i;
    for (i = 0; i < Core.ROWS; i += 1) {
      line(50, 50 + i * 100, 850, 50 + i * 100, (i === 0 || i === Core.ROWS - 1) ? 'frame' : '');
    }
    for (i = 0; i < Core.COLS; i += 1) {
      var x = 50 + i * 100;
      if (i === 0 || i === Core.COLS - 1) {
        line(x, 50, x, 950, 'frame');
      } else {
        line(x, 50, x, 450);
        line(x, 550, x, 950);
      }
    }
    /* 两座九宫的斜线 */
    line(350, 250, 550, 50);
    line(350, 50, 550, 250);
    line(350, 750, 550, 950);
    line(350, 950, 550, 750);
  }

  function buildPoints() {
    var box = el('pieces');
    if (!box) return;
    for (var i = 0; i < Core.COLS * Core.ROWS; i += 1) {
      var btn = doc.createElement('button');
      btn.type = 'button';
      btn.className = 'pt';
      btn.dataset.i = String(i);
      btn.setAttribute('role', 'gridcell');
      var stone = doc.createElement('span');
      stone.className = 'stone';
      btn.appendChild(stone);
      btn.addEventListener('click', onPointClick);
      box.appendChild(btn);
      points.push(btn);
    }
  }

  /* --------------------------------------------------------------- 渲染 */
  function displayPos(index) {
    var row = Core.rowOf(index);
    var col = Core.colOf(index);
    return {
      row: app.flipped ? Core.ROWS - 1 - row : row,
      col: app.flipped ? Core.COLS - 1 - col : col
    };
  }

  function render() {
    var board = app.state.board;
    var sideLabel = app.state.turn === Core.RED ? '红方' : '黑方';
    for (var i = 0; i < points.length; i += 1) {
      var btn = points[i];
      var pos = displayPos(i);
      btn.style.setProperty('--col', String(pos.col));
      btn.style.setProperty('--row', String(pos.row));

      var piece = board[i];
      var stone = btn.firstChild;
      /* 空交叉点不画棋子，只保留可落子 / 吃子提示 */
      stone.textContent = piece ? Core.pieceName(piece) : '';
      stone.className = piece
        ? 'stone ' + (Core.colorOf(piece) === Core.RED ? 'r' : 'b')
        : 'stone empty';
      btn.classList.toggle('has-piece', !!piece);
      btn.classList.toggle('is-sel', app.selected === i);
      btn.classList.toggle('is-target', app.targets.indexOf(i) >= 0);
      btn.classList.toggle('is-last', !!app.last && (app.last.from === i || app.last.to === i));
      btn.classList.toggle('is-check', app.state.checkSquare === i);
      btn.setAttribute('aria-label', Core.squareName(i) + (piece ? ' ' + Core.pieceName(piece) : ' 空'));
    }

    var chip = el('statusChip');
    var text = sideLabel + '走棋';
    if (app.over) {
      text = app.state.status === 'draw' ? '本局和棋' : (app.state.winner === Core.RED ? '红方胜' : '黑方胜');
    } else if (app.thinking) {
      text = '电脑思考中…';
    } else if (app.state.status === 'check') {
      text = sideLabel + '被将军';
    } else if (app.mode === 'ai' && app.state.turn !== app.side) {
      text = '电脑走棋';
    }
    el('statusText').textContent = text;
    chip.classList.toggle('is-black', !app.over && app.state.turn === Core.BLACK);
    chip.classList.toggle('is-over', app.over);
    el('liveStatus').textContent = text;
    el('turnDot').setAttribute('aria-hidden', 'true');
  }

  /* --------------------------------------------------------------- 选择与落子 */
  function clearSelection() {
    app.selected = -1;
    app.targets = [];
  }

  function select(index) {
    app.selected = index;
    app.targets = Core.targetsFrom(app.state, index);
    render();
  }

  function onPointClick(ev) {
    handleClick(Number(ev.currentTarget.dataset.i));
  }

  function handleClick(index) {
    if (app.over || app.thinking) return;
    if (app.mode === 'ai' && app.state.turn !== app.side) return;
    if (app.selected >= 0 && app.targets.indexOf(index) >= 0) {
      doMove(app.selected, index);
      return;
    }
    var piece = app.state.board[index];
    if (piece && Core.colorOf(piece) === app.state.turn) {
      select(index);
    } else if (app.selected >= 0) {
      clearSelection();
      render();
    }
  }

  function doMove(from, to) {
    var move = Core.moveAt(app.state, from, to);
    if (!move) return false;
    Core.applyMove(app.state, move);
    app.last = { from: from, to: to };
    clearSelection();
    afterMove();
    return true;
  }

  function afterMove() {
    render();
    syncMoves();
    syncCaptured();
    settle();
    if (!app.over) scheduleAI();
  }

  /* --------------------------------------------------------------- 结算 */
  function showResult(kicker, title, copy) {
    el('resultKicker').textContent = kicker;
    el('resultTitle').textContent = title;
    el('resultCopy').textContent = copy;
    el('result').hidden = false;
  }

  function settle() {
    var state = app.state;
    if (state.status === 'playing' || state.status === 'check') return;
    app.over = true;
    app.thinking = false;

    if (state.status === 'draw') {
      var why = state.reason === 'repetition' ? '同一局面出现三次，按例判和。' : '长时间没有吃子，按例判和。';
      showResult('本局和棋', '和棋', why);
      bumpRecord('draw');
      return;
    }

    var redWin = state.winner === Core.RED;
    var title = redWin ? '红方胜' : '黑方胜';
    var loser = redWin ? '黑方' : '红方';
    var copy = state.reason === 'stalemate'
      ? loser + '无子可走，困毙判负。'
      : loser + '被将死，' + (redWin ? '红方' : '黑方') + '获胜。';
    showResult('本局结束', title, copy);
    bumpRecord(app.mode === 'ai' ? (state.winner === app.side ? 'win' : 'loss') : null);
  }

  /* --------------------------------------------------------------- 电脑 */
  var aiTimer = null;
  var aiToken = 0;

  /* 作废旧任务：重开 / 悔棋 / 认输时调用，避免旧计时器在新局面上落子 */
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
      var move = null;
      try {
        move = AI.chooseMove(app.state, { level: app.level });
      } catch (err) {
        move = null;
      }
      if (token !== aiToken) return;
      app.thinking = false;
      if (app.over || !move) { render(); return; }
      doMove(move.from, move.to);
    };

    if (root.setTimeout) aiTimer = root.setTimeout(run, 240);
    else run();
  }

  /* --------------------------------------------------------------- 侧栏同步 */
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
        var li = doc.createElement('li');
        li.className = 'ply';
        var who = doc.createElement('span');
        who.className = 'who ' + item.color;
        who.textContent = item.color === Core.RED ? '红' : '黑';
        var txt = doc.createElement('span');
        txt.className = 'txt';
        txt.textContent = item.san;
        li.appendChild(who);
        li.appendChild(txt);
        list.appendChild(li);
      });
      list.scrollTop = list.scrollHeight;
    }
    el('moveCount').textContent = history.length + ' 手';
  }

  function materialDiff() {
    var sum = 0;
    app.state.board.forEach(function (piece) {
      if (!piece) return;
      var type = Core.typeOf(piece);
      if (type === 'K') return;
      sum += (Core.colorOf(piece) === Core.RED ? 1 : -1) * (AI.value[type] || 0);
    });
    return sum;
  }

  function syncCaptured() {
    var redEat = [];
    var blackEat = [];
    app.state.history.forEach(function (item) {
      if (!item.move.captured) return;
      var name = Core.pieceName(item.move.captured);
      if (item.color === Core.RED) redEat.push(name);
      else blackEat.push(name);
    });
    el('capturedR').textContent = redEat.length ? redEat.join(' ') : '—';
    el('capturedB').textContent = blackEat.length ? blackEat.join(' ') : '—';

    var diff = materialDiff();
    el('materialNote').textContent = diff === 0
      ? '子力持平'
      : (diff > 0 ? '红方多 ' + diff : '黑方多 ' + (-diff));
  }

  function syncRecord() {
    el('recVal').textContent = app.record.win + ' 胜 ' + app.record.draw + ' 和 ' + app.record.loss + ' 负';
  }

  function bumpRecord(kind) {
    if (!kind) {
      syncRecord();
      return;
    }
    if (kind === 'win') app.record.win += 1;
    else if (kind === 'draw') app.record.draw += 1;
    else app.record.loss += 1;
    syncRecord();
    saveSettings();
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

  /* --------------------------------------------------------------- 指令 */
  function newGame() {
    stopAI();
    app.state = Core.createState();
    app.over = false;
    app.selected = -1;
    app.targets = [];
    app.last = null;
    app.flipped = app.mode === 'ai' && app.side === Core.BLACK;
    el('result').hidden = true;
    render();
    syncMoves();
    syncCaptured();
    if (app.mode === 'ai' && app.state.turn !== app.side) scheduleAI();
  }

  function undo() {
    if (app.thinking) return;
    if (!app.state.history.length) return;
    stopAI();
    app.over = false;
    el('result').hidden = true;
    Core.undoMove(app.state);
    /* 人机模式连退两手，让玩家重新走自己那一步 */
    if (app.mode === 'ai' && app.state.history.length && app.state.turn !== app.side) {
      Core.undoMove(app.state);
    }
    var last = app.state.history[app.state.history.length - 1];
    app.last = last ? { from: last.move.from, to: last.move.to } : null;
    app.selected = -1;
    app.targets = [];
    render();
    syncMoves();
    syncCaptured();
    if (app.mode === 'ai' && app.state.turn !== app.side) scheduleAI();
  }

  function flip() {
    app.flipped = !app.flipped;
    render();
  }

  function resign() {
    if (app.over) return;
    stopAI();
    app.over = true;
    var loser = app.state.turn;
    var winner = Core.other(loser);
    app.state.status = 'resign';
    app.state.winner = winner;
    render();
    showResult('认输', winner === Core.RED ? '红方胜' : '黑方胜',
      (loser === Core.RED ? '红方' : '黑方') + '认输，本局结束。');
    bumpRecord(app.mode === 'ai' ? (winner === app.side ? 'win' : 'loss') : null);
  }

  function setMode(mode) {
    if (mode !== 'ai' && mode !== 'pvp') return;
    app.mode = mode;
    syncSettings();
    saveSettings();
    newGame();
  }

  function setSide(side) {
    if (side !== Core.RED && side !== Core.BLACK) return;
    app.side = side;
    syncSettings();
    saveSettings();
    newGame();
  }

  function setLevel(level) {
    if (!LEVEL_LABEL[level]) return;
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
      if (data.side === Core.RED || data.side === Core.BLACK) app.side = data.side;
      if (LEVEL_LABEL[data.level]) app.level = data.level;
      if (data.record) {
        app.record.win = data.record.win | 0;
        app.record.draw = data.record.draw | 0;
        app.record.loss = data.record.loss | 0;
      }
    } catch (err) {
      /* 存档损坏就当没有 */
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

  /* --------------------------------------------------------------- 事件绑定 */
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
    el('flipBtn').addEventListener('click', flip);
    el('resignBtn').addEventListener('click', resign);
    el('reviewBtn').addEventListener('click', function () {
      el('result').hidden = true;
    });

    doc.addEventListener('keydown', function (ev) {
      if (ev.key === 'Escape') {
        clearSelection();
        render();
      } else if (ev.key === 'u' || ev.key === 'U') {
        undo();
      }
    });
  }

  function init() {
    loadSettings();
    buildGrid();
    buildPoints();
    bindControls();
    syncSettings();
    syncRecord();
    newGame();
    render();
  }

  root.XiangqiGame = {
    get state() { return app.state; },
    get app() { return app; },
    pointEls: function () { return points; },
    click: handleClick,
    targets: function () { return app.targets.slice(); },
    newGame: newGame,
    undo: undo,
    resign: resign,
    flip: flip,
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
