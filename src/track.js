import * as THREE from 'three';

/**
 * Traçado do Indianapolis Motor Speedway: não é um oval "estádio", e sim um
 * retângulo arredondado — duas retas longas (front/back stretch), QUATRO curvas
 * de 90° e duas retas curtas ("short chutes") ligando as curvas de cada ponta.
 * Toda a geometria é derivada destes números (aqui em ~metade da escala real,
 * mantendo as proporções: reta ≈ 5×short chute, raio ≈ 1/4 da reta).
 */
export const TRACK = {
  longStraight: 520,  // front stretch e back stretch (m)
  shortChute: 120,    // reta curta entre as duas curvas de cada ponta (m)
  radius: 125,        // raio das 4 curvas de 90° (m)
  width: 26,          // largura do asfalto (m)
  apron: 7,           // faixa de grama entre o asfalto e o muro (m)
  wallHeight: 3.4,
};
TRACK.halfWidth = TRACK.width / 2;
TRACK.wallLat = TRACK.halfWidth + TRACK.apron;

const R = TRACK.radius;
const HALF = Math.PI / 2;
const ARC = HALF * R;                    // comprimento de um arco de 90°
const Xr = TRACK.longStraight / 2;       // |X| onde as retas longas viram curva
const Zr = TRACK.shortChute / 2;         // |Z| onde as short chutes viram curva
const W2 = Xr + R;                        // meia-extensão externa em X (centerline)
const H2 = Zr + R;                        // meia-extensão externa em Z (centerline)

TRACK.halfExtentX = W2;
TRACK.halfExtentZ = H2;

/**
 * A pista é uma lista de segmentos percorridos com as curvas à esquerda (como
 * no IMS), largada no meio do front stretch (reta de cima, Z = +H2). Cada arco
 * varre 90° com o ângulo DECRESCENTE (a0 → a0 − 90°). Cada segmento guarda seu
 * início acumulado `s0` (em metros) e o comprimento.
 */
const SEGMENTS = [];
let _acc = 0;
function pushLine(x0, z0, dx, dz, len) {
  SEGMENTS.push({ type: 'line', s0: _acc, len, x0, z0, dx, dz });
  _acc += len;
}
function pushArc(cx, cz, a0) {
  SEGMENTS.push({ type: 'arc', s0: _acc, len: ARC, cx, cz, a0 });
  _acc += ARC;
}

// largada no meio do front stretch (Z = +H2), seguindo para +X, curvas à esquerda
pushLine(0, H2, 1, 0, Xr);                     // front stretch — 1ª metade
pushArc(Xr, Zr, HALF);                         // curva 1 (canto superior-direito)
pushLine(W2, Zr, 0, -1, TRACK.shortChute);     // short chute direita
pushArc(Xr, -Zr, 0);                           // curva 2 (canto inferior-direito)
pushLine(Xr, -H2, -1, 0, TRACK.longStraight);  // back stretch (reta de baixo)
pushArc(-Xr, -Zr, -HALF);                      // curva 3 (canto inferior-esquerdo)
pushLine(-W2, -Zr, 0, 1, TRACK.shortChute);    // short chute esquerda
pushArc(-Xr, Zr, Math.PI);                     // curva 4 (canto superior-esquerdo)
pushLine(-Xr, H2, 1, 0, Xr);                   // front stretch — 2ª metade (fecha)

export const PERIMETER = _acc;

/** u (fração de volta) do meio de cada trecho, para posicionar cenário. */
export const LANDMARKS = {
  frontMid: 0,
  turn1: (SEGMENTS[1].s0 + ARC / 2) / PERIMETER,
  rightChute: (SEGMENTS[2].s0 + TRACK.shortChute / 2) / PERIMETER,
  turn2: (SEGMENTS[3].s0 + ARC / 2) / PERIMETER,
  backMid: (SEGMENTS[4].s0 + TRACK.longStraight / 2) / PERIMETER,
  turn3: (SEGMENTS[5].s0 + ARC / 2) / PERIMETER,
  leftChute: (SEGMENTS[6].s0 + TRACK.shortChute / 2) / PERIMETER,
  turn4: (SEGMENTS[7].s0 + ARC / 2) / PERIMETER,
};

function segmentAt(s) {
  for (let i = 0; i < SEGMENTS.length; i++) {
    const seg = SEGMENTS[i];
    if (s < seg.s0 + seg.len) return seg;
  }
  return SEGMENTS[SEGMENTS.length - 1];
}

/**
 * Ponto da pista para u ∈ [0,1) e deslocamento lateral
 * (lateral > 0 = para dentro do circuito, lateral < 0 = para fora).
 */
