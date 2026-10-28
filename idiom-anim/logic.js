/* 猜成语动图 · 纯逻辑（无 DOM，可被 node 直接加载做测试） */
(function (root) {
  'use strict';

  var ROUND_SECONDS = 15 * 60;
  var PUNCT = /[\s\u00A0.,!?;:'"`~@#$%^&*()_+\-=\[\]{}\\|<>\/、，。！？；：""''《》〈〉【】·—…]/g;

  function normalize(text) {
    if (text == null) return '';
    var s = String(text);
    s = s.replace(/[\uFF01-\uFF5E]/g, function (ch) {
      return String.fromCharCode(ch.charCodeAt(0) - 0xFEE0);
    });
    s = s.replace(/\u3000/g, ' ');
    return s.replace(PUNCT, '').toLowerCase();
  }

  function isCorrect(input, answer) {
    var a = normalize(answer);
    return a.length > 0 && normalize(input) === a;
  }

  function mulberry32(seed) {
    var t = seed >>> 0;
    return function () {
      t = (t + 0x6D2B79F5) >>> 0;
      var r = Math.imul(t ^ (t >>> 15), 1 | t);
      r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
      return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
    };
  }

  function shuffle(list, rng) {
    var random = rng || Math.random;
    var arr = list.slice();
    for (var i = arr.length - 1; i > 0; i -= 1) {
      var j = Math.floor(random() * (i + 1));
      var tmp = arr[i];
      arr[i] = arr[j];
      arr[j] = tmp;
    }
    return arr;
  }

  function pickOne(list, rng) {
    if (!list || !list.length) return null;
    var random = rng || Math.random;
    return list[Math.min(list.length - 1, Math.floor(random() * list.length))];
  }

  function createGame(opts) {
    var bank = (opts && opts.bank) || [];
    var anims = (opts && opts.anims) || ['bob'];
    var rng = (opts && opts.rng) || Math.random;
    var seconds = (opts && opts.seconds) || ROUND_SECONDS;

    var state = {
      score: 0, correct: 0, wrong: 0, asked: 0,
      streak: 0, bestStreak: 0, duration: seconds, startedAt: null
    };
    var deck = [];
    var lastWord = null;
    var current = null;

    function drawIdiom() {
      if (!deck.length) {
        deck = shuffle(bank, rng);
        if (deck.length > 1 && lastWord && deck[deck.length - 1].w === lastWord) {
          var swap = deck[0];
          deck[0] = deck[deck.length - 1];
          deck[deck.length - 1] = swap;
        }
      }
      var idiom = deck.pop();
      lastWord = idiom.w;
      return idiom;
    }

    function makeTiles(idiom) {
      return idiom.h.map(function (pics, i) {
        return {
          pic: pickOne(pics, rng),
          anim: pickOne(anims, rng),
          note: idiom.n[i],
          delay: Math.round(rng() * 800) / 1000
        };
      });
    }

    function next() {
      var idiom = drawIdiom();
      current = { idiom: idiom, tiles: makeTiles(idiom) };
      state.asked += 1;
      return current;
    }

    function submit(text) {
      if (!current) return { status: 'idle', score: state.score };
      if (isCorrect(text, current.idiom.w)) {
        state.score += 1;
        state.correct += 1;
        state.streak += 1;
        if (state.streak > state.bestStreak) state.bestStreak = state.streak;
        return { status: 'correct', score: state.score, answer: current.idiom.w, streak: state.streak };
      }
      state.score -= 1;
      state.wrong += 1;
      state.streak = 0;
      return { status: 'wrong', score: state.score, answer: current.idiom.w, streak: 0 };
    }

    function reveal() {
      if (!current) return { status: 'idle', score: state.score };
      state.score -= 1;
      state.wrong += 1;
      state.streak = 0;
      return { status: 'revealed', score: state.score, answer: current.idiom.w };
    }

    function summary() {
      var attempts = state.correct + state.wrong;
      return {
        score: state.score,
        correct: state.correct,
        wrong: state.wrong,
        asked: state.asked,
        attempts: attempts,
        accuracy: attempts ? Math.round((state.correct / attempts) * 100) : 0,
        bestStreak: state.bestStreak,
        duration: state.duration
      };
    }

    return {
      state: state,
      next: next,
      submit: submit,
      reveal: reveal,
      summary: summary,
      current: function () { return current; }
    };
  }

  function formatClock(totalSeconds) {
    var s = Math.max(0, Math.floor(totalSeconds));
    var m = Math.floor(s / 60);
    var r = s % 60;
    return (m < 10 ? '0' : '') + m + ':' + (r < 10 ? '0' : '') + r;
  }

  function rankEntries(entries) {
    return entries.slice().sort(function (a, b) {
      if (b.score !== a.score) return b.score - a.score;
      if ((b.correct || 0) !== (a.correct || 0)) return (b.correct || 0) - (a.correct || 0);
      return (a.at || 0) - (b.at || 0);
    });
  }

  function podiumLabel(index) {
    return ['冠军', '亚军', '季军'][index] || ('第 ' + (index + 1) + ' 名');
  }

  root.IdiomCore = {
    ROUND_SECONDS: ROUND_SECONDS,
    normalize: normalize,
    isCorrect: isCorrect,
    mulberry32: mulberry32,
    shuffle: shuffle,
    pickOne: pickOne,
    createGame: createGame,
    formatClock: formatClock,
    rankEntries: rankEntries,
    podiumLabel: podiumLabel
  };
})(typeof window !== 'undefined' ? window : globalThis);
