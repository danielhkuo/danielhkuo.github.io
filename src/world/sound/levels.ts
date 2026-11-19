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
/** World low-pass (Hz, Q_FLAT_DB): wide open in clear air; mist closes it (below). */
export const WORLD_LOWPASS_HZ = 20000;
/**
 * Mist (the weather's 0–1): the world low-pass falls from WORLD_LOWPASS_HZ to this in log frequency, and the world bus
 * by MIST_WORLD_DB, so everything but the wind at the listener's ears goes soft and a little far. A storytelling
 * convention: real fog hardly muffles sound (Engine §1).
 */
export const MIST_LOWPASS_HZ = 3500;
export const MIST_WORLD_DB = -2;
/** Night (the air's 0–1 darkness): the share of the gull colonies' calls still made at full night. */
export const NIGHT_GULLS = 0.15;
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

// ── Rain (§13) ───────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * The rain bed's shape (§14.2). The drops (synth/drops.ts) and the plinks (read `plinkRate` times their speed) are
 * each read three times, `across`: at its rate (a share of the layer's), set at its place (pan), its pitch wandering
 * on drift channel `drift` by `cents` × `wanderCents` (the drift runs −1 … 1: two of the three never wander together);
 * the plinks by `plinkCents`.
 * The plinks (synth/bubbles.ts, `RAIN_PLINKS`: their sizes give them their range of pitch) are read near their own
 * speed, `plinkSpread`, so each read comes round only every 11 s or so. The sheet: pink noise through a wide band-pass and a low-pass. The water's
 * fizz: white noise above `fizzHz`, its top
 * shelved, a share `fizzShare` of the bubbles' level. Q is linear for the band-passes. `landFloor`: the drops' share
 * over open sea (on the dragon and the waves).
 */
export const RAIN = {
  across: [
    { rate: 1, pan: -0.8, drift: 0, cents: 1 },
    { rate: 1.137, pan: 0, drift: 1, cents: 1 },
    { rate: 0.883, pan: 0.8, drift: 0, cents: -1 },
  ],
  wanderCents: 30, plinkCents: 60,
  sheetHz: 2000, sheetQ: 0.5, sheetTopHz: 4500,
  plinkHz: 2400, plinkQ: 0.6, plinkRate: 1, plinkSpread: [1.06, 0.95, 1.0], fizzHz: 5000, fizzShare: 0.2,
  topHz: 7000, topDb: -9,
  landFloor: 0.25,
};
/**
 * Rain's gains at a full shower (linear). Set (§14.2) so that most drops carry over the wind and the surf: a full
 * shower alone is −26.4 LUFS over land, −33 over open sea, and adds about 1 LU at the coast.
 */
export const K_RAIN = { patter: 0.24, sheet: 0.021, fizz: 0.1 };

// ── Rivers and falls (§3.2, §4.4, §4.5) ──────────────────────────────────────────────────────────────────────────────

/**
 * The river bed's three gains (each × the square root of an energy sum) and a fall's level, small (a run of 6 rows
 * or fewer) and tall (18 or more). Calibrated: a river 20 cells off at −33 LUFS, a small fall at 20 cells −28, a tall
 * fall at 30 cells −22.
 */
export const K_RIVER = { flow: 0.007, brook: 0.007, riffle: 0.003, fallSmall: 0.565, fallTall: 0.66 };
/** The share of a stream's energy that feeds the purl as well as the brook. */
export const RIVER_STREAM_PURL = 0.15;
/** The riffle: band-pass (LINEAR Q). The bed's reads of the bubble beds run at rates between these. */
export const RIVER = { riffleHz: 1800, riffleQ: 0.6, rateLo: 0.94, rateHi: 1.06 };
/**
 * A fall's voice. Body: band-pass (LINEAR Q) at bodyHz[0] for a small fall, bodyHz[1] for a tall one. Hiss: high-pass
 * (Q_FLAT_DB), breathing by ±`breathe` of its level on a slow drift (about ±2 dB). Plunge: the bubble bed under a
 * low-pass (Q_FLAT_DB). Rumble (tall falls only): brown under a low-pass (Q_FLAT_DB). Then each part's share of the
 * voice: body, hiss, plunge, rumble (× tallness), brook (× smallness).
 */
export const FALL = {
  bodyHz: [1600, 900] as [number, number], bodyQ: 0.5, hissHz: 4000, breathe: 0.23, plungeHz: 1200, rumbleHz: 140,
  body: 0.7, hiss: 0.2, plunge: 0.6, rumble: 1.8, brook: 0.4,
  /** A reported fall within this many cells of a voice's place is that voice's fall; the place follows it at this time constant. */
  near: 12, tau: 0.25,
  /** A fall with no voice takes the spare chain when it beats the weaker sounding fall by this ratio (6 dB) for this long; the crossfade takes this long. */
  beats: 2, forS: 0.5, crossS: 0.5,
};

// ── Bells (§3.4, §4.6) ───────────────────────────────────────────────────────────────────────────────────────────────

/**
 * A stroke's ring and its strike, linear (their buffers peak at 0.5), the reverb send's level at the tower, and how
 * far wind and water yield while the abbey rings, dB.
 * Calibrated at the tower (60 cells): the peal at −21 LUFS, its momentary loudness no higher than −18.
 */
export const K_BELL = { ring: 0.372, strike: 0.372, send: 0.251, duck: 3 };
/** Under reduced motion the strike is this much softer, dB. */
export const BELL_CALM_STRIKE_DB = -4;
/** A stroke beyond a bell's ring cap fades that bell's oldest ring at this time constant, seconds. */
export const BELL_CAP_TAU = 0.25;
/** The abbey's two slots sit this far either side of its place, × near; near falls from 1 to 0 between these distances, cells. */
export const BELL_SPREAD = 0.3;
export const BELL_NEAR: [number, number] = [60, 200];
/** Far off (0 … 1 between these distances, cells) the slots' level and cutoff wander on the drifts: by this share (about ±4 dB) and by these cents. */
export const BELL_FAR: [number, number] = [150, 900];
export const BELL_WANDER = { gain: 0.45, cents: 300 };
/** While the abbey rings, wind and water yield K_BELL.duck dB: in full once the abbey's own gain passes the upper edge, not at all under the lower. */
export const BELL_DUCK_EDGES_DB: [number, number] = [-16, -6];

// ── Gulls (§4.7, §4.11) ──────────────────────────────────────────────────────────────────────────────────────────────

/**
 * A call's notes, a startled bird's keks and its wingbeats, linear (their buffers peak at 0.5), and the reverb
 * send's level. Calibrated: a call 40 cells off peaks at −30 LUFS momentary.
 * `near`: the most a startled bird is given of a lone bird's level (1 within the small class's reference distance),
 * so the nearest are heard as one about 51 cells off. Without it, birds put up close ahead of a boosting flier, two
 * at once, peaked at −3.8 dBTP in the recorded flights (§9.1's bar is −4.5); the bench's beach pass is unchanged (§13).
 */
export const K_GULL = { call: 0.18, kek: 1.15, flap: 0.1, send: 0.158, near: 0.7 };

// ── The clock and the moments (§4.8–4.10) ────────────────────────────────────────────────────────────────────────────

/** The town clock: a chime, a clack, the doors' thud, the ratchet's loop, the whirr, and the reverb send. Calibrated: the tune 60 cells off at −27 LUFS. */
export const K_CLOCK = { chime: 0.4, clack: 0.2, thud: 0.2, ratchet: 0.05, whirr: 0.04, send: 0.1 };
/** The train: a chuff, a wheel click, the steam swell, the whistle, the spray at 18 cells a second. Calibrated 60 cells off: chuffs at −26 LUFS, the whistle at −21. */
export const K_TRAIN = { chuff: 1.0, click: 0.15, swell: 0.3, whistle: 0.75, spray: 0.09 };
/** The seaplane: its engine, the prop wash (against the engine), the purl under its floats, a splash, a last pop. Calibrated: its approach 60 cells off at −24 LUFS. */
export const K_PLANE = { engine: 0.5, wash: 1.2, purl: 0.15, splash: 0.6, pop: 0.5 };
/** The ferry: its engine's thump, the bow wash, the horn; the baths' steam and the brook of their pools. Calibrated: the horn 80 cells off at −20 LUFS. */
export const K_FERRY = { thump: 0.6, wash: 0.1, horn: 0.82, steam: 0.006, pools: 0.012 };
/** The church's flock: a wingbeat, a ripple's lap. Calibrated: the lift 60 cells off at −30 LUFS. */
export const K_FLOCK = { flap: 0.4, lap: 0.15 };

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
