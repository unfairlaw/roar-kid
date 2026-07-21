# Form-control labelling defects — report for review

**Date:** 2026-07-21 (amended same day after source verification — see
"Amendments" below)
**Found during:** 0.6.0 release smoke testing (Chrome DevTools → Issues panel,
options page, while exercising the per-band calibration sliders)
**Status:** not a 0.6.0 regression — all of it predates this release
**Affects:** `roar-kid/options.js`, `roar-kid/options.html`, `roar-kid/popup.html`

## Summary

Twelve form controls have no programmatic label. The text that visually
identifies them is present but not machine-associated, so assistive tech
announces them unnamed and browser autofill has nothing to key on. The worst
case is the calibration section: eight range sliders whose frequency labels are
DOM siblings with no `for` attribute and no `id` to point at, which a screen
reader renders as eight indistinguishable "slider" controls.

Standards-wise these are WCAG 2.1 failures of **1.3.1 Info and Relationships**
and **4.1.2 Name, Role, Value**. No functional impact — mouse/keyboard operation
is unaffected, and this does not touch the DSP path.

Worth naming the awkwardness plainly: this is a product built around a sensory
accommodation. Someone configuring per-frequency compensation for hearing loss
is a plausible assistive-tech user, and the calibration flow is exactly where
the labelling is weakest.

## Scope caveat — read before filing sub-tickets

The DevTools Issues panel reported **1** "incorrect use of `<label for>`" and
**4** "no label associated with a form field". Neither count matches what static
analysis of this codebase finds (0 broken `for` targets, 12 unlabelled
controls), and it is not currently known which tab was inspected.

Every `for=` attribute in the extension resolves to a real form field —
`k-openai`, `k-anthropic`, `k-google`, `k-xai` (`options.html:68-84`) and
`hpProfile` (`options.html:169`) all match existing ids. **There is no broken
`for` attribute in this codebase.** If the Issues panel was open on the YouTube
tab rather than the options page, that entry — and possibly some of the four —
belongs to YouTube's markup, not ours.

A second reason the counts can never reconcile, even on the right tab: Chrome's
"no label associated with a form field" issue comes from the autofill audit,
which does not evaluate every control type — range sliders in particular are
generally not flagged. So a full static audit will always find more than the
Issues panel reports. Do not treat the panel count as the size of the problem
in either direction.

The findings below were located by direct source audit and stand on their
own regardless of how the panel counts were attributed. Confirm the inspected
page before treating the DevTools numbers as a checklist.

## Findings

| # | Control(s) | Location | Current labelling | Severity |
|---|---|---|---|---|
| 1 | 8 × band sliders | `options.js:545-551` | orphan `<label>` sibling, input has no `id` | High |
| 2 | 8 × "play" buttons | `options.js:547` | eight identical "play" text nodes | Medium |
| 3 | `photo` (file) | `options.html:100` | none | Medium |
| 4 | `micFile` (file) | `options.html:192` | none | Medium |
| 5 | `anchorLabel` (text) | `options.html:155` | `placeholder` only | Medium |
| 6 | `vol` (range) | `popup.html:75` | adjacent `<span>`, not a `<label>` | Medium |
| 7 | N × "remove" buttons (anchor list) | `options.js:672` | identical "remove" text nodes, one per saved anchor | Medium |

Correctly labelled today, no change needed: `k-*` API-key inputs and `hpProfile`
(explicit `for=`); `cloudConsent`, `reviewed`, `childAttest`, `enabled` (input
nested inside its `<label>`, which is valid association).

## Detail and proposed fixes

### 1 + 2 — calibration band rows (`options.js:541-571`)

Current:

```js
return `<div class="keyrow">
  <label class="mono">${f >= 1000 ? f / 1000 + " kHz" : f + " Hz"}${anchor ? " ⚓" : ""}</label>
  <button class="ghost" data-band="${i}">play</button>
  <input type="range" data-band="${i}" min="-12" max="12" step="1"
    value="${v}" ${anchor ? "disabled" : ""} style="flex:1;" />
  <span class="mono" id="toneVal-${i}" style="width:44px; text-align:right;">${v > 0 ? "+" + v : v} dB</span>
</div>`;
```

