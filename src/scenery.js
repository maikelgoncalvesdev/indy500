import * as THREE from 'three';
import { TRACK, PERIMETER, LANDMARKS, PIT, sample, pitBounds, asphaltTexture } from './track.js';
import { flattenByMaterial, bakeGeometry } from './meshutil.js';
import { buildAnimalHead, animalMaterials, torsoGeometry } from './car.js';

const U_MAIN = LANDMARKS.frontMid;  // meio do front stretch (largada)
const U_BACK = LANDMARKS.backMid;   // meio do back stretch

/** Extensão das garagens; as caixas demarcadas na pit lane usam a mesma. */
const PIT_SPAN = PIT.boxes * 16;

/**
 * Direção do sol, ~47° de elevação. Mais baixo que isso e a arquibancada do
 * front stretch (17 m de telhado, a 18 m do muro) joga a própria sombra em
 * cima da reta principal — que é justamente onde o jogador passa mais tempo
 * olhando. A 47° a sombra dela morre antes do asfalto.
 */
export const SUN_DIR = new THREE.Vector3(-120, 150, 70).normalize();

function crowdTexture() {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#3a3e46';
  g.fillRect(0, 0, c.width, c.height);
  // fileiras de assentos, para a multidão ter estrutura e não virar confete
  g.fillStyle = 'rgba(0,0,0,0.28)';
  for (let y = 0; y < c.height; y += 16) g.fillRect(0, y, c.width, 4);
  const cols = ['#cfc9bf', '#b8453a', '#3467a8', '#c9a232', '#3f8f5e', '#dedede', '#6f52a5', '#2c2f36'];
  for (let i = 0; i < 9000; i++) {
    g.fillStyle = cols[(Math.random() * cols.length) | 0];
    g.beginPath();
    g.arc(Math.random() * c.width, Math.random() * c.height, 1.3 + Math.random() * 0.9, 0, Math.PI * 2);
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/** Uma cópia da textura de torcida com densidade proporcional ao tamanho. */
function crowdFor(base, len, aniso) {
  const t = base.clone();
  t.needsUpdate = true;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(Math.max(2, Math.round(len / 11)), 1);
  t.anisotropy = aniso;
  return t;
}

function grassTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#4d7440';
  g.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 4200; i++) {
    const v = 34 + Math.random() * 52;
    g.fillStyle = `rgba(${v * 0.72 | 0},${v + 28 | 0},${v * 0.5 | 0},${0.16 + Math.random() * 0.3})`;
    g.fillRect(Math.random() * 128, Math.random() * 128, 2, 2 + Math.random() * 3);
  }
  // manchas maiores quebram o padrão de repetição do gramado
  for (let i = 0; i < 24; i++) {
    g.fillStyle = `rgba(${30 + Math.random() * 30 | 0},${60 + Math.random() * 40 | 0},30,0.16)`;
    g.beginPath();
    g.ellipse(Math.random() * 128, Math.random() * 128, 8 + Math.random() * 22, 6 + Math.random() * 16, Math.random() * 3, 0, Math.PI * 2);
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(160, 160);
  return t;
}

/**
 * Céu equirretangular pintado no canvas: gradiente de fim de tarde, banco de
 * nuvens e o disco do sol na mesma direção de SUN_DIR. Também alimenta o
 * PMREM que ilumina os materiais metálicos.
 */
function skyTexture() {
  const W = 1024, H = 512;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');

  // y = H/2 é o horizonte; a faixa quente do pôr do sol tem de ficar ACIMA
  // dele, senão o gradiente bonito acaba escondido pelo chão
  const grad = g.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0.00, '#0d3068');  // zênite
  grad.addColorStop(0.24, '#2d6cad');
  grad.addColorStop(0.36, '#6ba3cc');
  grad.addColorStop(0.43, '#a9c4d6');
  grad.addColorStop(0.47, '#e2c294');  // faixa quente do fim de tarde
  grad.addColorStop(0.495, '#f3ad66');
  grad.addColorStop(0.500, '#e89f5c'); // horizonte
  grad.addColorStop(0.60, '#9c7248');
  grad.addColorStop(1.00, '#5d452f');
  g.fillStyle = grad;
  g.fillRect(0, 0, W, H);

  // posição do sol na projeção equirretangular (flipY da CanvasTexture já
  // considerado: y cresce para baixo enquanto v cresce para cima)
  const d = SUN_DIR;
  const sx = ((Math.atan2(d.z, d.x) / (Math.PI * 2)) + 0.5) * W;
  const sy = (1 - (Math.asin(d.y) / Math.PI + 0.5)) * H;

  // nuvens: aglomerados de elipses, achatados e menores perto do horizonte
  const cloud = (cx, cy, t) => {
    const warm = Math.min(1, Math.max(0, 1 - Math.abs(cx - sx) / 300));
    const scale = (10 + Math.random() * 26) * (1.3 - 0.75 * t);
    for (let k = 0; k < 6; k++) {
      const a = (0.06 + Math.random() * 0.13) * (0.55 + 0.45 * (1 - t));
      g.fillStyle = warm > 0.15
        ? `rgba(255,${226 - warm * 30 | 0},${200 - warm * 40 | 0},${a * (1 + warm * 0.5)})`
        : `rgba(246,249,253,${a})`;
      g.beginPath();
      g.ellipse(
        cx + (Math.random() - 0.5) * scale * 2.4,
        cy + (Math.random() - 0.5) * scale * 0.45,
        scale * (0.55 + Math.random() * 0.75),
        scale * (0.42 - 0.3 * t),
        0, 0, Math.PI * 2
      );
      g.fill();
    }
  };
  for (let i = 0; i < 150; i++) {
    const t = Math.pow(Math.random(), 0.55); // 0 = zênite, 1 = horizonte
    cloud(Math.random() * W, 22 + t * 218, t);
  }

  // halo e disco do sol por cima das nuvens, para o sol furar o banco
  const R = 120;
  const halo = g.createRadialGradient(sx, sy, 0, sx, sy, R);
  halo.addColorStop(0.00, 'rgba(255,247,222,0.85)');
  halo.addColorStop(0.10, 'rgba(255,216,150,0.40)');
  halo.addColorStop(0.36, 'rgba(255,196,128,0.14)');
  halo.addColorStop(1.00, 'rgba(255,196,128,0)');
  g.save();
  g.globalCompositeOperation = 'lighter';
  for (const off of [-W, 0, W]) { // repete na costura para não cortar o halo
    g.save();
    g.translate(off, 0);
    g.fillStyle = halo;
    g.fillRect(sx - R, sy - R, R * 2, R * 2);
    g.restore();
  }
  g.restore();
  g.fillStyle = '#fffdf4';
  g.beginPath();
  g.arc(sx, sy, 13, 0, Math.PI * 2);
  g.fill();

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

function checkerTexture(cols = 6, rows = 4) {
  const c = document.createElement('canvas');
  c.width = 96; c.height = 64;
  const g = c.getContext('2d');
  for (let i = 0; i < cols; i++) {
    for (let j = 0; j < rows; j++) {
      g.fillStyle = (i + j) % 2 ? '#101010' : '#f2f2f2';
      g.fillRect((i * c.width) / cols, (j * c.height) / rows, c.width / cols, c.height / rows);
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/**
 * Posiciona um objeto na pista: u, deslocamento lateral, virado para a pista.
 * Com yaw = 0 o eixo X do objeto fica paralelo à pista (arquibancadas, boxes);
 * com yaw = π/2 o eixo X atravessa a pista.
 */
function placeOnTrack(obj, u, lateral, yaw = 0) {
  const s = sample(u, lateral, {});
  obj.position.set(s.x, obj.position.y, s.z);
  obj.rotation.y = Math.atan2(s.nx, s.nz) + yaw; // +Z do objeto aponta para a pista
  return obj;
}

function buildGrandstand(len, crowd, aniso) {
  const g = new THREE.Group();
  const concrete = new THREE.MeshStandardMaterial({ color: 0xa8a297, roughness: 0.95 });
  const steel = new THREE.MeshStandardMaterial({ color: 0x8b9098, roughness: 0.6, metalness: 0.4 });

  const base = new THREE.Mesh(new THREE.BoxGeometry(len, 9, 26), concrete);
  base.position.set(0, 4.5, -14);
  base.castShadow = base.receiveShadow = true;
  g.add(base);

  const seats = new THREE.Mesh(new THREE.BoxGeometry(len - 2, 1.4, 28), new THREE.MeshStandardMaterial({ map: crowdFor(crowd, len, aniso), roughness: 1 }));
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

  return flattenByMaterial(g);
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
    new THREE.MeshStandardMaterial({ color: 0xfff6d8, emissive: 0xfff0c0, emissiveIntensity: 1.6 })
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

/**
 * Semáforo de largada: cinco luzes vermelhas que acendem
 * uma a uma na contagem e apagam de uma vez na largada, quando a barra verde
 * pisca. Devolve `set(n, green)` para main.js dirigir a sequência.
 */
function buildStartLights() {
  const g = new THREE.Group();
  const N = 5;
  const panel = new THREE.Mesh(
    new THREE.BoxGeometry(N * 1.9 + 0.9, 2.6, 0.5),
    new THREE.MeshStandardMaterial({ color: 0x101318, roughness: 0.85 })
  );
  panel.castShadow = true;
  g.add(panel);

  const bulbs = [];
  for (let i = 0; i < N; i++) {
    const socket = new THREE.Mesh(
      new THREE.CylinderGeometry(0.7, 0.7, 0.22, 16),
      new THREE.MeshStandardMaterial({ color: 0x07090c, roughness: 0.9 })
    );
    socket.rotation.x = Math.PI / 2;
    socket.position.set((i - (N - 1) / 2) * 1.9, 0, 0.32);
    g.add(socket);

    const bulb = new THREE.Mesh(
      new THREE.CircleGeometry(0.56, 20),
      new THREE.MeshStandardMaterial({
        color: 0x2a0d0d, emissive: 0xff1a1a, emissiveIntensity: 0, roughness: 0.4,
      })
    );
    bulb.position.set(socket.position.x, 0, 0.45);
    g.add(bulb);
    bulbs.push(bulb);
  }

  const green = new THREE.Mesh(
    new THREE.BoxGeometry(N * 1.9 - 0.4, 0.34, 0.16),
    new THREE.MeshStandardMaterial({
      color: 0x0d2410, emissive: 0x21ff5a, emissiveIntensity: 0, roughness: 0.4,
    })
  );
  green.position.set(0, -1.55, 0.4);
  g.add(green);

  g.userData.set = (n, greenOn = false) => {
    for (let i = 0; i < N; i++) {
      const on = i < n;
      bulbs[i].material.emissiveIntensity = on ? 3.2 : 0;
      bulbs[i].material.color.setHex(on ? 0xff5555 : 0x2a0d0d);
    }
    green.material.emissiveIntensity = greenOn ? 3.4 : 0;
    green.material.color.setHex(greenOn ? 0x63ff8f : 0x0d2410);
  };
  g.userData.set(0);
  return g;
}

/** Bandeira quadriculada num mastro, com a ondulação congelada na malha. */
function buildFlag(w, h, mat) {
  const flag = new THREE.Mesh(new THREE.PlaneGeometry(w, h, 12, 1), mat);
  const pos = flag.geometry.attributes.position;
  for (let v = 0; v < pos.count; v++) {
    pos.setZ(v, Math.sin((pos.getX(v) + w / 2) * 1.6) * 0.26);
  }
  pos.needsUpdate = true;
  flag.geometry.computeVertexNormals();
  flag.castShadow = true;
  return flag;
}

/**
 * Torre de bandeirada, na lateral da pista, na altura da linha de chegada: é
 * dela que sai a bandeirada. Leva o semáforo de largada num braço que avança
 * sobre a borda do asfalto — o pórtico que atravessava a pista não cabia mais,
 * porque agora a pit lane se bifurca por baixo dele.
 *
 * Montada com +Z apontando para a pista.
 */
function buildFlagStand() {
  const g = new THREE.Group();
  const steel = new THREE.MeshStandardMaterial({ color: 0x9aa2ab, roughness: 0.5, metalness: 0.4 });
  const concrete = new THREE.MeshStandardMaterial({ color: 0xbdb8ae, roughness: 0.95 });
  const deckMat = new THREE.MeshStandardMaterial({ color: 0x2f3841, roughness: 0.8 });

  // pilar e plataforma
  const base = new THREE.Mesh(new THREE.BoxGeometry(3.4, 6.4, 3.4), concrete);
  base.position.y = 3.2;
  base.castShadow = base.receiveShadow = true;
  g.add(base);

  const deck = new THREE.Mesh(new THREE.BoxGeometry(6.2, 0.35, 4.6), deckMat);
  deck.position.y = 6.6;
  deck.castShadow = true;
  g.add(deck);

  // guarda-corpo: um tubo corrido sobre quatro montantes
  for (const [x, z] of [[-3, 2.2], [3, 2.2], [-3, -2.2], [3, -2.2]]) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 1.1, 6), steel);
    post.position.set(x, 7.35, z);
    g.add(post);
  }
  for (const [w, d, x, z] of [[6.2, 0.12, 0, 2.2], [6.2, 0.12, 0, -2.2], [0.12, 4.4, -3, 0], [0.12, 4.4, 3, 0]]) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(w, 0.09, d), steel);
    rail.position.set(x, 7.9, z);
    g.add(rail);
  }

  // cobertura, apoiada nos quatro cantos da plataforma
  for (const [x, z] of [[-2.8, 2], [2.8, 2], [-2.8, -2], [2.8, -2]]) {
    const col = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 2.9, 6), steel);
    col.position.set(x, 8.4, z);
    g.add(col);
  }
  const roof = new THREE.Mesh(new THREE.BoxGeometry(6.8, 0.22, 5.2), deckMat);
  roof.position.set(0, 9.95, 0);
  roof.castShadow = true;
  g.add(roof);

  // letreiro na face do pilar, virado para a pista
  const board = new THREE.Mesh(
    new THREE.BoxGeometry(3.2, 0.85, 0.2),
    new THREE.MeshStandardMaterial({ map: bannerTexture('INDY'), roughness: 0.8 })
  );
  board.position.set(0, 4.6, 1.78);
  board.castShadow = true;
  g.add(board);

  // braço em balanço até a borda do asfalto, com o semáforo pendurado na ponta
  const reach = TRACK.wallLat - TRACK.halfWidth + 3.4;
  const arm = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, reach), steel);
  arm.position.set(0, 9.3, reach / 2 + 1.7);
  arm.castShadow = true;
  g.add(arm);
  const stay = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, reach * 0.75, 6), steel);
  stay.position.set(0, 8.3, reach / 2 + 1.4);
  stay.rotation.x = Math.PI / 2 - 0.36;
  stay.castShadow = true;
  g.add(stay);
  const hanger = new THREE.Mesh(new THREE.BoxGeometry(0.24, 1.5, 0.24), steel);
  hanger.position.set(0, 8.6, reach + 1.5);
  g.add(hanger);

  const lights = buildStartLights();
  // o painel encara quem se aproxima: −X local é o sentido de onde vêm os
  // carros, então ele gira um quarto de volta em relação à torre
  lights.rotation.y = Math.PI / 2;
  lights.position.set(0, 7.5, reach + 1.5);
  g.add(lights);
  g.userData.startLights = lights;

  // bandeiras quadriculadas, uma de cada lado da cobertura
  const flagMat = new THREE.MeshStandardMaterial({
    map: checkerTexture(), roughness: 0.9, side: THREE.DoubleSide,
  });
  for (const i of [-1, 1]) {
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 3.4, 6), steel);
    mast.position.set(i * 3.2, 11.4, 1.6);
    mast.castShadow = true;
    g.add(mast);
    const flag = buildFlag(3, 1.9, flagMat);
    flag.position.set(i * 4.7, 12.2, 1.6);
    g.add(flag);
  }

  // balcão em balanço à frente da torre: é dele que sai a bandeirada. Fica
  // fora da cobertura, senão o mastro atravessaria o teto ao ser agitado.
  const BX = -2.1, BZ = 3.6;
  const balcony = new THREE.Mesh(new THREE.BoxGeometry(3.0, 0.24, 2.2), deckMat);
  balcony.position.set(BX, 6.63, BZ);
  balcony.castShadow = true;
  g.add(balcony);
  for (const sx of [-1, 1]) {
    const brace = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 2.4, 6), steel);
    brace.position.set(BX + sx * 1.3, 5.85, BZ - 0.5);
    brace.rotation.x = -0.72;
    brace.castShadow = true;
    g.add(brace);
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 1.0, 6), steel);
    post.position.set(BX + sx * 1.4, 7.25, BZ + 1.0);
    g.add(post);
  }
  const frontRail = new THREE.Mesh(new THREE.BoxGeometry(3.0, 0.09, 0.12), steel);
  frontRail.position.set(BX, 7.7, BZ + 1.0);
  g.add(frontRail);

  // lugar do bandeirinha no balcão, virado para a pista (+Z)
  const marshalSlot = new THREE.Group();
  marshalSlot.position.set(BX, 6.75, BZ);
  g.add(marshalSlot);
  g.userData.marshalSlot = marshalSlot;

  return g;
}

