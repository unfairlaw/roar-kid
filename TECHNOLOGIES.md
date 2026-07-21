# Technologies in Roar, kid! — a study map

Every technology this project touches. Each entry links to a full study
document in [`docs/tech/`](docs/tech/) covering what it is, the core
concepts, exactly how this codebase uses it (with file references), the
pitfalls hit here, and where to research further.

| # | Document | One-line summary |
|---|----------|------------------|
| 1 | [Chrome Extensions — Manifest V3](docs/tech/01-chrome-extensions-mv3.md) | The platform contract: manifest, three execution worlds, permissions, the remote-code ban. |
| 2 | [Web Audio API](docs/tech/02-web-audio-api.md) | The node graph: LR4 crossover on explicit RBJ coefficients, WDRC and look-ahead-limiter worklets (with transient guard), the legacy fallback, channel handling, the CTA-2051-aligned test harness. |
| 3 | [Clinical audiology](docs/tech/03-clinical-audiology.md) | dB HL, recruitment, WDRC, the comfort/adult/child targets, the loudness anchor and dose estimate, why the safety ceilings exist, and CTA-2051 alignment without a conformance claim. |
| 4 | [Canvas 2D + Pointer Events](docs/tech/04-canvas-pointer-events.md) | The interactive audiogram editor: coordinate mapping, snapping, drag state, touch. |
| 5 | [chrome.storage](docs/tech/05-chrome-storage.md) | sync vs. local as a privacy decision, and onChanged as a zero-code message bus. |
| 6 | [MutationObserver & SPAs](docs/tech/06-mutationobserver-spa.md) | Surviving streaming sites that build and rebuild themselves; cheap observers; failure containment. |
| 7 | [Chrome built-in AI (Prompt API)](docs/tech/07-chrome-builtin-ai.md) | On-device Gemini Nano: availability gating, schema-constrained output, greedy decoding, ops surface. |
| 8 | [Cloud LLM APIs — BYOK](docs/tech/08-cloud-llm-apis-byok.md) | Four providers, user-owned keys, three structured-output dialects, CORS from extensions, key UX as security model. |
| 9 | [Prompt engineering for small models](docs/tech/09-prompt-engineering-small-models.md) | Eight measured lessons: byte-for-byte validation, named keys, pruned-branch few-shots, capability cliffs. |
| 10 | [Python tooling](docs/tech/10-python-tooling.md) | Generated icons, the CLI twin of the import pipeline, the calibration measurer, the test-harness server, the `__pycache__` trap. |
| 11 | [Playwright](docs/tech/11-playwright.md) | Extension E2E and screenshot manufacture: persistent contexts, shadow DOM, locale knobs, hard limits. |
| 12 | [Packaging & store review](docs/tech/12-packaging-store-review.md) | Two-zip discipline, field limits, health-data disclosure, the remote-code attestation, updating a live listing. |

**Suggested reading order:** 2 → 3 first (they explain each other), then
7 → 9 (the AI import story), then the rest as needed.
