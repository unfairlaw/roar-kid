// Roar, kid! options: BYOK key management + audiogram photo extraction.
// Keys live in chrome.storage.local (device-only; never storage.sync).
// Extraction: temperature 0 everywhere; seed 22 where the provider supports
// it (OpenAI, Grok, Gemini — Anthropic has no seed param); structured output
// via each provider's native schema mechanism; results validated, then shown
// for review before touching the audiogram.

const BANDS = [250, 500, 1000, 2000, 3000, 4000, 6000, 8000];
const SEED = 22;
const PROVIDERS = ["openai", "anthropic", "google", "xai"];

const SCHEMA = {
  type: "object",
  properties: {
    right: { type: "array", items: { type: ["number", "null"] }, minItems: 8, maxItems: 8,
      description: "Right ear (red O) dB HL at 250,500,1000,2000,3000,4000,6000,8000 Hz; null for untested frequencies" },
    left: { type: "array", items: { type: ["number", "null"] }, minItems: 8, maxItems: 8,
      description: "Left ear (blue X) dB HL at 250,500,1000,2000,3000,4000,6000,8000 Hz; null for untested frequencies" },
    read_from_table: { type: "boolean",
      description: "True if read from a printed numeric table, false if from plotted symbols" },
    confidence_note: { type: "string",
      description: "One sentence on anything ambiguous or interpolated" },
  },
  required: ["right", "left", "read_from_table", "confidence_note"],
  additionalProperties: false,
};

// Extraction prompt ships as prompt.txt (shared with extract_audiogram.py);
// loaded lazily from the extension package before the first extraction.
let PROMPT = "";
async function loadPrompt() {
  if (!PROMPT) {
    PROMPT = await (await fetch(chrome.runtime.getURL("prompt.txt"))).text();
  }
}

// snap to clinical 5 dB grid, clamp to extension's mild-moderate scope
const clean = (arr) => arr.map((x) => Math.round(Math.max(-10, Math.min(70, x)) / 5) * 5);

// Scope screen — a hard stop, unlike the plausibility warnings below. The
// prescription deliberately stops at mild-to-moderate loss, so an
// audiogram with thresholds beyond 70 dB HL must not be silently clamped
// into range and amplified as if it fit: the import is blocked, the
// preview shows the real (unclamped) numbers with the offending cells
// marked, and Apply never becomes available for that extraction.
const SCOPE_MAX_DB_HL = 70;
const hzLabel = (f) => (f >= 1000 ? f / 1000 + " kHz" : f + " Hz");
// For user-typed text interpolated into an HTML attribute (anchor labels).
const escAttr = (s) =>
  s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

// Shared staging for both extraction paths (BYOK cloud and on-device):
// gap-fill, detect out-of-scope thresholds, and only clamp when in scope —
// a blocked preview must show what the chart actually says.
function stagePending(raw) {
  const right = fillGaps(raw.right);
  const left = fillGaps(raw.left);
  // Blocked previews show values as read (integer, no 5 dB snap): a 72
  // snapped to 70 would display as in-scope while the block cites 72.
  const snap = (arr) => arr.map((x) => Math.round(x));
  const outOfScope = [];
  for (const [ear, vals] of [["right", right.out], ["left", left.out]]) {
    vals.forEach((v, i) => {
      if (v > SCOPE_MAX_DB_HL) outOfScope.push(`${ear} ${hzLabel(BANDS[i])}: ${Math.round(v)}`);
    });
  }
  pending = {
    right: outOfScope.length ? snap(right.out) : clean(right.out),
    left: outOfScope.length ? snap(left.out) : clean(left.out),
    outOfScope,
    inferred: [...new Set([...right.inferred, ...left.inferred])],
    meta: raw,
  };
}

// The model transcribes; inference is our job. Fill untested (null)
// frequencies from tested neighbors, deterministically.
function fillGaps(vals) {
  const tested = vals.map((v, i) => (v == null ? -1 : i)).filter((i) => i >= 0);
  if (!tested.length) throw new Error("no thresholds could be read");
  const inferred = [];
  const out = vals.map((v, i) => {
    if (v != null) return v;
    inferred.push(BANDS[i]);
    const lo = tested.filter((j) => j < i).at(-1);
    const hi = tested.find((j) => j > i);
    if (lo === undefined) return vals[hi];
    if (hi === undefined) return vals[lo];
    return (vals[lo] + vals[hi]) / 2;
  });
  return { out, inferred };
}

