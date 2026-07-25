/**
 * Som sintetizado (sem arquivos): motor por osciladores + ruído para
 * derrapagem/fora de pista + estouro curto na batida.
 */
export class EngineAudio {
  constructor() {
    this.ctx = null;
    this.muted = false;
  }

  start() {
    if (this.ctx) { this.ctx.resume?.(); return; }
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    this.ctx = ctx;

    this.master = ctx.createGain();
    this.master.gain.value = 0.55;
    this.master.connect(ctx.destination);

    // motor
    this.engineGain = ctx.createGain();
    this.engineGain.gain.value = 0;
    this.filter = ctx.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.filter.frequency.value = 1400;
    this.engineGain.connect(this.filter).connect(this.master);

    this.osc = [];
    for (const [type, detune, gain] of [['sawtooth', 0, 0.5], ['square', -1200, 0.28], ['sawtooth', 7, 0.22]]) {
      const o = ctx.createOscillator();
      o.type = type;
      o.detune.value = detune;
      const g = ctx.createGain();
      g.gain.value = gain;
      o.connect(g).connect(this.engineGain);
      o.start();
      this.osc.push(o);
    }

    // ruído (grama / derrapagem)
    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    this.noiseBuf = buf;

    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    this.noiseGain = ctx.createGain();
    this.noiseGain.gain.value = 0;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1200;
    bp.Q.value = 0.7;
    src.connect(bp).connect(this.noiseGain).connect(this.master);
    src.start();
  }

  toggleMute() {
    this.muted = !this.muted;
    if (this.master) this.master.gain.value = this.muted ? 0 : 0.55;
    return this.muted;
  }

  update(speedRatio, offTrack, throttle) {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime;
    const f = 52 + 250 * Math.min(1, Math.abs(speedRatio));
    for (const o of this.osc) o.frequency.setTargetAtTime(f, t, 0.05);
    this.filter.frequency.setTargetAtTime(700 + 2600 * speedRatio, t, 0.08);
    this.engineGain.gain.setTargetAtTime(0.07 + (throttle ? 0.09 : 0.02) * speedRatio, t, 0.08);
    this.noiseGain.gain.setTargetAtTime(offTrack ? 0.10 * Math.min(1, speedRatio * 2) : 0, t, 0.05);
  }

  crash(intensity = 1) {
    if (!this.ctx || this.muted || intensity < 0.15) return;
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const g = ctx.createGain();
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 900;
    g.gain.setValueAtTime(0.5 * intensity, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);
    src.connect(f).connect(g).connect(this.master);
    src.start();
    src.stop(ctx.currentTime + 0.4);
  }

  beep(freq = 440, dur = 0.15) {
    if (!this.ctx || this.muted) return;
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'square';
    o.frequency.value = freq;
    g.gain.setValueAtTime(0.16, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
    o.connect(g).connect(this.master);
    o.start();
    o.stop(ctx.currentTime + dur + 0.02);
  }
}
