'use strict';

/* renderer.js -- UI logic. Talks to the main process only via window.api. */

const $ = (sel) => document.querySelector(sel);

const state = {
  sourcePath:  null,
  tempPath:    null,
  latestPath:  null,
};

// ---------- Navigation ----------
document.querySelectorAll('.nav-item').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.nav-item').forEach((b) => b.classList.remove('active'));
    document.querySelectorAll('.module').forEach((m) => m.classList.remove('active'));
    btn.classList.add('active');
    const mod = btn.dataset.module;
    $(`#module-${mod}`).classList.add('active');
    if (mod === 'adapter') loadAdapter();
  });
});

// ---------- Module 1: file selection ----------
const dropzone = $('#dropzone');
const browseBtn = $('#browseBtn');
const convertBtn = $('#convertBtn');
const saveBtn = $('#saveBtn');

browseBtn.addEventListener('click', async () => {
  const picked = await window.api.selectFile();
  if (picked) setSource(picked.filePath, picked.fileName);
});

$('#clearFileBtn').addEventListener('click', () => {
  state.sourcePath = null;
  state.tempPath = null;
  $('#fileBar').classList.add('hidden');
  convertBtn.disabled = true;
  saveBtn.disabled = true;
  hide('#previewWrap'); hide('#status'); hide('#warnings');
});

['dragenter', 'dragover'].forEach((ev) =>
  dropzone.addEventListener(ev, (e) => { e.preventDefault(); dropzone.classList.add('drag'); })
);
['dragleave', 'drop'].forEach((ev) =>
  dropzone.addEventListener(ev, (e) => { e.preventDefault(); dropzone.classList.remove('drag'); })
);
dropzone.addEventListener('drop', (e) => {
  const file = e.dataTransfer.files && e.dataTransfer.files[0];
  if (!file) return;
  const path = window.api.getDroppedFilePath(file);
  if (!path) { showStatus('err', 'Could not read the dropped file path. Use “browse…” instead.'); return; }
  if (!/\.(xls|xlsx|csv|pdf)$/i.test(path)) {
    showStatus('err', 'Unsupported file type. Please use .xls, .xlsx, .csv or .pdf.');
    return;
  }
  setSource(path, file.name);
});

function setSource(filePath, fileName) {
  state.sourcePath = filePath;
  state.tempPath = null;
  $('#fileName').textContent = fileName;
  $('#fileBar').classList.remove('hidden');
  convertBtn.disabled = false;
  saveBtn.disabled = true;
  hide('#previewWrap'); hide('#status'); hide('#warnings');
}

// ---------- Module 1: convert ----------
convertBtn.addEventListener('click', async () => {
  if (!state.sourcePath) return;
  convertBtn.disabled = true;
  saveBtn.disabled = true;
  showStatus('info busy', 'Converting…');
  hide('#warnings');

  const res = await window.api.convertRoster(state.sourcePath);

  if (!res.ok) {
    showStatus('err', '✗ ' + res.error);
    convertBtn.disabled = false;
    return;
  }

  state.tempPath = res.tempPath;
  saveBtn.disabled = false;
  convertBtn.disabled = false;

  const v = res.validation;
  const verified = v.mismatches === 0;
  showStatus(
    verified ? 'ok' : 'err',
    verified
      ? `✓ Verified: ${v.employees} employees, ${v.days} days, 0 mismatches`
      : `✗ Validation found ${v.mismatches} mismatch(es). See console for details.`
  );
  if (!verified) console.warn('Validation details:', v.details);

  addRecentConversion($('#fileName').textContent, verified);
  renderWarnings(res.warnings);
  renderPreview(res.preview);
});

// ---------- Module 1: save ----------
saveBtn.addEventListener('click', async () => {
  if (!state.tempPath) return;
  const res = await window.api.saveOutput(state.tempPath);
  if (res.canceled) return;
  if (res.ok) showStatus('ok', '✓ Saved to ' + res.savedPath);
  else showStatus('err', '✗ ' + res.error);
});