// ------------------------------------------------------------- providers

async function callOpenAICompatible(baseUrl, key, model, mime, b64, extra = {}) {
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model,
      temperature: 0,
      seed: SEED,
      response_format: {
        type: "json_schema",
        json_schema: { name: "audiogram", strict: true, schema: SCHEMA },
      },
      messages: [{
        role: "user",
        content: [
          { type: "text", text: PROMPT },
          { type: "image_url",
            image_url: { url: `data:${mime};base64,${b64}`, detail: "high" } },
        ],
      }],
      ...extra,
    }),
  });
  if (!res.ok) throw new Error(`${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  return JSON.parse(data.choices[0].message.content);
}

async function callAnthropic(key, mime, b64) {
  // Structured output via a forced tool call; no seed parameter exists.
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 1000,
      temperature: 0,
      tools: [{ name: "report_audiogram",
        description: "Report the extracted audiogram thresholds",
        input_schema: SCHEMA }],
      tool_choice: { type: "tool", name: "report_audiogram" },
      messages: [{
        role: "user",
        content: [
          { type: "text", text: PROMPT },
          { type: "image",
            source: { type: "base64", media_type: mime, data: b64 } },
        ],
      }],
    }),
  });
  if (!res.ok) throw new Error(`${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  const tool = data.content.find((c) => c.type === "tool_use");
  if (!tool) throw new Error("No structured result returned");
  return tool.input;
}

// Gemini's responseSchema is OpenAPI-style, a fixed proto: nullable flag
// instead of type arrays, and no additionalProperties field at all — the
// API 400s on any unknown schema key rather than ignoring it.
function geminiSchema() {
  const s = structuredClone(SCHEMA);
  delete s.additionalProperties;
  for (const ear of ["right", "left"]) {
    s.properties[ear].items = { type: "number", nullable: true };
  }
  return s;
}

async function callGemini(key, mime, b64) {
  const res = await fetch(
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent",
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({
        contents: [{ parts: [
          { text: PROMPT },
          { inline_data: { mime_type: mime, data: b64 } },
        ]}],
        generationConfig: {
          temperature: 0,
          seed: SEED,
          responseMimeType: "application/json",
          responseSchema: geminiSchema(),
        },
      }),
    }
  );
  if (!res.ok) throw new Error(`${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  return JSON.parse(data.candidates[0].content.parts[0].text);
}

const EXTRACTORS = {
  openai: (k, m, b) => callOpenAICompatible("https://api.openai.com/v1", k, "gpt-5.2", m, b),
  xai:    (k, m, b) => callOpenAICompatible("https://api.x.ai/v1", k, "grok-4", m, b),
  anthropic: callAnthropic,
  google: callGemini,
};

// ------------------------------------------- Chrome built-in AI (on-device)
// Gemini Nano via the Prompt API. Verified 16/16 on printed-table reports
// (see spike-prompt-api/); plotted charts are beyond this model generation,
// so the UI scopes it to tables. The image never leaves the device.
// Nano can't index positional arrays reliably: each ear is an object keyed
// hz250..hz8000, converted to the usual arrays after parsing.

const NANO_EAR = (ear) => ({
  type: "object",
  properties: Object.fromEntries(BANDS.map((f) => [`hz${f}`, {
    type: ["number", "null"],
    description: `${ear} ear threshold dB HL at ${f} Hz, null if untested`,
  }])),
  required: BANDS.map((f) => `hz${f}`),
  additionalProperties: false,
});

const NANO_SCHEMA = {
  type: "object",
  properties: {
    reasoning: { type: "string",
      description: "The panel's recorded deliberation: source choice, how each row/symbol was read, how every slot was decided" },
    right: NANO_EAR("right (red O, OD)"),
    left: NANO_EAR("left (blue X, OE)"),
    read_from_table: SCHEMA.properties.read_from_table,
    confidence_note: SCHEMA.properties.confidence_note,
  },
  required: ["reasoning", "right", "left", "read_from_table", "confidence_note"],
  additionalProperties: false,
};

async function nanoSession(onDownload) {
  const base = {
    expectedInputs: [{ type: "image" }],
    expectedOutputs: [{ type: "text", languages: ["en"] }],
    monitor(m) { m.addEventListener("downloadprogress", onDownload); },
  };
  // Determinism: the API has no seed; greedy decoding is the control.
  // samplingMode is current spec, temperature/topK the deprecated fallback
  // still honored in extension contexts.
  try {
    const s = await LanguageModel.create({ ...base, samplingMode: "most-predictable" });
    console.log("[roar-kid] built-in AI decoding: samplingMode most-predictable");
    return s;
  } catch {
    try {
      const s = await LanguageModel.create({ ...base, temperature: 0, topK: 1 });
      console.log("[roar-kid] built-in AI decoding: greedy temperature/topK");
      return s;
    } catch {
      console.warn("[roar-kid] built-in AI decoding: DEFAULT SAMPLING (nondeterministic)");
      return LanguageModel.create(base);
    }
  }
}

async function extractBuiltin(file) {
  const prompt = await (await fetch(chrome.runtime.getURL("prompt-builtin.txt"))).text();
  const bitmap = await createImageBitmap(file);
  const session = await nanoSession((e) => {
    $("busy").textContent =
      `downloading on-device model (one time): ${Math.round((e.loaded / (e.total || 1)) * 100)}%`;
  });
  try {
    const raw = await session.prompt([{
      role: "user",
      content: [{ type: "text", value: prompt }, { type: "image", value: bitmap }],
    }], { responseConstraint: NANO_SCHEMA });
    console.log("[roar-kid] built-in AI raw output:", raw);
    const parsed = JSON.parse(raw.match(/\{[\s\S]*\}/)[0]);
    return {
      right: BANDS.map((f) => parsed.right?.[`hz${f}`] ?? null),
      left: BANDS.map((f) => parsed.left?.[`hz${f}`] ?? null),
      read_from_table: parsed.read_from_table,
      confidence_note: parsed.confidence_note,
    };
  } finally {
    session.destroy();
  }
}

// ------------------------------------------------------------------- UI

const $ = (id) => document.getElementById(id);
let pending = null;

chrome.storage.local.get({ apiKeys: {} }, ({ apiKeys }) => {
  for (const p of PROVIDERS) {
    if (apiKeys[p]) { $(`k-${p}`).value = apiKeys[p]; $(`s-${p}`).textContent = "✓"; }
  }
  lockOtherFields();
});

// The filled-in box doubles as the provider choice, so exactly one key may
// be present at a time: as soon as one box has content, the others lock.
const typedProviders = () =>
  PROVIDERS.filter((p) => $(`k-${p}`).value.trim());

function lockOtherFields() {
  const typed = typedProviders();
  for (const p of PROVIDERS) {
    $(`k-${p}`).disabled = typed.length > 0 && !typed.includes(p);
  }
}
for (const p of PROVIDERS) {
  $(`k-${p}`).addEventListener("input", lockOtherFields);
}

$("saveKeys").onclick = () => {
  const apiKeys = {};
  for (const p of PROVIDERS) {
    const v = $(`k-${p}`).value.trim();
    if (v) apiKeys[p] = v;
    $(`s-${p}`).textContent = v ? "✓" : "";
  }
  chrome.storage.local.set({ apiKeys });
};

$("removeKeys").onclick = () => {
  chrome.storage.local.remove("apiKeys");
  for (const p of PROVIDERS) {
    $(`k-${p}`).value = "";
    $(`s-${p}`).textContent = "";
  }
  lockOtherFields();
};

$("extract").onclick = async () => {
  $("err").textContent = "";
  const file = $("photo").files[0];
  if (!file) { $("err").textContent = "Choose a photo first."; return; }

  // On-device is the default path (FR3/NFR2): the cloud runs only when the
  // user has a key AND ticked the per-import consent box. The provider is
  // whichever box holds a key; a typed key wins over a saved one.
  const typed = typedProviders();
  const { apiKeys = {} } = await chrome.storage.local.get("apiKeys");
  const provider = typed[0] ?? PROVIDERS.find((p) => apiKeys[p]);
  const consented = $("cloudConsent").checked;
  if (!provider || !consented) {
    if (builtinAvailable) return runBuiltin();
    $("err").textContent = provider
      ? "Tick the consent box to send the photo to the cloud provider — " +
        "this device has no on-device model to use instead."
      : "No on-device model here: paste one provider's API key above and " +
        "tick the consent box (saving the key is optional).";
    return;
  }
  const key = $(`k-${provider}`).value.trim() || apiKeys[provider];

  const b64 = await new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result.split(",")[1]);
    r.onerror = () => rej(new Error("Could not read file"));
    r.readAsDataURL(file);
  });

  $("extract").disabled = true;
  $("busy").style.display = "inline";
  try {
    await loadPrompt();
    const raw = await EXTRACTORS[provider](key, file.type || "image/jpeg", b64);
    stagePending(raw);
    renderPreview();
  } catch (e) {
    $("err").textContent = `Extraction failed — ${e.message}`;
  } finally {
    $("extract").disabled = false;
    $("busy").style.display = "none";
  }
};

// Physiological plausibility screen over an extracted pair of ears. These
// flag patterns the LLM-audiogram literature associates with misreads
// (fabricated flat traces, symbol/ear swaps, gridline slips); they are
// warnings for the human reviewer, never auto-corrections.
function plausibilityWarnings(right, left) {
  const hz = (f) => (f >= 1000 ? f / 1000 + " kHz" : f + " Hz");
  const warnings = [];
  BANDS.forEach((f, i) => {
    if (Math.abs(right[i] - left[i]) > 40) {
      warnings.push(`Left/right differ by ${Math.abs(right[i] - left[i])} dB at ${hz(f)} — check the symbols weren't swapped.`);
    }
  });
  for (const [label, vals] of [["right", right], ["left", left]]) {
    for (let i = 1; i < vals.length; i++) {
      if (Math.abs(vals[i] - vals[i - 1]) > 30) {
        warnings.push(`Steep ${Math.abs(vals[i] - vals[i - 1])} dB jump between ${hz(BANDS[i - 1])} and ${hz(BANDS[i])} (${label} ear) — worth a second look.`);
      }
    }
  }
  const all = [...right, ...left];
  if (all.every((v) => v === all[0])) {
    warnings.push(`Every value reads ${all[0]} dB HL — perfectly flat identical ears are a classic misread.`);
  }
  return warnings;
}

