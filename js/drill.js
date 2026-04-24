// Drill state + logic. Framework-free.
//
// A "challenge" = one (word, inflection-key) pair to answer.
// The pool is rebuilt whenever filters change. Filter application lives here
// so all filter logic is in one place.

import { retrievability } from "./srs.js";

function randomChoice(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function normalize(s) {
  // Apostrophe-family normalization: mobile keyboards (and "smart quotes" on
  // desktops) happily substitute typographic quotes for the plain ASCII '
  // that the dataset stores. Without mapping these together, answers like
  // "vuo'den" silently fail when the user typed the visually-identical
  // "vuo\u2019den" (right single quote). Finnish orthography only uses a
  // plain apostrophe, so collapsing the whole family to ' is safe.
  return (s || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[\u2018\u2019\u201A\u201B\u02BC\u00B4\u0060]/g, "'");
}

// ---------- noun pool ----------

export function buildNounPool(data, filters) {
  const pool = [];
  for (const w of data.nouns.words) {
    // Group check uses strict "must be true" semantics rather than "isn't
    // explicitly false". The old "=== false" check let items slip through
    // whenever the group filter was unchecked-but-absent (e.g. a word with a
    // group ID not present in the filter map, or with no group at all),
    // which is why unchecking every box still produced challenges.
    if (filters && filters.groups && filters.groups[w.group] !== true) continue;
    for (const key of Object.keys(w.inflections || {})) {
      // "Must be true" semantics — same reasoning as the group check above.
      // Some inflection keys in the data (e.g. instructive_singular on words
      // like `jalka`) don't have a matching checkbox in the UI because the
      // case is marked plural_only in the config, so filters.cases[key] stays
      // undefined. The old "=== false" test let those slip through; this
      // ensures the pool mirrors the checkboxes exactly.
      if (filters && filters.cases && filters.cases[key] !== true) continue;
      pool.push({ word: w, key });
    }
  }
  return pool;
}

// ---------- verb pool ----------

/**
 * Parse a verb inflection key into its dimensions. Handles three shapes:
 *   "participle_<tense>_<voice>"             → kind=participle
 *   "inf<n>[_long]_<voice>"                  → kind=infinitive
 *   "<tense>_<voice>_<polarity>[_<person>]"  → kind=finite
 *
 * Finite tenses can be a single token (present, past, perfect, pluperfect,
 * conditional, imperative, potential) OR a two-token compound mood+aspect
 * (conditional_perfect, imperative_perfect, potential_perfect). We split
 * greedy-longest to disambiguate.
 */
const COMPOUND_TENSES = new Set([
  "conditional_perfect",
  "imperative_perfect",
  "potential_perfect",
]);

export function parseVerbKey(key) {
  const parts = key.split("_");
  if (parts[0] === "participle") {
    return {
      kind: "participle",
      tense: "participles",
      voice: parts[parts.length - 1],
      polarity: null,
      person: null,
    };
  }
  if (parts[0].startsWith("inf")) {
    const voice = parts[parts.length - 1];
    const tense = parts.slice(0, -1).join("_");
    return { kind: "infinitive", tense, voice, polarity: null, person: null };
  }
  const twoTok = parts[0] + "_" + parts[1];
  let tense, rest;
  if (COMPOUND_TENSES.has(twoTok)) {
    tense = twoTok;
    rest = parts.slice(2);
  } else {
    tense = parts[0];
    rest = parts.slice(1);
  }
  const [voice, polarity, person] = rest;
  return { kind: "finite", tense, voice, polarity, person: person || null };
}

export function buildVerbPool(data, filters) {
  const pool = [];
  for (const w of data.verbs.words) {
    // Same "must be true" semantics as buildNounPool — see the note there.
    if (filters && filters.groups && filters.groups[w.group] !== true) continue;
    for (const key of Object.keys(w.inflections || {})) {
      if (filters && !verbKeyAllowed(key, filters)) continue;
      pool.push({ word: w, key });
    }
  }
  return pool;
}

function verbKeyAllowed(key, filters) {
  const p = parseVerbKey(key);
  // "Must be true" semantics across all four dimensions — see the notes in
  // buildNounPool. The `p.voice && ...`-style guards are preserved because
  // some parsed keys legitimately have no value for a dimension (e.g.
  // participles have no polarity/person; infinitives have no person); in
  // those cases we skip the check entirely rather than fail it.
  if (filters.tenses    && filters.tenses[p.tense]    !== true) return false;
  if (filters.voices    && p.voice    && filters.voices[p.voice]       !== true) return false;
  if (filters.polarities && p.polarity && filters.polarities[p.polarity] !== true) return false;
  if (filters.persons   && p.person   && filters.persons[p.person]     !== true) return false;
  return true;
}

// ---------- shared ----------

/**
 * Pick the next challenge. `opts.priority` selects the strategy:
 *   "uniform"  — plain random
 *   "weighted" — bias toward items the user has been missing (legacy mode,
 *                pre-SRS — kept as an option for users who preferred it)
 *   "srs"      — FSRS-lite: weight by (1 - retrievability), floored so
 *                mastered items still surface occasionally
 * The `previous` avoid-repeat nudge fires for all modes.
 */
export function nextChallenge(pool, previous, opts) {
  if (pool.length === 0) return null;
  const priority = (opts && opts.priority) || "uniform";
  const pick = () => {
    if (priority === "srs" && opts.schedule && opts.mode) {
      return srsPick(pool, opts.mode, opts.schedule, opts.srsFloor, opts.now);
    }
    if (priority === "weighted" && opts.stats && opts.mode) {
      return weightedPick(pool, opts.mode, opts.stats);
    }
    return randomChoice(pool);
  };
  let chosen = pick();
  for (let tries = 0; tries < 5 && previous && chosen.word === previous.word && chosen.key === previous.key; tries++) {
    chosen = pick();
  }
  return chosen;
}

/**
 * Weight by miss rate. Unattempted items get a slight boost so they still
 * surface — the goal is to accelerate learning, not lock the user inside a
 * loop of their worst 10 forms. Per-word accuracy also contributes at a
 * smaller weight so a chronically-wrong lemma gets modest extra exposure
 * across all its forms.
 *
 *   w = 1
 *     + 2.0 * itemMissRate        (main signal; 0 if never attempted)
 *     + 0.5 * wordMissRate        (small cross-form nudge)
 *     + 0.6 if never attempted    (explore bonus)
 */
function weightedPick(pool, mode, stats) {
  const byItem = stats.byItem || {};

  // One pass over byItem to build a per-word miss-rate table. This avoids the
  // O(pool * byItem) blowup we'd get if we aggregated per lookup — pool can
  // easily be 100k+ entries in an unfiltered verb drill.
  const wordAgg = new Map(); // wordKey → { att, miss }
  const modePrefix = mode + "|";
  for (const key in byItem) {
    if (!key.startsWith(modePrefix)) continue;
    // key shape: "<mode>|<word>|<infl>"
    const second = key.indexOf("|", modePrefix.length);
    if (second < 0) continue;
    const wkey = key.slice(0, second);
    const b = byItem[key];
    const att  = b.correct + b.wrong + b.shown + b.skipped;
    const miss = b.wrong + b.shown + b.skipped;
    const prev = wordAgg.get(wkey);
    if (prev) { prev.att += att; prev.miss += miss; }
    else       wordAgg.set(wkey, { att, miss });
  }

  let total = 0;
  const weights = new Array(pool.length);
  for (let i = 0; i < pool.length; i++) {
    const item = pool[i];
    const wkey = `${mode}|${item.word.word}`;
    const id   = `${wkey}|${item.key}`;
    const b    = byItem[id];
    const attempted = b ? b.correct + b.wrong + b.shown + b.skipped : 0;
    const itemMiss  = attempted > 0 ? (b.wrong + b.shown + b.skipped) / attempted : 0;

    const wa = wordAgg.get(wkey);
    const wordMiss = wa && wa.att > 0 ? wa.miss / wa.att : 0;

    let w = 1 + 2.0 * itemMiss + 0.5 * wordMiss;
    if (attempted === 0) w += 0.6; // small explore bonus for unseen forms
    weights[i] = w;
    total += w;
  }

  let r = Math.random() * total;
  for (let i = 0; i < pool.length; i++) {
    r -= weights[i];
    if (r <= 0) return pool[i];
  }
  return pool[pool.length - 1];
}

/**
 * SRS picker. Each item's weight is max(floor, 1 - R) where R is the current
 * retrievability from the schedule entry. Unseen items have R=0, so they get
 * weight 1 — higher than the floor, guaranteeing they surface. The floor
 * keeps mastered items (R≈1) from vanishing entirely. One O(pool) pass, the
 * schedule lookup is O(1) per item (plain object map).
 */
function srsPick(pool, mode, schedule, floor, now) {
  const byItem = (schedule && schedule.byItem) || {};
  const f = typeof floor === "number" ? floor : 0.1;
  const t = typeof now === "number" ? now : Date.now();

  let total = 0;
  const weights = new Array(pool.length);
  for (let i = 0; i < pool.length; i++) {
    const item = pool[i];
    const id = `${mode}|${item.word.word}|${item.key}`;
    const entry = byItem[id];
    const R = retrievability(entry, t);
    const w = Math.max(f, 1 - R);
    weights[i] = w;
    total += w;
  }

  let r = Math.random() * total;
  for (let i = 0; i < pool.length; i++) {
    r -= weights[i];
    if (r <= 0) return pool[i];
  }
  return pool[pool.length - 1];
}

export function checkAnswer(challenge, input) {
  const expected = challenge.word.inflections[challenge.key];
  const ok = normalize(input) === normalize(expected);
  return { ok, expected, normalizedInput: normalize(input) };
}