/**
 * Bandeirinha: um bicho em pé na torre agitando a quadriculada. A espécie é
 * sorteada a cada corrida e ele só entra em cena na última volta.
 * Montado olhando para +Z, como o resto da torre.
 */
let _marshalCloth = null;

function buildFlagMarshal(animal) {
  const g = new THREE.Group();
  const { coat, tail, fur, accMat, white } = animalMaterials(animal);
  const pole = new THREE.MeshStandardMaterial({ color: 0xd8d4cc, roughness: 0.5, metalness: 0.3 });
  if (!_marshalCloth) {
    _marshalCloth = new THREE.MeshStandardMaterial({
      map: checkerTexture(5, 3), roughness: 0.9, side: THREE.DoubleSide,
    });
  }

  const add = (geo, mat, x, y, z, parent = g) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    parent.add(m);
    return m;
  };

  // pernas: coxa, joelho, canela e pé — em pé, levemente afastadas
  for (const sx of [1, -1]) {
    const leg = new THREE.Group();
    leg.position.set(sx * 0.24, 0.9, 0);
    leg.rotation.z = sx * 0.06;
    g.add(leg);
    add(new THREE.CapsuleGeometry(0.15, 0.26, 4, 10), fur, 0, -0.1, 0.02, leg);
    add(new THREE.SphereGeometry(0.13, 10, 8), fur, 0, -0.36, 0, leg);
    add(new THREE.CapsuleGeometry(0.11, 0.26, 4, 10), fur, 0, -0.58, -0.02, leg);
    add(new THREE.SphereGeometry(0.15, 10, 8), fur, 0, -0.8, 0.08, leg).scale.set(1, 0.55, 1.7);
  }

  // tronco e ventre claro (mesmo torso dos pilotos)
  const body = new THREE.Group();
  body.position.set(0, 1.3, 0);
  g.add(body);
  add(torsoGeometry(0.44), fur, 0, 0, 0, body);
  add(new THREE.SphereGeometry(0.3, 14, 10), coat === 'pena' ? accMat : white, 0, -0.06, 0.18, body)
    .scale.set(0.9, 1.15, 0.55);
  add(new THREE.CapsuleGeometry(0.17, 0.12, 4, 10), fur, 0, 0.44, 0.03, body);

  // cauda, acompanhando uma curva (aves e capivara ficam sem)
  if (tail) {
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, 1.15, -0.3),
      new THREE.Vector3(0.04, 0.95, -0.66),
      new THREE.Vector3(0.12, 1.0, -0.98),
      new THREE.Vector3(0.2, 1.3, -1.1),
    ]);
    for (let i = 0; i <= 8; i++) {
      const p = curve.getPoint(i / 8);
      add(new THREE.SphereGeometry(0.13 - 0.08 * (i / 8), 10, 8), fur, p.x, p.y, p.z);
    }
  }

  // cabeça da espécie (a mesma malha dos pilotos)
  const head = buildAnimalHead(animal);
  head.position.set(0, 1.98, 0.06);
  g.add(head);

  g.scale.setScalar(1.2); // lido de longe, da pista

  // braço parado: ombro, cotovelo e mão ao longo do corpo
  const idle = new THREE.Group();
  idle.position.set(-0.46, 1.62, 0.04);
  idle.rotation.set(0.25, 0, -0.2);
  g.add(idle);
  add(new THREE.SphereGeometry(0.15, 12, 10), fur, 0, 0, 0, idle);
  add(new THREE.CapsuleGeometry(0.1, 0.3, 4, 10), fur, 0, -0.26, 0, idle);
  add(new THREE.CapsuleGeometry(0.085, 0.26, 4, 10), fur, 0, -0.58, 0.04, idle);
  add(new THREE.SphereGeometry(0.12, 10, 8), accMat, 0, -0.8, 0.06, idle);

  // braço da bandeirada: pivô no ombro, tudo o que se move pendura aqui
  const arm = new THREE.Group();
  arm.position.set(0.46, 1.62, 0.06);
  g.add(arm);
  add(new THREE.SphereGeometry(0.15, 12, 10), fur, 0, 0, 0, arm);
  add(new THREE.CapsuleGeometry(0.1, 0.34, 4, 10), fur, 0, 0.3, 0, arm);
  add(new THREE.CapsuleGeometry(0.085, 0.28, 4, 10), fur, 0, 0.64, 0, arm);
  add(new THREE.SphereGeometry(0.13, 12, 10), accMat, 0, 0.86, 0.02, arm);

  // mastro na mão, com o pano pendurado de lado
  add(new THREE.CylinderGeometry(0.05, 0.05, 1.9, 8), pole, 0, 1.45, 0.02, arm);
  const clothPivot = new THREE.Group();
  clothPivot.position.set(0, 2.3, 0.02);
  arm.add(clothPivot);
  const flag = buildFlag(1.7, 1.15, _marshalCloth);
  flag.position.set(0.9, -0.35, 0);
  clothPivot.add(flag);

  /** Aceno: braço varre de um lado ao outro e o pano vem atrasado. */
  g.userData.wave = (t) => {
    arm.rotation.z = Math.sin(t * 7) * 1.05;
    arm.rotation.x = Math.sin(t * 3.5) * 0.14;
    clothPivot.rotation.z = Math.sin(t * 7 - 0.7) * 0.4;
    idle.rotation.x = 0.25 + Math.sin(t * 3.5 + 1.2) * 0.2;
    body.rotation.y = Math.sin(t * 3.5) * 0.13;
    head.rotation.y = Math.sin(t * 3.5 + 0.5) * 0.18;
    head.rotation.z = Math.sin(t * 7) * 0.06;
  };
  return g;
}

