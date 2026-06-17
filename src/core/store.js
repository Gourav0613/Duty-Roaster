'use strict';

/**
 * store.js
 * -----------------------------------------------------------------------------
 * Tiny JSON-file store that remembers the latest formatted roster Module 1
 * produced, so Module 2 can pick it up. No external dependencies.
 */

const fs = require('fs');
const path = require('path');

function storePath(userDataDir) {
  return path.join(userDataDir, 'roster-store.json');
}

function readStore(userDataDir) {
  try {
    const raw = fs.readFileSync(storePath(userDataDir), 'utf8');
    return JSON.parse(raw);
  } catch (e) {
    return { latestOutput: null, history: [] };
  }
}

function writeStore(userDataDir, data) {
  fs.writeFileSync(storePath(userDataDir), JSON.stringify(data, null, 2), 'utf8');
}

/**
 * Record a freshly produced output. Keeps a short history (most recent first).
 * @param {object} entry { path, fileName, createdAt, employees, days }
 */
function recordOutput(userDataDir, entry) {
  const store = readStore(userDataDir);
  store.latestOutput = entry;
  store.history = [entry, ...(store.history || [])].slice(0, 20);
  writeStore(userDataDir, store);
  return store;
}

function getLatestOutput(userDataDir) {
  const store = readStore(userDataDir);
  const latest = store.latestOutput;
  if (latest && latest.path && fs.existsSync(latest.path)) return latest;
  return null;
}

module.exports = { readStore, writeStore, recordOutput, getLatestOutput, storePath };