function renderPreview() {
  const head = `<tr><th></th>${BANDS.map(
    (f) => `<th>${f >= 1000 ? f / 1000 + "k" : f}</th>`).join("")}</tr>`;
  const row = (label, cls, vals) =>
    `<tr><th>${label}</th>${vals.map((v) =>
      `<td class="${cls}${v > SCOPE_MAX_DB_HL ? " oob" : ""}">${v}</td>`).join("")}</tr>`;
  $("tbl").innerHTML =
    head + row("Right O", "r", pending.right) + row("Left X", "l", pending.left);
  const inferredNote = pending.inferred.length
    ? ` Untested frequencies filled by interpolation: ${pending.inferred
        .map((f) => (f >= 1000 ? f / 1000 + "k" : f)).join(", ")} Hz.`
    : "";
  $("meta").textContent =
    `${pending.meta.read_from_table ? "Read from the printed table." :
      "Estimated from plotted symbols — double-check every point."} ` +
    (pending.meta.confidence_note || "") + inferredNote;
  const warnings = plausibilityWarnings(pending.right, pending.left);
  $("plaus").style.display = warnings.length ? "block" : "none";
  $("plaus").textContent = warnings.join(" ");
  // Scope block: out-of-scope thresholds end the flow here — the review
  // checkbox and Apply are hidden, not merely disabled, so there is
  // nothing to tick and nothing to press. Discard is the only way out.
  const blocked = pending.outOfScope.length > 0;
  $("scopeBlock").style.display = blocked ? "block" : "none";
  $("scopeBlock").textContent = blocked
    ? `This audiogram includes thresholds above ${SCOPE_MAX_DB_HL} dB HL ` +
      `(${pending.outOfScope.join(", ")} dB HL). This extension's ` +
      `prescriptions stop at mild-to-moderate loss, so it cannot apply ` +
      `this import — that range calls for a professionally fitted hearing ` +
      `instrument, not this tool.`
    : "";
  $("reviewedRow").style.display = blocked ? "none" : "flex";
  $("apply").style.display = blocked ? "none" : "";
  // Review is un-skippable: Apply stays dead until the checkbox is ticked,
  // and the checkbox resets for every new extraction.
  $("reviewed").checked = false;
  $("apply").disabled = true;
  $("preview").style.display = "block";
}

