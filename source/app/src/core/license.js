'use strict';
// License + trial gating. Payment provider: Polar (merchant of record).
// Public endpoints, no secret in the app: organization_id is not a secret.
const https = require('https');
const fs = require('fs');
const { productId, findProduct, DEFAULT_PRODUCT } = require('./products');
// Privacy: the activation label is generic. We never send hostnames or user names.

const POLAR_API = 'https://api.polar.sh/v1/customer-portal/license-keys';
const OFFLINE_GRACE_DAYS = 14;

function postJson(url, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = https.request(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } }, (res) => {
      let buf = '';
      res.on('data', (c) => { buf += c; });
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(buf); } catch (_) { /* non-JSON error page */ }
        resolve({ status: res.statusCode, json });
      });
    });
    req.on('error', reject);
    req.setTimeout(15000, () => req.destroy(new Error('license server timed out')));
    req.end(data);
  });
}

class LicenseStore {
  // products: () => { products, allAccess } (see products.js). Without it, any valid key unlocks all.
  constructor(file, config, { post = postJson, now = () => Date.now(), products = null } = {}) {
    this.file = file;
    this.config = config;
    this.post = post;
    this.now = now;
    this.products = products;
    this.state = { keys: [], trials: {} };
    let saved = {};
    try { saved = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { /* first run */ }
    this.state.trials = saved.trials || {};
    this.state.keys = Array.isArray(saved.keys) ? saved.keys : [];
    // v0.8 and earlier stored one key; it was always an Essentials key (benefitId null = legacy).
    if (saved.key) this.state.keys.push({ key: saved.key, activationId: saved.activationId || null, status: saved.status || 'none', lastValidAt: saved.lastValidAt || 0, benefitId: null });
  }

  save() { fs.writeFileSync(this.file, JSON.stringify(this.state, null, 2)); }

  configured() { return Boolean(this.config.polarOrganizationId); }

  fresh(k) { return k.status === 'granted' && (this.now() - k.lastValidAt) / 86400000 <= OFFLINE_GRACE_DAYS; }

  // Which products a key unlocks: its product's benefit, or every product for All-Access.
  keyUnlocks(k, pid) {
    const data = this.products && this.products();
    if (!data) return true;
    if (k.benefitId == null) return pid === DEFAULT_PRODUCT;
    if (data.allAccess && (data.allAccess.benefitIds || []).includes(k.benefitId)) return true;
    const p = findProduct(data, pid);
    return Boolean(p && (p.benefitIds || []).includes(k.benefitId));
  }

  // isPro(productId) → that product unlocked; isPro() → any license active.
  isPro(pid) {
    return this.state.keys.some((k) => this.fresh(k) && (pid === undefined || this.keyUnlocks(k, pid)));
  }

  unlockedProducts() {
    const data = this.products && this.products();
    return data ? (data.products || []).filter((p) => this.isPro(p.id)).map((p) => p.id) : (this.isPro() ? ['*'] : []);
  }

  trialsLeft(toolId) {
    const used = this.state.trials[toolId] || 0;
    return Math.max(0, (this.config.trialRuns ?? 3) - used);
  }

  canRun(spec) {
    if (spec.tier === 'free' || this.isPro(productId(spec))) return { ok: true, reason: 'licensed' };
    if (this.trialsLeft(spec.id) > 0) return { ok: true, reason: 'trial', left: this.trialsLeft(spec.id) };
    return { ok: false, reason: 'locked' };
  }

  recordRun(spec) {
    if (spec.tier === 'free' || this.isPro(productId(spec))) return;
    this.state.trials[spec.id] = (this.state.trials[spec.id] || 0) + 1;
    this.save();
  }

  async activate(key) {
    if (!this.configured()) throw new Error('Licensing is not set up yet in this build.');
    key = String(key || '').trim();
    if (!key) throw new Error('Enter your license key.');
    const org = this.config.polarOrganizationId;
    const act = await this.post(`${POLAR_API}/activate`, { key, organization_id: org, label: `GUI Hub on ${{ darwin: 'macOS', win32: 'Windows', linux: 'Linux' }[process.platform] || process.platform}` });
    let activationId = null;
    if (act.status >= 200 && act.status < 300 && act.json) activationId = act.json.id;
    else if (act.status !== 403 && act.status !== 404 && act.status !== 422) throw new Error(`License server error (HTTP ${act.status}). Try again later.`);
    // 403 from activate can mean "activations not enabled for this key"; fall through to plain validation.
    const body = { key, organization_id: org };
    if (activationId) body.activation_id = activationId;
    const val = await this.post(`${POLAR_API}/validate`, body);
    if (val.status < 200 || val.status >= 300 || !val.json) throw new Error(val.status === 404 ? 'That license key was not found.' : `License check failed (HTTP ${val.status}).`);
    if (val.json.status !== 'granted') throw new Error(`This license key is ${val.json.status}.`);
    const entry = { key, activationId, status: 'granted', lastValidAt: this.now(), benefitId: val.json.benefit_id || null };
    this.state.keys = [...this.state.keys.filter((k) => k.key !== key), entry];
    this.save();
    const data = this.products && this.products();
    return data ? (data.products || []).filter((p) => this.keyUnlocks(entry, p.id)).map((p) => p.name) : [];
  }

  // Called at startup; never blocks use while offline inside the grace window.
  async refresh() {
    if (!this.state.keys.length || !this.configured()) return this.isPro();
    for (const k of this.state.keys) {
      try {
        const body = { key: k.key, organization_id: this.config.polarOrganizationId };
        if (k.activationId) body.activation_id = k.activationId;
        const val = await this.post(`${POLAR_API}/validate`, body);
        if (val.status >= 200 && val.status < 300 && val.json) {
          k.status = val.json.status;
          if (val.json.benefit_id) k.benefitId = val.json.benefit_id;
          if (val.json.status === 'granted') k.lastValidAt = this.now();
        } else if (val.status === 404) k.status = 'revoked';
      } catch (_) { /* offline: keep cached state */ }
    }
    this.save();
    return this.isPro();
  }

  deactivate() { this.state.keys = []; this.save(); }
}

module.exports = { LicenseStore, OFFLINE_GRACE_DAYS };