export function sample(u, lateral = 0, out = {}) {
  const s = (((u % 1) + 1) % 1) * PERIMETER;
  const seg = segmentAt(s);
  const ls = s - seg.s0;

  let x, z, dx, dz;
  if (seg.type === 'line') {
    x = seg.x0 + seg.dx * ls;
    z = seg.z0 + seg.dz * ls;
    dx = seg.dx; dz = seg.dz;
  } else {
    const a = seg.a0 - ls / R;            // ângulo decresce ao longo da curva
    x = seg.cx + R * Math.cos(a);
    z = seg.cz + R * Math.sin(a);
    dx = Math.sin(a); dz = -Math.cos(a);  // tangente (curva à esquerda)
  }

  const nx = dz, nz = -dx;                // normal apontando para dentro do circuito
  out.x = x + nx * lateral;
  out.z = z + nz * lateral;
  out.dx = dx; out.dz = dz;
  out.nx = nx; out.nz = nz;
  return out;
}

/**
 * Projeta um ponto do mundo na pista testando os 9 segmentos e ficando com o
 * mais próximo. Devolve u (progresso) e lateral (m, + para dentro).
 */
export function project(x, z, out = {}) {
  let bestS = 0, bestLat = 0, bestDist = Infinity;

  for (const seg of SEGMENTS) {
    let s, lateral, px, pz;
    if (seg.type === 'line') {
      const t = Math.max(0, Math.min(seg.len, (x - seg.x0) * seg.dx + (z - seg.z0) * seg.dz));
      px = seg.x0 + seg.dx * t;
      pz = seg.z0 + seg.dz * t;
      s = seg.s0 + t;
      lateral = (x - px) * seg.dz + (z - pz) * (-seg.dx); // normal interior = (dz,-dx)
    } else {
      let da = Math.atan2(z - seg.cz, x - seg.cx) - seg.a0;
      da = Math.atan2(Math.sin(da), Math.cos(da));       // normaliza para [-π,π]
      const t = Math.max(0, Math.min(ARC, -da * R));     // arco decresce: t = -da·R
      const ac = seg.a0 - t / R;
      px = seg.cx + R * Math.cos(ac);
      pz = seg.cz + R * Math.sin(ac);
      s = seg.s0 + t;
      lateral = R - Math.hypot(x - seg.cx, z - seg.cz);  // interior = centro do arco
    }
    const d = Math.hypot(x - px, z - pz);
    if (d < bestDist) { bestDist = d; bestS = s; bestLat = lateral; }
  }

  out.u = bestS / PERIMETER;
  out.lateral = bestLat;
  return out;
}

/** Curvatura (1/raio) no ponto u — 0 nas retas, 1/R nas curvas. */
export function curvatureAt(u) {
  const s = (((u % 1) + 1) % 1) * PERIMETER;
  return segmentAt(s).type === 'arc' ? 1 / R : 0;
}

/* ------------------------------------------------------------------ */
/* Geometria                                                           */
/* ------------------------------------------------------------------ */

