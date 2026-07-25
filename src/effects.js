import * as THREE from 'three';

/**
 * Efeitos de contato do carro com o mundo: fumaça de pneu, poeira na grama,
 * faíscas no muro e as marcas deixadas no asfalto. Tudo em pools de tamanho
 * fixo (nada é alocado durante a corrida) e em poucos draw calls.
 */

/** Disco borrado usado como sprite de partícula. */
function puffTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0.0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.35, 'rgba(255,255,255,0.55)');
  grad.addColorStop(1.0, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  // granulado para a fumaça não parecer uma bola perfeita
  g.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < 40; i++) {
    g.fillStyle = `rgba(0,0,0,${Math.random() * 0.35})`;
    g.beginPath();
    g.arc(Math.random() * 64, Math.random() * 64, 2 + Math.random() * 6, 0, Math.PI * 2);
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

class ParticlePool {
  constructor(count, { additive = false, texture, sizeScale = 190 }) {
    this.count = count;
    this.head = 0;

    const geo = new THREE.BufferGeometry();
    this.pos = new Float32Array(count * 3);
    this.col = new Float32Array(count * 3);
    this.alpha = new Float32Array(count);
    this.size = new Float32Array(count);
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('aColor', new THREE.BufferAttribute(this.col, 3));
    geo.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1));
    geo.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1));
    this.geo = geo;

    this.vel = new Float32Array(count * 3);
    this.life = new Float32Array(count);
    this.maxLife = new Float32Array(count);
    this.grow = new Float32Array(count);
    this.drag = new Float32Array(count);
    this.gravity = new Float32Array(count);
    this.alpha0 = new Float32Array(count);

    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      uniforms: { uMap: { value: texture }, uScale: { value: sizeScale } },
      vertexShader: `
        attribute float aAlpha;
        attribute float aSize;
        attribute vec3 aColor;
        varying float vAlpha;
        varying vec3 vColor;
        uniform float uScale;
        void main() {
          vAlpha = aAlpha;
          vColor = aColor;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = aSize * uScale / max(1.0, -mv.z);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        uniform sampler2D uMap;
        varying float vAlpha;
        varying vec3 vColor;
        void main() {
          vec4 t = texture2D(uMap, gl_PointCoord);
          if (t.a * vAlpha < 0.004) discard;
          gl_FragColor = vec4(vColor, t.a * vAlpha);
        }`,
    });

    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 4;
  }

  spawn(o) {
    const i = this.head;
    this.head = (this.head + 1) % this.count;
    const i3 = i * 3;
    this.pos[i3] = o.x; this.pos[i3 + 1] = o.y; this.pos[i3 + 2] = o.z;
    this.vel[i3] = o.vx || 0; this.vel[i3 + 1] = o.vy || 0; this.vel[i3 + 2] = o.vz || 0;
    this.col[i3] = o.r; this.col[i3 + 1] = o.g; this.col[i3 + 2] = o.b;
    this.life[i] = this.maxLife[i] = o.life;
    this.size[i] = o.size;
    this.grow[i] = o.grow ?? 0;
    this.drag[i] = o.drag ?? 1.6;
    this.gravity[i] = o.gravity ?? 0;
    this.alpha0[i] = o.alpha ?? 1;
    this.alpha[i] = o.alpha ?? 1;
  }

  update(dt) {
    const { pos, vel, life, maxLife, alpha, size, grow, drag, gravity, alpha0 } = this;
    for (let i = 0; i < this.count; i++) {
      if (life[i] <= 0) { alpha[i] = 0; continue; }
      life[i] -= dt;
      if (life[i] <= 0) { alpha[i] = 0; continue; }
      const i3 = i * 3;
      const d = Math.max(0, 1 - drag[i] * dt);
      vel[i3] *= d;
      vel[i3 + 1] = vel[i3 + 1] * d + gravity[i] * dt;
      vel[i3 + 2] *= d;
      pos[i3] += vel[i3] * dt;
      pos[i3 + 1] += vel[i3 + 1] * dt;
      pos[i3 + 2] += vel[i3 + 2] * dt;
      const t = life[i] / maxLife[i];
      alpha[i] = alpha0[i] * t * t;         // desaparece acelerando no fim
      size[i] += grow[i] * dt;
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.aAlpha.needsUpdate = true;
    this.geo.attributes.aSize.needsUpdate = true;
    this.geo.attributes.aColor.needsUpdate = true;
  }

  clear() {
    this.life.fill(0);
    this.alpha.fill(0);
    this.geo.attributes.aAlpha.needsUpdate = true;
  }
}

