import * as THREE from 'three';
import { TRACK, PERIMETER, PIT, sample, project, signedMeters, pitBounds, pitDivided } from './track.js';
import { flattenByMaterial } from './meshutil.js';

export const CAR_SPEC = {
  maxSpeed: 79,        // m/s  (~285 km/h) — só nas retas
  maxReverse: 9,
  accel: 26,           // m/s² a velocidade zero; cai linearmente até 0 na máxima
  brake: 40,
  reverse: 12,
  coast: 0.10,         // freio-motor proporcional a v (só fora do acelerador)
  roll: 2.0,
  offDrag: 0.30,       // arrasto extra fora do asfalto
  offRoll: 6.0,
  turn: 2.0,           // rad/s no esterço máximo
  corneringDrag: 0.16, // curva rouba velocidade: equilíbrio ~60 m/s nas curvas
  handbrake: 26,
  halfWidth: 1.05,
  halfLength: 2.5,
};

const _p = {};
const _s = {};

function wrapAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

/* ------------------------------------------------------------------ */
/* Piloto-animal                                                        */
/*                                                                      */
/* As cabeças nascem de uma esfera esculpida — focinho, testa, maçãs e   */
/* mandíbula saem da própria malha, em vez de serem caixas e cones       */
/* colados por cima. É o que separa um bicho de um boneco de blocos.     */
/* Cada espécie ajusta o mesmo molde e acrescenta só o que a identifica. */
/* Tudo olha para +Z e cabe num raio de ~0,6 em volta da origem.         */
/* ------------------------------------------------------------------ */

const smooth01 = (t) => {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
};

/** Move cada vértice de uma geometria e reconstrói as normais. */
function sculpt(geo, mold) {
  const p = geo.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    mold(v);
    p.setXYZ(i, v.x, v.y, v.z);
  }
  p.needsUpdate = true;
  geo.computeVertexNormals();
  return geo;
}

/**
 * Crânio: esfera puxada para a frente até virar focinho.
 * `snout` alonga, `taper` afina a ponta, `drop` faz o focinho cair, `brow`
 * levanta a testa, `cheek` alarga as maçãs, `flat` achata (répteis), `jaw`
 * engorda a mandíbula (roedores).
 *
 * Devolve também `at(dir, offset)`: onde uma direção (olhar, focinho, orelha)
 * encosta na pele já deformada. Sem isso os olhos e o nariz de cada espécie
 * teriam de ser recalibrados na mão — e afundariam na malha ao menor ajuste.
 */
function makeSkull(r, opts = {}) {
  const {
    snout = 0.3, taper = 0.44, drop = 0.08, brow = 0.12,
    cheek = 0.14, flat = 1, jaw = 1, segs = 20,
  } = opts;

  const mold = (v) => {
    // o focinho só começa a partir de um terço à frente do centro: puxando
    // desde o equador, a cara inteira afunilava e levava os olhos junto
    const f = smooth01((v.z / r - 0.32) / 0.68);
    const back = smooth01(-v.z / r);
    v.x *= 1 + cheek * back;
    v.y *= flat;
    if (v.y > 0) v.y *= 1 + brow * (1 - f);
    else v.y *= jaw;
    v.x *= 1 - taper * f;
    v.y *= 1 - taper * f * 0.85;
    v.y -= drop * r * f;
    v.z += snout * r * f;
  };

  return {
    geo: sculpt(new THREE.SphereGeometry(r, segs, Math.round(segs * 0.75)), mold),
    /** Ponto da pele na direção (x,y,z); `out` afasta (+) ou afunda (−). */
    at(x, y, z, out = 0) {
      const dir = new THREE.Vector3(x, y, z).normalize();
      const p = dir.clone().multiplyScalar(r);
      mold(p);
      return p.addScaledVector(dir, out);
    },
    /**
     * Casca colada na pele — máscara facial, escudo, papada. `wide` é a
     * abertura horizontal em torno da frente e `theta` o trecho vertical
     * (0 = topo da cabeça, π = queixo), ambos em radianos.
     */
    shell(wide, theta0, theta1, out = 0.008) {
      const g = new THREE.SphereGeometry(
        r, 24, 16, Math.PI / 2 - wide / 2, wide, theta0, theta1 - theta0
      );
      return sculpt(g, (v) => {
        const dir = v.clone().normalize();
        mold(v);
        v.addScaledVector(dir, out);
      });
    },
  };
}

/**
 * Orelha: contorno em curva, com espessura e borda arredondada — no lugar da
 * pirâmide de quatro lados que o cone de 4 segmentos produzia.
 */
function earGeometry(w, h, pointy = 0.5, depth = 0.045) {
  const s = new THREE.Shape();
  s.moveTo(-w / 2, 0);
  s.bezierCurveTo(-w * 0.62, h * 0.42, -w * pointy * 0.45, h * 0.88, 0, h);
  s.bezierCurveTo(w * pointy * 0.45, h * 0.88, w * 0.62, h * 0.42, w / 2, 0);
  s.quadraticCurveTo(0, -h * 0.18, -w / 2, 0);
  return new THREE.ExtrudeGeometry(s, {
    depth,
    bevelEnabled: true,
    bevelSize: depth * 0.7,
    bevelThickness: depth * 0.6,
    bevelSegments: 2,
    curveSegments: 8,
  });
}

/** Bico apontando para +Z, afinando e curvando para baixo até a ponta. */
function beakGeometry(len, r, curve) {
  const g = new THREE.CylinderGeometry(r * 0.14, r, len, 14, 5);
  g.rotateX(Math.PI / 2); // o topo fino passa a apontar para +Z
  return sculpt(g, (v) => {
    const t = smooth01((v.z + len / 2) / len);
    v.y -= curve * t * t;
    v.x *= 1 - 0.18 * t;
  });
}

/* ---- pelagem procedural ---------------------------------------------
 * O material já carrega a cor do bicho, então o mapa é quase branco: ele só
 * multiplica variação em cima. Isso quebra o plástico liso e dá as rosetas da
 * onça sem espalhar bolinhas escuras pela malha.
 */
const _furTex = new Map();

/**
 * Traços que não vêm da malha: revestimento (muda a textura) e se o bicho
 * mostra cauda quando fica em pé. A espécie, e não a família, define os dois —
 * é o que separa o tatu da capivara e a arara do tucano.
 */
const SPECIES = {
  felino:   { coat: 'pelo',   tail: true },
  macaco:   { coat: 'pelo',   tail: true },
  quati:    { coat: 'pelo',   tail: true },
  capivara: { coat: 'pelo',   tail: false },
  tatu:     { coat: 'placa',  tail: true },
  tucano:   { coat: 'pena',   tail: false },
  arara:    { coat: 'pena',   tail: false },
  canideo:  { coat: 'pelo',   tail: true },
  reptil:   { coat: 'escama', tail: true },
  tamandua: { coat: 'pelo',   tail: true },
  preguica: { coat: 'pelo',   tail: false },
};

