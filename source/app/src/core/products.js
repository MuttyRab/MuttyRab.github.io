'use strict';
// GUI Hub is a store of products. Each product is a bundle of tools (spec.product, default
// "essentials") with its own Polar license benefit, price and checkout link. An All-Access
// benefit, when configured, unlocks every product. Data: catalog/products.json (also delivered
// remotely in catalog-v2.json so new products reach installed apps).
const fs = require('fs');
const path = require('path');

const DEFAULT_PRODUCT = 'essentials';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function loadProducts(catalogDir) {
  try { return JSON.parse(fs.readFileSync(path.join(catalogDir, 'products.json'), 'utf8')); } catch (_) { return { products: [], allAccess: null }; }
}

const productId = (spec) => (spec && spec.product) || DEFAULT_PRODUCT;
const findProduct = (data, id) => ((data && data.products) || []).find((p) => p.id === id) || null;

function productProblems(p) {
  const problems = [];
  if (!p || !/^[a-z0-9-]+$/.test(p.id || '')) problems.push('bad id');
  if (!p || typeof p.name !== 'string') problems.push('missing name');
  if (p && p.checkoutUrl && !/^https:\/\/(buy\.polar\.sh|polar\.sh)\//.test(p.checkoutUrl)) problems.push('checkoutUrl must be a Polar link');
  if (p && !(Array.isArray(p.benefitIds) && p.benefitIds.every((b) => UUID.test(b)))) problems.push('benefitIds must be UUIDs');
  return problems;
}

// Remote products override bundled ones by id; invalid entries are ignored.
function mergeProducts(bundled, remote) {
  if (!remote || !Array.isArray(remote.products)) return bundled;
  const byId = new Map((bundled.products || []).map((p) => [p.id, p]));
  for (const p of remote.products) if (!productProblems(p).length) byId.set(p.id, p);
  const aa = remote.allAccess && !productProblems({ id: 'all-access', name: 'x', ...remote.allAccess }).length ? remote.allAccess : bundled.allAccess;
  // launchFree: the site says purchases aren't open yet, so every tool runs without using a free try.
  const launchFree = typeof remote.launchFree === 'boolean' ? remote.launchFree : Boolean(bundled.launchFree);
  return { products: [...byId.values()], allAccess: aa || null, launchFree };
}

module.exports = { DEFAULT_PRODUCT, loadProducts, productId, findProduct, mergeProducts, productProblems };
