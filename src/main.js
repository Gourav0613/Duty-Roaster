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
