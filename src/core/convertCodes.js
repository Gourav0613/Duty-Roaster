'use strict';

/**
 * convertCodes.js
 * Replaces Book1 shift codes with Duty Roster codes in every sheet of a
 * workbook, leaving all other cells (names, dates, headers, legend, empty
 * cells, and the "keep" codes) untouched.
 *
 * Replacement map (exact cell-value match, case-sensitive):
 *   M     -> MS7
 *   E     -> E2
 *   N     -> NS1
 *   N1    -> NS1
 *   M+E   -> MS8
 *   C/OFF -> O
 *
 * Unchanged codes: NO, O, G4, G1, M1, M/Half (and all others).
 */

const path = require('path');
const XLSX = require('xlsx');

const CODE_MAP = {
  M:     'MS7',
  E:     'E2',
  N:     'NS1',
  N1:    'NS1',
  'M+E': 'MS8',
  'C/OFF': 'O',
};

/**
 * Convert shift codes in all sheets of the given workbook in-place.
 * @param {object} wb  SheetJS workbook object
 * @returns {{replacements: number, cellsScanned: number}}
 */
function convertCodes(wb) {
  let replacements = 0;
  let cellsScanned = 0;

  for (const sheetName of wb.SheetNames) {
    const sheet = wb.Sheets[sheetName];
    for (const addr of Object.keys(sheet)) {
      if (addr.startsWith('!')) continue; // skip sheet metadata keys
      const cell = sheet[addr];
      cellsScanned++;

      // Only touch string cells whose value exactly matches a code.
      const raw = cell.v !== undefined ? String(cell.v).trim() : '';
      const mapped = CODE_MAP[raw];
      if (!mapped) continue;

      // Update all value fields SheetJS uses so the output is consistent.
      cell.v = mapped;
      cell.w = mapped;
      if (cell.r) cell.r = `<t>${mapped}</t>`;
      if (cell.h) cell.h = mapped;
      replacements++;
    }
  }

  return { replacements, cellsScanned };
}

/**
 * Load sourcePath, apply code conversions, and write to outputPath.
 * @param {string} sourcePath
 * @param {string} outputPath
 */
function convertFile(sourcePath, outputPath) {
  const wb = XLSX.readFile(sourcePath, { cellStyles: true, raw: false });
  const stats = convertCodes(wb);
  XLSX.writeFile(wb, outputPath, { cellStyles: true, bookSST: false });
  return stats;
}

// ── CLI entry point ──────────────────────────────────────────────────────────
if (require.main === module) {
  const [, , src, dst] = process.argv;
  if (!src || !dst) {
    console.error('Usage: node convertCodes.js <source.xlsx> <output.xlsx>');
    process.exit(1);
  }
  const stats = convertFile(path.resolve(src), path.resolve(dst));
  console.log(`Done. Scanned ${stats.cellsScanned} cells, replaced ${stats.replacements} shift codes.`);
}

module.exports = { convertCodes, convertFile };
