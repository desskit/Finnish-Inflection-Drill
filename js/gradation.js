// Consonant gradation (KPT) patterns and detection.
//
// Finnish consonant gradation alternates between a "strong grade" (nominative
// singular, infinitive, etc.) and a "weak grade" (genitive singular, most
// oblique cases, 1sg/2sg present, etc.).
//
// Detection compares consonant stems extracted from two well-defined forms:
//   nouns: nominative_singular (strong) vs genitive_singular (weak)
//   verbs: lemma / infinitive (strong) vs present_active_positive_1sg (weak)
//
// Longer patterns are listed before shorter ones so that "pp" is tested before
// "p", preventing a false single-consonant match.

export const GRADE_PATTERNS = [
  { id: "pp_p",  strong: "pp", weak: "p",  label: "pp / p",
    nounEx: "kauppa / kaupan",  verbEx: "—"               },
  { id: "tt_t",  strong: "tt", weak: "t",  label: "tt / t",
    nounEx: "katto / katon",    verbEx: "ottaa / otan"     },
  { id: "kk_k",  strong: "kk", weak: "k",  label: "kk / k",
    nounEx: "pankki / pankin",  verbEx: "nukkua / nukun"   },
  { id: "mp_mm", strong: "mp", weak: "mm", label: "mp / mm",
    nounEx: "lampi / lammen",   verbEx: "—"                },
  { id: "nt_nn", strong: "nt", weak: "nn", label: "nt / nn",
    nounEx: "ranta / rannan",   verbEx: "antaa / annan"    },
  { id: "lt_ll", strong: "lt", weak: "ll", label: "lt / ll",
    nounEx: "kulta / kullan",   verbEx: "—"                },
  { id: "rt_rr", strong: "rt", weak: "rr", label: "rt / rr",
    nounEx: "virta / virran",   verbEx: "—"                },
  { id: "nk_ng", strong: "nk", weak: "ng", label: "nk / ng",
    nounEx: "hanko / hangon",   verbEx: "—"                },
  { id: "lk_l",  strong: "lk", weak: "l",  label: "lk / l",
    nounEx: "sulka / sulan",    verbEx: "—"                },
  { id: "rk_r",  strong: "rk", weak: "r",  label: "rk / r",
    nounEx: "torku / torun",    verbEx: "—"                },
  { id: "p_v",   strong: "p",  weak: "v",  label: "p / v",
    nounEx: "haapa / haavan",   verbEx: "—"                },
  { id: "t_d",   strong: "t",  weak: "d",  label: "t / d",
    nounEx: "tauti / taudin",   verbEx: "tietää / tiedän"  },
  { id: "k_0",   strong: "k",  weak: "",   label: "k / –",
    nounEx: "jalka / jalan",    verbEx: "—"                },
];

// Sentinel for words with no detected gradation — used as a filter dimension.
export const GRADE_NONE = { id: "none", label: "No gradation", strong: null, weak: null };

// Strip trailing vowel cluster (to get consonant stem from nominative/infinitive).
function trailingVowelStrip(s) {
  return s.replace(/[aäoeöuyi]+$/, "");
}

// Strip final -Vn (vowel + n, genitive/1sg marker) to get consonant stem.
function finalVnStrip(s) {
  return s.replace(/[aäoeöuyi]n$/, "");
}

function matchPattern(sStem, wStem) {
  if (!sStem || !wStem || sStem === wStem) return null;
  for (const pat of GRADE_PATTERNS) {
    if (!sStem.endsWith(pat.strong)) continue;
    const prefix = sStem.slice(0, sStem.length - pat.strong.length);
    if (wStem === prefix + pat.weak) return pat;
  }
  return null;
}

export function detectNounGradation(word) {
  const nom = word.inflections?.nominative_singular || word.word;
  const gen = word.inflections?.genitive_singular;
  if (!nom || !gen) return null;
  return matchPattern(trailingVowelStrip(nom), finalVnStrip(gen));
}

export function detectVerbGradation(word) {
  const inf = word.word;
  const sg1 = word.inflections?.present_active_positive_1sg;
  if (!inf || !sg1) return null;
  return matchPattern(trailingVowelStrip(inf), finalVnStrip(sg1));
}

// Return true if `form` uses the weak grade of `pattern`, given `strongCStem`
// (the consonant stem derived from the strong-grade reference form).
// Used to tint inflection-table cells.
//
// Strategy: form is weak-grade if it starts with (prefix + weakCluster) but
// NOT with (prefix + strongCluster), where prefix is the invariant part before
// the alternating consonant(s).
export function isWeakGrade(form, pattern, strongCStem) {
  if (!form || !pattern || pattern.strong === null) return false;
  const prefix = strongCStem.slice(0, strongCStem.length - pattern.strong.length);
  const wk = prefix + pattern.weak;
  const st = prefix + pattern.strong;
  return form.startsWith(wk) && !form.startsWith(st);
}
