// The little dancer: a 3D man in a chokha who hops onto the table, dances for a
// few seconds and hops off again. Built from primitives with three.js, which is
// only downloaded the first time he is needed.

let three = null;
let rig = null; // { renderer, scene, camera, canvas, parts }
const DURATION = 4.0; // seconds, enter + dance + exit

const clamp01 = (x) => Math.min(1, Math.max(0, x));
const lerp = (a, b, t) => a + (b - a) * t;
const easeOut = (t) => 1 - (1 - t) ** 3;
const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);

async function load() {
  if (!three) three = await import('three');
  return three;
}

function build(THREE) {
  const mat = (color, rough = 0.75, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: 0.0, ...extra });
  const M = {
    chokha: mat(0x3b1c24), chokhaDark: mat(0x241218), trouser: mat(0x1b1b20), boot: mat(0x0f0f12, 0.5),
    skin: mat(0xe8b48c, 0.7), cheek: mat(0xe98a7a, 0.8), hair: mat(0x15110f, 0.9), fur: mat(0x16130f, 1),
    cream: mat(0xf1e8d2, 0.6), gold: mat(0xd9a93e, 0.35, { metalness: 0.6 }), silver: mat(0xcfd3d8, 0.3, { metalness: 0.7 }),
    red: mat(0x9b1c1c), white: mat(0xffffff, 0.4), eye: mat(0x14110f, 0.3),
  };
  const mesh = (geo, m, x = 0, y = 0, z = 0) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); o.castShadow = false; return o; };
  const cyl = (rt, rb, h, m, seg = 20) => mesh(new THREE.CylinderGeometry(rt, rb, h, seg), m);

  const root = new THREE.Group(); // moves across the table
  const spin = new THREE.Group(); // turns around the vertical axis
  root.add(spin);
  const pelvis = new THREE.Group(); // bobs up and down
  spin.add(pelvis);

  // legs: hip -> thigh -> knee -> shin -> boot
  const legs = [-1, 1].map((side) => {
    const hip = new THREE.Group();
    hip.position.set(side * 0.12, 0, 0);
    const thigh = cyl(0.085, 0.075, 0.4, M.trouser); thigh.position.y = -0.2; hip.add(thigh);
    const knee = new THREE.Group(); knee.position.y = -0.4; hip.add(knee);
    const shin = cyl(0.07, 0.06, 0.4, M.trouser); shin.position.y = -0.2; knee.add(shin);
    const boot = cyl(0.075, 0.085, 0.24, M.boot); boot.position.set(0, -0.4, 0.015); knee.add(boot);
    const toe = mesh(new THREE.SphereGeometry(0.085, 16, 12), M.boot, 0, -0.5, 0.06); toe.scale.set(1, 0.55, 1.35); knee.add(toe);
    pelvis.add(hip);
    return { hip, knee };
  });

  // the chokha: flared skirt with a gold hem, belt, dagger
  const skirt = cyl(0.23, 0.42, 0.55, M.chokha, 32); skirt.position.y = -0.2; pelvis.add(skirt);
  const hem = mesh(new THREE.TorusGeometry(0.42, 0.018, 8, 40), M.gold, 0, -0.47, 0); hem.rotation.x = Math.PI / 2; pelvis.add(hem);
  const inner = cyl(0.22, 0.24, 0.1, M.cream, 24); inner.position.y = 0.0; pelvis.add(inner);
  const belt = mesh(new THREE.TorusGeometry(0.235, 0.03, 8, 32), M.gold, 0, 0.04, 0); belt.rotation.x = Math.PI / 2; pelvis.add(belt);
  const buckle = mesh(new THREE.BoxGeometry(0.07, 0.07, 0.03), M.gold, 0, 0.04, 0.245); pelvis.add(buckle);
  const dagger = new THREE.Group(); dagger.position.set(0.1, 0.0, 0.25); dagger.rotation.z = 0.6;
  dagger.add(mesh(new THREE.BoxGeometry(0.05, 0.3, 0.018), M.silver, 0, -0.17, 0));
  dagger.add(mesh(new THREE.BoxGeometry(0.06, 0.12, 0.03), M.gold, 0, 0.0, 0));
  pelvis.add(dagger);

  // torso, chest gazyrs, collar
  const torso = new THREE.Group(); torso.position.y = 0.06; pelvis.add(torso);
  torso.add(mesh(new THREE.CylinderGeometry(0.25, 0.22, 0.6, 28), M.chokha, 0, 0.3, 0));
  torso.add(mesh(new THREE.BoxGeometry(0.1, 0.5, 0.03), M.cream, 0, 0.3, 0.238));
  for (const side of [-1, 1]) {
    for (let i = 0; i < 5; i++) {
      const x = side * (0.085 + i * 0.038);
      const z = Math.sqrt(Math.max(0.0001, 0.245 * 0.245 - x * x));
      const g = new THREE.Group(); g.position.set(x, 0.36, z); g.rotation.y = Math.atan2(x, z); g.rotation.z = -side * 0.07;
      g.add(cyl(0.022, 0.022, 0.17, M.cream, 10));
      g.add(mesh(new THREE.CylinderGeometry(0.026, 0.026, 0.025, 10), M.gold, 0, 0.09, 0));
      g.add(mesh(new THREE.CylinderGeometry(0.026, 0.026, 0.02, 10), M.gold, 0, -0.09, 0));
      torso.add(g);
    }
  }
  const collar = mesh(new THREE.TorusGeometry(0.1, 0.03, 8, 20), M.cream, 0, 0.62, 0); collar.rotation.x = Math.PI / 2; torso.add(collar);
  torso.add(cyl(0.065, 0.075, 0.1, M.skin, 14)).position.y = 0.66;

  // head: face, moustache, papakha
  const head = new THREE.Group(); head.position.y = 0.88; torso.add(head);
  head.add(mesh(new THREE.SphereGeometry(0.19, 28, 22), M.skin));
  for (const s of [-1, 1]) {
    head.add(mesh(new THREE.SphereGeometry(0.024, 12, 10), M.eye, s * 0.072, 0.035, 0.172));
    const brow = mesh(new THREE.BoxGeometry(0.075, 0.016, 0.02), M.hair, s * 0.075, 0.09, 0.172); brow.rotation.z = s * -0.18; head.add(brow);
    const cheek = mesh(new THREE.SphereGeometry(0.034, 12, 10), M.cheek, s * 0.115, -0.035, 0.14); cheek.scale.set(1, 0.7, 0.5); head.add(cheek);
    const ear = mesh(new THREE.SphereGeometry(0.04, 10, 8), M.skin, s * 0.185, 0, 0); ear.scale.set(0.5, 1, 0.8); head.add(ear);
    const mo = new THREE.Mesh(new THREE.CapsuleGeometry(0.018, 0.1, 4, 10), M.hair);
    mo.position.set(s * 0.06, -0.062, 0.18); mo.rotation.z = Math.PI / 2 + s * 0.45; head.add(mo);
  }
  head.add(mesh(new THREE.SphereGeometry(0.036, 14, 12), M.skin, 0, -0.01, 0.19));
  const mouth = mesh(new THREE.TorusGeometry(0.05, 0.008, 6, 16, Math.PI), M.red, 0, -0.085, 0.172); mouth.rotation.z = Math.PI; head.add(mouth);
  // papakha: a low, fluffy fur cap (faceted sphere), not a top hat
  const cap = new THREE.Group(); cap.position.y = 0.17; head.add(cap);
  const fur = mesh(new THREE.IcosahedronGeometry(0.245, 2), M.fur); fur.scale.set(1, 0.78, 1); cap.add(fur);
  const band = mesh(new THREE.TorusGeometry(0.2, 0.05, 10, 30), M.fur, 0, -0.1, 0); band.rotation.x = Math.PI / 2; cap.add(band);
  const tuft = mesh(new THREE.CircleGeometry(0.075, 20), M.red, 0, 0.19, 0); tuft.rotation.x = -Math.PI / 2; cap.add(tuft);

  // arms: shoulder -> upper -> elbow -> forearm -> hand (long chokha sleeves)
  const arms = [-1, 1].map((side) => {
    const shoulder = new THREE.Group(); shoulder.position.set(side * 0.3, 0.52, 0); torso.add(shoulder);
    shoulder.add(mesh(new THREE.SphereGeometry(0.085, 14, 12), M.chokha));
    const upper = cyl(0.07, 0.08, 0.32, M.chokha, 14); upper.position.y = -0.16; shoulder.add(upper);
    const elbow = new THREE.Group(); elbow.position.y = -0.32; shoulder.add(elbow);
    elbow.add(mesh(new THREE.SphereGeometry(0.075, 12, 10), M.chokha));
    const fore = cyl(0.08, 0.115, 0.34, M.chokha, 14); fore.position.y = -0.17; elbow.add(fore);
    const cuff = mesh(new THREE.TorusGeometry(0.115, 0.014, 6, 20), M.gold, 0, -0.34, 0); cuff.rotation.x = Math.PI / 2; elbow.add(cuff);
    elbow.add(mesh(new THREE.SphereGeometry(0.062, 14, 12), M.skin, 0, -0.4, 0));
    return { shoulder, elbow };
  });

  // soft contact shadow
  const shadow = mesh(new THREE.CircleGeometry(0.45, 28), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.32, depthWrite: false }));
  shadow.rotation.x = -Math.PI / 2; shadow.position.y = 0.005;

  return { root, spin, pelvis, legs, skirt, hem, torso, head, arms, shadow };
}

