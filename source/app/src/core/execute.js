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

// {field} → its value; {tmp} → this step's temp file; {tmp:name.wav} → a named file in the run's
// temp folder (so one step can write several files and later steps can use them).
function fill(token, values, tmp, tmpDir) {
  return token.replace(/\{([A-Za-z0-9_]+)(?::([A-Za-z0-9_.-]+))?\}/g, (_, k, name) => (k === 'tmp' ? (name ? path.join(tmpDir, name) : tmp) : String(values[k] ?? '')));
}

async function prepareRun({ spec, action, values, specs, binCache, onOutput = () => {} }) {
  const v = { ...values };
  // Prepare steps see the same defaults the main command gets (e.g. an output size nobody chose).
  for (const f of action.fields || []) if (v[f.id] === undefined && f.default !== undefined) v[f.id] = f.default;
  let tmpDir = null;
  // prepare: one step or a list. Each step runs another catalog tool first. With `replaces`, its
  // output file ({tmp}) is handed to this action in place of that field (e.g. FFmpeg turns any
  // recording into a WAV). With `captureStdout`, what it prints is kept in that value (e.g. the
  // speaker timeline, merged into the transcript afterwards). `cwd: "tool"` runs it in its folder.
  const steps = action.prepare ? (Array.isArray(action.prepare) ? action.prepare : [action.prepare]) : [];
  for (const p of steps) {
    // requires: skip a step whose input an earlier optional step could not make (e.g. no sound).
    if (p.requires && !v[p.requires]) continue;
    // { write: "lyrics.srt", from: "_lyrics", transform: "srt", sets: "_srt" }: save text from an
    // earlier step as a file in the temp folder (no program runs).
    if (p.write) {
      if (!tmpDir) tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'guihub-prep-'));
      // to: "{outDir}/transcript.txt" writes into a folder the user chose instead of the temp folder.
      const f = p.to ? fill(p.to, v, '', tmpDir) : path.join(tmpDir, p.write);
      if (p.to) fs.mkdirSync(path.dirname(f), { recursive: true });
      const raw = String(v[p.from] ?? '');
      const list = Array.isArray(v[p.from]) ? v[p.from] : [];
      // concatList: FFmpeg concat-demuxer list ("file '/path'"), quotes escaped the FFmpeg way.
      const text = p.transform === 'concatList' ? list.map((f) => `file '${String(f).replace(/\\/g, '/').replace(/'/g, "'\\''")}'`).join('\n')
        : p.transform === 'srt' ? segmentsToSrt(raw) : p.transform === 'srtScript' ? scriptToSrt(raw, String(v[p.script] ?? '')) : p.transform === 'segments' ? segmentsToText(raw, true) : raw;
      if (!text.trim() && p.emptyText) { fs.writeFileSync(f, `${p.emptyText}\n`, 'utf8'); if (p.sets) v[p.sets] = f; continue; }
      if ((p.transform === 'srt' || p.transform === 'srtScript') && !text.trim()) throw new Error(p.emptyMessage || 'no speech was found');
      fs.writeFileSync(f, `${text}\n`, 'utf8');
      if (p.sets) v[p.sets] = f;
      continue;
    }
    const helper = (specs || []).find((s) => s.id === p.tool);
    if (!helper) throw new Error(`${spec.name} needs ${p.tool}, which is not available`);
    if (!tmpDir) tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'guihub-prep-'));
    // forEach: run the step once per file of a list field ({item} = that file, {tmp} = its own
    // output), collecting the outputs in order (e.g. normalise every clip before joining them).
    if (p.forEach) {
      const items = Array.isArray(v[p.forEach]) ? v[p.forEach] : [v[p.forEach]].filter(Boolean);
      const exe = await ensureBinary(helper, binCache);
      const outs = [];
      for (const [i, item] of items.entries()) {
        const out = path.join(tmpDir, `part${String(i).padStart(3, '0')}${p.ext || ''}`);
        const argv = p.argv.map((t) => fill(t, { ...v, item }, out, tmpDir));
        onOutput({ stream: 'meta', text: `Preparing ${i + 1} of ${items.length} with ${helper.upstream.displayName || helper.id}…\n` });
        const res = await new Promise((resolve) => runTool(exe, argv, { onOutput: () => {}, onExit: resolve }));
        if (res.code !== 0 || !fs.existsSync(out)) throw new Error(`could not read ${path.basename(String(item))} (is it a video file?)`);
        outs.push(out);
      }
      if (p.collect) v[p.collect] = outs;
      continue;
    }
    const tmp = path.join(tmpDir, `${p.replaces || p.captureStdout || 'step'}${p.ext || ''}`);
    const exe = await ensureBinary(helper, binCache);
    const argv = p.argv.map((t) => fill(t, v, tmp, tmpDir));
    onOutput({ stream: 'meta', text: `Preparing with ${helper.upstream.displayName || helper.id}…\n` });
    let printed = '';
    const res = await new Promise((resolve) => runTool(exe, argv, { cwd: p.cwd === 'tool' ? binaryPaths(helper, binCache).dir : undefined, onOutput: (o) => { if (o.stream === 'stdout') printed += o.text; }, onExit: resolve }));
    // optional: a step that may fail without stopping the job (its values stay unset).
    const ok = res.code === 0 && (!p.replaces || fs.existsSync(tmp)) && Object.values(p.sets || {}).every((name) => fs.existsSync(path.join(tmpDir, name)));
    if (p.optional && !ok) continue;
    if (p.replaces) {
      if (res.code !== 0 || !fs.existsSync(tmp)) throw new Error(`could not read ${path.basename(String(values[p.replaces] || 'the input'))} (is it an audio or video file?)`);
      v[p.replaces] = tmp;
    }
    if (p.captureStdout) {
      if (res.code !== 0) throw new Error(`${helper.name} failed (exit ${res.code})`);
      v[p.captureStdout] = printed;
    }
    // sets: { _inst: "inst.wav" } → later steps and the main program get that temp file's path.
    for (const [k, name] of Object.entries(p.sets || {})) {
      const f = path.join(tmpDir, name);
      if (res.code !== 0 || !fs.existsSync(f)) throw new Error(`${helper.name} failed (exit ${res.code})`);
      v[k] = f;
    }
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

