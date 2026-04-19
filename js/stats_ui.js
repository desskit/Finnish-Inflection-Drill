// Renders the stats panel — an overall summary plus per-dimension breakdowns.
// Pure DOM, no framework.

import { summarize, accuracy } from "./stats.js";
import { nounLabel, verbLabel } from "./labels.js";

function byId(list, id) { return list.find((x) => x.id === id); }

function fmtPct(a) {
  if (a == null) return "\u2014";
  return `${Math.round(a * 100)}%`;
}

function overallLine(totals) {
  const attempted = totals.correct + totals.wrong;
  const acc = attempted === 0 ? null : totals.correct / attempted;
  return (
    `${totals.correct.toLocaleString()} correct / ${attempted.toLocaleString()} attempted` +
    ` (${fmtPct(acc)}) \u2022 ${totals.shown.toLocaleString()} shown \u2022` +
    ` ${totals.skipped.toLocaleString()} skipped`
  );
}

function renderTable(rows, labelFor) {
  const table = document.createElement("table");
  table.className = "stats-table";

  const thead = document.createElement("thead");
  thead.innerHTML = `
    <tr>
      <th>Form</th>
      <th class="num">Correct</th>
      <th class="num">Wrong</th>
      <th class="num">Shown</th>
      <th class="num">Skipped</th>
      <th class="num">Accuracy</th>
    </tr>`;
  table.appendChild(thead);

  const tbody = document.createElement("tbody");
  for (const r of rows) {
    const tr = document.createElement("tr");
    const b = r.bucket;
    tr.innerHTML = `
      <td>${labelFor(r.id)}</td>
      <td class="num">${b.correct}</td>
      <td class="num">${b.wrong}</td>
      <td class="num">${b.shown}</td>
      <td class="num">${b.skipped}</td>
      <td class="num">${fmtPct(r.accuracy)}</td>`;
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  return table;
}

function sectionBlock(title, rows, labelFor) {
  const sec = document.createElement("section");
  sec.className = "stats-section";
  const h = document.createElement("h3");
  h.textContent = title;
  sec.appendChild(h);
  if (rows.length === 0) {
    const p = document.createElement("p");
    p.className = "stats-empty";
    p.textContent = "No attempts yet.";
    sec.appendChild(p);
  } else {
    sec.appendChild(renderTable(rows, labelFor));
  }
  return sec;
}

export function renderStats(root, cfg, stats) {
  root.innerHTML = "";

  const overall = document.createElement("p");
  overall.className = "stats-overall";
  overall.textContent = overallLine(stats.totals);
  root.appendChild(overall);

  // ----- noun breakdowns -----
  const nounWrap = document.createElement("div");
  nounWrap.className = "stats-group";
  const nounHead = document.createElement("h2");
  nounHead.textContent = "Nouns";
  nounWrap.appendChild(nounHead);

  nounWrap.appendChild(sectionBlock(
    "By case", summarize(stats.byNounCase),
    (id) => nounLabel(id, cfg)
  ));
  nounWrap.appendChild(sectionBlock(
    "By word type", summarize(stats.byNounGroup),
    (id) => {
      const g = byId(cfg.nounGroups.groups, id);
      return g ? g.label : id;
    }
  ));
  root.appendChild(nounWrap);

  // ----- verb breakdowns -----
  const verbWrap = document.createElement("div");
  verbWrap.className = "stats-group";
  const verbHead = document.createElement("h2");
  verbHead.textContent = "Verbs";
  verbWrap.appendChild(verbHead);

  verbWrap.appendChild(sectionBlock(
    "By tense / mood", summarize(stats.byVerbTense),
    (id) => {
      const t = byId(cfg.verbForms.tenses, id);
      return t ? t.label : id;
    }
  ));
  verbWrap.appendChild(sectionBlock(
    "By voice", summarize(stats.byVerbVoice),
    (id) => {
      const v = byId(cfg.verbForms.voices, id);
      return v ? v.label : id;
    }
  ));
  verbWrap.appendChild(sectionBlock(
    "By polarity", summarize(stats.byVerbPolarity),
    (id) => {
      const p = byId(cfg.verbForms.polarities, id);
      return p ? p.label : id;
    }
  ));
  verbWrap.appendChild(sectionBlock(
    "By person", summarize(stats.byVerbPerson),
    (id) => {
      const p = byId(cfg.verbForms.persons, id);
      return p ? p.label : id;
    }
  ));
  verbWrap.appendChild(sectionBlock(
    "By verb type", summarize(stats.byVerbGroup),
    (id) => {
      const g = byId(cfg.verbGroups.groups, id);
      return g ? g.label : id;
    }
  ));
  root.appendChild(verbWrap);
}

// Silence unused-import warning from accuracy — kept as a convenience export.
export { accuracy };
