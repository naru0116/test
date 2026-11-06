// CPU プレイヤー
// 「自分が知り得る情報」だけで判断する（相手の正体・手札・未確認ファイルの中身は見ない）。
// 合法手をすべて列挙し、状況に応じた点数を付けて最も良い手を選ぶ。

import {
  legalActions, neighbors, DIST, RULES, isBase, CARDS, trapHints,
} from './game.js';

export const LEVELS = {
  easy: { name: 'やさしい', noise: 45, blunder: 0.3, caution: 0, read: false },
  normal: { name: 'ふつう', noise: 10, blunder: 0.05, caution: 0.4, read: false },
  hard: { name: 'つよい', noise: 1, blunder: 0, caution: 1, read: true },
};

const dist = (a, b) => DIST[a][b];

function view(state, p) {
  const know = state.knowledge[p];
  const me = state.players[p];
  const mine = state.agents.filter((a) => a.owner === p && a.city);
  const ace = mine.find((a) => a.id === state.aces[p]);
  const fileVal = (f) => (know.files[f] === undefined ? null : know.files[f]);
  const realIn = (a) => a.files.filter((f) => fileVal(f) === true).length;
  // 見えている相手だけ（潜伏中の相手の本当の居場所は使わない）
  const enemies = state.agents.filter((a) => a.owner !== p && a.city && !a.hidden);
  // 潜伏中の相手: 公開されている「いる可能性のある都市」だけを使う
  const hiddenEnemies = state.agents.filter((a) => a.owner !== p && a.city && a.hidden)
    .map((a) => ({ id: a.id, owner: a.owner, files: a.files.length, possible: a.hidden.possible }));
  const enemyTraps = new Set(state.traps.filter((t) => t.owner !== p && know.traps[t.id]).map((t) => t.city));
  const myTraps = new Set(state.traps.filter((t) => t.owner === p).map((t) => t.city));
  // 自分の本物が誰かに調べられたか（尋問・罠の対象になったことはログで公開される。結果の中身は見ない）
  const aceExposed = state.knowledge.some((k, i) => i !== p && k.agents[state.aces[p]] !== undefined);
  // 狙う価値のあるファイルがある都市（未確認 or 本物と分かっている）
  const targets = Object.entries(state.cityFiles)
    .filter(([c, fs]) => !isBase(state, c) && fs.some((f) => fileVal(f) !== false))
    .map(([c]) => c);
  const knownRealCities = Object.entries(state.cityFiles)
    .filter(([, fs]) => fs.some((f) => fileVal(f) === true)).map(([c]) => c);
  const enemyIdent = (a) => know.agents[a.id] || null;
  // 罠の気配: 都市ごとの「罠がありそうな度合い」（候補の都市数で割る）
  const trapRisk = {};
  for (const h of trapHints(state, p)) {
    if (h.owner === p) continue;
    for (const c of h.cities) trapRisk[c] = (trapRisk[c] || 0) + 1 / h.cities.length;
  }
  return {
    p, me, know, mine, ace, fileVal, realIn, enemies, hiddenEnemies, enemyTraps, myTraps, aceExposed, targets, knownRealCities, enemyIdent, trapRisk,
  };
}

// 最も近い都市（同じ距離なら、その手番ごとに決まる乱数で選ぶ＝毎回同じ方向に偏らない）
let tieSeed = 0;
function nearest(from, cities) {
  let best = null;
  let bd = Infinity;
  let bt = 0;
  for (const c of cities) {
    const d = dist(from, c);
    const t = tieBreak(c);
    if (d < bd || (d === bd && t > bt)) { bd = d; best = c; bt = t; }
  }
  return { city: best, d: bd };
}
function tieBreak(c) {
  let h = tieSeed;
  for (let i = 0; i < c.length; i++) h = (h * 31 + c.charCodeAt(i)) >>> 0;
  h ^= h >>> 13; h = Math.imul(h, 0x5bd1e995) >>> 0; h ^= h >>> 15;
  return h + 1;
}

// 相手の工作員の「怖さ」: ファイルを持っているほど、本物と分かっているほど高い
function threat(v, t, state) {
  const id = v.enemyIdent(t);
  let s = t.files.length * 18;
  if (id === 'ace') s += 25 + t.files.length * 15;
  if (id === 'decoy') s -= 15;
  // 「つよい」は動きから本物を推測する: ファイルを2つ抱えて拠点の近くにいる工作員は本物っぽい
  if (v.L.read && !id && state && t.files.length >= 2) {
    const d = dist(t.city, state.players[t.owner].base);
    s += d <= 1 ? 35 : d === 2 ? 18 : 6;
  }
  return s;
}

