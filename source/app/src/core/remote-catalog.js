'use strict';
// Lets new and fixed tools reach installed apps without a reinstall.
// The app fetches catalog.json from the website, accepts only specs that pass checkSpec AND
// only download from the upstream project's own GitHub releases with a pinned sha256.
// Remote specs override bundled ones by id; the last good copy is cached for offline use.
const fs = require('fs');
const https = require('https');
const { checkSpec } = require('./spec');

function remoteProblems(spec) {
  const problems = checkSpec(spec);
  if (problems.length) return problems;
  for (const [plat, a] of Object.entries(spec.binary.assets)) {
    const prefix = `https://github.com/${spec.binary.sourceRepo || spec.upstream.repo}/releases/download/`;
    if (!a.url.startsWith(prefix)) problems.push(`${plat}: remote specs may only download from ${prefix}`);
    if (!/^[0-9a-f]{64}$/.test(a.sha256 || '')) problems.push(`${plat}: remote specs need a sha256`);
  }
  return problems;
}

function mergeCatalog(bundled, remote) {
  const byId = new Map(bundled.map((s) => [s.id, s]));
  const rejected = [];
  for (const spec of (remote && remote.specs) || []) {
    const p = remoteProblems(spec);
    if (p.length) { rejected.push({ id: spec && spec.id, problems: p }); continue; }
    if (spec.status === 'live') byId.set(spec.id, spec);
    else if (spec.status === 'retired') byId.delete(spec.id);
  }
  return { specs: [...byId.values()].sort((a, b) => a.name.localeCompare(b.name)), rejected };
}

function newerVersion(latest, current) {
  const a = String(latest || '').split('.').map(Number);
  const b = String(current || '').split('.').map(Number);
  for (let i = 0; i < 3; i++) { if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) > (b[i] || 0); }
  return false;
}

function fetchJson(url, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': 'gui-hub-app', Accept: 'application/json' } }, (res) => {
      if (res.statusCode !== 200) { res.resume(); return reject(new Error(`HTTP ${res.statusCode}`)); }
      let buf = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { buf += c; if (buf.length > 5e6) req.destroy(new Error('catalog too large')); });
      res.on('end', () => { try { resolve(JSON.parse(buf)); } catch (e) { reject(e); } });
    });
    req.on('error', reject);
    req.setTimeout(timeoutMs, () => req.destroy(new Error('timeout')));
  });
}

async function loadRemote(url, cacheFile, { fetcher = fetchJson } = {}) {
  try {
    const data = await fetcher(url);
    if (!data || !Array.isArray(data.specs)) throw new Error('bad catalog');
    try { fs.writeFileSync(cacheFile, JSON.stringify(data)); } catch (_) { /* read-only disk */ }
    return data;
  } catch (_) {
    try { return JSON.parse(fs.readFileSync(cacheFile, 'utf8')); } catch (__) { return null; }
  }
}

module.exports = { mergeCatalog, remoteProblems, newerVersion, loadRemote };
