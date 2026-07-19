# MutationObserver and single-page-app integration

Part of the [technology study map](../../TECHNOLOGIES.md).

## What it is

`MutationObserver` is the DOM's change-notification API: register a
callback and a scope, and the browser batches and delivers DOM mutations
(added/removed nodes, attribute changes) as they happen. For a content
script, it is the *only* reliable way to work with modern sites, because
what the manifest injects into and what the user experiences are different
things: the script runs once per page *load*, but a single-page app
navigates many times per load without ever loading a page again.

## Core concepts

**The SPA problem, concretely.** YouTube, Netflix, and Prime Video all:
- render the `<video>` element late (long after `document_idle`);
- *replace* the element across in-app navigation (next episode, browsing
  back and forth);
- on Netflix/Prime, play billboard/trailer videos in elements that come
  and go before the real player exists.

So "find the video" is not a moment — it's an ongoing responsibility.

**The pattern used here** (`content.js:192-203`):

```js
function findAndWire() {
  if (state.wiredVideo && state.wiredVideo.isConnected) return; // cheap early-out
  const video = document.querySelector("video.html5-main-video, video");
  if (video) wire(video);
}
new MutationObserver(findAndWire).observe(document.documentElement,
  { childList: true, subtree: true });
findAndWire(); // don't wait for the first mutation
```

Three details carry the design:
1. **The early-out.** Observing `subtree: true` on the whole document fires
   *constantly* on these sites. `isConnected` — "is my wired element still
   in the DOM?" — reduces ~every callback to one property read. Observers
   are cheap only if their callbacks are.
2. **Idempotent wiring.** `wire()` starts with `if (state.wiredVideo ===
   video) return;` — the callback may fire in bursts; wiring must tolerate
   being asked repeatedly.
3. **Selector preference.** `video.html5-main-video` (YouTube's main
   player class) is tried before bare `video`, biasing toward the real
   player when multiple elements exist.

**Rebuild on replacement.** When the site swaps its `<video>`, the old
`AudioContext` is closed and a new one built (`content.js:127`) — a media
element's capture cannot be transplanted. Wiring trailers is accepted as
harmless (same correction applies; the observer moves on when the real
player appears) — a deliberate "don't fight the site" decision
(`content.js:187`).

**Failure containment.** If `createMediaElementSource` throws (element
already captured by something else), the script records the element as
seen and *stops trying* (`content.js:130`) — otherwise the observer would
re-throw on every mutation forever.

## Pitfalls learned here

- Never do heavy work directly in an observer callback on a busy site;
  compute the cheapest possible "do I care?" predicate first.
- `disconnect()` isn't needed here (the script lives as long as the page),
  but leaked observers are a classic content-script memory hole in more
  complex extensions.
- Alternatives exist at other altitudes: `navigation` API / `yt-navigate-
  finish` events (site-specific), polling (crude), or `chrome.webNavigation`
  (needs another permission). The DOM observer is the zero-permission,
  site-agnostic choice.

## Further research

- https://developer.mozilla.org/docs/Web/API/MutationObserver
- Search terms: "content script SPA navigation", "yt-navigate-finish",
  "MutationObserver performance", "Navigation API".