function scoreDraw(state, v, action) {
  const card = action.from === 'market' ? state.market[action.index] : null;
  if (!card) return 14; // 山札（何が出るかわからない平均値）
  const has = (t) => state.hands[v.p].includes(t);
  const aceReal = v.ace ? v.realIn(v.ace) : 0;
  const nearEnemyWithFiles = v.enemies.some((t) => t.files.length && v.mine.some((a) => dist(a.city, t.city) <= 1));
  switch (card) {
    case 'arrest': return 19 + (nearEnemyWithFiles ? 10 : 0) - (has('arrest') ? 6 : 0);
    case 'steal': return 17 + (nearEnemyWithFiles ? 12 : 0) - (has('steal') ? 6 : 0);
    case 'trap': return 15 + (v.enemies.some((t) => t.files.length) ? 6 : 0) - (has('trap') ? 7 : 0);
    case 'extract': return 12 + (aceReal >= 1 && v.ace && dist(v.ace.city, v.me.base) >= 2 ? 22 : 0) - (has('extract') ? 8 : 0);
    case 'interrogate': return 12 - (has('interrogate') ? 5 : 0);
    case 'disguise': return (v.aceExposed && !has('disguise') ? 30 : 4);
    case 'wiretap': return 8 + (state.traps.some((t) => t.owner !== v.p && !v.know.traps[t.id]) ? 6 : 0) - (has('wiretap') ? 6 : 0);
    case 'hide': return 10 + (aceReal >= 1 ? 16 : 0) - (has('hide') ? 8 : 0);
    case 'checkpoint': return 7 + (v.hiddenEnemies.some((h) => h.files) ? 16 : v.hiddenEnemies.length ? 6 : 0) - (has('checkpoint') ? 6 : 0);
    default: return 10;
  }
}

function scoreMove(state, v, a, to) {
  const isAce = v.ace && a.id === v.ace.id;
  if (v.enemyTraps.has(to)) return -200;
  const real = v.realIn(a);
  const risk = (v.trapRisk[to] || 0) * v.L.caution;
  const home = v.me.base;
  const closer = (target) => (target ? dist(a.city, target) - dist(to, target) : 0); // 1 なら近づく
  // ファイルを持っているほど罠が痛い
  let s = -2 - risk * (8 + real * 30 + a.files.length * 8 + (isAce ? 10 : 0));
  const enemiesThere = v.enemies.filter((t) => t.city === to && t.city !== state.players[t.owner].base);
  if (isAce) {
    if (real >= RULES.filesToWin) {
      if (to === home) return 1000;
      s += closer(home) * 50;
    } else {
      // まず近くの囮が本物を持っていれば合流、なければファイルを探しに行く
      const carrier = v.mine.find((b) => b.id !== a.id && v.realIn(b) > 0);
      const goal = carrier ? carrier.city : (nearest(to, v.knownRealCities).city || nearest(a.city, v.targets).city);
      s += closer(goal) * (carrier ? 30 : 26);
      if (real >= 1 && v.knownRealCities.length === 0 && !carrier) s += closer(home) * 6;
    }
    // 本物は敵が多い場所を避ける
    s -= enemiesThere.length * (real ? 14 : 6);
    if (v.aceExposed) s -= enemiesThere.length * 10;
  } else {
    if (real > 0 && v.ace) {
      s += closer(v.ace.city) * 24; // 囮が集めた本物を本物の工作員へ届ける
      s += closer(home) * 4;
    } else if (a.files.length < RULES.carryLimit && v.targets.length) {
      s += closer(nearest(a.city, v.targets).city) * 16;
    }
    // 拘束/奪取/尋問カードを持っていれば、ファイルを運ぶ敵を追う
    const hunter = state.hands[v.p].some((c) => c === 'arrest' || c === 'steal' || c === 'interrogate');
    if (hunter) {
      const prey = v.enemies.filter((t) => t.files.length && t.city !== state.players[t.owner].base);
      if (prey.length) {
        const best = prey.reduce((x, y) => (threat(v, y, state) - dist(a.city, y.city) * 8 > threat(v, x, state) - dist(a.city, x.city) * 8 ? y : x));
        s += closer(best.city) * (12 + threat(v, best, state) / 4);
      }
    }
  }
  return s;
}

