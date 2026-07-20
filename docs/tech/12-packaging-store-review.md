# Packaging & Chrome Web Store review

Part of the [technology study map](../../TECHNOLOGIES.md).

## What it is

The path from a source folder to a reviewed, public store listing — half
build discipline, half regulatory paperwork. The operational docs are
`PACKAGING.md` (how to build) and `roar-kid/STORE_SUBMISSION.md` (every
dashboard field, paste-ready); this doc is the *why* behind them.

## Core concepts

**Two zips, permanently.**
- `roar-kid-store.zip` — runtime files only, **at the archive root** (the
  store rejects or misreads a wrapper folder). This is the upload.
- `roar-kid.zip` — the source bundle (nested folder, docs, Python CLI).
  Never uploaded: a reviewer scanning an unexplained `.py` file is a
  question you don't need to invite.

`roar-kid-store/` exists as a *structural* guarantee of that split — a
folder that never contains anything unshippable — rather than trusting a
zip command's exclude flags. (Both also exclude `__pycache__`; the store
rejects `_`-prefixed names.)

**Hard field limits, discovered by hitting them.**
| Field | Limit | This project's encounter |
|---|---|---|
| manifest `description` | 132 chars | hit **twice**: 152 at 0.3.0, then 156 again at 0.5.0 after the wellness reframe (now 126) |
| listing summary | 132 chars | budgeted from the start (126/130) |
| test instructions | 500 chars | long version kept for reviewer email |

Also: dashboard text fields keep newlines *literally* — paste-ready text
must be one line per paragraph, or the listing renders broken mid-sentence
(the kit's descriptions are single-line on purpose).

**The review-sensitive trio for this extension:**
1. *Health data.* Hearing thresholds are health information — disclosed as
   such (stored locally, transmitted nowhere by the extension), plus
   authentication info for the user-supplied keys. Only those two
   categories; everything else genuinely doesn't apply (no analytics, no
   server, audio never recorded).
2. *Host permissions.* Three streaming sites and four AI origins on a
   hearing extension read as a lot; each has a one-paragraph justification
   ready, and the standing decision is: justify first, consider a reduced
   build only after a formal rejection — never preemptively strip.
3. *Remote code.* The answer is a confident "No": all logic ships in the
   package, API responses are JSON data that is parsed, never executed;
   the prompts are bundled files read via `chrome.runtime.getURL`. The
   `anthropic-dangerous-direct-browser-access` header is an official CORS
   opt-in, with Anthropic's docs cited in the kit for reviewers.

**Listing hygiene.** Screenshots must be exactly 1280×800 (or 640×400),
contain no third-party brand imagery — which rules out any Netflix/Prime
frame, since their entire catalog is branded; the safe shot is an openly
licensed film (Big Buck Bunny) on YouTube — no real patient data (plot
throwaway curves), and no personal traces (profile avatars cropped out).
The name/icon carry their own diligence: originality checked against the
store and USPTO, domain availability, zero game/film references.

**Updates over a live listing (learned when 0.3.0 was approved,
2026-07-20).** Shipping a new version to an already-published item is a
different, smaller ritual than first submission, with its own rules:
- the manifest version must be *strictly greater* than the live one;
- only the item **title** follows the uploaded manifest; summary,
  description, and screenshots are dashboard fields that silently keep
  their old text — rename in the manifest and you must re-paste the
  listing or ship a mismatched storefront;
- unchanged permissions are the fast path: no new justifications, no
  re-approval prompt shown to existing users, typically a quicker review.
  Adding a permission in an update triggers both — which is a reason to
  design permissions maximally on first submission (as this project did
  with all four AI hosts) rather than trickling them in;
- existing installs auto-update after approval, so a broken update
  *reaches everyone*; the release gate (real-listening test before merge)
  matters more once there are users.
The paste-ready update runbook lives in `STORE_SUBMISSION.md`
("Updating a published release").

**Localized listings ≠ separate stores.** One global store, one review;
pt-BR is a second *listing language* added in the dashboard, shown
automatically to pt-BR Chrome users. (Localizing the extension UI itself
would be separate `_locales/` work.)

**Test instructions are leverage.** A reviewer who can exercise the
extension in two minutes without credentials is a fast approval; the
491-char version front-loads exactly that, and preempts the two "bugs" a
reviewer would otherwise file (no bundled key — by design; built-in AI
button absent — hardware-gated by Chrome).

## Further research

- https://developer.chrome.com/docs/webstore/publish
- https://developer.chrome.com/docs/webstore/program-policies
- Search terms: "chrome web store single purpose", "limited use policy",
  "data usage disclosures", "featured badge requirements".
