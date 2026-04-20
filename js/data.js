// Loads the generated word data (nouns.json, verbs.json).
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

export async function loadData() {
  const [nouns, verbs, blocklist] = await Promise.all([
    loadJson("data/nouns.json"),
    loadJson("data/verbs.json"),
    loadBlocklist(),
  ]);
  if (blocklist.nouns.size) {
    nouns.words = nouns.words.filter((w) => !blocklist.nouns.has(w.word));
  }
  if (blocklist.verbs.size) {
    verbs.words = verbs.words.filter((w) => !blocklist.verbs.has(w.word));
  }
  return { nouns, verbs };
}
