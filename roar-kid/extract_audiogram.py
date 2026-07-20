"""Roar, kid! audiogram extraction — image -> validated thresholds JSON.

Provider-agnostic via LangChain's init_chat_model. Structured output via
Pydantic schema. Deterministic-as-possible: temperature=0 everywhere,
seed=22 where the provider supports it (OpenAI, xAI/Grok, Gemini;
Anthropic has no seed parameter), high-detail image where supported.

Usage:
    export OPENAI_API_KEY=... (or ANTHROPIC_API_KEY / GOOGLE_API_KEY / XAI_API_KEY)
    python extract_audiogram.py photo.jpg --provider openai
    python extract_audiogram.py photo.jpg --provider anthropic -o thresholds.json

Output JSON matches the extension's chrome.storage schema:
    {"right": [db250, db500, db1k, db2k, db3k, db4k, db6k, db8k], "left": [...]}

Deps: pip install langchain "langchain[openai,anthropic,google-genai]"
      (xAI/Grok uses the OpenAI client with base_url override)
"""

from __future__ import annotations

import argparse
import base64
import json
import mimetypes
import sys
from pathlib import Path

from langchain.chat_models import init_chat_model
from pydantic import BaseModel, Field, field_validator

BANDS_HZ = [250, 500, 1000, 2000, 3000, 4000, 6000, 8000]
SEED = 22  # arbitrary fixed seed for reproducibility where supported

# ---------------------------------------------------------------- schema

class EarThresholds(BaseModel):
    """dB HL thresholds at 250, 500, 1k, 2k, 3k, 4k, 6k, 8k Hz, in order."""

    thresholds_db_hl: list[float | None] = Field(
        ...,
        min_length=8,
        max_length=8,
        description=(
            "Eight hearing thresholds in dB HL for 250, 500, 1000, 2000, "
            "3000, 4000, 6000, 8000 Hz, in ascending frequency order. "
            "Use null for any frequency not present in the report."
        ),
    )

    @field_validator("thresholds_db_hl")
    @classmethod
    def clamp_and_snap(cls, v: list[float | None]) -> list[float | None]:
        # Clinical audiograms use 5 dB steps in roughly -10..120 dB HL;
        # the extension clamps to 70 (mild-moderate scope).
        return [None if x is None else round(max(-10, min(70, x)) / 5) * 5
                for x in v]


def fill_gaps(vals: list[float | None]) -> tuple[list[float], list[int]]:
    """Interpolate untested (null) frequencies from tested neighbors.

    Done here, deterministically, rather than by the model: the model
    transcribes what is on paper; inference is the software's job.
    Returns (filled values, indices that were inferred).
    """
    tested = [i for i, v in enumerate(vals) if v is not None]
    if not tested:
        raise ValueError("no thresholds could be read for this ear")
    out, inferred = [], []
    for i, v in enumerate(vals):
        if v is not None:
            out.append(v)
            continue
        lo = max((j for j in tested if j < i), default=None)
        hi = min((j for j in tested if j > i), default=None)
        if lo is None:
            x = vals[hi]
        elif hi is None:
            x = vals[lo]
        else:
            x = (vals[lo] + vals[hi]) / 2
        out.append(round(x / 5) * 5)
        inferred.append(i)
    return out, inferred


def plausibility_warnings(right: list[float], left: list[float]) -> list[str]:
    """Physiological plausibility screen over the filled threshold pairs.

    Flags the misread patterns documented in the LLM-audiogram literature
    (fabricated flat traces, symbol/ear swaps, gridline slips). Warnings
    are for the human reviewer — nothing is auto-corrected.
    """
    hz = lambda f: f"{f // 1000} kHz" if f >= 1000 else f"{f} Hz"  # noqa: E731
    warnings: list[str] = []
    for i, f in enumerate(BANDS_HZ):
        if abs(right[i] - left[i]) > 40:
            warnings.append(
                f"left/right differ by {abs(right[i] - left[i]):.0f} dB at "
                f"{hz(f)} — check the symbols weren't swapped"
            )
    for label, vals in (("right", right), ("left", left)):
        for i in range(1, len(vals)):
            if abs(vals[i] - vals[i - 1]) > 30:
                warnings.append(
                    f"steep {abs(vals[i] - vals[i - 1]):.0f} dB jump between "
                    f"{hz(BANDS_HZ[i - 1])} and {hz(BANDS_HZ[i])} "
                    f"({label} ear) — worth a second look"
                )
    both = right + left
    if all(v == both[0] for v in both):
        warnings.append(
            f"every value reads {both[0]:.0f} dB HL — perfectly flat "
            "identical ears are a classic misread"
        )
    return warnings


