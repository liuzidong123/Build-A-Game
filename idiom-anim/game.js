/* 猜成语动图 · 界面与对局控制 */
(function () {
  'use strict';

  var Core = window.IdiomCore;
  var BANK = window.IDIOM_BANK || [];
  var ANIMS = window.IDIOM_ANIMS || ['bob'];
  var ROUND = Core.ROUND_SECONDS;
  var BOARD_KEY = 'idiom-anim.board.v1';
  var NAME_KEY = 'idiom-anim.name.v1';

  function $(id) { return document.getElementById(id); }
  var ui = {
    hud: $('hud'), score: $('scoreVal'), clock: $('clockVal'), streak: $('streakVal'),
    start: $('startScreen'), play: $('playScreen'), over: $('overScreen'),
    name: $('nameInput'), startBtn: $('startBtn'), hint: $('boardHint'), startBoard: $('startBoard'),
    qIndex: $('qIndex'), qLen: $('qLen'), tiles: $('tiles'), slots: $('slots'),
    form: $('guessForm'), input: $('guessInput'), submit: $('submitBtn'),
    log: $('guessLog'), reveal: $('revealBtn'), pause: $('pauseBtn'), end: $('endBtn'),
    finalScore: $('finalScore'), finalRank: $('finalRank'), finalCorrect: $('finalCorrect'),
    finalWrong: $('finalWrong'), finalAcc: $('finalAcc'), finalStreak: $('finalStreak'),
    saveName: $('saveName'), saveBtn: $('saveBtn'), overBoard: $('overBoard'),
    restart: $('restartBtn'), home: $('homeBtn'),
    pauseOverlay: $('pauseOverlay'), resume: $('resumeBtn'),
    toast: $('toast'), confetti: $('confetti')
  };

  var game = null;
  var timerId = null;
  var deadline = 0;
  var remaining = ROUND;
  var paused = false;
  var locked = false;
  var saved = false;
  var composing = false;
  var lastPlayer = '';

  /* ------------------------------------------------------------ 排行榜 */
  function loadBoard() {
    try {
      var raw = localStorage.getItem(BOARD_KEY);
      var list = raw ? JSON.parse(raw) : [];
      return Array.isArray(list) ? list.filter(function (r) { return r && typeof r.score === 'number'; }) : [];
    } catch (e) { return []; }
  }

  function saveBoard(list) {
    try { localStorage.setItem(BOARD_KEY, JSON.stringify(list.slice(0, 50))); } catch (e) { /* 隐私模式忽略 */ }
  }

  function escapeHtml(text) {
    return String(text).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  }

  function renderBoard(target, highlightId) {
    var list = Core.rankEntries(loadBoard()).slice(0, 10);
    if (!list.length) {
      target.innerHTML = '<p class="board-empty">还没有成绩，快来抢第一。</p>';
      return;
    }
    target.innerHTML = list.map(function (row, i) {
      var total = (row.correct || 0) + (row.wrong || 0);
      return '<div class="board-row' + (row.id === highlightId ? ' is-new' : '') + '">' +
        '<span class="rank rank-' + (i + 1) + '">' + (i + 1) + '</span>' +
        '<span class="who">' + escapeHtml(row.name) + '</span>' +
        '<span class="cnt">对 ' + (row.correct || 0) + ' / ' + total + '</span>' +
        '<strong class="pts">' + row.score + '</strong>' +
        '</div>';
    }).join('');
  }

  function refreshStartBoard() {
    var board = loadBoard();
    renderBoard(ui.startBoard);
    if (!board.length) {
      ui.hint.textContent = '还没有记录，本局将成为第一个成绩。';
      return;
    }
    var top = Core.rankEntries(board)[0];
    ui.hint.textContent = '当前最高分：' + top.score + ' 分（' + top.name + '）';
  }

  /* --------------------------------------------------------------- 计时 */
  function stopTimer() {
    if (timerId) { clearInterval(timerId); timerId = null; }
  }

  function tick() {
    if (!game || paused) return;
    remaining = Math.max(0, (deadline - Date.now()) / 1000);
    ui.clock.textContent = Core.formatClock(remaining);
    ui.clock.classList.toggle('is-urgent', remaining <= 60);
    if (remaining <= 0) {
      stopTimer();
      endRound('time');
    }
  }

  function startTimer() {
    deadline = Date.now() + remaining * 1000;
    stopTimer();
    tick();
    timerId = setInterval(tick, 200);
  }

  function pauseRound() {
    if (!game || paused || remaining <= 0) return;
    remaining = Math.max(0, (deadline - Date.now()) / 1000);
    paused = true;
    stopTimer();
    ui.pauseOverlay.hidden = false;
  }

  function resumeRound() {
    if (!paused) return;
    paused = false;
    ui.pauseOverlay.hidden = true;
    startTimer();
    ui.input.focus();
  }

  /* --------------------------------------------------------------- 画面 */
  function showScreen(name) {
    ui.start.hidden = name !== 'start';
    ui.play.hidden = name !== 'play';
    ui.over.hidden = name !== 'over';
    ui.hud.hidden = name === 'start';
    window.scrollTo(0, 0);
  }

  var toastTimer = null;
  function toast(text, tone) {
    ui.toast.textContent = text;
    ui.toast.className = 'toast tone-' + (tone || 'info');
    ui.toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { ui.toast.hidden = true; }, 1400);
  }

  function pop(node) {
    node.classList.remove('pop');
    void node.offsetWidth;
    node.classList.add('pop');
  }

  function syncHud() {
    var s = game.state;
    ui.score.textContent = s.score;
    ui.streak.textContent = s.streak;
    pop(ui.score);
    if (s.streak >= 3) pop(ui.streak);
  }

  function renderQuestion() {
    var q = game.next();
    var n = q.tiles.length;
    ui.qIndex.textContent = '第 ' + game.state.asked + ' 题';
    ui.qLen.textContent = n + ' 个字';
    ui.tiles.style.setProperty('--n', String(n));
    ui.tiles.className = 'tiles';
    ui.tiles.innerHTML = q.tiles.map(function (t, i) {
      var isNum = /^[0-9]+$/.test(t.pic);
      var isImg = /\.(gif|png|webp|svg|jpg|jpeg)$/i.test(t.pic);
      var face = isImg
        ? '<img class="tile-img" src="' + escapeHtml(t.pic) + '" alt="">'
        : escapeHtml(t.pic);
      return '<div class="tile anim-' + t.anim + (isNum ? ' is-num' : '') + (isImg ? ' is-img' : '') +
        '" style="--d:' + t.delay + 's;--i:' + i + '">' +
        '<span class="tile-face">' + face + '</span>' +
        '<span class="tile-note">' + escapeHtml(t.note) + '</span>' +
        '<span class="tile-spark s1"></span><span class="tile-spark s2"></span>' +
        '</div>';
    }).join('');

    ui.slots.innerHTML = q.tiles.map(function () { return '<span class="slot"></span>'; }).join('');
    ui.log.innerHTML = '';
    ui.input.value = '';
    ui.input.disabled = false;
    ui.input.focus();
  }

  function fillSlots(text, state) {
    var chars = text.split('');
    var cells = ui.slots.children;
    for (var i = 0; i < cells.length; i += 1) {
      var ch = chars[i] || '';
      cells[i].textContent = ch;
      cells[i].className = 'slot' + (ch ? ' filled' : '') + (state ? ' ' + state : '');
    }
  }

  function addChip(text, tone) {
    var chip = document.createElement('span');
    chip.className = 'chip chip-' + tone;
    chip.textContent = text;
    ui.log.appendChild(chip);
    while (ui.log.children.length > 4) ui.log.removeChild(ui.log.firstChild);
  }

  /* --------------------------------------------------------------- 对局 */
  function startRound() {
    var name = (ui.name.value || '').trim().slice(0, 12) || '无名高手';
    lastPlayer = name;
    try { localStorage.setItem(NAME_KEY, name); } catch (e) { /* ignore */ }

    game = Core.createGame({ bank: BANK, anims: ANIMS, seconds: ROUND });
    remaining = ROUND;
    paused = false;
    locked = false;
    saved = false;
    ui.score.textContent = '0';
    ui.streak.textContent = '0';
    ui.clock.textContent = Core.formatClock(ROUND);
    ui.clock.classList.remove('is-urgent');
    ui.pauseOverlay.hidden = true;
    ui.saveBtn.disabled = false;
    ui.saveBtn.textContent = '提交成绩';
    showScreen('play');
    renderQuestion();
    startTimer();
  }

  function onCorrect(res) {
    locked = true;
    ui.input.disabled = true;
    fillSlots(res.answer, 'right');
    ui.tiles.classList.add('is-right');
    syncHud();
    burst();
    toast(res.streak >= 3 ? ('+1 连对 ' + res.streak + ' 题！') : '+1 答对了', 'good');
    setTimeout(function () {
      if (!game) return;
      locked = false;
      renderQuestion();
    }, 1150);
  }

  function onWrong(text, res) {
    syncHud();
    fillSlots(Core.normalize(text), '');
    addChip(text.trim() + '  -1', 'bad');
    ui.tiles.classList.remove('is-wrong');
    void ui.tiles.offsetWidth;
    ui.tiles.classList.add('is-wrong');
    toast('-1 不对，再想想', 'bad');
    ui.input.select();
  }

  function revealAnswer() {
    if (!game || locked || paused) return;
    var res = game.reveal();
    locked = true;
    ui.input.disabled = true;
    fillSlots(res.answer, 'right');
    ui.tiles.classList.add('is-right');
    syncHud();
    toast('-1 答案：' + res.answer, 'bad');
    setTimeout(function () {
      if (!game) return;
      locked = false;
      renderQuestion();
    }, 1700);
  }

  function endRound(reason) {
    if (!game) return;
    stopTimer();
    paused = false;
    ui.pauseOverlay.hidden = true;
    var s = game.summary();
    ui.finalScore.textContent = s.score;
    ui.finalCorrect.textContent = s.correct;
    ui.finalWrong.textContent = s.wrong;
    ui.finalAcc.textContent = s.accuracy + '%';
    ui.finalStreak.textContent = s.bestStreak;
    ui.finalRank.textContent = reason === 'time' ? '15 分钟时间到' : '提前结束';
    ui.saveName.value = lastPlayer || '';
    renderBoard(ui.overBoard);
    showScreen('over');
    if (s.attempts === 0) toast('一题都没答，下次别客气', 'info');
    setTimeout(function () { ui.saveName.focus(); }, 60);
    game = null;
  }

  function submitScore() {
    if (ui.over.hidden) return;
    if (saved) { toast('这一局已经记录过了', 'info'); return; }
    var name = (ui.saveName.value || '').trim().slice(0, 12);
    if (!name) { toast('先写个昵称', 'bad'); ui.saveName.focus(); return; }
    var score = parseInt(ui.finalScore.textContent, 10) || 0;
    var correct = parseInt(ui.finalCorrect.textContent, 10) || 0;
    var wrong = parseInt(ui.finalWrong.textContent, 10) || 0;
    var entry = {
      id: 'r' + Date.now() + Math.random().toString(36).slice(2, 6),
      name: name, score: score, correct: correct, wrong: wrong, at: Date.now()
    };
    var list = loadBoard();
    list.push(entry);
    var ranked = Core.rankEntries(list).slice(0, 50);
    saveBoard(ranked);
    saved = true;
    ui.saveBtn.disabled = true;
    ui.saveBtn.textContent = '已记录';
    ui.name.value = name;
    lastPlayer = name;
    try { localStorage.setItem(NAME_KEY, name); } catch (e) { /* ignore */ }
    var rank = ranked.findIndex(function (r) { return r.id === entry.id; });
    if (rank === 0) {
      ui.finalRank.textContent = '新纪录！你暂列第一';
      burst();
    } else if (rank > 0) {
      ui.finalRank.textContent = Core.podiumLabel(rank) + ' · 共 ' + ranked.length + ' 条成绩';
    } else {
      ui.finalRank.textContent = '已记录（未进前 50）';
    }
    renderBoard(ui.overBoard, entry.id);
    toast('成绩已记录：' + score + ' 分', 'good');
  }

  /* ------------------------------------------------------------- 视觉特效 */
  function burst() {
    var canvas = ui.confetti;
    var ctx = canvas.getContext('2d');
    if (!ctx) return;
    var dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = window.innerWidth * dpr;
    canvas.height = window.innerHeight * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    var colors = ['#ffd166', '#4cc9f0', '#f72585', '#8ef6a4', '#ffffff'];
    var parts = [];
    for (var i = 0; i < 48; i += 1) {
      parts.push({
        x: window.innerWidth / 2 + (Math.random() - 0.5) * 120,
        y: window.innerHeight * 0.34,
        vx: (Math.random() - 0.5) * 9,
        vy: -Math.random() * 11 - 3,
        size: 4 + Math.random() * 7,
        rot: Math.random() * Math.PI,
        vr: (Math.random() - 0.5) * 0.4,
        color: colors[i % colors.length],
        life: 1
      });
    }
    var started = performance.now();
    function frame(now) {
      var t = now - started;
      ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
      parts.forEach(function (p) {
        p.vy += 0.35;
        p.x += p.vx;
        p.y += p.vy;
        p.rot += p.vr;
        p.life = Math.max(0, 1 - t / 1100);
        ctx.save();
        ctx.globalAlpha = p.life;
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6);
        ctx.restore();
      });
      if (t < 1100) requestAnimationFrame(frame);
      else ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
    }
    requestAnimationFrame(frame);
  }

  /* --------------------------------------------------------------- 事件 */
  ui.startBtn.addEventListener('click', startRound);
  ui.name.addEventListener('keydown', function (e) { if (e.key === 'Enter') startRound(); });

  ui.form.addEventListener('submit', function (e) {
    e.preventDefault();
    if (!game || locked || paused || composing) return;
    var text = ui.input.value;
    if (!Core.normalize(text)) { pop(ui.input); ui.input.focus(); return; }
    var res = game.submit(text);
    if (res.status === 'correct') onCorrect(res);
    else onWrong(text, res);
  });

  ui.input.addEventListener('input', function () {
    if (!game) return;
    fillSlots(ui.input.value, '');
  });

  ui.input.addEventListener('compositionstart', function () { composing = true; });
  ui.input.addEventListener('compositionend', function () {
    composing = false;
    fillSlots(ui.input.value, '');
  });

  ui.reveal.addEventListener('click', revealAnswer);
  ui.pause.addEventListener('click', pauseRound);
  ui.resume.addEventListener('click', resumeRound);
  ui.end.addEventListener('click', function () {
    if (!game) return;
    if (window.confirm('提前结束本局并结算？')) endRound('early');
  });

  ui.saveBtn.addEventListener('click', submitScore);
  ui.saveName.addEventListener('keydown', function (e) { if (e.key === 'Enter') submitScore(); });
  ui.restart.addEventListener('click', function () { startRound(); });
  ui.home.addEventListener('click', function () {
    game = null;
    stopTimer();
    refreshStartBoard();
    showScreen('start');
  });

  document.addEventListener('visibilitychange', function () {
    if (document.hidden && game && !paused) pauseRound();
  });

  window.addEventListener('resize', function () {
    if (!ui.confetti.getContext) return;
    ui.confetti.width = window.innerWidth;
    ui.confetti.height = window.innerHeight;
  });

  /* --------------------------------------------------------------- 启动 */
  function boot() {
    if (!BANK.length) {
      document.body.innerHTML = '<p style="padding:24px;color:#fff">题库加载失败：data.js 未加载。</p>';
      return;
    }
    try { ui.name.value = localStorage.getItem(NAME_KEY) || ''; } catch (e) { /* ignore */ }
    refreshStartBoard();
    showScreen('start');
    ui.name.focus();
  }

  boot();
})();