function furTexture(coat, spots) {
  const key = `${coat}|${spots ? 1 : 0}`;
  if (_furTex.has(key)) return _furTex.get(key);

  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, 256, 256);

  if (coat === 'escama') {
    // escamas: fileiras de arcos sobrepostos
    for (let y = 0; y < 256; y += 11) {
      for (let x = (y / 11) % 2 ? 0 : 7; x < 256; x += 14) {
        g.strokeStyle = 'rgba(0,0,0,0.16)';
        g.lineWidth = 1.4;
        g.beginPath();
        g.arc(x, y, 7, 0.15, Math.PI - 0.15);
        g.stroke();
      }
    }
  } else if (coat === 'placa') {
    // couraça do tatu: placas retangulares em fileiras, com sulco entre elas
    for (let y = 0; y < 256; y += 38) {
      g.fillStyle = 'rgba(0,0,0,0.09)';
      g.fillRect(0, y, 256, 4);
      for (let x = (y / 38) % 2 ? 0 : 16; x < 256; x += 32) {
        g.fillStyle = 'rgba(0,0,0,0.06)';
        g.fillRect(x, y + 4, 3, 34);
        g.fillStyle = 'rgba(255,255,255,0.1)';
        g.fillRect(x + 5, y + 7, 22, 4);
      }
    }
  } else if (coat === 'pena') {
    // penas: escamas maiores, com um brilho na borda de cima
    for (let y = 0; y < 256; y += 16) {
      for (let x = (y / 16) % 2 ? 0 : 10; x < 256; x += 20) {
        g.strokeStyle = 'rgba(0,0,0,0.14)';
        g.lineWidth = 1.6;
        g.beginPath();
        g.arc(x, y, 10, 0.2, Math.PI - 0.2);
        g.stroke();
        g.strokeStyle = 'rgba(255,255,255,0.28)';
        g.beginPath();
        g.arc(x, y - 2, 10, 0.35, Math.PI - 0.35);
        g.stroke();
      }
    }
  } else {
    // pelo: riscos curtos em duas tonalidades
    for (let i = 0; i < 3000; i++) {
      const x = Math.random() * 256, y = Math.random() * 256;
      const a = Math.random() * Math.PI;
      g.strokeStyle = Math.random() < 0.5 ? 'rgba(0,0,0,0.07)' : 'rgba(255,255,255,0.15)';
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x + Math.cos(a) * 5, y + Math.sin(a) * 5);
      g.stroke();
    }
  }

  if (spots) {
    // rosetas da onça: um punhado de pintas em roda, com miolo mais claro.
    // Cada uma é desenhada nas nove cópias vizinhas para não cortar na emenda.
    for (let i = 0; i < 18; i++) {
      const x = Math.random() * 256, y = Math.random() * 256;
      const r = 12 + Math.random() * 7;
      const a0 = Math.random() * 6.28;
      const n = 4 + ((Math.random() * 2) | 0);
      for (const dx of [-256, 0, 256]) {
        for (const dy of [-256, 0, 256]) {
          g.fillStyle = 'rgba(22,15,8,0.5)';
          for (let k = 0; k < n; k++) {
            const a = a0 + (k / n) * 6.28;
            g.beginPath();
            g.ellipse(x + dx + Math.cos(a) * r, y + dy + Math.sin(a) * r, r * 0.36, r * 0.26, a, 0, 6.28);
            g.fill();
          }
          g.fillStyle = 'rgba(22,15,8,0.16)';
          g.beginPath();
          g.arc(x + dx, y + dy, r * 0.6, 0, 6.28);
          g.fill();
        }
      }
    }
  }

  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(2, 2);
  t.anisotropy = 4;
  _furTex.set(key, t);
  return t;
}

/**
 * Torso: ombros largos, cintura estreita e peito estufado. Uma esfera
 * escalada lia como boneco de neve; a mesma esfera esculpida vira tronco.
 */
export function torsoGeometry(r = 0.52) {
  return sculpt(new THREE.SphereGeometry(r, 18, 14), (v) => {
    const up = smooth01(v.y / r);
    const down = smooth01(-v.y / r);
    v.x *= 1 + 0.2 * up - 0.16 * down;
    v.z *= 0.86 + 0.22 * smooth01(v.z / r) * (1 - down);
    v.y *= 1.2;
  });
}

/** Os quatro materiais de um bicho — compartilhados entre cabeça e corpo. */
export function animalMaterials(animal) {
  const kind = animal.kind || 'felino';
  const { coat, tail } = SPECIES[kind] ?? SPECIES.felino;
  return {
    kind, coat, tail,
    fur: new THREE.MeshStandardMaterial({
      color: animal.color, map: furTexture(coat, !!animal.spots), roughness: 0.88, metalness: 0.02,
    }),
    accMat: new THREE.MeshStandardMaterial({ color: animal.accent ?? 0x2a2018, roughness: 0.7, metalness: 0.05 }),
    white: new THREE.MeshStandardMaterial({ color: 0xf4f4f4, roughness: 0.5 }),
    black: new THREE.MeshStandardMaterial({ color: 0x101014, roughness: 0.45 }),
  };
}

/**
 * Olho inteiro: globo, íris, pupila, brilho e a pálpebra que dá o olhar.
 * `p` é o ponto da pele (de `skull.at`); o globo fica meio enterrado ali.
 */
function addEye(parent, o, p, r = 0.1, lid = 0.6) {
  const { fur, accMat, white, black } = o;
  const g = new THREE.Group();
  g.position.copy(p);
  g.rotation.y = Math.atan2(p.x, 1.1);   // acompanha a curvatura do crânio
  g.rotation.x = -Math.atan2(p.y, 2.2);

  const ball = new THREE.Mesh(new THREE.SphereGeometry(r, 12, 10), white);
  ball.scale.set(1, 1, 0.85);
  const iris = new THREE.Mesh(new THREE.SphereGeometry(r * 0.72, 12, 10), accMat);
  iris.position.z = r * 0.55;
  iris.scale.set(1, 1, 0.45);
  const pupil = new THREE.Mesh(new THREE.SphereGeometry(r * 0.44, 10, 8), black);
  pupil.position.z = r * 0.72;
  pupil.scale.set(1, 1, 0.4);
  const glint = new THREE.Mesh(new THREE.SphereGeometry(r * 0.15, 6, 5), white);
  glint.position.set(r * 0.3, r * 0.34, r * 0.7);
  // pálpebra: casca de pelo cobrindo o alto do globo, como uma sobrancelha
  const eyelid = new THREE.Mesh(
    new THREE.SphereGeometry(r * 1.16, 14, 8, 0, Math.PI * 2, 0, lid), fur
  );
  eyelid.rotation.x = -0.75;

  ball.castShadow = eyelid.castShadow = true;
  g.add(ball, iris, pupil, glint, eyelid);
  parent.add(g);
  return g;
}

