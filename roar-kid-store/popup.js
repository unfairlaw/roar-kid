// Audiogram editor. Clinical conventions:
//   X axis: 250 Hz .. 8 kHz (log-spaced)
//   Y axis: -10 .. 70 dB HL, INVERTED (worse hearing = lower on chart)
//   Right ear = red O, left ear = blue X

const BANDS = [250, 500, 1000, 2000, 3000, 4000, 6000, 8000];
const DB_MIN = -10, DB_MAX = 70;
const DEFAULTS = {
  enabled: true,
  left: [0,0,0,0,0,0,0,0],
  right: [0,0,0,0,0,0,0,0],
  masterVolume: 1.0,
  targetMode: "comfort", // comfort | adult | child gain rule
  calibration: { profile: "none", userOffsets: null, micOffsets: null },
};

// Settings saved by the 6-band version lack 3k and 6k: interpolate them.
function migrateBands(arr) {
  if (!Array.isArray(arr)) return [...DEFAULTS.left];
  if (arr.length === BANDS.length) return arr;
  if (arr.length === 6) {
    const [a250, a500, a1k, a2k, a4k, a8k] = arr;
    const mid = (x, y) => Math.round((x + y) / 2 / 5) * 5;
    return [a250, a500, a1k, a2k, mid(a2k, a4k), a4k, mid(a4k, a8k), a8k];
  }
  return [...DEFAULTS.left];
}

const cv = document.getElementById("chart");
const g = cv.getContext("2d");
const PAD = { l: 34, r: 10, t: 10, b: 24 };
let settings = structuredClone(DEFAULTS);
let activeEar = "right";

const xFor = (i) => PAD.l + (i / (BANDS.length - 1)) * (cv.width - PAD.l - PAD.r);
const yFor = (db) => PAD.t + ((db - DB_MIN) / (DB_MAX - DB_MIN)) * (cv.height - PAD.t - PAD.b);

function draw() {
  g.clearRect(0, 0, cv.width, cv.height);
  // quiet-zone shade (-10..15 dB HL, pediatric criterion): thresholds in
  // here need no boost
  g.fillStyle = "#efece4";
  g.fillRect(PAD.l, yFor(-10), cv.width - PAD.l - PAD.r, yFor(15) - yFor(-10));
  // grid
  g.strokeStyle = "#d8d5cc"; g.lineWidth = 1;
  g.font = "10px ui-monospace, monospace"; g.fillStyle = "#6b675c";
  for (let db = DB_MIN; db <= DB_MAX; db += 10) {
    g.beginPath(); g.moveTo(PAD.l, yFor(db)); g.lineTo(cv.width - PAD.r, yFor(db)); g.stroke();
    g.textAlign = "right"; g.fillText(db, PAD.l - 5, yFor(db) + 3);
  }
  BANDS.forEach((f, i) => {
    g.beginPath(); g.moveTo(xFor(i), PAD.t); g.lineTo(xFor(i), cv.height - PAD.b); g.stroke();
    g.textAlign = "center";
    g.fillText(f >= 1000 ? f / 1000 + "k" : f, xFor(i), cv.height - 8);
  });
  // traces
  drawEar("right", "#b3261e", drawO);
  drawEar("left", "#1f4e9c", drawX);
}

function drawEar(ear, color, marker) {
  const pts = settings[ear].map((db, i) => [xFor(i), yFor(db)]);
  g.strokeStyle = color; g.lineWidth = 1.5;
  g.beginPath();
  pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
  g.stroke();
  pts.forEach(([x, y]) => marker(x, y, color));
}
function drawO(x, y, c) {
  g.strokeStyle = c; g.lineWidth = 2;
  g.beginPath(); g.arc(x, y, 5, 0, Math.PI * 2); g.stroke();
}
function drawX(x, y, c) {
  g.strokeStyle = c; g.lineWidth = 2;
  g.beginPath();
  g.moveTo(x - 4, y - 4); g.lineTo(x + 4, y + 4);
  g.moveTo(x + 4, y - 4); g.lineTo(x - 4, y + 4);
  g.stroke();
}

