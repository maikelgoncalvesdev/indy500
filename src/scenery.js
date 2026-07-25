import * as THREE from 'three';
import { TRACK, PERIMETER, LANDMARKS, sample } from './track.js';

const U_MAIN = LANDMARKS.frontMid;  // meio do front stretch (largada)
const U_BACK = LANDMARKS.backMid;   // meio do back stretch

function crowdTexture() {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = '#2b2f36';
  g.fillRect(0, 0, c.width, c.height);
  const cols = ['#e8e2d8', '#d94f3d', '#3f7fd1', '#f2c43d', '#4caf72', '#efefef', '#8e6ad1'];
  for (let i = 0; i < 2600; i++) {
    g.fillStyle = cols[(Math.random() * cols.length) | 0];
    g.beginPath();
    g.arc(Math.random() * c.width, Math.random() * c.height, 1.6 + Math.random(), 0, Math.PI * 2);
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(6, 1);
  return t;
}

function skyTexture() {
  const c = document.createElement('canvas');
  c.width = 8; c.height = 256;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0.0, '#2c6fb5');
  grad.addColorStop(0.45, '#7db4e2');
  grad.addColorStop(0.72, '#c6ddf0');
  grad.addColorStop(1.0, '#e6eef3');
  g.fillStyle = grad;
  g.fillRect(0, 0, 8, 256);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.mapping = THREE.EquirectangularReflectionMapping;
  return t;
}

function bannerTexture(text) {
  const c = document.createElement('canvas');
  c.width = 1024; c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#12161c';
  g.fillRect(0, 0, c.width, c.height);
  g.fillStyle = '#f5c518';
  g.fillRect(0, 0, c.width, 8);
  g.fillRect(0, c.height - 8, c.width, 8);
  g.fillStyle = '#ffffff';
  g.font = 'bold 74px Consolas, monospace';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, c.width / 2, c.height / 2 + 2);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/**
 * Posiciona um objeto na pista: u, deslocamento lateral, virado para a pista.
 * Com yaw = 0 o eixo X do objeto fica paralelo à pista (arquibancadas, boxes);
 * com yaw = π/2 o eixo X atravessa a pista (pórtico).
 */
function placeOnTrack(obj, u, lateral, yaw = 0) {
  const s = sample(u, lateral, {});
  obj.position.set(s.x, obj.position.y, s.z);
  obj.rotation.y = Math.atan2(s.nx, s.nz) + yaw; // +Z do objeto aponta para a pista
  return obj;
}

function buildGrandstand(len, crowd) {
  const g = new THREE.Group();
  const concrete = new THREE.MeshStandardMaterial({ color: 0xb5b0a6, roughness: 0.95 });
  const steel = new THREE.MeshStandardMaterial({ color: 0x8b929b, roughness: 0.6, metalness: 0.4 });

  const base = new THREE.Mesh(new THREE.BoxGeometry(len, 9, 26), concrete);
  base.position.set(0, 4.5, -14);
  base.castShadow = base.receiveShadow = true;
  g.add(base);

  const seats = new THREE.Mesh(new THREE.BoxGeometry(len - 2, 1.4, 28), new THREE.MeshStandardMaterial({ map: crowd, roughness: 1 }));
  seats.position.set(0, 7.2, -8);
  seats.rotation.x = 0.46;
  seats.castShadow = true;
  g.add(seats);

  const roof = new THREE.Mesh(new THREE.BoxGeometry(len, 0.7, 20), steel);
  roof.position.set(0, 17, -16);
  roof.castShadow = true;
  g.add(roof);

  for (let i = -1; i <= 1; i += 2) {
    const p = new THREE.Mesh(new THREE.BoxGeometry(0.8, 17, 0.8), steel);
    p.position.set(i * (len / 2 - 3), 8.5, -24);
    g.add(p);
  }
  return g;
}

