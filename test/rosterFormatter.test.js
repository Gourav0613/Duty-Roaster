'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const ExcelJS = require('exceljs');

const { parseRoster } = require('../src/core/rosterParser');
const { buildWorkbook, writeRosterBuffer, validateOutput, colLetter } = require('../src/core/rosterFormatter');
const { convertGridInMemory } = require('../src/core/convert');
const { buildSampleGrid, buildRealisticRoster } = require('./fixtures/buildGrid');

test('colLetter maps column numbers to letters', () => {
  assert.strictEqual(colLetter(1), 'A');
  assert.strictEqual(colLetter(26), 'Z');
  assert.strictEqual(colLetter(27), 'AA');
  assert.strictEqual(colLetter(35), 'AI'); // 5 identity + 30 days
});

test('round-trip write + validate reports 0 mismatches (35 emp / 30 days)', async () => {
  const { employees, monthLength } = buildRealisticRoster();
  const grid = buildSampleGrid({ employees, monthLength, bandsPerSet: 2 });
  const { parsed, validation } = await convertGridInMemory(grid);

  assert.strictEqual(parsed.employees.length, 35);
  assert.strictEqual(parsed.monthLength, 30);
  assert.strictEqual(validation.employees, 35);
  assert.strictEqual(validation.days, 30);
  assert.strictEqual(validation.mismatches, 0, validation.details.join('\n'));
});

test('partial-month employee round-trips with blanks intact', async () => {
  const { employees, monthLength } = buildRealisticRoster();
  const grid = buildSampleGrid({ employees, monthLength, bandsPerSet: 2 });
  const { parsed, buffer } = await convertGridInMemory(grid);

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const ws = wb.worksheets[0];

  const idx = parsed.employees.findIndex((e) => e.emp === 'AF00072');
  const row = ws.getRow(5 + idx);
  // Identity columns 1..5, then days. Day d is at column 5 + d.
  assert.strictEqual(text(row.getCell(2)), 'AF00072');
  assert.strictEqual(text(row.getCell(5 + 1)), 'GS1'); // day 1
  assert.strictEqual(text(row.getCell(5 + 2)), '');    // day 2 blank
  assert.strictEqual(text(row.getCell(5 + 4)), 'O');   // day 4
  assert.strictEqual(text(row.getCell(5 + 5)), 'GS3'); // day 5
});

test('workbook has title, legend, styled header and freeze panes', () => {
  const { employees, monthLength } = buildRealisticRoster();
  const grid = buildSampleGrid({ employees, monthLength });
  const parsed = parseRoster(grid);
  const wb = buildWorkbook(parsed);
  const ws = wb.worksheets[0];

  assert.match(text(ws.getCell('A1')), /^Duty Roster Report/);
  assert.match(text(ws.getCell('A2')), /^Legend/);
  // header row 4
  assert.strictEqual(text(ws.getCell('A4')), 'S.No');
  assert.strictEqual(text(ws.getCell('B4')), 'EMP#');
  const hdrFill = ws.getCell('A4').fill;
  assert.strictEqual(hdrFill.fgColor.argb, 'FF1F4E78');
  // freeze panes
  assert.strictEqual(ws.views[0].xSplit, 5);
  assert.strictEqual(ws.views[0].ySplit, 4);
  assert.strictEqual(ws.views[0].showGridLines, false);
});

test('O cells are shaded gray', () => {
  const employees = [
    { emp: 'AF00072', name: 'A', designation: 'Tech', workArea: 'Plant A', shifts: { 1: 'O', 2: 'GS1' } },
  ];
  const grid = buildSampleGrid({ employees, monthLength: 28 });
  const parsed = parseRoster(grid);
  const ws = buildWorkbook(parsed).worksheets[0];
  const offCell = ws.getCell(5, 6); // row 5, day 1
  assert.strictEqual(offCell.fill.fgColor.argb, 'FFD9D9D9');
});

function text(cell) {
  const v = cell.value;
  if (v === null || v === undefined) return '';
  if (typeof v === 'object' && v.richText) return v.richText.map((t) => t.text).join('');
  return String(v).trim();
}
