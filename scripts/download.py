"""
Download source data for the Finnish drill app.

Pulls two things into scripts/raw/:
  1. Finnish Wiktionary extract from kaikki.org (JSONL, one entry per line)
  2. A Finnish word frequency list (for filtering to common words)

Run this once. Re-run only if you want fresher data. The raw files are
gitignored because they are large.
"""

from __future__ import annotations

import sys
from pathlib import Path

import requests

RAW_DIR = Path(__file__).parent / "raw"

SOURCES = {
    # kaikki.org publishes per-language Wiktionary extracts. This is the
    # "all senses, raw" Finnish file. ~150 MB compressed equivalent; we get
    # the JSONL directly.
    "kaikki_finnish.jsonl": "https://kaikki.org/dictionary/Finnish/kaikki.org-dictionary-Finnish.jsonl",
    # Finnish frequency list from the opensubtitles-based frequency-words
    # project. Plain text, one "word count" per line.
    "frequency_fi.txt": "https://raw.githubusercontent.com/hermitdave/FrequencyWords/master/content/2018/fi/fi_full.txt",
}


def download(url: str, dest: Path) -> None:
    if dest.exists():
        print(f"[skip] {dest.name} already exists ({dest.stat().st_size / 1e6:.1f} MB)")
        return
    print(f"[get]  {url}")
    with requests.get(url, stream=True, timeout=60) as r:
        r.raise_for_status()
        total = int(r.headers.get("content-length", 0))
        written = 0
        with dest.open("wb") as f:
            for chunk in r.iter_content(chunk_size=1024 * 256):
                if not chunk:
                    continue
                f.write(chunk)
                written += len(chunk)
                if total:
                    pct = 100 * written / total
                    print(f"\r       {written / 1e6:7.1f} / {total / 1e6:7.1f} MB ({pct:5.1f}%)", end="")
                else:
                    print(f"\r       {written / 1e6:7.1f} MB", end="")
        print()


def main() -> int:
    RAW_DIR.mkdir(parents=True, exist_ok=True)
    for filename, url in SOURCES.items():
        download(url, RAW_DIR / filename)
    print("Done.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
