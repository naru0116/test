// 「機密ファイル争奪戦」ルールエンジン
// DOM に依存しない純粋なロジック。ブラウザと Node の両方で動く。

export const CITIES = [
  // 北ルート（西→東）
  { id: 'ny', name: 'ニューヨーク', x: 295, y: 145, longitude: -74.006, latitude: 40.713 },
  { id: 'london', name: 'ロンドン', x: 450, y: 105, longitude: -0.128, latitude: 51.507 },
  { id: 'berlin', name: 'ベルリン', x: 540, y: 105, longitude: 13.405, latitude: 52.52 },
  { id: 'moscow', name: 'モスクワ', x: 635, y: 85, longitude: 37.618, latitude: 55.756 },
  { id: 'beijing', name: '北京', x: 800, y: 135, longitude: 116.407, latitude: 39.904 },
  { id: 'tokyo', name: '東京', x: 905, y: 180, longitude: 139.692, latitude: 35.689 },
  // 南ルート（西→東）
  { id: 'rio', name: 'リオ', x: 380, y: 350, longitude: -43.173, latitude: -22.907 },
  { id: 'casablanca', name: 'カサブランカ', x: 455, y: 225, longitude: -7.59, latitude: 33.573 },
  { id: 'istanbul', name: 'イスタンブール', x: 575, y: 195, longitude: 28.978, latitude: 41.008 },
  { id: 'dubai', name: 'ドバイ', x: 670, y: 255, longitude: 55.27, latitude: 25.205 },
  { id: 'singapore', name: 'シンガポール', x: 790, y: 320, longitude: 103.82, latitude: 1.352 },
  { id: 'sydney', name: 'シドニー', x: 920, y: 410, longitude: 151.209, latitude: -33.869 },
];

// 北ルートと南ルートの2つの環を南北の道でつないだ形（どの都市からも道が3本）。
// wrap: 地図の端をまたぐ太平洋航路
export const EDGES = [
  ['ny', 'london'], ['london', 'berlin'], ['berlin', 'moscow'], ['moscow', 'beijing'], ['beijing', 'tokyo'], ['tokyo', 'ny', 'wrap'],
  ['rio', 'casablanca'], ['casablanca', 'istanbul'], ['istanbul', 'dubai'], ['dubai', 'singapore'], ['singapore', 'sydney'], ['sydney', 'rio', 'wrap'],
  ['ny', 'rio'], ['london', 'casablanca'], ['berlin', 'istanbul'], ['moscow', 'dubai'], ['beijing', 'singapore'], ['tokyo', 'sydney'],
];

// 人数ごとの拠点（どの拠点も条件が同じになる配置）。席順にこの順で割り当てる。
export const BASE_SETS = {
  2: ['tokyo', 'berlin'],
  3: ['tokyo', 'london', 'moscow'],
  4: ['tokyo', 'ny', 'berlin', 'moscow'],
  5: ['tokyo', 'ny', 'london', 'berlin', 'moscow'],
  6: ['tokyo', 'ny', 'london', 'berlin', 'moscow', 'beijing'],
};
export const COLORS = ['#c62828', '#1565c0', '#2e7d32', '#e8710a', '#6a1b9a', '#00838f'];
export const COLOR_NAMES = ['赤', '青', '緑', '橙', '紫', '青緑'];
export const AGENT_LABELS = ['A', 'B', 'C'];

export const RULES = {
  actionsPerTurn: 2,
  handLimit: 5,
  startHand: 2,
  marketSize: 3,
  carryLimit: 2,
  filesToWin: 2,
  trapLimit: 2,
  firstTurnActions: 1, // 先手有利を減らすため、最初の手番だけ行動1回
  maxRounds: 15,
  logLimit: 100,
};