/** Torre de controle (a "pagoda" do Indy), marco visual do front stretch. */
function buildTower() {
  const g = new THREE.Group();
  const shell = new THREE.MeshStandardMaterial({ color: 0xe6e2d8, roughness: 0.85 });
  const glass = new THREE.MeshStandardMaterial({
    color: 0x2c4a63, roughness: 0.15, metalness: 0.75, envMapIntensity: 1.4,
  });
  const trim = new THREE.MeshStandardMaterial({ color: 0x2f3a45, roughness: 0.7 });

  const core = new THREE.Mesh(new THREE.BoxGeometry(9, 46, 9), shell);
  core.position.y = 23;
  core.castShadow = core.receiveShadow = true;
  g.add(core);

  // andares em balanço com telhado, empilhados
  for (let i = 0; i < 4; i++) {
    const y = 16 + i * 9;
    const w = 15 - i * 1.4;
    const floor = new THREE.Mesh(new THREE.BoxGeometry(w, 4.2, w), glass);
    floor.position.y = y;
    floor.castShadow = true;
    const roof = new THREE.Mesh(new THREE.BoxGeometry(w + 2.4, 0.6, w + 2.4), trim);
    roof.position.y = y + 2.6;
    roof.castShadow = true;
    g.add(floor, roof);
  }

  const cap = new THREE.Mesh(new THREE.ConeGeometry(6.5, 6, 4), trim);
  cap.position.y = 49;
  cap.rotation.y = Math.PI / 4;
  cap.castShadow = true;
  g.add(cap);
  return flattenByMaterial(g);
}

