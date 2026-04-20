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
    weightedSampling:  false, // bias sampling toward your weak forms
    frequencyCap:      0,     // 0 = no cap, otherwise only include words whose
                              // best rank is <= this value. Matches the cutoff
                              // used by scripts/extract.py at build time.
    theme:             "system", // "system" | "light" | "dark"
  };
}

export function loadSettings() {
  const stored = storage.load(KEY, null);
  if (!stored) return defaultSettings();
  return { ...defaultSettings(), ...stored };
}

export function saveSettings(s) { storage.save(KEY, s); }
