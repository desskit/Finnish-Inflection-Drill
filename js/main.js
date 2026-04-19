// App entry point. Loads config + data, renders the drill UI, wires filters,
// hints, settings, and stats.

import { loadConfig } from "./config.js";
import { loadData } from "./data.js";
import { buildNounPool, buildVerbPool, nextChallenge, checkAnswer } from "./drill.js";
import { nounLabel, verbLabel } from "./labels.js";
import {
  loadNounFilters, saveNounFilters, renderNounFilters,
  loadVerbFilters, saveVerbFilters, renderVerbFilters,
} from "./filters.js";
import { loadSettings, saveSettings } from "./settings.js";
import { loadStats, saveStats, resetStats, recordOutcome } from "./stats.js";
import { renderStats } from "./stats_ui.js";
import { speak, ttsAvailable, cancelSpeech } from "./tts.js";
import { APP_VERSION } from "./version.js";

// ---------- state ----------
const state = {
  mode: "noun",             // "noun" | "verb" — which pool we're drilling
  view: "drill",            // "drill" | "about" — which top-level view is shown
  cfg: null,
  data: null,
  pool: [],
  current: null,            // { word, key }
  awaitingNext: false,      // true after a right/wrong/shown-answer, Enter advances
  hintsShown: 0,            // number of letters revealed for current challenge
  scoredThisChallenge: false, // stats recorded at most once per challenge
  nounFilters: null,
  verbFilters: null,
  settings: null,
  stats: null,
  // Test mode: null when idle, otherwise { length, answered, results: [] }.
  // When `finished` is true, the results panel is on screen and new submits
  // don't affect the test.
  test: null,
};

// ---------- DOM refs ----------
const el = {
  modeNoun:        document.getElementById("mode-noun"),
  modeVerb:        document.getElementById("mode-verb"),
  modeAbout:       document.getElementById("mode-about"),
  about:           document.getElementById("about"),
  challenge:       document.getElementById("challenge"),
  answerRow:       document.getElementById("answer-row"),
  headword:        document.getElementById("headword"),
  translation:     document.getElementById("translation"),
  targetForm:      document.getElementById("target-form"),
  answer:          document.getElementById("answer"),
  feedback:        document.getElementById("feedback"),
  hintLetter:      document.getElementById("hint-letter"),
  hintAnswer:      document.getElementById("hint-answer"),
  skip:            document.getElementById("skip"),
  filtersNoun:     document.getElementById("filters-noun"),
  filtersVerb:     document.getElementById("filters-verb"),
  statusLine:      document.getElementById("status-line"),
  settingRequire:  document.getElementById("setting-require-correct"),
  statsPanel:      document.getElementById("stats-panel"),
  statsBody:       document.getElementById("stats-body"),
  statsReset:      document.getElementById("stats-reset"),
  settingAutoplay: document.getElementById("setting-autoplay"),
  speakHeadword:   document.getElementById("speak-headword"),
  speakAnswer:     document.getElementById("speak-answer"),
  examples:        document.getElementById("examples"),
  ttsWarning:      document.getElementById("tts-warning"),
  settingsPanel:   document.getElementById("settings-panel"),
  settingExcludeLong: document.getElementById("setting-exclude-long"),
  settingMaxLength:   document.getElementById("setting-max-length"),
  appVersion:      document.getElementById("app-version"),
  aboutVersion:    document.getElementById("about-version"),
  testPanel:       document.getElementById("test-panel"),
  testIdle:        document.getElementById("test-idle"),
  testRunning:     document.getElementById("test-running"),
  testResults:     document.getElementById("test-results"),
  testLength:      document.getElementById("test-length"),
  testCurrent:     document.getElementById("test-current"),
  testTotal:       document.getElementById("test-total"),
  testStart:       document.getElementById("test-start"),
  testCancel:      document.getElementById("test-cancel"),
};

