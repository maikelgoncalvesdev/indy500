import { TRACK, sample } from './track.js';

export function formatTime(t) {
  if (t == null || !isFinite(t)) return '--:--.--';
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  const c = Math.floor((t * 100) % 100);
  return `${m}:${String(s).padStart(2, '0')}.${String(c).padStart(2, '0')}`;
}

const hex = (c) => '#' + c.toString(16).padStart(6, '0');

export class HUD {
  constructor() {
    this.el = {
      lap: document.getElementById('lap'),
      pos: document.getElementById('pos'),
      time: document.getElementById('time'),
      last: document.getElementById('last'),
      best: document.getElementById('best'),
      gap: document.getElementById('gap'),
      speed: document.getElementById('speed-value'),
      center: document.getElementById('center'),
      centerBig: document.getElementById('center-big'),
      centerSub: document.getElementById('center-sub'),
      screen: document.getElementById('screen'),
      screenTitle: document.getElementById('screen-title'),
      screenSub: document.getElementById('screen-sub'),
      pick: document.getElementById('pick'),
      pickGrid: document.getElementById('pick-grid'),
      lapsOpts: document.getElementById('laps-opts'),
      podium: document.getElementById('podium'),
      standings: document.getElementById('standings'),
      startBtn: document.getElementById('start-btn'),
      backBtn: document.getElementById('back-btn'),
      controlsBox: document.getElementById('controls-box'),
      toasts: document.getElementById('toasts'),
      vignette: document.getElementById('vignette'),
      warnL: document.getElementById('warn-l'),
      warnR: document.getElementById('warn-r'),
    };

    this.canvas = document.getElementById('minimap');
    this.ctx = this.canvas.getContext('2d');
    this.tacho = document.getElementById('tacho');
    this.tctx = this.tacho.getContext('2d');

    this.portraits = new Map();
    this.trackPath = null;
    this.centerText = null;
    this.buildMinimapPath();
  }

  setPortraits(map) { this.portraits = map || new Map(); }

  /* ---------------- minimapa ---------------- */

  buildMinimapPath() {
    const w = this.canvas.width, h = this.canvas.height;
    const spanX = TRACK.halfExtentX + TRACK.wallLat;
    const spanZ = TRACK.halfExtentZ + TRACK.wallLat;
    this.scale = Math.min((w - 16) / (spanX * 2), (h - 16) / (spanZ * 2));
    this.cx = w / 2; this.cy = h / 2;

    const p = new Path2D();
    const s = {};
    for (let i = 0; i <= 160; i++) {
      sample(i / 160, 0, s);
      const x = this.cx + s.x * this.scale;
      const y = this.cy + s.z * this.scale;
      if (i === 0) p.moveTo(x, y); else p.lineTo(x, y);
    }
    p.closePath();
    this.trackPath = p;
  }

