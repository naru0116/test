// 別班ボードゲーム「機密ファイル争奪戦」ルールエンジン
// DOM に依存しない純粋なロジック。ブラウザと Node の両方で動く。

export const CITIES = [
  { id: 'ny', name: 'ニューヨーク', x: 250, y: 150 },
  { id: 'dc', name: 'ワシントン', x: 200, y: 240 },
  { id: 'london', name: 'ロンドン', x: 450, y: 105 },
  { id: 'berlin', name: 'ベルリン', x: 535, y: 135 },
  { id: 'moscow', name: 'モスクワ', x: 650, y: 85 },
  { id: 'istanbul', name: 'イスタンブール', x: 600, y: 215 },
  { id: 'cairo', name: 'カイロ', x: 545, y: 310 },
  { id: 'dubai', name: 'ドバイ', x: 690, y: 315 },
  { id: 'beijing', name: '北京', x: 810, y: 165 },
  { id: 'seoul', name: 'ソウル', x: 885, y: 215 },
  { id: 'tokyo', name: '東京', x: 935, y: 285 },
  { id: 'singapore', name: 'シンガポール', x: 815, y: 410 },
];

// wrap: 地図の端をまたぐ航路（太平洋）
export const EDGES = [
  ['ny', 'dc'], ['ny', 'london'], ['dc', 'cairo'], ['london', 'berlin'],
  ['berlin', 'moscow'], ['berlin', 'istanbul'], ['moscow', 'istanbul'],
  ['istanbul', 'cairo'], ['istanbul', 'dubai'], ['cairo', 'dubai'],
  ['moscow', 'beijing'], ['beijing', 'seoul'], ['seoul', 'tokyo'],
  ['beijing', 'singapore'], ['dubai', 'singapore'], ['singapore', 'tokyo'],
  ['dc', 'tokyo', 'wrap'],
];

// 拠点はプレイヤー順にこの順で割り当てる（なるべく離れるように）
export const BASE_ORDER = ['tokyo', 'london', 'ny', 'dubai', 'moscow', 'singapore'];
export const COLORS = ['#e53935', '#1e88e5', '#43a047', '#fb8c00', '#8e24aa', '#00acc1'];
export const COLOR_NAMES = ['赤', '青', '緑', '橙', '紫', '水'];
export const AGENT_LABELS = ['A', 'B', 'C'];

export const RULES = {
  actionsPerTurn: 2,
  handLimit: 5,
  startHand: 2,
  carryLimit: 2,
  filesToWin: 2,
  maxRounds: 15,
  logLimit: 80,
};

export const CARDS = {
  interrogate: { name: '尋問', count: 10, desc: '同じ都市にいる相手の工作員1人が本物か囮かを見る。' },
  arrest: { name: '拘束', count: 8, desc: '同じ都市にいる相手の工作員1人を拠点へ送り返す。持っていたファイルはその都市に落ちる。相手の拠点では使えない。' },
  disguise: { name: '偽装工作', count: 5, desc: '自分の工作員2人の正体（本物/囮）を入れ替える。相手が尋問で得た情報は無効になる。' },
  wiretap: { name: '盗聴', count: 4, desc: '相手1人の手札をすべて見る。' },
  extract: { name: '緊急脱出', count: 6, desc: '自分の工作員1人を自分の拠点へワープさせる。' },
};

const ADJ = (() => {
  const m = {};
  for (const c of CITIES) m[c.id] = [];
  for (const [a, b] of EDGES) { m[a].push(b); m[b].push(a); }
  return m;
})();

export const cityById = Object.fromEntries(CITIES.map((c) => [c.id, c]));
export function neighbors(cityId) { return ADJ[cityId] || []; }

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

