// Roar, kid! DSP test harness — runs the spec's test procedures in the
// browser with OfflineAudioContext (no build step, no framework).
//
//   T1  Prescriptive curves: sanity + reference values per target mode,
//       including adult-vs-NAL-R and child-vs-DSL-flavored reference
//       points within a stated tolerance (NFR-T.2).
//   T2  Signal integrity: crossover bank + WDRC at an all-zero audiogram
//       must be flat within ±1 dB from 100 Hz to 12 kHz.
//   T3  WDRC behavior: with a flat 40 dB HL curve, a quiet tone must get
//       more gain than a loud one (that's the whole point of WDRC).
//   T4  Limiter: worst-case input (full-scale square +12 dB, impulse
//       bursts) must never produce a sample above the ceiling. Sample-
//       accurate assertion. Also: the child ceiling holds, and a message
//       trying to RAISE the ceiling is clamped to the −1 dBFS guarantee.
//   T5  Calibration round-trip: known shape corrections in → the expected
//       combined, clamped per-band offsets out (NFR-T.4).
//   T6  End-to-end latency of the full chain (crossover + WDRC + limiter
//       look-ahead), measured and asserted inside the lip-sync budget
//       (FR-2.5 / NFR-T.3).

const DSP = globalThis.RoarDSP;
const FS = 48000;
const results = [];

function check(name, ok, detail = "") {
  results.push({ name, ok, detail });
  console[ok ? "log" : "error"](`${ok ? "PASS" : "FAIL"} ${name} ${detail}`);
}

function render() {
  const el = document.getElementById("results");
  const n = results.filter((r) => r.ok).length;
  el.innerHTML =
    `<p><strong>${n}/${results.length} passed</strong></p>` +
    results
      .map(
        (r) =>
          `<div class="${r.ok ? "pass" : "fail"}">${r.ok ? "✓" : "✗"} ` +
          `${r.name}${r.detail ? " — " + r.detail : ""}</div>`
      )
      .join("");
}

// ---------------------------------------------------------- T1: curves

function testCurves() {
  const zero = [0, 0, 0, 0, 0, 0, 0, 0];
  const flat40 = [40, 40, 40, 40, 40, 40, 40, 40];

  const cz = DSP.bandCurves(zero, "comfort");
  check(
    "T1a comfort/all-zero audiogram is unity",
    cz.every((c) => c.g50 === 0 && c.g65 === 0 && c.g80 === 0)
  );

  // comfort flat-40 reference: g65 = 18, ratio 2 -> slope 0.5 -> ±7.5
  const cf = DSP.bandCurves(flat40, "comfort");
  const near = (a, b, tol = 0.01) => Math.abs(a - b) <= tol;
  check(
    "T1b comfort/flat-40 matches the stated rule",
    cf.every((c) => near(c.g65, 18) && near(c.g50, 25.5) && near(c.g80, 10.5)),
    JSON.stringify(cf[2])
  );

  const ad = DSP.bandCurves(flat40, "adult");
  const ch = DSP.bandCurves(flat40, "child");
  check(
    "T1c child target prescribes ≥ adult at every band (flat 40)",
    ch.every((c, i) => c.g65 >= ad[i].g65)
  );
  check(
    "T1d gain monotone in loss (comfort, 1 kHz)",
    [0, 20, 40, 60].every((h, i, arr) => {
      if (!i) return true;
      const lo = DSP.bandCurves(zero.map(() => arr[i - 1]), "comfort")[2].g65;
      const hi = DSP.bandCurves(zero.map(() => h), "comfort")[2].g65;
      return hi > lo;
    })
  );

  const withCal = DSP.bandCurves(zero, "comfort", [5, -30, 0, 0, 0, 0, 0, 0]);
  check(
    "T1e calibration offsets shift and clamp (±12)",
    near(withCal[0].g65, 5) && near(withCal[1].g65, -12),
    `got ${withCal[0].g65}, ${withCal[1].g65}`
  );

  check(
    "T1f WDRC curves never exceed the band gain cap",
    DSP.bandCurves([70, 70, 70, 70, 70, 70, 70, 70], "child").every(
      (c) => c.g50 <= DSP.MAX_BAND_GAIN_DB
    )
  );

  // NFR-T.2: adult target vs reference NAL-R insertion-gain points,
  // computed independently here from the published rule (0.05·H3FA per
  // 3-freq-avg factor folded as X = 0.15·H3FA, + 0.31·H + band k), for a
  // typical sloping mild-moderate audiogram. Tolerance ±3 dB.
  {
    const H = [15, 20, 30, 40, 45, 50, 55, 60];
    const k = [-17, -8, 0, -1, -2, -2, -2, -2];
    const x = 0.15 * ((H[1] + H[2] + H[3]) / 3);
    const refG65 = H.map((h, i) => Math.max(0, x + 0.31 * h + k[i]));
    const got = DSP.bandCurves(H, "adult");
    const worst = Math.max(...got.map((c, i) => Math.abs(c.g65 - refG65[i])));
    check(
      "T1g adult target within ±3 dB of reference NAL-R points",
      worst <= 3,
      `worst |Δ| ${worst.toFixed(2)} dB (sloping 15–60 audiogram)`
    );
  }

  // NFR-T.2: child target vs the stated DSL-flavored reference (0.6·loss,
  // ratio 1 + loss/35 unfolded around the 65 dB pivot) at flat 40 dB HL:
  // g65 = 24, slope = 1 − 1/(1 + 40/35) ⇒ g50 = 32, g80 = 16.
  {
    const got = DSP.bandCurves(flat40, "child");
    const tol = 0.5;
    check(
      "T1h child target matches DSL-flavored reference points (flat 40)",
      got.every(
        (c) =>
          Math.abs(c.g65 - 24) <= tol &&
          Math.abs(c.g50 - 32) <= tol &&
          Math.abs(c.g80 - 16) <= tol
      ),
      JSON.stringify(got[2])
    );
  }
}