/**
 * Garagens dos boxes. A origem do grupo é a FACHADA (z = 0) e o prédio cresce
 * para +Z, que é o sentido de afastar-se da pista — assim ele encosta na pit
 * lane em vez de ficar por cima dela.
 */
function buildPits(len, boxes) {
  const g = new THREE.Group();
  const wall = new THREE.MeshStandardMaterial({ color: 0xc6c1b8, roughness: 0.9 });
  const roofMat = new THREE.MeshStandardMaterial({ color: 0x44505c, roughness: 0.8 });
  const steel = new THREE.MeshStandardMaterial({ color: 0x8b9098, roughness: 0.6, metalness: 0.4 });

  const b = new THREE.Mesh(new THREE.BoxGeometry(len, 6.5, 15), wall);
  b.position.set(0, 3.25, 7.5);
  b.castShadow = b.receiveShadow = true;
  g.add(b);

  // marquise avançando sobre a pit lane, apoiada em pilares
  const r = new THREE.Mesh(new THREE.BoxGeometry(len + 3, 0.6, 12), roofMat);
  r.position.set(0, 6.9, 8);
  r.castShadow = true;
  g.add(r);

  const step = len / boxes;
  for (let i = 0; i < boxes; i++) {
    const x = -len / 2 + step * (i + 0.5);
    // porta da garagem, embutida na fachada
    const door = new THREE.Mesh(
      new THREE.BoxGeometry(step * 0.62, 4.4, 0.35),
      new THREE.MeshStandardMaterial({ color: new THREE.Color().setHSL(i / boxes, 0.5, 0.46), roughness: 0.7 })
    );
    door.position.set(x, 2.3, -0.1);
    door.castShadow = true;
    g.add(door);

    // pilar da marquise entre uma garagem e outra
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.4, 6.6, 0.4), steel);
    post.position.set(x + step / 2, 3.3, 2.2);
    post.castShadow = true;
    g.add(post);
  }
  return flattenByMaterial(g);
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

