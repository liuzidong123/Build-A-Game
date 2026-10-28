/* 规则回归：node tests/logic.test.cjs */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const ROOT = path.join(__dirname, '..');
const sandbox = { console, Math, Number, String, Array, Object, JSON };
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'logic.js'), 'utf8'), sandbox, { filename: 'logic.js' });

const C = sandbox.ChessCore;
const W = C.WHITE;
const B = C.BLACK;

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

const at = (name) => C.idxOf(name.charCodeAt(0) - 97, Number(name.charAt(1)));
const fen = (state) => C.toFEN(state);
const fresh = () => C.createState();
const mk = (f) => C.fromFEN(f);
/* 数组来自 vm realm，先转成本域数组再比较，避免原型不同导致的误报 */
const same = (actual, expected, msg) => assert.deepStrictEqual(Array.prototype.slice.call(actual), expected, msg);

function play(state, from, to, promo) {
  const move = C.moveAt(state, at(from), at(to), promo);
  assert.ok(move, '找不到合法走法：' + from + '-' + to);
  return C.applyMove(state, move);
}

function targets(state, from) {
  return C.targetsFrom(state, at(from)).map(C.squareName).sort();
}

console.log('棋盘与走法');

check('初始局面：白先、32 枚棋子、FEN 标准', () => {
  const s = fresh();
  assert.strictEqual(s.turn, W);
  assert.strictEqual(s.board.filter(Boolean).length, 32);
  assert.strictEqual(fen(s), C.START_FEN);
  assert.strictEqual(s.status, 'playing');
});

check('初始合法走法 20 步，perft 20 / 400 / 8902', () => {
  const s = fresh();
  assert.strictEqual(C.legalMoves(s, W).length, 20);
  assert.strictEqual(C.perft(s, 1), 20);
  assert.strictEqual(C.perft(s, 2), 400);
  assert.strictEqual(C.perft(s, 3), 8902);
});

check('Kiwipete 局面 perft 48 / 2039（易位、吃过路兵、将军混合）', () => {
  const s = mk('r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1');
  assert.strictEqual(C.legalMoves(s, W).length, 48);
  assert.strictEqual(C.perft(s, 1), 48);
  assert.strictEqual(C.perft(s, 2), 2039);
});

check('兵：首发可两步，之后一步，不能后退', () => {
  const s = fresh();
  same(targets(s, 'e2'), ['e3', 'e4']);
  play(s, 'e2', 'e4');
  play(s, 'a7', 'a6');
  same(targets(s, 'e4'), ['e5']);
});

check('兵不能越过已有棋子', () => {
  const s = mk('4k3/8/8/8/8/4n3/4P3/4K3 w - - 0 1');
  same(targets(s, 'e2'), []);
  const t = mk('4k3/8/8/8/4n3/8/4P3/4K3 w - - 0 1');
  same(targets(t, 'e2'), ['e3']);
});

check('马走日，是唯一能越过兵墙的棋子', () => {
  const s = fresh();
  same(targets(s, 'b1'), ['a3', 'c3']);
  same(targets(s, 'g1'), ['f3', 'h3']);
});

check('象与后受兵墙限制，开局无路', () => {
  const s = fresh();
  same(targets(s, 'c1'), []);
  same(targets(s, 'd1'), []);
  play(s, 'e2', 'e4');
  play(s, 'a7', 'a6');
  same(targets(s, 'f1'), ['a6', 'b5', 'c4', 'd3', 'e2']);
});

check('兵斜向吃子，正前方有子时不能吃', () => {
  const s = mk('4k3/8/8/8/8/3p4/4P3/4K3 w - - 0 1');
  same(targets(s, 'e2'), ['d3', 'e3', 'e4']);
  const t = mk('4k3/8/8/8/8/4p3/4P3/4K3 w - - 0 1');
  same(targets(t, 'e2'), []);
});

check('王只能走一格，且不能走进被攻击格', () => {
  const s = mk('4k3/8/8/8/8/8/8/4K3 w - - 0 1');
  same(targets(s, 'e1'), ['d1', 'd2', 'e2', 'f1', 'f2']);
  const t = mk('4k3/8/8/8/8/8/r7/4K3 w - - 0 1');
  same(targets(t, 'e1'), ['d1', 'f1']);
});

