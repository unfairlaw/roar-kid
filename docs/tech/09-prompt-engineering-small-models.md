# Prompt engineering for small models

Part of the [technology study map](../../TECHNOLOGIES.md).

## What it is

The craft of making a language model produce *reliable, structured,
repeatable* output — which changes character completely when the model is
small. Everything here was measured on this project's extraction task
(read a hearing-test report photo into 16 numbers) against a /16 rubric,
with the harness preserved in `spike-prompt-api/`. These are not vibes;
each lesson flipped real scores.

## The lessons

**1. The validated artifact is prompt + schema, byte-for-byte.**
Under greedy decoding, generation is a pure function of the input tokens.
Change *anything* — reword a JSON-schema field description, "clean up"
whitespace — and the entire output can shift. A reworded `reasoning`
description alone flipped a 16/16 run into a wrong left ear. Operational
rule: ship the exact validated bytes (`prompt-builtin.txt`, `NANO_SCHEMA`),
and re-run the rubric after *any* touch, however cosmetic.

**2. The say–do gap is real.** Small models recite rules correctly while
violating them in the same response — Nano's confidence note quoted the
"use corrected values" rule in a run that used the uncorrected column.
Never trust self-reported compliance; verify outputs mechanically.

**3. Force performed reasoning, not planned reasoning.** Asked to "reason
first", a small model writes future tense — "Ana will read row 500 Hz" —
and then doesn't. The fix that worked: require *past-tense, performed*
actions ("Ana read row 500 Hz: 45 → wrote 45"), making the reasoning field
a record of work rather than a promise of it.

**4. Named keys beat positional arrays.** Nano could not reliably fill an
8-slot array — values dropped or shifted even when its own reasoning was
correct. Keying the output by name (`hz250` … `hz8000`) eliminated the
mapping errors; code converts to arrays afterward (`options.js:234`).
Generalization: never make a small model do bookkeeping that code can do.

**5. Few-shot the model's OWN failures.** The winning prompt quotes two
failure modes observed in earlier runs — column interleaving, and leaking
uncorrected values — as explicitly *pruned branches*, each with a
checkable invariant. Generic examples teach the task; the model's own
failures, quoted back, teach it where *it* falls.

**6. Structure is load-bearing — simplification can regress.** The
Tree-of-Thoughts scaffold (a three-expert panel with recorded
deliberation) looked baroque, and removing it *lowered* accuracy. So did
an "obvious" decomposition into transcribe-then-map turns: turn 2 lost the
few-shot guardrails established in turn 1. Single generation with the full
scaffold won. Measure before simplifying.

**7. Determinism = greedy decoding; there is no seed.** The Prompt API
offers no seed by design. `samplingMode: "most-predictable"` (or the
deprecated `temperature: 0, topK: 1`) is the only reproducibility control;
without it, individual cell reads vary run to run and no rubric result
means anything.

**8. Know the capability cliff.** The same prompt scores 16/16 on printed
threshold *tables* and ~4/16 on plotted *charts* — the failure is visual
(the model merges the two ear traces), and no prompt fixes a perception
problem. Ship the case that works (tables → on-device), route the case
that doesn't to bigger models (charts → BYOK), and write down the retest
trigger (next model generation).

## Method notes

The result above came from an A/B harness (`spike-prompt-api/`) with a
fixed rubric, ground truth held out of the repo (gitignored
`bera_truth.json`), and one variable changed per run. Prompt work without
a rubric is anecdote collection.

## Further research

- Yao et al., *Tree of Thoughts* (2023) — the scaffold's origin.
- Constrained decoding / structured-output literature.
- Search terms: "greedy decoding determinism", "small model instruction
  following", "self-consistency prompting", "LLM evaluation rubric".
