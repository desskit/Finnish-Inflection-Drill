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

// ---------- state ----------
const state = {
  mode: "noun",             // "noun" | "verb"
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
};

// ---------- DOM refs ----------
const el = {
  modeNoun:        document.getElementById("mode-noun"),
  modeVerb:        document.getElementById("mode-verb"),
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
  renderExamples(word);
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

function renderExamples(word) {
  el.examples.innerHTML = "";
  const exs = (word.examples || []).slice(0, 2);
  if (exs.length === 0) { el.examples.classList.add("hidden"); return; }

  const re = buildHighlightRegex(word);
  for (const text of exs) {
    const li = document.createElement("li");
    if (re) {
      // Split on matches and rebuild with <span class="ex-highlight"> wraps.
      let lastIdx = 0;
      let m;
      re.lastIndex = 0;
      while ((m = re.exec(text)) !== null) {
        if (m.index > lastIdx) li.appendChild(document.createTextNode(text.slice(lastIdx, m.index)));
        const span = document.createElement("span");
        span.className = "ex-highlight";
        span.textContent = m[0];
        li.appendChild(span);
        lastIdx = m.index + m[0].length;
      }
      if (lastIdx < text.length) li.appendChild(document.createTextNode(text.slice(lastIdx)));
    } else {
      li.textContent = text;
    }
    el.examples.appendChild(li);
  }
  el.examples.classList.remove("hidden");
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
  const expected = state.current.word.inflections[state.current.key];
  el.answer.value = expected;
  setFeedback(`answer shown: ${expected}`, "bad");
  score("shown");
  maybeAutoPlayAnswer();
  state.awaitingNext = true;
}

function skipChallenge() {
  if (!state.current) return;
  score("skipped");
  newChallenge();
}

// ---------- mode + filters ----------
function rebuildPool() {
  if (state.mode === "noun") {
    state.pool = buildNounPool(state.data, state.nounFilters);
  } else {
    state.pool = buildVerbPool(state.data, state.verbFilters);
  }
  updateStatus();
  newChallenge();
}

function setMode(mode) {
  state.mode = mode;
  el.modeNoun.setAttribute("aria-selected", mode === "noun" ? "true" : "false");
  el.modeVerb.setAttribute("aria-selected", mode === "verb" ? "true" : "false");

  el.filtersNoun.classList.toggle("hidden", mode !== "noun");
  el.filtersVerb.classList.toggle("hidden", mode !== "verb");

  rebuildPool();
}

// ---------- boot ----------
async function boot() {
  try {
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

    el.modeNoun.addEventListener("click", () => setMode("noun"));
    el.modeVerb.addEventListener("click", () => setMode("verb"));

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
