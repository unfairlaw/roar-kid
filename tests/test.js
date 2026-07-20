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
//       and the legacy DynamicsCompressorNode fallback graph (used when
//       AudioWorklet fails to load) stays within a bounded overshoot of
//       its own threshold under the same worst-case input (SR-1).
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

// ------------------------------------------------------------------ run

(async () => {
  try {
    testCurves();
    testCalibrationRoundTrip();
    await testFlatness();
    await testWdrcCompression();
    await testLimiter();
    await testLatency();
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
