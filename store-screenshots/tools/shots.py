import hashlib, pathlib, time
from playwright.sync_api import sync_playwright

EXT = "/home/guilherme-burzynski-dienes/Documentos/script/roar-kid/roar-kid-store"
OUT = pathlib.Path(__file__).parent / "raw"
OUT.mkdir(exist_ok=True)

def find_ext_id(ctx):
    pg = ctx.new_page()
    pg.goto("chrome://extensions")
    pg.wait_for_timeout(500)
    ids = pg.evaluate("""() => {
        const mgr = document.querySelector('extensions-manager');
        const list = mgr.shadowRoot.querySelector('extensions-item-list');
        return [...list.shadowRoot.querySelectorAll('extensions-item')].map(i => i.id);
    }""")
    pg.close()
    if not ids:
        raise RuntimeError("extension did not load")
    return ids[0]

AUDIOGRAM = {
    "enabled": True,
    "right": [15, 20, 25, 30, 35, 40, 40, 35],
    "left":  [10, 15, 20, 25, 30, 35, 40, 40],
    "masterVolume": 1.0,
}

with sync_playwright() as p:
    ctx = p.chromium.launch_persistent_context(
        str(OUT / "profile"),
        headless=False,
        viewport={"width": 1280, "height": 800},
        device_scale_factor=2,
        args=[
            f"--disable-extensions-except={EXT}",
            f"--load-extension={EXT}",
            "--window-size=1300,900",
            "--autoplay-policy=no-user-gesture-required",
            "--mute-audio",
        ],
    )
    ext_id = find_ext_id(ctx)
    print("extension id:", ext_id)
    page = ctx.new_page()

    # seed settings, then reload so the popup draws them
    page.goto(f"chrome-extension://{ext_id}/popup.html")
    page.evaluate("s => chrome.storage.sync.set(s)", AUDIOGRAM)
    page.reload()
    page.wait_for_timeout(400)
    page.screenshot(path=str(OUT / "popup.png"), full_page=True)
    print("popup captured")

    page.goto(f"chrome-extension://{ext_id}/options.html")
    page.wait_for_timeout(400)
    page.screenshot(path=str(OUT / "options.png"), full_page=True)
    print("options captured")

    # YouTube with the content script active (Big Buck Bunny, open movie)
    yt = ctx.new_page()
    yt.goto("https://www.youtube.com/watch?v=aqz-KE-bpKQ", wait_until="domcontentloaded")
    yt.wait_for_timeout(6000)
    # dismiss consent dialog if present
    for label in ("Accept all", "Aceitar tudo", "Reject all", "Recusar tudo"):
        btn = yt.locator(f"button:has-text('{label}')").first
        if btn.count():
            try:
                btn.click(timeout=2000)
                yt.wait_for_timeout(3000)
            except Exception:
                pass
            break
    try:
        yt.keyboard.press("k")  # ensure playing
    except Exception:
        pass
    yt.wait_for_timeout(4000)
    yt.mouse.move(640, 200)  # move pointer off the player so controls hide
    yt.wait_for_timeout(3500)
    yt.screenshot(path=str(OUT / "youtube.png"))
    print("youtube captured")

    ctx.close()
print("done")
