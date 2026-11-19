// Every level and filter constant of the world's sound, with its unit (design §3.6). The `k`s are calibrated against
// the solo targets of §3.6 with the bench renders and then pinned by the checker; change one only with a render.
//
// Units. Gains are linear amplitude unless the name ends in `Db`. Frequencies are Hz. For Web Audio's `lowpass` and
// `highpass`, Q is in DECIBELS: every one of ours is Q_FLAT_DB (Butterworth, no resonant bump) unless a number is
// given here. Band-pass and peaking Qs are LINEAR.

/** Q (dB) of every low-pass and high-pass: −3.01 dB is the Butterworth response. */
export const Q_FLAT_DB = -3.01;

// ── Master chain (§6.1) ──────────────────────────────────────────────────────────────────────────────────────────────

/** High-pass before the volume, Hz (Q_FLAT_DB): nothing useful lives under it and small speakers distort there. */
export const MASTER_HIGHPASS_HZ = 25;
/** The compressor is a safety limiter only; the mix must never make it work. dB, dB, ratio, seconds, seconds. */
export const LIMITER = { thresholdDb: -3, kneeDb: 0, ratio: 20, attackS: 0.003, releaseS: 0.25 };
/**
 * The compressor's fixed make-up at those settings, undone (dB). Measured in phase 0 with a −20 dBFS tone through the
 * chain: Chrome 148 and Firefox 160 both come out at −20.00 dBFS with this trim (see §6.9 of the design).
 */
export const LIMITER_TRIM_DB = -1.7;
/** The limiter delays everything by its look-ahead, seconds (6 ms in Chrome 148 and Firefox 160, measured). */
export const LIMITER_DELAY_S = 0.006;
/**
 * `reduction` reads −12 dB when a context starts and settles toward the truth with a time constant near 0.33 s
 * (measured: its meter, not the audio). Readings before this many seconds of context time are not trusted.
 */
export const LIMITER_METER_SETTLE_S = 3;
/** The soft clip is linear to this sample value, then bends toward 1. */
export const CLIP_KNEE = 0.7;
/** World low-pass (Hz, Q_FLAT_DB): wide open now; mist will close it later. */
export const WORLD_LOWPASS_HZ = 20000;
/** The limiter may not pull the level down by more than this (dB) anywhere in a render. */
export const LIMITER_IDLE_DB = -0.5;

// ── Wind (§3.3, §4.1) ────────────────────────────────────────────────────────────────────────────────────────────────

/** Layer gains at cruise (linear). Calibrated: wind alone reads −34 / −27 / −21 LUFS at brake / cruise / boost. */
export const K_WIND = {
  /** A, the ear buffet (per ear). */
  a: 0.36,
  /** B, the rush. */
  b: 0.32,
  /** C, the hiss. */
  c: 0.117,
  /** D, the whistles (their sum, at full squall). */
  d: 0.6,
  /** E, the ground breeze. */
  e: 0.038,
  /** The turn whoosh at its fullest. */
  w: 0.25,
};

/**
 * The speed the wind hears follows the dragon's, but changes by no more than this share a second (e-folds: 1 is
 * 8.7 dB a second on the rush). Flight's own easing is slower than this except at touchdown and take-off, where the
 * wind would otherwise leap 17 dB in half a second. Below WIND_FLOOR (of cruise) the breeze covers the wind, so the
 * limit starts from there.
 */
export const WIND_SLEW = 1;
export const WIND_FLOOR = 0.12;
/** A: a high-pass (Q_FLAT_DB, Hz) under the buffet, so it has weight without the sub-bass that eats headroom. */
export const A_HIGHPASS_HZ = 45;
/**
 * A second high-pass (Q_FLAT_DB, Hz) on the whole wind bus: with A's own it falls 24 dB an octave under the buffet's
 * body (80–250 Hz), so less than 8 % of the wind's power lies under 60 Hz even at boost.
 */
