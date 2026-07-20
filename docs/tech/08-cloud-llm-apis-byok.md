# Cloud multimodal LLM APIs — the BYOK architecture

Part of the [technology study map](../../TECHNOLOGIES.md).

## What it is

Hosted vision-capable language models — OpenAI, Anthropic (Claude), Google
Gemini, xAI (Grok) — called **directly from the browser** with the *user's
own* API key. "Bring your own key" (BYOK) is an architecture, not a
feature: the developer operates no server, proxies nothing, and can see
nothing.

## Core concepts

**Why BYOK.** For an app handling health data, the strongest privacy claim
available is *"we cannot see your data because there is nothing of ours to
send it through."* The photo goes browser → chosen provider, period. The
costs: users must obtain a key (real friction), the extension needs host
permissions for each provider origin, and each provider's request format
must be spoken natively (no server-side SDK to hide differences).

**Four providers, one contract.** All four are asked for the same thing —
the shared prompt (`roar-kid/prompt.txt`) and a JSON response validated
against one `SCHEMA` object. Models configured: OpenAI `gpt-5.2`,
Anthropic `claude-sonnet-4-6`, Gemini `gemini-3.5-flash`, xAI `grok-4`.
What differs per provider is transport (endpoint, auth header, image
encoding) *and the structured-output dialect*:
- OpenAI/xAI: `response_format: { type: "json_schema", strict: true }` —
  wants full JSON Schema *including* `additionalProperties: false`;
- Anthropic: a forced tool call (`tool_choice`), schema as `input_schema`;
- Gemini: `generationConfig.responseSchema` — an OpenAPI-style **fixed
  proto**: `nullable: true` instead of `type: [..., "null"]`, and **no
  `additionalProperties` field at all**. The API 400s on any unknown
  schema key instead of ignoring it, so the exact key that strict OpenAI
  mode *requires* breaks Gemini — `geminiSchema()` (`options.js:124`)
  clones the shared schema and translates both differences. One schema
  language, three dialects; never assume a JSON Schema travels.

**CORS from an extension.** Browsers block cross-origin `fetch` unless the
target allows it. Two mechanisms make these calls work:
- MV3 **host permissions** exempt listed origins from CORS for the
  extension's own pages — the manifest lists all four API hosts;
- Anthropic additionally requires an explicit opt-in header,
  `anthropic-dangerous-direct-browser-access: true` — an official,
  documented acknowledgment that the key lives client-side (scary name,
  sanctioned mechanism; the store-review note in `STORE_SUBMISSION.md`
  cites Anthropic's CORS docs for exactly this question).

**Key UX is part of the security model** (v0.2.1 decisions):
- a key *pasted* into the box works for one import and is **never
  stored**; persistence happens only on explicit "Save key"
  (`chrome.storage.local`, device-only), with "Remove key" as the inverse;
- one key = one provider: filling any provider's box disables the other
  three (CSS `:disabled`) — *prevention* instead of an error message, and
  the filled box itself is the provider selector (no dropdown).

**Data-boundary rules enforced by prompt + code.** The model transcribes
only what is on the paper and returns `null` for untested frequencies; gap
interpolation happens in local code, never in the model. Every imported
value is displayed for human review before it is applied, and stays
editable afterward. UI copy instructs cropping patient-identifying
information before upload; the prompt additionally instructs the model to
ignore any that remains.

**Import hardening (v1).** On-device extraction is the *default* path;
sending a photo to a cloud provider requires a per-import consent checkbox
(consent is to an act, not a mode). Extracted values pass plausibility
checks before display — > 40 dB left/right asymmetry, > 30 dB jumps
between adjacent bands, and suspiciously flat-identical ears each raise a
visible warning — and the Apply button stays disabled until an
un-skippable "I compared every value against my report" checkbox is
ticked (`options.js:397`). The model is treated as a fallible OCR, not an
authority.

## How Roar, kid! uses it

`options.js`: provider detection from which key box is filled → provider-
specific request builder → shared prompt + image → JSON parsed → review
table → apply to `chrome.storage`. The Python CLI
(`roar-kid/extract_audiogram.py`) is the same pipeline outside the
browser, sharing `prompt.txt` from disk.

## Pitfalls learned here

- Store reviewers see four AI hosts on a health extension and ask why;
  the permission justification must say "user-initiated, user's own key,
  single chosen provider" plainly (`STORE_SUBMISSION.md`).
- Provider JSON-mode behaviors drift; parsing defensively (extract the
  `{...}` block, validate fields) beats trusting the flag.
- A schema dialect bug is invisible until a user of *that* provider tries
  it — Gemini's `additionalProperties` rejection shipped all the way to
  manual pre-release key testing (caught 2026-07-20) because no automated
  test exercises real provider endpoints. BYOK cuts both ways: no server
  also means no server-side integration tests.
- Never let convenience code (retry loops, logging) capture the key or
  the image anywhere — the privacy claim is only as strong as the laziest
  code path.

## Further research

- Anthropic CORS / direct browser access documentation.
- Each provider's vision + structured-output docs.
- Search terms: "BYOK client-side API key", "CORS preflight Authorization
  header", "extension host_permissions fetch".
