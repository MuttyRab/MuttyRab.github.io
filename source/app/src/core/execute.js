'use strict';
// Shared steps around a tool run, used by the GUI, the MCP server and the smoke tests:
//  - prepare: run another catalog tool first (e.g. FFmpeg turns any audio/video into a WAV
//    for the speech engine) and hand its output file to this action in place of the input;
//  - cwd "tool": run inside the tool's own folder so it finds downloaded models (extras);
//  - saveStdout: write the program's printed result to a file the user chose (transcripts).
const fs = require('fs');
const os = require('os');
const path = require('path');
const { ensureBinary, binaryPaths } = require('./binaries');
const { runTool } = require('./runner');

function fill(token, values, tmp) {
  return token.replace(/\{([A-Za-z0-9_]+)\}/g, (_, k) => (k === 'tmp' ? tmp : String(values[k] ?? '')));
}

async function prepareRun({ spec, action, values, specs, binCache, onOutput = () => {} }) {
  const v = { ...values };
  let tmpDir = null;
  if (action.prepare) {
    const p = action.prepare;
    const helper = (specs || []).find((s) => s.id === p.tool);
    if (!helper) throw new Error(`${spec.name} needs ${p.tool}, which is not available`);
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'guihub-prep-'));
    const tmp = path.join(tmpDir, `input${p.ext || ''}`);
    const exe = await ensureBinary(helper, binCache);
    const argv = p.argv.map((t) => fill(t, v, tmp));
    onOutput({ stream: 'meta', text: `Preparing with ${helper.upstream.displayName || helper.id}…\n` });
    const res = await new Promise((resolve) => runTool(exe, argv, { onOutput: () => {}, onExit: resolve }));
    if (res.code !== 0 || !fs.existsSync(tmp)) throw new Error(`could not read ${path.basename(String(values[p.replaces] || 'the input'))} (is it an audio or video file?)`);
    v[p.replaces] = tmp;
  }
  const cwd = action.cwd === 'tool' ? binaryPaths(spec, binCache).dir : (values[action.cwdField] || undefined);
  return { values: v, cwd, cleanup: () => { if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true }); } };
}

// Turns "12.340 -- 15.002: text" lines into a transcript (with [mm:ss] stamps or plain).
function segmentsToText(stdout, stamps) {
  const lines = [];
  for (const l of String(stdout).split(/\r?\n/)) {
    const m = l.match(/^\s*(\d+(?:\.\d+)?)\s*--\s*(\d+(?:\.\d+)?)\s*:\s*(.*\S)\s*$/);
    if (!m) continue;
    const t = Math.floor(Number(m[1]));
    const ts = `${String(Math.floor(t / 3600)).padStart(2, '0')}:${String(Math.floor((t % 3600) / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
    lines.push(stamps ? `[${ts}] ${m[3]}` : m[3]);
  }
  return lines.join(stamps ? '\n' : '\n');
}

function finishRun({ action, values, stdout }) {
  const s = action.saveStdout;
  if (!s) return null;
  const text = s.transform === 'segments' ? segmentsToText(stdout, values[s.stampsField] === true || values[s.stampsField] === 'true') : String(stdout);
  if (values[s.field]) fs.writeFileSync(values[s.field], `${text}\n`);
  return text;
}

module.exports = { prepareRun, finishRun, segmentsToText };
