import * as THREE from 'three';
import { PERIMETER, buildTrackMeshes, sample } from './track.js';
import { Car, CAR_SPEC } from './car.js';
import { AIDriver } from './ai.js';
import { Input, NEUTRAL } from './input.js';
import { buildScenery, SUN_DIR } from './scenery.js';
import { HUD, formatTime } from './hud.js';
import { EngineAudio } from './audio.js';
import { Effects } from './effects.js';
import { renderPortraits } from './portraits.js';
import { createPostFX } from './postfx.js';

const LAP_OPTIONS = [3, 5, 10];
let LAPS = LAP_OPTIONS[0];

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
renderer.toneMappingExposure = 1.05;
document.getElementById('app').appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.4, 3500);

const ANISO = renderer.capabilities.getMaxAnisotropy();
const scenery = buildScenery(scene, ANISO);

// o próprio céu ilumina os materiais: sem isto, tudo que é metálico (a pintura
// dos karts, os cromados, o vidro da torre) reflete preto
const pmrem = new THREE.PMREMGenerator(renderer);
const envMap = pmrem.fromEquirectangular(scenery.sky).texture;
scene.environment = envMap;
pmrem.dispose();

scene.add(buildTrackMeshes(ANISO));

/* ---- luz de fim de tarde: quente, com sombras longas ---- */
// A hemisférica é o que enche as sombras: com ela fraca, tudo que não pega sol
// direto vira silhueta. As intensidades finais são definidas em applyQuality(),
// que compensa quando o céu não está iluminando.
const hemi = new THREE.HemisphereLight(0xa9c6e8, 0x7d6647, 0.55);
scene.add(hemi);

const sun = new THREE.DirectionalLight(0xffd8a8, 2.9);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
const SH = 100;
sun.shadow.camera.left = -SH;
sun.shadow.camera.right = SH;
sun.shadow.camera.top = SH;
sun.shadow.camera.bottom = -SH;
sun.shadow.camera.near = 1;
sun.shadow.camera.far = 700;
sun.shadow.bias = -0.0006;
sun.shadow.normalBias = 0.5;
scene.add(sun, sun.target);

/** O sol acompanha o jogador: sombras nítidas sem um shadow map gigante. */
function updateSun() {
  sun.target.position.set(player.x, 0, player.z);
  sun.position.set(
    player.x + SUN_DIR.x * 210,
    SUN_DIR.y * 210,
    player.z + SUN_DIR.z * 210
  );
  sun.target.updateMatrixWorld();
}

