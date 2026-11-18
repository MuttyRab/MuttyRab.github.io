#!/usr/bin/env node
'use strict';
// Proves "offline out of the box": runs real tools through a PACKAGED app's MCP server with an empty
// user folder. Run it with the network cut off (CI: `sudo unshare -n`), so any download would fail.
// usage: node scripts/offline-test.js <unpacked app dir, e.g. app/dist/linux-unpacked>
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const dir = path.resolve(process.argv[2] || 'app/dist/linux-unpacked');
const exe = fs.readdirSync(dir).map((f) => path.join(dir, f)).find((f) => /gui[- ]hub/i.test(path.basename(f)) && fs.statSync(f).isFile() && (process.platform === 'win32' ? /\.exe$/i.test(f) : (fs.statSync(f).mode & 0o111)));
const entry = path.join(dir, 'resources', 'app.asar.unpacked', 'src', 'mcp-entry.js');
const tools = path.join(dir, 'resources', 'tools');
if (!exe || !fs.existsSync(entry) || !fs.existsSync(tools)) { console.error('packaged app, MCP entry or bundled tools missing', { exe, entry, tools }); process.exit(1); }

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'offline-'));
const userData = path.join(work, 'user-data'); fs.mkdirSync(userData);
const find = (re) => { const walk = (d) => { for (const f of fs.readdirSync(d)) { const p = path.join(d, f); if (fs.statSync(p).isDirectory()) { const r = walk(p); if (r) return r; } else if (re.test(f)) return p; } return null; }; return walk(tools); };
const ffmpeg = find(/^ffmpeg(\.exe)?$/);
const ff = (...a) => { const r = spawnSync(ffmpeg, ['-loglevel', 'error', '-y', ...a]); if (r.status !== 0) throw new Error(String(r.stderr)); };

// Inputs, made with the bundled FFmpeg (no network).
ff('-f', 'lavfi', '-i', 'sine=frequency=440:duration=3', path.join(work, 'tone.wav'));
const docs = path.join(work, 'docs'); fs.mkdirSync(docs);
fs.writeFileSync(path.join(docs, 'notes.md'), '# Lease\n\nThe parking space is B12.\n');
const pics = path.join(work, 'pics'); fs.mkdirSync(pics);
ff('-f', 'lavfi', '-i', 'testsrc2=size=640x480', '-frames:v', '1', path.join(pics, 'pattern.jpg'));

const calls = [
  ['ffmpeg_audio', { input: path.join(work, 'tone.wav'), out: path.join(work, 'tone.mp3') }, () => fs.statSync(path.join(work, 'tone.mp3')).size > 1000],
  ['transcribe_transcribe', { input: path.join(work, 'tone.wav') }, null],
  ['docs_index', { folder: docs, out: path.join(work, 'docs.tsv'), limit: '500' }, () => /parking space is B12/.test(fs.readFileSync(path.join(work, 'docs.tsv'), 'utf8'))],
  ['photos_index', { folder: pics, out: path.join(work, 'pics.tsv'), limit: '50' }, () => { const l = fs.readFileSync(path.join(work, 'pics.tsv'), 'utf8'); console.log(l.trim()); return !/could not read/.test(l); }],
];
if (process.env.OFFLINE_ALL === '1') {
  fs.writeFileSync(path.join(work, 'sales.csv'), 'region,amount\nnorth,10\nsouth,32\n');
  calls.push(
    ['speak_speak', { text: 'Hello from GUI Hub, working offline.', out: path.join(work, 'hello.wav') }, () => fs.statSync(path.join(work, 'hello.wav')).size > 10000],
    ['duckdb_convert', { input: path.join(work, 'sales.csv'), out: path.join(work, 'sales.xlsx') }, () => fs.statSync(path.join(work, 'sales.xlsx')).size > 1000],
  );
}

const child = spawn(exe, [entry], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', GUIHUB_USER_DATA: userData }, stdio: ['pipe', 'pipe', 'inherit'] });
let buf = ''; const waiting = new Map();
child.stdout.on('data', (d) => {
  buf += d; const lines = buf.split('\n'); buf = lines.pop();
  for (const l of lines) { if (!l.trim()) continue; const m = JSON.parse(l); if (waiting.has(m.id)) { waiting.get(m.id)(m); waiting.delete(m.id); } }
});
let id = 0;
const rpc = (method, params) => new Promise((resolve) => { id++; waiting.set(id, resolve); child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`); });

(async () => {
  let failed = 0;
  const t = setTimeout(() => { console.error('TIMEOUT'); process.exit(1); }, 15 * 60 * 1000);
  await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'offline-test', version: '1' } });
  for (const [name, args, check] of calls) {
    const r = await rpc('tools/call', { name, arguments: args });
    const text = ((r.result && r.result.content) || []).map((c) => c.text || '').join('\n');
    let ok = r.result && !r.result.isError;
    try { if (ok && check) ok = check(); } catch (e) { ok = false; }
    console.log(`${ok ? 'PASS' : 'FAIL'} offline ${name}${ok ? '' : `\n${text.slice(0, 1500)}`}`);
    if (!ok) failed++;
  }
  const downloaded = fs.existsSync(path.join(userData, 'tools')) ? fs.readdirSync(path.join(userData, 'tools')) : [];
  console.log(`user tool folder after the run: [${downloaded.join(', ')}] (should be empty — engines used from the app folder)`);
  if (downloaded.length && process.platform !== 'darwin') failed++;
  clearTimeout(t); child.kill(); process.exit(failed ? 1 : 0);
})();
