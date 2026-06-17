'use strict';

/**
 * scripts/run-sample.js
 * Standalone integration check: runs samples/Duty_Roster_Report.XLS (the real
 * binary export, if present) through the full load -> parse -> write -> validate
 * pipeline and prints a summary. No Electron required.
 *
 *   node scripts/run-sample.js [path-to-file]
 */

const path = require('path');
const fs = require('fs');
const os = require('os');

const { convertFile } = require('../src/core/convert');

async function main() {
  const input = process.argv[2] || path.join(__dirname, '..', 'samples', 'Duty_Roster_Report.XLS');
  if (!fs.existsSync(input)) {
    console.error(`\n  Sample not found: ${input}`);
    console.error('  Place the real export at samples/Duty_Roster_Report.XLS and re-run.\n');
    process.exit(2);
  }

  const out = path.join(os.tmpdir(), `roster-sample-${Date.now()}.xlsx`);
  const { parsed, validation, warnings } = await convertFile(input, out);

  console.log('\n  Source     :', input);
  console.log('  Output     :', out);
  console.log('  Work area  :', parsed.workArea || '(none)');
  console.log('  Employees  :', parsed.employees.length);
  console.log('  Month days :', parsed.monthLength);
  console.log('  Validation : ✓', validation.mismatches === 0
    ? `${validation.employees} employees, ${validation.days} days, 0 mismatches`
    : `${validation.mismatches} MISMATCHES`);

  const partial = parsed.employees.filter((e) => Object.keys(e.days).length < parsed.monthLength);
  if (partial.length) {
    console.log('  Partial    :', partial.map((e) => `${e.emp}(${Object.keys(e.days).map(Number).sort((a, b) => a - b).join(',')})`).join('  '));
  }
  if (warnings.length) {
    console.log('  Warnings   :');
    warnings.forEach((w) => console.log('    -', w));
  }
  console.log('');
}

main().catch((err) => {
  console.error('\n  Failed:', err.message, '\n');
  process.exit(1);
});