class Audiogram(BaseModel):
    """Extracted audiogram. Right ear = red O symbols, left ear = blue X."""

    right: EarThresholds = Field(..., description="Right ear (red circles, 'O').")
    left: EarThresholds = Field(..., description="Left ear (blue crosses, 'X').")
    read_from_table: bool = Field(
        ...,
        description=(
            "True if values were read from a printed numeric table on the "
            "report, False if estimated from plotted chart symbols."
        ),
    )
    confidence_note: str = Field(
        ...,
        description="One sentence: anything ambiguous, occluded, or guessed.",
    )


# Shared with the extension (options.js loads the same file).
PROMPT = (Path(__file__).parent / "prompt.txt").read_text(encoding="utf-8")

# ------------------------------------------------------------- providers

def build_model(provider: str):
    """Return a structured-output model tuned for extraction.

    temperature=0 everywhere; seed and image detail applied per provider
    capability (Anthropic exposes no seed — its determinism comes from
    temperature 0 plus our schema validation).
    """
    p = provider.lower()
    if p == "openai":
        m = init_chat_model("openai:gpt-5.2", temperature=0, seed=SEED)
    elif p == "anthropic":
        m = init_chat_model("anthropic:claude-sonnet-4-6", temperature=0)
    elif p in ("google", "gemini"):
        m = init_chat_model(
            "google_genai:gemini-3.5-flash", temperature=0,
            generation_config={"seed": SEED},
        )
    elif p in ("xai", "grok"):
        # Grok speaks the OpenAI protocol
        m = init_chat_model(
            "openai:grok-4", temperature=0, seed=SEED,
            base_url="https://api.x.ai/v1",
            api_key_env="XAI_API_KEY",
        )
    else:
        raise ValueError(f"Unknown provider: {provider}")
    return m.with_structured_output(Audiogram)


def image_content_block(path: Path, provider: str) -> dict:
    mime = mimetypes.guess_type(path.name)[0] or "image/jpeg"
    b64 = base64.b64encode(path.read_bytes()).decode()
    if provider.lower() in ("openai", "xai", "grok"):
        # 'detail: high' is an OpenAI-protocol knob for full-resolution tiling
        return {
            "type": "image_url",
            "image_url": {"url": f"data:{mime};base64,{b64}", "detail": "high"},
        }
    # Anthropic / Gemini take the image at native resolution
    return {
        "type": "image",
        "source_type": "base64",
        "mime_type": mime,
        "data": b64,
    }

# ------------------------------------------------------------------ main

def extract(image_path: Path, provider: str) -> Audiogram:
    model = build_model(provider)
    message = {
        "role": "user",
        "content": [
            {"type": "text", "text": PROMPT},
            image_content_block(image_path, provider),
        ],
    }
    return model.invoke([message])


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("image", type=Path, help="Photo of the audiogram report")
    ap.add_argument(
        "--provider",
        default="openai",
        choices=["openai", "anthropic", "google", "gemini", "xai", "grok"],
    )
    ap.add_argument("-o", "--out", type=Path, help="Write JSON here (default: stdout)")
    args = ap.parse_args()

    result = extract(args.image, args.provider)

    right, right_inferred = fill_gaps(result.right.thresholds_db_hl)
    left, left_inferred = fill_gaps(result.left.thresholds_db_hl)
    warnings = plausibility_warnings(right, left)
    payload = {
        "right": right,
        "left": left,
        "_meta": {
            "read_from_table": result.read_from_table,
            "confidence_note": result.confidence_note,
            "inferred_hz": {
                "right": [BANDS_HZ[i] for i in right_inferred],
                "left": [BANDS_HZ[i] for i in left_inferred],
            },
            "plausibility_warnings": warnings,
            "bands_hz": BANDS_HZ,
            "provider": args.provider,
            "review_required": True,  # always confirm on the audiogram canvas
        },
    }
    for w in warnings:
        print(f"warning: {w}", file=sys.stderr)
    text = json.dumps(payload, indent=2)
    if args.out:
        args.out.write_text(text)
        print(f"wrote {args.out}", file=sys.stderr)
    else:
        print(text)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
