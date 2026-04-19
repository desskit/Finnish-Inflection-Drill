// Human-readable labels for inflection keys.
//
// Inflection keys in the data look like:
//   nouns: "genitive_singular"
//   verbs: "present_active_positive_1sg"        (finite with person)
//          "present_passive_positive"           (impersonal / passive)
//          "inf3_active", "inf5_active"         (infinitives)
//          "participle_past_active"             (participles)
//
// These helpers turn those keys into pretty labels using the config files.

function byId(list, id) {
  return list.find((x) => x.id === id);
}

export function nounLabel(key, cfg) {
  const [caseId, numberId] = key.split("_");
  const c = byId(cfg.nounCases.cases, caseId);
  const n = byId(cfg.nounCases.numbers, numberId);
  const caseLabel = c ? c.label : caseId;
  const numberLabel = n ? n.label.toLowerCase() : numberId;
  return `${caseLabel} ${numberLabel}`;
}

export function verbLabel(key, cfg) {
  const parts = key.split("_");

  // Participles: "participle_<tense>_<voice>"
  if (parts[0] === "participle") {
    const [, tense, voice] = parts;
    return `${tense} ${voice} participle`;
  }

  // Infinitives: "inf1_long_<voice>", "inf2_<voice>", ... "inf5_<voice>"
  if (parts[0].startsWith("inf")) {
    const voice = parts[parts.length - 1];
    const tenseId = parts.slice(0, -1).join("_");
    const tense = byId(cfg.verbForms.tenses, tenseId);
    return `${tense ? tense.label : tenseId} (${voice})`;
  }

  // Finite: "<tense>_<voice>_<polarity>[_<person>]"
  // Tense can be a compound mood+aspect like "conditional_perfect" — take
  // two tokens when they form a known compound, otherwise one.
  const compound = new Set([
    "conditional_perfect", "imperative_perfect", "potential_perfect",
  ]);
  const twoTok = parts[0] + "_" + parts[1];
  let tenseId, rest;
  if (compound.has(twoTok)) {
    tenseId = twoTok;
    rest = parts.slice(2);
  } else {
    tenseId = parts[0];
    rest = parts.slice(1);
  }
  const [voiceId, polarityId, personId] = rest;
  const tense = byId(cfg.verbForms.tenses, tenseId);
  const voice = byId(cfg.verbForms.voices, voiceId);
  const polarity = byId(cfg.verbForms.polarities, polarityId);
  const person = personId ? byId(cfg.verbForms.persons, personId) : null;

  // "present, active, positive \u2014 min\u00e4"
  // The em-dash separates the grammatical description from the person/subject
  // so the person stays visually distinct (it's the part you actually say).
  const grammar = [
    tense ? tense.label : tenseId,
    voice ? voice.label : voiceId,
    polarity ? polarity.label : polarityId,
  ].join(", ");
  return person ? `${grammar} \u2014 ${person.label}` : grammar;
}
