// Procedural sound: every music bed and effect is synthesized with WebAudio,
// so the engine ships with no audio files.

type Track = { stop(fade: number): void };

const NOTE = (n: string) => {
  const m = /^([A-G])(#|b)?(\d)$/.exec(n)!;
  const base = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[m[1] as "C"]!;
  const semis = base + (m[2] === "#" ? 1 : m[2] === "b" ? -1 : 0) + (Number(m[3]) + 1) * 12;
  return 440 * Math.pow(2, (semis - 69) / 12);
};

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private musicBus!: GainNode;
  private sfxBus!: GainNode;
  private reverb!: ConvolverNode;
  private reverbSend!: GainNode;
  private noiseBuf!: AudioBuffer;
  private track: Track | null = null;
  private trackName = "none";
  private heart: number | null = null;
  enabled = true;

  // Must run inside a user gesture the first time.
  unlock(): void {
    if (!this.enabled) return;
    if (!this.ctx) this.init();
    void this.ctx!.resume();
  }

  private init(): void {
    const ctx = (this.ctx = new AudioContext());
    this.master = ctx.createGain();
    this.master.gain.value = 0.8;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    this.master.connect(comp).connect(ctx.destination);
    this.musicBus = ctx.createGain();
    this.musicBus.gain.value = 0.55;
    this.sfxBus = ctx.createGain();
    this.sfxBus.gain.value = 0.9;
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this.impulse(3.2, 2.4);
    this.reverbSend = ctx.createGain();
    this.reverbSend.gain.value = 0.45;
    this.musicBus.connect(this.master);
    this.sfxBus.connect(this.master);
    this.musicBus.connect(this.reverbSend);
    this.sfxBus.connect(this.reverbSend);
    this.reverbSend.connect(this.reverb).connect(this.master);
    this.noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    if (this.trackName !== "none") {
      const name = this.trackName;
      this.trackName = "none";
      this.music(name);
    }
  }

  private impulse(seconds: number, decay: number): AudioBuffer {
    const ctx = this.ctx!;
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const ch = buf.getChannelData(c);
      for (let i = 0; i < len; i++) ch[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
    return buf;
  }

  setMuted(muted: boolean): void {
    if (muted) this.heartbeat(false);
    if (!this.ctx) {
      if (!muted) this.unlock();
      return;
    }
    this.master.gain.setTargetAtTime(muted ? 0 : 0.8, this.now, 0.05);
  }

  private get now(): number {
    return this.ctx!.currentTime;
  }

  // ---- building blocks -------------------------------------------------

  private env(g: GainNode, t: number, a: number, peak: number, d: number, sustain = 0.0001) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0002), t + a);
    g.gain.exponentialRampToValueAtTime(Math.max(sustain, 0.0001), t + a + d);
  }

  private osc(type: OscillatorType, freq: number, t: number, dur: number, out: AudioNode, peak = 0.2, a = 0.005, freqEnd?: number) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (freqEnd) o.frequency.exponentialRampToValueAtTime(freqEnd, t + dur);
    this.env(g, t, a, peak, dur);
    o.connect(g).connect(out);
    o.start(t);
    o.stop(t + a + dur + 0.05);
    return o;
  }

  private noise(t: number, dur: number, out: AudioNode, opts: { type?: BiquadFilterType; f0?: number; f1?: number; q?: number; peak?: number; a?: number } = {}) {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = opts.type ?? "bandpass";
    f.frequency.setValueAtTime(opts.f0 ?? 1000, t);
    if (opts.f1) f.frequency.exponentialRampToValueAtTime(opts.f1, t + dur);
    f.Q.value = opts.q ?? 1;
    const g = ctx.createGain();
    this.env(g, t, opts.a ?? 0.01, opts.peak ?? 0.3, dur);
    src.connect(f).connect(g).connect(out);
    src.start(t, Math.random());
    src.stop(t + dur + 0.1);
  }

  // ---- music -----------------------------------------------------------

  music(name: string): void {
    if (name === this.trackName) return;
    this.trackName = name;
    if (!this.ctx) return;
    this.track?.stop(2.5);
    this.track = null;
    const make = (MUSIC as Record<string, (a: AudioEngine) => Track>)[name];
    if (make) this.track = make(this);
  }

  // Loops a scheduler callback every `step` seconds until stopped.
  loop(step: number, fn: (t: number, i: number, out: GainNode) => void, level = 1): Track {
    const ctx = this.ctx!;
    const out = ctx.createGain();
    out.gain.setValueAtTime(0.0001, this.now);
    out.gain.exponentialRampToValueAtTime(level, this.now + 2);
    out.connect(this.musicBus);
    let i = 0;
    let next = this.now + 0.1;
    let alive = true;
    const tick = () => {
      if (!alive) return;
      while (next < this.now + 0.3) {
        fn(next, i++, out);
        next += step;
      }
      setTimeout(tick, 80);
    };
    tick();
    return {
      stop: (fade) => {
        alive = false;
        out.gain.cancelScheduledValues(this.now);
        out.gain.setValueAtTime(out.gain.value, this.now);
        out.gain.exponentialRampToValueAtTime(0.0001, this.now + fade);
        setTimeout(() => out.disconnect(), fade * 1000 + 200);
      },
    };
  }

  // Sustained oscillator pad that fades with the track.
  pad(freqs: number[], type: OscillatorType, cutoff: number, level: number, lfoRate = 0.1): Track {
    const ctx = this.ctx!;
    const out = ctx.createGain();
    out.gain.setValueAtTime(0.0001, this.now);
    out.gain.exponentialRampToValueAtTime(level, this.now + 3);
    const filt = ctx.createBiquadFilter();
    filt.type = "lowpass";
    filt.frequency.value = cutoff;
    const lfo = ctx.createOscillator();
    const lfoGain = ctx.createGain();
    lfo.frequency.value = lfoRate;
    lfoGain.gain.value = cutoff * 0.4;
    lfo.connect(lfoGain).connect(filt.frequency);
    lfo.start();
    filt.connect(out).connect(this.musicBus);
    const oscs = freqs.flatMap((f) =>
      [-6, 6].map((det) => {
        const o = ctx.createOscillator();
        o.type = type;
        o.frequency.value = f;
        o.detune.value = det;
        o.connect(filt);
        o.start();
        return o;
      }),
    );
    return {
      stop: (fade) => {
        out.gain.cancelScheduledValues(this.now);
        out.gain.setValueAtTime(out.gain.value, this.now);
        out.gain.exponentialRampToValueAtTime(0.0001, this.now + fade);
        const end = this.now + fade + 0.1;
        oscs.forEach((o) => o.stop(end));
        lfo.stop(end);
      },
    };
  }

  pluck(freq: number, t: number, out: AudioNode, level = 0.12, decay = 1.2) {
    this.osc("triangle", freq, t, decay, out, level, 0.003);
    this.osc("sine", freq * 2, t, decay * 0.5, out, level * 0.3, 0.003);
  }

  bell(freq: number, t: number, out: AudioNode, level = 0.08) {
    this.osc("sine", freq, t, 2.2, out, level, 0.002);
    this.osc("sine", freq * 2.76, t, 0.8, out, level * 0.35, 0.002);
  }

  fluteNote(freq: number, t: number, dur: number, out: AudioNode) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = "sine";
    o.frequency.value = freq;
    const vib = ctx.createOscillator();
    const vibG = ctx.createGain();
    vib.frequency.value = 5.2;
    vibG.gain.value = freq * 0.008;
    vib.connect(vibG).connect(o.frequency);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.16, t + 0.06);
    g.gain.setValueAtTime(0.14, t + dur * 0.7);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(out);
    o.start(t);
    vib.start(t);
    o.stop(t + dur + 0.05);
    vib.stop(t + dur + 0.05);
    this.noise(t, dur * 0.8, out, { f0: freq * 2, q: 6, peak: 0.015, a: 0.05 });
  }

  // ---- effects ---------------------------------------------------------

  sfx(name: string): void {
    if (!this.ctx) return;
    const fn = (SFX as Record<string, (a: AudioEngine, t: number, out: AudioNode) => void>)[name];
    if (fn) fn(this, this.now, this.sfxBus);
  }

  blip(voice: number): void {
    if (!this.ctx) return;
    const f = 170 * voice * (0.92 + Math.random() * 0.16);
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = "square";
    o.frequency.value = f;
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 1400;
    const g = ctx.createGain();
    this.env(g, this.now, 0.004, 0.025, 0.05);
    o.connect(lp).connect(g).connect(this.sfxBus);
    o.start();
    o.stop(this.now + 0.08);
  }

  heartbeat(on: boolean, bpm = 110): void {
    if (this.heart !== null) {
      clearInterval(this.heart);
      this.heart = null;
    }
    if (!on || !this.ctx) return;
    const beat = () => SFX.heartbeat(this, this.now, this.sfxBus);
    beat();
    this.heart = window.setInterval(beat, 60000 / bpm);
  }

  // Exposed for the track/sfx tables below.
  get raw() {
    return { osc: this.osc.bind(this), noise: this.noise.bind(this), now: () => this.now, ctx: this.ctx! };
  }
}

