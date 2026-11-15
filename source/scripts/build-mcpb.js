#!/usr/bin/env node
'use strict';
// Builds gui-hub.mcpb: a one-file MCP bundle (Claude Desktop "extension") that runs the GUI Hub MCP
// server with the client's bundled Node. It shares the license/trials folder with the desktop app.
// Also writes server.json for the official MCP Registry.
// usage: node build-mcpb.js <appDir> <catalogDir> <outDir> <downloadUrlBase> [productId]
// With productId: a bundle of only that product's tools (gui-hub-<id>.mcpb, server-<id>.json).
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const [appDir, catalogDir, outDir, urlBase, productId] = process.argv.slice(2);
const pkg = JSON.parse(fs.readFileSync(path.join(appDir, 'package.json'), 'utf8'));
const { loadCatalog } = require(path.resolve(appDir, 'src/core/spec'));
const { toolsFromSpecs } = require(path.resolve(appDir, 'src/core/mcp'));
const prodData = fs.existsSync(path.join(catalogDir, 'products.json')) ? JSON.parse(fs.readFileSync(path.join(catalogDir, 'products.json'), 'utf8')) : { products: [] };
const product = productId ? prodData.products.find((p) => p.id === productId) : null;
if (productId && !product) throw new Error(`unknown product ${productId}`);
const { specs: allSpecs } = loadCatalog(catalogDir);
const specs = product ? allSpecs.filter((s) => (s.product || 'essentials') === product.id) : allSpecs;
const bundleName = product ? `gui-hub-${product.id}` : 'gui-hub';
const displayName = product ? product.name : 'GUI Hub';
const tools = toolsFromSpecs(specs);
const engines = specs.map((s) => s.upstream.displayName || s.id);

const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'mcpb-'));
fs.mkdirSync(path.join(stage, 'src', 'core'), { recursive: true });
for (const f of ['mcp-entry.js']) fs.copyFileSync(path.join(appDir, 'src', f), path.join(stage, 'src', f));
for (const f of fs.readdirSync(path.join(appDir, 'src', 'core'))) fs.copyFileSync(path.join(appDir, 'src', 'core', f), path.join(stage, 'src', 'core', f));
const stageCfg = JSON.parse(fs.readFileSync(path.join(appDir, 'config.json'), 'utf8'));
if (product) Object.assign(stageCfg, { product: product.id, productName: product.name, checkoutUrl: product.checkoutUrl || stageCfg.checkoutUrl, price: product.price || stageCfg.price });
fs.writeFileSync(path.join(stage, 'config.json'), JSON.stringify(stageCfg, null, 2));
fs.writeFileSync(path.join(stage, 'package.json'), JSON.stringify({ name: pkg.name, productName: product ? product.name : pkg.productName, version: pkg.version, private: true, license: 'UNLICENSED' }, null, 2));
if (fs.existsSync(path.join(catalogDir, 'products.json'))) { fs.mkdirSync(path.join(stage, 'catalog'), { recursive: true }); fs.copyFileSync(path.join(catalogDir, 'products.json'), path.join(stage, 'catalog', 'products.json')); }
for (const s of specs) { fs.mkdirSync(path.join(stage, 'catalog', s.id), { recursive: true }); fs.writeFileSync(path.join(stage, 'catalog', s.id, 'spec.json'), JSON.stringify(s, null, 2)); }
const icon = path.join(appDir, 'build', 'icon.png');
if (fs.existsSync(icon)) fs.copyFileSync(icon, path.join(stage, 'icon.png'));

const manifest = {
  manifest_version: '0.2',
  name: bundleName,
  display_name: displayName,
  version: pkg.version,
  description: `Local tools for your AI: ${engines.join(', ')} — video, PDF, documents, renaming and file transfer, run on your computer.`,
  long_description: `GUI Hub gives Claude ${tools.length} tools backed by well-known open-source programs (${engines.join(', ')}). Each program is downloaded once from its official release and verified by SHA-256; files are processed locally and never uploaded. Every Pro tool has 3 free uses; a one-time license unlocks everything and also unlocks the GUI Hub desktop app (Windows, macOS, Linux): https://guihub.cc`,
  author: { name: 'GUI Hub', url: 'https://guihub.cc' },
  homepage: 'https://guihub.cc',
  support: 'https://guihub.cc/support.html',
  icon: fs.existsSync(icon) ? 'icon.png' : undefined,
  server: { type: 'node', entry_point: 'src/mcp-entry.js', mcp_config: { command: 'node', args: ['${__dirname}/src/mcp-entry.js'] } },
  tools: tools.map((t) => ({ name: t.name, description: t.description.slice(0, 300) })),
  keywords: [...new Set(['mcp', 'local', 'files', ...specs.flatMap((x) => [x.upstream.displayName || x.id, ...(x.keywords || [])])])].map((k) => String(k).toLowerCase()).slice(0, 40),
  license: 'Proprietary',
  compatibility: { platforms: ['darwin', 'win32', 'linux'], runtimes: { node: '>=18.0.0' } },
};
fs.writeFileSync(path.join(stage, 'manifest.json'), JSON.stringify(manifest, null, 2));
fs.mkdirSync(outDir, { recursive: true });
const out = path.resolve(outDir, `${bundleName}.mcpb`);
fs.rmSync(out, { force: true });
execFileSync('zip', ['-qr', out, '.'], { cwd: stage });
const sha = crypto.createHash('sha256').update(fs.readFileSync(out)).digest('hex');

fs.writeFileSync(path.resolve(outDir, product ? `server-${product.id}.json` : 'server.json'), JSON.stringify({
  $schema: 'https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json',
  name: product && product.id !== 'essentials' ? `io.github.MuttyRab/${bundleName}` : 'io.github.MuttyRab/gui-hub',
  title: displayName,
  description: (product ? `${product.name}: ${product.tagline}` : 'Local FFmpeg, pdfcpu, Pandoc and more for your AI: video, PDF, documents, renaming.').slice(0, 100),
  version: pkg.version,
  websiteUrl: 'https://guihub.cc',
  packages: [{ registryType: 'mcpb', identifier: `${urlBase}/${bundleName}.mcpb`, fileSha256: sha, transport: { type: 'stdio' } }],
}, null, 2));
console.log(`built ${out} (${tools.length} tools, sha256 ${sha})`);
