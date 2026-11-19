#!/usr/bin/env node
'use strict';
// End-to-end smoke test: launches the real Electron app with Playwright, using the real catalog
// but a pre-seeded fake binary for f2 and croc (so no network is needed), fills a form, runs it,
// checks the streamed output, checks the trial counter, and saves screenshots.
// usage (Linux): xvfb-run -a node test/e2e.js [screenshotDir]
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { _electron: electron } = require('playwright');
const { platformKey } = require('../src/core/spec');

const appDir = path.join(__dirname, '..');
const catalog = path.join(appDir, '..', 'catalog');
const shots = process.argv[2] || fs.mkdtempSync(path.join(os.tmpdir(), 'gh-shots-'));
fs.mkdirSync(shots, { recursive: true });
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'gh-e2e-'));
const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'gh-home-'));
const key = platformKey();

function seed(id) {
  const spec = JSON.parse(fs.readFileSync(path.join(catalog, id, 'spec.json'), 'utf8'));
  const exe = path.join(userData, 'tools', id, spec.binary.version, key, spec.binary.assets[key].path);
  fs.mkdirSync(path.dirname(exe), { recursive: true });
  fs.writeFileSync(exe, `#!/bin/sh\necho "fake ${id} cwd=$(pwd)"\nfor a in "$@"; do echo "arg: $a"; done\necho "secret=$CROC_SECRET"\n`);
  fs.chmodSync(exe, 0o755);
}

