// Renders the stats panel — an overall summary plus per-dimension breakdowns.
// Pure DOM, no framework.

import { summarize, summarizeByWord, accuracy } from "./stats.js";
import { nounLabel, verbLabel } from "./labels.js";

// UI-only state for the per-word tables. Persists across re-renders (toggle
// open/close, stats record, etc.) so the user's sort + search don't reset.
const wordUI = {
  noun: { sort: "most-wrong", query: "", expanded: false },
  verb: { sort: "most-wrong", query: "", expanded: false },
};

// Show this many rows by default before the user clicks "Show all".
const WORD_ROWS_COLLAPSED = 25;

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

// ----- per-word table -----
//
// One row per lemma the user has attempted, rollup of every form tried. The
// "Weakest form" column is the single most useful piece of info here — it
// tells you which form of *this* word to drill next. Sort defaults to
// "most wrong" so the words you need to work on float to the top.

function sortRows(rows, sortBy) {
  const sorted = rows.slice();
  const cmpWord = (a, b) => a.word.localeCompare(b.word);
  switch (sortBy) {
    case "most-attempts":
      sorted.sort((a, b) => (b.attempts - a.attempts) || cmpWord(a, b));
      break;
    case "lowest-accuracy":
      // Put words with attempts first; within them, lowest accuracy first.
      // Within ties, more-attempted first (more reliable signal).
      sorted.sort((a, b) => {
        if (a.attempts === 0 && b.attempts === 0) return cmpWord(a, b);
        if (a.attempts === 0) return 1;
        if (b.attempts === 0) return -1;
        if (a.accuracy !== b.accuracy) return a.accuracy - b.accuracy;
        return b.attempts - a.attempts;
      });
      break;
    case "highest-accuracy":
      sorted.sort((a, b) => {
        if (a.attempts === 0 && b.attempts === 0) return cmpWord(a, b);
        if (a.attempts === 0) return 1;
        if (b.attempts === 0) return -1;
        if (b.accuracy !== a.accuracy) return b.accuracy - a.accuracy;
        return b.attempts - a.attempts;
      });
      break;
    case "alphabetical":
      sorted.sort(cmpWord);
      break;
    case "most-wrong":
    default:
      sorted.sort((a, b) => (b.wrong - a.wrong) || (b.attempts - a.attempts) || cmpWord(a, b));
      break;
  }
  return sorted;
}

function renderWordTable(rows, labelFor) {
  const table = document.createElement("table");
  table.className = "stats-table stats-word-table";
  const thead = document.createElement("thead");
  thead.innerHTML = `
    <tr>
      <th>Word</th>
      <th class="num">Forms</th>
      <th class="num">Attempts</th>
      <th class="num">Wrong</th>
      <th class="num">Accuracy</th>
      <th>Weakest form</th>
    </tr>`;
  table.appendChild(thead);

  const tbody = document.createElement("tbody");
  for (const r of rows) {
    const tr = document.createElement("tr");
    const worstCell = r.worstKey
      ? `${escapeHtml(labelFor(r.worstKey))} <span class="muted">(${fmtPct(r.worstAccuracy)})</span>`
      : `<span class="muted">\u2014</span>`;
    tr.innerHTML = `
      <td class="word">${escapeHtml(r.word)}</td>
      <td class="num">${r.formsAttempted}</td>
      <td class="num">${r.attempts}</td>
      <td class="num">${r.wrong}</td>
      <td class="num">${fmtPct(r.accuracy)}</td>
      <td>${worstCell}</td>`;
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  return table;
}

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

// Build the per-word <section>. Returns the wrapping <section> element.
// The wrapper is stable across re-renders for this mode: controls live in a
// sticky `head` that we build once, and only the body (table + footer) is
// swapped out when sort/filter/expand change. That way the search input
// doesn't lose focus on every keystroke.
function wordSectionBlock(mode, cfg, stats) {
  const ui = wordUI[mode];
  const labelFor = (key) =>
    mode === "noun" ? nounLabel(key, cfg) : verbLabel(key, cfg);

  const sec = document.createElement("section");
  sec.className = "stats-section stats-words";

  const head = document.createElement("div");
  head.className = "stats-word-head";
  head.innerHTML = `
    <h3>Per word</h3>
    <div class="stats-word-controls">
      <label class="stats-ctl">
        Sort:
        <select class="inline-select" data-role="sort">
          <option value="most-wrong">Most wrong</option>
          <option value="most-attempts">Most attempts</option>
          <option value="lowest-accuracy">Lowest accuracy</option>
          <option value="highest-accuracy">Highest accuracy</option>
          <option value="alphabetical">Alphabetical</option>
        </select>
      </label>
      <input type="search" class="stats-word-search"
             placeholder="Filter by word\u2026" data-role="search" />
    </div>`;
  const sortSel = head.querySelector('select[data-role="sort"]');
  const searchIn = head.querySelector('input[data-role="search"]');
  sortSel.value = ui.sort;
  searchIn.value = ui.query;
  sec.appendChild(head);

  const body = document.createElement("div");
  body.className = "stats-word-body";
  sec.appendChild(body);

  function renderBody() {
    body.innerHTML = "";
    let rows = summarizeByWord(stats, mode);
    if (rows.length === 0) {
      const p = document.createElement("p");
      p.className = "stats-empty";
      p.textContent = "No attempts yet.";
      body.appendChild(p);
      return;
    }
    const totalWords = rows.length;
    const q = ui.query.trim().toLowerCase();
    if (q) rows = rows.filter((r) => r.word.toLowerCase().includes(q));
    rows = sortRows(rows, ui.sort);

    const shownRows = ui.expanded ? rows : rows.slice(0, WORD_ROWS_COLLAPSED);
    if (shownRows.length === 0) {
      const p = document.createElement("p");
      p.className = "stats-empty";
      p.textContent = `No words match "${ui.query}".`;
      body.appendChild(p);
      return;
    }
    body.appendChild(renderWordTable(shownRows, labelFor));

    const foot = document.createElement("p");
    foot.className = "stats-word-foot";
    const totalMatch = rows.length;
    if (rows.length > WORD_ROWS_COLLAPSED) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "mini-btn";
      btn.textContent = ui.expanded
        ? `Show fewer`
        : `Show all ${totalMatch.toLocaleString()}`;
      btn.addEventListener("click", () => {
        ui.expanded = !ui.expanded;
        renderBody();
      });
      foot.appendChild(btn);
    }
    const count = document.createElement("span");
    count.className = "muted";
    count.textContent = q
      ? ` ${totalMatch.toLocaleString()} of ${totalWords.toLocaleString()} words match`
      : ` ${totalWords.toLocaleString()} words`;
    foot.appendChild(count);
    body.appendChild(foot);
  }

  sortSel.addEventListener("change", () => {
    ui.sort = sortSel.value;
    renderBody();
  });
  // Re-render on input for snappy filtering. Only the body is swapped out,
  // so focus stays on the search box.
  searchIn.addEventListener("input", () => {
    ui.query = searchIn.value;
    renderBody();
  });

  renderBody();
  return sec;
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
  nounWrap.appendChild(wordSectionBlock("noun", cfg, stats));
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
  verbWrap.appendChild(wordSectionBlock("verb", cfg, stats));
  root.appendChild(verbWrap);
}

// Silence unused-import warning from accuracy — kept as a convenience export.
export { accuracy };
