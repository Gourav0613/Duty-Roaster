'use strict';

/**
 * preload.js -- the only bridge between the sandboxed renderer and the main
 * process. Exposes a minimal, explicit API; no Node globals leak to the page.
 */

const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('api', {
  /** Open a native file picker. -> { filePath, fileName } | null */
  selectFile: () => ipcRenderer.invoke('select-file'),

  /** Resolve the absolute path of a drag-and-dropped File (Electron-safe). */
  getDroppedFilePath: (file) => {
    try {
      return webUtils.getPathForFile(file);
    } catch (e) {
      return file && file.path ? file.path : null;
    }
  },

  /** Convert a source file at `sourcePath`. -> result object (see main.js) */
  convertRoster: (sourcePath) => ipcRenderer.invoke('convert-roster', sourcePath),

  /** Save the last converted temp file via a native Save dialog. */
  saveOutput: (tempPath) => ipcRenderer.invoke('save-output', tempPath),

  /** Module 2: metadata of the latest formatted output. -> entry | null */
  getLatestOutput: () => ipcRenderer.invoke('get-latest-output'),

  /** Module 2: read a formatted .xlsx into rows for preview. */
  previewOutput: (filePath) => ipcRenderer.invoke('preview-output', filePath),

  /** Adapter: load saved period params (workArea, startDate, etc.) from userData. */
  adapterLoadPeriod: () => ipcRenderer.invoke('adapter-load-period'),

  /** Adapter: save period params to userData. */
  adapterSavePeriod: (period) => ipcRenderer.invoke('adapter-save-period', period),

  /** Adapter: true if a parsed-roster.json snapshot exists. */
  adapterHasParsed: () => ipcRenderer.invoke('adapter-has-parsed'),

  /**
   * Adapter: diff Excel against HIS and (optionally) push changes.
   * @param {{ dryRun: boolean, period: object }} opts
   */
  adapterSync: (opts) => ipcRenderer.invoke('adapter-sync', opts),
});