check('被牵制的子不能离开，王也不可自投罗网', () => {
  const s = mk('4r1k1/8/8/8/8/8/4R3/4K3 w - - 0 1');
  same(targets(s, 'e2'), ['e3', 'e4', 'e5', 'e6', 'e7', 'e8']);
  const t = mk('4k3/8/8/8/8/8/8/4K1r1 w - - 0 1');
  same(targets(t, 'e1'), ['d2', 'e2', 'f2']);
});

console.log('将军、将杀与和棋');

check('被将军时只能应将', () => {
  const s = mk('4k3/8/8/8/8/8/4r3/4K3 w - - 0 1');
  assert.strictEqual(C.inCheck(s, W), true);
  same(targets(s, 'e1'), ['d1', 'e2', 'f1']);
  same(targets(s, 'a1'), []);
});

check('愚人杀：2...Qh4# 判定将杀，黑胜', () => {
  const s = fresh();
  play(s, 'f2', 'f3');
  play(s, 'e7', 'e5');
  play(s, 'g2', 'g4');
  const res = play(s, 'd8', 'h4');
  assert.strictEqual(res.san, 'Qh4#');
  assert.strictEqual(s.status, 'checkmate');
  assert.strictEqual(s.winner, B);
  assert.strictEqual(C.legalMoves(s, W).length, 0);
});

check('逼和：无子可动但未被将军判和', () => {
  const s = mk('k7/8/1Q6/8/8/8/8/7K b - - 0 1');
  assert.strictEqual(C.inCheck(s, B), false);
  assert.strictEqual(C.legalMoves(s, B).length, 0);
  assert.strictEqual(C.refreshStatus(s), 'stalemate');
});

check('三次重复局面判和', () => {
  const s = fresh();
  for (let i = 0; i < 2; i += 1) {
    play(s, 'g1', 'f3');
    play(s, 'g8', 'f6');
    play(s, 'f3', 'g1');
    play(s, 'f6', 'g8');
  }
  assert.strictEqual(s.status, 'draw');
  assert.strictEqual(s.reason, 'repetition');
});

check('50 回合规则判和', () => {
  const s = mk('4k3/8/8/8/8/8/8/R3K3 w - - 99 80');
  play(s, 'a1', 'a2');
  assert.strictEqual(s.halfmove, 100);
  assert.strictEqual(s.status, 'draw');
  assert.strictEqual(s.reason, 'fifty');
});

check('子力不足判和：K vs K、K+B vs K、同色格双象', () => {
  assert.strictEqual(C.insufficientMaterial(mk('4k3/8/8/8/8/8/8/4K3 w - - 0 1')), true);
  assert.strictEqual(C.insufficientMaterial(mk('4k3/8/8/8/8/8/8/2B1K3 w - - 0 1')), true);
  assert.strictEqual(C.insufficientMaterial(mk('4k3/8/8/8/8/8/8/1N2K3 w - - 0 1')), true);
  assert.strictEqual(C.insufficientMaterial(mk('5b1k/8/8/8/8/8/8/2B1K3 w - - 0 1')), true);
  assert.strictEqual(C.insufficientMaterial(mk('4k3/8/8/8/8/8/8/R3K3 w - - 0 1')), false);
});

console.log('特殊规则');

check('王车易位：长易位与短易位都可走，王与车同时归位', () => {
  const s = mk('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1');
  assert.ok(targets(s, 'e1').indexOf('g1') >= 0);
  assert.ok(targets(s, 'e1').indexOf('c1') >= 0);
  play(s, 'e1', 'g1');
  assert.strictEqual(s.board[at('f1')], 'wR');
  assert.strictEqual(s.board[at('g1')], 'wK');
  assert.strictEqual(s.castling.wK, false);
});

check('易位被阻挡 / 被将军 / 经过攻击格时都不可用', () => {
  const blocked = mk('r3k2r/8/8/8/8/8/8/R3KB1R w KQkq - 0 1');
  assert.ok(targets(blocked, 'e1').indexOf('g1') < 0);
  const checked = mk('r3k2r/8/8/8/8/8/4r3/R3K2R w KQkq - 0 1');
  assert.ok(targets(checked, 'e1').indexOf('g1') < 0);
  const through = mk('r3k2r/8/8/8/8/8/5r2/R3K2R w KQkq - 0 1');
  assert.ok(targets(through, 'e1').indexOf('g1') < 0);
  assert.ok(targets(through, 'e1').indexOf('c1') >= 0);
});

