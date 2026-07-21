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
with a true RMS level detector and an explicit per-band input/output
curve: gain in dB defined at 50, 65, and 80 dB program level, linearly
interpolated between the control points and held constant outside them.
The detector's time constants are a user-visible choice in the popup, not
a buried constant, because fast-versus-slow compression is a genuinely
contested parameter in the WDRC literature: **fast** (5 ms attack / 80 ms
release) tracks syllable-level dips, **slow** (20 ms / 500 ms) rides the
longer-term envelope and preserves more of the signal's own dynamics.
Program level is detected RMS dBFS plus the reference mapping — the
per-device loudness anchor when one exists, otherwise a documented
default assumption (100 dB SPL at full scale; see Calibration below).
Gain decisions are made once per 128-sample block and smoothed per sample
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
feature. Its ceiling is adjustable in one direction only: a construction
option or port message can *lower* it (the attestation-gated child target
runs at −7 dBFS, or lower still when a fresh loudness anchor allows an
anchor-derived ceiling — see below) but any request above −1 dBFS is
clamped — the guarantee is structural, and the harness asserts a raise
attempt has no effect.

On top of the static ceiling the limiter runs a **transient guard** for
sudden loud events — a movie explosion landing after quiet dialogue. A
slew-rate-limited tracker follows the running program level in dB, and
any incoming peak more than 15 dB above it (speech's own ~12 dB crest
factor stays untouched) is capped mid-event, at most 10 dB below the
static ceiling — the same fast-versus-slow-envelope mechanism and
attenuation range commercial hearing-aid impulse-noise reduction uses.
The cap relaxes at 30 dB/s once the level proves sustained, because
sustained loudness is the static ceiling's and the dose model's domain,
not the guard's; the tracker's dB slew limit (rather than an exponential
envelope, which would re-open within milliseconds against a full-scale
event) is what makes the cap actually hold through an event's onset. The
guard only lowers what the gain computer aims for — the sample-accurate
hard clamp stays at the static ceiling, so the structural guarantee is
unchanged. When a fresh anchor exists, the adult static ceiling is
additionally bounded where the anchored mapping puts 102 dB SPL peaks, a
target chosen from the loudness-discomfort literature for losses inside
this tool's ≤70 dB HL scope (normative UCLs cluster at 100–105 dB SPL;
the FDA's OTC hearing-aid rule hard-caps output at 111 dB SPL) — under
the standard anchor this resolves above −1 dBFS and is a no-op, and like
the child derivation it can only ever tighten. If
AudioWorklet modules cannot load, the script falls back to the previous
`DynamicsCompressorNode` graph (same crossover, compressor-based
limiting): degraded, never unlimited — and the popup surfaces a visible
"fallback limiter" indicator whenever that weakened path is the one
carrying audio.

The limiter also meters its own output. When — and only when — a loudness
anchor exists for the current output device, the content script converts
the metered level into an estimated listening dose using the conservative
mode of Recommendation ITU-T H.870 (100% weekly dose = 75 dBA for 40 h),
and the popup shows the running figure, marked as an estimate. Because
the dose is a weekly quantity, it is persisted in `chrome.storage.local`
in fixed 7-day blocks rather than resetting per page load: tabs flush
their accrued increment every few seconds read-modify-write, so
concurrent tabs accumulate into one figure, and the block rolls over
weekly. The popup readout escalates as the figure grows — at 80% of the
weekly reference it flags "nearing the weekly reference", and at 100% it
switches to an emphasized "over the weekly reference" warning — instead
of remaining a passive number. Without an anchor the system is honest
about being *relative*: the popup shows "relative — no anchor" instead of
a number, because an authoritative-looking level derived from an
unmeasured assumption can be wrong by 10–20 dB across laptop/headphone
combinations. If the machine's output devices change after anchoring, the
readout is flagged stale until the anchor is redone. None of this is a
substitute for keeping device volume moderate.

