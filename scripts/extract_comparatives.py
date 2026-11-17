"""
Build data/comparatives.json from the kaikki.org Finnish Wiktionary extract.

Finnish adjectives have two degree forms, and both decline through every case:
  iso  → isompi  (comparative)  → isommassa, isompaa, isommat, ...
       → isoin   (superlative)  → isoimmassa, isointa, isoimmat, ...

Each adjective entry in kaikki carries its degree forms on the headword line,
tagged ["comparative"] / ["superlative"]. Their declension comes from one of
two places:
  1. The degree form's own Wiktionary entry, when it has one (isompi, paras,
     kaunein...). Real tables always win — this is how irregulars like
     hyvä → paras (parhaan, parasta) come out right.
  2. Otherwise, composition. Comparatives (-mpi, KOTUS type 16 "vanhempi")
     and superlatives (-in, type 36 "sisin") decline completely regularly
     from the nominative, so the paradigm is built by suffix. Same approach
     as gen_compound_numerals.py.

Only adjectives already in data/nouns.json are included (adjectives are
merged into the noun pool by extract.py, so that list is already
frequency-filtered and blocklisted at load time).

Requires:
  scripts/raw/kaikki_finnish.jsonl  — from download.py
  data/nouns.json                   — from extract.py

Run: python scripts/extract_comparatives.py
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from extract import shape_noun, extract_translations  # noqa: E402  (reuse the noun parsers)

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
RAW = ROOT / "scripts" / "raw" / "kaikki_finnish.jsonl"

DEGREES = ("comparative", "superlative")

# A real table needs most of the paradigm to be worth preferring over the
# composed one (a stub entry with three forms shouldn't win).
MIN_REAL_KEYS = 20

# Archaic -hin superlatives (parahin, kaunehin, rakkahin) — poetic register,
# never accepted as alternatives. Wiktionary lists them after the standard
# form, so only non-first forms are checked: a first form like pahin or
# köyhin has the same shape but is the regular superlative of an h-stem.
ARCHAIC_SUPERLATIVE = re.compile(r"[aeiouyäö]hin$")

# Suffixes after the stem, back-vowel spelling; "a" flips to "ä" for front
# harmony. Key set matches data/nouns.json (26 slots).
COMPARATIVE_ENDINGS = {
    "nominative_singular":  "mpi",
    "genitive_singular":    "mman",
    "partitive_singular":   "mpaa",
    "inessive_singular":    "mmassa",
    "elative_singular":     "mmasta",
    "illative_singular":    "mpaan",
    "adessive_singular":    "mmalla",
    "ablative_singular":    "mmalta",
    "allative_singular":    "mmalle",
    "essive_singular":      "mpana",
    "translative_singular": "mmaksi",
    "abessive_singular":    "mmatta",
    "nominative_plural":    "mmat",
    "genitive_plural":      "mpien",
    "partitive_plural":     "mpia",
    "inessive_plural":      "mmissa",
    "elative_plural":       "mmista",
    "illative_plural":      "mpiin",
    "adessive_plural":      "mmilla",
    "ablative_plural":      "mmilta",
    "allative_plural":      "mmille",
    "essive_plural":        "mpina",
    "translative_plural":   "mmiksi",
    "abessive_plural":      "mmitta",
    "instructive_plural":   "mmin",
    "comitative_plural":    "mpine",
}
# Superlative = stem + "i" + the comparative endings, except the nominative
# and partitive singular, which use the short -in / -inta forms.
SUPERLATIVE_OVERRIDES = {
    "nominative_singular": "in",
    "partitive_singular":  "inta",
}


def front_harmony(base_word: str, base_inflections: dict[str, str], stem: str) -> bool:
    """True if the degree form's suffixes take ä/ö/y.

    A degree form keeps its base adjective's harmony, read off the base's
    partitive singular. That handles compounds (mustan|kipeä → front) and
    neutral stems (kiva → kivempi → kivempaa; pitkä → pidempi → pidempää),
    which a vowel scan of the form would get wrong.

    Suppletive forms don't share the base's stem, so they go by their own
    vowels instead: hyvä → parempi → paremmassa (back), paljo → enempi →
    enemmän (neutral → front).
    """
    if stem.startswith(base_word[:2]):
        part = base_inflections.get("partitive_singular", "")
        if part.endswith("ä"):
            return True
        if part.endswith("a"):
            return False
    for ch in reversed(stem):
        if ch in "aou":
            return False
        if ch in "äöy":
            return True
    return True


def harmonize(suffix: str, front: bool) -> str:
    return suffix.replace("a", "ä") if front else suffix


def compose(degree: str, form: str, front: bool) -> dict[str, str] | None:
    """Regular paradigm for a degree form, or None if it isn't regular."""
    if degree == "comparative":
        if not form.endswith("mpi"):
            return None
        stem = form[:-3]
        return {k: stem + harmonize(s, front) for k, s in COMPARATIVE_ENDINGS.items()}
    if not form.endswith("in"):
        return None
    stem = form[:-2]
    out = {}
    for k, s in COMPARATIVE_ENDINGS.items():
        out[k] = stem + harmonize(SUPERLATIVE_OVERRIDES.get(k, "i" + s), front)
    return out


