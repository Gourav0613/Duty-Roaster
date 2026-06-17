'use strict';

const { test } = require('node:test');
const assert = require('node:assert');

const {
  parseRoster,
  detectBands,
  findHeaderAnchors,
  findDayColumns,
  looksLikeEmpId,
  parseDayLabel,
  valueNear,
  findLegend,
} = require('../src/core/rosterParser');
const { buildSampleGrid, buildRealisticRoster } = require('./fixtures/buildGrid');

test('parseDayLabel accepts 01..31 and rejects others', () => {
  assert.strictEqual(parseDayLabel('01'), 1);
  assert.strictEqual(parseDayLabel('27'), 27);
  assert.strictEqual(parseDayLabel('31'), 31);
  assert.strictEqual(parseDayLabel('00'), null);
  assert.strictEqual(parseDayLabel('32'), null);
  assert.strictEqual(parseDayLabel('GS1'), null);
  assert.strictEqual(parseDayLabel(''), null);
});

test('looksLikeEmpId distinguishes IDs from headers/blanks/legend', () => {
  assert.ok(looksLikeEmpId('AF00072'));
  assert.ok(looksLikeEmpId('12345'));
  assert.ok(!looksLikeEmpId('EMP#'));
  assert.ok(!looksLikeEmpId(''));
  assert.ok(!looksLikeEmpId('Name'));
  assert.ok(!looksLikeEmpId('Legend :- O: OFF'));
});

test('valueNear absorbs merged-cell shift', () => {
  const row = [];
  row[16] = ''; // header col
  row[18] = 'Plant A'; // value shifted two cols right
  assert.strictEqual(valueNear(row, 16), 'Plant A');
});

test('detectBands finds both day-sets (band split) ', () => {
  const { employees, monthLength } = buildRealisticRoster();
  const grid = buildSampleGrid({ employees, monthLength, bandsPerSet: 2 });
  const bands = detectBands(grid);
  // 2 sub-bands per set x 2 day-sets (days 1..27 and 28..30) = 4 bands.
  assert.strictEqual(bands.length, 4);
  // First two bands carry days up to 27; last two carry 28..30.
  assert.ok(Math.max(...bands[0].dayCols.keys()) <= 27);
  assert.deepStrictEqual([...bands[3].dayCols.keys()], [28, 29, 30]);
});

test('findHeaderAnchors locates spread-out identity columns', () => {
  const grid = buildSampleGrid({ ...buildRealisticRoster() });
  const headerRowIdx = grid.findIndex((r) => r.includes('EMP#'));
  const anchors = findHeaderAnchors(grid[headerRowIdx]);
  assert.strictEqual(anchors.emp, 2);
  assert.strictEqual(anchors.name, 7);
  assert.strictEqual(anchors.designation, 12);
  assert.strictEqual(anchors.workArea, 16);
});

test('findDayColumns ignores identity numbers and maps every day', () => {
  const grid = buildSampleGrid({ ...buildRealisticRoster() });
  const headerRowIdx = grid.findIndex((r) => r.includes('EMP#'));
  const anchors = findHeaderAnchors(grid[headerRowIdx]);
  const cols = findDayColumns(grid[headerRowIdx], anchors);
  assert.deepStrictEqual([...cols.keys()], Array.from({ length: 27 }, (_, i) => i + 1));
  // all columns to the right of the identity block
  for (const c of cols.values()) assert.ok(c > anchors.workArea);
});

for (const N of [28, 29, 30, 31]) {
  test(`auto-detects ${N}-day month`, () => {
    const employees = [
      { emp: 'AF00072', name: 'A', designation: 'Tech', workArea: 'Plant A', shifts: fullMonth(N) },
      { emp: 'AF00073', name: 'B', designation: 'Op', workArea: 'Plant A', shifts: fullMonth(N) },
    ];
    const grid = buildSampleGrid({ employees, monthLength: N });
    const parsed = parseRoster(grid);
    assert.strictEqual(parsed.monthLength, N);
    assert.strictEqual(parsed.employees.length, 2);
    // every day present
    assert.strictEqual(Object.keys(parsed.employees[0].days).length, N);
  });
}

