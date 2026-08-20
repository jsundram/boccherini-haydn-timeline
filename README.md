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

The page centers the fixed-size 1080x1920 chart on a black background, so
naive window screenshots letterbox it. The script instead finds the chart
element itself (largest inline `<svg>`, or `--selector`), sizes the viewport
to exactly its natural dimensions, and writes to `output/`:

- `timeline.png` — the chart alone at 2x resolution (2160x3840)
- `timeline.svg` — the chart as a standalone vector, page styles inlined
- `timeline.pdf` — single-page PDF sized exactly to the chart

Options:

```sh
node capture.mjs --selector "#chart"   # explicit capture target
node capture.mjs --scale 3             # higher-res PNG (default 2)
node capture.mjs --file other.html
```

## View locally

Just open `index.html` in a browser, or `npm run serve`.
