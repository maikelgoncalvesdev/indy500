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
    this.ctrl = { throttle: 0, brake: 0, steer: 0, handbrake: false };
    this.onRestart = null;
    this.onStart = null;
    this.onCamera = null;
    this.onMute = null;
    this.onFirstInput = null;
    this._used = false;

    addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.down.add(e.code);
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
      if (e.code === 'KeyR') this.onRestart?.();
      if (e.code === 'Enter' || e.code === 'NumpadEnter') this.onStart?.();
      if (e.code === 'KeyC') this.onCamera?.();
      if (e.code === 'KeyM') this.onMute?.();
      if (!this._used) { this._used = true; this.onFirstInput?.(); }
    });
    addEventListener('keyup', (e) => this.down.delete(e.code));
    addEventListener('blur', () => this.down.clear());
  }

  has(action) { return KEYS[action].some((k) => this.down.has(k)); }

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