/** Faixa pavimentada entre dois `u`, com laterais que podem variar nas pontas. */
function pavedStrip(m0, m1, a0, b0, a1, b1, mat, y = 0.026, steps = 14) {
  const pos = [], uv = [], idx = [];
  const p = {}, q = {};
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const u = (m0 + (m1 - m0) * t) / PERIMETER;
    sample(u, a0 + (a1 - a0) * t, p);
    sample(u, b0 + (b1 - b0) * t, q);
    pos.push(p.x, y, p.z, q.x, y, q.z);
    uv.push(t, 0, t, 1);
  }
  for (let i = 0; i < steps; i++) {
    const k = i * 2;
    idx.push(k, k + 2, k + 1, k + 2, k + 3, k + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return new THREE.Mesh(g, mat);
}

/** Fita de asfalto entre duas laterais dadas como função de m. */
function boundedStrip(m0, m1, fa, fb, mat, y, steps) {
  const pos = [], uv = [], idx = [];
  const p = {}, q = {};
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const m = m0 + (m1 - m0) * t;
    sample(m / PERIMETER, fa(m), p);
    sample(m / PERIMETER, fb(m), q);
    pos.push(p.x, y, p.z, q.x, y, q.z);
    uv.push(t * ((m1 - m0) / 14), 0, t * ((m1 - m0) / 14), 1);
  }
  for (let i = 0; i < steps; i++) {
    const k = i * 2;
    idx.push(k, k + 2, k + 1, k + 2, k + 3, k + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  const mesh = new THREE.Mesh(g, mat);
  mesh.receiveShadow = true;
  return mesh;
}

/**
 * Murinho ao longo da pista entre `m0` e `m1`. `lat` aceita número (lateral
 * fixa) ou função de m — é assim que o muro externo acompanha a borda da
 * bifurcação enquanto ela abre.
 */
function sideWall(m0, m1, lat, height, mat, steps = 60) {
  const pos = [], uv = [], idx = [];
  const p = {};
  const f = typeof lat === 'function' ? lat : () => lat;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const m = m0 + (m1 - m0) * t;
    sample(m / PERIMETER, f(m), p);
    pos.push(p.x, 0, p.z, p.x, height, p.z);
    uv.push(t * ((m1 - m0) / 7), 0, t * ((m1 - m0) / 7), 1);
  }
  for (let i = 0; i < steps; i++) {
    const k = i * 2;
    idx.push(k, k + 2, k + 1, k + 2, k + 3, k + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  const mesh = new THREE.Mesh(g, mat);
  mesh.castShadow = mesh.receiveShadow = true;
  return mesh;
}

/**
 * A pit lane é uma bifurcação da pista principal: mesma largura, mesmo
 * asfalto, encostada nela. Nas duas pontas as pistas se tocam — é por ali que
 * se entra e se sai; no meio um muro divisor separa as duas.
 */
function buildPitLane(aniso) {
  const g = new THREE.Group();
  const pave = new THREE.MeshStandardMaterial({
    map: asphaltTexture(aniso, Math.round((PIT.flareOut - PIT.flareIn) / 14)),
    roughness: 0.93, metalness: 0.02, side: THREE.DoubleSide,
  });
  const line = new THREE.MeshStandardMaterial({ color: 0xf0f0ee, roughness: 0.8, side: THREE.DoubleSide });
  const yellow = new THREE.MeshStandardMaterial({ color: 0xe8c23a, roughness: 0.85, side: THREE.DoubleSide });
  const wallMat = new THREE.MeshStandardMaterial({ color: 0xd6d2ca, roughness: 0.85, side: THREE.DoubleSide });

  const { flareIn, flareOut, entryStart, exitEnd, wallStart, wallEnd, divider, inner, outer, boxes } = PIT;
  const lw = 0.35;
  const edge = (m) => pitBounds(m)[1];   // borda externa, que abre nas pontas

  // asfalto da bifurcação: nasce colado na pista e abre até a largura cheia
  g.add(boundedStrip(flareIn, flareOut, () => TRACK.halfWidth, edge, pave, 0.021, 110));

  // muro divisor entre as duas pistas (uma face para cada lado) e muro externo
  g.add(sideWall(wallStart, wallEnd, divider, 1.05, wallMat, 70));
  g.add(sideWall(wallStart, wallEnd, inner, 1.05, wallMat, 70));
  g.add(sideWall(flareIn, flareOut, edge, 1.15, wallMat, 110));

  // linha branca ao longo do muro divisor, do lado da pit lane
  g.add(pavedStrip(wallStart, wallEnd, inner + 1.2, inner + 1.2 + lw, inner + 1.2, inner + 1.2 + lw, line, 0.028, 40));
  // linha amarela de limite de velocidade, junto às garagens
  g.add(pavedStrip(entryStart, exitEnd, outer - 2.2, outer - 2.2 + lw, outer - 2.2, outer - 2.2 + lw, yellow, 0.028, 60));

  // caixas dos boxes: uma em frente a cada garagem, com o mesmo passo delas
  const step = PIT_SPAN / boxes;
  for (let i = 0; i < boxes; i++) {
    const c = -PIT_SPAN / 2 + step * (i + 0.5);
    const half = step * 0.34;
    const far = outer - 2.2, near = outer - 8.5;
    for (const s of [-1, 1]) {  // laterais da caixa
      g.add(pavedStrip(c + s * half - lw, c + s * half + lw, near, far, near, far, line, 0.028, 2));
    }
    g.add(pavedStrip(c - half, c + half, near, near + lw * 2, near, near + lw * 2, line, 0.028, 2));
  }

  return g;
}

/**
 * Replica um objeto ao longo da pista como InstancedMesh — uma por material
 * usado no protótipo. Cada slot é `{u, lat}`, orientado como em placeOnTrack.
 */
function instanceAlongTrack(proto, slots, castShadow = true) {
  const mats = [];
  proto.traverse((o) => { if (o.isMesh && !mats.includes(o.material)) mats.push(o.material); });

  const out = [];
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const p = new THREE.Vector3();
  const one = new THREE.Vector3(1, 1, 1);
  const s = {};

  for (const mat of mats) {
    const geo = bakeGeometry(proto, mat);
    if (!geo) continue;
    const inst = new THREE.InstancedMesh(geo, mat, slots.length);
    inst.castShadow = castShadow;
    slots.forEach((slot, i) => {
      sample(slot.u, slot.lat, s);
      p.set(s.x, 0, s.z);
      q.setFromAxisAngle(up, Math.atan2(s.nx, s.nz));
      inst.setMatrixAt(i, m.compose(p, q, one));
    });
    inst.instanceMatrix.needsUpdate = true;
    out.push(inst);
  }
  return out;
}

/**
 * Bosque ao fundo em duas InstancedMesh (tronco + copa). Uma árvore virava
 * dois draw calls; assim são dois no total, o que permite triplicar a
 * densidade sem custo.
 */
function buildTrees(count = 420) {
  const trunkGeo = new THREE.CylinderGeometry(0.5, 0.7, 1, 6);
  const leafGeo = new THREE.ConeGeometry(1, 1, 7);
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x4b3826, roughness: 1 });
  const leafMat = new THREE.MeshStandardMaterial({ color: 0x2c5f31, roughness: 1, flatShading: true });

  const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, count);
  const leaves = new THREE.InstancedMesh(leafGeo, leafMat, count);
  // Sem sombra: a mata fica a 470 m+ e o shadow map cobre ~100 m ao redor do
  // carro, então ela nunca projetaria nada visível. Como InstancedMesh não faz
  // culling por instância, deixá-la marcada custaria a árvore inteira em todo
  // passe de sombra, de graça.
  trunks.castShadow = leaves.castShadow = false;
  trunks.instanceMatrix.setUsage(THREE.StaticDrawUsage);
  leaves.instanceMatrix.setUsage(THREE.StaticDrawUsage);

  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const p = new THREE.Vector3();
  const s = new THREE.Vector3();
  const tint = new THREE.Color();

  for (let i = 0; i < count; i++) {
    // agrupa em bosques em vez de espalhar uniformemente: cada punhado de
    // árvores compartilha um ângulo-base, o que dá manchas de mata
    const a = (Math.floor(i / 7) / Math.ceil(count / 7)) * Math.PI * 2 + (Math.random() - 0.5) * 0.16;
    const rad = 470 + Math.random() * 820;
    const x = Math.cos(a) * rad * 1.35;
    const z = Math.sin(a) * rad;
    const h = 8 + Math.random() * 11;
    const r = 3.0 + Math.random() * 1.9;
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.random() * Math.PI);

    p.set(x, h * 0.2, z);
    s.set(1, h * 0.4, 1);
    trunks.setMatrixAt(i, m.compose(p, q, s));

    p.set(x, h * 0.4 + h / 2, z);
    s.set(r, h, r);
    leaves.setMatrixAt(i, m.compose(p, q, s));

    // variação de tom para a mata não virar um bloco chapado
    tint.setHSL(0.29 + Math.random() * 0.06, 0.34 + Math.random() * 0.16, 0.19 + Math.random() * 0.12);
    leaves.setColorAt(i, tint);
  }
  trunks.instanceMatrix.needsUpdate = true;
  leaves.instanceMatrix.needsUpdate = true;
  if (leaves.instanceColor) leaves.instanceColor.needsUpdate = true;
  return [trunks, leaves];
}

