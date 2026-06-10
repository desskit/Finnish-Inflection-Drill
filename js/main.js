// App entry point. Loads config + data, renders the drill UI, wires filters,
// hints, settings, and stats.

import { loadConfig } from "./config.js";
import { loadData } from "./data.js";
import {
  buildNounPool, buildVerbPool, nextChallenge, checkAnswer,
  buildClozePool, clozeBlankRegex, buildRectionPool, buildPossessivePool, parseVerbKey,
} from "./drill.js";
import { nounLabel, verbLabel, complementLabel, complementName, complementHint } from "./labels.js";
import {
  loadNounFilters, saveNounFilters, renderNounFilters,
  loadVerbFilters, saveVerbFilters, renderVerbFilters,
} from "./filters.js";
import {
  loadPresets, savePresets, listNames,
  upsertPreset, deletePreset, getPreset,
} from "./presets.js";
import { loadSettings, saveSettings } from "./settings.js";
import { loadStats, saveStats, resetStats, recordOutcome } from "./stats.js";
import { renderStats } from "./stats_ui.js";
import {
  loadSchedule, saveSchedule, resetSchedule,
  gradeItem, gradeShown, GRADE, CAP_PRESETS,
} from "./srs.js";
import { speak, ttsAvailable, cancelSpeech } from "./tts.js";
import { applyTheme, watchSystemTheme } from "./theme.js";
import { loadStreak, saveStreak, recordCorrect as bumpStreak, checkExpired as checkStreakExpired } from "./streak.js";
import {
  loadBlitzStats, saveBlitzStats, recordBlitzRound, bestScoreAt, BLITZ_DURATIONS,
} from "./blitz.js";
import { APP_VERSION } from "./version.js";
import {
  GRADE_PATTERNS, GRADE_NONE,
  detectNounGradation, detectVerbGradation, isWeakGrade,
} from "./gradation.js";

// Export-file schema version. Bumped only when the shape of the export
// payload changes in a way that older code can't read directly — e.g. a key
// rename inside stats.byItem, or restructuring schedule entries. The app
// version (APP_VERSION) bumps on every release regardless.
//
// Stamped at 1 for the 1.0 release as the trust contract: any export from
// here on will remain importable, with in-code migrations bridging future
// schema bumps.
const EXPORT_SCHEMA = 1;

// ---------- state ----------
const state = {
  mode: "noun",             // "noun" | "verb" — which pool we're drilling
  view: "drill",            // "drill" | "options" | "about" — top-level view
  cfg: null,
  data: null,
  pool: [],
  current: null,            // { word, key }
  awaitingNext: false,      // true after a right/wrong/shown-answer, Enter advances
  hintsShown: 0,            // number of letters revealed for current challenge
  // Per-challenge multiple-choice state for the Rection drill style:
  // { options: [complementId…], picked: complementId | null }. Lives outside
  // state.current because pool entries are shared objects — stashing answered
  // state on them would leak into the next time the same item is drawn.
  rectionRound: null,
  scoredThisChallenge: false, // stats recorded at most once per challenge
  nounFilters: null,
  verbFilters: null,
  settings: null,
  stats: null,
  schedule: null,           // FSRS-lite schedule, { byItem: { id → entry } }
  presets: null,            // { noun: { name → filters }, verb: { ... } }
  streak: null,
  // Test mode: null when idle, otherwise { length, answered, results: [] }.
  // When `finished` is true, the results panel is on screen and new submits
  // don't affect the test.
  test: null,
  // Blitz mode: null when idle, otherwise the active round. Mutually
  // exclusive with test mode — we reject starting blitz while a test is
  // running (and vice versa) so the two loops never overlap.
  // Shape:
  //   {
  //     active: bool, duration: 30|60|120, endAt: ms epoch,
  //     score: int, wrong: int, combo: int, bestCombo: int,
  //     timerId: setInterval handle,
  //     wrongFlashUntil: ms epoch | 0  (blocks submits while a wrong-answer
  //                                     flash is on screen, so a fast typer
  //                                     can't double-submit through it),
  //   }
  blitz: null,
  // Persistent blitz stats (best score/combo per duration, total rounds).
  // Separate storage key from drill stats so resetting one doesn't nuke the
  // other.
  blitzStats: null,
};

