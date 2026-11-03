import { connectDB } from './db.js';
import { firebaseConfig } from './firebase-config.js';
import {
  Lobby, WaitingRoom, OnlineGame, LocalGame, genId, normalizeRoomId,
} from './online.js';
import * as G from './game.js';

const $ = (s) => document.querySelector(s);
const SVG = 'http://www.w3.org/2000/svg';

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function storageGet(store, key) { try { return store.getItem(key); } catch { return null; } }
function storageSet(store, key, v) { try { if (v == null) store.removeItem(key); else store.setItem(key, v); } catch { /* ignore */ } }

// タブごとに別のID（同じブラウザの別タブで対戦できるように）
let uid = storageGet(sessionStorage, 'beppan-uid');
if (!uid) { uid = genId(12); storageSet(sessionStorage, 'beppan-uid', uid); }

let db = null;
let lobby = null;
let waiting = null;
let game = null;
let unsubGame = null;
let state = null;
let handoffShownFor = null;
let resultDismissed = false;

// UI の一時状態
const ui = { agent: null, city: null, flow: null, busy: false };

// ---------- 画面切り替え・共通 ----------

function show(screen) {
  for (const id of ['title', 'wait', 'game']) $(`#screen-${id}`).hidden = id !== screen;
  if (screen !== 'game') { $('#handoff').hidden = true; $('#result').hidden = true; }
}

let toastTimer;
function toast(msg, kind = 'error') {
  const t = $('#toast');
  t.textContent = msg;
  t.className = `toast ${kind === 'info' ? 'info' : ''}`;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 3200);
}

function playerName() {
  const v = $('#name').value.trim().slice(0, 12);
  const name = v || `工作員${Math.floor(100 + Math.random() * 900)}`;
  $('#name').value = name;
  storageSet(localStorage, 'beppan-name', name);
  return name;
}

function fillSizeSelect(sel, def) {
  for (let n = 2; n <= 6; n++) {
    const o = document.createElement('option');
    o.value = n;
    o.textContent = `${n}人`;
    if (n === def) o.selected = true;
    sel.appendChild(o);
  }
}

async function guard(btn, fn) {
  if (ui.busy) return;
  ui.busy = true;
  if (btn) btn.disabled = true;
  $('#title-msg').textContent = '';
  try {
    if (!lobby) throw new Error('オンライン対戦サーバー（Firebase）に接続できていません。通信環境を確認して再読み込みしてください。「1台で遊ぶ」は使えます。');
    await fn();
  } catch (e) {
    console.error(e);
    $('#title-msg').textContent = e.message || String(e);
  } finally {
    ui.busy = false;
    if (btn) btn.disabled = false;
  }
}

// ---------- 起動 ----------

async function init() {
  fillSizeSelect($('#qm-size'), 4);
  fillSizeSelect($('#room-size'), 6);
  fillSizeSelect($('#local-size'), 3);
  $('#name').value = storageGet(localStorage, 'beppan-name') || '';

  const dl = $('#rules-cards');
  for (const def of Object.values(G.CARDS)) {
    dl.insertAdjacentHTML('beforeend', `<dt>${esc(def.name)}（${def.count}枚）</dt><dd>${esc(def.desc)}</dd>`);
  }

  const params = new URLSearchParams(location.search);
  if (params.get('room')) $('#room-id').value = normalizeRoomId(params.get('room'));

  bindTitle();
  bindWait();
  bindGame();

  try {
    db = await connectDB(firebaseConfig);
  } catch (e) {
    console.error(e);
    $('#title-msg').textContent = 'オンライン対戦サーバー（Firebase）に接続できませんでした。通信環境を確認して再読み込みしてください。「1台で遊ぶ」は使えます。';
    return;
  }
  lobby = new Lobby(db, uid);
  if (db.kind === 'mock') {
    const b = $('#banner');
    b.hidden = false;
    b.textContent = 'デモモード（Firebase 未設定）: オンライン対戦は、このブラウザの別タブ同士でのみ動作します。インターネット対戦は README の手順で Firebase を設定してください。';
  }
  await tryResume();
}

