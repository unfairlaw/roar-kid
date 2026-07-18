"""Round 4: teddy bear with headphones for "Hey, Listen!".

Bear head, storybook ink outline, headphone cups in the clinical ear
colors: bear's right ear (viewer left) red, left ear blue — same
convention as the audiogram chart.
"""

from PIL import Image, ImageDraw

S = 1024
PAPER = (251, 250, 246, 255)
INK = (34, 33, 29, 255)
RED = (179, 38, 30, 255)
BLUE = (31, 78, 156, 255)
GRIDC = (216, 213, 204, 255)

FUR = (196, 147, 90, 255)
FUR_DARK = (169, 113, 58, 255)   # inner ears
MUZZLE = (233, 208, 173, 255)

SIZES = [128, 48, 32, 16]


def canvas(bg=None, radius=0.26):
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    if bg is not None:
        d.rounded_rectangle([0, 0, S - 1, S - 1], radius=S * radius, fill=bg)
    return img, d


def circle(d, cx, cy, r, **kw):
    d.ellipse([cx - r, cy - r, cx + r, cy + r], **kw)


def bear(img, d, outline=INK, ow=None, band=INK):
    """Bear head with headphones, centered."""
    if ow is None:
        ow = int(S * 0.030)
    cx, cy, hr = S * 0.50, S * 0.575, S * 0.315

    # headphone band FIRST so head and ears sit on top of it (earmuff look)
    br = hr + S * 0.075
    bw = int(S * 0.052)
    d.arc([cx - br, cy - br, cx + br, cy + br], start=180, end=360,
          fill=band, width=bw)

    # ears (top), inner ear darker
    for ex in (S * 0.315, S * 0.685):
        circle(d, ex, S * 0.295, S * 0.125, fill=FUR, outline=outline, width=ow)
        circle(d, ex, S * 0.295, S * 0.062, fill=FUR_DARK)

    # head
    circle(d, cx, cy, hr, fill=FUR, outline=outline, width=ow)

    # muzzle + nose + mouth
    mw, mh = S * 0.17, S * 0.125
    d.ellipse([cx - mw, cy + S * 0.055 - mh, cx + mw, cy + S * 0.055 + mh],
              fill=MUZZLE, outline=outline, width=int(ow * 0.75))
    nw, nh = S * 0.052, S * 0.038
    ny = cy + S * 0.015
    d.ellipse([cx - nw, ny - nh, cx + nw, ny + nh], fill=INK)
    d.line([cx, ny + nh, cx, ny + S * 0.075], fill=INK, width=int(S * 0.016))

    # eyes
    for ex in (cx - S * 0.125, cx + S * 0.125):
        circle(d, ex, cy - S * 0.075, S * 0.032, fill=INK)

    # ear cups: viewer-left = bear's RIGHT ear = red; viewer-right = blue
    cup_w, cup_h = S * 0.115, S * 0.20
    cup_y = cy - S * 0.02
    for side, color in [(-1, RED), (1, BLUE)]:
        ccx = cx + side * (hr + S * 0.012)
        d.rounded_rectangle(
            [ccx - cup_w, cup_y - cup_h / 2, ccx + cup_w, cup_y + cup_h / 2],
            radius=cup_w * 0.9, fill=color, outline=outline, width=ow)
    return img


def v_bear_paper():
    img, d = canvas(PAPER)
    d.rounded_rectangle([0, 0, S - 1, S - 1], radius=S * 0.26,
                        outline=GRIDC, width=int(S * 0.02))
    return bear(img, d)


def v_bear_ink():
    img, d = canvas(INK)
    # ink-on-ink band would vanish; use dark wood brown instead
    return bear(img, d, outline=INK, band=FUR_DARK)


def v_bear_blue():
    img, d = canvas(BLUE, radius=0.30)
    return bear(img, d)


def render(name, img):
    for size in SIZES:
        img.resize((size, size), Image.LANCZOS).save(f"{name}_{size}.png")
    print(name, "done")


if __name__ == "__main__":
    render("m_bearpaper", v_bear_paper())
    render("n_bearink", v_bear_ink())
    render("o_bearblue", v_bear_blue())
