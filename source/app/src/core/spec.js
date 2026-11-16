'use strict';
// Loads and validates tool specs from the catalog directory.
// A spec lives at <catalogDir>/<id>/spec.json. Only status "live" (or "beta" in dev) specs ship.
const fs = require('fs');
const path = require('path');

const FIELD_TYPES = new Set(['text', 'password', 'textarea', 'number', 'select', 'checkbox', 'file', 'files', 'folder', 'savefile']);
const PLATFORMS = ['darwin-arm64', 'darwin-x64', 'win32-x64', 'linux-x64'];

function checkSpec(spec) {
  const problems = [];
  const need = (cond, msg) => { if (!cond) problems.push(msg); };
  need(/^[a-z0-9-]+$/.test(spec.id || ''), 'id must be lowercase slug');
  need(spec.name, 'name required');
  need(spec.tagline, 'tagline required');
  need(['free', 'pro'].includes(spec.tier), 'tier must be free|pro');
  need(spec.upstream && spec.upstream.repo && spec.upstream.license, 'upstream.repo and upstream.license required');
  need(spec.binary && spec.binary.name && spec.binary.version && spec.binary.assets, 'binary.name/version/assets required');
  if (spec.binary && spec.binary.assets) {
    for (const p of PLATFORMS) {
      const a = spec.binary.assets[p];
      need(a && a.url && a.path, `binary.assets.${p} needs url and path`);
      if (a && a.url) need(a.url.startsWith('https://'), `binary.assets.${p}.url must be https`);
    }
  }
  need(Array.isArray(spec.actions) && spec.actions.length > 0, 'at least one action');
  for (const a of spec.actions || []) {
    need(a.id && a.label, `action needs id and label`);
    const ids = new Set();
    for (const f of a.fields || []) {
      need(f.id && f.label, `field in ${a.id} needs id and label`);
      need(FIELD_TYPES.has(f.type), `field ${a.id}.${f.id} has unknown type ${f.type}`);
      need(!ids.has(f.id), `duplicate field ${a.id}.${f.id}`);
      ids.add(f.id);
      if (f.type === 'select') need(Array.isArray(f.options) && f.options.length, `select ${a.id}.${f.id} needs options`);
    }
    const walk = (items) => {
      for (const it of items || []) {
        if (typeof it === 'string') continue;
        if (it.when) { need(ids.has(it.when), `${a.id}: when references unknown field ${it.when}`); walk(it.argv); continue; }
        if (it.sql) { for (const m of it.sql.matchAll(/\{([A-Za-z0-9_]+)\}/g)) need(ids.has(m[1]), `${a.id}: sql references unknown field ${m[1]}`); continue; }
        if (it.fmt) { for (const m of it.fmt.matchAll(/\{([A-Za-z0-9_]+)(?:\|filter)?\}/g)) need(ids.has(m[1]) || m[1].startsWith('_'), `${a.id}: fmt references unknown field ${m[1]}`); continue; }
        need(ids.has(it.field), `${a.id}: argv references unknown field ${it.field}`);
      }
    };
    walk(a.argv);
    if (a.stdinField) need((a.fields || []).some((f) => f.id === a.stdinField && f.type === 'textarea'), `${a.id}: stdinField must name a textarea field`);
    for (const [k, v] of Object.entries(a.env || {})) {
      if (typeof v !== 'string') need(ids.has(v.field), `${a.id}: env ${k} references unknown field`);
    }
  }
  return problems;
}

function loadCatalog(catalogDir, { includeBeta = false } = {}) {
  const specs = [];
  const errors = [];
  if (!fs.existsSync(catalogDir)) return { specs, errors };
  for (const name of fs.readdirSync(catalogDir).sort()) {
    const file = path.join(catalogDir, name, 'spec.json');
    if (!fs.existsSync(file)) continue;
    let spec;
    try { spec = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { errors.push({ file, problems: [`invalid JSON: ${e.message}`] }); continue; }
    const problems = checkSpec(spec);
    if (problems.length) { errors.push({ file, problems }); continue; }
    if (spec.status === 'live' || (includeBeta && spec.status === 'beta')) specs.push(spec);
  }
  return { specs, errors };
}

function platformKey(platform = process.platform, arch = process.arch) {
  // Windows on ARM and Intel Macs both run x64 builds fine; keep the matrix small.
  if (platform === 'darwin') return arch === 'arm64' ? 'darwin-arm64' : 'darwin-x64';
  if (platform === 'win32') return 'win32-x64';
  return 'linux-x64';
}

module.exports = { checkSpec, loadCatalog, platformKey, PLATFORMS, FIELD_TYPES };
