# Chrome built-in AI (Prompt API / Gemini Nano) feasibility spike

Throwaway probe answering one question: **can Chrome's on-device model
extract audiogram thresholds accurately enough to become a keyless,
fully-private import path?** It runs the *shipping* prompt (`prompt.txt`,
copied from `roar-kid/`) and the shipping JSON schema against Gemini Nano,
scores the synthetic test audiogram against its known ground truth, and
prints everything it learns about the API on-page.

Why it matters: the built-in model means the photo **never leaves the
device** — no API key, no provider terms, no network after the one-time
model download. Best possible privacy for a medical image. The open
question is pure accuracy: Nano is a small model, and plotted O/X symbols
on a grid are a hard vision task even for frontier models.

Not part of the shipping extension. Never upload this folder to the store.

## Requirements

- Chrome 138+ on desktop (Win 10/11, macOS 13+, Linux)
- ~22 GB free disk; >4 GB VRAM **or** 16 GB RAM + 4 cores
- Unmetered network for the one-time model download

## How to run

1. `chrome://extensions` → Developer mode → **Load unpacked** → select
   `spike-prompt-api/`.
2. Click **Details → Extension options** on the spike's card — the test
   page opens.
3. The page reports availability immediately (`available`, `downloadable`,
   `downloading`, or `unavailable` — the last one ends the experiment on
   this machine).
4. Press **Run on test audiogram**. First run may sit in "model download"
   for a while (multi-GB). Then read the score table: model value on top,
   ground truth beneath, red cells are misses, total is X/16.
5. Optionally pick a real report photo and **Run on chosen file** — no
   auto-scoring, compare by eye. (On-device: the image goes nowhere.)

## Reading the outcome

- **16/16 or near** on the synthetic chart AND correct values from a real
  report → promote to a real import path, likely as the recommended
  default ("no key needed, photo never leaves your device"), BYOK as
  fallback.
- **Good on printed tables, bad on plotted charts** → ship scoped: offer
  built-in AI with an honest "works best on printed numeric tables" label.
- **Bad everywhere** → document and drop; BYOK remains the only path.
  Re-test when Chrome swaps in a newer Nano (Gemini Nano 4 rollout is
  planned during 2026).

The spike also logs which API call shapes worked (`responseConstraint`
with multimodal input has version quirks) — keep that log when writing the
real integration.
