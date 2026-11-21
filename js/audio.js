// Audio: real CC0 samples, layered, with distance delay/lowpass, a reverb send and a synthetic sub-bass layer for big booms.
import { SFX } from './sfx.js';

const SPEED_OF_SOUND = 343;

export class Audio {
  constructor() {
    this.ctx = null;
    this.buffers = {};
    this.ready = false;
    this.listener = { x: 0, y: 0, z: 0, fx: 0, fz: -1 };
    this.muted = false;
    this.loops = {};
  }

  async init() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AC({ latencyHint: 'interactive' });
    const c = this.ctx;
    this.master = c.createGain();
    this.master.gain.value = 0.9;
    this.comp = c.createDynamicsCompressor();
    this.comp.threshold.value = -14;
    this.comp.knee.value = 10;
    this.comp.ratio.value = 5;
    this.comp.attack.value = 0.003;
    this.comp.release.value = 0.25;
    this.master.connect(this.comp).connect(c.destination);
    // reverb send (generated outdoor-ish impulse response)
    this.reverb = c.createConvolver();
    this.reverb.buffer = this._impulse(2.2, 2.8);
    this.revGain = c.createGain();
    this.revGain.gain.value = 0.35;
    this.reverb.connect(this.revGain).connect(this.master);
    // decode all samples
    const jobs = [];
    for (const [name, list] of Object.entries(SFX)) {
      this.buffers[name] = [];
      list.forEach((b64, i) => {
        const bin = atob(b64);
        const arr = new Uint8Array(bin.length);
        for (let k = 0; k < bin.length; k++) arr[k] = bin.charCodeAt(k);
        jobs.push(c.decodeAudioData(arr.buffer).then(buf => { this.buffers[name][i] = buf; }).catch(() => {}));
      });
    }
    await Promise.all(jobs);
    for (const k of Object.keys(this.buffers)) this.buffers[k] = this.buffers[k].filter(Boolean);
    this.ready = true;
  }

  resume() { if (this.ctx && this.ctx.state !== 'running') this.ctx.resume(); }

  _impulse(seconds, decay) {
    const c = this.ctx, len = Math.floor(c.sampleRate * seconds);
    const buf = c.createBuffer(2, len, c.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) {
        const t = i / len;
        // early reflections cluster + diffuse tail
        const early = i < c.sampleRate * 0.08 && Math.random() < 0.004 ? (Math.random() * 2 - 1) * 0.8 : 0;
        d[i] = ((Math.random() * 2 - 1) * Math.pow(1 - t, decay)) * 0.5 + early;
      }
    }
    return buf;
  }

  setListener(pos, dir) {
    this.listener.x = pos.x; this.listener.y = pos.y; this.listener.z = pos.z;
    const l = Math.hypot(dir.x, dir.z) || 1;
    this.listener.fx = dir.x / l; this.listener.fz = dir.z / l;
  }

  // name: sample set; opts: {pos, vol, rate, rateJitter, reverb, delay, lowpass, idx}
  play(name, opts = {}) {
    if (!this.ready || this.muted) return null;
    const set = this.buffers[name];
    if (!set || !set.length) return null;
    const c = this.ctx;
    const buf = set[opts.idx != null ? opts.idx % set.length : (Math.random() * set.length) | 0];
    const src = c.createBufferSource();
    src.buffer = buf;
    const jit = opts.rateJitter != null ? opts.rateJitter : 0.08;
    src.playbackRate.value = (opts.rate || 1) * (1 + (Math.random() * 2 - 1) * jit);
    let vol = opts.vol != null ? opts.vol : 1;
    let delay = opts.delay || 0;
    let pan = 0, lp = opts.lowpass || 20000;
    if (opts.pos) {
      const dx = opts.pos.x - this.listener.x, dy = opts.pos.y - this.listener.y, dz = opts.pos.z - this.listener.z;
      const d = Math.hypot(dx, dy, dz);
      const ref = opts.ref || 6;
      vol *= Math.min(1, ref / Math.max(ref, d)) ** 0.85;
      if (opts.speedOfSound !== false) delay += d / SPEED_OF_SOUND;
      lp = Math.min(lp, 22000 / (1 + d * 0.035));
      // stereo pan from listener right vector
      const rx = -this.listener.fz, rz = this.listener.fx;
      pan = Math.max(-0.85, Math.min(0.85, (dx * rx + dz * rz) / Math.max(1, d)));
    }
    if (vol < 0.003) return null;
    const g = c.createGain();
    g.gain.value = vol;
    let node = src;
    if (lp < 19000) {
      const f = c.createBiquadFilter();
      f.type = 'lowpass'; f.frequency.value = Math.max(300, lp); f.Q.value = 0.5;
      node.connect(f); node = f;
    }
    const p = c.createStereoPanner ? c.createStereoPanner() : null;
    if (p) { p.pan.value = pan; node.connect(p); node = p; }
    node.connect(g);
    g.connect(this.master);
    const rv = opts.reverb != null ? opts.reverb : 0.25;
    if (rv > 0) {
      const rg = c.createGain(); rg.gain.value = rv * vol;
      g.connect(rg).connect(this.reverb);
    }
    const t = c.currentTime + delay;
    src.start(t);
    if (opts.duration) {
      g.gain.setValueAtTime(vol, t + opts.duration * 0.7);
      g.gain.linearRampToValueAtTime(0, t + opts.duration);
      src.stop(t + opts.duration + 0.05);
    }
    return { src, gain: g };
  }

  // synthetic sub-bass thump that makes the phone speaker "push" (layer under sampled booms)
  thump(power = 1, opts = {}) {
    if (!this.ready || this.muted) return;
    const c = this.ctx;
    let delay = opts.delay || 0, vol = Math.min(1, 0.45 * power);
    if (opts.pos) {
      const d = Math.hypot(opts.pos.x - this.listener.x, opts.pos.y - this.listener.y, opts.pos.z - this.listener.z);
      delay += d / SPEED_OF_SOUND;
      vol *= Math.min(1, 14 / Math.max(14, d)) ** 0.6;
    }
    const t = c.currentTime + delay;
    const o = c.createOscillator();
    o.type = 'sine';
    const f0 = 95 - Math.min(40, power * 10);
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(28, t + 0.35 + power * 0.25);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.6 + power * 0.5);
    // gentle saturation so small speakers reproduce some of it as harmonics
    const ws = c.createWaveShaper();
    const curve = new Float32Array(256);
    for (let i = 0; i < 256; i++) { const x = i / 128 - 1; curve[i] = Math.tanh(x * 2.5); }
    ws.curve = curve;
    o.connect(ws).connect(g).connect(this.master);
    o.start(t); o.stop(t + 1.4 + power * 0.5);
  }

  // filtered-noise hiss (fuse, rocket thrust). returns handle with stop()
  hiss(opts = {}) {
    if (!this.ready || this.muted) return { stop() {}, set() {} };
    const c = this.ctx;
    const len = c.sampleRate * 2;
    const buf = c.createBuffer(1, len, c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (Math.random() < 0.002 ? 3 : 1);
    const src = c.createBufferSource();
    src.buffer = buf; src.loop = true;
    const f = c.createBiquadFilter();
    f.type = 'bandpass'; f.frequency.value = opts.freq || 4500; f.Q.value = opts.q || 1.2;
    const g = c.createGain();
    g.gain.value = 0;
    g.gain.linearRampToValueAtTime(opts.vol || 0.25, c.currentTime + 0.05);
    src.connect(f).connect(g).connect(this.master);
    src.start();
    return {
      set(freq, vol) {
        if (freq) f.frequency.setTargetAtTime(freq, c.currentTime, 0.05);
        if (vol != null) g.gain.setTargetAtTime(vol, c.currentTime, 0.05);
      },
      stop(fade = 0.08) {
        g.gain.setTargetAtTime(0, c.currentTime, fade / 3);
        src.stop(c.currentTime + fade + 0.1);
      },
    };
  }

  beep(freq = 1800, dur = 0.06, vol = 0.18) {
    if (!this.ready || this.muted) return;
    const c = this.ctx, t = c.currentTime;
    const o = c.createOscillator(); o.type = 'square'; o.frequency.value = freq;
    const g = c.createGain();
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master); o.start(t); o.stop(t + dur + 0.02);
  }

  loop(name, vol) {
    if (!this.ready) return;
    if (this.loops[name]) { this.loops[name].gain.gain.setTargetAtTime(vol, this.ctx.currentTime, 0.3); return; }
    const set = this.buffers[name];
    if (!set || !set.length) return;
    const src = this.ctx.createBufferSource();
    src.buffer = set[0]; src.loop = true;
    const g = this.ctx.createGain(); g.gain.value = vol;
    src.connect(g).connect(this.master); src.start();
    this.loops[name] = { src, gain: g };
  }

  // positional burning loop; returns handle to update/stop
  positionalLoop(name, pos, vol) {
    if (!this.ready || this.muted) return null;
    const set = this.buffers[name];
    if (!set || !set.length) return null;
    const c = this.ctx;
    const src = c.createBufferSource();
    src.buffer = set[0]; src.loop = true;
    src.loopStart = 0; src.loopEnd = set[0].duration;
    const g = c.createGain(); g.gain.value = 0;
    src.connect(g).connect(this.master);
    src.start(0, Math.random() * set[0].duration * 0.8);
    const self = this;
    return {
      update(p, v) {
        const d = Math.hypot(p.x - self.listener.x, p.y - self.listener.y, p.z - self.listener.z);
        g.gain.setTargetAtTime(v * Math.min(1, 5 / Math.max(5, d)), c.currentTime, 0.2);
      },
      stop() { g.gain.setTargetAtTime(0, c.currentTime, 0.3); src.stop(c.currentTime + 1.2); },
    };
  }
}

// Vibration (Android). Patterns in ms.
export const Haptics = {
  enabled: true,
  last: 0,
  pulse(pattern) {
    if (!this.enabled || !navigator.vibrate) return;
    try { navigator.vibrate(pattern); } catch (e) {}
  },
  // strength 0..1+ ; scaled single/double pulses
  impact(strength) {
    const now = performance.now();
    if (now - this.last < 40 && strength < 0.6) return;
    this.last = now;
    const s = Math.min(1.6, strength);
    if (s < 0.15) this.pulse(8);
    else if (s < 0.4) this.pulse(18);
    else if (s < 0.8) this.pulse([40, 30, 25]);
    else if (s < 1.2) this.pulse([90, 40, 60, 40, 30]);
    else this.pulse([160, 50, 120, 50, 90, 60, 50]);
  },
};