export const WIND_HIGHPASS_HZ = 75;
/** A: low-pass (Q_FLAT_DB) cutoff per unit of s, and its clamp, Hz; then a peaking bump (LINEAR Q). */
export const A_CUT_HZ = 110;
export const A_CUT_RANGE: [number, number] = [40, 260];
export const A_PEAK = { hz: 250, db: 4, q: 1.2 };
/** Each ear's buffet gain is 0.6 + 0.4 · its flutter signal. */
export const A_FLUTTER: [number, number] = [0.6, 0.4];
/** Bank tilt of A at full bank: the outside ear up, the inside ear down, dB. */
export const A_TILT_DB = 1.5;
/** A's gain goes as s to this power: brake to boost spans 14 dB. */
export const A_EXP = 1.25;

/** B: band-pass (LINEAR Q) centre per unit of s and its clamp, Hz; the gust moves the centre ±this share. */
export const B_HZ = 650;
export const B_RANGE: [number, number] = [250, 1300];
export const B_Q = 0.7;
export const B_GUST = 0.15;
/** The gust also breathes on B's level: gain × (B_SWELL[0] + B_SWELL[1]·gust), about −2.5 … +2 dB. */
export const B_SWELL: [number, number] = [0.75, 0.5];
/** B's high shelf: dB at Hz. */
export const B_SHELF = { hz: 5000, db: -6 };

/** C: high-pass (Q_FLAT_DB) Hz, then a low-pass (Q_FLAT_DB) at C_LOW[0] + C_LOW[1]·s Hz. Silent under s = C_FROM. */
export const C_HIGHPASS_HZ = 2500;
export const C_LOW: [number, number] = [3000, 2500];
export const C_FROM = 0.6;
/** The swell on C while speed is rising: gain × (1 + this · push). */
export const C_PUSH = 0.6;

/** D: three whistles. Centres at s = 1 (Hz), band-pass Qs (LINEAR), fixed pans, and how far each one's gust bends it. */
export const D_HZ: [number, number, number] = [520, 910, 1480];
export const D_Q: [number, number, number] = [30, 38, 45];
export const D_PAN: [number, number, number] = [-0.5, 0.3, 0.7];
export const D_GUST = 0.12;
export const D_FROM = 0.8;

/** E: band-pass (LINEAR Q) then low-pass (Q_FLAT_DB), Hz; its gain is × (E_GUST[0] + E_GUST[1]·gust), and × (1 + E_REST·rest). */
export const E_BAND = { hz: 400, q: 0.5 };
export const E_LOWPASS_HZ = 1500;
export const E_GUST: [number, number] = [0.4, 0.6];
export const E_REST = 0.8;

/** The whoosh: band-pass (LINEAR Q); centre W_HZ[0] + W_HZ[1]·|bank|^0.7·s Hz; pan at full bank. */
export const W_Q = 1.1;
export const W_HZ: [number, number] = [500, 900];
export const W_PAN = 0.3;
/** The whoosh opens between these banks: a 50 ms tap reaches 0.27 (shut), a 150 ms turn 0.61 (open). */
export const W_GATE: [number, number] = [0.35, 0.6];
/**
 * The whoosh is a bloom on the change of bank and a faint pressure through a held turn. The bloom is the roll rate
 * (|d bank/dt|) smoothed twice at W_BLOOM_TAU seconds, so it swells and falls with no step, over W_BLOOM_FULL (a
 * roll rate; the smoothed rate of one full turn's entry reaches about this). The hold is W_HOLD · |bank| · s: about
 * 10 dB under the bloom's peak.
 */
export const W_BLOOM_TAU = 0.3;
export const W_BLOOM_FULL = 1.1;
export const W_HOLD = 0.28;
/**
 * The whoosh rises in a straight line in decibels, W_RISE e-folds a second (2.1 is 18 dB a second), counted from
 * W_FLOOR of its fullest: a swell with no step. (On its own it must cross 15 LU from silence to its peak, and a rise
 * that a momentary meter reads as under 3 LU per 100 ms cannot do that in less than half a second.)
 */
export const W_RISE = 2.1;
export const W_FLOOR = 0.2;

