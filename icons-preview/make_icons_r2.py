"""Round 2 icon variants for "Hey, Listen!"."""

from PIL import Image, ImageDraw

S = 1024
PAPER = (251, 250, 246, 255)
INK = (34, 33, 29, 255)
RED = (179, 38, 30, 255)
BLUE = (31, 78, 156, 255)

SIZES = [128, 48, 32, 16]


def canvas(bg=None, radius=0.22):
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    if bg is not None:
        d.rounded_rectangle([0, 0, S - 1, S - 1], radius=S * radius, fill=bg)
    return img, d


def exclamation(d, cx, top, bot, w, bar_color, dot_color, gap=0.06,
                dot_scale=0.62):
    dot_r = w * dot_scale
    bar_bot = bot - 2 * dot_r - S * gap
    d.rounded_rectangle([cx - w / 2, top, cx + w / 2, bar_bot], radius=w / 2,
                        fill=bar_color)
    d.ellipse([cx - dot_r, bot - 2 * dot_r, cx + dot_r, bot], fill=dot_color)


def arcs(d, cy, radii, lw, sweep=40):
    for r in radii:
        d.arc([S * 0.5 - r, cy - r, S * 0.5 + r, cy + r],
              start=180 - sweep, end=180 + sweep, fill=BLUE, width=lw)
        d.arc([S * 0.5 - r, cy - r, S * 0.5 + r, cy + r],
              start=-sweep, end=sweep, fill=RED, width=lw)


def v_c_soft():
    """C, friendlier: rounder tile, chunkier !, bigger dot, fatter arcs."""
    img, d = canvas(INK, radius=0.30)
    exclamation(d, cx=S * 0.5, top=S * 0.17, bot=S * 0.83,
                w=S * 0.15, bar_color=PAPER, dot_color=PAPER,
                gap=0.055, dot_scale=0.75)
    arcs(d, cy=S * 0.5, radii=[S * 0.235, S * 0.35], lw=int(S * 0.07), sweep=35)
    return img


def v_c_blue():
    """C on a blue tile; paper ! and red-only arcs (right-ear accent)."""
    img, d = canvas(BLUE, radius=0.30)
    exclamation(d, cx=S * 0.5, top=S * 0.17, bot=S * 0.83,
                w=S * 0.15, bar_color=PAPER, dot_color=PAPER,
                gap=0.055, dot_scale=0.75)
    lw = int(S * 0.07)
    for r in [S * 0.235, S * 0.35]:
        d.arc([S * 0.5 - r, S * 0.5 - r, S * 0.5 + r, S * 0.5 + r],
              start=-35, end=35, fill=PAPER, width=lw)
        d.arc([S * 0.5 - r, S * 0.5 - r, S * 0.5 + r, S * 0.5 + r],
              start=145, end=215, fill=PAPER, width=lw)
    return img


def v_bubble_solid():
    """Solid ink speech bubble, paper !, red dot. Reads at any size."""
    img, d = canvas(None)
    bx0, by0, bx1, by1 = S * 0.06, S * 0.08, S * 0.94, S * 0.76
    d.rounded_rectangle([bx0, by0, bx1, by1], radius=S * 0.20, fill=INK)
    d.polygon([(S * 0.26, by1 - 4), (S * 0.48, by1 - 4), (S * 0.22, S * 0.97)],
              fill=INK)
    exclamation(d, cx=S * 0.5, top=S * 0.185, bot=S * 0.655,
                w=S * 0.125, bar_color=PAPER, dot_color=RED,
                gap=0.05, dot_scale=0.72)
    return img


def v_o_dot():
    """Exclamation whose dot is the red audiogram O; blue X crossing the bar
    top. The two clinical marks hidden inside a '!'."""
    img, d = canvas(PAPER, radius=0.30)
    # subtle border so the paper tile keeps an edge on white pages
    d.rounded_rectangle([0, 0, S - 1, S - 1], radius=S * 0.30,
                        outline=(216, 213, 204, 255), width=int(S * 0.02))
    # bar
    w = S * 0.15
    d.rounded_rectangle([S * 0.5 - w / 2, S * 0.14, S * 0.5 + w / 2, S * 0.60],
                        radius=w / 2, fill=INK)
    # red O as the dot
    orr = S * 0.115
    lw = int(S * 0.075)
    cy = S * 0.76
    d.ellipse([S * 0.5 - orr, cy - orr, S * 0.5 + orr, cy + orr],
              outline=RED, width=lw)
    # small blue X tucked at upper right
    xx, xy, xr = S * 0.78, S * 0.26, S * 0.085
    xlw = int(S * 0.06)
    for sx in (-1, 1):
        d.line([xx - sx * xr, xy - xr, xx + sx * xr, xy + xr],
               fill=BLUE, width=xlw)
        for ex, ey in [(xx - sx * xr, xy - xr), (xx + sx * xr, xy + xr)]:
            d.ellipse([ex - xlw / 2, ey - xlw / 2, ex + xlw / 2, ey + xlw / 2],
                      fill=BLUE)
    return img


def v_bubble_arcs():
    """A+C hybrid: solid ink bubble with paper !, single blue/red arc pair."""
    img, d = canvas(None)
    bx0, by0, bx1, by1 = S * 0.06, S * 0.08, S * 0.94, S * 0.76
    d.rounded_rectangle([bx0, by0, bx1, by1], radius=S * 0.20, fill=INK)
    d.polygon([(S * 0.26, by1 - 4), (S * 0.48, by1 - 4), (S * 0.22, S * 0.97)],
              fill=INK)
    exclamation(d, cx=S * 0.5, top=S * 0.185, bot=S * 0.655,
                w=S * 0.115, bar_color=PAPER, dot_color=PAPER,
                gap=0.05, dot_scale=0.68)
    lw = int(S * 0.06)
    cy = S * 0.42
    r = S * 0.24
    d.arc([S * 0.5 - r, cy - r, S * 0.5 + r, cy + r],
          start=150, end=210, fill=BLUE, width=lw)
    d.arc([S * 0.5 - r, cy - r, S * 0.5 + r, cy + r],
          start=-30, end=30, fill=RED, width=lw)
    return img


def render(name, img):
    for size in SIZES:
        img.resize((size, size), Image.LANCZOS).save(f"{name}_{size}.png")
    print(name, "done")


if __name__ == "__main__":
    render("d_csoft", v_c_soft())
    render("e_cblue", v_c_blue())
    render("f_bubblesolid", v_bubble_solid())
    render("g_odot", v_o_dot())
    render("h_bubblearcs", v_bubble_arcs())