export const CARDS = {
  interrogate: { name: '尋問', count: 7, short: '正体を見抜く', desc: '同じ都市にいる相手の工作員1人が本物か囮かを見る（結果は自分だけが知る）。' },
  arrest: { name: '拘束', count: 6, short: '拠点へ送り返す', desc: '同じ都市にいる相手の工作員1人を拠点へ送り返す。持っていたファイルはその都市に落ちる。相手の拠点では使えない。' },
  steal: { name: '奪取', count: 6, short: 'ファイルを1つ奪う', desc: '同じ都市にいる相手の工作員から、ファイルを1つ無作為に奪う。相手の拠点では使えない。' },
  trap: { name: '罠', count: 6, short: '見えない罠を置く', desc: '自分の工作員がいる都市か隣の都市に、罠を伏せて置く。相手の工作員が移動で入ると拘束され、正体もわかる。置ける罠は2つまで（3つ目を置くと古い罠が消える）。拠点には置けない。' },
  wiretap: { name: '盗聴', count: 4, short: '手札と罠を暴く', desc: '相手1人の手札をすべて見て、その人が置いている罠の場所も知る。' },
  disguise: { name: '偽装工作', count: 4, short: '正体を入れ替える', desc: '自分の工作員2人の正体（本物/囮）を入れ替える。相手が尋問などで得た正体の情報は無効になる。' },
  extract: { name: '緊急脱出', count: 5, short: '拠点へワープ', desc: '自分の工作員1人を自分の拠点へワープさせる（罠にはかからない）。' },
};
export const CARD_TYPES = Object.keys(CARDS);
const DECK_SIZE = CARD_TYPES.reduce((n, t) => n + CARDS[t].count, 0);

const ADJ = (() => {
  const m = {};
  for (const c of CITIES) m[c.id] = [];
  for (const [a, b] of EDGES) { m[a].push(b); m[b].push(a); }
  return m;
})();

export const cityById = Object.fromEntries(CITIES.map((c) => [c.id, c]));
export function neighbors(cityId) { return ADJ[cityId] || []; }

// 全都市間の最短距離
export const DIST = (() => {
  const d = {};
  for (const s of CITIES) {
    d[s.id] = { [s.id]: 0 };
    const q = [s.id];
    while (q.length) {
      const c = q.shift();
      for (const n of ADJ[c]) if (d[s.id][n] === undefined) { d[s.id][n] = d[s.id][c] + 1; q.push(n); }
    }
  }
  return d;
})();

function shuffle(arr, rng) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

const clone = (s) => JSON.parse(JSON.stringify(s));

export class RuleError extends Error {}
function fail(msg) { throw new RuleError(msg); }

// ---------- 生成 ----------

// players: [{id, name, cpu?}]
export function createGame(players, rng = Math.random) {
  const n = players.length;
  if (n < 2 || n > 6) fail('プレイ人数は2〜6人です');

  const ps = players.map((p, i) => ({
    id: p.id, name: p.name, color: COLORS[i], base: BASE_SETS[n][i], out: false, cpu: p.cpu || null,
  }));

  const agents = [];
  const aces = [];
  ps.forEach((p, i) => {
    AGENT_LABELS.forEach((label, j) => {
      agents.push({ id: `p${i}a${j}`, owner: i, label, city: p.base, files: [] });
    });
    aces.push(`p${i}a${Math.floor(rng() * AGENT_LABELS.length)}`);
  });

  const files = {};
  const fileIds = [];
  const realCount = 2 * n + 2;
  const fakeCount = n + 4;
  for (let k = 0; k < realCount + fakeCount; k++) {
    const id = `f${k}`;
    files[id] = { real: k < realCount };
    fileIds.push(id);
  }

  const deck = [];
  for (const type of CARD_TYPES) for (let k = 0; k < CARDS[type].count; k++) deck.push(type);

  const state = {
    version: 2,
    status: 'playing',
    seq: 0,
    players: ps,
    agents,
    aces,
    files,
    cityFiles: Object.fromEntries(CITIES.map((c) => [c.id, []])),
    fileDeck: shuffle(fileIds, rng),
    deck: shuffle(deck, rng),
    discard: [],
    market: [],
    hands: ps.map(() => []),
    traps: [],
    trapSeq: 0,
    knowledge: ps.map(() => ({ agents: {}, files: {}, traps: {} })),
    turn: { player: 0, actionsLeft: RULES.actionsPerTurn, round: 1, phase: 'draw' },
    log: [],
    last: null,
    winner: null,
  };

  refillFiles(state);
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < RULES.startHand; k++) {
      const c = takeFromDeck(state, rng);
      if (c) state.hands[i].push(c);
    }
  }
  refillMarket(state, rng);
  addLog(state, `作戦開始！ ${n}人対戦。本物の工作員で本物の機密ファイルを${RULES.filesToWin}つ拠点へ持ち帰れ。`);
  startTurn(state, rng);
  state.turn.actionsLeft = RULES.firstTurnActions;
  addLog(state, `先手の${ps[0].name}は、最初の手番だけ行動が${RULES.firstTurnActions}回。`);
  return state;
}