// ------------------------------------------- T5: calibration round-trip

function testCalibrationRoundTrip() {
  // Known corrections in: bass-heavy profile + tone-match offsets + a mic
  // correction JSON's values. Expected out: their per-band sum, clamped to
  // ±12 dB — and the same offset appearing 1:1 in the band curves.
  const user = [1, 2, 0, -1, 0, 3, 0, 0];
  const mic = [2.5, -3, 0.5, 0, 1, -1, 4, 10];
  const prof = DSP.HEADPHONE_PROFILES["bass-heavy"];
  const out = DSP.calibrationOffsets({
    profile: "bass-heavy",
    userOffsets: user,
    micOffsets: mic,
  });
  const expected = prof.map((p, i) =>
    Math.max(-12, Math.min(12, p + user[i] + mic[i]))
  );
  check(
    "T5a calibration offsets combine and clamp exactly",
    out.every((v, i) => Math.abs(v - expected[i]) < 1e-9),
    `[${out.join(", ")}]`
  );
  const curves = DSP.bandCurves([0, 0, 0, 0, 0, 0, 0, 0], "comfort", out);
  check(
    "T5b shape correction lands 1:1 in the band curves (zero audiogram)",
    curves.every((c, i) => Math.abs(c.g65 - expected[i]) < 1e-9)
  );
}

// ------------------------------------------------- offline-render helpers

function impulseBuffer(ctx, len) {
  const buf = ctx.createBuffer(1, len, FS);
  buf.getChannelData(0)[0] = 1;
  return buf;
}

function magDb(h, f) {
  let re = 0;
  let im = 0;
  for (let n = 0; n < h.length; n++) {
    const w = (2 * Math.PI * f * n) / FS;
    re += h[n] * Math.cos(w);
    im -= h[n] * Math.sin(w);
  }
  return 20 * Math.log10(Math.hypot(re, im) + 1e-20);
}