/** Bigodes: três fios finos saindo da bochecha `p`, em leque. */
function addWhiskers(parent, mat, p, len, sx) {
  for (let i = 0; i < 3; i++) {
    const pivot = new THREE.Group();
    pivot.position.set(p.x, p.y + (i - 1) * 0.03, p.z);
    pivot.rotation.z = sx * (Math.PI / 2 - 0.2 - i * 0.1);
    pivot.rotation.x = -0.15 + i * 0.12;
    const m = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.003, len, 3), mat);
    m.position.y = len / 2;
    pivot.add(m);
    parent.add(pivot);
  }
}

function addAnimalHead(head, o) {
  const { fur, accMat, white, black, kind } = o;
  const mk = (geo, mat, x, y, z, parent = head) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    parent.add(m);
    return m;
  };

  /** Peça chata (mancha, anel, escama) deitada na pele, virada para fora. */
  const patch = (geo, mat, p) => {
    const m = mk(geo, mat, p.x, p.y, p.z);
    m.lookAt(p.clone().multiplyScalar(2));
    m.castShadow = false;
    return m;
  };

  /** Par de orelhas com a concha interna, plantadas na pele. */
  const ears = (skull, w, h, pointy, dir, rot) => {
    for (const sx of [1, -1]) {
      const p = skull.at(sx * dir[0], dir[1], dir[2], -0.03);
      const g = new THREE.Group();
      g.position.copy(p);
      g.rotation.set(rot[0], sx * rot[1], sx * rot[2]);
      const outer = new THREE.Mesh(earGeometry(w, h, pointy), fur);
      outer.castShadow = true;
      const inner = new THREE.Mesh(earGeometry(w * 0.58, h * 0.62, pointy), accMat);
      inner.position.set(0, h * 0.16, 0.05);
      g.add(outer, inner);
      head.add(g);
    }
  };

  /** Boca: um sulco fino em arco, logo abaixo do focinho. */
  const mouth = (p, w, span = Math.PI) => {
    const m = mk(new THREE.TorusGeometry(w, 0.014, 4, 12, span), black, p.x, p.y, p.z);
    m.rotation.set(Math.PI / 2 - 0.35, 0, Math.PI + (Math.PI - span) / 2);
    m.castShadow = false;
    return m;
  };

  /** Nariz: bolinha achatada na ponta do focinho. */
  const nose = (p, r, mat = black) =>
    mk(new THREE.SphereGeometry(r, 12, 10), mat, p.x, p.y, p.z).scale.set(1.35, 0.85, 0.75);

  switch (kind) {
    case 'tucano': { // bico enorme e reto, crânio pequeno atrás dele
      const skull = makeSkull(0.4, { snout: 0.16, taper: 0.28, drop: 0, brow: 0.16, cheek: 0.06 });
      mk(skull.geo, fur, 0, 0, 0);

      // o bico é metade do bicho: comprido, alto na base, ponta escura
      const base = skull.at(0, -0.02, 1, -0.16);
      const upper = mk(beakGeometry(0.95, 0.21, 0.2), accMat, 0, base.y + 0.05, base.z + 0.45);
      upper.scale.set(0.92, 1.25, 1);
      const lower = mk(beakGeometry(0.82, 0.16, 0.12), black, 0, base.y - 0.1, base.z + 0.38);
      lower.scale.set(0.85, 0.6, 1);
      mk(new THREE.SphereGeometry(0.055, 10, 8), black, 0, base.y + 0.06, base.z + 0.9)
        .scale.set(0.9, 1.4, 1.6); // ponta preta

      // gola clara na garganta e olho com pele nua em volta
      mk(skull.shell(2.4, 1.45, 2.5), white, 0, 0, 0);
      for (const sx of [1, -1]) {
        const e = skull.at(sx * 0.7, 0.5, 0.7, -0.04);
        patch(new THREE.CircleGeometry(0.12, 14), accMat, e);
        addEye(head, o, e, 0.08, 0.55);
      }
      break;
    }

    case 'arara': { // bico curto em gancho, face nua e topete alto
      const skull = makeSkull(0.43, { snout: 0.2, taper: 0.34, drop: 0.05, brow: 0.2, cheek: 0.1 });
      mk(skull.geo, fur, 0, 0, 0);

      // gancho: metade de cima curta e muito curvada sobre a de baixo
      const base = skull.at(0, -0.05, 1, -0.16);
      const hook = mk(beakGeometry(0.34, 0.23, 0.26), black, 0, base.y + 0.12, base.z + 0.13);
      hook.scale.set(1.05, 1.2, 1);
      const jawB = mk(beakGeometry(0.22, 0.2, 0.04), white, 0, base.y - 0.06, base.z + 0.05);
      jawB.scale.set(1, 0.65, 1);

      // face branca de pele nua, a marca da arara, e o topete de penas
      mk(skull.shell(1.5, 0.9, 1.7), white, 0, 0, 0);
      for (const [i, tilt] of [[0, -0.5], [1, -0.35], [-1, -0.35], [2, -0.25], [-2, -0.25]]) {
        const g = new THREE.Group();
        const p = skull.at(i * 0.34, 1, -0.2, -0.02);
        g.position.copy(p);
        g.rotation.set(tilt, 0, -i * 0.24);
        const feather = new THREE.Mesh(earGeometry(0.13, 0.3 - Math.abs(i) * 0.05, 0.3), accMat);
        feather.castShadow = true;
        g.add(feather);
        head.add(g);
      }
      for (const sx of [1, -1]) addEye(head, o, skull.at(sx * 0.62, 0.42, 0.78, -0.035), 0.085, 0.5);
      break;
    }

    case 'capivara': { // cabeça de tijolo, focinho chato e narinas no alto
      const skull = makeSkull(0.46, { snout: 0.42, taper: 0.2, drop: 0.14, brow: 0.04, cheek: 0.14, jaw: 1.18, flat: 0.94 });
      mk(skull.geo, fur, 0, 0, 0);
      ears(skull, 0.15, 0.14, 0.9, [0.6, 0.9, -0.4], [-0.15, 0.5, 0.3]);

      // focinho: bloco arredondado com as narinas separadas, bem no topo
      const snoutTip = skull.at(0, -0.05, 1, -0.05);
      mk(new THREE.SphereGeometry(0.17, 14, 12), fur, snoutTip.x, snoutTip.y, snoutTip.z)
        .scale.set(1.15, 0.85, 0.7);
      for (const sx of [1, -1]) {
        const n = skull.at(sx * 0.3, 0.25, 1, 0.02);
        mk(new THREE.SphereGeometry(0.045, 10, 8), black, n.x, n.y, n.z).scale.set(1, 0.8, 0.8);
      }
      const chew = skull.at(0, -0.6, 0.8, 0.02);
      mk(new THREE.BoxGeometry(0.14, 0.11, 0.05), white, chew.x, chew.y, chew.z).rotation.x = 0.12;
      mk(new THREE.BoxGeometry(0.012, 0.11, 0.055), accMat, chew.x, chew.y, chew.z + 0.01);

      for (const sx of [1, -1]) {
        addEye(head, o, skull.at(sx * 0.78, 0.7, 0.45, -0.05), 0.075, 0.6);
        addWhiskers(head, black, skull.at(sx * 0.85, -0.3, 0.6), 0.28, sx);
      }
      break;
    }

    case 'tatu': { // focinho pontudo, orelhas de abano e escudo em placas
      const skull = makeSkull(0.42, { snout: 0.95, taper: 0.62, drop: 0.1, brow: 0.05, cheek: 0.06 });
      mk(skull.geo, fur, 0, 0, 0);
      ears(skull, 0.16, 0.32, 0.7, [0.62, 0.85, -0.45], [-0.1, 0.3, 0.1]);

      // escudo cefálico: casca de placas cobrindo o alto da cabeça
      mk(skull.shell(2.6, 0, 0.85, 0.012), accMat, 0, 0, 0);
      for (let i = 0; i < 3; i++) { // cintas do casco descendo pela nuca
        const p = skull.at(0, 1, -0.55 - i * 0.28, 0.01);
        const band = mk(new THREE.TorusGeometry(0.2 - i * 0.03, 0.028, 4, 14, Math.PI), accMat, p.x, p.y - 0.06, p.z);
        band.rotation.set(0, 0, 0);
        band.castShadow = false;
      }

      nose(skull.at(0, -0.15, 1, 0.01), 0.05);
      mouth(skull.at(0, -0.55, 0.85, 0.01), 0.06, Math.PI * 0.8);
      for (const sx of [1, -1]) {
        addEye(head, o, skull.at(sx * 0.66, 0.5, 0.6, -0.04), 0.062, 0.6);
        addWhiskers(head, black, skull.at(sx * 0.8, -0.3, 0.7), 0.2, sx);
      }
      break;
    }

    case 'macaco': { // cara pequena e chata, orelhas de abano, testa alta
      const skull = makeSkull(0.42, { snout: 0.26, taper: 0.34, drop: 0.04, brow: 0.24, cheek: 0.16 });
      mk(skull.geo, fur, 0, 0, 0);

      // a cara clara é uma casca colada no crânio, do meio da testa ao queixo
      mk(skull.shell(2.7, 0.9, 2.5), accMat, 0, 0, 0);
      const muzzle = skull.at(0, -0.35, 1, -0.09);
      mk(new THREE.SphereGeometry(0.15, 14, 12), accMat, muzzle.x, muzzle.y, muzzle.z)
        .scale.set(1.15, 0.75, 0.75);
      for (const sx of [1, -1]) { // narinas em vírgula, sem focinho projetado
        const n = skull.at(sx * 0.16, -0.16, 1, 0.01);
        mk(new THREE.SphereGeometry(0.026, 8, 6), black, n.x, n.y, n.z);
      }
      mouth(skull.at(0, -0.52, 0.88, 0.015), 0.1, Math.PI * 0.9);

      // topete de pelo entre as orelhas
      const tuft = skull.at(0, 1, 0.12, -0.04);
      mk(new THREE.SphereGeometry(0.16, 12, 10), fur, tuft.x, tuft.y + 0.03, tuft.z)
        .scale.set(1.5, 0.6, 1.1);

      for (const sx of [1, -1]) { // orelhas: discos grandes bem nas laterais
        const p = skull.at(sx * 1, 0.1, -0.02, -0.02);
        const g = new THREE.Group();
        g.position.copy(p);
        g.rotation.y = sx * 0.55;
        const disc = new THREE.Mesh(new THREE.SphereGeometry(0.17, 12, 10), fur);
        disc.scale.set(0.28, 1, 0.95);
        disc.castShadow = true;
        const cup = new THREE.Mesh(new THREE.SphereGeometry(0.12, 10, 8), accMat);
        cup.scale.set(0.26, 1, 0.9);
        cup.position.x = sx * 0.045;
        g.add(disc, cup);
        head.add(g);

        addEye(head, o, skull.at(sx * 0.4, 0.5, 0.95, -0.05), 0.092, 0.55);
      }
      break;
    }

    case 'quati': { // focinho de mangueira, virado para cima, e máscara listrada
      const skull = makeSkull(0.4, { snout: 1.5, taper: 0.72, drop: -0.06, brow: 0.12, cheek: 0.1 });
      mk(skull.geo, fur, 0, 0, 0);
      ears(skull, 0.15, 0.15, 0.9, [0.6, 0.9, -0.35], [-0.15, 0.45, 0.25]);

      // focinho claro na ponta e o narigão preto arrebitado
      const tip = skull.at(0, 0, 1, 0);
      mk(new THREE.SphereGeometry(0.08, 12, 10), accMat, tip.x, tip.y, tip.z - 0.06)
        .scale.set(1.1, 1, 1.6);
      nose(skull.at(0, 0.22, 1, 0.015), 0.055);

      // máscara: anéis claros em volta dos olhos, marca da espécie
      for (const sx of [1, -1]) {
        const e = skull.at(sx * 0.55, 0.55, 0.68, -0.04);
        patch(new THREE.CircleGeometry(0.1, 14), accMat, e).scale.set(1.4, 0.9, 1);
        addEye(head, o, e, 0.075, 0.6);
        addWhiskers(head, black, skull.at(sx * 0.7, -0.25, 0.75), 0.24, sx);
      }
      break;
    }

    case 'reptil': { // jacaré: crânio chato, boca entreaberta, olhos no topo
      const skull = makeSkull(0.44, { snout: 1.35, taper: 0.5, drop: 0.02, brow: 0.05, cheek: 0.1, flat: 0.6 });
      mk(skull.geo, fur, 0, 0, 0);

      // mandíbula articulada: mesma silhueta, um pouco aberta
      const jaw = mk(
        makeSkull(0.4, { snout: 1.45, taper: 0.54, drop: 0, brow: 0, cheek: 0.05, flat: 0.34, segs: 16 }).geo,
        fur, 0, -0.16, 0.02
      );
      jaw.rotation.x = 0.14;

      // fileira de dentes na maxila
      for (let i = 0; i < 5; i++) {
        const z = 0.3 + i * 0.13;
        const w = 0.16 - i * 0.017;
        for (const sx of [1, -1]) {
          const t = mk(new THREE.ConeGeometry(0.028, 0.09, 5), white, sx * w, -0.13, z);
          t.rotation.x = Math.PI;
          t.castShadow = false;
        }
      }

      // os olhos moram em cima de dois domos, como no bicho de verdade
      for (const sx of [1, -1]) {
        const dome = skull.at(sx * 0.42, 0.9, 0.25, -0.05);
        mk(new THREE.SphereGeometry(0.13, 12, 10), fur, dome.x, dome.y, dome.z).scale.set(1, 0.8, 1.15);
        addEye(head, o, skull.at(sx * 0.38, 1, 0.3, -0.005), 0.075, 0.8);
        const nostril = skull.at(sx * 0.16, 0.6, 1, 0.005);
        mk(new THREE.SphereGeometry(0.022, 8, 6), black, nostril.x, nostril.y, nostril.z);
      }

      // crista de escamas do focinho até a nuca
      for (let i = 0; i < 7; i++) {
        const p = skull.at(0, 1, -0.75 + i * 0.3, -0.01);
        const s = mk(new THREE.ConeGeometry(0.05, 0.075, 4), fur, p.x, p.y, p.z);
        s.castShadow = false;
      }
      break;
    }

    case 'canideo': { // lobo-guará: focinho longo, orelhas enormes
      const skull = makeSkull(0.42, { snout: 0.88, taper: 0.58, drop: 0.13, brow: 0.14, cheek: 0.1 });
      mk(skull.geo, fur, 0, 0, 0);
      ears(skull, 0.24, 0.46, 0.35, [0.5, 1, -0.25], [-0.12, 0.35, 0.16]);

      nose(skull.at(0, -0.16, 1, 0.01), 0.075);
      mouth(skull.at(0, -0.55, 0.8, 0.01), 0.08, Math.PI * 0.85);
      for (const sx of [1, -1]) {
        addEye(head, o, skull.at(sx * 0.6, 0.6, 0.75, -0.045), 0.088, 0.6);
        addWhiskers(head, black, skull.at(sx * 0.7, -0.3, 0.7), 0.22, sx);
      }
      break;
    }

    case 'tamandua': { // tamanduá: o crânio inteiro vira um tubo cônico
      const skull = makeSkull(0.42, { snout: 1.75, taper: 0.84, drop: 0.16, brow: 0.08, cheek: 0.08 });
      mk(skull.geo, fur, 0, 0, 0);
      ears(skull, 0.15, 0.17, 0.8, [0.55, 0.9, -0.4], [-0.1, 0.5, 0.2]);

      // língua fininha saindo da ponta
      const tip = skull.at(0, -0.1, 1, 0);
      const tongue = mk(new THREE.CylinderGeometry(0.015, 0.007, 0.24, 5), accMat, tip.x, tip.y - 0.01, tip.z + 0.09);
      tongue.rotation.set(Math.PI / 2 - 0.25, 0, 0);
      tongue.castShadow = false;
      nose(skull.at(0, 0.1, 1, 0.005), 0.035);
      for (const sx of [1, -1]) addEye(head, o, skull.at(sx * 0.66, 0.62, 0.5, -0.035), 0.068, 0.6);
      break;
    }

    case 'preguica': { // preguiça: cara achatada, máscara e sorriso permanente
      const skull = makeSkull(0.45, { snout: 0.24, taper: 0.36, drop: 0.05, brow: 0.1, cheek: 0.16 });
      mk(skull.geo, fur, 0, 0, 0);
      ears(skull, 0.12, 0.12, 0.9, [0.6, 0.8, -0.35], [0, 0.5, 0.2]);

      nose(skull.at(0, -0.25, 1, 0.01), 0.08);
      mouth(skull.at(0, -0.6, 0.8, 0.01), 0.12, Math.PI * 1.1);
      for (const sx of [1, -1]) {
        const e = skull.at(sx * 0.55, 0.5, 0.85, -0.045);
        // a máscara escura em volta dos olhos é a marca da espécie
        patch(new THREE.CircleGeometry(0.17, 16), accMat, e).scale.set(1.2, 0.95, 1);
        addEye(head, o, e, 0.08, 0.55);
      }
      break;
    }

    default: { // felino: onça, jaguatirica
      const skull = makeSkull(0.44, { snout: 0.6, taper: 0.54, drop: 0.13, brow: 0.08, cheek: 0.22 });
      mk(skull.geo, fur, 0, 0, 0);
      ears(skull, 0.26, 0.3, 0.4, [0.5, 1, -0.15], [-0.18, 0.45, 0.2]);

      // focinho claro, nariz e boca
      const muzzle = skull.at(0, -0.45, 0.95, -0.06);
      mk(new THREE.SphereGeometry(0.14, 14, 12), white, muzzle.x, muzzle.y, muzzle.z)
        .scale.set(1.25, 0.7, 0.75);
      nose(skull.at(0, -0.12, 1, 0.005), 0.065);
      mouth(skull.at(0, -0.45, 0.9, 0.03), 0.08, Math.PI * 0.95);
      for (const sx of [1, -1]) {
        addEye(head, o, skull.at(sx * 0.62, 0.62, 0.75, -0.045), 0.098, 0.6);
        addWhiskers(head, black, skull.at(sx * 0.8, -0.3, 0.65), 0.28, sx);
      }
    }
  }
}