/**
 * Flashes de câmera na arquibancada: pontos aditivos que acendem e apagam em
 * ordem aleatória. Custa um único draw call e dá vida à multidão estática.
 */
function buildCrowdFlashes(spots) {
  const N = spots.length;
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(N * 3);
  const alpha = new Float32Array(N);
  spots.forEach((s, i) => {
    pos[i * 3] = s.x; pos[i * 3 + 1] = s.y; pos[i * 3 + 2] = s.z;
    alpha[i] = 0;
  });
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aAlpha', new THREE.BufferAttribute(alpha, 1));

  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: { uSize: { value: 130 } },
    vertexShader: `
      attribute float aAlpha;
      varying float vAlpha;
      uniform float uSize;
      void main() {
        vAlpha = aAlpha;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = uSize / max(1.0, -mv.z);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      varying float vAlpha;
      void main() {
        float d = length(gl_PointCoord - vec2(0.5));
        if (d > 0.5) discard;
        float f = smoothstep(0.5, 0.0, d);
        gl_FragColor = vec4(vec3(1.0, 0.97, 0.9), f * vAlpha);
      }`,
  });

  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  const life = new Float32Array(N);

  points.userData.update = (dt, intensity) => {
    const a = geo.attributes.aAlpha;
    for (let i = 0; i < N; i++) {
      if (life[i] > 0) {
        life[i] -= dt * 7;
        a.array[i] = Math.max(0, life[i]);
      } else if (Math.random() < dt * 2.2 * intensity) {
        life[i] = 1;
        a.array[i] = 1;
      }
    }
    a.needsUpdate = true;
  };
  return points;
}