// 潜伏中の自分の工作員が、姿を現してしまう行動をするときの減点
function revealCost(state, v, act) {
  const ids = [act.agent, act.type === 'transfer' ? act.to : null].filter(Boolean);
  const own = ids.map((id) => state.agents.find((x) => x.id === id)).filter((a) => a && a.owner === v.p && a.hidden);
  if (!own.length) return 0;
  if (act.type === 'move' || (act.type === 'card' && state.hands[v.p][act.card] === 'disguise')) return 0;
  return 18 * own.length;
}

function scoreAction(state, v, act) {
  return scoreActionRaw(state, v, act) - revealCost(state, v, act);
}

function scoreActionRaw(state, v, act) {
  const ag = (id) => state.agents.find((x) => x.id === id);
  switch (act.type) {
    case 'draw': return scoreDraw(state, v, act);
    case 'endTurn': return 0;
    case 'move': return scoreMove(state, v, ag(act.agent), act.to);
    case 'scout': {
      const a = ag(act.agent);
      const isAce = v.ace && a.id === v.ace.id;
      return isAce ? 24 : (a.files.length >= RULES.carryLimit ? 9 : 6);
    }
    case 'infiltrate': {
      const a = ag(act.agent);
      const isAce = v.ace && a.id === v.ace.id;
      const k = v.fileVal(act.file);
      if (k === true) return isAce ? 70 : 40;
      if (k === false) return -25;
      return isAce ? 11 : 23;
    }
    case 'drop': {
      const a = ag(act.agent);
      const isAce = v.ace && a.id === v.ace.id;
      const k = v.fileVal(act.file);
      if (k === true) return -60;
      const roomNeeded = state.cityFiles[a.city].some((f) => v.fileVal(f) !== false) && a.files.length >= RULES.carryLimit;
      if (isAce) return roomNeeded ? 30 : 15;
      return roomNeeded ? 20 : -3; // 囮は偽ファイルをブラフとして持ち歩く
    }
    case 'transfer': {
      const a = ag(act.agent);
      const b = ag(act.to);
      const k = v.fileVal(act.file);
      const toAce = v.ace && b.id === v.ace.id;
      const fromAce = v.ace && a.id === v.ace.id;
      if (toAce && k === true) return 75;
      if (fromAce && k !== true) return 14;
      return -10;
    }
    case 'card': return scoreCard(state, v, act);
    default: return -100;
  }
}

