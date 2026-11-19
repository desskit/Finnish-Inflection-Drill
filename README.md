# Finnish Inflection Drill

**Try it: [desskit.github.io/Finnish-Inflection-Drill](https://desskit.github.io/Finnish-Inflection-Drill/)**

A free PWA for practising Finnish noun cases, verb conjugations, possessive
suffixes and adjective comparison — type the inflected form of 7,000+ common
words, sourced from Wiktionary. Works offline once loaded.

## Project layout

```
finnish-drill/
  index.html             Main app entry point
  manifest.json          PWA manifest (name, icons, theme)
  sw.js                  Service worker (offline cache)
  css/                   Styles
  js/                    App logic (vanilla JS, no build step)
  data/                  Generated word data (nouns.json, verbs.json)
  config/                Editable data files (ending groups, filters, etc.)
  icons/                 App icons (icon.svg + 192/512 PNGs) and og-image.png (link previews)
  sitemap.xml            For Google Search Console
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

## PWA / offline

The app registers a service worker (`sw.js`) that caches everything it needs
to run offline. A few notes:

- **Service workers only run on `localhost` or `https://`.** Opening
  `index.html` directly from disk won't work — use the `python -m http.server`
  command above, or deploy to GitHub Pages.
- **Bump `CACHE_VERSION` in `sw.js`** whenever you ship code/data changes.
  Without a bump, browsers keep serving the old cached copy.
- **PNG icons**: `icons/icon-192.png` and `icons/icon-512.png` (committed)
  cover platforms that don't render SVG icons — iOS home-screen install,
  some older Android launchers. If you change `icons/icon.svg`, regenerate
  them with:
  ```
  pip install cairosvg
  python scripts/make_icons.py
  ```
