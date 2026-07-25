import * as THREE from 'three';
import { PERIMETER, buildTrackMeshes, sample } from './track.js';
import { Car, CAR_SPEC } from './car.js';
import { AIDriver } from './ai.js';
import { Input, NEUTRAL } from './input.js';
import { buildScenery } from './scenery.js';
import { HUD, formatTime } from './hud.js';
import { EngineAudio } from './audio.js';

const LAPS = 3;

/* ------------------------------------------------------------------ */
/* Renderer / cena                                                     */
/* ------------------------------------------------------------------ */
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.02;
document.getElementById('app').appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.4, 3500);

buildScenery(scene);
scene.add(buildTrackMeshes(renderer.capabilities.getMaxAnisotropy()));

const hemi = new THREE.HemisphereLight(0xbcd8f5, 0x486b3c, 1.1);
scene.add(hemi);

const sun = new THREE.DirectionalLight(0xfff2d8, 2.2);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
const SH = 90;
sun.shadow.camera.left = -SH;
sun.shadow.camera.right = SH;
sun.shadow.camera.top = SH;
sun.shadow.camera.bottom = -SH;
sun.shadow.camera.near = 1;
sun.shadow.camera.far = 500;
sun.shadow.bias = -0.0008;
scene.add(sun, sun.target);

/* ------------------------------------------------------------------ */
/* Carros                                                              */
/* ------------------------------------------------------------------ */
// Cada piloto é um animal da fauna brasileira; `kind` define o formato da
// cabeça, `color` a pelagem/kart, `accent` bicos/orelhas/focinhos.
const ANIMALS = [
  { name: 'Onça',        color: 0xd9a441, kind: 'felino',   accent: 0x2a2018, spots: true },
  { name: 'Jaguatirica', color: 0xc17a2e, kind: 'felino',   accent: 0x2a2018, spots: true },
  { name: 'Macaco',      color: 0x7a4f2a, kind: 'primata',  accent: 0xcaa06a },
  { name: 'Quati',       color: 0x6e4a30, kind: 'primata',  accent: 0xd9c2a0 },
  { name: 'Tucano',      color: 0x17171f, kind: 'ave',      accent: 0xf5a623 },
  { name: 'Arara',       color: 0x1f6fe0, kind: 'ave',      accent: 0xf5c542 },
  { name: 'Capivara',    color: 0x8a5a2b, kind: 'roedor',   accent: 0x5c3a1c },
  { name: 'Tatu',        color: 0xa08e73, kind: 'roedor',   accent: 0x6b5a42 },
  { name: 'Jacaré',      color: 0x3d7a3a, kind: 'reptil',   accent: 0x27551f },
  { name: 'Lobo-guará',  color: 0xc0552a, kind: 'canideo',  accent: 0x1a1a1a },
  { name: 'Tamanduá',    color: 0x4a4a55, kind: 'tamandua', accent: 0xe6e6ea },
  { name: 'Preguiça',    color: 0x9c8f70, kind: 'preguica', accent: 0x5a4c38 },
];

function shuffled(arr) {
  const pool = [...arr];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool;
}

// Grid de largada, da pole para trás. `skill` regula a velocidade de curva da CPU.
// Sorteia os animais: o último da lista sorteada é você.
const CPU_COUNT = 9;
const roster = shuffled(ANIMALS).slice(0, CPU_COUNT + 1);
const GRID = roster.map((a, i) => ({
  name: a.name,
  color: a.color,
  animal: a,
  skill: 0.95 - i * 0.02,
  player: i === CPU_COUNT,
}));

const cars = [];
const drivers = [];
for (const d of GRID) {
  const car = new Car({ color: d.color, name: d.name, animal: d.animal, isPlayer: !!d.player });
  scene.add(car.mesh);
  cars.push(car);
  if (!d.player) drivers.push(new AIDriver(car, d.skill));
}
const player = cars.find((c) => c.isPlayer);

/** Largada em fila dupla: coluna de dentro na frente, como no oval de verdade. */
function gridSlot(i) {
  const row = Math.floor(i / 2), col = i % 2;
  const back = 12 + row * 12 + col * 5; // metros atrás da linha de largada
  return { u: -back / PERIMETER, lateral: col === 0 ? 5.5 : -5.5 };
}

