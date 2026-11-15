'use strict';
// Downloads the official upstream binary on first use, verifies it, and caches it.
// We never redistribute upstream code inside our installer.
const fs = require('fs');
const path = require('path');
const https = require('https');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { platformKey } = require('./spec');

function download(url, dest, onProgress, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 8) return reject(new Error('too many redirects'));
    const req = https.get(url, { headers: { 'User-Agent': 'gui-hub-app' } }, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        res.resume();
        const next = new URL(res.headers.location, url).toString();
        return resolve(download(next, dest, onProgress, redirects + 1));
      }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error(`download failed: HTTP ${res.statusCode} for ${url}`)); }
      const total = Number(res.headers['content-length']) || 0;
      let got = 0;
      const out = fs.createWriteStream(dest);
      res.on('data', (c) => { got += c.length; if (onProgress) onProgress(got, total); });
      res.pipe(out);
      out.on('finish', () => out.close(() => resolve(dest)));
      out.on('error', reject);
      res.on('error', reject);
    });
    req.on('error', reject);
    req.setTimeout(60000, () => req.destroy(new Error('download timed out')));
  });
}

function sha256(file) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha256');
    fs.createReadStream(file).on('data', (d) => h.update(d)).on('end', () => resolve(h.digest('hex'))).on('error', reject);
  });
}

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { ...opts, windowsHide: true });
    let err = '';
    p.stderr.on('data', (d) => { err += d; });
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} exited ${code}: ${err.trim()}`))));
  });
}

// bsdtar (macOS, Windows 10+) handles zip/tar.gz/tar.xz; GNU tar on Linux handles tar.*.
async function extract(archive, destDir) {
  fs.mkdirSync(destDir, { recursive: true });
  if (/\.zip$/i.test(archive) && process.platform === 'linux') return run('unzip', ['-o', '-q', archive, '-d', destDir]);
  // On Windows use the system bsdtar explicitly; a Git-for-Windows GNU tar earlier on PATH cannot read zip.
  const tar = process.platform === 'win32' ? path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe') : 'tar';
  return run(tar, ['-xf', archive, '-C', destDir]);
}

function findFile(dir, name, depth = 0) {
  if (depth > 4) return null;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isFile() && ent.name === name) return p;
    if (ent.isDirectory()) { const r = findFile(p, name, depth + 1); if (r) return r; }
  }
  return null;
}

function binaryPaths(spec, cacheRoot, key = platformKey()) {
  const asset = spec.binary.assets[key];
  if (!asset) throw new Error(`${spec.name} is not available for ${key}`);
  const dir = path.join(cacheRoot, spec.id, spec.binary.version, key);
  return { asset, dir, exe: path.join(dir, asset.path) };
}

function isInstalled(spec, cacheRoot, key) {
  const { exe } = binaryPaths(spec, cacheRoot, key);
  return fs.existsSync(exe);
}

async function ensureBinary(spec, cacheRoot, { onProgress, key, fetcher = download } = {}) {
  const { asset, dir, exe } = binaryPaths(spec, cacheRoot, key);
  if (fs.existsSync(exe)) return exe;
  const tmp = `${dir}.partial`;
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.mkdirSync(tmp, { recursive: true });
  const fname = decodeURIComponent(new URL(asset.url).pathname.split('/').pop());
  const archive = path.join(tmp, fname);
  await fetcher(asset.url, archive, onProgress);
  if (asset.sha256) {
    const got = await sha256(archive);
    if (got !== asset.sha256.toLowerCase()) throw new Error(`checksum mismatch for ${fname}: expected ${asset.sha256}, got ${got}`);
  }
  const isArchive = /\.(zip|tar\.gz|tgz|tar\.xz|tar\.bz2)$/i.test(fname);
  const out = path.join(tmp, 'out');
  if (isArchive) { await extract(archive, out); } else { fs.mkdirSync(out, { recursive: true }); fs.renameSync(archive, path.join(out, asset.path)); }
  const inner = path.join(out, asset.path);
  if (!fs.existsSync(inner)) {
    // Release archives sometimes nest the binary in a versioned folder; find it by name and hoist it.
    const found = findFile(out, path.basename(asset.path));
    if (!found) throw new Error(`expected ${asset.path} inside ${fname}`);
    fs.mkdirSync(path.dirname(inner), { recursive: true });
    fs.renameSync(found, inner);
  }
  if (process.platform !== 'win32') fs.chmodSync(inner, 0o755);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(dir), { recursive: true });
  fs.renameSync(out, dir);
  fs.rmSync(tmp, { recursive: true, force: true });
  return exe;
}

module.exports = { ensureBinary, isInstalled, binaryPaths, download, sha256, extract };
