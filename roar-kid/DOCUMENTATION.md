# Roar, kid! — Project Documentation

Roar, kid! is an open-source Chrome extension that applies audiogram-driven,
per-ear multiband compression to YouTube audio, intended as a listening
supplement for people with mild hearing loss. It is not a medical device and
does not replace hearing aids; for a child it is explicitly a complement to
professional aiding, not an alternative to it. This document describes the
architecture, every external resource and API the project relies on, the
audiological rationale behind the signal processing, and the current
limitations.

## Repository layout

`manifest.json` declares the Manifest V3 extension, its permissions, and
its entry points (a `browser_specific_settings.gecko` key is present for
the Firefox port). `dsp.js` is the shared DSP module — crossover builder,
prescriptive curves, calibration math — loaded ahead of `content.js`, the
content script that owns the audio processing graph. `worklets/wdrc.js`
and `worklets/limiter.js` are the AudioWorklet processors (per-ear WDRC and
the brickwall limiter). `popup.html`/`popup.js` implement the toolbar
popup, whose centerpiece is an interactive clinical audiogram chart.
`options.html`/`options.js` implement the settings page: bring-your-own-key
(BYOK) credential storage, AI-assisted import of audiogram photos, and
calibration. `extract_audiogram.py` is an optional Python command-line
equivalent of the photo import, built on LangChain; `calibrate_playback.py`
is the measurement-mic calibration utility. The repository-level `tests/`
directory holds the browser DSP test harness. `README.md` gives the short
install-and-run version of this document.

## Signal processing architecture

The content script locates the site's `<video>` element and routes it
through a Web Audio API graph. The signal enters via
`MediaElementAudioSourceNode`, is forced to stereo by an explicit upmix
`GainNode` (so mono sources reach both ears), and is split into left and
right channels with a `ChannelSplitterNode`; each ear is processed
independently against its own audiogram.

Per ear, the signal passes through a cascaded Linkwitz–Riley (LR4)
crossover that splits it into eight bands centered at the standard
diagnostic audiometric frequencies of 250, 500, 1000, 2000, 3000, 4000,
6000, and 8000 Hz (the ASHA 8-frequency set — 3 and 6 kHz sit in the
speech-critical region weighted most heavily by the Speech Intelligibility
Index). Crossover points sit at the geometric means between adjacent bands.
Each LR4 filter is two cascaded second-order Butterworth sections built
from explicit RBJ-cookbook coefficients on `IIRFilterNode` — deliberately
not `BiquadFilterNode`, whose lowpass/highpass Q is interpreted in dB with
implementation-specific designs that break the LP²+HP²=allpass identity the
crossover depends on. Every finished band is phase-compensated through
matching allpass sections for all later crossovers, which is what makes the
band sum flat at unity: an all-zero audiogram is acoustically transparent
(±1 dB from 100 Hz to 12 kHz, asserted by the test harness in `tests/`).

The eight bands feed a per-ear WDRC `AudioWorklet` (`worklets/wdrc.js`)
with a true RMS level detector (5 ms attack, 80 ms release) and an explicit
per-band input/output curve: gain in dB defined at 50, 65, and 80 dB
program level, linearly interpolated between the control points and held
constant outside them. Program level is detected RMS dBFS plus a documented
full-scale-to-SPL assumption (100 dB; see Calibration below). Gain
decisions are made once per 128-sample block and smoothed per sample
(~10 ms) against zipper noise.

The ears are reassembled by a `ChannelMergerNode`, pass through the master
volume `GainNode`, and then through the final node in every configuration:
a look-ahead brickwall limiter `AudioWorklet` (`worklets/limiter.js`). It
delays the signal by 3 ms while its gain computer reads the incoming
samples, so reduction is in place before a transient reaches the output,
and it hard-clamps the result to the −1 dBFS ceiling as a sample-accurate
guarantee — the test harness asserts that no output sample exceeds the
ceiling under worst-case input. Master volume sits *before* the limiter on
purpose: no gain stage anywhere in the graph can push output past the
ceiling. The limiter is always active and is a safety requirement, not a
feature. If AudioWorklet modules cannot load, the script falls back to the
previous `DynamicsCompressorNode` graph (same crossover, compressor-based
limiting): degraded, never unlimited.

The limiter also meters its own output. The content script converts the
metered level into an estimated listening dose using the conservative mode
of Recommendation ITU-T H.870 (100% weekly dose = 75 dBA for 40 h) under
the stated full-scale assumption, and the popup shows the running figure.
It is an assumption-based estimate, clearly labeled as such — not a
measurement, and no substitute for keeping device volume moderate.

The reason the design uses multiband compression rather than static
parametric EQ is loudness recruitment: a compressed usable dynamic range
means quiet sounds need substantial gain while loud sounds need little or
none. Static EQ derived from an audiogram over-amplifies loud passages.
Level-dependent gain per frequency band — wide dynamic range compression
(WDRC) — is what actual hearing aids implement, and Roar, kid!
approximates a simplified version of it.

### Prescriptive targets

