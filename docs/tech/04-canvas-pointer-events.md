# Canvas 2D + Pointer Events

Part of the [technology study map](../../TECHNOLOGIES.md).

## What it is

`<canvas>` is immediate-mode drawing: you issue paint commands onto a pixel
buffer, and nothing is retained — no scene graph, no hit testing, no
elements. If the data changes, you clear and redraw. Pointer Events unify
mouse, touch, and pen into one input model. Together they're the smallest
possible stack for a custom interactive chart — no library, ~120 lines.

## Core concepts

**Redraw everything, every time.** `popup.js`'s `draw()` clears the canvas
and repaints shade → grid → labels → both ear traces on every change. At
this scale (a 312×240 chart) that's microseconds; the "diffing" mindset
from DOM frameworks simply doesn't apply.

**Coordinate mapping is the whole game.** Two little functions define the
chart: `xFor(bandIndex)` and `yFor(dB)` (`popup.js:28`), mapping data space
to pixel space inside a padding box. Input does the exact inverse:
`plotFromEvent` takes a pointer position, finds the *nearest* frequency
column (snap-to-column — no precision required of a child's finger), and
quantizes the dB value to the clinical 5 dB grid. Snapping is a UX
decision encoded in math: every reachable state is a legal audiogram.

**Inverted axis.** Audiograms plot worse hearing *downward*. `yFor` simply
maps −10 dB → top and 70 dB → bottom; no special casing anywhere else.
One function owning the mapping means the convention lives in one place.

**Drag = state machine.** `pointerdown` sets a `dragging` flag and plots;
`pointermove` plots only while dragging; `pointerup` on **window** (not the
canvas — you must catch releases outside the element) clears it
(`popup.js:90`). That's the entire interaction model, and it works for
mouse, touch, and stylus identically because pointer events abstract them.

**`touch-action: none`.** Without it, mobile browsers claim touch drags
for scrolling before the page sees them. The popup sets it in CSS on the
canvas (`popup.html:29`) — one line that makes touch plotting possible.

**Marker drawing.** The clinical O and X are tiny path recipes: `arc()`
for the O, two crossing lines for the X (`popup.js:61-71`) — drawn last so
they sit on top of the connecting polylines.

## How Roar, kid! uses it

The entire popup chart: `roar-kid/popup.js` (`draw`, `drawEar`, `drawO`,
`drawX`, `plotFromEvent`) over the single `<canvas>` in `popup.html:57`.
State lives in a plain `settings` object; every plot mutates it, redraws,
and debounce-saves to `chrome.storage` (150 ms, `popup.js:107`) — canvas
for pixels, storage for truth.

## Pitfalls learned here

- Canvas is bitmap: on high-DPI screens a 1× canvas looks soft. The
  Playwright screenshot tooling captures at `device_scale_factor: 2` for
  store-quality images; the live popup accepts 1× as fine for its size.
- No hit testing exists — "which point did I touch?" is *your* math. The
  nearest-column snap sidesteps needing precise hit targets at all.
- Redraw-from-state (rather than incremental painting) is what makes the
  code simple; resist optimizing it until a profiler tells you to.

## Further research

- https://developer.mozilla.org/docs/Web/API/Canvas_API/Tutorial
- https://developer.mozilla.org/docs/Web/API/Pointer_events
- Search terms: "canvas devicePixelRatio crisp", "immediate vs retained
  mode", "touch-action manipulation none".