The `<label>` is a sibling of the `<input>`, carries no `for`, and the input has
no `id` to reference. The `<span>` holding the live dB value is likewise
unassociated, so the current offset is not announced when the slider changes.

Proposed:

```js
const fLabel = hzLabel(f);                     // reuse the existing helper
return `<div class="keyrow">
  <label class="mono" for="toneBand-${i}">${fLabel}${anchor ? " ⚓" : ""}</label>
  <button class="ghost" data-band="${i}" aria-label="Play ${fLabel} test tone">play</button>
  <input type="range" id="toneBand-${i}" data-band="${i}" min="-12" max="12" step="1"
    value="${v}" ${anchor ? "disabled" : ""} style="flex:1;"
    aria-describedby="toneVal-${i}" />
  <span class="mono" id="toneVal-${i}" style="width:44px; text-align:right;">${v > 0 ? "+" + v : v} dB</span>
</div>`;
```

Notes for the implementer:

- `hzLabel` already exists at module scope (added in PR #6, `options.js:47`) and
  is character-for-character the same expression as the inline ternary here.
  Reusing it removes a duplicate definition; worth doing as part of the fix.
- **A static `aria-label` on the play button is not enough — it must track the
  play/stop toggle.** `playTone` swaps the button text to "stop"
  (`options.js:538`) and `stopTone` resets it to "play" (`options.js:521-523`),
  and `aria-label` overrides text content in the accessible-name computation.
  Left static, a screen-reader user would hear "Play 1 kHz test tone" even
  while the tone is playing — the state change becomes invisible to exactly the
  users this fix targets. The implementation must update the `aria-label` in
  both `playTone` and `stopTone` alongside the visible text (or keep a stable
  name and toggle `aria-pressed`).
- Keep the `⚓` glyph out of the button's `aria-label` — "Play 1 kHz test tone"
  is the useful announcement; the anchor marker is decoration on the label.
- `aria-describedby` on the slider is what makes the live "+3 dB" readout
  reachable. Consider `aria-live="polite"` on the `<span>` if the value should
  be announced as it changes rather than only on focus — worth a quick check
  with an actual screen reader, since a live region on a drag-driven control can
  be chatty.
- **No layout change.** `options.html:25` already styles `.keyrow label { width:
  96px; }`, and the element is already a `<label>` — only attributes are added.
- `data-band` must stay: `renderToneRows` wires handlers off it
  (buttons at `options.js:554-556`, sliders at `options.js:557-570`).

### 3, 4, 5 — file and text inputs (`options.html`)

Three controls sit inside `.extract-controls` flex rows with no label element:

- `:100` `<input type="file" id="photo" accept="image/*" />`
- `:192` `<input type="file" id="micFile" accept="application/json,.json" />`
- `:155` `<input id="anchorLabel" type="text" placeholder="e.g. laptop + wired headphones" />`

A `placeholder` is not an accessible name — it is not announced by every screen
reader and disappears on input, so `anchorLabel` is unnamed the moment the user
starts typing.

Two options, and the choice is a judgement call:

- **`aria-label`** — one attribute each, zero visual/layout change. Suggested
  values: `"Hearing test report photo"`, `"Microphone correction JSON"`,
  `"Anchor description — device and headphones"`.
- **Visible `<label for=…>`** — better for autofill and for sighted users who
  benefit from a persistent field name, but adds an element to each flex row and
  needs a design pass on the layout.

Recommend `aria-label` for the two file inputs (their adjacent buttons already
give visual context) and a visible label for `anchorLabel`, whose purpose is the
least self-evident of the three.

### 6 — popup volume slider (`popup.html:75`)

Current:

```html
<span class="mono">vol</span>
<input id="vol" type="range" min="0.2" max="1.5" step="0.05" value="1" />
```

Proposed:

```html
<label class="mono" for="vol">vol</label>
<input id="vol" type="range" min="0.2" max="1.5" step="0.05" value="1" />
```

Safe swap: `popup.html` has only a `label.switch` rule (`:52`), so a bare
`<label class="mono">` inherits nothing unexpected, and `<label>` and `<span>`
are both inline — no layout shift. Consider `aria-label="Output volume"` if
"vol" is judged too terse as an announced name.

### 7 — anchor-list "remove" buttons (`options.js:667-673`)

Missed by the original audit; same defect class as finding 2. `renderAnchors`
generates one "remove" button per saved anchor:

```js
`<button class="ghost" data-sig="${encodeURIComponent(s)}">remove</button></div>`
```

With more than one anchor saved, a screen-reader user tabbing the list hears N
identical "remove" buttons; the anchor's name lives in an adjacent unassociated
`<span>`. Proposed: `aria-label="Remove anchor ${label}"` built from the same
`a.label || "unnamed"` expression the visible row uses. The label is user-typed
free text interpolated into an attribute, so it must be attribute-escaped
(`&`, `"`, `<`) — a `19" monitor` label would otherwise truncate the attribute
and corrupt the markup. (The visible span already interpolates the same string
into `innerHTML` unescaped; that pre-existing self-injection of the user's own
local data is out of scope here, but worth its own small ticket.)

## Verification

1. Options page and popup → DevTools → Issues panel: the label entries
   attributable to this codebase should clear.
2. Tab through the calibration section and confirm each slider announces its
   frequency and current offset.
3. Confirm the eight "play" buttons are now distinguishable by accessible
   name, and that the announced name flips to "Stop … test tone" while a tone
   plays and back when it stops.
3b. With two or more anchors saved, confirm each "remove" button announces
   which anchor it removes.
4. Visual regression check on `.keyrow` and `.extract-controls` rows — the fixes
   above are attribute-only or inline-for-inline, so nothing should move.
5. Re-run the DSP harness (`tests/`, 32 checks) — untouched by this work, but
   cheap insurance since `options.js` is edited.

## Release decision

None of this blocks 0.6.0 on correctness grounds: the defects predate the
release, are not regressions, and have no functional impact. The relevant
question is whether shipping an accessibility gap in the calibration flow is
acceptable for one more version.

- **Fix into 0.6.0** — the `v0.6.0` tag is currently local and unpushed, so this
  can be amended in cleanly with no history rewrite. Cost: re-sync
  `roar-kid-store/`, rebuild the zip, re-verify the archive.
- **Defer to 0.6.1** — ship the validated 0.6.0 artifact now and land these as a
  focused accessibility pass.

**Decision (2026-07-21): fixed into 0.6.0.** `roar-kid-store/` re-synced and
`roar-kid-store.zip` rebuilt (15:16, 70700 bytes) with the full Phase 4
verification battery re-run — see RELEASE_TODO.md. The local `v0.6.0` tag
still points at the pre-fix commit; commit these changes and move the tag
before pushing.

## Amendments (2026-07-21, post-review)

A source-verification pass over the original report confirmed all six findings,
the "no broken `for` in this codebase" claim, and the layout-safety claims
(`popup.js` selects only by id, so the `vol` span→label swap is inert). It
changed four things:

1. **Finding 7 added** — the anchor-list "remove" buttons share finding 2's
   identical-name defect and were missed.
2. **The play-button fix was corrected** — the originally proposed static
   `aria-label` would have frozen the announced name across the play/stop
   toggle, hiding the state change from assistive tech. See the note in
   section 1 + 2.
3. **Scope caveat extended** — DevTools' label issues come from the autofill
   audit and skip some control types (range sliders notably), so its count
   will undercount a static audit even on the correct tab.
4. **Line references corrected** to the current source (`hzLabel` is at
   `options.js:47`; the band-row template spans 545-551; handler wiring is
   554-570).

## Implementation status

Implemented 2026-07-21 in `roar-kid/` (options.js, options.html, popup.html):
findings 1-7 fixed as proposed above, including the play/stop `aria-label`
tracking and attribute-escaping on the anchor labels. Choices on the
judgement calls: `aria-label` for the two file inputs, a visible
`<label for="anchorLabel">Setup name</label>` for the anchor text field, and
both the `for="vol"` label and `aria-label="Output volume"` on the popup
slider ("vol" judged too terse as an announced name). None of the changes
touch `dsp.js`, the worklets, or any node in the audio graph, so the
project's ANSI/CTA-2051-A digital-domain alignment (verified by the
harness; disclosures in DOCUMENTATION.md) is unaffected — including the
requirement that no new processing stage enter the chain. DSP harness
re-run after the edits: see RELEASE_TODO.md Phase 2 note; result recorded
below.

- Harness result: **32/32 passed** (headless run, 2026-07-21, after the
  edits landed).
