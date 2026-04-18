# Finnish Drilling App

A PWA for drilling Finnish noun and verb inflections, sourced from Wiktionary.

## Project layout

```
finnish-drill/
  index.html             Main app entry point
  css/                   Styles
  js/                    App logic (vanilla JS, no build step)
  data/                  Generated word data (nouns.json, verbs.json)
  config/                Editable data files (ending groups, filters, etc.)
  scripts/               One-time Python pipeline that builds data/*.json
```

## Running locally

From the project root:

```
python -m http.server 8000
```

Then open http://localhost:8000 in a browser.

## Regenerating the word data

See `scripts/README.md`. Only needs to be re-run when you want fresh words or
change filters.
