# S-92 FCP

Single-page web app of the **S-92A Flight Check Procedures checklist** (`SA_S92A-FCP.pdf`, SA S92A-FCP-000, rev. 18 Oct 2013), used by helicopter technicians on an **iPad mini 4 (iPadOS 15, Safari 15)**. Same design as [ground-run](https://github.com/Lunde-Lab/ground-run) (colour tokens, Barlow + JetBrains Mono, cards, dark/light).

## Working with André

- André is an S-92 technician (B1). Write to him in **Norwegian**, short and direct. When there is a choice, give **numbered alternatives** and a recommendation.
- The **app UI is English**, and procedure text is verbatim from the PDF.
- Domain content comes from the PDF/André – never invent or "improve" procedure text, limits or values. If the parser got something wrong, fix the parser (or patch it there) – not by hand in the JSON.
- Show the result of a change (what changed, tested how) – don't recap steps.

## What the app does

- **Front page** = PDF pages 120–122 (chapters 1.0–5.0, items 1.1 … 5.11). PDF page 119 (header form) is intentionally dropped.
- Item number/title is a link to the procedure (`#/1.1`). Checkbox = selected for this FCP. Selected rows get **Performed**; one tap marks it performed (time stored). A performed task is struck through with reduced opacity. Tapping "✓ Performed" offers to undo it.
- Chapters collapse by tapping the header; **3.0 and 4.0 are collapsed by default**. Returning from a procedure opens its chapter.
- **Procedure page**: sticky top bar with **FCP** back button (always visible), prev/next, sign status. Bottom: **Performed**, prev/next. No selected toggle on the procedure page: if the test is not selected, Performed is greyed out and tapping it asks "Add it to Selected?" (adds only; tap Performed again to mark it).
- Filter **All / Selected**; with Selected active, prev/next steps through selected tests only.
- 4.2 AUTOROTATION has the record fields from the checklist (collective settings, HP, OAT …) and Figures 1–4 (PDF pages 115–118).
- **New job** (top bar): modal listing all tests with per-chapter Select all; **Start job** clears the previous job (selections, sign-offs, records), selects the picked tests and switches to the **Selected** filter. To add more tests later, switch to **All** and tick them.
- **Readability (display only, text stays verbatim):** `lineHtml()` shows menu paths (`HLTH→HUMS→…`) as chips, values with units (`105%`, `0.2 IPS`, `30 seconds`, `±1%`) bold, and ALL-CAPS switch/button names (`BATT – ON`, `EMER PWR`) bold mono. `docHtml()` groups sub-steps (a., b. …) under a left line, puts a divider between main steps, and folds 2+ consecutive NOTEs into one collapsed "NOTES (n)" box. WARNING/CAUTION are always shown. Procedure text is 1.15rem.

## Behaviour André has decided (don't undo without asking)

- No selected/performed/remaining counter card on the front page (removed on request).
- No export/Share summary (removed on request).
- No technician/initials – the button is just **Performed** (one tap). Performed tasks are struck through and the whole row (incl. background and Performed button) has reduced opacity.
- **Selected** view has no checkboxes (deselect only from All). No bar title/progress text ("S-92A FCP / x of y performed") and no disclaimer line on the front page.
- A new job starts by picking tests in the New job modal; after that only the selected tests are shown (All/Selected segmented control to add more).

## Files

| Path | What |
|---|---|
| `index.html` | The whole app: HTML + CSS + JS inline. The `<script id="fcp-data">` block is **generated** – don't edit it by hand. |
| `scripts/extract.py` | Parses the PDF → `data/fcp.json`, renders `figures/fig1-4.png`, and inlines the JSON into `index.html`. |
| `data/fcp.json` | Parsed content (readable copy of what is inlined). |
| `SA_S92A-FCP.pdf` | Source document. |
| `sw.js`, `manifest.webmanifest`, `icons/` | Offline/PWA. Bump `VERSION` in `sw.js` on each release: `scripts/bump-sw.sh` |
| `tests/smoke.js` | Playwright smoke test. |

## Data format (`data/fcp.json`)

`index` = front page chapters/items (`sign: false` for 2.9, which has no sign line in the PDF; 4.2 has `fields`). `sections[]` = `{id, chapter, title, page, blocks[]}`, blocks:
`step {lvl 1–3, n, text}` · `warning|caution|note {text}` · `h {id, text}` (sub-headings like 2.16.1) · `p {text, lvl}` · `table {rows}`.
Parser notes: the PDF draws `±` and `″` with pi fonts (mapped in `FONT_MAP`); some steps lack the dot after the label (`LOOSE_RE`); header/footer are cut by y-position. After changing the parser, check that no words are lost (compare word counts against `pdftotext`) and look at screenshots.

## Hard constraints

- **Safari 15**: no `color-mix()`, no `:has()`, no top-level `await`; keep JS ES2019-ish. Test on 768×1024.
- One file, no build step at runtime, no JS libraries. Touch targets ≥ 44 px. No horizontal page scroll (tables scroll inside `.tablewrap`).
- **Never rename localStorage keys** (data on iPads would be lost): `fcp-v1` (`{sel, done, rec}`), `fcp-collapsed` (`{chapterId: true}`), `fcp-filter`, `fcp-theme`. Unused, don't reuse: `fcp-signer`, `fcp-techs` (old technician feature). `done[id]` is `{at}`; older entries may also have `by`. Schema changes must stay backward compatible (see `tidy()`).

## Test and release

```
python3 scripts/extract.py                       # only after parser/PDF changes (needs pdfplumber, poppler-utils)
NODE_PATH=$(npm root -g) node tests/smoke.js     # Playwright + Chromium are preinstalled in the cloud env
scripts/bump-sw.sh                               # before committing a release
```

For visual checks, screenshot with Playwright at 768×1024 (iPad portrait), 1024×768 (landscape) and 390 wide (phone): `node tests/smoke.js <dir>` writes screenshots to `<dir>`.
