'use strict';

/**
 * convert.js
 * -----------------------------------------------------------------------------
 * High-level orchestration used by both the Electron main process and tests:
 * load -> parse -> (optionally write) -> validate.
 */

const { loadGrid } = require('./fileLoader');
const { parseRoster } = require('./rosterParser');
const { writeRosterFile, writeRosterBuffer, validateOutput } = require('./rosterFormatter');

/**
 * Parse a source file into a roster + a preview, write the formatted .xlsx to a
 * temp/target path, and validate the round-trip.
 *
 * @param {string} sourcePath  the uploaded file
 * @param {string} outputPath  where to write the formatted .xlsx
 * @returns {Promise<{parsed, validation, preview, warnings}>}
 */
async function convertFile(sourcePath, outputPath) {
  const { grid } = await loadGrid(sourcePath);
  const parsed = parseRoster(grid);

  if (parsed.employees.length === 0) {
    throw new Error('No employee rows were found. Is this the Duty Roster Report export?');
  }

  await writeRosterFile(parsed, outputPath);
  const validation = await validateOutput(parsed, outputPath);

  return {
    parsed,
    validation,
    preview: buildPreview(parsed),
    warnings: parsed.warnings,
  };
}

/** Parse + validate fully in memory (no file written) -- handy for tests. */
async function convertGridInMemory(grid) {
  const parsed = parseRoster(grid);
  const buffer = await writeRosterBuffer(parsed);
  const validation = await validateOutput(parsed, buffer);
  return { parsed, validation, buffer, preview: buildPreview(parsed) };
}

/**
 * A compact, serializable preview the renderer can render as a table without
 * needing ExcelJS in the renderer process.
 */
function buildPreview(parsed) {
  const N = parsed.monthLength;
  const header = ['S.No', 'EMP#', 'Name', 'Designation', 'Work Area'];
  for (let d = 1; d <= N; d++) header.push(String(d));

  const rows = parsed.employees.map((e) => {
    const row = [e.sno, e.emp, e.name, e.designation, e.workArea];
    for (let d = 1; d <= N; d++) row.push(e.days[d] !== undefined ? e.days[d] : '');
    return row;
  });

  return {
    title: `Duty Roster Report${parsed.workArea ? ' - ' + parsed.workArea : ''}`,
    legend: parsed.legend,
    header,
    rows,
    monthLength: N,
    employeeCount: parsed.employees.length,
  };
}

module.exports = { convertFile, convertGridInMemory, buildPreview };
