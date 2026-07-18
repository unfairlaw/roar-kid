import os, pathlib
os.environ["LANGUAGE"] = "en_US.UTF-8"
os.environ["LC_ALL"] = "en_US.UTF-8"
os.environ["LANG"] = "en_US.UTF-8"
from playwright.sync_api import sync_playwright
from PIL import Image, ImageChops

EXT = "/home/guilherme-burzynski-dienes/Documentos/script/roar-kid/roar-kid-store"
RAW = pathlib.Path(__file__).parent / "raw"
OUT = pathlib.Path("/home/guilherme-burzynski-dienes/Documentos/script/roar-kid/store-screenshots")
PAPER = (251, 250, 246)

with sync_playwright() as p:
    ctx = p.chromium.launch_persistent_context(
        str(RAW / "profile-en2"),
        headless=False,
        viewport={"width": 1280, "height": 800},
        device_scale_factor=2,
        locale="en-US",
        args=[f"--disable-extensions-except={EXT}", f"--load-extension={EXT}",
              "--window-size=1300,900", "--lang=en-US"],
    )
    pg = ctx.new_page()
    pg.goto("chrome://extensions")
    pg.wait_for_timeout(500)
    ext_id = pg.evaluate("""() => {
        const mgr = document.querySelector('extensions-manager');
        const list = mgr.shadowRoot.querySelector('extensions-item-list');
        return [...list.shadowRoot.querySelectorAll('extensions-item')].map(i => i.id)[0];
    }""")
    pg.goto(f"chrome-extension://{ext_id}/options.html")
    pg.wait_for_timeout(400)
    pg.screenshot(path=str(RAW / "options_en2.png"), full_page=True)
    ctx.close()

img = Image.open(RAW / "options_en2.png").convert("RGB")
base = Image.new("RGB", img.size, PAPER)
l, t, r, b = ImageChops.difference(img, base).getbbox()
pad = 48
img = img.crop((max(0, l - pad), max(0, t - pad), min(img.width, r + pad), min(img.height, b + pad)))
canvas = Image.new("RGB", (1280, 800), PAPER)
scale = min(1280 / img.width, 800 / img.height)
fit = img.resize((round(img.width * scale), round(img.height * scale)), Image.LANCZOS)
canvas.paste(fit, ((1280 - fit.width) // 2, (800 - fit.height) // 2))
canvas.save(OUT / "02-options-import-1280x800.png")
print("recomposed", fit.size)
