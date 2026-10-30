// The little dancer who comes out when somebody takes a 10♦ or 2♣ (and a furti
// that takes a lot). A hand-drawn SVG man in a chokha, built from parts that are
// posed every frame: hop in, gallop and twirl, drop to one knee and clap, hop out.

const DURATION = 4.0;
const INK = '#1b1a17';
const CHOKHA = '#2c2326';
const CHOKHA_LIGHT = '#43363a';
const GOLD = '#d9a93f';
const CREAM = '#f3e6c6';
const SKIN = '#f3c9a0';
const RED = '#a4263a';

const sw = `stroke="${INK}" stroke-width="4" stroke-linejoin="round" stroke-linecap="round"`;
const sw2 = `stroke="${INK}" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round"`;

function gazyrs(x0, dir) {
  let s = '';
  for (let i = 0; i < 6; i++) {
    const x = x0 + dir * i * 6.4;
    s += `<rect x="${x - 2.6}" y="132" width="5.2" height="27" rx="2.6" fill="${CREAM}" ${sw2}/><rect x="${x - 2.6}" y="132" width="5.2" height="6" rx="2" fill="${GOLD}" ${sw2}/>`;
  }
  return s;
}

function arm(side) {
  // side: 1 = left of the screen. Drawn hanging down from the shoulder at (0,0).
  return `
    <g class="upper">
      <rect x="-9" y="-6" width="18" height="44" rx="9" fill="${CHOKHA}" ${sw}/>
      <g class="fore" transform="translate(0 34)">
        <rect x="-8" y="-2" width="16" height="36" rx="8" fill="${CHOKHA}" ${sw}/>
        <rect x="-9" y="24" width="18" height="9" rx="3" fill="${GOLD}" ${sw2}/>
        <circle cx="0" cy="42" r="10" fill="${SKIN}" ${sw}/>
        <path d="M-3 44 q3 4 6 0" fill="none" stroke="${INK}" stroke-width="1.8" stroke-linecap="round"/>
      </g>
    </g>`;
}

function boot() {
  return `
    <path d="M-13 0 L13 0 L12 24 C22 26 28 32 28 38 L-14 38 C-14 30 -14 14 -13 0 Z" fill="#17120f" ${sw}/>
    <path d="M-12 30 L26 30" stroke="#5b3a24" stroke-width="3" stroke-linecap="round"/>`;
}