def degree_forms(entry: dict) -> dict[str, list[str]]:
    """{"comparative": [...], "superlative": [...]} from the headword line, in
    Wiktionary's order (the first is the standard form)."""
    out: dict[str, list[str]] = {d: [] for d in DEGREES}
    for f in entry.get("forms") or []:
        tags = set(f.get("tags") or [])
        s = f.get("form")
        if not s or s in ("-", "—") or " " in s:
            continue
        for d in DEGREES:
            if d in tags and s not in out[d]:
                if d == "superlative" and out[d] and ARCHAIC_SUPERLATIVE.search(s):
                    continue
                out[d].append(s)
    return out


def is_degree_entry(entry: dict) -> bool:
    glosses = " ".join(g for s in entry.get("senses") or [] for g in s.get("glosses") or [])
    return bool(re.search(r"\b(comparative|superlative)\b", glosses, re.I))


def main() -> int:
    if not RAW.exists():
        raise SystemExit(f"Missing {RAW}. Run scripts/download.py first.")
    nouns_path = DATA / "nouns.json"
    if not nouns_path.exists():
        raise SystemExit("Missing data/nouns.json. Run scripts/extract.py first.")

    nouns_data = json.loads(nouns_path.read_text(encoding="utf-8"))
    noun_by_word = {w["word"]: w for w in nouns_data["words"]}
    print(f"Loaded {len(noun_by_word):,} words from data/nouns.json")

    # One pass over the dump collects both halves:
    #   bases  — adjectives in our pool with their degree forms
    #   tables — real declension tables of every adjective entry, so degree
    #            forms with their own Wiktionary entry can use it
    bases: dict[str, dict[str, list[str]]] = {}
    # The adjective's own glosses. nouns.json keeps one entry per spelling, so
    # for noun/adjective homographs its translation may be the noun's
    # (mahti: "might, power" vs the adjective "awesome, great").
    adj_glosses: dict[str, list[str]] = {}
    tables: dict[str, dict[str, str]] = {}
    table_is_degree: dict[str, bool] = {}

    print(f"Streaming {RAW.name}...")
    with RAW.open("r", encoding="utf-8") as f:
        for line in f:
            # Cheap prefilter — json.loads on every line of a multi-GB dump
            # is the slow part, and only adjective entries matter here.
            if '"pos": "adj"' not in line:
                continue
            try:
                entry = json.loads(line)
            except json.JSONDecodeError:
                continue
            if entry.get("pos") != "adj":
                continue
            word = entry.get("word")
            if not word:
                continue

            if entry.get("inflection_templates"):
                infl = shape_noun(entry, None, "")["inflections"]
                degree_entry = is_degree_entry(entry)
                # Several entries can share a spelling; prefer the one that is
                # actually a comparative/superlative, then the fullest table.
                prev = tables.get(word)
                if (prev is None
                        or (degree_entry and not table_is_degree[word])
                        or (degree_entry == table_is_degree[word] and len(infl) > len(prev))):
                    tables[word] = infl
                    table_is_degree[word] = degree_entry

            if word in noun_by_word and word not in bases:
                forms = degree_forms(entry)
                if forms["comparative"] or forms["superlative"]:
                    bases[word] = forms
                    adj_glosses[word] = extract_translations(entry)

    print(f"Found {len(bases):,} pool adjectives with degree forms; "
          f"{len(tables):,} adjective tables indexed")

    out_words: list[dict] = []
    n_real = n_composed = n_skipped = n_harmony_fixed = 0
    for word, forms in bases.items():
        base = noun_by_word[word]
        inflections: dict[str, dict[str, str]] = {}
        alternatives: dict[str, dict[str, str]] = {}
        for degree in DEGREES:
            paradigms: list[dict[str, str]] = []
            for form in forms[degree]:
                # Harmony is judged on the stem: the -mpi / -in ending itself
                # is neutral and would tell us nothing.
                stem = form[:-3] if degree == "comparative" else form[:-2]
                front = front_harmony(word, base["inflections"], stem)
                composed = compose(degree, form, front)
                real = tables.get(form)
                if real and len(real) >= MIN_REAL_KEYS and real.get("nominative_singular") == form:
                    # Some Wiktionary degree tables were filed with the wrong
                    # harmony (pyörein → "pyöreimman", arvostetumpi →
                    # "arvostetummän"). A table that is exactly the flipped-
                    # harmony version of the composed paradigm is that bug,
                    # not an irregularity — use the composed one.
                    flipped = compose(degree, form, not front)
                    if composed and real != composed and all(
                        real.get(k) == v for k, v in flipped.items() if k in real
                    ):
                        paradigms.append(composed)
                        n_harmony_fixed += 1
                    else:
                        paradigms.append(real)
                        n_real += 1
                    continue
                if composed:
                    paradigms.append(composed)
                    n_composed += 1
                else:
                    n_skipped += 1
            if paradigms:
                inflections[degree] = paradigms[0]
                # A second standard form (pitkä → pidempi / pitempi,
                # hyvä → paras / parhain) is accepted as a correct answer.
                if len(paradigms) > 1:
                    alternatives[degree] = paradigms[1]
        if not inflections:
            continue
        entry = {
            "word":           word,
            "frequency_rank": base.get("frequency_rank"),
            "translations":   adj_glosses.get(word) or base.get("translations") or [],
            "group":          base.get("group") or "other",
            "inflections":    inflections,
        }
        if alternatives:
            entry["alternatives"] = alternatives
        out_words.append(entry)

    out_words.sort(key=lambda w: w.get("frequency_rank") or 10**9)

    payload = {
        "_source": (
            "Comparative and superlative forms from English Wiktionary Finnish "
            "adjective entries (en.wiktionary.org, via the kaikki.org extract), "
            "CC BY-SA 4.0. Regular -mpi / -in paradigms are composed where the "
            "degree form has no table of its own. Built by "
            "scripts/extract_comparatives.py."
        ),
        "degrees": list(DEGREES),
        "cases":   nouns_data["cases"],
        "numbers": nouns_data["numbers"],
        "words":   out_words,
    }
    (DATA / "comparatives.json").write_text(
        json.dumps(payload, ensure_ascii=False, indent=1), encoding="utf-8"
    )

    print(f"Wrote {len(out_words):,} adjectives to data/comparatives.json")
    print(f"  degree paradigms: {n_real:,} from Wiktionary tables, "
          f"{n_composed:,} composed, {n_harmony_fixed} Wiktionary tables with "
          f"wrong vowel harmony replaced, {n_skipped} skipped (irregular, no table)")

    sample = {"iso", "hyvä", "pitkä", "kaunis", "pieni", "uusi"}
    print("\nSanity check:")
    for w in out_words:
        if w["word"] not in sample:
            continue
        c = w["inflections"].get("comparative", {})
        s = w["inflections"].get("superlative", {})
        print(f"  {w['word']:8s} {c.get('nominative_singular','?'):12s} "
              f"{c.get('inessive_singular','?'):14s} {s.get('nominative_singular','?'):10s} "
              f"{s.get('partitive_singular','?'):12s} alts={list(w.get('alternatives', {}))}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
