"""Icon concepts for "Hey, Listen!" — drawn with PIL, no font dependencies.

Draw at S=1024 supersample, downscale with LANCZOS to 128/48/32/16.
Palette matches the extension UI:
  paper #fbfaf6, ink #22211d, right-ear red #b3261e, left-ear blue #1f4e9c
"""

from PIL import Image, ImageDraw

S = 1024
PAPER = (251, 250, 246, 255)
INK = (34, 33, 29, 255)
RED = (179, 38, 30, 255)
BLUE = (31, 78, 156, 255)
GRID = (216, 213, 204, 255)

SIZES = [128, 48, 32, 16]


def canvas(bg=None):
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    if bg is not None:
        d.rounded_rectangle([0, 0, S - 1, S - 1], radius=S * 0.22, fill=bg)
    return img, d


def exclamation(d, cx, top, bot, w, bar_color, dot_color, gap=0.06):
    """Rounded bar + dot exclamation mark centered at cx."""
    dot_r = w * 0.62
    bar_bot = bot - 2 * dot_r - S * gap
    d.rounded_rectangle([cx - w / 2, top, cx + w / 2, bar_bot], radius=w / 2,
                        fill=bar_color)
    d.ellipse([cx - dot_r, bot - 2 * dot_r, cx + dot_r, bot], fill=dot_color)


def concept_a():
    """Speech bubble with exclamation; dot in red."""
    img, d = canvas(PAPER)
    lw = int(S * 0.055)
    # bubble body
    bx0, by0, bx1, by1 = S * 0.13, S * 0.14, S * 0.87, S * 0.72
    d.rounded_rectangle([bx0, by0, bx1, by1], radius=S * 0.16,
                        outline=INK, width=lw)
    # tail: triangle from bottom-left of bubble
    d.polygon([(S * 0.30, by1 - lw / 2), (S * 0.46, by1 - lw / 2),
               (S * 0.26, S * 0.90)], fill=INK)
    exclamation(d, cx=S * 0.5, top=S * 0.245, bot=S * 0.625,
                w=S * 0.105, bar_color=INK, dot_color=RED, gap=0.045)
    return img


def concept_b():
    """Clinical audiogram marks: red O, blue X on a faint grid."""
    img, d = canvas(PAPER)
    gw = int(S * 0.016)
    for i in range(1, 4):
        t = i / 4
        d.line([S * 0.08, S * t, S * 0.92, S * t], fill=GRID, width=gw)
        d.line([S * t, S * 0.08, S * t, S * 0.92], fill=GRID, width=gw)
    lw = int(S * 0.085)
    # red O, upper-left quadrant-ish
    ox, oy, orr = S * 0.345, S * 0.36, S * 0.185
    d.ellipse([ox - orr, oy - orr, ox + orr, oy + orr], outline=RED, width=lw)
    # blue X, lower-right
    xx, xy, xr = S * 0.655, S * 0.64, S * 0.165
    for sx, sy in [(-1, -1), (1, -1)]:
        d.line([xx + sx * xr, xy + sy * xr, xx - sx * xr, xy - sy * xr],
               fill=BLUE, width=lw)
        # round the stroke ends
        for ex, ey in [(xx + sx * xr, xy + sy * xr), (xx - sx * xr, xy - sy * xr)]:
            d.ellipse([ex - lw / 2, ey - lw / 2, ex + lw / 2, ey + lw / 2],
                      fill=BLUE)
    return img


def concept_c():
    """Ink tile, paper exclamation, blue arcs left / red arcs right."""
    img, d = canvas(INK)
    exclamation(d, cx=S * 0.5, top=S * 0.16, bot=S * 0.84,
                w=S * 0.13, bar_color=PAPER, dot_color=PAPER, gap=0.06)
    lw = int(S * 0.055)
    cy = S * 0.5
    for i, r in enumerate([S * 0.21, S * 0.33]):
        # left (blue) and right (red) arcs, 70-degree sweeps
        d.arc([S * 0.5 - r, cy - r, S * 0.5 + r, cy + r],
              start=145, end=215, fill=BLUE, width=lw)
        d.arc([S * 0.5 - r, cy - r, S * 0.5 + r, cy + r],
              start=-35, end=35, fill=RED, width=lw)
    return img


def render(name, img):
    for size in SIZES:
        img.resize((size, size), Image.LANCZOS).save(f"{name}_{size}.png")
    print(name, "done")


if __name__ == "__main__":
    render("a_bubble", concept_a())
    render("b_ox", concept_b())
    render("c_arcs", concept_c())