/** Marcação branca (caixa) no asfalto para cada posição de largada. */
function gridBoxTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  g.strokeStyle = '#f2f2f2';
  g.lineWidth = 5;
  g.strokeRect(5, 5, 54, 54);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function gridBoxMesh(u, lateral, texture) {
  const boxLen = 5, boxWidth = 3.6;
  const du = (boxLen / 2) / PERIMETER;
  const a = sample(u - du, lateral - boxWidth / 2, {});
  const b = sample(u - du, lateral + boxWidth / 2, {});
  const c = sample(u + du, lateral - boxWidth / 2, {});
  const d = sample(u + du, lateral + boxWidth / 2, {});
  const pos = [a.x, 0.025, a.z, b.x, 0.025, b.z, c.x, 0.025, c.z, d.x, 0.025, d.z];
  const uv = [0, 0, 0, 1, 1, 0, 1, 1];
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex([0, 1, 2, 2, 1, 3]);
  geo.computeVertexNormals();
  return new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
    map: texture, transparent: true, roughness: 0.9, side: THREE.DoubleSide,
  }));
}

function buildGridMarks() {
  const g = new THREE.Group();
  const tex = gridBoxTexture();
  for (let i = 0; i < GRID.length; i++) {
    const slot = gridSlot(i);
    g.add(gridBoxMesh(slot.u, slot.lateral, tex));
  }
  return g;
}
scene.add(buildGridMarks());

/* ------------------------------------------------------------------ */
/* Estado da prova                                                     */
/* ------------------------------------------------------------------ */
const hud = new HUD();
const audio = new EngineAudio();
const input = new Input();

const CAM_MODES = [
  { name: 'perseguição', dist: 13, height: 5.0, look: 14, cockpit: false },
  { name: 'cabine', dist: 0, height: 0, look: 30, cockpit: true },
  { name: 'afastada', dist: 26, height: 11, look: 12, cockpit: false },
];
let camMode = 0;

// 'menu', 'podium' e 'paused' congelam a simulação; só 'countdown' e 'racing' rodam física.
let state = 'menu';
let pausedFrom = null;
let raceTime = 0;
let countdown = 3.0;
let lastBeep = 4;
let orbit = 0;

const camTarget = new THREE.Vector3();
const camPos = new THREE.Vector3();
let shake = 0;

function placeGrid() {
  cars.forEach((c, i) => {
    const g = gridSlot(i);
    c.reset(g.u, g.lateral);
  });
  drivers.forEach((d) => d.reset());
  shake = 0;
  camPos.set(player.x - player.dirX * 13, 5, player.z - player.dirZ * 13);
  camera.position.copy(camPos);
  camTarget.set(player.x, 1.5, player.z);
}

function showMenu() {
  placeGrid();
  state = 'menu';
  hud.hideCenter();
  hud.showScreen({
    title: 'INDY 500',
    subtitle: `${LAPS} voltas · ${cars.length} carros · você larga em último`,
    cta: 'CORRER',
  });
}

function startRace() {
  placeGrid();
  raceTime = 0;
  countdown = 3.0;
  lastBeep = 4;
  state = 'countdown';
  hud.hideScreen();
}

function showPodium() {
  state = 'podium';
  hud.hideCenter();
  const sorted = order();
  const rows = sorted.map((c, i) => ({
    pos: i + 1,
    name: c.name,
    color: '#' + c.color.toString(16).padStart(6, '0'),
    time: c.finishTime != null ? formatTime(c.finishTime) : `volta ${Math.max(1, c.lap + 1)}`,
    note: c.bestLap != null ? `melhor ${formatTime(c.bestLap)}` : '',
    me: c.isPlayer,
  }));
  const place = sorted.indexOf(player) + 1;
  hud.showScreen({
    title: place === 1 ? 'VITÓRIA!' : `${place}º LUGAR`,
    subtitle: player.bestLap != null
      ? `sua melhor volta: ${formatTime(player.bestLap)}`
      : 'prova encerrada',
    rows,
    cta: 'CORRER DE NOVO',
  });
}

function togglePause() {
  if (state === 'countdown' || state === 'racing') {
    pausedFrom = state;
    state = 'paused';
    hud.showCenter('PAUSADO', 'aperte enter pra continuar');
  } else if (state === 'paused') {
    state = pausedFrom;
    pausedFrom = null;
    hud.hideCenter();
  }
}

