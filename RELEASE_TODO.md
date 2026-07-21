# Release TODO — spec for building the next Chrome Web Store zip

Ordered checklist for producing a new `roar-kid-store.zip`. Do the phases in
order; each gate must pass before the next phase starts. Mechanical commands
live in [PACKAGING.md](PACKAGING.md); this file is the *what and in which
order*, not the *how*.

**Why a new zip is needed (state as of 2026-07-21):** the existing
`roar-kid-store.zip` was built 2026-07-20 09:41 at version 0.5.0. PR #6
(merged 2026-07-21) changed eight runtime files — `content.js`, `dsp.js`,
`options.html`, `options.js`, `popup.html`, `popup.js`, and both worklets —
so the zip no longer matches the code. The manifest also still says `0.5.0`,
the same version as the old zip.

## Phase 1 — Version

- [ ] **OPEN (human):** Confirm which version the developer dashboard
      currently holds (published or pending review). The new upload must be
      **strictly greater** — the store rejects equal or lower versions.
      Sources disagree on what is live: STORE_SUBMISSION.md says 0.3.0 was
      published 2026-07-20 and 0.5.0 was built over it; this file says the
      dashboard holds 0.5.0. 0.6.0 beats all candidates, so the bump is
      safe either way — but confirm before uploading.
- [x] Bump `"version"` in `roar-kid/manifest.json` → **0.6.0** (commit
      `b7744ba`), synced to `roar-kid-store/manifest.json`.
- [x] Manifest `description` unchanged, 126 chars (cap 132), verified
      byte-identical to the Summary in STORE_SUBMISSION.md.

## Phase 2 — Quality gates (before any packaging)

- [x] Working tree clean, on `main`, up to date with origin.
- [x] DSP test harness run headlessly — **32/32 pass**. Note: this file
      said 18; PR #6 added T8–T11 (CTA-2051 distortion, smoothness,
      self-noise, HF gain), so the suite is now 32 checks.
      **Flake to know about:** T7 (real A/V sync) failed the first run at
      31/32 with deltas `[21.5, 55.0, 21.7] ms` against a −15..+45 ms
      budget. Three re-runs were clean 32/32 — it is headless timing
      jitter, not a regression. Re-run before concluding anything from a
      lone T7 failure.
- [ ] Manual smoke test with the unpacked folder loaded (delete
      `__pycache__/` first if present):
  - [x] YouTube — EQ engages, popup shows state, limiter indicator
        behaves. Confirmed by developer smoke test, 2026-07-21.
  - [x] Icon click-to-disable — while a streaming tab's
        audio runs through the chain, clicking the toolbar icon on that
        tab turns the extension off directly (no popup); the icon tooltip
        reads "on (click to turn off)". Once off — or on any other tab —
        the click opens the popup as usual, where re-enabling lives.
        Verify the popup toggle and the icon click stay in sync both
        ways. (Pinning the icon next to the extensions menu is a manual
        user step — Chrome has no API for it.) Confirmed by developer
        smoke test, 2026-07-21.
  - [x] Netflix and Prime Video — same quick pass. Confirmed by developer
        smoke test, 2026-07-21. Note: Prime's console shows repeated EME
        "robustness level" warnings and its Issues panel lists label
        defects — both verified to be Amazon's own markup/player, not the
        extension's (violating nodes inspected).
  - [x] Options page — calibration flow and the new threshold behavior
        from PR #6 end to end. Confirmed by developer smoke test,
        2026-07-21, including the a11y label pass (DevTools Issues panel
        on the options page itself).
  - [x] Audiogram import: out-of-scope audiograms **blocked with a
        message**, not clamped — confirmed 2026-07-21 against the three
        generated charts (see Phase 4 note).
  - [x] No errors in the service-worker/page consoles attributable to the
        extension. Confirmed by developer smoke test, 2026-07-21.

## Phase 3 — Listing collateral still true?

PR #6 touched `options.html` and `popup.html` after the 0.5.0 screenshot set
was taken, and changed user-facing behavior. Verify before upload:

