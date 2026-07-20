"""Roar, kid! playback calibration — measure your real headphone response.

Plays a short tone at each of the extension's 8 audiometric bands while
recording through a measurement microphone placed where the ear would be,
then writes the per-band correction (relative to 1 kHz) as JSON that the
extension's options page imports ("Measurement-mic correction").

This is the assisted-absolute calibration tier: it corrects the *shape* of
your playback chain's frequency response. It is NOT clinical probe-mic
verification and says nothing about absolute SPL at the eardrum.

Setup:
    1. Plug in a measurement mic (any flat-ish USB mic works; a $20
       electret measurement mic beats guessing).
    2. Place it inside/against the headphone earcup, roughly at ear
       position. Keep the room quiet.
    3. Set system volume to your NORMAL listening level and leave it there.

Usage:
    pip install numpy sounddevice
    python calibrate_playback.py -o correction.json
    python calibrate_playback.py --list-devices
    python calibrate_playback.py --device 3 --duration 1.5 --level -20

Then: extension options page -> Calibration -> import correction.json.
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

try:
    import numpy as np
    import sounddevice as sd
except ImportError as e:  # pragma: no cover
    print(
        f"missing dependency ({e.name}): pip install numpy sounddevice",
        file=sys.stderr,
    )
    raise SystemExit(1)

BANDS_HZ = [250, 500, 1000, 2000, 3000, 4000, 6000, 8000]
REF_HZ = 1000  # anchor band: corrections are relative to this
CLAMP_DB = 12  # the extension clamps offsets to +/-12 dB; mirror it here


def make_tone(freq: float, fs: int, duration: float, amp: float) -> np.ndarray:
    t = np.arange(int(fs * duration)) / fs
    tone = amp * np.sin(2 * np.pi * freq * t)
    fade = max(1, int(0.02 * fs))  # 20 ms raised-cosine edges, no clicks
    ramp = 0.5 * (1 - np.cos(np.linspace(0, np.pi, fade)))
    tone[:fade] *= ramp
    tone[-fade:] *= ramp[::-1]
    return tone.astype(np.float32)


def band_level_db(rec: np.ndarray, fs: int, freq: float) -> float:
    """Power (dB) in a 1/3-octave window around freq, steady-state portion."""
    seg = rec[int(0.1 * fs): len(rec) - int(0.05 * fs)]
    if len(seg) < fs // 10:
        raise RuntimeError("recording too short to analyze")
    win = np.hanning(len(seg))
    spec = np.abs(np.fft.rfft(seg * win)) ** 2
    freqs = np.fft.rfftfreq(len(seg), 1 / fs)
    lo, hi = freq / 2 ** (1 / 6), freq * 2 ** (1 / 6)
    power = spec[(freqs >= lo) & (freqs <= hi)].sum()
    return 10 * float(np.log10(power + 1e-20))


def measure(fs: int, duration: float, amp: float, device) -> dict[int, float]:
    levels: dict[int, float] = {}
    for f in BANDS_HZ:
        print(f"  {f:>5} Hz ...", end="", flush=True)
        tone = make_tone(f, fs, duration, amp)
        rec = sd.playrec(
            tone.reshape(-1, 1), samplerate=fs, channels=1, device=device
        )
        sd.wait()
        levels[f] = band_level_db(rec[:, 0], fs, f)
        print(f" {levels[f]:7.1f} dB (uncal.)")
    return levels


def main() -> int:
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    ap.add_argument("-o", "--out", type=Path, default=Path("correction.json"))
    ap.add_argument("--duration", type=float, default=1.0, help="seconds per tone")
    ap.add_argument(
        "--level", type=float, default=-26.0, help="tone level in dBFS (default -26)"
    )
    ap.add_argument("--samplerate", type=int, default=48000)
    ap.add_argument(
        "--device", default=None,
        help="sounddevice device index or 'output,input' pair (see --list-devices)",
    )
    ap.add_argument("--list-devices", action="store_true")
    args = ap.parse_args()

    if args.list_devices:
        print(sd.query_devices())
        return 0

    device = args.device
    if isinstance(device, str) and device:
        parts = [int(x) for x in device.split(",")]
        device = parts[0] if len(parts) == 1 else (parts[1], parts[0])

    amp = 10 ** (args.level / 20)
    print(
        "Playing one tone per band and recording the mic. Keep the room "
        "quiet;\ndo not touch the volume until the run finishes.\n"
    )
    levels = measure(args.samplerate, args.duration, amp, device)

    ref = levels[REF_HZ]
    # A band that measured weak (below the 1 kHz anchor) gets a positive
    # correction: the extension boosts it back toward flat.
    correction = [
        max(-CLAMP_DB, min(CLAMP_DB, round((ref - levels[f]) * 2) / 2))
        for f in BANDS_HZ
    ]
    payload = {
        "bands_hz": BANDS_HZ,
        "correction_db": correction,
        "measured_db_rel_1k": {
            str(f): round(levels[f] - ref, 1) for f in BANDS_HZ
        },
        "meta": {
            "tool": "calibrate_playback.py",
            "reference_hz": REF_HZ,
            "tone_level_dbfs": args.level,
            "samplerate": args.samplerate,
            "measured_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "note": (
                "Relative response correction only; not probe-microphone "
                "verification, no absolute SPL claim."
            ),
        },
    }
    args.out.write_text(json.dumps(payload, indent=2))
    print(f"\nwrote {args.out}")
    print("import it in the extension: options -> Calibration -> mic correction")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
