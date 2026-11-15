'use strict';
// MCP (Model Context Protocol) server over stdio. Every tool action in the catalog becomes an
// MCP tool automatically, with a JSON schema generated from the same form fields the GUI shows.
// Runs the same code path as the GUI: buildCommand -> license/trial gate -> ensureBinary -> runTool.
// stdout carries only JSON-RPC messages (one per line); all logging goes to stderr.
const readline = require('readline');
const { buildCommand } = require('./args');
const { ensureBinary } = require('./binaries');
const { runTool } = require('./runner');

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

function createServer({ getSpecs, license, binCache, info, log = (m) => process.stderr.write(`${m}\n`) }) {
  const tools = () => toolsFromSpecs(getSpecs());

  async function callTool(name, args) {
    const t = tools().find((x) => x.name === name);
    if (!t) return { isError: true, content: [{ type: 'text', text: `Unknown tool: ${name}` }] };
    const { _spec: spec, _action: action } = t;
    let cmd;
    try { cmd = buildCommand(action, args || {}); } catch (e) { return { isError: true, content: [{ type: 'text', text: `Invalid arguments: ${e.message}` }] }; }
    if (license) {
      await license.refresh().catch(() => {});
      const gate = license.canRun(spec);
      if (!gate.ok) {
        return { isError: true, content: [{ type: 'text', text: `${spec.name} is a Pro tool and its free tries are used up. Tell the user: one ${info.price || ''} purchase unlocks every tool in ${info.productName} (GUI and AI use) — ${info.checkoutUrl || info.siteUrl}. They then enter the license key in the ${info.productName} app.` }] };
      }
    }
    let exe;
    try { exe = await ensureBinary(spec, binCache, { onProgress: () => {} }); } catch (e) { return { isError: true, content: [{ type: 'text', text: `Could not prepare ${spec.upstream.displayName}: ${e.message}` }] }; }
    if (license) license.recordRun(spec);
    let out = '';
    const res = await new Promise((resolve) => {
      runTool(exe, cmd.argv, { env: cmd.env, input: cmd.stdin, cwd: (args || {})[action.cwdField] || undefined, onOutput: (o) => { out += o.text; if (out.length > MAX_OUTPUT * 4) out = out.slice(-MAX_OUTPUT * 2); }, onExit: resolve });
    });
    const ok = res.code === 0;
    const left = license && spec.tier === 'pro' && !license.isPro() ? license.trialsLeft(spec.id) : null;
    const lines = [
      ok ? `Success: ${action.label} finished.` : `Failed with exit code ${res.code ?? res.signal}.`,
      left !== null ? `(Free trial: ${left} use${left === 1 ? '' : 's'} of ${spec.name} left. Unlimited with ${info.productName} Pro: ${info.checkoutUrl || info.siteUrl})` : null,
      '', 'Tool output:', tail(out.trim(), MAX_OUTPUT) || '(no output)',
    ].filter((x) => x !== null);
    return { isError: !ok, content: [{ type: 'text', text: lines.join('\n') }] };
  }

  async function handle(msg) {
    const { id, method, params } = msg;
    switch (method) {
      case 'initialize': {
        const v = params && PROTOCOL_VERSIONS.includes(params.protocolVersion) ? params.protocolVersion : PROTOCOL_VERSIONS[0];
        return { protocolVersion: v, capabilities: { tools: { listChanged: false } }, serverInfo: { name: 'gui-hub', title: info.productName, version: info.version },
          instructions: `${info.productName} runs open-source tools (FFmpeg, pdfcpu, croc, F2, immich-go) locally. Use absolute paths. Output files are written where you say; never overwrite the user's originals unless asked.` };
      }
      case 'ping': return {};
      case 'tools/list': return { tools: tools().map(({ _spec, _action, ...t }) => t) };
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
    rl.on('line', async (line) => {
      if (!line.trim()) return;
      let msg;
      try { msg = JSON.parse(line); } catch (_) { send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }); return; }
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

module.exports = { createServer, toolsFromSpecs, toolName };
