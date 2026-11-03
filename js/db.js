// データベース層。
// - Firebase Realtime Database（本番。js/firebase-config.js を設定すると有効）
// - MockDB（Firebase 未設定時のデモ用。同じブラウザの別タブ同士で通信できる）
// どちらも同じインターフェースを持つ:
//   get(path) / set(path, value) / remove(path) / transaction(path, fn)
//   subscribe(path, cb) -> unsubscribe / setPresence(path) / now()

const FIREBASE_VERSION = '10.12.2';

// ---------------- Mock ----------------

const MOCK_KEY = 'beppan-mock-db';

function splitPath(path) { return path.split('/').filter(Boolean); }

function getIn(obj, parts) {
  let cur = obj;
  for (const k of parts) {
    if (cur == null || typeof cur !== 'object') return null;
    cur = cur[k];
  }
  return cur === undefined ? null : cur;
}

function setIn(obj, parts, value) {
  if (parts.length === 0) return value ?? {};
  const root = obj && typeof obj === 'object' ? obj : {};
  let cur = root;
  for (let i = 0; i < parts.length - 1; i++) {
    if (cur[parts[i]] == null || typeof cur[parts[i]] !== 'object') cur[parts[i]] = {};
    cur = cur[parts[i]];
  }
  const last = parts[parts.length - 1];
  if (value === null || value === undefined) delete cur[last];
  else cur[last] = value;
  return root;
}

class MockDB {
  constructor() {
    this.kind = 'mock';
    this.listeners = new Set();
    window.addEventListener('storage', (e) => { if (e.key === MOCK_KEY) this.emit(); });
    this.presence = [];
    window.addEventListener('pagehide', () => {
      for (const p of this.presence) this.write(p, null, false);
    });
  }

  read() {
    try { return JSON.parse(localStorage.getItem(MOCK_KEY)) || {}; } catch { return {}; }
  }

  write(path, value, notify = true) {
    const tree = setIn(this.read(), splitPath(path), value === undefined ? null : JSON.parse(JSON.stringify(value)));
    localStorage.setItem(MOCK_KEY, JSON.stringify(tree));
    if (notify) this.emit();
  }

  emit() {
    const tree = this.read();
    for (const l of this.listeners) l(tree);
  }

  async get(path) { return getIn(this.read(), splitPath(path)); }
  async set(path, value) { this.write(path, value); }
  async remove(path) { this.write(path, null); }

  async transaction(path, fn) {
    const cur = getIn(this.read(), splitPath(path));
    const next = fn(cur === null ? null : JSON.parse(JSON.stringify(cur)));
    if (next === undefined) return { committed: false, value: cur };
    this.write(path, next);
    return { committed: true, value: next };
  }

  subscribe(path, cb) {
    const parts = splitPath(path);
    let last;
    const l = (tree) => {
      const v = getIn(tree, parts);
      const s = JSON.stringify(v);
      if (s === last) return;
      last = s;
      cb(v);
    };
    this.listeners.add(l);
    setTimeout(() => l(this.read()), 0);
    return () => this.listeners.delete(l);
  }

  async setPresence(path) {
    this.presence.push(path);
    this.write(path, true);
    return () => {
      this.presence = this.presence.filter((p) => p !== path);
      this.write(path, null);
    };
  }

  now() { return Date.now(); }
}

// ---------------- Firebase ----------------

class FirebaseDB {
  async init(config) {
    const base = `https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}`;
    const appMod = await import(`${base}/firebase-app.js`);
    const dbMod = await import(`${base}/firebase-database.js`);
    this.m = dbMod;
    this.kind = 'firebase';
    const app = appMod.initializeApp(config);
    this.db = dbMod.getDatabase(app);
    this.offset = 0;
    dbMod.onValue(dbMod.ref(this.db, '.info/serverTimeOffset'), (s) => { this.offset = s.val() || 0; });
    return this;
  }

  ref(path) { return this.m.ref(this.db, path); }

  async get(path) { return (await this.m.get(this.ref(path))).val(); }
  async set(path, value) { await this.m.set(this.ref(path), value); }
  async remove(path) { await this.m.remove(this.ref(path)); }

  async transaction(path, fn) {
    const r = this.ref(path);
    // 先に読み込んでキャッシュを温める（初回 null 推測による誤った中断を防ぐ）
    await this.m.get(r);
    const res = await this.m.runTransaction(r, (cur) => fn(cur), { applyLocally: false });
    return { committed: res.committed, value: res.snapshot.val() };
  }

  subscribe(path, cb) {
    return this.m.onValue(this.ref(path), (s) => cb(s.val()));
  }

  async setPresence(path) {
    const r = this.ref(path);
    const { onValue, onDisconnect, set } = this.m;
    const unsub = onValue(this.ref('.info/connected'), async (s) => {
      if (s.val() !== true) return;
      await onDisconnect(r).remove();
      await set(r, true);
    });
    return async () => {
      unsub();
      await onDisconnect(r).cancel();
      await this.m.remove(r);
    };
  }

  now() { return Date.now() + this.offset; }
}

export async function connectDB(config) {
  if (config && config.databaseURL) return new FirebaseDB().init(config);
  return new MockDB();
}
