# Store screenshots — how they were made, and the technique behind them

The Chrome Web Store wants at least one screenshot, exactly **1280×800** or
**640×400** PNG. The finished shots live in [`store-screenshots/`](store-screenshots/);
the scripts that produced them are in [`store-screenshots/tools/`](store-screenshots/tools/).

This doc has two audiences: future-you shipping an update (top half), and
future-you reusing the technique on another project (bottom half).

## What exists / what's missing

| File | Content | Status |
|------|---------|--------|
| `01-popup-audiogram-1280x800.png` | Popup with a plausible mild sloping-loss audiogram, target selector (comfort/adult/child), WDRC speed toggle | ✅ refreshed 2026-07-20 for 0.5.0 (`tools/retake_v050.py`) |
| `02-options-import-1280x800.png` | Options page, keys + photo-import section (on-device default, cloud consent checkbox) | ✅ refreshed 2026-07-20 for 0.5.0 — now a section crop; the full page grew too tall to fit one frame legibly |
| `03-youtube-popup-1280x800.png` | YouTube (theater mode, Big Buck Bunny) with the 0.5.0 popup open over it (target selector, "relative — no anchor") | ✅ retaken manually 2026-07-20; cropped to 1280×800 with the profile avatar cut out and the truncated masthead button patched |
| `04-options-anchor-1280x800.png` | Options page, loudness-anchor section ("relative until anchored" note visible) | ✅ new 2026-07-20 (`tools/retake_v050.py`) |
| `05-options-calibration-1280x800.png` | Options page, calibration/response-shape section: headphone preset, tone-match sliders (1 kHz anchor), measurement-mic correction import | ✅ new 2026-07-20 (`tools/retake_v050.py`) |

## Taking screenshot 3 manually

The one shot automation couldn't deliver: Playwright cannot click the browser
toolbar, so it can never open the *real* popup over a page — and YouTube's
player showed bot-detection errors on scripted profiles anyway. By hand it's
trivial:

1. `chrome://extensions` → Developer mode → **Load unpacked** → select
   `roar-kid-store/`. (Delete any `__pycache__` first if you ran the CLI.)
2. Open <https://www.youtube.com/watch?v=aqz-KE-bpKQ> (Big Buck Bunny —
   CC-BY, Blender Foundation, safe to show). Let it play past ~1:15 so an
   actual scene is on screen.
3. Press **`t`** (theater mode) — this pushes the recommendations sidebar
   below the fold, keeping **third-party branded thumbnails out of frame**
   (our listing rule: no film/game/brand imagery).
4. Click the Roar, kid! toolbar icon so the popup with the audiogram opens
   over the playing video. The plotted thresholds are already in storage if
   you used the extension; otherwise plot a plausible mild loss first.
5. Screenshot the window (Shift+PrintScreen area-select on Ubuntu, or full
   window + crop in GIMP). Final crop must be **exactly 1280×800**, popup and
   player both visible.
6. Save as `store-screenshots/03-youtube-popup-1280x800.png`.

Dashboard accepts up to 5 screenshots — with 03, 01, 02, 04, 05 the slots
are now exactly full, in that order.