// ---------- DOM refs ----------
const el = {
  modeNoun:        document.getElementById("mode-noun"),
  modeVerb:        document.getElementById("mode-verb"),
  modeOptions:     document.getElementById("mode-options"),
  modeAbout:       document.getElementById("mode-about"),
  about:           document.getElementById("about"),
  optionsPanel:    document.getElementById("options-panel"),
  exportStats:     document.getElementById("export-stats"),
  importStatsBtn:  document.getElementById("import-stats-btn"),
  importStatsFile: document.getElementById("import-stats-file"),
  importFeedback:  document.getElementById("import-feedback"),
  settingPriority: document.getElementById("setting-priority-mode"),
  settingSrsCap:   document.getElementById("setting-srs-cap"),
  settingSrsCapRow:  document.getElementById("setting-srs-cap-row"),
  settingSrsResetRow:document.getElementById("setting-srs-reset-row"),
  settingSrsReset: document.getElementById("setting-srs-reset"),
  settingHaptic:   document.getElementById("setting-haptic"),
  settingShowStreak: document.getElementById("setting-show-streak"),
  settingFreqCap:  document.getElementById("setting-frequency-cap"),
  challenge:       document.getElementById("challenge"),
  answerRow:       document.getElementById("answer-row"),
  headword:        document.getElementById("headword"),
  translation:     document.getElementById("translation"),
  targetForm:      document.getElementById("target-form"),
  drillStyleRow:   document.getElementById("drill-style-row"),
  drillStyleSwitch: document.getElementById("drill-style-switch"),
  clozeLine:       document.getElementById("cloze-line"),
  clozeFi:         document.getElementById("cloze-fi"),
  clozeEn:         document.getElementById("cloze-en"),
  rectionChoices:  document.getElementById("rection-choices"),
  inflectionModal: document.getElementById("inflection-modal"),
  inflectionTitle: document.getElementById("inflection-title"),
  inflectionNote:  document.getElementById("inflection-note"),
  inflectionBody:  document.getElementById("inflection-body"),
  inflectionClose: document.getElementById("inflection-close"),
  answer:          document.getElementById("answer"),
  submitAnswer:    document.getElementById("submit-answer"),
  feedback:        document.getElementById("feedback"),
  hintLetter:      document.getElementById("hint-letter"),
  hintAnswer:      document.getElementById("hint-answer"),
  skip:            document.getElementById("skip"),
  filtersNoun:     document.getElementById("filters-noun"),
  filtersVerb:     document.getElementById("filters-verb"),
  presetsPanel:    document.getElementById("presets-panel"),
  presetSave:      document.getElementById("preset-save"),
  presetList:      document.getElementById("preset-list"),
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
  settingExcludeLong: document.getElementById("setting-exclude-long"),
  settingMaxLength:   document.getElementById("setting-max-length"),
  themeSwitch:     document.getElementById("theme-switch"),
  streakBadge:     document.getElementById("streak-badge"),
  appVersion:      document.getElementById("app-version"),
  aboutVersion:    document.getElementById("about-version"),
  // Test mode — restructured in 1.1.1 to mirror Blitz: an in-row launch
  // button opens a start modal, a thin in-progress hud shows during the run,
  // and results appear in a result modal. The old #test-panel section is gone.
  testOpen:        document.getElementById("test-open"),
  testHud:         document.getElementById("test-hud"),
  testCurrent:     document.getElementById("test-current"),
  testTotal:       document.getElementById("test-total"),
  testCancel:      document.getElementById("test-cancel"),
  testStartModal:  document.getElementById("test-start"),
  testLength:      document.getElementById("test-length"),
  testStartCancel: document.getElementById("test-start-cancel"),
  testStartGo:     document.getElementById("test-start-go"),
  testResultModal: document.getElementById("test-result"),
  testResults:     document.getElementById("test-results"),
  testResultAgain: document.getElementById("test-result-again"),
  testResultDone:  document.getElementById("test-result-done"),
  // Blitz mode
  blitzOpen:       document.getElementById("blitz-open"),
  blitzHud:        document.getElementById("blitz-hud"),
  blitzTimerBar:   document.getElementById("blitz-timer-bar"),
  blitzTime:       document.getElementById("blitz-time"),
  blitzScore:      document.getElementById("blitz-score"),
  blitzCombo:      document.getElementById("blitz-combo"),
  blitzStartModal: document.getElementById("blitz-start"),
  blitzDurationPicker: document.getElementById("blitz-duration-picker"),
  blitzStartBest:  document.getElementById("blitz-start-best"),
  blitzStartCancel:document.getElementById("blitz-start-cancel"),
  blitzStartGo:    document.getElementById("blitz-start-go"),
  blitzResultModal:document.getElementById("blitz-result"),
  blitzResultScore:document.getElementById("blitz-result-score"),
  blitzResultDetail:document.getElementById("blitz-result-detail"),
  blitzResultBest: document.getElementById("blitz-result-best"),
  blitzResultShare:document.getElementById("blitz-result-share"),
  blitzResultAgain:document.getElementById("blitz-result-again"),
  blitzResultDone: document.getElementById("blitz-result-done"),
  blitzShareFeedback: document.getElementById("blitz-share-feedback"),
  settingShowBlitz:document.getElementById("setting-show-blitz"),
  kptOpen:         document.getElementById("kpt-open"),
  kptModal:        document.getElementById("kpt-modal"),
  kptBody:         document.getElementById("kpt-body"),
  kptClose:        document.getElementById("kpt-close"),
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
  // Rection style replaces the typed-answer flow entirely: the prompt is the
  // verb plus a blank ("uskoa + ___"), the gloss disambiguates which sense is
  // being asked, and the answer comes from the multiple-choice buttons.
  const rection = rectionActive() && !!state.current.rection;
  el.rectionChoices.classList.toggle("hidden", !rection);
  if (rection) {
    const item = state.current.rection;
    el.translation.textContent = item.glosses.join("; ");
    el.targetForm.classList.remove("hidden");
    el.clozeLine.classList.add("hidden");
    el.targetForm.textContent =
      `${word.word} + ___` + (item.hint ? ` (‘${item.hint}’)` : "");
    renderRectionChoices();
    // Examples often use the rection complement, so they'd spoil the answer —
    // hold them back until the challenge is resolved.
    if (state.awaitingNext || state.scoredThisChallenge) {
      renderExamples(word);
    } else {
      el.examples.innerHTML = "";
      el.examples.classList.add("hidden");
    }
  } else if (possessiveActive()) {
    el.translation.textContent = (word.translations || []).slice(0, 2).join(", ");
    el.clozeLine.classList.add("hidden");
    el.targetForm.classList.remove("hidden");
    const { person, caseKey } = parsePossessiveKey(key);
    el.targetForm.textContent = `${nounLabel(caseKey, state.cfg)} — ${PERSON_LABELS[person] || person}`;
    const base = state.current.baseWord;
    if (base) renderExamples(base, state.current.answer);
    else { el.examples.innerHTML = ""; el.examples.classList.add("hidden"); }
  } else {
    el.translation.textContent = (word.translations || []).slice(0, 2).join(", ");
    // Cloze style replaces the grammatical prompt + examples with the blanked
    // sentence. Falls back to the standard prompt if the blank can't be
    // located in the original text (shouldn't happen — the pool builder
    // verified containment on the normalized form — but belt + braces).
    const cloze = clozeActive() && renderClozeLine();
    el.targetForm.classList.toggle("hidden", !!cloze);
    el.clozeLine.classList.toggle("hidden", !cloze);
    if (cloze) {
      el.examples.innerHTML = "";
      el.examples.classList.add("hidden");
    } else {
      const label = state.mode === "noun" ? nounLabel(key, state.cfg) : verbLabel(key, state.cfg);
      el.targetForm.textContent = label;
      renderExamples(word, word.inflections[key]);
    }
  }
  // Only reveal the challenge/answer row when we're actually on the drill
  // view. Some settings (excludeLong, maxAnswerLength, frequencyCap) rebuild
  // the pool as a side effect, and without this guard the challenge would
  // pop into view behind the Options panel while the user is toggling
  // settings. setView("drill") handles un-hiding when we come back.
  if (state.view === "drill") {
    el.challenge.classList.remove("hidden");
    el.answerRow.classList.remove("hidden");
  }
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

// ---------- drill style helpers ----------
// The persisted drillStyle can be mode-specific ("rection" is verb-only,
// "possessive" is noun-only). Rather than mutating the saved setting on every
// mode switch, effectiveDrillStyle() falls back to standard outside the right
// mode — switch back and the style resumes where you left it.
function effectiveDrillStyle() {
  const s = (state.settings && state.settings.drillStyle) || "standard";
  if (s === "rection"   && state.mode !== "verb") return "standard";
  if (s === "possessive" && state.mode !== "noun") return "standard";
  return s;
}

function clozeActive()      { return effectiveDrillStyle() === "cloze"; }
function rectionActive()    { return effectiveDrillStyle() === "rection"; }
function possessiveActive() { return effectiveDrillStyle() === "possessive"; }

// Possessive key format: "{person}_{case}_{number}", e.g. "1sg_inessive_singular"
function parsePossessiveKey(key) {
  const idx = key.indexOf("_");
  return { person: key.slice(0, idx), caseKey: key.slice(idx + 1) };
}

const PERSON_LABELS = {
  "1sg": "my (minun)",
  "2sg": "your (sinun)",
  "3rd": "his / her / its (hänen)",
  "1pl": "our (meidän)",
  "2pl": "your pl. (teidän)",
};

// Stats + SRS bucket each style under its own mode id so keys never collide.
function statsMode() {
  if (rectionActive())    return "rection";
  if (possessiveActive()) return "possessive";
  return state.mode;
}

// Build the blanked sentence into #cloze-fi. Returns false when the current
// challenge has no usable example (caller falls back to the standard prompt).
// Every whole-word occurrence of the target form is blanked, not just the
// first — leaving a later occurrence visible would spoil the answer.
function renderClozeLine() {
  const { word, key, exampleIndex } = state.current;
  if (typeof exampleIndex !== "number" || exampleIndex < 0) return false;
  const ex = (word.examples || [])[exampleIndex];
  const fi = typeof ex === "string" ? ex : ex && ex.fi;
  const en = typeof ex === "string" ? "" : (ex && ex.en) || "";
  const expected = word.inflections[key];
  if (!fi || !expected) return false;

  const re = clozeBlankRegex(expected);
  el.clozeFi.innerHTML = "";
  let lastIdx = 0;
  let found = false;
  let m;
  while ((m = re.exec(fi)) !== null) {
    found = true;
    if (m.index > lastIdx) {
      el.clozeFi.appendChild(document.createTextNode(fi.slice(lastIdx, m.index)));
    }
    const blank = document.createElement("span");
    blank.className = "cloze-blank";
    blank.textContent = "_____";
    el.clozeFi.appendChild(blank);
    lastIdx = m.index + m[0].length;
  }
  if (!found) return false;
  if (lastIdx < fi.length) {
    el.clozeFi.appendChild(document.createTextNode(fi.slice(lastIdx)));
  }
  el.clozeEn.textContent = en;
  el.clozeEn.classList.toggle("hidden", !en);
  return true;
}

// Fill the blank(s) with the answer once the challenge resolves, so the user
// sees the completed sentence while the feedback line is on screen. No-op in
// standard style or when nothing is blanked (e.g. cloze render fell back).
function revealCloze() {
  if (!clozeActive() || !state.current) return;
  const expected = state.current.word.inflections[state.current.key];
  for (const blank of el.clozeFi.querySelectorAll(".cloze-blank")) {
    blank.textContent = expected;
    blank.classList.add("filled");
  }
}

// ---------- rection rendering ----------
const RECTION_OPTION_COUNT = 4;

function shuffleInPlace(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// Build the option set for the current rection challenge: one randomly chosen
// acceptable complement plus distractors drawn from the dataset-wide
// vocabulary, minus anything that's a correct answer for ANY sense of this
// verb (see buildRectionPool for why).
function buildRectionRound() {
  const { rection, rectionExclude } = state.current;
  const vocab = (state.data.rection && state.data.rection.complements) || [];
  const accept = rection.accept;
  const correct = accept[Math.floor(Math.random() * accept.length)];
  const distractors = shuffleInPlace(
    vocab.filter((c) => !(rectionExclude || accept).includes(c))
  );
  const options = [correct, ...distractors.slice(0, RECTION_OPTION_COUNT - 1)];
  return { options: shuffleInPlace(options), picked: null };
}

// (Re)paint the choice buttons. Builds the round lazily on first paint per
// challenge; after the challenge resolves, repaints disabled with the
// correct/wrong coloring so view switches don't lose the answered state.
function renderRectionChoices() {
  if (!state.rectionRound) state.rectionRound = buildRectionRound();
  const { options, picked } = state.rectionRound;
  const accept = state.current.rection.accept;
  const resolved = state.awaitingNext || state.scoredThisChallenge;
  el.rectionChoices.innerHTML = "";
  options.forEach((c, i) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "rection-choice";
    const kbd = document.createElement("kbd");
    kbd.textContent = String(i + 1);
    btn.appendChild(kbd);
    const h = complementHint(c);
    const hintEl = document.createElement("span");
    hintEl.className = "choice-hint";
    hintEl.textContent = h || complementName(c);
    btn.appendChild(hintEl);
    if (h) {
      const nameEl = document.createElement("span");
      nameEl.className = "choice-name";
      nameEl.textContent = complementName(c);
      btn.appendChild(nameEl);
    }
    if (resolved) {
      btn.disabled = true;
      if (accept.includes(c)) btn.classList.add("correct");
      else if (picked === c) btn.classList.add("wrong");
    } else {
      btn.addEventListener("click", () => answerRection(c));
    }
    el.rectionChoices.appendChild(btn);
  });
}

// "uskoa + illative (mihin) ‘in’" — shown as feedback after the challenge
// resolves so the user always sees the full rection pattern.
function formatRectionPattern() {
  const { word, rection } = state.current;
  const comps = rection.accept.map((c) => {
    const h = complementHint(c);
    return h ? `${complementName(c)} (${h})` : complementName(c);
  }).join(" or ");
  return `${word.word} + ${comps}` + (rection.hint ? ` ‘${rection.hint}’` : "");
}

function answerRection(choice) {
  if (!state.current || state.awaitingNext || state.scoredThisChallenge) return;
  const ok = state.current.rection.accept.includes(choice);
  state.rectionRound.picked = choice;
  state.awaitingNext = true;
  score(ok ? "correct" : "wrong");
  if (!ok) buzzIfWrong();
  setFeedback(`${ok ? "✓" : "✗"} ${formatRectionPattern()}`, ok ? "ok" : "bad");
  renderRectionChoices();
  renderExamples(state.current.word);
  // Auto-advance — a beat longer on a miss so the full pattern can be read.
  // The challenge-identity check (not just awaitingNext) keeps a stale timer
  // from skipping ahead when the user Enter-advanced and answered the next
  // challenge before this one's window elapsed.
  const answered = state.current;
  setTimeout(() => {
    if (state.awaitingNext && state.current === answered) newChallenge();
  }, ok ? 1400 : 2600);
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
  const ch = state.current;
  const expected = ch.answer !== undefined ? ch.answer : ch.word.inflections[ch.key];
  speak(expected);
}

// Returns a promise that resolves when the utterance finishes (or a nop-
// resolved promise when autoplay is off / muted / suppressed). Callers that
// want to advance AFTER the audio finishes — specifically the correct-answer
// auto-advance — can await this so the speech isn't clipped mid-word by
// cancelSpeech() in newChallenge().
function maybeAutoPlayAnswer() {
  if (!state.settings.autoPlayAudio) return Promise.resolve();
  // Suppress audio during an active test — hearing the answer is a spoiler.
  if (testActive()) return Promise.resolve();
  if (!state.current) return Promise.resolve();
  const ch = state.current;
  const expected = ch.answer !== undefined ? ch.answer : ch.word.inflections[ch.key];
  return speak(expected);
}

function setFeedback(text, cls) {
  el.feedback.textContent = text;
  el.feedback.className = "feedback" + (cls ? " " + cls : "");
  // Physical cue on wrong answers: brief shake on the input. Re-trigger by
  // removing + forcing reflow, since the class may still be applied from a
  // previous wrong answer. CSS strips all animation under reduced-motion.
  if (cls === "bad") {
    el.answer.classList.remove("input-shake");
    void el.answer.offsetWidth;
    el.answer.classList.add("input-shake");
  }
}

function setStatus(text) { el.statusLine.textContent = text; }

function updateStatus() {
  const count = state.pool.length;
  const styleId = effectiveDrillStyle();
  const style = styleId === "standard" ? "" : ` ${styleId}`;
  let suffix = "";
  if (count === 0) {
    if (rectionActive()) {
      suffix = " \u2014 no rection data within the current frequency cap; raise it under Options";
    } else if (clozeActive()) {
      suffix = " \u2014 no example sentences match these filters; broaden them or switch to Standard";
    } else if (possessiveActive()) {
      suffix = " \u2014 no possessive data within the current filters; enable more noun groups above";
    } else {
      suffix = " \u2014 all filtered out, enable something above";
    }
  }
  setStatus(`${state.mode}${style} mode \u2022 ${count.toLocaleString()} possible challenges${suffix}`);
}

// ---------- analytics ----------
// Thin wrapper around gtag. Captures drill-level events so I can see
// engagement shape (are people answering? correct/wrong ratio? which mode?).
// No answer content, no word IDs, no per-user state — just the two axes I
// need for basic reporting: mode (noun/verb) and outcome.
//
// No-ops if gtag isn't available (content blocker, offline first-load, etc.),
// so the drill never fails because analytics didn't load.
function track(name, params) {
  if (typeof gtag !== "function") return;
  try { gtag("event", name, params || {}); }
  catch { /* swallow — analytics must never break the drill */ }
}

// Session-level one-shot: fire once per page load when the user answers their
// first challenge. Good retention signal ("of people who landed, how many
// actually engaged?") without the volume of a per-answer event.
let sessionFirstAnswerFired = false;

// ---------- stats plumbing ----------
function score(outcome) {
  // Only the first terminal outcome per challenge counts. Prevents double-
  // counting e.g. "wrong" then "shown" on the same card.
  if (state.scoredThisChallenge) return;
  if (!state.current) return;
  recordOutcome(state.stats, statsMode(), state.current, outcome);
  saveStats(state.stats);
  state.scoredThisChallenge = true;

  // Mirror the outcome into the SRS schedule. "skipped" is deliberately
  // neutral — we didn't learn anything about recall, so we don't want to
  // inflate or deflate stability for it.
  recordOutcomeToSchedule(outcome);

  // GA: per-answer event with mode + outcome as params. Low-cardinality by
  // design (4 outcomes × 2 modes = 8 shapes). Register `mode` and `outcome`
  // as custom dimensions in GA4 admin if you want to filter the default
  // reports by them — without that, params still land in Explorations /
  // DebugView, just not the headline reports.
  track("drill_answer", { mode: statsMode(), outcome });
  if (!sessionFirstAnswerFired) {
    sessionFirstAnswerFired = true;
    track("session_first_answer", { mode: statsMode() });
  }

  if (outcome === "correct") {
    const before = state.streak.current;
    bumpStreak(state.streak);
    if (state.streak.current !== before) {
      saveStreak(state.streak);
      renderStreak();
    }
  }
  refreshStatsPanel();
}

// Map a drill outcome onto an FSRS grade and persist. Only reached when we
// have a current challenge and haven't already scored it.
function recordOutcomeToSchedule(outcome) {
  if (!state.current) return;
  const cap = CAP_PRESETS[state.settings.srsCap] || CAP_PRESETS.balanced;
  const id = `${statsMode()}|${state.current.word.word}|${state.current.key}`;
  const now = Date.now();

  if (outcome === "correct") {
    // Hints used → HARD; clean answer → GOOD. We don't surface EASY from the
    // UI (no explicit "too easy" button); that keeps the grading pipeline
    // simple and prevents accidental mastery from, say, hitting Enter on a
    // pre-filled hint trail.
    const grade = state.hintsShown > 0 ? GRADE.HARD : GRADE.GOOD;
    gradeItem(state.schedule, id, grade, cap.capDays, now);
  } else if (outcome === "wrong") {
    gradeItem(state.schedule, id, GRADE.AGAIN, cap.capDays, now);
  } else if (outcome === "shown") {
    gradeShown(state.schedule, id, cap.capDays, now);
  }
  // "skipped" → no schedule update (user didn't attempt)

  if (outcome !== "skipped") saveSchedule(state.schedule);
}

// The little flame badge next to the version tag. Hidden when no streak.
// Reflect the active theme on the segmented control.
function renderThemeSwitch() {
  if (!el.themeSwitch) return;
  const pref = state.settings.theme;
  for (const btn of el.themeSwitch.querySelectorAll(".seg-btn")) {
    const active = btn.dataset.value === pref;
    btn.classList.toggle("active", active);
    btn.setAttribute("aria-checked", active ? "true" : "false");
  }
}

// Sync the three-way priority switch to the saved value.
function renderPrioritySwitch() {
  if (!el.settingPriority) return;
  const pref = state.settings.priorityMode;
  for (const btn of el.settingPriority.querySelectorAll(".seg-btn")) {
    const active = btn.dataset.value === pref;
    btn.classList.toggle("active", active);
    btn.setAttribute("aria-checked", active ? "true" : "false");
  }
}

// Show the cap select + reset button only when SRS is the active mode.
// Saves vertical space in Options and avoids implying those controls have any
// effect in uniform/weighted modes.
function updateSrsControlsVisibility() {
  const srs = state.settings.priorityMode === "srs";
  if (el.settingSrsCapRow)   el.settingSrsCapRow.classList.toggle("hidden", !srs);
  if (el.settingSrsResetRow) el.settingSrsResetRow.classList.toggle("hidden", !srs);
}

function renderStreak() {
  if (!el.streakBadge) return;
  // Two independent reasons to hide the badge: the user opted out, or there's
  // no active streak to show. Either condition collapses it entirely.
  const showStreak = !!(state.settings && state.settings.showStreak);
  const n = state.streak && state.streak.current;
  if (!showStreak || !n) {
    el.streakBadge.classList.add("hidden");
    el.streakBadge.textContent = "";
    return;
  }
  el.streakBadge.classList.remove("hidden");
  el.streakBadge.textContent = `\uD83D\uDD25 ${n}`;
  el.streakBadge.setAttribute(
    "title",
    `Daily streak: ${n} day${n === 1 ? "" : "s"}` +
    (state.streak.longest > n ? ` (best: ${state.streak.longest})` : "")
  );
}

function refreshStatsPanel() {
  // Only re-render if the panel is actually open, to avoid work users can't see.
  if (el.statsPanel && el.statsPanel.open) {
    renderStats(el.statsBody, state.cfg, state.stats);
  }
}

// ---------- test mode ----------
// Restructured in 1.1.1 to mirror Blitz: a launch button opens a start
// modal, a thin hud shows during the run, results land in a result modal.
// When active, per-question feedback + autoplay are suppressed and each
// answer is stored silently. After `length` answers, the result modal
// opens and the test is marked finished.

function openTestModal() {
  if (rectionActive()) {
    setStatus("Test mode isn't available in the Rection style — switch to Standard or Cloze first.");
    return;
  }
  if (state.pool.length === 0) {
    setStatus("No challenges in the current pool — enable a filter first.");
    return;
  }
  if (blitzActive()) {
    alert("Finish or cancel the current Blitz round before starting a test.");
    return;
  }
  // Pre-fill with the user's last-used length.
  el.testLength.value = String(state.settings.testLength);
  el.testStartModal.classList.remove("hidden");
  // Defer focus so the modal is fully painted before selecting the input.
  setTimeout(() => { try { el.testLength.focus(); el.testLength.select(); } catch {} }, 0);
}

function closeTestStartModal() {
  el.testStartModal.classList.add("hidden");
}

function startTest() {
  const length = clampInt(el.testLength.value, 1, 500, state.settings.testLength);
  state.settings.testLength = length;
  saveSettings(state.settings);

  closeTestStartModal();
  state.test = { length, answered: 0, results: [], finished: false };
  el.testHud.classList.remove("hidden");
  el.testTotal.textContent = String(length);
  el.testCurrent.textContent = "1";
  track("test_start", { mode: state.mode, length });
  newChallenge();
}

function recordTestAnswer(outcome, input) {
  if (!state.test || state.test.finished) return;
  const ch = state.current;
  const expected = ch.answer !== undefined ? ch.answer : ch.word.inflections[ch.key];
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
  el.testHud.classList.add("hidden");
  renderTestResults();
  el.testResultModal.classList.remove("hidden");
  // GA: one event per completed test with aggregate outcome counts. Cheaper
  // than a per-question event (per-question already goes through score()),
  // and captures the "how did this attempt go" shape at test granularity.
  const r = state.test.results;
  const correct = r.filter((x) => x.outcome === "correct").length;
  track("test_complete", {
    mode:     state.mode,
    length:   r.length,
    correct,
    accuracy: r.length ? Math.round(100 * correct / r.length) : 0,
  });
}

function cancelTest() {
  state.test = null;
  el.testHud.classList.add("hidden");
  el.testResultModal.classList.add("hidden");
  el.testResults.innerHTML = "";
}

// Close the result modal without starting a new test. Mirrors the "Done"
// button on the blitz result modal — drop the user back into a fresh
// regular challenge so the last test prompt isn't sitting in the input
// waiting for a stray Enter to double-score it.
function closeTestResult() {
  state.test = null;
  el.testResultModal.classList.add("hidden");
  el.testResults.innerHTML = "";
  newChallenge();
}

// "New test" from the result modal: close the result, reopen the start
// modal preloaded with the same length so the user can re-roll quickly.
function playTestAgain() {
  state.test = null;
  el.testResultModal.classList.add("hidden");
  el.testResults.innerHTML = "";
  openTestModal();
}

function renderTestResults() {
  const r = state.test.results;
  const correct = r.filter((x) => x.outcome === "correct").length;
  const wrong   = r.filter((x) => x.outcome === "wrong").length;
  const shown   = r.filter((x) => x.outcome === "shown").length;
  const skipped = r.filter((x) => x.outcome === "skipped").length;
  const pct = r.length === 0 ? 0 : Math.round(100 * correct / r.length);

  el.testResults.innerHTML = "";

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

// Confirm-and-cancel before navigating away from the drill view. Returns
// false if the user backed out of any confirm, true if it's safe to proceed.
// Centralized so both Options and About switches behave the same.
function leaveDrillGuard() {
  if (blitzActive()) {
    if (!confirm("Leaving the drill will cancel the current Blitz round. Continue?")) return false;
    cancelBlitz();
  }
  if (testActive()) {
    if (!confirm("Leaving the drill will cancel the current test. Continue?")) return false;
    cancelTest();
  }
  return true;
}

// ---------- blitz mode ----------
// Timed sprint round. The drill chrome (hint row) hides, a HUD with timer bar
// and score slides in above the challenge, and each submit becomes a tight
// correct/wrong loop with no SRS/stats side effects. Timer is authoritative
// off Date.now() rather than a tick counter so a paused/throttled tab that
// comes back late just ends the round, not drifts.

function blitzActive() {
  return !!(state.blitz && state.blitz.active);
}

function openBlitzModal() {
  if (rectionActive()) {
    setStatus("Blitz isn't available in the Rection style — switch to Standard or Cloze first.");
    return;
  }
  if (state.pool.length === 0) {
    setStatus("No challenges in the current pool — enable a filter first.");
    return;
  }
  if (testActive()) {
    alert("Finish or cancel the current test before starting a Blitz round.");
    return;
  }
  // Pre-select the user's last-used duration (or 60 as the default).
  const d = state.settings.blitzDuration || 60;
  setBlitzDurationSelection(d);
  renderBlitzStartBest(d);
  el.blitzStartModal.classList.remove("hidden");
}

function closeBlitzStartModal() {
  el.blitzStartModal.classList.add("hidden");
}

function setBlitzDurationSelection(duration) {
  for (const btn of el.blitzDurationPicker.querySelectorAll(".seg-btn")) {
    const active = Number(btn.dataset.duration) === duration;
    btn.classList.toggle("active", active);
    btn.setAttribute("aria-checked", active ? "true" : "false");
  }
  state.settings.blitzDuration = duration;
}

function renderBlitzStartBest(duration) {
  const best = bestScoreAt(state.blitzStats, duration);
  el.blitzStartBest.textContent = best === null
    ? "No personal best yet at this length."
    : `Personal best: ${best} at ${duration}s.`;
}

function startBlitz() {
  const duration = state.settings.blitzDuration || 60;
  saveSettings(state.settings);
  closeBlitzStartModal();

  // Cancel any in-flight speech from a previous challenge — blitz has no
  // audio, and we don't want a stale TTS utterance trailing into the round.
  cancelSpeech();

  state.blitz = {
    active: true,
    duration,
    endAt: Date.now() + duration * 1000,
    score: 0,
    wrong: 0,
    combo: 0,
    bestCombo: 0,
    timerId: null,
    wrongFlashUntil: 0,
  };

  // Chrome swap: hide hints/speak, show HUD. The answer input and headword
  // stay put — blitz reuses the same drill plumbing.
  document.body.classList.add("blitz-mode");
  el.blitzHud.classList.remove("hidden");
  updateBlitzHud();

  // First challenge: force uniform sampling regardless of priorityMode.
  // SRS bias ("here's your 5 worst words") feels wrong at sprint pace —
  // blitz should be a grab-bag from the whole pool.
  newBlitzChallenge();

  state.blitz.timerId = setInterval(blitzTick, 100);
  el.answer.focus();
}

function newBlitzChallenge() {
  cancelSpeech();
  state.current = nextChallenge(state.pool, state.current, {
    priority: "uniform",
    mode:     state.mode,
    now:      Date.now(),
  });
  state.awaitingNext = false;
  state.hintsShown = 0;
  state.scoredThisChallenge = false;
  el.answer.value = "";
  setFeedback("");
  el.answer.classList.remove("blitz-flash-ok", "blitz-flash-bad");
  if (state.current) render();
  if (state.view === "drill") el.answer.focus();
}

function blitzTick() {
  if (!blitzActive()) return;
  const now = Date.now();
  const remaining = Math.max(0, state.blitz.endAt - now);
  if (remaining <= 0) { endBlitz(); return; }
  updateBlitzHud(remaining);
}

function updateBlitzHud(remainingMs) {
  if (!state.blitz) return;
  const remaining = remainingMs !== undefined
    ? remainingMs
    : Math.max(0, state.blitz.endAt - Date.now());
  const totalMs = state.blitz.duration * 1000;
  const pct = Math.max(0, Math.min(100, (remaining / totalMs) * 100));
  el.blitzTimerBar.style.width = `${pct}%`;
  el.blitzTimerBar.classList.toggle("urgent", pct <= 20);

  const secs = Math.ceil(remaining / 1000);
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  el.blitzTime.textContent = `${m}:${s < 10 ? "0" : ""}${s}`;

  el.blitzScore.textContent = String(state.blitz.score);

  const combo = state.blitz.combo;
  if (combo >= 2) {
    el.blitzCombo.textContent = `combo \u00D7${combo}${combo >= 5 ? " \uD83D\uDD25" : ""}`;
    el.blitzCombo.classList.add("active");
  } else {
    el.blitzCombo.textContent = "";
    el.blitzCombo.classList.remove("active");
  }
}

function blitzSubmit() {
  const b = state.blitz;
  if (!b || !b.active) return;
  // Block re-entry while a wrong-answer flash is on screen — prevents a
  // hammering typer from submitting the next card's blank input as "wrong".
  if (b.wrongFlashUntil && Date.now() < b.wrongFlashUntil) return;
  const input = el.answer.value;
  if (!input.trim()) return;
  const result = checkAnswer(state.current, input);
  if (result.ok) {
    b.score += 1;
    b.combo += 1;
    if (b.combo > b.bestCombo) b.bestCombo = b.combo;
    // Quick green flash on the input, then straight to the next card. No
    // TTS, no setTimeout chain — every ms matters at sprint pace.
    el.answer.classList.add("blitz-flash-ok");
    updateBlitzHud();
    newBlitzChallenge();
  } else {
    b.wrong += 1;
    b.combo = 0;
    // Show the correct form briefly so the user learns something, then
    // advance. 800ms is short enough not to feel punitive but long enough
    // to actually read on mobile.
    const expected = result.expected;
    setFeedback(`\u2717 was: ${expected}`, "bad");
    revealCloze();
    el.answer.classList.add("blitz-flash-bad");
    buzzIfWrong();
    b.wrongFlashUntil = Date.now() + 800;
    updateBlitzHud();
    setTimeout(() => {
      if (!blitzActive()) return; // round may have ended during the flash
      newBlitzChallenge();
    }, 800);
  }
}

function endBlitz() {
  const b = state.blitz;
  if (!b) return;
  clearInterval(b.timerId);
  b.active = false;

  document.body.classList.remove("blitz-mode");
  el.blitzHud.classList.add("hidden");
  el.answer.classList.remove("blitz-flash-ok", "blitz-flash-bad");
  setFeedback("");

  const summary = recordBlitzRound(state.blitzStats, b.duration, b.score, b.bestCombo);
  saveBlitzStats(state.blitzStats);

  // GA: one event per completed round. Matches the shape of test_complete
  // so the two are comparable in reports. Same privacy budget as the drill
  // events — counts only, no answer content.
  track("blitz_complete", {
    mode:       state.mode,
    duration:   b.duration,
    score:      b.score,
    wrong:      b.wrong,
    best_combo: b.bestCombo,
  });

  // Populate the result modal.
  el.blitzResultScore.textContent = String(b.score);
  const total = b.score + b.wrong;
  const pct = total === 0 ? 0 : Math.round(100 * b.score / total);
  el.blitzResultDetail.textContent =
    `${b.score} correct \u00B7 ${b.wrong} wrong \u00B7 ` +
    `${pct}% accuracy \u00B7 best combo \u00D7${b.bestCombo}`;

  const parts = [];
  if (summary.isPersonalBestScore && summary.previousBestScore !== null) {
    parts.push(`\uD83C\uDFC6 New best score! (was ${summary.previousBestScore})`);
  } else if (summary.isPersonalBestScore) {
    parts.push("\uD83C\uDFC6 First round at this length!");
  } else if (summary.previousBestScore !== null) {
    parts.push(`personal best ${summary.previousBestScore}`);
  }
  if (summary.isPersonalBestCombo && summary.previousBestCombo !== null && b.bestCombo > 0) {
    parts.push(`new combo best (was \u00D7${summary.previousBestCombo})`);
  }
  el.blitzResultBest.textContent = parts.join(" \u00B7 ");

  el.blitzShareFeedback.textContent = "";
  el.blitzResultModal.classList.remove("hidden");
}

function cancelBlitz() {
  const b = state.blitz;
  if (!b) return;
  clearInterval(b.timerId);
  b.active = false;
  state.blitz = null;
  document.body.classList.remove("blitz-mode");
  el.blitzHud.classList.add("hidden");
  el.answer.classList.remove("blitz-flash-ok", "blitz-flash-bad");
}

function shareBlitzResult() {
  const b = state.blitz;
  if (!b) return;
  const total = b.score + b.wrong;
  const pct = total === 0 ? 0 : Math.round(100 * b.score / total);
  const text =
    `\uD83C\uDDEB\uD83C\uDDEE Finnish Drill — Blitz, ${b.duration}s\n` +
    `\u2705 ${b.score} correct / ${b.wrong} wrong (${pct}%)\n` +
    `\uD83D\uDD25 best combo \u00D7${b.bestCombo}\n` +
    `https://desskit.github.io/Finnish-Inflection-Drill/`;
  // Clipboard API needs a secure context; fall back to a hidden textarea for
  // older browsers / file://. Either way, show a confirmation line so the
  // user knows the copy happened.
  const done = () => {
    el.blitzShareFeedback.textContent = "Copied to clipboard.";
    setTimeout(() => {
      if (el.blitzShareFeedback) el.blitzShareFeedback.textContent = "";
    }, 2500);
  };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(done, () => fallbackCopy(text, done));
  } else {
    fallbackCopy(text, done);
  }
}

function fallbackCopy(text, onDone) {
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    document.body.removeChild(ta);
    onDone();
  } catch {
    el.blitzShareFeedback.textContent = "Couldn't copy automatically — please copy the score manually.";
  }
}

