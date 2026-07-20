# Chrome built-in AI — the Prompt API (Gemini Nano)

Part of the [technology study map](../../TECHNOLOGIES.md).

## What it is

A small multimodal language model (Gemini Nano) that Chrome ships and runs
*on the device*, exposed to extensions through the `LanguageModel` global.
Prompts — including images — never leave the machine; no key, no account,
no network round trip. The trade: a small model's capability, a multi-GB
one-time model download, and hardware gates (disk space, VRAM).

This project's full research record lives in `PROMPT_API_RESEARCH.md`
(untracked personal notes) and the runnable evidence ladder in
`spike-prompt-api/`; this doc is the API-shaped summary.

## Core concepts

**Availability is a first-class state machine.**
`LanguageModel.availability(opts)` returns `"unavailable"`, `"downloadable"`,
`"downloading"`, or `"available"` — and the answer depends on the options
you'll create with (image input support has its own gate). UI must be built
around this: Roar, kid! probes on options-page load and only *then* reveals
the button (`options.js:374-383`). On unsupported machines the feature
simply doesn't exist visually.

**Session creation declares intent.** `LanguageModel.create({...})` takes:
- `expectedInputs: [{ type: "image" }]` — required for multimodal prompts;
- `expectedOutputs: [{ type: "text", languages: ["en"] }]` — declares output
  language. Omit it and Chrome logs a warning on *every* API request —
  including `availability()` (a bug class this project hit twice);
  supported output languages are only `[de, en, es, fr, ja]` — notably no
  Portuguese.
- `monitor(m)` — progress events for the one-time model download, surfaced
  in the UI (`options.js:199`).

**Structured output via `responseConstraint`.** Pass a JSON Schema and the
runtime constrains decoding to it (`options.js:231`). It works together
with image inputs (verified on Chrome 150 — this was uncertain and had to
be spiked). The schema is not decoration: under greedy decoding, *any*
byte of prompt or schema — even a field description — changes the whole
generation. **The validated artifact is prompt + schema, byte-for-byte**
(`prompt-builtin.txt` + `NANO_SCHEMA` in `options.js`).

**Determinism has exactly one lever.** The API has no seed, by spec
design. Greedy decoding is the only reproducibility control:
`samplingMode: "most-predictable"` (current spec), with
`temperature: 0, topK: 1` as the deprecated extension-context fallback —
the code tries both in order (`options.js:204-217`).

**Operational surface.** The model provisions on demand (it no longer
appears in `chrome://components`); debugging lives at
`chrome://on-device-internals` ("Pending Assets" = provisioning in
flight). Supplementary models (e.g. `GENERALIZED_SAFETY`) can block session
creation after a Chrome version jump; a major update can force
re-provisioning. Hardware gate observed: ~22 GB free disk, > 4 GB VRAM —
and hybrid-GPU laptops may probe the wrong GPU.

## How Roar, kid! uses it

The keyless photo-import path (`options.js`): availability-gated button →
`createImageBitmap(file)` → single prompt combining `prompt-builtin.txt`
and the image → `responseConstraint: NANO_SCHEMA` → parse → same
review-before-apply pipeline as the cloud providers. Since the v1 import
hardening, on-device is the *default* extraction path where available;
sending the photo to a cloud provider instead requires a per-import
consent checkbox — privacy ordering made structural, not a fallback.

Measured verdict (2026-07, Chrome 150): printed threshold tables
(ABR/BERA reports) extract 16/16 deterministically; *plotted* audiogram
charts fail at the vision level (~4/16 — the model merges the two ear
traces) and remain BYOK-only. Re-test when the next Nano generation ships.

## Further research

- https://developer.chrome.com/docs/ai/prompt-api
- `spike-prompt-api/README.md` in this repo — the A/B harness and rubric.
- The [prompt-engineering doc](09-prompt-engineering-small-models.md) —
  the lessons that made 16/16 possible.
- Search terms: "Gemini Nano extension", "responseConstraint JSON schema",
  "on-device AI availability", "chrome on-device-internals".
