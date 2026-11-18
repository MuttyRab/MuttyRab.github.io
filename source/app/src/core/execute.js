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
// {field}, {tmp}, {tmp:name.wav}; {field|dir} = the folder part of a path value (e.g. a voice model's folder).
function fill(token, values, tmp, tmpDir) {
  return token.replace(/\{([A-Za-z0-9_]+)(?::([A-Za-z0-9_.-]+))?(\|dir)?\}/g, (_, k, name, dir) => {
    if (k === 'tmp') return name ? path.join(tmpDir, name) : tmp;
    const val = String(values[k] ?? '');
    return dir ? path.posix.dirname(val.replace(/\\/g, '/')) : val;
  });
}

async function prepareRun({ spec, action, values, specs, binCache, onOutput = () => {} }) {
  const v = { ...values };
  // Prepare steps see the same defaults the main command gets (e.g. an output size nobody chose).
  for (const f of action.fields || []) if (v[f.id] === undefined && f.default !== undefined) v[f.id] = f.default;
  // {_os} (win32/darwin/linux) and {_display} let steps differ per platform (e.g. screen capture devices).
  v._os = process.platform; v._display = process.env.DISPLAY || ':0.0';
  // {_selfDir}: this tool's own folder (its extras, e.g. voice models used by a helper program).
  if (binCache && spec && spec.binary) { try { v._selfDir = binaryPaths(spec, binCache).dir.replace(/\\/g, '/'); } catch (e) { /* not installed yet */ } }
  let tmpDir = null;
  // prepare: one step or a list. Each step runs another catalog tool first. With `replaces`, its
  // output file ({tmp}) is handed to this action in place of that field (e.g. FFmpeg turns any
  // recording into a WAV). With `captureStdout`, what it prints is kept in that value (e.g. the
  // speaker timeline, merged into the transcript afterwards). `cwd: "tool"` runs it in its folder.
  const steps = action.prepare ? (Array.isArray(action.prepare) ? action.prepare : [action.prepare]) : [];
  for (const p of steps) {
    // requires: skip a step whose input an earlier optional step could not make (e.g. no sound).
    if (p.requires && !v[p.requires]) continue;
    // when/equals: run only on a matching value (e.g. when "_os" equals "darwin"); unless: skip once a
    // value is set (a fallback that runs only if an earlier optional step failed).
    if (p.when && ('equals' in p ? v[p.when] !== p.equals : !v[p.when])) continue;
    if (p.unless && v[p.unless]) continue;
    // { pick: "_devices", transform: "dshowAudio", sets: "_mic" }: choose a value from earlier output.
    if (p.pick) { const val = p.transform === 'dshowAudio' ? dshowAudio(v[p.pick]) : String(v[p.pick] ?? ''); if (val) v[p.sets] = val; continue; }
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
        : p.transform === 'silenceKeep' ? keepGraph(silenceToKeep(raw, p.pad ?? 0.15)) : p.transform === 'rangesKeep' ? keepGraph(rangesToKeep(raw, v[p.modeField] === 'remove')) : p.transform === 'srt' ? segmentsToSrt(raw, p.maxChars || 80) : p.transform === 'srtScript' ? scriptToSrt(raw, String(v[p.script] ?? '')) : p.transform === 'segments' ? segmentsToText(raw, true) : raw;
      if (!text.trim() && p.emptyText) { fs.writeFileSync(f, `${p.emptyText}\n`, 'utf8'); if (p.sets) v[p.sets] = f; continue; }
      if ((p.transform === 'srt' || p.transform === 'srtScript') && !text.trim()) throw new Error(p.emptyMessage || 'no speech was found');
      fs.writeFileSync(f, `${text}\n`, 'utf8');
      if (p.sets) v[p.sets] = f;
      continue;
    }
    // { cues: "subs", sets: "_lines", times: "_times" }: read an .srt file into its caption texts and
    // [start, end] seconds — one list item per caption (e.g. to speak each one with forEach).
    if (p.cues) {
      const cues = parseSrt(fs.readFileSync(String(v[p.cues]), 'utf8'));
      if (!cues.length) throw new Error('no subtitles found in that .srt file');
      v[p.sets] = cues.map((c) => c.text); v[p.times] = cues.map((c) => [c.start, c.end]);
      continue;
    }
    // { dubTrack: "_parts", times: "_times", to: "dub.wav", sets: "_dub" }: place each spoken caption
    // (16-bit PCM WAV) at its start time in one track; a line that runs long pushes the next one later.
    if (p.dubTrack) {
      if (!tmpDir) tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'guihub-prep-'));
      const f = path.join(tmpDir, p.to || 'dub.wav');
      fs.writeFileSync(f, buildDubTrack((v[p.dubTrack] || []).map((x) => fs.readFileSync(x)), v[p.times] || []));
      v[p.sets] = f;
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
    let errText = '';
    const res = await new Promise((resolve) => runTool(exe, argv, { cwd: p.cwd === 'tool' ? binaryPaths(helper, binCache).dir : undefined, onOutput: (o) => { if (o.stream === 'stdout') printed += o.text; else errText += o.text; }, onExit: resolve }));
    // captureStderr: keep what the program printed to stderr whatever its exit code (e.g. a device list).
    if (p.captureStderr) { v[p.captureStderr] = errText; continue; }
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
function segmentsToSrt(stdout, maxChars = 80) {
  const cues = [];
  for (const l of String(stdout).split(/\r?\n/)) {
    const m = l.match(/^\s*(\d+(?:\.\d+)?)\s*--\s*(\d+(?:\.\d+)?)\s*:\s*(.*\S)\s*$/);
    if (!m) continue;
    const a = Number(m[1]); const b = Math.max(Number(m[2]), a + 0.5);
    const words = m[3].split(/\s+/); const chunks = []; let cur = '';
    for (const w of words) { if (cur && (cur + ' ' + w).length > maxChars) { chunks.push(cur); cur = w; } else cur = cur ? `${cur} ${w}` : w; }
    if (cur) chunks.push(cur);
    const total = chunks.reduce((n, c) => n + c.length, 0); let t = a;
    for (const c of chunks) { const d = (b - a) * (c.length / total); cues.push([t, t + d, wrap2(c)]); t += d; }
  }
  return cues.map(([a, b, x], i) => `${i + 1}\n${srtTime(a)} --> ${srtTime(b)}\n${x}\n`).join('\n');
}

