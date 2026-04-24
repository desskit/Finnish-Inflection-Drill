// Blitz mode: a fixed-duration sprint where the user answers as many
// challenges as they can. Deliberately isolated from the rest of the drill
// infrastructure:
//
//   - Doesn't feed the FSRS schedule. Answers here are rushed, not genuine
//     recall; counting them would inflate stability for words the user
//     doesn't actually know or deflate it for ones they typo'd under time
//     pressure.
//   - Doesn't bump totalReviews / firstReviewAt. "Avg reviews/day" should
//     reflect learning, not sprint sessions.
//   - Doesn't bump the daily streak. The streak is meant to reward studying
//     consistency, and a 30-second blitz shouldn't count the same as a
//     deliberate session. (Revisit if testers complain.)
//
// All Blitz round records live under their own storage key so resetting drill
// stats doesn't also nuke personal bests, and vice versa.

import * as storage from "./storage.js";

const KEY = "blitz_stats_v1";

// Allowed durations. The picker UI enforces these, but we also guard against
// tampering by clamping to a known value when we record a round.
export const BLITZ_DURATIONS = [30, 60, 120];

export function defaultBlitzStats() {
  return {
    // Best score ever achieved at each duration, keyed by seconds as string
    // (object keys are always strings anyway; using "60" instead of 60 keeps
    // JSON round-trips clean).
    bestScore: {},
    // Best combo ever achieved at each duration. Same shape.
    bestCombo: {},
    // Total rounds played at each duration — pure curiosity metric.
    rounds:    {},
    // Total rounds played across all durations (ever). Used for a tiny
    // "you've played X blitz rounds" line in the result modal.
    totalRounds: 0,
  };
}

export function loadBlitzStats() {
  const stored = storage.load(KEY, null);
  if (!stored) return defaultBlitzStats();
  // Merge against defaults so a future field addition doesn't crash old blobs.
  return { ...defaultBlitzStats(), ...stored };
}

export function saveBlitzStats(s) { storage.save(KEY, s); }

// Record a completed round. Returns a small summary the UI can use to decide
// whether to show a "new personal best!" flourish:
//
//   {
//     isPersonalBestScore: boolean,
//     previousBestScore:   number | null,
//     isPersonalBestCombo: boolean,
//     previousBestCombo:   number | null,
//   }
//
// `duration` must be one of BLITZ_DURATIONS; anything else is clamped to 60.
export function recordBlitzRound(stats, duration, score, bestCombo) {
  const d = BLITZ_DURATIONS.includes(duration) ? duration : 60;
  const k = String(d);
  const prevScore = typeof stats.bestScore[k] === "number" ? stats.bestScore[k] : null;
  const prevCombo = typeof stats.bestCombo[k] === "number" ? stats.bestCombo[k] : null;

  const isPersonalBestScore = prevScore === null || score > prevScore;
  const isPersonalBestCombo = prevCombo === null || bestCombo > prevCombo;

  if (isPersonalBestScore) stats.bestScore[k] = score;
  if (isPersonalBestCombo) stats.bestCombo[k] = bestCombo;
  stats.rounds[k] = (stats.rounds[k] || 0) + 1;
  stats.totalRounds = (stats.totalRounds || 0) + 1;

  return { isPersonalBestScore, previousBestScore: prevScore,
           isPersonalBestCombo, previousBestCombo: prevCombo };
}

// Convenience: look up the current best at a duration without recording.
// Returns null if no rounds have been played at that duration yet.
export function bestScoreAt(stats, duration) {
  const v = stats.bestScore[String(duration)];
  return typeof v === "number" ? v : null;
}
