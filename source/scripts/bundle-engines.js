#!/usr/bin/env node
'use strict';
// Downloads every engine (binary + models) a product's tools need, for one platform, into a folder laid
// out exactly like the app's tool cache (<id>/<version>/<platform>/…). The release build ships that
// folder inside the installer, so every tool works offline straight after install.
// Usage: node scripts/bundle-engines.js <product> <outDir> [platformKey…]   (default: this machine)
const fs = require('fs');
const path = require('path');
const { loadCatalog, platformKey } = require('../app/src/core/spec');
const { ensureBinary } = require('../app/src/core/binaries');

const args = process.argv.slice(2);
const byArch = args.includes('--by-arch'); // name output folders x64/arm64 (electron-builder's ${arch})
const [product, outDir, ...keys] = args.filter((a) => !a.startsWith('--'));
if (!product || !outDir) { console.error('usage: bundle-engines.js <product> <outDir> [platformKey…]'); process.exit(2); }
const root = path.join(__dirname, '..');
const { specs } = loadCatalog(path.join(root, 'catalog'));
const mine = specs.filter((s) => s.status === 'live' && (product === 'all' || (s.product || 'essentials') === product));
const ids = new Set();
for (const s of mine) { ids.add(s.id); for (const a of s.actions || []) for (const p of [].concat(a.prepare || [])) if (p.tool) ids.add(p.tool); }
const need = [...ids].map((id) => specs.find((s) => s.id === id)).filter(Boolean);

// Archives that hold many statically linked programs (e.g. sherpa-onnx): keep only the one this tool runs,
// any shared libraries next to it, and its models (extras/).
function prune(s, root, key) {
  const { binaryPaths } = require('../app/src/core/binaries');
  const { dir, exe } = binaryPaths(s, root, key);
  const keep = new Set([path.resolve(exe)]);
  for (const f of fs.readdirSync(path.dirname(exe))) if (/\.(dll|so(\.\d+)*|dylib)$/i.test(f)) keep.add(path.resolve(path.dirname(exe), f));
  const walk = (d) => {
    for (const f of fs.readdirSync(d)) {
      const p = path.resolve(d, f);
      if (d === dir && f === 'extras') continue;
      if (fs.lstatSync(p).isDirectory()) { walk(p); if (!fs.readdirSync(p).length) fs.rmdirSync(p); } else if (!keep.has(p)) fs.rmSync(p);
    }
  };
  walk(dir);
}

// macOS code signing (strict) rejects an app bundle with a dangling symlink, or one that points outside it.
// Keep relative links inside the engine folder; copy in targets outside it; drop dangling links.
function fixLinks(top) {
  const walk = (d) => {
    for (const f of fs.readdirSync(d)) {
      const p = path.join(d, f); const st = fs.lstatSync(p);
      if (st.isSymbolicLink()) {
        let real = null; try { real = fs.realpathSync(p); } catch (e) { /* dangling */ }
        if (!real) { fs.rmSync(p); console.log(`LINK removed (dangling) ${path.relative(top, p)}`); continue; }
        const inside = real.startsWith(path.resolve(top) + path.sep) && !path.isAbsolute(fs.readlinkSync(p));
        if (!inside) { fs.rmSync(p); fs.cpSync(real, p, { recursive: true, dereference: true }); console.log(`LINK copied ${path.relative(top, p)}`); }
      } else if (st.isDirectory()) walk(p);
    }
  };
  walk(top);
}

function du(p) {
  const st = fs.lstatSync(p);
  if (!st.isDirectory()) return st.size;
  return fs.readdirSync(p).reduce((n, f) => n + du(path.join(p, f)), 0);
}

// What we redistribute, under which license, and where its source code is (GPL: plus a written offer).
function notices(list, key) {
  const support = (() => { try { return require('../app/config.json').supportEmail || ''; } catch (e) { return ''; } })();
  const lines = ['GUI Hub — third-party software shipped with this app', '',
    'GUI Hub is an independent, unofficial interface. The programs and models below are made by their own',
    'authors, are NOT modified by us, and are distributed under their own licenses (full texts in licenses/).', '',
    'Source code: every component\'s complete source is available from its project page below. For GPL/LGPL',
    `components we also offer, for three years from your download, to send the corresponding source code on request${support ? ` (${support})` : ''}`,
    'for no more than the cost of providing it.', ''];
  for (const s of list) {
    const a = s.binary.assets[key];
    lines.push(`* ${s.upstream.displayName || s.id} ${s.binary.version} — ${s.upstream.license}`, `  Project & source: ${s.upstream.homepage || `https://github.com/${s.upstream.repo}`}`, `  Binary: ${a.url}${a.sha256 ? ` (sha256 ${a.sha256})` : ''}`);
    for (const x of s.binary.extras || []) lines.push(`  Data: ${x.url}${x.sha256 ? ` (sha256 ${x.sha256})` : ''}`);
    lines.push('');
  }
  return lines.join('\n');
}
// Standard license texts (SPDX) for the licenses our engines use.
async function licenseTexts(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const ids = ['GPL-2.0-only', 'GPL-3.0-only', 'LGPL-2.1-only', 'LGPL-3.0-only', 'AGPL-3.0-only', 'Apache-2.0', 'MIT', 'BSD-2-Clause', 'BSD-3-Clause', 'MPL-2.0', 'OFL-1.1', 'Unlicense'];
  const { download } = require('../app/src/core/binaries');
  for (const id of ids) {
    const f = path.join(dir, `${id}.txt`);
    if (fs.existsSync(f)) continue;
    try { await download(`https://raw.githubusercontent.com/spdx/license-list-data/main/text/${id}.txt`, f); } catch (e) { console.error(`license text ${id}: ${e.message}`); }
  }
}

(async () => {
  let failed = 0;
  for (const key of keys.length ? keys : [platformKey()]) {
    const dir = path.join(outDir, byArch ? key.split('-').pop() : key);
    fs.mkdirSync(dir, { recursive: true });
    let total = 0;
    for (const s of need) {
      if (!s.binary.assets[key]) { console.log(`skip ${s.id}: no ${key} build`); continue; }
      try {
        await ensureBinary(s, dir, { key });
        if (s.binary.bundlePrune) prune(s, dir, key);
        const size = du(path.join(dir, s.id));
        total += size;
        console.log(`ENGINE ${product} ${key} ${s.id} ${(size / 1e6).toFixed(0)} MB`);
      } catch (e) { failed++; console.error(`FAILED ${s.id} ${key}: ${e.message}`); }
    }
    // Keep only the finished tool folders (no partial downloads).
    for (const f of fs.readdirSync(dir)) if (f.endsWith('.partial')) fs.rmSync(path.join(dir, f), { recursive: true, force: true });
    console.log(`TOTAL ${product} ${key} ${(total / 1e6).toFixed(0)} MB in ${need.length} engines`);
    fixLinks(dir);
    fs.writeFileSync(path.join(dir, 'THIRD_PARTY_NOTICES.txt'), notices(need.filter((x) => x.binary.assets[key]), key));
    await licenseTexts(path.join(dir, 'licenses'));
  }
  process.exit(failed ? 1 : 0);
})();
