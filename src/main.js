'use strict';

/**
 * main.js -- Electron main process.
 * All file I/O and parsing happen here; the renderer talks to us only through
 * the contextBridge API defined in preload.js.
 */

const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');

const { convertFile } = require('./core/convert');
const { recordOutput, getLatestOutput } = require('./core/store');
const { readRoster, updateRoster } = require('./core/adapterApi');
const { buildChanges } = require('./core/rosterSync');
const adapterConfig = require('./core/adapterConfig');

const DEFAULT_OUTPUT_NAME = 'Duty_Roster_Formatted.xlsx';

let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: 'Duty Roster Manager',
    backgroundColor: '#f4f6fb',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });

  mainWindow.removeMenu();
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

/** Where the auto-saved userData copy lives. */
function userDataDir() {
  return app.getPath('userData');
}

// ---------------------------------------------------------------------------
// IPC handlers
// ---------------------------------------------------------------------------

ipcMain.handle('select-file', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Select a Duty Roster export',
    properties: ['openFile'],
    filters: [
      { name: 'Roster files', extensions: ['xls', 'xlsx', 'csv', 'pdf'] },
      { name: 'All files', extensions: ['*'] },
    ],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  const filePath = result.filePaths[0];
  return { filePath, fileName: path.basename(filePath) };
});

/**
 * Convert a source file. Writes the formatted .xlsx to a temp path, validates
 * it, auto-saves a copy to userData, records it for Module 2, and returns a
 * serializable preview + validation summary to the renderer.
 */
ipcMain.handle('convert-roster', async (_evt, sourcePath) => {
  try {
    if (!sourcePath || !fs.existsSync(sourcePath)) {
      return { ok: false, error: 'The selected file no longer exists.' };
    }

    const tempPath = path.join(app.getPath('temp'), `roster-${process.pid}-${Date.now()}.xlsx`);
    const { parsed, validation, preview, warnings } = await convertFile(sourcePath, tempPath);

    // Auto-save a copy into userData and remember it for Module 2.
    const savedPath = path.join(userDataDir(), DEFAULT_OUTPUT_NAME);
    fs.copyFileSync(tempPath, savedPath);

    const entry = {
      path: savedPath,
      fileName: DEFAULT_OUTPUT_NAME,
      createdAt: new Date().toISOString(),
      employees: parsed.employees.length,
      days: parsed.monthLength,
      workArea: parsed.workArea,
    };
    recordOutput(userDataDir(), entry);

    // Persist minimal parsed data for the Adapter Automation module.
    const parsedSnapshot = {
      employees: parsed.employees.map((e) => ({ emp: e.emp, name: e.name, days: e.days })),
      monthLength: parsed.monthLength,
      workArea: parsed.workArea,
      savedAt: new Date().toISOString(),
    };
    fs.writeFileSync(
      path.join(userDataDir(), 'parsed-roster.json'),
      JSON.stringify(parsedSnapshot, null, 2),
      'utf8'
    );

    return {
      ok: true,
      tempPath,
      savedPath,
      preview,
      validation,
      warnings,
      summary: {
        employees: parsed.employees.length,
        days: parsed.monthLength,
        workArea: parsed.workArea,
        legend: parsed.legend,
      },
    };
  } catch (err) {
    return { ok: false, error: err && err.message ? err.message : String(err) };
  }
});

/** Save the already-converted temp file to a user-chosen location. */
ipcMain.handle('save-output', async (_evt, tempPath) => {
  try {
    if (!tempPath || !fs.existsSync(tempPath)) {
      return { ok: false, error: 'Nothing to save -- convert a file first.' };
    }
    const result = await dialog.showSaveDialog(mainWindow, {
      title: 'Save formatted roster',
      defaultPath: DEFAULT_OUTPUT_NAME,
      filters: [{ name: 'Excel Workbook', extensions: ['xlsx'] }],
    });
    if (result.canceled || !result.filePath) return { ok: false, canceled: true };
    fs.copyFileSync(tempPath, result.filePath);
    return { ok: true, savedPath: result.filePath };
  } catch (err) {
    return { ok: false, error: err && err.message ? err.message : String(err) };
  }
});

/** Module 2: latest formatted output (path + metadata) or null. */
ipcMain.handle('get-latest-output', async () => {
  return getLatestOutput(userDataDir());
});

// ---------------------------------------------------------------------------
// Adapter Automation IPC handlers
// ---------------------------------------------------------------------------

const PARSED_ROSTER_FILE = 'parsed-roster.json';
const PERIOD_FILE = 'adapter-period.json';

