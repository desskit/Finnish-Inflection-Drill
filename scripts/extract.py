"""
Build data/nouns.json and data/verbs.json from the kaikki.org Finnish Wiktionary
extract and a frequency list.

Output shape (nouns):
{
  "cases":   ["nominative", ...],        # from config/noun_cases.json
  "numbers": ["singular", "plural"],
  "words": [
    {
      "word": "kala",
      "translations": ["fish"],
      "kotus_type": 9,
      "group": "a_ae",                   # from config/noun_groups.json
      "inflections": {
        "nominative_singular": "kala",
        "genitive_singular":   "kalan",
        ...
      },
      "audio": "https://.../kala.ogg",   # or null
      "examples": [],
      "frequency_rank": 412               # or null if not in top-N
    },
    ...
  ]
}

Output shape (verbs): similar, but inflections keys are
  "<tense>_<voice>_<polarity>_<person>"   (person omitted for impersonal forms)

Run:  python scripts/extract.py
"""

from __future__ import annotations

import json
import sys
from collections import Counter
from pathlib import Path
from typing import Any, Iterable

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "scripts" / "raw"
DATA = ROOT / "data"
CONFIG = ROOT / "config"

KAIKKI_FILE = RAW / "kaikki_finnish.jsonl"
FREQ_FILE = RAW / "frequency_fi.txt"

# Keep a lemma if ANY of its inflected forms ranks within the top N of the
# frequency list. Using inflected-form ranks rather than the lemma's own rank
# lets us catch common verbs whose dictionary form is rarer than their
# conjugations (e.g. "olla" is much rarer than "on", "oli", "olen").
FREQUENCY_CUTOFF = 20000

# -------- helpers --------------------------------------------------------


def load_json(path: Path) -> Any:
    with path.open("r", encoding="utf-8") as f:
        return json.load(f)


def load_frequency() -> dict[str, int]:
    """Return {word: rank}, rank 1 = most common."""
    if not FREQ_FILE.exists():
        print(f"[warn] frequency list not found at {FREQ_FILE}; skipping freq filter")
        return {}
    ranks: dict[str, int] = {}
    with FREQ_FILE.open("r", encoding="utf-8") as f:
        for i, line in enumerate(f, start=1):
            parts = line.strip().split()
            if not parts:
                continue
            word = parts[0]
            if word not in ranks:
                ranks[word] = i
    return ranks


def load_kotus_lookups() -> tuple[dict[str, int], dict[int, str], dict[str, int], dict[int, str]]:
    """Load template → kotus_type maps, and build kotus_type → group_id maps."""
    templates = load_json(ROOT / "scripts" / "kotus_templates.json")
    noun_groups = load_json(CONFIG / "noun_groups.json")["groups"]
    verb_groups = load_json(CONFIG / "verb_groups.json")["groups"]

    noun_type_to_group = {}
    for g in noun_groups:
        for t in g["kotus_types"]:
            noun_type_to_group[t] = g["id"]

    verb_type_to_group = {}
    for g in verb_groups:
        for t in g["kotus_types"]:
            verb_type_to_group[t] = g["id"]

    return (
        templates["nouns"],
        noun_type_to_group,
        templates["verbs"],
        verb_type_to_group,
    )