// ---------- 補助 ----------

function addLog(state, text, to) {
  const entry = { n: state.seq, text };
  if (to !== undefined) entry.to = to;
  state.log.push(entry);
  if (state.log.length > RULES.logLimit) state.log.splice(0, state.log.length - RULES.logLimit);
}

function takeFromDeck(state, rng) {
  if (state.deck.length === 0) {
    if (state.discard.length === 0) return null;
    state.deck = shuffle(state.discard, rng);
    state.discard = [];
  }
  return state.deck.pop();
}

function refillMarket(state, rng) {
  while (state.market.length < RULES.marketSize) {
    const c = takeFromDeck(state, rng);
    if (!c) break;
    state.market.push(c);
  }
}

export function isBase(state, cityId) {
  return state.players.some((p) => p.base === cityId);
}

function refillFiles(state) {
  for (const c of CITIES) {
    if (isBase(state, c.id)) continue;
    if (state.cityFiles[c.id].length === 0 && state.fileDeck.length > 0) {
      state.cityFiles[c.id].push(state.fileDeck.pop());
    }
  }
}

export function agentName(state, agentId) {
  const a = getAgent(state, agentId);
  return `${state.players[a.owner].name}の${a.label}`;
}

export function getAgent(state, agentId) {
  const a = state.agents.find((x) => x.id === agentId);
  if (!a) fail('工作員が見つかりません');
  return a;
}

function ownAgent(state, p, agentId) {
  const a = getAgent(state, agentId);
  if (a.owner !== p) fail('自分の工作員を選んでください');
  if (!a.city) fail('その工作員は盤上にいません');
  return a;
}

export function isAce(state, agentId) {
  return state.aces.includes(agentId);
}

// viewer から見た工作員の正体: 'ace' | 'decoy' | null(不明)
export function knownIdentity(state, viewer, agentId) {
  const a = state.agents.find((x) => x.id === agentId);
  if (!a) return null;
  if (state.status === 'finished' || a.owner === viewer) return isAce(state, agentId) ? 'ace' : 'decoy';
  if (viewer == null || viewer < 0) return null;
  return state.knowledge[viewer].agents[agentId] || null;
}

// viewer から見たファイルの中身: true(本物) | false(偽) | null(不明)
export function knownFile(state, viewer, fileId) {
  if (state.status === 'finished') return state.files[fileId].real;
  if (viewer == null || viewer < 0) return null;
  const k = state.knowledge[viewer].files[fileId];
  return k === undefined ? null : k;
}

// viewer に見えている罠
export function visibleTraps(state, viewer) {
  return state.traps.filter((t) => state.status === 'finished' || t.owner === viewer
    || (viewer >= 0 && state.knowledge[viewer].traps[t.id]));
}

// 罠の「気配」: 場所が分からない罠について、あり得る都市の範囲（公開情報）。
// 罠は置いた工作員の都市か隣にしか置けないので、その範囲（拠点を除く）が候補になる。
export function trapZone(state, trap) {
  return [trap.around, ...neighbors(trap.around)].filter((c) => !isBase(state, c));
}
export function trapHints(state, viewer) {
  const visible = new Set(visibleTraps(state, viewer).map((t) => t.id));
  return state.traps.filter((t) => !visible.has(t.id)).map((t) => ({ id: t.id, owner: t.owner, cities: trapZone(state, t) }));
}

// 盤上にある各プレイヤーの罠の数（公開情報）
export function trapCount(state, p) {
  return state.traps.filter((t) => t.owner === p).length;
}

