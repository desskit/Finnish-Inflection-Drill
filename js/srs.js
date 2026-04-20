// Spaced-repetition scheduler, FSRS-lite.
//
// We don't do full FSRS (19 tuned weights, per-user fitting). For a drill app
// a much simpler model is enough:
//   - per item: stability (days), lastReviewed (ms), reps, lapses
//   - retrievability R(t) = exp(-t / stability)  — memory-decay curve
//   - picker weight w = max(floor, 1 - R)         — low recall → picked more
//   - stability grows on successful reviews, collapses (but doesn't reset)
//     on lapses, and is hard-capped so "mastered" words never disappear for
//     longer than the user-configured ceiling
//
// This translates to drill-session behavior like this:
//   - Items you just got right have R≈1, weight≈floor — mostly absent from
//     the current session.
//   - Items you haven't seen in a while have R→0, weight→1 — heavy priority.
//   - Brand-new items have weight 1 — they always surface.
//
// Grade mapping (from main.js outcomes):
//   correct, no hints used      → GOOD
//   correct, hints were used    → HARD
//   wrong                       → AGAIN
//   shown (gave up / requested) → AGAIN with extra penalty
//   skipped                     → no grade (neutral, schedule untouched)

import * as storage from "./storage.js";

const KEY = "schedule_v1";

// Integer grade codes. Kept as numbers for compact storage and easy indexing.
export const GRADE = { AGAIN: 0, HARD: 1, GOOD: 2, EASY: 3 };

// Initial stability (in days) when an item is seen for the very first time.
// Tuned small: one correct pass is encouraging but not "safe for a week."
const INITIAL_STABILITY = {
  [GRADE.AGAIN]: 0.2,
  [GRADE.HARD]:  0.8,
  [GRADE.GOOD]:  2.0,
  [GRADE.EASY]:  5.0,
};

// Multiplier applied on subsequent successful reviews. A Good review roughly
// doubles the interval; Hard barely moves it; Easy jumps ahead aggressively.
const SUCCESS_MULT = {
  [GRADE.HARD]: 1.2,
  [GRADE.GOOD]: 2.2,
  [GRADE.EASY]: 3.5,
};

// Lapse: stability shrinks by this factor but doesn't zero out. A word that
// was once stable re-stabilizes faster than one that was never known —
// reflects the "savings effect" in real memory.
const LAPSE_MULT = 0.3;

// Shown (gave up): worse than wrong — treat as a lapse with extra penalty.
const SHOWN_MULT = 0.2;

// Stability floor so we never divide by tiny numbers when computing R.
const MIN_STABILITY = 0.1;

const MS_PER_DAY = 1000 * 60 * 60 * 24;

/**
 * Presets for the "Review frequency for mastered words" option.
 *   floor   — minimum picker weight, so mastered items still surface
 *   capDays — hard ceiling on stability, so "forever remembered" caps out
 *
 * The floor controls how often mastered words appear relative to struggling
 * ones; the cap guarantees mastered words eventually decay even if you keep
 * getting them right.
 */
export const CAP_PRESETS = {
  often:    { floor: 0.25, capDays: 14  },
  balanced: { floor: 0.10, capDays: 60  },
  rarely:   { floor: 0.03, capDays: 180 },
};

export function defaultSchedule() {
  return { byItem: {} };
}

export function loadSchedule() {
  const stored = storage.load(KEY, null);
  if (!stored) return defaultSchedule();
  return { byItem: stored.byItem || {} };
}

export function saveSchedule(sched) { storage.save(KEY, sched); }

export function resetSchedule() {
  const s = defaultSchedule();
  saveSchedule(s);
  return s;
}

/**
 * Probability of recall right now. 0 if never reviewed (we want those
 * surfaced aggressively), otherwise exp(-elapsed_days / stability).
 */
export function retrievability(entry, now) {
  if (!entry || !entry.lastReviewed || !entry.stability) return 0;
  const elapsedDays = Math.max(0, (now - entry.lastReviewed) / MS_PER_DAY);
  const s = Math.max(entry.stability, MIN_STABILITY);
  return Math.exp(-elapsedDays / s);
}

/**
 * Update the schedule entry for `itemId` after a review of the given grade.
 * `capDays` is the user-configured stability ceiling. Returns the same
 * schedule object, mutated for convenience.
 */
export function gradeItem(schedule, itemId, grade, capDays, now) {
  if (!schedule.byItem) schedule.byItem = {};
  let e = schedule.byItem[itemId];
  if (!e) e = { reps: 0, lapses: 0, stability: 0, lastReviewed: 0 };

  e.reps = (e.reps || 0) + 1;

  if (grade === GRADE.AGAIN) {
    e.lapses = (e.lapses || 0) + 1;
    e.stability = e.stability > 0
      ? Math.max(MIN_STABILITY, e.stability * LAPSE_MULT)
      : INITIAL_STABILITY[GRADE.AGAIN];
  } else if (!e.stability) {
    // First non-lapse review of a new item: seed stability from the grade.
    e.stability = INITIAL_STABILITY[grade] ?? INITIAL_STABILITY[GRADE.GOOD];
  } else {
    e.stability *= SUCCESS_MULT[grade] ?? 1;
  }

  if (capDays && capDays > 0) {
    e.stability = Math.min(e.stability, capDays);
  }

  e.lastReviewed = now;
  schedule.byItem[itemId] = e;
  return schedule;
}

/**
 * Treat a "shown" outcome as a lapse-plus. We want the item to re-surface
 * quickly since the user couldn't produce it on their own, but we also don't
 * want to punish a single shown worse than repeated wrongs.
 */
export function gradeShown(schedule, itemId, capDays, now) {
  if (!schedule.byItem) schedule.byItem = {};
  let e = schedule.byItem[itemId];
  if (!e) e = { reps: 0, lapses: 0, stability: 0, lastReviewed: 0 };
  e.reps   = (e.reps   || 0) + 1;
  e.lapses = (e.lapses || 0) + 1;
  e.stability = e.stability > 0
    ? Math.max(MIN_STABILITY, e.stability * SHOWN_MULT)
    : INITIAL_STABILITY[GRADE.AGAIN] * 0.5;
  if (capDays && capDays > 0) {
    e.stability = Math.min(e.stability, capDays);
  }
  e.lastReviewed = now;
  schedule.byItem[itemId] = e;
  return schedule;
}

/**
 * Picker weight for a single item. `floor` keeps mastered items from falling
 * out of circulation entirely; `1 - R` biases toward items most in need of
 * review right now. Brand-new items (no entry) get weight 1.
 */
export function itemWeight(entry, floor, now) {
  const R = retrievability(entry, now);
  return Math.max(floor, 1 - R);
}