/**
 * Só a cabeça do piloto, com materiais próprios — usada para gerar os
 * retratos da interface (seleção de piloto, pódio e classificação).
 */
export function buildAnimalHead(animal) {
  const head = new THREE.Group();
  addAnimalHead(head, animalMaterials(animal));
  return head;
}

/* ------------------------------------------------------------------ */
/* Modelo 3D: kart pequeno + piloto-animal grande (estilo Mario Kart)   */
/* aponta para +Z                                                       */
/* ------------------------------------------------------------------ */
function buildCarMesh(color, animal = {}) {
  const mats = animalMaterials({ ...animal, color: animal.color ?? color });
  const { coat, fur, accMat, white, black } = mats;

  const g = new THREE.Group();
  const kartMat = new THREE.MeshStandardMaterial({ color, roughness: 0.4, metalness: 0.35 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x14171c, roughness: 0.6, metalness: 0.2 });
  const rubber = new THREE.MeshStandardMaterial({ color: 0x1a1a1c, roughness: 0.95 });
  const chrome = new THREE.MeshStandardMaterial({ color: 0xb9c2cc, roughness: 0.25, metalness: 0.9 });

  const add = (geo, mat, x, y, z, parent = g) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    parent.add(m);
    return m;
  };

  // --- KART ---
  // assoalho e quadro
  add(new THREE.BoxGeometry(1.34, 0.12, 2.9), dark, 0, 0.30, -0.1);        // assoalho
  add(new THREE.BoxGeometry(1.46, 0.10, 0.9), dark, 0, 0.30, -1.05);       // traseira do assoalho

  // bico: cunha baixa à frente, no lugar do antigo bloco reto
  const nose = add(new THREE.CylinderGeometry(0.18, 0.52, 0.85, 4), kartMat, 0, 0.38, 1.3);
  nose.rotation.set(Math.PI / 2, Math.PI / 4, 0);
  nose.scale.set(1, 1, 0.5);

  // para-choques tubulares
  const bumper = (z, len) => {
    const b = add(new THREE.CapsuleGeometry(0.09, len, 3, 10), chrome, 0, 0.30, z);
    b.rotation.z = Math.PI / 2;
    return b;
  };
  bumper(1.72, 1.5);
  bumper(-1.62, 1.55);
  for (const sx of [1, -1]) {                                              // hastes do para-choque
    add(new THREE.CylinderGeometry(0.05, 0.05, 0.5, 6), chrome, sx * 0.5, 0.30, 1.5).rotation.x = Math.PI / 2;
    add(new THREE.CylinderGeometry(0.05, 0.05, 0.5, 6), chrome, sx * 0.5, 0.30, -1.4).rotation.x = Math.PI / 2;
  }

  // pontões laterais arredondados, presos por dois tubos cada
  for (const sx of [1, -1]) {
    const pod = add(new THREE.CapsuleGeometry(0.20, 1.5, 3, 10), kartMat, sx * 0.84, 0.40, -0.15);
    pod.rotation.x = Math.PI / 2;
    pod.scale.set(1, 1, 0.72);
    add(new THREE.CylinderGeometry(0.045, 0.045, 0.42, 6), chrome, sx * 0.6, 0.40, 0.45).rotation.z = Math.PI / 2;
    add(new THREE.CylinderGeometry(0.045, 0.045, 0.42, 6), chrome, sx * 0.6, 0.40, -0.75).rotation.z = Math.PI / 2;
  }

  // banco envolvente
  add(new THREE.BoxGeometry(0.98, 0.18, 0.92), dark, 0, 0.50, -0.72);      // assento
  const back = add(new THREE.CapsuleGeometry(0.44, 0.5, 3, 10), dark, 0, 0.82, -1.14);
  back.rotation.z = Math.PI / 2;
  back.scale.set(1, 1, 0.45);
  for (const sx of [1, -1]) {                                              // laterais do banco
    const side = add(new THREE.CapsuleGeometry(0.16, 0.5, 3, 8), dark, sx * 0.46, 0.62, -0.78);
    side.rotation.x = Math.PI / 2;
    side.scale.set(0.7, 1, 1);
  }

  // motor e escapamento, do lado direito como num kart de verdade
  add(new THREE.BoxGeometry(0.42, 0.42, 0.6), dark, 0.62, 0.62, -1.15);
  const pipe = add(new THREE.TorusGeometry(0.3, 0.055, 6, 14, Math.PI * 1.1), chrome, 0.72, 0.72, -1.5);
  pipe.rotation.set(0, Math.PI / 2, -0.6);
  add(new THREE.CylinderGeometry(0.1, 0.075, 0.5, 10), chrome, 0.72, 0.95, -1.85).rotation.x = Math.PI / 2.4;

  // asa traseira baixa
  add(new THREE.BoxGeometry(1.15, 0.07, 0.3), kartMat, 0, 1.22, -1.5);
  for (const sx of [1, -1]) {
    add(new THREE.BoxGeometry(0.06, 0.42, 0.22), kartMat, sx * 0.5, 1.02, -1.5);
  }

  // coluna de direção
  add(new THREE.CylinderGeometry(0.045, 0.045, 0.75, 8), chrome, 0, 0.70, 0.52).rotation.x = 0.6;

  // volante (gira com o esterço): aro + três raios + cubo
  const steerHub = new THREE.Group();
  steerHub.userData.dynamic = true;
  steerHub.position.set(0, 0.98, 0.63);
  steerHub.rotation.x = -0.55;
  const steerRing = new THREE.Group();
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.23, 0.042, 7, 18), dark);
  ring.castShadow = true;
  steerRing.add(ring);
  for (let i = 0; i < 3; i++) {
    const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.23, 0.035), dark);
    spoke.position.set(Math.sin(i * 2.094) * 0.11, Math.cos(i * 2.094) * 0.11, 0);
    spoke.rotation.z = -i * 2.094;
    steerRing.add(spoke);
  }
  steerRing.add(new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.06, 10), chrome).rotateX(Math.PI / 2));
  flattenByMaterial(steerRing); // aro + raios + cubo viram 2 peças
  steerHub.add(steerRing);
  g.add(steerHub);

  // --- PILOTO-ANIMAL (grande) ---
  const driver = new THREE.Group();
  driver.position.set(0, 0, -0.5);
  g.add(driver);

  // tronco
  add(torsoGeometry(0.52), fur, 0, 0.98, 0, driver);

  // ventre claro (nas aves, o peito colorido da espécie)
  add(new THREE.SphereGeometry(0.34, 14, 10), coat === 'pena' ? accMat : white, 0, 0.88, 0.3, driver)
    .scale.set(0.92, 1.2, 0.72);

  // pescoço, para a cabeça não pousar solta em cima do tronco
  add(new THREE.CapsuleGeometry(0.19, 0.14, 4, 10), fur, 0, 1.5, 0.04, driver);

  // braços em dois segmentos: ombro, cotovelo dobrado e a mão no aro
  for (const sx of [1, -1]) {
    const shoulder = new THREE.Group();
    shoulder.position.set(sx * 0.45, 1.16, 0.06);
    shoulder.rotation.set(-1.15, 0, -sx * 0.22);
    driver.add(shoulder);
    add(new THREE.SphereGeometry(0.17, 12, 10), fur, 0, 0, 0, shoulder);
    add(new THREE.CapsuleGeometry(0.1, 0.34, 4, 10), fur, 0, -0.28, 0, shoulder);

    const elbow = new THREE.Group();
    elbow.position.set(0, -0.55, 0);
    elbow.rotation.x = -0.35;
    shoulder.add(elbow);
    add(new THREE.SphereGeometry(0.1, 10, 8), fur, 0, 0, 0, elbow);
    add(new THREE.CapsuleGeometry(0.085, 0.28, 4, 10), fur, 0, -0.24, 0, elbow);

    const hand = add(new THREE.SphereGeometry(0.13, 12, 10), accMat, 0, -0.46, 0.03, elbow);
    hand.scale.set(0.95, 0.85, 1.15);
    add(new THREE.SphereGeometry(0.055, 8, 6), accMat, -sx * 0.09, -0.42, 0.1, elbow); // polegar
  }

  // cabeça
  const head = new THREE.Group();
  head.position.set(0, 1.74, 0.08);
  driver.add(head);
  addAnimalHead(head, mats);

  /**
   * Roda em dois níveis: `hub` esterça em Y, `spin` gira em X dentro dele.
   * Num grupo só, as duas rotações se compõem na ordem errada e a roda
   * bamboleia quando o volante está virado, em vez de girar no próprio eixo.
   */
  const wheels = [];
  const mkWheel = (x, z, r, width, front) => {
    const hub = new THREE.Group();
    hub.userData.dynamic = true;
    hub.position.set(x, r, z);

    const spin = new THREE.Group();
    spin.userData.dynamic = true;
    hub.add(spin);

    // pneu revolucionado: ombro chanfrado e parede lateral reta, em vez do
    // cilindro de bordas vivas
    const half = width / 2;
    const sh = r * 0.13;
    const tyre = new THREE.Mesh(new THREE.LatheGeometry([
      new THREE.Vector2(r * 0.5, -half),
      new THREE.Vector2(r * 0.9, -half),
      new THREE.Vector2(r, -half + sh),
      new THREE.Vector2(r, half - sh),
      new THREE.Vector2(r * 0.9, half),
      new THREE.Vector2(r * 0.5, half),
    ], 18), rubber);
    tyre.rotation.z = Math.PI / 2;
    tyre.castShadow = true;
    spin.add(tyre);

    // aro: disco, raios e porca central
    const rimR = r * 0.54;
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(rimR, rimR, width * 0.86, 16), chrome);
    disc.rotation.z = Math.PI / 2;
    spin.add(disc);
    for (let i = 0; i < 4; i++) {
      const spoke = new THREE.Mesh(new THREE.BoxGeometry(width * 0.95, rimR * 1.75, 0.05), chrome);
      spoke.rotation.x = (i / 4) * Math.PI;
      spin.add(spoke);
    }
    const nut = new THREE.Mesh(new THREE.CylinderGeometry(rimR * 0.3, rimR * 0.3, width * 0.95, 8), dark);
    nut.rotation.z = Math.PI / 2;
    spin.add(nut);

    flattenByMaterial(spin); // 4 peças viram 2 (borracha + cromo)

    hub.userData.front = front;
    hub.userData.spin = spin;
    hub.userData.radius = r;
    g.add(hub);
    wheels.push(hub);
  };
  mkWheel(0.86, 1.12, 0.32, 0.30, true);
  mkWheel(-0.86, 1.12, 0.32, 0.30, true);
  mkWheel(0.94, -1.20, 0.42, 0.46, false);
  mkWheel(-0.94, -1.20, 0.42, 0.46, false);

  // sombra de contato: mancha escura logo abaixo do kart. A sombra do sol é
  // rasante e distante; sem isto o carro parece flutuar em alguns ângulos.
  const blob = new THREE.Mesh(
    new THREE.CircleGeometry(1.9, 20),
    new THREE.MeshBasicMaterial({
      map: blobTexture(), transparent: true, depthWrite: false, opacity: 0.5,
    })
  );
  blob.userData.dynamic = true; // transparente: fica fora do merge
  blob.rotation.x = -Math.PI / 2;
  blob.position.y = 0.045;
  blob.scale.set(1, 1.55, 1); // alongada no sentido do kart
  blob.renderOrder = 3;
  g.add(blob);

  flattenByMaterial(g);

  g.userData.wheels = wheels;
  g.userData.steerRing = steerRing;
  return g;
}