- [x] Screenshots — **no retake needed; this file's premise was wrong.**
      It assumed the calibration/anchor sections changed. The diff says
      otherwise: every PR #6 change to `options.html`/`options.js` is
      confined to the photo-import *review* panel, which only appears
      after an extraction. `options.html` gained one CSS rule (`td.oob`)
      and two container elements, all inside that panel; `popup.html`
      gained one CSS rule (`#dose.alert`). Screenshot 02 shows the
      pre-extraction state. All five frames verified still accurate.
- [x] `STORE_SUBMISSION.md` — EN and pt-BR listing text needed no change
      (it never claimed clamping, and makes no per-session dose claim).
      Version-specific collateral around it was updated: testing
      instructions (497 chars, cap 500), reviewer note for 0.6.0, and the
      fuller import description now documents the blocking behavior.
- [x] Copy rule check: new copy describes the software and the data range
      ("this extension's prescriptions stop at mild-to-moderate loss",
      "imports with any threshold over 70 dB HL are blocked"). It does not
      classify the listener's hearing anywhere.
- [x] `PRIVACY_POLICY.md` — confirmed untouched by PR #6 (last changed
      2026-07-18 for 0.3.0); data handling unchanged, no edit needed.

## Phase 4 — Build the zip

- [x] Synced `roar-kid/` → `roar-kid-store/` and rebuilt the zip per
      PACKAGING.md. Built 2026-07-21 16:12, 71801 bytes — this build
      includes the a11y labelling fixes (A11Y_LABEL_REPORT.md) **and
      icon click-to-disable on active tabs** (new `background.js` service
      worker + content-script report; manifest gained a `background` key,
      no new permissions). Supersedes the 15:16 / 70700-byte build.
      Harness re-ran 32/32 after each change.
- [x] Archive verified (re-run in full against the 16:12 build):
  - [x] 18 entries (was 17; `background.js` is new), manifest at top
        level, no wrapper folder.
  - [x] No `__pycache__`, `.pyc`, docs, or Python files.
  - [x] Archive manifest reads `"version": "0.6.0"`.
  - [x] All 12 shipped files byte-match their `roar-kid/` sources (`cmp`),
        icons included.
  - [x] Every manifest-referenced path resolves inside the archive; the
        four unreferenced files (`options.js`, `popup.js`, both prompts)
        are loaded from the HTML, confirmed.
  - [x] Chrome's own `--pack-extension` accepted it without error —
        validates manifest and structure the way the store loader does.
- [ ] Final proof — load the shipped artifact, not its source:
  - [x] Out-of-scope import blocking, confirmed 2026-07-21. Test charts
        generated by `icons-preview/make_test_audiogram_oob.py`:
        `oob_clear` (6 values over → block), `oob_minimal` (exactly one,
        right 8k = 75 → block), `edge_70` (peaks at exactly 70 → must
        **not** block; the block is `>`, not `>=`). Generator's predicted
        offender strings are byte-identical to what `options.js` builds.
  - [x] 2-minute YouTube smoke test on the synced `roar-kid-store/`
        folder. Confirmed by developer smoke test, 2026-07-21.

## Phase 5 — Tag and submit

- [x] Committed the version bump + collateral: `b7744ba`.
- [x] Tagged `v0.6.0` locally (annotated).
- [ ] **OPEN:** push the tag (`git push origin main --follow-tags`).
      The hold is resolved: smoke tests passed 2026-07-21 and the tag was
      moved to the commit containing the a11y fixes and click-to-disable
      (the code the verified 16:12 zip was built from).
- [ ] Dashboard: upload the new `roar-kid-store.zip` to the **existing
      item** (never "New item" for an update).
- [ ] Re-paste Summary/Description only if STORE_SUBMISSION.md changed in
      Phase 3 (both languages). Replace changed screenshots.
- [ ] Remote-code declaration stays **"No"**; data disclosures unchanged.
- [ ] Submit for review; watch email — host-permission + health-adjacent
      extensions get slower, chattier reviews. Answer promptly.
- [ ] After approval: install the live store version on a clean profile and
      smoke test once more.
