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
  // A short dance tune in the spirit of Georgian folk music, written from scratch:
  // a two-voice drone under the plucked lead (panduri-like), a doli drum in 6/8.
  // Returns a function that stops it early.
  folk(seconds = 4) {
    const c = ac(); if (!c) return () => {};
    const t0 = c.currentTime + 0.03;
    const eighth = 0.165;
    const bus = c.createGain();
    bus.gain.setValueAtTime(0.0001, t0);
    bus.gain.linearRampToValueAtTime(1, t0 + 0.12);
    bus.gain.setValueAtTime(1, t0 + seconds - 0.4);
    bus.gain.linearRampToValueAtTime(0.0001, t0 + seconds);
    bus.connect(master);
    const stops = [];

    const pluck = (t, f, dur = 0.26, peak = 0.11) => {
      for (const detune of [-4, 5]) {
        const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; o.detune.value = detune;
        const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 4;
        lp.frequency.setValueAtTime(f * 7, t); lp.frequency.exponentialRampToValueAtTime(f * 1.6, t + dur);
        const g = c.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(peak / 2, t + 0.006); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        o.connect(lp); lp.connect(g); g.connect(bus); o.start(t); o.stop(t + dur + 0.05); stops.push(o);
      }
    };
    const drone = (f, peak) => {
      const o = c.createOscillator(); o.type = 'triangle'; o.frequency.value = f;
      const lfo = c.createOscillator(); lfo.frequency.value = 5.2;
      const lg = c.createGain(); lg.gain.value = f * 0.006; lfo.connect(lg); lg.connect(o.frequency);
      const g = c.createGain(); g.gain.value = peak;
      o.connect(g); g.connect(bus); o.start(t0); lfo.start(t0); o.stop(t0 + seconds + 0.1); lfo.stop(t0 + seconds + 0.1); stops.push(o, lfo);
    };
    const doli = (t, kind) => {
      if (kind === 'dum') {
        const o = c.createOscillator(); o.type = 'sine';
        o.frequency.setValueAtTime(115, t); o.frequency.exponentialRampToValueAtTime(52, t + 0.13);
        const g = c.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.3, t + 0.004); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
        o.connect(g); g.connect(bus); o.start(t); o.stop(t + 0.22); stops.push(o);
      } else {
        const n = noise(c); const hp = c.createBiquadFilter(); hp.type = 'bandpass'; hp.frequency.value = 3200; hp.Q.value = 1.2;
        const g = c.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.14, t + 0.003); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.07);
        n.connect(hp); hp.connect(g); g.connect(bus); n.start(t); n.stop(t + 0.1); stops.push(n);
      }
    };

    // D dorian-ish: D4 E4 F4 G4 A4 Bb4 C5 D5
    const D4 = 293.66, E4 = 329.63, F4 = 349.23, G4 = 392, A4 = 440, C5 = 523.25, D5 = 587.33;
    const tune = [
      A4, A4, G4, A4, C5, A4,   G4, F4, E4, F4, G4, D4,
      A4, C5, D5, C5, A4, G4,   F4, E4, F4, E4, D4, D4,
    ];
    const beats = Math.floor(seconds / eighth);
    for (let i = 0; i < beats; i++) {
      const t = t0 + i * eighth;
      pluck(t, tune[i % tune.length], i % 6 === 0 ? 0.34 : 0.22, i % 6 === 0 ? 0.13 : 0.1);
      const pos = i % 6; // doli: DUM . tek DUM tek .
      if (pos === 0 || pos === 3) doli(t, 'dum'); else if (pos === 2 || pos === 4) doli(t, 'tek');
    }
    drone(146.83, 0.035); drone(220, 0.022);

    return () => {
      const now = c.currentTime;
      bus.gain.cancelScheduledValues(now); bus.gain.setValueAtTime(bus.gain.value, now); bus.gain.linearRampToValueAtTime(0.0001, now + 0.15);
    };
  },
  firework() {
    const c = ac(); if (!c) return;
    const t = c.currentTime;
    const o = c.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(900, t); o.frequency.exponentialRampToValueAtTime(160, t + 0.35);
    env(c, o, t, 0.01, 0.025, 0.36); o.start(t); o.stop(t + 0.45);
    slide(c, t + 0.34, { dur: 0.18, freq: 4200, q: 0.6, peak: 0.12 });
    for (let i = 0; i < 7; i++) tap(c, t + 0.4 + Math.random() * 0.5, 0.03 + Math.random() * 0.03);
  },
  special() {
    const c = ac(); if (!c) return;
    const t = c.currentTime;
    [C5, E5, G5, C6, E6].forEach((f, i) => tone(c, t + i * 0.07, f, 0.55, 0.055, 'triangle'));
    tone(c, t + 0.4, 2093, 0.5, 0.025);
    for (let i = 0; i < 6; i++) tap(c, t + 0.25 + i * 0.05, 0.025);
  },
  pop() {
    const c = ac(); if (!c) return;
    const t = c.currentTime;
    tone(c, t, 660, 0.12, 0.045);
    tone(c, t + 0.06, 990, 0.14, 0.03);
  },
  tick() {
    const c = ac(); if (!c) return;
    tap(c, c.currentTime, 0.05);
  },
};