/** Persist period params (workArea, dept, unit, etc.) to userData. */
ipcMain.handle('adapter-save-period', async (_evt, period) => {
  try {
    fs.writeFileSync(
      path.join(userDataDir(), PERIOD_FILE),
      JSON.stringify(period, null, 2),
      'utf8'
    );
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

/** Load saved period params. */
ipcMain.handle('adapter-load-period', async () => {
  try {
    const p = path.join(userDataDir(), PERIOD_FILE);
    if (!fs.existsSync(p)) return null;
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
});

/** True if a parsed-roster.json snapshot exists (works cross-session). */
ipcMain.handle('adapter-has-parsed', async () => {
  return fs.existsSync(path.join(userDataDir(), PARSED_ROSTER_FILE));
});

/**
 * Build changes from the saved parsed roster and call the HIS update endpoint.
 * Credentials come from adapterConfig.js (hardcoded).
 * Only dates present (non-empty) in the Excel are ever included.
 */
ipcMain.handle('adapter-sync', async (_evt, { dryRun, period }) => {
  let changes = null; // hoisted so catch can include it in error response
  try {
    const parsedPath = path.join(userDataDir(), PARSED_ROSTER_FILE);
    if (!fs.existsSync(parsedPath)) {
      return { ok: false, error: 'No formatted roster found. Convert a file in Roster Formatter first.' };
    }

    const creds = adapterConfig;
    if (!creds.BASE_URL || creds.BASE_URL.includes('your-his-server') ||
        !creds.API_KEY || creds.API_KEY === 'PASTE_YOUR_API_KEY_HERE') {
      return { ok: false, error: 'API credentials not configured. Edit src/core/adapterConfig.js and set BASE_URL and API_KEY.' };
    }

    if (!period || !period.workArea) {
      return { ok: false, error: 'Work Area is required.' };
    }
    if (!period.startDate) {
      return { ok: false, error: 'Start Date is required (DD/MM/YYYY).' };
    }

    // Merge hardcoded credentials with the per-run period params
    const cfg = {
      baseUrl:   creds.BASE_URL,
      apiKey:    creds.API_KEY,
      workArea:  period.workArea,
      dept:      period.dept      || '',
      unit:      period.unit      || '',
      payPeriod: period.payPeriod || '',
      startDate: period.startDate,
      endDate:   period.endDate   || '',
      week:      period.week      || '',
    };

    const saved = JSON.parse(fs.readFileSync(parsedPath, 'utf8'));

    // Try to fetch current HIS data for noop suppression; non-fatal if it fails.
    let apiRoster = null;
    let readErr = null;
    try {
      apiRoster = await readRoster(cfg);
    } catch (e) {
      readErr = e.message || String(e);
    }

    changes = buildChanges(saved.employees, cfg.startDate, apiRoster);

    // Guard: if emp values are missing the snapshot is stale — tell user to re-convert.
    const badEmp = changes.filter((c) => !c.empNum || c.empNum === 'undefined');
    if (badEmp.length > 0) {
      return {
        ok: false,
        error: `${badEmp.length} employee(s) have no EMP# in the saved roster snapshot. Please re-convert your Excel file in the Roster Formatter tab, then try again.`,
      };
    }

    if (changes.length === 0) {
      return { ok: true, noChanges: true, message: 'All Excel dates already match HIS — nothing to update.', readErr };
    }

    // Surface a compact summary so the log shows what is being sent.
    const empNums = [...new Set(changes.map((c) => c.empNum))];
    const sendSummary = `${changes.length} change(s) for ${empNums.length} employee(s): ${empNums.slice(0, 5).join(', ')}${empNums.length > 5 ? ' …' : ''}`;

    const result = await updateRoster(cfg, changes, dryRun);
    result._sendSummary = sendSummary;

    // Rule: saved: false even with HTTP 200 = HIS did not commit — treat as failure.
    if (!dryRun && result.saved === false) {
      return {
        ok: false,
        error: 'HIS accepted the request but did not save (saved: false). Check HIS logs.',
        result,
        readErr,
      };
    }

    return { ok: true, dryRun: Boolean(dryRun), changes, result, readErr };
  } catch (err) {
    const out = { ok: false, error: err.message || String(err) };
    if (err.code)    out.code    = err.code;
    if (err.body)    out.details = err.body;
    if (changes)     out.changes = changes;
    return out;
  }
});

/** Module 2: read a formatted .xlsx back into a preview table. */
ipcMain.handle('preview-output', async (_evt, filePath) => {
  try {
    const target = filePath || (getLatestOutput(userDataDir()) || {}).path;
    if (!target || !fs.existsSync(target)) return { ok: false, error: 'No formatted roster found.' };
    const ExcelJS = require('exceljs');
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(target);
    const ws = wb.worksheets[0];
    const rows = [];
    ws.eachRow({ includeEmpty: false }, (row) => {
      const values = [];
      row.eachCell({ includeEmpty: true }, (cell) => {
        const v = cell.value;
        values.push(v === null || v === undefined ? '' : (typeof v === 'object' ? (v.richText ? v.richText.map((t) => t.text).join('') : (v.result ?? '')) : v));
      });
      rows.push(values);
    });
    return { ok: true, rows };
  } catch (err) {
    return { ok: false, error: err && err.message ? err.message : String(err) };
  }
});
