import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createGame, applyAction, legalActions, forfeit, RULES, CITIES, neighbors, knownIdentity,
  visibleTraps, trapHints, DECK_SIZE, BASE_SETS, DIST,
} from '../js/game.js';
import { chooseAction } from '../js/cpu.js';

export function seeded(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

const players = (n) => Array.from({ length: n }, (_, i) => ({ id: `u${i}`, name: `P${i + 1}` }));

function checkInvariants(s) {
  // ファイルは「盤上・工作員・山」のどこか1か所にだけ存在する
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
  // カード総数は不変（山札・捨て札・作戦本部・手札）
  const cards = s.deck.length + s.discard.length + s.market.length + s.hands.reduce((n, h) => n + h.length, 0);
  assert.equal(cards, DECK_SIZE);
  s.hands.forEach((h) => assert.ok(h.length <= RULES.handLimit));
  assert.ok(s.market.length <= RULES.marketSize);
  s.aces.forEach((id, i) => assert.ok(id.startsWith(`p${i}a`)));
  // 罠は1人2つまで、拠点には置かれない
  s.players.forEach((p, i) => assert.ok(s.traps.filter((t) => t.owner === i).length <= RULES.trapLimit));
  s.traps.forEach((t) => assert.ok(!s.players.some((p) => p.base === t.city)));
}

// 手番の最初にカードを引いて行動フェーズにする
function toAction(s, p = s.turn.player) {
  if (s.turn.phase === 'draw') s = applyAction(s, p, { type: 'draw', from: 'deck' });
  s.turn.actionsLeft = RULES.actionsPerTurn; // 先手の初手（行動1回）の影響を受けないように
  return s;
}

test('マップはすべて連結している', () => {
  const seen = new Set(['tokyo']);
  const q = ['tokyo'];
  while (q.length) for (const n of neighbors(q.shift())) if (!seen.has(n)) { seen.add(n); q.push(n); }
  assert.equal(seen.size, CITIES.length);
});

test('ランダム対局が2〜6人で最後まで進む', () => {
  for (let n = 2; n <= 6; n++) {
    for (let g = 0; g < 50; g++) {
      const rng = seeded(n * 1000 + g);
      let s = createGame(players(n), rng);
      checkInvariants(s);
      let steps = 0;
      while (s.status === 'playing') {
        const p = s.turn.player;
        const acts = legalActions(s, p);
        assert.ok(acts.length > 0);
        const nonEnd = acts.filter((a) => a.type !== 'endTurn');
        const pick = nonEnd.length && rng() < 0.9 ? nonEnd[Math.floor(rng() * nonEnd.length)] : acts[0];
        s = applyAction(s, p, pick, rng);
        checkInvariants(s);
        assert.ok(++steps < 8000, 'game did not terminate');
      }
      assert.ok(s.winner && s.winner.players.length >= 1);
    }
  }
});

test('CPU同士の対局が2〜6人・全難易度で最後まで進み、多くは任務完了で決着する', () => {
  const stats = {};
  for (const level of ['easy', 'normal', 'hard']) {
    for (let n = 2; n <= 6; n++) {
      let delivered = 0;
      let rounds = 0;
      const games = 25;
      for (let g = 0; g < games; g++) {
        const rng = seeded(n * 7919 + g * 31 + level.length);
        let s = createGame(players(n), rng);
        let steps = 0;
        while (s.status === 'playing') {
          const p = s.turn.player;
          const a = chooseAction(s, p, level, rng);
          s = applyAction(s, p, a, rng);
          assert.ok(++steps < 8000, 'CPU game did not terminate');
        }
        checkInvariants(s);
        if (!s.winner.byScore) delivered += 1;
        rounds += s.turn.round;
      }
      stats[`${level}-${n}`] = { delivered: delivered / games, avgRound: +(rounds / games).toFixed(1) };
    }
  }
  console.log(stats);
  // ふつう・つよい同士なら、大半は時間切れではなく任務完了で決着する
  for (let n = 2; n <= 6; n++) assert.ok(stats[`hard-${n}`].delivered >= 0.6, `hard-${n}: ${JSON.stringify(stats[`hard-${n}`])}`);
});

test('CPUは強さ順に勝ちやすい（つよい vs やさしい）', () => {
  let hardWins = 0;
  let easyWins = 0;
  for (let g = 0; g < 80; g++) {
    const rng = seeded(424242 + g);
    const hardSeat = g % 2;
    let s = createGame(players(2), rng);
    while (s.status === 'playing') {
      const p = s.turn.player;
      s = applyAction(s, p, chooseAction(s, p, p === hardSeat ? 'hard' : 'easy', rng), rng);
    }
    if (s.winner.players.length === 1) {
      if (s.winner.players[0] === hardSeat) hardWins += 1; else easyWins += 1;
    }
  }
  console.log({ hardWins, easyWins });
  assert.ok(hardWins > easyWins * 1.5);
});

test('手番の最初は必ずカードを引く（作戦本部からも選べる）', () => {
  let s = createGame(players(2), seeded(1));
  assert.equal(s.turn.phase, 'draw');
  assert.equal(s.market.length, RULES.marketSize);
  assert.throws(() => applyAction(s, 0, { type: 'endTurn' }), /カードを1枚引いて/);
  const card = s.market[1];
  const before = s.hands[0].length;
  s = applyAction(s, 0, { type: 'draw', from: 'market', index: 1 });
  assert.equal(s.hands[0].length, before + 1);
  assert.equal(s.hands[0].at(-1), card);
  assert.equal(s.market.length, RULES.marketSize);
  assert.equal(s.turn.phase, 'action');
  assert.equal(s.turn.actionsLeft, RULES.firstTurnActions); // 先手の初手は行動1回
  s = applyAction(s, 0, { type: 'endTurn' });
  s = applyAction(s, 1, { type: 'draw', from: 'deck' });
  assert.equal(s.turn.actionsLeft, RULES.actionsPerTurn);
});

test('どの都市からも道は3本（有利な場所がない）', () => {
  for (const c of CITIES) assert.equal(neighbors(c.id).length, 3, c.id);
});

test('拠点同士は隣り合わない（2〜3人）', () => {
  for (let n = 2; n <= 5; n++) {
    const set = BASE_SETS[n];
    assert.equal(set.length, n);
    if (n <= 3) for (const a of set) for (const b of set) if (a !== b) assert.ok(DIST[a][b] >= 2);
  }
});

test('手番以外は行動できない', () => {
  const s = createGame(players(3), seeded(1));
  assert.throws(() => applyAction(s, 1, { type: 'draw', from: 'deck' }), /手番/);
});

function placeReal(s, agent, count) {
  const reals = Object.keys(s.files).filter((f) => s.files[f].real).slice(0, count);
  for (const f of reals) {
    for (const k of Object.keys(s.cityFiles)) s.cityFiles[k] = s.cityFiles[k].filter((x) => x !== f);
    s.fileDeck = s.fileDeck.filter((x) => x !== f);
  }
  agent.files = reals;
  return reals;
}

test('本物の工作員が本物2つを拠点に持ち帰ると勝利', () => {
  let s = toAction(createGame(players(2), seeded(7)));
  const ace = s.agents.find((a) => a.id === s.aces[0]);
  placeReal(s, ace, 2);
  ace.city = 'beijing';
  s = applyAction(s, 0, { type: 'move', agent: ace.id, to: 'tokyo' });
  assert.equal(s.status, 'finished');
  assert.deepEqual(s.winner.players, [0]);
});

test('囮が本物2つを持ち帰っても勝利にならない', () => {
  let s = toAction(createGame(players(2), seeded(8)));
  const decoy = s.agents.find((a) => a.owner === 0 && a.id !== s.aces[0]);
  placeReal(s, decoy, 2);
  decoy.city = 'beijing';
  s = applyAction(s, 0, { type: 'move', agent: decoy.id, to: 'tokyo' });
  assert.equal(s.status, 'playing');
});

test('偵察はファイルを取らずに中身だけ知る', () => {
  let s = toAction(createGame(players(2), seeded(9)));
  const a = s.agents.find((x) => x.owner === 0);
  a.city = 'istanbul';
  const f = s.cityFiles.istanbul[0];
  s = applyAction(s, 0, { type: 'scout', agent: a.id, file: f });
  assert.ok(s.cityFiles.istanbul.includes(f));
  assert.equal(s.knowledge[0].files[f], s.files[f].real);
  assert.equal(s.knowledge[1].files[f], undefined);
});

test('尋問の結果は本人にしか見えず、偽装工作でリセットされる', () => {
  let s = toAction(createGame(players(2), seeded(3)));
  const mine = s.agents.find((a) => a.owner === 0);
  const target = s.agents.find((a) => a.owner === 1);
  mine.city = 'istanbul';
  target.city = 'istanbul';
  s.hands[0] = ['interrogate'];
  s = applyAction(s, 0, { type: 'card', card: 0, agent: mine.id, target: target.id });
  assert.ok(knownIdentity(s, 0, target.id));
  assert.ok(s.log.some((l) => l.to === 0 && l.text.includes('尋問結果')));
  assert.ok(!s.log.some((l) => l.to === undefined && l.text.includes('尋問結果')));

  s = toAction(applyAction(s, 0, { type: 'endTurn' }));
  const other = s.agents.find((a) => a.owner === 1 && a.id !== target.id);
  s.hands[1] = ['disguise'];
  s = applyAction(s, 1, { type: 'card', card: 0, agent: target.id, agent2: other.id });
  assert.equal(knownIdentity(s, 0, target.id), null);
});

test('拘束でファイルが落ち、工作員は拠点へ戻る', () => {
  let s = toAction(createGame(players(2), seeded(4)));
  const mine = s.agents.find((a) => a.owner === 0);
  const target = s.agents.find((a) => a.owner === 1);
  mine.city = 'istanbul';
  target.city = 'istanbul';
  const f = s.cityFiles.istanbul.pop();
  target.files = [f];
  s.hands[0] = ['arrest'];
  s = applyAction(s, 0, { type: 'card', card: 0, agent: mine.id, target: target.id });
  const t = s.agents.find((a) => a.id === target.id);
  assert.equal(t.city, s.players[1].base);
  assert.deepEqual(t.files, []);
  assert.ok(s.cityFiles.istanbul.includes(f));
});

test('罠: 場所は秘密、相手が入ると拘束され正体がわかる', () => {
  let s = toAction(createGame(players(2), seeded(11)));
  const mine = s.agents.find((a) => a.owner === 0);
  mine.city = 'singapore';
  s.hands[0] = ['trap'];
  s = applyAction(s, 0, { type: 'card', card: 0, agent: mine.id, city: 'beijing' });
  assert.equal(s.traps.length, 1);
  assert.equal(visibleTraps(s, 0).length, 1);
  assert.equal(visibleTraps(s, 1).length, 0);
  assert.ok(!s.log.some((l) => l.to === undefined && l.text.includes('北京')));
  // 相手には「シンガポール周辺のどこか」という気配だけが見える
  const hints = trapHints(s, 1);
  assert.equal(hints.length, 1);
  assert.ok(hints[0].cities.includes('beijing') && hints[0].cities.includes('singapore'));
  assert.equal(trapHints(s, 0).length, 0);

  s = toAction(applyAction(s, 0, { type: 'endTurn' }));
  const enemy = s.agents.find((a) => a.owner === 1);
  enemy.city = 'moscow';
  const f = s.cityFiles.moscow.pop();
  enemy.files = [f];
  s = applyAction(s, 1, { type: 'move', agent: enemy.id, to: 'beijing' });
  const e = s.agents.find((a) => a.id === enemy.id);
  assert.equal(e.city, s.players[1].base);
  assert.ok(s.cityFiles.beijing.includes(f));
  assert.equal(s.traps.length, 0);
  assert.ok(knownIdentity(s, 0, enemy.id));
  assert.equal(s.last.type, 'trap');
});

test('罠は3つ目を置くと古いものが消える。自分の罠にはかからない', () => {
  let s = toAction(createGame(players(2), seeded(12)));
  const mine = s.agents.find((a) => a.owner === 0);
  mine.city = 'moscow';
  s.hands[0] = ['trap', 'trap', 'trap'];
  s.turn.actionsLeft = 9;
  assert.throws(() => applyAction(s, 0, { type: 'card', card: 0, agent: mine.id, city: 'berlin' }), /拠点/);
  s = applyAction(s, 0, { type: 'card', card: 0, agent: mine.id, city: 'moscow' });
  s = applyAction(s, 0, { type: 'card', card: 0, agent: mine.id, city: 'beijing' });
  s = applyAction(s, 0, { type: 'card', card: 0, agent: mine.id, city: 'dubai' });
  assert.deepEqual(s.traps.map((t) => t.city), ['beijing', 'dubai']);
  s = applyAction(s, 0, { type: 'move', agent: mine.id, to: 'beijing' });
  assert.equal(s.agents.find((a) => a.id === mine.id).city, 'beijing');
});

test('盗聴で相手の罠の場所がわかる', () => {
  let s = toAction(createGame(players(2), seeded(13)));
  s = toAction(applyAction(s, 0, { type: 'endTurn' }));
  const enemy = s.agents.find((a) => a.owner === 1);
  enemy.city = 'istanbul';
  s.hands[1] = ['trap'];
  s = applyAction(s, 1, { type: 'card', card: 0, agent: enemy.id, city: 'dubai' });
  s = toAction(applyAction(s, 1, { type: 'endTurn' }));
  s.hands[0] = ['wiretap'];
  s = applyAction(s, 0, { type: 'card', card: 0, player: 1 });
  assert.equal(visibleTraps(s, 0).length, 1);
  assert.ok(s.log.some((l) => l.to === 0 && l.text.includes('ドバイ')));
});

test('奪取で相手のファイルを1つ奪い、中身がわかる', () => {
  let s = toAction(createGame(players(2), seeded(14)));
  const mine = s.agents.find((a) => a.owner === 0);
  const enemy = s.agents.find((a) => a.owner === 1);
  mine.city = 'istanbul';
  enemy.city = 'istanbul';
  const f = s.cityFiles.istanbul.pop();
  enemy.files = [f];
  s.hands[0] = ['steal'];
  s = applyAction(s, 0, { type: 'card', card: 0, agent: mine.id, target: enemy.id });
  assert.deepEqual(s.agents.find((a) => a.id === mine.id).files, [f]);
  assert.deepEqual(s.agents.find((a) => a.id === enemy.id).files, []);
  assert.equal(s.knowledge[0].files[f], s.files[f].real);
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