async function ensureRig(width, height) {
  const THREE = await load();
  if (!rig) {
    const canvas = document.createElement('canvas');
    canvas.className = 'dancer-canvas';
    const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, premultipliedAlpha: true });
    renderer.setClearColor(0x000000, 0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    const scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight(0xfff2dd, 0x4a3320, 1.55));
    const sun = new THREE.DirectionalLight(0xfff0d0, 2.2); sun.position.set(2.5, 5, 4); scene.add(sun);
    const rim = new THREE.DirectionalLight(0xffc27a, 0.9); rim.position.set(-3, 2, -3); scene.add(rim);
    const parts = build(THREE);
    scene.add(parts.shadow);
    scene.add(parts.root);
    const camera = new THREE.PerspectiveCamera(28, 1, 0.1, 50);
    rig = { THREE, renderer, scene, camera, canvas, parts };
  }
  rig.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  rig.renderer.setSize(width, height, false);
  rig.canvas.style.width = `${width}px`;
  rig.canvas.style.height = `${height}px`;
  rig.camera.aspect = width / height;
  rig.camera.position.set(0, 1.45, 6.3);
  rig.camera.lookAt(0, 1.02, 0);
  rig.camera.updateProjectionMatrix();
  return rig;
}

export function webglAvailable() {
  try { const c = document.createElement('canvas'); return !!(c.getContext('webgl2') || c.getContext('webgl')); } catch { return false; }
}

