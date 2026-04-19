// Thin wrapper over the browser SpeechSynthesis API, locked to a Finnish voice.
//
// Browser quirks handled here:
//   - getVoices() is often empty on first call; it populates asynchronously,
//     so we wait for the `voiceschanged` event (with a timeout fallback).
//   - Some platforms list a voice as "fi-FI" but others as "fi". We pick
//     anything whose lang starts with "fi".
//   - Calling speak() while a previous utterance is still going can queue or
//     drop — we cancel the queue first so the latest request always wins.

let _voicePromise = null;

function findFinnishVoice(voices) {
  // Prefer voices whose lang is fi/fi-FI. If multiple, prefer one flagged as
  // default, then the first.
  const fi = voices.filter((v) => (v.lang || "").toLowerCase().startsWith("fi"));
  if (fi.length === 0) return null;
  return fi.find((v) => v.default) || fi[0];
}

function loadVoice() {
  if (_voicePromise) return _voicePromise;
  _voicePromise = new Promise((resolve) => {
    if (!("speechSynthesis" in window)) { resolve(null); return; }

    const tryNow = () => {
      const voices = window.speechSynthesis.getVoices();
      if (voices && voices.length) return findFinnishVoice(voices);
      return null;
    };

    const immediate = tryNow();
    if (immediate !== null) { resolve(immediate); return; }

    // Wait for voices to load, but don't hang forever — Chromium will fire
    // voiceschanged once; other browsers may not fire at all if there's no
    // voice to report.
    const onChange = () => {
      const v = tryNow();
      window.speechSynthesis.removeEventListener("voiceschanged", onChange);
      resolve(v);
    };
    window.speechSynthesis.addEventListener("voiceschanged", onChange);
    setTimeout(() => {
      window.speechSynthesis.removeEventListener("voiceschanged", onChange);
      resolve(tryNow());
    }, 2000);
  });
  return _voicePromise;
}

export async function ttsAvailable() {
  const v = await loadVoice();
  return !!v;
}

export async function speak(text) {
  if (!text) return;
  if (!("speechSynthesis" in window)) return;
  const voice = await loadVoice();
  if (!voice) return;
  // Cancel anything currently in-flight so rapid-fire clicks don't stack up.
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.voice = voice;
  u.lang = voice.lang || "fi-FI";
  u.rate = 0.95;  // a hair slower than default — easier to catch inflection endings
  window.speechSynthesis.speak(u);
}

export function cancelSpeech() {
  if ("speechSynthesis" in window) window.speechSynthesis.cancel();
}
