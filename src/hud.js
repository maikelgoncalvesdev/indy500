import { TRACK, sample } from './track.js';

export function formatTime(t) {
  if (t == null || !isFinite(t)) return '--:--.--';
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  const c = Math.floor((t * 100) % 100);
  return `${m}:${String(s).padStart(2, '0')}.${String(c).padStart(2, '0')}`;
}

export class HUD {
  constructor() {
    this.el = {
      lap: document.getElementById('lap'),
      pos: document.getElementById('pos'),
      time: document.getElementById('time'),
      best: document.getElementById('best'),
      gap: document.getElementById('gap'),
      speed: document.getElementById('speed-value'),
      bar: document.querySelector('#gear-bar i'),
      center: document.getElementById('center'),
      centerBig: document.getElementById('center-big'),
      centerSub: document.getElementById('center-sub'),
      screen: document.getElementById('screen'),
      screenTitle: document.getElementById('screen-title'),
      screenSub: document.getElementById('screen-sub'),
      podium: document.getElementById('podium'),
      standings: document.getElementById('standings'),
      startBtn: document.getElementById('start-btn'),
    };

    this.canvas = document.getElementById('minimap');
    this.ctx = this.canvas.getContext('2d');
    this.trackPath = null;
    this.buildMinimapPath();
  }

  buildMinimapPath() {
    const w = this.canvas.width, h = this.canvas.height;
    const spanX = TRACK.halfExtentX + TRACK.wallLat;
    const spanZ = TRACK.halfExtentZ + TRACK.wallLat;
    this.scale = Math.min((w - 10) / (spanX * 2), (h - 10) / (spanZ * 2));
    this.cx = w / 2; this.cy = h / 2;

    const p = new Path2D();
    const s = {};
    for (let i = 0; i <= 120; i++) {
      sample(i / 120, 0, s);
      const x = this.cx + s.x * this.scale;
      const y = this.cy + s.z * this.scale;
      if (i === 0) p.moveTo(x, y); else p.lineTo(x, y);
    }
    p.closePath();
    this.trackPath = p;
  }

  drawMinimap(cars) {
    const g = this.ctx;
    const w = this.canvas.width, h = this.canvas.height;
    g.clearRect(0, 0, w, h);

    g.lineJoin = g.lineCap = 'round';
    g.strokeStyle = 'rgba(255,255,255,0.18)';
    g.lineWidth = TRACK.width * this.scale + 3;
    g.stroke(this.trackPath);
    g.strokeStyle = 'rgba(180,205,235,0.55)';
    g.lineWidth = TRACK.width * this.scale;
    g.stroke(this.trackPath);

    // linha de chegada
    const s = sample(0, 0, {});
    g.strokeStyle = '#ffffff';
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(this.cx + s.x * this.scale - 5, this.cy + s.z * this.scale);
    g.lineTo(this.cx + s.x * this.scale + 5, this.cy + s.z * this.scale);
    g.stroke();

    for (const c of cars) {
      g.fillStyle = '#' + c.color.toString(16).padStart(6, '0');
      g.strokeStyle = c.isPlayer ? '#fff' : 'rgba(0,0,0,0.6)';
      g.lineWidth = 1.5;
      g.beginPath();
      g.arc(this.cx + c.x * this.scale, this.cy + c.z * this.scale, c.isPlayer ? 4 : 3.2, 0, Math.PI * 2);
      g.fill();
      g.stroke();
    }
  }

  update(st) {
    this.el.lap.textContent = `${st.lap}/${st.laps}`;
    this.el.pos.textContent = `${st.pos}/${st.total}`;
    this.el.time.textContent = formatTime(st.time);
    this.el.best.textContent = formatTime(st.best);
    this.el.gap.textContent = st.gap;
    this.el.speed.textContent = Math.round(st.speedKmh);
    this.el.bar.style.width = `${Math.max(0, Math.min(1, st.speedRatio)) * 100}%`;
    this.drawMinimap(st.cars);
  }

  showCenter(big, sub = '') {
    this.el.center.classList.remove('hidden');
    this.el.centerBig.textContent = big;
    this.el.centerSub.textContent = sub;
  }

  hideCenter() { this.el.center.classList.add('hidden'); }

  /**
   * Menu inicial e pódio são a mesma tela: sem `rows` mostra só o menu,
   * com `rows` mostra pódio + classificação.
   */
  showScreen({ title, subtitle, rows = null, cta = 'CORRER' }) {
    const e = this.el;
    e.screen.classList.remove('hidden');
    e.screenTitle.textContent = title;
    e.screenSub.textContent = subtitle;
    e.startBtn.textContent = cta;
    document.body.classList.add('no-hud');

    if (!rows) {
      e.podium.classList.add('hidden');
      e.standings.classList.add('hidden');
      return;
    }

    // pódio: 2º à esquerda, 1º ao centro, 3º à direita
    const top = rows.slice(0, 3);
    const layout = [top[1], top[0], top[2]];
    e.podium.classList.remove('hidden');
    e.podium.innerHTML = layout.map((r, i) => {
      if (!r) return '<div class="step"></div>';
      const place = i === 1 ? 1 : (i === 0 ? 2 : 3);
      return `<div class="step step-${place} ${r.me ? 'me' : ''}">
          <div class="car" style="background:${r.color}"></div>
          <div class="who">${r.name}</div>
          <div class="t">${r.time}</div>
          <div class="block">${place}º</div>
        </div>`;
    }).join('');

    e.standings.classList.remove('hidden');
    e.standings.innerHTML = rows.map((r) => `
      <tr class="${r.me ? 'me' : ''}">
        <td><span class="dot" style="background:${r.color}"></span></td>
        <td>${r.pos}º</td><td>${r.name}</td><td>${r.time}</td><td>${r.note ?? ''}</td>
      </tr>`).join('');
  }

  hideScreen() {
    this.el.screen.classList.add('hidden');
    document.body.classList.remove('no-hud');
  }

  onStart(fn) { this.el.startBtn.addEventListener('click', fn); }
}
