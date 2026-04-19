// Filter UI + state for noun and verb drills.
//
// State shapes:
//   noun: {
//     cases:  { "<caseId>_<numberId>": true, ... }
//     groups: { "<groupId>": true, ... }
//   }
//   verb: {
//     tenses:     { "<tenseId>": true, ... }
//     voices:     { active: true, passive: true }
//     polarities: { positive: true, negative: true }
//     persons:    { "1sg": true, ..., "3pl": true }
//     groups:     { "type1": true, ..., "type6": true }
//   }

import * as storage from "./storage.js";

const NOUN_KEY = "filters_noun_v1";
const VERB_KEY = "filters_verb_v1";

// =========================================================================
// Defaults + load/save
// =========================================================================

export function defaultNounFilters(cfg) {
  const cases = {};
  for (const c of cfg.nounCases.cases) {
    for (const n of cfg.nounCases.numbers) {
      if (c.plural_only && n.id !== "plural") continue;
      cases[`${c.id}_${n.id}`] = true;
    }
  }
  const groups = {};
  for (const g of cfg.nounGroups.groups) groups[g.id] = true;
  return { cases, groups };
}

export function defaultVerbFilters(cfg) {
  return {
    tenses:     allOn(cfg.verbForms.tenses),
    voices:     allOn(cfg.verbForms.voices),
    polarities: allOn(cfg.verbForms.polarities),
    persons:    allOn(cfg.verbForms.persons),
    groups:     allOn(cfg.verbGroups.groups),
  };
}

function allOn(items) {
  const o = {};
  for (const it of items) o[it.id] = true;
  return o;
}

export function loadNounFilters(cfg) {
  return mergeFromStorage(NOUN_KEY, defaultNounFilters(cfg));
}
export function saveNounFilters(state) { storage.save(NOUN_KEY, state); }

export function loadVerbFilters(cfg) {
  return mergeFromStorage(VERB_KEY, defaultVerbFilters(cfg));
}
export function saveVerbFilters(state) { storage.save(VERB_KEY, state); }

function mergeFromStorage(key, defaults) {
  const stored = storage.load(key, null);
  if (!stored) return defaults;
  // Shallow-merge each dimension so new keys added to config turn on by default.
  const out = {};
  for (const dim of Object.keys(defaults)) {
    out[dim] = { ...defaults[dim], ...(stored[dim] || {}) };
  }
  return out;
}

// =========================================================================
// Noun filter rendering
// =========================================================================

export function renderNounFilters(root, cfg, state, onChange) {
  root.innerHTML = "";
  const refresh = () => renderNounFilters(root, cfg, state, onChange);
  const changed = () => { refresh(); onChange(state); };

  // Cases grid
  const caseSection = sectionWithHead("Cases",
    () => { toggleAll(state.cases, true);  changed(); },
    () => { toggleAll(state.cases, false); changed(); });
  caseSection.appendChild(renderCaseGrid(cfg, state, changed));
  root.appendChild(caseSection);

  // Ending groups
  const groupSection = sectionWithHead("Word type (by ending)",
    () => { toggleAll(state.groups, true);  changed(); },
    () => { toggleAll(state.groups, false); changed(); });
  const list = document.createElement("div");
  list.className = "group-list";
  for (const g of cfg.nounGroups.groups) {
    list.appendChild(checkboxRow(g, state.groups, changed));
  }
  groupSection.appendChild(list);
  root.appendChild(groupSection);
}

