// Feasibility probe: attach createMediaElementSource to Netflix's <video>
// and measure whether any signal actually flows through the Web Audio graph.
// If DRM (EME/Widevine) blocks the tap, the analyser reads pure silence even
// while the video visibly plays. Verdict is shown in an on-screen overlay.
//
// Side effect while attached: ALL audio routes through our graph, so if the
// tap is blocked you will hear nothing. Reloading the page restores normal
// playback.

(() => {
  const overlay = document.createElement("div");
  Object.assign(overlay.style, {
    position: "fixed", top: "8px", left: "8px", zIndex: 2147483647,
    background: "rgba(0,0,0,0.85)", color: "#7CFC00", padding: "10px 12px",
    font: "12px/1.5 ui-monospace, monospace", whiteSpace: "pre",
    borderRadius: "6px", pointerEvents: "none",
  });
  overlay.textContent = "[roar-spike] waiting for <video>…";
  document.documentElement.appendChild(overlay);

  let video = null, ctx = null, analyser = null, data = null;
  let attachError = null, peakRms = 0, attachedAt = 0;

  function attach(v) {
    video = v;
    attachError = null;
    peakRms = 0;
    try {
      if (!ctx) ctx = new AudioContext();
      const src = ctx.createMediaElementSource(v);
      analyser = ctx.createAnalyser();
      analyser.fftSize = 2048;
      src.connect(analyser);
      analyser.connect(ctx.destination);
      data = new Float32Array(analyser.fftSize);
      attachedAt = performance.now();
    } catch (e) {
      attachError = e.message;
    }
  }

  // AudioContext starts suspended until a user gesture; any click/key resumes.
  const resume = () => ctx && ctx.state === "suspended" && ctx.resume();
  document.addEventListener("click", resume, true);
  document.addEventListener("keydown", resume, true);

  setInterval(() => {
    const v = document.querySelector("video");
    if (v && v !== video) attach(v);

    if (!video) {
      overlay.textContent = "[roar-spike] waiting for <video>…";
      return;
    }
    if (attachError) {
      overlay.textContent =
        `[roar-spike] createMediaElementSource FAILED\n${attachError}\n` +
        "Verdict: BLOCKED (cannot even tap the element)";
      overlay.style.color = "#ff6b5e";
      return;
    }

    let rms = 0;
    if (analyser) {
      analyser.getFloatTimeDomainData(data);
      let sum = 0;
      for (let i = 0; i < data.length; i++) sum += data[i] * data[i];
      rms = Math.sqrt(sum / data.length);
      peakRms = Math.max(peakRms, rms);
    }

    const playing = !video.paused && video.currentTime > 0;
    const drm = video.mediaKeys ? "yes (EME active)" : "no";
    const elapsed = (performance.now() - attachedAt) / 1000;

    let verdict = "…play something and wait a few seconds";
    let color = "#7CFC00";
    if (playing && ctx && ctx.state === "running" && elapsed > 5) {
      if (peakRms > 1e-4) {
        verdict = "PASS — audio flows through Web Audio; filterbank is feasible";
      } else {
        verdict = "SILENT — DRM is starving the tap; Netflix not feasible this way";
        color = "#ff6b5e";
      }
    }
    overlay.style.color = color;
    overlay.textContent =
      `[roar-spike] video: found | playing: ${playing} | t=${video.currentTime.toFixed(1)}s\n` +
      `DRM (mediaKeys): ${drm} | AudioContext: ${ctx ? ctx.state : "-"}\n` +
      `rms now: ${rms.toExponential(2)} | peak: ${peakRms.toExponential(2)}\n` +
      `Verdict: ${verdict}`;
  }, 500);
})();