input.onRestart = () => startRace();
input.onStart = () => {
  if (state === 'menu' || state === 'podium') startRace();
  else togglePause();
};
input.onCamera = () => { camMode = (camMode + 1) % CAM_MODES.length; };
input.onMute = () => audio.toggleMute();
input.onFirstInput = () => audio.start();
hud.onStart(() => { audio.start(); startRace(); });

/* ------------------------------------------------------------------ */
/* Colisão entre carros                                                */
/* ------------------------------------------------------------------ */
function resolveCollisions() {
  for (let i = 0; i < cars.length; i++) {
    for (let j = i + 1; j < cars.length; j++) {
      const a = cars[i], b = cars[j];
      const dx = b.x - a.x, dz = b.z - a.z;
      const d = Math.hypot(dx, dz);
      const minD = 3.8;
      if (d < 1e-4 || d >= minD) continue;
      const nx = dx / d, nz = dz / d;
      const push = (minD - d) * 0.5;
      a.x -= nx * push; a.z -= nz * push;
      b.x += nx * push; b.z += nz * push;
      const loss = 0.06 + 0.10 * (1 - d / minD);
      a.speed *= 1 - loss;
      b.speed *= 1 - loss;
      if (a.isPlayer || b.isPlayer) {
        shake = Math.max(shake, 0.35);
        audio.crash(0.4);
      }
    }
  }
}

/* ------------------------------------------------------------------ */
/* Câmera                                                              */
/* ------------------------------------------------------------------ */
function updateCamera(dt) {
  const m = CAM_MODES[camMode];
  const c = player;

  if (state === 'menu' || state === 'podium') {
    // órbita lenta: no menu ao redor do seu carro, no pódio ao redor do vencedor
    const focus = state === 'podium' ? order()[0] : player;
    camera.position.set(focus.x + Math.cos(orbit) * 17, 6.5, focus.z + Math.sin(orbit) * 17);
    camera.lookAt(focus.x, 1.1, focus.z);
    camera.fov = 55;
    camera.updateProjectionMatrix();
    return;
  }

  if (state === 'countdown') {
    // giro lento ao redor do carro antes da largada
    const a = c.heading + Math.PI + countdown * 0.55;
    camera.position.set(c.x + Math.cos(a) * 12, 4.5, c.z + Math.sin(a) * 12);
    camera.lookAt(c.x, 1.2, c.z);
    camera.fov = 58;
    camera.updateProjectionMatrix();
    return;
  }

  if (m.cockpit) {
    camera.position.set(c.x + c.dirX * 0.1, 1.55, c.z + c.dirZ * 0.1);
    camTarget.set(c.x + c.dirX * m.look, 1.75, c.z + c.dirZ * m.look);
    camera.up.set(0, 1, 0);
    camera.lookAt(camTarget);
    camera.rotation.z += c.steer * 0.05;
  } else {
    const k = 1 - Math.exp(-dt * 5.5);
    camPos.set(c.x - c.dirX * m.dist, m.height, c.z - c.dirZ * m.dist);
    camera.position.lerp(camPos, k);
    const tgt = new THREE.Vector3(c.x + c.dirX * m.look, 1.6, c.z + c.dirZ * m.look);
    camTarget.lerp(tgt, 1 - Math.exp(-dt * 8));
    camera.lookAt(camTarget);
  }

  if (shake > 0.001) {
    camera.position.x += (Math.random() - 0.5) * shake * 1.6;
    camera.position.y += (Math.random() - 0.5) * shake * 1.0;
    camera.position.z += (Math.random() - 0.5) * shake * 1.6;
  }

  const ratio = Math.max(0, c.speed) / CAR_SPEC.maxSpeed;
  const targetFov = (m.cockpit ? 70 : 60) + 18 * ratio;
  camera.fov += (targetFov - camera.fov) * (1 - Math.exp(-dt * 3));
  camera.updateProjectionMatrix();
}

/* ------------------------------------------------------------------ */
/* HUD                                                                 */
/* ------------------------------------------------------------------ */
function order() {
  return [...cars].sort((a, b) => {
    const fa = a.finishTime ?? Infinity, fb = b.finishTime ?? Infinity;
    if (fa !== fb) return fa - fb;
    return b.progress - a.progress;
  });
}

