import { connectDB } from './db.js';
import { firebaseConfig } from './firebase-config.js';
import { FEATURES } from './features.js';
import {
  Lobby, WaitingRoom, OnlineGame, LocalGame, genId, normalizeRoomId,
} from './online.js';
import * as G from './game.js';
import * as A from './art.js';
import { LEVELS, cpuName, chooseAction } from './cpu.js';
import { Camera, DEFAULT_SCALE } from './camera.js';
import { sfx, sfxEnabled, setSfx } from './sfx.js';

const $ = (s) => document.querySelector(s);
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
let lastSetup = null; // 「もう一度」用
let handoffShownFor = null;
let resultDismissed = false;
let camera = null;

// スマホ表示かどうか（幅が狭い、または横向きのスマホ）
const mqMobile = window.matchMedia('(max-width: 760px), (max-height: 520px) and (pointer: coarse)');
const mqLandscape = window.matchMedia('(orientation: landscape)');
const isMobile = () => mqMobile.matches;

// 画面の一時状態
const ui = {
  tab: 'action', tabCtx: '', prevTurnKey: '', logSeenSeq: -1, menuOpen: false,
  agent: null, city: null, flow: null, busy: false,
  seenSeq: null, freshUntil: 0, freshSeq: -1, prevSeq: -1,
};

// ---------- 共通 ----------