function plotFromEvent(ev) {
  const r = cv.getBoundingClientRect();
  const x = ev.clientX - r.left, y = ev.clientY - r.top;
  // snap to nearest band column and 5 dB step
  let band = 0, best = Infinity;
  BANDS.forEach((_, i) => {
    const d = Math.abs(x - xFor(i));
    if (d < best) { best = d; band = i; }
  });
  let db = DB_MIN + ((y - PAD.t) / (cv.height - PAD.t - PAD.b)) * (DB_MAX - DB_MIN);
  db = Math.round(Math.max(DB_MIN, Math.min(DB_MAX, db)) / 5) * 5;
  settings[activeEar][band] = db;
  document.getElementById("readout").textContent =
    `${activeEar} ${BANDS[band] >= 1000 ? BANDS[band]/1000 + "kHz" : BANDS[band] + "Hz"}: ${db} dB HL`;
  draw(); save();
}

let dragging = false;
cv.addEventListener("pointerdown", (e) => { dragging = true; plotFromEvent(e); });
cv.addEventListener("pointermove", (e) => dragging && plotFromEvent(e));
window.addEventListener("pointerup", () => (dragging = false));

function setEar(ear) {
  activeEar = ear;
  document.getElementById("btnRight").className = ear === "right" ? "on-right" : "";
  document.getElementById("btnLeft").className = ear === "left" ? "on-left" : "";
}
document.getElementById("btnRight").onclick = () => setEar("right");
document.getElementById("btnLeft").onclick = () => setEar("left");

document.getElementById("aiLink").onclick = (e) => {
  e.preventDefault();
  chrome.runtime.openOptionsPage();
};

document.getElementById("enabled").onchange = (e) => { settings.enabled = e.target.checked; save(); };
document.getElementById("vol").oninput = (e) => { settings.masterVolume = +e.target.value; save(); };

// Target selector: which rule turns thresholds into per-band I/O curves.
// "comfort" = conservative v0 rule; "adult"/"child" = NAL-/DSL-flavored
// approximations (see DOCUMENTATION.md — approximations, not the real
// proprietary formulas).
function setMode(mode) {
  settings.targetMode = mode;
  for (const b of document.querySelectorAll("#modeToggle button")) {
    b.className = b.dataset.mode === mode ? "on-mode" : "";
  }
}
for (const b of document.querySelectorAll("#modeToggle button")) {
  b.onclick = () => { setMode(b.dataset.mode); save(); };
}

// Live estimated listening level / weekly sound dose from the content
// script's limiter metering. Silent (blank) when no wired tab is active.
function pollDose() {
  chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
    if (!tab?.id) return;
    chrome.tabs.sendMessage(tab.id, { type: "roar-dose" }, (r) => {
      if (chrome.runtime.lastError || !r?.ok || !r.metering) {
        document.getElementById("dose").textContent = "";
        return;
      }
      const lvl = r.levelDb == null ? "—" : `~${Math.round(r.levelDb)} dB est`;
      document.getElementById("dose").textContent =
        `${lvl} · dose ${r.dosePct < 0.1 ? "<0.1" : r.dosePct.toFixed(1)}%`;
    });
  });
}
setInterval(pollDose, 1000);
pollDose();

let saveTimer;
function save() {
  clearTimeout(saveTimer);
  // Write only the keys the popup owns — calibration belongs to the
  // options page, and writing a stale snapshot of it here would clobber
  // edits made while this popup sat open.
  saveTimer = setTimeout(() => chrome.storage.sync.set({
    enabled: settings.enabled,
    left: settings.left,
    right: settings.right,
    masterVolume: settings.masterVolume,
    targetMode: settings.targetMode,
  }), 150);
}

chrome.storage.sync.get(DEFAULTS, (s) => {
  s.left = migrateBands(s.left);
  s.right = migrateBands(s.right);
  settings = s;
  document.getElementById("enabled").checked = s.enabled;
  document.getElementById("vol").value = s.masterVolume;
  setMode(s.targetMode || "comfort");
  draw();
});
draw();