def iter_entries(path: Path) -> Iterable[dict]:
    """Stream JSONL one entry at a time."""
    if not path.exists():
        raise SystemExit(f"Missing {path}. Run scripts/download.py first.")
    with path.open("r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                yield json.loads(line)
            except json.JSONDecodeError:
                continue


# -------- tag normalization ----------------------------------------------

# Map kaikki/Wiktionary tag sets → our config case ids.
CASE_TAGS = {
    "nominative", "genitive", "partitive", "inessive", "elative", "illative",
    "adessive", "ablative", "allative", "essive", "translative", "abessive",
    "instructive", "comitative", "accusative",
}
NUMBER_TAGS = {"singular", "plural"}

# Verb tag mappings.
TENSE_TAGS = {
    "present": "present", "past": "past", "perfect": "perfect",
    "pluperfect": "pluperfect", "conditional": "conditional",
    "imperative": "imperative", "potential": "potential",
}
VOICE_TAGS = {"active": "active", "passive": "passive"}
POLARITY_TAGS = {"negative": "negative"}  # positive is default
PERSON_TAGS = {
    ("first-person", "singular"): "1sg",
    ("second-person", "singular"): "2sg",
    ("third-person", "singular"): "3sg",
    ("first-person", "plural"): "1pl",
    ("second-person", "plural"): "2pl",
    ("third-person", "plural"): "3pl",
}
INFINITIVE_TAGS = {
    "first-infinitive": "inf1_long",
    "second-infinitive": "inf2",
    "third-infinitive": "inf3",
    "fourth-infinitive": "inf4",
    "fifth-infinitive": "inf5",
}
PARTICIPLE_TAGS = {"participle"}


def tag_set(form: dict) -> set[str]:
    return set(form.get("tags") or [])


def noun_form_key(tags: set[str]) -> str | None:
    cases = tags & CASE_TAGS
    nums = tags & NUMBER_TAGS
    if len(cases) != 1 or len(nums) != 1:
        return None
    return f"{next(iter(cases))}_{next(iter(nums))}"


def verb_form_key(tags: set[str]) -> str | None:
    # Infinitives and participles first — they don't take person.
    for t, key in INFINITIVE_TAGS.items():
        if t in tags:
            voice = "passive" if "passive" in tags else "active"
            return f"{key}_{voice}"
    if tags & PARTICIPLE_TAGS:
        voice = "passive" if "passive" in tags else "active"
        tense = "past" if "past" in tags else "present"
        return f"participle_{tense}_{voice}"

    tense = None
    for t, key in TENSE_TAGS.items():
        if t in tags:
            tense = key
            break
    if tense is None:
        return None
    voice = "passive" if "passive" in tags else "active"
    polarity = "negative" if "negative" in tags else "positive"

    person = ""
    for (p1, p2), key in PERSON_TAGS.items():
        if p1 in tags and p2 in tags:
            person = f"_{key}"
            break
    if "imperative" in tags and not person:
        return None  # ambiguous imperatives without person
    return f"{tense}_{voice}_{polarity}{person}"


# -------- extraction per entry -------------------------------------------


def extract_kotus_type(entry: dict, template_map: dict[str, int]) -> int | None:
    """Search head/inflection templates for a known fi-decl-*/fi-conj-* name."""
    for key in ("head_templates", "inflection_templates"):
        for t in entry.get(key) or []:
            name = t.get("name")
            if name and name in template_map:
                return template_map[name]
    return None


def extract_translations(entry: dict) -> list[str]:
    glosses: list[str] = []
    for sense in entry.get("senses") or []:
        for g in sense.get("glosses") or []:
            if isinstance(g, str):
                glosses.append(g)
    return glosses[:5]  # cap to avoid bloat


def extract_audio(entry: dict) -> str | None:
    for s in entry.get("sounds") or []:
        url = s.get("ogg_url") or s.get("mp3_url") or s.get("audio")
        if url:
            return url
    return None


def extract_examples(entry: dict) -> list[dict]:
    """Return a list of {fi, en} pairs. `en` may be empty if no translation."""
    out: list[dict] = []
    for sense in entry.get("senses") or []:
        for ex in sense.get("examples") or []:
            fi = ex.get("text")
            if not fi:
                continue
            en = ex.get("english") or ex.get("translation") or ""
            out.append({"fi": fi, "en": en})
            if len(out) >= 3:
                return out
    return out


def shape_noun(entry: dict, kotus_type: int | None, group: str) -> dict:
    inflections: dict[str, str] = {}
    for f in entry.get("forms") or []:
        form_str = f.get("form")
        if not form_str or form_str in ("-", "—"):
            continue
        key = noun_form_key(tag_set(f))
        if key and key not in inflections:
            inflections[key] = form_str
    return {
        "word": entry["word"],
        "translations": extract_translations(entry),
        "kotus_type": kotus_type,
        "group": group,
        "inflections": inflections,
        "audio": extract_audio(entry),
        "examples": extract_examples(entry),
    }


def shape_verb(entry: dict, kotus_type: int | None, group: str) -> dict:
    inflections: dict[str, str] = {}
    for f in entry.get("forms") or []:
        form_str = f.get("form")
        if not form_str or form_str in ("-", "—"):
            continue
        key = verb_form_key(tag_set(f))
        if key and key not in inflections:
            inflections[key] = form_str
    return {
        "word": entry["word"],
        "translations": extract_translations(entry),
        "kotus_type": kotus_type,
        "group": group,
        "inflections": inflections,
        "audio": extract_audio(entry),
        "examples": extract_examples(entry),
    }


# -------- main pipeline --------------------------------------------------


def main() -> int:
    DATA.mkdir(parents=True, exist_ok=True)

    print("[1/4] loading frequency list...")
    freq = load_frequency()
    print(f"      {len(freq):,} words with rank")

    print("[2/4] loading kotus lookups...")
    noun_tpl, noun_group_of, verb_tpl, verb_group_of = load_kotus_lookups()

    print(f"[3/4] streaming {KAIKKI_FILE.name}...")
    nouns: list[dict] = []
    verbs: list[dict] = []
    counts = Counter()
    unknown_templates: Counter[str] = Counter()

    def raw_template_name(entry: dict) -> str | None:
        for key in ("inflection_templates", "head_templates"):
            for t in entry.get(key) or []:
                name = t.get("name")
                if name and (name.startswith("fi-decl-") or name.startswith("fi-conj-")):
                    return name
        return None

    for entry in iter_entries(KAIKKI_FILE):
        pos = entry.get("pos")
        word = entry.get("word")
        if not word or pos not in ("noun", "verb"):
            continue
        counts[f"seen_{pos}"] += 1

        # Skip inflected-form-pointer entries: kaikki.org lists every inflected
        # form (e.g. "sanoi", "sanon") as its own entry with pos=verb but no
        # inflection table — they just point back to the lemma. We only want
        # lemma entries, which always carry an inflection_templates field.
        if not entry.get("inflection_templates"):
            counts[f"not_lemma_{pos}"] += 1
            continue

        # Take the best (lowest/smallest) rank across the lemma itself and all
        # of its inflected forms. A lemma counts as "common enough" if any of
        # its forms is in the top FREQUENCY_CUTOFF of the frequency list.
        rank = freq.get(word.lower())
        for f in entry.get("forms") or []:
            s = f.get("form")
            if not s:
                continue
            r = freq.get(s.lower())
            if r is not None and (rank is None or r < rank):
                rank = r
        if freq and (rank is None or rank > FREQUENCY_CUTOFF):
            continue
        counts[f"in_freq_{pos}"] += 1

        tpl_map = noun_tpl if pos == "noun" else verb_tpl
        group_of = noun_group_of if pos == "noun" else verb_group_of
        shaper = shape_noun if pos == "noun" else shape_verb

        ktype = extract_kotus_type(entry, tpl_map)
        if ktype is None:
            tname = raw_template_name(entry)
            if tname:
                unknown_templates[tname] += 1

        group = group_of.get(ktype, "other")
        shaped = shaper(entry, ktype, group)
        if not shaped["inflections"]:
            counts[f"no_inflections_{pos}"] += 1
            continue
        shaped["frequency_rank"] = rank
        (nouns if pos == "noun" else verbs).append(shaped)

    # Deduplicate by word (keep the one with most inflection entries).
    def dedupe(items: list[dict]) -> list[dict]:
        best: dict[str, dict] = {}
        for it in items:
            prev = best.get(it["word"])
            if prev is None or len(it["inflections"]) > len(prev["inflections"]):
                best[it["word"]] = it
        return sorted(best.values(), key=lambda x: x.get("frequency_rank") or 10**9)

    nouns = dedupe(nouns)
    verbs = dedupe(verbs)

    noun_cases_cfg = load_json(CONFIG / "noun_cases.json")
    out_nouns = {
        "cases":   [c["id"] for c in noun_cases_cfg["cases"]],
        "numbers": [n["id"] for n in noun_cases_cfg["numbers"]],
        "words":   nouns,
    }
    out_verbs = {"words": verbs}

    print(f"[4/4] writing {len(nouns):,} nouns, {len(verbs):,} verbs")
    (DATA / "nouns.json").write_text(
        json.dumps(out_nouns, ensure_ascii=False, indent=1), encoding="utf-8"
    )
    (DATA / "verbs.json").write_text(
        json.dumps(out_verbs, ensure_ascii=False, indent=1), encoding="utf-8"
    )

    print("Done.")
    print("Counts:", dict(counts))

    # Sanity check: show inflection key counts for a handful of common lemmas.
    sample_nouns = {"kala", "talo", "nainen", "k\u00e4si", "vastaus"}
    sample_verbs = {"sanoa", "olla", "tehd\u00e4", "menn\u00e4", "puhua"}
    print("\nSanity check — inflection keys extracted for sample lemmas:")
    for n in nouns:
        if n["word"] in sample_nouns:
            print(f"  noun {n['word']!r:12s} group={n['group']:12s} type={n['kotus_type']}  {len(n['inflections'])} keys")
    for v in verbs:
        if v["word"] in sample_verbs:
            some_keys = list(v["inflections"].keys())[:3]
            print(f"  verb {v['word']!r:12s} group={v['group']:12s} type={v['kotus_type']}  {len(v['inflections'])} keys, e.g. {some_keys}")
    if unknown_templates:
        print("\nUnknown templates (top 20) — add to scripts/kotus_templates.json if you want these covered:")
        for name, n in unknown_templates.most_common(20):
            print(f"  {n:5,}  {name}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
