"""
Diagnostic: sample real entries and dump enough structure to understand
what's in the kaikki.org Finnish extract.

Run: python scripts/inspect_raw.py
"""

from __future__ import annotations

import json
from collections import Counter
from pathlib import Path

RAW = Path(__file__).parent / "raw" / "kaikki_finnish.jsonl"

# Lemma we want a deep dump of
DEEP_DUMP_WORD = "sanoa"
DEEP_DUMP_POS = "verb"


def main() -> int:
    pos_counter: Counter[str] = Counter()
    has_infl_template: Counter[tuple[str, bool]] = Counter()
    form_of_counter: Counter[str] = Counter()

    deep_dumped = False

    with RAW.open("r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                entry = json.loads(line)
            except json.JSONDecodeError:
                continue
            pos = entry.get("pos") or ""
            pos_counter[pos] += 1

            has_infl = bool(entry.get("inflection_templates"))
            has_infl_template[(pos, has_infl)] += 1

            # Check if this is an inflected-form entry
            senses = entry.get("senses") or []
            is_form_of = False
            for sense in senses:
                tags = set(sense.get("tags") or [])
                if "form-of" in tags:
                    is_form_of = True
                    break
                if sense.get("form_of"):
                    is_form_of = True
                    break
            if is_form_of:
                form_of_counter[pos] += 1

            # Deep dump our chosen lemma the FIRST time we hit it with forms
            if (
                not deep_dumped
                and entry.get("word") == DEEP_DUMP_WORD
                and pos == DEEP_DUMP_POS
                and has_infl
            ):
                print(f"\n=== DEEP DUMP: {DEEP_DUMP_WORD} ({pos}) ===\n")
                print(f"inflection_templates: {entry.get('inflection_templates')}")
                forms = entry.get("forms") or []
                print(f"\nTotal forms: {len(forms)}")
                print("First 30 forms with tags:")
                for ff in forms[:30]:
                    print(f"  {ff.get('form')!r:25s} tags={ff.get('tags')}")
                print("\nUnique tag sets across ALL forms:")
                unique_tagsets: Counter[tuple[str, ...]] = Counter()
                for ff in forms:
                    unique_tagsets[tuple(sorted(ff.get("tags") or []))] += 1
                for tagset, n in unique_tagsets.most_common(40):
                    print(f"  {n:3d}x  {list(tagset)}")
                deep_dumped = True

    print("\n=== POS counts (all entries) ===")
    for pos, n in pos_counter.most_common():
        print(f"  {n:8,}  {pos}")

    print("\n=== (pos, has_inflection_template) counts ===")
    for (pos, has_infl), n in sorted(has_infl_template.items()):
        print(f"  {n:8,}  pos={pos!r:12s} has_inflection_template={has_infl}")

    print("\n=== form-of (inflected-form) entry counts by pos ===")
    for pos, n in form_of_counter.most_common():
        print(f"  {n:8,}  {pos}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
