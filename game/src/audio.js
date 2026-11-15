// audio.js — one job: every sound is synthesized with WebAudio. No audio
// files, no network. Created on the first user gesture (browsers require it).
export class AudioSys {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.noiseBuf = null;
    this.enabled = true;
  }

  ensure() {
    if (this.ctx) {
      if (this.ctx.state === "suspended") this.ctx.resume();
      return true;
    }
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.4;
      this.master.connect(this.ctx.destination);
      const len = this.ctx.sampleRate * 0.5;
      this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const data = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
      return true;
    } catch {
      this.ctx = null;
      return false;
    }
  }

  // Distance-attenuated gain for sounds that are not the player's own.
  vol(dist) {
    if (dist === undefined) return 1;
    return Math.max(0.05, 1 - dist / 55);
  }

  noise(dur, filterFreq, gainVal, when = 0) {
    if (!this.ctx || !this.enabled) return;
    const t = this.ctx.currentTime + when;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const filter = this.ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = filterFreq;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gainVal, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(filter).connect(g).connect(this.master);
    src.start(t);
    src.stop(t + dur + 0.02);
  }

  tone(freq, dur, type, gainVal, slideTo, when = 0) {
    if (!this.ctx || !this.enabled) return;
    const t = this.ctx.currentTime + when;
    const osc = this.ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gainVal, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(g).connect(this.master);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  shot(weaponId, dist) {
    const v = this.vol(dist);
    if (weaponId === "sniper") {
      this.noise(0.28, 900, 0.9 * v);
      this.tone(140, 0.18, "sawtooth", 0.35 * v, 50);
    } else if (weaponId === "smg") {
      this.noise(0.09, 2400, 0.5 * v);
      this.tone(220, 0.06, "square", 0.12 * v, 90);
    } else if (weaponId === "rifle") {
      this.noise(0.14, 1600, 0.7 * v);
      this.tone(180, 0.1, "sawtooth", 0.22 * v, 70);
    } else {
      this.noise(0.11, 2000, 0.6 * v);
      this.tone(200, 0.08, "square", 0.15 * v, 80);
    }
  }

  dryFire() {
    this.tone(1200, 0.04, "square", 0.12);
  }

  reload() {
    this.tone(900, 0.05, "square", 0.1);
    this.tone(600, 0.05, "square", 0.1, undefined, 0.25);
    this.tone(1100, 0.05, "square", 0.12, undefined, 0.55);
  }

  step(crouch) {
    this.noise(0.06, 500, crouch ? 0.05 : 0.12);
  }

  hit() {
    this.tone(1500, 0.05, "sine", 0.2, 900);
  }

  kill() {
    this.tone(700, 0.09, "sine", 0.25, 1400);
  }

  hurt() {
    this.noise(0.15, 700, 0.35);
    this.tone(110, 0.15, "sawtooth", 0.18, 60);
  }

  plantBeep() {
    this.tone(1250, 0.09, "sine", 0.22);
  }

  explosion(dist) {
    const v = this.vol(dist);
    this.noise(0.9, 300, 1.0 * v);
    this.tone(70, 0.7, "sine", 0.5 * v, 30);
  }

  throwWhoosh() {
    this.noise(0.25, 1200, 0.25);
  }

  buy() {
    this.tone(880, 0.06, "sine", 0.18);
    this.tone(1320, 0.08, "sine", 0.18, undefined, 0.07);
  }

  deny() {
    this.tone(220, 0.12, "square", 0.15, 160);
  }

  roundWin() {
    this.tone(523, 0.14, "sine", 0.22);
    this.tone(659, 0.14, "sine", 0.22, undefined, 0.14);
    this.tone(784, 0.22, "sine", 0.25, undefined, 0.28);
  }

  roundLose() {
    this.tone(392, 0.16, "sine", 0.2);
    this.tone(311, 0.2, "sine", 0.2, undefined, 0.16);
    this.tone(233, 0.3, "sine", 0.22, undefined, 0.36);
  }
}
