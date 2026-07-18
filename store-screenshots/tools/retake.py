import pathlib
from playwright.sync_api import sync_playwright

EXT = "/home/guilherme-burzynski-dienes/Documentos/script/roar-kid/roar-kid-store"
OUT = pathlib.Path(__file__).parent / "raw"

with sync_playwright() as p:
    ctx = p.chromium.launch_persistent_context(
        str(OUT / "profile-en"),
        headless=False,
        viewport={"width": 1280, "height": 1200},
        device_scale_factor=2,
        locale="en-US",
        args=[
            f"--disable-extensions-except={EXT}",
            f"--load-extension={EXT}",
            "--window-size=1300,900",
            "--lang=en-US",
            "--autoplay-policy=no-user-gesture-required",
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
    print("extension id:", ext_id)

    pg.goto(f"chrome-extension://{ext_id}/options.html")
    pg.wait_for_timeout(400)
    pg.screenshot(path=str(OUT / "options_en.png"), full_page=True)
    print("options_en captured")

    yt = ctx.new_page()
    yt.goto("https://www.youtube.com/watch?v=aqz-KE-bpKQ", wait_until="domcontentloaded")
    yt.wait_for_timeout(6000)
    for label in ("Accept all", "Reject all"):
        btn = yt.locator(f"button:has-text('{label}')").first
        if btn.count():
            try:
                btn.click(timeout=2000)
                yt.wait_for_timeout(3000)
            except Exception:
                pass
            break
    yt.keyboard.press("t")  # theater mode: full-width player, no sidebar in frame
    yt.wait_for_timeout(1500)
    # jump into a colorful scene, ensure playing
    try:
        yt.evaluate("document.querySelector('video').currentTime = 220")
    except Exception:
        pass
    # wait until the seek finished and frames are actually rendering
    for _ in range(30):
        ready = yt.evaluate("""() => {
            const v = document.querySelector('video');
            if (!v) return false;
            if (v.paused) v.play().catch(() => {});
            return v.readyState >= 3 && !v.seeking && v.currentTime > 200;
        }""")
        if ready:
            break
        yt.wait_for_timeout(1000)
    yt.wait_for_timeout(2000)
    yt.mouse.move(640, 1190)
    yt.wait_for_timeout(100)
    yt.mouse.move(5, 1195)  # park cursor in a corner so player controls fade
    yt.wait_for_timeout(4000)
    yt.screenshot(path=str(OUT / "youtube_en.png"),
                  clip={"x": 0, "y": 0, "width": 1280, "height": 800})
    print("youtube_en captured")
    ctx.close()
print("done")
