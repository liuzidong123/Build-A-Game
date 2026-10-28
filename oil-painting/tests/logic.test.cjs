/* 油画大师逻辑自测：node tests/logic.test.cjs */
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

function sessionOf(id) { return Core.createSession(Core.findArt(id)); }

function paintAll(session, colorOf) {
  Core.regionList(session.art).forEach((shape) => {
    Core.paint(session, shape[0], colorOf(shape, session.art));
  });
}

console.log('画作数据');

check('共 30 幅画，id 唯一', () => {
  assert.strictEqual(Core.ARTWORKS.length, 30);
  const ids = Core.ARTWORKS.map((art) => art.id);
  assert.strictEqual(new Set(ids).size, ids.length);
});

check('每幅画都有标题、说明与 6 色参考调色板', () => {
  Core.ARTWORKS.forEach((art) => {
    assert.ok(art.title, art.id + ' 缺标题');
    assert.ok(art.hint, art.id + ' 缺说明');
    assert.strictEqual(art.palette.length, 6, art.id + ' 调色板应为 6 色');
    art.palette.forEach((hex) => assert.ok(/^#[0-9a-f]{6}$/i.test(hex), art.id + ' 色值非法：' + hex));
  });
});

check('每个分区都有合法路径与参考色索引', () => {
  let total = 0;
  Core.ARTWORKS.forEach((art) => {
    const list = Core.regionList(art);
    assert.ok(list.length >= 8, art.id + ' 分区过少');
    list.forEach((shape) => {
      const [id, name, ref, d] = shape;
      total += 1;
      assert.ok(id && name, art.id + ' 分区缺名称');
      assert.ok(Number.isInteger(ref) && ref >= 0 && ref < art.palette.length, art.id + '/' + id + ' 参考色越界');
      assert.ok(typeof d === 'string' && d[0] === 'M' && d[d.length - 1] === 'Z', art.id + '/' + id + ' 路径不合法');
    });
  });
  assert.ok(total >= 330, '总分区数应达到 330 以上，实际 ' + total);
});

check('前 3 幅默认开放，其余逐幅解锁', () => {
  const progress = Core.createProgress();
  assert.strictEqual(Core.levelOpen(progress, 0), true);
  assert.strictEqual(Core.levelOpen(progress, 2), true);
  assert.strictEqual(Core.levelOpen(progress, 3), false);
  progress.best[Core.ARTWORKS[2].id] = 1;
  assert.strictEqual(Core.levelOpen(progress, 3), true);
  assert.strictEqual(Core.levelOpen(progress, 4), false);
});

console.log('颜色与评分');

check('同色相似度为 1，黑白几乎为 0', () => {
  assert.strictEqual(Core.similarity('#3366cc', '#3366cc'), 1);
  assert.ok(Core.similarity('#000000', '#ffffff') < 0.25);
  assert.ok(Core.similarity('#c9a227', '#e8c95a') > Core.similarity('#c9a227', '#1b3a5c'));
});

check('十六进制与 RGB 往返一致', () => {
  assert.deepStrictEqual(Core.hexToRgb('#ff8800'), [255, 136, 0]);
  assert.strictEqual(Core.rgbToHex([255, 136, 0]), '#ff8800');
  assert.deepStrictEqual(Core.hexToRgb('#abc'), [170, 187, 204]);
});

check('全按参考色填满：贴合度 100、三星', () => {
  const session = sessionOf('starry-night');
  paintAll(session, (shape, art) => art.palette[shape[2]]);
  const result = Core.evaluate(session);
  assert.strictEqual(result.filled, result.total);
  assert.ok(result.fit > 0.999);
  assert.strictEqual(Core.stars(session), 3);
  assert.strictEqual(Core.faithful(session), true);
});

check('填满但配色全错：只给一星', () => {
  const session = sessionOf('mondrian');
  paintAll(session, () => '#00ff00');
  assert.strictEqual(Core.isFilled(session), true);
  assert.strictEqual(Core.stars(session), 1);
  assert.strictEqual(Core.faithful(session), false);
});

check('没填满不给星', () => {
  const session = sessionOf('water-lilies');
  Core.paint(session, Core.regionList(session.art)[0][0], '#3c6b7a');
  assert.strictEqual(Core.stars(session), 0);
  assert.ok(Core.fillRatio(session) > 0 && Core.fillRatio(session) < 1);
});

check('星级分档：0.82 三星、0.55 二星、填满一星', () => {
  assert.strictEqual(Core.starsForFit(0.9, true), 3);
  assert.strictEqual(Core.starsForFit(0.82, true), 3);
  assert.strictEqual(Core.starsForFit(0.81, true), 2);
  assert.strictEqual(Core.starsForFit(0.55, true), 2);
  assert.strictEqual(Core.starsForFit(0.54, true), 1);
  assert.strictEqual(Core.starsForFit(0.99, false), 0);
});

check('大部分贴合、少数乱涂：二星', () => {
  const session = sessionOf('autumn-path');
  const list = Core.regionList(session.art);
  list.forEach((shape, i) => {
    /* 一半按参考色，一半故意乱涂 */
    Core.paint(session, shape[0], i % 2 === 0 ? session.art.palette[shape[2]] : '#00ff00');
  });
  const result = Core.evaluate(session);
  assert.ok(result.fit > 0.55 && result.fit < 0.82, '贴合度 ' + result.fit.toFixed(2));
  assert.strictEqual(Core.stars(session), 2);
});

console.log('绘制与撤销');

check('重复填同色不产生操作，改色可撤销回原色', () => {
  const session = sessionOf('sunflowers');
  const id = Core.regionList(session.art)[0][0];
  assert.strictEqual(Core.paint(session, id, '#111111'), true);
  assert.strictEqual(Core.paint(session, id, '#111111'), false);
  assert.strictEqual(Core.paint(session, id, '#222222'), true);
  assert.strictEqual(session.ops.length, 2);
  Core.undo(session);
  assert.strictEqual(session.fills[id], '#111111');
  Core.undo(session);
  assert.strictEqual(session.fills[id], undefined);
  assert.strictEqual(Core.undo(session), false);
});

check('非法分区与空颜色会被忽略', () => {
  const session = sessionOf('the-kiss');
  assert.strictEqual(Core.paint(session, 'nope', '#fff000'), false);
  assert.strictEqual(Core.paint(session, Core.regionList(session.art)[0][0], ''), false);
  assert.strictEqual(session.ops.length, 0);
});

check('无道具时撤销栈限 20 步', () => {
  const session = Core.createSession(Core.findArt('neon-city'));
  const ids = Core.regionIds(session.art);
  for (let i = 0; i < 26; i += 1) {
    Core.paint(session, ids[i % ids.length], i === 0 ? '#010101' : '#' + (100000 + i).toString(16).slice(0, 6));
  }
  const progress = Core.createProgress();
  assert.strictEqual(Core.canUndo(session, progress), false);
  session.ops = session.ops.slice(-20);
  assert.strictEqual(Core.canUndo(session, progress), true);
});

check('厚涂笔触可撤销', () => {
  const session = sessionOf('misty-forest');
  Core.addStroke(session, { x: 10, y: 10, r: 6, color: '#fff', angle: 0.4 });
  Core.addStroke(session, { x: 20, y: 30, r: 6, color: '#fff', angle: 0.4 });
  assert.strictEqual(session.strokes.length, 2);
  Core.undo(session);
  assert.strictEqual(session.strokes.length, 1);
  assert.strictEqual(session.ops.length, 1);
});

check('自动混色补齐剩余分区', () => {
  const session = sessionOf('snowy-peak');
  const ids = Core.regionIds(session.art);
  Core.paint(session, ids[0], '#ffffff');
  const added = Core.autoFill(session);
  assert.strictEqual(added, ids.length - 1);
  assert.strictEqual(Core.isFilled(session), true);
  assert.strictEqual(Core.stars(session), 3);
});

check('重开一局清空画布', () => {
  const session = sessionOf('tea-table');
  paintAll(session, () => '#123456');
  Core.addStroke(session, { x: 1, y: 1, r: 3, color: '#fff', angle: 0 });
  Core.resetSession(session);
  assert.deepStrictEqual(session.fills, {});
  assert.strictEqual(session.ops.length, 0);
  assert.strictEqual(session.strokes.length, 0);
});

console.log('进度与道具');

check('提交后记录最佳星级与贴合度', () => {
  const progress = Core.createProgress();
  const session = sessionOf('starry-night');
  paintAll(session, (shape, art) => art.palette[shape[2]]);
  const first = Core.commit(progress, session);
  assert.strictEqual(first.stars, 3);
  assert.strictEqual(first.best, 3);
  assert.strictEqual(first.fit, 100);
  assert.strictEqual(progress.best['starry-night'], 3);

  /* 再画一次更差的配色，不应覆盖最佳记录 */
  const worse = sessionOf('starry-night');
  paintAll(worse, () => '#00ff00');
  const second = Core.commit(progress, worse);
  assert.strictEqual(second.stars, 1);
  assert.strictEqual(progress.best['starry-night'], 3);
  assert.strictEqual(progress.fit['starry-night'], 100);
});

check('星数达标解锁道具', () => {
  const progress = Core.createProgress();
  assert.deepStrictEqual(Core.unlockedProps(progress), ['impasto']);
  assert.strictEqual(Core.hasProp(progress, 'knife'), false);

  const session = sessionOf('mondrian');
  paintAll(session, (shape, art) => art.palette[shape[2]]);
  const result = Core.commit(progress, session);
  assert.strictEqual(result.totalStars, 3);
  assert.strictEqual(Core.hasProp(progress, 'knife'), false);

  const second = sessionOf('starry-night');
  paintAll(second, (shape, art) => art.palette[shape[2]]);
  Core.commit(progress, second);
  assert.strictEqual(Core.totalStars(progress), 6);
  assert.strictEqual(Core.hasProp(progress, 'knife'), true);
  assert.strictEqual(Core.hasProp(progress, 'gold'), false);
});

check('下一件道具给出还差几星', () => {
  const progress = Core.createProgress();
  const next = Core.nextProp(progress);
  assert.strictEqual(next.prop.id, 'knife');
  assert.strictEqual(next.need, 4);
  progress.best['starry-night'] = 3;
  progress.best['mondrian'] = 3;
  assert.strictEqual(Core.nextProp(progress).prop.id, 'gold');
  assert.strictEqual(Core.nextProp(progress).need, 2);
});

check('存档往返只保留合法数据', () => {
  const progress = Core.createProgress();
  progress.best['starry-night'] = 3;
  progress.best['ghost'] = 2;
  progress.fit['starry-night'] = 87;
  progress.fit['ghost'] = 40;
  progress.best['mondrian'] = 9;

  const raw = JSON.parse(JSON.stringify(Core.serializeProgress(progress)));
  const back = Core.parseProgress(raw);
  assert.strictEqual(back.best['starry-night'], 3);
  assert.strictEqual(back.fit['starry-night'], 87);
  assert.strictEqual(back.best['ghost'], undefined);
  assert.strictEqual(back.fit['ghost'], undefined);
  assert.strictEqual(back.best['mondrian'], undefined, '越界星级应被丢弃');
  assert.deepStrictEqual(Core.parseProgress(null), Core.createProgress());
});

console.log('\n' + (process.exitCode ? '存在失败用例' : '规则测试通过：' + pass + ' 项'));