async function tryResume() {
  const roomId = storageGet(sessionStorage, 'beppan-room');
  if (!roomId) return;
  try {
    const room = await db.get(`rooms/${roomId}`);
    if (room && room.meta && room.meta.status === 'waiting' && room.meta.players && room.meta.players[uid]) {
      await enterWaiting(roomId);
      return;
    }
    if (room && room.state) {
      const s = JSON.parse(room.state);
      const me = s.players.findIndex((p) => p.id === uid);
      if (me >= 0 && !s.players[me].out && s.status === 'playing') {
        await enterOnlineGame(roomId);
        return;
      }
    }
  } catch (e) { console.error(e); }
  storageSet(sessionStorage, 'beppan-room', null);
}

// ---------- タイトル ----------

function bindTitle() {
  $('#btn-quick').onclick = (e) => guard(e.currentTarget, async () => {
    const name = playerName();
    const n = Number($('#qm-size').value);
    $('#title-msg').textContent = '';
    const roomId = await lobby.quickMatch(name, n);
    await enterWaiting(roomId);
  });
  $('#btn-create').onclick = (e) => guard(e.currentTarget, async () => {
    const roomId = await lobby.createRoom(playerName(), Number($('#room-size').value));
    await enterWaiting(roomId);
  });
  $('#btn-join').onclick = (e) => guard(e.currentTarget, async () => {
    const id = normalizeRoomId($('#room-id').value);
    if (!id) throw new Error('ルームIDを入力してください');
    await lobby.join(id, playerName());
    await enterWaiting(id);
  });
  $('#room-id').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#btn-join').click(); });
  $('#btn-local').onclick = () => {
    const n = Number($('#local-size').value);
    const base = playerName();
    const names = Array.from({ length: n }, (_, i) => (i === 0 ? base : `${G.COLOR_NAMES[i]}チーム`));
    startGame(new LocalGame(names));
  };
  $('#btn-rules').onclick = () => $('#rules').showModal();
}

// ---------- 待機室 ----------

function bindWait() {
  $('#btn-wait-cancel').onclick = async () => {
    const w = waiting;
    waiting = null;
    storageSet(sessionStorage, 'beppan-room', null);
    show('title');
    if (w) await w.close(true);
  };
  $('#btn-start-now').onclick = (e) => guard(e.currentTarget, async () => { if (waiting) await waiting.startNow(); });
  $('#btn-copy-id').onclick = () => copy($('#wait-code').textContent);
  $('#btn-copy-url').onclick = () => copy(shareUrl($('#wait-code').textContent));
}

function shareUrl(id) {
  const u = new URL(location.href);
  u.search = `?room=${id}`;
  u.hash = '';
  return u.toString();
}

async function copy(text) {
  try { await navigator.clipboard.writeText(text); toast('コピーしました', 'info'); } catch { toast(text, 'info'); }
}

async function enterWaiting(roomId) {
  storageSet(sessionStorage, 'beppan-room', roomId);
  show('wait');
  $('#wait-status').textContent = '接続中…';
  $('#wait-players').innerHTML = '';
  waiting = new WaitingRoom(db, lobby, roomId, renderWaiting, async (id) => {
    waiting = null;
    await enterOnlineGame(id);
  });
  await waiting.open();
}