function closeBlitzResult() {
  el.blitzResultModal.classList.add("hidden");
  state.blitz = null;
  // Drop the user back into a fresh regular challenge so the drill UI is
  // usable again without a manual tab switch. Pool may have shifted under
  // us if filters changed between rounds (they can't, modals are modal,
  // but belt + braces).
  newChallenge();
}

function playBlitzAgain() {
  const duration = (state.blitz && state.blitz.duration) || state.settings.blitzDuration || 60;
  el.blitzResultModal.classList.add("hidden");
  state.blitz = null;
  state.settings.blitzDuration = duration;
  startBlitz();
}

// Apply the settings.showBlitz toggle to the launch button visibility. Kept
// as a helper because it's hit from both boot and the settings change event.
function applyShowBlitz() {
  if (!el.blitzOpen) return;
  const show = state.settings && state.settings.showBlitz !== false;
  el.blitzOpen.classList.toggle("hidden", !show);
}

// ---------- drill flow ----------
// `opts.suppressFocus` skips the answer-input focus step at the end. Callers
// triggered by user edits to the filter grid / presets / etc. pass true:
// focusing the answer input from there scrolls the page up on mobile and
// yanks focus out of the checkbox the user was just tapping. Explicit user
// actions (submit, skip, mode switch) leave it unset so focus lands where
// they expect.
function newChallenge(opts) {
  cancelSpeech();
  const priority = (state.settings && state.settings.priorityMode) || "uniform";
  const capPreset = CAP_PRESETS[state.settings && state.settings.srsCap] || CAP_PRESETS.balanced;
  state.current = nextChallenge(state.pool, state.current, {
    priority,
    mode:     statsMode(),
    stats:    state.stats,
    schedule: state.schedule,
    srsFloor: capPreset.floor,
    now:      Date.now(),
  });
  state.awaitingNext = false;
  state.hintsShown = 0;
  state.scoredThisChallenge = false;
  state.rectionRound = null;
  el.answer.value = "";
  setFeedback("");
  if (!state.current) {
    el.challenge.classList.add("hidden");
    el.answerRow.classList.add("hidden");
    return;
  }
  render();
  // Entrance animation for the fresh card. Remove + reflow + re-add so it
  // re-triggers on every challenge, not just the first.
  el.challenge.classList.remove("card-in");
  void el.challenge.offsetWidth;
  el.challenge.classList.add("card-in");
  // Keep focus management scoped to the drill view — don't yank focus into
  // a hidden answer input while the user is interacting with Options — and
  // skip it entirely when the caller asked us to (filter toggles, preset
  // applies) so we don't scroll mobile users away from the control they're
  // touching.
  if (state.view === "drill" && !rectionActive() && !(opts && opts.suppressFocus)) {
    el.answer.focus();
  }
}

