// Daily streak tracking. One correct answer on a day counts the day; missing
// a day resets the streak to 0 next time the app opens. "Longest" is kept
// across resets so you can still see your record.
//
// Shape (stored under "streak_v1"):
//   { current: <int>, longest: <int>, lastActive: "YYYY-MM-DD" | null }
//
// Dates are computed in the user's local timezone — a streak is about their
// calendar day, not UTC.

import * as storage from "./storage.js";

const KEY = "streak_v1";

export function defaultStreak() {
  return { current: 0, longest: 0, lastActive: null };
}

export function loadStreak() {
  const s = storage.load(KEY, null);
  if (!s) return defaultStreak();
  return { ...defaultStreak(), ...s };
}

export function saveStreak(s) { storage.save(KEY, s); }

function localDateStr(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function addDays(dateStr, delta) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + delta);
  return localDateStr(dt);
}

/**
 * Record a successful drill today. Idempotent within the day — repeated
 * correct answers don't bump the streak past 1/day. Returns the updated
 * streak object (mutated + returned for convenience).
 */
export function recordCorrect(streak) {
  const today = localDateStr();
  if (streak.lastActive === today) return streak;

  const yesterday = addDays(today, -1);
  streak.current = streak.lastActive === yesterday ? (streak.current || 0) + 1 : 1;
  streak.lastActive = today;
  if (streak.current > (streak.longest || 0)) streak.longest = streak.current;
  return streak;
}

/**
 * Call on boot. If more than one calendar day has passed since lastActive,
 * the streak is broken — zero out `current` while preserving `longest`. Keeps
 * stale "you're on a 9-day streak!" from showing after a two-week absence.
 */
export function checkExpired(streak) {
  if (!streak.lastActive) return streak;
  const today = localDateStr();
  const yesterday = addDays(today, -1);
  if (streak.lastActive !== today && streak.lastActive !== yesterday) {
    streak.current = 0;
  }
  return streak;
}
