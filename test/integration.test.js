'use strict';

/**
 * integration.test.js -- exercises the REAL file pipeline: write a messy grid to
 * an actual .xlsx and .csv on disk, then run convertFile (loadGrid -> parse ->
 * write -> validate) end-to-end. This covers fileLoader/SheetJS reading, which
 * the in-memory unit tests skip.
 */

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const XLSX = require('xlsx');
const ExcelJS = require('exceljs');

const { convertFile } = require('../src/core/convert');
const { buildSampleGrid, buildRealisticRoster } = require('./fixtures/buildGrid');

function writeGridAs(grid, ext) {
  const ws = XLSX.utils.aoa_to_sheet(grid);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Roster');
  const file = path.join(os.tmpdir(), `dr-int-${process.pid}-${Date.now()}${ext}`);
  XLSX.writeFile(wb, file);
  return file;
}

test('full pipeline on a real .xlsx file: 35 employees, 30 days, 0 mismatches', async () => {
  const { employees, monthLength } = buildRealisticRoster();
  const grid = buildSampleGrid({ employees, monthLength, bandsPerSet: 2 });
  const src = writeGridAs(grid, '.xlsx');
  const out = path.join(os.tmpdir(), `dr-out-${Date.now()}.xlsx`);

  const { parsed, validation } = await convertFile(src, out);

  assert.strictEqual(parsed.employees.length, 35);
  assert.strictEqual(parsed.monthLength, 30);
  assert.strictEqual(validation.mismatches, 0, validation.details.join('\n'));
  assert.ok(fs.existsSync(out));

  // AF00072 partial month survives the real round-trip.
  const partial = parsed.employees.find((e) => e.emp === 'AF00072');
  assert.deepStrictEqual(Object.keys(partial.days).map(Number).sort((a, b) => a - b), [1, 4, 5]);

  // Confirm the written file is genuinely a styled workbook.
  const check = new ExcelJS.Workbook();
  await check.xlsx.readFile(out);
  assert.match(String(check.worksheets[0].getCell('A1').value), /^Duty Roster Report/);

  fs.unlinkSync(src); fs.unlinkSync(out);
});

test('full pipeline on a real .csv file works too', async () => {
  const { employees, monthLength } = buildRealisticRoster();
  const grid = buildSampleGrid({ employees, monthLength, bandsPerSet: 1 });
  const src = writeGridAs(grid, '.csv');
  const out = path.join(os.tmpdir(), `dr-out-csv-${Date.now()}.xlsx`);

  const { parsed, validation } = await convertFile(src, out);
  assert.strictEqual(parsed.employees.length, 35);
  assert.strictEqual(parsed.monthLength, 30);
  assert.strictEqual(validation.mismatches, 0, validation.details.join('\n'));

  fs.unlinkSync(src); fs.unlinkSync(out);
});
