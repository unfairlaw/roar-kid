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

const CEILING_DB = -1;
const LOOKAHEAD_S = 0.003;

class RoarLimiterProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.ceiling = Math.pow(10, CEILING_DB / 20);
    this.la = Math.max(1, Math.round(sampleRate * LOOKAHEAD_S));
    this.buf = [new Float32Array(this.la), new Float32Array(this.la)];
    this.w = 0;
    this.gain = 1;
    // Attack well inside the look-ahead window; release slow enough not to
    // pump on dialogue.
    this.attCoef = Math.exp(-1 / (sampleRate * 0.0008));
    this.relCoef = Math.exp(-1 / (sampleRate * 0.06));
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
    for (let i = 0; i < n; i++) {
      // Linked-channel required gain from the incoming (future) sample.
      let peakIn = 0;
      for (let c = 0; c < nch; c++) {
        const s = inp[c] ? Math.abs(inp[c][i]) : 0;
        if (s > peakIn) peakIn = s;
      }
      const needed = peakIn > ceiling ? ceiling / peakIn : 1;
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