function scoreCard(state, v, act) {
  const type = state.hands[v.p][act.card];
  const ag = (id) => state.agents.find((x) => x.id === id);
  const aceReal = v.ace ? v.realIn(v.ace) : 0;
  switch (type) {
    case 'interrogate': {
      const t = ag(act.target);
      if (v.enemyIdent(t)) return -20;
      return (t.files.length ? 26 : 6) + (state.hands[v.p].includes('arrest') ? 6 : 0);
    }
    case 'arrest': {
      const t = ag(act.target);
      const val = threat(v, t, state) + 8;
      return val - 22;
    }
    case 'steal': {
      const t = ag(act.target);
      const a = ag(act.agent);
      const toAce = v.ace && a.id === v.ace.id;
      return 26 + t.files.length * 6 + (v.enemyIdent(t) === 'ace' ? 15 : 0) + (toAce ? 6 : 0) - 10;
    }
    case 'trap': {
      const c = act.city;
      let val = 0;
      for (const t of v.enemies) {
        const base = state.players[t.owner].base;
        // ファイルを持った敵が拠点へ帰る道の途中なら有望
        if (t.files.length && t.city !== c && dist(t.city, c) === 1 && dist(c, base) < dist(t.city, base)) val += 22 + threat(v, t, state) / 3;
        // ファイルのある都市の隣にいる敵
        if (!t.files.length && dist(t.city, c) === 1 && state.cityFiles[c].length) val += 7;
      }
      if (v.mine.some((a) => a.city === c)) val -= 4;
      return val - 14;
    }
    case 'wiretap': {
      const t = act.player;
      const hidden = state.traps.filter((x) => x.owner === t && !v.know.traps[x.id]).length;
      return hidden * 14 + state.hands[t].length * 1.5 - 9;
    }
    case 'disguise': {
      const a = ag(act.agent);
      const b = ag(act.agent2);
      if (!v.aceExposed || !v.ace) return -50;
      if (a.id !== v.ace.id && b.id !== v.ace.id) return -50;
      const other = a.id === v.ace.id ? b : a;
      // 本物がファイルを持っていない／もう一方がファイルを持っているなら入れ替える価値大
      return 34 + v.realIn(other) * 25 - aceReal * 10;
    }
    case 'extract': {
      const a = ag(act.agent);
      const isAce = v.ace && a.id === v.ace.id;
      const d = dist(a.city, v.me.base);
      if (isAce && aceReal >= RULES.filesToWin) return 900;
      if (isAce && aceReal >= 1 && v.aceExposed) return 20 + d * 4;
      if (!isAce && v.realIn(a) > 0 && v.ace && v.ace.city === v.me.base) return 18 + d * 5;
      return -30;
    }
    case 'hide': {
      const a = ag(act.agent);
      const isAce = v.ace && a.id === v.ace.id;
      const near = v.enemies.filter((t) => dist(t.city, a.city) <= 2 && t.city !== state.players[t.owner].base).length;
      const risky = [a.city, ...neighbors(a.city)].some((c) => (v.trapRisk[c] || 0) > 0.2);
      // 本物が本物ファイルを抱えて帰るときに、追っ手や罠から身を隠す
      if (isAce && aceReal >= RULES.filesToWin) return 34 + near * 8 + (risky ? 10 : 0) + (v.aceExposed ? 10 : 0) + Math.min(3, dist(a.city, v.me.base)) * 4 - 14;
      if (isAce) return (aceReal >= 1 ? 4 : -10) + near * 4 + (v.aceExposed ? 8 : 0) - 14;
      // 囮がファイルを抱えて潜伏 → 相手の検問を空振りさせるハッタリ
      if (a.files.length) return 4 + near * 3 + (v.L.read ? 6 : 0) - 14;
      return -25;
    }
    case 'checkpoint': {
      let val = 0;
      for (const h of v.hiddenEnemies) {
        if (h.possible.includes(act.city)) val += (10 + h.files * 18) / h.possible.length;
      }
      return val - 12;
    }
    default: return -10;
  }
}

// カードを作戦ポイント（行動+1）に変えるときに失う価値の目安
const KEEP = {
  arrest: 18, steal: 16, trap: 14, hide: 14, extract: 12, interrogate: 10, checkpoint: 10, disguise: 6, wiretap: 6,
};

// 1手を選ぶ
export function chooseAction(state, p, level = 'normal', rng = Math.random) {
  const L = LEVELS[level] || LEVELS.normal;
  const acts = legalActions(state, p);
  if (acts.length === 0) return null;
  tieSeed = Math.floor(rng() * 2 ** 31);
  const v = view(state, p);
  v.L = L;
  if (L.blunder && rng() < L.blunder) {
    const pool = acts.filter((a) => a.type !== 'endTurn');
    if (pool.length) return pool[Math.floor(rng() * pool.length)];
  }
  let best = acts[0];
  let bestScore = -Infinity;
  // 作戦ポイント以外の手を先に評価し、その最善手の価値から「行動を1回増やす価値」を見積もる
  let bestOther = 0;
  const scored = acts.map((a) => {
    if (a.type === 'ops') return null;
    const sc = scoreAction(state, v, a);
    if (a.type !== 'endTurn' && a.type !== 'draw') bestOther = Math.max(bestOther, sc);
    return sc;
  });
  acts.forEach((a, i) => {
    let sc = scored[i];
    if (a.type === 'ops') {
      const type = state.hands[p][a.card];
      sc = bestOther * 0.55 - (KEEP[type] ?? 10) - (state.turn.actionsLeft >= 2 ? 6 : 0);
    }
    sc += rng() * L.noise;
    if (sc > bestScore) { bestScore = sc; best = a; }
  });
  return best;
}

export function cpuName(i, level) {
  const names = ['コード:カラス', 'コード:キツネ', 'コード:フクロウ', 'コード:ヤマネコ', 'コード:サソリ', 'コード:オオカミ'];
  return `${names[i % names.length]}`;
}

export { CARDS, neighbors };