let _blobTex = null;
function blobTexture() {
  if (_blobTex) return _blobTex;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0.0, 'rgba(0,0,0,0.85)');
  grad.addColorStop(0.55, 'rgba(0,0,0,0.35)');
  grad.addColorStop(1.0, 'rgba(0,0,0,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  _blobTex = new THREE.CanvasTexture(c);
  return _blobTex;
}

/* ------------------------------------------------------------------ */

export class Car {
  constructor({ color, name, animal = {}, isPlayer = false, spec = CAR_SPEC }) {
    this.name = name;
    this.color = color;
    this.animal = animal;
    this.isPlayer = isPlayer;
    this.spec = spec;
    this.mesh = buildCarMesh(color, animal);
    this.wheels = this.mesh.userData.wheels;

    this.x = 0; this.z = 0;
    this.heading = 0;
    this.speed = 0;
    this.steer = 0;
    this.lateral = 0;
    this.u = 0; this.prevU = 0;
    this.lap = 0;
    this.progress = 0;
    this.offTrack = false;
    this.wallHit = 0;
    this.lapStart = 0;
    this.lapTimes = [];
    this.bestLap = null;
    this.finished = false;
    this.finishTime = null;
    // lidos pelos efeitos visuais: quanto o pneu escorrega (0..1) e se o
    // freio de mão está acionado
    this.slip = 0;
    this.handbrake = false;
    this.inPit = false;   // true quando o carro está do lado dos boxes do muro
  }

