// User settings, persisted to localStorage.
//
// Currently only one flag:
//   requireCorrect — if true, wrong answers keep the same challenge up until
//                    you type it correctly (or press "show answer" / skip).
//                    If false (default), a wrong answer reveals the expected
//                    form and Enter advances.

import * as storage from "./storage.js";

const KEY = "settings_v1";

export function defaultSettings() {
  return {
    requireCorrect:  false,
    autoPlayAudio:   true,
    excludeLong:     false,
    maxAnswerLength: 15,  // only used when excludeLong is true
    testLength:      10,
  };
}

export function loadSettings() {
  const stored = storage.load(KEY, null);
  if (!stored) return defaultSettings();
  return { ...defaultSettings(), ...stored };
}

export function saveSettings(s) { storage.save(KEY, s); }
