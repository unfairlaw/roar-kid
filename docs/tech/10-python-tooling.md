# Python tooling — PIL icons and the extraction CLI

Part of the [technology study map](../../TECHNOLOGIES.md).

## What it is

Python as the project's *workbench*: none of it ships in the extension,
but it generates the artwork, mirrors the AI pipeline for testing, and
automates the screenshots (that last part lives in the
[Playwright doc](11-playwright.md)).

## Core pieces

**The icon is code** (`icons-preview/`). The storybook lion in headphones
is drawn by PIL (Pillow) scripts — shapes, gradients, and the deliberate
detail that the headphone cups follow the audiogram color convention (red
on the lion's right ear, blue on the left). Because it's generated:
- every size (16/32/48/128) renders from the same source, no scaling
  artifacts;
- iterations are diffs, not lost layers (the repo's history walks
  bear → lion, sword → no sword, tongue → teeth);
- if the store ever wants padding or tweaks, you re-render — the doc rule
  is *never hand-edit the PNGs*.

The same folder holds `test_audiogram.png` — a *synthetic* hearing-report
image generated for testing the AI extraction without exposing any real
report. It's public in the repo and doubles as the store reviewers' test
image (`STORE_SUBMISSION.md`).

**The CLI twin** (`roar-kid/extract_audiogram.py`). A standalone script
that runs the exact same photo-extraction as the options page: same
providers, same `prompt.txt` (read from disk instead of
`chrome.runtime.getURL`), same named-key JSON contract, same
software-side interpolation. Why it earns its place:
- pipeline changes are testable from a terminal, no extension reload
  loop;
- it validates that the prompt is genuinely interface-neutral;
- users who won't put a key in a browser can still import on their own
  machine.

Auto-scoring for chosen-file runs checks results against a local rubric
that stays gitignored — real-report ground truth never enters the public
repo.

**The calibration measurer** (`roar-kid/calibrate_playback.py`, added in
v1). Plays a tone at each of the 8 audiometric bands while recording
through a measurement microphone placed at ear position (numpy +
sounddevice), then writes the per-band correction relative to 1 kHz as
JSON that the options page imports ("Measurement-mic correction",
clamped ±12 dB on import). It corrects the *shape* of the playback
chain's frequency response — the assisted tier between "trust a headphone
preset" and clinical probe-mic verification, which it explicitly is not.
Python again because the browser can't be trusted to loop audio out and
back through arbitrary devices with known levels.

**The test-harness server** (`tests/serve.py`). The DSP test suite runs
real `OfflineAudioContext` renders in a page (`tests/test.html`), so it
needs an origin — a stdlib `http.server` subclass that also accepts the
results as a POST and writes `tests/results.json`. Run it, point headless
Chrome at it in the background, poll for the file: that dance exists
because `--virtual-time-budget` kills pending offline renders (see the
[Web Audio doc](02-web-audio-api.md)).

**The `__pycache__` trap.** Running any Python in `roar-kid/` creates
`__pycache__/`, and the Chrome Web Store **rejects archives containing
any file or directory whose name starts with `_`**. Defenses layered
through the project: zips exclude it (`PACKAGING.md`), `.gitignore`
ignores it, the load-unpacked instructions say to use `roar-kid-store/`
(where no Python exists), and the habit of `python3 -B` (don't write
bytecode) when running the CLI.

## Pitfalls learned here

- Generated assets beat edited assets everywhere reproducibility matters —
  icons, test fixtures, screenshots alike.
- Keep the workbench out of the shipping path *structurally* (separate
  folder), not by discipline alone; `roar-kid-store/` exists exactly so a
  stray `.pyc` can't reach the store zip.
- A synthetic fixture with known ground truth (test_audiogram.png) is
  worth more than any number of real examples you can't publish.

## Further research

- Pillow docs: https://pillow.readthedocs.io/
- Search terms: "PIL ImageDraw", "python -B PYTHONDONTWRITEBYTECODE",
  "golden file testing", "synthetic test data".
