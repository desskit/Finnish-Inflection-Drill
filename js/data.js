// Loads the generated word data (nouns.json, verbs.json).
// These files come from the Python pipeline in scripts/extract.py.

async function loadJson(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`Failed to load ${path}: ${res.status}`);
  return res.json();
}

export async function loadData() {
  const [nouns, verbs] = await Promise.all([
    loadJson("data/nouns.json"),
    loadJson("data/verbs.json"),
  ]);
  return { nouns, verbs };
}