function renderWaiting(info) {
  if (!info) {
    $('#wait-status').textContent = 'ルームが見つかりません。';
    return;
  }
  const { meta, members, remain, isHost } = info;
  $('#wait-title').textContent = meta.isPublic ? 'ランダムマッチ待機中…' : 'ルーム待機中';
  $('#wait-share').hidden = meta.isPublic;
  $('#wait-code').textContent = waiting ? waiting.roomId : '';
  const n = members.length;
  let status = `${n} / ${meta.capacity}人`;
  if (meta.isPublic) {
    status += remain > 0
      ? `　あと${remain}秒で${n >= 2 ? '今の人数で' : ''}開始${n < 2 ? '（2人以上必要）' : ''}`
      : (n >= 2 ? '　まもなく開始…' : '　対戦相手を探しています…');
  } else {
    status += isHost ? '　（2人以上で開始できます）' : '　ホストの開始を待っています';
  }
  $('#wait-status').textContent = status;
  const ul = $('#wait-players');
  ul.innerHTML = '';
  members.forEach((m, i) => {
    const li = document.createElement('li');
    li.innerHTML = `<span class="dot" style="background:${G.COLORS[i]}"></span>${esc(m.name)}${m.id === uid ? '（あなた）' : ''}${m.id === meta.host && !meta.isPublic ? ' 👑' : ''}`;
    ul.appendChild(li);
  });
  for (let i = n; i < meta.capacity; i++) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = '募集中…';
    ul.appendChild(li);
  }
  $('#btn-start-now').hidden = !(n >= 2 && (meta.isPublic || isHost));
}

// ---------- ゲーム ----------

async function enterOnlineGame(roomId) {
  storageSet(sessionStorage, 'beppan-room', roomId);
  const g = new OnlineGame(db, roomId, uid);
  await g.open();
  startGame(g);
}

function startGame(g) {
  if (unsubGame) unsubGame();
  game = g;
  state = null;
  handoffShownFor = null;
  centeredFor = null;
  resultDismissed = false;
  Object.assign(ui, { agent: null, city: null, flow: null });
  show('game');
  unsubGame = game.onState((s) => {
    state = s;
    if (game.kind === 'online' && game.viewer() < 0) {
      toast('このゲームに参加できませんでした（開始時に接続していなかった可能性があります）');
      leaveGame(false);
      return;
    }
    render();
  });
}

async function leaveGame(confirmFirst = true) {
  if (!game) return;
  const playing = state && state.status === 'playing' && game.viewer() >= 0 && !state.players[game.viewer()].out;
  if (confirmFirst && playing && !confirm(game.kind === 'online' ? '投降して退出しますか？' : 'ゲームを終了しますか？')) return;
  if (playing && game.kind === 'online') { try { await game.act({ type: 'resign' }); } catch { /* ignore */ } }
  if (unsubGame) unsubGame();
  unsubGame = null;
  const g = game;
  game = null;
  state = null;
  storageSet(sessionStorage, 'beppan-room', null);
  show('title');
  await g.close();
}

function bindGame() {
  $('#btn-leave').onclick = () => leaveGame(true);
  $('#btn-rules2').onclick = () => $('#rules').showModal();
  $('#btn-end').onclick = () => act({ type: 'endTurn' });
  $('#btn-handoff').onclick = () => {
    handoffShownFor = state ? `${state.turn.round}-${state.turn.player}` : null;
    $('#handoff').hidden = true;
    render();
  };
  $('#btn-result-board').onclick = () => { resultDismissed = true; $('#result').hidden = true; };
  $('#btn-result-title').onclick = () => leaveGame(false);

  $('#board').addEventListener('click', (e) => {
    const t = e.target.closest('[data-agent]');
    if (t) { onAgentClick(t.dataset.agent); return; }
    const c = e.target.closest('[data-city]');
    if (c) onCityClick(c.dataset.city);
  });
  $('#players').addEventListener('click', (e) => {
    const li = e.target.closest('[data-player]');
    if (li && ui.flow) flowPick('player', Number(li.dataset.player));
  });
  $('#hand').addEventListener('click', (e) => {
    const b = e.target.closest('[data-card]');
    if (b) onCardClick(Number(b.dataset.card));
  });
  $('#selection').addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const d = b.dataset;
    if (d.act === 'infiltrate') act({ type: 'infiltrate', agent: d.agent, file: d.file });
    else if (d.act === 'drop') act({ type: 'drop', agent: d.agent, file: d.file });
    else if (d.act === 'transfer') act({ type: 'transfer', agent: d.agent, to: d.to, file: d.file });
    else if (d.act === 'select') { ui.agent = d.agent; render(); }
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && ui.flow) { ui.flow = null; render(); }
  });
}

