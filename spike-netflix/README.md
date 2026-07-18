# Netflix / Prime Video feasibility spike

Throwaway probe answering one question: **can a content script route a
DRM-protected `<video>` (Netflix, Prime Video) through Web Audio and still
get signal?** If yes, the Roar, kid! filterbank can work there. If the tap
reads silence, per-band processing on that service is not possible with the
`createMediaElementSource` approach, and the feature needs a different
mechanism (e.g. `chrome.tabCapture`) or gets dropped.

Not part of the shipping extension. Never upload this folder to the store.

## How to run

1. `chrome://extensions` → Developer mode → **Load unpacked** → select
   `spike-netflix/`.
2. Open a title on Netflix (or Prime Video — both are matched) and press
   play. Interact once (click/keypress) so the AudioContext may start.
3. Read the green/red overlay in the top-left corner after ~5 seconds of
   playback:
   - **PASS** — audio flows through the Web Audio graph. The filterbank is
     feasible on this service; the real work (player discovery, SPA
     navigation, manifest permissions) can begin.
   - **SILENT** — the element plays but the tap reads zeros: DRM is
     starving Web Audio. Not feasible via this approach.
   - **BLOCKED** — `createMediaElementSource` threw (element already
     captured or otherwise refused).
4. While the spike is attached you may hear nothing if the verdict is
   SILENT — the audio path is routed through the graph. **Reload the page**
   to restore normal playback. Remove the unpacked extension when done.

The overlay also reports whether EME is active (`video.mediaKeys`), the
AudioContext state, and live/peak RMS so a partial or intermittent signal is
visible too.

## Interpreting beyond pass/fail

Verdicts can differ per service, per browser version, and even per playback
tier (SD vs HD, software vs hardware DRM path). A PASS today is evidence,
not a guarantee — retest after major Chrome updates before building on it.
