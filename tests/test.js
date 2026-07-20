// Roar, kid! DSP test harness — runs the spec's test procedures in the
// browser with OfflineAudioContext (no build step, no framework).
//
//   T1  Prescriptive curves: sanity + reference values per target mode.
//   T2  Signal integrity: crossover bank + WDRC at an all-zero audiogram
//       must be flat within ±1 dB from 100 Hz to 12 kHz.
//   T3  WDRC behavior: with a flat 40 dB HL curve, a quiet tone must get
//       more gain than a loud one (that's the whole point of WDRC).
//   T4  Limiter: worst-case input (full-scale square +12 dB, impulse
//       bursts) must never produce a sample above the ceiling. Sample-
//       accurate assertion.

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

async function testLimiter() {
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
  });
  src.connect(limiter).connect(ctx.destination);
  src.start();
  const out = await ctx.startRendering();
  const ceiling = Math.pow(10, DSP.CEILING_DB / 20);
  let peak = 0;
  for (let c = 0; c < 2; c++) {
    const d = out.getChannelData(c);
    for (let i = 0; i < len; i++) {
      const a = Math.abs(d[i]);
      if (a > peak) peak = a;
    }
  }
  check(
    "T4 limiter: no output sample above the ceiling (sample-accurate)",
    peak <= ceiling + 1e-6,
    `peak ${peak.toFixed(6)} vs ceiling ${ceiling.toFixed(6)}`
  );
}

// ------------------------------------------------------------------ run

(async () => {
  try {
    testCurves();
    await testFlatness();
    await testWdrcCompression();
    await testLimiter();
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