  get dirX() { return Math.cos(this.heading); }
  get dirZ() { return Math.sin(this.heading); }

  /** Troca o piloto sem recriar o objeto: reconstrói a malha no mesmo lugar. */
  setAppearance(animal) {
    const parent = this.mesh.parent;
    parent?.remove(this.mesh);
    this.mesh.traverse((o) => { if (o.isMesh) o.geometry?.dispose(); });

    this.animal = animal;
    this.color = animal.color;
    this.name = animal.name;
    this.mesh = buildCarMesh(animal.color, animal);
    this.wheels = this.mesh.userData.wheels;
    parent?.add(this.mesh);
    this.syncMesh();
  }

  reset(u, lateral) {
    sample(u, lateral, _s);
    this.x = _s.x; this.z = _s.z;
    this.heading = Math.atan2(_s.dz, _s.dx);
    this.speed = 0;
    this.steer = 0;
    this.lap = -1; // vira 0 ao cruzar a linha (largada) e conta a partir daí
    this.lapTimes = [];
    this.bestLap = null;
    this.finished = false;
    this.finishTime = null;
    this.lapStart = 0;
    this.wallHit = 0;
    this.slip = 0;
    this.handbrake = false;
    this.inPit = false;
    project(this.x, this.z, _p);
    this.u = this.prevU = _p.u;
    this.lateral = _p.lateral;
    this.progress = this.lap + _p.u;
    this.syncMesh();
  }

