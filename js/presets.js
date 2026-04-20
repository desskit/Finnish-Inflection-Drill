// Saveable filter presets, per mode.
//
// Presets capture the user's current filter configuration (cases/groups for
// nouns; tenses/voices/polarities/persons/groups for verbs) under a name so
// they can jump back to a known drilling setup in one click. Options-tab
// settings (theme, priorityMode, etc.) deliberately aren't included — those
// are app-wide preferences, not per-drill context.
//
// Storage shape:
//   {
//     noun: { "<name>": <filters state>, ... },
//     verb: { "<name>": <filters state>, ... },
//   }

import * as storage from "./storage.js";

const KEY = "presets_v1";

export function loadPresets() {
  const stored = storage.load(KEY, null);
  if (!stored) return { noun: {}, verb: {} };
  return { noun: stored.noun || {}, verb: stored.verb || {} };
}

export function savePresets(p) { storage.save(KEY, p); }

// Return the saved names for `mode`, sorted case-insensitively so the list is
// stable regardless of save order.
export function listNames(presets, mode) {
  return Object.keys(presets[mode] || {})
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
}

// Deep-clone on save + apply so the stored snapshot and live filter object
// don't alias — otherwise toggling a checkbox after saving would silently
// mutate the preset.
export function upsertPreset(presets, mode, name, filters) {
  if (!presets[mode]) presets[mode] = {};
  presets[mode][name] = deepClone(filters);
}

export function deletePreset(presets, mode, name) {
  if (presets[mode]) delete presets[mode][name];
}

export function getPreset(presets, mode, name) {
  const snap = presets[mode] && presets[mode][name];
  return snap ? deepClone(snap) : null;
}

function deepClone(o) { return JSON.parse(JSON.stringify(o)); }