const MUSIC = {
  dread: (a: AudioEngine) => {
    const pad = a.pad([NOTE("A1"), NOTE("E2"), NOTE("Bb2")], "sawtooth", 280, 0.12, 0.05);
    const wind = a.loop(3, (t, _i, out) => a.raw.noise(t, 4, out, { f0: 350, f1: 700, q: 2, peak: 0.05, a: 1.5 }), 1);
    return { stop: (f: number) => (pad.stop(f), wind.stop(f)) };
  },
  mystery: (a: AudioEngine) => {
    const pad = a.pad([NOTE("D3"), NOTE("F3"), NOTE("A3"), NOTE("E4")], "triangle", 900, 0.06, 0.08);
    const scale = ["D5", "F5", "G5", "A5", "C6", "D6", "A4"].map(NOTE);
    const pings = a.loop(0.9, (t, i, out) => {
      if (i % 3 === 0 || Math.random() < 0.35) a.bell(scale[Math.floor(Math.random() * scale.length)], t + Math.random() * 0.2, out, 0.04);
    });
    return { stop: (f: number) => (pad.stop(f), pings.stop(f)) };
  },
  tension: (a: AudioEngine) => {
    const pad = a.pad([NOTE("D2"), NOTE("A2"), NOTE("Eb3")], "sawtooth", 500, 0.07, 0.3);
    const pulse = a.loop(0.42, (t, i, out) => {
      a.raw.osc("sawtooth", i % 8 === 7 ? NOTE("Eb2") : NOTE("D2"), t, 0.25, out, 0.08, 0.005);
      if (i % 2 === 0) a.raw.noise(t, 0.08, out, { f0: 4000, q: 1, peak: 0.03 });
    });
    return { stop: (f: number) => (pad.stop(f), pulse.stop(f)) };
  },
  harp: (a: AudioEngine) => {
    const chords = [
      ["A3", "C4", "E4", "A4", "E4", "C4"],
      ["F3", "A3", "C4", "F4", "C4", "A3"],
      ["C3", "G3", "C4", "E4", "C4", "G3"],
      ["G3", "B3", "D4", "G4", "D4", "B3"],
    ].map((c) => c.map(NOTE));
    return a.loop(0.24, (t, i, out) => {
      const chord = chords[Math.floor(i / 12) % chords.length];
      a.pluck(chord[i % chord.length], t, out, 0.07, 1.6);
    });
  },
  flute: (a: AudioEngine) => {
    const melody: [string, number][] = [
      ["A4", 1], ["C5", 1], ["E5", 2], ["D5", 1], ["C5", 1], ["A4", 2],
      ["G4", 1], ["A4", 1], ["C5", 2], ["B4", 1], ["G4", 1], ["A4", 3], ["", 1],
    ];
    const beat = 0.32;
    const steps: { f: number; d: number }[] = [];
    for (const [n, d] of melody) {
      for (let j = 0; j < d; j++) steps.push({ f: j === 0 && n ? NOTE(n) : 0, d: d * beat });
    }
    return a.loop(beat, (t, i, out) => {
      const s = steps[i % steps.length];
      if (s.f) a.fluteNote(s.f, t, s.d * 0.95, out);
    });
  },
  triumph: (a: AudioEngine) => {
    const chords = [
      ["C3", "E4", "G4", "C5"],
      ["F3", "F4", "A4", "C5"],
      ["G3", "D4", "G4", "B4"],
      ["C3", "E4", "G4", "C5"],
    ].map((c) => c.map(NOTE));
    return a.loop(0.3, (t, i, out) => {
      const chord = chords[Math.floor(i / 8) % 4];
      if (i % 8 === 0) for (const f of chord) a.raw.osc("sawtooth", f, t, 2.2, out, 0.03, 0.3);
      a.bell(chord[(i % 4) + (i % 8 >= 4 ? 0 : 0)] * 2, t, out, 0.035);
    });
  },
  sorrow: (a: AudioEngine) => a.pad([NOTE("D3"), NOTE("F3"), NOTE("Bb3")], "triangle", 600, 0.07, 0.04),
};