// FFmpeg "-list_devices true -f dshow -i dummy" output → the first audio input device's name.
function dshowAudio(text) {
  for (const l of String(text || '').split(/\r?\n/)) { const m = l.match(/"([^"]+)"\s*\(audio\)/); if (m) return m[1]; }
  return '';
}
// SRT text → [{start, end, text}] (seconds). Tolerates BOMs, CRLF, "," or "." millis and blank lines.
function parseSrt(text) {
  const out = []; const t = (h, m, sec, ms) => (+h) * 3600 + (+m) * 60 + (+sec) + (+ms) / 1000;
  for (const block of String(text).replace(/^﻿/, '').split(/\r?\n\s*\r?\n/)) {
    const lines = block.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const i = lines.findIndex((l) => /-->/.test(l)); if (i < 0) continue;
    const m = lines[i].match(/(\d+):(\d+):(\d+)[,.](\d+)\s*-->\s*(\d+):(\d+):(\d+)[,.](\d+)/); if (!m) continue;
    const words = lines.slice(i + 1).join(' ').replace(/<[^>]+>/g, '').replace(/^[-–—]+\s*/, '').trim(); if (!words) continue;
    out.push({ start: t(m[1], m[2], m[3], m[4]), end: t(m[5], m[6], m[7], m[8]), text: words });
  }
  return out;
}
// Spoken captions (mono/stereo 16-bit PCM WAVs, same rate) → one mono WAV with each at its start time.
function buildDubTrack(wavs, times) {
  const parse = (b) => { let o = 12, rate = 22050, ch = 1, data = null; while (o + 8 <= b.length) { const id = b.toString('ascii', o, o + 4), len = b.readUInt32LE(o + 4); if (id === 'fmt ') { ch = b.readUInt16LE(o + 10); rate = b.readUInt32LE(o + 12); } if (id === 'data') { data = b.subarray(o + 8, Math.min(b.length, o + 8 + len)); break; } o += 8 + len + (len % 2); } return { rate, ch, data: data || Buffer.alloc(0) }; };
  const parts = wavs.map(parse); const rate = parts.length ? parts[0].rate : 22050;
  const placed = []; let t = 0;
  parts.forEach((p, i) => { const n = Math.floor(p.data.length / 2 / p.ch); const start = Math.max(Math.round(((times[i] || [0])[0]) * rate), t); placed.push([start, p, n]); t = start + n; });
  const pcm = Buffer.alloc(t * 2);
  for (const [start, p, n] of placed) for (let k = 0; k < n; k++) pcm.writeInt16LE(p.data.readInt16LE(k * 2 * p.ch), (start + k) * 2);
  const h = Buffer.alloc(44); h.write('RIFF', 0); h.writeUInt32LE(36 + pcm.length, 4); h.write('WAVEfmt ', 8); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}

