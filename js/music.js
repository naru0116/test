// Original 16-bar ambient score, synthesized locally without external audio.
const button = document.querySelector('#music-toggle');
const volume = document.querySelector('#music-volume');
const status = document.querySelector('#music-status');
let context, master, timer, next = 0, step = 0, enabled = false;
const beat = 60 / 84;
const chords = [[45, 52, 57, 60], [41, 48, 53, 57], [48, 55, 60, 64], [43, 50, 55, 59]];
function note(midi, when, duration, gain, type = 'sine') {
  const osc = context.createOscillator(), envelope = context.createGain();
  osc.type = type;
  osc.frequency.value = 440 * 2 ** ((midi - 69) / 12);
  envelope.gain.setValueAtTime(0, when);
  envelope.gain.linearRampToValueAtTime(gain, when + .04);
  envelope.gain.exponentialRampToValueAtTime(.0001, when + duration);
  osc.connect(envelope).connect(master);
  osc.start(when); osc.stop(when + duration + .05);
  osc.onended = () => { osc.disconnect(); envelope.disconnect(); };
}
function schedule() {
  while (next < context.currentTime + .2) {
    const chord = chords[Math.floor(step / 16) % 4];
    if (step % 4 === 0) note(chord[0] - 12, next, beat * 2, .2);
    if (step % 2 === 0) note(chord[(step / 2) % 4] + 12, next, beat * 2.8, .075);
    if (step % 16 === 0) chord.slice(1).forEach(n => note(n, next, beat * 7, .035, 'triangle'));
    next += beat / 2; step = (step + 1) % 64;
  }
}
async function sync() {
  clearInterval(timer);
  if (!enabled || document.hidden) {
    if (context) await context.suspend();
    return;
  }
  await context.resume();
  next = context.currentTime + .05;
  schedule(); timer = setInterval(schedule, 80);
}
button.addEventListener('click', async () => {
  button.disabled = true;
  try {
    if (!context) {
      const Audio = window.AudioContext || window.webkitAudioContext;
      context = new Audio();
      master = context.createGain();
      master.gain.value = Number(volume.value) / 100;
      master.connect(context.destination);
    }
    enabled = !enabled;
    await sync();
    button.textContent = enabled ? 'BGM 停止' : 'BGM 再生';
    button.setAttribute('aria-pressed', String(enabled));
    status.textContent = '';
  } catch {
    enabled = false;
    clearInterval(timer);
    button.textContent = 'BGM 再生';
    button.setAttribute('aria-pressed', 'false');
    status.textContent = 'BGMを再生できませんでした。再度お試しください。';
  } finally { button.disabled = false; }
});
volume.addEventListener('input', () => {
  if (master) master.gain.setTargetAtTime(Number(volume.value) / 100, context.currentTime, .05);
});
document.addEventListener('visibilitychange', () => { sync().catch(() => { status.textContent = '再生ボタンでBGMを再開してください。'; }); });
window.addEventListener('pagehide', () => { clearInterval(timer); context?.suspend(); });
window.addEventListener('pageshow', () => { if (enabled) sync().catch(() => {}); });
