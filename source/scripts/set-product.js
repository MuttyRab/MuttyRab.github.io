#!/usr/bin/env node
'use strict';
// Turns the app source into one product's app before packaging (used by the public release
// workflow): app name, app id, installer file names, and config.product (which limits the tools).
// usage: node set-product.js <productId> <appDir> <catalogDir>
const fs = require('fs');
const path = require('path');

const [id, appDir, catalogDir] = process.argv.slice(2);
const data = JSON.parse(fs.readFileSync(path.join(catalogDir, 'products.json'), 'utf8'));
const p = (data.products || []).find((x) => x.id === id);
if (!p) { console.error(`unknown product ${id}`); process.exit(1); }
const slug = p.name.replace(/[^A-Za-z0-9]+/g, '-'); // "GUI Hub Data" -> "GUI-Hub-Data"

const cfgFile = path.join(appDir, 'config.json');
const cfg = JSON.parse(fs.readFileSync(cfgFile, 'utf8'));
Object.assign(cfg, { product: id, productName: p.name, checkoutUrl: p.checkoutUrl || cfg.checkoutUrl, price: p.price || cfg.price });
fs.writeFileSync(cfgFile, `${JSON.stringify(cfg, null, 2)}\n`);

const pkgFile = path.join(appDir, 'package.json');
const pkg = JSON.parse(fs.readFileSync(pkgFile, 'utf8'));
pkg.productName = p.name;
pkg.build.productName = p.name;
pkg.build.appId = `cc.guihub.${id}`;
pkg.build.artifactName = `${slug}-\${os}-\${arch}.\${ext}`;
pkg.build.linux = { ...(pkg.build.linux || {}), executableName: `gui-hub-${id}` };
fs.writeFileSync(pkgFile, `${JSON.stringify(pkg, null, 2)}\n`);
console.log(`app set to ${p.name} (${id}) -> ${slug}-<os>-<arch>`);