// ---------- rendering ----------
function render() {
  if (!state.current) {
    el.challenge.classList.add("hidden");
    el.answerRow.classList.add("hidden");
    return;
  }
  const { word, key } = state.current;
  el.headword.textContent = word.word;
  el.translation.textContent = (word.translations || []).slice(0, 2).join(", ");
  const label = state.mode === "noun" ? nounLabel(key, state.cfg) : verbLabel(key, state.cfg);
  el.targetForm.textContent = label;
  renderExamples(word, word.inflections[key]);
  el.challenge.classList.remove("hidden");
  el.answerRow.classList.remove("hidden");
}

// Word stem sharing: Finnish inflections often share a stem with the lemma
// (talo → taloa, talossa …). So we highlight any token in the example whose
// first few chars match the lemma. Crude but catches most cases without
// needing a real Finnish analyzer.
function buildHighlightRegex(word) {
  const forms = new Set();
  forms.add(word.word);
  for (const v of Object.values(word.inflections || {})) forms.add(v);
  // Sort long → short so the regex engine prefers full matches.
  const esc = [...forms]
    .filter(Boolean)
    .sort((a, b) => b.length - a.length)
    .map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  if (esc.length === 0) return null;
  // Can't use \b — it's ASCII-only, so Finnish diacritics break boundaries.
  // Use Unicode letter class lookarounds instead.
  return new RegExp(`(?<!\\p{L})(${esc.join("|")})(?!\\p{L})`, "giu");
}

function renderExamples(word, targetForm) {
  el.examples.innerHTML = "";
  // Drop any example that contains the target inflected form as a whole word —
  // those would just spoil the answer. Unicode-aware boundaries so diacritics
  // don't break the match.
  const all = (word.examples || []).filter((ex) => {
    const fi = typeof ex === "string" ? ex : ex.fi;
    if (!fi || !targetForm) return !!fi;
    const esc = targetForm.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const spoiler = new RegExp(`(?<!\\p{L})${esc}(?!\\p{L})`, "iu");
    return !spoiler.test(fi);
  });
  const exs = all.slice(0, 2);
  if (exs.length === 0) { el.examples.classList.add("hidden"); return; }

  const re = buildHighlightRegex(word);
  for (const ex of exs) {
    // Handle legacy plain-string shape as a fallback so old cached data
    // doesn't crash the UI before the service worker picks up fresh data.
    const fi = typeof ex === "string" ? ex : ex.fi;
    const en = typeof ex === "string" ? ""  : (ex.en || "");
    if (!fi) continue;

    const li = document.createElement("li");
    const fiDiv = document.createElement("div");
    fiDiv.className = "ex-fi";
    appendHighlighted(fiDiv, fi, re);
    li.appendChild(fiDiv);
    if (en) {
      const enDiv = document.createElement("div");
      enDiv.className = "ex-en";
      enDiv.textContent = en;
      li.appendChild(enDiv);
    }
    el.examples.appendChild(li);
  }
  el.examples.classList.remove("hidden");
}

function appendHighlighted(parent, text, re) {
  if (!re) { parent.textContent = text; return; }
  let lastIdx = 0;
  let m;
  re.lastIndex = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > lastIdx) parent.appendChild(document.createTextNode(text.slice(lastIdx, m.index)));
    const span = document.createElement("span");
    span.className = "ex-highlight";
    span.textContent = m[0];
    parent.appendChild(span);
    lastIdx = m.index + m[0].length;
  }
  if (lastIdx < text.length) parent.appendChild(document.createTextNode(text.slice(lastIdx)));
}

function speakHeadword() {
  if (!state.current) return;
  speak(state.current.word.word);
}

function speakAnswer() {
  if (!state.current) return;
  const expected = state.current.word.inflections[state.current.key];
  speak(expected);
}

function maybeAutoPlayAnswer() {
  if (!state.settings.autoPlayAudio) return;
  // Suppress audio during an active test — hearing the answer is a spoiler.
  if (testActive()) return;
  if (!state.current) return;
  const expected = state.current.word.inflections[state.current.key];
  speak(expected);
}

