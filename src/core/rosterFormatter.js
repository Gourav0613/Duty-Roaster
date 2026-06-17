'use strict';

/**
 * rosterFormatter.js
 * -----------------------------------------------------------------------------
 * Turns a parsed roster (see rosterParser.js) into a nicely styled .xlsx using
 * ExcelJS, and re-reads it to validate that every shift value survived the
 * round-trip. SheetJS can read legacy .xls but cannot write styles; ExcelJS can
 * write rich styles but cannot read .xls -- so we read with one and write with
 * the other.
 */

const ExcelJS = require('exceljs');

const IDENTITY_COLUMNS = ['S.No', 'EMP#', 'Name', 'Designation', 'Work Area'];
const HEADER_FILL  = '1E3A5F'; // deep navy
const ALT_ROW_FILL = 'EFF6FF'; // blue-50
const OFF_FILL     = 'E2E8F0'; // slate-200
const OFF_TEXT     = '94A3B8'; // slate-400
const TITLE_BG     = 'EBF3FD'; // soft blue title background

function thinBorder() {
  return {
    top:    { style: 'thin', color: { argb: 'FFD1D5DB' } },
    left:   { style: 'thin', color: { argb: 'FFD1D5DB' } },
    bottom: { style: 'thin', color: { argb: 'FFD1D5DB' } },
    right:  { style: 'thin', color: { argb: 'FFD1D5DB' } },
  };
}

// Visually separates the frozen identity columns from the day columns.
function separatorBorder() {
  return {
    top:    { style: 'thin',   color: { argb: 'FFD1D5DB' } },
    left:   { style: 'thin',   color: { argb: 'FFD1D5DB' } },
    bottom: { style: 'thin',   color: { argb: 'FFD1D5DB' } },
    right:  { style: 'medium', color: { argb: 'FF94A3B8' } },
  };
}

/**
 * Build an ExcelJS workbook from a parsed roster.
 * @param {object} parsed  output of parseRoster()
 * @returns {ExcelJS.Workbook}
 */
function buildWorkbook(parsed) {
  const { employees, monthLength, legend, workArea } = parsed;
  const N = monthLength || 0;
  const totalCols = IDENTITY_COLUMNS.length + N;

  const wb = new ExcelJS.Workbook();
  wb.creator = 'Duty Roster Manager';
  wb.created = new Date();
  const ws = wb.addWorksheet('Roster', {
    views: [{ showGridLines: false, state: 'frozen', xSplit: 5, ySplit: 4 }],
    pageSetup: { printTitlesRow: '4:4', orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });

  const lastColLetter = colLetter(totalCols);

  // Row 1: merged title.
  ws.mergeCells(`A1:${lastColLetter}1`);
  const titleCell = ws.getCell('A1');
  titleCell.value = `Duty Roster Report${workArea ? ' — ' + workArea : ''}`;
  titleCell.font = { bold: true, size: 14, color: { argb: 'FF1E3A5F' } };
  titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + TITLE_BG } };
  titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
  ws.getRow(1).height = 28;

  // Row 2: merged legend.
  ws.mergeCells(`A2:${lastColLetter}2`);
  const legendCell = ws.getCell('A2');
  legendCell.value = legend || 'Legend: O = OFF   L/HL = Leave   S = Official   Y = Double Duty   All others = Regular shift';
  legendCell.font = { italic: true, size: 9.5, color: { argb: 'FF64748B' } };
  legendCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFAFCFF' } };
  legendCell.alignment = { horizontal: 'left', vertical: 'middle', indent: 1 };
  ws.getRow(2).height = 17;

  // Row 3: spacer (left blank).
  ws.getRow(3).height = 5;

  // Row 4: header row.
  const headerLabels = [...IDENTITY_COLUMNS];
  for (let d = 1; d <= N; d++) headerLabels.push(String(d));
  const headerRow = ws.getRow(4);
  headerLabels.forEach((label, i) => {
    const cell = headerRow.getCell(i + 1);
    cell.value = label;
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + HEADER_FILL } };
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
    const isLastIdentity = i === IDENTITY_COLUMNS.length - 1;
    cell.border = isLastIdentity ? separatorBorder() : thinBorder();
  });
  headerRow.height = 22;

  // Data rows start at row 5.
  employees.forEach((emp, idx) => {
    const r = 5 + idx;
    const row = ws.getRow(r);
    const isAlt = idx % 2 === 1;

    const identity = [emp.sno, emp.emp, emp.name, emp.designation, emp.workArea];
    identity.forEach((val, i) => {
      const cell = row.getCell(i + 1);
      cell.value = val === undefined || val === null ? '' : val;
      const isLastIdentity = i === IDENTITY_COLUMNS.length - 1;
      cell.border = isLastIdentity ? separatorBorder() : thinBorder();
      const leftAligned = i === 2 || i === 3;
      cell.alignment = { horizontal: leftAligned ? 'left' : 'center', vertical: 'middle', indent: leftAligned ? 1 : 0 };
      if (isAlt) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + ALT_ROW_FILL } };
    });

    for (let d = 1; d <= N; d++) {
      const cell = row.getCell(IDENTITY_COLUMNS.length + d);
      const value = emp.days[d] !== undefined ? emp.days[d] : '';
      cell.value = value;
      cell.border = thinBorder();
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
      if (value === 'O') {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + OFF_FILL } };
        cell.font = { color: { argb: 'FF' + OFF_TEXT } };
      } else if (isAlt) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + ALT_ROW_FILL } };
      }
    }
  });

  // Column widths — identity columns auto-fitted; day columns compact and uniform.
  ws.getColumn(1).width = 5.5; // S.No
  ws.getColumn(2).width = fitWidth(employees, (e) => e.emp, 'EMP#', 9, 14);
  ws.getColumn(3).width = fitWidth(employees, (e) => e.name, 'Name', 14, 30);
  ws.getColumn(4).width = fitWidth(employees, (e) => e.designation, 'Designation', 12, 24);
  ws.getColumn(5).width = fitWidth(employees, (e) => e.workArea, 'Work Area', 10, 20);
  for (let d = 1; d <= N; d++) ws.getColumn(IDENTITY_COLUMNS.length + d).width = 3.8;

  // Uniform, tidy row heights.
  for (let r = 5; r < 5 + employees.length; r++) ws.getRow(r).height = 16;

  return wb;
}