The end-to-end processing latency of the full chain — crossover group
delay, WDRC block processing, and the limiter's 3 ms look-ahead — is
measured by the test harness at ~3.3 ms (energy centroid of the impulse
response at 48 kHz), comfortably inside the ITU lip-sync detectability
budget for streaming video; there is no live-microphone path, so latency,
not feedback, is the only timing concern. That offline figure is
cross-checked against a real, playing `<video>` element: the harness's T7
plays a synthetic clip through the actual production graph and through an
unprocessed baseline in a live AudioContext, using
`requestVideoFrameCallback` and `getOutputTimestamp` to compare each
against genuine video-frame display timing, and asserts the processing-
added delta — not just the synthetic impulse response — stays inside the
same lip-sync budget.

The reason the design uses multiband compression rather than static
parametric EQ is loudness recruitment: a compressed usable dynamic range
means quiet sounds need substantial gain while loud sounds need little or
none. Static EQ derived from an audiogram over-amplifies loud passages.
Level-dependent gain per frequency band — wide dynamic range compression
(WDRC) — is what actual hearing aids implement, and Roar, kid!
approximates a simplified version of it.

### Prescriptive targets

The popup offers three rules for turning thresholds into per-band I/O
curves. **comfort** is the conservative v0 rule and the first-run
default: gain at 65 dB program level is 0.45 × threshold (a variant of
the classical half-gain rule) and the compression ratio grows with loss
as 1 + loss/40, so a 0 dB HL band stays transparent at 1:1 while a
40 dB HL band is compressed at 2:1. **adult** is an NAL-R-flavored rule
(0.15 × three-frequency average + 0.31 × threshold + per-band
corrections, gentler ratios); the popup labels it "approximate — not
NAL-NL2" right where the choice is made, because an approximation is
acceptable only when disclosed where the user sees it. **child** is a
DSL-flavored rule prescribing more gain at every band (0.6 × threshold,
slightly stronger compression), reflecting the pediatric literature's
audibility-first stance — published comparisons put DSL 6–25 dB above NAL
for children's losses.

The child target is **locked by default**. FDA and professional-body
guidance is unambiguous that self-fit amplification is designed and
validated for adults: pediatric fitting depends on measured
real-ear-to-coupler differences this tool cannot obtain, and a child's
smaller ear canal receives higher SPL from the same signal. The target
unlocks only through an explicit attestation on the options page — "an
audiologist has reviewed this child's audiogram and verified these
settings for this child" — and, when active, the output ceiling drops
from −1 to −7 dBFS (the limiter clamps any request so the ceiling can
only ever be lowered). When a fresh (non-stale) loudness anchor exists,
the child ceiling is derived from it instead: peaks are capped where the
anchored mapping puts 85 dB SPL (`childCeilingDb`, ≈ −9 dBFS under the
standard anchor), and the derivation can only *tighten* the fixed
−7 dBFS ceiling, never relax it. The popup then shows "≈85 dB peak cap"
with the honest caveat that the cap is only meaningful at the system
volume the anchor was set at — changing system volume shifts the real
level, which is why this is a mitigation, not a guarantee. Without the
attestation, a stored "child" selection behaves as comfort and the popup
shows what is actually applied.

Both named targets are explicitly *approximations inspired by* NAL and
DSL; the genuine NAL-NL2 and DSL v5.0 formulas are proprietary,
level-and-age-dependent, and remain on the roadmap. The test harness
compares the adult target against independently computed NAL-R reference
points (±3 dB on a sloping mild-moderate audiogram) and the child target
against its stated DSL-flavored reference points. The ratio is unfolded
into the three curve points as a gain slope of (1 − 1/ratio) dB per input
dB around the 65 dB pivot. Per-band gain is capped at 35 dB and
thresholds are clamped to the −10 to 70 dB HL range: these are *scope*
limits that keep the tool inside its intended mild-to-moderate range, not
safety guarantees — the limiter is the safety guarantee.

### Calibration

Gain in a browser is applied to the digital signal; what reaches the ear
depends on the headphone's frequency response, its fit, and system volume,
none of which a web page can know. The project splits the problem into
absolute level and response shape, and treats them separately.

