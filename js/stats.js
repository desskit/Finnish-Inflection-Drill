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
//   byItem:         { "<mode>|<word>|<key>": { ... } },  // for weighted sampling
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
    byItem:         {},
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
    byItem:         stored.byItem         || {},
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

export function itemId(mode, challenge) {
  return `${mode}|${challenge.word.word}|${challenge.key}`;
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
  bump(stats.byItem, itemId(mode, challenge), outcome);
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

/**
 * Aggregate `byItem` into per-word rows for the given mode. One row per lemma,
 * with totals rolled up across every form you've attempted for that word plus
 * a pointer to your weakest form (lowest accuracy among attempted forms,
 * ties broken by wrong count).
 *
 * Returns (unsorted — caller sorts):
 *   [{ word, attempts, correct, wrong, shown, skipped, accuracy,
 *      formsAttempted, worstKey, worstAccuracy }]
 */
export function summarizeByWord(stats, mode) {
  const prefix = `${mode}|`;
  // Map<word, { correct, wrong, shown, skipped, forms: Map<key, bucket> }>
  const byWord = new Map();

  for (const id of Object.keys(stats.byItem || {})) {
    if (!id.startsWith(prefix)) continue;
    // IDs look like "<mode>|<word>|<key>". The key itself can contain "_" but
    // never "|", so one split after the mode prefix is safe.
    const rest = id.slice(prefix.length);
    const sep = rest.indexOf("|");
    if (sep < 0) continue;
    const word = rest.slice(0, sep);
    const key = rest.slice(sep + 1);
    const b = stats.byItem[id];

    let row = byWord.get(word);
    if (!row) {
      row = { correct: 0, wrong: 0, shown: 0, skipped: 0, forms: new Map() };
      byWord.set(word, row);
    }
    row.correct += b.correct;
    row.wrong   += b.wrong;
    row.shown   += b.shown;
    row.skipped += b.skipped;
    row.forms.set(key, b);
  }

  const rows = [];
  for (const [word, row] of byWord) {
    const attempts = row.correct + row.wrong;
    const acc = attempts === 0 ? null : row.correct / attempts;

    let worstKey = null, worstAccuracy = null, worstWrong = -1;
    for (const [k, b] of row.forms) {
      const a = b.correct + b.wrong;
      if (a === 0) continue;
      const ac = b.correct / a;
      // Prefer lowest accuracy; on tie prefer the one with more wrong attempts.
      if (
        worstKey === null ||
        ac < worstAccuracy ||
        (ac === worstAccuracy && b.wrong > worstWrong)
      ) {
        worstKey = k;
        worstAccuracy = ac;
        worstWrong = b.wrong;
      }
    }

    rows.push({
      word,
      attempts,
      correct: row.correct,
      wrong:   row.wrong,
      shown:   row.shown,
      skipped: row.skipped,
      accuracy: acc,
      formsAttempted: row.forms.size,
      worstKey,
      worstAccuracy,
    });
  }
  return rows;
}
