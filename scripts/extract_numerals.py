"""
Build data/numerals.json from the kaikki.org Finnish Wiktionary extract.

Targets a hand-picked list of common Finnish numerals (1–10 plus sata,
tuhat, miljoona). Numerals inflect across the standard 15 cases (like
nouns); the kaikki.org data has full paradigm tables for all of them.

Exotic numeral-specific cases (superessive, delative, multiplicative, etc.)
present in the raw data are intentionally ignored — we only extract the 15
cases already used in the noun drill.

Run: python scripts/extract_numerals.py
     (requires scripts/raw/kaikki_finnish.jsonl from download.py)
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

FOOTNOTE = re.compile(r"\s*\(\*+\)|\*+$")

ROOT = Path(__file__).resolve().parent.parent
DATA   = ROOT / "data"
CONFIG = ROOT / "config"
RAW    = ROOT / "scripts" / "raw" / "kaikki_finnish.jsonl"

# Canonical list in display order; gloss used only as fallback if Wiktionary
# has no English translation for an entry.
#
# The compound cardinals (11-19, tens) can also be generated offline from the
# base paradigms by scripts/gen_compound_numerals.py — run it AFTER this
# script; it only fills in words that are missing, so Wiktionary paradigms
# extracted here always win.
NUMERALS: list[tuple[str, str]] = [
    ("nolla",     "zero"),
    ("yksi",      "one"),
    ("kaksi",     "two"),
    ("kolme",     "three"),
    ("neljä",     "four"),
    ("viisi",     "five"),
    ("kuusi",     "six"),
    ("seitsemän", "seven"),
    ("kahdeksan", "eight"),
    ("yhdeksän",  "nine"),
    ("kymmenen",  "ten"),
    ("yksitoista",        "eleven"),
    ("kaksitoista",       "twelve"),
    ("kolmetoista",       "thirteen"),
    ("neljätoista",       "fourteen"),
    ("viisitoista",       "fifteen"),
    ("kuusitoista",       "sixteen"),
    ("seitsemäntoista",   "seventeen"),
    ("kahdeksantoista",   "eighteen"),
    ("yhdeksäntoista",    "nineteen"),
    ("kaksikymmentä",     "twenty"),
    ("kolmekymmentä",     "thirty"),
    ("neljäkymmentä",     "forty"),
    ("viisikymmentä",     "fifty"),
    ("kuusikymmentä",     "sixty"),
    ("seitsemänkymmentä", "seventy"),
    ("kahdeksankymmentä", "eighty"),
    ("yhdeksänkymmentä",  "ninety"),
    ("sata",      "hundred"),
    ("tuhat",     "thousand"),
    ("miljoona",  "million"),
    ("miljardi",  "billion"),
    # Ordinals — decline like adjectives, full paradigms on Wiktionary.
    ("ensimmäinen", "first"),
    ("toinen",      "second"),
    ("kolmas",      "third"),
    ("neljäs",      "fourth"),
    ("viides",      "fifth"),
    ("kuudes",      "sixth"),
    ("seitsemäs",   "seventh"),
    ("kahdeksas",   "eighth"),
    ("yhdeksäs",    "ninth"),
    ("kymmenes",    "tenth"),
    ("sadas",       "hundredth"),
    ("tuhannes",    "thousandth"),
]
NUMERAL_WORDS   = {w for w, _ in NUMERALS}
NUMERAL_FALLBACK = {w: g for w, g in NUMERALS}

CASE_TAGS = frozenset({
    "nominative", "genitive", "partitive", "inessive", "elative", "illative",
    "adessive", "ablative", "allative", "essive", "translative", "abessive",
    "instructive", "comitative", "accusative",
})
NUMBER_TAGS = frozenset({"singular", "plural"})


def extract_inflections(entry: dict) -> dict[str, str]:
    inflections: dict[str, str] = {}
    for f in entry.get("forms") or []:
        form_str = f.get("form")
        # Wiktionary marks rare or archaic forms with a footnote ("nelin (*)");
        # the marker isn't part of the word and would end up in the answer.
        form_str = FOOTNOTE.sub("", form_str or "").strip()
        if not form_str or form_str in ("-", "—"):
            continue
        tags  = set(f.get("tags") or [])
        cases = tags & CASE_TAGS
        nums  = tags & NUMBER_TAGS
        if len(cases) == 1 and len(nums) == 1:
            key = f"{next(iter(cases))}_{next(iter(nums))}"
            if key not in inflections:
                inflections[key] = form_str
    return inflections


def extract_translations(entry: dict) -> list[str]:
    glosses: list[str] = []
    for sense in entry.get("senses") or []:
        for g in sense.get("glosses") or []:
            if isinstance(g, str) and g not in glosses:
                glosses.append(g)
    return glosses[:3]


def main() -> int:
    if not RAW.exists():
        raise SystemExit(f"Missing {RAW}. Run scripts/download.py first.")

    noun_cases_cfg = json.loads((CONFIG / "noun_cases.json").read_text(encoding="utf-8"))

    # word → best entry found so far (most inflection keys wins on tie-break)
    best: dict[str, dict] = {}

    print(f"Streaming {RAW.name}...")
    with RAW.open("r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                entry = json.loads(line)
            except json.JSONDecodeError:
                continue

            word = entry.get("word")
            if word not in NUMERAL_WORDS:
                continue
            if not entry.get("inflection_templates"):
                continue

            inflections = extract_inflections(entry)
            if not inflections:
                continue

            prev = best.get(word)
            if prev is None or len(inflections) > len(prev["inflections"]):
                trans = extract_translations(entry) or [NUMERAL_FALLBACK[word]]
                best[word] = {
                    "word":         word,
                    "translations": trans,
                    "inflections":  inflections,
                }

    # Output in canonical numeral order
    out_words: list[dict] = []
    for word, _ in NUMERALS:
        if word in best:
            out_words.append(best[word])
        else:
            print(f"[warn] {word!r} not found in kaikki data")

    payload = {
        "_source": (
            "Numeral inflection paradigms from English Wiktionary "
            "(en.wiktionary.org, via the kaikki.org extract), CC BY-SA 4.0. "
            "Parsed by scripts/extract_numerals.py."
        ),
        "cases":   [c["id"] for c in noun_cases_cfg["cases"]],
        "numbers": [n["id"] for n in noun_cases_cfg["numbers"]],
        "words":   out_words,
    }
    (DATA / "numerals.json").write_text(
        json.dumps(payload, ensure_ascii=False, indent=1), encoding="utf-8"
    )

    print(f"\nWrote {len(out_words)} numerals:")
    for w in out_words:
        nom = w["inflections"].get("nominative_singular", "?")
        gen = w["inflections"].get("genitive_singular",  "?")
        par = w["inflections"].get("partitive_singular", "?")
        print(f"  {w['word']:12s}  nom={nom:<12} gen={gen:<12} par={par}  "
              f"({len(w['inflections'])} forms)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
