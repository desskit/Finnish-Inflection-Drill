// Entry point. Phase 0: just prove config loads end-to-end.
// Real drill UI comes in Phase 2+.

import { loadConfig } from "./config.js";

const statusEl = document.getElementById("status");

async function boot() {
  try {
    const cfg = await loadConfig();
    statusEl.textContent = `Loaded ${cfg.nounGroups.groups.length} noun groups, ${cfg.verbGroups.groups.length} verb groups, ${cfg.nounCases.cases.length} cases, ${cfg.verbForms.tenses.length} tenses.`;
    statusEl.style.color = "var(--ok)";
  } catch (err) {
    statusEl.textContent = `Error: ${err.message}`;
    statusEl.style.color = "var(--danger)";
    console.error(err);
  }
}

boot();
