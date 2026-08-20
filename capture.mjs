// Capture static outputs (PNG / PDF / SVG) from index.html using Playwright.
//
// The page centers a fixed-aspect chart on a black background, so naive
// window screenshots letterbox it. This script finds the chart itself
// (largest inline <svg>/<canvas>, or --selector), sizes the viewport to
// exactly the chart's natural dimensions, and captures just that.
//
// Usage:
//   npm run capture                        # auto-detects the chart element
//   node capture.mjs --selector "#chart"   # explicit capture target
//   node capture.mjs --scale 3             # higher-res PNG (default 2)
//   node capture.mjs --file other.html
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

const selector = arg("selector", null);
const scale = Number(arg("scale", "2"));
const src = path.join(__dirname, arg("file", "index.html"));

// Runs in the page: the capture target is the --selector match if given,
// else the largest visible <svg>/<canvas>, else null (full-page fallback).
const findTarget = (sel) => {
  if (sel) return document.querySelector(sel);
  let best = null;
  let bestArea = 0;
  for (const el of document.querySelectorAll("svg, canvas")) {
    const r = el.getBoundingClientRect();
    if (r.width * r.height > bestArea) {
      bestArea = r.width * r.height;
      best = el;
    }
  }
  return bestArea >= 200 * 200 ? best : null;
};

async function load(page) {
  await page.goto(`file://${src}`, { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
  // Give any JS-driven layout (charts, animations) a beat to settle.
  await page.waitForTimeout(1000);
}

await mkdir(OUT, { recursive: true });
const browser = await chromium.launch();

// --- Pass 1: open at a desktop default and measure the target's natural size.
let page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await load(page);

const size = await page.evaluate((sel) => {
  const find = (s) => {
    if (s) return document.querySelector(s);
    let best = null, bestArea = 0;
    for (const el of document.querySelectorAll("svg, canvas")) {
      const r = el.getBoundingClientRect();
      if (r.width * r.height > bestArea) { bestArea = r.width * r.height; best = el; }
    }
    return bestArea >= 200 * 200 ? best : null;
  };
  const el = find(sel);
  if (el) {
    const r = el.getBoundingClientRect();
    // Prefer the SVG's own declared size over its (possibly CSS-shrunk) layout size.
    const w = Number(el.getAttribute?.("width")) || r.width;
    const h = Number(el.getAttribute?.("height")) || r.height;
    return { mode: "element", width: Math.ceil(w), height: Math.ceil(h) };
  }
  // Fallback: whole-page content bounds.
  let right = 0, bottom = 0;
  for (const e of document.querySelectorAll("body *")) {
    const r = e.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) {
      right = Math.max(right, r.right + scrollX);
      bottom = Math.max(bottom, r.bottom + scrollY);
    }
  }
  return { mode: "page", width: Math.ceil(right), height: Math.ceil(bottom) };
}, selector);

console.log(`capture target: ${size.mode}, ${size.width}x${size.height}`);

// --- Pass 2: reopen with the viewport matched to the target, so centering
// collapses to zero offset and responsive CSS settles at final size.
await page.close();
page = await browser.newPage({
  viewport: { width: size.width, height: size.height },
  deviceScaleFactor: scale,
});
await load(page);

// PNG — the target element alone (or full page in fallback mode), at scale.
const handle =
  size.mode === "element"
    ? (await page.evaluateHandle(findTarget, selector)).asElement()
    : null;
if (handle) {
  await handle.screenshot({ path: path.join(OUT, "timeline.png") });
} else {
  await page.screenshot({
    path: path.join(OUT, "timeline.png"),
    clip: { x: 0, y: 0, width: size.width, height: size.height },
  });
}
console.log(`wrote output/timeline.png (${size.width * scale}x${size.height * scale})`);

// SVG — serialize each sizable inline <svg> standalone, with computed styles
// inlined so page CSS isn't needed to render it.
const svgs = await page.evaluate(() => {
  const VISUAL_PROPS = [
    "fill", "fill-opacity", "stroke", "stroke-width", "stroke-opacity",
    "stroke-dasharray", "stroke-linecap", "stroke-linejoin", "opacity",
    "font-family", "font-size", "font-weight", "font-style", "letter-spacing",
    "text-anchor", "dominant-baseline", "paint-order", "color", "visibility",
  ];
  const results = [];
  document.querySelectorAll("svg").forEach((svg) => {
    const rect = svg.getBoundingClientRect();
    if (rect.width < 200 || rect.height < 200) return; // skip icons
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
    // Carry the page's background onto the root so the standalone SVG
    // doesn't render transparent where the page supplied white.
    const bg = getComputedStyle(svg.parentElement || svg).backgroundColor;
    if (bg && bg !== "rgba(0, 0, 0, 0)") {
      const bgRect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
      bgRect.setAttribute("width", "100%");
      bgRect.setAttribute("height", "100%");
      bgRect.setAttribute("fill", bg);
      clone.insertBefore(bgRect, clone.firstChild);
    }
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

// PDF — a single page sized exactly to the capture target (viewport matches
// the target, so there's no letterboxing offset to worry about).
await page.pdf({
  path: path.join(OUT, "timeline.pdf"),
  width: `${size.width}px`,
  height: `${size.height}px`,
  printBackground: true,
  pageRanges: "1",
});
console.log("wrote output/timeline.pdf");

await browser.close();
