'use strict';
const fs = require('fs');
const { net } = require('electron');

// Downloads go through Chromium's network stack first (system proxy, VPN and certificate settings,
// like the browser), then Node's as a fallback; binaries.js retries each and explains failures.
function netDownload(url, dest, onProgress) {
  return new Promise((resolve, reject) => {
    let done = false; let stall;
    const fail = (e) => { if (!done) { done = true; clearTimeout(stall); reject(e); } };
    const arm = () => { clearTimeout(stall); stall = setTimeout(() => { try { req.abort(); } catch (_) { /* gone */ } fail(new Error('download timed out')); }, 60000); };
    const req = net.request({ url, redirect: 'follow', useSessionCookies: false });
    req.setHeader('User-Agent', 'gui-hub-app');
    req.on('response', (res) => {
      if (res.statusCode !== 200) { res.on('data', () => {}); return fail(new Error(`download failed: HTTP ${res.statusCode} for ${url}`)); }
      const len = [].concat(res.headers['content-length'] || [])[0];
      const total = Number(len) || 0; let got = 0;
      const out = fs.createWriteStream(dest);
      res.on('data', (c) => { arm(); got += c.length; out.write(c); if (onProgress) onProgress(got, total); });
      res.on('end', () => out.end(() => { if (!done) { done = true; clearTimeout(stall); resolve(dest); } }));
      res.on('error', fail); out.on('error', fail);
    });
    req.on('error', fail);
    arm(); req.end();
  });
}
module.exports = { netDownload };
