# chrome.storage — sync, local, and storage-as-message-bus

Part of the [technology study map](../../TECHNOLOGIES.md).

## What it is

Extension key-value storage, asynchronous and JSON-shaped, in two main
areas with *very* different privacy semantics:

- **`chrome.storage.sync`** — roams with the user's signed-in Chrome
  profile across machines. Quota-limited (~100 KB total, ~8 KB/item).
- **`chrome.storage.local`** — this device only, never transmitted.

Plus `chrome.storage.onChanged` — an event that fires in *every* extension
context when any value changes.

## Core concepts

**Privacy-driven placement.** Where a datum lives is a privacy statement:

| Data | Area | Why |
|------|------|-----|
| Hearing thresholds, enabled flag, volume, target mode, WDRC speed, red-flags acknowledgment | `sync` | Small values; roaming them is user convenience. Thresholds are disclosed as health data in the store filing. |
| Calibration (headphone profile, per-band tone-match and mic-correction offsets) | `sync` | Describes the user's *listening setup*; owned by the options page. |
| API keys | `local`, **only on explicit "Save key"** | Credentials must never roam. A key pasted for a one-off import is used and *never stored at all* — the strongest claim in the privacy policy. |
| Loudness anchors, keyed by output-device signature | `local`, never `sync` | An anchor is a physical measurement of *this device's* hardware chain — roaming it to another machine would make it wrong by design (`content.js:155-176`). |
| Child-target attestation | `sync` (but the *gate* re-checks it) | The stored flag is convenience; `applySettings` treats un-attested "child" as comfort every time, so a tampered or half-synced value fails safe (`content.js:81`). |

This split is written into `PRIVACY_POLICY.md` and the store's data-usage
disclosures — storage choices become legal text, so make them deliberately.

**Storage as the message bus.** For settings, the popup never messages the
content script. It just writes (`popup.js:206`); the content script
subscribed with `chrome.storage.onChanged` re-reads and re-applies. (The
one true message in the project — the popup's `roar-dose` poll for live
level/dose — is the exception that proves the rule: ephemeral, per-tab,
read-on-demand telemetry is what messaging is *for*; durable settings are
what storage is for.) Effects:
- zero messaging code, zero tab-targeting logic;
- every open tab updates simultaneously;
- state and notification cannot desynchronize (the write *is* the event);
- it composes with cross-machine sync for free — plot on the desktop, and
  a laptop playing the same account updates too.

The pattern generalizes: for "settings-like" state, `storage.onChanged`
is a simpler pub/sub than `runtime.sendMessage` round-trips.

**Defaults and migration at the read edge.** Every read passes the
`DEFAULTS` object (`chrome.storage.sync.get(DEFAULTS, …)`) so missing keys
materialize with sane values, and every read passes through
`migrateBands()` which upgrades old 6-band arrays to the current 8-band
format by interpolation (`content.js:45`, `popup.js:11`). Migrating on
read (not with a one-shot upgrade script) means old and new versions can
coexist during a rollout.

**Debounced writes.** Dragging on the chart produces dozens of changes per
second; the popup coalesces them with a 150 ms timer before writing
(`popup.js:106-110`) — polite to sync quotas and to every listening tab.

## Pitfalls learned here

- `sync` write quotas are real (`MAX_WRITE_OPERATIONS_PER_MINUTE`);
  debounce anything connected to a drag or slider.
- The API is callback/Promise asynchronous — the popup draws once with
  defaults and once when the read lands (`popup.js:112-120`); design initial
  paint to tolerate that.
- Storing a key *only on explicit action* is both better UX copy and a
  materially stronger store disclosure — "never stored unless you press
  Save" is verifiable from the code.
- **Two writers, one namespace: write only the keys you own.** A naive
  `set(allSettings)` from the popup would overwrite the calibration the
  options page just saved with the popup's stale copy. The popup's `save()`
  therefore writes an explicit key list (`popup.js:206-218`) — the
  storage-area equivalent of a partial UPDATE vs. replacing the whole row.

## Further research

- https://developer.chrome.com/docs/extensions/reference/api/storage
- Search terms: "chrome.storage.sync quota", "storage.onChanged pattern",
  "chrome.storage.session", "extension settings migration".
