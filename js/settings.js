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
    // Gamification is opt-in for new users. Existing users with a stored
    // settings blob keep streak visibility via the migration below, so this
    // default only applies to fresh installs.
    showStreak:        false,
  };
}

export function loadSettings() {
  const stored = storage.load(KEY, null);
  if (!stored) return defaultSettings();
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
  return merged;
}

export function saveSettings(s) { storage.save(KEY, s); }