// ---------- Rendering helpers ----------
function renderWarnings(warnings) {
  const box = $('#warnings');
  if (!warnings || warnings.length === 0) { box.classList.add('hidden'); return; }
  box.innerHTML =
    `<h4>⚠ ${warnings.length} warning(s)</h4><ul>` +
    warnings.map((w) => `<li>${escapeHtml(w)}</li>`).join('') +
    '</ul>';
  box.classList.remove('hidden');
}

function renderPreview(preview) {
  $('#previewTitle').textContent = preview.title;
  $('#previewMeta').textContent = `${preview.employeeCount} employees · ${preview.monthLength} days`;
  $('#previewLegend').textContent = preview.legend || '';
  buildTable($('#previewTable'), preview.header, preview.rows);
  $('#previewWrap').classList.remove('hidden');
}

// Cache for adapter table so it can be re-rendered when pay period month changes
const adapterTableData = { header: null, rows: null };

function getRefMonthYear() {
  const monthEl = $('#p-payPeriodMonth');
  if (monthEl && monthEl.value) {
    const [y, m] = monthEl.value.split('-').map(Number);
    return { year: y, month: m };
  }
  const now = new Date();
  return { year: now.getFullYear(), month: now.getMonth() + 1 };
}

/** Build a table; first 5 columns frozen, day columns show date + day name, weekends highlighted. */
function buildTable(table, header, rows) {
  const STICKY = 5;
  const { year, month } = getRefMonthYear();
  const sundayCols = new Set();

  const thead = document.createElement('thead');
  const htr = document.createElement('tr');
  header.forEach((h, i) => {
    const th = document.createElement('th');
    if (i < STICKY) {
      th.classList.add('sticky-col');
      th.textContent = h;
    }
    if (i === STICKY - 1) th.classList.add('sticky-last');
    if (i >= STICKY) {
      th.classList.add('day');
      const dayNum = parseInt(h);
      if (!isNaN(dayNum) && dayNum >= 1 && dayNum <= 31) {
        const d = new Date(year, month - 1, dayNum);
        const dayName = d.toLocaleDateString('en-US', { weekday: 'short' });
        th.innerHTML = `<span class="day-num">${dayNum}</span><span class="day-name">${dayName}</span>`;
        if (d.getDay() === 0) { th.classList.add('sunday'); sundayCols.add(i); }
      } else {
        th.textContent = h;
      }
    }
    htr.appendChild(th);
  });
  thead.appendChild(htr);

  const tbody = document.createElement('tbody');
  rows.forEach((row) => {
    const tr = document.createElement('tr');
    row.forEach((cell, i) => {
      const td = document.createElement('td');
      td.textContent = cell === null || cell === undefined ? '' : cell;
      if (i === 2 || i === 3) td.classList.add('left');
      if (i < STICKY) td.classList.add('sticky-col');
      if (i === STICKY - 1) td.classList.add('sticky-last');
      if (i >= STICKY) {
        td.classList.add('day');
        if (String(cell) === 'O') td.classList.add('off');
        if (sundayCols.has(i)) td.classList.add('sunday');
      }
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });

  table.innerHTML = '';
  table.appendChild(thead);
  table.appendChild(tbody);

  applyStickyOffsets(table, STICKY);
}

/** After layout, set each frozen column's left = cumulative width of those before it. */
function applyStickyOffsets(table, sticky) {
  const headCells = table.tHead ? table.tHead.rows[0].cells : [];
  const lefts = [];
  let acc = 0;
  for (let i = 0; i < sticky && i < headCells.length; i++) {
    lefts[i] = acc;
    acc += headCells[i].getBoundingClientRect().width;
  }
  const setLeft = (cell, i) => { if (i < sticky) cell.style.left = lefts[i] + 'px'; };
  for (const row of table.tHead.rows) [...row.cells].forEach(setLeft);
  for (const row of table.tBodies[0].rows) [...row.cells].forEach(setLeft);
}

// ---------- Module 2: roster card ----------
async function loadAdapter() {
  // Show content if a conversion happened this session OR a snapshot exists from a prior session.
  const hasParsed = await window.api.adapterHasParsed();
  const latest = await window.api.getLatestOutput();

  if (!hasParsed && !state.tempPath) {
    show('#adapterEmpty'); hide('#adapterContent');
    setSyncButtonsEnabled(false);
    return;
  }

  hide('#adapterEmpty'); show('#adapterContent');
  setSyncButtonsEnabled(true);

  if (latest) {
    hide('#adapterTableWrap');
    $('#viewSheetBtn').textContent = 'View Sheet';
    $('#latestName').textContent = latest.fileName;
    const when = new Date(latest.createdAt).toLocaleString();
    $('#latestSub').textContent =
      `${latest.employees} employees · ${latest.days} days · created ${when}`;
    state.latestPath = latest.path;
  }

  await loadPeriod();
}

$('#refreshLatestBtn').addEventListener('click', loadAdapter);

$('#viewSheetBtn').addEventListener('click', async () => {
  const wrap = $('#adapterTableWrap');
  if (!wrap.classList.contains('hidden')) {
    hide('#adapterTableWrap');
    $('#viewSheetBtn').textContent = 'View Sheet';
    return;
  }
  if (!state.latestPath) return;
  const res = await window.api.previewOutput(state.latestPath);
  if (res.ok) {
    const headerRowIdx = res.rows.findIndex((r) => String(r[0]).trim() === 'S.No');
    if (headerRowIdx >= 0) {
      adapterTableData.header = res.rows[headerRowIdx];
      adapterTableData.rows   = res.rows.slice(headerRowIdx + 1);
      buildTable($('#adapterTable'), adapterTableData.header, adapterTableData.rows);
    }
  }
  show('#adapterTableWrap');
  $('#viewSheetBtn').textContent = 'Hide Sheet';
});

$('#hideSheetBtn').addEventListener('click', () => {
  hide('#adapterTableWrap');
  $('#viewSheetBtn').textContent = 'View Sheet';
});

$('#downloadExcelBtn').addEventListener('click', async () => {
  if (!state.latestPath) return;
  await window.api.saveOutput(state.latestPath);
});

// ---------- Module 2: period params ----------

// Pay period formula derived from known values: Jun-2026 = 49, May-2026 = 48
// payPeriod = 43 + (year - 2026) * 12 + month  (month is 1–12)
function monthToPayPeriod(year, month) {
  return 43 + (year - 2026) * 12 + month;
}

function payPeriodToYearMonth(pp) {
  const offset = pp - 43;
  const month  = ((offset - 1) % 12) + 1;
  const year   = 2026 + Math.floor((offset - 1) / 12);
  return { year, month };
}

function isoToApiDate(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

function apiToIsoDate(ddmmyyyy) {
  if (!ddmmyyyy) return '';
  const [d, m, y] = ddmmyyyy.split('/');
  return `${y}-${m}-${d}`;
}

function updatePayPeriodFromMonth() {
  const monthEl = $('#p-payPeriodMonth');
  if (!monthEl || !monthEl.value) return;
  const [year, month] = monthEl.value.split('-').map(Number);
  const pp = monthToPayPeriod(year, month);
  $('#p-payPeriod').value = pp;

  const hint = $('#p-payPeriodHint');
  if (hint) {
    const label = new Date(year, month - 1).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
    hint.textContent = `Pay Period ${pp} (${label})`;
  }

  // Auto-fill start = 1st of month, end = last day of month
  const lastDay = new Date(year, month, 0).getDate();
  const pad = (n) => String(n).padStart(2, '0');
  $('#p-startDate').value = `${year}-${pad(month)}-01`;
  $('#p-endDate').value   = `${year}-${pad(month)}-${pad(lastDay)}`;

  // Re-render adapter table with updated day names if it is currently visible
  if (!$('#adapterTableWrap').classList.contains('hidden') && adapterTableData.header) {
    buildTable($('#adapterTable'), adapterTableData.header, adapterTableData.rows);
  }
}

$('#p-payPeriodMonth').addEventListener('change', updatePayPeriodFromMonth);

async function loadPeriod() {
  const p = await window.api.adapterLoadPeriod();
  const set = (id, val) => { const el = $(id); if (el && val != null) el.value = val; };

  if (p) {
    set('#p-workArea',  p.workArea);
    set('#p-dept',      p.dept);
    set('#p-week',      p.week);

    if (p.payPeriod != null && p.payPeriod !== '') {
      const { year, month } = payPeriodToYearMonth(Number(p.payPeriod));
      $('#p-payPeriodMonth').value = `${year}-${String(month).padStart(2, '0')}`;
    }

    // Restore saved dates only if month wasn't just set (dates may have been manually adjusted)
    if (p.startDate) set('#p-startDate', apiToIsoDate(p.startDate));
    if (p.endDate)   set('#p-endDate',   apiToIsoDate(p.endDate));
  }

  // Default month input to current month if still empty
  const monthEl = $('#p-payPeriodMonth');
  if (monthEl && !monthEl.value) {
    const now = new Date();
    monthEl.value = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  }
  updatePayPeriodFromMonth();
}

function readPeriod() {
  const v = (id) => ($(id) ? $(id).value.trim() : '');
  return {
    workArea:  v('#p-workArea'),
    dept:      v('#p-dept'),
    unit:      '1',
    payPeriod: v('#p-payPeriod'),
    startDate: isoToApiDate(v('#p-startDate')),
    endDate:   isoToApiDate(v('#p-endDate')),
    week:      v('#p-week'),
  };
}

$('#savePeriodBtn').addEventListener('click', async () => {
  const res = await window.api.adapterSavePeriod(readPeriod());
  const msg = $('#periodSavedMsg');
  if (res.ok) {
    msg.classList.remove('hidden');
    setTimeout(() => msg.classList.add('hidden'), 2000);
    appendLog('info', 'Period parameters saved.');
  }
});

// ---------- Module 2: log ----------

function nowHHMMSS() {
  return new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function appendLog(level, message) {
  const container = $('#logEntries');
  const empty = container.querySelector('.log-empty');
  if (empty) empty.remove();

  const entry = document.createElement('div');
  entry.className = 'log-entry';
  entry.innerHTML =
    `<span class="log-time">${nowHHMMSS()}</span>` +
    `<span class="log-msg log-${level}">${escapeHtml(message)}</span>`;
  container.appendChild(entry);
  container.scrollTop = container.scrollHeight;
}

$('#clearLogBtn').addEventListener('click', () => {
  $('#logEntries').innerHTML = '<span class="log-empty">No activity yet.</span>';
});

// ---------- Module 2: sync ----------

function setSyncButtonsEnabled(on) {
  $('#dryRunBtn').disabled = !on;
  $('#pushHisBtn').disabled = !on;
}

function showSyncStatus(kind, msg) {
  const el = $('#syncStatus');
  el.className = 'status ' + kind;
  el.textContent = msg;
  el.classList.remove('hidden');
}

function hideSyncStatus() { hide('#syncStatus'); }

// Friendly messages for known API error codes
const ERROR_HINTS = {
  emp_not_found:    'Employee not found in this work area / dept. Verify workArea and dept match HIS.',
  empty_roster:     'No employees matched the search criteria. Check workArea, dept, payPeriod and date range.',
  validation_error: 'Validation failed — see rows below. "empId not in this roster" means the employee exists in HIS but not under the workArea/dept/unit/payPeriod you entered. Verify those four fields.',
};

function renderSyncResult(res) {
  const wrap = $('#syncResultWrap');
  const content = $('#syncResultContent');

  if (res.noChanges) {
    content.innerHTML = `<p class="sync-ok">✓ ${escapeHtml(res.message)}</p>`;
    wrap.classList.remove('hidden');
    return;
  }

  if (!res.ok) {
    const hint = res.code ? (ERROR_HINTS[res.code] || '') : '';
    let html = `<p class="sync-err">✗ ${escapeHtml(res.error || 'Unknown error')}</p>`;
    if (hint) html += `<p class="sync-hint">${escapeHtml(hint)}</p>`;
    if (res.details && res.details.fieldErrors && res.details.fieldErrors.length) {
      const sentChanges = res.changes || [];
      html += '<ul class="sync-field-errors">';
      for (const fe of res.details.fieldErrors) {
        // API may omit empNum/shiftCode on fieldError items — fall back to our changes array
        const sent = sentChanges[fe.index] || {};
        const who  = fe.empNum || fe.empId || sent.empNum || sent.empId || '?';
        const code = fe.shiftCode || sent.shiftCode || '?';
        const date = fe.date     || sent.date       || '';
        html += `<li>Row&nbsp;${fe.index + 1} — ` +
          `<strong>${escapeHtml(who)}</strong> ` +
          `${date ? escapeHtml(date) + ' ' : ''}` +
          `shiftCode&nbsp;<strong>${escapeHtml(code)}</strong>: ${escapeHtml(fe.error)}</li>`;
      }
      html += '</ul>';
    }
    content.innerHTML = html;
    wrap.classList.remove('hidden');
    return;
  }

  const result = res.result || {};
  const changeRows = result.changes || res.changes || [];
  const isLive = !res.dryRun;

  let html = `<div class="sync-summary ${isLive ? 'sync-summary-live' : 'sync-summary-dry'}">`;
  html += isLive
    ? `✓ Pushed <strong>${result.changeCount ?? changeRows.length}</strong> change(s) to HIS`
    : `Dry run — <strong>${changeRows.length}</strong> change(s) would be written`;
  if (isLive && result.finalUrl) {
    html += `&ensp;<a class="final-url-link" href="#" title="${escapeHtml(result.finalUrl)}">view in HIS ↗</a>`;
  }
  html += '</div>';

  if (changeRows.length) {
    html += '<div class="sync-table-wrap"><table class="sync-table">';
    html += '<thead><tr><th>Emp No</th><th>Date</th><th>From</th><th>To</th><th>Noop</th></tr></thead><tbody>';
    for (const c of changeRows) {
      const noop = c.noop ? '<span class="noop-tag">noop</span>' : '';
      html += `<tr${c.noop ? ' class="row-noop"' : ''}>
        <td>${escapeHtml(String(c.empNum || c.empId || '—'))}</td>
        <td>${escapeHtml(c.date)}</td>
        <td class="shift-from">${escapeHtml(c.from || '—')}</td>
        <td class="shift-to">${escapeHtml(c.to || c.shiftCode || '—')}</td>
        <td>${noop}</td>
      </tr>`;
    }
    html += '</tbody></table></div>';
  }

  content.innerHTML = html;
  wrap.classList.remove('hidden');
}

async function runSync(dryRun) {
  const period = readPeriod();

  if (!period.workArea) {
    showSyncStatus('err', 'Work Area is required.');
    appendLog('err', 'Sync aborted — Work Area missing.');
    return;
  }
  if (!period.startDate) {
    showSyncStatus('err', 'Start Date is required (DD/MM/YYYY).');
    appendLog('err', 'Sync aborted — Start Date missing.');
    return;
  }

  const action = dryRun ? 'Dry Run' : 'Push to HIS';
  appendLog('info', `${action} started — workArea:${period.workArea} dept:${period.dept || '-'} unit:${period.unit || '-'} payPeriod:${period.payPeriod || '-'} ${period.startDate}→${period.endDate || '?'}`);
  showSyncStatus('info busy', dryRun ? 'Running dry run…' : 'Pushing to HIS…');
  hide('#syncResultWrap');
  $('#dryRunBtn').disabled = true;
  $('#pushHisBtn').disabled = true;

  const res = await window.api.adapterSync({ dryRun, period });

  $('#dryRunBtn').disabled = false;
  $('#pushHisBtn').disabled = false;

  if (res.readErr) {
    appendLog('warn', `HIS read skipped (noop suppression off): ${res.readErr}`);
  }

  if (res.ok) {
    hideSyncStatus();
    if (res.result && res.result._sendSummary) appendLog('info', `Sent: ${res.result._sendSummary}`);
    if (res.noChanges) {
      appendLog('ok', res.message);
      $('#syncBadgeText').textContent = 'Up to date';
    } else {
      const count = (res.result && res.result.changeCount) ?? (res.changes || []).length;
      if (dryRun) {
        appendLog('ok', `Dry run passed — ${count} change(s) queued. Safe to push.`);
        $('#syncBadgeText').textContent = 'Dry run passed';

        // Log noops so user can spot unexpected from values
        const noops = (res.result && res.result.changes || []).filter((c) => c.noop);
        if (noops.length) appendLog('warn', `  ${noops.length} noop(s) included (from === to)`);
      } else {
        appendLog('ok', `Pushed ${count} change(s) to HIS.`);
        if (res.result && res.result.finalUrl) {
          appendLog('info', `  finalUrl: ${res.result.finalUrl}`);
        }
        $('#syncBadgeText').textContent = 'Synced';

        for (const c of (res.result && res.result.changes) || []) {
          const tag = c.noop ? ' [noop]' : '';
          appendLog(c.noop ? 'warn' : 'ok',
            `  ${c.empNum || c.empId}  ${c.date}  ${c.from || '?'} → ${c.to || c.shiftCode}${tag}`);
        }
      }
    }
  } else {
    showSyncStatus('err', '✗ ' + (res.error || 'Sync failed'));
    appendLog('err', `${action} failed: ${res.error || 'Unknown error'}`);
    if (res.code) appendLog('err', `  code: ${res.code} — ${ERROR_HINTS[res.code] || ''}`);
    if (res.details && res.details.fieldErrors) {
      const sentChanges = res.changes || [];
      for (const fe of res.details.fieldErrors) {
        const sent = sentChanges[fe.index] || {};
        const who  = fe.empNum || fe.empId || sent.empNum || sent.empId || '?';
        const code = fe.shiftCode || sent.shiftCode || '?';
        appendLog('err', `  row ${fe.index + 1}: ${who} / ${code} — ${fe.error}`);
      }
    }
  }

  renderSyncResult(res);
}

$('#dryRunBtn').addEventListener('click', () => runSync(true));
$('#pushHisBtn').addEventListener('click', async () => {
  const ok = confirm('Push changes to HIS now?\n\nThis will write to the live system.');
  if (ok) runSync(false);
});

// ---------- Date display ----------
(function () {
  const el = document.getElementById('formatterDateText');
  if (!el) return;
  const d = new Date();
  el.textContent = d.toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'short', day: 'numeric',
  });
})();

// ---------- Recent conversions ----------
const recentList = [];

function addRecentConversion(fileName, ok) {
  const d = new Date();
  const date =
    d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) +
    ', ' +
    d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  recentList.unshift({ name: fileName, date, ok });
  if (recentList.length > 10) recentList.pop();
  renderRecentConversions();
}

function renderRecentConversions() {
  const wrap = document.getElementById('recentConversionsWrap');
  const tbody = document.getElementById('recentConversionsBody');
  if (!recentList.length) { wrap.classList.add('hidden'); return; }
  tbody.innerHTML = recentList
    .map(
      (item) =>
        `<tr>
          <td class="rc-name">[${escapeHtml(item.name)}]</td>
          <td>${escapeHtml(item.date)}</td>
          <td><span class="rc-status ${item.ok ? 'rc-ok' : 'rc-review'}">
            ${item.ok ? '✅' : '⚠️'}&nbsp;<span class="rc-label">${item.ok ? 'Complete' : 'Review'}</span>
          </span></td>
        </tr>`
    )
    .join('');
  wrap.classList.remove('hidden');
}

// ---------- tiny utils ----------
function showStatus(kind, msg) {
  const el = $('#status');
  el.className = 'status ' + kind;
  el.textContent = msg;
  el.classList.remove('hidden');
}
function show(sel) { $(sel).classList.remove('hidden'); }
function hide(sel) { $(sel).classList.add('hidden'); }
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
