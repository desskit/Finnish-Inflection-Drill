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
python scripts/download.py      # grabs kaikki.org data + frequency list
python scripts/extract.py       # filters and writes data/nouns.json + verbs.json
```

Re-run these when you want fresh words or change filters (e.g. frequency cutoff,
group mappings in `config/noun_groups.json`).