function setFeedback(text, cls) {
  el.feedback.textContent = text;
  el.feedback.className = "feedback" + (cls ? " " + cls : "");
}

function setStatus(text) { el.statusLine.textContent = text; }

function updateStatus() {
  const count = state.pool.length;
  setStatus(
    `${state.mode} mode \u2022 ${count.toLocaleString()} possible challenges` +
    (count === 0 ? " \u2014 all filtered out, enable something above" : "")
  );
}

// ---------- stats plumbing ----------
function score(outcome) {
  // Only the first terminal outcome per challenge counts. Prevents double-
  // counting e.g. "wrong" then "shown" on the same card.
  if (state.scoredThisChallenge) return;
  if (!state.current) return;
  recordOutcome(state.stats, state.mode, state.current, outcome);
  saveStats(state.stats);
  state.scoredThisChallenge = true;
  refreshStatsPanel();
}

function refreshStatsPanel() {
  // Only re-render if the panel is actually open, to avoid work users can't see.
  if (el.statsPanel && el.statsPanel.open) {
    renderStats(el.statsBody, state.cfg, state.stats);
  }
}

// ---------- test mode ----------
// When active, per-question feedback + autoplay are suppressed and each
// answer is stored silently. After `length` answers, a summary is rendered
// in the test panel and the test is marked finished.

function startTest() {
  const length = clampInt(el.testLength.value, 1, 500, state.settings.testLength);
  state.settings.testLength = length;
  saveSettings(state.settings);

  state.test = { length, answered: 0, results: [], finished: false };
  el.testIdle.classList.add("hidden");
  el.testResults.classList.add("hidden");
  el.testResults.innerHTML = "";
  el.testRunning.classList.remove("hidden");
  el.testTotal.textContent = String(length);
  el.testCurrent.textContent = "1";
  newChallenge();
}

function recordTestAnswer(outcome, input) {
  if (!state.test || state.test.finished) return;
  const ch = state.current;
  const expected = ch.word.inflections[ch.key];
  state.test.results.push({
    word: ch.word.word,
    key: ch.key,
    input: input || "",
    expected,
    outcome, // "correct" | "wrong" | "shown" | "skipped"
  });
  state.test.answered++;
  el.testCurrent.textContent = String(Math.min(state.test.answered + 1, state.test.length));
  if (state.test.answered >= state.test.length) finishTest();
}

function finishTest() {
  state.test.finished = true;
  el.testRunning.classList.add("hidden");
  renderTestResults();
  el.testResults.classList.remove("hidden");
  // Leave the drill challenge on screen too so they can keep drilling if
  // they want; the idle controls stay hidden until "Dismiss" is clicked.
}

function cancelTest() {
  state.test = null;
  el.testRunning.classList.add("hidden");
  el.testResults.classList.add("hidden");
  el.testResults.innerHTML = "";
  el.testIdle.classList.remove("hidden");
}

