"""Retake store shots 01 (popup) and 02 (options) for the 0.5.0 UI.

Same recipe as shots.py + options_en.py (see SCREENSHOTS.md), with the
0.5.0 settings shape seeded: redFlagsAck acknowledged so the first-run
notice doesn't cover the chart, comfort target, fast WDRC. Shot 03
(popup over YouTube) stays manual — Playwright can't click the toolbar.
"""

import os, pathlib

# Native widgets (e.g. <input type=file>) follow the OS locale, not --lang.
os.environ["LANGUAGE"] = "en_US.UTF-8"
os.environ["LC_ALL"] = "en_US.UTF-8"
os.environ["LANG"] = "en_US.UTF-8"

from playwright.sync_api import sync_playwright
from PIL import Image, ImageChops, ImageDraw

EXT = "/home/guilherme-burzynski-dienes/Documentos/script/roar-kid/roar-kid-store"
RAW = pathlib.Path(__file__).parent / "raw"
OUT = pathlib.Path("/home/guilherme-burzynski-dienes/Documentos/script/roar-kid/store-screenshots")
RAW.mkdir(exist_ok=True)
PAPER = (251, 250, 246)

# Throwaway curves (same plausible mild sloping loss as the 0.3.0 shots).
SETTINGS = {
    "enabled": True,
    "right": [15, 20, 25, 30, 35, 40, 40, 35],
    "left":  [10, 15, 20, 25, 30, 35, 40, 40],
    "masterVolume": 1.0,
    "targetMode": "comfort",
    "wdrcSpeed": "fast",
    "redFlagsAck": True,  # notice already acknowledged; show the working UI
}

with sync_playwright() as p:
    ctx = p.chromium.launch_persistent_context(
        str(RAW / "profile-v050"),
        headless=False,
        viewport={"width": 1280, "height": 1200},
        device_scale_factor=2,
        locale="en-US",
        args=[
            f"--disable-extensions-except={EXT}",
            f"--load-extension={EXT}",
            "--window-size=1300,900",
            "--lang=en-US",
            "--mute-audio",
        ],
    )
    pg = ctx.new_page()
    pg.goto("chrome://extensions")
    pg.wait_for_timeout(500)
    ext_id = pg.evaluate("""() => {
        const mgr = document.querySelector('extensions-manager');
        const list = mgr.shadowRoot.querySelector('extensions-item-list');
        return [...list.shadowRoot.querySelectorAll('extensions-item')].map(i => i.id)[0];
    }""")
    if not ext_id:
        raise RuntimeError("extension did not load")
    print("extension id:", ext_id)

    pg.goto(f"chrome-extension://{ext_id}/popup.html")
    pg.evaluate("s => chrome.storage.sync.set(s)", SETTINGS)
    pg.reload()
    pg.wait_for_timeout(600)
    pg.screenshot(path=str(RAW / "popup_v050.png"), full_page=True)
    print("popup captured")

    pg.goto(f"chrome-extension://{ext_id}/options.html")
    pg.wait_for_timeout(600)
    pg.screenshot(path=str(RAW / "options_v050.png"), full_page=True)
    print("options captured")
    ctx.close()

def trim_to_content(img, bg=PAPER, pad=16):
    base = Image.new("RGB", img.size, bg)
    bbox = ImageChops.difference(img.convert("RGB"), base).getbbox()
    l, t, r, b = bbox
    l = max(0, l - pad); t = max(0, t - pad)
    r = min(img.width, r + pad); b = min(img.height, b + pad)
    return img.crop((l, t, r, b))

# 01 popup: trim, frame centered on paper with a hairline border
popup = trim_to_content(Image.open(RAW / "popup_v050.png"))
canvas = Image.new("RGB", (1280, 800), PAPER)
target_h = 744
scale = target_h / popup.height
card = popup.resize((round(popup.width * scale), target_h), Image.LANCZOS)
x = (1280 - card.width) // 2
y = (800 - card.height) // 2
canvas.paste(card, (x, y))
d = ImageDraw.Draw(canvas)
d.rectangle([x - 1, y - 1, x + card.width, y + card.height], outline=(216, 213, 204), width=1)
canvas.save(OUT / "01-popup-audiogram-1280x800.png")
print("popup composed:", card.size)

# 02 options: fit the full page into the frame
opt = trim_to_content(Image.open(RAW / "options_v050.png").convert("RGB"), pad=48)
canvas = Image.new("RGB", (1280, 800), PAPER)
scale = min(1280 / opt.width, 800 / opt.height)
fit = opt.resize((round(opt.width * scale), round(opt.height * scale)), Image.LANCZOS)
canvas.paste(fit, ((1280 - fit.width) // 2, (800 - fit.height) // 2))
canvas.save(OUT / "02-options-import-1280x800.png")
print("options composed:", fit.size)
