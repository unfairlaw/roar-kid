from PIL import Image, ImageChops, ImageDraw
import pathlib

RAW = pathlib.Path(__file__).parent / "raw"
OUT = pathlib.Path("/home/guilherme-burzynski-dienes/Documentos/script/roar-kid/store-screenshots")
OUT.mkdir(exist_ok=True)
PAPER = (251, 250, 246)

def trim_to_content(img, bg=PAPER, pad=16):
    base = Image.new("RGB", img.size, bg)
    bbox = ImageChops.difference(img.convert("RGB"), base).getbbox()
    l, t, r, b = bbox
    l = max(0, l - pad); t = max(0, t - pad)
    r = min(img.width, r + pad); b = min(img.height, b + pad)
    return img.crop((l, t, r, b))

# 1) popup: crop from full-page capture, frame centered on paper
popup = trim_to_content(Image.open(RAW / "popup.png"))
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
print("popup:", card.size)

# 2) options page: fit full page into the frame
opt = Image.open(RAW / "options_en.png").convert("RGB")
opt = trim_to_content(opt, pad=0)  # drop excess bottom whitespace, keep layout
canvas = Image.new("RGB", (1280, 800), PAPER)
scale = min(1280 / opt.width, 800 / opt.height)
fit = opt.resize((round(opt.width * scale), round(opt.height * scale)), Image.LANCZOS)
canvas.paste(fit, ((1280 - fit.width) // 2, (800 - fit.height) // 2))
canvas.save(OUT / "02-options-import-1280x800.png")
print("options:", fit.size)
print("saved to", OUT)