  drawMinimap(cars, player, leader) {
    const g = this.ctx;
    const w = this.canvas.width, h = this.canvas.height;
    g.clearRect(0, 0, w, h);

    g.lineJoin = g.lineCap = 'round';
    g.strokeStyle = 'rgba(255,255,255,0.16)';
    g.lineWidth = TRACK.width * this.scale + 4;
    g.stroke(this.trackPath);
    g.strokeStyle = 'rgba(150,168,190,0.5)';
    g.lineWidth = TRACK.width * this.scale;
    g.stroke(this.trackPath);
    g.strokeStyle = 'rgba(255,255,255,0.28)';
    g.lineWidth = 1;
    g.stroke(this.trackPath);

    // linha de chegada
    const s = sample(0, 0, {});
    g.strokeStyle = '#ffffff';
    g.lineWidth = 2.5;
    g.beginPath();
    g.moveTo(this.cx + s.x * this.scale - 5, this.cy + s.z * this.scale);
    g.lineTo(this.cx + s.x * this.scale + 5, this.cy + s.z * this.scale);
    g.stroke();

    // rivais primeiro, para o jogador ficar sempre por cima
    for (const c of cars) {
      if (c === player) continue;
      const x = this.cx + c.x * this.scale;
      const y = this.cy + c.z * this.scale;
      if (c === leader) {
        g.strokeStyle = 'rgba(245,197,24,0.95)';
        g.lineWidth = 1.6;
        g.beginPath();
        g.arc(x, y, 5.4, 0, Math.PI * 2);
        g.stroke();
      }
      g.fillStyle = hex(c.color);
      g.strokeStyle = 'rgba(0,0,0,0.65)';
      g.lineWidth = 1.2;
      g.beginPath();
      g.arc(x, y, 3.1, 0, Math.PI * 2);
      g.fill();
      g.stroke();
    }

    // jogador: seta apontando para onde ele está indo
    const px = this.cx + player.x * this.scale;
    const py = this.cy + player.z * this.scale;
    g.save();
    g.translate(px, py);
    g.rotate(player.heading);
    g.beginPath();
    g.moveTo(7.5, 0);
    g.lineTo(-4.5, 4.6);
    g.lineTo(-2.4, 0);
    g.lineTo(-4.5, -4.6);
    g.closePath();
    g.fillStyle = '#ffffff';
    g.strokeStyle = 'rgba(0,0,0,0.8)';
    g.lineWidth = 1.4;
    g.fill();
    g.stroke();
    g.restore();
  }

  /* ---------------- tacômetro ---------------- */

  drawTacho(ratio, redline) {
    const g = this.tctx;
    const w = this.tacho.width, h = this.tacho.height;
    g.clearRect(0, 0, w, h);

    const cx = w / 2, cy = h - 24, r = Math.min(w / 2 - 14, h - 34);
    const A0 = Math.PI * 1.02, A1 = Math.PI * 1.98;
    const ang = (t) => A0 + (A1 - A0) * t;

    // trilho
    g.lineCap = 'round';
    g.strokeStyle = 'rgba(255,255,255,0.13)';
    g.lineWidth = 11;
    g.beginPath();
    g.arc(cx, cy, r, A0, A1);
    g.stroke();

    // faixa vermelha
    g.strokeStyle = 'rgba(255,70,60,0.35)';
    g.beginPath();
    g.arc(cx, cy, r, ang(0.88), A1);
    g.stroke();

    // preenchimento
    if (ratio > 0.002) {
      const grad = g.createLinearGradient(cx - r, 0, cx + r, 0);
      grad.addColorStop(0, '#3ddc84');
      grad.addColorStop(0.55, '#f5d020');
      grad.addColorStop(1, '#ff3b30');
      g.strokeStyle = grad;
      g.lineWidth = 11;
      g.beginPath();
      g.arc(cx, cy, r, A0, ang(Math.min(1, ratio)));
      g.stroke();
    }

    // marcas a cada 20%
    g.strokeStyle = 'rgba(255,255,255,0.4)';
    g.lineWidth = 2;
    for (let i = 0; i <= 5; i++) {
      const a = ang(i / 5);
      const c = Math.cos(a), s = Math.sin(a);
      g.beginPath();
      g.moveTo(cx + c * (r - 9), cy + s * (r - 9));
      g.lineTo(cx + c * (r + 8), cy + s * (r + 8));
      g.stroke();
    }

    // shift light: acende quando o carro está no limite
    const lit = ratio > 0.9;
    for (let i = 0; i < 3; i++) {
      const a = ang(0.5 + (i - 1) * 0.085);
      const x = cx + Math.cos(a) * (r - 30);
      const y = cy + Math.sin(a) * (r - 30);
      g.beginPath();
      g.arc(x, y, 4, 0, Math.PI * 2);
      g.fillStyle = lit && (redline || i < 2)
        ? (redline ? '#ff4a3d' : '#ffd23d')
        : 'rgba(255,255,255,0.12)';
      g.fill();
    }
  }