**Absolute level — the loudness anchor.** The single largest source of
error is the mapping from digital full scale to SPL at the ear, which
varies 10–20 dB across hardware. Instead of trusting one global constant,
the options page offers a guided in-situ anchoring flow: a 1 kHz
reference tone plays at a fixed digital level while the user sets their
*system* volume until the tone matches conversational-speech loudness
(about 65 dB SPL — "someone talking to you across a table"); saving
records the implied full-scale-to-SPL mapping. Anchors are keyed to a
signature of the machine's audio output devices and stored in
`chrome.storage.local` (an anchor is meaningless on another machine, so
it never syncs). The WDRC's level mapping uses the anchor when one
exists; the level/dose readout is *suppressed entirely* until then, and
flagged stale when the output-device set changes, because the anchor is
only valid for the chain it was set on. A self-reported loudness match is
still not a measurement — but it is grounded in the user's actual
hardware, which the old global assumption was not.

**Response shape.** Two optional helpers, both shape-only corrections
relative to 1 kHz. Tier 1: a generic headphone-profile preset (clearly
labeled as average shapes, not measurements) plus a reference-tone
loudness match across bands — the user adjusts each band's tone until it
sounds equally loud, producing per-band offsets. Tier 2:
`calibrate_playback.py` plays each band's tone through the user's actual
chain, records it with a cheap USB measurement microphone, computes the
response relative to 1 kHz, and writes a correction JSON the options page
imports — shape-only by construction, and labeled as such. All correction
offsets are clamped to ±12 dB and folded into the band curves; the test
harness asserts the round trip (known corrections in → expected combined,
clamped offsets out, landing 1:1 in the curves). Neither tier is clinical
probe-microphone verification, and the docs and UI say so.

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
selector (comfort / adult / child, with the adult approximation labeled
and the child target locked as described above), the WDRC fast/slow
speed toggle, a master volume slider, an enable toggle, and the
level/dose readout described above. On first run the popup fronts a
plain-language notice of the red-flag conditions that call for an ENT
and audiologist *before* any self-adjustment — ear-to-ear asymmetry,
tinnitus, drainage or pain, dizziness, sudden or one-sided change — and
is dismissed once, permanently, with an explicit acknowledgment.
Settings persist through `chrome.storage.sync` and the content script
applies changes live via the `storage.onChanged` listener.

The options page holds the BYOK key fields, the photo import flow, and the
calibration section. Extracted thresholds are never applied silently: they
are displayed in a review table, screened by a plausibility check that
flags patterns associated with model misreads (left/right asymmetry over
40 dB at any band, steep jumps over 30 dB between adjacent bands, a
perfectly flat identical read), and applied only after the user ticks an
explicit "I compared every value against the paper report" confirmation —
the Apply button stays disabled until then, and the confirmation resets on
every new extraction. Before any of that, a scope screen applies a hard
stop: if the extraction contains thresholds above 70 dB HL, the import is
blocked outright rather than clamped into range — the preview shows the
real unclamped numbers with the out-of-scope cells highlighted, states
that the extension's prescriptions stop at mild-to-moderate loss and that
this range calls for a professionally fitted hearing instrument, and the
review checkbox and Apply button are removed for that extraction (Discard
is the only exit). Silently truncating a severe audiogram to 70 and
amplifying anyway would misrepresent what the tool had done, which is why
the previous clamp-on-import behavior is now a block. Values remain editable on the popup chart afterwards.
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

Verification remains the fundamental limitation: even with the loudness
anchor, tone match, and mic correction, the software cannot know true SPL
at the eardrum — the anchor is a self-reported loudness judgment, not
real-ear measurement, and everything downstream of it is an estimate. The
self-fit trials that validate this product category all used professional
support or real-ear/in-situ verification, so any claim here stays at
"listening comfort," not measured benefit; the credible next step toward
a benefit claim would be a small self-report study (APHAB or IOI-HA)
comparing calibrated-on versus off. The adult/child targets are
first-order approximations of NAL/DSL, not the real formulas; closer
target tables are the main remaining DSP milestone. The dose model uses
an unweighted level under the anchored mapping rather than a true
A-weighted measurement. Extraction
accuracy on symbol-only charts (no numeric table) is the weakest AI step
and is mitigated, not solved, by the plausibility screen and un-skippable
review; a purpose-built on-device CV/OCR path (numeric-table OCR plus
symbol detection), which the digitizer literature puts at ~1.3 dB mean
absolute error, is the planned default for machines without Chrome's
built-in model. The Firefox manifest key is in place but the port is
untested in practice. A per-provider key validity test and import of the
numeric JSON produced by the Python CLI directly into the options page
round out the near-term list.