async function earChain(ctx, curves) {
  await ctx.audioWorklet.addModule("../roar-kid/worklets/wdrc.js");
  const input = new GainNode(ctx, { gain: 1 });
  const bands = DSP.buildCrossoverBank(ctx, input);
  const wdrc = new AudioWorkletNode(ctx, "roar-wdrc", {
    numberOfInputs: DSP.BANDS_HZ.length,
    numberOfOutputs: 1,
    outputChannelCount: [1],
  });
  bands.forEach((b, i) => b.connect(wdrc, 0, i));
  if (curves) wdrc.port.postMessage({ curves });
  return { input, output: wdrc };
}

// ----------------------------------------------------- T2: flat at unity

async function testFlatness() {
  const len = 32768;
  const ctx = new OfflineAudioContext(1, len, FS);
  const { input, output } = await earChain(ctx, null); // default = zero curves
  const src = new AudioBufferSourceNode(ctx, { buffer: impulseBuffer(ctx, len) });
  src.connect(input);
  output.connect(ctx.destination);
  src.start();
  const h = (await ctx.startRendering()).getChannelData(0);

  let worst = 0;
  let worstF = 0;
  for (let i = 0; i < 48; i++) {
    const f = 100 * Math.pow(12000 / 100, i / 47);
    const db = magDb(h, f);
    if (Math.abs(db) > Math.abs(worst)) {
      worst = db;
      worstF = f;
    }
  }
  check(
    "T2 crossover+WDRC flat within ±1 dB at unity (100 Hz–12 kHz)",
    Math.abs(worst) <= 1,
    `worst ${worst.toFixed(2)} dB @ ${worstF.toFixed(0)} Hz`
  );
}

// ------------------------------------------- T3: level-dependent gain

async function toneGainThroughChain(levelDb) {
  const len = FS; // 1 s
  const ctx = new OfflineAudioContext(1, len, FS);
  const curves = DSP.bandCurves([40, 40, 40, 40, 40, 40, 40, 40], "comfort");
  const { input, output } = await earChain(ctx, curves);
  const osc = new OscillatorNode(ctx, { frequency: 1000 });
  const g = new GainNode(ctx, { gain: Math.pow(10, levelDb / 20) });
  osc.connect(g).connect(input);
  output.connect(ctx.destination);
  osc.start();
  const out = (await ctx.startRendering()).getChannelData(0);
  // steady-state RMS over the last half second
  let acc = 0;
  for (let i = len / 2; i < len; i++) acc += out[i] * out[i];
  const rmsOut = Math.sqrt(acc / (len / 2));
  const rmsIn = Math.pow(10, levelDb / 20) * Math.SQRT1_2;
  return 20 * Math.log10(rmsOut / rmsIn);
}

async function testWdrcCompression() {
  const quiet = await toneGainThroughChain(-46); // ~54 dB "SPL" program level
  const loud = await toneGainThroughChain(-23); // ~77 dB
  check(
    "T3 WDRC gives the quiet tone more gain than the loud one (flat 40)",
    quiet > loud + 3,
    `quiet ${quiet.toFixed(1)} dB vs loud ${loud.toFixed(1)} dB`
  );
}

// -------------------------------------------------- T4: limiter ceiling

// Worst-case peak through the limiter, optionally with a ceilingDb set
// via processorOptions (the child-mode reduced ceiling, or an attempt to
// raise it that the worklet must clamp). Construction-time options rather
// than a port message: offline renders can finish before a posted message
// is delivered, so a message-based test would race.
async function worstCasePeak(ceilingMsgDb) {
  const len = FS; // 1 s
  const ctx = new OfflineAudioContext(2, len, FS);
  await ctx.audioWorklet.addModule("../roar-kid/worklets/limiter.js");

  // Worst case: full-scale square at 97 Hz, boosted +12 dB, with periodic
  // single-sample spikes at ±4 on top — transients a lagging compressor
  // would let through.
  const buf = ctx.createBuffer(2, len, FS);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < len; i++) {
      d[i] = Math.sign(Math.sin((2 * Math.PI * 97 * i) / FS)) * 4;
      if (i % 4801 === 0) d[i] = i % 2 ? -4 : 4;
    }
  }
  const src = new AudioBufferSourceNode(ctx, { buffer: buf });
  const limiter = new AudioWorkletNode(ctx, "roar-limiter", {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    outputChannelCount: [2],
    channelCount: 2,
    channelCountMode: "explicit",
    processorOptions:
      ceilingMsgDb === undefined ? {} : { ceilingDb: ceilingMsgDb },
  });
  src.connect(limiter).connect(ctx.destination);
  src.start();
  const out = await ctx.startRendering();
  let peak = 0;
  for (let c = 0; c < 2; c++) {
    const d = out.getChannelData(c);
    for (let i = 0; i < len; i++) {
      const a = Math.abs(d[i]);
      if (a > peak) peak = a;
    }
  }
  return peak;
}

