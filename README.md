# Duty Roster Manager

A cross-platform **Electron** desktop app that cleans up the messy HR
"Duty Roster Report" export and (soon) automates adapter scheduling.

It has two modules:

1. **Roster Formatter** — upload the messy `.XLS` / `.xlsx` / `.csv` / `.pdf`
   export, convert it to a clean, styled `.xlsx`, preview it, and save it.
2. **Adapter Automation** — *placeholder*. Previews the latest formatted sheet;
   automation actions are marked "coming soon".

---

## Run

```bash
npm install
npm start        # launches the Electron app
```

## Test

```bash
npm test         # node:test — parser + formatter unit tests
```

Unit tests cover band detection, day-column mapping, 28/29/30/31-day months,
band merging, partial-month employees, conflict warnings, and a full
write→re-read validation with 0 mismatches.

## Try the real sample

Drop the binary export at `samples/Duty_Roster_Report.XLS`, then:

```bash
node scripts/run-sample.js
```

It prints employee count, month length, partial employees, and the validation
result. Expected for the reference file: **35 employees, 30 days**, `AF00072`
filled only on days 1, 4, 5.

## Package

```bash
npm run dist        # current OS
npm run dist:win    # Windows installer (NSIS)
```

(Outputs to `release/`. `electron-builder` config lives in `package.json`.)

---

## Why two Excel libraries?

| Need | Library |
|------|---------|
| **Read** legacy `.xls` (BIFF), `.xlsx`, `.csv` | **SheetJS `xlsx`** |
| **Write** a richly styled `.xlsx` | **`exceljs`** |

SheetJS reads every spreadsheet flavour but the community edition can't write
cell styles; ExcelJS writes rich styles but can't read legacy `.xls`. So we read
with one and write with the other. PDFs are best-effort via `pdfjs-dist`.

---

## The band-merging algorithm

The export splits **one month across repeated horizontal "bands."** Each band
starts with a header row (`EMP# · Name · Designation · Work Area · day labels`).
The first set of bands carries days **01–27**; continuation bands lower down
carry the rest (**28–31**, depending on the month). So one employee's month is
spread across two rows in two bands — and we stitch them back together.

```
 ┌──────────────────────────────────────────── grid (≈460 × 102) ───────────┐
 │ row 1   Duty Roster Report ...                                            │
 │ row 2   Legend :- O: OFF; L/HL: Leave; ...                                │
 │                                                                           │
 │ ┌─ BAND A (days 01..27) ─────────────────────────────────────────────┐   │
 │ │ EMP#   Name   Designation   Work Area   01 02 03 ... 27             │   │  ← header
 │ │ AF00072 Alice  Tech          Plant A     GS1 .. .. ...               │   │  ← employee
 │ │ AF00073 Bob    Op            Plant A     E1  M1 .. ...               │   │
 │ └────────────────────────────────────────────────────────────────────┘   │
 │              ... many empty spacer rows ...                               │
 │ ┌─ BAND B (days 28..30, continuation) ───────────────────────────────┐   │
 │ │ EMP#   Name   Designation   Work Area   28 29 30                    │   │  ← header
 │ │ AF00072 Alice  Tech          Plant A     ..  ..  ..                  │   │  ← same emp!
 │ │ AF00073 Bob    Op            Plant A     NS1 O   O                   │   │
 │ └────────────────────────────────────────────────────────────────────┘   │
 └───────────────────────────────────────────────────────────────────────────┘

  merge by EMP#  ─────────────►   AF00072 : days 1..30 in one clean row
```

Steps (all anchors detected **dynamically** — nothing is hardcoded to the sample
file's coordinates):

1. **Load** the sheet into a 2-D grid
   (`sheet_to_json(sheet, { header: 1, raw: false, defval: '' })`).
2. **Detect bands** — every row containing the literal `EMP#`. For each band,
   derive the identity-column anchors (EMP#, Name, Designation, Work Area).
3. **Map day → column** — scan each header row, *to the right of the identity
   block*, for two-digit labels `01..31` (so identity numbers are never mistaken
   for days).
4. **Auto-detect month length N** = the largest day label seen across all bands
   (handles 28 / 29 / 30 / 31 automatically).
5. **Read employee rows** below each header until the next band. A row is an
   employee if its `EMP#` cell looks like an ID. Name/Designation/Work Area are
   read with a small right-ward search to absorb **merged-cell shift**; each day
   value is read at its exact mapped column so **blanks stay blank**.
6. **Merge by EMP#** in first-seen order. Later bands fill in missing days. If two
   bands give conflicting non-empty values for the same day, the **first wins**
   and a **warning** is surfaced in the UI.
7. **Format** to `.xlsx` with ExcelJS (title, legend, dark-blue header, borders,
   alternating shading, gray `O` cells, freeze panes, hidden gridlines).
8. **Validate** — re-read the written file and compare every shift cell to the
   extracted value → `✓ Verified: X employees, N days, 0 mismatches`.

### Source modules

| File | Responsibility |
|------|----------------|
| `src/core/fileLoader.js`     | Read `.xls/.xlsx/.csv` (SheetJS) / route `.pdf` → grid |
| `src/core/pdfParser.js`      | Best-effort PDF text → grid reconstruction |
| `src/core/rosterParser.js`   | Band detection, day mapping, merge-by-EMP#, conflicts |
| `src/core/rosterFormatter.js`| Styled `.xlsx` output + cell-by-cell validation |
| `src/core/convert.js`        | Orchestration (load → parse → write → validate → preview) |
| `src/core/store.js`          | JSON store of the latest output (for Module 2) |
| `src/main.js` / `src/preload.js` | Secure Electron shell + contextBridge IPC |
| `src/renderer/*`             | Light-theme UI (sidebar, drag-drop, preview table) |

## Security

`nodeIntegration: false`, `contextIsolation: true`, `sandbox: true`. The renderer
reaches the main process only through a small allow-listed `contextBridge` API
(`selectFile`, `convertRoster`, `saveOutput`, `getLatestOutput`, …). All file I/O
and parsing happen in the main process.