The popup offers three rules for turning thresholds into per-band I/O
curves. **comfort** is the conservative v0 rule: gain at 65 dB program
level is 0.45 × threshold (a variant of the classical half-gain rule) and
the compression ratio grows with loss as 1 + loss/40, so a 0 dB HL band
stays transparent at 1:1 while a 40 dB HL band is compressed at 2:1.
**adult** is an NAL-R-flavored rule (0.15 × three-frequency average +
0.31 × threshold + per-band corrections, gentler ratios). **child** is a
DSL-flavored rule prescribing more gain at every band (0.6 × threshold,
slightly stronger compression), reflecting the pediatric literature's
audibility-first stance — published comparisons put DSL 6–25 dB above NAL
for children's losses. Both named targets are explicitly *approximations
inspired by* NAL and DSL; the genuine NAL-NL2 and DSL v5.0 formulas are
proprietary, level-and-age-dependent, and remain on the roadmap. The ratio
is unfolded into the three curve points as a gain slope of (1 − 1/ratio) dB
per input dB around the 65 dB pivot; per-band gain is capped at 35 dB
before the limiter ever gets involved. Thresholds are clamped to the −10 to
70 dB HL range because the project scopes itself to mild-to-moderate loss.

### Calibration

Gain in a browser is applied to the digital signal; what reaches the ear
depends on the headphone's frequency response, its fit, and system volume,
none of which a web page can know. The options page therefore offers a
two-tier, fully optional calibration, and the documentation is explicit
about the limits of each. Tier 1 is *relative*: a generic headphone-profile
preset (clearly labeled as average shapes, not measurements) plus a
reference-tone loudness match — the 1 kHz tone is the anchor and the user
adjusts each band's tone until it sounds equally loud, producing per-band
offsets. Tier 2 is *assisted-absolute in shape*: `calibrate_playback.py`
plays each band's tone through the user's actual chain, records it with a
cheap USB measurement microphone, computes the response relative to 1 kHz,
and writes a correction JSON the options page imports. All correction
offsets are clamped to ±12 dB and folded into the band curves. Neither tier
is clinical probe-microphone verification, and the docs say so; without
calibration, gains are internally consistent but not absolute.

Because YouTube is a single-page application, the content script watches the
DOM with a `MutationObserver` and rebuilds the audio context when the video
element is replaced, since a media element can only ever be bound to one
`MediaElementAudioSourceNode`. Browser autoplay policy requires a user
gesture before an `AudioContext` may run, so the script resumes the context
on the first play event or click.

## User interface

The popup renders a clinical audiogram on a `<canvas>`, drawn to the
conventions an audiologist uses: frequency on the horizontal axis from
250 Hz to 8 kHz, hearing level on an inverted vertical axis so that worse
hearing plots lower, the quiet zone (−10 to 15 dB HL, where no boost is
applied) shaded, the right ear plotted as red O symbols and the left ear as
blue X symbols. This is intentional — the chart the clinic hands a parent
can be copied onto the popup point by point without translation. Thresholds
are entered by tapping or dragging on the chart and snap to the clinical
5 dB grid. The popup also carries an ear selector, the prescriptive-target
selector (comfort / adult / child), a master volume slider, an enable
toggle, and the estimated level/dose readout described above. Settings
persist through `chrome.storage.sync` and the content script applies
changes live via the `storage.onChanged` listener.

The options page holds the BYOK key fields, the photo import flow, and the
calibration section. Extracted thresholds are never applied silently: they
are displayed in a review table, screened by a plausibility check that
flags patterns associated with model misreads (left/right asymmetry over
40 dB at any band, steep jumps over 30 dB between adjacent bands, a
perfectly flat identical read), and applied only after the user ticks an
explicit "I compared every value against the paper report" confirmation —
the Apply button stays disabled until then, and the confirmation resets on
every new extraction. Values remain editable on the popup chart afterwards.
This un-skippable human-in-the-loop step exists because the recent
LLM-audiogram literature documents hallucination rates of 4–24% including
fabricated thresholds, and multimodal models are measurably weaker at
reading a symbol's position between gridlines than at reading printed
numbers — extraction is a proposal, never a result.

## AI-assisted audiogram import

On-device extraction is the default path: when Chrome's built-in model is
available, the Extract button uses it and the photo never leaves the
machine. A cloud provider runs only when the user has supplied that
provider's key *and* ticked a per-import consent checkbox acknowledging
that the image leaves the device; the checkbox does not persist across
imports. This is the medical-image posture the privacy section commits to,
applied mechanically in the UI.

Both the options page and the Python CLI implement the same extraction task:
given a photo of a clinical audiogram report, return the sixteen thresholds
(eight per ear) as strictly structured JSON, prefer a printed numeric table
over reading plotted symbols when one exists, report which source was used,
flag anything ambiguous in a confidence note, and ignore all
patient-identifying information. All providers are called at temperature 0.
A fixed seed of 22 is passed where the provider supports one — OpenAI and
Grok via the `seed` field of the Chat Completions protocol, Gemini via
`generationConfig.seed`. The Anthropic Messages API exposes no seed
parameter and documents that even temperature 0 is not fully deterministic,
so for that provider reproducibility rests on the schema alone. In practice
the determinism that matters comes from validation rather than sampling:
every extracted value is clamped to −10..70 dB HL and snapped to the 5 dB
clinical grid, which collapses small sampler jitter into identical results.

