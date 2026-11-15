#!/usr/bin/env node
'use strict';
// Starts the GUI Hub MCP server. Run by AI clients (Claude Desktop, Cursor, VS Code, ...) as:
//   command: <GUI Hub executable>, args: [<this file>], env: { ELECTRON_RUN_AS_NODE: "1" }
// or with plain Node: node mcp-entry.js. Shares license, trials and tool cache with the GUI.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { loadCatalog } = require('./core/spec');
const { LicenseStore } = require('./core/license');
const { loadRemote, mergeCatalog } = require('./core/remote-catalog');
const { createServer } = require('./core/mcp');
const { loadProducts, mergeProducts } = require('./core/products');

const appRoot = path.join(__dirname, '..');
// Packaged builds unpack src/ and config.json next to app.asar; package.json stays inside the asar
// (readable here because Electron's node mode understands asar paths).
function readJson(name) {
  for (const dir of [appRoot, appRoot.replace(/app\.asar\.unpacked$/, 'app.asar')]) {
    try { return JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8')); } catch (_) { /* try next */ }
  }
  return {};
}
const config = readJson('config.json');
const pkg = readJson('package.json');
const productName = pkg.productName || config.productName;

// Same folder Electron uses for the GUI (app.getPath('userData')).
function userDataDir() {
  if (process.env.GUIHUB_USER_DATA) return process.env.GUIHUB_USER_DATA;
  if (process.platform === 'darwin') return path.join(os.homedir(), 'Library', 'Application Support', productName);
  if (process.platform === 'win32') return path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), productName);
  return path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), productName);
}

// Packaged: <resources>/app.asar.unpacked/src -> <resources>/catalog. Dev: app/src -> repo/catalog.
function catalogDir() {
  if (process.env.GUIHUB_CATALOG) return process.env.GUIHUB_CATALOG;
  const candidates = [path.join(appRoot, 'catalog'), path.join(appRoot, '..', 'catalog'), path.join(appRoot, '..', '..', 'catalog')];
  if (process.resourcesPath) candidates.unshift(path.join(process.resourcesPath, 'catalog'));
  return candidates.find((p) => fs.existsSync(p)) || candidates[0];
}

const userDir = userDataDir();
fs.mkdirSync(path.join(userDir, 'tools'), { recursive: true });
const { specs: bundled } = loadCatalog(catalogDir(), { includeBeta: process.env.GUIHUB_BETA === '1' });
// `--product=<id>` (or GUIHUB_PRODUCT) serves only that product's tools, e.g. for a per-product listing.
const onlyProduct = (process.argv.find((a) => a.startsWith('--product=')) || '').slice(10) || process.env.GUIHUB_PRODUCT || config.product || '';
const forProduct = (list) => (onlyProduct ? list.filter((s) => (s.product || 'essentials') === onlyProduct) : list);
let specs = forProduct(bundled);
const bundledProducts = loadProducts(catalogDir());
let products = bundledProducts;
const license = new LicenseStore(path.join(userDir, 'license.json'), config, { products: () => products });

const server = createServer({
  getSpecs: () => specs,
  getProducts: () => products,
  license,
  binCache: path.join(userDir, 'tools'),
  info: { productName, version: pkg.version, checkoutUrl: config.checkoutUrl, siteUrl: config.siteUrl, price: config.price || '$9' },
});
server.start();

if (config.catalogUrl && !process.env.GUIHUB_CATALOG) {
  loadRemote(config.catalogUrl, path.join(userDir, 'catalog-cache.json'))
    .then((remote) => { if (remote) { specs = forProduct(mergeCatalog(bundled, remote).specs); products = mergeProducts(bundledProducts, remote); } })
    .catch(() => {});
}