function realCount(state, fileIds) {
  return fileIds.filter((f) => state.files[f].real).length;
}

function cityName(id) { return cityById[id].name; }

// ---------- ターン進行 ----------

function startTurn(state) {
  const p = state.turn.player;
  state.turn.actionsLeft = RULES.actionsPerTurn;
  addLog(state, `— ラウンド${state.turn.round}: ${state.players[p].name}の番 —`);
  const canDraw = state.hands[p].length < RULES.handLimit && (state.market.length > 0 || state.deck.length > 0 || state.discard.length > 0);
  state.turn.phase = canDraw ? 'draw' : 'action';
  if (!canDraw) addLog(state, '手札がいっぱいなので、カードは引けない。', p);
}

function activePlayers(state) {
  return state.players.map((p, i) => i).filter((i) => !state.players[i].out);
}

function endTurn(state, rng) {
  refillFiles(state);
  const n = state.players.length;
  const cur = state.turn.player;
  let next = cur;
  for (let k = 1; k <= n; k++) {
    const i = (cur + k) % n;
    if (!state.players[i].out) { next = i; break; }
  }
  if (next <= cur) state.turn.round += 1;
  if (state.turn.round > RULES.maxRounds) {
    finishByScore(state);
    return;
  }
  state.turn.player = next;
  startTurn(state, rng);
}

export function scoreOf(state, p) {
  return state.agents
    .filter((a) => a.owner === p && a.city)
    .reduce((s, a) => s + realCount(state, a.files), 0);
}

function finishByScore(state) {
  const act = activePlayers(state);
  const scores = act.map((i) => scoreOf(state, i));
  const best = Math.max(...scores);
  const winners = act.filter((i, k) => scores[k] === best);
  state.status = 'finished';
  state.winner = {
    players: winners,
    reason: `${RULES.maxRounds}ラウンドが終了。本物のファイルを最も多く持っていたプレイヤーの勝利（${best}枚）。`,
    byScore: true,
  };
  addLog(state, `作戦終了: ${winners.map((i) => state.players[i].name).join('、')}の勝利！`);
}

function checkWin(state) {
  for (let i = 0; i < state.players.length; i++) {
    if (state.players[i].out) continue;
    const ace = getAgent(state, state.aces[i]);
    if (ace.city === state.players[i].base && realCount(state, ace.files) >= RULES.filesToWin) {
      state.status = 'finished';
      state.winner = { players: [i], reason: `${state.players[i].name}の本物の工作員（${ace.label}）が、本物の機密ファイルを${RULES.filesToWin}つ拠点へ持ち帰った。` };
      addLog(state, `任務完了！ ${state.players[i].name}の勝利！`);
      return true;
    }
  }
  const act = activePlayers(state);
  if (act.length === 1) {
    state.status = 'finished';
    state.winner = { players: act, reason: '他の全プレイヤーが離脱した。' };
    addLog(state, `${state.players[act[0]].name}の勝利（他プレイヤー離脱）。`);
    return true;
  }
  return false;
}

// 工作員を拘束して拠点へ送り返す（拘束カード・罠の共通処理）
function sendHome(state, agent) {
  const from = agent.city;
  const dropped = agent.files.length;
  state.cityFiles[from].push(...agent.files);
  agent.files = [];
  agent.city = state.players[agent.owner].base;
  return { from, dropped };
}

// ---------- 離脱 ----------

// プレイヤーを離脱させる（投降・切断）。誰の手番でも実行できる。
export function forfeit(stateIn, p, reason = '離脱', rng = Math.random) {
  const state = clone(stateIn);
  if (state.status !== 'playing') return state;
  if (!state.players[p] || state.players[p].out) return state;
  state.seq += 1;
  state.players[p].out = true;
  for (const a of state.agents) {
    if (a.owner !== p || !a.city) continue;
    state.cityFiles[a.city].push(...a.files);
    a.files = [];
    a.city = null;
  }
  state.traps = state.traps.filter((t) => t.owner !== p);
  state.discard.push(...state.hands[p]);
  state.hands[p] = [];
  state.last = null;
  addLog(state, `${state.players[p].name}が${reason}した。持っていたファイルはその場に残された。`);
  if (checkWin(state)) return state;
  if (state.turn.player === p) endTurn(state, rng);
  return state;
}

