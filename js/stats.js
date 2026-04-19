// Drill statistics. Stored in localStorage, tallied per-dimension so the
// user can see which cases / verb types / persons they're weakest at.
//
// Shape:
// {
//   totals:         { correct, wrong, shown, skipped },
//   byNounCase:     { "<caseId_numberId>": { correct, wrong, shown, skipped } },
//   byNounGroup:    { "<groupId>":         { ... } },
//   byVerbTense:    { "<tenseId>":         { ... } },
//   byVerbVoice:    { "<voiceId>":         { ... } },
//   byVerbPolarity: { "<polarityId>":      { ... } },
//   byVerbPerson:   { "<personId>":        { ... } },
//   byVerbGroup:    { "<groupId>":         { ... } },
// }
//
// One attempt = one outcome recorded. Outcomes: correct | wrong | shown | skipped.
// "shown" and "skipped" do NOT count as wrong; they're tracked separately so
// the accuracy number stays meaningful.

import * as storage from "./storage.js";
import { parseVerbKey } from "./drill.js";

const KEY = "stats_v1";

const OUTCOMES = ["correct", "wrong", "shown", "skipped"];

function emptyBucket() {
  return { correct: 0, wrong: 0, shown: 0, skipped: 0 };
}

export function defaultStats() {
  return {
    totals:         emptyBucket(),
    byNounCase:     {},
    byNounGroup:    {},
    byVerbTense:    {},
    byVerbVoice:    {},
    byVerbPolarity: {},
    byVerbPerson:   {},
    byVerbGroup:    {},
  };
}

export function loadStats() {
  const stored = storage.load(KEY, null);
  if (!stored) return defaultStats();
  // Merge in case new dimensions get added in a future version.
  const base = defaultStats();
  return {
    totals: { ...base.totals, ...(stored.totals || {}) },
    byNounCase:     stored.byNounCase     || {},
    byNounGroup:    stored.byNounGroup    || {},
    byVerbTense:    stored.byVerbTense    || {},
    byVerbVoice:    stored.byVerbVoice    || {},
    byVerbPolarity: stored.byVerbPolarity || {},
    byVerbPerson:   stored.byVerbPerson   || {},
    byVerbGroup:    stored.byVerbGroup    || {},
  };
}

export function saveStats(stats) { storage.save(KEY, stats); }

export function resetStats() {
  const fresh = defaultStats();
  saveStats(fresh);
  return fresh;
}

function bump(bucketMap, id, outcome) {
  if (!id) return;
  if (!bucketMap[id]) bucketMap[id] = emptyBucket();
  bucketMap[id][outcome]++;
}

/**
 * Record one outcome against the right dimension buckets.
 *   mode:      "noun" | "verb"
 *   challenge: { word, key }
 *   outcome:   "correct" | "wrong" | "shown" | "skipped"
 */
export function recordOutcome(stats, mode, challenge, outcome) {
  if (!OUTCOMES.includes(outcome)) return stats;
  if (!challenge || !challenge.word || !challenge.key) return stats;

  stats.totals[outcome]++;

  if (mode === "noun") {
    bump(stats.byNounCase,  challenge.key,        outcome);
    bump(stats.byNounGroup, challenge.word.group, outcome);
  } else {
    const p = parseVerbKey(challenge.key);
    bump(stats.byVerbTense,    p.tense,             outcome);
    bump(stats.byVerbVoice,    p.voice,             outcome);
    bump(stats.byVerbPolarity, p.polarity,          outcome);
    bump(stats.byVerbPerson,   p.person,            outcome);
    bump(stats.byVerbGroup,    challenge.word.group, outcome);
  }
  return stats;
}

// ----- summary helpers used by the UI -----

export function accuracy(bucket) {
  const attempted = bucket.correct + bucket.wrong;
  if (attempted === 0) return null;
  return bucket.correct / attempted;
}

/**
 * Turn a dimension map into a sorted array of rows for the stats table.
 * Sort: most-attempted first, then alphabetical.
 */
export function summarize(bucketMap) {
  const rows = [];
  for (const id of Object.keys(bucketMap)) {
    const b = bucketMap[id];
    const attempted = b.correct + b.wrong;
    rows.push({ id, bucket: b, attempted, accuracy: accuracy(b) });
  }
  rows.sort((a, b) => {
    if (b.attempted !== a.attempted) return b.attempted - a.attempted;
    return a.id.localeCompare(b.id);
  });
  return rows;
}
