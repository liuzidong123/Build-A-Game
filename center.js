/* 游戏中心：扫描 games/<name>/index.html，渲染看板，记录时长/点赞/收藏/人数 */
(function () {
  'use strict';

  var CFG = Object.assign({
    statsEndpoint: './api/stats',
    refreshMs: 30000,
    scan: true
  }, window.GAME_CENTER_CONFIG || {});

  var STORE_KEY = 'game-center.player.v1';
  var LOCAL_KEY = 'game-center.stats.v1';
  var VIEW_KEY = 'game-center.view.v1';
  var SKIP_DIRS = /^(tools|tests|api|assets|node_modules|\.stats|\.git)$/i;

  function $(id) { return document.getElementById(id); }

  var ui = {
    board: $('board'), empty: $('empty'), countAll: $('countAll'),
    search: $('search'), sort: $('sort'), filters: $('filters'), refresh: $('refresh'),
    viewSwitch: $('viewSwitch'),
    badge: $('sourceBadge'), footNote: $('footNote'), toast: $('toast'),
    player: $('player'), shell: $('playerShell'), frame: $('playerFrame'),
    playerTitle: $('playerTitle'), playerClock: $('playerClock'),
    playerClose: $('playerClose'), playerFull: $('playerFull')
  };

  var state = {
    games: [],
    filter: 'all',
    sort: 'hot',
    query: '',
    view: readJSON(VIEW_KEY, 'grid') === 'list' ? 'list' : 'grid',
    remote: null,
    remoteOk: false,
    loading: true
  };

  var session = null;
  var toastTimer = null;

  /* ------------------------------------------------------------ 本地存储 */
  function readJSON(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) { return fallback; }
  }

  function writeJSON(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* 隐私模式忽略 */ }
  }

  function uid() {
    return 'p-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  }

  var player = readJSON(STORE_KEY, null);
  if (!player || !player.id) {
    player = { id: uid() };
    writeJSON(STORE_KEY, player);
  }

  var localStats = readJSON(LOCAL_KEY, {}) || {};

  function localOf(id) {
    if (!localStats[id] || typeof localStats[id] !== 'object') {
      localStats[id] = { plays: 0, seconds: 0, liked: false, favored: false, lastPlay: 0 };
    }
    return localStats[id];
  }

  function saveLocal() { writeJSON(LOCAL_KEY, localStats); }

  /* --------------------------------------------------------------- 工具 */
  function clean(value) {
    return String(value == null ? '' : value).replace(/\s+/g, ' ').trim().slice(0, 120);
  }

  function decodeEntities(text) {
    return String(text)
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
      .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');
  }

  function fmtClock(seconds) {
    var s = Math.max(0, Math.floor(seconds));
    var h = Math.floor(s / 3600);
    var m = Math.floor((s % 3600) / 60);
    var sec = s % 60;
    var mm = String(m).padStart(2, '0');
    var ss = String(sec).padStart(2, '0');
    return h > 0 ? (h + ':' + mm + ':' + ss) : (mm + ':' + ss);
  }

  function fmtDuration(seconds) {
    var s = Math.max(0, Math.round(seconds));
    if (s < 60) return s + ' 秒';
    if (s < 3600) {
      var m = Math.floor(s / 60);
      var rest = s % 60;
      return rest ? (m + ' 分 ' + rest + ' 秒') : (m + ' 分');
    }
    var h = Math.floor(s / 3600);
    var mm2 = Math.round((s % 3600) / 60);
    return mm2 ? (h + ' 小时 ' + mm2 + ' 分') : (h + ' 小时');
  }

  function fmtCount(n) {
    var v = Math.max(0, Number(n) || 0);
    if (v < 1000) return String(v);
    if (v < 10000) return (v / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
    return (v / 10000).toFixed(1).replace(/\.0$/, '') + 'w';
  }

  function toast(text) {
    ui.toast.textContent = text;
    ui.toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { ui.toast.hidden = true; }, 1600);
  }

  /* ------------------------------------------------------------ 数据来源 */
  function metrics(id) {
    var l = localStats[id] || {};
    var r = state.remote && state.remote[id];
    if (state.remoteOk && r) {
      return {
        plays: Number(r.plays) || 0,
        seconds: Number(r.seconds) || 0,
        people: Number(r.people) || 0,
        likes: Number(r.likes) || 0,
        favs: Number(r.favs) || 0,
        mine: Number(l.seconds) || 0,
        liked: !!l.liked,
        favored: !!l.favored
      };
    }
    return {
      plays: Number(l.plays) || 0,
      seconds: Number(l.seconds) || 0,
      people: l.plays ? 1 : 0,
      likes: l.liked ? 1 : 0,
      favs: l.favored ? 1 : 0,
      mine: Number(l.seconds) || 0,
      liked: !!l.liked,
      favored: !!l.favored
    };
  }

  function refreshRemote() {
    if (!CFG.statsEndpoint) { state.remoteOk = false; return Promise.resolve(false); }
    return fetch(CFG.statsEndpoint, { cache: 'no-store' })
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      })
      .then(function (data) {
        state.remote = (data && data.games) || {};
        state.remoteOk = true;
        return true;
      })
      .catch(function () {
        state.remoteOk = false;
        return false;
      });
  }

  function sendEvent(id, type, extra) {
    if (!state.remoteOk || !CFG.statsEndpoint) return;
    var body = JSON.stringify(Object.assign({
      playerId: player.id, gameId: id, type: type
    }, extra || {}));
    fetch(CFG.statsEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body,
      keepalive: true
    })
      .then(function (res) { return res.ok ? res.json() : null; })
      .then(function (snap) {
        if (snap && snap.games) {
          state.remote = snap.games;
          state.remoteOk = true;
          render();
        }
      })
      .catch(function () { /* 服务端不可用时保持本机数据 */ });
  }

  /* --------------------------------------------------------------- 扫描 */
  function manifestGames() {
    var manifest = window.GAMES_MANIFEST;
    return manifest && Array.isArray(manifest.games) ? manifest.games : [];
  }

  function normalize(raw, fallbackId) {
    var id = clean(raw.id || fallbackId || '');
    return {
      id: id,
      title: clean(raw.title) || id,
      subtitle: clean(raw.subtitle || raw.description || ''),
      tags: Array.isArray(raw.tags) ? raw.tags.slice(0, 4).map(clean).filter(Boolean) : [],
      cover: Array.from(String(raw.cover || '🎮')).slice(0, 2).join(''),
      accent: /^#[0-9a-f]{3,8}$/i.test(raw.accent || '') ? raw.accent : '#ffd166',
      version: clean(raw.version),
      updatedAt: Number(raw.updatedAt || raw.mtime || 0) || 0,
      path: (fallbackId || raw.id) + '/index.html'
    };
  }

  function listDirs() {
    return fetch('./', { cache: 'no-store', headers: { Accept: 'text/html' } })
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.text();
      })
      .then(function (text) {
        var names = [];
        var re = /href="([^"/?][^"]*)"/gi;
        var match;
        while ((match = re.exec(text))) {
          var href = match[1];
          if (/^(https?:|mailto:|#|\.\.|javascript:)/i.test(href)) continue;
          var name = href.replace(/\/index\.html?$/i, '').replace(/\/$/, '');
          if (!name || name.indexOf('/') !== -1) continue;
          if (SKIP_DIRS.test(name)) continue;
          if (/\.(html?|css|js|json|png|jpe?g|gif|svg|md)$/i.test(name)) continue;
          if (!/^[A-Za-z0-9._-]+$/.test(name)) continue;
          if (names.indexOf(name) === -1) names.push(name);
        }
        return names;
      })
      .catch(function () { return []; });
  }

  function fetchMeta(id) {
    return fetch(id + '/game.json', { cache: 'no-store' })
      .then(function (res) { return res.ok ? res.json() : null; })
      .catch(function () { return null; })
      .then(function (meta) {
        if (meta) return meta;
        return fetch(id + '/index.html', { cache: 'no-store' })
          .then(function (res) {
            if (!res.ok) return null;
            return res.text().then(function (html) {
              var out = {};
              var title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
              if (title) out.title = decodeEntities(title[1].trim());
              var desc = html.match(/<meta[^>]+name=["']description["'][^>]*content=["']([^"']*)["']/i)
                || html.match(/<meta[^>]+content=["']([^"']*)["'][^>]*name=["']description["']/i);
              if (desc) out.subtitle = decodeEntities(desc[1]);
              if (!out.title) out.title = id;
              return out;
            });
          })
          .catch(function () { return null; });
      })
      .then(function (meta) {
        return meta ? normalize(meta, id) : null;
      });
  }

  function discover() {
    var found = new Map();
    manifestGames().forEach(function (game) {
      if (!game || !game.id) return;
      found.set(game.id, normalize(game, game.id));
    });

    if (!CFG.scan) return Promise.resolve(Array.from(found.values()));

    return listDirs().then(function (dirs) {
      if (dirs.length) {
        // 目录扫描成功时，剔除已被删除的清单条目
        Array.from(found.keys()).forEach(function (id) {
          if (dirs.indexOf(id) === -1) found.delete(id);
        });
      }
      var pending = dirs.filter(function (id) { return !found.has(id); });
      return pending.reduce(function (chain, id) {
        return chain.then(function () {
          return fetchMeta(id).then(function (meta) { if (meta) found.set(id, meta); });
        });
      }, Promise.resolve()).then(function () {
        return Array.from(found.values());
      });
    });
  }

  /* --------------------------------------------------------------- 渲染 */
  var sorters = {
    hot: function (a, b) {
      var ma = metrics(a.id), mb = metrics(b.id);
      return mb.plays - ma.plays || mb.likes - ma.likes || a.title.localeCompare(b.title, 'zh');
    },
    likes: function (a, b) {
      var ma = metrics(a.id), mb = metrics(b.id);
      return mb.likes - ma.likes || mb.plays - ma.plays || a.title.localeCompare(b.title, 'zh');
    },
    new: function (a, b) {
      return (b.updatedAt || 0) - (a.updatedAt || 0) || a.title.localeCompare(b.title, 'zh');
    },
    name: function (a, b) { return a.title.localeCompare(b.title, 'zh'); }
  };

  function metricBox(value, label) {
    var box = document.createElement('div');
    box.className = 'metric';
    var strong = document.createElement('b');
    strong.textContent = value;
    var span = document.createElement('span');
    span.textContent = label;
    box.appendChild(strong);
    box.appendChild(span);
    return box;
  }

  function buildCard(game) {
    var m = metrics(game.id);
    var card = document.createElement('article');
    card.className = 'card';
    card.style.setProperty('--accent', game.accent);

    var top = document.createElement('div');
    top.className = 'card-top';

    var cover = document.createElement('div');
    cover.className = 'cover';
    cover.textContent = game.cover;

    var info = document.createElement('div');
    info.style.minWidth = '0';
    var title = document.createElement('h2');
    title.className = 'card-title';
    title.textContent = game.title;
    var sub = document.createElement('p');
    sub.className = 'card-sub';
    sub.textContent = game.subtitle || ('目录 ' + game.id);
    info.appendChild(title);
    info.appendChild(sub);

    top.appendChild(cover);
    top.appendChild(info);
    card.appendChild(top);

    if (m.plays) {
      var mark = document.createElement('span');
      mark.className = 'played-mark';
      mark.textContent = '玩过';
      card.appendChild(mark);
    }

    if (game.tags.length) {
      var tags = document.createElement('div');
      tags.className = 'tags';
      game.tags.forEach(function (name) {
        var tag = document.createElement('span');
        tag.className = 'tag';
        tag.textContent = name;
        tags.appendChild(tag);
      });
      card.appendChild(tags);
    }

    var metricsRow = document.createElement('div');
    metricsRow.className = 'metrics';
    metricsRow.appendChild(metricBox(fmtCount(m.plays), '游玩次数'));
    metricsRow.appendChild(metricBox(fmtDuration(m.seconds), '累计时长'));
    metricsRow.appendChild(metricBox(fmtCount(m.people), '人数'));
    metricsRow.appendChild(metricBox(fmtCount(m.likes), '点赞'));
    metricsRow.appendChild(metricBox(fmtCount(m.favs), '收藏'));
    metricsRow.appendChild(metricBox(fmtDuration(m.mine), '我的时长'));
    card.appendChild(metricsRow);

    var actions = document.createElement('div');
    actions.className = 'card-actions';

    var play = document.createElement('button');
    play.type = 'button';
    play.className = 'btn primary play';
    play.textContent = m.plays ? '继续游戏' : '开始游戏';
    play.addEventListener('click', function () { openGame(game); });

    var like = document.createElement('button');
    like.type = 'button';
    like.className = 'icon-btn' + (m.liked ? ' is-on' : '');
    like.textContent = '👍 ' + fmtCount(m.likes);
    like.title = m.liked ? '取消点赞' : '点赞';
    like.setAttribute('aria-pressed', m.liked ? 'true' : 'false');
    like.addEventListener('click', function () { toggleFlag(game.id, 'liked', 'like', 'unlike'); });

    var fav = document.createElement('button');
    fav.type = 'button';
    fav.className = 'icon-btn fav' + (m.favored ? ' is-on' : '');
    fav.textContent = '⭐ ' + fmtCount(m.favs);
    fav.title = m.favored ? '取消收藏' : '收藏';
    fav.setAttribute('aria-pressed', m.favored ? 'true' : 'false');
    fav.addEventListener('click', function () { toggleFlag(game.id, 'favored', 'favorite', 'unfavorite'); });

    actions.appendChild(play);
    actions.appendChild(like);
    actions.appendChild(fav);
    card.appendChild(actions);

    return card;
  }

  /* --------------------------------------------------- 表格视图（详情列表） */
  var COLUMNS = [
    { key: 'plays', label: '游玩次数', fmt: fmtCount },
    { key: 'seconds', label: '累计时长', fmt: fmtDuration },
    { key: 'people', label: '人数', fmt: fmtCount },
    { key: 'likes', label: '点赞', fmt: fmtCount },
    { key: 'favs', label: '收藏', fmt: fmtCount },
    { key: 'mine', label: '我的时长', fmt: fmtDuration }
  ];

  function cell(tag, className, text) {
    var node = document.createElement(tag);
    node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function tableHead() {
    var thead = document.createElement('thead');
    var tr = document.createElement('tr');
    var cols = [{ key: 'game', label: '游戏' }, { key: 'tags', label: '标签' }]
      .concat(COLUMNS.map(function (col) { return { key: col.key, label: col.label }; }))
      .concat([{ key: 'actions', label: '操作' }]);
    cols.forEach(function (col) {
      var th = cell('th', 'col col-' + col.key, col.label);
      th.setAttribute('scope', 'col');
      tr.appendChild(th);
    });
    thead.appendChild(tr);
    return thead;
  }

  function tableRow(game) {
    var m = metrics(game.id);
    var tr = document.createElement('tr');
    tr.className = 'game-row' + (m.plays ? ' is-played' : '');
    tr.dataset.game = game.id;
    tr.style.setProperty('--accent', game.accent);

    /* 游戏：封面 + 标题 + 简介 */
    var nameCell = cell('td', 'col col-game');
    var box = document.createElement('div');
    box.className = 'cell-game';
    var cover = cell('span', 'cover small', game.cover);
    var text = document.createElement('div');
    text.className = 'cell-text';
    text.appendChild(cell('b', 'cell-title', game.title));
    text.appendChild(cell('span', 'cell-sub', game.subtitle || ('目录 ' + game.id)));
    box.appendChild(cover);
    box.appendChild(text);
    nameCell.appendChild(box);
    tr.appendChild(nameCell);

    /* 标签 */
    var tagCell = cell('td', 'col col-tags');
    if (game.tags.length) {
      var tags = document.createElement('div');
      tags.className = 'tags';
      game.tags.forEach(function (name) {
        tags.appendChild(cell('span', 'tag', name));
      });
      tagCell.appendChild(tags);
    } else {
      tagCell.textContent = '—';
      tagCell.className = 'col col-tags is-blank';
    }
    tr.appendChild(tagCell);

    /* 六项指标 */
    COLUMNS.forEach(function (col) {
      var value = col.fmt(m[col.key]);
      var td = cell('td', 'col num', value);
      if (col.key === 'seconds' || col.key === 'mine') {
        td.title = m[col.key] + ' 秒';
      }
      tr.appendChild(td);
    });

    /* 操作 */
    var actionCell = cell('td', 'col col-actions');
    var actions = document.createElement('div');
    actions.className = 'row-actions';

    var play = document.createElement('button');
    play.type = 'button';
    play.className = 'btn small primary play';
    play.textContent = m.plays ? '继续' : '开始';
    play.addEventListener('click', function () { openGame(game); });

    var like = document.createElement('button');
    like.type = 'button';
    like.className = 'icon-btn tiny' + (m.liked ? ' is-on' : '');
    like.textContent = '👍 ' + fmtCount(m.likes);
    like.title = m.liked ? '取消点赞' : '点赞';
    like.setAttribute('aria-pressed', m.liked ? 'true' : 'false');
    like.addEventListener('click', function () { toggleFlag(game.id, 'liked', 'like', 'unlike'); });

    var fav = document.createElement('button');
    fav.type = 'button';
    fav.className = 'icon-btn tiny fav' + (m.favored ? ' is-on' : '');
    fav.textContent = '⭐ ' + fmtCount(m.favs);
    fav.title = m.favored ? '取消收藏' : '收藏';
    fav.setAttribute('aria-pressed', m.favored ? 'true' : 'false');
    fav.addEventListener('click', function () { toggleFlag(game.id, 'favored', 'favorite', 'unfavorite'); });

    actions.appendChild(play);
    actions.appendChild(like);
    actions.appendChild(fav);
    actionCell.appendChild(actions);
    tr.appendChild(actionCell);

    return tr;
  }

  function buildTable(games) {
    var wrap = document.createElement('div');
    wrap.className = 'table-wrap';
    var table = document.createElement('table');
    table.className = 'game-table';
    table.appendChild(tableHead());
    var tbody = document.createElement('tbody');
    games.forEach(function (game) { tbody.appendChild(tableRow(game)); });
    table.appendChild(tbody);
    wrap.appendChild(table);
    wrap.appendChild(cell('p', 'table-swipe-hint', '表格较宽，左右滑动查看其余指标'));
    return wrap;
  }

  function render() {
    var query = state.query.trim().toLowerCase();
    var games = state.games.filter(function (game) {
      var m = metrics(game.id);
      if (state.filter === 'fav' && !m.favored) return false;
      if (state.filter === 'played' && !(localStats[game.id] && localStats[game.id].plays)) return false;
      if (!query) return true;
      var haystack = [game.title, game.subtitle, game.id].concat(game.tags).join(' ').toLowerCase();
      return haystack.indexOf(query) !== -1;
    });

    games.sort(sorters[state.sort] || sorters.hot);

    var listMode = state.view === 'list' && games.length > 0;

    ui.countAll.textContent = String(state.games.length);
    ui.empty.hidden = state.games.length > 0;
    ui.board.textContent = '';
    ui.board.classList.toggle('is-list', listMode);

    if (!games.length) {
      if (!state.games.length) return;
      var note = document.createElement('section');
      note.className = 'empty';
      note.style.gridColumn = '1 / -1';
      var h = document.createElement('h2');
      h.textContent = '没有匹配的游戏';
      var p = document.createElement('p');
      p.textContent = state.filter === 'fav' ? '还没有收藏任何游戏，点 ⭐ 收藏一个试试。'
        : (state.filter === 'played' ? '还没有玩过的游戏，挑一个开始吧。' : '换个关键词试试。');
      note.appendChild(h);
      note.appendChild(p);
      ui.board.appendChild(note);
      return;
    }

    if (listMode) {
      ui.board.appendChild(buildTable(games));
      return;
    }
    games.forEach(function (game) {
      ui.board.appendChild(buildCard(game));
    });
  }

  /* ------------------------------------------------------- 展示方式切换 */
  function syncViewButtons() {
    if (!ui.viewSwitch) return;
    Array.prototype.forEach.call(ui.viewSwitch.querySelectorAll('[data-view]'), function (button) {
      var on = button.dataset.view === state.view;
      button.classList.toggle('is-on', on);
      button.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  }

  function setView(view) {
    var next = view === 'list' ? 'list' : 'grid';
    if (next === state.view) return;
    state.view = next;
    writeJSON(VIEW_KEY, next);
    syncViewButtons();
    render();
  }

  function updateSourceUI() {
    if (state.remoteOk) {
      ui.badge.textContent = '服务端统计';
      ui.badge.dataset.mode = 'server';
      ui.badge.title = '点赞/收藏/人数/时长由 stats_server.py 聚合，多设备共享';
      ui.footNote.textContent = '统计服务已连接，数据多设备共享';
    } else {
      ui.badge.textContent = '本机统计';
      ui.badge.dataset.mode = 'local';
      ui.badge.title = '未连接统计服务，数据只保存在本机浏览器';
      ui.footNote.textContent = '数据保存在本机浏览器（运行 stats_server.py 可多设备共享）';
    }
  }

  /* ------------------------------------------------------------ 计数事件 */
  function toggleFlag(id, field, onType, offType) {
    var local = localOf(id);
    local[field] = !local[field];
    saveLocal();

    var remote = state.remote && state.remote[id];
    if (state.remoteOk && remote) {
      var key = field === 'liked' ? 'likes' : 'favs';
      remote[key] = Math.max(0, (Number(remote[key]) || 0) + (local[field] ? 1 : -1));
    }

    sendEvent(id, local[field] ? onType : offType);
    toast(local[field] ? (field === 'liked' ? '已点赞' : '已收藏') : (field === 'liked' ? '已取消点赞' : '取消收藏'));
    render();
  }

  /* ------------------------------------------------------------ 游玩会话 */
  function applyOpen(id) {
    var local = localOf(id);
    local.plays = (Number(local.plays) || 0) + 1;
    local.lastPlay = Date.now();
    saveLocal();
    var remote = state.remote && state.remote[id];
    if (state.remoteOk && remote) remote.plays = (Number(remote.plays) || 0) + 1;
    sendEvent(id, 'open');
  }

  function applyClose(id, seconds) {
    var value = Math.max(0, Math.min(14400, Math.round(seconds)));
    if (!value) return;
    var local = localOf(id);
    local.seconds = (Number(local.seconds) || 0) + value;
    saveLocal();
    var remote = state.remote && state.remote[id];
    if (state.remoteOk && remote) remote.seconds = (Number(remote.seconds) || 0) + value;
    sendEvent(id, 'close', { seconds: value });
  }

  function openGame(game) {
    if (session) closeSession(true);
    session = {
      id: game.id,
      title: game.title,
      activeMs: 0,
      last: Date.now(),
      timer: null
    };
    ui.playerTitle.textContent = game.title;
    ui.playerClock.textContent = '00:00';
    ui.frame.src = game.path;
    ui.player.hidden = false;
    document.body.style.overflow = 'hidden';
    applyOpen(game.id);
    session.timer = setInterval(function () {
      if (!session) return;
      var now = Date.now();
      if (!document.hidden) session.activeMs += now - session.last;
      session.last = now;
      ui.playerClock.textContent = fmtClock(session.activeMs / 1000);
    }, 1000);
    render();
  }

  function closeSession(silent) {
    if (!session) return;
    var current = session;
    session = null;
    clearInterval(current.timer);
    if (!document.hidden) current.activeMs += Date.now() - current.last;
    ui.frame.src = 'about:blank';
    ui.player.hidden = true;
    document.body.style.overflow = '';
    if (document.fullscreenElement && document.exitFullscreen) {
      document.exitFullscreen().catch(function () {});
    }
    var seconds = Math.round(current.activeMs / 1000);
    applyClose(current.id, seconds);
    if (!silent) {
      toast(seconds > 0 ? ('本次游玩 ' + fmtDuration(seconds) + '，已计入统计') : '本次未记录时长');
      render();
    }
  }

  function flushSession() {
    if (!session) return;
    var current = session;
    session = null;
    clearInterval(current.timer);
    if (!document.hidden) current.activeMs += Date.now() - current.last;
    applyClose(current.id, Math.round(current.activeMs / 1000));
  }

  /* --------------------------------------------------------------- 事件 */
  ui.search.addEventListener('input', function () {
    state.query = ui.search.value;
    render();
  });

  ui.sort.addEventListener('change', function () {
    state.sort = ui.sort.value;
    render();
  });

  ui.filters.addEventListener('click', function (event) {
    var button = event.target.closest('[data-filter]');
    if (!button) return;
    state.filter = button.dataset.filter;
    Array.prototype.forEach.call(ui.filters.querySelectorAll('.chip'), function (chip) {
      chip.classList.toggle('is-on', chip === button);
    });
    render();
  });

  if (ui.viewSwitch) {
    ui.viewSwitch.addEventListener('click', function (event) {
      var button = event.target.closest('[data-view]');
      if (!button) return;
      setView(button.dataset.view);
    });
    syncViewButtons();
  }

  ui.refresh.addEventListener('click', function () {
    ui.refresh.disabled = true;
    refreshRemote()
      .then(function () { return discover(); })
      .then(function (games) {
        state.games = games;
        updateSourceUI();
        render();
        toast('已重新扫描：' + games.length + ' 个游戏');
      })
      .finally(function () { ui.refresh.disabled = false; });
  });

  ui.playerClose.addEventListener('click', function () { closeSession(false); });

  ui.playerFull.addEventListener('click', function () {
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(function () {});
      return;
    }
    var target = ui.shell;
    if (target.requestFullscreen) {
      target.requestFullscreen().catch(function () { toast('当前浏览器不支持全屏'); });
    } else {
      toast('当前浏览器不支持全屏');
    }
  });

  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape' && session) closeSession(false);
  });

  window.addEventListener('pagehide', flushSession);
  window.addEventListener('beforeunload', flushSession);

  /* --------------------------------------------------------------- 启动 */
  function boot() {
    render();
    refreshRemote().then(function () {
      updateSourceUI();
      return discover();
    }).then(function (games) {
      state.games = games;
      state.loading = false;
      render();
      if (!games.length) ui.empty.hidden = false;
    });

    setInterval(function () {
      if (!CFG.refreshMs) return;
      refreshRemote().then(function (changed) {
        updateSourceUI();
        if (changed) render();
      });
    }, Math.max(10000, Number(CFG.refreshMs) || 30000));
  }

  boot();
})();
