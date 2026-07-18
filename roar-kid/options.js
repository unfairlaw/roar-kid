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

// ------------------------------------------------------------------- UI

const $ = (id) => document.getElementById(id);
let pending = null;

chrome.storage.local.get({ apiKeys: {} }, ({ apiKeys }) => {
  for (const p of PROVIDERS) {
    if (apiKeys[p]) { $(`k-${p}`).value = apiKeys[p]; $(`s-${p}`).textContent = "✓"; }
  }
});

$("saveKeys").onclick = () => {
  const apiKeys = {};
  for (const p of PROVIDERS) {
    const v = $(`k-${p}`).value.trim();
    if (v) apiKeys[p] = v;
    $(`s-${p}`).textContent = v ? "✓" : "";
  }
  chrome.storage.local.set({ apiKeys });
};

$("extract").onclick = async () => {
  $("err").textContent = "";
  const file = $("photo").files[0];
  const provider = $("provider").value;
  if (!file) { $("err").textContent = "Choose a photo first."; return; }

  const { apiKeys = {} } = await chrome.storage.local.get("apiKeys");
  const key = apiKeys[provider];
  if (!key) { $("err").textContent = `No ${provider} key saved above.`; return; }

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
