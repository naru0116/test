// 効果音と振動（すべて端末内で合成。外部の音源ファイルは使わない）

const KEY = 'beppan-sfx';
let ctx = null;
let master = null;
let on = true;
try { on = localStorage.getItem(KEY) !== '0'; } catch { /* ignore */ }

export function sfxEnabled() { return on; }
export function setSfx(v) {
  on = v;
  try { localStorage.setItem(KEY, v ? '1' : '0'); } catch { /* ignore */ }
  if (v) audio();
}

function audio() {
  if (!on) return null;
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.22;
    master.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}

// iOS などは、ユーザー操作の中で一度鳴らす準備をしないと音が出ない
document.addEventListener('pointerdown', () => { if (on) audio(); }, { capture: true });

function tone(freq, dur, { type = 'sine', gain = 0.5, when = 0, to = null } = {}) {
  const c = audio();
  if (!c) return;
  const t = c.currentTime + when;
  const osc = c.createOscillator();
  const env = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  if (to) osc.frequency.exponentialRampToValueAtTime(to, t + dur);
  env.gain.setValueAtTime(0.0001, t);
  env.gain.exponentialRampToValueAtTime(gain, t + 0.012);
  env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(env).connect(master);
  osc.start(t);
  osc.stop(t + dur + 0.05);
}

function noise(dur, { gain = 0.4, when = 0, freq = 900 } = {}) {
  const c = audio();
  if (!c) return;
  const t = c.currentTime + when;
  const buf = c.createBuffer(1, Math.floor(c.sampleRate * dur), c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
  const src = c.createBufferSource();
  src.buffer = buf;
  const filter = c.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.value = freq;
  const env = c.createGain();
  env.gain.value = gain;
  src.connect(filter).connect(env).connect(master);
  src.start(t);
}

function vibrate(pattern) {
  if (on && navigator.vibrate) { try { navigator.vibrate(pattern); } catch { /* ignore */ } }
}

export const sfx = {
  tap() { tone(700, 0.05, { type: 'triangle', gain: 0.18 }); },
  draw() { noise(0.09, { gain: 0.25, freq: 2400 }); tone(520, 0.08, { type: 'triangle', gain: 0.25, when: 0.03 }); },
  move() { tone(240, 0.12, { type: 'sine', gain: 0.35, to: 360 }); },
  scout() { tone(880, 0.07, { gain: 0.25 }); tone(1320, 0.12, { gain: 0.2, when: 0.07 }); },
  take() { noise(0.12, { gain: 0.3, freq: 1600 }); tone(440, 0.1, { type: 'triangle', gain: 0.25, when: 0.05, to: 660 }); },
  card() { tone(392, 0.09, { type: 'square', gain: 0.12 }); tone(587, 0.12, { type: 'square', gain: 0.1, when: 0.08 }); },
  trap() {
    noise(0.25, { gain: 0.6, freq: 500 });
    tone(220, 0.35, { type: 'sawtooth', gain: 0.25, to: 70 });
    vibrate([90, 50, 140]);
  },
  arrest() {
    tone(150, 0.14, { type: 'square', gain: 0.25 });
    tone(110, 0.2, { type: 'square', gain: 0.25, when: 0.16 });
    vibrate([60, 40, 60]);
  },
  steal() { tone(300, 0.18, { type: 'triangle', gain: 0.3, to: 1100 }); vibrate(40); },
  myTurn() { tone(659, 0.14, { type: 'triangle', gain: 0.3 }); tone(988, 0.22, { type: 'triangle', gain: 0.28, when: 0.12 }); vibrate(30); },
  win() { [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.3, { type: 'triangle', gain: 0.3, when: i * 0.12 })); vibrate([80, 40, 80, 40, 200]); },
  lose() { [392, 330, 262].forEach((f, i) => tone(f, 0.35, { type: 'sine', gain: 0.3, when: i * 0.16 })); },
};
