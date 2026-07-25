import { TRACK, PERIMETER, sample, project, curvatureAt } from './track.js';
import { CAR_SPEC } from './car.js';

const _aim = {};
const _p = {};

function wrapAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/**
 * Piloto da CPU: segue uma linha de corrida (fora nas retas, dentro nas curvas),
 * respeita um limite de velocidade em curva e desvia do rival.
 */
export class AIDriver {
  constructor(car, skill = 1) {
    this.car = car;
    this.skill = skill;
    this.lineLat = 0;
    this.noiseT = 0;
    this.noise = 0;
    this.latAccel = 37 * skill;   // define a velocidade máxima de curva
    this.ctrl = { throttle: 0, brake: 0, steer: 0, handbrake: false };
  }

  reset() {
    this.lineLat = 0;
    this.noise = 0;
    this.noiseT = 0;
  }

  update(dt, rivals, rubberBand = 0) {
    const car = this.car;
    project(car.x, car.z, _p);

    // ---- linha de corrida ----
    const ratio = car.speed / CAR_SPEC.maxSpeed;
    const look = 0.010 + 0.030 * ratio;          // olhar à frente (fração da volta)
    const kNow = curvatureAt(_p.u + look * 0.6);
    const kSoon = curvatureAt(_p.u + look * 2.2);

    // dentro na curva, fora na reta antes de entrar
    let target = kNow > 0 ? TRACK.halfWidth * 0.55
      : (kSoon > 0 ? -TRACK.halfWidth * 0.45 : -TRACK.halfWidth * 0.15);

    // ---- desvio: considera só o carro mais próximo logo à frente ----
    let blocker = null, blockDist = Infinity;
    for (const r of rivals) {
      if (r === car) continue;
      const dx = r.x - car.x, dz = r.z - car.z;
      const ahead = dx * Math.cos(car.heading) + dz * Math.sin(car.heading);
      const dist = Math.hypot(dx, dz);
      if (ahead > 0 && dist < 18 && dist < blockDist && Math.abs(r.lateral - car.lateral) < 4.0) {
        blocker = r; blockDist = dist;
      }
    }

    let followSpeed = null;
    if (blocker) {
      // tenta os dois lados; se nenhum couber na pista, fica atrás e alivia
      const lim = TRACK.halfWidth - 2.5;
      const sides = [blocker.lateral - 6.5, blocker.lateral + 6.5].filter((s) => Math.abs(s) <= lim);
      if (sides.length) {
        target = sides.reduce((a, b) => (Math.abs(b - this.lineLat) < Math.abs(a - this.lineLat) ? b : a));
      } else {
        target = this.lineLat;
      }
      if (blockDist < 11) followSpeed = blocker.speed * 0.96;
    }

    // ruído para não parecer um trilho
    this.noiseT -= dt;
    if (this.noiseT <= 0) { this.noiseT = 1.2 + Math.random() * 2; this.noise = (Math.random() - 0.5) * 3.5; }
    target += this.noise;

    this.lineLat += (target - this.lineLat) * Math.min(1, dt * 1.6);

    // ---- esterço ----
    sample(_p.u + look, this.lineLat, _aim);
    const desired = Math.atan2(_aim.z - car.z, _aim.x - car.x);
    const diff = wrapAngle(desired - car.heading);
    this.ctrl.steer = clamp(diff * 2.4, -1, 1);

    // ---- velocidade alvo ----
    const kAhead = Math.max(curvatureAt(_p.u + look * 1.6), curvatureAt(_p.u + look * 0.5));
    let vTarget = kAhead > 0 ? Math.sqrt(this.latAccel / kAhead) : CAR_SPEC.maxSpeed;
    vTarget *= 0.97 + rubberBand;                       // ajuste fino de disputa
    if (followSpeed != null) vTarget = Math.min(vTarget, followSpeed); // não bater em quem está à frente
    if (car.offTrack) vTarget = Math.min(vTarget, 30);  // se saiu, volta com calma
    if (Math.abs(diff) > 0.35) vTarget *= 0.75;         // muito desalinhado: alivia

    const err = vTarget - car.speed;
    this.ctrl.throttle = err > 0 ? clamp(err / 6, 0, 1) : 0;
    this.ctrl.brake = err < -2 ? clamp(-err / 10, 0, 1) : 0;
    this.ctrl.handbrake = false;

    return this.ctrl;
  }
}