// ---------- アクション ----------
// action:
//  {type:'draw', from:'deck'|'market', index?}            … 手番の最初に1回
//  {type:'move', agent, to}
//  {type:'scout', agent, file}                             … ファイルを取らずに中身を見る
//  {type:'infiltrate', agent, file?}
//  {type:'drop', agent, file}
//  {type:'transfer', agent, to(agentId), file}
//  {type:'card', card(index in hand), agent?, target?, agent2?, player?, city?}
//  {type:'endTurn'}
//  {type:'resign'}

export function applyAction(stateIn, p, action, rng = Math.random) {
  if (action && action.type === 'resign') return forfeit(stateIn, p, '投降', rng);
  if (stateIn.status !== 'playing') fail('ゲームは終了しています');
  if (stateIn.turn.player !== p) fail('あなたの手番ではありません');
  const state = clone(stateIn);
  state.seq += 1;
  const me = state.players[p];
  const type = action && action.type;

  if (state.turn.phase === 'draw') {
    if (type !== 'draw') fail('まずカードを1枚引いてください（作戦本部か山札）');
    drawAction(state, p, action, rng);
    state.turn.phase = 'action';
    return state;
  }
  if (type === 'draw') fail('カードはもう引きました');

  state.last = null;
  switch (type) {
    case 'endTurn':
      addLog(state, `${me.name}がターンを終了した。`);
      endTurn(state, rng);
      return state;

    case 'move': {
      const a = ownAgent(state, p, action.agent);
      if (!neighbors(a.city).includes(action.to)) fail('線でつながった隣の都市にしか移動できません');
      const from = a.city;
      addLog(state, `${agentName(state, a.id)}が${cityName(from)}→${cityName(action.to)}へ移動。`);
      a.city = action.to;
      state.last = { type: 'move', agent: a.id, from, to: action.to };
      triggerTrap(state, a);
      break;
    }

    case 'scout': {
      const a = ownAgent(state, p, action.agent);
      const here = state.cityFiles[a.city];
      if (!here.includes(action.file)) fail('そのファイルはこの都市にありません');
      state.knowledge[p].files[action.file] = state.files[action.file].real;
      addLog(state, `${agentName(state, a.id)}が${cityName(a.city)}のファイルを偵察した。`);
      addLog(state, `偵察結果: ファイル#${action.file.slice(1)}は${state.files[action.file].real ? '本物の機密情報' : '偽情報'}だ。`, p);
      state.last = { type: 'scout', agent: a.id, city: a.city };
      break;
    }

    case 'infiltrate': {
      const a = ownAgent(state, p, action.agent);
      const here = state.cityFiles[a.city];
      if (here.length === 0) fail('この都市にファイルはありません');
      if (a.files.length >= RULES.carryLimit) fail(`1人が持てるファイルは${RULES.carryLimit}つまでです`);
      const fileId = action.file ?? here[0];
      const idx = here.indexOf(fileId);
      if (idx < 0) fail('そのファイルはこの都市にありません');
      here.splice(idx, 1);
      a.files.push(fileId);
      state.knowledge[p].files[fileId] = state.files[fileId].real;
      addLog(state, `${agentName(state, a.id)}が${cityName(a.city)}に潜入し、ファイルを入手。`);
      addLog(state, `入手したファイル#${fileId.slice(1)}の中身: ${state.files[fileId].real ? '本物の機密情報' : '偽情報'}`, p);
      state.last = { type: 'infiltrate', agent: a.id, city: a.city };
      break;
    }

    case 'drop': {
      const a = ownAgent(state, p, action.agent);
      const idx = a.files.indexOf(action.file);
      if (idx < 0) fail('そのファイルを持っていません');
      a.files.splice(idx, 1);
      state.cityFiles[a.city].push(action.file);
      addLog(state, `${agentName(state, a.id)}が${cityName(a.city)}にファイルを置いた。`);
      state.last = { type: 'drop', agent: a.id, city: a.city };
      break;
    }

    case 'transfer': {
      const a = ownAgent(state, p, action.agent);
      const b = ownAgent(state, p, action.to);
      if (a.id === b.id) fail('別の工作員を選んでください');
      if (a.city !== b.city) fail('同じ都市にいる工作員にしか渡せません');
      const idx = a.files.indexOf(action.file);
      if (idx < 0) fail('そのファイルを持っていません');
      if (b.files.length >= RULES.carryLimit) fail(`1人が持てるファイルは${RULES.carryLimit}つまでです`);
      a.files.splice(idx, 1);
      b.files.push(action.file);
      addLog(state, `${agentName(state, a.id)}が${agentName(state, b.id)}にファイルを渡した。`);
      state.last = { type: 'transfer', agent: a.id, target: b.id, city: a.city };
      break;
    }

    case 'card':
      playCard(state, p, action, rng);
      break;

    default:
      fail('不明なアクションです');
  }

  if (checkWin(state)) return state;
  state.turn.actionsLeft -= 1;
  if (state.turn.actionsLeft <= 0) endTurn(state, rng);
  return state;
}