function buildLightPole() {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: 0x9aa2ab, roughness: 0.5, metalness: 0.6 });
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.5, 22, 8), mat);
  pole.position.y = 11;
  pole.castShadow = true;
  const head = new THREE.Mesh(new THREE.BoxGeometry(5, 1.2, 1.2), mat);
  head.position.set(0, 22, 1.4);
  const lamp = new THREE.Mesh(
    new THREE.BoxGeometry(4.6, 0.4, 1),
    new THREE.MeshStandardMaterial({ color: 0xfff6d8, emissive: 0xfff0c0, emissiveIntensity: 0.7 })
  );
  lamp.position.set(0, 21.4, 1.6);
  g.add(pole, head, lamp);
  return g;
}

function buildTyreStack() {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: 0x1c1c1e, roughness: 1 });
  for (let i = 0; i < 3; i++) {
    const t = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.75, 0.55, 14), mat);
    t.position.y = 0.3 + i * 0.55;
    t.castShadow = true;
    g.add(t);
  }
  return g;
}

function buildGantry() {
  const g = new THREE.Group();
  const steel = new THREE.MeshStandardMaterial({ color: 0x9aa2ab, roughness: 0.5, metalness: 0.6 });
  const span = TRACK.wallLat * 2 + 4; // atravessa a pista inteira, apoiado além dos muros
  for (let i = -1; i <= 1; i += 2) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(1.2, 12, 1.2), steel);
    leg.position.set(i * (span / 2), 6, 0);
    leg.castShadow = true;
    g.add(leg);
  }
  const beam = new THREE.Mesh(new THREE.BoxGeometry(span, 1, 1.2), steel);
  beam.position.y = 12.4;
  g.add(beam);

  const board = new THREE.Mesh(
    new THREE.BoxGeometry(span * 0.8, 3.4, 0.4),
    new THREE.MeshStandardMaterial({ map: bannerTexture('INDY 500'), roughness: 0.8 })
  );
  board.position.y = 10.2;
  board.castShadow = true;
  g.add(board);
  return g;
}

function buildPits() {
  const g = new THREE.Group();
  const wall = new THREE.MeshStandardMaterial({ color: 0xd8d4cc, roughness: 0.9 });
  const roofMat = new THREE.MeshStandardMaterial({ color: 0x3a4550, roughness: 0.8 });
  const b = new THREE.Mesh(new THREE.BoxGeometry(190, 7, 16), wall);
  b.position.set(0, 3.5, -10);
  b.castShadow = b.receiveShadow = true;
  const r = new THREE.Mesh(new THREE.BoxGeometry(194, 0.8, 20), roofMat);
  r.position.set(0, 7.4, -8);
  r.castShadow = true;
  g.add(b, r);
  // boxes coloridos
  for (let i = -4; i <= 4; i++) {
    const door = new THREE.Mesh(
      new THREE.BoxGeometry(12, 5, 0.4),
      new THREE.MeshStandardMaterial({ color: new THREE.Color().setHSL((i + 4) / 9, 0.55, 0.5), roughness: 0.7 })
    );
    door.position.set(i * 20, 2.6, -1.7); // à frente da parede, para aparecer da pista
    g.add(door);
  }
  return g;
}

/** Quadrilátero plano (2 triângulos) entre dois pares de pontos (u, lateral). */
function paveQuad(u0, u1, latA0, latB0, latA1, latB1, mat) {
  const a = sample(u0, latA0, {}), b = sample(u0, latB0, {});
  const c = sample(u1, latA1, {}), d = sample(u1, latB1, {});
  const pos = [a.x, 0.025, a.z, b.x, 0.025, b.z, c.x, 0.025, c.z, d.x, 0.025, d.z];
  const uv = [0, 0, 0, 1, 1, 0, 1, 1];
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex([0, 1, 2, 2, 1, 3]);
  geo.computeVertexNormals();
  return new THREE.Mesh(geo, mat);
}

/**
 * Pit lane no interior do front stretch: taper de entrada, trecho reto junto
 * aos boxes e taper de saída, com uma linha branca marcando a entrada.
 */
