// スマホ用の地図カメラ。
// SVG の viewBox を動かして、ドラッグで移動・ピンチ／ボタンで拡大縮小する。
// PC では無効（地図全体を表示）。

const MAP_W = 1000;
const MAP_H = 480;
export const DEFAULT_SCALE = 0.95; // 1 地図単位 ≒ 0.95 CSS px（駒や文字がそのまま読める大きさ）
const MAX_SCALE = 2.2;
const EDGE_PAD = 90;

export class Camera {
  constructor(svg, wrap) {
    this.svg = svg;
    this.wrap = wrap;
    this.enabled = false;
    this.cx = MAP_W / 2;
    this.cy = MAP_H / 2;
    this.scale = DEFAULT_SCALE;
    this.userPanAt = 0;
    this.suppressUntil = 0;
    this.pointers = new Map();
    this.gesture = null;
    this.onChange = null;
    this.bind();
  }

  setEnabled(on) {
    this.enabled = on;
    this.apply();
  }

  size() {
    return { W: this.wrap.clientWidth || 1, H: this.wrap.clientHeight || 1 };
  }

  // 地図全体が収まる倍率（これより小さくはしない）
  minScale() {
    const { W, H } = this.size();
    return Math.min(W / MAP_W, H / MAP_H);
  }

  clamp() {
    const { W, H } = this.size();
    this.scale = Math.max(this.minScale(), Math.min(MAX_SCALE, this.scale));
    const w = W / this.scale;
    const h = H / this.scale;
    // 端の都市も画面の中ほどに寄せられるよう、地図の外側に少し余白を許す
    const mx = Math.min(EDGE_PAD, w / 4);
    const my = Math.min(EDGE_PAD / 2, h / 4);
    this.cx = w >= MAP_W ? MAP_W / 2 : Math.max(w / 2 - mx, Math.min(MAP_W - w / 2 + mx, this.cx));
    this.cy = h >= MAP_H ? MAP_H / 2 : Math.max(h / 2 - my, Math.min(MAP_H - h / 2 + my, this.cy));
  }

  apply() {
    if (!this.enabled) {
      this.svg.setAttribute('viewBox', `0 0 ${MAP_W} ${MAP_H}`);
      return;
    }
    this.clamp();
    const { W, H } = this.size();
    const w = W / this.scale;
    const h = H / this.scale;
    this.svg.setAttribute('viewBox', `${(this.cx - w / 2).toFixed(1)} ${(this.cy - h / 2).toFixed(1)} ${w.toFixed(1)} ${h.toFixed(1)}`);
    if (this.onChange) this.onChange();
  }

  focus(x, y, scale) {
    if (scale) this.scale = scale;
    this.cx = x;
    this.cy = y;
    this.apply();
  }

  // 指定した点がすべて入るように表示する（拡大しすぎない）
  fit(points, { pad = 70, maxScale = DEFAULT_SCALE * 1.1, minScale = DEFAULT_SCALE * 0.6 } = {}) {
    if (!points.length) return;
    const xs = points.map((p) => p.x);
    const ys = points.map((p) => p.y);
    const minX = Math.min(...xs) - pad;
    const maxX = Math.max(...xs) + pad;
    const minY = Math.min(...ys) - pad;
    const maxY = Math.max(...ys) + pad;
    const { W, H } = this.size();
    // 縮小しすぎると駒が読めなくなるので、下限を設ける（はみ出した分はドラッグで見る）
    this.scale = Math.max(minScale, Math.min(maxScale, W / (maxX - minX), H / (maxY - minY)));
    this.cx = (minX + maxX) / 2;
    this.cy = (minY + maxY) / 2;
    this.apply();
  }

  fitAll() {
    this.scale = this.minScale();
    this.apply();
  }

  // 画面上の点 (px, py) を中心に拡大縮小
  zoom(factor, px, py) {
    const { W, H } = this.size();
    const sx = px ?? W / 2;
    const sy = py ?? H / 2;
    const wx = this.cx + (sx - W / 2) / this.scale;
    const wy = this.cy + (sy - H / 2) / this.scale;
    this.scale *= factor;
    this.clamp();
    this.cx = wx - (sx - W / 2) / this.scale;
    this.cy = wy - (sy - H / 2) / this.scale;
    this.userPanAt = Date.now();
    this.apply();
  }

  // 地図上の点が今見えているか
  visible(x, y, margin = 30) {
    if (!this.enabled) return true;
    const { W, H } = this.size();
    const w = W / this.scale;
    const h = H / this.scale;
    return Math.abs(x - this.cx) < w / 2 - margin && Math.abs(y - this.cy) < h / 2 - margin;
  }

  // ドラッグ直後のタップ（クリック）は無視する
  shouldSuppressClick() {
    return Date.now() < this.suppressUntil;
  }

  local(e) {
    const r = this.wrap.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  startGesture() {
    const pts = [...this.pointers.values()];
    if (pts.length === 1) {
      this.gesture = { kind: 'pan', x: pts[0].x, y: pts[0].y, cx: this.cx, cy: this.cy, moved: false };
    } else if (pts.length >= 2) {
      const [a, b] = pts;
      const mx = (a.x + b.x) / 2;
      const my = (a.y + b.y) / 2;
      const { W, H } = this.size();
      this.gesture = {
        kind: 'pinch',
        dist: Math.hypot(a.x - b.x, a.y - b.y) || 1,
        scale: this.scale,
        wx: this.cx + (mx - W / 2) / this.scale,
        wy: this.cy + (my - H / 2) / this.scale,
        moved: true,
      };
    }
  }

  bind() {
    const w = this.wrap;
    w.addEventListener('pointerdown', (e) => {
      if (!this.enabled) return;
      this.pointers.set(e.pointerId, this.local(e));
      this.startGesture();
    });
    w.addEventListener('pointermove', (e) => {
      if (!this.enabled || !this.pointers.has(e.pointerId) || !this.gesture) return;
      this.pointers.set(e.pointerId, this.local(e));
      const g = this.gesture;
      const { W, H } = this.size();
      if (g.kind === 'pan') {
        const p = this.pointers.get(e.pointerId);
        const dx = p.x - g.x;
        const dy = p.y - g.y;
        if (!g.moved && Math.hypot(dx, dy) < 8) return;
        if (!g.moved) {
          g.moved = true;
          try { w.setPointerCapture(e.pointerId); } catch { /* ignore */ }
        }
        this.cx = g.cx - dx / this.scale;
        this.cy = g.cy - dy / this.scale;
      } else {
        const [a, b] = [...this.pointers.values()];
        if (!b) return;
        const mx = (a.x + b.x) / 2;
        const my = (a.y + b.y) / 2;
        this.scale = g.scale * (Math.hypot(a.x - b.x, a.y - b.y) / g.dist);
        this.clamp();
        this.cx = g.wx - (mx - W / 2) / this.scale;
        this.cy = g.wy - (my - H / 2) / this.scale;
      }
      this.userPanAt = Date.now();
      this.apply();
    });
    const end = (e) => {
      if (!this.pointers.has(e.pointerId)) return;
      this.pointers.delete(e.pointerId);
      if (this.gesture && this.gesture.moved) this.suppressUntil = Date.now() + 350;
      if (this.pointers.size) this.startGesture(); else this.gesture = null;
    };
    w.addEventListener('pointerup', end);
    w.addEventListener('pointercancel', end);
    w.addEventListener('wheel', (e) => {
      if (!this.enabled) return;
      e.preventDefault();
      const p = this.local(e);
      this.zoom(e.deltaY < 0 ? 1.15 : 1 / 1.15, p.x, p.y);
    }, { passive: false });
  }
}
