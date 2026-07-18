"""Round 3: wooden toy sword variants for "Hey, Listen!".

Generic toy sword (round tip, wood grain, simple straight crossguard) —
deliberately NOT the Master Sword silhouette. Drawn vertically on its own
layer, rotated 45 deg, composited onto a rounded tile.
"""

from PIL import Image, ImageDraw

S = 1024
PAPER = (251, 250, 246, 255)
INK = (34, 33, 29, 255)
RED = (179, 38, 30, 255)
BLUE = (31, 78, 156, 255)
GRIDC = (216, 213, 204, 255)

WOOD_LIGHT = (217, 160, 91, 255)   # blade
WOOD_MID = (169, 113, 58, 255)     # guard
WOOD_DARK = (124, 74, 34, 255)     # handle / grain lines
WOOD_LINE = (138, 90, 43, 255)

SIZES = [128, 48, 32, 16]


def canvas(bg=None, radius=0.26):
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    if bg is not None:
        d.rounded_rectangle([0, 0, S - 1, S - 1], radius=S * radius, fill=bg)
    return img, d


def sword_layer(scale=1.0, outline=None):
    """Vertical toy sword centered in an S x S transparent layer.
    Blade up, handle down."""
    layer = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    k = scale
    cx = S / 2
    bw = S * 0.135 * k          # blade width
    tip_y = S * 0.10 / k        # top of blade
    guard_y = S * 0.60          # crossguard center
    ow = int(S * 0.028) if outline else 0

    # blade: rounded rect (round tip via radius = half width)
    d.rounded_rectangle([cx - bw / 2, tip_y, cx + bw / 2, guard_y],
                        radius=bw / 2, fill=WOOD_LIGHT,
                        outline=outline, width=ow)
    # wood grain: two short darker strokes along the blade
    gw = int(S * 0.018)
    d.line([cx - bw * 0.16, tip_y + S * 0.10, cx - bw * 0.16, guard_y - S * 0.10],
           fill=WOOD_LINE, width=gw)
    d.line([cx + bw * 0.20, tip_y + S * 0.16, cx + bw * 0.20, guard_y - S * 0.05],
           fill=WOOD_LINE, width=gw)
    # crossguard: simple straight bar, slightly rounded
    gw2 = S * 0.34 * k
    gh = S * 0.085 * k
    d.rounded_rectangle([cx - gw2 / 2, guard_y - gh / 2,
                         cx + gw2 / 2, guard_y + gh / 2],
                        radius=gh / 2, fill=WOOD_MID,
                        outline=outline, width=ow)
    # handle
    hw = bw * 0.72
    hb = guard_y + S * 0.185 * k
    d.rounded_rectangle([cx - hw / 2, guard_y + gh / 2, cx + hw / 2, hb],
                        radius=hw / 2, fill=WOOD_DARK,
                        outline=outline, width=ow)
    # pommel
    pr = S * 0.052 * k
    d.ellipse([cx - pr, hb - pr * 0.6, cx + pr, hb + pr * 1.4],
              fill=WOOD_MID, outline=outline, width=ow)
    return layer


def paste_sword(img, angle=45, scale=1.0, outline=None):
    sw = sword_layer(scale=scale, outline=outline).rotate(
        angle, resample=Image.BICUBIC, center=(S / 2, S / 2))
    img.alpha_composite(sw)
    return img


def v_sword_ink():
    """Toy sword, diagonal, on the ink tile."""
    img, _ = canvas(INK)
    return paste_sword(img, angle=45, scale=1.05)


def v_sword_paper():
    """Toy sword on paper tile with border."""
    img, d = canvas(PAPER)
    d.rounded_rectangle([0, 0, S - 1, S - 1], radius=S * 0.26,
                        outline=GRIDC, width=int(S * 0.02))
    return paste_sword(img, angle=45, scale=1.05, outline=INK)


def v_sword_arcs():
    """Sword + blue/red hearing arcs radiating from the tip corner:
    the toy sword that listens."""
    img, d = canvas(INK)
    paste_sword(img, angle=45, scale=0.98)
    # arcs centered on the tip (upper-right area after 45 deg rotation)
    tx, ty = S * 0.745, S * 0.255
    lw = int(S * 0.05)
    for r in [S * 0.14, S * 0.225]:
        d.arc([tx - r, ty - r, tx + r, ty + r], start=-80, end=-10,
              fill=RED, width=lw)
        d.arc([tx - r, ty - r, tx + r, ty + r], start=-170, end=-100,
              fill=BLUE, width=lw)
    return img


def v_sword_blue():
    """Toy sword on the bright blue tile — most kid-forward."""
    img, _ = canvas(BLUE, radius=0.30)
    return paste_sword(img, angle=45, scale=1.05)


def render(name, img):
    for size in SIZES:
        img.resize((size, size), Image.LANCZOS).save(f"{name}_{size}.png")
    print(name, "done")


if __name__ == "__main__":
    render("i_swordink", v_sword_ink())
    render("j_swordpaper", v_sword_paper())
    render("k_swordarcs", v_sword_arcs())
    render("l_swordblue", v_sword_blue())
