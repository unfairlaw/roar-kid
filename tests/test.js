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
//       accurate assertion. Also: the child ceiling holds, a message
//       trying to RAISE the ceiling is clamped to the −1 dBFS guarantee,
//       the legacy DynamicsCompressorNode fallback graph (used when
//       AudioWorklet fails to load) stays within a bounded overshoot of
//       its own threshold under the same worst-case input (SR-1), the
//       anchor-derived child ceiling (childCeilingDb) maps peaks to the
//       85 dB SPL target, can only tighten the fixed −7 dBFS child
//       ceiling, and holds in the limiter under worst-case input; the
//       adult anchored ceiling (adultCeilingDb, UCL-derived 102 dB SPL)
//       is a no-op at the standard anchor and can never relax −1 dBFS;
//       and the transient guard caps a sudden full-scale event near
//       10 dB below the ceiling mid-event, leaves quiet program content
//       untouched, and relaxes once the level proves sustained.
//   T5  Calibration round-trip: known shape corrections in → the expected
//       combined, clamped per-band offsets out (NFR-T.4).
//   T6  End-to-end latency of the full chain (crossover + WDRC + limiter
//       look-ahead), measured and asserted inside the lip-sync budget
//       (FR-2.5 / NFR-T.3).
//   T7  Real A/V sync: a live (non-Offline) AudioContext plays an actual
//       <video> element through the real production graph and through an
//       unprocessed baseline, using requestVideoFrameCallback +
//       getOutputTimestamp to compare each against genuine video-frame
//       display timing. The DELTA between processed and baseline isolates
//       what the extension's own processing adds, canceling out the test
//       fixture's own encode jitter (FR-2.5 / NFR-T.3, the part T6's
//       OfflineAudioContext measurement can't reach).
//   T8  Distortion (CTA-2051 §5.4, spec S4): residual THD+N through the
//       full chain — everything that is not the fundamental counts,
//       including the WDRC's non-harmonic modulation sidebands — must
//       stay below the standard's 5% criterion at the moderate tone
//       points (500/800 Hz @ 70 dB SPL, 1600 Hz @ 65), at the chain's
//       maximum achievable steady output with the limiter fully engaged
//       (§5.4.1's high-level point), and with a 100 dB SPL-equivalent
//       input tone through a transparency fitting (§5.4.2's analog).
//   T9  1/3-octave response smoothness (CTA-2051 §5.2, spec S2), by the
//       standard's own local statistic: no band more than 12 dB above
//       the mean of its neighbors two-thirds of an octave to either
//       side, over 250–5000 Hz — at transparency, at a representative
//       sloping fitting, and at the steepest in-scope prescription
//       (whose smooth slope passes the local criterion on its own
//       terms; the band-gain cap check rides along).
//   T10 Self-generated noise (CTA-2051 §5.5, spec S5): digital silence
//       through the highest-gain in-scope fitting must render below
//       −68 dBFS RMS (the 32 dB SPL equivalent under the default
//       mapping); expected identically zero — the chain has no noise
//       sources, no dither, no auto-muting to disable for the test.
//   T11 High-frequency gain (CTA-2051 §5.6, spec S6): the average
//       measured insertion gain at 1.0/1.6/2.5 kHz with a 50 dB
//       SPL-equivalent input at the highest-gain in-scope fitting must
//       match the figure DOCUMENTATION.md publishes (35 dB) within
//       ±1 dB. Only the digital path is software-assessable; acoustic
//       delivery belongs to the playback hardware.

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
  // Curves go in via processorOptions, not a port message: an offline
  // render can outrun message delivery (same race the limiter tests avoid
  // the same way), which would silently measure the unity chain.
  const wdrc = new AudioWorkletNode(ctx, "roar-wdrc", {
    numberOfInputs: DSP.BANDS_HZ.length,
    numberOfOutputs: 1,
    outputChannelCount: [1],
    processorOptions: curves ? { curves } : {},
  });
  bands.forEach((b, i) => b.connect(wdrc, 0, i));
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

// Worst case: full-scale square at 97 Hz, boosted +12 dB, with periodic
// single-sample spikes at ±4 on top — transients a lagging compressor
// would let through. Shared by the worklet limiter (T4a-c) and the legacy
// DynamicsCompressorNode fallback (T4d) so both face the identical input.
function worstCaseBuffer(ctx, len) {
  const buf = ctx.createBuffer(2, len, FS);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < len; i++) {
      d[i] = Math.sign(Math.sin((2 * Math.PI * 97 * i) / FS)) * 4;
      if (i % 4801 === 0) d[i] = i % 2 ? -4 : 4;
    }
  }
  return buf;
}