function drawAction(state, p, action, rng) {
  const me = state.players[p];
  let card;
  if (action.from === 'market') {
    const i = action.index;
    if (!Number.isInteger(i) || i < 0 || i >= state.market.length) fail('作戦本部のカードを選んでください');
    card = state.market.splice(i, 1)[0];
    refillMarket(state, rng);
    addLog(state, `${me.name}が作戦本部から「${CARDS[card].name}」を取った。`);
  } else {
    card = takeFromDeck(state, rng);
    if (!card) fail('山札がありません。作戦本部から選んでください');
    addLog(state, `${me.name}が山札からカードを引いた。`);
    addLog(state, `山札から「${CARDS[card].name}」を引いた。`, p);
  }
  state.hands[p].push(card);
  state.last = { type: 'draw', player: p };
}

function triggerTrap(state, agent) {
  const trap = state.traps.find((t) => t.city === agent.city && t.owner !== agent.owner);
  if (!trap) return;
  state.traps = state.traps.filter((t) => t.id !== trap.id);
  const owner = state.players[trap.owner];
  const city = agent.city;
  const { dropped } = sendHome(state, agent);
  const id = isAce(state, agent.id) ? 'ace' : 'decoy';
  state.knowledge[trap.owner].agents[agent.id] = id;
  addLog(state, `罠発動！ ${cityName(city)}で${agentName(state, agent.id)}が${owner.name}の罠にかかり拘束された。${dropped ? `ファイル${dropped}つがその場に落ちた。` : ''}`);
  addLog(state, `罠の報告: ${agentName(state, agent.id)}は${id === 'ace' ? '★本物（エース）' : '囮'}だった。`, trap.owner);
  state.last = { type: 'trap', agent: agent.id, city, owner: trap.owner };
}

function enemyAgentSameCity(state, p, mine, targetId) {
  const t = getAgent(state, targetId);
  if (t.owner === p) fail('相手の工作員を選んでください');
  if (!t.city) fail('その工作員は盤上にいません');
  if (t.city !== mine.city) fail('同じ都市にいる相手しか対象にできません');
  return t;
}