function markup() {
  return `
<svg class="dancer-svg" viewBox="0 0 240 350" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <ellipse id="dn-shadow" cx="120" cy="338" rx="62" ry="9" fill="rgba(0,0,0,.28)"/>
  <g id="dn-root">
    <g id="dn-legs">
      <g id="dn-legL" transform="translate(100 296)">${boot()}</g>
      <g id="dn-legR" transform="translate(140 296)">${boot()}</g>
    </g>
    <g id="dn-skirt">
      <path d="M94 186 L146 186 C170 230 202 268 208 306 C172 320 68 320 32 306 C38 268 70 230 94 186 Z" fill="${CHOKHA}" ${sw}/>
      <path d="M104 196 C96 240 84 280 70 312 M120 196 L120 316 M136 196 C144 240 156 280 170 312" fill="none" stroke="${CHOKHA_LIGHT}" stroke-width="3.5" stroke-linecap="round"/>
      <path d="M33 298 C70 312 170 312 207 298 L208 306 C172 320 68 320 32 306 Z" fill="${GOLD}" ${sw2}/>
      <path d="M36 288 C72 302 168 302 204 288" fill="none" stroke="${RED}" stroke-width="5" stroke-linecap="round"/>
    </g>
    <g id="dn-torsoWrap">
      <g id="dn-torso">
        <path d="M86 126 C86 114 100 108 120 108 C140 108 154 114 154 126 L148 194 L92 194 Z" fill="${CHOKHA}" ${sw}/>
        <path d="M106 110 L120 140 L134 110" fill="none" stroke="${GOLD}" stroke-width="4" stroke-linejoin="round" stroke-linecap="round"/>
        ${gazyrs(98, 1)}${gazyrs(142, -1)}
        <rect x="88" y="184" width="64" height="12" rx="4" fill="${GOLD}" ${sw2}/>
        <circle cx="120" cy="190" r="6.5" fill="${RED}" ${sw2}/>
        <g transform="translate(134 196) rotate(-8)"><rect x="-4" y="0" width="8" height="14" rx="3" fill="${GOLD}" ${sw2}/><path d="M-3 14 L3 14 L2 52 L0 58 L-2 52 Z" fill="#dfe5ea" ${sw2}/></g>
      </g>
      <g id="dn-armL" transform="translate(94 124)">${arm(1)}</g>
      <g id="dn-armR" transform="translate(146 124)">${arm(-1)}</g>
      <g id="dn-head" transform="translate(120 112)">
        <g transform="translate(-120 -112)">
          <rect x="111" y="100" width="18" height="14" rx="5" fill="#e2ab80" ${sw2}/>
          <ellipse cx="91" cy="84" rx="7" ry="9" fill="${SKIN}" ${sw2}/><ellipse cx="149" cy="84" rx="7" ry="9" fill="${SKIN}" ${sw2}/>
          <circle cx="120" cy="82" r="29" fill="${SKIN}" ${sw}/>
          <circle cx="98" cy="92" r="6" fill="#f09a8a" opacity=".55"/><circle cx="142" cy="92" r="6" fill="#f09a8a" opacity=".55"/>
          <g id="dn-eyes">
            <ellipse cx="107" cy="78" rx="7" ry="8" fill="#fff" ${sw2}/><ellipse cx="133" cy="78" rx="7" ry="8" fill="#fff" ${sw2}/>
            <circle id="dn-pupL" cx="108" cy="80" r="3.6" fill="${INK}"/><circle id="dn-pupR" cx="134" cy="80" r="3.6" fill="${INK}"/>
            <circle cx="106.5" cy="78" r="1.3" fill="#fff"/><circle cx="132.5" cy="78" r="1.3" fill="#fff"/>
          </g>
          <path d="M98 66 Q107 59 116 65 M124 65 Q133 59 142 66" fill="none" stroke="${INK}" stroke-width="4.5" stroke-linecap="round"/>
          <path d="M116 80 Q120 94 124 80 Q126 88 120 90 Q114 88 116 80Z" fill="#e3a273" ${sw2}/>
          <path d="M108 104 Q120 122 132 104 Z" fill="#7a2230" ${sw2}/>
          <path d="M113 110 Q120 116 127 110 Q120 108 113 110Z" fill="#e8808a"/>
          <path id="dn-mus" d="M120 95 C108 88 90 90 82 100 C76 108 85 114 91 108 C88 122 106 122 120 106 C134 122 152 122 149 108 C155 114 164 108 158 100 C150 90 132 88 120 95 Z" fill="#241f1d" ${sw}/>
          <path d="M96 100 C104 96 112 98 117 102 M144 100 C136 96 128 98 123 102" fill="none" stroke="#6a5a52" stroke-width="2.6" stroke-linecap="round"/>
          <!-- papakha -->
          <path d="M88 62 C82 40 92 20 120 18 C148 20 158 40 152 62 C140 54 100 54 88 62 Z" fill="#4a4543" ${sw}/>
          <g fill="#5e5856" ${sw2}><circle cx="94" cy="52" r="7"/><circle cx="106" cy="46" r="7"/><circle cx="120" cy="44" r="7"/><circle cx="134" cy="46" r="7"/><circle cx="146" cy="52" r="7"/><circle cx="100" cy="34" r="7"/><circle cx="112" cy="28" r="7"/><circle cx="128" cy="28" r="7"/><circle cx="140" cy="34" r="7"/></g>
          <path d="M96 24 C104 14 136 14 144 24 C136 30 104 30 96 24 Z" fill="${RED}" ${sw2}/>
          <path d="M113 20 L120 12 L127 20" fill="none" stroke="${GOLD}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
        </g>
      </g>
    </g>
  </g>
</svg>`;
}

