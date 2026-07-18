# Packaging & Release

## TL;DR — which zip do I upload?

Upload **`roar-kid-store.zip`** to the Chrome Web Store.

Do **not** upload `roar-kid.zip` — that is the source/dev bundle.

## Why two zips exist

| Zip | Contents | Purpose |
|-----|----------|---------|
| **`roar-kid-store.zip`** | Runtime files only, at the **top level** of the archive: `manifest.json`, `popup.html`, `options.html`, `content.js`, `options.js`, `popup.js`, `prompt.txt`, `prompt-builtin.txt`, `icons/`. | **Upload this.** It is exactly what the extension needs and nothing else. |
| `roar-kid.zip` | Everything nested inside a `roar-kid/` folder, including `README.md`, `DOCUMENTATION.md`, `PRIVACY_POLICY.md`, `STORE_SUBMISSION.md`, and the standalone `extract_audiogram.py` Python CLI. | Source archive / backup. **Not** for the store. |

Two reasons the store copy is separate:

1. **Structure.** The store expects the manifest and files at the archive root.
   `roar-kid.zip` wraps everything in a `roar-kid/` folder, which the store would
   reject or misread.
2. **Cleanliness.** `roar-kid.zip` ships docs and a Python file that aren't part
   of the extension. A reviewer scanning `extract_audiogram.py` could raise
   questions even though it's harmless. The store package carries no such
   surface.

## Rebuilding the store zip

`roar-kid-store/` is the runtime subset of `roar-kid/`. After editing any runtime
file in `roar-kid/`, sync it over and repackage:

```sh
# from the repo root
cp roar-kid/manifest.json roar-kid/popup.html roar-kid/options.html \
   roar-kid/content.js roar-kid/options.js roar-kid/popup.js \
   roar-kid/prompt.txt roar-kid/prompt-builtin.txt roar-kid-store/
cp roar-kid/icons/*.png roar-kid-store/icons/

rm -f roar-kid-store.zip
( cd roar-kid-store && zip -r -FS ../roar-kid-store.zip . -x "*.DS_Store" -q )
```

> [!NOTE]
> Never let a `__pycache__/` directory into either the folder or the zip —
> Chrome rejects any file or directory whose name starts with `_`. It appears
> in `roar-kid/` whenever Python runs `extract_audiogram.py`. The zip commands
> here exclude it, but if you load an unpacked folder, delete `__pycache__`
> first (or run the CLI with `python3 -B`).

Verify the archive is clean before uploading:

```sh
unzip -l roar-kid-store.zip                       # top-level files, no wrapper folder
unzip -l roar-kid-store.zip | grep -iE 'pycache|\.pyc'   # should print nothing
```

## Submission checklist (human steps)

The extension code is done; these are the things only you can do in the
[developer dashboard](https://chrome.google.com/webstore/devconsole)
(one-time $5 registration). The paste-ready listing text — name, description,
single-purpose statement, permission justifications, and data disclosures —
lives in [`roar-kid/STORE_SUBMISSION.md`](roar-kid/STORE_SUBMISSION.md).

- [ ] Register the developer account ($5, one-time).
- [ ] **Upload `roar-kid-store.zip`** → New item.
- [ ] Paste listing text from `roar-kid/STORE_SUBMISSION.md`.
- [ ] **Host the privacy policy.** Put `roar-kid/PRIVACY_POLICY.md` at a public
      URL (push this repo to GitHub and use the raw file link, or GitHub Pages)
      and paste that URL into the dashboard's Privacy tab. It is referenced by
      link, not bundled in the zip.
- [ ] Add screenshots (1280×800 or 640×400 PNG) taken with the extension
      loaded — the popup over a playing YouTube video is the strongest shot.
- [ ] Declare **"No, I am not using remote code."** All logic ships in the
      package; API calls exchange JSON data, not executable code.
- [ ] Submit. Review for host-permission + health-data extensions typically
      takes several days; answer any reviewer email promptly.