function playCard(state, p, action, rng) {
  const hand = state.hands[p];
  const ci = action.card;
  if (!Number.isInteger(ci) || ci < 0 || ci >= hand.length) fail('カードを選んでください');
  const type = hand[ci];
  const me = state.players[p];
  const cname = CARDS[type].name;

  switch (type) {
    case 'interrogate': {
      const mine = ownAgent(state, p, action.agent);
      const t = enemyAgentSameCity(state, p, mine, action.target);
      const id = isAce(state, t.id) ? 'ace' : 'decoy';
      state.knowledge[p].agents[t.id] = id;
      addLog(state, `【${cname}】${agentName(state, mine.id)}が${agentName(state, t.id)}を尋問した。`);
      addLog(state, `尋問結果: ${agentName(state, t.id)}は${id === 'ace' ? '★本物（エース）' : '囮'}だ。`, p);
      state.last = { type: 'card', card: type, agent: mine.id, target: t.id, city: mine.city };
      break;
    }
    case 'arrest': {
      const mine = ownAgent(state, p, action.agent);
      const t = enemyAgentSameCity(state, p, mine, action.target);
      if (t.city === state.players[t.owner].base) fail('相手の拠点にいる工作員は拘束できません');
      const { from, dropped } = sendHome(state, t);
      addLog(state, `【${cname}】${agentName(state, mine.id)}が${agentName(state, t.id)}を拘束！ 拠点へ送還。${dropped ? `ファイル${dropped}つが${cityName(from)}に落ちた。` : ''}`);
      state.last = { type: 'card', card: type, agent: mine.id, target: t.id, city: from };
      break;
    }
    case 'steal': {
      const mine = ownAgent(state, p, action.agent);
      const t = enemyAgentSameCity(state, p, mine, action.target);
      if (t.city === state.players[t.owner].base) fail('相手の拠点では奪取できません');
      if (t.files.length === 0) fail('相手はファイルを持っていません');
      if (mine.files.length >= RULES.carryLimit) fail(`1人が持てるファイルは${RULES.carryLimit}つまでです`);
      const k = Math.floor(rng() * t.files.length);
      const f = t.files.splice(k, 1)[0];
      mine.files.push(f);
      state.knowledge[p].files[f] = state.files[f].real;
      addLog(state, `【${cname}】${agentName(state, mine.id)}が${agentName(state, t.id)}からファイルを奪った！`);
      addLog(state, `奪ったファイル#${f.slice(1)}の中身: ${state.files[f].real ? '本物の機密情報' : '偽情報'}`, p);
      addLog(state, `奪われたファイル#${f.slice(1)}は${state.files[f].real ? '本物' : '偽物'}だった。`, t.owner);
      state.last = { type: 'card', card: type, agent: mine.id, target: t.id, city: mine.city };
      break;
    }
    case 'trap': {
      const mine = ownAgent(state, p, action.agent);
      const city = action.city;
      if (city !== mine.city && !neighbors(mine.city).includes(city)) fail('罠は工作員がいる都市か隣の都市にしか置けません');
      if (isBase(state, city)) fail('拠点には罠を置けません');
      if (state.traps.some((t) => t.owner === p && t.city === city)) fail('そこにはもう罠を置いています');
      const mineTraps = state.traps.filter((t) => t.owner === p);
      if (mineTraps.length >= RULES.trapLimit) {
        state.traps = state.traps.filter((t) => t.id !== mineTraps[0].id);
        addLog(state, `${cityName(mineTraps[0].city)}の古い罠を回収した。`, p);
      }
      state.trapSeq += 1;
      state.traps.push({ id: `t${state.trapSeq}`, owner: p, city, around: mine.city });
      addLog(state, `【${cname}】${me.name}が${agentName(state, mine.id)}の近くに罠を仕掛けた（場所は秘密）。`);
      addLog(state, `${cityName(city)}に罠を仕掛けた。`, p);
      state.last = { type: 'card', card: type, agent: mine.id };
      break;
    }
    case 'wiretap': {
      const t = action.player;
      if (!Number.isInteger(t) || t === p || !state.players[t] || state.players[t].out) fail('盗聴する相手を選んでください');
      const h = state.hands[t];
      const traps = state.traps.filter((x) => x.owner === t);
      for (const x of traps) state.knowledge[p].traps[x.id] = true;
      addLog(state, `【${cname}】${me.name}が${state.players[t].name}を盗聴した。`);
      addLog(state, `盗聴結果: ${state.players[t].name}の手札は ${h.length ? h.map((c) => CARDS[c].name).join('・') : 'なし'}。罠は ${traps.length ? traps.map((x) => cityName(x.city)).join('・') : 'なし'}。`, p);
      state.last = { type: 'card', card: type, player: t };
      break;
    }
    case 'disguise': {
      const a = ownAgent(state, p, action.agent);
      const b = ownAgent(state, p, action.agent2);
      if (a.id === b.id) fail('別々の工作員を2人選んでください');
      const ace = state.aces[p];
      if (ace === a.id) state.aces[p] = b.id;
      else if (ace === b.id) state.aces[p] = a.id;
      for (let i = 0; i < state.players.length; i++) {
        if (i === p) continue;
        delete state.knowledge[i].agents[a.id];
        delete state.knowledge[i].agents[b.id];
      }
      addLog(state, `【${cname}】${me.name}が${a.label}と${b.label}の正体を入れ替えた（かもしれない）。正体の情報はリセット。`);
      state.last = { type: 'card', card: type, agent: a.id, target: b.id };
      break;
    }
    case 'extract': {
      const a = ownAgent(state, p, action.agent);
      if (a.city === me.base) fail('すでに拠点にいます');
      const from = a.city;
      addLog(state, `【${cname}】${agentName(state, a.id)}が${cityName(from)}から拠点へ緊急脱出！`);
      a.city = me.base;
      state.last = { type: 'move', agent: a.id, from, to: me.base, extract: true };
      break;
    }
    default:
      fail('不明なカードです');
  }
  hand.splice(ci, 1);
  state.discard.push(type);
}

