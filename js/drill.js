// Drill state + logic. Framework-free.
//
// A "challenge" = one (word, inflection-key) pair to answer.
// The pool is rebuilt whenever filters change. Filter application lives here
// so all filter logic is in one place.

import { retrievability } from "./srs.js";
import { detectNounGradation, detectVerbGradation } from "./gradation.js";

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

// Returns true if the word passes the gradation dimension filter.
// Only applies filtering when at least one pattern is unchecked; all-checked
// (the default) skips detection entirely for performance.
function passesGradeFilter(gf, detectFn, word) {
  if (!gf) return true;
  const allOn = Object.values(gf).every(Boolean);
  if (allOn) return true;
  const pat = detectFn(word);
  const id  = pat ? pat.id : "none";
  return gf[id] === true;
}

export function buildNounPool(data, filters) {
  const pool = [];
  for (const w of data.nouns.words) {
    // Group check uses strict "must be true" semantics rather than "isn't
    // explicitly false". The old "=== false" check let items slip through
    // whenever the group filter was unchecked-but-absent (e.g. a word with a
    // group ID not present in the filter map, or with no group at all),
    // which is why unchecking every box still produced challenges.
    if (filters && filters.groups && filters.groups[w.group] !== true) continue;
    if (!passesGradeFilter(filters?.gradation, detectNounGradation, w)) continue;
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
    if (!passesGradeFilter(filters?.gradation, detectVerbGradation, w)) continue;
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

// ---------- rection ----------
// A rection challenge asks which complement (case or infinitive form) a verb
// governs, answered by multiple choice. Items come from data/rection.json
// (parsed Wiktionary annotations — see scripts/extract_rection.py) and join
// back to the verb objects in verbs.json for the headword, audio, examples,
// and inflection table.

export function buildRectionPool(data) {
  const out = [];
  if (!data.rection || !Array.isArray(data.rection.words)) return out;
  const byWord = new Map();
  for (const w of data.verbs.words) byWord.set(w.word, w);
  for (const r of data.rection.words) {
    const word = byWord.get(r.word);
    if (!word) continue;
    // Union of acceptable complements across ALL of this verb's items. A
    // complement that's correct for one sense (pitää + elative "to like")
    // must never appear as a distractor on another (pitää + partitive
    // "to hold") — the user would be right for the wrong reasons, or worse,
    // marked wrong for a correct pattern.
    const exclude = [];
    for (const item of r.items) {
      for (const c of item.accept) {
        if (!exclude.includes(c)) exclude.push(c);
      }
    }
    for (const item of r.items) {
      out.push({ word, key: item.key, rection: item, rectionExclude: exclude });
    }
  }
  return out;
}

// ---------- possessive pool ----------
// Challenge shape: { word, key: "{person}_{case}_{number}", answer, baseWord }
// The `answer` field carries the expected form directly so checkAnswer doesn't
// need to navigate the nested inflection structure. `baseWord` is the matching
// entry from nouns.words (flat inflections + examples), used for the inflection
// table and example sentences.

const POSSESSIVE_PERSONS = ["1sg", "2sg", "3rd", "1pl", "2pl"];

export function buildPossessivePool(data, nounFilters) {
  const out = [];
  if (!data.possessives || !Array.isArray(data.possessives.words)) return out;
  const nounMap = new Map();
  for (const w of data.nouns.words) nounMap.set(w.word, w);
  for (const pw of data.possessives.words) {
    if (nounFilters?.groups && nounFilters.groups[pw.group] !== true) continue;
    const baseWord = nounMap.get(pw.word);
    for (const person of POSSESSIVE_PERSONS) {
      if (nounFilters?.persons && nounFilters.persons[person] !== true) continue;
      const pInfl = (pw.inflections || {})[person];
      if (!pInfl) continue;
      for (const [caseKey, form] of Object.entries(pInfl)) {
        if (!form || form === "-" || form === "—") continue;
        if (nounFilters?.cases && nounFilters.cases[caseKey] !== true) continue;
        out.push({ word: pw, key: `${person}_${caseKey}`, answer: form, baseWord });
      }
    }
  }
  return out;
}

export function checkAnswer(challenge, input) {
  // Possessive challenges carry the expected answer directly to avoid navigating
  // the nested possessive inflection structure in challenge.word.inflections.
  const expected = challenge.answer !== undefined
    ? challenge.answer
    : challenge.word.inflections[challenge.key];
  const ok = normalize(input) === normalize(expected);
  return { ok, expected, normalizedInput: normalize(input) };
}

// ---------- cloze ----------
// A cloze challenge shows one of the word's example sentences with the
// inflected form blanked out — the user reconstructs the form from sentence
// context instead of a grammatical prompt. Pool entries gain an
// `exampleIndex` pointing at the example that contains the target form.

// Per-word cache of normalized example sentences so buildClozePool stays
// O(pool): without it we'd re-normalize the same handful of sentences once
// per inflection key (133 keys per verb). WeakMap keys on the word object,
// so a data reload drops the cache automatically.
const normExampleCache = new WeakMap();

function normalizedExamples(word) {
  let cached = normExampleCache.get(word);
  if (cached) return cached;
  cached = (word.examples || []).map((ex) => {
    const fi = typeof ex === "string" ? ex : ex && ex.fi;
    return fi ? normalize(fi) : null;
  });
  normExampleCache.set(word, cached);
  return cached;
}

function isLetterChar(ch) {
  return !!ch && /\p{L}/u.test(ch);
}

// Whole-word containment on normalized strings. indexOf is the hot path
// (runs for every pool entry); the per-char boundary test only runs on
// candidate hits. Boundaries are "not a letter" rather than \b so Finnish
// diacritics don't split words — same semantics as the spoiler filter.
function containsWholeWord(haystack, needle) {
  let idx = 0;
  while ((idx = haystack.indexOf(needle, idx)) !== -1) {
    const before = idx > 0 ? haystack[idx - 1] : "";
    const after = haystack[idx + needle.length] || "";
    if (!isLetterChar(before) && !isLetterChar(after)) return idx;
    idx += 1;
  }
  return -1;
}

function findClozeExampleIndex(word, key) {
  const form = word.inflections[key];
  if (!form) return -1;
  const needle = normalize(form);
  const exs = normalizedExamples(word);
  for (let i = 0; i < exs.length; i++) {
    if (exs[i] && containsWholeWord(exs[i], needle) !== -1) return i;
  }
  return -1;
}

/**
 * Filter a standard pool down to cloze-able challenges: entries whose word
 * has an example sentence containing the target form as a whole word.
 * Multi-word forms (negative verbs like "en voinut") match across spaces.
 */
export function buildClozePool(pool) {
  const out = [];
  // Identical surface forms under different keys (voi = present 3sg, past
  // 3sg, imperative 2sg…) would otherwise produce the same on-screen
  // challenge several times over, so dedupe on what the user actually sees.
  const seen = new Set();
  for (const { word, key } of pool) {
    // Skip the nominative singular: its blank is just the headword already
    // shown in the hint line, so typing it teaches nothing.
    if (key === "nominative_singular") continue;
    const exampleIndex = findClozeExampleIndex(word, key);
    if (exampleIndex < 0) continue;
    const dedupeKey = `${word.word}|${exampleIndex}|${normalize(word.inflections[key])}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    out.push({ word, key, exampleIndex });
  }
  return out;
}

/**
 * Regex matching `form` as a whole word in original (non-normalized) text.
 * Used to locate the blank when rendering a cloze sentence: case-insensitive,
 * Unicode-aware boundaries, tolerant of typographic apostrophes and flexible
 * whitespace inside multi-word forms.
 */
export function clozeBlankRegex(form) {
  const esc = form
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    .replace(/'/g, "['‘’‚‛ʼ´`]")
    .replace(/ /g, "\\s+");
  return new RegExp(`(?<!\\p{L})${esc}(?!\\p{L})`, "giu");
}
