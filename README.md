<div align="center">

<img src="roar-kid/icons/icon128.png" width="120" height="120" alt="Roar, kid! logo" />

# Roar, kid!

**Audiogram-driven, per-ear EQ for YouTube, Netflix, and Prime Video — a listening supplement for kids and adults with hearing loss.**

![Manifest V3](https://img.shields.io/badge/Manifest-V3-4c8bf5)
![Web Audio API](https://img.shields.io/badge/Web%20Audio-API-e8543f)
![No server](https://img.shields.io/badge/server-none-2e9b57)
![Not a medical device](https://img.shields.io/badge/not%20a-medical%20device-6b675c)
![License: MIT](https://img.shields.io/badge/license-MIT-2e9b57)

</div>

---

Roar, kid! shapes YouTube, Netflix, and Prime Video audio to a real
audiogram. Instead of a generic
equalizer, it applies **per-ear, per-frequency-band wide-dynamic-range
compression** modeled on how hearing aids amplify — quiet sounds boosted more,
loud sounds boosted less — with a hard output limiter that is always on.

Plot thresholds directly on an interactive audiogram drawn to clinical
conventions (red **O** = right ear, blue **X** = left ear), or import them from
a photo of a clinical report using your own AI-provider API key. Every imported
value is shown for review before it is applied, and every point stays editable.

> [!WARNING]
> **Not a medical device.** No diagnosis, and not a replacement for hearing
> aids or professional audiological care — especially for children. It is a
> listening supplement for mild-to-moderate loss.

## Features

- 🦁 **Interactive audiogram** — plot right/left thresholds the way an
  audiologist draws them, across the 8-frequency diagnostic standard
  (250, 500, 1k, 2k, 3k, 4k, 6k, 8k Hz).
- 🎚️ **Per-ear multiband WDRC** — a flat-summing Linkwitz–Riley crossover
  into eight bands per ear, compressed in an `AudioWorklet` with true RMS
  detection and per-band input/output curves driven by the plotted
  thresholds. Three selectable gain rules: conservative **comfort**, plus
  NAL-flavored **adult** and DSL-flavored **child** approximations.
- 🛡️ **Always-on brickwall limiter** — a look-ahead `AudioWorklet` limiter
  with a sample-accurate −1 dBFS ceiling, last node in the graph so nothing
  bypasses it, feeding an estimated listening-dose readout (ITU-T H.870
  conservative framing). Non-negotiable child safety.
- 🎧 **Optional calibration** — headphone presets, a reference-tone loudness
  match, and import of a correction curve measured with a cheap USB mic via
  `calibrate_playback.py`. Without it, gains are relative, not absolute.
- 📷 **Import from a photo** — extract thresholds from a clinical report:
  fully on-device via Chrome's built-in AI where supported (no key, the photo
  never leaves your machine — best on printed threshold tables), or with your
  own OpenAI / Anthropic / Gemini / Grok key; values are reviewed before
  applying.
- 🔒 **No server, no analytics** — thresholds live in your browser; the photo
  (if you use import) goes only to the provider you pick, under your own key.

## How it works

```
<video> ─ MediaElementSource ─ upmix ─ ChannelSplitter
   ├─ L: LR4 crossover [250 500 1k 2k 3k 4k 6k 8k] → WDRC worklet ─┐
   └─ R: same, driven by the right-ear audiogram                   ├─
        ChannelMerger → volume → look-ahead brickwall limiter → out
```

Default fitting rule ("comfort", deliberately conservative):

- gain at 65 dB program level = `0.45 × threshold(dB HL)` (half-gain-ish rule)
- compression ratio = `1 + loss/40` (recruitment compensation)

The `adult` / `child` selections apply NAL- and DSL-flavored approximations
instead (documented as approximations — the real prescriptive formulas
remain on the roadmap). A browser test harness in [`tests/`](tests/) checks
crossover flatness at unity, WDRC level-dependence, and the limiter ceiling.

Why not a static EQ? Hearing loss compresses the ear's dynamic range
(recruitment): quiet sounds need lots of gain, loud sounds almost none. Static
EQ over-amplifies loud passages; level-dependent gain per band is what real aids
do — this is a simplified version of that.

Full rationale, band math, and the 8-frequency (ASHA) basis are in
[`roar-kid/DOCUMENTATION.md`](roar-kid/DOCUMENTATION.md). For a study map of
every technology in the project — Web Audio, the audiology, the AI import,
the tooling — see [`TECHNOLOGIES.md`](TECHNOLOGIES.md) and its twelve
deep-dives in [`docs/tech/`](docs/tech/).

## Install

**From source (developer mode):**

1. `chrome://extensions` → enable **Developer mode**
2. **Load unpacked** → select the [`roar-kid-store/`](roar-kid-store/) folder
3. Open YouTube, Netflix, or Prime Video, click the icon, plot thresholds,
   press play.

Detailed local-testing steps and L/R troubleshooting are in
[`roar-kid/README.md`](roar-kid/README.md#testing-locally).

## Repository layout

| Path | What it is |
|------|-----------|
| [`roar-kid-store/`](roar-kid-store/) | **The shippable extension** — runtime files only. Load/upload this. |
| [`roar-kid/`](roar-kid/) | Dev copy + docs + the standalone Python extraction CLI. |
| [`icons-preview/`](icons-preview/) | Icon generators and the synthetic test audiogram. |
| [`TECHNOLOGIES.md`](TECHNOLOGIES.md) + [`docs/tech/`](docs/tech/) | Study map: one deep-dive doc per technology used in the project. |
| `roar-kid-store.zip` | Packaged extension for the Chrome Web Store. |

## Packaging & release

Which zip to upload, how to rebuild it, and the privacy-policy hosting step are
documented in [`PACKAGING.md`](PACKAGING.md). Short version: upload
**`roar-kid-store.zip`**.

## Privacy

Thresholds and preferences are stored in your browser (`chrome.storage.sync`);
API keys stay device-only (`chrome.storage.local`). Nothing is transmitted
during normal listening. See [`roar-kid/PRIVACY_POLICY.md`](roar-kid/PRIVACY_POLICY.md).

## Support

Roar, kid! is free, open source, and has no server costs passed on to anyone —
but if it helps someone in your life hear their cartoons better and you'd like
to say thanks:

<a href="https://buymeacoffee.com/guilherme.burzynski"><img src="https://img.shields.io/badge/Buy%20me%20a%20coffee-☕-ffdd00?labelColor=22211d" alt="Buy me a coffee" /></a>

## License

[MIT](LICENSE) — free to use, modify, and share. The "not a medical device"
disclaimer above still applies to anything you build from it.
