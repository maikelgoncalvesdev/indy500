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

/**
 * Curvatura suavizada numa janela de ±`span` metros. A curvatura crua é um
 * degrau (0 na reta, 1/R na curva); a versão suave antecipa a entrada e
 * prolonga a saída, que é como a linha de corrida real se comporta.
 */
export function smoothCurvature(u, span = 70) {
  const step = 7;
  const n = Math.round(span / step);
  const du = step / PERIMETER;
  let acc = 0;
  for (let i = -n; i <= n; i++) acc += curvatureAt(u + i * du);
  return acc / (2 * n + 1);
}

/**
 * Pit lane: uma bifurcação da pista principal, no interior do front stretch,
 * com a MESMA largura dela. Distâncias em metros a partir da linha de chegada
 * (negativo = antes dela). Nas duas pontas as pistas se tocam — é por ali que
 * se entra e se sai; entre `wallStart` e `wallEnd` um muro divisor separa.
 */
export const PIT = {
  entryStart: -240,  // a pista alarga: aqui começa a bifurcação
  wallStart: -196,   // daqui até wallEnd um muro separa as duas pistas
  wallEnd: 196,
  exitEnd: 240,      // a pit lane volta a se fundir com a pista
  divider: TRACK.halfWidth + 0.7,   // lateral do muro divisor
  boxes: 10,
};
// a pit lane tem a MESMA largura da pista: é uma bifurcação, não um corredor
PIT.inner = PIT.divider + 0.7;
PIT.outer = PIT.inner + TRACK.width;
// trechos em que o asfalto abre a partir da pista e volta a fechar
PIT.flareIn = PIT.entryStart - 48;
PIT.flareOut = PIT.exitEnd + 48;
PIT.u = (m) => m / PERIMETER;

const smoothstep = (x) => {
  const t = Math.max(0, Math.min(1, x));
  return t * t * (3 - 2 * t);
};

/** u → metros com sinal a partir da linha de chegada, em [-P/2, P/2). */
export function signedMeters(u) {
  const m = (((u % 1) + 1) % 1) * PERIMETER;
  return m > PERIMETER / 2 ? m - PERIMETER : m;
}

/**
 * Asfalto extra da bifurcação em `m`, do lado de dentro: [borda da pista,
 * borda externa da pit lane], ou null fora dela. Nas duas pontas as pistas se
 * tocam (asfalto contínuo, sem grama no meio); no miolo o muro divisor separa.
 *
 * É a mesma função que desenha o asfalto e que limita o carro, para que o que
 * se vê e o que se pode dirigir nunca discordem.
 */
export function pitBounds(m) {
  const { flareIn, flareOut, entryStart, exitEnd, outer } = PIT;
  if (m < flareIn || m > flareOut) return null;
  const hw = TRACK.halfWidth;
  // a borda interna fica sempre colada na pista; só a externa abre. Assim a
  // bifurcação nasce da própria pista, sem afunilar num bico.
  let hi = outer;
  if (m < entryStart) hi = hw + (outer - hw) * smoothstep((m - flareIn) / (entryStart - flareIn));
  else if (m > exitEnd) hi = hw + (outer - hw) * smoothstep((flareOut - m) / (flareOut - exitEnd));
  return [hw, hi];
}

/** Há muro entre a pista e a pit lane em `m`? Nas bocas, não. */
export function pitDivided(m) {
  return m >= PIT.wallStart && m <= PIT.wallEnd;
}

/**
 * Deslocamento lateral da linha de corrida ideal em u: por fora nas retas,
 * por dentro nas curvas. É o traçado que o "groove" desenha no asfalto e que
 * ensina a linha ao jogador sem precisar de tutorial.
 */
export function racingLineLat(u) {
  const t = Math.min(1, smoothCurvature(u) * R); // 0 na reta, 1 no meio da curva
  const outside = -TRACK.halfWidth * 0.30;
  const inside = TRACK.halfWidth * 0.42;
  return outside + (inside - outside) * t;
}