$("reviewed").onchange = (e) => {
  $("apply").disabled = !e.target.checked || !!pending?.outOfScope?.length;
};

$("apply").onclick = () => {
  if (!$("reviewed").checked || pending?.outOfScope?.length) return;
  chrome.storage.sync.set({ right: pending.right, left: pending.left });
  $("preview").style.display = "none";
  $("err").textContent = "";
  $("meta").textContent = "";
  alert("Applied. Open the popup to review the chart point by point.");
};

$("discard").onclick = () => {
  pending = null;
  $("preview").style.display = "none";
};

// Built-in AI path: shown only where Chrome's on-device model can run.
// Same review pipeline as the BYOK providers — nothing applies unchecked.
// When no provider key exists, the main Extract button falls back to it.
let builtinAvailable = false;
(async () => {
  if (typeof LanguageModel === "undefined") return;
  try {
    const a = await LanguageModel.availability({
      expectedInputs: [{ type: "image" }],
      expectedOutputs: [{ type: "text", languages: ["en"] }],
    });
    if (a === "unavailable") return;
    builtinAvailable = true;
    $("builtinRow").style.display = "flex";
    $("builtinNote").style.display = "block";
  } catch { /* probing failed — keep the option hidden */ }
})();

async function runBuiltin() {
  $("err").textContent = "";
  const file = $("photo").files[0];
  if (!file) { $("err").textContent = "Choose a photo first."; return; }
  $("extractBuiltin").disabled = $("extract").disabled = true;
  $("busy").textContent = "reading on this device…";
  $("busy").style.display = "inline";
  try {
    const raw = await extractBuiltin(file);
    stagePending(raw);
    renderPreview();
  } catch (e) {
    $("err").textContent = `On-device extraction failed — ${e.message}`;
  } finally {
    $("extractBuiltin").disabled = $("extract").disabled = false;
    $("busy").textContent = "reading chart…";
    $("busy").style.display = "none";
  }
}

