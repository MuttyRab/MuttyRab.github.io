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
  // textFiles: text the user or AI typed (e.g. form answers as JSON) is written to a temp file
  // and the program gets that file's path in place of the text.
  for (const t of action.textFiles || []) {
    if (v[t.field] === undefined || v[t.field] === '') continue;
    if (!tmpDir) tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'guihub-prep-'));
    const f = path.join(tmpDir, `${t.field}${t.ext || '.txt'}`);
    fs.writeFileSync(f, String(v[t.field]), 'utf8');
    v[t.field] = f;
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

// SRT subtitles from "start -- end: text" segments. Long segments are split into captions of at
// most ~80 characters (two lines), with time shared out by length, so they stay readable.
function srtTime(sec) {
  const ms = Math.max(0, Math.round(sec * 1000));
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return `${p(Math.floor(ms / 3600000))}:${p(Math.floor((ms % 3600000) / 60000))}:${p(Math.floor((ms % 60000) / 1000))},${p(ms % 1000, 3)}`;
}
function wrap2(t) {
  if (t.length <= 42) return t;
  const mid = t.lastIndexOf(' ', Math.ceil(t.length / 2) + 6);
  return mid > 0 ? `${t.slice(0, mid)}\n${t.slice(mid + 1)}` : t;
}
function segmentsToSrt(stdout) {
  const cues = [];
  for (const l of String(stdout).split(/\r?\n/)) {
    const m = l.match(/^\s*(\d+(?:\.\d+)?)\s*--\s*(\d+(?:\.\d+)?)\s*:\s*(.*\S)\s*$/);
    if (!m) continue;
    const a = Number(m[1]); const b = Math.max(Number(m[2]), a + 0.5);
    const words = m[3].split(/\s+/); const chunks = []; let cur = '';
    for (const w of words) { if (cur && (cur + ' ' + w).length > 80) { chunks.push(cur); cur = w; } else cur = cur ? `${cur} ${w}` : w; }
    if (cur) chunks.push(cur);
    const total = chunks.reduce((n, c) => n + c.length, 0); let t = a;
    for (const c of chunks) { const d = (b - a) * (c.length / total); cues.push([t, t + d, wrap2(c)]); t += d; }
  }
  return cues.map(([a, b, x], i) => `${i + 1}\n${srtTime(a)} --> ${srtTime(b)}\n${x}\n`).join('\n');
}

// "0.031 -- 3.102 speaker_01" → "[00:00:00 → 00:00:03] Speaker 2"
function speakersToText(stdout) {
  const hms = (x) => { const t = Math.floor(Number(x)); return `${String(Math.floor(t / 3600)).padStart(2, '0')}:${String(Math.floor((t % 3600) / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`; };
  const out = []; const order = new Map(); // number speakers in the order they first talk
  for (const l of String(stdout).split(/\r?\n/)) {
    const m = l.match(/^\s*(\d+(?:\.\d+)?)\s*--\s*(\d+(?:\.\d+)?)\s+speaker_(\d+)/);
    if (!m) continue;
    if (!order.has(m[3])) order.set(m[3], order.size + 1);
    out.push(`[${hms(m[1])} → ${hms(m[2])}] Speaker ${order.get(m[3])}`);
  }
  return out.join('\n');
}

function finishRun({ action, values, stdout }) {
  const s = action.saveStdout;
  if (!s) return null;
  const text = s.transform === 'segments' ? segmentsToText(stdout, values[s.stampsField] === true || values[s.stampsField] === 'true') : s.transform === 'srt' ? segmentsToSrt(stdout) : s.transform === 'speakers' ? speakersToText(stdout) : String(stdout);
  if (values[s.field]) fs.writeFileSync(values[s.field], `${text}\n`);
  return text;
}

module.exports = { prepareRun, finishRun, segmentsToText, segmentsToSrt, speakersToText };
