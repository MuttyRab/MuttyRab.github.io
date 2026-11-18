'use strict';
// `GUI Hub --mcp` runs the MCP server for AI clients instead of opening a window.
if (process.argv.includes('--mcp')) {
  try { require('electron').app.dock?.hide(); } catch (_) { /* not macOS */ }
  require('./mcp-entry');
  return;
}
const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const os = require('os');
const path = require('path');
const fs = require('fs');
const { loadCatalog } = require('./core/spec');
const { buildCommand } = require('./core/args');
const { ensureBinary: ensureBinaryRaw, isInstalled, download: nodeDownload } = require('./core/binaries');
const { runTool } = require('./core/runner');
const { prepareRun, finishRun } = require('./core/execute');
const { LicenseStore } = require('./core/license');
const { loadRemote, mergeCatalog, newerVersion } = require('./core/remote-catalog');
const { loadProducts, mergeProducts, productId, findProduct } = require('./core/products');

const isDev = !app.isPackaged;
const resources = isDev ? path.join(__dirname, '..', '..') : process.resourcesPath;
const config = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config.json'), 'utf8'));
// Overrides exist for automated end-to-end tests only.
if (process.env.GUIHUB_USER_DATA) app.setPath('userData', process.env.GUIHUB_USER_DATA);
const catalogDir = process.env.GUIHUB_CATALOG || path.join(resources, 'catalog');
const userDir = app.getPath('userData');
// Engines shipped inside the installer (offline out of the box); downloads/updates go to the user folder.
const binCache = [path.join(userDir, 'tools'), path.join(resources, 'tools')];
fs.mkdirSync(binCache[0], { recursive: true });

// Each GUI Hub product ships as its own app: config.product (set at build time) limits the tools.
const onlyProduct = config.product || process.env.GUIHUB_PRODUCT || '';
const forProduct = (list) => (onlyProduct ? list.filter((s) => (s.product || 'essentials') === onlyProduct) : list);
const serverKey = onlyProduct ? `gui-hub-${onlyProduct}` : 'gui-hub';
let specs = [];
let bundledSpecs = [];
const bundledProducts = loadProducts(catalogDir);
let products = bundledProducts;
let remoteInfo = null;
let license;
let allSpecs = [];
let win;
const running = new Map();

function loadSpecs() {
  const { specs: s, errors } = loadCatalog(catalogDir, { includeBeta: isDev || process.env.GUIHUB_BETA === '1' });
  for (const e of errors) console.error('spec error', e.file, e.problems);
  bundledSpecs = forProduct(s);
  specs = s;
  allSpecs = s; // helpers for prepare steps (e.g. FFmpeg for Audio tools) come from the whole catalog
}

// New and fixed tools arrive from the website's catalog.json without reinstalling the app.
async function refreshRemoteCatalog() {
  if (!config.catalogUrl || process.env.GUIHUB_CATALOG) return;
  const remote = await loadRemote(config.catalogUrl, path.join(userDir, 'catalog-cache.json'));
  if (!remote) return;
  const { specs: mergedAll, rejected } = mergeCatalog(bundledSpecs, remote);
  const merged = forProduct(mergedAll);
  allSpecs = mergeCatalog(allSpecs, remote).specs;
  for (const r of rejected) console.error('remote spec rejected', r.id, r.problems);
  specs = merged;
  products = mergeProducts(bundledProducts, remote);
  remoteInfo = remote.app || null;
  if (win) win.webContents.send('catalog:changed');
}

const { netDownload } = require('./net-download');
const ensureBinary = (spec, cache, opts = {}) => ensureBinaryRaw(spec, cache, { ...opts, fetchers: [netDownload, nodeDownload] });

// Every catalog tool a tool's actions run (itself + helpers such as FFmpeg or the speech model).
function toolsNeeded(spec) {
  const ids = new Set([spec.id]);
  for (const a of spec.actions || []) for (const p of [].concat(a.prepare || [])) if (p.tool) ids.add(p.tool);
  return [...ids].map((id) => allSpecs.find((x) => x.id === id) || specs.find((x) => x.id === id)).filter(Boolean);
}
const readyOffline = (spec) => { try { return toolsNeeded(spec).every((t) => isInstalled(t, binCache)); } catch (_) { return false; } };

function toolSummary(spec) {
  const p = findProduct(products, productId(spec)) || {};
  return { ...spec, installed: readyOffline(spec), access: license.canRun(spec), productName: p.name || config.productName, checkoutUrl: p.checkoutUrl || config.checkoutUrl, price: p.price || config.price };
}

