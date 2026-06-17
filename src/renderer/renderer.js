'use strict';

/* renderer.js -- UI logic. Talks to the main process only via window.api. */

const $ = (sel) => document.querySelector(sel);

const state = {
  sourcePath: null,
  tempPath: null,
  latestPath: null,
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

/** Build a table; first 5 columns frozen, `O` cells styled, names left-aligned. */
function buildTable(table, header, rows) {
  const STICKY = 5;
  const thead = document.createElement('thead');
  const htr = document.createElement('tr');
  header.forEach((h, i) => {
    const th = document.createElement('th');
    th.textContent = h;
    if (i < STICKY) th.classList.add('sticky-col');
    if (i === STICKY - 1) th.classList.add('sticky-last');
    if (i >= STICKY) th.classList.add('day');
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
      if (i >= STICKY) { td.classList.add('day'); if (String(cell) === 'O') td.classList.add('off'); }
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });

  table.innerHTML = '';
  table.appendChild(thead);
  table.appendChild(tbody);

  // Freeze the identity columns using REAL measured widths so there are no gaps
  // or overlaps regardless of content length.
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

// ---------- Module 2 ----------
async function loadAdapter() {
  // Only surface stored output if something was converted this session.
  if (!state.tempPath) {
    show('#adapterEmpty'); hide('#adapterContent');
    return;
  }
  const latest = await window.api.getLatestOutput();
  if (!latest) {
    show('#adapterEmpty'); hide('#adapterContent');
    return;
  }
  hide('#adapterEmpty'); show('#adapterContent');
  hide('#adapterTableWrap');
  $('#viewSheetBtn').textContent = 'View Sheet';
  $('#latestName').textContent = latest.fileName;
  const when = new Date(latest.createdAt).toLocaleString();
  $('#latestSub').textContent =
    `${latest.employees} employees · ${latest.days} days · created ${when}`;
  state.latestPath = latest.path;
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
      buildTable($('#adapterTable'), res.rows[headerRowIdx], res.rows.slice(headerRowIdx + 1));
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