function renderTestResults() {
  const r = state.test.results;
  const correct = r.filter((x) => x.outcome === "correct").length;
  const wrong   = r.filter((x) => x.outcome === "wrong").length;
  const shown   = r.filter((x) => x.outcome === "shown").length;
  const skipped = r.filter((x) => x.outcome === "skipped").length;
  const pct = r.length === 0 ? 0 : Math.round(100 * correct / r.length);

  el.testResults.innerHTML = "";

  const h = document.createElement("h3");
  h.textContent = "Test complete";
  el.testResults.appendChild(h);

  const summary = document.createElement("p");
  summary.className = "summary";
  summary.textContent =
    `${correct} / ${r.length} correct (${pct}%)` +
    ` \u2022 ${wrong} wrong \u2022 ${shown} shown \u2022 ${skipped} skipped`;
  el.testResults.appendChild(summary);

  const misses = r.filter((x) => x.outcome !== "correct");
  if (misses.length > 0) {
    const header = document.createElement("p");
    header.className = "panel-description";
    header.textContent = "Review:";
    el.testResults.appendChild(header);

    const ul = document.createElement("ul");
    ul.className = "wrong-list";
    for (const m of misses) {
      const li = document.createElement("li");
      const left = document.createElement("span");
      left.innerHTML = `<strong>${escapeHtml(m.word)}</strong> &mdash; ` +
        (m.input
          ? `<span class="yours">${escapeHtml(m.input)}</span> `
          : "") +
        `<span class="expected">${escapeHtml(m.expected)}</span>`;
      const right = document.createElement("span");
      right.className = "outcome";
      right.textContent = m.outcome;
      li.appendChild(left);
      li.appendChild(right);
      ul.appendChild(li);
    }
    el.testResults.appendChild(ul);
  }

  const again = document.createElement("button");
  again.type = "button";
  again.className = "mode-btn";
  again.textContent = "New test";
  again.addEventListener("click", () => { cancelTest(); });
  el.testResults.appendChild(again);
}

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function clampInt(v, lo, hi, fallback) {
  const n = parseInt(v, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(lo, Math.min(hi, n));
}

function testActive() {
  return state.test && !state.test.finished;
}

// ---------- drill flow ----------
function newChallenge() {
  cancelSpeech();
  state.current = nextChallenge(state.pool, state.current);
  state.awaitingNext = false;
  state.hintsShown = 0;
  state.scoredThisChallenge = false;
  el.answer.value = "";
  setFeedback("");
  if (!state.current) {
    el.challenge.classList.add("hidden");
    el.answerRow.classList.add("hidden");
    return;
  }
  render();
  el.answer.focus();
}

function submit() {
  if (!state.current) return;

  // In an active test we run a tighter loop: silent feedback, record,
  // immediate advance. Stats still update via score().
  if (testActive()) {
    const input = el.answer.value;
    if (!input.trim()) return;
    const result = checkAnswer(state.current, input);
    score(result.ok ? "correct" : "wrong");
    recordTestAnswer(result.ok ? "correct" : "wrong", input);
    if (!state.test.finished) newChallenge();
    return;
  }

  if (state.awaitingNext) { newChallenge(); return; }

  const input = el.answer.value;
  if (!input.trim()) return;

  const result = checkAnswer(state.current, input);
  if (result.ok) {
    setFeedback("\u2713 correct", "ok");
    score("correct");
    maybeAutoPlayAnswer();
    state.awaitingNext = true;
    // Give TTS a beat to start before auto-advancing.
    setTimeout(newChallenge, state.settings.autoPlayAudio ? 900 : 450);
  } else if (state.settings.requireCorrect) {
    // Count the first wrong attempt, then let them keep trying.
    score("wrong");
    setFeedback("\u2717 not quite \u2014 try again", "bad");
    el.answer.select();
  } else {
    score("wrong");
    setFeedback(`\u2717 expected: ${result.expected}`, "bad");
    maybeAutoPlayAnswer();
    state.awaitingNext = true;
  }
}

function revealNextLetter() {
  if (!state.current || state.awaitingNext) return;
  const expected = state.current.word.inflections[state.current.key];
  if (state.hintsShown >= expected.length) return;
  state.hintsShown++;
  el.answer.value = expected.slice(0, state.hintsShown);
  el.answer.focus();
  el.answer.setSelectionRange(el.answer.value.length, el.answer.value.length);
  setFeedback(`hint: ${state.hintsShown} letter${state.hintsShown === 1 ? "" : "s"} shown`);
}

function showFullAnswer() {
  if (!state.current) return;
  if (testActive()) {
    score("shown");
    recordTestAnswer("shown", el.answer.value);
    if (!state.test.finished) newChallenge();
    return;
  }
  const expected = state.current.word.inflections[state.current.key];
  el.answer.value = expected;
  setFeedback(`answer shown: ${expected}`, "bad");
  score("shown");
  maybeAutoPlayAnswer();
  state.awaitingNext = true;
}

function skipChallenge() {
  if (!state.current) return;
  if (testActive()) {
    score("skipped");
    recordTestAnswer("skipped", el.answer.value);
    if (!state.test.finished) newChallenge();
    return;
  }
  score("skipped");
  newChallenge();
}

// ---------- mode + filters ----------
function rebuildPool() {
  let pool = state.mode === "noun"
    ? buildNounPool(state.data, state.nounFilters)
    : buildVerbPool(state.data, state.verbFilters);

  // Optional length filter — drops any challenge whose expected answer is
  // longer than the configured threshold. Applied as a post-filter so the
  // main pool builders stay agnostic.
  if (state.settings && state.settings.excludeLong) {
    const max = state.settings.maxAnswerLength;
    pool = pool.filter(({ word, key }) => {
      const ans = word.inflections[key] || "";
      return ans.length <= max;
    });
  }

  state.pool = pool;
  updateStatus();
  newChallenge();
}

// Reflect current tab selection on the three buttons.
function updateTabAria() {
  const drill = state.view === "drill";
  el.modeNoun.setAttribute("aria-selected",  drill && state.mode === "noun" ? "true" : "false");
  el.modeVerb.setAttribute("aria-selected",  drill && state.mode === "verb" ? "true" : "false");
  el.modeAbout.setAttribute("aria-selected", state.view === "about"          ? "true" : "false");
}

// Show or hide the drill UI vs the about panel. Doesn't touch the drill
// state (pool, current challenge, stats) — clicking About and back should
// leave your place.
function setView(view) {
  state.view = view;
  const drill = view === "drill";
  // Drill-only chrome: only show if we're in drill view AND we have something
  // to drill (otherwise the "hidden" class from newChallenge wins).
  el.challenge.classList.toggle("hidden", !(drill && state.current));
  el.answerRow.classList.toggle("hidden", !(drill && state.current));
  el.filtersNoun.classList.toggle("hidden", !(drill && state.mode === "noun"));
  el.filtersVerb.classList.toggle("hidden", !(drill && state.mode === "verb"));
  // Settings / test / stats / status line are only for the drill workflow.
  // About is a standalone read-only view.
  el.settingsPanel.classList.toggle("hidden", !drill);
  el.testPanel.classList.toggle("hidden",     !drill);
  el.statsPanel.classList.toggle("hidden",    !drill);
  el.statusLine.classList.toggle("hidden",    !drill);
  el.about.classList.toggle("hidden", drill);
  updateTabAria();
  if (drill) el.answer.focus();
}

function setMode(mode) {
  const changed = state.mode !== mode;
  // Switching drill mode mid-test would invalidate the question set, so
  // confirm before blowing away the user's progress.
  if (changed && testActive()) {
    if (!confirm("Switching mode will cancel the current test. Continue?")) return;
    cancelTest();
  }
  state.mode = mode;
  setView("drill");
  // Rebuild the pool on a real mode switch, OR whenever there's no current
  // challenge on screen. The second case matters on first boot: state.mode
  // is initialized to "noun", so the final setMode("noun") in boot() looks
  // like a no-op and would skip rebuildPool(), leaving the noun page blank
  // until the user toggled to verbs and back. Preserving `!changed` with an
  // existing challenge still keeps the original UX of not re-randomizing the
  // prompt when you click the tab you're already on.
  if (changed || !state.current) rebuildPool();
  else updateStatus();
}

// ---------- boot ----------
async function boot() {
  try {
    // Version stamp — shows in header + About panel.
    el.appVersion.textContent   = `v${APP_VERSION}`;
    el.aboutVersion.textContent = APP_VERSION;

    setStatus("Loading config and data\u2026");
    const [cfg, data] = await Promise.all([loadConfig(), loadData()]);
    state.cfg = cfg;
    state.data = data;
    state.nounFilters = loadNounFilters(cfg);
    state.verbFilters = loadVerbFilters(cfg);
    state.settings    = loadSettings();
    state.stats       = loadStats();

    renderNounFilters(el.filtersNoun, cfg, state.nounFilters, (newState) => {
      saveNounFilters(newState);
      if (state.mode === "noun") rebuildPool();
    });
    renderVerbFilters(el.filtersVerb, cfg, state.verbFilters, (newState) => {
      saveVerbFilters(newState);
      if (state.mode === "verb") rebuildPool();
    });

    // Settings
    el.settingRequire.checked = state.settings.requireCorrect;
    el.settingRequire.addEventListener("change", () => {
      state.settings.requireCorrect = el.settingRequire.checked;
      saveSettings(state.settings);
    });
    el.settingAutoplay.checked = state.settings.autoPlayAudio;
    el.settingAutoplay.addEventListener("change", () => {
      state.settings.autoPlayAudio = el.settingAutoplay.checked;
      saveSettings(state.settings);
    });

    // Long-answer filter: both the toggle and the threshold re-filter the
    // pool. Threshold only takes effect when the toggle is on.
    el.settingExcludeLong.checked = state.settings.excludeLong;
    el.settingMaxLength.value     = String(state.settings.maxAnswerLength);
    el.settingExcludeLong.addEventListener("change", () => {
      state.settings.excludeLong = el.settingExcludeLong.checked;
      saveSettings(state.settings);
      rebuildPool();
    });
    el.settingMaxLength.addEventListener("change", () => {
      const n = clampInt(el.settingMaxLength.value, 5, 40, state.settings.maxAnswerLength);
      state.settings.maxAnswerLength = n;
      el.settingMaxLength.value = String(n);
      saveSettings(state.settings);
      if (state.settings.excludeLong) rebuildPool();
    });

    // Test mode
    el.testLength.value = String(state.settings.testLength);
    el.testStart.addEventListener("click", () => startTest());
    el.testCancel.addEventListener("click", () => {
      if (confirm("Cancel the current test? Answers so far will be discarded.")) {
        cancelTest();
      }
    });

    // TTS readiness — if no Finnish voice, disable speak buttons and warn.
    ttsAvailable().then((ok) => {
      if (!ok) {
        el.ttsWarning.classList.remove("hidden");
        el.speakHeadword.disabled = true;
        el.speakAnswer.disabled = true;
        el.settingAutoplay.disabled = true;
      }
    });
    el.speakHeadword.addEventListener("click", (e) => {
      e.preventDefault();
      speakHeadword();
      el.answer.focus();
    });
    el.speakAnswer.addEventListener("click", (e) => {
      e.preventDefault();
      speakAnswer();
      el.answer.focus();
    });

    // Stats panel — render on open, re-render on reset.
    el.statsPanel.addEventListener("toggle", () => {
      if (el.statsPanel.open) renderStats(el.statsBody, state.cfg, state.stats);
    });
    el.statsReset.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (confirm("Reset all drill statistics? This cannot be undone.")) {
        state.stats = resetStats();
        refreshStatsPanel();
      }
    });

    el.modeNoun.addEventListener("click",  () => setMode("noun"));
    el.modeVerb.addEventListener("click",  () => setMode("verb"));
    el.modeAbout.addEventListener("click", () => setView("about"));

    el.hintLetter.addEventListener("click", revealNextLetter);
    el.hintAnswer.addEventListener("click", showFullAnswer);
    el.skip.addEventListener("click", skipChallenge);

    el.answer.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); submit();            return; }
      if (e.key === ";")     { e.preventDefault(); revealNextLetter();  return; }
      if (e.key === "-")     { e.preventDefault(); skipChallenge();     return; }
      if (e.key === ".")     { e.preventDefault(); showFullAnswer();    return; }
      if (e.key === "'")     { e.preventDefault(); speakAnswer();       return; }
    });

    setMode("noun");
  } catch (err) {
    setStatus(`Error: ${err.message}`);
    console.error(err);
  }
}

boot();

// Register the service worker so the app is installable and works offline.
// We don't await this — it's a fire-and-forget side effect, and if it fails
// the app still works, just without caching.
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch((err) => {
      console.warn("Service worker registration failed:", err);
    });
  });
}