/* ------------------------------------------------------------------ */
/* Geometria                                                           */
/* ------------------------------------------------------------------ */

/**
 * Fita de triângulos entre dois deslocamentos laterais (chão) ou duas alturas
 * (muro). `latA`/`latB` aceitam número (fita de largura fixa) ou função de u
 * (fita que serpenteia — usada no groove).
 */
function ribbon(latA, latB, yA, yB, segments, repeat, u0 = 0, u1 = 1) {
  const pos = [], uv = [], idx = [];
  const a = {}, b = {};
  const fa = typeof latA === 'function' ? latA : () => latA;
  const fb = typeof latB === 'function' ? latB : () => latB;
  for (let i = 0; i <= segments; i++) {
    const u = u0 + ((u1 - u0) * i) / segments;
    sample(u, fa(u), a);
    sample(u, fb(u), b);
    pos.push(a.x, yA, a.z, b.x, yB, b.z);
    uv.push((i / segments) * repeat, 0, (i / segments) * repeat, 1);
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

export function asphaltTexture(aniso, repeatX) {
  return canvasTexture(256, 256, (g, w, h) => {
    g.fillStyle = '#585c63';
    g.fillRect(0, 0, w, h);
    // remendos: retângulos de tom levemente diferente, como asfalto recapeado
    for (let i = 0; i < 14; i++) {
      const v = 78 + Math.random() * 20;
      g.fillStyle = `rgba(${v},${v},${v + 4},0.35)`;
      g.fillRect(Math.random() * w, Math.random() * h, 20 + Math.random() * 70, 14 + Math.random() * 40);
    }
    // granulado
    for (let i = 0; i < 5000; i++) {
      const v = 74 + Math.random() * 46;
      g.fillStyle = `rgba(${v},${v},${v + 3},${0.25 + Math.random() * 0.3})`;
      g.fillRect(Math.random() * w, Math.random() * h, 2, 2);
    }
    // trincas finas no sentido da pista
    g.strokeStyle = 'rgba(40,42,46,0.4)';
    g.lineWidth = 1;
    for (let i = 0; i < 10; i++) {
      const y = Math.random() * h;
      g.beginPath();
      g.moveTo(0, y);
      for (let x = 0; x <= w; x += 16) g.lineTo(x, y + (Math.random() - 0.5) * 5);
      g.stroke();
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
    g.fillStyle = '#cdd0cd';
    g.fillRect(0, 0, w, h);
    g.fillStyle = 'rgba(0,0,0,0.3)';
    g.fillRect(0, h - 14, w, 14);      // base suja
    g.fillStyle = 'rgba(255,255,255,0.35)';
    g.fillRect(0, 0, w, 5);            // topo claro
    // marcas de borracha deixadas por quem raspou no muro
    for (let i = 0; i < 5; i++) {
      g.fillStyle = `rgba(30,28,30,${0.06 + Math.random() * 0.12})`;
      g.fillRect(Math.random() * w, h - 30 + Math.random() * 14, 12 + Math.random() * 40, 3 + Math.random() * 6);
    }
  }, aniso, repeatX);
}

/**
 * Asfalto em malha com colunas: além da fita de bordas, o eixo transversal é
 * subdividido para carregar cor por vértice. É assim que o "groove" (a
 * borracha depositada na linha de corrida) é pintado — como parte do próprio
 * asfalto, sem camada transparente por cima, que brigaria no z-buffer.
 */
function roadGeometry(segments, cols) {
  const pos = [], uv = [], col = [], idx = [];
  const s = {};
  const GROOVE_HALF = 5.2;
  const W = TRACK.width;

  for (let i = 0; i <= segments; i++) {
    const u = i / segments;
    const line = racingLineLat(u);
    for (let j = 0; j <= cols; j++) {
      const t = j / cols;
      const lat = -TRACK.halfWidth + W * t;
      sample(u, lat, s);
      pos.push(s.x, 0.02, s.z);
      uv.push(u, t);
      // escurece conforme se aproxima da linha de corrida
      const d = Math.min(1, Math.abs(lat - line) / GROOVE_HALF);
      const k = 1 - (1 - d * d) * 0.34;
      col.push(k, k, k * 1.02);
    }
  }

  const row = cols + 1;
  for (let i = 0; i < segments; i++) {
    for (let j = 0; j < cols; j++) {
      const a = i * row + j;
      idx.push(a, a + row, a + 1, a + 1, a + row, a + row + 1);
    }
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
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
  const SEG = 900; // ~2,2 m por segmento: já é liso nas curvas de raio 125 m

  // asfalto — o `repeat` mora só na textura; a geometria emite uv de 0 a 1,
  // senão a repetição seria contada duas vezes e o granulado sumiria no mipmap.
  // A cor por vértice desenha o groove da linha de corrida.
  const road = new THREE.Mesh(
    roadGeometry(SEG, 8),
    new THREE.MeshStandardMaterial({
      map: asphaltTexture(aniso, Math.round(PERIMETER / 14)),
      vertexColors: true,
      roughness: 0.92, metalness: 0.02,
    })
  );
  road.receiveShadow = true;
  group.add(road);

  // faixa de escape (grama batida) até os muros. Do lado de dentro ela para
  // onde começa a bifurcação: ali o espaço é todo asfalto da pit lane.
  const apronMat = new THREE.MeshStandardMaterial({ color: 0x578645, roughness: 1 });
  const apronOut = new THREE.Mesh(ribbon(-TRACK.wallLat, -TRACK.halfWidth, 0.01, 0.015, SEG, 1), apronMat);
  apronOut.receiveShadow = true;
  group.add(apronOut);

  const uOut = PIT.u(PIT.flareOut);           // fim da bifurcação
  const uIn = 1 + PIT.u(PIT.flareIn);         // início dela, na volta seguinte
  const restSeg = Math.round(SEG * (uIn - uOut));
  const apronIn = new THREE.Mesh(ribbon(TRACK.halfWidth, TRACK.wallLat, 0.015, 0.01, restSeg, 1, uOut, uIn), apronMat);
  apronIn.receiveShadow = true;
  group.add(apronIn);

  // muros (externo e interno)
  const wRepeat = Math.round(PERIMETER / 7);
  const wallMat = new THREE.MeshStandardMaterial({
    map: wallTexture(aniso, wRepeat), roughness: 0.7, side: THREE.DoubleSide,
  });
  const wallOut = new THREE.Mesh(ribbon(-TRACK.wallLat, -TRACK.wallLat, 0, TRACK.wallHeight, SEG, 1), wallMat);
  wallOut.castShadow = wallOut.receiveShadow = true;
  group.add(wallOut);

  // O muro interno existe só fora da bifurcação; ao longo dela quem separa a
  // pista da pit lane é o muro divisor, montado em scenery.js.
  const capMat = new THREE.MeshStandardMaterial({ color: 0xb9bcb9, roughness: 0.8, side: THREE.DoubleSide });
  const wIn = new THREE.Mesh(
    ribbon(TRACK.wallLat, TRACK.wallLat, TRACK.wallHeight, 0, restSeg, Math.round(PERIMETER * (uIn - uOut) / 7), uOut, uIn),
    wallMat
  );
  wIn.castShadow = wIn.receiveShadow = true;
  group.add(wIn);
  group.add(new THREE.Mesh(
    ribbon(TRACK.wallLat, TRACK.wallLat + 0.5, TRACK.wallHeight, TRACK.wallHeight, restSeg, 1, uOut, uIn),
    capMat
  ));

  // topo do muro externo (evita ver a espessura zero de lado)
  group.add(new THREE.Mesh(ribbon(-TRACK.wallLat - 0.5, -TRACK.wallLat, TRACK.wallHeight, TRACK.wallHeight, SEG, 1), capMat));

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
