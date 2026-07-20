// Roar, kid! content script.
// Audio graph (worklet path — the normal one):
//   <video> -> MediaElementSource -> upmix(2ch) -> ChannelSplitter
//     each ear -> LR4 crossover bank (8 bands, dsp.js) -> WDRC AudioWorklet
//   -> ChannelMerger -> master volume -> brickwall limiter AudioWorklet
//   -> destination
//
// Master volume sits BEFORE the limiter on purpose: the limiter is the last
// stage, so no gain anywhere — prescriptive, calibration, or volume — can
// push output past the ceiling (NFR1).
//
// If AudioWorklet modules fail to load (exotic CSP, old browser) the script
// falls back to the previous DynamicsCompressorNode graph, which keeps the
// same crossover bank and a compressor-based limiter: degraded, never
// unlimited.
//
// dsp.js is loaded before this file (see manifest content_scripts) and
// provides globalThis.RoarDSP.

const DSP = globalThis.RoarDSP;
const BANDS_HZ = DSP.BANDS_HZ;

const state = {
  ctx: null,
  source: null,
  chainInput: null, // entry to the filterbank; source routes here or around
  wiredVideo: null,
  wdrcNodes: null, // {left, right} AudioWorkletNodes (worklet path)
  legacyChains: null, // {left, right} [{compressor, makeup}] (fallback path)
  masterGain: null,
  settings: null,
  wiring: false,
  // listening-dose accounting (fed by the limiter's meter messages)
  dose: { fraction: 0, levelDb: null, since: Date.now(), metering: false },
};

const DEFAULTS = {
  enabled: true,
  // dB HL thresholds per band, per ear.
  left: [0, 0, 0, 0, 0, 0, 0, 0],
  right: [0, 0, 0, 0, 0, 0, 0, 0],
  masterVolume: 1.0,
  targetMode: "comfort", // comfort | adult | child
  calibration: { profile: "none", userOffsets: null, micOffsets: null },
};

// Settings saved by the 6-band version lack 3k and 6k: interpolate them
// from their octave neighbors (snapped to the clinical 5 dB grid).
function migrateBands(arr) {
  if (!Array.isArray(arr)) return [...DEFAULTS.left];
  if (arr.length === BANDS_HZ.length) return arr;
  if (arr.length === 6) {
    const [a250, a500, a1k, a2k, a4k, a8k] = arr;
    const mid = (x, y) => Math.round((x + y) / 2 / 5) * 5;
    return [a250, a500, a1k, a2k, mid(a2k, a4k), a4k, mid(a4k, a8k), a8k];
  }
  return [...DEFAULTS.left];
}

const dbToLinear = (db) => Math.pow(10, db / 20);

function applySettings(s) {
  if (!state.ctx || !state.source) return;
  s.left = migrateBands(s.left);
  s.right = migrateBands(s.right);
  state.settings = s;
  // True bypass when disabled: route around the filterbank entirely.
  state.source.disconnect();
  state.source.connect(s.enabled ? state.chainInput : state.masterGain);

  const cal = DSP.calibrationOffsets(s.calibration);
  for (const ear of ["left", "right"]) {
    const curves = DSP.bandCurves(s[ear], s.targetMode, cal);
    if (state.wdrcNodes) {
      state.wdrcNodes[ear].port.postMessage({ curves });
    } else if (state.legacyChains) {
      curves.forEach((c, i) => {
        const band = state.legacyChains[ear][i];
        if (!band) return;
        // Fold the I/O curve back into compressor terms: pivot gain is
        // g65, the 65->80 slope recovers the ratio.
        const slope = Math.max(0, Math.min(0.9, (c.g65 - c.g80) / 15));
        const comp = band.compressor;
        comp.threshold.value = -35;
        comp.ratio.value = 1 / (1 - slope);
        comp.knee.value = 20;
        comp.attack.value = 0.005;
        comp.release.value = 0.08;
        band.makeup.gain.setTargetAtTime(
          dbToLinear(c.g65),
          state.ctx.currentTime,
          0.05
        );
      });
    }
  }
  state.masterGain.gain.setTargetAtTime(
    s.masterVolume ?? 1.0,
    state.ctx.currentTime,
    0.05
  );
}

// ---------------------------------------------------------------- dose
// The limiter meters its own output. Estimated A-weighted level assumes
// full-scale RMS = REF_DBSPL_AT_FS (documented in dsp.js) at CURRENT master
// volume position — an upper-bound-style estimate, not a measurement.
// Dose reference: ITU-T H.870 Mode 2 (children/conservative): 100% weekly
// dose = 75 dBA for 40 h. Resets per page load.
function onMeter(msg) {
  const { msq, dt } = msg;
  if (!(msq > 0) || !(dt > 0)) return;
  const level = 10 * Math.log10(msq) + DSP.REF_DBSPL_AT_FS;
  state.dose.levelDb = level;
  state.dose.metering = true;
  if (level > 40) {
    state.dose.fraction += (dt / (40 * 3600)) * Math.pow(10, (level - 75) / 10);
  }
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg && msg.type === "roar-dose") {
    sendResponse({
      ok: true,
      metering: state.dose.metering,
      levelDb: state.dose.levelDb,
      dosePct: state.dose.fraction * 100,
      sinceMs: Date.now() - state.dose.since,
      refDbSplAtFs: DSP.REF_DBSPL_AT_FS,
    });
  }
  return false;
});