/** Fita de triângulos entre dois deslocamentos laterais (chão) ou duas alturas (muro). */
function ribbon(latA, latB, yA, yB, segments, repeat) {
  const pos = [], uv = [], idx = [];
  const a = {}, b = {};
  for (let i = 0; i <= segments; i++) {
    const u = i / segments;
    sample(u, latA, a);
    sample(u, latB, b);
    pos.push(a.x, yA, a.z, b.x, yB, b.z);
    uv.push(u * repeat, 0, u * repeat, 1);
  }
  for (let i = 0; i < segments; i++) {
    const k = i * 2;
    idx.push(k, k + 2, k + 1, k + 2, k + 3, k + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function canvasTexture(w, h, draw, aniso, repeatX = 1) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.ClampToEdgeWrapping;
  t.repeat.set(repeatX, 1);
  t.anisotropy = aniso;
  return t;
}

function asphaltTexture(aniso, repeatX) {
  return canvasTexture(256, 256, (g, w, h) => {
    g.fillStyle = '#3a3d42';
    g.fillRect(0, 0, w, h);
    // granulado
    for (let i = 0; i < 5000; i++) {
      const v = 40 + Math.random() * 45;
      g.fillStyle = `rgba(${v},${v},${v + 3},${0.25 + Math.random() * 0.3})`;
      g.fillRect(Math.random() * w, Math.random() * h, 2, 2);
    }
    // zebras vermelho/branco nas duas bordas (eixo v = largura da pista)
    for (let i = 0; i < 8; i++) {
      g.fillStyle = i % 2 ? '#d9d9d9' : '#c0392b';
      g.fillRect((i * w) / 8, 0, w / 8, 9);
      g.fillStyle = i % 2 ? '#c0392b' : '#d9d9d9';
      g.fillRect((i * w) / 8, h - 9, w / 8, 9);
    }
    // faixa branca de borda
    g.fillStyle = '#f2f2f2';
    g.fillRect(0, 9, w, 7);
    g.fillRect(0, h - 16, w, 7);
  }, aniso, repeatX);
}

function wallTexture(aniso, repeatX) {
  return canvasTexture(128, 64, (g, w, h) => {
    g.fillStyle = '#eef0ee';
    g.fillRect(0, 0, w, h);
    g.fillStyle = 'rgba(0,0,0,0.28)';
    g.fillRect(0, h - 14, w, 14);      // base suja
    g.fillStyle = 'rgba(255,255,255,0.5)';
    g.fillRect(0, 0, w, 5);            // topo claro
  }, aniso, repeatX);
}

function startLineTexture(aniso) {
  return canvasTexture(256, 64, (g, w, h) => {
    const cols = 16, rows = 4;
    for (let i = 0; i < cols; i++) {
      for (let j = 0; j < rows; j++) {
        g.fillStyle = (i + j) % 2 ? '#101010' : '#f2f2f2';
        g.fillRect((i * w) / cols, (j * h) / rows, w / cols, h / rows);
      }
    }
  }, aniso);
}

/** Monta asfalto, zebras, muros e a linha de largada/chegada. */
export function buildTrackMeshes(aniso = 4) {
  const group = new THREE.Group();
  group.name = 'track';
  const SEG = 1200; // mais segmentos: a pista dobrou e agora tem 4 curvas

  // asfalto
  const road = new THREE.Mesh(
    ribbon(-TRACK.halfWidth, TRACK.halfWidth, 0.02, 0.02, SEG, Math.round(PERIMETER / 14)),
    new THREE.MeshStandardMaterial({
      map: asphaltTexture(aniso, 1),
      roughness: 0.92, metalness: 0.02,
    })
  );
  road.material.map.repeat.set(Math.round(PERIMETER / 14), 1);
  road.receiveShadow = true;
  group.add(road);

  // faixa de escape (grama batida) até os muros
  const apronMat = new THREE.MeshStandardMaterial({ color: 0x4e7a3f, roughness: 1 });
  const apronOut = new THREE.Mesh(ribbon(-TRACK.wallLat, -TRACK.halfWidth, 0.01, 0.015, SEG, 1), apronMat);
  const apronIn = new THREE.Mesh(ribbon(TRACK.halfWidth, TRACK.wallLat, 0.015, 0.01, SEG, 1), apronMat);
  apronOut.receiveShadow = apronIn.receiveShadow = true;
  group.add(apronOut, apronIn);

  // muros (externo e interno)
  const wRepeat = Math.round(PERIMETER / 7);
  const wallMat = new THREE.MeshStandardMaterial({
    map: wallTexture(aniso, wRepeat), roughness: 0.7, side: THREE.DoubleSide,
  });
  const wallOut = new THREE.Mesh(ribbon(-TRACK.wallLat, -TRACK.wallLat, 0, TRACK.wallHeight, SEG, wRepeat), wallMat);
  const wallIn = new THREE.Mesh(ribbon(TRACK.wallLat, TRACK.wallLat, TRACK.wallHeight, 0, SEG, wRepeat), wallMat);
  wallOut.castShadow = wallIn.castShadow = true;
  wallOut.receiveShadow = wallIn.receiveShadow = true;
  group.add(wallOut, wallIn);

  // topo dos muros (evita ver a espessura zero de lado)
  const capMat = new THREE.MeshStandardMaterial({ color: 0xdddddd, roughness: 0.8, side: THREE.DoubleSide });
  group.add(
    new THREE.Mesh(ribbon(-TRACK.wallLat - 0.5, -TRACK.wallLat, TRACK.wallHeight, TRACK.wallHeight, SEG, 1), capMat),
    new THREE.Mesh(ribbon(TRACK.wallLat, TRACK.wallLat + 0.5, TRACK.wallHeight, TRACK.wallHeight, SEG, 1), capMat)
  );

  // linha de largada / chegada (u = 0, no meio do front stretch) — ~9 m de comprimento
  const lineLen = 4.5 / PERIMETER; // em fração de volta
  const line = new THREE.Mesh(
    shortRibbon(-lineLen, lineLen, -TRACK.halfWidth, TRACK.halfWidth, 0.035),
    new THREE.MeshStandardMaterial({ map: startLineTexture(aniso), roughness: 0.8 })
  );
  group.add(line);

  return group;
}

/** Fita curta entre dois valores de u (usada na linha de chegada). */
function shortRibbon(u0, u1, latA, latB, y) {
  const pos = [], uv = [], idx = [];
  const a = {}, b = {};
  const steps = 8;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const u = u0 + (u1 - u0) * t;
    sample(u, latA, a);
    sample(u, latB, b);
    pos.push(a.x, y, a.z, b.x, y, b.z);
    uv.push(0, t, 1, t);
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
  return g;
}
