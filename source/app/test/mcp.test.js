'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { platformKey } = require('../src/core/spec');

const catalog = path.join(__dirname, '..', '..', 'catalog');

function seed(userData, id) {
  const spec = JSON.parse(fs.readFileSync(path.join(catalog, id, 'spec.json'), 'utf8'));
  const key = platformKey();
  const exe = path.join(userData, 'tools', id, spec.binary.version, key, spec.binary.assets[key].path);
  fs.mkdirSync(path.dirname(exe), { recursive: true });
  fs.writeFileSync(exe, '#!/bin/sh\nfor a in "$@"; do echo "arg: $a"; done\n');
  fs.chmodSync(exe, 0o755);
}

function client(env) {
  const p = spawn(process.execPath, [path.join(__dirname, '..', 'src', 'mcp-entry.js')], { env: { ...process.env, ...env }, stdio: ['pipe', 'pipe', 'pipe'] });
  let buf = ''; const waiting = new Map(); let id = 0;
  p.stdout.on('data', (d) => {
    buf += d; let i;
    while ((i = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, i); buf = buf.slice(i + 1); const m = JSON.parse(line); waiting.get(m.id)?.(m); }
  });
  return {
    req: (method, params) => new Promise((resolve) => { const n = ++id; waiting.set(n, resolve); p.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: n, method, params })}\n`); }),
    note: (method) => p.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method })}\n`),
    close: () => p.stdin.end(),
  };
}

test('MCP: initialize, list tools from the catalog, call a tool, enforce trials', { skip: process.platform === 'win32' }, async () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'gh-mcp-'));
  seed(userData, 'f2');
  const c = client({ GUIHUB_USER_DATA: userData, GUIHUB_CATALOG: catalog });
  const init = await c.req('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } });
  assert.strictEqual(init.result.protocolVersion, '2025-06-18');
  assert.ok(init.result.capabilities.tools);
  c.note('notifications/initialized');
  const list = await c.req('tools/list', {});
  const names = list.result.tools.map((t) => t.name);
  for (const n of ['ffmpeg_compress', 'pdfcpu_merge', 'f2_rename', 'croc_send', 'immich-go_from-folder'.replace('-', '_').replace('-', '_')]) assert.ok(names.includes(n), `missing ${n}`);
  const rename = list.result.tools.find((t) => t.name === 'f2_rename');
  assert.deepStrictEqual(rename.inputSchema.required, ['folder', 'find']);
  assert.strictEqual(rename.inputSchema.properties.apply.type, 'boolean');
  assert.ok(!('_spec' in rename));
  const bad = await c.req('tools/call', { name: 'f2_rename', arguments: { folder: userData } });
  assert.strictEqual(bad.result.isError, true);
  for (let i = 0; i < 3; i++) {
    const r = await c.req('tools/call', { name: 'f2_rename', arguments: { folder: userData, find: 'IMG_', replace: 'pic-' } });
    assert.strictEqual(r.result.isError, false, r.result.content[0].text);
    assert.match(r.result.content[0].text, /arg: IMG_/);
    assert.match(r.result.content[0].text, new RegExp(`${2 - i} uses? of Rename Many Files left`));
  }
  const locked = await c.req('tools/call', { name: 'f2_rename', arguments: { folder: userData, find: 'a' } });
  assert.strictEqual(locked.result.isError, true);
  assert.match(locked.result.content[0].text, /free tries are used up/);
  const unknown = await c.req('nope/nope', {});
  assert.strictEqual(unknown.error.code, -32601);
  c.close();
});
