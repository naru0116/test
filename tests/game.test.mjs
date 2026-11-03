import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createGame, applyAction, legalActions, forfeit, RULES, CITIES, neighbors, knownIdentity,
} from '../js/game.js';

function seeded(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

const players = (n) => Array.from({ length: n }, (_, i) => ({ id: `u${i}`, name: `P${i + 1}` }));

function checkInvariants(s) {
  // ファイルは「盤上・工作員・山札」のどこか1か所にだけ存在する
  const seen = new Map();
  const mark = (f, where) => {
    assert.ok(!seen.has(f), `file ${f} duplicated (${seen.get(f)} / ${where})`);
    seen.set(f, where);
  };
  for (const [c, fs] of Object.entries(s.cityFiles)) fs.forEach((f) => mark(f, c));
  for (const a of s.agents) {
    a.files.forEach((f) => mark(f, a.id));
    assert.ok(a.files.length <= RULES.carryLimit);
  }
  s.fileDeck.forEach((f) => mark(f, 'deck'));
  assert.equal(seen.size, Object.keys(s.files).length);
  // カード総数は不変
  const cards = s.deck.length + s.discard.length + s.hands.reduce((n, h) => n + h.length, 0);
  assert.equal(cards, 33);
  s.hands.forEach((h) => assert.ok(h.length <= RULES.handLimit));
  // エースは各プレイヤーの工作員
  s.aces.forEach((id, i) => assert.ok(id.startsWith(`p${i}a`)));
}

test('マップはすべて連結している', () => {
  const seen = new Set(['tokyo']);
  const q = ['tokyo'];
  while (q.length) for (const n of neighbors(q.shift())) if (!seen.has(n)) { seen.add(n); q.push(n); }
  assert.equal(seen.size, CITIES.length);
});

test('ランダム対局が2〜6人で最後まで進む', () => {
  for (let n = 2; n <= 6; n++) {
    for (let g = 0; g < 60; g++) {
      const rng = seeded(n * 1000 + g);
      let s = createGame(players(n), rng);
      checkInvariants(s);
      let steps = 0;
      while (s.status === 'playing') {
        const p = s.turn.player;
        const acts = legalActions(s, p);
        assert.ok(acts.length > 0);
        // ターン終了ばかり選ばないよう少し重みを付ける
        const pick = acts.length > 1 && rng() < 0.9 ? acts[1 + Math.floor(rng() * (acts.length - 1))] : acts[0];
        s = applyAction(s, p, pick, rng);
        checkInvariants(s);
        assert.ok(++steps < 5000, 'game did not terminate');
      }
      assert.ok(s.winner && s.winner.players.length >= 1);
      assert.ok(s.turn.round <= RULES.maxRounds + 1);
    }
  }
});

test('手番以外は行動できない', () => {
  const s = createGame(players(3), seeded(1));
  assert.throws(() => applyAction(s, 1, { type: 'endTurn' }), /手番/);
});

test('本物の工作員が本物2つを拠点に持ち帰ると勝利', () => {
  let s = createGame(players(2), seeded(7));
  const ace = s.agents.find((a) => a.id === s.aces[0]);
  const reals = Object.keys(s.files).filter((f) => s.files[f].real).slice(0, 2);
  // 盤面を直接いじってテスト状況を作る
  for (const f of reals) {
    for (const k of Object.keys(s.cityFiles)) s.cityFiles[k] = s.cityFiles[k].filter((x) => x !== f);
    s.fileDeck = s.fileDeck.filter((x) => x !== f);
  }
  ace.files = reals;
  ace.city = 'seoul';
  s = applyAction(s, 0, { type: 'move', agent: ace.id, to: 'tokyo' });
  assert.equal(s.status, 'finished');
  assert.deepEqual(s.winner.players, [0]);
});

test('囮が本物2つを持ち帰っても勝利にならない', () => {
  let s = createGame(players(2), seeded(8));
  const decoy = s.agents.find((a) => a.owner === 0 && a.id !== s.aces[0]);
  const reals = Object.keys(s.files).filter((f) => s.files[f].real).slice(0, 2);
  for (const f of reals) {
    for (const k of Object.keys(s.cityFiles)) s.cityFiles[k] = s.cityFiles[k].filter((x) => x !== f);
    s.fileDeck = s.fileDeck.filter((x) => x !== f);
  }
  decoy.files = reals;
  decoy.city = 'seoul';
  s = applyAction(s, 0, { type: 'move', agent: decoy.id, to: 'tokyo' });
  assert.equal(s.status, 'playing');
});

test('尋問の結果は本人にしか見えず、偽装工作でリセットされる', () => {
  let s = createGame(players(2), seeded(3));
  const mine = s.agents.find((a) => a.owner === 0);
  const target = s.agents.find((a) => a.owner === 1);
  mine.city = 'cairo';
  target.city = 'cairo';
  s.hands[0] = ['interrogate'];
  s = applyAction(s, 0, { type: 'card', card: 0, agent: mine.id, target: target.id });
  assert.ok(knownIdentity(s, 0, target.id));
  const privateLogs = s.log.filter((l) => l.to === 0);
  assert.ok(privateLogs.some((l) => l.text.includes('尋問結果')));
  assert.ok(!s.log.some((l) => l.to === undefined && l.text.includes('尋問結果')));

  // 相手の手番まで進めて偽装工作
  s = applyAction(s, 0, { type: 'endTurn' });
  const other = s.agents.find((a) => a.owner === 1 && a.id !== target.id);
  s.hands[1] = ['disguise'];
  s = applyAction(s, 1, { type: 'card', card: 0, agent: target.id, agent2: other.id });
  assert.equal(knownIdentity(s, 0, target.id), null);
});

test('拘束でファイルが落ち、工作員は拠点へ戻る', () => {
  let s = createGame(players(2), seeded(4));
  const mine = s.agents.find((a) => a.owner === 0);
  const target = s.agents.find((a) => a.owner === 1);
  mine.city = 'cairo';
  target.city = 'cairo';
  const f = s.cityFiles.cairo.pop();
  target.files = [f];
  s.hands[0] = ['arrest'];
  s = applyAction(s, 0, { type: 'card', card: 0, agent: mine.id, target: target.id });
  const t = s.agents.find((a) => a.id === target.id);
  assert.equal(t.city, s.players[1].base);
  assert.deepEqual(t.files, []);
  assert.ok(s.cityFiles.cairo.includes(f));
});

test('離脱で残り1人になると勝利', () => {
  let s = createGame(players(3), seeded(5));
  s = forfeit(s, 1);
  assert.equal(s.status, 'playing');
  s = forfeit(s, 0);
  assert.equal(s.status, 'finished');
  assert.deepEqual(s.winner.players, [2]);
  assert.equal(s.agents.filter((a) => a.owner === 0 && a.city).length, 0);
});
