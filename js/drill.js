// Drill state + logic. Framework-free.
//
// A "challenge" = one (word, inflection-key) pair to answer.
// The pool is rebuilt whenever filters change. Filter application lives here
// so all filter logic is in one place.

function randomChoice(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function normalize(s) {
  return (s || "").trim().toLowerCase().replace(/\s+/g, " ");
}

// ---------- noun pool ----------

export function buildNounPool(data, filters) {
  const pool = [];
  for (const w of data.nouns.words) {
    if (filters && filters.groups && filters.groups[w.group] === false) continue;
    for (const key of Object.keys(w.inflections || {})) {
      if (filters && filters.cases && filters.cases[key] === false) continue;
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
    if (filters && filters.groups && filters.groups[w.group] === false) continue;
    for (const key of Object.keys(w.inflections || {})) {
      if (filters && !verbKeyAllowed(key, filters)) continue;
      pool.push({ word: w, key });
    }
  }
  return pool;
}

function verbKeyAllowed(key, filters) {
  const p = parseVerbKey(key);
  if (filters.tenses    && filters.tenses[p.tense]    === false) return false;
  if (filters.voices    && p.voice    && filters.voices[p.voice]       === false) return false;
  if (filters.polarities && p.polarity && filters.polarities[p.polarity] === false) return false;
  if (filters.persons   && p.person   && filters.persons[p.person]     === false) return false;
  return true;
}

// ---------- shared ----------

/**
 * Pick the next challenge. Uniform random unless `opts.weighted` is provided,
 * in which case items are weighted by how much the user has been getting them
 * wrong (see itemWeight below). The `previous` avoid-repeat nudge still fires
 * either way.
 */
export function nextChallenge(pool, previous, opts) {
  if (pool.length === 0) return null;
  const pick = () => {
    if (opts && opts.weighted && opts.stats && opts.mode) {
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

export function checkAnswer(challenge, input) {
  const expected = challenge.word.inflections[challenge.key];
  const ok = normalize(input) === normalize(expected);
  return { ok, expected, normalizedInput: normalize(input) };
}
