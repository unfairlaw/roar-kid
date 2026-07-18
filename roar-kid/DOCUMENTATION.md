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

The project is a flat directory. `manifest.json` declares the Manifest V3
extension, its permissions, and its entry points. `content.js` is the content
script injected into YouTube pages; it owns the entire audio processing
graph. `popup.html` and `popup.js` implement the toolbar popup, whose
centerpiece is an interactive clinical audiogram chart. `options.html` and
`options.js` implement the settings page, covering bring-your-own-key (BYOK)
credential storage and AI-assisted import of audiogram photos.
`extract_audiogram.py` is an optional Python command-line equivalent of the
photo import, built on LangChain for users who prefer to keep extraction
outside the browser. `README.md` gives the short install-and-run version of
this document.

## Signal processing architecture

The content script locates YouTube's `<video>` element and routes it through
a Web Audio API graph. The signal enters via `MediaElementAudioSourceNode`,
is split into left and right channels with a `ChannelSplitterNode`, and each
ear is processed independently against its own audiogram. Per ear, the
signal is tapped into eight bands centered at the standard diagnostic
audiometric frequencies of 250, 500, 1000, 2000, 3000, 4000, 6000, and
8000 Hz (the ASHA 8-frequency set — 3 and 6 kHz sit in the speech-critical
region weighted most heavily by the Speech Intelligibility Index) using
`BiquadFilterNode` bandpass filters, each with a Q derived from the
geometric spacing to its neighbors. Each band passes through a
`DynamicsCompressorNode` followed by a makeup `GainNode`, and the bands are
summed back per ear before a `ChannelMergerNode` reassembles stereo. The
merged signal then passes through a hard output limiter (a compressor at
−3 dB threshold, 20:1 ratio, 1 ms attack) and a master volume `GainNode`
before reaching `destination`. The limiter is always active and is a safety
requirement, not a feature: prescriptive gain must never be able to produce
harmful output levels, particularly for a child listener.

The reason the design uses multiband compression rather than static
parametric EQ is loudness recruitment: a hearing-impaired ear has a
compressed dynamic range, so quiet sounds need substantial gain while loud
sounds need little or none. Static EQ derived from an audiogram
over-amplifies loud passages. Level-dependent gain per frequency band —
wide dynamic range compression (WDRC) — is what actual hearing aids
implement, and Roar, kid! approximates a simplified version of it.

The v0 fitting rule is deliberately conservative. Makeup gain per band is
0.45 × threshold (dB HL), a variant of the classical half-gain rule from
hearing aid fitting literature. The compression ratio grows with loss as
1 + loss/40, so a normal-hearing band remains transparent at 1:1 while a
40 dB HL band is compressed at 2:1. Thresholds are clamped to the −10 to
70 dB HL range because the project scopes itself to mild-to-moderate loss.
Real clinical fittings use level-dependent prescriptive targets — DSL v5.0
for children and NAL-NL2 for adults — which this rule approximates only
loosely; implementing genuine DSL-style input/output curves is on the
roadmap. Gain changes are smoothed with `setTargetAtTime` to avoid zipper
noise and sudden loudness jumps.

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
hearing plots lower, the normal-hearing region (−10 to 20 dB HL) shaded, the
right ear plotted as red O symbols and the left ear as blue X symbols. This
is intentional — the chart the clinic hands a parent can be copied onto the
popup point by point without translation. Thresholds are entered by tapping
or dragging on the chart and snap to the clinical 5 dB grid. The popup also
carries an ear selector, a master volume slider, and an enable toggle.
Settings persist through `chrome.storage.sync` and the content script
applies changes live via the `storage.onChanged` listener.

The options page holds the BYOK key fields and the photo import flow.
Extracted thresholds are never applied silently: they are displayed in a
review table, applied only on explicit confirmation, and remain editable on
the popup chart afterwards. This human-in-the-loop step exists because
multimodal models are measurably weaker at reading a symbol's precise
vertical position between chart gridlines than at reading printed numbers,
so extraction is treated as a proposal rather than a result.

## AI-assisted audiogram import

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
user selects. Audiogram photos are a child's medical record: the UI
instructs users to crop identifying information before upload, the
extraction prompt instructs the model to ignore any that remains, and the
documentation is explicit that the image leaves the device for the chosen
provider. The output limiter cannot be disabled. The project describes
itself everywhere as a supplement, and the popup footer repeats that framing
where a parent will actually read it.

## Known limitations and roadmap

The bandpass-tap band split does not reconstruct flat at unity; a cascaded
Linkwitz–Riley crossover network is the planned replacement. The fitting
rule is a static approximation of level-dependent prescriptive targets;
implementing DSL v5.0-style input/output curves per band, likely inside an
`AudioWorklet` with true RMS detection, is the main DSP milestone.
`DynamicsCompressorNode` is a fixed-topology peak-oriented compressor, which
is another reason the AudioWorklet port matters. Extraction accuracy on
symbol-only charts (no numeric table) is the weakest AI step and is
mitigated, not solved, by the review flow. A per-provider key validity test,
a Firefox port, and import of the numeric JSON produced by the Python CLI
directly into the options page round out the near-term list.
