// Capture static outputs (PNG / PDF / SVG) from index.html using Playwright.
//
// Usage:
//   npm run capture                 # captures at the page's natural content size
//   node capture.mjs --width 1600   # force a specific viewport width
//   node capture.mjs --scale 3      # higher-res PNG (default 2)
//
// Outputs land in ./output/

import { chromium } from "playwright";
import { fileURLToPath } from "node:url";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, "output");

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const forcedWidth = arg("width", null);
const scale = Number(arg("scale", "2"));
const src = path.join(__dirname, arg("file", "index.html"));

await mkdir(OUT, { recursive: true });

const browser = await chromium.launch();

// --- Pass 1: open at a generous default width and measure natural content size.
let page = await browser.newPage({
  viewport: { width: forcedWidth ? Number(forcedWidth) : 1440, height: 900 },
});
await page.goto(`file://${src}`, { waitUntil: "networkidle" });
await page.evaluate(() => document.fonts.ready);
// Give any JS-driven layout (React, charts, animations) a beat to settle.
await page.waitForTimeout(1000);

// Natural content bounds: the extent of every laid-out element, so wide
// timelines aren't clipped and short pages aren't padded with viewport.
const measureContent = () => {
  let maxRight = 0, maxBottom = 0;
  for (const el of document.querySelectorAll("body, body *")) {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) {
      maxRight = Math.max(maxRight, r.right + window.scrollX);
      maxBottom = Math.max(maxBottom, r.bottom + window.scrollY);
    }
  }
  return { width: Math.ceil(maxRight), height: Math.ceil(maxBottom) };
};

const size = await page.evaluate(measureContent);

const width = forcedWidth ? Number(forcedWidth) : size.width;
console.log(`content size: ${size.width}x${size.height}, capturing at width ${width}`);

// --- Pass 2: reopen at the measured width so responsive CSS settles at final size.
await page.close();
page = await browser.newPage({
  viewport: { width, height: 900 },
  deviceScaleFactor: scale,
});
await page.goto(`file://${src}`, { waitUntil: "networkidle" });
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(1000);

const final = await page.evaluate(measureContent);
// Small breathing room so bottom borders/shadows aren't shaved off.
const height = Math.min(final.height + 8, await page.evaluate(() => document.documentElement.scrollHeight));

// PNG — clipped to actual content bounds, at deviceScaleFactor for crispness.
await page.screenshot({
  path: path.join(OUT, "timeline.png"),
  clip: { x: 0, y: 0, width, height },
});
console.log(`wrote output/timeline.png (${width * scale}x~${height * scale}px)`);

// SVG — serialize each inline <svg> as a standalone file, with computed
// styles inlined so page CSS isn't needed to render it.
const svgs = await page.evaluate(() => {
  const VISUAL_PROPS = [
    "fill", "fill-opacity", "stroke", "stroke-width", "stroke-opacity",
    "stroke-dasharray", "stroke-linecap", "stroke-linejoin", "opacity",
    "font-family", "font-size", "font-weight", "font-style", "letter-spacing",
    "text-anchor", "dominant-baseline", "paint-order", "color", "visibility",
  ];
  const results = [];
  document.querySelectorAll("svg").forEach((svg, i) => {
    const rect = svg.getBoundingClientRect();
    if (rect.width < 20 || rect.height < 20) return; // skip icons
    const clone = svg.cloneNode(true);
    const origEls = [svg, ...svg.querySelectorAll("*")];
    const cloneEls = [clone, ...clone.querySelectorAll("*")];
    origEls.forEach((orig, j) => {
      const cs = getComputedStyle(orig);
      const decls = VISUAL_PROPS
        .map((p) => {
          const v = cs.getPropertyValue(p);
          return v && v !== "normal" ? `${p}:${v}` : null;
        })
        .filter(Boolean)
        .join(";");
      if (decls) cloneEls[j].setAttribute("style", decls);
    });
    clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    clone.setAttribute("xmlns:xlink", "http://www.w3.org/1999/xlink");
    if (!clone.getAttribute("viewBox"))
      clone.setAttribute("viewBox", `0 0 ${rect.width} ${rect.height}`);
    if (!clone.getAttribute("width")) clone.setAttribute("width", rect.width);
    if (!clone.getAttribute("height")) clone.setAttribute("height", rect.height);
    results.push(new XMLSerializer().serializeToString(clone));
  });
  return results;
});
for (const [i, svg] of svgs.entries()) {
  const name = svgs.length === 1 ? "timeline.svg" : `timeline-${i + 1}.svg`;
  await writeFile(path.join(OUT, name), `<?xml version="1.0" encoding="UTF-8"?>\n${svg}`);
  console.log(`wrote output/${name}`);
}
if (svgs.length === 0) console.log("no sizable inline <svg> found — skipping SVG export");

// PDF — single page sized exactly to the content (no pagination, no clipping).
await page.pdf({
  path: path.join(OUT, "timeline.pdf"),
  width: `${width / 96}in`,
  height: `${(height + 2) / 96}in`,
  printBackground: true,
  pageRanges: "1",
});
console.log("wrote output/timeline.pdf");

// Also a conventional paginated Letter PDF, in case that's ever handier.
await page.pdf({
  path: path.join(OUT, "timeline-letter.pdf"),
  format: "Letter",
  printBackground: true,
  margin: { top: "0.4in", bottom: "0.4in", left: "0.4in", right: "0.4in" },
});
console.log("wrote output/timeline-letter.pdf");

await browser.close();
