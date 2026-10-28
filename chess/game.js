/* 国际象棋 · 界面与交互层
 * 规则全部来自 logic.js（window.ChessCore），这里只负责棋盘渲染、点选落子、
 * 升变选择、棋谱/被吃子展示、悔棋与存档，人机对战由 ai.js 出招。
 */
(function (root) {
  'use strict';

  var Core = root.ChessCore;
  var AI = root.ChessAI;
  var STORE_KEY = 'chess.v1';
  var FILES = 'abcdefgh';
  var GLYPH = { K: '♚', Q: '♛', R: '♜', B: '♝', N: '♞', P: '♟' };
  var TYPE_NAME = { K: '王', Q: '后', R: '车', B: '象', N: '马', P: '兵' };

  var app = {
    state: Core.createState(),
    mode: 'ai',
    level: 'normal',
    side: Core.WHITE,
    flipped: false,
    selected: -1,
    targets: [],
    lastMove: null,
    pending: null,
    thinking: false,
    over: false,
    result: null,
    record: { wins: 0, draws: 0, losses: 0 }
  };

  var ui = {};

  /* --------------------------------------------------------------- 基础 */
  function sideName(color) { return color === Core.WHITE ? '白方' : '黑方'; }

  function boardIndexAt(displayIndex) {
    return app.flipped ? 63 - displayIndex : displayIndex;
  }

  function isDarkSquare(index) {
    return (((index >> 3) + (index & 7)) % 2) === 1;
  }

  function humanColor() {
    return app.mode === 'ai' ? app.side : app.state.turn;
  }

  function canAct() {
    if (app.over || app.thinking || app.pending) return false;
    return app.mode !== 'ai' || app.state.turn === app.side;
  }

  /* --------------------------------------------------------------- 建盘 */
  function buildBoard() {
    ui.squares = [];
    ui.board.textContent = '';
    for (var d = 0; d < 64; d += 1) {
      var sq = root.document.createElement('button');
      sq.type = 'button';
      sq.className = 'sq';
      sq.setAttribute('role', 'gridcell');

      var pc = root.document.createElement('span');
      pc.className = 'pc';
      sq.appendChild(pc);

      var file = root.document.createElement('span');
      file.className = 'coord file';
      sq.appendChild(file);

      var rank = root.document.createElement('span');
      rank.className = 'coord rank';
      sq.appendChild(rank);

      (function (displayIndex) {
        sq.addEventListener('click', function () { onSquare(boardIndexAt(displayIndex)); });
      })(d);

      ui.board.appendChild(sq);
      ui.squares.push(sq);
    }
  }

  function ariaFor(index, piece) {
    var where = FILES.charAt(index & 7) + Core.rankOf(index);
    if (!piece) return where + ' 空格';
    return where + ' ' + sideName(Core.colorOf(piece)) + TYPE_NAME[Core.typeOf(piece)];
  }

  /* --------------------------------------------------------------- 渲染 */
  function render() {
    var state = app.state;
    var checkSquare = state.status === 'check' || state.status === 'checkmate' ? state.checkSquare : -1;
    var last = app.lastMove;

    for (var d = 0; d < 64 && ui.squares; d += 1) {
      var index = boardIndexAt(d);
      var sq = ui.squares[d];
      var piece = state.board[index];
      var classes = 'sq' + (isDarkSquare(index) ? ' dark' : '');

      if (app.selected === index) classes += ' sel';
      else if (app.targets.indexOf(index) >= 0) classes += piece ? ' take' : ' move';
      if (last && (last.from === index || last.to === index)) classes += ' last';
      if (checkSquare === index) classes += ' check';

      sq.className = classes;
      sq.dataset.i = String(index);
      sq.setAttribute('aria-label', ariaFor(index, piece));
      if (app.selected === index) sq.setAttribute('aria-selected', 'true');
      else sq.removeAttribute('aria-selected');

      var pc = sq.children[0];
      if (pc) {
        pc.className = 'pc' + (piece ? (Core.colorOf(piece) === Core.WHITE ? ' white' : ' black') : '');
        pc.textContent = piece ? GLYPH[Core.typeOf(piece)] : '';
      }

      var col = d & 7;
      var row = d >> 3;
      var fileEl = sq.children[1];
      var rankEl = sq.children[2];
      if (fileEl) fileEl.textContent = row === 7 ? FILES.charAt(index & 7) : '';
      if (rankEl) rankEl.textContent = col === 0 ? String(Core.rankOf(index)) : '';
    }

    syncStatus();
  }

  function syncStatus() {
    var state = app.state;
    var text;
    var chipClass = 'turn-chip';

    if (app.over && app.result) {
      text = app.result.short;
      chipClass += ' is-over';
    } else if (app.thinking) {
      text = '电脑思考中…';
      chipClass += state.turn === Core.BLACK ? ' is-black' : '';
    } else if (state.status === 'check') {
      text = sideName(state.turn) + '被将军';
      chipClass += ' is-check';
    } else {
      text = sideName(state.turn) + '走棋';
      if (state.turn === Core.BLACK) chipClass += ' is-black';
      if (app.mode === 'ai') text += state.turn === app.side ? '（你）' : '（电脑）';
    }

    if (ui.statusText) ui.statusText.textContent = text;
    if (ui.statusChip) ui.statusChip.className = chipClass;
    if (ui.liveStatus) ui.liveStatus.textContent = text;
    if (ui.undoBtn) ui.undoBtn.disabled = !state.history.length || app.thinking;
    if (ui.resignBtn) ui.resignBtn.disabled = app.over;
  }

  /* --------------------------------------------------------------- 落子 */
  function clearSelection() {
    app.selected = -1;
    app.targets = [];
  }

  function onSquare(index) {
    if (!ui.board || app.over || app.pending) return;
    if (!canAct()) return;
    var state = app.state;

    if (app.selected >= 0 && index !== app.selected && app.targets.indexOf(index) >= 0) {
      var choices = Core.movesFrom(state, app.selected).filter(function (move) { return move.to === index; });
      if (!choices.length) { clearSelection(); render(); return; }
      if (choices.length > 1 && choices[0].promotion) { askPromotion(app.selected, index); return; }
      doMove(app.selected, index, choices[0].promotion);
      return;
    }

    if (app.selected === index) { clearSelection(); render(); return; }

    var piece = state.board[index];
    if (piece && Core.colorOf(piece) === state.turn) {
      app.selected = index;
      app.targets = Core.targetsFrom(state, index);
    } else {
      clearSelection();
    }
    render();
  }

  function doMove(from, to, promotion) {
    var move = Core.moveAt(app.state, from, to, promotion);
    if (!move) return false;

    var applied = Core.applyMove(app.state, move);
    app.lastMove = { from: move.from, to: move.to };
    clearSelection();
    app.pending = null;
    if (ui.promote) ui.promote.hidden = true;

    if (applied.status === 'checkmate' || applied.status === 'stalemate' || applied.status === 'draw') {
      app.over = true;
      app.result = describeResult(applied);
      writeRecord(app.result.outcome);
      showResult();
    }

    render();
    syncMoves();
    syncCaptured();
    syncRecord();

    if (!app.over && app.mode === 'ai' && app.state.turn !== app.side) scheduleAI();
    return true;
  }

  function askPromotion(from, to) {
    app.pending = { from: from, to: to };
    var color = Core.colorOf(app.state.board[from]);
    if (!ui.promote || !ui.promoRow) { doMove(from, to, 'Q'); return; }

    ui.promoRow.textContent = '';
    Core.PROMOTIONS.forEach(function (type) {
      var btn = root.document.createElement('button');
      btn.type = 'button';
      btn.className = 'promo-btn ' + (color === Core.WHITE ? 'white' : 'black');
      btn.textContent = GLYPH[type];
      btn.setAttribute('aria-label', '升变为' + TYPE_NAME[type]);
      btn.addEventListener('click', function () {
        var pending = app.pending;
        if (!pending) return;
        doMove(pending.from, pending.to, type);
      });
      ui.promoRow.appendChild(btn);
    });
    ui.promote.hidden = false;
    render();
  }

  function cancelPromotion() {
    app.pending = null;
    if (ui.promote) ui.promote.hidden = true;
    clearSelection();
    render();
  }

  /* --------------------------------------------------------------- 电脑 */
  var aiTimer = null;
  var aiToken = 0;

  /* 作废未执行的思考任务：重开/悔棋/认输时调用，避免旧计时器在新局面上落子 */
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
      if (app.over) { render(); return; }
      if (!move) { render(); return; }
      doMove(move.from, move.to, move.promotion);
    };

    if (root.setTimeout) aiTimer = root.setTimeout(run, 280);
    else run();
  }

  /* --------------------------------------------------------------- 结算 */
  function describeResult(applied) {
    var reasonText = {
      stalemate: '对手无子可动且未被将军，判为逼和。',
      fifty: '连续 50 回合没有吃子或动兵，按规则判和。',
      insufficient: '双方子力不足以将死对方，判和。',
      repetition: '同一局面出现三次，判和。'
    };
    if (applied.winner) {
      var humanWin = applied.winner === app.side;
      var title = app.mode === 'ai'
        ? (humanWin ? '你赢了' : '电脑获胜')
        : sideName(applied.winner) + '胜';
      return {
        short: sideName(applied.winner) + '胜 · 将死',
        kicker: '将死',
        title: title,
        copy: sideName(applied.winner) + '把对方的王将死，对局结束。',
        outcome: app.mode === 'ai' ? (humanWin ? 'win' : 'loss') : 'local'
      };
    }
    return {
      short: '和棋',
      kicker: '和棋',
      title: '和棋',
      copy: reasonText[applied.reason] || '双方平分秋色。',
      outcome: 'draw'
    };
  }

  function showResult() {
    if (!ui.result || !app.result) return;
    if (ui.resultKicker) ui.resultKicker.textContent = app.result.kicker;
    if (ui.resultTitle) ui.resultTitle.textContent = app.result.title;
    if (ui.resultCopy) ui.resultCopy.textContent = app.result.copy;
    ui.result.hidden = false;
  }

  function hideResult() {
    if (ui.result) ui.result.hidden = true;
  }

  /* --------------------------------------------------------------- 棋谱 */
  function syncMoves() {
    var history = app.state.history;
    if (ui.moveCount) ui.moveCount.textContent = history.length + ' 手';
    if (!ui.moveList) return;

    ui.moveList.textContent = '';
    if (!history.length) {
      var empty = root.document.createElement('li');
      empty.className = 'moves-empty';
      empty.textContent = '还没有落子';
      ui.moveList.appendChild(empty);
      return;
    }

    for (var i = 0; i < history.length; i += 2) {
      var li = root.document.createElement('li');
      var no = root.document.createElement('span');
      no.className = 'no';
      no.textContent = (i / 2 + 1) + '.';
      li.appendChild(no);

      for (var k = 0; k < 2; k += 1) {
        var entry = history[i + k];
        var ply = root.document.createElement('span');
        ply.className = 'ply' + (entry && i + k === history.length - 1 ? ' latest' : '');
        ply.textContent = entry ? entry.san : '';
        li.appendChild(ply);
      }
      ui.moveList.appendChild(li);
    }

    if (typeof ui.moveList.scrollTop === 'number') {
      ui.moveList.scrollTop = ui.moveList.scrollHeight || 0;
    }
  }

  function syncCaptured() {
    var taken = { w: [], b: [] };
    app.state.history.forEach(function (entry) {
      var captured = entry.move.captured;
      if (!captured) return;
      var taker = Core.colorOf(captured) === Core.WHITE ? 'b' : 'w';
      taken[taker].push({ type: Core.typeOf(captured), color: Core.colorOf(captured) });
    });

    renderCaptured(ui.capturedW, taken.w);
    renderCaptured(ui.capturedB, taken.b);

    var values = (AI && AI.VALUE) || { P: 100, N: 320, B: 330, R: 500, Q: 900, K: 0 };
    var score = function (list) {
      return list.reduce(function (sum, item) { return sum + (values[item.type] || 0); }, 0);
    };
    var diff = Math.round((score(taken.w) - score(taken.b)) / 100);
    if (ui.materialNote) {
      ui.materialNote.textContent = diff === 0 ? '子力持平'
        : diff > 0 ? '白多 ' + diff : '黑多 ' + (-diff);
    }
  }

  function renderCaptured(el, list) {
    if (!el) return;
    el.textContent = '';
    if (!list.length) { el.textContent = '—'; return; }
    list.sort(function (a, b) {
      var values = (AI && AI.VALUE) || {};
      return (values[b.type] || 0) - (values[a.type] || 0);
    });
    list.forEach(function (item) {
      var span = root.document.createElement('span');
      span.className = 'cap-piece ' + (item.color === Core.WHITE ? 'white' : 'black');
      span.textContent = GLYPH[item.type];
      el.appendChild(span);
    });
  }

  /* --------------------------------------------------------------- 存档 */
  function storage() {
    try {
      return root.localStorage || null;
    } catch (err) {
      return null;
    }
  }

  function loadStore() {
    var ls = storage();
    if (!ls) return;
    try {
      var raw = ls.getItem(STORE_KEY);
      if (!raw) return;
      var data = JSON.parse(raw) || {};
      var record = data.record || {};
      app.record.wins = Number(record.wins) || 0;
      app.record.draws = Number(record.draws) || 0;
      app.record.losses = Number(record.losses) || 0;
      if (data.mode === 'ai' || data.mode === 'pvp') app.mode = data.mode;
      if (data.level === 'easy' || data.level === 'normal' || data.level === 'hard') app.level = data.level;
      if (data.side === 'w' || data.side === 'b') app.side = data.side;
    } catch (err) {
      /* 存档损坏时按默认设置开局 */
    }
  }

  function saveStore() {
    var ls = storage();
    if (!ls) return;
    try {
      ls.setItem(STORE_KEY, JSON.stringify({
        record: app.record,
        mode: app.mode,
        level: app.level,
        side: app.side
      }));
    } catch (err) {
      /* 隐私模式下写入失败不影响对局 */
    }
  }

  function writeRecord(outcome) {
    if (outcome === 'win') app.record.wins += 1;
    else if (outcome === 'loss') app.record.losses += 1;
    else if (outcome === 'draw') app.record.draws += 1;
    else return;
    saveStore();
  }

  function syncRecord() {
    if (!ui.recVal) return;
    ui.recVal.textContent = app.record.wins + ' 胜 ' + app.record.draws + ' 和 ' + app.record.losses + ' 负';
  }

  /* --------------------------------------------------------------- 操作 */
  function newGame() {
    stopAI();
    app.state = Core.createState();
    app.over = false;
    app.pending = null;
    app.result = null;
    app.lastMove = null;
    clearSelection();
    if (ui.promote) ui.promote.hidden = true;
    hideResult();
    render();
    syncMoves();
    syncCaptured();
    syncRecord();
    if (app.mode === 'ai' && app.state.turn !== app.side) scheduleAI();
  }

  function undo() {
    if (app.thinking) return;
    if (!app.state.history.length) return;
    stopAI();
    app.over = false;
    app.result = null;
    hideResult();
    app.pending = null;
    if (ui.promote) ui.promote.hidden = true;

    Core.undoMove(app.state);
    while (app.mode === 'ai' && app.state.turn !== app.side && app.state.history.length) {
      Core.undoMove(app.state);
    }

    var last = app.state.history[app.state.history.length - 1];
    app.lastMove = last ? { from: last.move.from, to: last.move.to } : null;
    clearSelection();
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
    var winner = Core.other(app.state.turn);
    var humanWin = winner === app.side;
    app.over = true;
    app.result = {
      short: sideName(winner) + '胜 · 认输',
      kicker: '认输',
      title: app.mode === 'ai'
        ? (humanWin ? '你赢了' : '你认输了')
        : sideName(winner) + '胜',
      copy: sideName(Core.other(winner)) + '认输，' + sideName(winner) + '获胜。',
      outcome: app.mode === 'ai' ? (humanWin ? 'win' : 'loss') : 'local'
    };
    writeRecord(app.result.outcome);
    showResult();
    render();
    syncRecord();
  }

  function setMode(mode) {
    if (mode !== 'ai' && mode !== 'pvp') return;
    app.mode = mode;
    syncSegs();
    saveStore();
    newGame();
  }

  function setLevel(level) {
    if (['easy', 'normal', 'hard'].indexOf(level) < 0) return;
    app.level = level;
    syncSegs();
    saveStore();
  }

  function setSide(side) {
    if (side !== 'w' && side !== 'b') return;
    app.side = side;
    app.flipped = side === 'b';
    syncSegs();
    saveStore();
    newGame();
  }

  /* --------------------------------------------------------------- 绑定 */
  function cacheDom() {
    var doc = root.document;
    ['board', 'statusChip', 'statusText', 'liveStatus', 'modeRow', 'sideRow', 'sideGroup',
      'levelRow', 'levelGroup', 'newBtn', 'undoBtn', 'flipBtn', 'resignBtn', 'moveList',
      'moveCount', 'capturedW', 'capturedB', 'materialNote', 'recVal', 'result',
      'resultKicker', 'resultTitle', 'resultCopy', 'againBtn', 'reviewBtn', 'promote', 'promoRow'
    ].forEach(function (id) {
      ui[id] = doc.getElementById(id);
    });
  }

  function bindSeg(container, attr, handler) {
    if (!container || !container.children) return;
    for (var i = 0; i < container.children.length; i += 1) {
      (function (node) {
        if (!node || !node.dataset || node.dataset[attr] == null) return;
        node.addEventListener('click', function () { handler(node.dataset[attr]); });
      })(container.children[i]);
    }
  }

  function syncSegs() {
    markSeg(ui.modeRow, 'mode', app.mode);
    markSeg(ui.levelRow, 'level', app.level);
    markSeg(ui.sideRow, 'side', app.side);
    if (ui.sideGroup) ui.sideGroup.hidden = app.mode !== 'ai';
    if (ui.levelGroup) ui.levelGroup.hidden = app.mode !== 'ai';
  }

  function markSeg(container, attr, value) {
    if (!container || !container.children) return;
    for (var i = 0; i < container.children.length; i += 1) {
      var node = container.children[i];
      if (!node || !node.dataset || node.dataset[attr] == null) continue;
      var on = node.dataset[attr] === value;
      node.className = 'seg-btn' + (on ? ' is-on' : '');
      node.setAttribute('aria-pressed', on ? 'true' : 'false');
    }
  }

  function bindEvents() {
    bindSeg(ui.modeRow, 'mode', setMode);
    bindSeg(ui.levelRow, 'level', setLevel);
    bindSeg(ui.sideRow, 'side', setSide);

    on(ui.newBtn, 'click', newGame);
    on(ui.undoBtn, 'click', undo);
    on(ui.flipBtn, 'click', flip);
    on(ui.resignBtn, 'click', resign);
    on(ui.againBtn, 'click', newGame);
    on(ui.reviewBtn, 'click', hideResult);
    on(root.document, 'keydown', onKey);
  }

  function on(node, type, handler) {
    if (node && node.addEventListener) node.addEventListener(type, handler);
  }

  function onKey(event) {
    if (!event || !event.key) return;
    var key = String(event.key).toLowerCase();
    if (key === 'escape') {
      if (app.pending) cancelPromotion();
      else { clearSelection(); render(); }
    } else if (key === 'u') {
      undo();
    } else if (key === 'f') {
      flip();
    }
  }

  function boot() {
    if (!root.document) return;
    cacheDom();
    if (!ui.board) return;
    loadStore();
    buildBoard();
    bindEvents();
    syncSegs();
    syncRecord();
    newGame();
  }

  root.ChessGame = {
    get state() { return app.state; },
    get over() { return app.over; },
    get thinking() { return app.thinking; },
    get result() { return app.result; },
    get record() { return app.record; },
    get app() { return app; },
    newGame: newGame,
    undo: undo,
    flip: flip,
    resign: resign,
    click: onSquare,
    setMode: setMode,
    setLevel: setLevel,
    setSide: setSide,
    targets: function () { return app.targets.slice(); },
    selected: function () { return app.selected; },
    render: render,
    boot: boot
  };

  if (root.document) {
    if (root.document.readyState === 'loading') {
      root.document.addEventListener('DOMContentLoaded', boot);
    } else {
      boot();
    }
  }
})(typeof window !== 'undefined' ? window : globalThis);