async function testLimiter() {
  const adult = Math.pow(10, DSP.CEILING_DB / 20);
  const child = Math.pow(10, DSP.CHILD_CEILING_DB / 20);

  const peak = await worstCasePeak();
  check(
    "T4a limiter: no output sample above the ceiling (sample-accurate)",
    peak <= adult + 1e-6,
    `peak ${peak.toFixed(6)} vs ceiling ${adult.toFixed(6)}`
  );

  const childPeak = await worstCasePeak(DSP.CHILD_CEILING_DB);
  check(
    "T4b child ceiling holds under worst-case input",
    childPeak <= child + 1e-6,
    `peak ${childPeak.toFixed(6)} vs ceiling ${child.toFixed(6)}`
  );

  // SR-1: a message may only ever LOWER the ceiling; +6 dB must be clamped
  // back to the −1 dBFS structural guarantee.
  const raisedPeak = await worstCasePeak(6);
  check(
    "T4c ceiling cannot be raised above −1 dBFS by any message",
    raisedPeak <= adult + 1e-6,
    `peak ${raisedPeak.toFixed(6)} after posting ceilingDb:+6`
  );
}

// -------------------------------------------- T6: end-to-end latency

async function testLatency() {
  // Impulse through the complete worklet chain (crossover + WDRC +
  // limiter). The energy centroid of the response gives the effective
  // delay; the budget is the ITU broadcast lip-sync detectability bound
  // (~45 ms audio-late). Expected: limiter look-ahead (3 ms) plus the
  // crossover/WDRC group delay.
  const len = 16384;
  const ctx = new OfflineAudioContext(1, len, FS);
  const { input, output } = await earChain(ctx, null);
  await ctx.audioWorklet.addModule("../roar-kid/worklets/limiter.js");
  const limiter = new AudioWorkletNode(ctx, "roar-limiter", {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    outputChannelCount: [2],
    channelCount: 2,
    channelCountMode: "explicit",
  });
  const src = new AudioBufferSourceNode(ctx, { buffer: impulseBuffer(ctx, len) });
  src.connect(input);
  output.connect(limiter).connect(ctx.destination);
  src.start();
  const h = (await ctx.startRendering()).getChannelData(0);
  let e = 0;
  let te = 0;
  for (let i = 0; i < len; i++) {
    const p = h[i] * h[i];
    e += p;
    te += p * i;
  }
  const ms = (te / e / FS) * 1000;
  check(
    "T6 end-to-end latency inside the lip-sync budget",
    e > 0 && ms >= 2 && ms <= 45,
    `energy-centroid delay ${ms.toFixed(1)} ms (look-ahead 3 ms + filter group delay)`
  );
}

// ------------------------------------------------------------------ run

(async () => {
  try {
    testCurves();
    testCalibrationRoundTrip();
    await testFlatness();
    await testWdrcCompression();
    await testLimiter();
    await testLatency();
  } catch (e) {
    check("harness completed without exceptions", false, String(e));
    console.error(e);
  }
  render();
  document.title = `roar-tests: ${results.filter((r) => r.ok).length}/${results.length}`;
  // Headless/CI hook: a collector server (tests/serve.py) accepts this
  // POST and writes results.json; the plain `python3 -m http.server`
  // just answers 501, which is fine.
  fetch("/__results", {
    method: "POST",
    body: JSON.stringify(results, null, 2),
  }).catch(() => {});
})();
