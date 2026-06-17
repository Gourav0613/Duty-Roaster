'use strict';

/**
 * buildGrid.js -- synthetic fixture generator that mimics the real HR export's
 * messy layout so the parser can be tested without the binary .XLS:
 *
 *   - identity anchors spread out (EMP# @2, Name @7, Designation @12,
 *     Work Area header @16 but values land @18 due to "merged cells"),
 *   - day labels starting around col 22 with an irregular step,
 *   - the month split into a first band (days 1..27) and continuation
 *     band(s) (28..N),
 *   - blank spacer rows between employees and empty padding columns.
 *
 * Each employee: { emp, name, designation, workArea, shifts: { day: code } }.
 * Omitted days stay blank (partial months).
 */

const ANCHORS = { emp: 2, name: 7, designation: 12, workAreaHeader: 16, workAreaValue: 18 };
const WIDTH = 102;

function emptyRow() {
  return new Array(WIDTH).fill('');
}

/** Day -> column map for a band with an irregular jump after day 24. */
function dayColumns(days) {
  const map = new Map();
  let col = 22;
  for (const d of days) {
    map.set(d, col);
    col += d === 24 ? 5 : 3; // irregular jump around day 25, like the real file
  }
  return map;
}

function headerRow(days) {
  const row = emptyRow();
  row[ANCHORS.emp] = 'EMP#';
  row[ANCHORS.name] = 'Name';
  row[ANCHORS.designation] = 'Designation';
  row[ANCHORS.workAreaHeader] = 'Work Area';
  const cols = dayColumns(days);
  for (const [d, c] of cols.entries()) {
    row[c] = String(d).padStart(2, '0'); // two-digit labels "01".."31"
  }
  return { row, cols };
}

function employeeRow(emp, days, cols) {
  const row = emptyRow();
  row[ANCHORS.emp] = emp.emp;
  row[ANCHORS.name] = emp.name;
  row[ANCHORS.designation] = emp.designation;
  // Work Area value lands two columns right of its header (merged-cell shift).
  row[ANCHORS.workAreaValue] = emp.workArea;
  for (const d of days) {
    const v = emp.shifts ? emp.shifts[d] : undefined;
    if (v !== undefined && v !== null && v !== '') row[cols.get(d)] = v;
  }
  return row;
}

/**
 * @param {object} opts
 *   monthLength {number} 28..31
 *   employees   {Array}
 *   legend      {string}
 *   bandsPerSet {number} how many sub-bands to split employees into per day-set
 */
function buildSampleGrid(opts) {
  const monthLength = opts.monthLength || 30;
  const employees = opts.employees || [];
  const legend = opts.legend || 'Legend :- O: OFF; L/HL: Leave; S: Offical; Y: Double Duty; All others regular shifts;';
  const bandsPerSet = opts.bandsPerSet || 1;

  const grid = [];
  // Top padding + title + legend.
  grid.push(emptyRow());
  const titleRow = emptyRow();
  titleRow[2] = 'Duty Roster Report';
  grid.push(titleRow);
  const legendRow = emptyRow();
  legendRow[2] = legend;
  grid.push(legendRow);
  grid.push(emptyRow());

  // Split employees into chunks (one chunk per sub-band).
  const chunks = chunk(employees, Math.ceil(employees.length / bandsPerSet) || 1);

  const firstDays = range(1, Math.min(27, monthLength));
  const contDays = monthLength > 27 ? range(28, monthLength) : [];

  const daySets = contDays.length ? [firstDays, contDays] : [firstDays];

  for (const days of daySets) {
    for (const ch of chunks) {
      const { row, cols } = headerRow(days);
      grid.push(row);
      grid.push(emptyRow()); // spacer under header
      for (const emp of ch) {
        grid.push(employeeRow(emp, days, cols));
        grid.push(emptyRow()); // blank spacer row between employees
      }
      grid.push(emptyRow());
      grid.push(emptyRow());
    }
  }

  return grid;
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out.length ? out : [[]];
}

function range(a, b) {
  const out = [];
  for (let i = a; i <= b; i++) out.push(i);
  return out;
}

/** A realistic 35-employee, 30-day roster with one partial-month employee. */
function buildRealisticRoster() {
  const codes = ['GS1', 'GS3', 'GS5', 'E1', 'E2', 'M1', 'MS7', 'MS8', 'MS9', 'NS1', 'NO', 'O'];
  const employees = [];
  for (let i = 0; i < 35; i++) {
    const emp = `AF${String(72 + i).padStart(5, '0')}`;
    const shifts = {};
    if (i === 0) {
      // AF00072 -- partial month: only days 1, 4, 5 filled.
      shifts[1] = 'GS1';
      shifts[4] = 'O';
      shifts[5] = 'GS3';
    } else {
      for (let d = 1; d <= 30; d++) shifts[d] = codes[(i + d) % codes.length];
    }
    employees.push({
      emp,
      name: `Employee ${i + 1}`,
      designation: i % 3 === 0 ? 'Technician' : 'Operator',
      workArea: 'Plant A',
      shifts,
    });
  }
  return { employees, monthLength: 30 };
}

module.exports = { buildSampleGrid, buildRealisticRoster, ANCHORS, WIDTH, dayColumns, range };
