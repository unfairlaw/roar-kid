// Roar, kid! shared DSP module.
// Loaded before content.js (content_scripts array) and by tests/test.html.
// Everything hangs off globalThis.RoarDSP so both contexts see one API.
//
// Two responsibilities:
//   1. buildCrossoverBank(): a cascaded Linkwitz-Riley (LR4) crossover that
//      splits a signal into the 8 audiometric bands and sums back FLAT at
//      unity — unlike the old parallel bandpass taps, silence-in-the-
//      audiogram now means bit-transparent-in-spirit audio out.
//   2. bandCurves(): per-band input/output curves (gain in dB at 50/65/80 dB
//      program level) for the three selectable targets. These feed the WDRC
//      AudioWorklet, which interpolates between the control points at its
//      RMS-detected input level.

(() => {
  // 8-band diagnostic standard (ASHA): octaves plus 3 and 6 kHz.
  const BANDS_HZ = [250, 500, 1000, 2000, 3000, 4000, 6000, 8000];

  // Crossover points at the geometric means between adjacent bands.
  const XOVER_HZ = BANDS_HZ.slice(0, -1).map((f, i) =>
    Math.sqrt(f * BANDS_HZ[i + 1])
  );

  // CALIBRATION ASSUMPTION (documented, not measured): a full-scale RMS
  // signal is taken as 100 dB SPL at the ear for a typical laptop +
  // headphone at full volume. Every "SPL" in this file is relative to this
  // anchor. Without the calibration step, gains are internally consistent
  // but not absolute — see DOCUMENTATION.md "Calibration".
  const REF_DBSPL_AT_FS = 100;

  // Hard cap on any single band's makeup gain, before the brickwall
  // limiter even gets a say. Mild-to-moderate scope: nothing needs more.
  const MAX_BAND_GAIN_DB = 35;

  // Output ceiling of the brickwall limiter (dBFS).
  const CEILING_DB = -1;

  // ---------------------------------------------------------- crossover

  // Biquad sections built from explicit RBJ cookbook coefficients
  // (bilinear transform, Q = 1/sqrt2) on IIRFilterNode. BiquadFilterNode
  // is deliberately NOT used: browsers interpret its lowpass/highpass Q in
  // dB with implementation-specific designs, which quietly breaks the
  // LP^2 + HP^2 = allpass identity the crossover depends on. With
  // hand-computed coefficients the identity is exact in the digital
  // domain, so the band sum is flat by construction (asserted by tests/).
  function rbj(ctx, type, f) {
    const w0 = (2 * Math.PI * f) / ctx.sampleRate;
    const cosw = Math.cos(w0);
    const alpha = Math.sin(w0) / (2 * Math.SQRT1_2);
    let b;
    if (type === "lowpass") {
      b = [(1 - cosw) / 2, 1 - cosw, (1 - cosw) / 2];
    } else if (type === "highpass") {
      b = [(1 + cosw) / 2, -(1 + cosw), (1 + cosw) / 2];
    } else {
      b = [1 - alpha, -2 * cosw, 1 + alpha]; // allpass
    }
    const a = [1 + alpha, -2 * cosw, 1 - alpha];
    return new IIRFilterNode(ctx, { feedforward: b, feedback: a });
  }

  // One LR4 filter = two cascaded 2nd-order Butterworth sections.
  function lr4(ctx, type, frequency) {
    const a = rbj(ctx, type, frequency);
    const b = rbj(ctx, type, frequency);
    a.connect(b);
    return { input: a, output: b };
  }

  // Serial split: at each crossover the low branch becomes a band and the
  // high branch feeds the next crossover. An LR4 LP+HP pair sums to a
  // 2nd-order allpass at the crossover frequency, so every finished band
  // is passed through matching allpass sections for all LATER crossovers —
  // that phase compensation is what makes the final sum flat.
  function buildCrossoverBank(ctx, input) {
    const bands = [];
    let node = input;
    XOVER_HZ.forEach((f, k) => {
      const lp = lr4(ctx, "lowpass", f);
      const hp = lr4(ctx, "highpass", f);
      node.connect(lp.input);
      node.connect(hp.input);
      let out = lp.output;
      for (let j = k + 1; j < XOVER_HZ.length; j++) {
        const ap = rbj(ctx, "allpass", XOVER_HZ[j]);
        out.connect(ap);
        out = ap;
      }
      bands.push(out);
      node = hp.output;
    });
    bands.push(node); // residue above the last crossover = top band
    return bands;
  }

  // ------------------------------------------------------ prescriptions

  // Each target yields, per band, {g65, ratio}: gain at a 65 dB "speech"
  // program level and a compression ratio. Both are then unfolded into a
  // 3-point I/O curve {g50, g65, g80}. All three are stated approximations
  // of published rules — see DOCUMENTATION.md for what they are NOT.
  const clampGain = (g) => Math.max(0, Math.min(MAX_BAND_GAIN_DB, g));

  const TARGETS = {
    // v0 rule kept as "comfort": conservative half-gain-ish, the least
    // aggressive of the three.
    comfort(H) {
      return H.map((h) => {
        const loss = Math.max(0, Math.min(70, h));
        return { g65: clampGain(loss * 0.45), ratio: 1 + loss / 40 };
      });
    },
    // Adult target, NAL-R-flavored: gain leans on the three-frequency
    // average and per-band corrections; ratios grow gently with loss
    // (NAL-NL2 rarely exceeds ~2.5:1 in this range).
    adult(H) {
      const k = [-17, -8, 0, -1, -2, -2, -2, -2]; // NAL-R band corrections
      const h3fa =
        (Math.max(0, H[1]) + Math.max(0, H[2]) + Math.max(0, H[3])) / 3;
      const x = 0.15 * h3fa;
      return H.map((h, i) => {
        const loss = Math.max(0, Math.min(70, h));
        return {
          g65: clampGain(x + 0.31 * loss + k[i]),
          ratio: 1 + loss / 50,
        };
      });
    },
    // Child target, DSL-v5-flavored: audibility first, so more gain than
    // the adult rule at every band (the literature puts DSL 6-25 dB above
    // NAL for pediatric losses) and slightly stronger compression.
    child(H) {
      return H.map((h) => {
        const loss = Math.max(0, Math.min(70, h));
        return { g65: clampGain(loss * 0.6), ratio: 1 + loss / 35 };
      });
    },
  };

  // Unfold {g65, ratio} into gains at 50/65/80 dB program level: a ratio r
  // means output rises 1/r dB per input dB, i.e. gain falls (1 - 1/r) per
  // input dB above (and rises below) the pivot at 65.
  function bandCurves(thresholds, mode, calOffsets) {
    const target = TARGETS[mode] || TARGETS.comfort;
    const cal = calOffsets || new Array(BANDS_HZ.length).fill(0);
    return target(thresholds).map(({ g65, ratio }, i) => {
      const slope = 1 - 1 / Math.max(1, ratio);
      const off = Math.max(-12, Math.min(12, cal[i] || 0));
      const cap = (g) => Math.max(-12, Math.min(MAX_BAND_GAIN_DB, g + off));
      return {
        g50: cap(g65 + 15 * slope),
        g65: cap(g65),
        g80: cap(g65 - 15 * slope),
      };
    });
  }

  // Generic headphone correction presets (dB per band, added to the user's
  // reference-tone offsets). Rough, published-average shapes — clearly NOT
  // a measurement; the Python mic utility is the real correction path.
  const HEADPHONE_PROFILES = {
    none: [0, 0, 0, 0, 0, 0, 0, 0],
    "bass-heavy": [-4, -3, -1, 0, 1, 2, 2, 2],
    earbuds: [3, 2, 0, 0, 0, 0, 1, 1],
  };

  // Combined calibration offsets from settings.calibration.
  function calibrationOffsets(calibration) {
    const c = calibration || {};
    const prof = HEADPHONE_PROFILES[c.profile] || HEADPHONE_PROFILES.none;
    return BANDS_HZ.map((_, i) => {
      const sum =
        (prof[i] || 0) + (c.userOffsets?.[i] || 0) + (c.micOffsets?.[i] || 0);
      return Math.max(-12, Math.min(12, sum));
    });
  }

  globalThis.RoarDSP = {
    BANDS_HZ,
    XOVER_HZ,
    REF_DBSPL_AT_FS,
    MAX_BAND_GAIN_DB,
    CEILING_DB,
    HEADPHONE_PROFILES,
    buildCrossoverBank,
    bandCurves,
    calibrationOffsets,
  };
})();