function createWindow() {
  win = new BrowserWindow({
    width: 1100, height: 760, minWidth: 820, minHeight: 560,
    title: config.productName,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  win.removeMenu();
  win.loadFile(path.join(__dirname, 'ui', 'index.html'));
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https:\/\//.test(url)) shell.openExternal(url); return { action: 'deny' }; });
}

app.whenReady().then(async () => {
  license = new LicenseStore(path.join(userDir, 'license.json'), config, { products: () => products });
  loadSpecs();
  createWindow();
  license.refresh().then(() => win && win.webContents.send('license:changed')).catch(() => {});
  refreshRemoteCatalog().catch(() => {});
});
app.on('window-all-closed', () => { for (const r of running.values()) r.cancel(); app.quit(); });

ipcMain.handle('app:info', () => ({
  productName: config.productName, version: app.getVersion(), checkoutUrl: config.checkoutUrl, siteUrl: config.siteUrl,
  supportEmail: config.supportEmail, licensing: license.configured(), pro: license.isPro(),
  unlocked: license.unlockedProducts().map((id) => (findProduct(products, id) || { name: id }).name),
  legalUrl: config.siteUrl ? `${config.siteUrl}/legal.html` : '',
  update: remoteInfo && newerVersion(remoteInfo.version, app.getVersion()) ? { version: remoteInfo.version, url: remoteInfo.downloadUrl || config.siteUrl } : null,
}));
ipcMain.handle('catalog:list', () => specs.map(toolSummary));

// Opening a tool fetches its engine (and helpers) in the background, so Run works right away — and offline later.
const fetching = new Map();
// One download per tool at a time, whoever asks (Run, prefetch, "all offline").
function getTool(t, onProgress) {
  if (isInstalled(t, binCache)) return ensureBinary(t, binCache);
  if (!fetching.has(t.id)) fetching.set(t.id, ensureBinary(t, binCache, { onProgress: (g, n) => { for (const f of fetchWatchers.get(t.id) || []) f(g, n); } }).finally(() => { fetching.delete(t.id); fetchWatchers.delete(t.id); }));
  if (onProgress) fetchWatchers.set(t.id, [...(fetchWatchers.get(t.id) || []), onProgress]);
  return fetching.get(t.id);
}
const fetchWatchers = new Map();
function fetchTools(list, onEach) {
  return list.reduce((chain, t, i) => chain.then(async (failed) => {
    if (onEach) onEach(t, i);
    try { await getTool(t); } catch (e) { failed.push({ id: t.id, name: t.name, error: e.message }); }
    return failed;
  }), Promise.resolve([]));
}
ipcMain.handle('tools:prefetch', async (_e, { toolId }) => {
  const spec = specs.find((s) => s.id === toolId); if (!spec) return { ok: false };
  const failed = await fetchTools(toolsNeeded(spec));
  return { ok: !failed.length, ready: readyOffline(spec), error: failed[0] && failed[0].error };
});
// "Make all tools work offline": download every engine now, with progress.
ipcMain.handle('tools:prepareAll', async (e) => {
  const all = [...new Map(specs.flatMap(toolsNeeded).map((t) => [t.id, t])).values()];
  const send = (payload) => { if (!e.sender.isDestroyed()) e.sender.send('tools:progress', payload); };
  const failed = await fetchTools(all, (t, i) => send({ text: `Downloading ${i + 1} of ${all.length}: ${t.name}…` }));
  send({ text: failed.length ? `${all.length - failed.length} of ${all.length} tools ready offline. ${failed.length} could not be downloaded — check the connection and try again.` : `All ${all.length} tools are ready to use offline.`, done: true });
  return { total: all.length, failed };
});

ipcMain.handle('dialog:pick', async (_e, { type, filters, title }) => {
  if (type === 'savefile') {
    const r = await dialog.showSaveDialog(win, { title, filters });
    return r.canceled ? null : r.filePath;
  }
  const props = type === 'folder' ? ['openDirectory', 'createDirectory'] : type === 'files' ? ['openFile', 'multiSelections'] : ['openFile'];
  const r = await dialog.showOpenDialog(win, { title, properties: props, filters });
  if (r.canceled) return null;
  return type === 'files' ? r.filePaths : r.filePaths[0];
});

ipcMain.handle('tool:run', async (e, { runId, toolId, actionId, values }) => {
  const spec = specs.find((s) => s.id === toolId);
  if (!spec) throw new Error('Unknown tool');
  const action = spec.actions.find((a) => a.id === actionId);
  if (!action) throw new Error('Unknown action');
  const gate = license.canRun(spec);
  if (!gate.ok) throw new Error('LOCKED');
  buildCommand(action, values); // validates first: throws with fieldErrors on bad input
  const send = (ch, payload) => { if (!e.sender.isDestroyed()) e.sender.send(ch, { runId, ...payload }); };
  send('run:status', { text: `Preparing ${spec.name} ${spec.binary.version}…` });
  // The tool's engine and any helpers it uses (one-time downloads; offline afterwards).
  let exe;
  for (const t of toolsNeeded(spec)) {
    const r = await getTool(t, (got, total) => send('run:status', { text: total ? `One-time download: ${t.name}… ${Math.round((got / total) * 100)}%` : `One-time download: ${t.name}… ${Math.round(got / 1e6)} MB` }));
    if (t.id === spec.id) exe = r;
  }
  let prep;
  try { prep = await prepareRun({ spec, action, values, specs: allSpecs, binCache, onOutput: (o) => send('run:output', o) }); } catch (err) { send('run:output', { stream: 'stderr', text: `${err.message}\n` }); send('run:exit', { code: 1 }); return { started: true, trial: null }; }
  const { argv, env, stdin } = buildCommand(action, prep.values);
  license.recordRun(spec);
  send('run:status', { text: 'Running…' });
  const secrets = (action.fields || []).filter((f) => f.type === 'password' && values[f.id]).map((f) => String(values[f.id]));
  const shown = argv.map((a) => secrets.reduce((s, x) => s.split(x).join('••••'), a));
  send('run:output', { stream: 'meta', text: `$ ${spec.binary.name} ${shown.map((a) => (/\s/.test(a) ? JSON.stringify(a) : a)).join(' ')}\n` });
  const { cwd } = prep;
  let stdoutText = '';
  const handle = runTool(exe, argv, {
    env, cwd, input: stdin, okCodes: action.okCodes,
    onOutput: (o) => { if (o.stream === 'stdout') stdoutText += o.text; send('run:output', o); },
    onExit: ({ code, signal }) => {
      running.delete(runId);
      try { if (code === 0) { const r = finishRun({ action, values: prep.values, stdout: stdoutText }); if (action.resultValue && r) send('run:output', { stream: 'stdout', text: `\n${r}\n` }); } } catch (err) { send('run:output', { stream: 'stderr', text: `Could not save: ${err.message}\n` }); }
      prep.cleanup();
      send('run:exit', { code, signal });
    },
  });
  running.set(runId, handle);
  return { started: true, trial: gate.reason === 'trial' ? license.trialsLeft(spec.id) : null };
});

ipcMain.handle('tool:cancel', (_e, { runId }) => { const r = running.get(runId); if (r) r.cancel(); return true; });
ipcMain.handle('tool:stdin', (_e, { runId, text }) => { const r = running.get(runId); if (r) r.write(text); return true; });

ipcMain.handle('license:activate', async (_e, { key }) => license.activate(key));
ipcMain.handle('license:deactivate', () => { license.deactivate(); return true; });

ipcMain.handle('shell:open', (_e, { target }) => {
  if (/^https:\/\//.test(target)) return shell.openExternal(target);
  if (target && fs.existsSync(target)) return shell.openPath(target);
  return null;
});

// ---- Use with AI (MCP) -------------------------------------------------------------------
function mcpServerConfig() {
  const appPath = app.getAppPath();
  const root = appPath.endsWith('.asar') ? `${appPath}.unpacked` : appPath;
  return { command: process.execPath, args: [path.join(root, 'src', 'mcp-entry.js')], env: { ELECTRON_RUN_AS_NODE: '1' } };
}
const clientConfigFiles = {
  claude: () => (process.platform === 'darwin' ? path.join(os.homedir(), 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json')
    : process.platform === 'win32' ? path.join(process.env.APPDATA || '', 'Claude', 'claude_desktop_config.json')
      : path.join(os.homedir(), '.config', 'Claude', 'claude_desktop_config.json')),
  cursor: () => path.join(os.homedir(), '.cursor', 'mcp.json'),
};
ipcMain.handle('mcp:info', () => {
  const { toolsFromSpecs } = require('./core/mcp');
  return {
    config: { mcpServers: { [serverKey]: mcpServerConfig() } },
    tools: toolsFromSpecs(specs).map((t) => ({ name: t.name, title: t.title })),
    clients: Object.fromEntries(Object.entries(clientConfigFiles).map(([k, f]) => [k, fs.existsSync(path.dirname(f()))])),
  };
});
ipcMain.handle('mcp:install', async (_e, { client }) => {
  const file = clientConfigFiles[client] && clientConfigFiles[client]();
  if (!file) throw new Error('Unknown app');
  let cfg = {};
  if (fs.existsSync(file)) {
    try { cfg = JSON.parse(fs.readFileSync(file, 'utf8') || '{}'); } catch (_) { throw new Error(`Could not read ${file}. Fix or remove it, then try again.`); }
    fs.copyFileSync(file, `${file}.backup-${Date.now()}`);
  }
  cfg.mcpServers = { ...(cfg.mcpServers || {}), [serverKey]: mcpServerConfig() };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(cfg, null, 2)}\n`);
  return { file };
});
ipcMain.handle('clipboard:write', (_e, { text }) => { require('electron').clipboard.writeText(String(text)); return true; });
