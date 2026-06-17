'use strict';

/**
 * rosterParser.js
 * -----------------------------------------------------------------------------
 * Pure, dependency-free logic that turns a messy 2-D grid (rows x columns of raw
 * cell values, exactly what SheetJS `sheet_to_json(sheet, { header: 1 })`
 * produces) into a clean, merged roster.
 *
 * The HR export splits one month across repeated horizontal "bands". Each band
 * begins with a header row containing the literal labels EMP#, Name,
 * Designation, Work Area followed by two-digit day labels. The first set of
 * bands carries days 01..27; continuation bands further down carry the rest
 * (28, 29, 30, 31 depending on the month). The same employee therefore appears
 * once per band, and we merge those partial rows back into a single record.
 *
 * NOTHING here is hardcoded to the sample file's coordinates -- every anchor is
 * detected dynamically. The coordinates mentioned in the spec are only used as
 * a mental model while reading this code.
 */

const HEADER_LABELS = {
  emp: ['emp#', 'emp #', 'empno', 'emp no', 'emp.no', 'employee#', 'employee no'],
  name: ['name', 'employee name'],
  designation: ['designation', 'desig', 'designaton'],
  workArea: ['work area', 'workarea', 'work-area', 'area'],
};

/** Normalize a cell value to a trimmed string ('' for null/undefined). */
function cellStr(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

/** Does this cell contain the EMP# header label? */
function isEmpHeaderCell(value) {
  const v = cellStr(value).toLowerCase().replace(/\s+/g, '');
  return v === 'emp#' || v === 'empno' || v === 'emp.no' || v === 'employee#';
}

/** Match one of a label's accepted spellings. */
function matchesLabel(value, accepted) {
  const v = cellStr(value).toLowerCase().replace(/\s+/g, ' ').trim();
  return accepted.some((a) => v === a);
}

/**
 * Is this an employee-ID value (e.g. "AF00072")? Used to tell a data row apart
 * from blank spacer rows, legend rows and stray text. An ID has letters
 * and/or digits and contains at least one digit; we also accept pure-digit IDs.
 */
function looksLikeEmpId(value) {
  const v = cellStr(value);
  if (!v) return false;
  if (isEmpHeaderCell(v)) return false;
  // letters optionally, then digits, then alnum -- must contain a digit, len >= 3
  return /\d/.test(v) && /^[A-Za-z0-9./-]{3,}$/.test(v) && !/\s/.test(v);
}

/** Two-digit (or one/two digit) day label in 1..31 -> the integer, else null. */
function parseDayLabel(value) {
  const v = cellStr(value);
  if (!/^\d{1,2}$/.test(v)) return null;
  const n = parseInt(v, 10);
  return n >= 1 && n <= 31 ? n : null;
}

/** First non-empty value at [col, col+1, col+2] -- absorbs merged-cell shift. */
function valueNear(row, col, span = 2) {
  if (col === -1 || col === undefined) return '';
  for (let c = col; c <= col + span; c++) {
    const v = cellStr(row[c]);
    if (v) return v;
  }
  return '';
}

/**
 * Scan a header row and return its column anchors.
 * @returns {{emp:number,name:number,designation:number,workArea:number}}
 */
function findHeaderAnchors(row) {
  const anchors = { emp: -1, name: -1, designation: -1, workArea: -1 };
  for (let c = 0; c < row.length; c++) {
    const cell = row[c];
    if (anchors.emp === -1 && isEmpHeaderCell(cell)) anchors.emp = c;
    else if (anchors.name === -1 && matchesLabel(cell, HEADER_LABELS.name)) anchors.name = c;
    else if (anchors.designation === -1 && matchesLabel(cell, HEADER_LABELS.designation)) anchors.designation = c;
    else if (anchors.workArea === -1 && matchesLabel(cell, HEADER_LABELS.workArea)) anchors.workArea = c;
  }
  return anchors;
}

/**
 * Build day-number -> column-index map for a header row. Only columns to the
 * right of the identity block are considered so we never mistake an identity
 * number for a day. If two cells claim the same day, the leftmost wins.
 */
function findDayColumns(row, anchors) {
  const dayCols = new Map();
  const identityRight = Math.max(anchors.emp, anchors.name, anchors.designation, anchors.workArea);
  const start = identityRight >= 0 ? identityRight + 1 : 0;
  for (let c = start; c < row.length; c++) {
    const day = parseDayLabel(row[c]);
    if (day !== null && !dayCols.has(day)) dayCols.set(day, c);
  }
  return dayCols;
}

/**
 * Detect every header band in the grid.
 * @returns {Array<{headerRow:number, anchors:object, dayCols:Map<number,number>}>}
 */
function detectBands(grid) {
  const bands = [];
  for (let r = 0; r < grid.length; r++) {
    const row = grid[r] || [];
    const hasEmpHeader = row.some(isEmpHeaderCell);
    if (!hasEmpHeader) continue;
    const anchors = findHeaderAnchors(row);
    if (anchors.emp === -1) continue;
    const dayCols = findDayColumns(row, anchors);
    if (dayCols.size === 0) continue; // an EMP# row with no day labels is not a real band
    bands.push({ headerRow: r, anchors, dayCols });
  }
  return bands;
}

/** Find the legend line anywhere in the sheet (first cell starting "Legend"). */
function findLegend(grid) {
  for (const row of grid) {
    if (!row) continue;
    for (const cell of row) {
      const v = cellStr(cell);
      if (/^legend\s*:/i.test(v) || /^legend\s*:-/i.test(v) || /^legend\b/i.test(v)) {
        return v;
      }
    }
  }
  return '';
}

/**
 * Extract employee rows for one band: every row from headerRow+1 up to (but not
 * including) the next band's header row (or end of grid).
 */
function extractBandRows(grid, band, nextHeaderRow) {
  const end = nextHeaderRow === undefined ? grid.length : nextHeaderRow;
  const rows = [];
  for (let r = band.headerRow + 1; r < end; r++) {
    const row = grid[r] || [];
    const empVal = cellStr(row[band.anchors.emp]);
    if (!looksLikeEmpId(empVal)) continue;

    const days = {};
    for (const [day, col] of band.dayCols.entries()) {
      const val = cellStr(row[col]);
      if (val) days[day] = val;
    }
    rows.push({
      emp: empVal,
      name: valueNear(row, band.anchors.name),
      designation: valueNear(row, band.anchors.designation),
      workArea: valueNear(row, band.anchors.workArea),
      days,
    });
  }
  return rows;
}

/**
 * Parse a full grid into a clean, merged roster.
 *
 * @param {Array<Array<any>>} grid  2-D array of raw cell values.
 * @returns {{
 *   employees: Array<{sno:number, emp:string, name:string, designation:string, workArea:string, days:Object}>,
 *   monthLength:number,
 *   legend:string,
 *   workArea:string,
 *   bands:Array,
 *   warnings:Array<string>
 * }}
 */
function parseRoster(grid) {
  if (!Array.isArray(grid)) throw new TypeError('parseRoster expects a 2-D array');

  const bands = detectBands(grid);
  const warnings = [];

  if (bands.length === 0) {
    return { employees: [], monthLength: 0, legend: '', workArea: '', bands, warnings: ['No header bands (EMP#) were found in the sheet.'] };
  }

  // Auto-detect month length N = the largest day label seen across all bands.
  let monthLength = 0;
  for (const band of bands) {
    for (const day of band.dayCols.keys()) {
      if (day > monthLength) monthLength = day;
    }
  }

  // Merge bands by EMP#, preserving first-seen order.
  const order = [];
  const byEmp = new Map();

  for (let b = 0; b < bands.length; b++) {
    const nextHeaderRow = b + 1 < bands.length ? bands[b + 1].headerRow : undefined;
    const rows = extractBandRows(grid, bands[b], nextHeaderRow);

    for (const row of rows) {
      let rec = byEmp.get(row.emp);
      if (!rec) {
        rec = {
          emp: row.emp,
          name: row.name,
          designation: row.designation,
          workArea: row.workArea,
          days: {},
        };
        byEmp.set(row.emp, rec);
        order.push(row.emp);
      } else {
        // Fill identity fields if a later band has data the first one lacked.
        if (!rec.name) rec.name = row.name;
        if (!rec.designation) rec.designation = row.designation;
        if (!rec.workArea) rec.workArea = row.workArea;
      }

      for (const [day, value] of Object.entries(row.days)) {
        const existing = rec.days[day];
        if (existing === undefined || existing === '') {
          rec.days[day] = value;
        } else if (existing !== value) {
          warnings.push(
            `Conflict for ${row.emp} on day ${day}: kept "${existing}", ignored "${value}".`
          );
        }
      }
    }
  }

  const employees = order.map((emp, i) => {
    const rec = byEmp.get(emp);
    return { sno: i + 1, ...rec };
  });

  // Title work area = first non-empty work area among employees.
  let workArea = '';
  for (const e of employees) {
    if (e.workArea) { workArea = e.workArea; break; }
  }

  return {
    employees,
    monthLength,
    legend: findLegend(grid),
    workArea,
    bands: bands.map((b) => ({ headerRow: b.headerRow, anchors: b.anchors, days: [...b.dayCols.keys()] })),
    warnings,
  };
}

module.exports = {
  parseRoster,
  // exported for unit tests:
  cellStr,
  isEmpHeaderCell,
  looksLikeEmpId,
  parseDayLabel,
  valueNear,
  findHeaderAnchors,
  findDayColumns,
  detectBands,
  findLegend,
  extractBandRows,
};