// Poses are eased toward their targets every frame, so phase changes look smooth.
function makeState() {
  return { ax: 0.2, az: 0.1, bend: 0, lean: 0, flare: 1, kneel: 0, lift: 0, wave: 0 };
}

function frame(parts, st, t, dt) {
  const T = DURATION;
  const enterEnd = 0.95, glideEnd = 1.75, spinEnd = 2.6, kneelEnd = 3.15;
  const ease = (cur, target, rate = 16) => cur + (target - cur) * (1 - Math.exp(-dt * rate));

  let x = 0, hop = 0, face = 0;
  let armUp = 0.15, armFlap = 0, bend = 0, lift = 0, kneel = 0, lean = 0, flare = 1, wave = 0;

  if (t < enterEnd) {                                     // hop in from the left
    const p = t / enterEnd;
    x = lerp(-3.7, -0.15, easeOut(p));
    hop = Math.abs(Math.sin(p * Math.PI * 4)) * 0.2;
    armUp = 0.5; armFlap = 0.25 * Math.sin(t * 18);
    bend = 0.25 * Math.abs(Math.cos(p * Math.PI * 4));
  } else if (t < glideEnd) {                              // toe-stepping, arms like wings
    const k = t - enterEnd;
    x = -0.15 + 0.5 * Math.sin(k * 5.2);
    hop = 0.06 + 0.05 * Math.abs(Math.sin(k * 14));
    armUp = 1.45; armFlap = 0.22 * Math.sin(k * 11);
    lift = Math.sin(k * 11);
    lean = 0.1 * Math.sin(k * 5.2);
    face = 0.35 * Math.sin(k * 5.2);
  } else if (t < spinEnd) {                               // two fast turns, skirt flaring
    const p = (t - glideEnd) / (spinEnd - glideEnd);
    x = 0.35 - 0.35 * easeInOut(p);
    face = easeInOut(p) * Math.PI * 4;
    armUp = 1.55; armFlap = 0.12 * Math.sin(t * 20);
    hop = 0.1 * Math.sin(p * Math.PI);
    flare = 1 + 0.32 * Math.sin(p * Math.PI);
    lean = 0.06;
  } else if (t < kneelEnd) {                              // drop to one knee, arms thrown up
    const p = (t - spinEnd) / (kneelEnd - spinEnd);
    kneel = easeOut(clamp01(p * 2));
    armUp = 2.5 - 0.15 * Math.sin(t * 16); armFlap = 0.15 * Math.sin(t * 16);
    lean = -0.12;
  } else if (t < T - 0.65) {                              // bounce back up and clap
    const p = (t - kneelEnd) / (T - 0.65 - kneelEnd);
    kneel = 1 - easeOut(clamp01(p * 3));
    armUp = lerp(2.4, 1.0, clamp01(p * 2)); armFlap = 0.18 * Math.sin(t * 22);
    hop = 0.14 * Math.abs(Math.sin(p * Math.PI * 2));
  } else {                                                // hop out to the right, waving
    const p = (t - (T - 0.65)) / 0.65;
    x = lerp(-0.15, 3.8, easeInOut(p));
    hop = Math.abs(Math.sin(p * Math.PI * 4)) * 0.2;
    armUp = 0.3; wave = 1;
    bend = 0.2 * Math.abs(Math.cos(p * Math.PI * 4));
    face = -0.4 * Math.sin(p * Math.PI);
  }

  st.az = ease(st.az, armUp); st.ax = ease(st.ax, armFlap, 30);
  st.bend = ease(st.bend, bend); st.lift = ease(st.lift, lift, 24); st.kneel = ease(st.kneel, kneel, 22);
  st.lean = ease(st.lean, lean); st.flare = ease(st.flare, flare, 20); st.wave = ease(st.wave, wave);

  const { root, spin, pelvis, legs, skirt, hem, torso, head, arms, shadow } = parts;
  const pop = Math.min(1, t / 0.18) * Math.min(1, (T - t) / 0.12);
  root.scale.setScalar(Math.max(0.001, pop));
  root.position.x = x;
  spin.rotation.y = face;
  shadow.position.x = x;
  shadow.scale.setScalar(Math.max(0.2, 1 - hop * 1.3) * pop * (1 + st.kneel * 0.1));

  // legs: squat, toe-step, kneel
  const b = st.bend;
  const stand = 0.82 * Math.cos(0.9 * b);
  const kneelDrop = 0.36 * st.kneel;
  pelvis.position.y = stand - kneelDrop + hop;
  legs.forEach((leg, i) => {
    const alt = i === 0 ? 1 : -1;
    const stepLift = Math.max(0, st.lift * alt) * 0.55;
    // left leg stays forward, right leg goes down on the knee
    const kneelThigh = i === 0 ? -1.15 : -0.05;
    const kneelShin = i === 0 ? 1.15 : 1.75;
    leg.hip.rotation.x = lerp(-0.9 * b - stepLift, kneelThigh, st.kneel);
    leg.knee.rotation.x = lerp(1.8 * b + stepLift * 1.3, kneelShin, st.kneel);
  });
  skirt.scale.set(st.flare, 1, st.flare);
  hem.scale.set(st.flare, st.flare, 1);

  torso.rotation.z = st.lean;
  torso.rotation.x = -0.05 - st.kneel * 0.1;
  head.rotation.z = -st.lean * 0.6 + 0.08 * Math.sin(t * 9);
  head.rotation.y = 0.18 * Math.sin(t * 6);

  arms.forEach((arm, i) => {
    const side = i === 0 ? -1 : 1;
    let z = st.az;
    if (st.wave > 0.01 && side === 1) z = lerp(z, 2.4 + 0.3 * Math.sin(t * 20), st.wave);
    arm.shoulder.rotation.z = side * z;
    arm.shoulder.rotation.x = side * st.ax * 0.6;
    arm.elbow.rotation.z = side * (0.2 + 0.35 * Math.sin(t * 13 + i * 1.7) * Math.min(1, st.az));
  });
}

// Plays one dance. `box` is the table's rectangle on screen. Resolves when he has left.
export async function playDancer(box, onStart) {
  if (!webglAvailable()) return false;
  const width = Math.round(Math.min(Math.max(box.width, 360), 760));
  const height = Math.round(Math.min(Math.max(box.height * 0.8, 300), 420));
  const r = await ensureRig(width, height);
  const host = document.getElementById('fx');
  r.canvas.style.left = `${box.left + box.width / 2 - width / 2}px`;
  r.canvas.style.top = `${box.top + box.height * 0.56 - height * 0.62}px`;
  host.appendChild(r.canvas);

  const st = makeState();
  if (onStart) onStart();
  const t0 = performance.now();
  let last = t0;
  await new Promise((resolve) => {
    const tick = (now) => {
      const t = (now - t0) / 1000;
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      if (t >= DURATION) { resolve(); return; }
      frame(r.parts, st, t, dt);
      r.renderer.render(r.scene, r.camera);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  r.canvas.remove();
  return true;
}

export const DANCER_SECONDS = DURATION;
