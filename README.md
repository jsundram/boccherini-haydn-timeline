# Boccherini / Haydn Timeline

Offline home for the timeline originally built as a Claude artifact
([original artifact](https://claude.ai/public/artifacts/0588cef3-6f5f-4f62-aba6-17b316a9cf2e)),
plus automated static capture (PNG / PDF / SVG) that sizes itself to the
content instead of the browser window.

## Files

- `index.html` — the artifact source, self-contained
- `capture.mjs` — Playwright script that renders `index.html` and writes captures
- `output/` — generated captures (committed, so the latest renders travel with the repo)

## Setup (once)

```sh
npm install
npx playwright install chromium
```

## Capture

```sh
npm run capture
```

This measures the page's natural content size, reopens it at exactly that
width, and writes to `output/`:

- `timeline.png` — full-page screenshot at 2x resolution
- `timeline.svg` — each sizable inline `<svg>`, standalone with styles inlined
- `timeline.pdf` — single-page PDF sized exactly to the content
- `timeline-letter.pdf` — conventional paginated US-Letter PDF

Options:

```sh
node capture.mjs --width 1600   # force a specific capture width
node capture.mjs --scale 3      # higher-res PNG (default 2)
node capture.mjs --file other.html
```

## View locally

Just open `index.html` in a browser, or `npm run serve`.
