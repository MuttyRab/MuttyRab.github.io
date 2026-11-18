'use strict';
// Shared start-up for the MCP server (mcp-entry.js) and the command line (cli.js): same catalog,
// license, free trials and tool cache as the desktop app, so a purchase unlocks all three.
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

// Packaged: <resources>/app.asar.unpacked/src -> <resources>/catalog. Dev: app/src -> repo/catalog.
function catalogDir() {
  if (process.env.GUIHUB_CATALOG) return process.env.GUIHUB_CATALOG;
  const candidates = [path.join(appRoot, 'catalog'), path.join(appRoot, '..', 'catalog'), path.join(appRoot, '..', '..', 'catalog')];
  if (process.resourcesPath) candidates.unshift(path.join(process.resourcesPath, 'catalog'));
  return candidates.find((p) => fs.existsSync(p)) || candidates[0];
}

function setup({ argv = process.argv, remoteTimeoutMs = 0 } = {}) {
  const config = readJson('config.json');
  const pkg = readJson('package.json');
  const productName = pkg.productName || config.productName;
  // Same folder Electron uses for the GUI (app.getPath('userData')).
  const userDir = process.env.GUIHUB_USER_DATA || (process.platform === 'darwin'
    ? path.join(os.homedir(), 'Library', 'Application Support', productName)
    : process.platform === 'win32'
      ? path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), productName)
      : path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), productName));
  fs.mkdirSync(path.join(userDir, 'tools'), { recursive: true });
  const { specs: bundled } = loadCatalog(catalogDir(), { includeBeta: process.env.GUIHUB_BETA === '1' });
  // `--product=<id>` (or GUIHUB_PRODUCT) serves only that product's tools, e.g. for a per-product listing.
  const onlyProduct = (argv.find((a) => a.startsWith('--product=')) || '').slice(10) || process.env.GUIHUB_PRODUCT || config.product || '';
  const forProduct = (list) => (onlyProduct ? list.filter((s) => (s.product || 'essentials') === onlyProduct) : list);
  let specs = forProduct(bundled);
  let allSpecs = bundled; // prepare-step helpers (FFmpeg, speaker engine…) may belong to another product
  const bundledProducts = loadProducts(catalogDir());
  let products = bundledProducts;
  const license = new LicenseStore(path.join(userDir, 'license.json'), config, { products: () => products });
  const server = createServer({
    getSpecs: () => specs,
    getAllSpecs: () => allSpecs,
    getProducts: () => products,
    license,
    binCache: [path.join(userDir, 'tools'), ...[process.resourcesPath, path.resolve(appRoot, '..'), path.resolve(appRoot, '..', '..')].filter(Boolean).map((r) => path.join(r, 'tools')).filter((p, i, a) => a.indexOf(p) === i && fs.existsSync(p))],
    info: { productName, version: pkg.version, checkoutUrl: config.checkoutUrl, siteUrl: config.siteUrl, price: config.price || '$9' },
  });
  // New and fixed tools arrive from the remote catalog without reinstalling.
  let ready = Promise.resolve();
  if (config.catalogUrl && !process.env.GUIHUB_CATALOG) {
    ready = loadRemote(config.catalogUrl, path.join(userDir, 'catalog-cache.json'))
      .then((remote) => { if (remote) { allSpecs = mergeCatalog(bundled, remote).specs; specs = forProduct(allSpecs); products = mergeProducts(bundledProducts, remote); } })
      .catch(() => {});
    if (remoteTimeoutMs) ready = Promise.race([ready, new Promise((r) => setTimeout(r, remoteTimeoutMs))]);
  }
  return { server, ready, config, pkg, productName, userDir, getProducts: () => products, getAllSpecs: () => allSpecs };
}

module.exports = { setup };