function submit() {
  if (!state.current) return;

  // Blitz has its own submit path: no SRS, no drill stats, no streak bump,
  // no TTS chain. Handled entirely inside blitzSubmit().
  if (blitzActive()) { blitzSubmit(); return; }

  // Dead zone between a blitz round ending and the user dismissing the
  // result modal. state.current may still be set, and without this guard
  // an Enter press would fall through to the normal drill submit path and
  // score a challenge the user never actually intended to answer.
  if (state.blitz && !state.blitz.active) return;

  // In an active test we run a tighter loop: silent feedback, record,
  // immediate advance. Stats still update via score().
  if (testActive()) {
    const input = el.answer.value;
    if (!input.trim()) return;
    const result = checkAnswer(state.current, input);
    const testOutcome = result.ok && state.hintsShown === 0 ? "correct" : "wrong";
    score(testOutcome);
    recordTestAnswer(testOutcome, input);
    if (!state.test.finished) newChallenge();
    return;
  }

  if (state.awaitingNext) { newChallenge(); return; }

  const input = el.answer.value;
  if (!input.trim()) return;

  const result = checkAnswer(state.current, input);
  if (result.ok) {
    setFeedback("\u2713 correct", "ok");
    revealCloze();
    score(state.hintsShown > 0 ? "wrong" : "correct");
    state.awaitingNext = true;
    // Advance after the TTS finishes, not on a fixed timer. Finnish words
    // of even moderate length were getting clipped on mobile because the
    // old 900ms timeout fired mid-utterance and newChallenge() cancels
    // speech. The speak() promise resolves on the utterance's `end` event
    // (or a safety timeout); we add a small buffer so the last phoneme
    // isn't clipped by the incoming cancelSpeech(). The awaitingNext guard
    // prevents a double-advance if the user pressed Enter/Skip first.
    maybeAutoPlayAnswer().then(() => {
      setTimeout(() => {
        if (state.awaitingNext) newChallenge();
      }, state.settings.autoPlayAudio ? 200 : 450);
    });
  } else if (state.settings.requireCorrect) {
    // Count the first wrong attempt, then let them keep trying.
    score("wrong");
    buzzIfWrong();
    setFeedback("\u2717 not quite \u2014 try again", "bad");
    el.answer.select();
  } else {
    score("wrong");
    buzzIfWrong();
    setFeedback(`\u2717 expected: ${result.expected}`, "bad");
    revealCloze();
    maybeAutoPlayAnswer();
    state.awaitingNext = true;
  }
}

