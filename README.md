# ClearChoice

Compare options with your own weighted criteria, privately in your browser. Pick a decision, add options and criteria, score each option 0–10, weight each criterion 1–5, and ClearChoice computes weighted totals and rankings automatically.

## Features

- Decisions dashboard: create, rename, duplicate, delete comparisons
- Comparison workspace: add, edit, reorder, and remove options and criteria
- Weights 1–5 per criterion, scores 0–10 per option
- Weighted totals and rankings, with ties flagged and missing scores shown clearly
- Notes on individual scores, listed together and included in the printed report
- Automatic saving in local storage — no account, no backend
- Export and import decisions as validated JSON (invalid files rejected whole, nothing changed)
- Print a clean comparison report
- Starts completely empty; responsive table on desktop, stacked option cards on mobile
- Accessible: labelled controls, visible focus, keyboard-operable dialogs, rankings in text as well as colour
- Works offline (service worker caches the app shell)

## How scoring works

Each option's weighted total is the sum of (weight × score) across scored criteria. A criterion with weight 5 counts five times as much as one with weight 1. An option with any empty score cell is not ranked, and its total is shown as partial. Equal totals share a rank and show a “Tie” badge.

## Files

- `index.html` — app shell
- `style.css` — warm white / charcoal / teal flat design (system font stack, no external font requests)
- `app.js` — all logic, localStorage persistence, import validation
- `sw.js`, `manifest.webmanifest` — offline support

## Run locally

Open `index.html` in a browser, or serve the folder with any static server, for example `python3 -m http.server`.

## Tests

`tests/clearchoice-test.js` is a Playwright suite (headless Firefox) covering the dashboard, scoring maths, ties, missing scores, notes, reorder, import validation (including duplicate-ID rejection), focus preservation, responsive score sync across breakpoints, dialog focus trap, print output, offline directory navigation, and the 375px layout. To run it, serve the folder on port 8141 (`python3 -m http.server 8141`), install Playwright (`npm install playwright-core`, plus a Firefox build), then run `node tests/clearchoice-test.js`.

`tests/clearchoice-subpath-test.js` checks the GitHub Pages layout: the app served under `/clearchoice/` with the domain root returning 404. It starts its own server on port 8143 and verifies the service worker installs and offline navigation to `/clearchoice/` loads the app. Run it with `node tests/clearchoice-subpath-test.js` (same Playwright install).

## Privacy

All data stays in the browser's local storage on the device. The app requests only its own static files; decision content is never transmitted. Export downloads a JSON file you control.
