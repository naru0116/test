import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createGame, applyAction, legalActions, forfeit, RULES, CITIES, neighbors, knownIdentity,
  visibleTraps, trapHints, DECK_SIZE, BASE_SETS, DIST, agentVisible,
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
  // 潜伏中の工作員の本当の居場所は、公開されている候補に必ず含まれる
  for (const a of s.agents) {
    if (!a.hidden) continue;
    assert.ok(a.city, 'hidden agent must be on board');
    assert.ok(a.hidden.possible.includes(a.city), `${a.id} at ${a.city} not in ${a.hidden.possible}`);
    assert.ok(a.hidden.turns >= 1);
  }
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

test('潜伏: 相手からは候補の都市だけが見え、移動のたびに候補が広がる', () => {
  let s = toAction(createGame(players(2), seeded(21)));
  const a = s.agents.find((x) => x.owner === 0);
  s.hands[0] = ['hide'];
  s = applyAction(s, 0, { type: 'card', card: 0, agent: a.id });
  let ag = s.agents.find((x) => x.id === a.id);
  assert.deepEqual(ag.hidden.possible, ['tokyo']);
  assert.equal(agentVisible(s, 1, ag), false);
  assert.equal(agentVisible(s, 0, ag), true);
  s = applyAction(s, 0, { type: 'move', agent: a.id, to: 'beijing' });
  ag = s.agents.find((x) => x.id === a.id);
  assert.deepEqual([...ag.hidden.possible].sort(), [...neighbors('tokyo')].sort());
  // 公開ログに行き先は出ない（本人向けの秘密ログには出る）
  assert.ok(!s.log.some((l) => l.to === undefined && l.text.includes('北京へ')));
  assert.ok(s.log.some((l) => l.to === 0 && l.text.includes('北京')));
  assert.equal(s.last.type, 'hiddenMove');
});

test('潜伏中は尋問・拘束・奪取の対象にならず、期限が来ると姿を現す', () => {
  let s = toAction(createGame(players(2), seeded(22)));
  const a = s.agents.find((x) => x.owner === 0);
  s.hands[0] = ['hide'];
  s = applyAction(s, 0, { type: 'card', card: 0, agent: a.id });
  s = toAction(applyAction(s, 0, { type: 'endTurn' }));
  const e = s.agents.find((x) => x.owner === 1);
  e.city = 'tokyo';
  s.hands[1] = ['arrest', 'interrogate'];
  assert.ok(!legalActions(s, 1).some((x) => x.type === 'card' && x.target === a.id));
  assert.throws(() => applyAction(s, 1, { type: 'card', card: 0, agent: e.id, target: a.id }), /潜伏中/);
  // 自分の手番2回目の終わりで姿を現す
  s = toAction(applyAction(s, 1, { type: 'endTurn' }));
  assert.ok(s.agents.find((x) => x.id === a.id).hidden);
  s = applyAction(s, 0, { type: 'endTurn' });
  assert.equal(s.agents.find((x) => x.id === a.id).hidden, null);
});

test('潜伏中に移動以外をすると姿を現す。罠にはかかる', () => {
  let s = toAction(createGame(players(2), seeded(23)));
  const a = s.agents.find((x) => x.owner === 0);
  a.city = 'istanbul';
  s.hands[0] = ['hide'];
  s.turn.actionsLeft = 5;
  s = applyAction(s, 0, { type: 'card', card: 0, agent: a.id });
  const f = s.cityFiles.istanbul[0];
  s = applyAction(s, 0, { type: 'infiltrate', agent: a.id, file: f });
  assert.equal(s.agents.find((x) => x.id === a.id).hidden, null);

  // 罠
  s = toAction(applyAction(s, 0, { type: 'endTurn' }));
  const e = s.agents.find((x) => x.owner === 1);
  e.city = 'dubai';
  s.hands[1] = ['hide'];
  s.traps.push({ id: 'tx', owner: 0, city: 'singapore', around: 'singapore' });
  s = applyAction(s, 1, { type: 'card', card: 0, agent: e.id });
  s = applyAction(s, 1, { type: 'move', agent: e.id, to: 'singapore' });
  const e2 = s.agents.find((x) => x.id === e.id);
  assert.equal(e2.hidden, null);
  assert.equal(e2.city, s.players[1].base);
});

test('検問: 見つければ姿を現し、外れれば候補から除外される', () => {
  let s = toAction(createGame(players(2), seeded(24)));
  s = toAction(applyAction(s, 0, { type: 'endTurn' }));
  const e = s.agents.find((x) => x.owner === 1);
  e.city = 'istanbul';
  s.hands[1] = ['hide'];
  s = applyAction(s, 1, { type: 'card', card: 0, agent: e.id });
  s = applyAction(s, 1, { type: 'move', agent: e.id, to: 'dubai' }); // 行動2回で手番は自動で終わる
  s = toAction(s, 0);
  let h = s.agents.find((x) => x.id === e.id).hidden;
  assert.ok(h.possible.includes('casablanca'));
  s.hands[0] = ['checkpoint', 'checkpoint'];
  s = applyAction(s, 0, { type: 'card', card: 0, city: 'casablanca' });
  h = s.agents.find((x) => x.id === e.id).hidden;
  assert.ok(h && !h.possible.includes('casablanca'));
  s = applyAction(s, 0, { type: 'card', card: 0, city: 'dubai' });
  assert.equal(s.agents.find((x) => x.id === e.id).hidden, null);
});

test('作戦ポイント: カードを捨てて行動+1、1ターンに1回まで', () => {
  let s = toAction(createGame(players(2), seeded(25)));
  s.hands[0] = ['wiretap', 'arrest'];
  const before = s.turn.actionsLeft;
  s = applyAction(s, 0, { type: 'ops', card: 0 });
  assert.equal(s.turn.actionsLeft, before + 1);
  assert.deepEqual(s.hands[0], ['arrest']);
  assert.ok(!legalActions(s, 0).some((x) => x.type === 'ops'));
  assert.throws(() => applyAction(s, 0, { type: 'ops', card: 0 }), /もう使いました/);
});

test('CPUは潜伏中の相手の本当の居場所を見ない（居場所を変えても選ぶ手が同じ）', () => {
  let diffs = 0;
  for (let g = 0; g < 40; g++) {
    let s = toAction(createGame(players(2), seeded(300 + g)));
    s = toAction(applyAction(s, 0, { type: 'endTurn' }));
    const e = s.agents.find((x) => x.owner === 1);
    e.city = 'istanbul';
    e.files = [s.cityFiles.istanbul.pop()];
    s.hands[1] = ['hide'];
    s = applyAction(s, 1, { type: 'card', card: 0, agent: e.id });
    s = applyAction(s, 1, { type: 'move', agent: e.id, to: 'dubai' }); // 行動2回で手番は自動で終わる
    s = toAction(s, 0);
    s.hands[0] = ['checkpoint', 'arrest', 'trap'];
    const cand = s.agents.find((x) => x.id === e.id).hidden.possible;
    const picks = new Set();
    for (const city of cand) {
      const t = JSON.parse(JSON.stringify(s));
      t.agents.find((x) => x.id === e.id).city = city;
      picks.add(JSON.stringify(chooseAction(t, 0, 'hard', seeded(9))));
    }
    if (picks.size > 1) diffs += 1;
  }
  assert.equal(diffs, 0);
});