export function createGame(players, rng = Math.random) {
  const n = players.length;
  if (n < 2 || n > 6) fail('プレイ人数は2〜6人です');

  const ps = players.map((p, i) => ({
    id: p.id, name: p.name, color: COLORS[i], base: BASE_ORDER[i], out: false,
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
  for (const [type, def] of Object.entries(CARDS)) {
    for (let k = 0; k < def.count; k++) deck.push(type);
  }

  const state = {
    version: 1,
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
    hands: ps.map(() => []),
    knowledge: ps.map(() => ({ agents: {}, files: {} })),
    turn: { player: 0, actionsLeft: RULES.actionsPerTurn, round: 1 },
    log: [],
    winner: null,
  };

  refillFiles(state);
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < RULES.startHand; k++) drawCard(state, i, rng);
  }
  addLog(state, `ゲーム開始！ ${n}人対戦。本物の工作員で本物の機密ファイルを${RULES.filesToWin}つ拠点へ持ち帰れ。`);
  startTurn(state, rng);
  return state;
}

// ---------- 補助 ----------

function addLog(state, text, to) {
  const entry = { n: state.seq, text };
  if (to !== undefined) entry.to = to;
  state.log.push(entry);
  if (state.log.length > RULES.logLimit) state.log.splice(0, state.log.length - RULES.logLimit);
}

function drawCard(state, p, rng) {
  if (state.hands[p].length >= RULES.handLimit) return null;
  if (state.deck.length === 0) {
    if (state.discard.length === 0) return null;
    state.deck = shuffle(state.discard, rng);
    state.discard = [];
  }
  const c = state.deck.pop();
  state.hands[p].push(c);
  return c;
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

function realCount(state, fileIds) {
  return fileIds.filter((f) => state.files[f].real).length;
}

function cityName(id) { return cityById[id].name; }

// ---------- ターン進行 ----------

function startTurn(state, rng) {
  const p = state.turn.player;
  state.turn.actionsLeft = RULES.actionsPerTurn;
  const c = drawCard(state, p, rng);
  addLog(state, `— ラウンド${state.turn.round}: ${state.players[p].name}の番 —`);
  if (c) addLog(state, `カード「${CARDS[c].name}」を引いた。`, p);
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
  state.winner = { players: winners, reason: `${RULES.maxRounds}ラウンド終了。本物のファイルを最も多く持っていたプレイヤーの勝利（${best}枚）。` };
  addLog(state, `ゲーム終了: ${winners.map((i) => state.players[i].name).join('、')}の勝利！`);
}

function checkWin(state) {
  for (let i = 0; i < state.players.length; i++) {
    if (state.players[i].out) continue;
    const ace = getAgent(state, state.aces[i]);
    if (ace.city === state.players[i].base && realCount(state, ace.files) >= RULES.filesToWin) {
      state.status = 'finished';
      state.winner = { players: [i], reason: `${state.players[i].name}の本物の工作員（${ace.label}）が本物の機密ファイルを${RULES.filesToWin}つ拠点へ持ち帰った。` };
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
  state.discard.push(...state.hands[p]);
  state.hands[p] = [];
  addLog(state, `${state.players[p].name}が${reason}した。持っていたファイルはその場に残された。`);
  if (checkWin(state)) return state;
  if (state.turn.player === p) endTurn(state, rng);
  return state;
}

// ---------- アクション ----------
// action:
//  {type:'move', agent, to}
//  {type:'infiltrate', agent, file?}
//  {type:'drop', agent, file}
//  {type:'transfer', agent, to(agentId), file}
//  {type:'card', card(index in hand), agent?, target?, agent2?, player?}
//  {type:'endTurn'}
//  {type:'resign'}

export function applyAction(stateIn, p, action, rng = Math.random) {
  if (action && action.type === 'resign') return forfeit(stateIn, p, '投降', rng);
  if (stateIn.status !== 'playing') fail('ゲームは終了しています');
  if (stateIn.turn.player !== p) fail('あなたの手番ではありません');
  const state = clone(stateIn);
  state.seq += 1;
  const me = state.players[p];

  switch (action && action.type) {
    case 'endTurn':
      addLog(state, `${me.name}がターンを終了した。`);
      endTurn(state, rng);
      return state;

    case 'move': {
      const a = ownAgent(state, p, action.agent);
      if (!neighbors(a.city).includes(action.to)) fail('隣の都市にしか移動できません');
      addLog(state, `${agentName(state, a.id)}が${cityName(a.city)}→${cityName(action.to)}へ移動。`);
      a.city = action.to;
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
      addLog(state, `${agentName(state, a.id)}が${cityName(a.city)}で潜入し、ファイルを入手。`);
      addLog(state, `入手したファイルの中身: ${state.files[fileId].real ? '本物の機密情報' : '偽情報'}`, p);
      break;
    }

    case 'drop': {
      const a = ownAgent(state, p, action.agent);
      const idx = a.files.indexOf(action.file);
      if (idx < 0) fail('そのファイルを持っていません');
      a.files.splice(idx, 1);
      state.cityFiles[a.city].push(action.file);
      addLog(state, `${agentName(state, a.id)}が${cityName(a.city)}にファイルを置いた。`);
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
      break;
    }
    case 'arrest': {
      const mine = ownAgent(state, p, action.agent);
      const t = enemyAgentSameCity(state, p, mine, action.target);
      const owner = state.players[t.owner];
      if (t.city === owner.base) fail('相手の拠点にいる工作員は拘束できません');
      const dropped = t.files.length;
      const from = t.city;
      state.cityFiles[from].push(...t.files);
      t.files = [];
      t.city = owner.base;
      addLog(state, `【${cname}】${agentName(state, mine.id)}が${agentName(state, t.id)}を拘束！ 拠点へ送還。${dropped ? `ファイル${dropped}つが${cityName(from)}に落ちた。` : ''}`);
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
      addLog(state, `【${cname}】${me.name}が${a.label}と${b.label}の正体を入れ替えた（かもしれない）。尋問情報はリセット。`);
      break;
    }
    case 'wiretap': {
      const t = action.player;
      if (!Number.isInteger(t) || t === p || !state.players[t] || state.players[t].out) fail('盗聴する相手を選んでください');
      const h = state.hands[t];
      addLog(state, `【${cname}】${me.name}が${state.players[t].name}を盗聴した。`);
      addLog(state, `盗聴結果: ${state.players[t].name}の手札は ${h.length ? h.map((c) => CARDS[c].name).join('・') : 'なし'}`, p);
      break;
    }
    case 'extract': {
      const a = ownAgent(state, p, action.agent);
      if (a.city === me.base) fail('すでに拠点にいます');
      addLog(state, `【${cname}】${agentName(state, a.id)}が${cityName(a.city)}から拠点へ緊急脱出！`);
      a.city = me.base;
      break;
    }
    default:
      fail('不明なカードです');
  }
  hand.splice(ci, 1);
  state.discard.push(type);
}

// ---------- 合法手の列挙（テスト・CPU用） ----------

export function legalActions(state, p) {
  if (state.status !== 'playing' || state.turn.player !== p) return [];
  const out = [{ type: 'endTurn' }];
  const mine = state.agents.filter((a) => a.owner === p && a.city);
  const enemies = state.agents.filter((a) => a.owner !== p && a.city);
  for (const a of mine) {
    for (const to of neighbors(a.city)) out.push({ type: 'move', agent: a.id, to });
    if (a.files.length < RULES.carryLimit) {
      for (const f of state.cityFiles[a.city]) out.push({ type: 'infiltrate', agent: a.id, file: f });
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
    if (type === 'interrogate' || type === 'arrest') {
      for (const a of mine) {
        for (const t of enemies) {
          if (t.city !== a.city) continue;
          if (type === 'arrest' && t.city === state.players[t.owner].base) continue;
          out.push({ type: 'card', card, agent: a.id, target: t.id });
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
