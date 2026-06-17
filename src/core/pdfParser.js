'use strict';

/**
 * pdfParser.js
 * -----------------------------------------------------------------------------
 * Best-effort PDF -> grid reconstruction. PDFs have no real table structure, so
 * we group text items by their vertical position (rows) and sort by horizontal
 * position (columns), then hand the result to the normal band-detection parser.
 *
 * If pdfjs-dist isn't installed or the layout can't be reconstructed, we throw a
 * friendly error that the UI surfaces verbatim -- we never produce wrong data
 * silently.
 */

const FRIENDLY_ERROR =
  "This PDF's layout couldn't be parsed -- please upload the Excel or CSV export instead.";

/**
 * @param {string} filePath
 * @returns {Promise<Array<Array<string>>>} a 2-D grid
 */
async function extractGridFromPdf(filePath) {
  let pdfjs;
  try {
    // pdfjs-dist v4 ships an ESM legacy build that works under CommonJS via import().
    pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  } catch (e) {
    throw new Error(FRIENDLY_ERROR);
  }

  const fs = require('fs');
  let data;
  try {
    data = new Uint8Array(fs.readFileSync(filePath));
  } catch (e) {
    throw new Error(FRIENDLY_ERROR);
  }

  let doc;
  try {
    doc = await pdfjs.getDocument({ data, useSystemFonts: true }).promise;
  } catch (e) {
    throw new Error(FRIENDLY_ERROR);
  }

  const allItems = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    const viewport = page.getViewport({ scale: 1 });
    for (const item of content.items) {
      if (!item.str || !item.str.trim()) continue;
      const x = item.transform[4];
      const y = viewport.height - item.transform[5]; // flip so y grows downward
      allItems.push({ x, y, str: item.str.trim() });
    }
  }

  if (allItems.length === 0) throw new Error(FRIENDLY_ERROR);

  const grid = itemsToGrid(allItems);

  // Sanity check: the reconstruction must contain an EMP# header somewhere.
  const hasEmp = grid.some((row) => row.some((c) => String(c).trim().toLowerCase().replace(/\s+/g, '') === 'emp#'));
  if (!hasEmp) throw new Error(FRIENDLY_ERROR);

  return grid;
}

/**
 * Cluster text items into rows (by y) and columns (by x).
 * Exposed for unit testing without a real PDF.
 */
function itemsToGrid(items, opts = {}) {
  const rowTol = opts.rowTol || 4; // px tolerance to consider items on the same line
  const colTol = opts.colTol || 12; // px tolerance to merge x positions into a column

  // Group into rows by y.
  const sorted = [...items].sort((a, b) => a.y - b.y || a.x - b.x);
  const rows = [];
  for (const item of sorted) {
    let row = rows.find((r) => Math.abs(r.y - item.y) <= rowTol);
    if (!row) {
      row = { y: item.y, items: [] };
      rows.push(row);
    }
    row.items.push(item);
  }

  // Build a global set of column x-anchors.
  const xs = [];
  for (const item of items) {
    let anchor = xs.find((a) => Math.abs(a - item.x) <= colTol);
    if (anchor === undefined) xs.push(item.x);
  }
  xs.sort((a, b) => a - b);

  const colOf = (x) => {
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < xs.length; i++) {
      const d = Math.abs(xs[i] - x);
      if (d < bestD) { bestD = d; best = i; }
    }
    return best;
  };

  return rows
    .sort((a, b) => a.y - b.y)
    .map((row) => {
      const cells = new Array(xs.length).fill('');
      for (const item of row.items.sort((a, b) => a.x - b.x)) {
        const c = colOf(item.x);
        cells[c] = cells[c] ? cells[c] + ' ' + item.str : item.str;
      }
      return cells;
    });
}

module.exports = { extractGridFromPdf, itemsToGrid, FRIENDLY_ERROR };