const viewer = () => (game ? game.viewer() : -1);
const myTurn = () => state && state.status === 'playing' && state.turn.player === viewer();

async function act(action) {
  if (!game || ui.busy) return;
  ui.busy = true;
  try {
    await game.act(action);
    ui.flow = null;
    if (action.type === 'endTurn') ui.agent = null;
  } catch (e) {
    toast(e.message || String(e));
  } finally {
    ui.busy = false;
    render();
  }
}

// ---------- カード使用の手順 ----------

const FLOWS = {
  interrogate: [
    { key: 'agent', kind: 'own', prompt: '尋問する自分の工作員を選んでください' },
    { key: 'target', kind: 'enemySameCity', prompt: '同じ都市にいる相手の工作員を選んでください' },
  ],
  arrest: [
    { key: 'agent', kind: 'own', prompt: '拘束する自分の工作員を選んでください' },
    { key: 'target', kind: 'enemySameCity', prompt: '同じ都市にいる相手の工作員を選んでください（相手の拠点は不可）' },
  ],
  disguise: [
    { key: 'agent', kind: 'own', prompt: '正体を入れ替える1人目の工作員を選んでください' },
    { key: 'agent2', kind: 'own', prompt: '2人目の工作員を選んでください' },
  ],
  wiretap: [{ key: 'player', kind: 'player', prompt: '盗聴する相手をプレイヤー一覧から選んでください' }],
  extract: [{ key: 'agent', kind: 'own', prompt: '拠点へ脱出させる工作員を選んでください' }],
};

// 現在の手順で選べる候補（legalActions から逆算）
function flowCandidates() {
  const f = ui.flow;
  if (!f) return { step: null, ids: new Set() };
  const steps = FLOWS[f.type];
  const step = steps.find((s) => f.picks[s.key] === undefined);
  const ids = new Set();
  if (!step) return { step, ids };
  const legal = G.legalActions(state, viewer()).filter((a) => a.type === 'card' && a.card === f.card);
  for (const a of legal) {
    if (steps.every((s) => f.picks[s.key] === undefined || a[s.key] === f.picks[s.key])) ids.add(a[step.key]);
  }
  return { step, ids };
}

function onCardClick(idx) {
  if (!myTurn()) return;
  const type = state.hands[viewer()][idx];
  if (ui.flow && ui.flow.card === idx) { ui.flow = null; render(); return; }
  ui.flow = { card: idx, type, picks: {} };
  // 選択中の自分の工作員を1人目として使えるなら自動で使う
  const first = FLOWS[type][0];
  if (first.kind === 'own' && ui.agent) {
    const { ids } = flowCandidates();
    if (ids.has(ui.agent)) ui.flow.picks[first.key] = ui.agent;
  }
  maybeFinishFlow();
  render();
}

function flowPick(kind, value) {
  const { step, ids } = flowCandidates();
  if (!step) return;
  const ok = (kind === 'player') === (step.kind === 'player');
  if (!ok || !ids.has(value)) { toast('その対象は選べません'); return; }
  ui.flow.picks[step.key] = value;
  if (step.kind !== 'player') ui.agent = ui.agent || value;
  if (!maybeFinishFlow()) render();
}

function maybeFinishFlow() {
  const f = ui.flow;
  if (!f) return false;
  const steps = FLOWS[f.type];
  if (steps.some((s) => f.picks[s.key] === undefined)) {
    // 候補が無ければ中断
    if (flowCandidates().ids.size === 0) {
      toast(`今は「${G.CARDS[f.type].name}」を使える対象がいません`);
      ui.flow = null;
    }
    return false;
  }
  act({ type: 'card', card: f.card, ...f.picks });
  return true;
}

