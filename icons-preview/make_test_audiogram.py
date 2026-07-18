"""Synthetic clinical audiogram with KNOWN thresholds — ground truth for
testing the photo-import pipeline (options page or extract_audiogram.py).

Deliberately has NO numeric table, so the model must read the plotted
symbols (the hard path): expected read_from_table = false.
"""

import json
from PIL import Image, ImageDraw, ImageFont

W, H = 1200, 900
MARGIN_L, MARGIN_R, MARGIN_T, MARGIN_B = 140, 60, 130, 90
RED = (179, 38, 30)
BLUE = (31, 78, 156)
INK = (34, 33, 29)
GRID = (200, 200, 200)

FREQS = [250, 500, 1000, 2000, 3000, 4000, 6000, 8000]
DB_MIN, DB_MAX = -10, 80

# ground truth: plausible mild-moderate sloping loss, 5 dB steps
TRUTH = {
    "right": [15, 20, 30, 40, 45, 50, 50, 45],   # red O
    "left":  [10, 15, 25, 35, 40, 45, 50, 50],   # blue X
}


def font(size):
    for path in ["/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
                 "/usr/share/fonts/TTF/DejaVuSans.ttf"]:
        try:
            return ImageFont.truetype(path, size)
        except OSError:
            continue
    return ImageFont.load_default()


def x_for(i):
    return MARGIN_L + i * (W - MARGIN_L - MARGIN_R) / (len(FREQS) - 1)


def y_for(db):
    return MARGIN_T + (db - DB_MIN) * (H - MARGIN_T - MARGIN_B) / (DB_MAX - DB_MIN)


img = Image.new("RGB", (W, H), (252, 252, 250))
d = ImageDraw.Draw(img)
f_title, f_lab, f_small = font(34), font(22), font(18)

d.text((W / 2, 40), "PURE TONE AUDIOMETRY", font=f_title, fill=INK, anchor="mm")
d.text((W / 2, 78), "Synthetic test chart — no patient", font=f_small,
       fill=(120, 120, 120), anchor="mm")

# grid
for db in range(DB_MIN, DB_MAX + 1, 10):
    y = y_for(db)
    d.line([MARGIN_L, y, W - MARGIN_R, y], fill=GRID, width=1)
    d.text((MARGIN_L - 14, y), str(db), font=f_lab, fill=INK, anchor="rm")
for i, fq in enumerate(FREQS):
    x = x_for(i)
    d.line([x, MARGIN_T, x, H - MARGIN_B], fill=GRID, width=1)
    lab = f"{fq // 1000}k" if fq >= 1000 else str(fq)
    d.text((x, H - MARGIN_B + 26), lab, font=f_lab, fill=INK, anchor="mm")

d.text((MARGIN_L - 60, MARGIN_T - 30), "Hearing Level (dB HL)", font=f_lab,
       fill=INK, anchor="lm")
d.text((W / 2, H - 28), "Frequency (Hz)", font=f_lab, fill=INK, anchor="mm")

# traces: connect then mark
for ear, color in [("right", RED), ("left", BLUE)]:
    pts = [(x_for(i), y_for(db)) for i, db in enumerate(TRUTH[ear])]
    d.line(pts, fill=color, width=3)
    for x, y in pts:
        if ear == "right":
            d.ellipse([x - 12, y - 12, x + 12, y + 12], outline=color, width=4)
        else:
            d.line([x - 11, y - 11, x + 11, y + 11], fill=color, width=4)
            d.line([x + 11, y - 11, x - 11, y + 11], fill=color, width=4)

# legend
lx, ly = W - 330, MARGIN_T + 14
d.ellipse([lx - 10, ly - 10, lx + 10, ly + 10], outline=RED, width=4)
d.text((lx + 22, ly), "Right ear (O)", font=f_lab, fill=INK, anchor="lm")
ly2 = ly + 36
d.line([lx - 9, ly2 - 9, lx + 9, ly2 + 9], fill=BLUE, width=4)
d.line([lx + 9, ly2 - 9, lx - 9, ly2 + 9], fill=BLUE, width=4)
d.text((lx + 22, ly2), "Left ear (X)", font=f_lab, fill=INK, anchor="lm")

img.save("test_audiogram.png")
json.dump(TRUTH, open("test_audiogram_truth.json", "w"), indent=2)
print("test_audiogram.png + test_audiogram_truth.json written")
print("truth:", json.dumps(TRUTH))
