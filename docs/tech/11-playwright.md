# Playwright — extension testing and screenshot production

Part of the [technology study map](../../TECHNOLOGIES.md).

## What it is

Scriptable automation of a *real* browser (same family as Puppeteer and
Selenium, with a cleaner API). In this project it served two distinct
jobs: end-to-end verification of the options page, and manufacturing the
Chrome Web Store screenshots. Scripts live in `store-screenshots/tools/`;
the method writeup (including what could *not* be automated) is
`SCREENSHOTS.md`.

## Core techniques (extension-specific)

**Loading an extension.** Extensions require a persistent context and
launch flags:

```python
p.chromium.launch_persistent_context(
    profile_dir, headless=False,
    args=[f"--disable-extensions-except={EXT}", f"--load-extension={EXT}"],
)
```

Headed mode (`headless=False`) is the compatibility-safe choice for
extension work.

**Finding the extension id.** Unpacked extension ids are derived from the
path; rather than hardcoding, the tooling reads it out of
`chrome://extensions` — which is shadow-DOM all the way down:

```python
page.evaluate("""() => {
  const mgr = document.querySelector('extensions-manager');
  const list = mgr.shadowRoot.querySelector('extensions-item-list');
  return [...list.shadowRoot.querySelectorAll('extensions-item')].map(i => i.id);
}""")
```

Then any extension page is reachable as
`chrome-extension://<id>/popup.html`.

**Seeding state before capture.** Screenshots need data. The tooling
navigates to an extension page and writes directly:
`page.evaluate("s => chrome.storage.sync.set(s)", AUDIOGRAM)`, then
reloads so the UI draws it. Faster and more reproducible than simulating
forty pointer events — and the plotted curve is guaranteed to be
*throwaway data*, never real thresholds.

**Locale is two different knobs.** Playwright's `locale=` sets the browser
locale, but **native widgets** (the file input's "Choose File") follow the
OS environment — a store screenshot came out saying "Escolher arquivo"
until the script exported `LANG`/`LC_ALL`/`LANGUAGE=en_US.UTF-8` *before*
launching. Both knobs, always.

**High-DPI capture.** `device_scale_factor: 2` renders crisp images that
downscale beautifully into the store's exact 1280×800 requirement;
PIL does the trim-to-content and framing (`compose.py`).

**Availability-gated UI in a bare Chromium.** Playwright's bundled
Chromium has no Gemini Nano, so the built-in-AI button hides itself. The
capture script un-hides it with the same style toggle the real
availability check performs — showing a genuine UI state the automation
environment can't reach naturally (documented transparently in the shot's
provenance).

**The hard limits — know what can't be automated.**
- Playwright cannot click the browser toolbar, so the real popup opened
  *over a page* is forever a manual screenshot (recipe in
  `SCREENSHOTS.md`).
- YouTube shows bot-detection errors on scripted profiles; the manual
  path uses a real profile.

**E2E verification pattern.** The options-page test drives the packaged
extension, exercises the key UX, and asserts on `#err`/`#busy` *and* zero
console errors. That run also debunked a false bug report ("status
messages vanished") — the cause was a stale loaded copy; the fix is
reloading the extension card *and* reopening the options tab. Automation
verifying the packaged artifact catches an entire class of "works from
source" illusions.

## Further research

- https://playwright.dev/python/
- Search terms: "playwright chrome extension persistent context",
  "playwright shadow DOM piercing", "device_scale_factor screenshot",
  "testing chrome.storage".