function onAgentClick(id) {
  if (!state) return;
  if (ui.flow) { flowPick('agent', id); return; }
  const a = state.agents.find((x) => x.id === id);
  // 自分の選択中の工作員と別都市の場所を押したら移動とみなす
  if (ui.agent && a && a.owner !== viewer()) {
    const sel = state.agents.find((x) => x.id === ui.agent);
    if (sel && sel.owner === viewer() && myTurn() && G.neighbors(sel.city).includes(a.city)) {
      act({ type: 'move', agent: sel.id, to: a.city });
      return;
    }
  }
  ui.agent = id;
  ui.city = a ? a.city : null;
  render();
}

function onCityClick(cityId) {
  if (!state || ui.flow) return;
  const sel = ui.agent && state.agents.find((x) => x.id === ui.agent);
  if (sel && sel.owner === viewer() && myTurn() && G.neighbors(sel.city).includes(cityId)) {
    act({ type: 'move', agent: sel.id, to: cityId });
    return;
  }
  ui.city = cityId;
  const mine = state.agents.filter((x) => x.owner === viewer() && x.city === cityId);
  ui.agent = mine.length ? mine[0].id : null;
  render();
}

// ---------- 描画 ----------

function render() {
  if (!state || !game) return;
  const v = viewer();

  // 選択状態の整合性
  if (ui.agent && !state.agents.some((a) => a.id === ui.agent && a.city)) ui.agent = null;
  if (ui.flow && (!myTurn() || state.hands[v][ui.flow.card] !== ui.flow.type)) ui.flow = null;

  // 1台モード: 手番交代の目隠し
  const key = `${state.turn.round}-${state.turn.player}`;
  const needHandoff = game.kind === 'local' && state.status === 'playing' && handoffShownFor !== key;
  $('#handoff').hidden = !needHandoff;
  if (needHandoff) {
    const p = state.players[state.turn.player];
    $('#handoff-name').innerHTML = `<span class="dot" style="background:${p.color}"></span>${esc(p.name)}の番です`;
    ui.agent = null;
    ui.flow = null;
  }

  renderHead();
  renderBoard();
  centerOnBase();
  renderPlayers();
  renderSelection();
  renderHand();
  renderLog();
  renderPrompt();

  const fin = state.status === 'finished';
  $('#result').hidden = !fin || resultDismissed;
  if (fin) {
    const names = state.winner.players.map((i) => state.players[i].name);
    const iWon = state.winner.players.includes(v);
    $('#result-title').textContent = `${names.join('、')}の勝利！${iWon && game.kind === 'online' ? '（あなたの勝ち）' : ''}`;
    $('#result-reason').textContent = state.winner.reason;
  }
}

function renderHead() {
  const v = viewer();
  const t = state.turn;
  const p = state.players[t.player];
  let html;
  if (state.status === 'finished') {
    html = '<b>ゲーム終了</b>';
  } else {
    const you = myTurn() ? '<span class="you">あなたの番</span>　' : '';
    html = `${you}ラウンド ${t.round}/${G.RULES.maxRounds}　<span class="dot" style="background:${p.color}"></span>${esc(p.name)}の手番　残り行動 <b>${t.actionsLeft}</b>`;
  }
  if (v >= 0) {
    const me = state.players[v];
    html += `　<span class="muted">あなた: <span class="dot" style="background:${me.color}"></span>${esc(me.name)}／拠点 ${G.cityById[me.base].name}</span>`;
  }
  $('#turn-info').innerHTML = html;
  $('#btn-end').disabled = !myTurn();
}

function el(tag, attrs = {}, parent) {
  const e = document.createElementNS(SVG, tag);
  for (const [k, val] of Object.entries(attrs)) e.setAttribute(k, val);
  if (parent) parent.appendChild(e);
  return e;
}

