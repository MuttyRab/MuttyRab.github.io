'use strict';
// MCP (Model Context Protocol) server over stdio. Every tool action in the catalog becomes an
// MCP tool automatically, with a JSON schema generated from the same form fields the GUI shows.
// Runs the same code path as the GUI: buildCommand -> license/trial gate -> ensureBinary -> runTool.
// stdout carries only JSON-RPC messages (one per line); all logging goes to stderr.
const readline = require('readline');
const { buildCommand } = require('./args');
const { ensureBinary } = require('./binaries');
const { runTool } = require('./runner');
const { prepareRun, finishRun } = require('./execute');
// "returnImages": {"field": "out"} (one image file) or {"field": "outDir", "max": 6} (images in a folder):
// attach them to the tool result so the AI sees them directly, not just their paths.
function imageContent(action, values) {
  const r = action.returnImages; if (!r || !values[r.field]) return [];
  const fs = require('fs'); const path = require('path');
  const types = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };
  let files = [];
  try {
    const p = values[r.field];
    if (fs.statSync(p).isDirectory()) {
      files = fs.readdirSync(p).filter((f) => types[path.extname(f).toLowerCase()]).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).map((f) => path.join(p, f));
      const max = r.max || 6; if (files.length > max) files = Array.from({ length: max }, (_, i) => files[Math.round((i * (files.length - 1)) / (max - 1 || 1))]);
    } else files = [p];
  } catch (e) { return []; }
  return files.map((f) => { try { const b = fs.readFileSync(f); return b.length <= 4 * 1024 * 1024 ? { type: 'image', data: b.toString('base64'), mimeType: types[path.extname(f).toLowerCase()] } : null; } catch (e) { return null; } }).filter(Boolean);
}
const { productId, findProduct } = require('./products');

const PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];
const MAX_OUTPUT = 12000;

function toolName(spec, action) {
  return `${spec.id}_${action.id}`.toLowerCase().replace(/[^a-z0-9_]/g, '_').slice(0, 64);
}

function fieldSchema(f) {
  const d = { description: [f.label, f.help].filter(Boolean).join(' — ') };
  switch (f.type) {
    case 'checkbox': return { type: 'boolean', ...d };
    case 'number': return { type: 'number', ...d };
    case 'select': return { type: 'string', enum: f.options.map((o) => o.value), ...d, description: `${d.description}. Options: ${f.options.map((o) => `"${o.value}" = ${o.label}`).join('; ')}` };
    case 'files': return { type: 'array', items: { type: 'string' }, ...d, description: `${d.description}. Absolute file paths.` };
    case 'file': case 'folder': case 'savefile': return { type: 'string', ...d, description: `${d.description}. Absolute ${f.type === 'folder' ? 'folder' : 'file'} path${f.type === 'savefile' ? ' to write' : ''}.` };
    default: return { type: 'string', ...d };
  }
}

function toolsFromSpecs(specs) {
  const tools = [];
  for (const spec of specs) {
    for (const action of spec.actions) {
      if (action.mcp === false) continue; // GUI-only (e.g. needs to show a live code before finishing)
      const properties = {};
      const required = [];
      for (const f of action.fields || []) {
        properties[f.id] = fieldSchema(f);
        if (f.default !== undefined) properties[f.id].default = f.default;
        if (f.required && !f.showIf) required.push(f.id);
      }
      tools.push({
        name: toolName(spec, action),
        title: `${spec.name}: ${action.label}`,
        description: `${action.mcpDescription || action.description || action.label} (${spec.name}, powered by ${spec.upstream.displayName || spec.id}. Runs locally on this computer; file paths must be absolute.)`,
        inputSchema: { type: 'object', properties, required, additionalProperties: false },
        annotations: { title: `${spec.name}: ${action.label}`, readOnlyHint: false, openWorldHint: spec.id === 'croc' || spec.id === 'immich-go' },
        _spec: spec, _action: action,
      });
    }
  }
  return tools;
}

function tail(s, n) { return s.length > n ? `…(earlier output trimmed)…\n${s.slice(-n)}` : s; }