/** At boost the world yields this much to the wind, and under the Codex this much more, dB. */
export const WORLD_BOOST_DB = -2;
export const WORLD_REST_DB = -6;

// ── Surf (§3.2, §4.3) ────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * How loud each part of a wave is, by shore kind: low (rumble, boom), mid (crash, body), high (hiss, spray), grain
 * (the shingle's rattle), slosh (the rock's gully). Linear; baked into the envelope buffers. Calibrated 25 cells off:
 * the big beach wave peaks at −20 LUFS momentary, the rock's boom at −19, shingle at −21.
 */
export const K_SURF = {
  beach: [3.2, 1.6, 0.9, 0, 0],
  shingle: [2.0, 1.2, 0.8, 1.6, 0],
  rock: [16, 2.0, 1.1, 0, 0.5],
  /** A wave emitter's chain gain at its nearest. */
  wave: 0.85,
  /** A lap, and the lap that stands for a lull (dB under a lap). */
  lap: 0.12,
  /** The surf bed: hiss, body, rumble, rattle (each × the square root of an energy sum). */
  bedHiss: 0.004,
  bedBody: 0.07,
  bedRumble: 0.008,
  bedRattle: 0.01,
  /** The open sea's wash at its fullest. */
  open: 0.05,
};

/** The emitter's fixed filters: the hiss's top (low-pass, Q_FLAT_DB), the crash's band (LINEAR Q), the rattle and slosh band (LINEAR Q). */
export const WAVE_HISS_TOP_HZ = 9000;
export const WAVE_MID_Q = 0.8;
export const WAVE_BAND_Q = 1.5;
/** The foam's sizzle: the hiss's gain is SIZZLE[0] + SIZZLE[1] · flutter, about ±2 dB at 8–14 Hz, live, so it never repeats. */
export const SIZZLE: [number, number] = [0.8, 0.45];

/** The surf bed's bands: rumble low-pass (Q_FLAT_DB), body band-pass (LINEAR Q), hiss high-pass (Q_FLAT_DB), rattle band-pass (LINEAR Q). */
export const BED = { rumbleHz: 180, bodyHz: 600, bodyQ: 0.6, hissHz: 2500, rattleHz: 3600, rattleQ: 1.5 };
/** The bed's two halves each wander by this share on their own slow drift (about ±1.5 dB). */
export const BED_WANDER = 0.17;
/**
 * How far apart the bed's two halves are panned when the surf is all round (spread 1): hard left and right. (The
 * design had 0.8, which leaves the halves correlated at 0.31 at best, over the 0.3 the cove is held to.)
 */
export const BED_SPREAD = 1;
/** The open sea: band-pass (LINEAR Q). */
export const OPEN = { hz: 700, q: 0.4 };
/** A bed is stopped when every gain has been under BED_OFF for BED_OFF_S seconds, and built again when one passes BED_ON. */
export const BED_OFF = 1e-3;
export const BED_ON = 2e-3;
export const BED_OFF_S = 2;

// ── Smoothing (§3.5): time constants in seconds ──────────────────────────────────────────────────────────────────────

export const TAU = {
  /** A voice whose buffers arrived late comes in at this. */
  late: 0.5,
  mute: 0.04,
  /** Tab hidden: a linear ramp of this length, then everything is stopped. */
  hideRamp: 0.2,
  steal: 0.015,
  /** A long sound joined in progress comes in at this (95 % in 30 ms). */
  rejoin: 0.01,
};

/**
 * Fade-ins of the whole mix rise in a straight line in decibels (a setTargetAtTime fade starts far too steeply for
 * that: measured, +8 LU in its first 100 ms). Seconds, and the level the line starts from (under −50 LUFS for our mix,
 * so the step onto it is not heard). The first enable is slow; an unmute or a return to the tab is quicker. Both stay
 * under 4 LU per 100 ms on a momentary meter.
 */
export const FADE_IN = {
  first: { seconds: 1.5, fromDb: -36 },
  again: { seconds: 0.9, fromDb: -26 },
};