(async () => {
  seed('f2'); seed('croc');
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'gh-work-'));
  // E2E_PACKAGED=<path to built app executable> tests the real installer contents (bundled
  // catalog, asar, config) instead of the source tree.
  const packaged = process.env.E2E_PACKAGED;
  const app = await electron.launch(packaged ? {
    executablePath: packaged, args: ['--no-sandbox'],
    env: { ...process.env, GUIHUB_USER_DATA: userData, HOME: fakeHome, XDG_CONFIG_HOME: path.join(fakeHome, '.config') },
  } : {
    executablePath: require('electron'),
    args: [appDir, '--no-sandbox'],
    env: { ...process.env, GUIHUB_USER_DATA: userData, GUIHUB_CATALOG: catalog, HOME: fakeHome, XDG_CONFIG_HOME: path.join(fakeHome, '.config') },
  });
  // Native file dialogs cannot be driven; stub them in the main process.
  await app.evaluate(({ ipcMain }, dir) => {
    ipcMain.removeHandler('dialog:pick');
    ipcMain.handle('dialog:pick', (_e, { type }) => (type === 'files' ? [`${dir}/a.txt`, `${dir}/b c.txt`] : dir));
  }, work);
  const page = await app.firstWindow();
  await page.setViewportSize({ width: 1100, height: 760 });
  await page.waitForSelector('.tool-item');
  const names = await page.$$eval('.tool-item', (els) => els.map((e) => e.textContent));
  assert.ok(names.length >= 4, `expected 4+ tools, got ${names}`);
  await page.screenshot({ path: path.join(shots, '1-start.png') });

  // f2: pro tool on trial. Validation first.
  await page.click('.tool-item:has-text("Rename Many Files")');
  await page.click('#run-btn');
  assert.ok(await page.isVisible('.field.invalid'), 'required fields should be flagged');
  await page.click('.field[data-field="folder"] button:has-text("Choose")');
  await page.fill('#f-find', 'IMG_');
  await page.fill('#f-replace', 'holiday-{%03d}{ext}');
  await page.check('#f-recursive');
  await page.click('#run-btn');
  await page.waitForFunction(() => document.querySelector('#output').textContent.includes('Done') || document.querySelector('#output').textContent.includes('Exit code'));
  const out = await page.textContent('#output');
  assert.ok(out.includes('arg: -f') && out.includes('arg: IMG_') && out.includes('arg: holiday-{%03d}{ext}') && out.includes('arg: -R'), out);
  assert.ok(!out.includes('arg: -x'), 'preview must not apply');
  assert.ok(out.includes(`cwd=${fs.realpathSync(work)}`) || out.includes(`cwd=${work}`), 'runs inside chosen folder');
  // Trial counts down, unless the live catalog says purchases aren't open yet (free launch: nothing is used up).
  assert.match(await page.textContent('#tool-access'), /2 free runs left|Free during launch/);
  await page.screenshot({ path: path.join(shots, '2-f2-preview.png') });

  // croc receive: secret goes through env, not argv.
  await page.click('.tool-item:has-text("Send Big Files")');
  await page.click('.tab:has-text("Receive")');
  await page.fill('#f-code', '7777-alpha-bravo-charlie');
  await page.click('.field[data-field="dest"] button:has-text("Choose")');
  await page.click('#run-btn');
  await page.waitForFunction(() => document.querySelector('#output').textContent.includes('Done'));
  const out2 = await page.textContent('#output');
  assert.ok(out2.includes('secret=7777-alpha-bravo-charlie'));
  assert.ok(!/arg: .*alpha/.test(out2), 'code must not be in argv');
  await page.screenshot({ path: path.join(shots, '3-croc-receive.png') });

  // License dialog: a fake key gets a friendly error (from Polar when configured, else "not set up").
  await page.click('#license-btn');
  await page.fill('#license-key', 'TEST-KEY');
  await page.click('#activate-btn');
  await page.waitForFunction(() => document.querySelector('#license-error').textContent.length > 0);
  assert.match(await page.textContent('#license-error'), /not set up|not found|License (check|server)/);
  await page.screenshot({ path: path.join(shots, '4-license.png') });

  // Use with AI: one-click install into Claude Desktop's config, then start the server exactly as
  // Claude would from that config and check it answers MCP initialize + tools/list.
  await page.click('#license-dialog button[value=cancel]');
  await page.click('#mcp-btn');
  await page.waitForSelector('#mcp-dialog[open]');
  assert.match(await page.textContent('#mcp-json'), /gui-hub/);
  const mcpKey = (o) => Object.keys(o).find((k) => k.startsWith('gui-hub'));
  await page.click('#mcp-claude');
  await page.waitForFunction(() => /Added to Claude Desktop/.test(document.querySelector('#mcp-result').textContent));
  await page.screenshot({ path: path.join(shots, '5-mcp.png') });
  const cfgFile = process.platform === 'darwin' ? path.join(fakeHome, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json') : path.join(fakeHome, '.config', 'Claude', 'claude_desktop_config.json');
  const servers = JSON.parse(fs.readFileSync(cfgFile, 'utf8')).mcpServers; const cfg = servers[mcpKey(servers)];
  const { spawn } = require('child_process');
  const srv = spawn(cfg.command, cfg.args, { env: { ...process.env, ...cfg.env, GUIHUB_USER_DATA: userData, ...(packaged ? {} : { GUIHUB_CATALOG: catalog }) }, stdio: ['pipe', 'pipe', 'inherit'] });
  const answers = await new Promise((resolve, reject) => {
    let buf = ''; const got = [];
    const timer = setTimeout(() => reject(new Error(`MCP server did not answer: ${buf}`)), 30000);
    // Only complete lines count: the tools/list answer is larger than one pipe chunk.
    srv.stdout.on('data', (d) => { buf += d; const lines = buf.split('\n').slice(0, -1).filter(Boolean); if (lines.length >= 2) { clearTimeout(timer); resolve(lines.map((l) => JSON.parse(l))); } });
    srv.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'e2e', version: '1' } } })}\n`);
    srv.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' })}\n`);
  });
  srv.stdin.end();
  assert.strictEqual(answers[0].result.serverInfo.name, 'gui-hub');
  assert.ok(answers[1].result.tools.length >= 10, 'tools listed');
  console.log(`mcp ok: ${answers[1].result.tools.length} tools via ${path.basename(cfg.command)}`);

  await app.close();
  console.log(`e2e ok; screenshots in ${shots}`);
})().catch((e) => { console.error(e); process.exit(1); });