// ---------- 合法手の列挙（テスト・CPU・UI 用） ----------

export function legalActions(state, p) {
  if (state.status !== 'playing' || state.turn.player !== p) return [];
  if (state.turn.phase === 'draw') {
    const out = state.market.map((c, index) => ({ type: 'draw', from: 'market', index }));
    if (state.deck.length > 0 || state.discard.length > 0) out.push({ type: 'draw', from: 'deck' });
    return out;
  }
  const out = [{ type: 'endTurn' }];
  const mine = state.agents.filter((a) => a.owner === p && a.city);
  const enemies = state.agents.filter((a) => a.owner !== p && a.city);
  for (const a of mine) {
    for (const to of neighbors(a.city)) out.push({ type: 'move', agent: a.id, to });
    for (const f of state.cityFiles[a.city]) {
      if (state.knowledge[p].files[f] === undefined) out.push({ type: 'scout', agent: a.id, file: f });
      if (a.files.length < RULES.carryLimit) out.push({ type: 'infiltrate', agent: a.id, file: f });
    }
    for (const f of a.files) {
      out.push({ type: 'drop', agent: a.id, file: f });
      for (const b of mine) {
        if (b.id !== a.id && b.city === a.city && b.files.length < RULES.carryLimit) {
          out.push({ type: 'transfer', agent: a.id, to: b.id, file: f });
        }
      }
    }
  }
  state.hands[p].forEach((type, card) => {
    if (state.hands[p].indexOf(type) !== card) return; // 同じ種類のカードは1枚分だけ列挙
    if (type === 'interrogate' || type === 'arrest' || type === 'steal') {
      for (const a of mine) {
        for (const t of enemies) {
          if (t.city !== a.city) continue;
          const atBase = t.city === state.players[t.owner].base;
          if (type !== 'interrogate' && atBase) continue;
          if (type === 'steal' && (t.files.length === 0 || a.files.length >= RULES.carryLimit)) continue;
          out.push({ type: 'card', card, agent: a.id, target: t.id });
        }
      }
    } else if (type === 'trap') {
      const seen = new Set();
      for (const a of mine) {
        for (const city of [a.city, ...neighbors(a.city)]) {
          if (seen.has(city) || isBase(state, city)) continue;
          if (state.traps.some((t) => t.owner === p && t.city === city)) continue;
          seen.add(city);
          out.push({ type: 'card', card, agent: a.id, city });
        }
      }
    } else if (type === 'disguise') {
      for (const a of mine) {
        for (const b of mine) if (a.id !== b.id) out.push({ type: 'card', card, agent: a.id, agent2: b.id });
      }
    } else if (type === 'wiretap') {
      state.players.forEach((pl, i) => { if (i !== p && !pl.out) out.push({ type: 'card', card, player: i }); });
    } else if (type === 'extract') {
      for (const a of mine) if (a.city !== state.players[p].base) out.push({ type: 'card', card, agent: a.id });
    }
  });
  return out;
}

export { DECK_SIZE };
