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
 *   "participle_<tense>_<voice>"           → kind=participle
 *   "inf<n>[_long]_<voice>"                → kind=infinitive
 *   "<tense>_<voice>_<polarity>[_<person>]"→ kind=finite
 *
 * For filtering, both participles and infinitives are treated as their own
 * "tense" in the config (the tense list includes `inf1_long` .. `inf5` and
 * `participles`).
 */
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
  const [tense, voice, polarity, person] = parts;
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

export function nextChallenge(pool, previous) {
  if (pool.length === 0) return null;
  let pick = randomChoice(pool);
  for (let tries = 0; tries < 5 && previous && pick.word === previous.word && pick.key === previous.key; tries++) {
    pick = randomChoice(pool);
  }
  return pick;
}

export function checkAnswer(challenge, input) {
  const expected = challenge.word.inflections[challenge.key];
  const ok = normalize(input) === normalize(expected);
  return { ok, expected, normalizedInput: normalize(input) };
}