$("extractBuiltin").onclick = runBuiltin;

// -------------------------------------------------------- calibration
// Tier 1 self-calibration (FR5): a headphone-profile preset plus a
// reference-tone loudness match, both stored as per-band dB offsets in
// settings.calibration (chrome.storage.sync) and folded into the player's
// band gains. Tier 2 is the mic-measured correction JSON import. All
// offsets are clamped to ±12 dB in dsp.js before use.

const CAL_DEFAULT = { profile: "none", userOffsets: null, micOffsets: null };
let calibration = { ...CAL_DEFAULT };

function saveCalibration() {
  chrome.storage.sync.set({ calibration });
}

// --- reference-tone loudness match
// One tone at a time; 1 kHz is the anchor (offset locked to 0). The tone is
// played WITH the slider's offset applied, so the user hears the corrected
// result while matching. Modest base level: -26 dBFS sine.
let toneCtx = null, toneOsc = null, toneGain = null, toneBand = null;
const TONE_BASE = 0.05;

function stopTone() {
  if (toneOsc) { try { toneOsc.stop(); } catch {} }
  toneOsc = null;
  toneBand = null;
  for (const b of document.querySelectorAll("#toneRows button")) {
    b.textContent = "play";
    b.setAttribute("aria-label", `Play ${hzLabel(BANDS[+b.dataset.band])} test tone`);
  }
}

function playTone(i) {
  if (toneBand === i) return stopTone();
  stopTone();
  if (!toneCtx) toneCtx = new AudioContext();
  toneCtx.resume();
  toneGain = new GainNode(toneCtx, {
    gain: TONE_BASE * Math.pow(10, (calibration.userOffsets?.[i] || 0) / 20),
  });
  toneOsc = new OscillatorNode(toneCtx, { frequency: BANDS[i] });
  toneOsc.connect(toneGain).connect(toneCtx.destination);
  toneOsc.start();
  toneBand = i;
  const btn = document.querySelectorAll("#toneRows button")[i];
  btn.textContent = "stop";
  btn.setAttribute("aria-label", `Stop ${hzLabel(BANDS[i])} test tone`);
}

