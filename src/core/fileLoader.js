'use strict';

/**
 * fileLoader.js
 * -----------------------------------------------------------------------------
 * Reads a source file (.xls / .xlsx / .csv / .pdf) into a raw 2-D grid that the
 * parser understands. SheetJS handles all spreadsheet flavours including the
 * legacy BIFF .xls; PDF is best-effort via pdfParser.js.
 */

const path = require('path');
const XLSX = require('xlsx');
const { extractGridFromPdf } = require('./pdfParser');

/**
 * Convert a SheetJS worksheet into a rectangular 2-D array of strings.
 * `raw: false` gives us formatted text so two-digit day labels stay "01" etc.
 * `defval: ''` keeps the rows rectangular so column indexes line up.
 */
function sheetToGrid(sheet) {
  return XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: '', blankrows: true });
}

/**
 * Load any supported file into a grid.
 * @param {string} filePath
 * @returns {Promise<{grid:Array<Array<string>>, kind:string, sheetName:string}>}
 */
async function loadGrid(filePath) {
  const ext = path.extname(filePath).toLowerCase();

  if (ext === '.pdf') {
    const grid = await extractGridFromPdf(filePath);
    return { grid, kind: 'pdf', sheetName: '' };
  }

  if (ext === '.xls' || ext === '.xlsx' || ext === '.csv') {
    const wb = XLSX.readFile(filePath, { cellDates: false, raw: false });
    const sheetName = pickSheet(wb);
    const sheet = wb.Sheets[sheetName];
    if (!sheet) throw new Error('The workbook has no readable sheet.');
    return { grid: sheetToGrid(sheet), kind: ext.slice(1), sheetName };
  }

  throw new Error(`Unsupported file type "${ext}". Please upload .xls, .xlsx, .csv or .pdf.`);
}

/** Choose the sheet most likely to hold the roster (the one mentioning EMP#). */
function pickSheet(wb) {
  for (const name of wb.SheetNames) {
    const sheet = wb.Sheets[name];
    const grid = sheetToGrid(sheet);
    const hasEmp = grid.some((row) => row && row.some((c) => String(c).trim().toLowerCase().replace(/\s+/g, '') === 'emp#'));
    if (hasEmp) return name;
  }
  return wb.SheetNames[0];
}

module.exports = { loadGrid, sheetToGrid, pickSheet };
