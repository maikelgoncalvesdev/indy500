import * as THREE from 'three';
import { TRACK, PERIMETER, sample, project } from './track.js';

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
/* Cabeça do piloto-animal (varia por espécie), centrada na origem      */
/* ------------------------------------------------------------------ */
function addAnimalHead(head, o) {
  const { fur, accMat, white, black, kind, spots } = o;
  const mk = (geo, mat, x, y, z, parent = head) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    parent.add(m);
    return m;
  };

  // crânio
  mk(new THREE.SphereGeometry(0.44, 18, 14), fur, 0, 0, 0);

  // olhos (répteis os têm no topo; répteis reposicionam depois)
  const eyeY = kind === 'reptil' ? 0.28 : 0.08;
  const eyeZ = kind === 'reptil' ? 0.18 : 0.34;
  for (const sx of [1, -1]) {
    mk(new THREE.SphereGeometry(0.1, 10, 8), white, sx * 0.2, eyeY, eyeZ);
    mk(new THREE.SphereGeometry(0.05, 8, 6), black, sx * 0.2, eyeY, eyeZ + 0.08);
  }

  switch (kind) {
    case 'ave': { // tucano, arara: bico grande e topete, sem orelhas
      const beak = mk(new THREE.ConeGeometry(0.17, 0.62, 14), accMat, 0, -0.04, 0.55);
      beak.rotation.x = Math.PI / 2;
      mk(new THREE.ConeGeometry(0.09, 0.24, 6), accMat, 0, 0.46, -0.05).rotation.x = -0.4;
      break;
    }
    case 'primata': { // macaco, quati: orelhas redondas nas laterais + focinho claro
      for (const sx of [1, -1]) mk(new THREE.SphereGeometry(0.14, 10, 8), fur, sx * 0.44, 0.04, 0).scale.set(0.55, 1, 1);
      mk(new THREE.SphereGeometry(0.27, 12, 10), accMat, 0, -0.12, 0.3).scale.set(1, 0.78, 0.8);
      mk(new THREE.SphereGeometry(0.06, 8, 6), black, 0, -0.06, 0.54);
      break;
    }
    case 'roedor': { // capivara, tatu: orelhinhas no topo, focinho quadrado, dentes
      for (const sx of [1, -1]) mk(new THREE.SphereGeometry(0.1, 10, 8), fur, sx * 0.27, 0.4, -0.02);
      mk(new THREE.BoxGeometry(0.32, 0.26, 0.36), fur, 0, -0.14, 0.34);
      mk(new THREE.BoxGeometry(0.13, 0.13, 0.06), white, 0, -0.24, 0.52);
      mk(new THREE.SphereGeometry(0.06, 8, 6), black, 0, -0.04, 0.54);
      break;
    }
    case 'reptil': { // jacaré: focinho comprido e chato com dentes
      mk(new THREE.BoxGeometry(0.36, 0.18, 0.7), fur, 0, -0.16, 0.5);
      mk(new THREE.BoxGeometry(0.3, 0.06, 0.6), white, 0, -0.26, 0.5);
      mk(new THREE.SphereGeometry(0.05, 8, 6), black, 0.09, -0.07, 0.86);
      mk(new THREE.SphereGeometry(0.05, 8, 6), black, -0.09, -0.07, 0.86);
      break;
    }
    case 'canideo': { // lobo-guará: orelhas pontudas e altas, focinho médio
      for (const sx of [1, -1]) mk(new THREE.ConeGeometry(0.12, 0.34, 5), fur, sx * 0.23, 0.48, 0);
      mk(new THREE.BoxGeometry(0.22, 0.2, 0.42), fur, 0, -0.14, 0.44).scale.set(1, 1, 1);
      mk(new THREE.SphereGeometry(0.07, 8, 6), black, 0, -0.12, 0.66);
      break;
    }
    case 'tamandua': { // tamanduá: focinho tubular bem comprido
      mk(new THREE.CylinderGeometry(0.14, 0.05, 0.85, 10), fur, 0, -0.1, 0.58).rotation.x = Math.PI / 2;
      for (const sx of [1, -1]) mk(new THREE.SphereGeometry(0.08, 8, 6), fur, sx * 0.3, 0.34, -0.04);
      break;
    }
    case 'preguica': { // preguiça: orelhinhas, máscara escura nos olhos, focinho
      for (const sx of [1, -1]) mk(new THREE.SphereGeometry(0.11, 10, 8), fur, sx * 0.3, 0.32, -0.06);
      for (const sx of [1, -1]) mk(new THREE.TorusGeometry(0.12, 0.035, 6, 12), accMat, sx * 0.2, 0.08, 0.36);
      mk(new THREE.SphereGeometry(0.16, 10, 8), accMat, 0, -0.12, 0.34).scale.set(1, 0.8, 0.9);
      mk(new THREE.SphereGeometry(0.06, 8, 6), black, 0, -0.08, 0.5);
      break;
    }
    default: { // felino: onça, jaguatirica — orelhas triangulares + focinho
      for (const sx of [1, -1]) {
        mk(new THREE.ConeGeometry(0.15, 0.27, 4), fur, sx * 0.26, 0.42, -0.02);
        mk(new THREE.ConeGeometry(0.08, 0.16, 4), accMat, sx * 0.26, 0.44, 0.02);
      }
      mk(new THREE.SphereGeometry(0.21, 12, 10), fur, 0, -0.12, 0.34).scale.set(1, 0.72, 0.9);
      mk(new THREE.SphereGeometry(0.07, 8, 6), black, 0, -0.06, 0.52);
    }
  }

  // manchas (onça-pintada / jaguatirica)
  if (spots) {
    const spotMat = new THREE.MeshStandardMaterial({ color: 0x241b12, roughness: 0.75 });
    for (const [x, y, z] of [[0.3, 0.16, 0.2], [-0.28, 0.2, 0.14], [0.16, -0.16, 0.32], [-0.2, -0.06, 0.34], [0.34, -0.02, 0.02], [-0.34, 0.06, -0.02]]) {
      mk(new THREE.SphereGeometry(0.06, 8, 6), spotMat, x, y, z).scale.set(1, 1, 0.35);
    }
  }
}

