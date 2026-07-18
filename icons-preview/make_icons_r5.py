"""Round 5: storybook lion with headphones for "Hey, Listen!".

Paper tile, ink outline, headphone cups in the clinical ear colors
(viewer-left red = lion's right ear, viewer-right blue = left ear).
Two mane styles: scalloped (cloud) and sunburst (spikes).
"""

import math
from PIL import Image, ImageDraw

S = 1024
PAPER = (251, 250, 246, 255)
INK = (34, 33, 29, 255)
RED = (179, 38, 30, 255)
BLUE = (31, 78, 156, 255)
GRIDC = (216, 213, 204, 255)

MANE = (191, 111, 44, 255)
FACE = (228, 172, 96, 255)
MUZZLE = (243, 220, 180, 255)

SIZES = [128, 48, 32, 16]
CX, CY = S * 0.50, S * 0.55


def canvas():
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([0, 0, S - 1, S - 1], radius=S * 0.26, fill=PAPER)
    d.rounded_rectangle([0, 0, S - 1, S - 1], radius=S * 0.26,
                        outline=GRIDC, width=int(S * 0.02))
    return img, d


def circle(d, cx, cy, r, **kw):
    d.ellipse([cx - r, cy - r, cx + r, cy + r], **kw)


def band(d):
    """Headphone band, drawn first so everything sits on top of it."""
    br = S * 0.40
    d.arc([CX - br, CY - br, CX + br, CY + br], start=180, end=360,
          fill=INK, width=int(S * 0.052))


def mane_scalloped(d, ow):
    ring_r, scallop_r = S * 0.26, S * 0.105
    for i in range(11):
        a = math.pi * 2 * i / 11 - math.pi / 2
        circle(d, CX + ring_r * math.cos(a), CY + ring_r * math.sin(a),
               scallop_r, fill=MANE, outline=INK, width=ow)
    circle(d, CX, CY, S * 0.30, fill=MANE)  # unify interior


def mane_sunburst(d, ow):
    pts = []
    n = 13
    r_in, r_out = S * 0.285, S * 0.375
    for i in range(n * 2):
        r = r_out if i % 2 == 0 else r_in
        a = math.pi * i / n - math.pi / 2
        pts.append((CX + r * math.cos(a), CY + r * math.sin(a)))
    d.polygon(pts, fill=MANE, outline=INK, width=ow)


def lion_face(d, ow):
    circle(d, CX, CY, S * 0.225, fill=FACE, outline=INK, width=ow)
    # eyes
    for ex in (CX - S * 0.105, CX + S * 0.105):
        circle(d, ex, CY - S * 0.06, S * 0.028, fill=INK)
    # muzzle + nose + mouth
    mw, mh = S * 0.15, S * 0.11
    my = CY + S * 0.055
    d.ellipse([CX - mw, my - mh, CX + mw, my + mh],
              fill=MUZZLE, outline=INK, width=int(ow * 0.75))
    nw, nh = S * 0.048, S * 0.034
    ny = CY + S * 0.01
    d.ellipse([CX - nw, ny - nh, CX + nw, ny + nh], fill=INK)
    d.line([CX, ny + nh, CX, ny + S * 0.065], fill=INK, width=int(S * 0.015))


TONGUE = (214, 106, 93, 255)


def lion_face_roaring(d, ow, roar_lines=False):
    """Mid-roar: eyes squeezed happy-shut, mouth wide open."""
    circle(d, CX, CY, S * 0.225, fill=FACE, outline=INK, width=ow)
    # closed happy eyes: downward-opening arcs
    er = S * 0.042
    for ex in (CX - S * 0.105, CX + S * 0.105):
        ey = CY - S * 0.055
        d.arc([ex - er, ey - er, ex + er, ey + er], start=200, end=340,
              fill=INK, width=int(S * 0.018))
    # muzzle
    mw, mh = S * 0.15, S * 0.115
    my = CY + S * 0.055
    d.ellipse([CX - mw, my - mh, CX + mw, my + mh],
              fill=MUZZLE, outline=INK, width=int(ow * 0.75))
    # nose
    nw, nh = S * 0.046, S * 0.032
    ny = CY + S * 0.005
    d.ellipse([CX - nw, ny - nh, CX + nw, ny + nh], fill=INK)
    # wide-open mouth with two upper teeth
    mo_w, mo_h = S * 0.088, S * 0.082
    mo_y = CY + S * 0.105
    d.ellipse([CX - mo_w, mo_y - mo_h, CX + mo_w, mo_y + mo_h], fill=INK)
    tw, th = S * 0.032, S * 0.042
    t_top = mo_y - mo_h + S * 0.012
    for side in (-1, 1):
        tx = CX + side * S * 0.036
        d.rounded_rectangle([tx - tw / 2, t_top, tx + tw / 2, t_top + th],
                            radius=tw / 2.5, fill=PAPER)
    if roar_lines:
        # short strokes fanning from the mouth: the roar made visible
        lw = int(S * 0.020)
        for side in (-1, 1):
            for dx, dy1, dy2 in [(0.155, 0.075, 0.045), (0.175, 0.135, 0.135),
                                 (0.155, 0.195, 0.225)]:
                x1 = CX + side * S * dx
                x2 = CX + side * S * (dx + 0.055)
                d.line([x1, CY + S * dy1, x2, CY + S * dy2], fill=INK, width=lw)


def cups(d, ow):
    cup_w, cup_h = S * 0.115, S * 0.20
    cup_y = CY - S * 0.02
    for side, color in [(-1, RED), (1, BLUE)]:
        ccx = CX + side * S * 0.30
        d.rounded_rectangle(
            [ccx - cup_w, cup_y - cup_h / 2, ccx + cup_w, cup_y + cup_h / 2],
            radius=cup_w * 0.9, fill=color, outline=INK, width=ow)


def build(mane_fn, face_fn=None):
    img, d = canvas()
    ow = int(S * 0.026)
    band(d)
    mane_fn(d, ow)
    (face_fn or lion_face)(d, ow)
    cups(d, ow)
    return img


def render(name, img):
    for size in SIZES:
        img.resize((size, size), Image.LANCZOS).save(f"{name}_{size}.png")
    print(name, "done")


if __name__ == "__main__":
    render("p_lionscallop", build(mane_scalloped))
    render("q_lionburst", build(mane_sunburst))
    render("r_lionroar", build(mane_scalloped, lambda d, ow:
           lion_face_roaring(d, ow, roar_lines=False)))
    render("s_lionroarlines", build(mane_scalloped, lambda d, ow:
           lion_face_roaring(d, ow, roar_lines=True)))