type Raw = AudioEngine["raw"];
const r = (a: AudioEngine): Raw => a.raw;

const SFX = {
  spell: (a: AudioEngine, t: number, out: AudioNode) => {
    r(a).osc("sine", 1400, t, 0.35, out, 0.12, 0.004, 260);
    r(a).noise(t, 0.4, out, { f0: 4000, f1: 700, q: 3, peak: 0.25 });
  },
  burst: (a: AudioEngine, t: number, out: AudioNode) => {
    r(a).noise(t, 0.6, out, { type: "lowpass", f0: 3000, f1: 200, peak: 0.4 });
    r(a).osc("sine", 160, t, 0.4, out, 0.3, 0.003, 50);
  },
  whoosh: (a: AudioEngine, t: number, out: AudioNode) => r(a).noise(t, 0.7, out, { f0: 300, f1: 2500, q: 2, peak: 0.25, a: 0.25 }),
  roar: (a: AudioEngine, t: number, out: AudioNode) => {
    for (const [f, d] of [
      [92, 0],
      [74, 0.08],
      [110, 0.15],
    ]) {
      r(a).osc("sawtooth", f, t + d, 1.6, out, 0.16, 0.08, f * 0.6);
    }
    r(a).noise(t, 1.7, out, { type: "lowpass", f0: 900, f1: 300, peak: 0.35, a: 0.08 });
  },
  growl: (a: AudioEngine, t: number, out: AudioNode) => {
    r(a).osc("sawtooth", 58, t, 1.3, out, 0.14, 0.2, 52);
    r(a).noise(t, 1.3, out, { type: "lowpass", f0: 400, peak: 0.15, a: 0.2 });
  },
  thud: (a: AudioEngine, t: number, out: AudioNode) => {
    r(a).osc("sine", 90, t, 0.45, out, 0.5, 0.002, 38);
    r(a).noise(t, 0.12, out, { type: "lowpass", f0: 1200, peak: 0.3 });
  },
  crash: (a: AudioEngine, t: number, out: AudioNode) => {
    r(a).noise(t, 1.4, out, { type: "lowpass", f0: 5000, f1: 300, peak: 0.6 });
    for (let i = 0; i < 4; i++) r(a).osc("sine", 70 + Math.random() * 60, t + i * 0.07, 0.5, out, 0.3, 0.002, 30);
  },
  creak: (a: AudioEngine, t: number, out: AudioNode) => {
    const o = r(a).osc("sawtooth", 140, t, 1.1, out, 0.05, 0.1, 210);
    o.detune.setValueCurveAtTime(new Float32Array([0, 80, -40, 120, 0]), t, 1.0);
  },
  flutter: (a: AudioEngine, t: number, out: AudioNode) => {
    for (let i = 0; i < 28; i++) r(a).noise(t + i * 0.055 + Math.random() * 0.02, 0.03, out, { f0: 2500 + Math.random() * 2000, q: 4, peak: 0.08 });
  },
  gulp: (a: AudioEngine, t: number, out: AudioNode) => {
    r(a).osc("sine", 320, t, 0.12, out, 0.2, 0.01, 140);
    r(a).osc("sine", 300, t + 0.35, 0.12, out, 0.2, 0.01, 130);
  },
  fire: (a: AudioEngine, t: number, out: AudioNode) => {
    r(a).noise(t, 2.2, out, { type: "lowpass", f0: 1200, f1: 500, peak: 0.3, a: 0.15 });
    for (let i = 0; i < 18; i++) r(a).noise(t + Math.random() * 2, 0.02, out, { f0: 3000, q: 2, peak: 0.12 });
  },
  choice: (a: AudioEngine, t: number, out: AudioNode) => {
    a.bell(880, t, out, 0.1);
    a.bell(1320, t + 0.09, out, 0.07);
  },
  select: (a: AudioEngine, t: number, out: AudioNode) => {
    a.bell(660, t, out, 0.09);
    a.bell(990, t + 0.06, out, 0.06);
  },
  heartbeat: (a: AudioEngine, t: number, out: AudioNode) => {
    r(a).osc("sine", 58, t, 0.16, out, 0.45, 0.005, 40);
    r(a).osc("sine", 52, t + 0.22, 0.2, out, 0.32, 0.005, 36);
  },
  sparkle: (a: AudioEngine, t: number, out: AudioNode) => {
    for (let i = 0; i < 10; i++) a.bell(2000 + Math.random() * 3000, t + i * 0.08, out, 0.025);
  },
  shatter: (a: AudioEngine, t: number, out: AudioNode) => {
    for (let i = 0; i < 12; i++) r(a).noise(t + Math.random() * 0.4, 0.15, out, { type: "highpass", f0: 3000 + Math.random() * 4000, peak: 0.12 });
  },
  grind: (a: AudioEngine, t: number, out: AudioNode) => r(a).noise(t, 1.2, out, { type: "lowpass", f0: 250, f1: 400, peak: 0.4, a: 0.2 }),
  door: (a: AudioEngine, t: number, out: AudioNode) => {
    SFX.creak(a, t, out);
    SFX.thud(a, t + 1.0, out);
  },
  laugh: (a: AudioEngine, t: number, out: AudioNode) => {
    for (let i = 0; i < 6; i++) r(a).osc("sawtooth", 150 - i * 6, t + i * 0.2, 0.14, out, 0.06, 0.02, 120 - i * 6);
  },
};
