# Chrome Extensions — Manifest V3

Part of the [technology study map](../../TECHNOLOGIES.md).

## What it is

A Chrome extension is a zip of ordinary web files (HTML, JS, CSS, images)
plus one special file — `manifest.json` — that declares, up front and
immutably, everything the extension is allowed to touch. The browser
enforces those declarations; the store reviews them. Manifest V3 (MV3) is
the current generation of that contract, and its design theme is
*auditability*: if a reviewer reads the manifest and the bundled code,
they have seen everything the extension can ever do.

## Core concepts

**The three worlds an extension runs in.**
1. *Extension pages* (popup, options page) — normal pages served from
   `chrome-extension://<id>/`, with access to `chrome.*` APIs granted by
   the manifest.
2. *Content scripts* — JS injected into other sites' pages. They see the
   page's DOM but run in an "isolated world": same DOM, separate JS
   globals. They get only a small slice of `chrome.*` (storage, runtime
   messaging).
3. *Background service worker* — an event-driven worker with no DOM,
   killed when idle. **This project has none**, which is worth noticing:
   if your architecture can be "pages + content script + storage events",
   you skip an entire class of service-worker lifetime bugs.

**Permissions are two different things.**
- *API permissions* (`"permissions": ["storage"]`) unlock `chrome.*` APIs.
- *Host permissions* (`"host_permissions": [...]`) unlock reading/injecting
  into specific origins — and, for `fetch`, exempt those origins from CORS.
  Roar, kid! uses host permissions in both senses: streaming sites for the
  content script, AI API hosts so the options page can call them directly.

**The remote-code ban.** MV3 forbids executing code the package doesn't
contain: no CDN `<script>`, no `eval` of downloaded strings. Extension CSP
enforces most of it mechanically. Data is fine — Roar, kid!'s photo import
exchanges JSON with AI APIs and never executes any of it, which is exactly
the line the store's "are you using remote code?" question probes.

**`web_accessible_resources`, messaging, `chrome.runtime.getURL`.** Files
inside the package are addressable by URL. Extension pages can read any
packaged file that way (`chrome.runtime.getURL("prompt.txt")` — a *file
read*, not a network fetch, an important distinction in store review).
But when the *page's* machinery must fetch the file — as with
`audioWorklet.addModule()` loading the DSP worklets from a content
script — the manifest must list those files under
`web_accessible_resources`, scoped to the streaming-site origins. That is
the only reason the key exists in this manifest.

## How Roar, kid! uses it

`roar-kid/manifest.json` in full:
- `content_scripts` → `content.js` on five URL patterns (YouTube, Netflix,
  Prime Video, two amazon.com video paths), `run_at: document_idle`.
- `action.default_popup` → `popup.html` (the audiogram editor).
- `options_page` → `options.html` (keys + photo import). The popup deep-links
  to it with `chrome.runtime.openOptionsPage()` (`popup.js:103`).
- `permissions: ["storage"]` — the only API permission. No `tabs`, no
  `scripting`, no `activeTab`: nothing else was needed, and every
  permission you don't request is a review question you never get asked.
- `host_permissions` — streaming sites + four AI API origins.
- `web_accessible_resources` — the two worklet files, for the reason above.
- `browser_specific_settings.gecko` — an extension ID + minimum version
  for a possible future Firefox port; Chrome ignores the key.

Notable absences: no background worker, and *settings* never travel by
message — they flow through `chrome.storage.onChanged` (see the
[storage doc](05-chrome-storage.md)). The one message that does exist is a
popup → content-script poll (`chrome.tabs.sendMessage`, type `roar-dose`)
for the live level/dose readout — ephemeral telemetry, queried on demand,
which is exactly the kind of state storage would be wrong for.

## Pitfalls learned here

- The store rejects archives containing files whose names start with `_`
  (`__pycache__/` — created just by running the Python CLI in the folder).
- The manifest `description` has a 132-character limit that is only
  enforced at upload time — this project hit it twice (152 chars at 0.3.0,
  156 at 0.5.0 after the wellness reframe; both rewritten under the cap).
- One media element can host only one `MediaElementSource` *ever*; a second
  extension capturing the same `<video>` throws — the content script
  crash-guards and backs off rather than retrying (`content.js:134`).

## Further research

- MV3 docs: https://developer.chrome.com/docs/extensions/develop
- Store program policies: https://developer.chrome.com/docs/webstore/program-policies
- Search terms: "isolated world content script", "MV3 service worker
  lifetime", "host_permissions CORS", "web_accessible_resources".
