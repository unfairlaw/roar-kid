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
<video> ─ MediaElementSource ─ ChannelSplitter
   ├─ L: [250 500 1k 2k 3k 4k 6k 8k]  bandpass → compressor → makeup gain → Σ
   └─ R: same, right-ear audiogram
        └────────── ChannelMerger → limiter (−3 dB, 20:1) → volume → out
```

Fitting rule (v0, deliberately conservative):
- makeup gain = `0.45 × threshold(dB HL)` (half-gain-ish rule)
- compression ratio = `1 + loss/40` (recruitment compensation)
- hard output limiter always on (child safety)

## Roadmap

- [ ] Proper crossover network (cascaded Linkwitz–Riley LP/HP instead of
      bandpass taps — flat reconstruction at unity)
- [ ] Real DSL v5.0 / NAL-NL2 gain targets (level-dependent, implemented as
      per-band input/output curves via WaveShaper or AudioWorklet)
- [ ] AudioWorklet port for tighter control + true RMS-based WDRC
- [ ] Import audiogram from photo of the clinical chart (this is where your
      ML background earns its keep)
- [ ] Firefox port (manifest tweaks only)

## Why not static EQ?

Hearing loss compresses the ear's dynamic range (recruitment): quiet sounds
need lots of gain, loud sounds almost none. Static EQ over-amplifies loud
passages. Level-dependent gain per band is what actual aids do — this is a
simplified version of that.

## Full documentation

See [DOCUMENTATION.md](DOCUMENTATION.md) for architecture, utilized resources,
audiological rationale, and privacy/safety posture.
