// Roar, kid! content script
// Audio graph (per ear):
//   <video> -> MediaElementSource -> ChannelSplitter
//     L -> [band 250|500|1k|2k|3k|4k|6k|8k: bandpass -> compressor -> makeup gain] -> sum
//     R -> same, with right-ear audiogram
//   -> ChannelMerger -> master limiter -> master gain -> destination
//
// Python dev notes: JS is single-threaded + event-driven. The audio graph
// itself runs on a separate real-time audio thread; we only *configure*
// nodes here. Think of nodes as a dataflow DAG you wire once.

// 8-band diagnostic standard (ASHA): octaves plus 3 and 6 kHz, the
// speech-critical additions used by real fittings (DSL v5 / NAL-NL2).
const BANDS_HZ = [250, 500, 1000, 2000, 3000, 4000, 6000, 8000];

// Bands are no longer octave-spaced, so each bandpass gets its own Q:
// bandwidth spans the geometric means to its neighbors (virtual 125 Hz
// and 16 kHz endpoints), keeping overlap roughly even across the bank.
const BAND_Q = BANDS_HZ.map((f, i) => {
  const lo = Math.sqrt(f * (BANDS_HZ[i - 1] ?? f / 2));
  const hi = Math.sqrt(f * (BANDS_HZ[i + 1] ?? f * 2));
  return f / (hi - lo);
});

const state = {
  ctx: null,
  source: null,
  chainInput: null, // entry to the filterbank; source is re-routed here or around it
  wiredVideo: null,
  earChains: { left: [], right: [] }, // per-band {compressor, makeup}
  masterGain: null,
  enabled: true,
};

const DEFAULTS = {
  enabled: true,
  // dB HL thresholds per band, per ear. 0 = normal hearing.
  left: [0, 0, 0, 0, 0, 0, 0, 0],
  right: [0, 0, 0, 0, 0, 0, 0, 0],
  masterVolume: 1.0,
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

// --- Simplified prescriptive fitting -----------------------------------
// Real fittings use DSL v5.0 / NAL-NL2 (level-dependent gain targets).
// v0 approximation:
//   makeup gain  = 0.45 * threshold_dBHL          (half-gain-ish rule)
//   compression ratio grows with loss             (recruitment compensation)
// This is intentionally conservative. NOT a medical device.
function fittingForThreshold(dbHL) {
  const loss = Math.max(0, Math.min(70, dbHL)); // clamp: aids, not miracles
  return {
    makeupDb: loss * 0.45,
    ratio: 1 + loss / 40,      // 0 dB HL -> 1:1 (transparent), 40 dB -> 2:1
    threshold: -35,            // compress above this input level (dBFS-ish)
    knee: 20,
    attack: 0.005,
    release: 0.1,
  };
}

const dbToLinear = (db) => Math.pow(10, db / 20);

function buildBand(ctx, freqHz, q) {
  const bp = new BiquadFilterNode(ctx, {
    type: "bandpass",
    frequency: freqHz,
    Q: q, // per-band; imperfect reconstruction, fine for v0
  });
  const comp = new DynamicsCompressorNode(ctx);
  const makeup = new GainNode(ctx, { gain: 1 });
  bp.connect(comp).connect(makeup);
  return { input: bp, compressor: comp, makeup };
}

function applySettings(s) {
  if (!state.ctx || !state.source) return;
  s.left = migrateBands(s.left);
  s.right = migrateBands(s.right);
  state.enabled = s.enabled;
  // True bypass when disabled: the bandpass bank doesn't reconstruct flat,
  // so zeroing gains alone would still color the sound. Route around it.
  state.source.disconnect();
  state.source.connect(s.enabled ? state.chainInput : state.masterGain);
  for (const ear of ["left", "right"]) {
    s[ear].forEach((dbHL, i) => {
      const band = state.earChains[ear][i];
      if (!band) return;
      const fit = fittingForThreshold(dbHL);
      const c = band.compressor;
      c.threshold.value = fit.threshold;
      c.ratio.value = fit.ratio;
      c.knee.value = fit.knee;
      c.attack.value = fit.attack;
      c.release.value = fit.release;
      // Smooth gain changes to avoid zipper noise / sudden loudness jumps
      band.makeup.gain.setTargetAtTime(
        dbToLinear(fit.makeupDb),
        state.ctx.currentTime,
        0.05
      );
    });
  }
  state.masterGain.gain.setTargetAtTime(
    s.masterVolume ?? 1.0,
    state.ctx.currentTime,
    0.05
  );
}

function wire(video) {
  if (state.wiredVideo === video) return;
  // A media element can only ever have ONE MediaElementSource. If YouTube
  // swaps the element (SPA navigation), we rebuild the whole context.
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
  state.earChains = { left: [], right: [] };

  [["left", 0], ["right", 1]].forEach(([ear, ch]) => {
    const earSum = new GainNode(ctx, { gain: 1 });
    for (const [i, f] of BANDS_HZ.entries()) {
      const band = buildBand(ctx, f, BAND_Q[i]);
      splitter.connect(band.input, ch); // tap this ear's channel
      band.makeup.connect(earSum);
      state.earChains[ear].push(band);
    }
    earSum.connect(merger, 0, ch);
  });

  // SAFETY: hard limiter so prescriptive gain can never blast the ears.
  // Non-negotiable for a device a child might use.
  const limiter = new DynamicsCompressorNode(ctx, {
    threshold: -3, knee: 0, ratio: 20, attack: 0.001, release: 0.05,
  });
  const masterGain = new GainNode(ctx, { gain: 1 });
  merger.connect(limiter).connect(masterGain).connect(ctx.destination);

  Object.assign(state, { ctx, source, chainInput: upmix, masterGain });

  // Browsers require a user gesture before audio contexts run
  const resume = () => ctx.state === "suspended" && ctx.resume();
  video.addEventListener("play", resume);
  document.addEventListener("click", resume, { once: true });

  chrome.storage.sync.get(DEFAULTS, applySettings);
}

// YouTube is a single-page app: watch for the <video> element appearing
// or being replaced across navigations.
function findAndWire() {
  // Cheap early-out: YouTube reuses its <video> across SPA navigations, so
  // once wired we can skip the querySelector on every mutation.
  if (state.wiredVideo && state.wiredVideo.isConnected) return;
  const video = document.querySelector("video.html5-main-video, video");
  if (video) wire(video);
}
new MutationObserver(findAndWire).observe(document.documentElement, {
  childList: true,
  subtree: true,
});
findAndWire();

// Live-update when the popup saves new thresholds
chrome.storage.onChanged.addListener(() =>
  chrome.storage.sync.get(DEFAULTS, applySettings)
);