// ---------------------------------------------------------------- wiring

async function buildWorkletGraph(ctx, splitter, merger) {
  const load = (f) => ctx.audioWorklet.addModule(chrome.runtime.getURL(f));
  await load("worklets/wdrc.js");
  await load("worklets/limiter.js");
  const wdrcNodes = {};
  [["left", 0], ["right", 1]].forEach(([ear, ch]) => {
    const earIn = new GainNode(ctx, {
      gain: 1,
      channelCount: 1,
      channelCountMode: "explicit",
    });
    splitter.connect(earIn, ch);
    const bands = DSP.buildCrossoverBank(ctx, earIn);
    const wdrc = new AudioWorkletNode(ctx, "roar-wdrc", {
      numberOfInputs: BANDS_HZ.length,
      numberOfOutputs: 1,
      outputChannelCount: [1],
    });
    bands.forEach((b, i) => b.connect(wdrc, 0, i));
    wdrc.connect(merger, 0, ch);
    wdrcNodes[ear] = wdrc;
  });
  const limiter = new AudioWorkletNode(ctx, "roar-limiter", {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    outputChannelCount: [2],
    channelCount: 2,
    channelCountMode: "explicit",
  });
  limiter.port.onmessage = (e) => onMeter(e.data);
  return { wdrcNodes, limiter };
}

function buildLegacyGraph(ctx, splitter, merger) {
  const legacyChains = { left: [], right: [] };
  [["left", 0], ["right", 1]].forEach(([ear, ch]) => {
    const earIn = new GainNode(ctx, {
      gain: 1,
      channelCount: 1,
      channelCountMode: "explicit",
    });
    splitter.connect(earIn, ch);
    const bands = DSP.buildCrossoverBank(ctx, earIn);
    const earSum = new GainNode(ctx, { gain: 1 });
    bands.forEach((b) => {
      const compressor = new DynamicsCompressorNode(ctx);
      const makeup = new GainNode(ctx, { gain: 1 });
      b.connect(compressor).connect(makeup).connect(earSum);
      legacyChains[ear].push({ compressor, makeup });
    });
    earSum.connect(merger, 0, ch);
  });
  // Not a true brickwall, but the fallback never runs unlimited.
  const limiter = new DynamicsCompressorNode(ctx, {
    threshold: -3, knee: 0, ratio: 20, attack: 0.001, release: 0.05,
  });
  return { legacyChains, limiter };
}

async function wire(video) {
  if (state.wiredVideo === video || state.wiring) return;
  state.wiring = true;
  // A media element can only ever have ONE MediaElementSource. If the site
  // swaps the element (SPA navigation, next episode), we rebuild the context.
  if (state.ctx) state.ctx.close();

  const ctx = new AudioContext();
  // Remember the element even if capture fails below, so we don't retry
  // (and re-throw) on every DOM mutation.
  state.wiredVideo = video;
  let source;
  try {
    source = ctx.createMediaElementSource(video);
  } catch (e) {
    // Element already captured (e.g. by another extension) — leave it alone.
    ctx.close();
    state.ctx = null;
    state.source = null;
    state.wiring = false;
    return;
  }
  // Mono videos would otherwise come out of the splitter as left-only.
  // Force upmix to stereo so both ears always get signal.
  const upmix = new GainNode(ctx, {
    gain: 1,
    channelCount: 2,
    channelCountMode: "explicit",
    channelInterpretation: "speakers",
  });
  const splitter = new ChannelSplitterNode(ctx, { numberOfOutputs: 2 });
  const merger = new ChannelMergerNode(ctx, { numberOfInputs: 2 });
  source.connect(upmix);
  upmix.connect(splitter);

  const masterGain = new GainNode(ctx, { gain: 1 });
  let wdrcNodes = null;
  let legacyChains = null;
  let limiter;
  try {
    const g = await buildWorkletGraph(ctx, splitter, merger);
    wdrcNodes = g.wdrcNodes;
    limiter = g.limiter;
  } catch (e) {
    console.warn("[roar-kid] AudioWorklet unavailable, using fallback graph:", e);
    const g = buildLegacyGraph(ctx, splitter, merger);
    legacyChains = g.legacyChains;
    limiter = g.limiter;
  }
  // SAFETY: volume BEFORE the limiter; limiter is the last node.
  merger.connect(masterGain).connect(limiter).connect(ctx.destination);

  Object.assign(state, {
    ctx,
    source,
    chainInput: upmix,
    masterGain,
    wdrcNodes,
    legacyChains,
    wiring: false,
  });

  // Browsers require a user gesture before audio contexts run.
  const resume = () => ctx.state === "suspended" && ctx.resume();
  video.addEventListener("play", resume);
  document.addEventListener("click", resume, { once: true });

  chrome.storage.sync.get(DEFAULTS, applySettings);
}

// All supported sites are single-page apps: watch for the <video> element
// appearing or being replaced across navigations.
function findAndWire() {
  // Cheap early-out: sites reuse their <video> across SPA navigations.
  if (state.wiredVideo && state.wiredVideo.isConnected) return;
  const video = document.querySelector("video.html5-main-video, video");
  if (video) wire(video);
}
new MutationObserver(findAndWire).observe(document.documentElement, {
  childList: true,
  subtree: true,
});
findAndWire();

// Live-update when the popup/options save new settings.
chrome.storage.onChanged.addListener(() =>
  chrome.storage.sync.get(DEFAULTS, applySettings)
);
