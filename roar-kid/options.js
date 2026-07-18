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

// Gemini's responseSchema is OpenAPI-style: nullable flag, not type arrays
function geminiSchema() {
  const s = structuredClone(SCHEMA);
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
      description: "The panel's recorded deliberation: transcription of the table, then the mapping of corrected values" },
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
  try { return await LanguageModel.create({ ...base, samplingMode: "most-predictable" }); }
  catch {
    try { return await LanguageModel.create({ ...base, temperature: 0, topK: 1 }); }
    catch { return LanguageModel.create(base); }
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

  // The provider is whichever box holds a key. A typed key wins over a
  // saved one (and never has to touch disk); saved is the fallback.
  const typed = typedProviders();
  const { apiKeys = {} } = await chrome.storage.local.get("apiKeys");
  const provider = typed[0] ?? PROVIDERS.find((p) => apiKeys[p]);
  if (!provider) {
    // No key anywhere: use the on-device engine when this machine has it.
    if (builtinAvailable) return runBuiltin();
    $("err").textContent =
      "Paste one provider's API key above first (saving it is optional).";
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
    const right = fillGaps(raw.right);
    const left = fillGaps(raw.left);
    pending = {
      right: clean(right.out),
      left: clean(left.out),
      inferred: [...new Set([...right.inferred, ...left.inferred])],
      meta: raw,
    };
    renderPreview();
  } catch (e) {
    $("err").textContent = `Extraction failed — ${e.message}`;
  } finally {
    $("extract").disabled = false;
    $("busy").style.display = "none";
  }
};

function renderPreview() {
  const head = `<tr><th></th>${BANDS.map(
    (f) => `<th>${f >= 1000 ? f / 1000 + "k" : f}</th>`).join("")}</tr>`;
  const row = (label, cls, vals) =>
    `<tr><th>${label}</th>${vals.map((v) => `<td class="${cls}">${v}</td>`).join("")}</tr>`;
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
  $("preview").style.display = "block";
}

$("apply").onclick = () => {
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
    const a = await LanguageModel.availability({ expectedInputs: [{ type: "image" }] });
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
    const right = fillGaps(raw.right);
    const left = fillGaps(raw.left);
    pending = {
      right: clean(right.out),
      left: clean(left.out),
      inferred: [...new Set([...right.inferred, ...left.inferred])],
      meta: raw,
    };
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