test('merges bands into one record per employee, preserving order', () => {
  const { employees, monthLength } = buildRealisticRoster();
  const grid = buildSampleGrid({ employees, monthLength, bandsPerSet: 3 });
  const parsed = parseRoster(grid);
  assert.strictEqual(parsed.employees.length, 35);
  assert.strictEqual(parsed.employees[0].emp, 'AF00072');
  assert.strictEqual(parsed.employees[34].emp, 'AF00106');
  // Each non-partial employee has all 30 days after merge.
  const full = parsed.employees[1];
  assert.strictEqual(Object.keys(full.days).length, 30);
  assert.ok(full.days[1] && full.days[28] && full.days[30]);
});

test('partial-month employee keeps blanks (AF00072: only days 1,4,5)', () => {
  const { employees, monthLength } = buildRealisticRoster();
  const grid = buildSampleGrid({ employees, monthLength, bandsPerSet: 2 });
  const parsed = parseRoster(grid);
  const partial = parsed.employees.find((e) => e.emp === 'AF00072');
  assert.deepStrictEqual(Object.keys(partial.days).map(Number).sort((a, b) => a - b), [1, 4, 5]);
  assert.strictEqual(partial.days[1], 'GS1');
  assert.strictEqual(partial.days[4], 'O');
  assert.strictEqual(partial.days[5], 'GS3');
  assert.strictEqual(partial.days[2], undefined); // blank stays blank
});

test('conflicting non-empty values across bands produce a warning and keep first', () => {
  // Two bands, same day overlap with different values.
  const grid = [];
  const W = 40;
  const blank = () => new Array(W).fill('');
  // Band 1: header with day 1 @ col 22
  const h1 = blank(); h1[2] = 'EMP#'; h1[7] = 'Name'; h1[12] = 'Designation'; h1[16] = 'Work Area'; h1[22] = '01';
  grid.push(h1);
  const e1 = blank(); e1[2] = 'AF00072'; e1[7] = 'Alice'; e1[18] = 'Plant A'; e1[22] = 'GS1';
  grid.push(e1);
  grid.push(blank());
  // Band 2: same day 1 but different value
  const h2 = blank(); h2[2] = 'EMP#'; h2[7] = 'Name'; h2[12] = 'Designation'; h2[16] = 'Work Area'; h2[22] = '01';
  grid.push(h2);
  const e2 = blank(); e2[2] = 'AF00072'; e2[7] = 'Alice'; e2[18] = 'Plant A'; e2[22] = 'NS1';
  grid.push(e2);

  const parsed = parseRoster(grid);
  assert.strictEqual(parsed.employees.length, 1);
  assert.strictEqual(parsed.employees[0].days[1], 'GS1'); // first kept
  assert.strictEqual(parsed.warnings.length, 1);
  assert.match(parsed.warnings[0], /Conflict for AF00072 on day 1/);
});

test('findLegend captures the legend line', () => {
  const { employees, monthLength } = buildRealisticRoster();
  const grid = buildSampleGrid({ employees, monthLength });
  assert.match(findLegend(grid), /^Legend\s*:-/);
});

test('empty / non-roster grid degrades gracefully', () => {
  const parsed = parseRoster([['hello', 'world'], ['', '']]);
  assert.strictEqual(parsed.employees.length, 0);
  assert.strictEqual(parsed.monthLength, 0);
  assert.ok(parsed.warnings.length >= 1);
});

function fullMonth(N) {
  const codes = ['GS1', 'E1', 'M1', 'NS1', 'O'];
  const s = {};
  for (let d = 1; d <= N; d++) s[d] = codes[d % codes.length];
  return s;
}
