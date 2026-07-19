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
hardware and measured uncomfortable-loudness levels. Roar, kid! v0
deliberately implements only a coarse ancestor of these
(`content.js:56`):
- makeup gain = 0.45 × threshold — the classic **half-gain rule** (a 1970s
  heuristic: aid gain ≈ half the loss);
- ratio = 1 + loss/40 — recruitment compensation that reaches 2:1 at
  40 dB HL.

**The safety ceilings are clinical, not arbitrary.** Thresholds clamp at
70 dB HL ("aids, not miracles", `content.js:63`); the −3 dB / 20:1 master
limiter never comes off. Severe/profound loss (> 70 dB) needs acoustic
output and fitted safety limits (measured UCL/MPO per ear) that consumer
headphones and full-scale digital audio cannot provide — that territory is
deliberately, permanently out of scope. See the warning in the README and
`DOCUMENTATION.md`.

**ABR/BERA.** Auditory brainstem response — the objective (electrode-based)
hearing test used for infants and toddlers, reported as a printed threshold
table rather than a plotted chart, often with "com correção" (corrected)
columns. The photo import handles these reports; they were the project's
real-world test case.

## How Roar, kid! uses it

- Chart conventions and 5 dB grid: `popup.js` (`draw`, `plotFromEvent`).
- Fitting rule and ceilings: `content.js:56-72`.
- Band set + Q derivation and the 6→8-band migration: `content.js:12-54`.
- Import prompt rules (transcribe only what's on paper; `null` for
  untested frequencies; software interpolates, never the model):
  `roar-kid/prompt.txt`.

## Further research

- Harvey Dillon, *Hearing Aids*, 2nd ed. — the standard textbook (WDRC,
  prescriptions, verification).
- NAL-NL2: Keidser et al., 2011, *Audiology Research*. DSL v5.0: Scollie
  et al., 2005.
- ANSI S3.5 (Speech Intelligibility Index).
- Search terms: "loudness recruitment", "pure tone average", "real-ear
  measurement", "UCL MPO fitting", "auditory brainstem response threshold".
