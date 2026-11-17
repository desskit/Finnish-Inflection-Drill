# Data extraction pipeline

One-time scripts that build `data/nouns.json` and `data/verbs.json` from
Wiktionary. The app itself never runs these — it just reads the resulting JSON.

## Setup (one time)

From the project root:

```
python -m venv .venv
.venv\Scripts\activate        # Windows
pip install -r scripts/requirements.txt
```

## What we use

- **kaikki.org** publishes [machine-readable Finnish Wiktionary](https://kaikki.org/dictionary/Finnish/)
  as JSONL (one JSON object per line). We download their extract and filter it,
  rather than parsing the raw Wiktionary XML ourselves.
- A Finnish word frequency list (to cut down to the most common ~10k words).

## How it runs (once Phase 1 is built)

```
python scripts/download.py              # grabs kaikki.org data + frequency list
python scripts/extract.py               # filters and writes data/nouns.json + verbs.json
                                        # (adjectives are merged into nouns.json —
                                        # they decline identically)
python scripts/extract_rection.py       # rection annotations → data/rection.json
python scripts/extract_possessives.py   # possessive paradigms → data/possessives.json
python scripts/extract_comparatives.py  # adjective comparative/superlative paradigms
                                        # → data/comparatives.json
python scripts/extract_numerals.py      # numeral paradigms → data/numerals.json
python scripts/gen_compound_numerals.py # fills in any 11-19 / tens missing from
                                        # Wiktionary by composing base paradigms
                                        # (no raw dump needed)
python scripts/extract_tatoeba.py       # tops up example sentences in nouns.json
                                        # + verbs.json from Tatoeba (run after
                                        # extract.py; downloads ~150 MB once)
```

Re-run these when you want fresh words or change filters (e.g. `FREQUENCY_CUTOFF`
in extract.py, group mappings in `config/noun_groups.json`). Run
`gen_compound_numerals.py` last — it only adds numerals that are missing, so
real Wiktionary paradigms always win.
