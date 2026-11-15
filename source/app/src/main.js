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
const { ensureBinary, isInstalled } = require('./core/binaries');
const { runTool } = require('./core/runner');
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
const binCache = path.join(userDir, 'tools');
fs.mkdirSync(binCache, { recursive: true });

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
let win;
const running = new Map();

function loadSpecs() {
  const { specs: s, errors } = loadCatalog(catalogDir, { includeBeta: isDev || process.env.GUIHUB_BETA === '1' });
  for (const e of errors) console.error('spec error', e.file, e.problems);
  bundledSpecs = forProduct(s);
  specs = s;
}

// New and fixed tools arrive from the website's catalog.json without reinstalling the app.
async function refreshRemoteCatalog() {
  if (!config.catalogUrl || process.env.GUIHUB_CATALOG) return;
  const remote = await loadRemote(config.catalogUrl, path.join(userDir, 'catalog-cache.json'));
  if (!remote) return;
  const { specs: mergedAll, rejected } = mergeCatalog(bundledSpecs, remote);
  const merged = forProduct(mergedAll);
  for (const r of rejected) console.error('remote spec rejected', r.id, r.problems);
  specs = merged;
  products = mergeProducts(bundledProducts, remote);
  remoteInfo = remote.app || null;
  if (win) win.webContents.send('catalog:changed');
}

function toolSummary(spec) {
  const p = findProduct(products, productId(spec)) || {};
  return { ...spec, installed: isInstalled(spec, binCache), access: license.canRun(spec), productName: p.name || config.productName, checkoutUrl: p.checkoutUrl || config.checkoutUrl, price: p.price || config.price };
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
  const { argv, env, stdin } = buildCommand(action, values); // throws with fieldErrors on bad input
  const send = (ch, payload) => { if (!e.sender.isDestroyed()) e.sender.send(ch, { runId, ...payload }); };
  send('run:status', { text: `Preparing ${spec.name} ${spec.binary.version}…` });
  const exe = await ensureBinary(spec, binCache, {
    onProgress: (got, total) => send('run:status', { text: total ? `Downloading ${spec.name}… ${Math.round((got / total) * 100)}%` : `Downloading ${spec.name}… ${Math.round(got / 1e6)} MB` }),
  });
  license.recordRun(spec);
  send('run:status', { text: 'Running…' });
  const secrets = (action.fields || []).filter((f) => f.type === 'password' && values[f.id]).map((f) => String(values[f.id]));
  const shown = argv.map((a) => secrets.reduce((s, x) => s.split(x).join('••••'), a));
  send('run:output', { stream: 'meta', text: `$ ${spec.binary.name} ${shown.map((a) => (/\s/.test(a) ? JSON.stringify(a) : a)).join(' ')}\n` });
  const cwd = values[action.cwdField] || undefined;
  const handle = runTool(exe, argv, {
    env, cwd, input: stdin,
    onOutput: (o) => send('run:output', o),
    onExit: ({ code, signal }) => { running.delete(runId); send('run:exit', { code, signal }); },
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
