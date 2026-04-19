# Finnish Drilling App

A PWA for drilling Finnish noun and verb inflections, sourced from Wiktionary.

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
  icons/                 App icons (icon.svg + optional 192/512 PNGs)
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
- **PNG icons**: the manifest also references `icons/icon-192.png` and
  `icons/icon-512.png` for platforms that don't render SVG icons (iOS
  home-screen install, some older Android launchers). Generate them once
  with:
  ```
  pip install cairosvg
  python scripts/make_icons.py
  ```
  The SVG icon alone is enough for desktop Chrome / modern Android.