function renderBoard() {
  const svg = $('#board');
  svg.textContent = '';
  const v = viewer();

  // 経緯線
  const grid = el('g', { stroke: '#16283c', 'stroke-width': 1 }, svg);
  for (let x = 50; x < 1000; x += 100) el('line', { x1: x, y1: 0, x2: x, y2: 480 }, grid);
  for (let y = 40; y < 480; y += 80) el('line', { x1: 0, y1: y, x2: 1000, y2: y }, grid);

  for (const [a, b, wrap] of G.EDGES) {
    const A = G.cityById[a];
    const B = G.cityById[b];
    if (wrap) {
      el('line', { x1: A.x, y1: A.y, x2: 0, y2: A.y + 30, class: 'edge wrap' }, svg);
      el('line', { x1: B.x, y1: B.y, x2: 1000, y2: B.y + 30, class: 'edge wrap' }, svg);
      const l1 = el('text', { x: 6, y: A.y + 52, class: 'wrap-label' }, svg); l1.textContent = '← 太平洋航路';
      const l2 = el('text', { x: 994, y: B.y + 78, class: 'wrap-label', 'text-anchor': 'end' }, svg); l2.textContent = '太平洋航路 →';
    } else {
      el('line', { x1: A.x, y1: A.y, x2: B.x, y2: B.y, class: 'edge' }, svg);
    }
  }

  const sel = ui.agent && state.agents.find((a) => a.id === ui.agent);
  const reachable = new Set(sel && sel.owner === v && myTurn() && !ui.flow ? G.neighbors(sel.city) : []);

  for (const c of G.CITIES) {
    const g = el('g', { class: `city${reachable.has(c.id) ? ' reachable' : ''}${ui.city === c.id ? ' selected' : ''}`, 'data-city': c.id }, svg);
    const owner = state.players.find((p) => p.base === c.id);
    if (owner) el('circle', { cx: c.x, cy: c.y, r: 27, class: 'base-ring', stroke: owner.color, opacity: owner.out ? 0.3 : 1 }, g);
    el('circle', { cx: c.x, cy: c.y, r: 20, class: 'node' }, g);
    const t = el('text', { x: c.x, y: c.y + 46, class: 'cname' }, g);
    t.textContent = owner ? `${c.name}（拠点）` : c.name;
    const n = state.cityFiles[c.id].length;
    if (n > 0) {
      const f = el('g', { class: 'folder' }, g);
      el('rect', { x: c.x - 11, y: c.y - 8, width: 22, height: 16, rx: 3 }, f);
      const ft = el('text', { x: c.x, y: c.y + 4.5 }, f);
      ft.textContent = n;
    }
  }

  // 工作員
  const { ids: candidates } = flowCandidates();
  const byCity = {};
  for (const a of state.agents) if (a.city) (byCity[a.city] ||= []).push(a);
  for (const [cityId, list] of Object.entries(byCity)) {
    const c = G.cityById[cityId];
    const k = list.length;
    // 都市名に重ならないよう、少人数なら上半分に並べる
    const upper = k <= 5;
    const r = upper ? 32 : 40;
    list.forEach((a, i) => {
      const ang = upper
        ? (k === 1 ? -Math.PI / 2 : -Math.PI + Math.PI * (0.12 + (0.76 * i) / (k - 1)))
        : -Math.PI / 2 + (2 * Math.PI * i) / k;
      const x = c.x + r * Math.cos(ang);
      const y = c.y + r * Math.sin(ang) * (upper ? 1 : 0.85);
      const pl = state.players[a.owner];
      const cls = ['token'];
      if (ui.agent === a.id) cls.push('selected');
      if (candidates.has(a.id)) cls.push('candidate');
      const g = el('g', { class: cls.join(' '), 'data-agent': a.id }, svg);
      const title = el('title', {}, g);
      const ident = G.knownIdentity(state, v, a.id);
      title.textContent = `${pl.name}の${a.label}${ident === 'ace' ? '（本物）' : ident === 'decoy' ? '（囮）' : ''}　ファイル${a.files.length}`;
      el('circle', { cx: x, cy: y, r: 13, class: 'body', fill: pl.color }, g);
      const lbl = el('text', { x, y: y + 4.5, class: 'lbl' }, g);
      lbl.textContent = a.label;
      if (ident) {
        el('circle', { cx: x + 11, cy: y - 11, r: 8, fill: ident === 'ace' ? '#f2cc60' : '#57606a', stroke: '#0d1117' }, g);
        const it = el('text', { x: x + 11, y: y - 7.5, class: 'ident', fill: ident === 'ace' ? '#2a1f00' : '#fff' }, g);
        it.textContent = ident === 'ace' ? '★' : '囮';
      }
      if (a.files.length) {
        el('rect', { x: x + 4, y: y + 5, width: 14, height: 11, rx: 2, fill: '#e8c766', stroke: '#2a1f00' }, g);
        const ft = el('text', { x: x + 11, y: y + 14, class: 'ident', fill: '#2a1f00' }, g);
        ft.textContent = a.files.length;
      }
    });
  }
}

