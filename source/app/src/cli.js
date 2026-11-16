#!/usr/bin/env node
'use strict';
// GUI Hub on the command line, for AI agents that have their own computer (Grok Bot, ChatGPT dots,
// Claude Duet, OpenClaw, Manus, Codex, ...) and for scripts. Same tools, free uses and license as
// the desktop app and the MCP server.
//
//   npx -y https://guihub.cc/cli.tgz list                 # every job, one line each
//   npx -y https://guihub.cc/cli.tgz info <tool>          # parameters of one job
//   npx -y https://guihub.cc/cli.tgz run <tool> --input /abs/in.mov --out /abs/out.mp4
//   npx -y https://guihub.cc/cli.tgz status | activate <license-key>
//
// Exit codes: 0 done, 1 failed, 2 usage error, 3 free uses used up (show the user the purchase link).
const path = require('path');
const { setup } = require('./server-setup');

const EXIT = { ok: 0, failed: 1, usage: 2, payment: 3 };
const args = process.argv.slice(2).filter((a) => !a.startsWith('--product='));
const json = args.includes('--json');

// MCP wording → command-line wording.
const cliText = (t) => String(t).replace(/call gui_hub_activate_license with it/g, 'run: guihub activate <license-key>').replace(/gui_hub_activate_license/g, 'guihub activate <license-key>').replace(/gui_hub_status/g, 'guihub status');
function out(s) { process.stdout.write(`${cliText(s)}\n`); }

function parseFlags(list, schema) {
  const props = (schema && schema.properties) || {};
  const v = {};
  for (let i = 0; i < list.length; i++) {
    const a = list[i];
    if (!a.startsWith('--')) throw new Error(`unexpected argument "${a}" (use --name value)`);
    let [k, val] = a.slice(2).split(/=(.*)/s);
    const p = props[k];
    if (!p) throw new Error(`unknown option --${k}. Run "guihub info <tool>" to see the options.`);
    if (val === undefined) {
      if (p.type === 'boolean' && (i + 1 >= list.length || list[i + 1].startsWith('--'))) val = 'true';
      else val = list[++i];
    }
    if (val === undefined) throw new Error(`--${k} needs a value`);
    if (p.type === 'boolean') v[k] = !/^(false|0|no)$/i.test(val);
    else if (p.type === 'number') v[k] = Number(val);
    else if (p.type === 'array') (v[k] = v[k] || []).push(path.resolve(val));
    else if (/Absolute (file|folder) path/.test(p.description || '')) v[k] = path.resolve(val);
    else v[k] = val;
  }
  return v;
}

function usage(tools, name) {
  out(`${name} — run trusted open-source programs (FFmpeg, Whisper, Pandoc, Typst, pdfcpu, DuckDB, 7-Zip, Real-ESRGAN, …) on this computer.

Usage:
  guihub list [--json]              all jobs
  guihub info <tool> [--json]       options of one job
  guihub run <tool> --opt value …   do the job (paths may be relative)
  guihub status                     free uses left + purchase links
  guihub activate <license-key>     unlock after the user has paid

${tools.length} jobs available. Free uses on every computer; after that a one-time purchase unlocks
them. Exit code 3 = free uses used up: show the user the purchase link from the message.`);
}

(async () => {
  const s = setup({ argv: process.argv, remoteTimeoutMs: 4000 });
  await s.ready;
  const call = async (name, a) => s.server.handle({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: a } });
  const tools = s.server.tools();
  const [cmd, ...rest] = args.filter((a) => a !== '--json');
  const find = (n) => tools.find((t) => t.name === n || t.name === String(n || '').replace(/-/g, '_'));

  if (!cmd || cmd === 'help' || cmd === '--help' || cmd === '-h') { usage(tools, s.productName); return EXIT.ok; }
  if (cmd === '--version' || cmd === 'version') { out(s.pkg.version); return EXIT.ok; }
  if (cmd === 'list') {
    if (json) { out(JSON.stringify(tools.map((t) => ({ name: t.name, title: t.title, description: t.description })), null, 2)); return EXIT.ok; }
    for (const t of tools) out(`${t.name.padEnd(26)} ${t.title}`);
    out('\nDetails: guihub info <tool>   ·   Run: guihub run <tool> --option value …');
    return EXIT.ok;
  }
  if (cmd === 'info') {
    const t = find(rest[0]);
    if (!t) { out(`Unknown tool "${rest[0] || ''}". Run: guihub list`); return EXIT.usage; }
    if (json) { out(JSON.stringify({ name: t.name, description: t.description, inputSchema: t.inputSchema }, null, 2)); return EXIT.ok; }
    out(`${t.name} — ${t.title}\n${t.description}\n\nOptions:`);
    for (const [k, p] of Object.entries(t.inputSchema.properties)) {
      const req = (t.inputSchema.required || []).includes(k) ? ' (required)' : '';
      out(`  --${k}${p.type === 'array' ? ' <path> (repeat for several)' : p.type === 'boolean' ? ' [true|false]' : ' <value>'}${req}${p.default !== undefined ? ` [default: ${p.default}]` : ''}\n      ${p.description}`);
    }
    return EXIT.ok;
  }
  if (cmd === 'status' || cmd === 'activate') {
    const r = await call(cmd === 'status' ? 'gui_hub_status' : 'gui_hub_activate_license', cmd === 'activate' ? { licenseKey: rest[0] || '' } : {});
    out(r.content.map((c) => c.text).join('\n'));
    return r.isError ? EXIT.failed : EXIT.ok;
  }
  // "guihub run <tool> …" or the shorthand "guihub <tool> …"
  const toolName = cmd === 'run' ? rest[0] : cmd;
  const flags = cmd === 'run' ? rest.slice(1) : rest;
  const t = find(toolName);
  if (!t) { out(`Unknown command or tool "${toolName || ''}". Run: guihub list`); return EXIT.usage; }
  let values;
  try { values = parseFlags(flags, t.inputSchema); } catch (e) { out(`${e.message}`); return EXIT.usage; }
  const missing = (t.inputSchema.required || []).filter((k) => values[k] === undefined);
  if (missing.length) { out(`Missing ${missing.map((k) => `--${k}`).join(', ')}. See: guihub info ${t.name}`); return EXIT.usage; }
  process.stderr.write(`Running ${t.title}… (the first run downloads the program once)\n`);
  const r = await call(t.name, values);
  const text = r.content.map((c) => c.text).join('\n');
  out(text);
  if (r.isError && /free uses of .* are used up/i.test(text)) return EXIT.payment;
  return r.isError ? EXIT.failed : EXIT.ok;
})().then((code) => process.exit(code), (e) => { process.stderr.write(`${e && e.stack || e}\n`); process.exit(EXIT.failed); });
