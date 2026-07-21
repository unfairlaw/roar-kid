# Web Audio API

Part of the [technology study map](../../TECHNOLOGIES.md).

## What it is

The browser's built-in DSP engine. You construct a *graph* of audio nodes —
sources, filters, gains, worklets — connect them once, and the graph then
runs on a dedicated real-time audio thread. Main-thread JavaScript only
wires and parameterizes nodes; the one place JS *does* touch samples is an
`AudioWorkletProcessor`, a class you register that the audio thread calls
per 128-sample block. Since the v1 rebuild, this project's actual DSP —
compression and limiting — lives in two such worklets, with the graph
around them doing the splitting and summing.

## Core concepts

**Nodes used in this project, and why:**

| Node | Role here |
|------|-----------|
| `AudioContext` | The graph's container and clock. One per wired video. |
| `MediaElementAudioSourceNode` | Captures a `<video>`'s audio into the graph. **One per element, ever.** |
| `GainNode` | Volume as a linear multiplier; also a channel-forcing pass-through (upmix, per-ear mono). |
| `ChannelSplitterNode` / `ChannelMergerNode` | Break stereo into per-ear mono chains and reassemble. |
| `IIRFilterNode` | The LR4 crossover sections, from explicit RBJ-cookbook coefficients (`dsp.js:66`). |
| `AudioWorkletNode` | Three per graph: one WDRC per ear (`worklets/wdrc.js`) and the output limiter (`worklets/limiter.js`). |
| `DynamicsCompressorNode` | **Fallback graph only** — used when `addModule` fails (`content.js:231`). |

**Decibels vs. linear gain.** Audio nodes take linear multipliers; humans
and audiograms speak dB. The conversion is `10^(dB/20)` (`content.js:70`).
20, not 10, because amplitude squares into power.

**Crossover, not parallel bandpasses.** v0 split the signal with 8 parallel
bandpass biquads; summing overlapping bandpasses does not reconstruct the
input (phase ripple), which forced true-bypass workarounds. v1 replaces it
with a cascaded **Linkwitz-Riley 4th-order (LR4) crossover**
(`dsp.js:95`): at each split, LP² and HP² sections whose outputs sum to an
allpass — flat magnitude by construction, asserted by the test suite.
Crossover points sit at the geometric means between adjacent audiometric
bands (`dsp.js:20`). True bypass when disabled is still used
(`content.js:77`), now for CPU and paranoia rather than necessity.

**The BiquadFilterNode trap (the expensive lesson).** `BiquadFilterNode`
lowpass/highpass interpret `Q` **in dB**, with implementation-specific
filter designs — which silently breaks the LP² + HP² = allpass identity
and put +14 dB bumps at every crossover point. The fix: compute RBJ
cookbook coefficients by hand (bilinear transform, Q = 1/√2) and load them
into `IIRFilterNode`, where the transfer function is exactly what you
specify (`dsp.js:59-93`). If a filter identity matters, do not let the
browser design the filter.

**WDRC in a worklet.** Each ear's 8 crossover bands feed one
`AudioWorkletNode` with 8 inputs (`content.js:211`). The processor
(`worklets/wdrc.js`) runs an RMS detector per band and interpolates each
band's gain from an input/output curve — gain prescribed at 50/65/80 dB
program level, computed in `dsp.js:163` (`bandCurves`) for the selected
target (comfort/adult/child — see the [audiology doc](03-clinical-audiology.md)).
Detector time constants are user-selectable, fast/syllabic 5/80 ms vs.
slow 20/500 ms (`dsp.js:52`) — genuinely contested in the literature,
hence a toggle rather than a hardcode.

**The limiter is the safety guarantee.** A look-ahead brickwall
(`worklets/limiter.js`): delays audio a few ms, so gain reduction is in
place *before* a peak arrives — a −1 dBFS ceiling that is sample-accurate,
unlike `DynamicsCompressorNode`'s reactive attack. It is the LAST node
before `destination` and master volume sits BEFORE it (`content.js:307`),
so no user setting can bypass it. Two hard rules in the processor: any
requested ceiling is clamped to −1 dBFS *or lower* (child mode lowers it
to −7; a fresh loudness anchor can only *tighten* either ceiling further,
never relax it; nothing can raise it, `worklets/limiter.js:29`), and it
meters its own output over a port message (mean-square + interval) that
feeds the popup's level/dose estimate (`content.js:144`). Below the
static ceiling sits a **transient guard**: a slew-rate-limited program-
level tracker that caps sudden peaks ≥ 15 dB above the recent level (a
movie explosion after quiet dialog) at up to 10 dB below the ceiling,
relaxing at 30 dB/s once the level proves sustained — it only lowers
what the gain computer targets; the sample-accurate clamp is untouched
(`worklets/limiter.js:36-39`).