function peakOf(buf, len) {
  let peak = 0;
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < len; i++) {
      const a = Math.abs(d[i]);
      if (a > peak) peak = a;
    }
  }
  return peak;
}

// Worst-case peak through the limiter, optionally with a ceilingDb set
// via processorOptions (the child-mode reduced ceiling, or an attempt to
// raise it that the worklet must clamp). Construction-time options rather
// than a port message: offline renders can finish before a posted message
// is delivered, so a message-based test would race.
async function worstCasePeak(ceilingMsgDb) {
  const len = FS; // 1 s
  const ctx = new OfflineAudioContext(2, len, FS);
  await ctx.audioWorklet.addModule("../roar-kid/worklets/limiter.js");
  const src = new AudioBufferSourceNode(ctx, { buffer: worstCaseBuffer(ctx, len) });
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
  return peakOf(out, len);
}

// SR-1 gap: the legacy DynamicsCompressorNode fallback (content.js
// buildLegacyGraph, used only when AudioWorklet fails to load) is, by its
// own code comment, "not a true brickwall" — no look-ahead, finite 20:1
// ratio, so a fast transient can overshoot the -3 dBFS threshold before the
// detector reacts. Mirrors content.js's exact compressor settings so this
// tracks the real fallback, not an idealized one.
async function worstCasePeakLegacy() {
  const len = FS;
  const ctx = new OfflineAudioContext(2, len, FS);
  const src = new AudioBufferSourceNode(ctx, { buffer: worstCaseBuffer(ctx, len) });
  const limiter = new DynamicsCompressorNode(ctx, {
    threshold: -3,
    knee: 0,
    ratio: 20,
    attack: 0.001,
    release: 0.05,
  });
  src.connect(limiter).connect(ctx.destination);
  src.start();
  const out = await ctx.startRendering();
  return peakOf(out, len);
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

  // T4d: the legacy fallback (SR-1 gap closed). "Not a true brickwall, but
  // the fallback never runs unlimited" (content.js) means bounded
  // overshoot above its -3 dBFS threshold, not zero overshoot — the bound
  // below is the documented acceptable degradation for the degraded path,
  // not an aspiration to worklet-level precision.
  const legacyThreshold = Math.pow(10, -3 / 20);
  const legacyMarginDb = 4;
  const legacyBound = Math.pow(10, (-3 + legacyMarginDb) / 20);
  const legacyPeak = await worstCasePeakLegacy();
  check(
    "T4d legacy DynamicsCompressorNode fallback: worst-case overshoot stays bounded",
    legacyPeak <= legacyBound,
    `peak ${legacyPeak.toFixed(6)} (${(20 * Math.log10(legacyPeak)).toFixed(1)} dBFS) ` +
      `vs threshold ${legacyThreshold.toFixed(6)} (-3 dBFS), bound +${legacyMarginDb} dB`
  );

  // T4e: the anchor-derived child ceiling. Under the standard anchor
  // (refDb = anchorRefDb() ≈ 94) peaks must map to CHILD_PEAK_TARGET_DBSPL,
  // and no refDb — however wrong — may ever RELAX the fixed child ceiling.
  const anchoredDb = DSP.childCeilingDb(DSP.anchorRefDb());
  check(
    "T4e anchor-derived child ceiling = peak target minus refDb, never above −7",
    anchoredDb === DSP.CHILD_PEAK_TARGET_DBSPL - DSP.anchorRefDb() &&
      anchoredDb <= DSP.CHILD_CEILING_DB &&
      DSP.childCeilingDb(60) === DSP.CHILD_CEILING_DB &&
      DSP.childCeilingDb(NaN) === DSP.CHILD_CEILING_DB,
    `childCeilingDb(${DSP.anchorRefDb()}) = ${anchoredDb} dBFS`
  );

  // T4f: that derived ceiling holds in the limiter under worst-case input.
  const anchoredCeil = Math.pow(10, anchoredDb / 20);
  const anchoredPeak = await worstCasePeak(anchoredDb);
  check(
    "T4f anchor-derived child ceiling holds under worst-case input",
    anchoredPeak <= anchoredCeil + 1e-6,
    `peak ${anchoredPeak.toFixed(6)} vs ceiling ${anchoredCeil.toFixed(6)}`
  );

  // T4g: the adult anchored ceiling (UCL-derived 102 dB SPL peak target).
  // Under the standard anchor it must be a no-op (−1 dBFS), it must
  // tighten for an anchor implying high SPL at full scale, and no refDb
  // may ever relax the −1 dBFS ceiling.
  check(
    "T4g adult anchored ceiling: no-op at standard anchor, tightens, never relaxes",
    DSP.adultCeilingDb(DSP.anchorRefDb()) === DSP.CEILING_DB &&
      DSP.adultCeilingDb(110) === DSP.ADULT_PEAK_TARGET_DBSPL - 110 &&
      DSP.adultCeilingDb(60) === DSP.CEILING_DB &&
      DSP.adultCeilingDb(NaN) === DSP.CEILING_DB,
    `adultCeilingDb(${DSP.anchorRefDb()}) = ${DSP.adultCeilingDb(DSP.anchorRefDb())}, ` +
      `adultCeilingDb(110) = ${DSP.adultCeilingDb(110)} dBFS`
  );

  await testTransientGuard();
}