function renderToneRows() {
  const rows = BANDS.map((f, i) => {
    const anchor = f === 1000;
    const v = anchor ? 0 : (calibration.userOffsets?.[i] || 0);
    return `<div class="keyrow">
      <label class="mono" for="toneBand-${i}">${hzLabel(f)}${anchor ? " ⚓" : ""}</label>
      <button class="ghost" data-band="${i}" aria-label="Play ${hzLabel(f)} test tone">play</button>
      <input type="range" id="toneBand-${i}" data-band="${i}" min="-12" max="12" step="1"
        value="${v}" ${anchor ? "disabled" : ""} style="flex:1;"
        aria-describedby="toneVal-${i}" />
      <span class="mono" id="toneVal-${i}" style="width:44px; text-align:right;">${v > 0 ? "+" + v : v} dB</span>
    </div>`;
  });
  $("toneRows").innerHTML = rows.join("");
  for (const b of document.querySelectorAll("#toneRows button")) {
    b.onclick = () => playTone(+b.dataset.band);
  }
  for (const s of document.querySelectorAll("#toneRows input[type=range]")) {
    s.oninput = () => {
      const i = +s.dataset.band;
      const v = +s.value;
      if (!calibration.userOffsets) calibration.userOffsets = BANDS.map(() => 0);
      calibration.userOffsets[i] = v;
      $(`toneVal-${i}`).textContent = `${v > 0 ? "+" + v : v} dB`;
      if (toneBand === i && toneGain) {
        toneGain.gain.setTargetAtTime(
          TONE_BASE * Math.pow(10, v / 20), toneCtx.currentTime, 0.02);
      }
      saveCalibration();
    };
  }
}

$("toneReset").onclick = () => {
  stopTone();
  calibration.userOffsets = null;
  saveCalibration();
  renderToneRows();
};

$("hpProfile").onchange = (e) => {
  calibration.profile = e.target.value;
  saveCalibration();
};

// --- measurement-mic correction import (produced by calibrate_playback.py)
function micStatusText() {
  $("micStatus").textContent = calibration.micOffsets
    ? `active: [${calibration.micOffsets.map((v) => (v > 0 ? "+" + v : v)).join(", ")}] dB`
    : "none imported";
}

$("micFile").onchange = async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    const bands = data.bands_hz || data.bands;
    const corr = data.correction_db;
    if (!Array.isArray(corr) || corr.length !== BANDS.length ||
        !corr.every((v) => typeof v === "number" && isFinite(v)) ||
        (bands && JSON.stringify(bands) !== JSON.stringify(BANDS))) {
      throw new Error("expected {bands_hz: [250..8000], correction_db: [8 numbers]}");
    }
    calibration.micOffsets = corr.map((v) => Math.max(-12, Math.min(12, Math.round(v * 10) / 10)));
    saveCalibration();
    micStatusText();
  } catch (err) {
    $("micStatus").textContent = `import failed — ${err.message}`;
  }
  e.target.value = "";
};

$("micClear").onclick = () => {
  calibration.micOffsets = null;
  saveCalibration();
  micStatusText();
};

chrome.storage.sync.get({ calibration: CAL_DEFAULT }, (s) => {
  calibration = { ...CAL_DEFAULT, ...s.calibration };
  $("hpProfile").value = calibration.profile || "none";
  renderToneRows();
  micStatusText();
});

// -------------------------------------------------- loudness anchor (FR-3)
// In-situ anchoring: a fixed-digital-level 1 kHz tone plays while the user
// sets SYSTEM volume to conversational-speech loudness; saving records the
// implied full-scale-to-SPL mapping, keyed to a signature of this
// machine's audio outputs (chrome.storage.local — an anchor never syncs to
// another machine). The content script suppresses level/dose readouts
// until an anchor exists and flags it stale when the device set changes.

const DSP = globalThis.RoarDSP;
let anchorCtx = null, anchorOsc = null;

