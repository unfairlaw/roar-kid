// Spike: can Chrome's built-in Gemini Nano (Prompt API) extract audiogram
// thresholds well enough to become a keyless, fully on-device import path?
// Uses the SAME prompt.txt and JSON schema as the shipping extension, so a
// pass here transfers directly. Everything (including raw errors) is logged
// on-page — this spike exists to learn how the API behaves on this machine.

const BANDS = [250, 500, 1000, 2000, 3000, 4000, 6000, 8000];

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

// Diagnostic variant: same fields plus a "reasoning" transcript that the
// model must write BEFORE the arrays, so the answer follows the reasoning.
const SCHEMA_DIAG = {
  type: "object",
  properties: {
    reasoning: { type: "string",
      description: "The panel's recorded deliberation: source choice, how each row/symbol was read, how every slot was decided" },
    ...SCHEMA.properties,
  },
  required: ["reasoning", ...SCHEMA.required],
  additionalProperties: false,
};

const $ = (id) => document.getElementById(id);
const log = (msg) => { $("log").textContent += "\n" + msg; };

async function availability() {
  $("log").textContent = "checking availability…";
  if (typeof LanguageModel === "undefined") {
    log("LanguageModel API not present — Chrome too old, or built-in AI " +
        "unsupported on this hardware/platform.");
    return "unavailable";
  }
  const plain = await LanguageModel.availability();
  log(`text-only availability: ${plain}`);
  let multi = "unavailable";
  try {
    multi = await LanguageModel.availability({ expectedInputs: [{ type: "image" }] });
    log(`image-input availability: ${multi}`);
  } catch (e) {
    log(`image-input availability check threw: ${e.message}`);
  }
  try {
    const params = await LanguageModel.params();
    log(`params: ${JSON.stringify(params)}`);
  } catch { /* older builds lack params() */ }
  return multi;
}

async function makeSession() {
  return LanguageModel.create({
    expectedInputs: [{ type: "image" }],
    monitor(m) {
      m.addEventListener("downloadprogress", (e) => {
        log(`model download: ${Math.round((e.loaded / (e.total || 1)) * 100)}%`);
      });
    },
  });
}

async function extract(blob) {
  const promptFile = $("promptSel").value;
  const schema = promptFile === "prompt.txt" || promptFile === "prompt-nano.txt"
    ? SCHEMA : SCHEMA_DIAG;
  log(`prompt: ${promptFile}`);
  const prompt = await (await fetch(chrome.runtime.getURL(promptFile))).text();
  const bitmap = await createImageBitmap(blob);
  log(`image: ${bitmap.width}x${bitmap.height}`);
  const session = await makeSession();
  log("session created, prompting…");
  const t0 = performance.now();

  const messages = [{
    role: "user",
    content: [
      { type: "text", value: prompt },
      { type: "image", value: bitmap },
    ],
  }];
  let raw;
  try {
    raw = await session.prompt(messages, { responseConstraint: schema });
  } catch (e) {
    // Older builds want the image via append(), or reject responseConstraint
    // with multimodal input. Try the fallback and report which shape worked.
    log(`prompt(messages, responseConstraint) failed: ${e.message}`);
    log("retrying without responseConstraint…");
    raw = await session.prompt(messages);
  }
  const secs = ((performance.now() - t0) / 1000).toFixed(1);
  log(`model answered in ${secs}s`);
  log(`raw output:\n${raw}`);
  session.destroy();

  // With responseConstraint the output is pure JSON; without it the model
  // may wrap it in prose or fences — salvage the first JSON object.
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("no JSON object in model output");
  return JSON.parse(match[0]);
}

function score(parsed, truth) {
  let hits = 0;
  const head = `<tr><th></th>${BANDS.map(
    (f) => `<th>${f >= 1000 ? f / 1000 + "k" : f}</th>`).join("")}<th>score</th></tr>`;
  const row = (label, got, want) => {
    let ok = 0;
    const cells = BANDS.map((_, i) => {
      const g = got?.[i], w = want[i];
      const good = g === w;
      if (good) { ok++; hits++; }
      return `<td class="${good ? "ok" : "bad"}">${g ?? "∅"}<br><small>${w}</small></td>`;
    }).join("");
    return `<tr><th>${label}</th>${cells}<td>${ok}/8</td></tr>`;
  };
  $("result").innerHTML =
    `<table>${head}${row("Right O", parsed.right, truth.right)}${row("Left X", parsed.left, truth.left)}</table>` +
    `<p><b>Total: ${hits}/16 exact.</b> (model value on top, ground truth below)<br>` +
    `read_from_table: ${parsed.read_from_table} — ${parsed.confidence_note ?? ""}</p>`;
  log(`SCORE: ${hits}/16`);
}

async function run(blob, truth) {
  $("run").disabled = $("runFile").disabled = true;
  $("result").innerHTML = "";
  try {
    const parsed = await extract(blob);
    if (parsed.reasoning) log(`REASONING:\n${parsed.reasoning}`);
    if (truth) score(parsed, truth);
    else {
      $("result").innerHTML =
        `<pre>${JSON.stringify(parsed, null, 2)}</pre>` +
        `<p>No ground truth for this image — inspect by eye against the report.</p>`;
    }
  } catch (e) {
    log(`FAILED: ${e.message}`);
  } finally {
    $("run").disabled = false;
    $("runFile").disabled = !$("photo").files[0];
  }
}

$("run").onclick = async () => {
  const blob = await (await fetch(chrome.runtime.getURL("test_audiogram.png"))).blob();
  const truth = await (await fetch(chrome.runtime.getURL("test_audiogram_truth.json"))).json();
  run(blob, truth);
};
$("photo").onchange = () => { $("runFile").disabled = !$("photo").files[0]; };
$("runFile").onclick = () => run($("photo").files[0], null);

availability().then((a) => {
  if (a === "unavailable") log("\nVerdict: built-in AI path NOT feasible on this machine.");
  else log(`\nReady (state: ${a}). First run may trigger the model download.`);
});
