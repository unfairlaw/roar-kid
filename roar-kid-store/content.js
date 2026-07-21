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
  limiter: null, // worklet-path limiter node (ceiling messages)
  legacyLimiter: null, // fallback-path DynamicsCompressorNode "limiter"
  masterGain: null,
  settings: null,
  wiring: false,
  // Per-device loudness anchor (FR-3): {refDb, stale} once one exists for
  // this machine, else null — and while null the system is RELATIVE, so
  // absolute level/dose numbers are suppressed, not estimated.
  anchor: null,
  // True while the limiter ceiling in effect was derived from a fresh
  // anchor in child mode (surfaced by the popup with its volume caveat).
  childCeilingAnchored: false,
  // listening-dose accounting (fed by the limiter's meter messages);
  // `pending` is the fraction accrued since the last storage flush.
  dose: { fraction: 0, pending: 0, levelDb: null, since: Date.now(), metering: false },
};

const DEFAULTS = {
  enabled: true,
  // dB HL thresholds per band, per ear.
  left: [0, 0, 0, 0, 0, 0, 0, 0],
  right: [0, 0, 0, 0, 0, 0, 0, 0],
  masterVolume: 1.0,
  targetMode: "comfort", // comfort | adult | child (child is gated, SR-2)
  wdrcSpeed: "fast", // fast | slow detector time constants
  // Child target stays locked until the options-page audiologist
  // attestation; without it a stored "child" mode falls back to comfort.
  childMode: { unlocked: false },
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

// Tab-badge state report (background.js turns it into the "ON" badge).
// Transitions only; a failed send (e.g. the extension was reloaded under
// this page) is irrelevant to playback and ignored.
let lastReportedActive = null;
function reportActive(active) {
  if (active === lastReportedActive) return;
  lastReportedActive = active;
  try {
    chrome.runtime.sendMessage({ type: "roar-active", active }).catch(() => {});
  } catch {}
}

function applySettings(s) {
  if (!state.ctx || !state.source) return;
  s.left = migrateBands(s.left);
  s.right = migrateBands(s.right);
  state.settings = s;
  // True bypass when disabled: route around the filterbank entirely.
  state.source.disconnect();
  state.source.connect(s.enabled ? state.chainInput : state.masterGain);
  reportActive(s.enabled);

  // SR-2 gate: the child target only ever takes effect with the
  // audiologist attestation on record; otherwise fall back to comfort.
  const childActive = s.targetMode === "child" && s.childMode?.unlocked;
  const mode = s.targetMode === "child" && !childActive ? "comfort" : s.targetMode;

  // Output ceiling. With a fresh (non-stale) anchor it is derived from
  // the anchored mapping — peaks land at the child (85 dB SPL) or adult
  // (102 dB SPL, UCL-derived) peak target — which is only meaningful at
  // the system volume the anchor was set at (the popup says so). The
  // adult derivation is normally a no-op (see dsp.js). Both derivations
  // can only tighten their fixed ceilings, and the limiter clamps any
  // request to −1 dBFS or lower, so these messages only ever lower it.
  const anchoredFresh = !!state.anchor && !state.anchor.stale;
  const ceilDb = childActive
    ? anchoredFresh
      ? DSP.childCeilingDb(state.anchor.refDb)
      : DSP.CHILD_CEILING_DB
    : anchoredFresh
      ? DSP.adultCeilingDb(state.anchor.refDb)
      : DSP.CEILING_DB;
  state.childCeilingAnchored = childActive && anchoredFresh;
  if (state.limiter) {
    state.limiter.port.postMessage({ ceilingDb: ceilDb });
  } else if (state.legacyLimiter) {
    state.legacyLimiter.threshold.value = -3 + (ceilDb - DSP.CEILING_DB);
  }

  const cal = DSP.calibrationOffsets(s.calibration);
  for (const ear of ["left", "right"]) {
    const curves = DSP.bandCurves(s[ear], mode, cal);
    if (state.wdrcNodes) {
      state.wdrcNodes[ear].port.postMessage({
        curves,
        speed: s.wdrcSpeed,
        // Level mapping uses the per-device anchor when one exists; the
        // documented default assumption otherwise (shape-only, relative).
        refDb: state.anchor?.refDb ?? DSP.REF_DBSPL_AT_FS,
      });
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
        const spd = DSP.WDRC_SPEEDS[s.wdrcSpeed] || DSP.WDRC_SPEEDS.fast;
        comp.attack.value = spd.attack;
        comp.release.value = spd.release;
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
// The limiter meters its own output. Absolute level and dose are computed
// ONLY when a per-device loudness anchor exists (FR-3.1/SR-3): an
// un-anchored point estimate can be wrong by 10–20 dB across hardware, so
// until anchoring the system reports itself as relative and no number is
// shown. Dose reference: ITU-T H.870 Mode 2 (children/conservative): 100%
// weekly dose = 75 dBA for 40 h.
//
// The dose is a WEEKLY figure, so it must survive page loads: it is
// persisted in chrome.storage.local under fixed 7-day blocks (epoch-
// aligned — the block boundary is arbitrary but consistent) and restored
// on startup. Tabs flush their accrued increment read-modify-write every
// few seconds, so concurrent tabs add up instead of clobbering each
// other, and each flush pulls the other tabs' contributions back in.
const WEEK_MS = 7 * 24 * 3600 * 1000;
const doseWeek = () => Math.floor(Date.now() / WEEK_MS);

function onMeter(msg) {
  const { msq, dt } = msg;
  state.dose.metering = true;
  if (!(msq > 0) || !(dt > 0) || !state.anchor) return;
  const level = 10 * Math.log10(msq) + state.anchor.refDb;
  state.dose.levelDb = level;
  if (level > 40) {
    const inc = (dt / (40 * 3600)) * Math.pow(10, (level - 75) / 10);
    state.dose.fraction += inc;
    state.dose.pending += inc;
  }
}

async function restoreDose() {
  const { doseLog } = await chrome.storage.local.get("doseLog");
  if (doseLog && doseLog.week === doseWeek() && isFinite(doseLog.fraction)) {
    // += so metering that landed before this read is not lost.
    state.dose.fraction += doseLog.fraction;
    state.dose.since = doseLog.since || state.dose.since;
  }
}
restoreDose();

async function flushDose() {
  const inc = state.dose.pending;
  if (!(inc > 0)) return;
  state.dose.pending = 0;
  const week = doseWeek();
  const { doseLog } = await chrome.storage.local.get("doseLog");
  const base =
    doseLog && doseLog.week === week && isFinite(doseLog.fraction)
      ? doseLog
      : { week, fraction: 0, since: Date.now() };
  base.fraction += inc;
  await chrome.storage.local.set({ doseLog: base });
  // Adopt the merged total: picks up other tabs and the weekly reset.
  state.dose.fraction = base.fraction + state.dose.pending;
  state.dose.since = base.since;
}
setInterval(flushDose, 5000);

// ------------------------------------------------------ loudness anchor
// Anchors are saved by the options page in chrome.storage.local, keyed by
// an output-device signature (FR-3.4). An exact signature match is a valid
// anchor; if only anchors for OTHER signatures exist, the newest is used
// but flagged stale so the UI can say "device changed — re-anchor".
async function refreshAnchor() {
  const sig = await DSP.outputDeviceSignature();
  const { anchors = {} } = await chrome.storage.local.get("anchors");
  if (anchors[sig]) {
    state.anchor = { refDb: anchors[sig].refDb, stale: false };
  } else {
    const newest = Object.values(anchors).sort(
      (a, b) => (b.when || 0) - (a.when || 0)
    )[0];
    state.anchor = newest ? { refDb: newest.refDb, stale: true } : null;
  }
  if (state.settings) applySettings(state.settings);
}
refreshAnchor();
try {
  navigator.mediaDevices.addEventListener("devicechange", refreshAnchor);
} catch { /* no device events here — anchor still refreshes via storage */ }

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg && msg.type === "roar-dose") {
    sendResponse({
      ok: true,
      metering: state.dose.metering,
      anchored: !!state.anchor,
      anchorStale: !!state.anchor?.stale,
      // SR-5: surfaced whenever the DynamicsCompressorNode fallback graph
      // is carrying the audio (weakened, non-brickwall safety path).
      degraded: !!state.legacyChains,
      levelDb: state.anchor ? state.dose.levelDb : null,
      dosePct: state.anchor ? state.dose.fraction * 100 : null,
      sinceMs: Date.now() - state.dose.since,
      childCeilingAnchored: state.childCeilingAnchored,
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
    limiter: wdrcNodes ? limiter : null,
    legacyLimiter: wdrcNodes ? null : limiter,
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

// Live-update when the popup/options save new settings; anchors live in
// storage.local, so those changes refresh the anchor lookup instead.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local") {
    if (changes.anchors) refreshAnchor();
    return;
  }
  chrome.storage.sync.get(DEFAULTS, applySettings);
});