Structured output uses each provider's native mechanism. OpenAI and Grok
receive `response_format` of type `json_schema` with `strict: true`; Grok is
reached through its OpenAI-compatible endpoint at `api.x.ai`. Anthropic is
forced through a tool call (`tool_choice` targeting a single tool whose
`input_schema` is the audiogram schema), which is the Messages API's
schema-guarantee mechanism, and direct browser calls additionally require
the `anthropic-dangerous-direct-browser-access: true` header. Gemini
receives `responseSchema` with `responseMimeType: application/json` on the
`generateContent` endpoint. High-resolution image ingestion is requested
where a knob exists (`detail: "high"` on the OpenAI protocol); Anthropic and
Gemini ingest the image at native resolution.

The Python CLI (`extract_audiogram.py`) reaches the same four providers
through LangChain's `init_chat_model` with `with_structured_output` bound to
a Pydantic schema, whose field validator performs the same clamp-and-snap.
It reads keys from the standard environment variables (`OPENAI_API_KEY`,
`ANTHROPIC_API_KEY`, `GOOGLE_API_KEY`, `XAI_API_KEY`) and emits JSON
compatible with the extension's storage schema.

## Utilized resources

Platform APIs. The Web Audio API supplies the entire DSP layer:
`AudioContext`, `MediaElementAudioSourceNode`, `BiquadFilterNode`,
`DynamicsCompressorNode`, `GainNode`, `ChannelSplitterNode`, and
`ChannelMergerNode`, documented at
https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API. Chrome
Extensions Manifest V3 provides the packaging and lifecycle model
(https://developer.chrome.com/docs/extensions), with `chrome.storage.sync`
for settings, `chrome.storage.local` for API keys, content scripts for page
injection, and `host_permissions` to authorize cross-origin calls to the
provider APIs. The Canvas 2D API and Pointer Events drive the audiogram
editor.

Provider APIs. OpenAI Chat Completions
(https://platform.openai.com/docs/api-reference/chat) with structured
outputs, seed, and image detail; Anthropic Messages API
(https://docs.claude.com/en/api/overview) with tool-forced structured
output and the CORS opt-in header; Google Gemini `generateContent`
(https://ai.google.dev/api) with response schemas and seeded generation;
xAI Grok through its OpenAI-compatible interface (https://docs.x.ai). The
Python path adds LangChain (https://python.langchain.com) and Pydantic
(https://docs.pydantic.dev).

Audiological grounding. The audiogram plotting conventions (frequencies,
inverted dB HL axis, red O / blue X symbology) follow standard clinical
audiometry practice as described in ASHA's guidance on the audiogram
(https://www.asha.org). The compression rationale draws on the WDRC and
loudness-recruitment literature summarized in standard references such as
Dillon, *Hearing Aids* (Thieme), and the half-gain rule tracing to
Lybarger's fitting work. The prescriptive formulas the roadmap targets are
DSL v5.0 (developed at the National Centre for Audiology, Western
University; https://www.dslio.com) and NAL-NL2 (National Acoustic
Laboratories; https://www.nal.gov.au).

## Privacy and safety posture

API keys are stored exclusively in `chrome.storage.local`, which is bound to
the device and never synced, and are transmitted only to the provider the
user selects. Audiogram photos are a child's medical record: extraction is
on-device by default, any cloud call requires explicit per-import consent,
the UI instructs users to crop identifying information before upload, and
the extraction prompt instructs the model to ignore any that remains. The
output limiter cannot be disabled and is the last node in the graph. The
project frames itself as a personal audio comfort EQ and a listening
supplement — it makes no diagnostic or treatment claims — and the popup
footer repeats that framing where a parent will actually read it.

## Known limitations and roadmap

Calibration remains the fundamental limitation: even with the tone match
and mic correction, the software cannot know true SPL at the eardrum, and
the dose readout inherits the same assumption — everything downstream of
that is an estimate. The adult/child targets are first-order approximations
of NAL/DSL, not the real formulas; closer target tables are the main
remaining DSP milestone. The dose model uses an unweighted level under the
full-scale assumption rather than a true A-weighted measurement. Extraction
accuracy on symbol-only charts (no numeric table) is the weakest AI step
and is mitigated, not solved, by the plausibility screen and un-skippable
review; a purpose-built on-device CV/OCR path (numeric-table OCR plus
symbol detection), which the digitizer literature puts at ~1.3 dB mean
absolute error, is the planned default for machines without Chrome's
built-in model. The Firefox manifest key is in place but the port is
untested in practice. A per-provider key validity test and import of the
numeric JSON produced by the Python CLI directly into the options page
round out the near-term list.