function updateHud() {
  const sorted = order();
  const idx = sorted.indexOf(player);
  const pos = idx + 1;
  // gap para quem está imediatamente à frente (ou para o 2º, se você lidera)
  const other = idx > 0 ? sorted[idx - 1] : sorted[1];
  const gapM = (player.progress - other.progress) * PERIMETER;
  const ref = Math.max(18, Math.abs(player.speed));
  const gapS = gapM / ref;
  const gapTxt = Math.abs(gapM) > 900
    ? (gapM > 0 ? '+1 volta' : '-1 volta')
    : `${gapM >= 0 ? '+' : '-'}${Math.abs(gapS).toFixed(1)}s`;

  hud.update({
    lap: Math.max(1, Math.min(LAPS, player.lap + 1)),
    laps: LAPS,
    pos, total: cars.length,
    time: raceTime,
    best: player.bestLap,
    gap: gapTxt,
    speedKmh: Math.abs(player.speed) * 3.6,
    speedRatio: Math.max(0, player.speed) / CAR_SPEC.maxSpeed,
    cars,
  });
}

/* ------------------------------------------------------------------ */
/* Loop                                                                */
/* ------------------------------------------------------------------ */
function step(dt) {
  const ctrl = input.poll();

  // menu e pódio: nada de física, só a câmera girando
  if (state === 'menu' || state === 'podium') {
    orbit += dt * 0.22;
    audio.update(0, false, false);
    updateCamera(dt);
    return;
  }

  // pausado: congela tudo, inclusive a câmera, até apertar enter de novo
  if (state === 'paused') {
    audio.update(0, false, false);
    return;
  }

  if (state === 'countdown') {
    countdown -= dt;
    const n = Math.ceil(countdown);
    if (n < lastBeep) {
      lastBeep = n;
      if (n > 0) audio.beep(n === 1 ? 660 : 440, 0.18);
      else audio.beep(990, 0.5);
    }
    if (countdown > 0) {
      hud.showCenter(String(Math.min(3, Math.max(1, n))), 'prepare-se');
    } else {
      state = 'racing';
      raceTime = 0;
      cars.forEach((c) => { c.lapStart = 0; });
      hud.showCenter('VAI!', '');
    }
  } else {
    raceTime += dt;
    if (countdown > -0.7) { countdown -= dt; } else { hud.hideCenter(); }

    player.update(dt, player.finished ? NEUTRAL : ctrl, raceTime);

    for (const d of drivers) {
      const c = d.car;
      // quem já cruzou a linha segue circulando devagar (volta de desaceleração).
      // Parar no meio da pista transformava o carro em obstáculo e engavetava o pelotão.
      const rb = c.finished
        ? -0.38
        : Math.max(-0.05, Math.min(0.06, (player.progress - c.progress) * 0.03));
      c.update(dt, d.update(dt, cars, rb), raceTime);
    }

    resolveCollisions();

    for (const c of cars) {
      if (!c.finished && c.lap >= LAPS) {
        c.finished = true;
        c.finishTime = raceTime;
      }
    }

    if (state === 'racing' && player.finished) {
      audio.beep(880, 0.6);
      showPodium();
    }
  }

  // efeitos ligados ao jogador
  if (player.wallHit > 0) {
    shake = Math.max(shake, player.wallHit * 0.9);
    audio.crash(player.wallHit);
    player.wallHit = 0;
  }
  if (player.offTrack && Math.abs(player.speed) > 5) shake = Math.max(shake, 0.12);
  shake *= Math.exp(-dt * 4);

  audio.update(Math.abs(player.speed) / CAR_SPEC.maxSpeed, player.offTrack, ctrl.throttle > 0 && state === 'racing');

  // a luz do sol acompanha o jogador (sombras nítidas sem mapa gigante)
  sun.target.position.set(player.x, 0, player.z);
  sun.position.set(player.x - 90, 140, player.z + 70);
  sun.target.updateMatrixWorld();

  updateCamera(dt);
  updateHud();
}

let last = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  step(dt);
  renderer.render(scene, camera);
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

showMenu();
requestAnimationFrame(frame);