// スマホ（盤面が横スクロールになる幅）では最初に自分の拠点を中央に表示する
let centeredFor = null;
function centerOnBase() {
  const key = `${game.kind}-${viewer()}`;
  if (centeredFor === key) return;
  const wrap = document.querySelector('.board-wrap');
  if (wrap.scrollWidth <= wrap.clientWidth || viewer() < 0) return;
  centeredFor = key;
  const base = G.cityById[state.players[viewer()].base];
  wrap.scrollLeft = (base.x / 1000) * wrap.scrollWidth - wrap.clientWidth / 2;
}

function renderPlayers() {
  const ul = $('#players');
  ul.innerHTML = '';
  const v = viewer();
  const { step, ids } = flowCandidates();
  state.players.forEach((p, i) => {
    const li = document.createElement('li');
    li.dataset.player = i;
    const cls = [];
    if (state.status === 'playing' && state.turn.player === i) cls.push('turn');
    if (p.out) cls.push('out');
    if (step && step.kind === 'player' && ids.has(i)) cls.push('pickable');
    li.className = cls.join(' ');
    const carried = state.agents.filter((a) => a.owner === i && a.city).reduce((n, a) => n + a.files.length, 0);
    const off = game.kind === 'online' && !p.out && !game.isOnline(i);
    li.innerHTML = `<span class="dot" style="background:${p.color}"></span>`
      + `<span class="pname">${esc(p.name)}${i === v ? '（あなた）' : ''}</span>`
      + `${off ? '<span class="badge off">切断</span>' : ''}`
      + `<span class="stats">手札${state.hands[i].length}・ファイル${carried}</span>`;
    ul.appendChild(li);
  });
}

function fileTag(fileId) {
  const k = G.knownFile(state, viewer(), fileId);
  const num = fileId.slice(1);
  if (k === true) return `<span class="file-tag real">#${num} 本物</span>`;
  if (k === false) return `<span class="file-tag fake">#${num} 偽</span>`;
  return `<span class="file-tag">#${num} ?</span>`;
}

