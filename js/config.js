// Loads the editable config files that define groups, cases, and verb forms.
// Keeping this in one module means the rest of the app never hardcodes these lists.

async function loadJson(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`Failed to load ${path}: ${res.status}`);
  return res.json();
}

export async function loadConfig() {
  const [nounGroups, verbGroups, nounCases, verbForms] = await Promise.all([
    loadJson("config/noun_groups.json"),
    loadJson("config/verb_groups.json"),
    loadJson("config/noun_cases.json"),
    loadJson("config/verb_forms.json"),
  ]);
  return { nounGroups, verbGroups, nounCases, verbForms };
}
