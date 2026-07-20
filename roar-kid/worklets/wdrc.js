// Roar, kid! WDRC AudioWorklet — one node per ear.
// 8 inputs (one per crossover band), 1 mono output (the ear's sum).
//
// Replaces the old DynamicsCompressorNode-per-band chain: this is true
// wide-dynamic-range compression with an RMS level detector and an explicit
// per-band input/output curve, which DynamicsCompressorNode (fixed-topology,
// peak-oriented, under-specified makeup gain) cannot express.
//
// The main thread posts {curves: [{g50,g65,g80} x 8]} — gain in dB at
// 50/65/80 dB program level. Program level = detected RMS dBFS + refDb.
// refDb defaults to the documented full-scale-to-SPL assumption and is
// replaced by the per-device loudness anchor when one exists (posted as
// {refDb}). Between control points the gain is linearly interpolated in dB;
// outside them it holds constant, so a quiet passage never gets more than
// g50 and a loud one never less than g80.
//
// {speed: "fast"|"slow"} selects the detector time constants (values
// mirror dsp.js WDRC_SPEEDS — worklets can't import the shared module).

const REF_DBSPL_AT_FS = 100;
const GAIN_HARD_CAP_DB = 40; // absolute per-band cap, whatever the curve says
const SPEEDS = {
  fast: { attack: 0.005, release: 0.08 },
  slow: { attack: 0.02, release: 0.5 },
};

class RoarWdrcProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const n = options.numberOfInputs || 8;
    this.nBands = n;
    this.curves = Array.from({ length: n }, () => ({ g50: 0, g65: 0, g80: 0 }));
    this.env = new Float64Array(n).fill(1e-10); // RMS^2 envelope per band
    this.gain = new Float64Array(n).fill(1); // smoothed linear gain per band
    this.refDb = REF_DBSPL_AT_FS;
    this.setSpeed("fast");
    // Applied-gain smoothing: ~10 ms, kills zipper noise between blocks.
    this.gainCoef = Math.exp(-1 / (sampleRate * 0.01));
    this.port.onmessage = (e) => {
      const d = e.data || {};
      if (Array.isArray(d.curves)) this.curves = d.curves;
      if (typeof d.refDb === "number" && isFinite(d.refDb)) {
        this.refDb = Math.max(60, Math.min(120, d.refDb));
      }
      if (SPEEDS[d.speed]) this.setSpeed(d.speed);
    };
  }

  setSpeed(name) {
    const s = SPEEDS[name];
    this.attCoef = Math.exp(-1 / (sampleRate * s.attack));
    this.relCoef = Math.exp(-1 / (sampleRate * s.release));
  }

  targetGainDb(band, levelDbfs) {
    const c = this.curves[band];
    if (!c) return 0;
    const spl = levelDbfs + this.refDb;
    let g;
    if (spl <= 50) g = c.g50;
    else if (spl >= 80) g = c.g80;
    else if (spl <= 65) g = c.g50 + ((spl - 50) / 15) * (c.g65 - c.g50);
    else g = c.g65 + ((spl - 65) / 15) * (c.g80 - c.g65);
    return Math.min(g, GAIN_HARD_CAP_DB);
  }

  process(inputs, outputs) {
    const out = outputs[0][0];
    if (!out) return true;
    out.fill(0);
    for (let b = 0; b < this.nBands; b++) {
      const x = inputs[b] && inputs[b][0];
      if (!x) continue;
      // RMS^2 envelope, asymmetric attack/release, per sample.
      let env = this.env[b];
      const att = this.attCoef;
      const rel = this.relCoef;
      for (let i = 0; i < x.length; i++) {
        const sq = x[i] * x[i];
        const c = sq > env ? att : rel;
        env = c * env + (1 - c) * sq;
      }
      this.env[b] = env;
      // One gain decision per 128-sample block (~2.7 ms), smoothed per
      // sample toward the target — cheap and click-free.
      const levelDbfs = 10 * Math.log10(env + 1e-12);
      const target = Math.pow(10, this.targetGainDb(b, levelDbfs) / 20);
      let g = this.gain[b];
      const gc = this.gainCoef;
      for (let i = 0; i < x.length; i++) {
        g = gc * g + (1 - gc) * target;
        out[i] += x[i] * g;
      }
      this.gain[b] = g;
    }
    return true;
  }
}

registerProcessor("roar-wdrc", RoarWdrcProcessor);
