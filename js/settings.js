// User settings, persisted to localStorage.

import * as storage from "./storage.js";

const KEY = "settings_v1";

export function defaultSettings() {
  return {
    requireCorrect:    false,
    autoPlayAudio:     true,
    excludeLong:       false,
    maxAnswerLength:   15,    // only used when excludeLong is true
    testLength:        10,
    hapticFeedback:    true,  // vibrate on wrong answer (mobile only)
    // Sampling strategy for the next-challenge picker. Three modes:
    //   "uniform"  — plain random over the current pool
    //   "weighted" — legacy miss-rate bias (pre-SRS)
    //   "srs"      — FSRS-lite spaced repetition (default)
    priorityMode:      "srs",
    // How often mastered words should still surface. Maps to a (floor, cap)
    // pair in srs.js: higher "often" → mastered words re-appear sooner.
    //   "often" | "balanced" | "rarely"
    srsCap:            "balanced",
    frequencyCap:      0,     // 0 = no cap, otherwise only include words whose
                              // best rank is <= this value. Matches the cutoff
                              // used by scripts/extract.py at build time.
    theme:             "system", // "system" | "light" | "dark"
    // Challenge presentation. "standard" shows lemma + grammatical prompt;
    // "cloze" shows an example sentence with the target form blanked out;
    // "rection" (verb mode only) asks which complement a verb governs,
    // answered by multiple choice. Cloze restricts the pool to challenges
    // with a usable example; rection uses its own pool (data/rection.json).
    drillStyle:        "standard",
    // Gamification is opt-in for new users. Existing users with a stored
    // settings blob keep streak visibility via the migration below, so this
    // default only applies to fresh installs.
    showStreak:        false,
    // Blitz mode (timed sprint round). Unlike the streak badge, this is a
    // button the user has to click to engage with, so defaulting it on is
    // low-friction — hidden only if you explicitly opt out.
    showBlitz:         true,
    // Last duration the user picked in the blitz start modal. Preserved so
    // repeat rounds don't require re-clicking the same chip every time.
    blitzDuration:     60,
  };
}

// Allowed values for the enum-like settings; must match the controls in
// index.html. Anything else (a damaged store, an imported file from another
// version) falls back to the default instead of leaving a switch with nothing
// selected — or, for maxAnswerLength, silently filtering the pool to empty.
const ENUMS = {
  priorityMode:  ["uniform", "weighted", "srs"],
  srsCap:        ["often", "balanced", "rarely"],
  theme:         ["system", "light", "dark"],
  drillStyle:    ["standard", "cloze", "rection", "possessive", "comparative"],
  frequencyCap:  [0, 1000, 2500, 5000, 10000],
  blitzDuration: [30, 60, 120],
};
const INT_RANGES = {
  maxAnswerLength: [5, 40],
  testLength:      [1, 500],
};

export function sanitizeSettings(s) {
  const d = defaultSettings();
  const out = { ...s };
  for (const [k, def] of Object.entries(d)) {
    if (typeof def === "boolean" && typeof out[k] !== "boolean") out[k] = def;
  }
  for (const [k, allowed] of Object.entries(ENUMS)) {
    if (!allowed.includes(out[k])) out[k] = d[k];
  }
  for (const [k, [lo, hi]] of Object.entries(INT_RANGES)) {
    const n = Number(out[k]);
    out[k] = Number.isInteger(n) ? Math.min(hi, Math.max(lo, n)) : d[k];
  }
  return out;
}

export function loadSettings() {
  const stored = storage.load(KEY, null);
  if (!stored || typeof stored !== "object") return defaultSettings();
  const merged = { ...defaultSettings(), ...stored };
  // Legacy migration: `weightedSampling` was a boolean checkbox in <=v0.11.
  // Translate it to the new three-way priority mode exactly once, then drop
  // the old key so it doesn't keep overriding the user's new choice.
  if (Object.prototype.hasOwnProperty.call(stored, "weightedSampling") &&
      !Object.prototype.hasOwnProperty.call(stored, "priorityMode")) {
    merged.priorityMode = stored.weightedSampling ? "srs" : "uniform";
  }
  delete merged.weightedSampling;
  // Streak-visibility migration: existing installs predate the toggle, so
  // they had the streak badge on by default. Flipping the default to false
  // for new users shouldn't silently hide it for people who were already
  // counting their streak — presume "on" unless the user later opts out.
  if (!Object.prototype.hasOwnProperty.call(stored, "showStreak")) {
    merged.showStreak = true;
  }
  return sanitizeSettings(merged);
}

export function saveSettings(s) { storage.save(KEY, s); }