// ---------- posing ----------
const clamp01 = (v) => Math.max(0, Math.min(1, v));
const lerp = (a, b, k) => a + (b - a) * k;
const smooth = (k) => { k = clamp01(k); return k * k * (3 - 2 * k); };
const easeOutBack = (k) => { k = clamp01(k); const c = 1.7; return 1 + (c + 1) * Math.pow(k - 1, 3) + c * Math.pow(k - 1, 2); };
const deg = (r) => (r * 180) / Math.PI;

function pose(el, t) {
  const $ = (id) => el.querySelector(`#dn-${id}`);
  const root = $('root'), legL = $('legL'), legR = $('legR'), skirt = $('skirt');
  const torso = $('torso'), head = $('head'), armL = $('armL'), armR = $('armR'), shadow = $('shadow');
  const pupL = $('pupL'), pupR = $('pupR'), mus = $('mus'), legs = $('legs');

  // phases
  const enter = smooth(t / 0.5);
  const galloping = smooth((t - 0.45) / 0.15) * (1 - smooth((t - 2.2) / 0.2));
  const kneel = smooth((t - 2.25) / 0.25) * (1 - smooth((t - 3.45) / 0.2));
  const leave = smooth((t - 3.5) / 0.5);

  const beat = t * Math.PI * 2 * 2.1;                       // ~2 hops a second ... fast folk step
  const hop = Math.abs(Math.sin(beat / 2)) * 26 * galloping;
  const clap = Math.sin(t * 26);
  const bounce = Math.abs(Math.sin(t * 9)) * 6 * kneel;

  // two twirls: the body turns on the spot (squash across, flip, back)
  const twirl = (a, b) => (t > a && t < b ? (t - a) / (b - a) : -1);
  const u = twirl(0.95, 1.5) >= 0 ? twirl(0.95, 1.5) : twirl(1.6, 2.15);
  const spinning = u >= 0;
  const turn = spinning ? Math.cos(u * Math.PI * 2) : 1;
  const flare = spinning ? 1 + 0.32 * Math.sin(u * Math.PI) : 1 + 0.06 * Math.sin(beat);

  // root: enter from below with a bounce, leave sideways with a hop
  const ty = (1 - easeOutBack(enter)) * 150 + kneel * 30 - hop + leave * -30 * Math.sin(leave * Math.PI);
  const tx = leave * 200;
  const sc = lerp(0.5, 1, easeOutBack(enter)) * (1 - leave * 0.35);
  const sx = Math.abs(turn) < 0.12 ? 0.12 * Math.sign(turn || 1) : turn;
  const sway = Math.sin(beat / 2) * 5 * galloping;
  root.setAttribute('transform', `translate(${(120 + tx).toFixed(1)} ${(338 + ty).toFixed(1)}) rotate(${sway.toFixed(1)}) scale(${(sc * sx).toFixed(3)} ${sc.toFixed(3)}) translate(-120 -338)`);
  el.style.opacity = String(clamp01(t / 0.12) * (1 - smooth((t - 3.8) / 0.2)));

  // shadow shrinks as he leaps
  const lift = hop / 26;
  shadow.setAttribute('rx', String((62 * (1 - lift * 0.3) * sc).toFixed(1)));
  shadow.setAttribute('cx', String((120 + tx).toFixed(1)));
  shadow.setAttribute('opacity', String(1 - leave));

  // skirt flares on twirls, shortens when he drops to the knee
  skirt.setAttribute('transform', `translate(120 186) scale(${flare.toFixed(3)} ${(1 - kneel * 0.2).toFixed(3)}) translate(-120 -186)`);

  // legs: alternate kicks while galloping; tucked under the skirt on the knee
  const kick = Math.sin(beat / 2);
  const legAng = (side) => deg(0.5) * kick * side * galloping;
  const tuck = kneel * 30;
  legL.setAttribute('transform', `translate(100 ${296 - tuck}) rotate(${(legAng(1) * 0.9).toFixed(1)}) scale(1 ${(1 - kneel * 0.35).toFixed(2)})`);
  legR.setAttribute('transform', `translate(140 ${296 - tuck + kneel * 8}) rotate(${(legAng(-1) * 0.9 - kneel * 40).toFixed(1)})`);
  legs.setAttribute('opacity', '1');

  // torso & head
  const lean = Math.sin(beat / 2 + 0.6) * 4 * galloping + Math.sin(t * 9) * 3 * kneel;
  torso.setAttribute('transform', `translate(120 190) rotate(${lean.toFixed(1)}) translate(-120 -190)`);
  const nod = Math.sin(t * 9) * 5 * (galloping + kneel);
  head.setAttribute('transform', `translate(120 112) rotate(${(nod - lean * 0.5).toFixed(1)}) translate(0 ${(-bounce * 0.5).toFixed(1)})`);
  mus.setAttribute('transform', `translate(120 106) scale(1 ${(1 + Math.sin(t * 18) * 0.04 * (galloping + kneel)).toFixed(3)}) translate(-120 -106)`);
  const look = Math.sin(t * 5) * 1.6 * (galloping + kneel);
  pupL.setAttribute('cx', String((108 + look).toFixed(1)));
  pupR.setAttribute('cx', String((134 + look).toFixed(1)));

  // arms: left = positive angle swings out, right = negative
  const place = (g, side, up, wave) => {
    // up 0 = hanging, 1 = out to the side, 2 = overhead
    const base = up <= 1 ? lerp(8, 78, up) : lerp(78, 168, up - 1);
    const ang = side * (base + wave * 8);
    g.setAttribute('transform', `translate(${side === 1 ? 94 : 146} ${(124 + 0).toFixed(0)}) rotate(${ang.toFixed(1)})`);
    const fore = g.querySelector('.fore');
    const bend = side * (-(8 + wave * 22) - (up >= 1.9 ? 0 : 0));
    fore.setAttribute('transform', `translate(0 34) rotate(${bend.toFixed(1)})`);
  };
  const intro = enter * (1 - galloping) * (1 - kneel) * (1 - smooth((t - 3.5) / 0.3));
  const upBase = 0.15 + galloping * 0.9 + kneel * 1.8 + leave * 0.3;
  const waveG = Math.sin(t * 12);
  const waveL = galloping * waveG + kneel * (clap > 0 ? 0.5 : -0.6) + intro * 0.2;
  const waveR = -galloping * waveG + kneel * (clap > 0 ? 0.5 : -0.6) - intro * 0.2;
  place(armL, 1, upBase, waveL);
  place(armR, -1, upBase + (galloping > 0 && !spinning ? 0.15 * Math.sin(beat) : 0), waveR);
}

// ---------- public ----------
export function webglAvailable() { return true; } // kept for callers; the dancer is plain SVG now

export async function playDancer(box, onStart) {
  const host = document.getElementById('fx');
  if (!host) return false;
  const height = Math.round(Math.min(Math.max(box.height * 0.86, 250), 380));
  const width = Math.round((height * 240) / 350);
  const el = document.createElement('div');
  el.className = 'dancer-canvas';
  el.style.width = `${width}px`;
  el.style.height = `${height}px`;
  el.style.left = `${box.left + box.width / 2 - width / 2}px`;
  el.style.top = `${box.top + box.height - height * 0.96}px`; // feet on the lower edge of the cloth
  el.innerHTML = markup();
  host.appendChild(el);
  pose(el, 0);
  if (onStart) onStart();
  const t0 = performance.now();
  await new Promise((resolve) => {
    const tick = (now) => {
      const t = (now - t0) / 1000;
      if (t >= DURATION) { resolve(); return; }
      pose(el, t);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  el.remove();
  return true;
}

export const DANCER_SECONDS = DURATION;

// for tests and previews
export const dancerMarkup = markup;
export const dancerPose = pose;