**Parameter smoothing.** Jumping a gain value causes a click ("zipper
noise"). `AudioParam.setTargetAtTime(value, now, timeConstant)` moves it
exponentially instead (`content.js:122`).

**Autoplay policy.** Contexts start `suspended` until a user gesture;
`content.js:322` resumes on `play` and on first click.

**Channel-count subtleties.** A mono stream entering a splitter comes out
as left-only. The fix is a `GainNode` with `channelCount: 2,
channelCountMode: "explicit"` forcing an upmix before the split
(`content.js:281`) — discovered here the hard way when mono videos went
silent in one ear.

## The full graph

```
<video> ─ MediaElementSource ─ upmix(GainNode, forced stereo) ─ ChannelSplitter
  ├─ ch0 (L): LR4 crossover (8 bands) ─▶ WDRC worklet (8-in, RMS + I/O curves) ─┐
  └─ ch1 (R): same, right-ear curves                                            ├─ ChannelMerger
                                                                                ↓
                 masterGain ─▶ limiter worklet (look-ahead, ≤ −1 dBFS, meters) ─▶ destination
```

Bypass mode reconnects the source directly to `masterGain`
(`content.js:79`). If `audioWorklet.addModule` fails, `buildLegacyGraph`
(`content.js:231`) substitutes per-band `DynamicsCompressorNode`s (the I/O
curves folded back into threshold/ratio terms) and a −3 dB/20:1 compressor
as limiter — not a true brickwall, so the popup shows "⚠ fallback limiter"
whenever this graph is carrying audio (`content.js:185`).

## The chain is held to a written spec

Since 2026-07 the reference chain (crossover → WDRC → limiter in an
`OfflineAudioContext` at 48 kHz) is checked against the
software-assessable criteria of ANSI/CTA-2051, the PSAP performance
standard — not as a conformance claim (the standard measures
microphone-to-coupler acoustics that software cannot warrant), but as
digital-domain equivalents with pass thresholds. The tests themselves
(`tests/test.js`, 32 checks) plus the disclosure paragraphs in
`DOCUMENTATION.md` are the in-repo record of that alignment; the
standard's text is copyrighted, so it is cited, never reproduced. The
tests that landed with this work, and the measurement lessons they
encode:

- **T8 (distortion, §5.4)** asserts **residual THD+N**, not harmonic-bin
  THD: subtract the fundamental from the steady output and everything
  left counts. Harmonic bins alone would miss the *non-harmonic*
  modulation sidebands the WDRC's per-block gain updates produce — the
  one distortion mechanism most characteristic of this chain. Worst
  moderate-level point 0.009%; 3.2% with the limiter fully engaged at
  maximum steady output, against the 5% criterion.
- **T9 (response smoothness, §5.2)** uses the standard's own statistic —
  each 1/3-octave band vs. the mean of its neighbors ⅔ octave to either
  side, ≤ 12 dB — because the obvious max-minus-global-mean substitute
  flags prescription slope the standard permits and can miss a local
  resonance riding on one. A smooth ski-slope prescription passes on its
  own terms (max local prominence 3.7 dB).
- **T10 (self-noise, §5.5)** renders digital silence through the
  highest-gain fitting and asserts < −68 dBFS RMS out — identically zero
  in fact, since the chain has no noise sources or dither; the test
  exists so that stays true.
- **T11 (HF gain, §5.6)** measures the average insertion gain at
  1.0/1.6/2.5 kHz and requires it to match the 35 dB figure published in
  `DOCUMENTATION.md` within ±1 dB — documentation as a tested claim.

## Pitfalls learned here

- `createMediaElementSource` throws if the element is already captured
  (another extension, a previous context). Guard it, remember the element,
  and *don't retry* on every DOM mutation (`content.js:266`).
- SPAs replace their `<video>`; each replacement needs a fresh context
  (`ctx.close()` then rebuild, `content.js:262`).
- The BiquadFilterNode Q-in-dB behavior above — verify any filter math
  against an `OfflineAudioContext` render, never trust node docs alone.
- Worklet files load with `audioWorklet.addModule(chrome.runtime.getURL(…))`
  from a content script, which requires `web_accessible_resources` in the
  manifest — and can still fail, so a fallback graph is not optional.
- Worklet modules can't `import`; shared constants (speeds, ceilings) are
  duplicated into the processor files and must be kept in sync by hand.
- `postMessage` to a worklet can lose the race against a fast
  `OfflineAudioContext` render — both worklets therefore also accept
  their full settings at construction via `processorOptions` (the
  limiter's `ceilingDb`; the WDRC's curves/refDb/speed, added during the
  CTA-2051 test work), which `tests/test.js` relies on for determinism.
- Headless Chrome's `--virtual-time-budget` cuts off pending
  `OfflineAudioContext` renders: synchronous tests report, async ones
  silently never finish. The harness (`tests/serve.py`) runs Chrome
  headless in the background and polls for the posted `results.json`.

## Further research

- MDN overview: https://developer.mozilla.org/docs/Web/API/Web_Audio_API
- The spec (unusually readable): https://webaudio.github.io/web-audio-api/
- The RBJ "Audio EQ Cookbook" — the coefficient formulas `dsp.js` encodes.
- ANSI/CTA-2051-A (PSAP performance criteria) — the engineering targets
  behind T8–T11; obtain it from CTA, the text is copyrighted.
- Search terms: "Linkwitz-Riley crossover", "audio worklet processor",
  "look-ahead limiter design", "wide dynamic range compression attack
  release", "offline audio context testing", "THD+N residual
  measurement", "1/3 octave analysis".
