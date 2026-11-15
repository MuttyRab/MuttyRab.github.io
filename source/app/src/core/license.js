'use strict';
// License + trial gating. Payment provider: Polar (merchant of record).
// Public endpoints, no secret in the app: organization_id is not a secret.
const https = require('https');
const fs = require('fs');
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
  constructor(file, config, { post = postJson, now = () => Date.now() } = {}) {
    this.file = file;
    this.config = config;
    this.post = post;
    this.now = now;
    this.state = { key: null, activationId: null, lastValidAt: 0, status: 'none', trials: {} };
    try { Object.assign(this.state, JSON.parse(fs.readFileSync(file, 'utf8'))); } catch (_) { /* first run */ }
  }

  save() { fs.writeFileSync(this.file, JSON.stringify(this.state, null, 2)); }

  configured() { return Boolean(this.config.polarOrganizationId); }

  isPro() {
    if (this.state.status !== 'granted') return false;
    const ageDays = (this.now() - this.state.lastValidAt) / 86400000;
    return ageDays <= OFFLINE_GRACE_DAYS;
  }

  trialsLeft(toolId) {
    const used = this.state.trials[toolId] || 0;
    return Math.max(0, (this.config.trialRuns ?? 3) - used);
  }

  canRun(spec) {
    if (spec.tier === 'free' || this.isPro()) return { ok: true, reason: 'licensed' };
    if (this.trialsLeft(spec.id) > 0) return { ok: true, reason: 'trial', left: this.trialsLeft(spec.id) };
    return { ok: false, reason: 'locked' };
  }

  recordRun(spec) {
    if (spec.tier === 'free' || this.isPro()) return;
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
    Object.assign(this.state, { key, activationId, status: 'granted', lastValidAt: this.now() });
    this.save();
    return true;
  }

  // Called at startup; never blocks use while offline inside the grace window.
  async refresh() {
    if (!this.state.key || !this.configured()) return this.isPro();
    try {
      const body = { key: this.state.key, organization_id: this.config.polarOrganizationId };
      if (this.state.activationId) body.activation_id = this.state.activationId;
      const val = await this.post(`${POLAR_API}/validate`, body);
      if (val.status >= 200 && val.status < 300 && val.json) {
        this.state.status = val.json.status;
        if (val.json.status === 'granted') this.state.lastValidAt = this.now();
        this.save();
      } else if (val.status === 404) {
        this.state.status = 'revoked';
        this.save();
      }
    } catch (_) { /* offline: keep cached state */ }
    return this.isPro();
  }

  deactivate() { Object.assign(this.state, { key: null, activationId: null, status: 'none', lastValidAt: 0 }); this.save(); }
}

module.exports = { LicenseStore, OFFLINE_GRACE_DAYS };
