'use strict';

/**
 * rosterSync.js
 * -----------------------------------------------------------------------------
 * Build the `changes` array for POST /api/hr/roster/update.
 *
 * Each change uses `empNum` (the AF-code from the Excel, e.g. "AF00075").
 * The API resolves it to an internal empId automatically.
 *
 * Critical rule: only dates physically present (non-empty cell) in the parsed
 * Excel are ever included. Dates absent from the Excel are never sent.
 */

/**
 * @param {object[]} employees   parsed.employees — each has { emp, days: { <dayNum>: shiftCode } }
 * @param {string}   startDate   DD/MM/YYYY — provides month + year for full date strings
 * @param {object}   [apiRoster] optional GET /api/hr/roster response; when present,
 *                               entries already matching HIS are omitted (noop suppression).
 *                               API roster employees are keyed by empId; we skip suppression
 *                               for any employee whose empId we can't resolve.
 * @returns {{ empNum: string, date: string, shiftCode: string }[]}
 */
function buildChanges(employees, startDate, apiRoster) {
  const parts = (startDate || '').split('/');
  if (parts.length < 3) throw new Error('startDate must be in DD/MM/YYYY format');
  const mm   = parts[1].padStart(2, '0');
  const yyyy = parts[2];

  // Build lookup by empNum (AF-code) -> { 'DD/MM/YYYY': shiftCode }
  // The GET /api/hr/roster response keys employees by internal empId (e.g. "76"), not
  // by empNum (e.g. "AF00075"). Noop suppression only works when the response actually
  // carries empNum on each record. We detect that here so we never silently skip changes
  // because the key lookup returned {} instead of a real match.
  const apiShiftsByEmpNum = {};
  let hasEmpNumKeys = false;
  if (apiRoster && Array.isArray(apiRoster.employees)) {
    for (const emp of apiRoster.employees) {
      if (emp.empNum) {
        apiShiftsByEmpNum[emp.empNum] = emp.shifts || {};
        hasEmpNumKeys = true;
      }
    }
  }
  // Only treat as having useful data when we found at least one empNum-keyed entry.
  const hasApiData = hasEmpNumKeys;

  const changes = [];

  for (const employee of employees) {
    const empNum = String(employee.emp);
    const empApiShifts = apiShiftsByEmpNum[empNum] || {};

    // Iterate only over keys present in the Excel — never synthesise missing dates.
    for (const dayKey of Object.keys(employee.days)) {
      const shiftCode = String(employee.days[dayKey] || '').trim();
      if (!shiftCode) continue; // blank cell — skip

      const dd      = String(parseInt(dayKey, 10)).padStart(2, '0');
      const dateStr = `${dd}/${mm}/${yyyy}`;

      // Suppress noops when we have current HIS data for this employee
      if (hasApiData && empApiShifts[dateStr] === shiftCode) continue;

      changes.push({ empNum, date: dateStr, shiftCode });
    }
  }

  return changes;
}

module.exports = { buildChanges };
