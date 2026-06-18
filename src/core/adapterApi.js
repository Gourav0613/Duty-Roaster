'use strict';

const https = require('https');
const http = require('http');
const { URL } = require('url');

function doRequest(method, urlStr, headers, body) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(urlStr);
    const lib = parsed.protocol === 'https:' ? https : http;
    const bodyStr = body ? JSON.stringify(body) : null;

    const options = {
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(bodyStr ? { 'Content-Length': Buffer.byteLength(bodyStr) } : {}),
        ...headers,
      },
    };

    const req = lib.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        let body;
        try { body = JSON.parse(data); } catch { body = { raw: data }; }
        resolve({ status: res.statusCode, body });
      });
    });

    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

function buildAuthHeaders(cfg) {
  return {
    'x-api-key': cfg.apiKey,
  };
}

/**
 * GET /api/hr/roster — fetch current roster from HIS.
 * @param {object} cfg  adapter config (baseUrl, apiKey, jwt + period params)
 * @returns {Promise<object>}  API response body
 */
async function readRoster(cfg) {
  const params = new URLSearchParams();
  params.set('workArea', cfg.workArea);
  const optional = ['dept', 'unit', 'payPeriod', 'payPeriodLabel', 'startDate',
                    'endDate', 'week', 'designation', 'empNum'];
  for (const k of optional) if (cfg[k]) params.set(k, cfg[k]);

  const url = `${cfg.baseUrl.replace(/\/$/, '')}/api/hr/roster?${params.toString()}`;
  const { status, body } = await doRequest('GET', url, buildAuthHeaders(cfg), null);

  if (status !== 200) {
    const msg = (body && body.error) ? body.error : `HTTP ${status}`;
    throw Object.assign(new Error(msg), { status, code: body && body.code, body });
  }
  return body;
}

/**
 * POST /api/hr/roster/update — write changes back to HIS.
 * @param {object}  cfg      adapter config
 * @param {Array}   changes  [{ empNum, date, shiftCode }]
 * @param {boolean} dryRun   when true, validates + reports but does NOT write
 * @returns {Promise<object>}
 */
async function updateRoster(cfg, changes, dryRun) {
  const url = `${cfg.baseUrl.replace(/\/$/, '')}/api/hr/roster/update`;

  const reqBody = { workArea: cfg.workArea, dryRun: Boolean(dryRun), changes };
  const optFields = ['dept', 'unit', 'payPeriod', 'startDate', 'endDate', 'week'];
  for (const k of optFields) if (cfg[k]) reqBody[k] = cfg[k];

  const { status, body } = await doRequest('POST', url, buildAuthHeaders(cfg), reqBody);

  if (status !== 200) {
    const msg = (body && body.error) ? body.error : `HTTP ${status}`;
    throw Object.assign(new Error(msg), { status, code: body && body.code, body });
  }
  return body;
}

module.exports = { readRoster, updateRoster };
