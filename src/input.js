const KEYS = {
  up: ['ArrowUp', 'KeyW'],
  down: ['ArrowDown', 'KeyS'],
  left: ['ArrowLeft', 'KeyA'],
  right: ['ArrowRight', 'KeyD'],
  handbrake: ['Space'],
};

export class Input {
  constructor() {
    this.down = new Set();
    this.touch = { up: false, down: false, left: false, right: false };
    this.ctrl = { throttle: 0, brake: 0, steer: 0, handbrake: false };
    this.onRestart = null;
    this.onStart = null;
    this.onCamera = null;
    this.onMute = null;
    this.onHud = null;
    this.onQuality = null;
    this.onFirstInput = null;
    this._used = false;

    addEventListener('keydown', (e) => {
      if (e.repeat) return;
      // com o foco num botão da tela de menu, Enter/Espaço são do próprio
      // botão — senão largar pelo teclado dispararia a corrida duas vezes
      const inUI = e.target?.closest?.('#screen');
      if (inUI && ['Enter', 'NumpadEnter', 'Space'].includes(e.code)) return;
      this.down.add(e.code);
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
      if (e.code === 'KeyR') this.onRestart?.();
      if (e.code === 'Enter' || e.code === 'NumpadEnter') this.onStart?.();
      if (e.code === 'KeyC') this.onCamera?.();
      if (e.code === 'KeyM') this.onMute?.();
      if (e.code === 'KeyH') this.onHud?.();
      if (e.code === 'KeyG') this.onQuality?.();
      if (!this._used) { this._used = true; this.onFirstInput?.(); }
    });
    addEventListener('keyup', (e) => this.down.delete(e.code));
    addEventListener('blur', () => { this.down.clear(); this.clearTouch(); });

    this.setupTouch();
  }

  clearTouch() {
    for (const k of Object.keys(this.touch)) this.touch[k] = false;
    document.querySelectorAll('.tbtn.on').forEach((b) => b.classList.remove('on'));
  }

  /**
   * Botões de toque: só aparecem em telas sem teclado. Cada botão é um
   * pointer independente, então dá para acelerar e virar ao mesmo tempo.
   */
  setupTouch() {
    const coarse = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
    const pad = document.getElementById('touch');
    if (!coarse || !pad) return;
    pad.classList.remove('hidden');
    document.body.classList.add('touch'); // o CSS sobe os painéis de baixo

    const bind = (id, action) => {
      const el = document.getElementById(id);
      if (!el) return;
      const on = (e) => {
        e.preventDefault();
        el.setPointerCapture?.(e.pointerId);
        this.touch[action] = true;
        el.classList.add('on');
        if (!this._used) { this._used = true; this.onFirstInput?.(); }
      };
      const off = (e) => {
        e.preventDefault();
        this.touch[action] = false;
        el.classList.remove('on');
      };
      el.addEventListener('pointerdown', on);
      el.addEventListener('pointerup', off);
      el.addEventListener('pointercancel', off);
      el.addEventListener('pointerleave', off);
      el.addEventListener('contextmenu', (e) => e.preventDefault());
    };
    bind('t-gas', 'up');
    bind('t-brake', 'down');
    bind('t-left', 'left');
    bind('t-right', 'right');
  }

  has(action) {
    return KEYS[action].some((k) => this.down.has(k)) || !!this.touch[action];
  }

  poll() {
    const c = this.ctrl;
    c.throttle = this.has('up') ? 1 : 0;
    c.brake = this.has('down') ? 1 : 0;
    // steer > 0 = direita (o ângulo do carro cresce nesse sentido)
    c.steer = (this.has('right') ? 1 : 0) - (this.has('left') ? 1 : 0);
    c.handbrake = this.has('handbrake');
    return c;
  }
}

export const NEUTRAL = { throttle: 0, brake: 0, steer: 0, handbrake: false };