  /** ctrl: { throttle, brake, steer, handbrake } */
  update(dt, ctrl, raceTime) {
    const S = this.spec;
    // a pit lane é asfalto como a pista: quem entra nos boxes não é penalizado
    // a pit lane é asfalto contíguo à pista, então não há margem entre as duas
    const pit = pitBounds(signedMeters(this.u));
    const onAsphalt = Math.abs(this.lateral) <= TRACK.halfWidth - 0.3
      || (!!pit && this.lateral > TRACK.halfWidth - 0.3 && this.lateral < pit[1] - 0.3);
    this.offTrack = !onAsphalt;
    const grip = onAsphalt ? 1 : 0.45;

    const v = this.speed;
    const ratio = Math.max(0, v) / S.maxSpeed;

    // --- longitudinal ---
    let a = 0;
    if (ctrl.throttle > 0) {
      a += S.accel * ctrl.throttle * Math.max(0, 1 - ratio) * (onAsphalt ? 1 : 0.4);
    }
    if (ctrl.brake > 0) {
      if (v > 0.6) a -= S.brake * ctrl.brake * grip;
      else if (v > -S.maxReverse) a -= S.reverse * ctrl.brake;
    }
    if (ctrl.handbrake && Math.abs(v) > 0.2) a -= Math.sign(v) * S.handbrake;

    if (Math.abs(v) > 0.05) {
      a -= Math.sign(v) * (1 - ctrl.throttle) * (S.coast * Math.abs(v) + S.roll);
      if (!onAsphalt) a -= Math.sign(v) * (S.offDrag * Math.abs(v) + S.offRoll);
    }
    if (!ctrl.throttle && !ctrl.brake && Math.abs(v) < 0.4) { this.speed = 0; a = 0; }

    this.speed += a * dt;
    this.speed = Math.max(-S.maxReverse, Math.min(S.maxSpeed, this.speed));

    // --- direção ---
    this.steer += (ctrl.steer - this.steer) * Math.min(1, dt * 8);
    const speedFactor = Math.min(1, Math.abs(this.speed) / 8) * (1 - 0.45 * ratio);
    const dirSign = this.speed >= 0 ? 1 : -1;
    const extra = ctrl.handbrake ? 1.5 : 1;
    const angular = this.steer * S.turn * speedFactor * grip * dirSign * extra;
    this.heading = wrapAngle(this.heading + angular * dt);

    // curva rouba velocidade (obriga a levantar o pé nas curvas)
    this.speed -= Math.abs(angular) * Math.abs(this.speed) * S.corneringDrag * dt;

    // aceleração lateral normalizada — vira fumaça de pneu e marca no asfalto
    this.handbrake = !!ctrl.handbrake;
    this.slip = Math.min(1, (Math.abs(angular) * Math.abs(this.speed)) / 34);

    // --- integração ---
    this.x += Math.cos(this.heading) * this.speed * dt;
    this.z += Math.sin(this.heading) * this.speed * dt;

    // --- pista: progresso, laterais e muros ---
    project(this.x, this.z, _p);
    this.u = _p.u;
    this.lateral = _p.lateral;

    /* Limites laterais. Nas duas bocas da bifurcação pista e pit lane são um
     * espaço só e o carro escolhe o lado; no meio o muro divisor separa, e aí
     * ele fica preso do lado em que entrou — daí o estado `inPit`. */
    const m = signedMeters(this.u);
    const now = pitBounds(m);
    const divided = pitDivided(m);
    this.inPit = !!now && (divided ? this.inPit : this.lateral > PIT.divider);

    const hi = now ? (this.inPit || !divided ? now[1] : PIT.divider) : TRACK.wallLat;
    const lo = this.inPit && divided ? PIT.inner : -TRACK.wallLat;

    const hiLim = hi - S.halfWidth;
    const loLim = lo + S.halfWidth;
    if (this.lateral > hiLim || this.lateral < loLim) {
      const clamped = this.lateral > hiLim ? hiLim : loLim;
      const sgn = this.lateral > hiLim ? 1 : -1;
      sample(this.u, clamped, _s);
      this.x = _s.x; this.z = _s.z;
      this.lateral = clamped;
      const trackHeading = Math.atan2(_s.dz, _s.dx);
      const diff = wrapAngle(trackHeading - this.heading);
      this.heading = wrapAngle(this.heading + diff * 0.6);
      const impact = Math.min(1, Math.abs(diff) * 1.6);
      this.speed *= 1 - 0.55 * impact;
      this.wallHit = Math.max(this.wallHit, impact);
      // ponto de contato, para as faíscas saírem do muro e não do centro do kart
      this.wallX = _s.x + _s.nx * sgn * S.halfWidth;
      this.wallZ = _s.z + _s.nz * sgn * S.halfWidth;
    }

    // --- contagem de voltas ---
    const du = this.u - this.prevU;
    if (du < -0.5) {
      this.lap++;
      if (this.lap >= 1) {
        const t = raceTime - this.lapStart;
        this.lapTimes.push(t);
        if (this.bestLap === null || t < this.bestLap) this.bestLap = t;
      }
      this.lapStart = raceTime;
    } else if (du > 0.5) {
      this.lap--;
    }
    this.prevU = this.u;
    this.progress = this.lap + this.u;

    this.syncMesh(dt);
  }

  syncMesh(dt = 0) {
    const m = this.mesh;
    m.position.set(this.x, 0, this.z);
    m.rotation.y = Math.atan2(Math.cos(this.heading), Math.sin(this.heading));

    // inclinação de carroceria na curva
    m.rotation.z = this.steer * Math.min(1, Math.abs(this.speed) / this.spec.maxSpeed) * 0.09;

    // volante gira com o esterço
    if (m.userData.steerRing) m.userData.steerRing.rotation.z = -this.steer * 1.3;

    if (dt > 0) {
      for (const w of this.wheels) {
        // cada roda gira pelo próprio raio; acima de ~0,5 rad por quadro o
        // pneu vira estroboscópio (parece tremer ou girar ao contrário), então
        // a rotação aparente satura em vez de acompanhar a velocidade real
        const d = (this.speed * dt) / w.userData.radius;
        w.userData.spin.rotation.x -= Math.max(-0.5, Math.min(0.5, d));
        if (w.userData.front) w.rotation.y = -this.steer * 0.42;
      }
    }
  }

  /** distância percorrida em metros (para calcular gap) */
  get distance() { return this.progress * PERIMETER; }
}
