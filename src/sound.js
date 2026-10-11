// Sound effects synthesized with Web Audio: no files, nothing to download, and
// quiet by design. Card sounds are filtered noise; chimes are soft sines.

const STORAGE = 'eleven.sound';
let enabled = true;
try { enabled = localStorage.getItem(STORAGE) !== 'off'; } catch { /* storage blocked */ }

let ctx = null;
let master = null;
let noiseBuf = null;

function ac() {
  if (!enabled) return null;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  if (!ctx) {
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.55;
    master.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}

// Browsers only start audio after a user gesture; call this from the first click.
export function unlock() { ac(); }
export function soundEnabled() { return enabled; }
export function setSound(on) {
  enabled = !!on;
  try { localStorage.setItem(STORAGE, enabled ? 'on' : 'off'); } catch { /* ignore */ }
  if (enabled) ac();
}

function noise(c) {
  if (!noiseBuf) {
    const len = Math.floor(c.sampleRate * 0.5);
    noiseBuf = c.createBuffer(1, len, c.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }
  const src = c.createBufferSource();
  src.buffer = noiseBuf;
  src.loop = true;
  return src;
}

function env(c, node, t0, attack, peak, decay) {
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.linearRampToValueAtTime(peak, t0 + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + attack + decay);
  node.connect(g);
  g.connect(master);
}

// A card sliding over felt.
function slide(c, t0, { dur = 0.09, freq = 1800, q = 0.9, peak = 0.16 } = {}) {
  const n = noise(c);
  const f = c.createBiquadFilter();
  f.type = 'bandpass';
  f.Q.value = q;
  f.frequency.setValueAtTime(freq, t0);
  f.frequency.exponentialRampToValueAtTime(freq * 0.55, t0 + dur);
  n.connect(f);
  env(c, f, t0, 0.012, peak, dur);
  n.start(t0);
  n.stop(t0 + dur + 0.05);
}

// A card landing: a tick plus a tiny thump.
function tap(c, t0, peak = 0.1) {
  const n = noise(c);
  const f = c.createBiquadFilter();
  f.type = 'highpass';
  f.frequency.value = 2600;
  n.connect(f);
  env(c, f, t0, 0.002, peak, 0.028);
  n.start(t0);
  n.stop(t0 + 0.06);
  const o = c.createOscillator();
  o.type = 'sine';
  o.frequency.setValueAtTime(170, t0);
  o.frequency.exponentialRampToValueAtTime(90, t0 + 0.05);
  env(c, o, t0, 0.003, peak * 0.5, 0.06);
  o.start(t0);
  o.stop(t0 + 0.1);
}

function tone(c, t0, freq, dur, peak = 0.07, type = 'sine') {
  const o = c.createOscillator();
  o.type = type;
  o.frequency.value = freq;
  env(c, o, t0, 0.012, peak, dur);
  o.start(t0);
  o.stop(t0 + dur + 0.05);
}

const C5 = 523.25, E5 = 659.25, G5 = 783.99, C6 = 1046.5, E6 = 1318.5, D5 = 587.33, A4 = 440, G4 = 392, F4 = 349.23;

export const sfx = {
  shuffle() {
    const c = ac(); if (!c) return;
    const t = c.currentTime;
    for (let i = 0; i < 22; i++) tap(c, t + i * 0.028 + Math.random() * 0.01, 0.035 + Math.random() * 0.03);
    slide(c, t + 0.68, { dur: 0.14, freq: 1200, peak: 0.1 });
  },
  deal(n, startDelay = 0) {
    const c = ac(); if (!c) return;
    const t = c.currentTime + startDelay;
    for (let i = 0; i < Math.min(n, 14); i++) slide(c, t + i * 0.07, { peak: 0.12 });
  },
  lay() {
    const c = ac(); if (!c) return;
    const t = c.currentTime;
    slide(c, t, { dur: 0.08 });
    tap(c, t + 0.07, 0.07);
  },
  take(n) {
    const c = ac(); if (!c) return;
    const t = c.currentTime;
    for (let i = 0; i < Math.min(n, 6); i++) slide(c, t + i * 0.06, { dur: 0.07, freq: 1500, peak: 0.1 });
    tone(c, t + 0.05, C5, 0.18, 0.045);
    tone(c, t + 0.15, E5, 0.26, 0.045);
  },
  sweep() {
    const c = ac(); if (!c) return;
    const t = c.currentTime;
    [C5, E5, G5, C6].forEach((f, i) => tone(c, t + i * 0.08, f, 0.32, 0.05));
    for (let i = 0; i < 4; i++) slide(c, t + i * 0.06, { dur: 0.07, peak: 0.09 });
  },
  turn() {
    const c = ac(); if (!c) return;
    const t = c.currentTime;
    tone(c, t, 880, 0.5, 0.06);
    tone(c, t, 1760, 0.3, 0.015);
  },
  dealOver(good) {
    const c = ac(); if (!c) return;
    const t = c.currentTime;
    (good ? [C5, E5, G5] : [E5, D5, C5]).forEach((f, i) => tone(c, t + i * 0.14, f, 0.36, 0.05, 'triangle'));
  },
  gameOver(won) {
    const c = ac(); if (!c) return;
    const t = c.currentTime;
    (won ? [C5, E5, G5, C6, E6] : [A4, G4, F4]).forEach((f, i) => tone(c, t + i * 0.16, f, 0.5, 0.055, 'triangle'));
  },
  tick() {
    const c = ac(); if (!c) return;
    tap(c, c.currentTime, 0.05);
  },
};
