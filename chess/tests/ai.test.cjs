/* 电脑对手回归：node tests/ai.test.cjs */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const ROOT = path.join(__dirname, '..');
const sandbox = { console, Math, Number, String, Array, Object, JSON, Date };
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'logic.js'), 'utf8'), sandbox, { filename: 'logic.js' });
vm.runInContext(fs.readFileSync(path.join(ROOT, 'ai.js'), 'utf8'), sandbox, { filename: 'ai.js' });

const C = sandbox.ChessCore;
const AI = sandbox.ChessAI;

let pass = 0;
const failures = [];
function check(name, fn) {
  try {
    fn();
    pass += 1;
    console.log('  PASS  ' + name);
  } catch (err) {
    failures.push(name + ' → ' + err.message);
    console.log('  FAIL  ' + name + ' → ' + err.message);
  }
}

const mk = (f) => C.fromFEN(f);
const at = (name) => C.idxOf(name.charCodeAt(0) - 97, Number(name.charAt(1)));
const name = (move) => C.squareName(move.from) + '-' + C.squareName(move.to)
  + (move.promotion ? '=' + move.promotion : '');

check('静态评估在对称局面为 0，多子一方为正', () => {
  assert.strictEqual(AI.evaluate(C.createState()), 0);
  const up = mk('4k3/8/8/8/8/8/8/R3K3 w - - 0 1');
  assert.ok(AI.evaluate(up) > 400, '白方多车应显著为正：' + AI.evaluate(up));
  const down = mk('r3k3/8/8/8/8/8/8/4K3 w - - 0 1');
  assert.ok(AI.evaluate(down) < -400);
});

check('一步杀能抓住：后车配合的后排杀', () => {
  const s = mk('6k1/5ppp/8/8/8/8/5PPP/4R1K1 w - - 0 1');
  const move = AI.chooseMove(s, { level: 'normal', timeMs: 800 });
  assert.ok(move, '应当给出走法');
  C.applyMove(s, move);
  assert.strictEqual(s.status, 'checkmate');
  assert.strictEqual(s.winner, C.WHITE);
});

check('能吃掉无保护的后', () => {
  const s = mk('4k3/8/8/8/8/8/4q3/3QK3 w - - 0 1');
  const move = AI.chooseMove(s, { level: 'hard', timeMs: 900 });
  assert.strictEqual(name(move), 'd1-e2', '应吃掉 e2 的后');
  C.applyMove(s, move);
  assert.strictEqual(s.board[at('e2')], 'wQ');
});

check('不会白送子：被将军时优先解围', () => {
  const s = mk('4k3/8/8/8/8/8/4r3/4K3 w - - 0 1');
  const move = AI.chooseMove(s, { level: 'normal', timeMs: 600 });
  const next = C.cloneMeta(s);
  C.play(next, move);
  assert.strictEqual(C.inCheck(next, C.WHITE), false, '走完不能还被将军');
});

check('任何难度给出的都是合法走法', () => {
  const fens = [
    C.START_FEN,
    'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1',
    '8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1',
    '4k3/8/8/8/8/8/8/4K2R w K - 0 1'
  ];
  fens.forEach((fen) => {
    const s = mk(fen);
    const legal = C.legalMoves(s, s.turn).map(name);
    ['easy', 'normal', 'hard'].forEach((level) => {
      const move = AI.chooseMove(s, { level, timeMs: 500 });
      assert.ok(move, level + ' 无走法 ' + fen);
      assert.ok(legal.indexOf(name(move)) >= 0, level + ' 走了非法着法：' + name(move));
    });
  });
});

check('升变局面优先升后', () => {
  const s = mk('4k3/1P6/8/8/8/8/8/4K3 w - - 0 1');
  const move = AI.chooseMove(s, { level: 'normal', timeMs: 500 });
  assert.strictEqual(move.to, at('b8'));
  assert.strictEqual(move.promotion, 'Q');
});

check('终局局面不再出招', () => {
  const s = mk('6k1/5ppp/8/8/8/8/5PPP/4R1K1 w - - 0 1');
  const move = AI.chooseMove(s, { level: 'normal', timeMs: 500 });
  C.applyMove(s, move);
  assert.strictEqual(AI.chooseMove(s, { level: 'normal' }), null);
  const stale = mk('8/8/8/8/8/8/8/4K3 w - - 0 1');
  C.refreshStatus(stale);
  assert.strictEqual(AI.chooseMove(stale, { level: 'normal' }), null);
});

check('思考时间受控，不会卡死界面', () => {
  const s = C.createState();
  const start = Date.now();
  AI.chooseMove(s, { level: 'hard', timeMs: 300 });
  const used = Date.now() - start;
  assert.ok(used < 4000, '思考耗时过长：' + used + 'ms');
});

console.log('');
if (failures.length) {
  console.error('失败 ' + failures.length + ' 项：');
  failures.forEach((line) => console.error('  - ' + line));
  process.exit(1);
}
console.log('全部通过：' + pass + ' 项');