function show(screen) {
  for (const id of ['title', 'wait', 'game']) $(`#screen-${id}`).hidden = id !== screen;
  document.body.classList.toggle('in-game', screen === 'game');
  if (screen !== 'game') { $('#handoff').hidden = true; $('#result').hidden = true; }
  window.scrollTo(0, 0);
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

function fillIcons(root = document) {
  root.querySelectorAll('[data-icon]').forEach((el) => {
    if (!el.firstElementChild) el.innerHTML = A.icon(el.dataset.icon);
  });
}

function playerName() {
  const v = $('#name').value.trim().slice(0, 12);
  const name = v || `工作員${Math.floor(100 + Math.random() * 900)}`;
  $('#name').value = name;
  storageSet(localStorage, 'beppan-name', name);
  return name;
}

function fillSelect(sel, items, def) {
  sel.innerHTML = '';
  for (const [value, label] of items) {
    const o = document.createElement('option');
    o.value = value;
    o.textContent = label;
    if (String(value) === String(def)) o.selected = true;
    sel.appendChild(o);
  }
}
const range = (a, b, suffix) => Array.from({ length: b - a + 1 }, (_, i) => [a + i, `${a + i}${suffix}`]);
const levelItems = () => Object.entries(LEVELS).map(([k, v]) => [k, v.name]);

async function guard(btn, fn) {
  if (ui.busy) return;
  ui.busy = true;
  if (btn) btn.disabled = true;
  $('#title-msg').textContent = '';
  try {
    if (!FEATURES.online) throw new Error('オンライン対戦は準備中です。「ひとりで遊ぶ」「1台でみんなで」で遊べます。');
    if (!lobby) throw new Error('オンライン対戦サーバー（Firebase）に接続できていません。通信環境を確認して再読み込みしてください。「ひとりで遊ぶ」「1台でみんなで」は使えます。');
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
  $('#hero-art').innerHTML = A.heroSVG();
  $('#wait-art').innerHTML = A.tutorialArt('identity');
  fillIcons();

  fillSelect($('#solo-cpus'), range(1, 5, '人'), 2);
  fillSelect($('#solo-level'), levelItems(), 'normal');
  fillSelect($('#qm-size'), range(2, 6, '人'), 4);
  fillSelect($('#room-size'), range(2, 6, '人'), 6);
  fillSelect($('#local-humans'), range(2, 6, '人'), 2);
  fillSelect($('#local-level'), levelItems(), 'normal');
  const syncLocal = () => {
    const h = Number($('#local-humans').value);
    const cur = Number($('#local-cpus').value || 0);
    fillSelect($('#local-cpus'), range(0, 6 - h, '人'), Math.min(cur, 6 - h));
  };
  $('#local-humans').addEventListener('change', syncLocal);
  syncLocal();
  $('#name').value = storageGet(localStorage, 'beppan-name') || '';

  bindTitle();
  bindWait();
  bindGame();
  bindRules();
  bindMobile();

  // オンライン対戦は js/features.js の FEATURES.online で開放する
  document.querySelectorAll('[data-feature="online"]').forEach((el) => { el.hidden = !FEATURES.online; });
  document.querySelectorAll('.modes .mode:not([hidden]) .mode-tab').forEach((el, i) => { el.textContent = `FILE ${String(i + 1).padStart(2, '0')}`; });
  if (!FEATURES.online) {
    storageSet(sessionStorage, 'beppan-room', null);
    return;
  }

  const params = new URLSearchParams(location.search);
  if (params.get('room')) $('#room-id').value = normalizeRoomId(params.get('room'));

  try {
    db = await connectDB(firebaseConfig);
  } catch (e) {
    console.error(e);
    $('#title-msg').textContent = 'オンライン対戦サーバー（Firebase）に接続できませんでした。「ひとりで遊ぶ」「1台でみんなで」は使えます。';
    return;
  }
  lobby = new Lobby(db, uid);
  if (db.kind === 'mock') {
    const b = $('#banner');
    b.hidden = false;
    b.textContent = 'デモモード（Firebase 未設定）: オンライン対戦は、このブラウザの別タブ同士でのみ動作します。';
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

function startLocal(setup) {
  lastSetup = setup;
  const cpuDelay = Number(storageGet(localStorage, 'beppan-cpu-delay')) || 900;
  startGame(new LocalGame(setup, { cpuDelay }));
}

function bindTitle() {
  $('#btn-solo').onclick = () => {
    const n = Number($('#solo-cpus').value);
    const level = $('#solo-level').value;
    const seats = [{ name: playerName() }];
    for (let i = 0; i < n; i++) seats.push({ name: cpuName(i), cpu: level });
    startLocal(seats);
  };
  $('#btn-local').onclick = () => {
    const h = Number($('#local-humans').value);
    const c = Number($('#local-cpus').value);
    const level = $('#local-level').value;
    const base = playerName();
    const seats = [];
    for (let i = 0; i < h; i++) seats.push({ name: i === 0 ? base : `プレイヤー${i + 1}` });
    for (let i = 0; i < c; i++) seats.push({ name: cpuName(i), cpu: level });
    startLocal(seats);
  };
  $('#btn-quick').onclick = (e) => guard(e.currentTarget, async () => {
    const roomId = await lobby.quickMatch(playerName(), Number($('#qm-size').value));
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
  $('#btn-rules').onclick = () => openRules(0);
}

// ---------- 待機室 ----------

function bindWait() {
  const cancel = async () => {
    const w = waiting;
    waiting = null;
    storageSet(sessionStorage, 'beppan-room', null);
    show('title');
    if (w) await w.close(true);
  };
  $('#btn-wait-cancel').onclick = cancel;
  $('#btn-wait-cpu').onclick = async () => {
    const cap = waiting && waiting.info() ? waiting.info().meta.capacity : 4;
    await cancel();
    const seats = [{ name: playerName() }];
    for (let i = 0; i < cap - 1; i++) seats.push({ name: cpuName(i), cpu: 'normal' });
    startLocal(seats);
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
  $('#wait-title').textContent = meta.isPublic ? 'ランダムマッチ 待機中' : 'ルーム 待機中';
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
    li.innerHTML = `${A.agentSVG(G.COLORS[i])}<span>${esc(m.name)}${m.id === uid ? '（あなた）' : ''}${m.id === meta.host && !meta.isPublic ? '　ホスト' : ''}</span>`;
    ul.appendChild(li);
  });
  for (let i = n; i < meta.capacity; i++) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = '募集中…';
    ul.appendChild(li);
  }
  $('#btn-start-now').hidden = !(n >= 2 && (meta.isPublic || isHost));
  $('#btn-wait-cpu').hidden = !(meta.isPublic && n < 2);
}

// ---------- ゲーム開始・終了 ----------

async function enterOnlineGame(roomId) {
  storageSet(sessionStorage, 'beppan-room', roomId);
  const g = new OnlineGame(db, roomId, uid);
  await g.open();
  lastSetup = null;
  startGame(g);
}

function startGame(g) {
  if (unsubGame) unsubGame();
  if (game && game !== g) game.close();
  game = g;
  state = null;
  handoffShownFor = null;
  resultDismissed = false;
  Object.assign(ui, {
    agent: null, city: null, flow: null, seenSeq: null, prevSeq: -1, tabCtx: '', prevTurnKey: '', logSeenSeq: -1,
  });
  show('game');
  camera.needsInitialFocus = true;
  renderLegend();
  unsubGame = game.onState((s) => {
    state = s;
    if (game.kind === 'online' && game.viewer() < 0) {
      toast('このゲームに参加できませんでした（開始時に接続していなかった可能性があります）');
      leaveGame(false);
      return;
    }
    onNewState();
    render();
  });
}

async function leaveGame(confirmFirst = true) {
  if (!game) return;
  const v = game.viewer();
  const playing = state && state.status === 'playing' && v >= 0 && !state.players[v].out;
  if (confirmFirst && playing && !confirm(game.kind === 'online' ? '投降して退出しますか？' : 'ゲームを終了してタイトルに戻りますか？')) return;
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

// ---------- 入力 ----------

function bindGame() {
  $('#btn-leave').onclick = () => leaveGame(true);
  $('#btn-rules2').onclick = () => openRules(0);
  $('#btn-end').onclick = () => act({ type: 'endTurn' });
  $('#btn-handoff').onclick = () => {
    handoffShownFor = state ? `${state.turn.round}-${state.turn.player}` : null;
    $('#handoff').hidden = true;
    render();
  };
  $('#btn-result-board').onclick = () => { resultDismissed = true; $('#result').hidden = true; };
  $('#btn-result-title').onclick = () => leaveGame(false);
  $('#btn-result-again').onclick = () => { if (lastSetup) startLocal(lastSetup); };

  $('#board').addEventListener('click', (e) => {
    if (camera && camera.shouldSuppressClick()) return;
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
  $('#market').addEventListener('click', (e) => {
    const b = e.target.closest('[data-draw]');
    if (!b) return;
    if (b.dataset.draw === 'deck') act({ type: 'draw', from: 'deck' });
    else act({ type: 'draw', from: 'market', index: Number(b.dataset.draw) });
  });
  $('#coach').addEventListener('click', (e) => {
    const b = e.target.closest('[data-coach]');
    if (!b) return;
    if (b.dataset.coach === 'cancel') { ui.flow = null; render(); }
    if (b.dataset.coach === 'deck') act({ type: 'draw', from: 'deck' });
    if (b.dataset.coach === 'end') act({ type: 'endTurn' });
    if (b.dataset.coach === 'speed' && game && game.kind === 'local') {
      game.cpuDelay = game.cpuDelay < 500 ? 900 : 250;
      storageSet(localStorage, 'beppan-cpu-delay', String(game.cpuDelay));
      game.schedule();
      render();
    }
  });
  $('#selection').addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const d = b.dataset;
    if (d.act === 'select') { selectAgent(d.agent, { frame: true }); return; }
    if (d.act === 'deselect') { ui.agent = null; ui.city = null; render(); return; }
    if (d.act === 'move') { act({ type: 'move', agent: d.agent, to: d.to }); return; }
    if (d.act === 'transfer') act({ type: 'transfer', agent: d.agent, to: d.to, file: d.file });
    else act({ type: d.act, agent: d.agent, file: d.file });
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && ui.flow) { ui.flow = null; render(); }
  });
}

// ---------- スマホ表示・地図カメラ・メニュー ----------

function bindMobile() {
  camera = new Camera($('#board'), document.querySelector('.board-wrap'));
  const applyMode = () => {
    document.body.classList.toggle('is-mobile', isMobile());
    document.body.classList.toggle('landscape', isMobile() && mqLandscape.matches);
    camera.setEnabled(isMobile());
    if (state && game) { camera.needsInitialFocus = true; render(); }
  };
  mqMobile.addEventListener('change', applyMode);
  mqLandscape.addEventListener('change', applyMode);
  window.addEventListener('resize', () => { if (camera.enabled) camera.apply(); });
  applyMode();

  document.querySelector('.map-ctrl').addEventListener('click', (e) => {
    const b = e.target.closest('[data-zoom]');
    if (!b || !state) return;
    const z = b.dataset.zoom;
    if (z === 'in') camera.zoom(1.3);
    if (z === 'out') camera.zoom(1 / 1.3);
    if (z === 'fit') { camera.fitAll(); camera.userPanAt = Date.now(); }
    if (z === 'me') cycleMyAgent();
  });

  $('#dock-tabs').addEventListener('click', (e) => {
    const b = e.target.closest('[data-tab]');
    if (!b) return;
    ui.tab = b.dataset.tab;
    if (ui.tab === 'log' && state) ui.logSeenSeq = state.seq;
    render();
  });

  const menu = $('#game-menu');
  const setMenu = (open) => {
    ui.menuOpen = open;
    menu.hidden = !open;
    $('#btn-menu').setAttribute('aria-expanded', String(open));
    if (open) renderMenu();
  };
  $('#btn-menu').onclick = (e) => { e.stopPropagation(); setMenu(!ui.menuOpen); };
  document.addEventListener('click', (e) => { if (ui.menuOpen && !e.target.closest('#game-menu')) setMenu(false); });
  menu.addEventListener('click', (e) => {
    const b = e.target.closest('[data-menu]');
    if (!b) return;
    const m = b.dataset.menu;
    if (m === 'rules') { setMenu(false); openRules(0); }
    if (m === 'bgm') { $('#music-toggle').click(); setTimeout(renderMenu, 250); }
    if (m === 'sfx') { setSfx(!sfxEnabled()); renderMenu(); renderSfxButton(); }
    if (m === 'leave') { setMenu(false); leaveGame(true); }
  });
  $('#mission').addEventListener('click', (e) => {
    const b = e.target.closest('[data-warn]');
    if (!b || !state) return;
    const a = state.agents.find((x) => x.id === b.dataset.warn);
    if (!a) return;
    if (camera.enabled) { const c = cityPt(a.city); camera.focus(c.x, c.y); camera.userPanAt = Date.now(); }
    selectAgent(a.id);
  });
  $('#btn-sfx').onclick = () => { setSfx(!sfxEnabled()); renderSfxButton(); if (sfxEnabled()) sfx.tap(); };
  renderSfxButton();
}

function renderMenu() {
  const bgmOn = $('#music-toggle').getAttribute('aria-pressed') === 'true';
  $('#game-menu [data-menu="bgm"]').textContent = bgmOn ? 'BGM 停止' : 'BGM 再生';
  $('#game-menu [data-menu="sfx"]').textContent = `効果音・振動 ${sfxEnabled() ? 'ON' : 'OFF'}`;
}

function renderSfxButton() {
  const b = $('#btn-sfx');
  b.textContent = `効果音 ${sfxEnabled() ? 'ON' : 'OFF'}`;
  b.setAttribute('aria-pressed', String(sfxEnabled()));
}

const cityPt = (id) => G.cityById[id];

// 工作員を選び、スマホでは移動先まで見えるように地図を寄せる
function selectAgent(id, { frame = false } = {}) {
  ui.agent = id;
  ui.city = null;
  const a = state.agents.find((x) => x.id === id);
  if (a && a.owner === viewer() && isMobile()) ui.tab = 'action';
  if (frame && a && camera.enabled) frameAgent(a);
  render();
}

function frameAgent(a) {
  const wrapN = new Set(G.EDGES.filter((e) => e[2] && (e[0] === a.city || e[1] === a.city)).map((e) => (e[0] === a.city ? e[1] : e[0])));
  const pts = [cityPt(a.city), ...G.neighbors(a.city).filter((n) => !wrapN.has(n)).map(cityPt)];
  camera.fit(pts, { minScale: DEFAULT_SCALE * 0.75 });
  // 選んだ工作員自身は必ず画面内に
  const c = cityPt(a.city);
  if (!camera.visible(c.x, c.y, 50)) camera.focus(c.x, c.y);
}

// 「自分」ボタン: 自分の工作員を順番に選んで表示する
function cycleMyAgent() {
  const mine = state.agents.filter((a) => a.owner === viewer() && a.city);
  if (!mine.length) return;
  const i = mine.findIndex((a) => a.id === ui.agent);
  const next = mine[(i + 1) % mine.length];
  camera.focus(cityPt(next.city).x, cityPt(next.city).y, Math.max(camera.scale, DEFAULT_SCALE));
  camera.userPanAt = Date.now();
  selectAgent(next.id);
}

const viewer = () => (game ? game.viewer() : -1);
const isCpuTurn = () => !!(state && state.status === 'playing' && state.players[state.turn.player].cpu);
const myTurn = () => !!(state && state.status === 'playing' && state.turn.player === viewer() && !isCpuTurn());
const actionPhase = () => myTurn() && state.turn.phase === 'action';

async function act(action) {
  if (!game || ui.busy) return;
  ui.busy = true;
  try {
    await game.act(action);
    ui.flow = null;
    if (action.type === 'endTurn') { ui.agent = null; ui.city = null; }
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
    { key: 'agent', kind: 'own', prompt: '尋問する<b>自分の工作員</b>を選んでください' },
    { key: 'target', kind: 'enemy', prompt: '同じ都市にいる<b>相手の工作員</b>を選んでください' },
  ],
  arrest: [
    { key: 'agent', kind: 'own', prompt: '拘束する<b>自分の工作員</b>を選んでください' },
    { key: 'target', kind: 'enemy', prompt: '同じ都市にいる<b>相手の工作員</b>を選んでください（相手の拠点では不可）' },
  ],
  steal: [
    { key: 'agent', kind: 'own', prompt: 'ファイルを奪う<b>自分の工作員</b>を選んでください' },
    { key: 'target', kind: 'enemy', prompt: 'ファイルを持っている<b>相手の工作員</b>を選んでください' },
  ],
  trap: [{ key: 'city', kind: 'city', prompt: '罠を置く<b>都市</b>を選んでください（赤い点線の都市）' }],
  wiretap: [{ key: 'player', kind: 'player', prompt: '盗聴する<b>相手</b>を工作員リストから選んでください' }],
  disguise: [
    { key: 'agent', kind: 'own', prompt: '正体を入れ替える<b>1人目</b>を選んでください' },
    { key: 'agent2', kind: 'own', prompt: '<b>2人目</b>を選んでください' },
  ],
  extract: [{ key: 'agent', kind: 'own', prompt: '拠点へ脱出させる<b>工作員</b>を選んでください' }],
};

function flowLegal() {
  const f = ui.flow;
  if (!f) return [];
  const steps = FLOWS[f.type];
  return G.legalActions(state, viewer())
    .filter((a) => a.type === 'card' && a.card === f.card)
    .filter((a) => steps.every((s) => f.picks[s.key] === undefined || a[s.key] === f.picks[s.key]));
}

function flowCandidates() {
  const f = ui.flow;
  if (!f) return { step: null, ids: new Set() };
  const step = FLOWS[f.type].find((s) => f.picks[s.key] === undefined);
  const ids = new Set();
  if (step) for (const a of flowLegal()) ids.add(a[step.key]);
  return { step, ids };
}

function onCardClick(idx) {
  if (!actionPhase()) return;
  const hand = state.hands[viewer()];
  const type = hand[idx];
  const card = hand.indexOf(type);
  if (ui.flow && ui.flow.card === card) { ui.flow = null; render(); return; }
  ui.flow = { card, type, picks: {} };
  // 選択中の自分の工作員を1人目として使えるなら自動で使う
  const first = FLOWS[type][0];
  if (first.kind === 'own' && ui.agent && flowCandidates().ids.has(ui.agent)) ui.flow.picks[first.key] = ui.agent;
  advanceFlow();
}

function flowPick(kind, value) {
  const { step, ids } = flowCandidates();
  if (!step) return;
  let v = value;
  if (step.kind === 'city' && kind === 'agent') v = state.agents.find((a) => a.id === value).city;
  else if ((step.kind === 'player') !== (kind === 'player')) { toast('その対象は選べません'); return; }
  if (!ids.has(v)) { toast('その対象は選べません'); return; }
  ui.flow.picks[step.key] = v;
  if (step.kind === 'own') ui.agent = v;
  advanceFlow();
}

// 候補が1つしかない手順は自動で進め、すべて決まったら実行する
function advanceFlow() {
  for (let guardN = 0; guardN < 5 && ui.flow; guardN++) {
    const { step, ids } = flowCandidates();
    if (!step) {
      const action = flowLegal()[0];
      ui.flow = null;
      if (action) act(action); else render();
      return;
    }
    if (ids.size === 0) {
      toast(`今は「${G.CARDS[ui.flow.type].name}」を使える対象がいません`);
      ui.flow = null;
      break;
    }
    if (ids.size === 1 && step.kind !== 'city' && step.kind !== 'player') {
      ui.flow.picks[step.key] = [...ids][0];
      continue;
    }
    // スマホ: 選べる対象が見えるようにする
    if (isMobile()) {
      if (step.kind === 'player') ui.tab = 'agents';
      else if (camera.enabled) {
        const pts = [...ids].map((v) => (step.kind === 'city' ? cityPt(v) : cityPt(state.agents.find((a) => a.id === v).city)));
        if (pts.some((p) => !camera.visible(p.x, p.y, 40))) camera.fit(pts, { maxScale: camera.scale });
      }
    }
    break;
  }
  render();
}

function onAgentClick(id) {
  if (!state) return;
  if (ui.flow) { flowPick('agent', id); return; }
  const a = state.agents.find((x) => x.id === id);
  const sel = ui.agent && state.agents.find((x) => x.id === ui.agent);
  // 選択中の自分の工作員の隣の都市にいる相手をタップ → その都市へ移動
  if (sel && a && a.owner !== viewer() && sel.owner === viewer() && actionPhase() && G.neighbors(sel.city).includes(a.city)) {
    act({ type: 'move', agent: sel.id, to: a.city });
    return;
  }
  selectAgent(id);
}

function onCityClick(cityId) {
  if (!state) return;
  if (ui.flow) { flowPick('city', cityId); return; }
  const sel = ui.agent && state.agents.find((x) => x.id === ui.agent);
  if (sel && sel.owner === viewer() && actionPhase() && G.neighbors(sel.city).includes(cityId)) {
    act({ type: 'move', agent: sel.id, to: cityId });
    return;
  }
  const mine = state.agents.filter((x) => x.owner === viewer() && x.city === cityId);
  if (mine.length) { selectAgent(mine[0].id); return; }
  ui.agent = null;
  ui.city = cityId;
  if (isMobile()) ui.tab = 'action';
  render();
}

// ---------- 新しい状態が来たとき ----------

function onNewState() {
  const s = state;
  const turnKey = `${s.turn.round}-${s.turn.player}`;
  if (ui.seenSeq === null) {
    ui.seenSeq = s.seq; ui.prevSeq = s.seq; ui.prevTurnKey = turnKey; ui.logSeenSeq = s.seq;
    return;
  }
  if (s.seq === ui.seenSeq) return;
  ui.prevSeq = ui.seenSeq;
  ui.seenSeq = s.seq;
  ui.freshUntil = Date.now() + 1500;
  const v = viewer();
  const L = s.last;

  // 演出と効果音
  if (L && L.type === 'trap') { popup('罠発動！', 'trap'); sfx.trap(); }
  else if (L && L.type === 'card' && L.card === 'arrest') { popup('拘束！', 'arrest'); sfx.arrest(); }
  else if (L && L.type === 'card' && L.card === 'steal') { popup('奪取！', 'steal'); sfx.steal(); }
  else if (L && L.type === 'card') sfx.card();
  else if (L && L.type === 'move') sfx.move();
  else if (L && L.type === 'scout') sfx.scout();
  else if (L && (L.type === 'infiltrate' || L.type === 'transfer' || L.type === 'drop')) sfx.take();
  else if (L && L.type === 'draw' && L.player === v) sfx.draw();

  if (s.status === 'finished') {
    if (s.winner.players.includes(v)) sfx.win(); else sfx.lose();
    return;
  }

  // 自分の番が回ってきた
  const turnChanged = turnKey !== ui.prevTurnKey;
  ui.prevTurnKey = turnKey;
  const singleViewer = game.kind !== 'local' || game.humans.length === 1;
  if (turnChanged && myTurn() && singleViewer) {
    setTimeout(() => { popup('あなたの番', null, '#c7b68e'); sfx.myTurn(); }, L && ['trap', 'card'].includes(L.type) ? 1300 : 0);
    // スマホ: 自分の工作員が見えるように
    if (camera.enabled && Date.now() - camera.userPanAt > 2500) {
      const mine = s.agents.filter((a) => a.owner === v && a.city).map((a) => cityPt(a.city));
      if (mine.some((p) => !camera.visible(p.x, p.y, 40))) camera.fit(mine);
    }
    return;
  }

  // 相手の番: 動きのあった場所を追いかける（自分で地図を動かした直後は追わない）
  if (camera.enabled && !myTurn() && Date.now() - camera.userPanAt > 4000 && L) {
    const target = L.to || L.city;
    if (target) {
      const c = cityPt(target);
      if (!camera.visible(c.x, c.y, 60)) camera.focus(c.x, c.y);
    }
  }
}

let popupTimer;
function popup(text, card, color) {
  const p = $('#popup');
  p.hidden = true;
  void p.offsetWidth;
  p.innerHTML = `${A.stampSVG(text, color)}${card ? A.cardArtSVG(card) : ''}`;
  p.hidden = false;
  clearTimeout(popupTimer);
  popupTimer = setTimeout(() => { p.hidden = true; }, 1700);
}

// ---------- 描画 ----------

function render() {
  if (!state || !game) return;
  const v = viewer();

  if (ui.agent && !state.agents.some((a) => a.id === ui.agent && a.city)) ui.agent = null;
  if (ui.flow && (!actionPhase() || state.hands[v][ui.flow.card] !== ui.flow.type)) ui.flow = null;

  // 1台で複数人のとき: 手番交代の目隠し
  const key = `${state.turn.round}-${state.turn.player}`;
  const multiHuman = game.kind === 'local' && game.humans.length > 1;
  const needHandoff = multiHuman && state.status === 'playing' && !isCpuTurn() && handoffShownFor !== key;
  $('#handoff').hidden = !needHandoff;
  if (needHandoff) {
    const p = state.players[state.turn.player];
    $('#handoff-art').innerHTML = A.agentSVG(p.color);
    $('#handoff-name').textContent = `${p.name}の番です`;
    ui.agent = null;
    ui.flow = null;
  }

  autoTab();
  renderBanner();
  renderCoach();
  renderMission();
  renderBoard();
  if (camera.enabled && camera.needsInitialFocus && v >= 0) {
    camera.needsInitialFocus = false;
    camera.scale = DEFAULT_SCALE;
    const base = cityPt(state.players[v].base);
    camera.focus(base.x, base.y);
  } else {
    camera.apply();
  }
  renderDockTabs();
  renderMarket();
  renderHand();
  renderSelection();
  renderPlayers();
  renderLog();

  const fin = state.status === 'finished';
  $('#result').hidden = !fin || resultDismissed;
  if (fin) renderResult();
}

// スマホ: 手番の段階に合わせて下のタブを自動で切り替える
function autoTab() {
  if (!isMobile()) return;
  const s = state;
  const ctx = `${s.turn.round}-${s.turn.player}-${s.turn.phase}-${myTurn()}-${s.status}`;
  if (ctx === ui.tabCtx) return;
  ui.tabCtx = ctx;
  if (s.status !== 'playing') ui.tab = 'log';
  else if (!myTurn()) ui.tab = 'log';
  else if (s.turn.phase === 'draw') ui.tab = 'market';
  else ui.tab = 'action';
}

const TABS = [
  ['market', '本部'],
  ['action', '行動'],
  ['hand', '手札'],
  ['agents', '工作員'],
  ['log', 'ログ'],
];

function renderDockTabs() {
  const s = state;
  const v = viewer();
  if (ui.tab === 'log') ui.logSeenSeq = s.seq;
  const badge = {
    market: myTurn() && s.turn.phase === 'draw' ? '<i class="dot-badge">!</i>' : '',
    hand: v >= 0 ? `<i class="count-badge">${s.hands[v].length}</i>` : '',
    log: s.seq > ui.logSeenSeq ? '<i class="dot-badge"></i>' : '',
    action: '',
    agents: ui.flow && flowCandidates().step && flowCandidates().step.kind === 'player' ? '<i class="dot-badge">!</i>' : '',
  };
  $('#dock-tabs').innerHTML = TABS.map(([k, label]) => `<button data-tab="${k}" class="${ui.tab === k ? 'on' : ''}" aria-pressed="${ui.tab === k}">${label}${badge[k]}</button>`).join('');
  document.querySelectorAll('.side .sheet[data-panel]').forEach((el) => el.classList.toggle('active', el.dataset.panel === ui.tab));
}

// ミッション進捗: 自分の本物の工作員の状況と、相手の危険な動き（公開情報）
function renderMission() {
  const box = $('#mission');
  const s = state;
  const v = viewer();
  if (s.status !== 'playing' || v < 0 || s.players[v].out) { box.innerHTML = ''; return; }
  const me = s.players[v];
  const ace = s.agents.find((a) => a.id === s.aces[v]);
  const real = ace ? ace.files.filter((f) => G.knownFile(s, v, f) === true).length : 0;
  const dist = ace ? G.DIST[ace.city][me.base] : 0;
  const pips = '●'.repeat(Math.min(real, G.RULES.filesToWin)) + '○'.repeat(Math.max(0, G.RULES.filesToWin - real));
  let html = `<span class="m-item">${A.aceSVG()}本物は<b>${ace ? ace.label : '-'}</b>${ace ? `（${esc(cityPt(ace.city).name)}）` : ''}</span>`
    + `<span class="m-item">本物ファイル <b class="pips">${pips}</b></span>`
    + `<span class="m-item">拠点まで <b>${dist}</b>マス</span>`;
  // 相手の要注意工作員: ファイル2つを抱えて拠点の近くにいる
  const danger = s.agents.filter((a) => a.owner !== v && a.city && a.files.length >= G.RULES.filesToWin
    && G.DIST[a.city][s.players[a.owner].base] <= 2 && !s.players[a.owner].out);
  for (const a of danger.slice(0, 2)) {
    const d = G.DIST[a.city][s.players[a.owner].base];
    html += `<button class="m-warn" data-warn="${a.id}">⚠ ${esc(s.players[a.owner].name)}の${a.label}がファイル${a.files.length}つ・拠点まで${d}</button>`;
  }
  box.innerHTML = html;
}

function renderBanner() {
  const t = state.turn;
  const p = state.players[t.player];
  const v = viewer();
  let html;
  if (state.status === 'finished') {
    html = '<b>作戦終了</b>';
  } else {
    const phaseM = t.phase === 'draw' ? '① 引く' : `② 行動 ${'●'.repeat(t.actionsLeft)}${'○'.repeat(Math.max(0, G.RULES.actionsPerTurn - t.actionsLeft))}`;
    html = `<span class="round">ROUND ${t.round}/${G.RULES.maxRounds}</span>${A.agentSVG(p.color)}<b class="pname">${esc(p.name)}</b><span class="who-suffix">の作戦行動</span>${myTurn() ? ' <span class="you">あなたの番</span>' : ''}<span class="phase-m">${phaseM}</span>`;
  }
  $('#turn-banner').innerHTML = html;

  const steps = $('#steps');
  if (state.status !== 'playing') { steps.innerHTML = ''; return; }
  const ph = t.phase;
  const pips = '●'.repeat(t.actionsLeft) + '○'.repeat(Math.max(0, G.RULES.actionsPerTurn - t.actionsLeft));
  steps.innerHTML = `<li class="${ph === 'draw' ? 'now' : 'done'}">① カードを引く</li>`
    + `<li class="${ph === 'action' ? 'now' : ''}">② 行動 <span class="pips">${ph === 'action' ? pips : '●●'}</span></li>`
    + '<li>③ ターン終了</li>';
  $('#btn-end').disabled = !actionPhase();
  void v;
}

function renderCoach() {
  const c = $('#coach');
  const v = viewer();
  let iconName = 'eye';
  let html = '';
  let cls = '';
  const s = state;
  if (s.status === 'finished') {
    iconName = 'flag';
    html = '<b>作戦終了。</b><div class="coach-sub">盤面で全員の正体とファイルの中身を確認できます。</div>';
    cls = 'win';
  } else if (!myTurn()) {
    const p = s.players[s.turn.player];
    cls = 'wait';
    iconName = isCpuTurn() ? 'cpu' : 'person';
    const fast = game.kind === 'local' && game.cpuDelay < 500;
    html = isCpuTurn()
      ? `<b>${esc(p.name)}</b>（CPU）が作戦中… <div class="coach-sub">動きは地図の矢印と作戦ログで確認できます。</div><button data-coach="speed" class="small">${fast ? 'ふつうの速さ' : '早送り ≫'}</button>`
      : `<b>${esc(p.name)}</b>の番です。待機中…<div class="coach-sub">相手の動きから、どれが本物かを推理しよう。</div>`;
  } else if (s.turn.phase === 'draw') {
    iconName = 'market';
    html = `<b>① カードを1枚引こう。</b><div class="coach-sub">${isMobile() ? '下の「本部」' : '右の作戦本部'}の表向きのカードから選ぶか、山札から引きます（山札は何が出るかわからない）。</div>`;
  } else if (ui.flow) {
    const { step } = flowCandidates();
    iconName = 'cards';
    html = `<b>【${esc(G.CARDS[ui.flow.type].name)}】</b>${step ? step.prompt : ''}<div class="coach-sub">効果: ${esc(G.CARDS[ui.flow.type].desc)}</div>`;
    html += '<button data-coach="cancel" class="small">やめる</button>';
  } else {
    const left = s.turn.actionsLeft;
    const sel = ui.agent && s.agents.find((a) => a.id === ui.agent);
    const myAce = s.agents.find((a) => a.id === s.aces[v]);
    const aceReal = myAce ? myAce.files.filter((f) => G.knownFile(s, v, f) === true).length : 0;
    iconName = 'move';
    if (aceReal >= G.RULES.filesToWin) {
      html = `<b>本物の工作員が本物のファイルを${G.RULES.filesToWin}つ持っています！</b> 拠点に戻れば勝利！`;
      cls = 'win';
    } else if (sel && sel.owner === v) {
      html = `<b>② 行動（あと${left}回）</b> 光る都市をタップで移動。<div class="coach-sub">移動・偵察・潜入などは${isMobile() ? '下の「行動」タブ' : '右の「行動・選択中」'}から。カードは「手札」から。</div>`;
    } else {
      html = `<b>② 行動（あと${left}回）</b> まず<b>自分の工作員</b>（自分の色の肖像の札）をタップ。<div class="coach-sub">★が本物、仮面が囮。正体は自分にしか見えません。</div>`;
    }
    html += '<button data-coach="end" class="small">ターン終了</button>';
  }
  c.className = `coach ${cls}`;
  c.innerHTML = `${A.icon(iconName)}<div class="coach-text">${html.replace(/<button[\s\S]*$/, '')}</div>${(html.match(/<button[\s\S]*$/) || [''])[0]}`;
}

function renderLegend() {
  $('#legend').innerHTML = [
    `<span>${A.svgTiny(A.aceBadge(0, 0, 6.5), '-9 -9 18 18')}本物</span>`,
    `<span>${A.svgTiny(A.decoyBadge(0, 0, 6.5), '-9 -9 18 18')}囮</span>`,
    `<span>${A.folderSVG('unknown')}ファイル（中身不明）</span>`,
    `<span>${A.folderSVG('real')}本物</span>`,
    `<span>${A.folderSVG('fake')}偽</span>`,
    `<span>${A.trapSVG('#555')}罠</span>`,
    `<span>${A.svgTiny('<circle r="8" fill="#6a1b9a"/><text y="4" text-anchor="middle" font-size="11" font-weight="900" fill="#fff">?</text>', '-9 -9 18 18')}罠があるかも</span>`,
  ].join('');
}

// ---------- 盤面 ----------

function curve(a, b, bend = 0.12) {
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return { cx: mx - dy * bend, cy: my + dx * bend };
}

const WRAP_ENDS = {
  'tokyo-ny': [[1000, 150], [0, 115]],
  'sydney-rio': [[1000, 440], [0, 425]],
};

function renderBoard() {
  const v = viewer();
  const s = state;
  const out = [];
  const fresh = Date.now() < ui.freshUntil;

  out.push(`<defs><pattern id="grid" width="50" height="50" patternUnits="userSpaceOnUse"><path d="M50 0 H0 V50" fill="none" stroke="#335357" stroke-width="1"/></pattern></defs>
    <rect width="1000" height="480" fill="#172e34"/><rect width="1000" height="480" fill="url(#grid)" opacity=".7"/>`);
  for (const d of A.CONTINENTS) out.push(`<path d="${d}" fill="#526b68" stroke="#8c9e8f" stroke-width=".65" fill-rule="evenodd"/>`);
  out.push(A.compassSVG(52, 418));
  out.push(`<g transform="translate(16 16)"><rect width="196" height="40" fill="#fbf6e9" stroke="#2b2620" stroke-width="1.5"/><text x="98" y="17" text-anchor="middle" font-size="11" font-family="'Special Elite', monospace" fill="#2b2620">WORLD OPERATIONS MAP</text><text x="98" y="33" text-anchor="middle" font-size="12" font-weight="700" fill="#b3261e">作戦地図 — 極秘</text></g>`);

  out.push('<text x="22" y="469" font-size="10" fill="#bbc9c2">海岸線：Natural Earth ／ 都市の駒は視認性のため位置を調整</text>');
  for (const c of G.CITIES) {
    const x = (c.longitude + 180) * 1000 / 360, y = (85 - c.latitude) * 3.1;
    out.push(`<path d="M${x} ${y} L${c.x} ${c.y}" stroke="#abb9a6" stroke-width=".8" opacity=".7"/><circle cx="${x}" cy="${y}" r="2" fill="#edcf96"/>`);
  }
  // 航路
  for (const [a, b, wrap] of G.EDGES) {
    const A1 = G.cityById[a];
    const B1 = G.cityById[b];
    if (wrap) {
      const [[ex1, ey1], [ex2, ey2]] = WRAP_ENDS[`${a}-${b}`];
      for (const [P, ex, ey] of [[A1, ex1, ey1], [B1, ex2, ey2]]) {
        out.push(`<line x1="${P.x}" y1="${P.y}" x2="${ex}" y2="${ey}" class="route-under"/><line x1="${P.x}" y1="${P.y}" x2="${ex}" y2="${ey}" class="route"/>`);
      }
      out.push(`<text x="${ex1 - 6}" y="${ey1 + 18}" text-anchor="end" class="route-label">太平洋航路 →</text><text x="${ex2 + 6}" y="${ey2 + 18}" class="route-label">← 太平洋航路</text>`);
    } else {
      const { cx, cy } = curve(A1, B1, 0.08);
      const d = `M${A1.x} ${A1.y} Q${cx} ${cy} ${B1.x} ${B1.y}`;
      out.push(`<path d="${d}" class="route-under"/><path d="${d}" class="route"/>`);
    }
  }

  // 直前の移動を矢印で表示
  const L = s.last;
  if (L && L.type === 'move') {
    const ag = s.agents.find((x) => x.id === L.agent);
    const color = ag ? s.players[ag.owner].color : '#000';
    const A1 = G.cityById[L.from];
    const B1 = G.cityById[L.to];
    const wrap = !G.neighbors(L.from).includes(L.to) || G.EDGES.some(([x, y, w]) => w && ((x === L.from && y === L.to) || (y === L.from && x === L.to)));
    if (!wrap || L.extract) {
      const { cx, cy } = curve(A1, B1, L.extract ? 0.25 : 0.08);
      const ang = Math.atan2(B1.y - cy, B1.x - cx);
      const tx = B1.x - Math.cos(ang) * 20;
      const ty = B1.y - Math.sin(ang) * 20;
      out.push(`<path d="M${A1.x} ${A1.y} Q${cx} ${cy} ${tx} ${ty}" class="last-arrow" stroke="${color}"/>`);
      const p1 = `${tx + Math.cos(ang) * 10},${ty + Math.sin(ang) * 10}`;
      const p2 = `${tx + Math.cos(ang + 2.4) * 10},${ty + Math.sin(ang + 2.4) * 10}`;
      const p3 = `${tx + Math.cos(ang - 2.4) * 10},${ty + Math.sin(ang - 2.4) * 10}`;
      out.push(`<polygon points="${p1} ${p2} ${p3}" fill="${color}" stroke="#2b2620" stroke-width="1"/>`);
    }
  }

  // 選択中の工作員が動ける都市・カードの対象
  const sel = ui.agent && s.agents.find((a) => a.id === ui.agent);
  const reachable = new Set(sel && sel.owner === v && actionPhase() && !ui.flow ? G.neighbors(sel.city) : []);
  const { step, ids: cands } = flowCandidates();
  const cityPick = step && step.kind === 'city' ? cands : new Set();
  const hints = G.trapHints(s, v);
  const myTraps = G.visibleTraps(s, v);

  for (const c of G.CITIES) {
    const owner = s.players.find((p) => p.base === c.id);
    const g = [`<circle cx="${c.x}" cy="${c.y}" r="30" fill="#000" fill-opacity="0"/>`];
    if (reachable.has(c.id)) g.push(`<circle cx="${c.x}" cy="${c.y}" r="25" class="reach"/>`);
    if (cityPick.has(c.id)) g.push(`<circle cx="${c.x}" cy="${c.y}" r="26" class="pick"/>`);
    if (owner) {
      g.push(`<g transform="translate(${c.x} ${c.y + 2}) scale(1.05)" opacity="${owner.out ? 0.4 : 1}">${A.baseShape(owner.color)}</g>`);
    } else {
      g.push(`<circle cx="${c.x}" cy="${c.y}" r="11" class="pin"/><circle cx="${c.x}" cy="${c.y}" r="3.6" class="pin-dot"/>`);
    }
    // 都市名の札
    const label = c.name;
    const w = label.length * 13 + 16;
    const ty = c.y + (owner ? 22 : 18);
    g.push(`<g class="city-tag"><rect x="${c.x - w / 2}" y="${ty}" width="${w}" height="19" rx="2"/>${owner ? `<rect x="${c.x - w / 2}" y="${ty}" width="6" height="19" fill="${owner.color}"/>` : ''}<text x="${c.x + (owner ? 3 : 0)}" y="${ty + 14}">${esc(label)}</text></g>`);
    // 置かれているファイル
    const files = s.cityFiles[c.id];
    files.slice(0, 3).forEach((f, j) => {
      const k = G.knownFile(s, v, f);
      g.push(`<g transform="translate(${c.x + 13 + j * 6} ${c.y - 8 - j * 3})">${A.folderShape(k === true ? 'real' : k === false ? 'fake' : 'unknown', 26)}</g>`);
    });
    if (files.length > 1) g.push(`<g><circle cx="${c.x + 46}" cy="${c.y - 6}" r="8" fill="#2b2620"/><text x="${c.x + 46}" y="${c.y - 2}" text-anchor="middle" font-size="11" font-weight="900" fill="#fbf6e9">${files.length}</text></g>`);
    // 見えている罠
    myTraps.filter((t) => t.city === c.id).forEach((t, j) => {
      g.push(`<g transform="translate(${c.x - 28 - j * 10} ${c.y + 8})">${A.trapShape(s.players[t.owner].color)}</g>`);
    });
    // 罠の気配
    hints.filter((h) => h.cities.includes(c.id)).forEach((h, j) => {
      const hx = c.x - w / 2 - 10 - j * 15;
      const hy = ty + 10;
      g.push(`<g class="hint-q"><title>${esc(s.players[h.owner].name)}の罠があるかもしれない</title><circle cx="${hx}" cy="${hy}" r="7.5" fill="${s.players[h.owner].color}" stroke="#2b2620" stroke-width="1"/><text x="${hx}" y="${hy + 4}">?</text></g>`);
    });
    out.push(`<g class="city${ui.city === c.id ? ' focus' : ''}" data-city="${c.id}"><title>${esc(c.name)}${owner ? `（${esc(owner.name)}の拠点）` : ''}</title>${g.join('')}</g>`);
  }

  // 罠・拘束・奪取の演出
  if (fresh && L && (L.type === 'trap' || (L.type === 'card' && (L.card === 'arrest' || L.card === 'steal'))) && L.city) {
    const c = G.cityById[L.city];
    const pts = [];
    for (let i = 0; i < 16; i++) {
      const a = (i * Math.PI) / 8;
      const r = i % 2 ? 18 : 40;
      pts.push(`${(c.x + r * Math.cos(a)).toFixed(1)},${(c.y + r * Math.sin(a)).toFixed(1)}`);
    }
    out.push(`<polygon points="${pts.join(' ')}" fill="#ffd54f" stroke="#b3261e" stroke-width="3" class="burst"/>`);
  }

  // 工作員
  const byCity = {};
  for (const a of s.agents) if (a.city) (byCity[a.city] ||= []).push(a);
  const agentCands = step && (step.kind === 'own' || step.kind === 'enemy') ? cands : new Set();
  for (const [cityId, list] of Object.entries(byCity)) {
    const c = G.cityById[cityId];
    list.sort((x, y) => (x.owner === v ? -1 : 0) - (y.owner === v ? -1 : 0) || x.owner - y.owner || x.label.localeCompare(y.label));
    const k = list.length;
    list.forEach((a, i) => {
      const ring = i < 5 ? 0 : 1;
      const inRing = ring === 0 ? Math.min(k, 5) : k - 5;
      const idx = ring === 0 ? i : i - 5;
      const r = ring === 0 ? 40 : 66;
      const ang = inRing === 1 ? -Math.PI / 2 : (-150 + (120 * idx) / (inRing - 1)) * (Math.PI / 180);
      const x = c.x + r * Math.cos(ang);
      const y = c.y + r * Math.sin(ang) * 0.9 - 4;
      const pl = s.players[a.owner];
      const ident = G.knownIdentity(s, v, a.id);
      const cls = ['agent'];
      if (ui.agent === a.id) cls.push('sel');
      if (agentCands.has(a.id)) cls.push('cand');
      if (fresh && L && L.agent === a.id && L.type === 'move') cls.push('moved');
      // 指でタップしやすいよう、見えない当たり判定を広めに取る
      const parts = ['<rect x="-19" y="-30" width="38" height="56" fill="#000" fill-opacity="0"/>'];
      if (ui.agent === a.id || agentCands.has(a.id)) parts.push('<ellipse cx="0" cy="20" rx="16" ry="6" class="glow"/>');
      parts.push(`<g class="fig" transform="scale(1.25)">${A.agentShape(pl.color, a.label)}</g>`);
      if (ident === 'ace') parts.push(A.aceBadge(13, -24, 6.2));
      if (ident === 'decoy') parts.push(A.decoyBadge(13, -24, 6.2));
      a.files.forEach((f, j) => {
        const kf = G.knownFile(s, v, f);
        parts.push(`<g transform="translate(${-26 + j * 4} ${2 - j * 3})">${A.folderShape(kf === true ? 'real' : kf === false ? 'fake' : 'unknown', 18)}</g>`);
      });
      const title = `${pl.name}の${a.label}${ident === 'ace' ? '（本物）' : ident === 'decoy' ? '（囮）' : ''}・ファイル${a.files.length}`;
      // 位置は外側の g の transform 属性、アニメーションは内側の g（CSS の transform が位置を上書きしないように）
      out.push(`<g class="${cls.join(' ')}" data-agent="${a.id}" transform="translate(${x.toFixed(1)} ${y.toFixed(1)})"><title>${esc(title)}</title><g class="bob">${parts.join('')}</g></g>`);
    });
  }

  $('#board').innerHTML = out.join('');
}

// ---------- サイドパネル ----------

function cardButton(type, attrs, { extraClass = '', disabled = false, desc = true } = {}) {
  const def = G.CARDS[type];
  return `<button class="card ${extraClass}" ${attrs} ${disabled ? 'disabled' : ''} title="${esc(def.desc)}">
    ${A.cardArtSVG(type)}<b>${esc(def.name)}</b><small>${esc(def.short)}</small>${desc ? `<small class="card-desc">${esc(def.desc)}</small>` : ''}</button>`;
}

function renderMarket() {
  const s = state;
  const canDraw = myTurn() && s.turn.phase === 'draw';
  const deckCount = s.deck.length + s.discard.length;
  const html = s.market.map((type, i) => cardButton(type, `data-draw="${i}"`, { extraClass: canDraw ? 'pickable' : '', disabled: !canDraw, desc: false })).join('')
    + `<button class="deck-btn ${canDraw ? 'card pickable' : 'card'}" data-draw="deck" ${canDraw && deckCount ? '' : 'disabled'}>${A.cardBackSVG()}<span>山札 ${s.deck.length}枚</span></button>`;
  $('#market').innerHTML = html;
}

function renderHand() {
  const v = viewer();
  const box = $('#hand');
  if (v < 0) { box.innerHTML = ''; $('#hand-count').textContent = ''; return; }
  const hand = state.hands[v];
  $('#hand-count').textContent = `${hand.length}/${G.RULES.handLimit}枚`;
  const legal = actionPhase() ? G.legalActions(state, v) : [];
  if (!hand.length) { box.innerHTML = '<span class="muted empty">手札はありません。作戦本部からカードを引こう。</span>'; return; }
  box.innerHTML = hand.map((type, i) => {
    const usable = legal.some((a) => a.type === 'card' && hand[a.card] === type);
    const active = ui.flow && ui.flow.type === type && hand.indexOf(type) === i;
    return cardButton(type, `data-card="${i}"`, { extraClass: active ? 'active' : '', disabled: !usable });
  }).join('');
}

function fileTag(fileId) {
  const k = G.knownFile(state, viewer(), fileId);
  const kind = k === true ? 'real' : k === false ? 'fake' : 'unknown';
  const label = k === true ? '本物' : k === false ? '偽' : '不明';
  return `<span class="ftag">${A.folderSVG(kind)}#${fileId.slice(1)} ${label}</span>`;
}

function myAgentList() {
  const s = state;
  const v = viewer();
  const mine = s.agents.filter((a) => a.owner === v && a.city);
  return `<div class="my-agents">${mine.map((a) => {
    const ident = G.knownIdentity(s, v, a.id);
    const realN = a.files.filter((f) => G.knownFile(s, v, f) === true).length;
    return `<button data-act="select" data-agent="${a.id}" class="agent-pick">${A.agentSVG(s.players[v].color, a.label)}
      <span class="ap-main"><b>${a.label}</b>${ident === 'ace' ? `${A.aceSVG()}<span class="ap-ace">本物</span>` : `${A.decoySVG()}<span>囮</span>`}</span>
      <span class="ap-sub">${esc(cityPt(a.city).name)}・ファイル${a.files.length}${realN ? `（本物${realN}）` : ''}</span></button>`;
  }).join('')}</div>`;
}

function renderSelection() {
  const box = $('#selection');
  const v = viewer();
  const s = state;
  const a = ui.agent && s.agents.find((x) => x.id === ui.agent);
  const cityId = a ? a.city : ui.city;
  if (!cityId) {
    const lead = actionPhase()
      ? '<p class="sel-lead">動かす<b>自分の工作員</b>を選んでください（地図の駒をタップしてもOK）。</p>'
      : '<p class="sel-lead muted">地図の工作員や都市をタップすると、詳しい情報が出ます。</p>';
    box.innerHTML = v >= 0 && !s.players[v].out ? lead + myAgentList() : lead;
    return;
  }
  const city = G.cityById[cityId];
  let html = '';
  if (a) {
    const pl = s.players[a.owner];
    const ident = G.knownIdentity(s, v, a.id);
    const identHtml = ident === 'ace' ? `${A.aceSVG()}本物（エース）` : ident === 'decoy' ? `${A.decoySVG()}囮` : `${A.icon('question')}正体不明`;
    html += `<div class="sel-head">${A.agentSVG(pl.color, a.label)}<div><div class="who">${esc(pl.name)}の${a.label}</div><div class="ident">${identHtml}</div><div class="muted">現在地: ${esc(city.name)}</div></div>
      ${a.owner === v ? '<button data-act="deselect" class="small sel-back">← 一覧</button>' : ''}</div>`;
    html += `<div class="sel-files">所持ファイル: ${a.files.length ? a.files.map(fileTag).join('') : 'なし'}</div>`;
    if (a.owner === v && actionPhase() && !ui.flow) {
      // 移動先（罠の気配・判明している罠も表示）
      const hints = G.trapHints(s, v);
      const known = G.visibleTraps(s, v).filter((t) => t.owner !== v);
      const moves = G.neighbors(a.city).map((to) => {
        const danger = known.some((t) => t.city === to) ? '<i class="warn">罠!</i>' : hints.some((h) => h.cities.includes(to)) ? '<i class="warn soft">罠?</i>' : '';
        const files = s.cityFiles[to].length ? `<i class="mv-file">${A.folderSVG('unknown')}${s.cityFiles[to].length}</i>` : '';
        const home = to === s.players[v].base ? '<i class="mv-home">拠点</i>' : '';
        return `<button data-act="move" data-agent="${a.id}" data-to="${to}">${A.icon('move')}${esc(G.cityById[to].name)}へ${home}${files}${danger}</button>`;
      });
      html += `<div class="act-group"><div class="act-label">移動（1行動）</div><div class="actions">${moves.join('')}</div></div>`;
      const btns = [];
      const full = a.files.length >= G.RULES.carryLimit;
      for (const f of s.cityFiles[cityId]) {
        if (G.knownFile(s, v, f) === null) btns.push(`<button data-act="scout" data-agent="${a.id}" data-file="${f}" title="取らずに中身だけ見る">${A.icon('scout')}偵察 #${f.slice(1)}</button>`);
        btns.push(`<button data-act="infiltrate" data-agent="${a.id}" data-file="${f}" ${full ? 'disabled title="2つまでしか持てません"' : 'title="ファイルを取る（中身もわかる）"'}>${A.icon('infiltrate')}潜入 ${fileTag(f)}</button>`);
      }
      const mates = s.agents.filter((b) => b.owner === v && b.id !== a.id && b.city === cityId);
      for (const f of a.files) {
        btns.push(`<button data-act="drop" data-agent="${a.id}" data-file="${f}">${A.icon('drop')}置く #${f.slice(1)}</button>`);
        for (const b of mates) {
          const bfull = b.files.length >= G.RULES.carryLimit;
          btns.push(`<button data-act="transfer" data-agent="${a.id}" data-to="${b.id}" data-file="${f}" ${bfull ? 'disabled' : ''}>${A.icon('transfer')}#${f.slice(1)}を${b.label}へ渡す</button>`);
        }
      }
      if (btns.length) html += `<div class="act-group"><div class="act-label">${esc(city.name)}で（1行動）</div><div class="actions">${btns.join('')}</div></div>`;
      html += '<div class="sel-sub">地図の光っている都市をタップしても移動できます。カードは「手札」から。</div>';
    }
  } else {
    html += `<div class="sel-head">${A.icon('globe')}<div class="who">${esc(city.name)}</div></div>`;
  }
  const files = s.cityFiles[cityId];
  html += `<div class="sel-files">${esc(city.name)}のファイル: ${files.length ? files.map(fileTag).join('') : 'なし'}</div>`;
  const hint = G.trapHints(s, v).filter((h) => h.cities.includes(cityId));
  if (hint.length) html += `<div class="sel-sub">⚠ ${hint.map((h) => esc(s.players[h.owner].name)).join('・')}の罠があるかもしれない都市です。</div>`;
  const here = s.agents.filter((x) => x.city === cityId);
  if (here.length) {
    html += `<div class="chips">${here.map((x) => `<button data-act="select" data-agent="${x.id}">${A.agentSVG(s.players[x.owner].color)}${esc(s.players[x.owner].name)}の${x.label}</button>`).join('')}</div>`;
  }
  box.innerHTML = html;
}

function renderPlayers() {
  const ul = $('#players');
  const v = viewer();
  const s = state;
  const { step, ids } = flowCandidates();
  ul.innerHTML = s.players.map((p, i) => {
    const cls = [];
    if (s.status === 'playing' && s.turn.player === i) cls.push('turn');
    if (p.out) cls.push('out');
    if (step && step.kind === 'player' && ids.has(i)) cls.push('pickable');
    const carried = s.agents.filter((a) => a.owner === i && a.city).reduce((n, a) => n + a.files.length, 0);
    const off = game.kind === 'online' && !p.out && !game.isOnline(i);
    const tags = [];
    if (i === v) tags.push('<span class="tag me">あなた</span>');
    if (p.cpu) tags.push(`<span class="tag">CPU・${esc(LEVELS[p.cpu] ? LEVELS[p.cpu].name : '')}</span>`);
    if (off) tags.push('<span class="tag off">切断</span>');
    return `<li data-player="${i}" class="${cls.join(' ')}">${A.agentSVG(p.color)}<span class="pname">${esc(p.name)}</span>${tags.join('')}
      <span class="stats"><span title="手札">${A.icon('cards')}${s.hands[i].length}</span><span title="運んでいるファイル">${A.folderSVG('unknown')}${carried}</span><span title="置いている罠">${A.trapSVG('#555')}${G.trapCount(s, i)}</span></span></li>`;
  }).join('');
}

function renderLog() {
  const v = viewer();
  const ol = $('#log');
  const entries = state.log.filter((l) => l.to === undefined || l.to === v).slice(-60).reverse();
  ol.innerHTML = entries.map((l) => {
    const cls = [];
    if (l.text.startsWith('—')) cls.push('turn-line');
    if (l.to !== undefined) cls.push('private');
    if (l.n > ui.prevSeq && ui.prevSeq >= 0) cls.push('fresh');
    return `<li class="${cls.join(' ')}">${l.to !== undefined ? A.icon('lock') : ''}<span>${esc(l.text)}</span></li>`;
  }).join('');
}

function renderResult() {
  const s = state;
  const w = s.winner;
  const v = viewer();
  const names = w.players.map((i) => s.players[i].name);
  const iWon = w.players.includes(v);
  $('#result-stamp').innerHTML = A.stampSVG(w.byScore ? '作戦終了' : '任務完了', w.byScore ? '#2b2620' : '#b3261e');
  $('#result-art').innerHTML = w.players.map((i) => A.agentSVG(s.players[i].color)).join('');
  $('#result-title').textContent = `${names.join('、')}の勝利！${iWon && (game.kind === 'online' || game.humans.length === 1) ? '（あなたの勝ち）' : ''}`;
  $('#result-reason').textContent = w.reason;
  $('#btn-result-again').hidden = !(game.kind === 'local' && lastSetup);
}

// ---------- 遊び方 ----------

const RULE_PAGES = [
  {
    title: 'ミッション',
    art: () => A.tutorialArt('goal'),
    html: '<p><b>本物の工作員</b>に、<b>本物の機密ファイル</b>を<b>2つ</b>持たせて、自分の<b>拠点</b>（HQのマーク）に戻れば勝ちです。</p><p>2〜6人で遊べます。15ラウンドたっても決着しないときは、本物のファイルをいちばん多く持っている人の勝ちです。</p>',
  },
  {
    title: '3人のうち、本物は1人',
    art: () => A.tutorialArt('identity'),
    html: '<p>工作員は1人につき3人（A・B・C）。そのうち<b>1人だけが本物</b>（★）で、2人は<b>囮</b>（仮面）です。</p><p>正体は<b>自分にしか見えません</b>。相手から見ると、全員同じ肖像のコマです。囮も上手に動かして、相手を惑わせましょう。</p>',
  },
  {
    title: 'ファイルは本物？ 偽物？',
    art: () => A.tutorialArt('files'),
    html: '<ul><li>都市にはフォルダーが伏せて置いてあります。中身は<b>本物</b>か<b>偽情報</b>。</li><li><b>偵察</b>: ファイルを取らずに中身だけ見る（1行動）。</li><li><b>潜入</b>: ファイルを取る（1行動）。1人が持てるのは2つまで。</li><li>偽物は<b>置く</b>、本物は同じ都市の仲間に<b>渡す</b>こともできます。</li></ul>',
  },
  {
    title: '手番の流れ',
    art: () => A.tutorialArt('turn'),
    html: '<ol><li><b>カードを1枚引く</b>: 作戦本部（表向きの3枚）から選ぶか、山札から引く。何を取るかで作戦が変わります。</li><li><b>行動を2回</b>: 移動（線でつながった隣の都市へ）・偵察・潜入・置く・渡す・カードを使う。</li><li><b>ターン終了</b>。行動を使い切ると自動で次の人へ。</li></ol><p class="muted">先手は最初の手番だけ行動が1回です。</p>',
  },
  {
    title: 'カード',
    art: () => '',
    html: () => `<div class="card-grid">${G.CARD_TYPES.map((t) => `<div class="card">${A.cardArtSVG(t)}<b>${esc(G.CARDS[t].name)}</b><small>${esc(G.CARDS[t].desc)}</small></div>`).join('')}</div>`,
  },
  {
    title: '罠と読み合い',
    art: () => A.tutorialArt('trap'),
    html: '<ul><li>罠を置くと、場所は秘密ですが「<b>この工作員のまわりのどこか</b>」だけは全員にわかります。地図には<b>？マーク</b>で表示されます。</li><li>本物がファイルを運ぶルートに罠があるかも…？ 盗聴すれば罠の場所がわかります。</li><li>相手が<b>偵察したのに取らなかった</b>ファイルは偽物かも。<b>2つ抱えて拠点に向かう</b>工作員は本物かも。ログを読んで推理しよう。</li></ul>',
  },
];
let rulesPage = 0;

function bindRules() {
  $('#rules-prev').onclick = () => openRules(rulesPage - 1);
  $('#rules-next').onclick = () => {
    if (rulesPage >= RULE_PAGES.length - 1) $('#rules').close();
    else openRules(rulesPage + 1);
  };
}

function openRules(page) {
  rulesPage = Math.max(0, Math.min(RULE_PAGES.length - 1, page));
  const p = RULE_PAGES[rulesPage];
  const html = typeof p.html === 'function' ? p.html() : p.html;
  $('#rules-body').innerHTML = `<h2>${rulesPage + 1}. ${esc(p.title)}</h2>${p.art()}${html}`;
  $('#rules-dots').innerHTML = RULE_PAGES.map((_, i) => `<li class="${i === rulesPage ? 'on' : ''}"></li>`).join('');
  $('#rules-prev').disabled = rulesPage === 0;
  $('#rules-next').textContent = rulesPage === RULE_PAGES.length - 1 ? 'とじる' : '次へ →';
  const d = $('#rules');
  if (!d.open) d.showModal();
}

// 動作確認用（URL に ?debug を付けたときだけ）
if (new URLSearchParams(location.search).has('debug')) {
  window.__beppan = {
    get game() { return game; }, get state() { return state; }, G, chooseAction,
  };
}

init();
