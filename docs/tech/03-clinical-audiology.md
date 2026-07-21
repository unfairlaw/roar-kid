# Clinical audiology — the domain

Part of the [technology study map](../../TECHNOLOGIES.md).

## What it is

The medical science this project translates into consumer software: how
hearing is measured, how loss distorts perception, and how amplification is
prescribed. Everything in `content.js`'s fitting math and `popup.js`'s chart
is a (simplified, safety-capped) encoding of ideas below.

## Core concepts

**dB HL — hearing level.** Audiograms are plotted in dB *HL*, not dB SPL.
0 dB HL is defined as the average normal-hearing threshold *at each
frequency* — the scale bakes in the ear's frequency response, so "0 across
the chart" means "average hearing", flat. This is why the software can
treat thresholds as "gain needed" without an equal-loudness correction.

**Pure-tone audiometry.** An audiologist finds the quietest audible level
per frequency per ear, in 5 dB steps. Conventions the popup reproduces
exactly (`popup.js`): red **O** = right ear, blue **X** = left (mnemonic in
Portuguese clinics: *O de Orelha Direita*), Y axis inverted so worse
hearing plots downward, frequencies log-spaced 250 Hz → 8 kHz.

**The 8-band diagnostic standard.** Octaves (250, 500, 1k, 2k, 4k, 8k)
plus the inter-octaves 3k and 6k — ASHA's recommended set. The
inter-octaves matter because consonant energy (s, f, t, k…) lives at
2–6 kHz, precisely the region the Speech Intelligibility Index (SII,
ANSI S3.5) weights most, and precisely where age- and noise-related losses
bite first. This project upgraded from 6 to 8 bands after a literature
review for exactly that reason (settings migration: `migrateBands`).

**Degrees of loss** (typical clinical bands, dB HL): normal ≤ 15–20
(pediatric practice uses the stricter 15 — the popup's shaded band spans
−10..15), mild 20–40, moderate 41–55, moderately-severe 56–70, severe
71–90, profound > 90.

**Recruitment — why static EQ fails.** Sensorineural loss doesn't just
attenuate; it *compresses the ear's dynamic range*. Quiet sounds are
inaudible, but loud sounds are as loud as ever (sometimes intolerable).
Amplify everything equally and loud passages become painful before quiet
speech becomes clear. The correct response is level-dependent gain — quiet
in, more gain; loud in, less gain — i.e., **WDRC** (wide dynamic range
compression), which is what real hearing aids and this extension do.

**Prescriptive fitting.** Formulas mapping an audiogram to per-band,
per-level gain targets: NAL-NL2 (Australia, loudness-normalization
lineage) and DSL v5.0 (Canada, child-focused). Both need calibrated
hardware and measured uncomfortable-loudness levels, which is why this
project only ever *approximates* them and says so at the point of choice.
The popup's three targets (`dsp.js:163`, `bandCurves`):
- **Comfort** (default) — the v0 rule: makeup gain = 0.45 × threshold, the
  classic **half-gain rule** (a 1970s heuristic: aid gain ≈ half the
  loss), with ratio-style compression ≈ 1 + loss/40 (2:1 at 40 dB HL);
- **Adult** — NAL-flavored: more mid-frequency speech emphasis, labeled
  "approximate — not NAL-NL2" in the UI;
- **Child** — DSL-flavored (more audibility-driven gain), **locked by
  default**: it takes effect only after an audiologist-guidance
  attestation on the options page, and while active drops the limiter
  ceiling from −1 to −7 dBFS — a child's smaller ear canal yields several
  dB more SPL for the same signal (real-ear-to-coupler difference, RECD),
  so the same digital level is louder in a child's ear. A stored "child"
  choice without the attestation behaves as comfort, and the popup says
  which target is actually applied (`content.js:81-95`).

Each target's output is an input/output curve per band — gain at 50, 65,
and 80 dB program level — which is what WDRC actually is: more gain for
quiet input than loud.