// Cutting a talking video in one pass: "keep" ranges (seconds) become an FFmpeg filtergraph that
// keeps only those parts of the picture and the sound, in order, without drifting out of sync.
const END = 1e9; // "until the end" — FFmpeg's between(t,a,b) needs a number
function keepGraph(keep) {
  if (!keep.length) throw new Error('nothing would be left of the video — check the times');
  const e = keep.map(([a, b]) => `between(t,${a.toFixed(3)},${b >= END ? END : b.toFixed(3)})`).join('+');
  return `[0:v]select='${e}',setpts=N/FRAME_RATE/TB[v];[0:a]aselect='${e}',asetpts=N/SR/TB[a]`;
}
// "1:02:03.5", "12:30", "750", "750.5s" → seconds
function parseTime(t) {
  const s = String(t).trim().replace(/s$/i, '').replace(',', '.');
  if (!/^\d+(?::\d{1,2}){0,2}(?:\.\d+)?$/.test(s)) return NaN;
  return s.split(':').reduce((acc, x) => acc * 60 + Number(x), 0);
}
// "0:00-0:42, 1:10 to 3:05" → [[0,42],[70,185]], sorted and merged. With remove, the complement.
function rangesToKeep(text, remove) {
  const out = [];
  for (const part of String(text).split(/[,;\n]+/)) {
    if (!part.trim()) continue;
    const m = part.trim().match(/^(.+?)\s*(?:-|–|—|to)\s*(.+|end)$/i);
    const a = m ? parseTime(m[1]) : NaN; const b = m ? (/^end$/i.test(m[2].trim()) ? END : parseTime(m[2])) : NaN;
    if (!(a >= 0) || !(b > a)) throw new Error(`can't read the time range "${part.trim()}" — write it like 1:10-3:05`);
    out.push([a, b]);
  }
  if (!out.length) throw new Error('no time ranges given — write them like 0:00-0:42, 1:10-3:05');
  out.sort((x, y) => x[0] - y[0]);
  const merged = [];
  for (const r of out) { const last = merged[merged.length - 1]; if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]); else merged.push([...r]); }
  if (!remove) return merged;
  const keep = []; let t = 0;
  for (const [a, b] of merged) { if (a > t) keep.push([t, a]); t = b; }
  if (t < END) keep.push([t, END]);
  return keep;
}
// FFmpeg silencedetect + ametadata print ("lavfi.silence_start=12.3" / "lavfi.silence_end=13.9")
// → the parts to keep. Each pause keeps `pad` seconds at both ends so speech isn't clipped.
function silenceToKeep(stdout, pad) {
  const sil = []; let start = null;
  for (const l of String(stdout).split(/\r?\n/)) {
    const a = l.match(/lavfi\.silence_start=(-?[\d.]+)/); if (a) { start = Math.max(0, Number(a[1])); continue; }
    const b = l.match(/lavfi\.silence_end=([\d.]+)/); if (b && start !== null) { sil.push([start, Number(b[1])]); start = null; }
  }
  if (start !== null) sil.push([start, END]); // silent until the end
  const keep = []; let t = 0;
  for (const [a, b] of sil) {
    const cutA = a === 0 ? 0 : a + pad; const cutB = b >= END ? END : b - pad;
    if (cutB - cutA < 0.1) continue;
    if (cutA > t) keep.push([t, cutA]);
    t = cutB;
  }
  if (t < END) keep.push([t, END]);
  return keep;
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

module.exports = { prepareRun, finishRun, segmentsToText, segmentsToSrt, scriptToSrt, speakersToText, speakerTranscript, keepGraph, rangesToKeep, silenceToKeep, parseTime, parseSrt, buildDubTrack, fill, dshowAudio };