function renderCaseGrid(cfg, state, changed) {
  const table = document.createElement("table");
  table.className = "case-grid";

  const thead = document.createElement("thead");
  const headRow = document.createElement("tr");
  headRow.appendChild(document.createElement("th"));
  for (const n of cfg.nounCases.numbers) {
    const th = document.createElement("th");
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = isWholeColChecked(state, cfg, n.id);
    cb.addEventListener("change", () => {
      for (const c of cfg.nounCases.cases) {
        if (c.plural_only && n.id !== "plural") continue;
        state.cases[`${c.id}_${n.id}`] = cb.checked;
      }
      changed();
    });
    const lbl = document.createElement("label");
    lbl.appendChild(cb);
    lbl.appendChild(document.createTextNode(" " + n.label));
    th.appendChild(lbl);
    headRow.appendChild(th);
  }
  thead.appendChild(headRow);
  table.appendChild(thead);

  const tbody = document.createElement("tbody");
  for (const c of cfg.nounCases.cases) {
    const tr = document.createElement("tr");
    const nameCell = document.createElement("td");
    nameCell.className = "case-name";
    nameCell.textContent = c.ending_hint ? `${c.label} (${c.ending_hint})` : c.label;
    tr.appendChild(nameCell);
    for (const n of cfg.nounCases.numbers) {
      const td = document.createElement("td");
      td.className = "case-cell";
      if (c.plural_only && n.id !== "plural") {
        td.classList.add("disabled");
        tr.appendChild(td);
        continue;
      }
      const key = `${c.id}_${n.id}`;
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = !!state.cases[key];
      cb.addEventListener("change", () => {
        state.cases[key] = cb.checked;
        changed();
      });
      td.appendChild(cb);
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  return table;
}

function isWholeColChecked(state, cfg, numberId) {
  let any = false;
  for (const c of cfg.nounCases.cases) {
    if (c.plural_only && numberId !== "plural") continue;
    if (!state.cases[`${c.id}_${numberId}`]) return false;
    any = true;
  }
  return any;
}

// =========================================================================
// Verb filter rendering
// =========================================================================

export function renderVerbFilters(root, cfg, state, onChange) {
  root.innerHTML = "";
  const refresh = () => renderVerbFilters(root, cfg, state, onChange);
  const changed = () => { refresh(); onChange(state); };

  // Tenses / moods
  root.appendChild(simpleCheckboxSection(
    "Tenses & moods", cfg.verbForms.tenses, state.tenses, changed, "group-list"
  ));

  // Voices + polarities on one row-pair (they're small)
  root.appendChild(simpleCheckboxSection(
    "Voice", cfg.verbForms.voices, state.voices, changed, "inline-list"
  ));
  root.appendChild(simpleCheckboxSection(
    "Polarity", cfg.verbForms.polarities, state.polarities, changed, "inline-list"
  ));

  // Persons
  root.appendChild(simpleCheckboxSection(
    "Persons", cfg.verbForms.persons, state.persons, changed, "group-list"
  ));

  // Verb type groups (I-VI)
  root.appendChild(simpleCheckboxSection(
    "Verb type", cfg.verbGroups.groups, state.groups, changed, "group-list"
  ));
}

// =========================================================================
// Shared helpers
// =========================================================================

function simpleCheckboxSection(title, items, stateDim, changed, listClass) {
  const section = sectionWithHead(title,
    () => { for (const it of items) stateDim[it.id] = true;  changed(); },
    () => { for (const it of items) stateDim[it.id] = false; changed(); });
  const list = document.createElement("div");
  list.className = listClass;
  for (const it of items) list.appendChild(checkboxRow(it, stateDim, changed));
  section.appendChild(list);
  return section;
}

function checkboxRow(item, stateDim, changed) {
  const row = document.createElement("label");
  row.className = "group-row";
  const cb = document.createElement("input");
  cb.type = "checkbox";
  cb.checked = !!stateDim[item.id];
  cb.addEventListener("change", () => {
    stateDim[item.id] = cb.checked;
    changed();
  });
  row.appendChild(cb);
  const lbl = document.createElement("span");
  lbl.className = "group-label";
  lbl.textContent = item.label;
  row.appendChild(lbl);
  if (item.example) {
    const ex = document.createElement("span");
    ex.className = "group-example";
    ex.textContent = item.example;
    row.appendChild(ex);
  }
  return row;
}

function sectionWithHead(title, onSelectAll, onClear) {
  const section = document.createElement("section");
  section.className = "filter-section";
  const head = document.createElement("div");
  head.className = "filter-section-head";
  const h = document.createElement("h2");
  h.textContent = title;
  head.appendChild(h);
  const btnAll = document.createElement("button");
  btnAll.type = "button";
  btnAll.textContent = "Select all";
  btnAll.className = "mini-btn";
  btnAll.addEventListener("click", onSelectAll);
  head.appendChild(btnAll);
  const btnNone = document.createElement("button");
  btnNone.type = "button";
  btnNone.textContent = "Clear";
  btnNone.className = "mini-btn";
  btnNone.addEventListener("click", onClear);
  head.appendChild(btnNone);
  section.appendChild(head);
  return section;
}

function toggleAll(obj, value) {
  for (const k of Object.keys(obj)) obj[k] = value;
}