// Account tools let an assistant handle the whole free-trial -> purchase -> unlock loop in chat,
// so people who never visit the website (e.g. installed via npx) can still upgrade.
const ACCOUNT_TOOLS = [
  {
    name: 'gui_hub_status',
    title: 'GUI Hub: plan and free uses left',
    description: 'Show whether GUI Hub Pro is active, how many free uses each tool has left, the price and the purchase link. Call this when the user asks about limits, pricing or upgrading.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { title: 'GUI Hub: plan and free uses left', readOnlyHint: true, openWorldHint: false },
  },
  {
    name: 'gui_hub_activate_license',
    title: 'GUI Hub: activate a Pro license key',
    description: 'Activate the GUI Hub Pro license key the user received by email after buying. Unlocks unlimited use of every tool on this computer (also in the desktop app). Only call with a key the user gave you.',
    inputSchema: { type: 'object', properties: { licenseKey: { type: 'string', description: 'The license key from the purchase email (format like XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX).' } }, required: ['licenseKey'], additionalProperties: false },
    annotations: { title: 'GUI Hub: activate a Pro license key', readOnlyHint: false, openWorldHint: true },
  },
];

function createServer({ getSpecs, getAllSpecs, getProducts = () => null, license, binCache, info, log = (m) => process.stderr.write(`${m}\n`) }) {
  const tools = () => toolsFromSpecs(getSpecs());
  const prod = (spec) => findProduct(getProducts(), productId(spec)) || { name: `${info.productName} Pro`, price: info.price, checkoutUrl: info.checkoutUrl };
  const buy = (spec) => (spec && prod(spec).checkoutUrl) || info.checkoutUrl || info.siteUrl;
  const text = (t, isError = false) => ({ isError, content: [{ type: 'text', text: t }] });

  async function accountTool(name, args) {
    if (!license) return text('Licensing is not configured in this build: every tool is unlocked.');
    if (name === 'gui_hub_status') {
      await license.refresh().catch(() => {});
      const groups = new Map();
      for (const s of getSpecs()) { const id = productId(s); if (!groups.has(id)) groups.set(id, []); groups.get(id).push(s); }
      const lines = [];
      for (const [, list] of groups) {
        const p = prod(list[0]);
        if (license.isPro(productId(list[0]))) { lines.push(`${p.name}: unlocked — every tool unlimited.`, ''); continue; }
        if (license.launchFree && license.launchFree()) { lines.push(`${p.name}: free and unlimited during launch (purchases aren't open yet; free tries are not used up).`, ''); continue; }
        lines.push(`${p.name}: free uses left —`);
        for (const s of list) lines.push(`- ${s.name}: ${s.tier === 'free' ? 'free, unlimited' : license.trialsLeft(s.id)}`);
        lines.push(`Unlock ${p.name}: ${p.price || info.price || ''} one-time (no subscription, up to 3 computers, 30-day refund) — ${buy(list[0])}`, '');
      }
      const all = getProducts() && getProducts().allAccess;
      if (all && !(getProducts().products || []).every((p) => p.checkoutUrl === all.checkoutUrl)) lines.push(`Or ${all.name}: ${all.price} once unlocks every product, including future ones — ${all.checkoutUrl}`, '');
      lines.push('After buying, the license key arrives by email; give it to the assistant to activate with gui_hub_activate_license.');
      return text(lines.join('\n'));
    }
    const key = String((args && args.licenseKey) || '').trim();
    if (!key) return text('licenseKey is required.', true);
    try {
      const names = await license.activate(key);
      return text(`Activated. ${names && names.length ? names.join(', ') : `${info.productName} Pro`} ${names && names.length > 1 ? 'are' : 'is'} now unlocked on this computer — those tools are unlimited. Thank you!`);
    } catch (e) {
      return text(`Could not activate that key: ${e.message}. Check it was copied completely from the purchase email. If it still fails, the user can email support via ${info.siteUrl}.`, true);
    }
  }

  // Client capabilities from initialize, and a way to send the client a request (set by start()).
  let clientCaps = {};
  let requestClient = null;
  // "confirm": ask the person directly (MCP elicitation) before tools that use the camera, microphone or
  // screen — every time, whatever the client's "always allow" setting. Clients without elicitation still
  // show their own per-tool permission prompt.
  async function confirmWithUser(action) {
    if (!action.confirm || !clientCaps.elicitation || !requestClient) return true;
    try {
      const r = await requestClient('elicitation/create', { message: action.confirm, requestedSchema: { type: 'object', properties: { allow: { type: 'boolean', title: 'Allow', default: true } }, required: [] } });
      return r && r.action === 'accept' && !(r.content && r.content.allow === false);
    } catch (e) { return false; }
  }

  async function callTool(name, args) {
    if (ACCOUNT_TOOLS.some((a) => a.name === name)) return accountTool(name, args);
    const t = tools().find((x) => x.name === name);
    if (!t) return { isError: true, content: [{ type: 'text', text: `Unknown tool: ${name}` }] };
    const { _spec: spec, _action: action } = t;
    if (!(await confirmWithUser(action))) return { isError: true, content: [{ type: 'text', text: 'Not allowed: the user declined, or this app could not show the permission prompt. Nothing was recorded. Ask the user in chat; if they say yes but this keeps happening, their app may not support MCP permission prompts (elicitation) yet, and they can use the GUI Hub desktop app for this tool instead.' }] };
    let cmd;
    try { cmd = buildCommand(action, args || {}); } catch (e) { return { isError: true, content: [{ type: 'text', text: `Invalid arguments: ${e.message}` }] }; }
    if (license) {
      await license.refresh().catch(() => {});
      const gate = license.canRun(spec);
      if (!gate.ok) {
        return text([
          `The free uses of ${spec.name} on this computer are used up, so this job was not run.`,
          `Tell the user, briefly and without pressure: ${prod(spec).name} is a ${prod(spec).price || info.price || 'small'} one-time payment (no subscription, 30-day refund) that unlocks this tool and the rest of ${getProducts() && getProducts().allAccess && getProducts().allAccess.checkoutUrl === buy(spec) ? 'GUI Hub (every tool, every app)' : prod(spec).name} with no limits.`,
          `Purchase link: ${buy(spec)}`,
          ...(getProducts() && getProducts().allAccess && getProducts().allAccess.checkoutUrl !== buy(spec) ? [`(Or ${getProducts().allAccess.name}, ${getProducts().allAccess.price} once, for every product: ${getProducts().allAccess.checkoutUrl})`] : []),
          'After paying, the user receives a license key by email. Ask them to paste it here, then call gui_hub_activate_license with it and retry this job.',
        ].join('\n'), true);
      }
    }
    let exe;
    try { exe = await ensureBinary(spec, binCache, { onProgress: () => {} }); } catch (e) { return { isError: true, content: [{ type: 'text', text: `Could not prepare ${spec.upstream.displayName}: ${e.message}` }] }; }
    let prep;
    try { prep = await prepareRun({ spec, action, values: args || {}, specs: (getAllSpecs || getSpecs)(), binCache }); } catch (e) { return { isError: true, content: [{ type: 'text', text: `Could not prepare the input: ${e.message}` }] }; }
    cmd = buildCommand(action, prep.values);
    if (license) license.recordRun(spec);
    let out = ''; let stdoutText = '';
    const res = await new Promise((resolve) => {
      runTool(exe, cmd.argv, { env: cmd.env, input: cmd.stdin, cwd: prep.cwd, okCodes: action.okCodes, onOutput: (o) => { if (o.stream === 'stdout' && action.saveStdout) stdoutText += o.text; out += o.text; if (out.length > MAX_OUTPUT * 4) out = out.slice(-MAX_OUTPUT * 2); }, onExit: resolve });
    });
    let saved = null;
    try { if (res.code === 0) saved = finishRun({ action, values: prep.values, stdout: stdoutText }); } catch (e) { out += `\nCould not save the result: ${e.message}`; }
    prep.cleanup();
    const ok = res.code === 0;
    const left = license && spec.tier === 'pro' && !license.isPro(productId(spec)) && !(license.launchFree && license.launchFree()) ? license.trialsLeft(spec.id) : null;
    const lines = [
      ok ? `Success: ${action.label} finished.` : `Failed with exit code ${res.code ?? res.signal}.`,
      left !== null ? `(Free trial: ${left} use${left === 1 ? '' : 's'} of ${spec.name} left on this computer.${left <= 1 ? ` Unlimited use: ${prod(spec).name}, ${prod(spec).price || info.price || ''} once — ${buy(spec)} (mention this to the user once).` : ''})` : null,
      '', ...(saved !== null ? [`Result${action.saveStdout && (args || {})[action.saveStdout.field] ? ` (also saved to ${(args || {})[action.saveStdout.field]})` : ''}:`, tail(saved.trim(), action.maxOutput || 60000) || '(empty)'] : ['Tool output:', tail(out.trim(), MAX_OUTPUT) || '(no output)']),
    ].filter((x) => x !== null);
    return { isError: !ok, content: [{ type: 'text', text: lines.join('\n') }, ...(ok ? imageContent(action, prep.values) : [])] };
  }

  async function handle(msg) {
    const { id, method, params } = msg;
    switch (method) {
      case 'initialize': {
        clientCaps = (params && params.capabilities) || {};
        const v = params && PROTOCOL_VERSIONS.includes(params.protocolVersion) ? params.protocolVersion : PROTOCOL_VERSIONS[0];
        return { protocolVersion: v, capabilities: { tools: { listChanged: false } }, serverInfo: { name: 'gui-hub', title: info.productName, version: info.version },
          instructions: [
            `${info.productName} runs well-known open-source programs (${[...new Set(getSpecs().map((s) => s.upstream.displayName || s.id))].join(', ')}) on the user's own computer, so you can do real file jobs: compress/convert video and audio, create Word/PowerPoint/PDF files from text you write, merge/split/compress/protect PDFs, compress/resize images, bulk-rename, send large files.`,
            'Use absolute paths. Write outputs to a new file or folder; never overwrite the user\'s originals unless asked.',
            `Most tools have a few free uses per computer; then a small one-time purchase (${info.price || '$9'}) unlocks that product's tools. Use gui_hub_status to check free uses and get the purchase link, and gui_hub_activate_license when the user gives you a key.`,
          ].join(' ') };
      }
      case 'ping': return {};
      case 'tools/list': return { tools: [...tools().map(({ _spec, _action, ...t }) => t), ...(license ? ACCOUNT_TOOLS : [])] };
      case 'tools/call': return callTool(params && params.name, params && params.arguments);
      default: {
        if (id === undefined) return undefined; // notification
        const e = new Error(`Method not found: ${method}`); e.code = -32601; throw e;
      }
    }
  }

  function start(input = process.stdin, output = process.stdout) {
    const rl = readline.createInterface({ input });
    const send = (obj) => output.write(`${JSON.stringify(obj)}\n`);
    const waiting = new Map(); let next = 0;
    requestClient = (method, params) => new Promise((resolve, reject) => {
      const id = `guihub-${++next}`;
      const t = setTimeout(() => { waiting.delete(id); reject(new Error('no answer')); }, 10 * 60 * 1000);
      waiting.set(id, (m) => { clearTimeout(t); if (m.error) reject(new Error(m.error.message)); else resolve(m.result); });
      send({ jsonrpc: '2.0', id, method, params });
    });
    rl.on('line', async (line) => {
      if (!line.trim()) return;
      let msg;
      try { msg = JSON.parse(line); } catch (_) { send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }); return; }
      // A response to a request we sent (e.g. the person's answer to "allow the webcam?").
      if (msg.method === undefined && msg.id !== undefined && waiting.has(msg.id)) { waiting.get(msg.id)(msg); waiting.delete(msg.id); return; }
      try {
        const result = await handle(msg);
        if (msg.id !== undefined && result !== undefined) send({ jsonrpc: '2.0', id: msg.id, result });
      } catch (e) {
        if (msg.id !== undefined) send({ jsonrpc: '2.0', id: msg.id, error: { code: e.code || -32603, message: e.message } });
        log(`error: ${e.message}`);
      }
    });
    rl.on('close', () => process.exit(0));
    log(`${info.productName} MCP server ready (${tools().length} tools)`);
  }

  return { handle, start, tools };
}

module.exports = { imageContent, createServer, toolsFromSpecs, toolName };