/**
 * Marcas de pneu: um ring buffer de quadriláteros pintados no asfalto. Ao
 * encher, as marcas mais antigas são sobrescritas — em três voltas isso
 * praticamente não acontece à vista do jogador.
 */
class SkidMarks {
  constructor(max = 1600) {
    this.max = max;
    this.head = 0;
    const pos = new Float32Array(max * 4 * 3);
    const col = new Float32Array(max * 4 * 4);
    const idx = new Uint16Array(max * 6);
    for (let q = 0; q < max; q++) {
      const v = q * 4;
      idx.set([v, v + 1, v + 2, v + 2, v + 1, v + 3], q * 6);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 4));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    this.geo = geo;
    this.pos = pos;
    this.col = col;

    this.mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
      vertexColors: true, transparent: true, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
    }));
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
  }

  /** Segmento de x0,z0 a x1,z1 com meia-largura `hw` na direção (nx,nz). */
  push(x0, z0, x1, z1, nx, nz, hw, alpha) {
    const q = this.head;
    this.head = (this.head + 1) % this.max;
    const o = q * 12;
    const y = 0.032;
    this.pos.set([
      x0 - nx * hw, y, z0 - nz * hw,
      x0 + nx * hw, y, z0 + nz * hw,
      x1 - nx * hw, y, z1 - nz * hw,
      x1 + nx * hw, y, z1 + nz * hw,
    ], o);
    const c = q * 16;
    for (let v = 0; v < 4; v++) this.col.set([0.05, 0.05, 0.06, alpha], c + v * 4);
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.color.needsUpdate = true;
  }

  clear() {
    this.col.fill(0);
    this.head = 0;
    this.geo.attributes.color.needsUpdate = true;
  }
}

export class Effects {
  constructor(scene, cars) {
    this.cars = cars;
    const tex = puffTexture();

    this.smoke = new ParticlePool(360, { texture: tex, sizeScale: 210 });
    this.sparks = new ParticlePool(180, { texture: tex, additive: true, sizeScale: 70 });
    this.skids = new SkidMarks(1000);

    scene.add(this.smoke.points, this.sparks.points, this.skids.mesh);

    this.lastWheel = new Map(); // última posição das rodas traseiras, por carro
  }

  reset() {
    this.smoke.clear();
    this.sparks.clear();
    this.skids.clear();
    this.lastWheel.clear();
  }