/* ------------------------------------------------------------------ */
/* Modelo 3D: kart pequeno + piloto-animal grande (estilo Mario Kart)   */
/* aponta para +Z                                                       */
/* ------------------------------------------------------------------ */
function buildCarMesh(color, animal = {}) {
  const kind = animal.kind || 'felino';
  const accent = animal.accent ?? 0x2a2018;
  const spots = !!animal.spots;

  const g = new THREE.Group();
  const kartMat = new THREE.MeshStandardMaterial({ color, roughness: 0.4, metalness: 0.35 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x14171c, roughness: 0.6, metalness: 0.2 });
  const rubber = new THREE.MeshStandardMaterial({ color: 0x1a1a1c, roughness: 0.95 });
  const chrome = new THREE.MeshStandardMaterial({ color: 0xb9c2cc, roughness: 0.25, metalness: 0.9 });
  const fur = new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0.02 });
  const accMat = new THREE.MeshStandardMaterial({ color: accent, roughness: 0.7, metalness: 0.05 });
  const white = new THREE.MeshStandardMaterial({ color: 0xf4f4f4, roughness: 0.5 });
  const black = new THREE.MeshStandardMaterial({ color: 0x101014, roughness: 0.5 });

  const add = (geo, mat, x, y, z, parent = g) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    parent.add(m);
    return m;
  };

  // --- KART (pequeno e baixo) ---
  add(new THREE.BoxGeometry(1.5, 0.18, 3.0), dark, 0, 0.34, -0.1);         // assoalho
  add(new THREE.BoxGeometry(1.7, 0.14, 0.5), kartMat, 0, 0.36, 1.5);       // para-choque diant.
  add(new THREE.BoxGeometry(1.7, 0.14, 0.5), kartMat, 0, 0.36, -1.55);     // para-choque tras.
  add(new THREE.BoxGeometry(0.26, 0.32, 2.2), kartMat, 0.86, 0.45, -0.2);  // pontão dir.
  add(new THREE.BoxGeometry(0.26, 0.32, 2.2), kartMat, -0.86, 0.45, -0.2); // pontão esq.
  add(new THREE.BoxGeometry(1.02, 0.72, 0.24), kartMat, 0, 0.82, -1.18);   // encosto do banco
  add(new THREE.BoxGeometry(1.02, 0.22, 0.95), dark, 0, 0.55, -0.72);      // assento
  add(new THREE.CylinderGeometry(0.05, 0.05, 0.7, 8), chrome, 0, 0.72, 0.5).rotation.x = 0.6; // coluna

  // volante (gira com o esterço)
  const steerHub = new THREE.Group();
  steerHub.position.set(0, 0.98, 0.6);
  steerHub.rotation.x = -0.55;
  const steerRing = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.045, 8, 20), dark);
  steerRing.castShadow = true;
  steerHub.add(steerRing);
  g.add(steerHub);

  // --- PILOTO-ANIMAL (grande) ---
  const driver = new THREE.Group();
  driver.position.set(0, 0, -0.5);
  g.add(driver);

  // tronco
  add(new THREE.SphereGeometry(0.5, 16, 12), fur, 0, 0.98, 0, driver).scale.set(1.05, 1.15, 0.85);
  if (spots) {
    const spotMat = new THREE.MeshStandardMaterial({ color: 0x241b12, roughness: 0.75 });
    for (const [x, y, z] of [[0.28, 1.05, 0.35], [-0.3, 0.9, 0.3], [0.2, 0.8, 0.38], [-0.15, 1.15, 0.32]]) {
      add(new THREE.SphereGeometry(0.07, 8, 6), spotMat, x, y, z, driver).scale.set(1, 1, 0.3);
    }
  }

  // braços até o volante
  for (const sx of [1, -1]) {
    const arm = new THREE.Group();
    arm.position.set(sx * 0.44, 1.08, 0.12);
    arm.rotation.x = -1.15;
    arm.rotation.z = sx * 0.28;
    const a = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.09, 0.9, 10), fur);
    a.position.y = -0.42;
    a.castShadow = true;
    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.12, 10, 8), accMat);
    hand.position.y = -0.85;
    arm.add(a, hand);
    driver.add(arm);
  }

  // cabeça
  const head = new THREE.Group();
  head.position.set(0, 1.66, 0.1);
  driver.add(head);
  addAnimalHead(head, { fur, accMat, white, black, kind, spots });

  // --- rodas de kart (traseiras maiores); grupo gira em X ---
  const wheels = [];
  const mkWheel = (x, z, r, front) => {
    const w = new THREE.Group();
    w.position.set(x, r, z);
    const t = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 0.36, 16), rubber);
    t.rotation.z = Math.PI / 2;
    t.castShadow = true;
    const rim = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.5, r * 0.5, 0.38, 10), chrome);
    rim.rotation.z = Math.PI / 2;
    w.add(t, rim);
    w.userData.front = front;
    g.add(w);
    wheels.push(w);
  };
  mkWheel(0.84, 1.1, 0.34, true);
  mkWheel(-0.84, 1.1, 0.34, true);
  mkWheel(0.92, -1.2, 0.44, false);
  mkWheel(-0.92, -1.2, 0.44, false);

  g.userData.wheels = wheels;
  g.userData.steerRing = steerRing;
  return g;
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
  }

  get dirX() { return Math.cos(this.heading); }
  get dirZ() { return Math.sin(this.heading); }

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
    project(this.x, this.z, _p);
    this.u = this.prevU = _p.u;
    this.lateral = _p.lateral;
    this.progress = this.lap + _p.u;
    this.syncMesh();
  }

  /** ctrl: { throttle, brake, steer, handbrake } */
  update(dt, ctrl, raceTime) {
    const S = this.spec;
    const onAsphalt = Math.abs(this.lateral) <= TRACK.halfWidth - 0.3;
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

    // --- integração ---
    this.x += Math.cos(this.heading) * this.speed * dt;
    this.z += Math.sin(this.heading) * this.speed * dt;

    // --- pista: progresso, laterais e muros ---
    project(this.x, this.z, _p);
    this.u = _p.u;
    this.lateral = _p.lateral;

    const limit = TRACK.wallLat - S.halfWidth;
    if (Math.abs(this.lateral) > limit) {
      const sgn = Math.sign(this.lateral);
      sample(this.u, sgn * limit, _s);
      this.x = _s.x; this.z = _s.z;
      this.lateral = sgn * limit;
      const trackHeading = Math.atan2(_s.dz, _s.dx);
      const diff = wrapAngle(trackHeading - this.heading);
      this.heading = wrapAngle(this.heading + diff * 0.6);
      const impact = Math.min(1, Math.abs(diff) * 1.6);
      this.speed *= 1 - 0.55 * impact;
      this.wallHit = Math.max(this.wallHit, impact);
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
      const spin = (this.speed * dt) / 0.46;
      for (const w of this.wheels) {
        w.rotation.x -= spin;
        if (w.userData.front) w.rotation.y = -this.steer * 0.42;
      }
    }
  }

  /** distância percorrida em metros (para calcular gap) */
  get distance() { return this.progress * PERIMETER; }
}
