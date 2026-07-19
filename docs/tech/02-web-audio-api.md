# Web Audio API

Part of the [technology study map](../../TECHNOLOGIES.md).

## What it is

The browser's built-in DSP engine. You construct a *graph* of audio nodes —
sources, filters, compressors, gains — connect them once, and the graph then
runs on a dedicated real-time audio thread. JavaScript never touches audio
samples here; it only wires and parameterizes nodes. That split (config on
the main thread, processing on the audio thread) is the single most
important mental model, and `content.js:8` states it as a comment for
Python-minded readers.

## Core concepts

**Nodes used in this project, and why:**

| Node | Role here |
|------|-----------|
| `AudioContext` | The graph's container and clock. One per wired video. |
| `MediaElementAudioSourceNode` | Captures a `<video>`'s audio into the graph. **One per element, ever.** |
| `GainNode` | Volume as a linear multiplier; also used as a channel-forcing pass-through and as per-band makeup gain. |
| `ChannelSplitterNode` / `ChannelMergerNode` | Break stereo into per-ear mono chains and reassemble. |
| `BiquadFilterNode` (bandpass) | One per band per ear — the filterbank. |
| `DynamicsCompressorNode` | Twice: per-band WDRC, and the master limiter. |

**Decibels vs. linear gain.** Audio nodes take linear multipliers; humans
and audiograms speak dB. The conversion is `10^(dB/20)` (`content.js:74`).
20, not 10, because amplitude squares into power.

**Biquad Q and bandwidth.** A bandpass biquad is defined by center
frequency and Q (center ÷ bandwidth). Because the 8 clinical bands are not
evenly spaced (octaves plus 3k and 6k), each band computes its own Q from
the *geometric means* to its neighbors (`content.js:19`) so the filters
overlap evenly. Geometric, not arithmetic, because frequency perception is
logarithmic.

**Filterbanks don't reconstruct flat.** Summing overlapping bandpass
outputs does not reproduce the input — phase interactions ripple the
spectrum. Consequence: "disable" cannot mean "set gains to 1"; it must
route *around* the bank entirely (true bypass, `content.js:93`).

**Dynamics compression.** A compressor reduces gain above a threshold, by
`ratio`, softened over `knee` dB, reacting with `attack`/`release` time
constants. Two very different uses here:
- *WDRC per band*: gentle ratio that grows with hearing loss
  (`ratio = 1 + loss/40`), threshold −35, slow-ish attack — this is the
  "quiet sounds boosted more than loud sounds" behavior.
- *Limiter*: threshold −3 dB, ratio 20:1, zero knee, 1 ms attack — a brick
  wall. Safety, not tone shaping (`content.js:171`).

**Parameter smoothing.** Jumping a gain value causes a click ("zipper
noise"). `AudioParam.setTargetAtTime(value, now, timeConstant)` moves it
exponentially instead (`content.js:109`).

**Autoplay policy.** Contexts start `suspended` until a user gesture;
`content.js:180` resumes on `play` and on first click.

**Channel-count subtleties.** A mono stream entering a splitter comes out
as left-only. The fix is a `GainNode` with `channelCount: 2,
channelCountMode: "explicit"` forcing an upmix before the split
(`content.js:145`) — discovered here the hard way when mono videos went
silent in one ear.

## The full graph

```
<video> ─ MediaElementSource ─ upmix(GainNode, forced stereo) ─ ChannelSplitter
  ├─ ch0 (L): 8 × [bandpass → compressor → makeup gain] → earSum ─┐
  └─ ch1 (R): same, right-ear params                              ├─ ChannelMerger
                                                                  ↓
                                     limiter(−3 dB, 20:1) → masterGain → destination
```

Bypass mode reconnects the source directly to `masterGain`.

## Pitfalls learned here

- `createMediaElementSource` throws if the element is already captured
  (another extension, a previous context). Guard it, remember the element,
  and *don't retry* on every DOM mutation (`content.js:130`).
- SPAs replace their `<video>`; each replacement needs a fresh context
  (`ctx.close()` then rebuild, `content.js:127`).
- `DynamicsCompressorNode` is a black box (no side-chain, unspecified
  makeup behavior); for exacting work people use `AudioWorklet` — the next
  step up if this project ever outgrows the built-in node.

## Further research

- MDN overview: https://developer.mozilla.org/docs/Web/API/Web_Audio_API
- The spec (unusually readable): https://webaudio.github.io/web-audio-api/
- Search terms: "biquad filter cookbook" (the RBJ cookbook), "audio worklet",
  "dynamics compressor attack release", "equal-loudness contour".