// T4h: the transient guard. Quiet dialogue-level content followed by a
// full-scale "explosion": the event's onset must be capped near
// GUARD_MAX_CUT_DB below the static ceiling, the quiet content itself
// must pass untouched, and once the event sustains, the guard must relax
// back to the static ceiling (sustained loudness is the static ceiling's
// and the dose model's job, not the guard's).
async function testTransientGuard() {
  const len = Math.round(3.5 * FS);
  const ctx = new OfflineAudioContext(1, len, FS);
  await ctx.audioWorklet.addModule("../roar-kid/worklets/limiter.js");
  const buf = ctx.createBuffer(1, len, FS);
  const d = buf.getChannelData(0);
  const toneAmp = Math.pow(10, -27 / 20); // sine peak −27 dBFS ≈ RMS −30
  for (let i = 0; i < len; i++) {
    const t = i / FS;
    d[i] =
      t < 1.0
        ? toneAmp * Math.sin(2 * Math.PI * 500 * t) // quiet "dialogue"
        : Math.sign(Math.sin(2 * Math.PI * 97 * t)); // full-scale "explosion"
  }
  const src = new AudioBufferSourceNode(ctx, { buffer: buf });
  const limiter = new AudioWorkletNode(ctx, "roar-limiter", {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    outputChannelCount: [2],
    channelCount: 2,
    channelCountMode: "explicit",
  });
  src.connect(limiter).connect(ctx.destination);
  src.start();
  const out = (await ctx.startRendering()).getChannelData(0);
  const peakIn = (a, b) => {
    let p = 0;
    for (let i = Math.round(a * FS); i < Math.round(b * FS); i++) {
      const v = Math.abs(out[i]);
      if (v > p) p = v;
    }
    return p;
  };
  const ceiling = Math.pow(10, DSP.CEILING_DB / 20);
  const guardFloor = ceiling * Math.pow(10, -DSP.GUARD_MAX_CUT_DB / 20);

  const tonePeak = peakIn(0.5, 0.95);
  check(
    "T4h1 transient guard leaves quiet program content untouched",
    Math.abs(tonePeak - toneAmp) < toneAmp * 0.05,
    `quiet-tone peak ${tonePeak.toFixed(4)} vs input ${toneAmp.toFixed(4)}`
  );

  // Onset window starts after the 3 ms look-ahead delay flushes.
  const onsetPeak = peakIn(1.005, 1.06);
  check(
    "T4h2 sudden full-scale event is capped mid-execution near the guard floor",
    onsetPeak <= guardFloor * Math.pow(10, 1.5 / 20),
    `onset peak ${onsetPeak.toFixed(4)} (${(20 * Math.log10(onsetPeak)).toFixed(1)} dBFS) ` +
      `vs floor ${guardFloor.toFixed(4)} (${(DSP.CEILING_DB - DSP.GUARD_MAX_CUT_DB).toFixed(0)} dBFS), slack 1.5 dB`
  );

  const latePeak = peakIn(3.0, 3.45);
  check(
    "T4h3 guard relaxes on sustained level — static ceiling governs again",
    latePeak >= ceiling * Math.pow(10, -1 / 20) && latePeak <= ceiling + 1e-6,
    `late peak ${latePeak.toFixed(4)} vs ceiling ${ceiling.toFixed(4)}`
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

// -------------------------------------------------- T7: real A/V sync

// Sample-accurate click detector: an inline AudioWorklet module (built at
// test time, not shipped) that reports the exact context-time a click
// crosses the threshold, then cools down so it can catch several clicks in
// one pass.
const CLICK_DETECTOR_CODE = `
class ClickDetector extends AudioWorkletProcessor {
  constructor() { super(); this.cooldown = 0; }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch) {
      for (let i = 0; i < ch.length; i++) {
        if (this.cooldown > 0) { this.cooldown--; continue; }
        if (Math.abs(ch[i]) > 0.05) {
          this.port.postMessage({ t: currentTime + i / sampleRate });
          this.cooldown = Math.round(sampleRate * 0.2);
        }
      }
    }
    return true;
  }
}
registerProcessor("click-detector", ClickDetector);
`;

// Builds a short synthetic clip in-browser: a canvas flashing white paired
// with sample-accurate audio clicks (scheduled via AudioContext, not
// setTimeout) at the same nominal instants, muxed live via MediaRecorder.
// The clip's OWN internal a/v alignment has up to ~1 video-frame (33 ms
// @30fps) of canvas/MediaRecorder jitter -- that's fine, because T7 only
// measures the DELTA the extension's graph adds relative to a baseline
// pass through the SAME fixture, not the fixture's absolute accuracy.
async function buildSyncFixture() {
  const W = 64, H = 64, FPS = 30, DUR_S = 1.8;
  const clickTimes = [0.4, 0.9, 1.4];

  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const cctx = canvas.getContext("2d", { alpha: false });
  cctx.fillStyle = "black";
  cctx.fillRect(0, 0, W, H);
  const vStream = canvas.captureStream(FPS);

  const actx = new AudioContext();
  const dest = actx.createMediaStreamDestination();
  const t0Ctx = actx.currentTime;
  clickTimes.forEach((t) => {
    const osc = new OscillatorNode(actx, { type: "square", frequency: 2000 });
    const g = new GainNode(actx, { gain: 0 });
    g.gain.setValueAtTime(0.9, t0Ctx + t);
    g.gain.setValueAtTime(0, t0Ctx + t + 0.03);
    osc.connect(g).connect(dest);
    osc.start(t0Ctx + t);
    osc.stop(t0Ctx + t + 0.05);
  });

  const combined = new MediaStream([
    ...vStream.getVideoTracks(),
    ...dest.stream.getAudioTracks(),
  ]);
  const mimeType =
    ["video/webm;codecs=vp8,opus", "video/webm;codecs=vp9,opus", "video/webm"].find(
      (m) => MediaRecorder.isTypeSupported(m)
    ) || "";
  const rec = new MediaRecorder(combined, mimeType ? { mimeType } : undefined);
  const chunks = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  const stopped = new Promise((resolve) => (rec.onstop = resolve));

  const t0Wall = performance.now();
  rec.start();
  let flashIdx = 0;
  function draw(now) {
    const t = (now - t0Wall) / 1000;
    const flashing = flashIdx < clickTimes.length && Math.abs(t - clickTimes[flashIdx]) < 0.05;
    cctx.fillStyle = flashing ? "white" : "black";
    cctx.fillRect(0, 0, W, H);
    if (flashing && t > clickTimes[flashIdx]) flashIdx++;
    if (t < DUR_S) requestAnimationFrame(draw);
    else rec.stop();
  }
  requestAnimationFrame(draw);
  await stopped;
  await actx.close();

  return { blob: new Blob(chunks, { type: "video/webm" }), clickTimes };
}

function loadFixtureVideo(blob) {
  const video = document.createElement("video");
  video.muted = false;
  video.playsInline = true;
  video.style.cssText = "position:fixed;left:-9999px;width:1px;height:1px;";
  document.body.appendChild(video);
  video.src = URL.createObjectURL(blob);
  return new Promise((resolve, reject) => {
    video.onloadedmetadata = () => resolve(video);
    video.onerror = () => reject(new Error("fixture video failed to load"));
  });
}

// Plays `video` once through either the real production graph
// (crossover + WDRC + limiter, mirroring content.js's wire()) or a direct
// bypass (mirroring content.js's disabled-state routing), tapping the
// result with the click detector. Returns each detected click's wall-clock
// arrival, computed via getOutputTimestamp's context-time/performance-time
// correspondence, matched to the nearest real video frame's
// requestVideoFrameCallback expectedDisplayTime (also wall-clock).
async function measureAvOffsets(video, clickTimes, processed) {
  const ctx = new AudioContext();
  const source = ctx.createMediaElementSource(video);
  let tap = source;
  if (processed) {
    await ctx.audioWorklet.addModule("../roar-kid/worklets/wdrc.js");
    await ctx.audioWorklet.addModule("../roar-kid/worklets/limiter.js");
    const input = new GainNode(ctx, { gain: 1 });
    source.connect(input);
    const bands = DSP.buildCrossoverBank(ctx, input);
    const wdrc = new AudioWorkletNode(ctx, "roar-wdrc", {
      numberOfInputs: DSP.BANDS_HZ.length,
      numberOfOutputs: 1,
      outputChannelCount: [1],
    });
    bands.forEach((b, i) => b.connect(wdrc, 0, i));
    const limiter = new AudioWorkletNode(ctx, "roar-limiter", {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [2],
      channelCount: 2,
      channelCountMode: "explicit",
    });
    wdrc.connect(limiter);
    tap = limiter;
  }

  const detectorUrl = URL.createObjectURL(
    new Blob([CLICK_DETECTOR_CODE], { type: "application/javascript" })
  );
  await ctx.audioWorklet.addModule(detectorUrl);
  const detector = new AudioWorkletNode(ctx, "click-detector");
  tap.connect(detector);
  tap.connect(ctx.destination); // must reach destination to be pulled

  const audioHits = [];
  detector.port.onmessage = (e) => audioHits.push(e.data.t);

  const videoFrames = [];
  function onFrame(_now, metadata) {
    videoFrames.push({
      mediaTime: metadata.mediaTime,
      expectedDisplayTime: metadata.expectedDisplayTime,
    });
    if (!video.ended) video.requestVideoFrameCallback(onFrame);
  }
  video.requestVideoFrameCallback(onFrame);

  video.currentTime = 0;
  await video.play();
  await new Promise((resolve) => {
    video.onended = resolve;
    setTimeout(resolve, 3000); // safety timeout, clip is 1.8 s
  });

  const ts = ctx.getOutputTimestamp();
  const outputLatencyS = ctx.outputLatency || 0;
  await ctx.close();

  return clickTimes.map((ct) => {
    let bestFrame = null;
    let bestDist = Infinity;
    for (const f of videoFrames) {
      const d = Math.abs(f.mediaTime - ct);
      if (d < bestDist) {
        bestDist = d;
        bestFrame = f;
      }
    }
    // Pick the audio hit closest to this click's nominal schedule (by
    // detection order, since hits and clickTimes are both chronological).
    const idx = clickTimes.indexOf(ct);
    const audioCtxTime = audioHits[idx];
    if (audioCtxTime === undefined || !bestFrame) return null;
    const audioWallMs = ts.performanceTime + (audioCtxTime - ts.contextTime + outputLatencyS) * 1000;
    return audioWallMs - bestFrame.expectedDisplayTime; // ms; +ve = audio late
  });
}

async function testAvSyncReal() {
  const { blob, clickTimes } = await buildSyncFixture();

  const baselineVideo = await loadFixtureVideo(blob);
  const baselineOffsets = await measureAvOffsets(baselineVideo, clickTimes, false);
  baselineVideo.remove();

  const processedVideo = await loadFixtureVideo(blob);
  const processedOffsets = await measureAvOffsets(processedVideo, clickTimes, true);
  processedVideo.remove();

  // The delta between the two passes through the identical fixture
  // cancels the fixture's own encode jitter and shared headless output
  // latency, isolating what roar-kid's own processing graph adds.
  const deltas = [];
  for (let i = 0; i < clickTimes.length; i++) {
    if (baselineOffsets[i] == null || processedOffsets[i] == null) continue;
    deltas.push(processedOffsets[i] - baselineOffsets[i]);
  }
  check(
    "T7 real A/V sync: processing-added delay stays inside the lip-sync budget",
    deltas.length > 0 && deltas.every((d) => d >= -15 && d <= 45),
    `n=${deltas.length}/${clickTimes.length} deltas=[${deltas.map((d) => d.toFixed(1)).join(", ")}] ms ` +
      `(audio-late positive; budget -15..+45 ms, ITU-R BT.1359)`
  );
}

// -------------------------------------------- T8: distortion (spec S4)

// Single-bin DFT over [start, start+count), returning the complex
// amplitude so the fundamental can be subtracted, not just measured.
// Rectangular window is exact here: every test frequency completes an
// integer number of cycles in the 0.5 s analysis window at FS = 48000
// (S4.5).
function binAmp(x, start, count, f) {
  let re = 0;
  let im = 0;
  for (let n = 0; n < count; n++) {
    const w = (2 * Math.PI * f * n) / FS;
    re += x[start + n] * Math.cos(w);
    im -= x[start + n] * Math.sin(w);
  }
  return { re: (2 / count) * re, im: (2 / count) * im };
}

// Residual THD+N (S4.4): bin-subtract the fundamental from the steady
// output and take remaining RMS over fundamental RMS. Everything that is
// not the fundamental counts — harmonics AND the non-harmonic modulation
// sidebands the WDRC's per-block gain updates produce, which
// harmonic-bin THD cannot see. The residual is taken over the render's
// full band (0–24 kHz ⊇ the spec's 100 Hz–12 kHz analyzer band); a
// wider band can only raise the figure, never flatter it.
function thdnResidual(x, start, count, f) {
  const { re, im } = binAmp(x, start, count, f);
  const fundRms = Math.hypot(re, im) * Math.SQRT1_2;
  let acc = 0;
  for (let n = 0; n < count; n++) {
    const w = (2 * Math.PI * f * n) / FS;
    const r = x[start + n] - (re * Math.cos(w) - im * Math.sin(w));
    acc += r * r;
  }
  return Math.sqrt(acc / count) / fundRms;
}

// A steady tone through the reference chain: crossover + WDRC at the
// given fitting + limiter at the adult ceiling. `splIn` is the program
// level under the worklet's default full-scale mapping (100 dB SPL at
// 0 dBFS), so input RMS dBFS = splIn − 100. Renders 2.5 s: the limiter's
// transient guard needs ~1.5 s to fully relax after a loud tone's cold
// onset (10 dB cut recovering at 30 dB/s from the −60 dB tracker start),
// and S4.5 wants detector and guard settled in the analysis window.
async function toneThroughChain(freq, splIn, curves) {
  const len = Math.round(2.5 * FS);
  const ctx = new OfflineAudioContext(1, len, FS);
  const { input, output } = await earChain(ctx, curves);
  await ctx.audioWorklet.addModule("../roar-kid/worklets/limiter.js");
  const limiter = new AudioWorkletNode(ctx, "roar-limiter", {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    outputChannelCount: [2],
    channelCount: 2,
    channelCountMode: "explicit",
  });
  const osc = new OscillatorNode(ctx, { frequency: freq });
  const g = new GainNode(ctx, {
    gain: Math.SQRT2 * Math.pow(10, (splIn - 100) / 20),
  });
  osc.connect(g).connect(input);
  output.connect(limiter).connect(ctx.destination);
  osc.start();
  return (await ctx.startRendering()).getChannelData(0);
}

async function testDistortion() {
  const flat40 = DSP.bandCurves([40, 40, 40, 40, 40, 40, 40, 40], "comfort");
  const win = FS / 2; // final 0.5 s of the render
  const pct = (t) => `${(t * 100).toFixed(3)}%`;

  // S4.1 — moderate-level output distortion at the canonical flat-40
  // comfort fitting: 500 Hz @ 70 dB SPL equivalent is §5.4.1's criterion
  // point; the ANSI S3.22 companion points ride along at the same 5%
  // limit. The limiter is idle here — on trial are the WDRC's gain
  // modulation (detector ripple) and the filter bank.
  const cases = [
    [500, 70],
    [800, 70],
    [1600, 65],
  ];
  const mods = [];
  for (const [f, spl] of cases) {
    const out = await toneThroughChain(f, spl, flat40);
    mods.push(thdnResidual(out, out.length - win, win, f));
  }
  check(
    "T8a residual THD+N at moderate output levels stays below 5%",
    mods.every((t) => t < 0.05),
    mods.map((t, i) => `${cases[i][0]} Hz @ ${cases[i][1]} dB: ${pct(t)}`).join(", ")
  );

  // S4.2 — maximum-output distortion. §5.4.1 also measures at high
  // output with volume at maximum — precisely where the WDRC's upper
  // curve region, the transient guard, and the limiter gain computer are
  // engaged. A steady 100 dB SPL-equivalent sine is unreachable under
  // the default mapping (sine peak = RMS + 3 dB would cross the −1 dBFS
  // ceiling), so the point sits at the chain's maximum achievable steady
  // output: input driven to full scale, limiter fully engaged, output at
  // the ceiling (≈ 96 dB SPL equivalent).
  const maxOut = await toneThroughChain(500, 100, flat40);
  const thdnMax = thdnResidual(maxOut, maxOut.length - win, win, 500);
  check(
    "T8b residual THD+N at maximum achievable output (limiter engaged) stays below 5%",
    thdnMax < 0.05,
    `500 Hz, full-scale drive: ${pct(thdnMax)}`
  );

  // S4.3 — input distortion (§5.4.2's analog): a 100 dB SPL-equivalent
  // input tone through a transparency fitting.
  const hotIn = await toneThroughChain(500, 100, null);
  const thdnIn = thdnResidual(hotIn, hotIn.length - win, win, 500);
  check(
    "T8c residual THD+N with a 100 dB SPL-equivalent input stays below 5%",
    thdnIn < 0.05,
    `500 Hz @ 100 dB in, transparency fitting: ${pct(thdnIn)}`
  );
}

// --------------------------------- T9: 1/3-octave response smoothness

// ANSI nominal 1/3-octave centers across the CTA-2051 250–5000 Hz band.
const THIRD_OCT_HZ = [
  250, 315, 400, 500, 630, 800, 1000, 1250, 1600, 2000, 2500, 3150, 4000, 5000,
];

// Impulse response of crossover + WDRC with the given curves, read at the
// 1/3-octave centers. The impulse is scheduled 0.3 s in: the WDRC's
// smoothed gain starts at unity and must first settle at the held
// quiet-level gain (g50 — silence sits below the 50 dB control point).
// The single-sample impulse barely moves the RMS detector, so the render
// is a linear snapshot of the chain at its highest-gain operating point —
// the widest per-band gain spread the fitting can produce, i.e. the worst
// case for a smoothness criterion.
async function thirdOctaveLevels(curves) {
  const len = 65536;
  const ctx = new OfflineAudioContext(1, len, FS);
  const { input, output } = await earChain(ctx, curves);
  const src = new AudioBufferSourceNode(ctx, { buffer: impulseBuffer(ctx, len) });
  src.connect(input);
  output.connect(ctx.destination);
  src.start(0.3);
  const h = (await ctx.startRendering()).getChannelData(0);
  return THIRD_OCT_HZ.map((f) => magDb(h, f));
}

// CTA-2051 §5.2's own statistic (S2.1): each band is judged against the
// mean of its neighbors two 1/3-octave steps (⅔ octave) away on both
// sides — prominence(f) = L(f) − mean(L(f₋⅔oct), L(f₊⅔oct)); endpoints
// without a full neighborhood inside 250–5000 Hz are judged against the
// available neighbor. Max-minus-overall-mean is NOT an acceptable
// substitute: it flags prescription slope the standard permits and can
// miss a local resonance riding on a slope the standard forbids.
function maxLocalProminence(levels) {
  let worst = { db: -Infinity, hz: 0 };
  levels.forEach((l, i) => {
    const nb = [];
    if (i >= 2) nb.push(levels[i - 2]);
    if (i + 2 < levels.length) nb.push(levels[i + 2]);
    const db = l - nb.reduce((a, b) => a + b, 0) / nb.length;
    if (db > worst.db) worst = { db, hz: THIRD_OCT_HZ[i] };
  });
  return worst;
}

async function testSmoothness() {
  const fmt = (w) =>
    `max local prominence ${w.db.toFixed(1)} dB @ ${w.hz} Hz (limit 12)`;

  // T9a (S2.2): transparency (zero audiogram) — the setting CTA-2051's
  // reference test condition corresponds to. Expected ≈ 0.
  const unity = maxLocalProminence(await thirdOctaveLevels(null));
  check("T9a local 1/3-oct prominence at transparency ≤ 12 dB", unity.db <= 12, fmt(unity));

  // T9b (S2.3): a representative real fitting — the T1g sloping
  // mild-moderate audiogram under the adult (NAL-R-flavored) target.
  const rep = maxLocalProminence(
    await thirdOctaveLevels(DSP.bandCurves([15, 20, 30, 40, 45, 50, 55, 60], "adult"))
  );
  check(
    "T9b local 1/3-oct prominence at a representative sloping fitting ≤ 12 dB",
    rep.db <= 12,
    fmt(rep)
  );

  // T9c (S2.4): the steepest in-scope prescription (70 dB HL ski slope).
  // The criterion is local, so the prescription's own smooth slope passes
  // on its own terms — what it would catch is a resonance or crossover
  // notch riding on that slope. The band-gain cap check is retained.
  const steepLevels = await thirdOctaveLevels(
    DSP.bandCurves([0, 0, 0, 70, 70, 70, 70, 70], "comfort")
  );
  const steep = maxLocalProminence(steepLevels);
  const peak = Math.max(...steepLevels);
  check(
    "T9c local 1/3-oct prominence at the steepest in-scope prescription ≤ 12 dB",
    steep.db <= 12 && peak <= DSP.MAX_BAND_GAIN_DB + 1,
    `${fmt(steep)}, peak ${peak.toFixed(1)} dB vs cap ${DSP.MAX_BAND_GAIN_DB} (+1 dB slack)`
  );
}

// ------------------------------------------- T10: self-noise (spec S5)

// CTA-2051 §5.5 bounds self-generated noise at 32 dBA-equivalent SPL
// referred to the input. The dominant self-noise source in a wearable —
// the microphone — does not exist here, and the acoustic noise floor at
// the ear belongs to the DAC and headphones; what the digital chain can
// assert is its own contribution. Digital silence through the
// highest-gain in-scope fitting (flat 70 dB HL, comfort — every band
// riding the 35 dB cap) must render below −68 dBFS RMS, the 32 dB SPL
// equivalent under the default mapping, referred to the input side by
// construction since the input is silence. Expected identically zero:
// no noise sources, no dither, and no auto-muting or downward expansion
// whose disabling the standard would require (S5.2 — adding such a
// stage means revisiting the spec). The test keeps that true as the
// chain evolves.
async function testSelfNoise() {
  const len = FS; // 1 s
  const ctx = new OfflineAudioContext(1, len, FS);
  const curves = DSP.bandCurves([70, 70, 70, 70, 70, 70, 70, 70], "comfort");
  const { input, output } = await earChain(ctx, curves);
  await ctx.audioWorklet.addModule("../roar-kid/worklets/limiter.js");
  const limiter = new AudioWorkletNode(ctx, "roar-limiter", {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    outputChannelCount: [2],
    channelCount: 2,
    channelCountMode: "explicit",
  });
  const src = new AudioBufferSourceNode(ctx, { buffer: ctx.createBuffer(1, len, FS) });
  src.connect(input);
  output.connect(limiter).connect(ctx.destination);
  src.start();
  const out = (await ctx.startRendering()).getChannelData(0);
  let acc = 0;
  for (let i = 0; i < len; i++) acc += out[i] * out[i];
  const rms = Math.sqrt(acc / len);
  check(
    "T10 digital silence renders as silence at the highest-gain fitting",
    rms > 0 ? 20 * Math.log10(rms) < -68 : true,
    `output RMS ${rms === 0 ? "−∞ (identically zero)" : (20 * Math.log10(rms)).toFixed(1) + " dBFS"} ` +
      `vs −68 dBFS bound (32 dB SPL equivalent)`
  );
}

// -------------------------------- T11: high-frequency gain (spec S6)

// CTA-2051 §5.6 reports the maximum available high-frequency gain: the
// average of the gains at 1.0, 1.6, and 2.5 kHz with a 50 dB SPL input.
// Measured here at the highest-gain in-scope fitting and required to
// match the figure DOCUMENTATION.md publishes — 35 dB, MAX_BAND_GAIN_DB
// — within ±1 dB (S6.2). Two-layer cap structure: dsp.js clamps every
// curve to 35 dB; the worklet's independent 40 dB backstop is a defense
// against malformed messages, not headroom — 35 is the reportable
// maximum. The figure is digital-domain; acoustic delivery depends on
// the user's headphones.
async function testHfGain() {
  const curves = DSP.bandCurves([70, 70, 70, 70, 70, 70, 70, 70], "comfort");
  const freqs = [1000, 1600, 2500];
  const rmsIn = Math.pow(10, (50 - 100) / 20);
  const gains = [];
  for (const f of freqs) {
    const out = await toneThroughChain(f, 50, curves);
    const count = FS / 2;
    const start = out.length - count;
    let acc = 0;
    for (let i = start; i < out.length; i++) acc += out[i] * out[i];
    gains.push(20 * Math.log10(Math.sqrt(acc / count) / rmsIn));
  }
  const avg = gains.reduce((a, b) => a + b, 0) / gains.length;
  check(
    "T11 max digital HF gain matches the published figure within ±1 dB",
    Math.abs(avg - DSP.MAX_BAND_GAIN_DB) <= 1,
    `avg gain at 1/1.6/2.5 kHz @ 50 dB SPL in = ${avg.toFixed(2)} dB ` +
      `[${gains.map((g) => g.toFixed(2)).join(", ")}] vs published ${DSP.MAX_BAND_GAIN_DB} dB`
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
    await testDistortion();
    await testSmoothness();
    await testSelfNoise();
    await testHfGain();
    await testAvSyncReal();
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
