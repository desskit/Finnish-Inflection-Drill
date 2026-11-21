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

function getTodayDate() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// Reviews recorded today. todayCount only resets on the next recorded
// outcome, so a count from yesterday must read as 0 until then.
export function reviewsToday(stats) {
  return stats.todayDate === getTodayDate() ? (stats.todayCount || 0) : 0;
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
    byRection:      {},
    byItem:         {},
    // Timeline for the "avg reviews/day" summary. We don't store per-day
    // buckets — just the first-ever review timestamp and a running counter —
    // so the computation is one subtraction, one division. Honest but coarse.
    firstReviewAt:  null,  // ms since epoch, set on first recordOutcome
    totalReviews:   0,     // every outcome (correct/wrong/shown/skipped) counts
    todayDate:      null,  // YYYY-MM-DD of last recorded outcome
    todayCount:     0,     // outcomes recorded on todayDate
  };
}

const isPlainObject = (x) => x !== null && typeof x === "object" && !Array.isArray(x);
const objOr = (x) => (isPlainObject(x) ? x : {});

export function loadStats() {
  return normalizeStats(storage.load(KEY, null));
}

/**
 * Coerce any stored or imported value into a complete stats object. Used on
 * load and on import: an imported file with `"stats": {}` (or a bucket of the
 * wrong type) would otherwise be stored as-is and crash the next
 * recordOutcome(), freezing the drill.
 */
export function normalizeStats(stored) {
  if (!isPlainObject(stored)) return defaultStats();
  // Merge in case new dimensions get added in a future version.
  const base = defaultStats();
  const totals = { ...base.totals };
  for (const k of Object.keys(totals)) {
    const v = objOr(stored.totals)[k];
    if (typeof v === "number" && Number.isFinite(v)) totals[k] = v;
  }
  return {
    totals,
    byNounCase:     objOr(stored.byNounCase),
    byNounGroup:    objOr(stored.byNounGroup),
    byVerbTense:    objOr(stored.byVerbTense),
    byVerbVoice:    objOr(stored.byVerbVoice),
    byVerbPolarity: objOr(stored.byVerbPolarity),
    byVerbPerson:   objOr(stored.byVerbPerson),
    byVerbGroup:    objOr(stored.byVerbGroup),
    byRection:      objOr(stored.byRection),
    byItem:         objOr(stored.byItem),
    // Migration: older stores don't have these fields. Leaving firstReviewAt
    // null means the first recordOutcome after update stamps "now" — we'd
    // rather under-report "avg/day since tracking started" than pretend we
    // know how long existing users have been drilling.
    firstReviewAt:  typeof stored.firstReviewAt === "number" ? stored.firstReviewAt : null,
    totalReviews:   typeof stored.totalReviews  === "number" ? stored.totalReviews  : 0,
    todayDate:      typeof stored.todayDate === "string" ? stored.todayDate : null,
    todayCount:     typeof stored.todayCount === "number" ? stored.todayCount : 0,
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
 *   mode:      "noun" | "verb" | "rection"
 *   challenge: { word, key }
 *   outcome:   "correct" | "wrong" | "shown" | "skipped"
 */
export function recordOutcome(stats, mode, challenge, outcome) {
  if (!OUTCOMES.includes(outcome)) return stats;
  if (!challenge || !challenge.word || !challenge.key) return stats;

  stats.totals[outcome]++;
  stats.totalReviews = (stats.totalReviews || 0) + 1;
  if (!stats.firstReviewAt) stats.firstReviewAt = Date.now();

  const today = getTodayDate();
  if (stats.todayDate !== today) { stats.todayDate = today; stats.todayCount = 0; }
  stats.todayCount++;

  if (mode === "noun") {
    bump(stats.byNounCase,  challenge.key,        outcome);
    bump(stats.byNounGroup, challenge.word.group, outcome);
  } else if (mode === "rection") {
    // Rection keys aren't verb inflection keys — parseVerbKey would
    // misclassify them, so they get their own dimension and skip the
    // tense/voice/polarity/person buckets entirely.
    if (!stats.byRection) stats.byRection = {};
    bump(stats.byRection, challenge.key, outcome);
  } else if (mode === "possessive" || mode === "comparative") {
    // Possessive keys are "{person}_{case}_{number}", comparative keys
    // "{degree}_{case}_{number}" — tracked per-item via byItem below; no
    // additional dimension breakdown yet. (Must not fall through to the verb
    // branch: parseVerbKey would misfile them.)
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

/**
 * Average reviews per day since the user's first recorded outcome.
 *
 *   { value: number | null, days: number }
 *
 * Returns null for `value` when we can't yet compute an honest average —
 * i.e. either there's no first-review timestamp yet (migrated user who hasn't
 * answered since update) or less than one full day has elapsed. The UI falls
 * back to a dash in that case. Days is reported floored; we don't want to
 * show "0.3 days" in a user-facing summary.
 */
export function averageReviewsPerDay(stats, now) {
  const t = typeof now === "number" ? now : Date.now();
  const first = stats.firstReviewAt;
  const total = stats.totalReviews || 0;
  if (!first || total === 0) return { value: null, days: 0 };
  const elapsedMs = Math.max(0, t - first);
  const days = elapsedMs / (1000 * 60 * 60 * 24);
  // Less than one full day → not enough signal. Show "—" until tomorrow.
  if (days < 1) return { value: null, days: Math.floor(days) };
  return { value: total / days, days: Math.floor(days) };
}

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