/**
 * Compute a snug column width: the longest content (or header) length plus a
 * tiny pad, clamped to [min, max]. Keeps the table compact instead of gappy.
 */
function fitWidth(employees, pick, header, min, max) {
  let longest = String(header).length;
  for (const e of employees) {
    const v = pick(e);
    const len = v === undefined || v === null ? 0 : String(v).length;
    if (len > longest) longest = len;
  }
  return Math.max(min, Math.min(max, longest + 1.5));
}

function colLetter(n) {
  // 1 -> A, 26 -> Z, 27 -> AA ...
  let s = '';
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/**
 * Write a parsed roster to an .xlsx file on disk.
 * @returns {Promise<string>} the path written.
 */
async function writeRosterFile(parsed, outputPath) {
  const wb = buildWorkbook(parsed);
  await wb.xlsx.writeFile(outputPath);
  return outputPath;
}

/** Write to an in-memory buffer (used by tests / validation). */
async function writeRosterBuffer(parsed) {
  const wb = buildWorkbook(parsed);
  return wb.xlsx.writeBuffer();
}

/**
 * Re-read a written workbook (file path or buffer) and verify every shift value
 * matches the parsed source cell-by-cell.
 * @returns {Promise<{employees:number, days:number, mismatches:number, details:Array}>}
 */
async function validateOutput(parsed, fileOrBuffer) {
  const wb = new ExcelJS.Workbook();
  if (Buffer.isBuffer(fileOrBuffer)) {
    await wb.xlsx.load(fileOrBuffer);
  } else {
    await wb.xlsx.readFile(fileOrBuffer);
  }
  const ws = wb.worksheets[0];
  const N = parsed.monthLength || 0;
  const details = [];
  let mismatches = 0;

  parsed.employees.forEach((emp, idx) => {
    const r = 5 + idx;
    const row = ws.getRow(r);

    // Sanity: EMP# column should line up.
    const writtenEmp = readCellText(row.getCell(2));
    if (writtenEmp !== emp.emp) {
      mismatches++;
      details.push(`Row ${r}: EMP# "${writtenEmp}" != "${emp.emp}"`);
    }

    for (let d = 1; d <= N; d++) {
      const expected = emp.days[d] !== undefined ? emp.days[d] : '';
      const actual = readCellText(row.getCell(IDENTITY_COLUMNS.length + d));
      if (actual !== expected) {
        mismatches++;
        details.push(`${emp.emp} day ${d}: "${actual}" != "${expected}"`);
      }
    }
  });

  return { employees: parsed.employees.length, days: N, mismatches, details };
}

function readCellText(cell) {
  const v = cell.value;
  if (v === null || v === undefined) return '';
  if (typeof v === 'object' && v.richText) return v.richText.map((t) => t.text).join('');
  if (typeof v === 'object' && 'result' in v) return String(v.result);
  return String(v).trim();
}

module.exports = {
  buildWorkbook,
  writeRosterFile,
  writeRosterBuffer,
  validateOutput,
  colLetter,
};
