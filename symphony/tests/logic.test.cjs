/* 交响乐工坊规则自测：node tests/logic.test.cjs */
'use strict';

const assert = require('assert');
const path = require('path');
const Core = require(path.join(__dirname, '..', 'logic.js'));

let pass = 0;
function check(name, fn) {
  try {
    fn();
    pass += 1;
    console.log('  PASS  ' + name);
  } catch (err) {
    console.log('  FAIL  ' + name + '\n        ' + err.message);
    process.exitCode = 1;
  }
}

function scoreWith(instrument, line, opts) {
  const score = Core.createScore(Object.assign({ bars: 8 }, opts || {}));
  const track = Core.addTrack(score, instrument);
  if (line) Core.lay(track, line);
  return { score, track };
}

console.log('乐器与情感');

check('11 件乐器、id 唯一、音域与泛音合法', () => {
  assert.strictEqual(Core.INSTRUMENTS.length, 11);
  const ids = Core.INSTRUMENTS.map((i) => i.id);
  assert.strictEqual(new Set(ids).size, ids.length);
  Core.INSTRUMENTS.forEach((ins) => {
    assert.ok(ins.name && ins.desc, ins.id + ' 缺名称或说明');
    assert.ok(ins.range[0] < ins.range[1], ins.id + ' 音域倒置');
    assert.ok(ins.range[0] >= 24 && ins.range[1] <= 100, ins.id + ' 音域越界');
    assert.ok(ins.harmonics.length >= 4, ins.id + ' 泛音过少');
    assert.ok(ins.gain > 0 && ins.cutoff > 100, ins.id + ' 音色参数异常');
    assert.ok(/^#[0-9a-f]{6}$/i.test(ins.color), ins.id + ' 颜色非法');
  });
});

check('三种乐器默认需要星数解锁，其余免费', () => {
  const locked = Core.INSTRUMENTS.filter((i) => i.unlock);
  assert.deepStrictEqual(locked.map((i) => [i.id, i.unlock]), [['timpani', 2], ['organ', 4], ['contrabass', 6]]);
  const progress = Core.createProgress();
  assert.strictEqual(Core.instrumentList(progress).filter((i) => i.unlocked).length, 8);
  assert.ok(!Core.isInstrumentUnlocked(progress, 'organ'));
  Core.completeTask(progress, 'a');
  Core.completeTask(progress, 'b');
  assert.ok(Core.isInstrumentUnlocked(progress, 'timpani'));
  assert.ok(!Core.isInstrumentUnlocked(progress, 'contrabass'));
});

check('6 种情感各有速度、明暗、混响与揉弦参数', () => {
  assert.strictEqual(Core.EMOTIONS.length, 6);
  Core.EMOTIONS.forEach((emo) => {
    assert.ok(emo.name && emo.desc && emo.icon, emo.id + ' 缺文案');
    assert.ok(emo.tempo >= Core.TEMPO_RANGE[0] && emo.tempo <= Core.TEMPO_RANGE[1]);
    assert.ok(emo.gate > 0.5 && emo.gate <= 1);
    assert.ok(emo.reverb >= 0 && emo.reverb <= 1);
  });
  assert.ok(Core.findEmotion('weird') === null);
});

console.log('音高与记谱');

check('音名、级数、简谱与 MIDI 互相对应', () => {
  assert.strictEqual(Core.pitchName(60), 'C4');
  assert.strictEqual(Core.pitchName(61), 'C#4');
  assert.strictEqual(Core.midiOf('C4'), 60);
  assert.strictEqual(Core.midiOf('F#3'), 54);
  assert.strictEqual(Core.midiOf('Bb3'), null);
  assert.deepStrictEqual(Core.degreeOf(60), { degree: 1, accidental: 0, octave: 4 });
  assert.strictEqual(Core.degreeOf(62).degree, 2);
  assert.strictEqual(Core.degreeOf(66).accidental, 1, 'F#4 应带升号');
  assert.strictEqual(Core.degreeAbsolute(72) - Core.degreeAbsolute(60), 7);
});

check('编辑网格是 C3–F5 的白键，共 18 行', () => {
  assert.strictEqual(Core.PITCH_ROWS.length, 18);
  assert.strictEqual(Core.PITCH_ROWS[0].midi, 77);
  assert.strictEqual(Core.PITCH_ROWS[Core.PITCH_ROWS.length - 1].midi, 48);
  Core.PITCH_ROWS.forEach((row) => assert.ok(Core.isWhite(row.midi), row.name + ' 不是白键'));
  assert.deepStrictEqual(Core.PITCH_ROWS.map((r) => r.label).slice(0, 8), ['4', '3', '2', '1', '7', '6', '5', '4']);
});

check('音符时长只在五种内取最近值', () => {
  assert.deepStrictEqual(Core.DURATIONS, [4, 2, 1, 0.5, 0.25]);
  assert.strictEqual(Core.nearestDuration(0.9), 1);
  assert.strictEqual(Core.nearestDuration(3), 4);
  assert.strictEqual(Core.nearestDuration(0.1), 0.25);
  assert.strictEqual(Core.DURATION_NAMES[0.5], '八分音符');
});

console.log('乐谱编辑');

check('新谱默认 8 小节、情感决定速度', () => {
  const score = Core.createScore();
  assert.strictEqual(score.bars, 8);
  assert.strictEqual(score.emotion, 'lively');
  assert.strictEqual(score.tempo, 138);
  assert.deepStrictEqual(score.tracks, []);
  const emo = Core.applyEmotion(score, 'melancholy');
  assert.strictEqual(emo.tempo, 62);
  assert.strictEqual(score.tempo, 62);
  assert.strictEqual(score.emotion, 'melancholy');
  assert.deepStrictEqual(score.tweaks, { bright: 0, reverb: 0, vibrato: 0 });
});

check('最多 8 条轨，可删除，重复乐器自动降音量', () => {
  const score = Core.createScore();
  for (let i = 0; i < 9; i += 1) Core.addTrack(score, 'violin');
  assert.strictEqual(score.tracks.length, 8);
  assert.ok(score.tracks[7].volume < score.tracks[0].volume, '重复乐器应递减音量');
  const gone = Core.removeTrack(score, score.tracks[0].id);
  assert.strictEqual(gone, true);
  assert.strictEqual(score.tracks.length, 7);
  assert.strictEqual(Core.removeTrack(score, 'nope'), false);
});

check('写音符：吸附到十六分、同拍覆盖、越界拒绝', () => {
  const { score, track } = scoreWith('violin');
  const note = Core.addNote(score, track.id, { t: 1.6, m: 60, d: 0.3 });
  assert.strictEqual(note.t, 1.5);
  assert.strictEqual(note.d, 0.25);
  assert.strictEqual(Core.totalNotes(score), 1);
  Core.addNote(score, track.id, { t: 1.6, m: 64, d: 1 });
  assert.strictEqual(Core.totalNotes(score), 1, '同一时刻只能有一个音');
  assert.strictEqual(Core.noteAt(track, 1.5).m, 64);
  assert.strictEqual(Core.addNote(score, track.id, { t: 99, m: 60 }), null);
  assert.strictEqual(Core.addNote(score, track.id, { t: 0, m: 30 }), null, '超出网格应拒绝');
  assert.strictEqual(Core.addNote(score, 'ghost', { t: 0, m: 60 }), null);
});

check('超音域音符按八度搬移到乐器舒适音区', () => {
  const { score, track } = scoreWith('violin');
  const low = Core.addNote(score, track.id, { t: 0, m: 48 });
  assert.strictEqual(low.m, 60, '小提琴最低 G3，C3 应上移八度');
  const high = Core.addNote(score, track.id, { t: 1, m: 72 });
  assert.strictEqual(high.m, 72);
});

check('末小节写过长的音会自动截断', () => {
  const { score, track } = scoreWith('piano', null, { bars: 2 });
  const note = Core.addNote(score, track.id, { t: 7.75, m: 60, d: 4 });
  assert.strictEqual(note.d, 0.25);
  assert.strictEqual(Core.addNote(score, track.id, { t: 8, m: 60 }), null);
});

check('删除、改时长、改力度与清空轨道', () => {
  const { score, track } = scoreWith('flute', 'C5:1 D5:1 E5:1');
  assert.strictEqual(Core.totalNotes(score), 3);
  assert.strictEqual(Core.removeNote(score, track.id, 1), true);
  assert.strictEqual(Core.removeNote(score, track.id, 1), false);
  const patched = Core.setNote(score, track.id, 0, { d: 0.6, v: 1.5 });
  assert.strictEqual(patched.d, 0.5);
  assert.strictEqual(patched.v, 1);
  assert.strictEqual(Core.setNote(score, track.id, 9, { d: 2 }), null);
  assert.strictEqual(Core.clearTrack(score, track.id), true);
  assert.strictEqual(Core.totalNotes(score), 0);
});

console.log('混音与调度');

check('静音与独奏决定实际发声的轨道', () => {
  const score = Core.createScore();
  const a = Core.addTrack(score, 'violin');
  const b = Core.addTrack(score, 'cello');
  Core.lay(a, 'C5:1 D5:1');
  Core.lay(b, 'C3:1 D3:1');
  assert.strictEqual(Core.activeTracks(score).length, 2);
  b.solo = true;
  assert.deepStrictEqual(Core.activeTracks(score).map((t) => t.id), [b.id]);
  const plan = Core.mixPlan(score);
  assert.strictEqual(plan[0].gain, 0);
  assert.ok(plan[1].gain > 0);
  b.solo = false;
  a.mute = true;
  assert.strictEqual(Core.activeTracks(score).length, 1);
  assert.strictEqual(Core.mixPlan(score)[0].audible, false);
});

check('情感与微调共同决定音色：轻快更亮、忧郁更暗', () => {
  const score = Core.createScore();
  const track = Core.addTrack(score, 'violin');
  const lively = Core.timbre(score, track);
  Core.applyEmotion(score, 'melancholy');
  const sad = Core.timbre(score, track);
  assert.ok(lively.cutoff > sad.cutoff, '轻快应比忧郁明亮');
  assert.ok(lively.gate < sad.gate, '轻快应更短促');
  assert.ok(sad.reverb > lively.reverb, '忧郁应有更多混响');
  score.tweaks.bright = 1;
  assert.ok(Core.timbre(score, track).cutoff > sad.cutoff * 1.5);
  score.tweaks.vibrato = 1;
  assert.ok(Core.timbre(score, track).vibratoDepth > sad.vibratoDepth);
});

check('时间轴按拍换算成秒并排序，独奏时只剩一条轨', () => {
  const score = Core.createScore({ tempo: 120, bars: 4 });
  const a = Core.addTrack(score, 'violin');
  const b = Core.addTrack(score, 'cello');
  Core.lay(a, 'C5:1 E5:1 G5:2');
  Core.lay(b, 'C3:2 G3:2');
  const tl = Core.timeline(score);
  assert.strictEqual(tl.beatSec, 0.5);
  assert.strictEqual(tl.seconds, 8);
  assert.strictEqual(tl.events.length, 5);
  assert.ok(tl.events[0].time <= tl.events[1].time);
  const first = tl.events[0];
  assert.strictEqual(first.time, 0);
  const lead = tl.events.filter((e) => e.midi === 72)[0];
  assert.ok(Math.abs(lead.dur - 0.5 * 0.7) < 1e-9, '轻快断奏应缩短发声');
  b.solo = true;
  assert.strictEqual(Core.timeline(score).events.length, 2);
});

console.log('任务与存档');

check('六项任务可各自达成并计入星数', () => {
  const progress = Core.createProgress();
  const duet = scoreWith('violin', 'C5:1 D5:1 E5:1 F5:1 G5:1 A5:1').score;
  Core.lay(Core.addTrack(duet, 'cello'), 'C3:1 C3:1 C3:1 C3:1 C3:1 C3:1');
  assert.strictEqual(Core.evaluateTasks(duet, progress).includes('duet'), true);
  assert.strictEqual(Core.evaluateTasks(duet, progress).length, 0, '已完成的任务不重复计分');
  assert.strictEqual(Core.totalStars(progress), 1);

  const grand = Core.DEMOS.find((d) => d.id === 'march').build();
  const gained = Core.evaluateTasks(grand, progress);
  assert.ok(gained.includes('bass'));
  assert.ok(gained.includes('grand'));
  assert.strictEqual(Core.totalStars(progress), 3);

  const tender = Core.DEMOS.find((d) => d.id === 'star').build();
  assert.ok(Core.evaluateTasks(tender, progress).includes('tender'));
  const lively = Core.createScore({ emotion: 'lively', tempo: 140 });
  const lt = Core.addTrack(lively, 'piano');
  Core.lay(lt, 'C5:0.5 E5:0.5 G5:0.5 C5:0.5 D5:0.5 F5:0.5 A5:0.5 D5:0.5 C5:0.5 E5:0.5 G5:0.5 C5:0.5 D5:0.5 F5:0.5 A5:0.5 D5:0.5 C5:0.5 E5:0.5 G5:0.5 C5:0.5 D5:0.5 F5:0.5 A5:0.5 D5:0.5 C5:0.5 E5:0.5 G5:0.5 C5:0.5 D5:0.5 F5:0.5 A5:0.5 D5:0.5');
  assert.ok(Core.evaluateTasks(lively, progress).includes('lively'));
});

check('任务列表带完成态与可达成标记', () => {
  const progress = Core.createProgress();
  const score = Core.DEMOS.find((d) => d.id === 'march').build();
  const list = Core.taskList(score, progress);
  assert.strictEqual(list.length, 6);
  assert.strictEqual(list.filter((t) => t.ready).length >= 3, true);
  assert.ok(list.every((t) => t.done === false));
  Core.completeTask(progress, 'duet');
  assert.strictEqual(Core.taskList(score, progress)[0].done, true);
});

check('统计乐器组、轨数与时长', () => {
  const score = Core.DEMOS.find((d) => d.id === 'mist').build();
  const st = Core.stats(score);
  assert.strictEqual(st.tracksWithNotes, 3);
  assert.strictEqual(st.families.length, 3);
  assert.ok(st.notes >= 30);
  assert.ok(st.seconds > 10 && st.totalSeconds >= st.seconds);
  assert.strictEqual(st.totalSeconds, 8 * 4 * (60 / 88));
});

check('存档往返保留情感、微调、轨道与音符', () => {
  const score = Core.DEMOS.find((d) => d.id === 'ode').build();
  score.tweaks.bright = 0.4;
  score.tracks[0].pan = -0.4;
  const copy = Core.parse(Core.serialize(score));
  assert.ok(copy, '解析失败');
  assert.strictEqual(copy.title, score.title);
  assert.strictEqual(copy.emotion, score.emotion);
  assert.strictEqual(copy.tempo, score.tempo);
  assert.strictEqual(copy.tracks.length, score.tracks.length);
  assert.strictEqual(Core.totalNotes(copy), Core.totalNotes(score));
  assert.strictEqual(copy.tracks[0].pan, -0.4);
  assert.strictEqual(copy.tweaks.bright, 0.4);
  assert.deepStrictEqual(copy.tracks[1].notes[0], score.tracks[1].notes[0]);
});

check('损坏或越界的存档会被拒收或收敛', () => {
  assert.strictEqual(Core.parse('不是 JSON'), null);
  assert.strictEqual(Core.parse('{"tracks":5}'), null);
  const raw = {
    title: 'x'.repeat(80), tempo: 999, bars: 99, emotion: 'nope', master: 9,
    tracks: [
      { instrument: 'violin', notes: [[0, 60, 1, 0.8], [0.25, 999, 1, 0.8], [1, 64]] },
      { instrument: 'kazoo', notes: [[0, 60, 1, 0.8]] }
    ]
  };
  const parsed = Core.parse(raw);
  assert.strictEqual(parsed.tempo, 208);
  assert.strictEqual(parsed.bars, 16);
  assert.strictEqual(parsed.emotion, 'lively');
  assert.strictEqual(parsed.title.length, 40);
  assert.strictEqual(parsed.tracks.length, 1, '未知乐器应被丢弃');
  assert.strictEqual(Core.totalNotes(parsed), 2, '越界音高应被丢弃');
});

console.log('示范曲');

check('6 首示范曲都可用免费乐器完整演奏', () => {
  const list = Core.demoList();
  assert.strictEqual(list.length, 6);
  const free = Core.INSTRUMENTS.filter((i) => !i.unlock).map((i) => i.id);
  Core.DEMOS.forEach((demo) => {
    const score = demo.build();
    const st = Core.stats(score);
    assert.ok(st.tracksWithNotes >= 3, demo.id + ' 轨道不足');
    assert.ok(st.notes >= 30, demo.id + ' 音符不足');
    assert.ok(st.seconds > 8, demo.id + ' 太短');
    score.tracks.forEach((track) => {
      assert.ok(free.indexOf(track.instrument) >= 0, demo.id + ' 使用了未解锁乐器 ' + track.instrument);
      const range = Core.findInstrument(track.instrument).range;
      const beats = new Set();
      track.notes.forEach((n) => {
        assert.ok(n.m >= Core.GRID_LOW && n.m <= Core.GRID_HIGH, demo.id + ' 音高超出编辑网格');
        assert.ok(n.m >= range[0] && n.m <= range[1], demo.id + ' 超出乐器音域');
        assert.ok(n.t >= 0 && n.t + n.d <= score.bars * 4, demo.id + ' 越出小节');
        assert.ok(!beats.has(n.t), demo.id + ' 同轨同拍重音');
        beats.add(n.t);
      });
    });
    const events = Core.timeline(score).events;
    assert.strictEqual(events.length, st.notes, demo.id + ' 时间轴事件数不符');
  });
});

console.log('\n' + (process.exitCode ? '存在失败用例' : '规则测试通过：' + pass + ' 项'));