function stopAnchorTone() {
  if (anchorOsc) { try { anchorOsc.stop(); } catch {} }
  anchorOsc = null;
  $("anchorTone").textContent = "Play anchor tone";
}

$("anchorTone").onclick = () => {
  if (anchorOsc) return stopAnchorTone();
  if (!anchorCtx) anchorCtx = new AudioContext();
  anchorCtx.resume();
  const g = new GainNode(anchorCtx, { gain: DSP.ANCHOR_TONE_AMP });
  anchorOsc = new OscillatorNode(anchorCtx, { frequency: 1000 });
  anchorOsc.connect(g).connect(anchorCtx.destination);
  anchorOsc.start();
  $("anchorTone").textContent = "Stop tone";
};

async function renderAnchors() {
  const sig = await DSP.outputDeviceSignature();
  const { anchors = {} } = await chrome.storage.local.get("anchors");
  const entries = Object.entries(anchors);
  $("anchorStatus").textContent = anchors[sig]
    ? `Anchor active for the current output device (“${anchors[sig].label}”, ` +
      `saved ${new Date(anchors[sig].when).toLocaleDateString()}). ` +
      `Level and dose readouts are on.`
    : entries.length
      ? "No anchor matches the current output device — the newest saved " +
        "anchor is used but flagged stale. Re-anchor on this setup."
      : "No anchor saved yet — the popup shows no level or dose numbers " +
        "(relative mode).";
  $("anchorList").innerHTML = entries
    .map(([s, a], i) =>
      `<div class="keyrow"><span class="sub" style="flex:1;">` +
      `${a.label || "unnamed"} — ${new Date(a.when).toLocaleDateString()}` +
      `${s === sig ? " (current device)" : ""}</span>` +
      `<button class="ghost" data-sig="${encodeURIComponent(s)}" aria-label="Remove anchor ${escAttr(a.label || "unnamed")}">remove</button></div>`)
    .join("");
  for (const b of $("anchorList").querySelectorAll("button")) {
    b.onclick = async () => {
      const { anchors = {} } = await chrome.storage.local.get("anchors");
      delete anchors[decodeURIComponent(b.dataset.sig)];
      await chrome.storage.local.set({ anchors });
      renderAnchors();
    };
  }
}

$("anchorSave").onclick = async () => {
  stopAnchorTone();
  const sig = await DSP.outputDeviceSignature();
  const { anchors = {} } = await chrome.storage.local.get("anchors");
  anchors[sig] = {
    refDb: DSP.anchorRefDb(),
    label: $("anchorLabel").value.trim() || "unnamed setup",
    when: Date.now(),
  };
  await chrome.storage.local.set({ anchors });
  renderAnchors();
};

try {
  navigator.mediaDevices.addEventListener("devicechange", renderAnchors);
} catch {}
renderAnchors();

// ------------------------------------------------ child target gate (SR-2)
// The child target ships locked. Unlocking requires the explicit
// audiologist attestation below; the popup and content script both check
// this flag, and the active child target runs under a reduced limiter
// ceiling (CHILD_CEILING_DB, clamped in the worklet so it can only ever
// be lower than the adult ceiling).

function renderChildGate(childMode) {
  const unlocked = !!childMode?.unlocked;
  $("childStatus").textContent = unlocked
    ? `unlocked ${new Date(childMode.when).toLocaleDateString()} — ` +
      `ceiling ${DSP.CHILD_CEILING_DB} dBFS`
    : "locked — the child button in the popup is inactive";
  $("childLock").disabled = !unlocked;
  $("childAttest").checked = false;
  $("childUnlock").disabled = true;
}

$("childAttest").onchange = (e) => {
  $("childUnlock").disabled = !e.target.checked;
};

$("childUnlock").onclick = () => {
  if (!$("childAttest").checked) return;
  const childMode = { unlocked: true, when: Date.now() };
  chrome.storage.sync.set({ childMode });
  renderChildGate(childMode);
};

$("childLock").onclick = () => {
  const childMode = { unlocked: false };
  chrome.storage.sync.set({ childMode });
  renderChildGate(childMode);
};

chrome.storage.sync.get({ childMode: { unlocked: false } }, (s) =>
  renderChildGate(s.childMode)
);