function buildPitLane() {
  const g = new THREE.Group();
  const pave = new THREE.MeshStandardMaterial({ color: 0x46484c, roughness: 0.95, side: THREE.DoubleSide });
  const line = new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.8, side: THREE.DoubleSide });

  const uEntryStart = -140 / PERIMETER;
  const uEntryEnd = -85 / PERIMETER;
  const uExitStart = 85 / PERIMETER;
  const uExitEnd = 140 / PERIMETER;
  const latIn = TRACK.wallLat + 4;   // borda da pit lane voltada para a pista
  const latOut = TRACK.wallLat + 12; // borda voltada para os boxes

  g.add(paveQuad(uEntryStart, uEntryEnd, latIn, latIn, latIn, latOut, pave));       // taper de entrada
  g.add(paveQuad(uEntryEnd, uExitStart, latIn, latOut, latIn, latOut, pave));       // trecho reto
  g.add(paveQuad(uExitStart, uExitEnd, latIn, latOut, latIn, latIn, pave));         // taper de saída

  // linha branca contínua marcando a entrada dos boxes
  const lw = 0.4;
  g.add(paveQuad(uEntryStart, uExitEnd, latIn - lw, latIn + lw, latIn - lw, latIn + lw, line));

  return g;
}

export function buildScenery(scene) {
  scene.background = skyTexture();
  scene.fog = new THREE.Fog(0xc6ddf0, 900, 2600);

  const world = new THREE.Group();
  world.name = 'scenery';

  // chão
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(5000, 5000),
    new THREE.MeshStandardMaterial({ color: 0x4a7a41, roughness: 1 })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.05;
  ground.receiveShadow = true;
  world.add(ground);

  const crowd = crowdTexture();

  // arquibancadas ao longo das duas retas longas (front stretch e back stretch)
  world.add(placeOnTrack(buildGrandstand(430, crowd), U_MAIN, -(TRACK.wallLat + 18)));
  world.add(placeOnTrack(buildGrandstand(430, crowd), U_BACK, -(TRACK.wallLat + 18)));

  // arquibancadas menores do lado de fora das quatro curvas
  for (const u of [LANDMARKS.turn1, LANDMARKS.turn2, LANDMARKS.turn3, LANDMARKS.turn4]) {
    world.add(placeOnTrack(buildGrandstand(150, crowd), u, -(TRACK.wallLat + 22)));
  }

  // boxes no interior, ao longo do front stretch
  world.add(placeOnTrack(buildPits(), U_MAIN, TRACK.wallLat + 22));

  // pit lane (entrada/saída dos boxes)
  world.add(buildPitLane());

  // pórtico da linha de chegada (atravessando a pista)
  world.add(placeOnTrack(buildGantry(), U_MAIN, 0, Math.PI / 2));

  // postes de luz ao redor de toda a pista
  const POLES = 22;
  for (let i = 0; i < POLES; i++) {
    world.add(placeOnTrack(buildLightPole(), i / POLES, -(TRACK.wallLat + 7)));
  }

  // pilhas de pneus na entrada/saída das quatro curvas
  const dChute = TRACK.shortChute / 2 / PERIMETER; // meia short chute em fração de volta
  for (const u of [LANDMARKS.turn1, LANDMARKS.turn2, LANDMARKS.turn3, LANDMARKS.turn4]) {
    for (let k = -2; k <= 2; k++) {
      world.add(placeOnTrack(buildTyreStack(), u + k * dChute * 0.5, -(TRACK.wallLat + 2.5)));
    }
  }

  // árvores ao fundo
  const trunk = new THREE.MeshStandardMaterial({ color: 0x5a4530, roughness: 1 });
  const leaf = new THREE.MeshStandardMaterial({ color: 0x2f6b34, roughness: 1, flatShading: true });
  for (let i = 0; i < 120; i++) {
    const a = (i / 120) * Math.PI * 2 + Math.random() * 0.05;
    const rad = 560 + Math.random() * 900;
    const x = Math.cos(a) * rad * 1.3;
    const z = Math.sin(a) * rad;
    const h = 8 + Math.random() * 9;
    const t = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.7, h * 0.4, 6), trunk);
    t.position.set(x, h * 0.2, z);
    const c = new THREE.Mesh(new THREE.ConeGeometry(3.2 + Math.random() * 1.6, h, 7), leaf);
    c.position.set(x, h * 0.4 + h / 2, z);
    world.add(t, c);
  }

  scene.add(world);
  return world;
}