  /* ---------------- estado por frame ---------------- */

  update(st) {
    const e = this.el;
    e.lap.textContent = `${st.lap}/${st.laps}`;
    e.pos.textContent = `${st.pos}/${st.total}`;
    e.time.textContent = formatTime(st.time);
    e.last.textContent = formatTime(st.last);
    e.best.textContent = formatTime(st.best);
    e.gap.textContent = st.gap;
    e.speed.textContent = Math.round(st.speedKmh);

    // gap: verde quando você encosta, vermelho quando abre
    e.gap.classList.toggle('good', st.gapClosing === true);
    e.gap.classList.toggle('bad', st.gapClosing === false);
    // última volta: roxo quando é a melhor da prova, verde quando é sua melhor
    e.last.classList.toggle('purple', !!st.lastIsOverallBest);
    e.last.classList.toggle('good', !st.lastIsOverallBest && !!st.lastIsPersonalBest);

    this.drawTacho(Math.max(0, Math.min(1, st.speedRatio)), st.speedRatio > 0.96);
    this.drawMinimap(st.cars, st.player, st.leader);

    // vinheta e avisos laterais
    const v = Math.max(0, (st.speedRatio - 0.42) / 0.58);
    e.vignette.style.opacity = (v * v * 0.85).toFixed(3);
    e.warnL.style.opacity = (st.nearLeft ?? 0).toFixed(2);
    e.warnR.style.opacity = (st.nearRight ?? 0).toFixed(2);
  }

  clearEffects() {
    this.el.vignette.style.opacity = 0;
    this.el.warnL.style.opacity = 0;
    this.el.warnR.style.opacity = 0;
  }

  /* ---------------- mensagens ---------------- */

  showCenter(big, sub = '') {
    const e = this.el;
    e.center.classList.remove('hidden');
    if (big !== this.centerText) {
      e.center.classList.remove('pop');
      void e.center.offsetWidth; // reinicia a animação
      e.center.classList.add('pop');
      this.centerText = big;
    }
    e.centerBig.textContent = big;
    e.centerSub.textContent = sub;
  }

  hideCenter() {
    this.el.center.classList.add('hidden');
    this.centerText = null;
  }

  /** Aviso efêmero no topo: ultrapassagem, melhor volta, última volta… */
  toast(text, kind = '', ms = 1900) {
    const d = document.createElement('div');
    d.className = `toast ${kind}`.trim();
    d.textContent = text;
    this.el.toasts.appendChild(d);
    setTimeout(() => {
      d.classList.add('out');
      setTimeout(() => d.remove(), 320);
    }, ms);
    // no máximo quatro na tela
    while (this.el.toasts.children.length > 4) this.el.toasts.firstChild.remove();
  }

  clearToasts() { this.el.toasts.replaceChildren(); }

  /* ---------------- telas ---------------- */