  /** Faíscas + fumaça no ponto de impacto (muro ou outro carro). */
  impact(x, y, z, intensity) {
    const n = Math.round(4 + 22 * intensity);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 4 + Math.random() * 16 * intensity;
      this.sparks.spawn({
        x, y: y + Math.random() * 0.4, z,
        vx: Math.cos(a) * sp, vy: 2 + Math.random() * 7, vz: Math.sin(a) * sp,
        r: 1.0, g: 0.72 + Math.random() * 0.25, b: 0.25,
        size: 0.5 + Math.random() * 0.7, life: 0.25 + Math.random() * 0.4,
        drag: 1.1, gravity: -22, alpha: 1,
      });
    }
    for (let i = 0; i < Math.round(3 + 8 * intensity); i++) {
      this.smoke.spawn({
        x, y: y + Math.random() * 0.6, z,
        vx: (Math.random() - 0.5) * 6, vy: 1 + Math.random() * 3, vz: (Math.random() - 0.5) * 6,
        r: 0.62, g: 0.6, b: 0.58,
        size: 0.9 + Math.random(), grow: 2.4, life: 0.7 + Math.random() * 0.6,
        drag: 1.8, alpha: 0.5 * intensity + 0.2,
      });
    }
  }

  /** Confete do pódio, solto acima do carro vencedor. */
  confetti(x, z) {
    for (let i = 0; i < 14; i++) {
      const a = Math.random() * Math.PI * 2;
      this.sparks.spawn({
        x: x + Math.cos(a) * 6 * Math.random(), y: 9 + Math.random() * 5, z: z + Math.sin(a) * 6 * Math.random(),
        vx: (Math.random() - 0.5) * 5, vy: 1 + Math.random() * 2, vz: (Math.random() - 0.5) * 5,
        r: 0.4 + Math.random() * 0.6, g: 0.4 + Math.random() * 0.6, b: 0.4 + Math.random() * 0.6,
        size: 0.7 + Math.random() * 0.6, life: 2.2 + Math.random() * 1.6,
        drag: 0.5, gravity: -3.4, alpha: 1,
      });
    }
  }

  /**
   * Emissão contínua: fumaça quando o pneu escorrega, poeira quando o carro
   * corre na grama, e a marca preta correspondente no chão.
   */
  update(dt, camera) {
    for (const car of this.cars) {
      // longe da câmera não vale gastar partículas do pool nem marcas no chão
      if (Math.hypot(car.x - camera.position.x, car.z - camera.position.z) > 150) {
        this.lastWheel.get(car)?.splice(4, 1, false);
        continue;
      }
      const v = Math.abs(car.speed);
      const dirX = car.dirX, dirZ = car.dirZ;
      const rx = dirZ, rz = -dirX;               // vetor "direita" do carro
      const slipping = car.handbrake ? 1 : Math.max(0, (car.slip ?? 0) - 0.22) * 1.6;
      const dusty = car.offTrack && v > 6;

      let prev = this.lastWheel.get(car);
      if (!prev) { prev = [0, 0, 0, 0, false]; this.lastWheel.set(car, prev); }

      for (let s = 0; s < 2; s++) {
        const side = s === 0 ? 0.92 : -0.92;
        const wx = car.x + dirX * -1.2 + rx * side;
        const wz = car.z + dirZ * -1.2 + rz * side;

        if ((slipping > 0.05 || dusty) && v > 4) {
          if (prev[4]) {
            const a = dusty ? 0.32 : Math.min(0.72, 0.3 + slipping * 0.5);
            this.skids.push(prev[s * 2], prev[s * 2 + 1], wx, wz, rx, rz, 0.2, a);
          }
          // fumaça branca no asfalto, poeira terrosa na grama
          const rate = dusty ? 26 : 16 * Math.min(1, slipping);
          if (Math.random() < rate * dt) {
            const tint = dusty ? [0.66, 0.58, 0.42] : [0.86, 0.86, 0.88];
            this.smoke.spawn({
              x: wx, y: 0.25, z: wz,
              vx: -dirX * v * 0.12 + (Math.random() - 0.5) * 2,
              vy: 0.8 + Math.random() * 1.6,
              vz: -dirZ * v * 0.12 + (Math.random() - 0.5) * 2,
              r: tint[0], g: tint[1], b: tint[2],
              size: 0.7 + Math.random() * 0.5, grow: 2.8,
              life: 0.65 + Math.random() * 0.55, drag: 1.5,
              alpha: dusty ? 0.5 : 0.42,
            });
          }
        }
        prev[s * 2] = wx;
        prev[s * 2 + 1] = wz;
      }
      prev[4] = (slipping > 0.05 || dusty) && v > 4;
    }

    this.smoke.update(dt);
    this.sparks.update(dt);
  }
}