// Captions for a known script read by a synthetic voice: Whisper gives the timing, the script gives
// the words. Each Whisper segment gets the same share of the script's words as of the heard words.
function scriptToSrt(stdout, script) {
  const segs = [];
  for (const l of String(stdout).split(/\r?\n/)) {
    const m = l.match(/^\s*(\d+(?:\.\d+)?)\s*--\s*(\d+(?:\.\d+)?)\s*:\s*(.*\S)\s*$/);
    if (m) segs.push({ a: Number(m[1]), b: Number(m[2]), n: m[3].split(/\s+/).length });
  }
  const words = String(script).trim().split(/\s+/).filter(Boolean);
  if (!segs.length || !words.length) return '';
  const heard = segs.reduce((x, s) => x + s.n, 0);
  let i = 0;
  const lines = segs.map((s, k) => {
    const take = k === segs.length - 1 ? words.length - i : Math.max(1, Math.round((s.n / heard) * words.length));
    const text = words.slice(i, i + take).join(' '); i += take;
    return `${s.a.toFixed(3)} -- ${s.b.toFixed(3)}: ${text}`;
  }).filter((l) => !/:\s*$/.test(l));
  return segmentsToSrt(lines.join('\n'));
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

// Transcript segments + speaker timeline → "[hh:mm:ss] Speaker N: text", one line per turn.
function speakerTranscript(stdout, speakers) {
  const turns = [];
  for (const l of String(speakers || '').split(/\r?\n/)) {
    const m = l.match(/^\s*(\d+(?:\.\d+)?)\s*--\s*(\d+(?:\.\d+)?)\s+speaker_(\d+)/);
    if (m) turns.push([Number(m[1]), Number(m[2]), m[3]]);
  }
  const order = new Map(); const out = []; let last = null;
  const hms = (x) => { const t = Math.floor(x); return `${String(Math.floor(t / 3600)).padStart(2, '0')}:${String(Math.floor((t % 3600) / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`; };
  for (const l of String(stdout).split(/\r?\n/)) {
    const m = l.match(/^\s*(\d+(?:\.\d+)?)\s*--\s*(\d+(?:\.\d+)?)\s*:\s*(.*\S)\s*$/);
    if (!m) continue;
    const a = Number(m[1]); const b = Number(m[2]);
    let best = null; let bestOverlap = 0;
    for (const [s0, s1, id] of turns) { const o = Math.min(b, s1) - Math.max(a, s0); if (o > bestOverlap) { bestOverlap = o; best = id; } }
    if (best !== null && !order.has(best)) order.set(best, order.size + 1);
    const who = best === null ? 'Speaker ?' : `Speaker ${order.get(best)}`;
    if (last && last.who === who) last.text += ` ${m[3]}`;
    else { last = { at: a, who, text: m[3] }; out.push(last); }
  }
  return out.map((x) => `[${hms(x.at)}] ${x.who}: ${x.text}`).join('\n');
}

function finishRun({ action, values, stdout }) {
  const s = action.saveStdout;
  if (!s) return null;
  const text = s.transform === 'segments' ? segmentsToText(stdout, values[s.stampsField] === true || values[s.stampsField] === 'true') : s.transform === 'srt' ? segmentsToSrt(stdout) : s.transform === 'speakers' ? speakersToText(stdout) : s.transform === 'speakerTranscript' ? speakerTranscript(stdout, values[s.speakersField || '_speakers']) : String(stdout);
  if (values[s.field]) fs.writeFileSync(values[s.field], `${text}\n`);
  return text;
}

module.exports = { prepareRun, finishRun, segmentsToText, segmentsToSrt, scriptToSrt, speakersToText, speakerTranscript };
