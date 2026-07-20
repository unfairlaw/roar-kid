# Roar, kid! — Audiogram-driven EQ for YouTube, Netflix & Prime Video

Open-source browser extension that applies **per-ear, multiband wide-dynamic-range
compression** to YouTube, Netflix, and Prime Video audio, driven by a real
audiogram. A listening
supplement for people with mild hearing loss. **Not a medical device, not a
hearing aid replacement** — especially not for children in classrooms.

## Install (dev mode)

1. `chrome://extensions` → enable **Developer mode**
2. **Load unpacked** → select this folder
3. Open YouTube, Netflix, or Prime Video, click the extension icon, plot
   thresholds on the audiogram
   (red O = right ear, blue X = left ear — the clinical convention), press play.

## Testing locally

1. `chrome://extensions` → **Developer mode** → **Load unpacked**. Load the
   `roar-kid-store/` folder for testing — it is the runtime-only copy, so it
   avoids the `__pycache__` directory Chrome rejects (`extract_audiogram.py`
   regenerates that folder in `roar-kid/` whenever Python runs it; delete it, or
   run the CLI with `python3 -B`, if you load `roar-kid/` instead).
2. After **any** code edit, click the ↻ reload icon on the extension card —
   Chrome does not hot-reload.
3. **Hear the effect:** use headphones (the whole point is per-ear). Open a
   video with clear treble/speech, plot an exaggerated lopsided loss (e.g.
   right ear 60–70 dB HL at 3k–8k, left ear flat), press play, and toggle the
   **on** switch. Off should sound identical to native YouTube; on should
   brighten the ear you marked as impaired.
4. Then plot the real audiogram — at true mild/moderate levels the effect is
   deliberately subtle.

**Troubleshooting**

- *No difference at all:* reload the **YouTube tab** (not just the video) after
  reloading the extension — a `<video>` already captured by the old context
  won't re-wire. Then click the page and press play; the AudioContext stays
  suspended until a user gesture.
- *Left/right feels swapped:* first rule out your own hardware. Play a
  hard-panned channel test — e.g.
  [Left/Right Stereo Test](https://www.youtube.com/watch?v=YwNs1Z0qRY0) — with
  the extension **off**. If the spoken "left/right" already comes out the wrong
  ears with the extension off, the swap is your system or headset (fix in the
  OS audio settings), not this extension. If off is correct but on swaps, it's
  the extension — file it.
- *Console:* popup/options errors show in each surface's own DevTools
  (right-click → Inspect); content-script errors show in the **YouTube tab's**
  console (F12).

## Architecture

```
<video> ─ MediaElementSource ─ upmix(2ch) ─ ChannelSplitter
   ├─ L: LR4 crossover [250 500 1k 2k 3k 4k 6k 8k] → WDRC AudioWorklet → ┐
   └─ R: same, right-ear audiogram                                       ├─
        ChannelMerger → volume → look-ahead brickwall limiter (worklet) → out
```

- **Crossover:** cascaded Linkwitz–Riley (LR4) with allpass phase
  compensation, built from explicit RBJ biquad coefficients on
  `IIRFilterNode` — the band sum is flat at unity (±1 dB asserted by
  `tests/`), so an all-zero audiogram is transparent.
- **WDRC:** an `AudioWorklet` per ear with a true RMS detector and per-band
  input/output curves (gain at 50/65/80 dB program level, interpolated).
- **Targets** (popup selector): `comfort` = the conservative v0 rule
  (gain `0.45 × threshold`, ratio `1 + loss/40`); `adult` = NAL-R-flavored;
  `child` = DSL-flavored (more gain, audibility first). The latter two are
  stated approximations, not the proprietary formulas.
- **Limiter:** look-ahead (3 ms) brickwall `AudioWorklet` with a
  sample-accurate hard ceiling at −1 dBFS, always on, last node in the
  graph — master volume sits *before* it, so nothing can bypass it. It also
  meters output for the popup's estimated listening-dose readout
  (ITU-T H.870 conservative-mode framing; estimate, not measurement).
- **Calibration** (options page): headphone-profile presets, a
  reference-tone loudness match, and import of a correction JSON measured
  by `calibrate_playback.py` with a cheap USB measurement mic. Without it,
  gains are relative, not absolute.

## Tests

```
python3 tests/serve.py 8471          # from the repo root
# open http://127.0.0.1:8471/tests/test.html
```

Covers: prescriptive-curve reference values, crossover+WDRC flatness at
unity (±1 dB, 100 Hz–12 kHz), level-dependence of the WDRC, and the
sample-accurate limiter ceiling under worst-case transients.

## Roadmap

- [x] Proper crossover network (cascaded Linkwitz–Riley — flat at unity)
- [x] Level-dependent per-band I/O curves via AudioWorklet + RMS detection
- [x] Look-ahead brickwall limiter (AudioWorklet, sample-accurate ceiling)
- [x] Import audiogram from photo of the clinical chart
- [x] Self-calibration (tone match, headphone profiles, mic correction)
- [ ] Firefox port (manifest key is in; needs real-world testing)
- [ ] Closer NAL-NL2 / DSL v5.0 target tables (current curves are
      first-order approximations)
- [ ] On-device CV/OCR extraction path (purpose-built, not LLM) as default
      where Chrome's built-in model is unavailable

## Why not static EQ?

Hearing loss compresses the ear's dynamic range (recruitment): quiet sounds
need lots of gain, loud sounds almost none. Static EQ over-amplifies loud
passages. Level-dependent gain per band is what actual aids do — this is a
simplified version of that.

## Full documentation

See [DOCUMENTATION.md](DOCUMENTATION.md) for architecture, utilized resources,
audiological rationale, and privacy/safety posture.