/* ------------------------------------------------------------------ */
/* Pilotos                                                             */
/* ------------------------------------------------------------------ */
// Cada piloto é um animal da fauna brasileira; `kind` define o formato da
// cabeça, `color` a pelagem/kart, `accent` bicos/orelhas/focinhos.
const ANIMALS = [
  { name: 'Onça',        color: 0xd9a441, kind: 'felino',   accent: 0x2a2018, spots: true },
  { name: 'Jaguatirica', color: 0xc17a2e, kind: 'felino',   accent: 0x2a2018, spots: true },
  { name: 'Macaco',      color: 0x7a4f2a, kind: 'macaco',   accent: 0xcaa06a },
  { name: 'Quati',       color: 0x6e4a30, kind: 'quati',    accent: 0xd9c2a0 },
  { name: 'Tucano',      color: 0x17171f, kind: 'tucano',   accent: 0xf5a623 },
  { name: 'Arara',       color: 0x1f6fe0, kind: 'arara',    accent: 0xf5c542 },
  { name: 'Capivara',    color: 0x8a5a2b, kind: 'capivara', accent: 0x5c3a1c },
  { name: 'Tatu',        color: 0xa08e73, kind: 'tatu',     accent: 0x6b5a42 },
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
/* Sistemas                                                            */
/* ------------------------------------------------------------------ */
const hud = new HUD();
const audio = new EngineAudio();
const input = new Input();
const effects = new Effects(scene, cars);

hud.setPortraits(renderPortraits(ANIMALS));

/* ---- qualidade gráfica ----
 * Os dois passes caros são o bloom (reprocessa a tela inteira várias vezes) e
 * o céu como fonte de luz (`scene.environment` custa samples por pixel em todo
 * material). Sombras ficam ligadas nos três níveis: a luz rasante do fim de
 * tarde é metade do visual e sai barato perto dos outros dois.
 * O padrão é "rápido", que roda no mesmo custo do jogo antes desta versão.
 */
const QUALITY = ['alto', 'médio', 'rápido'];
let quality = 2;
let postfx = null;

function applyQuality() {
  const q = QUALITY[quality];
  const useEnv = q !== 'rápido';

  renderer.shadowMap.enabled = true;
  sun.shadow.mapSize.setScalar(q === 'alto' ? 2048 : 1024);
  sun.shadow.map?.dispose();
  sun.shadow.map = null; // força a recriação no tamanho novo

  scene.environment = useEnv ? envMap : null;
  // sem o céu iluminando, a luz ambiente cobre o buraco que ele deixa
  hemi.intensity = useEnv ? 0.55 : 1.35;
  sun.intensity = useEnv ? 2.9 : 3.1;

  const cap = q === 'alto' ? 2 : q === 'médio' ? 1.5 : 1;
  const pr = Math.min(window.devicePixelRatio, cap);
  renderer.setPixelRatio(pr);
  postfx?.setPixelRatio(pr);
  scene.traverse((o) => { if (o.isMesh && o.material) o.material.needsUpdate = true; });
}
applyQuality();

createPostFX(renderer, scene, camera).then((fx) => { postfx = fx; applyQuality(); });
const useBloom = () => postfx && QUALITY[quality] === 'alto';

/* ------------------------------------------------------------------ */
/* Estado da prova                                                     */
/* ------------------------------------------------------------------ */
const CAM_MODES = [
  { name: 'perseguição', dist: 13, height: 5.0, look: 14, cockpit: false },
  { name: 'cabine', dist: 0, height: 0, look: 30, cockpit: true },
  { name: 'afastada', dist: 26, height: 11, look: 12, cockpit: false },
];
let camMode = 0;

// 'menu', 'podium' e 'paused' congelam a simulação; 'countdown', 'racing' e
// 'finish' rodam física.
let state = 'menu';
let pausedFrom = null;
let raceTime = 0;
let countdown = 3.5;
let lightsOn = -1;
let greenUntil = 0;
let finishTimer = 0;
let orbit = 0;
let confettiTimer = 0;

const camTarget = new THREE.Vector3();
const camPos = new THREE.Vector3();
let shake = 0;

// acompanhamento de eventos para os avisos do HUD
let lastPos = null;
let lastLapCount = 0;
let finalLapAnnounced = false;
let gapRef = null;
let gapPrev = 0;
let gapTrend = 0;

function placeGrid() {
  cars.forEach((c, i) => {
    const g = gridSlot(i);
    c.reset(g.u, g.lateral);
  });
  drivers.forEach((d) => d.reset());
  effects.reset();
  shake = 0;
  camPos.set(player.x - player.dirX * 13, 5, player.z - player.dirZ * 13);
  camera.position.copy(camPos);
  camTarget.set(player.x, 1.5, player.z);
}

/* ---- escolhas do jogador (piloto e tamanho da corrida) ---- */
const SAVED_PILOT = 'indy.pilot';
const SAVED_LAPS = 'indy.laps';

const save = (key, value) => {
  try { localStorage.setItem(key, String(value)); } catch { /* modo anônimo */ }
};

function pickPilot(animal) {
  if (animal.name === player.animal.name) return;
  const mine = player.animal;
  const rival = cars.find((c) => !c.isPlayer && c.animal.name === animal.name);
  player.setAppearance(animal);
  rival?.setAppearance(mine); // troca com quem já estava usando esse animal
  save(SAVED_PILOT, animal.name);
}

function pickLaps(n) {
  LAPS = n;
  save(SAVED_LAPS, n);
  hud.setSubtitle(menuSubtitle());
}

try {
  const a = ANIMALS.find((x) => x.name === localStorage.getItem(SAVED_PILOT));
  if (a) pickPilot(a);
  const n = Number(localStorage.getItem(SAVED_LAPS));
  if (LAP_OPTIONS.includes(n)) LAPS = n;
} catch { /* localStorage indisponível */ }

const menuSubtitle = () =>
  `${LAPS} voltas · ${cars.length} karts · você larga em último`;

function showMenu() {
  placeGrid();
  state = 'menu';
  hud.hideCenter();
  scenery.startLights(0);
  hud.showScreen({
    title: 'INDY',
    subtitle: menuSubtitle(),
    cta: 'CORRER',
  });
  hud.buildPicker(ANIMALS, player.animal.name, pickPilot);
  hud.buildLapsPicker(LAP_OPTIONS, LAPS, pickLaps);
}

function startRace() {
  placeGrid();
  raceTime = 0;
  countdown = 3.5;
  lightsOn = -1;
  greenUntil = 0;
  finishTimer = 0;
  lastPos = null;
  lastLapCount = 0;
  finalLapAnnounced = false;
  gapRef = null;
  gapTrend = 0;
  state = 'countdown';
  scenery.hideFlagman();
  hud.hideScreen();
  hud.clearToasts();
}

/** Quem vai dar a bandeirada: de preferência um bicho que não está na prova. */
function pickFlagman() {
  const racing = new Set(cars.map((c) => c.animal.name));
  const outsiders = ANIMALS.filter((a) => !racing.has(a.name));
  const pool = outsiders.length ? outsiders : ANIMALS;
  return pool[Math.floor(Math.random() * pool.length)];
}

function bestLapOverall() {
  let best = null;
  for (const c of cars) if (c.bestLap != null && (best == null || c.bestLap < best)) best = c.bestLap;
  return best;
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
  if (state === 'countdown' || state === 'racing' || state === 'finish') {
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
input.onCamera = () => {
  camMode = (camMode + 1) % CAM_MODES.length;
  hud.toast(`CÂMERA: ${CAM_MODES[camMode].name.toUpperCase()}`, '', 1200);
};
input.onMute = () => hud.toast(audio.toggleMute() ? 'SOM DESLIGADO' : 'SOM LIGADO', '', 1200);
input.onHud = () => document.body.classList.toggle('hide-hud');
input.onQuality = () => {
  quality = (quality + 1) % QUALITY.length;
  applyQuality();
  hud.toast(`GRÁFICOS: ${QUALITY[quality].toUpperCase()}`, '', 1400);
};
input.onFirstInput = () => audio.start();
hud.onStart(() => { audio.start(); startRace(); });
hud.onBack(() => showMenu());

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
      const hard = Math.min(1, (1 - d / minD) * 2.2);
      if (hard > 0.2) {
        effects.impact((a.x + b.x) / 2, 0.55, (a.z + b.z) / 2, hard * 0.6);
      }
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
const _tgt = new THREE.Vector3();

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

  const ratio = Math.max(0, c.speed) / CAR_SPEC.maxSpeed;

  if (m.cockpit) {
    camera.position.set(c.x + c.dirX * 0.1, 1.55 + c.slip * 0.03, c.z + c.dirZ * 0.1);
    camTarget.set(c.x + c.dirX * m.look, 1.75, c.z + c.dirZ * m.look);
    camera.up.set(0, 1, 0);
    camera.lookAt(camTarget);
    camera.rotation.z += c.steer * 0.05;
  } else {
    // a câmera desliza para fora da curva: dá para "ver" a curva antes de entrar
    const rx = c.dirZ, rz = -c.dirX;
    const side = -c.steer * 2.2 * Math.min(1, ratio * 2);
    const k = 1 - Math.exp(-dt * 5.5);
    camPos.set(
      c.x - c.dirX * m.dist + rx * side,
      m.height + ratio * 0.6,
      c.z - c.dirZ * m.dist + rz * side
    );
    camera.position.lerp(camPos, k);
    _tgt.set(c.x + c.dirX * m.look, 1.6, c.z + c.dirZ * m.look);
    camTarget.lerp(_tgt, 1 - Math.exp(-dt * 8));
    camera.lookAt(camTarget);
  }

  if (shake > 0.001) {
    camera.position.x += (Math.random() - 0.5) * shake * 1.6;
    camera.position.y += (Math.random() - 0.5) * shake * 1.0;
    camera.position.z += (Math.random() - 0.5) * shake * 1.6;
  }

  const targetFov = (m.cockpit ? 70 : 60) + 20 * ratio;
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

/** Quanto um rival está colado no seu cotovelo, de cada lado (0..1). */
function sideProximity() {
  let left = 0, right = 0;
  const dirX = player.dirX, dirZ = player.dirZ;
  const rx = dirZ, rz = -dirX;
  for (const c of cars) {
    if (c === player) continue;
    const dx = c.x - player.x, dz = c.z - player.z;
    const fwd = dx * dirX + dz * dirZ;
    const side = dx * rx + dz * rz;
    if (Math.abs(fwd) > 5.5) continue;
    const a = Math.max(0, 1 - (Math.abs(side) - 2.0) / 4.5);
    if (a <= 0) continue;
    if (side > 0) right = Math.max(right, a); else left = Math.max(left, a);
  }
  return { left, right };
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

  // tendência do gap: crescer é sempre bom (abre vantagem ou encosta no da frente)
  if (other !== gapRef) { gapRef = other; gapPrev = gapM; gapTrend = 0; }
  gapTrend = gapTrend * 0.92 + (gapM - gapPrev) * 0.08;
  gapPrev = gapM;
  const gapClosing = Math.abs(gapTrend) < 0.006 ? null : gapTrend > 0;

  const near = sideProximity();
  const last = player.lapTimes.length ? player.lapTimes[player.lapTimes.length - 1] : null;
  const overall = bestLapOverall();

  hud.update({
    lap: Math.max(1, Math.min(LAPS, player.lap + 1)),
    laps: LAPS,
    pos, total: cars.length,
    time: raceTime,
    last,
    best: player.bestLap,
    lastIsPersonalBest: last != null && last === player.bestLap,
    lastIsOverallBest: last != null && overall != null && last === overall,
    gap: gapTxt,
    gapClosing,
    speedKmh: Math.abs(player.speed) * 3.6,
    speedRatio: Math.max(0, player.speed) / CAR_SPEC.maxSpeed,
    cars,
    player,
    leader: sorted[0],
    nearLeft: near.left,
    nearRight: near.right,
  });

  /* ---- avisos ---- */
  if (state === 'racing') {
    if (lastPos != null && pos !== lastPos) {
      if (pos < lastPos) hud.toast(`ULTRAPASSOU · P${pos}`, 'up', 1500);
      else hud.toast(`PERDEU POSIÇÃO · P${pos}`, 'down', 1500);
    }
    lastPos = pos;

    if (player.lapTimes.length > lastLapCount) {
      lastLapCount = player.lapTimes.length;
      const t = player.lapTimes[lastLapCount - 1];
      if (overall != null && t === overall) hud.toast(`MELHOR VOLTA DA PROVA · ${formatTime(t)}`, 'purple', 2400);
      else if (t === player.bestLap) hud.toast(`SUA MELHOR VOLTA · ${formatTime(t)}`, 'up', 2200);
    }

    if (!finalLapAnnounced && player.lap === LAPS - 1) {
      finalLapAnnounced = true;
      scenery.showFlagman(pickFlagman());
      hud.toast('ÚLTIMA VOLTA', 'gold', 2600);
      audio.beep(760, 0.22);
    }
  }
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
    if (state === 'podium') {
      confettiTimer -= dt;
      if (confettiTimer <= 0) {
        confettiTimer = 0.28;
        const w = order()[0];
        effects.confetti(w.x, w.z);
      }
    }
    effects.update(dt, camera);
    scenery.update(dt, state === 'podium' ? 1.6 : 0.3);
    updateSun();
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
    // cinco luzes acendendo de 0,6 em 0,6 s; apagam todas na largada
    const n = countdown > 3.0 ? 0 : Math.min(5, Math.floor((3.0 - countdown) / 0.6) + 1);
    if (n !== lightsOn) {
      lightsOn = n;
      scenery.startLights(n);
      if (n > 0) audio.beep(440, 0.16);
    }
    if (countdown > 0) {
      hud.showCenter(String(Math.min(3, Math.max(1, Math.ceil(countdown)))), 'prepare-se');
    } else {
      state = 'racing';
      raceTime = 0;
      cars.forEach((c) => { c.lapStart = 0; });
      scenery.startLights(0, true);
      greenUntil = 1.6;
      audio.beep(990, 0.5);
      hud.showCenter('VAI!', '');
    }
  } else {
    raceTime += dt;
    if (countdown > -0.7) { countdown -= dt; } else if (state === 'racing') { hud.hideCenter(); }

    if (greenUntil > 0) {
      greenUntil -= dt;
      if (greenUntil <= 0) scenery.startLights(0, false);
    }

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

    // bandeirada: segura o pódio por um instante para o jogador ver a chegada
    if (state === 'racing' && player.finished) {
      state = 'finish';
      finishTimer = 2.4;
      audio.beep(880, 0.6);
      const place = order().indexOf(player) + 1;
      hud.toast(place === 1 ? '🏁 VENCEU!' : `🏁 CHEGOU EM P${place}`, place === 1 ? 'gold' : '', 2600);
      hud.showCenter('BANDEIRADA', place === 1 ? 'você venceu a prova' : `${place}º lugar`);
    } else if (state === 'finish') {
      finishTimer -= dt;
      if (finishTimer <= 0) showPodium();
    }
  }

  // efeitos ligados ao jogador
  for (const c of cars) {
    if (c.wallHit > 0) {
      if (c === player) {
        shake = Math.max(shake, c.wallHit * 0.9);
        audio.crash(c.wallHit);
      }
      effects.impact(c.wallX ?? c.x, 0.6, c.wallZ ?? c.z, c.wallHit);
      c.wallHit = 0;
    }
  }
  if (player.offTrack && Math.abs(player.speed) > 5) shake = Math.max(shake, 0.12);
  shake *= Math.exp(-dt * 4);

  audio.update(Math.abs(player.speed) / CAR_SPEC.maxSpeed, player.offTrack, ctrl.throttle > 0 && state === 'racing');

  updateSun();
  updateCamera(dt);
  updateHud();
  effects.update(dt, camera);
  scenery.update(dt, state === 'racing' ? 0.55 : 0.3);
}

let last = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  step(dt);
  if (useBloom()) postfx.render();
  else renderer.render(scene, camera);
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  postfx?.setSize(window.innerWidth, window.innerHeight);
});

showMenu();
requestAnimationFrame(frame);
