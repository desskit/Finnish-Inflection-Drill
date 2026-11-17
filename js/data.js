// Loads the generated word data (nouns.json, verbs.json, etc.).
// These files come from the Python pipeline in scripts/extract.py.
//
// A hand-curated blocklist (data/blocklist.json) is applied at load time so
// junk entries can be dropped without regenerating the full dataset. The
// blocklist lists lemmas to skip; we match exactly against `word`.

async function loadJson(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`Failed to load ${path}: ${res.status}`);
  return res.json();
}

async function loadBlocklist() {
  try {
    const b = await loadJson("data/blocklist.json");
    return {
      nouns: new Set(b.nouns || []),
      verbs: new Set(b.verbs || []),
    };
  } catch {
    return { nouns: new Set(), verbs: new Set() };
  }
}

// Optional data files — older cached shells may not have them; all callers
// gracefully fall back to empty structures when they're missing.
async function loadRection() {
  try { return await loadJson("data/rection.json"); }
  catch { return { complements: [], words: [] }; }
}

async function loadPossessives() {
  try { return await loadJson("data/possessives.json"); }
  catch { return { possessors: [], cases: [], numbers: [], words: [] }; }
}

async function loadNumerals() {
  try { return await loadJson("data/numerals.json"); }
  catch { return { cases: [], numbers: [], words: [] }; }
}

async function loadComparatives() {
  try { return await loadJson("data/comparatives.json"); }
  catch { return { degrees: [], cases: [], numbers: [], words: [] }; }
}

export async function loadData() {
  const [nouns, verbs, rection, possessives, numerals, comparatives, blocklist] = await Promise.all([
    loadJson("data/nouns.json"),
    loadJson("data/verbs.json"),
    loadRection(),
    loadPossessives(),
    loadNumerals(),
    loadComparatives(),
    loadBlocklist(),
  ]);
  if (blocklist.nouns.size) {
    nouns.words = nouns.words.filter((w) => !blocklist.nouns.has(w.word));
    possessives.words = possessives.words.filter((w) => !blocklist.nouns.has(w.word));
    comparatives.words = comparatives.words.filter((w) => !blocklist.nouns.has(w.word));
  }
  if (blocklist.verbs.size) {
    verbs.words = verbs.words.filter((w) => !blocklist.verbs.has(w.word));
    rection.words = rection.words.filter((w) => !blocklist.verbs.has(w.word));
  }
  // Numeral words share the noun inflection key format (case_number), so they
  // fold into the noun pool under their own group id "numeral". Adding them here
  // keeps pool-building logic unchanged — the noun group filter just controls
  // whether numerals surface alongside regular nouns.
  for (const w of numerals.words) {
    nouns.words.push({ ...w, group: "numeral" });
  }
  return { nouns, verbs, rection, possessives, comparatives };
}