// Short haptic buzz on wrong answers for mobile. No-op if the browser doesn't
// support navigator.vibrate (desktop Chrome is fine; iOS Safari ignores it).
function buzzIfWrong() {
  if (!state.settings || !state.settings.hapticFeedback) return;
  if (typeof navigator === "undefined" || !navigator.vibrate) return;
  try { navigator.vibrate(40); } catch { /* ignore */ }
}

function revealNextLetter() {
  if (!state.current || state.awaitingNext) return;
  if (blitzActive()) return;   // hints disabled during blitz
  if (rectionActive()) return; // no typed answer to reveal letters of
  const ch = state.current;
  const expected = ch.answer !== undefined ? ch.answer : ch.word.inflections[ch.key];
  const input = el.answer.value;
  let correctPrefixLen = 0;
  while (correctPrefixLen < input.length && correctPrefixLen < expected.length && input[correctPrefixLen] === expected[correctPrefixLen]) {
    correctPrefixLen++;
  }
  if (correctPrefixLen >= expected.length) return;
  state.hintsShown = Math.max(state.hintsShown, correctPrefixLen) + 1;
  el.answer.value = expected.slice(0, state.hintsShown);

  if (state.hintsShown >= expected.length) {
    // Last letter revealed — score as wrong and auto-advance.
    if (testActive()) {
      // Tests stay silent: record the miss and move on without leaking
      // feedback or leaving the flow stuck on awaitingNext.
      score("wrong");
      recordTestAnswer("wrong", el.answer.value);
      if (!state.test.finished) newChallenge();
      return;
    }
    score("wrong");
    setFeedback(`✗ ${expected}`, "bad");
    revealCloze();
    maybeAutoPlayAnswer();
    state.awaitingNext = true;
  } else {
    el.answer.focus();
    el.answer.setSelectionRange(el.answer.value.length, el.answer.value.length);
  }
}

function showFullAnswer() {
  if (!state.current) return;
  if (blitzActive()) return;   // hints disabled during blitz
  if (rectionActive()) return; // multiple choice — nothing to type-reveal
  if (testActive()) {
    score("shown");
    recordTestAnswer("shown", el.answer.value);
    if (!state.test.finished) newChallenge();
    return;
  }
  const ch = state.current;
  const expected = ch.answer !== undefined ? ch.answer : ch.word.inflections[ch.key];
  el.answer.value = expected;
  setFeedback(`answer shown: ${expected}`, "bad");
  revealCloze();
  score("shown");
  maybeAutoPlayAnswer();
  state.awaitingNext = true;
}

