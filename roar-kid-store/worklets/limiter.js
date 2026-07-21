// Roar, kid! brickwall limiter AudioWorklet — the safety ceiling.
//
// Replaces the DynamicsCompressorNode "limiter": that node has no
// look-ahead, so short transients could overshoot the intended ceiling.
// Here the signal is delayed by LOOKAHEAD seconds while the gain computer
// reads the *incoming* samples, so reduction is in place before a peak
// reaches the output. As the final, sample-accurate guarantee the output is
// additionally hard-clamped to the ceiling — tests/ asserts that no sample
// ever exceeds it, whatever the input.
//
// This node is the LAST processing stage before destination (master volume
// sits before it) — no signal path can bypass it. NFR1.
//
// Metering: every ~250 ms the node posts {msq, peak, dt} — mean-square and
// peak of the *output* over the interval — which content.js turns into the
// estimated listening dose (ITU-T H.870 Mode 2 framing).
//
// Transient guard: on top of the static ceiling, a slew-rate-limited
// tracker follows the running program level in dB, and any incoming peak
// more than GUARD_HEADROOM_DB above it (a movie explosion after quiet
// dialogue) is capped mid-event — the fast-vs-slow envelope mechanism
// commercial impulse-noise reduction uses. The tracker is rate-limited in
// dB (not an exponential envelope: that would re-open within
// milliseconds against a full-scale event), so the cap holds and then
// relaxes at GUARD_RISE_DBPS as the level proves sustained — sustained
// loud content is governed by the static ceiling and the dose model, not
// by the guard. The allowed level floats between the static ceiling and
// GUARD_MAX_CUT_DB below it, is updated once per 128-sample block (it
// moves < 0.1 dB per block), and the reduction rides the same look-ahead
// as the main gain computer. The guard can only lower what the gain
// computer aims for; the sample-accurate hard clamp stays at the static
// ceiling. Values mirror dsp.js GUARD_* (worklets can't import).

const CEILING_DB = -1;
const LOOKAHEAD_S = 0.003;
const GUARD_HEADROOM_DB = 15;
const GUARD_MAX_CUT_DB = 10;
const GUARD_RISE_DBPS = 30; // full 10 dB cut relaxes over ~1/3 s sustained
const GUARD_FALL_DBPS = 20; // re-arms within ~1 s after loudness ends

class RoarLimiterProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    // The ceiling is adjustable in ONE direction only: clamped to
    // CEILING_DB or lower, whether set at construction (processorOptions)
    // or by a posted {ceilingDb} message (used by the attestation-gated
    // child target, which runs several dB below the adult ceiling).
    // Nothing can raise it above −1 dBFS — that guarantee is structural.
    const clampDb = (db) =>
      typeof db === "number" && isFinite(db) ? Math.min(CEILING_DB, db) : CEILING_DB;
    this.ceiling = Math.pow(10, clampDb(options?.processorOptions?.ceilingDb) / 20);
    this.port.onmessage = (e) => {
      const db = e.data?.ceilingDb;
      if (typeof db === "number" && isFinite(db)) {
        this.ceiling = Math.pow(10, clampDb(db) / 20);
      }
    };
    this.la = Math.max(1, Math.round(sampleRate * LOOKAHEAD_S));
    this.buf = [new Float32Array(this.la), new Float32Array(this.la)];
    this.w = 0;
    this.gain = 1;
    // Attack well inside the look-ahead window; release slow enough not to
    // pump on dialogue.
    this.attCoef = Math.exp(-1 / (sampleRate * 0.0008));
    this.relCoef = Math.exp(-1 / (sampleRate * 0.06));
    // transient-guard program-level tracker (dB, slew-rate limited)
    this.slowDb = -60;
    // metering accumulators
    this.msqAcc = 0;
    this.peak = 0;
    this.nAcc = 0;
    this.meterEvery = Math.round(sampleRate * 0.25);
  }

  process(inputs, outputs) {
    const inp = inputs[0];
    const out = outputs[0];
    if (!inp || !inp.length || !out[0]) return true;
    const n = out[0].length;
    const nch = Math.min(2, out.length);
    const ceiling = this.ceiling;

    // Transient guard, once per block: slew the program-level tracker
    // toward this block's linked peak, then derive the allowed level.
    let blockPeak = 0;
    for (let i = 0; i < n; i++) {
      for (let c = 0; c < nch; c++) {
        const s = inp[c] ? Math.abs(inp[c][i]) : 0;
        if (s > blockPeak) blockPeak = s;
      }
    }
    const lvlDb = 20 * Math.log10(blockPeak + 1e-6);
    const step = n / sampleRate;
    this.slowDb =
      lvlDb > this.slowDb
        ? Math.min(lvlDb, this.slowDb + GUARD_RISE_DBPS * step)
        : Math.max(lvlDb, this.slowDb - GUARD_FALL_DBPS * step);
    const allowed = Math.min(
      ceiling,
      Math.max(
        Math.pow(10, (this.slowDb + GUARD_HEADROOM_DB) / 20),
        ceiling * Math.pow(10, -GUARD_MAX_CUT_DB / 20)
      )
    );

    for (let i = 0; i < n; i++) {
      // Linked-channel required gain from the incoming (future) sample.
      let peakIn = 0;
      for (let c = 0; c < nch; c++) {
        const s = inp[c] ? Math.abs(inp[c][i]) : 0;
        if (s > peakIn) peakIn = s;
      }
      const needed = peakIn > allowed ? allowed / peakIn : 1;
      const coef = needed < this.gain ? this.attCoef : this.relCoef;
      this.gain = coef * this.gain + (1 - coef) * needed;

      for (let c = 0; c < nch; c++) {
        const delayed = this.buf[c][this.w];
        this.buf[c][this.w] = inp[c] ? inp[c][i] : 0;
        let y = delayed * this.gain;
        // Sample-accurate hard wall: smoothing keeps this clamp almost
        // always idle, but it is what makes the ceiling a guarantee.
        if (y > ceiling) y = ceiling;
        else if (y < -ceiling) y = -ceiling;
        out[c][i] = y;
        this.msqAcc += y * y;
        const a = Math.abs(y);
        if (a > this.peak) this.peak = a;
      }
      this.w = (this.w + 1) % this.la;
      this.nAcc++;
      if (this.nAcc >= this.meterEvery) {
        this.port.postMessage({
          msq: this.msqAcc / (this.nAcc * nch),
          peak: this.peak,
          dt: this.nAcc / sampleRate,
        });
        this.msqAcc = 0;
        this.peak = 0;
        this.nAcc = 0;
      }
    }
    return true;
  }
}

registerProcessor("roar-limiter", RoarLimiterProcessor);
