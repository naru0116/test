// マッチング（ランダムマッチ・ルーム）とオンライン対戦の進行管理

import { createGame, applyAction, forfeit, RuleError } from './game.js';
import { chooseAction } from './cpu.js';

export const PUBLIC_WAIT_MS = 40_000; // ランダムマッチ: この時間が過ぎたら2人以上で開始
const POINTER_TTL = 3 * 60_000;
const STALE_JOIN_MS = 10_000;
const ABSENT_MS = 25_000; // 切断からこの時間で離脱扱い

const ID_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export function genId(len = 6) {
  let s = '';
  const buf = new Uint32Array(len);
  crypto.getRandomValues(buf);
  for (const v of buf) s += ID_CHARS[v % ID_CHARS.length];
  return s;
}

export function normalizeRoomId(s) {
  return String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

// 参加者のうち接続中の人（入室直後の人は猶予）
export function activeMembers(room, now) {
  const players = (room && room.meta && room.meta.players) || {};
  const presence = (room && room.presence) || {};
  return Object.entries(players)
    .filter(([uid, p]) => presence[uid] || now - p.joinedAt < STALE_JOIN_MS)
    .sort((a, b) => a[1].joinedAt - b[1].joinedAt || (a[0] < b[0] ? -1 : 1))
    .map(([uid, p]) => ({ id: uid, name: p.name, joinedAt: p.joinedAt }));
}

export class Lobby {
  constructor(db, uid) {
    this.db = db;
    this.uid = uid;
  }

  // 部屋に参加する。create=true なら存在しない場合に作成する。
  async join(roomId, name, { create = false, capacity = 4, isPublic = false } = {}) {
    const uid = this.uid;
    const now = this.db.now();
    let reason = '';
    const res = await this.db.transaction(`rooms/${roomId}`, (room) => {
      if (!room || !room.meta) {
        if (!create) { reason = 'ルームが見つかりません'; return null; }
        return {
          meta: {
            capacity, isPublic, status: 'waiting', createdAt: now, host: uid,
            players: { [uid]: { name, joinedAt: now } },
          },
        };
      }
      const meta = room.meta;
      meta.players = meta.players || {};
      if (meta.players[uid]) return room; // 再参加
      if (meta.status !== 'waiting') { reason = 'このルームはすでに対戦が始まっています'; return undefined; }
      // 接続が切れている待機者を整理
      const active = new Set(activeMembers(room, now).map((m) => m.id));
      for (const u of Object.keys(meta.players)) if (!active.has(u)) delete meta.players[u];
      if (Object.keys(meta.players).length >= meta.capacity) { reason = 'ルームが満員です'; return undefined; }
      meta.players[uid] = { name, joinedAt: now };
      if (!active.has(meta.host)) meta.host = uid;
      return room;
    });
    const ok = res.committed && res.value && res.value.meta && res.value.meta.players && res.value.meta.players[uid];
    if (!ok) throw new Error(reason || '参加できませんでした');
    return roomId;
  }

  async quickMatch(name, capacity) {
    let skip = null;
    for (let attempt = 0; attempt < 8; attempt++) {
      const fresh = genId();
      const now = this.db.now();
      const ptr = await this.db.transaction(`match/${capacity}`, (cur) => {
        if (cur && cur.roomId && cur.roomId !== skip && now - cur.createdAt < POINTER_TTL) return cur;
        return { roomId: fresh, createdAt: now };
      });
      const roomId = ptr.value.roomId;
      try {
        return await this.join(roomId, name, { create: true, capacity, isPublic: true });
      } catch {
        skip = roomId;
      }
    }
    throw new Error('マッチングに失敗しました。もう一度お試しください');
  }

  async createRoom(name, capacity) {
    for (let i = 0; i < 5; i++) {
      const id = genId();
      const existing = await this.db.get(`rooms/${id}/meta`);
      if (existing) continue;
      return this.join(id, name, { create: true, capacity, isPublic: false });
    }
    throw new Error('ルームを作成できませんでした');
  }

  async leave(roomId) {
    const uid = this.uid;
    await this.db.transaction(`rooms/${roomId}`, (room) => {
      if (!room || !room.meta) return null;
      if (room.meta.status !== 'waiting') return undefined;
      if (room.meta.players) delete room.meta.players[uid];
      if (room.presence) delete room.presence[uid];
      if (!room.meta.players || Object.keys(room.meta.players).length === 0) return null;
      if (room.meta.host === uid) room.meta.host = Object.keys(room.meta.players)[0];
      return room;
    });
  }

  async start(roomId) {
    const now = this.db.now();
    await this.db.transaction(`rooms/${roomId}`, (room) => {
      if (!room || !room.meta) return null;
      if (room.meta.status !== 'waiting') return undefined;
      const members = activeMembers(room, now).filter((m) => room.presence && room.presence[m.id]);
      if (members.length < 2) return undefined;
      const list = members.slice(0, room.meta.capacity);
      // 手番順はランダム
      for (let i = list.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [list[i], list[j]] = [list[j], list[i]];
      }
      room.meta.status = 'playing';
      room.meta.startedAt = now;
      room.state = JSON.stringify(createGame(list.map((m) => ({ id: m.id, name: m.name }))));
      return room;
    });
  }
}

// 待機室: 人数がそろう／時間切れで自動開始
export class WaitingRoom {
  constructor(db, lobby, roomId, onUpdate, onStart) {
    this.db = db;
    this.lobby = lobby;
    this.roomId = roomId;
    this.room = null;
    this.onUpdate = onUpdate;
    this.onStart = onStart;
    this.starting = false;
  }

  async open() {
    this.dropPresence = await this.db.setPresence(`rooms/${this.roomId}/presence/${this.lobby.uid}`);
    this.unsub = this.db.subscribe(`rooms/${this.roomId}`, (room) => {
      this.room = room;
      this.tick();
    });
    this.timer = setInterval(() => this.tick(), 1000);
  }

  info() {
    const room = this.room;
    if (!room || !room.meta) return null;
    const now = this.db.now();
    const members = activeMembers(room, now);
    const meta = room.meta;
    const remain = meta.isPublic ? Math.max(0, Math.ceil((meta.createdAt + PUBLIC_WAIT_MS - now) / 1000)) : null;
    return { meta, members, remain, isHost: meta.host === this.lobby.uid };
  }

  tick() {
    const room = this.room;
    if (!room || !room.meta) { this.onUpdate(null); return; }
    if (room.meta.status === 'playing' && room.state) {
      this.close(false);
      this.onStart(this.roomId);
      return;
    }
    const info = this.info();
    this.onUpdate(info);
    // 自動開始の判定は「接続を確認できた人」だけで数える（入室直後の人を取りこぼさないため）
    const presence = room.presence || {};
    const n = info.members.filter((m) => presence[m.id]).length;
    const full = n >= info.meta.capacity;
    const timeUp = info.meta.isPublic && info.remain === 0 && n >= 2;
    if ((full || timeUp) && !this.starting) {
      this.starting = true;
      this.lobby.start(this.roomId).catch(() => {}).finally(() => { this.starting = false; });
    }
  }

  startNow() { return this.lobby.start(this.roomId); }

  async close(leave = true) {
    clearInterval(this.timer);
    if (this.unsub) this.unsub();
    if (leave) {
      await this.lobby.leave(this.roomId).catch(() => {});
      if (this.dropPresence) await this.dropPresence();
    }
  }
}

// オンライン対戦のコントローラー（UI から使う）
export class OnlineGame {
  constructor(db, roomId, uid) {
    this.db = db;
    this.roomId = roomId;
    this.uid = uid;
    this.kind = 'online';
    this.state = null;
    this.presence = {};
    this.absentSince = {};
    this.listeners = new Set();
  }

  async open() {
    this.dropPresence = await this.db.setPresence(`rooms/${this.roomId}/presence/${this.uid}`);
    this.unsubState = this.db.subscribe(`rooms/${this.roomId}/state`, (s) => {
      if (!s) return;
      this.state = JSON.parse(s);
      this.emit();
    });
    this.unsubPresence = this.db.subscribe(`rooms/${this.roomId}/presence`, (p) => {
      this.presence = p || {};
      this.emit();
    });
    this.watchdog = setInterval(() => this.checkAbsent(), 3000);
  }

  emit() { if (this.state) for (const l of this.listeners) l(this.state); }
  onState(cb) { this.listeners.add(cb); if (this.state) cb(this.state); return () => this.listeners.delete(cb); }

  viewer() {
    if (!this.state) return -1;
    return this.state.players.findIndex((p) => p.id === this.uid);
  }

  isOnline(i) { return !!(this.state && this.presence[this.state.players[i].id]); }

  async mutate(fn) {
    let err = null;
    await this.db.transaction(`rooms/${this.roomId}/state`, (cur) => {
      if (cur == null) return null;
      try {
        return JSON.stringify(fn(JSON.parse(cur)));
      } catch (e) {
        err = e;
        return undefined;
      }
    });
    if (err) throw err;
  }

  act(action) {
    const me = this.viewer();
    return this.mutate((s) => applyAction(s, me, action));
  }

  // 切断したプレイヤーを一定時間後に離脱扱いにする（接続中で最も若い番号の人が担当）
  checkAbsent() {
    const s = this.state;
    if (!s || s.status !== 'playing') return;
    const now = Date.now();
    const me = this.viewer();
    const present = s.players.map((p, i) => i).filter((i) => !s.players[i].out && this.presence[s.players[i].id]);
    if (present[0] !== me) return;
    s.players.forEach((p, i) => {
      if (p.out || this.presence[p.id]) { delete this.absentSince[i]; return; }
      this.absentSince[i] ??= now;
      if (now - this.absentSince[i] > ABSENT_MS) {
        delete this.absentSince[i];
        this.mutate((st) => forfeit(st, i, '通信切断により離脱')).catch(() => {});
      }
    });
  }

  async close() {
    clearInterval(this.watchdog);
    if (this.unsubState) this.unsubState();
    if (this.unsubPresence) this.unsubPresence();
    if (this.dropPresence) await this.dropPresence();
  }
}

// 1台で遊ぶローカル対戦（CPU を混ぜられる）
// seats: [{ name, cpu: null | 'easy' | 'normal' | 'hard' }]
export class LocalGame {
  constructor(seats, { cpuDelay = 900 } = {}) {
    this.kind = 'local';
    this.state = createGame(seats.map((s, i) => ({ id: `local${i}`, name: s.name, cpu: s.cpu || null })));
    this.humans = this.state.players.map((p, i) => i).filter((i) => !this.state.players[i].cpu);
    this.lastHuman = this.humans[0] ?? -1;
    this.cpuDelay = cpuDelay;
    this.listeners = new Set();
    this.timer = null;
    this.closed = false;
    this.schedule();
  }

  onState(cb) { this.listeners.add(cb); cb(this.state); return () => this.listeners.delete(cb); }
  emit() { for (const l of this.listeners) l(this.state); }

  isCpu(i) { return !!this.state.players[i].cpu; }
  cpuThinking() { return this.state.status === 'playing' && this.isCpu(this.state.turn.player); }

  // 画面に表示する視点: 人間の手番ならその人、CPU の手番なら直前の人間
  viewer() {
    const cur = this.state.turn.player;
    if (this.state.status === 'playing' && !this.isCpu(cur)) this.lastHuman = cur;
    return this.lastHuman;
  }

  isOnline() { return true; }

  async act(action) {
    const cur = this.state.turn.player;
    if (action.type === 'resign') {
      this.state = forfeit(this.state, this.viewer(), '投降');
    } else {
      if (this.isCpu(cur)) throw new RuleError('CPU の手番です');
      this.state = applyAction(this.state, cur, action);
    }
    this.emit();
    this.schedule();
  }

  schedule() {
    clearTimeout(this.timer);
    if (this.closed || !this.cpuThinking()) return;
    const delay = this.state.turn.phase === 'draw' ? this.cpuDelay * 0.7 : this.cpuDelay;
    this.timer = setTimeout(() => this.stepCpu(), delay);
  }

  stepCpu() {
    if (this.closed || !this.cpuThinking()) return;
    const p = this.state.turn.player;
    const action = chooseAction(this.state, p, this.state.players[p].cpu);
    try {
      this.state = action ? applyAction(this.state, p, action) : applyAction(this.state, p, { type: 'endTurn' });
    } catch (e) {
      console.error('CPU error', e, action);
      this.state = applyAction(this.state, p, { type: 'endTurn' });
    }
    this.emit();
    this.schedule();
  }

  async close() { this.closed = true; clearTimeout(this.timer); }
}

export { RuleError };