function skipChallenge() {
  if (!state.current) return;
  if (blitzActive()) return;   // skip disabled during blitz
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
// `opts.suppressFocus` is forwarded to newChallenge — see the note there.
function rebuildPool(opts) {
  let pool;
  if (rectionActive()) {
    // Rection has its own challenge set — the case/tense filter grids don't
    // apply (and are hidden); only the frequency cap below carries over.
    pool = buildRectionPool(state.data);
  } else if (possessiveActive()) {
    // Possessive drill uses the possessives dataset filtered by the same noun
    // group/case checkboxes. Length and cloze filters don't apply here.
    pool = buildPossessivePool(state.data, state.nounFilters);
  } else {
    pool = state.mode === "noun"
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

    // Cloze style: keep only challenges whose word has an example sentence
    // containing the target form, and remember which example it was.
    if (clozeActive()) pool = buildClozePool(pool);
  }

  // Optional frequency cap — restrict to words whose best inflected-form rank
  // is within the top N. Words with no rank (null) fall outside any cap.
  if (state.settings && state.settings.frequencyCap > 0) {
    const cap = state.settings.frequencyCap;
    pool = pool.filter(({ word }) => {
      const r = word.frequency_rank;
      return typeof r === "number" && r <= cap;
    });
  }

  state.pool = pool;
  updateStatus();
  newChallenge(opts);
}

// Reflect current tab selection on the four buttons.
function updateTabAria() {
  const drill = state.view === "drill";
  el.modeNoun.setAttribute("aria-selected",    drill && state.mode === "noun" ? "true" : "false");
  el.modeVerb.setAttribute("aria-selected",    drill && state.mode === "verb" ? "true" : "false");
  el.modeOptions.setAttribute("aria-selected", state.view === "options"       ? "true" : "false");
  el.modeAbout.setAttribute("aria-selected",   state.view === "about"         ? "true" : "false");
}

// Show or hide the drill UI vs the standalone panels (About, Options).
// Doesn't touch drill state (pool, current challenge, stats) — leaving and
// returning should preserve your place.
function setView(view) {
  state.view = view;
  const drill   = view === "drill";
  const options = view === "options";
  const about   = view === "about";
  // Drill-only chrome: only show if we're in drill view AND we have something
  // to drill (otherwise the "hidden" class from newChallenge wins).
  el.challenge.classList.toggle("hidden", !(drill && state.current));
  el.answerRow.classList.toggle("hidden", !(drill && state.current));
  el.drillStyleRow.classList.toggle("hidden", !drill);
  // Rection ignores the filter grids and presets entirely (its pool isn't
  // case/tense-shaped), so they hide along with the rest of the chrome.
  el.filtersNoun.classList.toggle("hidden", !(drill && state.mode === "noun"));
  el.filtersVerb.classList.toggle("hidden", !(drill && state.mode === "verb" && !rectionActive()));
  // Presets live between filters and test mode; drill-only, and the list is
  // per-mode so it re-renders on any mode switch that reaches this code path.
  el.presetsPanel.classList.toggle("hidden", !(drill && !rectionActive()));
  if (drill) renderPresets();
  // Stats / status line are drill-only; settings now live in Options. The
  // test hud is gated on both: only show it on the drill view AND when a
  // test is actually running. Hiding on leave keeps it from peeking into
  // Options/About, showing on return preserves the user's place if they
  // wandered off mid-test.
  el.testHud.classList.toggle("hidden", !(drill && testActive()));
  el.statsPanel.classList.toggle("hidden",    !drill);
  el.statusLine.classList.toggle("hidden",    !drill);
  el.about.classList.toggle("hidden",          !about);
  el.optionsPanel.classList.toggle("hidden",   !options);
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
  // Same story for blitz — mid-round mode switch invalidates the pool.
  if (changed && blitzActive()) {
    if (!confirm("Switching mode will cancel the current Blitz round. Continue?")) return;
    cancelBlitz();
  }
  state.mode = mode;
  // The effective drill style can change with the mode (rection is verb-only),
  // so the switch highlight and the body chrome both need a refresh here.
  renderDrillStyleSwitch();
  applyRectionChrome();
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

// ---------- drill style (standard / cloze / rection) ----------
function renderDrillStyleSwitch() {
  if (!el.drillStyleSwitch) return;
  const pref = effectiveDrillStyle();
  for (const btn of el.drillStyleSwitch.querySelectorAll(".seg-btn")) {
    // Rection is verb-only; Possessive is noun-only — hide each outside its mode.
    if (btn.dataset.value === "rection") {
      btn.classList.toggle("hidden", state.mode !== "verb");
    }
    if (btn.dataset.value === "possessive") {
      btn.classList.toggle("hidden", state.mode !== "noun");
    }
    const active = btn.dataset.value === pref;
    btn.classList.toggle("active", active);
    btn.setAttribute("aria-checked", active ? "true" : "false");
  }
}

function updateAnswerPlaceholder() {
  el.answer.placeholder = clozeActive()
    ? "type the missing form and press Enter"
    : "type the form and press Enter";
}

// Swap body classes for mode-specific chrome.
// rection-mode: hides the typed-answer input + hint buttons (multiple choice instead).
// possessive-mode: reveals the Possessor filter section in the noun panel.
function applyRectionChrome() {
  document.body.classList.toggle("rection-mode",    rectionActive());
  document.body.classList.toggle("possessive-mode", possessiveActive());
}

function setDrillStyle(style) {
  if (style !== "standard" && style !== "cloze" && style !== "rection" && style !== "possessive") return;
  if (state.settings.drillStyle === style) return;
  // Each style is a different challenge set, so switching mid-test or
  // mid-blitz invalidates the run — same confirm flow as a mode switch.
  if (testActive()) {
    if (!confirm("Switching drill style will cancel the current test. Continue?")) return;
    cancelTest();
  }
  if (blitzActive()) {
    if (!confirm("Switching drill style will cancel the current Blitz round. Continue?")) return;
    cancelBlitz();
  }
  state.settings.drillStyle = style;
  saveSettings(state.settings);
  renderDrillStyleSwitch();
  updateAnswerPlaceholder();
  applyRectionChrome();
  track("drill_style", { style });
  rebuildPool();
  // Filter/preset panel visibility depends on the style — re-sync the view.
  if (state.view === "drill") setView("drill");
}

// ---------- full inflection table ----------
// Opened by tapping the headword. While the current challenge is unanswered,
// every cell whose value matches the expected answer is masked, so the table
// works as a paradigm reference without doubling as a free "show answer".

function openInflectionTable() {
  if (!state.current) return;
  // A reference aid has no place inside timed or unaided runs — the hint
  // buttons at least carry a stats penalty; this wouldn't.
  if (blitzActive() || testActive()) return;
  const { word, key } = state.current;
  el.inflectionBody.innerHTML = "";
  if (possessiveActive()) {
    // Show the base noun's plain inflection table as a paradigm reference.
    // No masking — the possessive form isn't in the base table, so there's
    // nothing to conceal that would spoil the answer.
    const base = state.current.baseWord || word;
    el.inflectionTitle.textContent = base.word;
    el.inflectionNote.classList.add("hidden");
    el.inflectionBody.appendChild(buildNounTable(base, null, null, false));
  } else {
    const expected = word.inflections[key];
    // Rection answers are case names, not table cells — nothing to mask.
    const concealed = !rectionActive() && !(state.awaitingNext || state.scoredThisChallenge);
    el.inflectionTitle.textContent = word.word;
    el.inflectionNote.classList.toggle("hidden", !concealed);
    if (state.mode === "noun") {
      el.inflectionBody.appendChild(buildNounTable(word, key, expected, concealed));
    } else {
      buildVerbTables(el.inflectionBody, word, key, expected, concealed);
    }
  }
  track("inflection_table_open", { mode: state.mode });
  el.inflectionModal.classList.remove("hidden");
}

function closeInflectionTable() {
  el.inflectionModal.classList.add("hidden");
  if (state.view === "drill") el.answer.focus();
}

function inflectionCell(value, key, currentKey, expected, concealed, gradeInfo) {
  const td = document.createElement("td");
  if (!value) {
    td.textContent = "—";
    td.className = "infl-empty";
    return td;
  }
  if (key === currentKey) td.classList.add("infl-target");
  const masked = concealed && value === expected;
  // Only tint when the cell isn't hidden — showing the grade class on a masked
  // cell would leak that it's a weak/strong form before the answer is given.
  if (!masked && gradeInfo && isWeakGrade(value, gradeInfo.pattern, gradeInfo.strongCStem)) {
    td.classList.add("infl-weak");
  }
  if (masked) {
    td.classList.add("infl-masked");
    td.textContent = "•••";
    td.title = "hidden until you answer";
  } else {
    td.textContent = value;
  }
  return td;
}

function inflectionTableSkeleton(headers) {
  const table = document.createElement("table");
  table.className = "infl-table";
  const thead = document.createElement("thead");
  const tr = document.createElement("tr");
  for (const h of headers) {
    const th = document.createElement("th");
    th.textContent = h;
    tr.appendChild(th);
  }
  thead.appendChild(tr);
  table.appendChild(thead);
  const tbody = document.createElement("tbody");
  table.appendChild(tbody);
  return { table, tbody };
}

function buildNounTable(word, currentKey, expected, concealed) {
  const { table, tbody } = inflectionTableSkeleton(["", "Singular", "Plural"]);
  const gradePat  = detectNounGradation(word);
  const strongCStem = gradePat
    ? (word.inflections?.nominative_singular || word.word).replace(/[aäoeöuyi]+$/, "")
    : null;
  const gradeInfo = gradePat ? { pattern: gradePat, strongCStem } : null;
  for (const c of state.cfg.nounCases.cases) {
    const sg = word.inflections[`${c.id}_singular`];
    const pl = word.inflections[`${c.id}_plural`];
    if (!sg && !pl) continue;
    const tr = document.createElement("tr");
    const th = document.createElement("th");
    th.scope = "row";
    th.textContent = c.label;
    tr.appendChild(th);
    tr.appendChild(inflectionCell(sg, `${c.id}_singular`, currentKey, expected, concealed, gradeInfo));
    tr.appendChild(inflectionCell(pl, `${c.id}_plural`,   currentKey, expected, concealed, gradeInfo));
    tbody.appendChild(tr);
  }
  return table;
}

// Conventional Finnish conjugation layout: one table per tense/mood with
// pronoun rows + a passive row, positive and negative columns. Participles
// and infinitives don't fit that grid, so they land in a flat list at the end.
const VERB_TABLE_PRONOUNS = {
  "1sg": "minä", "2sg": "sinä", "3sg": "hän",
  "1pl": "me",   "2pl": "te",   "3pl": "he",
  passive: "passive",
};

function buildVerbTables(container, word, currentKey, expected, concealed) {
  const gradePat    = detectVerbGradation(word);
  const strongCStem = gradePat
    ? word.word.replace(/[aäoeöuyi]+$/, "")
    : null;
  const gradeInfo = gradePat ? { pattern: gradePat, strongCStem } : null;
  const byTense = new Map(); // tenseId → { rowId → { positive: key, negative: key } }
  const nonFinite = [];
  for (const k of Object.keys(word.inflections || {})) {
    const p = parseVerbKey(k);
    if (p.kind !== "finite") { nonFinite.push(k); continue; }
    let rows = byTense.get(p.tense);
    if (!rows) { rows = {}; byTense.set(p.tense, rows); }
    const rowId = p.person || "passive"; // passive forms carry no person
    const slot = rows[rowId] || (rows[rowId] = {});
    slot[p.polarity] = k;
  }

  const rowOrder = [...state.cfg.verbForms.persons.map((p) => p.id), "passive"];
  for (const tense of state.cfg.verbForms.tenses) {
    const rows = byTense.get(tense.id);
    if (!rows) continue;
    const h = document.createElement("h3");
    h.textContent = tense.label;
    container.appendChild(h);
    const { table, tbody } = inflectionTableSkeleton(["", "Positive", "Negative"]);
    for (const rowId of rowOrder) {
      const slot = rows[rowId];
      if (!slot) continue;
      const tr = document.createElement("tr");
      const th = document.createElement("th");
      th.scope = "row";
      th.textContent = VERB_TABLE_PRONOUNS[rowId] || rowId;
      tr.appendChild(th);
      tr.appendChild(inflectionCell(
        word.inflections[slot.positive], slot.positive, currentKey, expected, concealed, gradeInfo));
      tr.appendChild(inflectionCell(
        word.inflections[slot.negative], slot.negative, currentKey, expected, concealed, gradeInfo));
      tbody.appendChild(tr);
    }
    container.appendChild(table);
  }

  if (nonFinite.length > 0) {
    const h = document.createElement("h3");
    h.textContent = "participles & infinitives";
    container.appendChild(h);
    const { table, tbody } = inflectionTableSkeleton(["", "Form"]);
    for (const k of nonFinite) {
      const tr = document.createElement("tr");
      const th = document.createElement("th");
      th.scope = "row";
      th.textContent = verbLabel(k, state.cfg);
      tr.appendChild(th);
      tr.appendChild(inflectionCell(word.inflections[k], k, currentKey, expected, concealed, gradeInfo));
      tbody.appendChild(tr);
    }
    container.appendChild(table);
  }
}

// ---------- presets ----------
// Save / apply / delete named filter configurations, scoped to the current
// mode. Presets capture only the filter state — they deliberately don't
// touch app-wide settings (theme, priority mode, etc.), which live under
// Options and should stay stable across presets.

function currentFilters() {
  return state.mode === "noun" ? state.nounFilters : state.verbFilters;
}

// Re-render the list for whichever mode is currently active. Cheap enough
// (DOM rebuild, not diff) that we just nuke and rebuild on every change.
function renderPresets() {
  if (!el.presetList) return;
  el.presetList.innerHTML = "";
  const names = listNames(state.presets, state.mode);
  if (names.length === 0) {
    const empty = document.createElement("li");
    empty.className = "preset-empty";
    empty.textContent = "No saved presets yet. Configure filters above and click Save.";
    el.presetList.appendChild(empty);
    return;
  }
  for (const name of names) {
    el.presetList.appendChild(buildPresetRow(name));
  }
}

function buildPresetRow(name) {
  const li = document.createElement("li");
  li.className = "preset-row";

  const apply = document.createElement("button");
  apply.type = "button";
  apply.className = "preset-apply";
  apply.textContent = name;
  apply.title = `Apply preset "${name}"`;
  apply.addEventListener("click", () => applyPreset(name));
  li.appendChild(apply);

  const del = document.createElement("button");
  del.type = "button";
  del.className = "preset-delete";
  del.title = `Delete preset "${name}"`;
  del.setAttribute("aria-label", `Delete preset ${name}`);
  del.textContent = "\u2715"; // ✕
  del.addEventListener("click", (e) => {
    e.stopPropagation();
    removePreset(name);
  });
  li.appendChild(del);

  return li;
}

function applyPreset(name) {
  const snap = getPreset(state.presets, state.mode, name);
  if (!snap) return;
  // Replace filter state wholesale and persist, then re-render the filter
  // panel so the checkboxes reflect the new values. rebuildPool() picks up
  // the change and surfaces a fresh challenge.
  if (state.mode === "noun") {
    state.nounFilters = snap;
    saveNounFilters(state.nounFilters);
    renderNounFilters(el.filtersNoun, state.cfg, state.nounFilters, (newState) => {
      saveNounFilters(newState);
      rebuildPool({ suppressFocus: true });
    });
  } else {
    state.verbFilters = snap;
    saveVerbFilters(state.verbFilters);
    renderVerbFilters(el.filtersVerb, state.cfg, state.verbFilters, (newState) => {
      saveVerbFilters(newState);
      rebuildPool({ suppressFocus: true });
    });
  }
  // Applying a preset is a deliberate click, but it's the preset row the user
  // touched — not the answer input. Respect that on mobile so we don't scroll
  // them away from the presets list.
  rebuildPool({ suppressFocus: true });
}

function saveCurrentAsPreset() {
  // Prompt for a name. If the name is already taken, confirm before
  // overwriting — otherwise a typo could silently clobber a good preset.
  const raw = window.prompt("Save current filters as preset. Name:");
  if (raw === null) return; // user cancelled
  const name = raw.trim();
  if (!name) return;
  const existing = listNames(state.presets, state.mode);
  if (existing.includes(name)) {
    if (!confirm(`Preset "${name}" already exists. Overwrite it?`)) return;
  }
  upsertPreset(state.presets, state.mode, name, currentFilters());
  savePresets(state.presets);
  renderPresets();
}

function removePreset(name) {
  if (!confirm(`Delete preset "${name}"?`)) return;
  deletePreset(state.presets, state.mode, name);
  savePresets(state.presets);
  renderPresets();
}

// ---------- KPT reference modal ----------

function openKptModal() {
  if (el.kptBody.childElementCount === 0) renderKptTable();
  el.kptModal.classList.remove("hidden");
}

function closeKptModal() {
  el.kptModal.classList.add("hidden");
}

function renderKptTable() {
  const table = document.createElement("table");
  table.className = "infl-table kpt-table";
  const thead = document.createElement("thead");
  const hr = document.createElement("tr");
  for (const h of ["Strong", "Weak", "Noun (nom / gen)", "Verb (inf / 1sg)"]) {
    const th = document.createElement("th");
    th.textContent = h;
    hr.appendChild(th);
  }
  thead.appendChild(hr);
  table.appendChild(thead);
  const tbody = document.createElement("tbody");
  for (const p of GRADE_PATTERNS) {
    const tr = document.createElement("tr");
    const tdS = document.createElement("td");
    tdS.textContent = p.strong;
    tdS.className = "kpt-strong";
    const tdW = document.createElement("td");
    tdW.textContent = p.weak || "–";
    tdW.className = "kpt-weak";
    const tdN = document.createElement("td");
    tdN.textContent = p.nounEx;
    const tdV = document.createElement("td");
    tdV.textContent = p.verbEx;
    tr.append(tdS, tdW, tdN, tdV);
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  el.kptBody.appendChild(table);
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
    state.schedule    = loadSchedule();
    state.presets     = loadPresets();
    state.streak      = checkStreakExpired(loadStreak());
    saveStreak(state.streak); // persist any expiry reset immediately
    renderStreak();
    state.blitzStats  = loadBlitzStats();

    // Theme: the inline script in <head> already applied the persisted value
    // pre-paint. Here we just sync the segmented control and subscribe to OS
    // changes for the "system" case.
    applyTheme(state.settings.theme);
    renderThemeSwitch();
    watchSystemTheme(() => state.settings.theme);

    renderNounFilters(el.filtersNoun, cfg, state.nounFilters, (newState) => {
      saveNounFilters(newState);
      if (state.mode === "noun") rebuildPool({ suppressFocus: true });
    });
    renderVerbFilters(el.filtersVerb, cfg, state.verbFilters, (newState) => {
      saveVerbFilters(newState);
      if (state.mode === "verb") rebuildPool({ suppressFocus: true });
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

    // Challenge-selection mode: Random / Focus misses / Spaced repetition.
    // None of these rebuild the pool — they only change which item we pick
    // from it next. The cap select and reset button only make sense in SRS
    // mode, so we hide them in the other modes.
    renderPrioritySwitch();
    updateSrsControlsVisibility();
    el.settingPriority.addEventListener("click", (e) => {
      const btn = e.target.closest(".seg-btn");
      if (!btn) return;
      const value = btn.dataset.value;
      if (!value || value === state.settings.priorityMode) return;
      state.settings.priorityMode = value;
      saveSettings(state.settings);
      renderPrioritySwitch();
      updateSrsControlsVisibility();
    });

    el.settingSrsCap.value = state.settings.srsCap;
    el.settingSrsCap.addEventListener("change", () => {
      state.settings.srsCap = el.settingSrsCap.value;
      saveSettings(state.settings);
    });

    el.settingSrsReset.addEventListener("click", () => {
      if (confirm("Reset the spaced-repetition schedule? Every form will be treated as new again. This does not affect your statistics.")) {
        state.schedule = resetSchedule();
      }
    });

    // Haptic feedback
    el.settingHaptic.checked = state.settings.hapticFeedback;
    el.settingHaptic.addEventListener("change", () => {
      state.settings.hapticFeedback = el.settingHaptic.checked;
      saveSettings(state.settings);
    });

    // Streak visibility — opt-in for new users, grandfathered on for existing
    // ones via loadSettings. Toggle re-renders the badge so the change is
    // instant; no reload needed.
    el.settingShowStreak.checked = state.settings.showStreak;
    el.settingShowStreak.addEventListener("change", () => {
      state.settings.showStreak = el.settingShowStreak.checked;
      saveSettings(state.settings);
      renderStreak();
    });

    // Blitz visibility — the launch button can be hidden entirely for users
    // who aren't interested in gamified layers. Default is on (unlike streak,
    // which is passive and always visible) because the button is inert until
    // clicked.
    el.settingShowBlitz.checked = state.settings.showBlitz !== false;
    applyShowBlitz();
    el.settingShowBlitz.addEventListener("change", () => {
      state.settings.showBlitz = el.settingShowBlitz.checked;
      saveSettings(state.settings);
      applyShowBlitz();
    });

    // Frequency cap — select reflects saved value; change rebuilds the pool.
    el.settingFreqCap.value = String(state.settings.frequencyCap);
    el.settingFreqCap.addEventListener("change", () => {
      const n = parseInt(el.settingFreqCap.value, 10) || 0;
      state.settings.frequencyCap = n;
      saveSettings(state.settings);
      rebuildPool();
    });

    // Test mode — launch button + start modal + cancel + result modal.
    el.testLength.value = String(state.settings.testLength);
    el.testOpen.addEventListener("click", openTestModal);
    el.testStartCancel.addEventListener("click", closeTestStartModal);
    el.testStartGo.addEventListener("click", () => startTest());
    // Enter inside the questions input starts the test, so users on a
    // keyboard don't have to mouse over to the Start button.
    el.testLength.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); startTest(); }
    });
    // Backdrop click cancels the start modal.
    el.testStartModal.addEventListener("click", (e) => {
      if (e.target === el.testStartModal) closeTestStartModal();
    });
    el.testCancel.addEventListener("click", () => {
      if (confirm("Cancel the current test? Answers so far will be discarded.")) {
        cancelTest();
      }
    });
    el.testResultAgain.addEventListener("click", playTestAgain);
    el.testResultDone.addEventListener("click", closeTestResult);
    el.testResultModal.addEventListener("click", (e) => {
      if (e.target === el.testResultModal) closeTestResult();
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

    // Presets — save button + list. The list re-renders whenever the mode
    // changes (via setMode → setView path), since it's scoped per mode.
    el.presetSave.addEventListener("click", () => saveCurrentAsPreset());
    renderPresets();

    el.modeNoun.addEventListener("click",    () => setMode("noun"));
    el.modeVerb.addEventListener("click",    () => setMode("verb"));
    // Leaving the drill view during an active blitz round would orphan the
    // timer; leaving during an active test would orphan its progress strip.
    // Confirm and tear down whichever is running before letting the user wander.
    el.modeOptions.addEventListener("click", () => {
      if (!leaveDrillGuard()) return;
      setView("options");
    });
    el.modeAbout.addEventListener("click",   () => {
      if (!leaveDrillGuard()) return;
      setView("about");
    });

    // Theme segmented control
    el.themeSwitch.addEventListener("click", (e) => {
      const btn = e.target.closest(".seg-btn");
      if (!btn) return;
      const value = btn.dataset.value;
      if (!value || value === state.settings.theme) return;
      state.settings.theme = value;
      saveSettings(state.settings);
      applyTheme(value);
      renderThemeSwitch();
    });

    // Stats export / import — JSON files you can move between devices.
    el.exportStats.addEventListener("click", () => exportStats());
    el.importStatsBtn.addEventListener("click", () => el.importStatsFile.click());
    el.importStatsFile.addEventListener("change", (e) => {
      const file = e.target.files && e.target.files[0];
      if (file) importStats(file);
      el.importStatsFile.value = "";
    });

    el.hintLetter.addEventListener("click", revealNextLetter);
    el.hintAnswer.addEventListener("click", showFullAnswer);
    el.skip.addEventListener("click", skipChallenge);

    // Drill style: Standard / Cloze segmented control above the challenge.
    renderDrillStyleSwitch();
    updateAnswerPlaceholder();
    el.drillStyleSwitch.addEventListener("click", (e) => {
      const btn = e.target.closest(".seg-btn");
      if (!btn) return;
      setDrillStyle(btn.dataset.value);
    });

    // KPT reference modal.
    el.kptOpen.addEventListener("click", openKptModal);
    el.kptClose.addEventListener("click", closeKptModal);
    el.kptModal.addEventListener("click", (e) => {
      if (e.target === el.kptModal) closeKptModal();
    });

    // Full inflection table — opened by tapping the headword.
    el.headword.addEventListener("click", openInflectionTable);
    el.inflectionClose.addEventListener("click", closeInflectionTable);
    el.inflectionModal.addEventListener("click", (e) => {
      if (e.target === el.inflectionModal) closeInflectionTable();
    });

    // Blitz: launch button + duration picker + start/cancel + result actions.
    el.blitzOpen.addEventListener("click", openBlitzModal);
    el.blitzDurationPicker.addEventListener("click", (e) => {
      const btn = e.target.closest(".seg-btn");
      if (!btn) return;
      const d = Number(btn.dataset.duration);
      if (!BLITZ_DURATIONS.includes(d)) return;
      setBlitzDurationSelection(d);
      renderBlitzStartBest(d);
    });
    el.blitzStartCancel.addEventListener("click", closeBlitzStartModal);
    el.blitzStartGo.addEventListener("click", startBlitz);
    // Clicking the modal backdrop (but not the inner card) also cancels.
    el.blitzStartModal.addEventListener("click", (e) => {
      if (e.target === el.blitzStartModal) closeBlitzStartModal();
    });

    el.blitzResultShare.addEventListener("click", shareBlitzResult);
    el.blitzResultAgain.addEventListener("click", playBlitzAgain);
    el.blitzResultDone.addEventListener("click", closeBlitzResult);
    el.blitzResultModal.addEventListener("click", (e) => {
      if (e.target === el.blitzResultModal) closeBlitzResult();
    });

    // Keyboard: Esc cancels the start modal; during an active round it
    // cancels the round entirely. Not bound to Enter inside the start modal
    // because the answer input already eats Enter as submit, and we don't
    // want the picker to steal focus from there.
    document.addEventListener("keydown", (e) => {
      if (e.key !== "Escape") return;
      if (!el.kptModal.classList.contains("hidden")) {
        closeKptModal();
      } else if (!el.inflectionModal.classList.contains("hidden")) {
        closeInflectionTable();
      } else if (!el.blitzStartModal.classList.contains("hidden")) {
        closeBlitzStartModal();
      } else if (!el.testStartModal.classList.contains("hidden")) {
        closeTestStartModal();
      } else if (!el.testResultModal.classList.contains("hidden")) {
        closeTestResult();
      } else if (blitzActive()) {
        if (confirm("Cancel the current Blitz round?")) cancelBlitz();
      } else if (!el.blitzResultModal.classList.contains("hidden")) {
        closeBlitzResult();
      }
    });

    // Rection keyboard support: the answer input is hidden in this style, so
    // its keydown handler never fires. 1–4 pick a choice, Enter advances once
    // the challenge is resolved, "-" skips. Skipped while typing in any other
    // control or while a modal is up.
    document.addEventListener("keydown", (e) => {
      if (!rectionActive() || state.view !== "drill" || !state.current) return;
      const t = e.target;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT")) return;
      if (!el.inflectionModal.classList.contains("hidden")) return;
      if (e.key === "Enter") {
        if (state.awaitingNext) { e.preventDefault(); newChallenge(); }
        return;
      }
      if (e.key === "-") { e.preventDefault(); skipChallenge(); return; }
      if (e.key >= "1" && e.key <= "4") {
        const btn = el.rectionChoices.querySelectorAll(".rection-choice")[Number(e.key) - 1];
        if (btn && !btn.disabled) { e.preventDefault(); btn.click(); }
      }
    });

    // On-screen submit button — same path as Enter. Mousedown-preventDefault
    // keeps focus in the answer input so the mobile keyboard doesn't dismiss.
    if (el.submitAnswer) {
      el.submitAnswer.addEventListener("mousedown", (e) => e.preventDefault());
      el.submitAnswer.addEventListener("click", () => {
        submit();
        if (state.view === "drill") el.answer.focus();
      });
    }

    el.answer.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); submit();            return; }
      if (e.key === ";")     { e.preventDefault(); revealNextLetter();  return; }
      if (e.key === "-")     { e.preventDefault(); skipChallenge();     return; }
      if (e.key === ".")     { e.preventDefault(); showFullAnswer();    return; }
      // No shortcut for speak-answer: Finnish uses ' in words like raa'an,
      // so we must let the apostrophe key type. Click the Speak button instead.
    });

    setMode("noun");
  } catch (err) {
    setStatus(`Error: ${err.message}`);
    console.error(err);
  }
}