check('吃过路兵：仅下一步有效，且被吃兵从棋盘移除', () => {
  const s = mk('4k3/3p4/8/4P3/8/8/8/4K3 b - - 0 1');
  play(s, 'd7', 'd5');
  assert.strictEqual(s.ep, at('d6'));
  const white = C.movesFrom(s, at('e5'));
  const ep = white.filter((m) => m.ep);
  assert.strictEqual(ep.length, 1);
  C.applyMove(s, ep[0]);
  assert.strictEqual(s.board[at('d6')], 'wP');
  assert.strictEqual(s.board[at('d5')], null);
  assert.strictEqual(s.ep, null);
});

check('升变：到达底线生成四种选择，选其后立即生效', () => {
  const s = mk('4k3/1P6/8/8/8/8/8/4K3 w - - 0 1');
  const moves = C.movesFrom(s, at('b7'));
  const promos = moves.filter((m) => m.promotion).map((m) => m.promotion).sort();
  same(promos, ['B', 'N', 'Q', 'R']);
  const res = play(s, 'b7', 'b8', 'Q');
  assert.strictEqual(s.board[at('b8')], 'wQ');
  assert.strictEqual(res.san, 'b8=Q+');
  assert.strictEqual(C.inCheck(s, B), true);
});

check('升变选车/象也合法，SAN 带 =R', () => {
  const s = mk('4k3/1P6/8/8/8/8/8/4K3 w - - 0 1');
  const res = play(s, 'b7', 'b8', 'R');
  assert.strictEqual(res.san, 'b8=R+');
  assert.strictEqual(s.board[at('b8')], 'wR');
});

console.log('记谱与悔棋');

check('SAN：兵、马、吃子、易位、将军后缀', () => {
  const s = fresh();
  assert.strictEqual(play(s, 'e2', 'e4').san, 'e4');
  play(s, 'd7', 'd5');
  assert.strictEqual(play(s, 'e4', 'd5').san, 'exd5');
  play(s, 'd8', 'd7');
  assert.strictEqual(play(s, 'g1', 'f3').san, 'Nf3');
  play(s, 'd7', 'g4');
  assert.strictEqual(play(s, 'f1', 'e2').san, 'Be2');
  const t = mk('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1');
  assert.strictEqual(play(t, 'e1', 'g1').san, 'O-O');
  const u = mk('r3k2r/8/8/8/8/8/8/R3K2R b KQkq - 0 1');
  assert.strictEqual(play(u, 'e8', 'c8').san, 'O-O-O');
});

check('SAN 消歧：线路相同时标注起始横线，不同线时标注字母', () => {
  const sameFile = mk('4k3/8/8/R7/8/8/8/R3K3 w - - 0 1');
  assert.strictEqual(play(sameFile, 'a1', 'a3').san, 'R1a3');
  const diffFile = mk('4k3/8/8/6N1/8/2N5/8/4K3 w - - 0 1');
  assert.strictEqual(play(diffFile, 'c3', 'e4').san, 'Nce4');
});

check('悔棋可以逐步回到初始局面', () => {
  const s = fresh();
  play(s, 'e2', 'e4');
  play(s, 'e7', 'e5');
  play(s, 'g1', 'f3');
  const before = fen(s);
  C.undoMove(s);
  assert.strictEqual(C.toFEN(s), 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2');
  C.undoMove(s);
  C.undoMove(s);
  assert.strictEqual(fen(s), C.START_FEN);
  assert.strictEqual(C.undoMove(s), null);
  assert.strictEqual(before.length > 0, true);
});

check('悔棋能完全复原易位与吃过路兵造成的棋盘变化', () => {
  const s = mk('4k3/3p4/8/4P3/8/8/8/4K3 b - - 0 1');
  const start = fen(s);
  play(s, 'd7', 'd5');
  C.applyMove(s, C.movesFrom(s, at('e5')).filter((m) => m.ep)[0]);
  C.undoMove(s);
  C.undoMove(s);
  assert.strictEqual(fen(s), start);
});

check('升变后悔棋恢复为兵', () => {
  const s = mk('4k3/1P6/8/8/8/8/8/4K3 w - - 0 1');
  play(s, 'b7', 'b8', 'Q');
  C.undoMove(s);
  assert.strictEqual(s.board[at('b8')], null);
  assert.strictEqual(s.board[at('b7')], 'wP');
});

console.log('');
if (failures.length) {
  console.error('失败 ' + failures.length + ' 项：');
  failures.forEach((line) => console.error('  - ' + line));
  process.exit(1);
}
console.log('全部通过：' + pass + ' 项');