  /** Grade de pilotos: retrato + nome, com o escolhido destacado. */
  buildPicker(animals, selectedName, onPick) {
    const grid = this.el.pickGrid;
    grid.replaceChildren();
    for (const a of animals) {
      const card = document.createElement('div');
      card.className = 'pick-card' + (a.name === selectedName ? ' sel' : '');
      card.tabIndex = 0;
      card.setAttribute('role', 'button');
      card.setAttribute('aria-label', `pilotar como ${a.name}`);

      const src = this.portraits.get(a.name);
      if (src) {
        const img = document.createElement('img');
        img.src = src;
        img.alt = a.name;
        card.appendChild(img);
      } else {
        const sw = document.createElement('div');
        sw.className = 'swatch';
        sw.style.background = hex(a.color);
        card.appendChild(sw);
      }

      const nm = document.createElement('div');
      nm.className = 'nm';
      nm.textContent = a.name;
      card.appendChild(nm);

      const choose = () => {
        for (const c of grid.children) c.classList.remove('sel');
        card.classList.add('sel');
        onPick(a);
      };
      card.addEventListener('click', choose);
      card.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); ev.stopPropagation(); choose(); }
      });
      grid.appendChild(card);
    }
  }

  /** Botões de tamanho da corrida (número de voltas). */
  buildLapsPicker(options, selected, onPick) {
    const box = this.el.lapsOpts;
    box.replaceChildren();
    for (const n of options) {
      const b = document.createElement('button');
      b.className = 'laps-btn' + (n === selected ? ' sel' : '');
      b.innerHTML = `<span class="n">${n}</span><span class="t">VOLTAS</span>`;
      b.setAttribute('aria-label', `corrida de ${n} voltas`);
      b.addEventListener('click', () => {
        for (const c of box.children) c.classList.remove('sel');
        b.classList.add('sel');
        onPick(n);
      });
      box.appendChild(b);
    }
  }

  /** Troca só o subtítulo, sem remontar a tela. */
  setSubtitle(text) { this.el.screenSub.textContent = text; }

  /**
   * Menu inicial e pódio são a mesma tela: sem `rows` mostra o menu com a
   * seleção de piloto, com `rows` mostra pódio + classificação.
   */
  showScreen({ title, subtitle, rows = null, cta = 'CORRER' }) {
    const e = this.el;
    e.screen.classList.remove('hidden');
    e.screenTitle.textContent = title;
    e.screenSub.textContent = subtitle;
    e.startBtn.textContent = cta;
    document.body.classList.add('no-hud');
    this.clearToasts();
    this.clearEffects();

    if (!rows) {
      e.pick.classList.remove('hidden');
      e.controlsBox.classList.remove('hidden');
      e.backBtn.classList.add('hidden');
      e.podium.classList.add('hidden');
      e.standings.classList.add('hidden');
      return;
    }

    e.pick.classList.add('hidden');
    e.controlsBox.classList.add('hidden'); // no fim da prova o jogador já sabe jogar
    e.backBtn.classList.remove('hidden');  // e pode voltar para trocar de piloto

    // pódio: 2º à esquerda, 1º ao centro, 3º à direita
    const top = rows.slice(0, 3);
    const layout = [top[1], top[0], top[2]];
    e.podium.classList.remove('hidden');
    e.podium.innerHTML = layout.map((r, i) => {
      if (!r) return '<div class="step"></div>';
      const place = i === 1 ? 1 : (i === 0 ? 2 : 3);
      const src = this.portraits.get(r.name);
      const face = src
        ? `<img class="face" src="${src}" alt="${r.name}">`
        : `<div class="face" style="background:${r.color}"></div>`;
      return `<div class="step step-${place} ${r.me ? 'me' : ''}">
          ${face}
          <div class="car" style="background:${r.color}"></div>
          <div class="who">${r.name}</div>
          <div class="t">${r.time}</div>
          <div class="block">${place}º</div>
        </div>`;
    }).join('');

    e.standings.classList.remove('hidden');
    e.standings.innerHTML = rows.map((r) => {
      const src = this.portraits.get(r.name);
      const face = src
        ? `<img class="face-sm" src="${src}" alt="">`
        : `<span class="dot" style="background:${r.color}"></span>`;
      return `<tr class="${r.me ? 'me' : ''}">
        <td>${face}</td>
        <td><span class="dot" style="background:${r.color}"></span></td>
        <td>${r.pos}º</td><td>${r.name}</td><td>${r.time}</td><td>${r.note ?? ''}</td>
      </tr>`;
    }).join('');
  }

  hideScreen() {
    this.el.screen.classList.add('hidden');
    document.body.classList.remove('no-hud');
  }

  onStart(fn) { this.el.startBtn.addEventListener('click', fn); }
  onBack(fn) { this.el.backBtn.addEventListener('click', fn); }
}