export function buildScenery(scene, aniso = 4) {
  const sky = skyTexture();
  scene.background = sky;
  scene.fog = new THREE.FogExp2(0xd8b98f, 0.0004);

  const world = new THREE.Group();
  world.name = 'scenery';

  // chão
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(5000, 5000),
    new THREE.MeshStandardMaterial({ map: grassTexture(), roughness: 1 })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.05;
  ground.receiveShadow = true;
  world.add(ground);

  const crowd = crowdTexture();
  const flashSpots = [];

  /** Semeia pontos de flash sobre a área de torcida de uma arquibancada. */
  const seedFlashes = (u, lateral, len, n) => {
    for (let i = 0; i < n; i++) {
      const along = (Math.random() - 0.5) * len;
      const s = sample(u + along / PERIMETER, lateral - 4 - Math.random() * 12, {});
      flashSpots.push({ x: s.x, y: 8 + Math.random() * 7, z: s.z });
    }
  };

  // arquibancadas ao longo das duas retas longas (front stretch e back stretch)
  const mainLat = -(TRACK.wallLat + 18);
  world.add(placeOnTrack(buildGrandstand(430, crowd, aniso), U_MAIN, mainLat));
  world.add(placeOnTrack(buildGrandstand(430, crowd, aniso), U_BACK, mainLat));
  seedFlashes(U_MAIN, mainLat, 420, 70);
  seedFlashes(U_BACK, mainLat, 420, 40);

  // arquibancadas menores do lado de fora das quatro curvas
  for (const u of [LANDMARKS.turn1, LANDMARKS.turn2, LANDMARKS.turn3, LANDMARKS.turn4]) {
    world.add(placeOnTrack(buildGrandstand(150, crowd, aniso), u, -(TRACK.wallLat + 22)));
    seedFlashes(u, -(TRACK.wallLat + 22), 140, 16);
  }

  world.add(buildCrowdFlashes(flashSpots));

  // boxes no interior, ao longo do front stretch
    // garagens: fachada encostada na borda externa da pit lane
  world.add(placeOnTrack(buildPits(PIT_SPAN, PIT.boxes), U_MAIN, PIT.outer + 0.5));

  // torre de controle atrás dos boxes
  world.add(placeOnTrack(buildTower(), U_MAIN + 0.055, PIT.outer + 30));

  // pit lane (entrada/saída dos boxes)
  world.add(buildPitLane(aniso));

  // torre de bandeirada na lateral externa, na linha de chegada
  const flagStand = placeOnTrack(buildFlagStand(), U_MAIN, -(TRACK.wallLat + 3));
  world.add(flagStand);

  // postes de luz e pilhas de pneus se repetem dezenas de vezes: viram
  // InstancedMesh (2 e 1 draw calls no lugar de 126)
  const POLES = 22;
  const poleSlots = [];
  for (let i = 0; i < POLES; i++) poleSlots.push({ u: i / POLES, lat: -(TRACK.wallLat + 7) });
  for (const m of instanceAlongTrack(buildLightPole(), poleSlots)) world.add(m);

  const dChute = TRACK.shortChute / 2 / PERIMETER; // meia short chute em fração de volta
  const tyreSlots = [];
  for (const u of [LANDMARKS.turn1, LANDMARKS.turn2, LANDMARKS.turn3, LANDMARKS.turn4]) {
    for (let k = -2; k <= 2; k++) {
      tyreSlots.push({ u: u + k * dChute * 0.5, lat: -(TRACK.wallLat + 2.5) });
    }
  }
  // pneus não projetam sombra: são baixos, ficam colados no muro e o ganho
  // visual não paga o passe extra (InstancedMesh não é cortado por instância)
  for (const m of instanceAlongTrack(buildTyreStack(), tyreSlots, false)) world.add(m);

  // mata ao fundo
  for (const m of buildTrees()) world.add(m);

  scene.add(world);

  const flashes = world.children.find((c) => c.isPoints);

  // bandeirinha: montado só quando a última volta começa, e desmontado no
  // início da corrida seguinte (a espécie muda a cada prova)
  const marshalSlot = flagStand.userData.marshalSlot;
  let marshal = null;
  let waveT = 0;

  const dropMarshal = () => {
    if (!marshal) return;
    marshalSlot.remove(marshal);
    // as texturas (pelagem e quadriculado) são cacheadas e compartilhadas:
    // aqui só somem as malhas e os materiais deste bicho
    marshal.traverse((o) => {
      if (!o.isMesh) return;
      o.geometry?.dispose();
      if (o.material !== _marshalCloth) o.material?.dispose();
    });
    marshal = null;
  };

  return {
    world,
    sky,
    startLights: flagStand.userData.startLights.userData.set,
    /** Põe o bicho `animal` na torre dando bandeirada. */
    showFlagman(animal) {
      dropMarshal();
      waveT = 0;
      marshal = buildFlagMarshal(animal);
      marshalSlot.add(marshal);
    },
    hideFlagman: dropMarshal,
    /** `excitement` 0..1 modula a frequência dos flashes na arquibancada. */
    update(dt, excitement = 0.35) {
      flashes?.userData.update(dt, excitement);
      if (marshal) {
        waveT += dt;
        marshal.userData.wave(waveT);
      }
    },
  };
}