boot();

// ---------- stats export / import ----------
// Stats live in localStorage, which is per-device and per-browser. Exporting
// lets you back them up or move them to another device; importing replaces
// the current stats wholesale. We also bundle settings so the whole user
// state travels together.

function exportStats() {
  const payload = {
    app: "finnish-inflection-drill",
    version: APP_VERSION,
    schemaVersion: EXPORT_SCHEMA,
    exportedAt: new Date().toISOString(),
    stats: state.stats,
    settings: state.settings,
    streak: state.streak,
    schedule: state.schedule,
    presets: state.presets,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const stamp = new Date().toISOString().slice(0, 10);
  a.href = url;
  a.download = `finnish-drill-stats-${stamp}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  setImportFeedback("Exported stats.", "ok");
}

async function importStats(file) {
  try {
    const text = await file.text();
    const data = JSON.parse(text);
    if (!data || data.app !== "finnish-inflection-drill" || !data.stats) {
      throw new Error("file doesn't look like a drill export");
    }
    // Schema check. Files missing the field are assumed to be pre-1.0
    // exports (schema 1 shape, just without the stamp). Anything newer than
    // we know about gets rejected rather than silently half-imported.
    const schemaVersion = typeof data.schemaVersion === "number" ? data.schemaVersion : 1;
    if (schemaVersion > EXPORT_SCHEMA) {
      throw new Error(
        `export is from a newer schema (v${schemaVersion}) than this app understands (v${EXPORT_SCHEMA}). ` +
        `Update the app and try again.`
      );
    }
    if (!confirm("Replace your current stats with the imported data? This cannot be undone.")) {
      setImportFeedback("Import cancelled.", "");
      return;
    }
    state.stats = data.stats;
    saveStats(state.stats);
    if (data.settings) {
      state.settings = { ...state.settings, ...data.settings };
      // Legacy imports might still carry weightedSampling; translate it the
      // same way loadSettings() does so the UI below shows the right state.
      if (Object.prototype.hasOwnProperty.call(data.settings, "weightedSampling") &&
          !Object.prototype.hasOwnProperty.call(data.settings, "priorityMode")) {
        state.settings.priorityMode = data.settings.weightedSampling ? "srs" : "uniform";
      }
      delete state.settings.weightedSampling;
      saveSettings(state.settings);
      // Reflect any changed UI-bound settings immediately.
      el.settingRequire.checked     = state.settings.requireCorrect;
      el.settingAutoplay.checked    = state.settings.autoPlayAudio;
      el.settingExcludeLong.checked = state.settings.excludeLong;
      el.settingMaxLength.value     = String(state.settings.maxAnswerLength);
      el.settingSrsCap.value        = state.settings.srsCap;
      el.settingHaptic.checked      = state.settings.hapticFeedback;
      el.settingShowStreak.checked  = state.settings.showStreak;
      el.settingShowBlitz.checked   = state.settings.showBlitz !== false;
      applyShowBlitz();
      el.settingFreqCap.value       = String(state.settings.frequencyCap);
      el.testLength.value           = String(state.settings.testLength);
      renderPrioritySwitch();
      updateSrsControlsVisibility();
      applyTheme(state.settings.theme);
      renderThemeSwitch();
      renderDrillStyleSwitch();
      updateAnswerPlaceholder();
      applyRectionChrome();
    }
    if (data.schedule && data.schedule.byItem) {
      state.schedule = { byItem: data.schedule.byItem };
      saveSchedule(state.schedule);
    }
    if (data.presets && (data.presets.noun || data.presets.verb)) {
      state.presets = {
        noun: data.presets.noun || {},
        verb: data.presets.verb || {},
      };
      savePresets(state.presets);
      renderPresets();
    }
    if (data.streak) {
      state.streak = checkStreakExpired({ ...state.streak, ...data.streak });
      saveStreak(state.streak);
      renderStreak();
    }
    refreshStatsPanel();
    rebuildPool();
    setImportFeedback(`Imported stats (exported ${data.exportedAt || "earlier"}).`, "ok");
  } catch (err) {
    setImportFeedback(`Import failed: ${err.message}`, "bad");
  }
}

function setImportFeedback(text, cls) {
  if (!el.importFeedback) return;
  el.importFeedback.textContent = text;
  el.importFeedback.className = "import-feedback" + (cls ? " " + cls : "");
}

// Register the service worker so the app is installable and works offline.
// We don't await this — it's a fire-and-forget side effect, and if it fails
// the app still works, just without caching.
//
// We also attach the update-banner plumbing here: when the browser detects
// a new sw.js on the server, it installs it as the "waiting" worker. Without
// this, the user has to refresh twice to pick up the new version (first
// refresh loads the cached old shell, second refresh gets the new one). The
// banner bridges that gap — one click and the page reloads onto the new SW.
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    // Wire controllerchange BEFORE registration so it's ready before any
    // SKIP_WAITING message can be sent.
    let swRefreshing = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (swRefreshing) return;
      swRefreshing = true;
      location.reload();
    });

    navigator.serviceWorker.register("sw.js")
      .then((reg) => {
        // A new SW is already waiting (e.g. installed on a previous visit).
        // Apply it immediately on load — no banner needed.
        if (reg.waiting) {
          reg.waiting.postMessage({ type: "SKIP_WAITING" });
          return;
        }
        wireUpdateBanner(reg);
      })
      .catch((err) => {
        console.warn("Service worker registration failed:", err);
      });
  });
}

function wireUpdateBanner(reg) {
  const banner  = document.getElementById("update-banner");
  const reload  = document.getElementById("update-banner-reload");
  const dismiss = document.getElementById("update-banner-dismiss");
  if (!banner || !reload || !dismiss) return;

  const show = () => banner.classList.remove("hidden");
  const hide = () => banner.classList.add("hidden");

  function applyUpdate() {
    if (reg.waiting) reg.waiting.postMessage({ type: "SKIP_WAITING" });
    else location.reload();
  }

  // Background update: new SW finished installing — show banner.
  // Drop the navigator.serviceWorker.controller guard so this works
  // even if the page was loaded via hard-refresh (controller is null then).
  reg.addEventListener("updatefound", () => {
    const nw = reg.installing;
    if (!nw) return;
    nw.addEventListener("statechange", () => {
      if (nw.state === "installed") show();
    });
  });

  reload.addEventListener("click", applyUpdate);
  dismiss.addEventListener("click", hide);

  // Version badge: explicit check — apply immediately without banner.
  if (el.appVersion) {
    el.appVersion.addEventListener("click", () => {
      const orig = el.appVersion.textContent;
      if (orig === "checking…") return;

      if (reg.waiting) { applyUpdate(); return; }

      el.appVersion.textContent = "checking…";
      let applied = false;

      const onUpdateFound = () => {
        const nw = reg.installing;
        if (!nw) return;
        nw.addEventListener("statechange", () => {
          if (nw.state === "installed" && !applied) {
            applied = true;
            applyUpdate();
          }
        });
      };
      reg.addEventListener("updatefound", onUpdateFound, { once: true });

      reg.update()
        .then(() => setTimeout(() => {
          reg.removeEventListener("updatefound", onUpdateFound);
          if (!applied) el.appVersion.textContent = orig;
        }, 4000))
        .catch(() => {
          reg.removeEventListener("updatefound", onUpdateFound);
          el.appVersion.textContent = orig;
        });
    });
  }
}
