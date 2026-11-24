'use strict';
// Read-aloud (speak tool, play=true): player selection per OS, MCP schema, temp output path.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { playerCommand } = require('../src/core/play');
const { platformKey } = require('../src/core/spec');

const catalog = path.join(__dirname, '..', '..', 'catalog');

test('playerCommand: built-in player per OS, first available on Linux', () => {
  assert.deepStrictEqual(playerCommand('/t/a.wav', 'darwin'), ['afplay', ['/t/a.wav']]);
  const [w, wargs] = playerCommand("C:\\Users\\O'Neil\\a.wav", 'win32');
  assert.strictEqual(w, 'powershell.exe');
  assert.match(wargs.at(-1), /SoundPlayer 'C:\\Users\\O''Neil\\a\.wav'\)\.PlaySync\(\)/);
  assert.deepStrictEqual(playerCommand('/t/a.wav', 'linux', (c) => c === 'aplay'), ['aplay', ['-q', '/t/a.wav']]);
  assert.deepStrictEqual(playerCommand('/t/a.wav', 'linux', (c) => c === 'paplay' || c === 'aplay'), ['paplay', ['/t/a.wav']]);
  assert.strictEqual(playerCommand('/t/a.wav', 'linux', () => false), null);
});

function client(env) {
  const p = spawn(process.execPath, [path.join(__dirname, '..', 'src', 'mcp-entry.js')], { env: { ...process.env, ...env }, stdio: ['pipe', 'pipe', 'pipe'] });
  let buf = ''; const waiting = new Map(); let id = 0;
  p.stdout.on('data', (d) => {
    buf += d; let i;
    while ((i = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, i); buf = buf.slice(i + 1); const m = JSON.parse(line); waiting.get(m.id)?.(m); }
  });
  return {
    req: (method, params) => new Promise((resolve) => { const n = ++id; waiting.set(n, resolve); p.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: n, method, params })}\n`); }),
    close: () => p.stdin.end(),
  };
}

test('MCP speak: play=true reads aloud without an output path; otherwise out is needed', { skip: process.platform === 'win32' }, async () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'gh-play-'));
  const spec = JSON.parse(fs.readFileSync(path.join(catalog, 'speak', 'spec.json'), 'utf8'));
  const key = platformKey();
  const dir = path.join(userData, 'tools', 'speak', spec.binary.version, key);
  const exe = path.join(dir, spec.binary.assets[key].path);
  fs.mkdirSync(path.dirname(exe), { recursive: true });
  for (const x of spec.binary.extras || []) fs.mkdirSync(path.join(dir, 'extras', x.name), { recursive: true });
  // Fake TTS engine: writes a tiny file at --output-filename=...
  fs.writeFileSync(exe, '#!/bin/sh\nfor a in "$@"; do case "$a" in --output-filename=*) printf RIFF > "${a#--output-filename=}";; esac; done\necho done\n');
  fs.chmodSync(exe, 0o755);
  const c = client({ GUIHUB_USER_DATA: userData, GUIHUB_CATALOG: catalog, PATH: '/nonexistent' });
  await c.req('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } });
  const list = await c.req('tools/list', {});
  const speak = list.result.tools.find((t) => t.name === 'speak_speak');
  assert.ok(speak, 'speak_speak tool listed');
  assert.ok(!speak.inputSchema.required.includes('out'), 'out is optional (play=true needs no path)');
  assert.strictEqual(speak.inputSchema.properties.play.type, 'boolean');
  assert.match(speak.description, /READ SOMETHING ALOUD/);
  const noOut = await c.req('tools/call', { name: 'speak_speak', arguments: { text: 'Hello' } });
  assert.strictEqual(noOut.result.isError, true);
  assert.match(noOut.result.content[0].text, /set "play": true/);
  const r = await c.req('tools/call', { name: 'speak_speak', arguments: { text: 'Hello there', play: true } });
  assert.strictEqual(r.result.isError, false, r.result.content[0].text);
  const m = r.result.content[0].text.match(/(\/\S*gui-hub-speech-\d+\.wav)/);
  assert.ok(m, r.result.content[0].text);
  assert.ok(fs.existsSync(m[1]), 'audio written to a temp file');
  // PATH has no player here, so it must say so instead of failing the job.
  assert.match(r.result.content[0].text, /could not play it aloud: no audio player found|Now playing it aloud/);
  c.close();
});