**dB HL is not dB SPL at the ear — the anchor problem.** The software can
compute *relative* gain from an audiogram, but any absolute statement
("you are listening at 78 dB") requires knowing what SPL a full-scale
digital signal produces on *this* hardware — and across laptops and
headphones that varies by 10–20 dB. v1.1's answer is a **loudness anchor**
(options page): a 1 kHz tone at a fixed digital level that the user
matches to conversational loudness (~65 dB SPL), stored per output device.
Until an anchor exists, level and listening-dose readouts are suppressed
and the UI says "relative — no anchor" rather than guessing
(`content.js:137-153`). The dose estimate itself follows ITU-T H.870's
conservative Mode 2 framing: 100% of a weekly sound allowance = 75 dBA
for 40 hours.

**The safety ceilings are clinical, not arbitrary.** Thresholds clamp at
70 dB HL ("aids, not miracles") and per-band gain at 35 dB — scope
limits, while the always-on look-ahead limiter (≤ −1 dBFS, lower in child
mode, never raisable — `worklets/limiter.js:29`) is the safety guarantee.
Severe/profound loss (> 70 dB) needs acoustic output and fitted safety
limits (measured UCL/MPO per ear) that consumer headphones and full-scale
digital audio cannot provide — that territory is deliberately, permanently
out of scope. See the warning in the README and `DOCUMENTATION.md`.

**CTA-2051 — the consumer amplification standard.** ANSI/CTA-2051-A
(*Personal Sound Amplification Performance Criteria*) is the performance
standard for PSAPs: pass/fail criteria for maximum output, distortion,
self-generated noise, latency, bandwidth, and response smoothness, plus
report-only disclosure categories (microphones, noise reduction,
feedback control, ear coupling, personalization). It measures a complete
acoustic device — microphone to 2cc coupler — which software can never
be, so the project claims no conformance. Instead, each
software-assessable criterion was translated into a digital-domain
equivalent with its own pass threshold and asserted by the test harness
(T8–T11 were added for this: distortion, smoothness, self-noise, and
high-frequency gain — see the [Web Audio doc](02-web-audio-api.md)),
and `DOCUMENTATION.md` carries the report-only disclosures: no
microphone of any kind, no noise reduction, no feedback path, ear
coupling is the user's own headphones. As of 2026-07-21 every
applicable criterion is covered by a passing test or a published
disclosure. The standard's text is copyrighted and is cited, never
reproduced, in this repo.

**ABR/BERA.** Auditory brainstem response — the objective (electrode-based)
hearing test used for infants and toddlers, reported as a printed threshold
table rather than a plotted chart, often with "com correção" (corrected)
columns. The photo import handles these reports; they were the project's
real-world test case.

## How Roar, kid! uses it

- Chart conventions and 5 dB grid: `popup.js` (`draw`, `plotFromEvent`).
- Targets, curves, clamps, calibration offsets: `dsp.js` (`bandCurves`,
  `calibrationOffsets`); applied in `content.js:72` (`applySettings`).
- Band set, LR4 crossover points, and the 6→8-band migration:
  `dsp.js:16-22`, `content.js:59` (`migrateBands`).
- Anchor storage and dose accounting: `content.js:137-176`.
- Import prompt rules (transcribe only what's on paper; `null` for
  untested frequencies; software interpolates, never the model):
  `roar-kid/prompt.txt`.
- CTA-2051 digital-domain alignment: tests T8–T11 in `tests/test.js`;
  disclosures and the measured 35 dB maximum-HF-gain figure in
  `DOCUMENTATION.md`.

## Further research

- Harvey Dillon, *Hearing Aids*, 2nd ed. — the standard textbook (WDRC,
  prescriptions, verification).
- NAL-NL2: Keidser et al., 2011, *Audiology Research*. DSL v5.0: Scollie
  et al., 2005.
- ANSI S3.5 (Speech Intelligibility Index).
- ITU-T H.870 (safe listening devices) — the dose framing.
- ANSI/CTA-2051-A (personal sound amplification performance criteria) —
  the engineering targets behind T8–T11.
- Search terms: "loudness recruitment", "pure tone average", "real-ear
  measurement", "UCL MPO fitting", "auditory brainstem response threshold",
  "real-ear-to-coupler difference RECD", "NAL-NL2 vs DSL v5".