For automated retakes after a UI change, `tools/retake_v050.py` is the
current script: seeds the 0.5.0 settings shape (`redFlagsAck: true` so the
first-run notice doesn't cover the chart), captures popup + options, and
composes 01, 02, 04, and 05 (the options page is section-cropped — as one
frame the full page scales to illegibility; the crop y-coordinates are in
the script and need re-measuring if the options layout changes).

---

# Technique: automated screenshots of a Chrome extension (Playwright)

The general recipe for photographing extension UI programmatically, with
every pitfall hit on this project and its fix.

## 1. Branded Chrome won't load unpacked extensions anymore

Since **Chrome 137**, stable branded Chrome ignores `--load-extension`. Use
Playwright's bundled **Chromium** instead (`python3 -m playwright install
chromium`). Do *not* pass `channel="chrome"`.

## 2. Launching with the extension loaded

Extensions need a real (headed) browser and a persistent context:

```python
ctx = p.chromium.launch_persistent_context(
    "profile-dir",                     # throwaway; delete between runs
    headless=False,                    # extensions want a real browser + display
    viewport={"width": 1280, "height": 800},
    device_scale_factor=2,             # capture at 2× for crisp downscales
    locale="en-US",
    args=[
        f"--disable-extensions-except={EXT_DIR}",
        f"--load-extension={EXT_DIR}",
        "--lang=en-US",
        "--autoplay-policy=no-user-gesture-required",
        "--mute-audio",
    ],
)
```

## 3. Finding the extension ID

Two ways, both used here:

- **Derive it**: for unpacked extensions the ID is a function of the absolute
  path — first 32 hex chars of `sha256(path)`, each hex digit mapped `0-f` →
  `a-p`:

  ```python
  h = hashlib.sha256(path.encode()).hexdigest()[:32]
  ext_id = "".join("abcdefghijklmnop"[int(c, 16)] for c in h)
  ```

- **Read it from `chrome://extensions`** (robust against surprises; the page
  is shadow-DOM all the way down):

  ```python
  page.goto("chrome://extensions")
  ids = page.evaluate("""() => {
      const mgr  = document.querySelector('extensions-manager');
      const list = mgr.shadowRoot.querySelector('extensions-item-list');
      return [...list.shadowRoot.querySelectorAll('extensions-item')].map(i => i.id);
  }""")
  ```

  Empty list ⇒ the extension didn't load at all (see pitfall #1).

## 4. Extension pages are just pages

`chrome-extension://<id>/popup.html` and `options.html` open in normal tabs
with full `chrome.*` API access — no need to click the toolbar. The popup
renders identically to its dropdown form (same HTML/CSS; body width is fixed
in its stylesheet).

**Seeding state**: set storage from the page itself, then reload so the UI
draws it:

```python
page.goto(f"chrome-extension://{ext_id}/popup.html")
page.evaluate("s => chrome.storage.sync.set(s)", SETTINGS_DICT)
page.reload()
```

This is how the audiogram got its plotted curves without simulating clicks.

## 5. Composing exact store sizes (PIL)

Capture `full_page=True` at 2×, then: trim to content by diffing against the
known background color, pad, scale, center on a 1280×800 canvas:

```python
bbox = ImageChops.difference(img, Image.new("RGB", img.size, BG)).getbbox()
```

See `tools/compose.py` for the full pipeline (popup gets a hairline border;
options page is fit-scaled).

## 6. Pitfalls hit on this project

- **Native widgets ignore `--lang`.** The `<input type=file>` button rendered
  "Escolher arquivo" despite `locale="en-US"` + `--lang=en-US`. Native
  strings follow the **OS locale**: set `LANGUAGE` / `LC_ALL` / `LANG` env
  vars *before* launching (see `tools/options_en.py`).
- **Third-party content sneaks into frame.** YouTube's sidebar is a wall of
  branded thumbnails — a rights/branding problem in a store listing. Theater
  mode (`t`) pushes it below the fold.
- **Don't screenshot a buffering player.** Poll
  `video.readyState >= 3 && !video.seeking` (or just `currentTime > N`)
  instead of sleeping.
- **Seeking a fresh automated profile trips YouTube's defenses** — first a
  spinner, then "Something went wrong". Don't `currentTime = 220`; let it
  play. If the error appears (`.ytp-error`), reload. For anything needing the
  real toolbar popup or a trusted profile, do it manually — automation has a
  cost ceiling.
- **`sudo` can't prompt inside a non-interactive shell**, and headed browsers
  need `$DISPLAY` — this recipe assumes a desktop session.

## 7. Cleanup

Profile dirs (`raw/profile*`) are throwaway login-less Chromium profiles —
delete freely. Raw captures stay out of the repo; only composed finals are
kept in `store-screenshots/`.