function renderSelection() {
  const box = $('#selection');
  const v = viewer();
  const a = ui.agent && state.agents.find((x) => x.id === ui.agent);
  const cityId = a ? a.city : ui.city;
  if (!cityId) {
    box.innerHTML = '<span class="muted">盤面の工作員や都市をタップしてください。</span>';
    return;
  }
  const city = G.cityById[cityId];
  let html = '';
  if (a) {
    const pl = state.players[a.owner];
    const ident = G.knownIdentity(state, v, a.id);
    const identTxt = ident === 'ace' ? '★本物' : ident === 'decoy' ? '囮' : '正体不明';
    html += `<div><span class="dot" style="background:${pl.color}"></span><b>${esc(pl.name)}の${a.label}</b>（${identTxt}）@ ${city.name}</div>`;
    if (a.owner === v) {
      html += `<div class="sub">所持ファイル: ${a.files.length ? a.files.map(fileTag).join(' ') : 'なし'}</div>`;
      if (myTurn() && !ui.flow) {
        html += '<div class="sub">光っている隣の都市をタップすると移動します。</div><div class="actions">';
        const full = a.files.length >= G.RULES.carryLimit;
        for (const f of state.cityFiles[cityId]) {
          html += `<button data-act="infiltrate" data-agent="${a.id}" data-file="${f}" ${full ? 'disabled title="これ以上持てません"' : ''}>潜入: ${fileTag(f)}</button>`;
        }
        const mates = state.agents.filter((b) => b.owner === v && b.id !== a.id && b.city === cityId);
        for (const f of a.files) {
          html += `<button data-act="drop" data-agent="${a.id}" data-file="${f}">置く ${fileTag(f)}</button>`;
          for (const b of mates) {
            const bfull = b.files.length >= G.RULES.carryLimit;
            html += `<button data-act="transfer" data-agent="${a.id}" data-to="${b.id}" data-file="${f}" ${bfull ? 'disabled' : ''}>${fileTag(f)}を${b.label}へ渡す</button>`;
          }
        }
        html += '</div>';
      }
    } else {
      html += `<div class="sub">所持ファイル: ${a.files.length ? a.files.map(fileTag).join(' ') : 'なし'}</div>`;
    }
  } else {
    html += `<div><b>${city.name}</b></div>`;
  }
  const files = state.cityFiles[cityId];
  html += `<div class="sub">${city.name}のファイル: ${files.length ? files.map(fileTag).join(' ') : 'なし'}</div>`;
  const here = state.agents.filter((x) => x.city === cityId);
  if (here.length) {
    html += '<div class="actions">';
    for (const x of here) {
      const pl = state.players[x.owner];
      html += `<button data-act="select" data-agent="${x.id}"><span class="dot" style="background:${pl.color}"></span>${esc(pl.name)}の${x.label}</button>`;
    }
    html += '</div>';
  }
  box.innerHTML = html;
}

function renderHand() {
  const v = viewer();
  const box = $('#hand');
  box.innerHTML = '';
  if (v < 0) { $('#hand-count').textContent = ''; return; }
  const hand = state.hands[v];
  $('#hand-count').textContent = `${hand.length}/${G.RULES.handLimit}`;
  const legal = myTurn() ? G.legalActions(state, v) : [];
  if (!hand.length) box.innerHTML = '<span class="muted">手札なし</span>';
  hand.forEach((type, i) => {
    const def = G.CARDS[type];
    const usable = legal.some((a) => a.type === 'card' && a.card === i);
    const b = document.createElement('button');
    b.dataset.card = i;
    b.disabled = !usable;
    if (ui.flow && ui.flow.card === i) b.className = 'active';
    b.title = usable ? '' : (myTurn() ? '今は使える対象がいません' : '自分の手番に使えます');
    b.innerHTML = `<b>${esc(def.name)}</b><small>${esc(def.desc)}</small>`;
    box.appendChild(b);
  });
}

function renderLog() {
  const v = viewer();
  const ol = $('#log');
  ol.innerHTML = '';
  const entries = state.log.filter((l) => l.to === undefined || l.to === v).slice(-50).reverse();
  for (const l of entries) {
    const li = document.createElement('li');
    if (l.to !== undefined) li.className = 'private';
    li.textContent = l.text;
    ol.appendChild(li);
  }
}

function renderPrompt() {
  const p = $('#prompt');
  const { step } = flowCandidates();
  if (!ui.flow || !step) { p.hidden = true; return; }
  p.hidden = false;
  p.innerHTML = `<span>【${esc(G.CARDS[ui.flow.type].name)}】${esc(step.prompt)}</span><button id="btn-flow-cancel">やめる</button>`;
  $('#btn-flow-cancel').onclick = () => { ui.flow = null; render(); };
}

init();
