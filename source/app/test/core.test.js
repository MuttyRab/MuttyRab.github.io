'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { buildCommand, validate } = require('../src/core/args');
const { loadCatalog, checkSpec, platformKey } = require('../src/core/spec');
const { ensureBinary } = require('../src/core/binaries');
const { runTool, clean } = require('../src/core/runner');
const { LicenseStore } = require('../src/core/license');

const catalogDir = path.join(__dirname, '..', '..', 'catalog');
const { specs, errors } = loadCatalog(catalogDir, { includeBeta: true });
const spec = (id) => specs.find((s) => s.id === id);
const action = (id, a) => spec(id).actions.find((x) => x.id === a);

test('every catalog spec is valid', () => {
  assert.deepStrictEqual(errors, []);
  assert.ok(specs.length >= 4);
});

test('checkSpec catches broken specs', () => {
  const p = checkSpec({ id: 'Bad Id', tier: 'x', actions: [{ id: 'a', label: 'A', fields: [{ id: 'f', label: 'F', type: 'nope' }], argv: [{ field: 'missing' }] }] });
  assert.ok(p.some((m) => m.includes('slug')));
  assert.ok(p.some((m) => m.includes('unknown type')));
  assert.ok(p.some((m) => m.includes('unknown field missing')));
});

test('croc receive passes the code only through the environment', () => {
  const { argv, env } = buildCommand(action('croc', 'receive'), { code: '1234-apple-banana-cherry', dest: '/tmp' });
  assert.deepStrictEqual(argv, ['--yes', '--rename']);
  assert.strictEqual(env.CROC_SECRET, '1234-apple-banana-cherry');
  assert.ok(!argv.join(' ').includes('apple'));
});

test('croc send expands multiple files and optional relay', () => {
  let r = buildCommand(action('croc', 'send'), { paths: ['/a b.txt', '/c.txt'] });
  assert.deepStrictEqual(r.argv, ['send', '/a b.txt', '/c.txt']);
  r = buildCommand(action('croc', 'send'), { paths: ['/c.txt'], relay: 'r.example:9009' });
  assert.deepStrictEqual(r.argv, ['--relay', 'r.example:9009', 'send', '/c.txt']);
});

test('pdfcpu merge puts output before inputs', () => {
  const { argv } = buildCommand(action('pdfcpu', 'merge'), { inputs: ['/x/1.pdf', '/x/2.pdf'], out: '/x/all.pdf' });
  assert.deepStrictEqual(argv, ['merge', '/x/all.pdf', '/x/1.pdf', '/x/2.pdf']);
});

test('pdfcpu split hides span unless mode=span', () => {
  let { argv } = buildCommand(action('pdfcpu', 'split'), { input: '/i.pdf', outDir: '/o' });
  assert.deepStrictEqual(argv, ['split', '--mode', 'span', '/i.pdf', '/o', '1']);
  ({ argv } = buildCommand(action('pdfcpu', 'split'), { input: '/i.pdf', outDir: '/o', mode: 'bookmark', span: '5' }));
  assert.deepStrictEqual(argv, ['split', '--mode', 'bookmark', '/i.pdf', '/o']);
});

test('pdfcpu flags come before positional args', () => {
  const { argv } = buildCommand(action('pdfcpu', 'encrypt'), { input: '/i.pdf', upw: 'a', opw: 'b', out: '/o.pdf' });
  assert.deepStrictEqual(argv, ['encrypt', '--upw', 'a', '--opw', 'b', '/i.pdf', '/o.pdf']);
});

test('immich-go uses --flag=value and dry run by default', () => {
  const { argv } = buildCommand(action('immich-go', 'from-folder'), { server: 'http://h:2283', apiKey: 'k', folder: '/p', albums: 'FOLDER' });
  assert.deepStrictEqual(argv, ['upload', 'from-folder', '--no-ui', '--server=http://h:2283', '--api-key=k', '--folder-as-album=FOLDER', '--dry-run', '/p']);
});

test('f2 preview omits -x; apply adds it; empty replace strips', () => {
  let { argv } = buildCommand(action('f2', 'rename'), { folder: '/d', find: 'IMG_' });
  assert.deepStrictEqual(argv, ['-f', 'IMG_']);
  ({ argv } = buildCommand(action('f2', 'rename'), { folder: '/d', find: 'IMG_', replace: 'pic-', recursive: true, apply: true }));
  assert.deepStrictEqual(argv, ['-f', 'IMG_', '-r', 'pic-', '-R', '-x']);
});

test('validation reports required and minLength', () => {
  const errs = validate(action('croc', 'receive'), { code: 'abc' });
  const msgs = errs.map((e) => e.field);
  assert.ok(msgs.includes('code'));
  assert.ok(msgs.includes('dest'));
  assert.throws(() => buildCommand(action('croc', 'receive'), {}), (e) => Array.isArray(e.fieldErrors));
});

test('user input is never shell-interpreted', async () => {
  const out = [];
  await new Promise((resolve) => runTool(process.execPath, ['-e', 'console.log(process.argv[1])', '$(echo pwned); rm -rf /'], {
    onOutput: (o) => out.push(o.text), onExit: resolve,
  }));
  assert.strictEqual(out.join('').trim(), '$(echo pwned); rm -rf /');
});

test('stdin is closed so tools that read it when not a TTY do not hang', async () => {
  const out = [];
  const r = await new Promise((resolve) => {
    runTool(process.execPath, ['-e', "let n=0;process.stdin.on('data',d=>n+=d.length).on('end',()=>console.log('eof',n))"], {
      onOutput: (o) => out.push(o.text), onExit: resolve,
    });
  });
  assert.strictEqual(r.code, 0);
  assert.strictEqual(out.join('').trim(), 'eof 0');
});

test('stdinField pipes text to the tool and closes stdin', async () => {
  const a = { id: 'w', fields: [{ id: 'src', type: 'textarea', required: true }], argv: ['-'], stdinField: 'src' };
  const cmd = buildCommand(a, { src: 'héllo\nworld' });
  assert.strictEqual(cmd.stdin, 'héllo\nworld');
  assert.strictEqual(buildCommand({ ...a, stdinField: undefined }, { src: 'x' }).stdin, undefined);
  const out = await new Promise((resolve) => {
    let o = '';
    runTool(process.execPath, ['-e', "let s='';process.stdin.setEncoding('utf8').on('data',d=>s+=d).on('end',()=>console.log(JSON.stringify(s)))"], {
      input: cmd.stdin, onOutput: (x) => { o += x.text; }, onExit: () => resolve(o),
    });
  });
  assert.strictEqual(JSON.parse(out.trim()), 'héllo\nworld');
});

test('typst write reads the document from stdin; compile takes a file', () => {
  const w = buildCommand(action('typst', 'write'), { source: '= Hi', out: '/t/o.pdf' });
  assert.deepStrictEqual(w.argv, ['compile', '-', '/t/o.pdf']);
  assert.strictEqual(w.stdin, '= Hi');
  assert.deepStrictEqual(buildCommand(action('typst', 'write'), { source: 'x', out: '/o.pdf', assets: '/img' }).argv, ['compile', '--root', '/img', '-', '/o.pdf']);
  assert.deepStrictEqual(buildCommand(action('typst', 'compile'), { input: '/a.typ', out: '/a.pdf' }).argv, ['compile', '/a.typ', '/a.pdf']);
});

test('pandoc write turns Markdown on stdin into the chosen format', () => {
  const c = buildCommand(action('pandoc', 'write'), { text: '# T', to: 'pptx', out: '/d.pptx' });
  assert.deepStrictEqual(c.argv, ['--standalone', '-f', 'markdown', '-t', 'pptx', '-o', '/d.pptx']);
  assert.strictEqual(c.stdin, '# T');
});

test('caesium never overwrites, only sends the chosen compression mode, inputs last', () => {
  const base = { inputs: ['/a.jpg', '/b.png'], outDir: '/out' };
  assert.deepStrictEqual(buildCommand(action('caesium', 'compress'), base).argv,
    ['--quality', '80', '--no-upscale', '--format', 'original', '--keep-dates', '--output', '/out', '--overwrite', 'never', '/a.jpg', '/b.png']);
  assert.deepStrictEqual(buildCommand(action('caesium', 'compress'), { ...base, mode: 'size', maxSize: '200000', resize: '1280', format: 'webp', exif: true }).argv,
    ['--max-size', '200000', '--long-edge', '1280', '--no-upscale', '--format', 'webp', '--exif', '--keep-dates', '--output', '/out', '--overwrite', 'never', '/a.jpg', '/b.png']);
  assert.deepStrictEqual(buildCommand(action('caesium', 'compress'), { ...base, mode: 'lossless' }).argv.slice(0, 2), ['--lossless', '--no-upscale']);
  const f = buildCommand(action('caesium', 'folder'), { folder: '/pics', recursive: true, outDir: '/out' }).argv;
  assert.deepStrictEqual([f[0], f[1], f[f.length - 1]], ['--recursive', '--keep-structure', '/pics']);
});

test('sql templates quote paths safely and keep enum options raw', () => {
  const conv = buildCommand(action('duckdb', 'convert'), { input: "/d/it's; DROP x.csv", out: '/o.xlsx' }).argv;
  assert.deepStrictEqual(conv, ['-cmd', 'INSTALL excel; LOAD excel;', '-c', "COPY (SELECT * FROM '/d/it''s; DROP x.csv') TO '/o.xlsx' (FORMAT xlsx, HEADER true);"]);
  const comb = buildCommand(action('duckdb', 'combine'), { inputs: ['/a.csv', '/b.csv'], format: 'parquet', out: '/o.parquet' }).argv.slice(-1)[0];
  assert.strictEqual(comb, "COPY (SELECT * FROM read_csv(['/a.csv', '/b.csv'], union_by_name = true)) TO '/o.parquet' (FORMAT parquet);");
  assert.throws(() => buildCommand(action('duckdb', 'convert'), { input: '/a.csv', out: '/o', format: 'csv); DROP' }), /invalid choice/);
  assert.strictEqual(spec('duckdb').product, 'data');
});

test('7-Zip switches are glued to their values (-o/dir, -pSECRET) and never overwrite by default', () => {
  assert.deepStrictEqual(buildCommand(action('7zip', 'extract'), { archive: '/a.rar', outDir: '/o' }).argv, ['x', '/a.rar', '-o/o', '-aou', '-y']);
  assert.deepStrictEqual(buildCommand(action('7zip', 'create'), { inputs: ['/x'], password: 'pw', out: '/o.zip' }).argv, ['a', '-tzip', '-ppw', '-mem=AES256', '-y', '/o.zip', '/x']);
  assert.deepStrictEqual(buildCommand(action('7zip', 'create'), { folder: '/f', format: '7z', out: '/o.7z' }).argv, ['a', '-t7z', '-y', '/o.7z', '/f']);
});

test('transcription: segments become a clean transcript; argv points at the downloaded model', () => {
  const { segmentsToText } = require('../src/core/execute');
  assert.strictEqual(segmentsToText('log line\n0.210 -- 5.120: Hello there\n3725.5 -- 3730: Bye\n', true), '[00:00:00] Hello there\n[01:02:05] Bye');
  assert.strictEqual(segmentsToText('0.2 -- 1: a\n1.5 -- 2: b', false), 'a\nb');
  const a = action('transcribe', 'transcribe');
  const argv = buildCommand(a, { input: '/t/in.wav', language: 'de' }).argv;
  assert.ok(argv.includes('--whisper-language=de') && argv[argv.length - 1] === '/t/in.wav');
  assert.strictEqual(a.cwd, 'tool'); assert.strictEqual(a.prepare.tool, 'ffmpeg');
});

test('text to speech: voice, speed and output become flags; the text is the last argument', () => {
  const a = action('speak', 'speak');
  const argv = buildCommand(a, { text: 'Hello there.', voice: '26', speed: '1.2', out: '/o/hi.wav' }).argv;
  assert.ok(argv.includes('--sid=26') && argv.includes('--kokoro-length-scale=1.2') && argv.includes('--output-filename=/o/hi.wav'));
  assert.ok(argv.some((x) => x.startsWith('--kokoro-lexicon=extras/voice/')));
  assert.strictEqual(argv[argv.length - 1], 'Hello there.');
  assert.strictEqual(a.cwd, 'tool');
});

test('vocal remover and voice clean-up: ffmpeg prepares a wav, outputs map to the right flags', () => {
  const v = action('vocals', 'split');
  const va = buildCommand(v, { input: '/t/song.wav', instrumental: '/o/inst.wav', vocals: '/o/voc.wav' }).argv;
  assert.ok(va.includes('--input-wav=/t/song.wav') && va.includes('--output-accompaniment-wav=/o/inst.wav') && va.includes('--output-vocals-wav=/o/voc.wav'));
  assert.ok(v.prepare.argv.includes('44100'));
  const c = action('cleanvoice', 'denoise');
  const ca = buildCommand(c, { input: '/t/memo.wav', out: '/o/clean.wav' }).argv;
  assert.deepStrictEqual(ca, ['--speech-denoiser-gtcrn-model=extras/model/gtcrn_simple.onnx', '--input-wav=/t/memo.wav', '--output-wav=/o/clean.wav']);
  assert.ok(c.prepare.argv.includes('16000'));
});

test('PDF forms: field list prints JSON; fill writes the AI-written answers to a temp .json file', async () => {
  const { prepareRun } = require('../src/core/execute');
  const list = action('pdfcpu', 'form-fields');
  assert.deepStrictEqual(buildCommand(list, { input: '/f.pdf' }).argv, ['form', 'list', '--json', '/f.pdf']);
  const fill = action('pdfcpu', 'form-fill');
  const prep = await prepareRun({ spec: { id: 'pdfcpu', name: 'x', binary: {} }, action: fill, values: { input: '/f.pdf', data: '{"forms":[]}', out: '/o.pdf' } });
  assert.ok(prep.values.data.endsWith('data.json'));
  assert.strictEqual(require('fs').readFileSync(prep.values.data, 'utf8'), '{"forms":[]}');
  assert.deepStrictEqual(buildCommand(fill, prep.values).argv, ['form', 'fill', '/f.pdf', prep.values.data, '/o.pdf']);
  prep.cleanup();
  assert.ok(!require('fs').existsSync(prep.values.data));
});

test('subtitles: segments become numbered SRT cues; long ones are split; ffmpeg muxes as mov_text', () => {
  const { segmentsToSrt } = require('../src/core/execute');
  const srt = segmentsToSrt(`log\n0.1 -- 3.52: Please call Stella.\n4 -- 12: ${'word '.repeat(30)}end.\n`);
  assert.ok(srt.startsWith('1\n00:00:00,100 --> 00:00:03,520\nPlease call Stella.\n'));
  assert.ok(/\n2\n00:00:04,000 --> /.test(srt) && /\n3\n/.test(srt) && /--> 00:00:12,000\n/.test(srt));
  const sub = action('transcribe', 'subtitles');
  assert.strictEqual(sub.saveStdout.transform, 'srt');
  const argv = buildCommand(action('ffmpeg', 'add-subtitles'), { input: '/v.mp4', subs: '/s.srt', out: '/o.mp4' }).argv;
  assert.deepStrictEqual(argv.slice(0, 5), ['-y', '-i', '/v.mp4', '-i', '/s.srt']);
  assert.ok(argv.includes('mov_text') && argv[argv.length - 1] === '/o.mp4');
});

test('fix volume: loudnorm target, video copied or dropped', () => {
  const a = action('ffmpeg', 'loudness');
  assert.deepStrictEqual(buildCommand(a, { input: '/i.mov', target: 'loudnorm=I=-14:TP=-1:LRA=11', kind: 'video', out: '/o.mp4' }).argv,
    ['-y', '-i', '/i.mov', '-af', 'loudnorm=I=-14:TP=-1:LRA=11', '-vcodec', 'copy', '-ar', '48000', '/o.mp4']);
  assert.ok(buildCommand(a, { input: '/i.wav', target: 'loudnorm=I=-16:TP=-1.5:LRA=11', kind: 'audio', out: '/o.mp3' }).argv.includes('-vn'));
});

test('who spoke when: speakers numbered by first appearance; auto mode passes no cluster count', () => {
  const { speakersToText } = require('../src/core/execute');
  assert.strictEqual(speakersToText('log\n0.031 -- 3.102 speaker_01\n3.8 -- 7.9 speaker_00\n8.6 -- 11.6 speaker_01\n'),
    '[00:00:00 → 00:00:03] Speaker 1\n[00:00:03 → 00:00:07] Speaker 2\n[00:00:08 → 00:00:11] Speaker 1');
  const a = action('speakers', 'diarize');
  assert.ok(!buildCommand(a, { input: '/m.wav', speakers: '' }).argv.some((x) => x.startsWith('--clustering.num-clusters')));
  assert.ok(buildCommand(a, { input: '/m.wav', speakers: '3' }).argv.includes('--clustering.num-clusters=3'));
});

test('upscaler: input/output/model flags, fixed 4x with the bundled models folder', () => {
  const argv = buildCommand(action('upscale', 'upscale'), { input: '/i/a.jpg', model: 'realesrgan-x4plus-anime', out: '/o/a.png' }).argv;
  assert.deepStrictEqual(argv, ['-i', '/i/a.jpg', '-o', '/o/a.png', '-n', 'realesrgan-x4plus-anime', '-s', '4', '-m', 'models']);
});

test('clean strips ANSI codes', () => {
  assert.strictEqual(clean('\x1b[32mok\x1b[0m done'), 'ok done');
});

test('ensureBinary extracts, hoists nested binary, verifies checksum', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gh-test-'));
  const src = path.join(tmp, 'src', 'tool_1.0_Linux'); fs.mkdirSync(src, { recursive: true });
  fs.writeFileSync(path.join(src, 'tool'), '#!/bin/sh\necho hi\n');
  const archive = path.join(tmp, 'tool_1.0_Linux.tar.gz');
  execFileSync('tar', ['-czf', archive, '-C', path.join(tmp, 'src'), 'tool_1.0_Linux']);
  const digest = require('crypto').createHash('sha256').update(fs.readFileSync(archive)).digest('hex');
  const key = platformKey();
  const fake = { id: 't', binary: { version: '1.0', assets: { [key]: { url: 'https://example.invalid/tool_1.0_Linux.tar.gz', path: 'tool', sha256: digest } } } };
  const fetcher = async (_u, dest) => fs.copyFileSync(archive, dest);
  const exe = await ensureBinary(fake, path.join(tmp, 'cache'), { key, fetcher });
  assert.ok(fs.existsSync(exe));
  if (process.platform !== 'win32') assert.strictEqual(execFileSync(exe).toString().trim(), 'hi');
  const bad = { id: 'u', binary: { version: '1.0', assets: { [key]: { ...fake.binary.assets[key], sha256: '00' } } } };
  await assert.rejects(ensureBinary(bad, path.join(tmp, 'cache'), { key, fetcher }), /checksum mismatch/);
});

test('license: trials, activation, revocation, offline grace', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gh-lic-'));
  let now = Date.now();
  let serverStatus = 'granted';
  const calls = [];
  const post = async (url, body) => {
    calls.push({ url, body });
    if (url.endsWith('/activate')) return { status: 200, json: { id: 'act-1', license_key: { status: serverStatus } } };
    if (body.key === 'bad') return { status: 404, json: { detail: 'not found' } };
    return { status: 200, json: { status: serverStatus } };
  };
  const lic = new LicenseStore(path.join(tmp, 'l.json'), { polarOrganizationId: 'org', trialRuns: 2 }, { post, now: () => now });
  const pro = spec('pdfcpu');
  const free = spec('croc');
  assert.strictEqual(lic.canRun(free).ok, true);
  assert.strictEqual(lic.canRun(pro).reason, 'trial');
  lic.recordRun(pro); lic.recordRun(pro);
  assert.strictEqual(lic.canRun(pro).ok, false);
  await assert.rejects(lic.activate('bad'), /not found/);
  await lic.activate(' good-key ');
  assert.strictEqual(calls.find((c) => c.url.endsWith('/validate') && c.body.key === 'good-key').body.activation_id, 'act-1');
  assert.strictEqual(lic.canRun(pro).reason, 'licensed');
  now += 20 * 86400000; // offline too long
  assert.strictEqual(lic.isPro(), false);
  await lic.refresh();
  assert.strictEqual(lic.isPro(), true);
  serverStatus = 'revoked';
  await lic.refresh();
  assert.strictEqual(lic.isPro(), false);
  const reloaded = new LicenseStore(path.join(tmp, 'l.json'), { polarOrganizationId: 'org' }, { post, now: () => now });
  assert.strictEqual(reloaded.state.keys[0].status, 'revoked');
});

test('license: each product key unlocks only its product; All-Access unlocks all; legacy key = Essentials', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gh-lic2-'));
  const B = { ess: '11111111-1111-1111-1111-111111111111', data: '22222222-2222-2222-2222-222222222222', all: '33333333-3333-3333-3333-333333333333' };
  const keys = { 'k-ess': B.ess, 'k-data': B.data, 'k-all': B.all };
  const post = async (url, body) => (url.endsWith('/activate') ? { status: 403, json: {} } : { status: 200, json: { status: 'granted', benefit_id: keys[body.key] } });
  const products = () => ({ products: [{ id: 'essentials', name: 'Essentials', benefitIds: [B.ess] }, { id: 'data', name: 'Data', benefitIds: [B.data] }], allAccess: { name: 'All', benefitIds: [B.all] } });
  const file = path.join(tmp, 'l.json');
  const ess = spec('pdfcpu');
  const dataTool = { ...spec('pdfcpu'), id: 'duck', product: 'data' };
  let lic = new LicenseStore(file, { polarOrganizationId: 'org', trialRuns: 0 }, { post, products });
  assert.deepStrictEqual(await lic.activate('k-data'), ['Data']);
  assert.strictEqual(lic.canRun(dataTool).ok, true);
  assert.strictEqual(lic.canRun(ess).ok, false);
  await lic.activate('k-all');
  assert.strictEqual(lic.canRun(ess).ok, true);
  // legacy single-key file from v0.8 (no benefit known) unlocks Essentials only
  fs.writeFileSync(file, JSON.stringify({ key: 'old', status: 'granted', lastValidAt: Date.now(), trials: {} }));
  lic = new LicenseStore(file, { polarOrganizationId: 'org', trialRuns: 0 }, { post: async () => { throw new Error('offline'); }, products });
  assert.strictEqual(lic.canRun(ess).ok, true);
  assert.strictEqual(lic.canRun(dataTool).ok, false);
  assert.deepStrictEqual(lic.unlockedProducts(), ['essentials']);
});

test('remote catalog: accepts pinned upstream specs, rejects anything else', () => {
  const { mergeCatalog, newerVersion } = require('../src/core/remote-catalog');
  const good = JSON.parse(JSON.stringify(spec('f2')));
  good.status = 'live';
  good.tagline = 'updated remotely';
  const evil = JSON.parse(JSON.stringify(spec('croc')));
  evil.binary.assets['linux-x64'].url = 'https://evil.example/croc.tar.gz';
  const nosum = JSON.parse(JSON.stringify(spec('pdfcpu')));
  delete nosum.binary.assets['win32-x64'].sha256;
  const { specs: merged, rejected } = mergeCatalog(specs, { specs: [good, evil, nosum] });
  assert.strictEqual(merged.find((s) => s.id === 'f2').tagline, 'updated remotely');
  assert.notStrictEqual(merged.find((s) => s.id === 'croc').binary.assets['linux-x64'].url, 'https://evil.example/croc.tar.gz');
  assert.deepStrictEqual(rejected.map((r) => r.id).sort(), ['croc', 'pdfcpu']);
  const retired = { ...good, status: 'retired' };
  assert.ok(!mergeCatalog(specs, { specs: [retired] }).specs.some((s) => s.id === 'f2'));
  assert.strictEqual(newerVersion('0.10.0', '0.9.9'), true);
  assert.strictEqual(newerVersion('0.2.0', '0.2.0'), false);
});

test('ffmpeg compress builds a safe argv with scale and audio choices', () => {
  const a = action('ffmpeg', 'compress');
  let { argv } = buildCommand(a, { input: '/v/in.mov', out: '/v/out.mp4' });
  assert.deepStrictEqual(argv, ['-y', '-i', '/v/in.mov', '-vcodec', 'libx264', '-crf', '28', '-preset', 'medium', '-pix_fmt', 'yuv420p', '-acodec', 'aac', '-ab', '128k', '-movflags', '+faststart', '/v/out.mp4']);
  ({ argv } = buildCommand(a, { input: '/v/in.mov', out: '/v/out.mp4', size: '720', audio: 'remove', quality: '32' }));
  assert.ok(argv.includes('scale=-2:min(720\\,ih)') && argv.includes('-an') && !argv.includes('aac'));
  const g = buildCommand(action('ffmpeg', 'gif'), { input: '/v/in.mp4', out: '/v/o.gif', start: '3' }).argv;
  assert.deepStrictEqual(g.slice(0, 5), ['-y', '-ss', '3', '-t', '5']);
});

test('remote catalog accepts binaries from a declared sourceRepo only', () => {
  const { remoteProblems } = require('../src/core/remote-catalog');
  const s = JSON.parse(JSON.stringify(spec('ffmpeg')));
  for (const a of Object.values(s.binary.assets)) a.sha256 = 'a'.repeat(64);
  assert.deepStrictEqual(remoteProblems(s), []);
  delete s.binary.sourceRepo;
  assert.ok(remoteProblems(s).length > 0);
});

test('agent command line: list, info, usage errors exit 2', () => {
  const { spawnSync } = require('child_process');
  const path = require('path'); const os = require('os'); const fs = require('fs');
  const env = { ...process.env, GUIHUB_CATALOG: path.join(__dirname, '..', '..', 'catalog'), GUIHUB_USER_DATA: fs.mkdtempSync(path.join(os.tmpdir(), 'gh-cli-')) };
  const cli = (...a) => spawnSync(process.execPath, [path.join(__dirname, '..', 'src', 'cli.js'), ...a], { env, encoding: 'utf8' });
  const l = cli('list'); assert.strictEqual(l.status, 0); assert.ok(/pdfcpu_form_fill/.test(l.stdout));
  const i = cli('info', 'pdfcpu_form_fill'); assert.strictEqual(i.status, 0); assert.ok(/--data/.test(i.stdout));
  assert.strictEqual(cli('run', 'pdfcpu_form_fill').status, 2);
  assert.strictEqual(cli('run', 'pdfcpu_form_fill', '--nope', 'x').status, 2);
  assert.strictEqual(cli('no_such_tool').status, 2);
});

test('per-product server: Audio-only tool list, but prepare helpers (FFmpeg) still found', async () => {
  const path = require('path'); const os = require('os'); const fs = require('fs');
  process.env.GUIHUB_CATALOG = path.join(__dirname, '..', '..', 'catalog');
  process.env.GUIHUB_USER_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'gh-prod-'));
  const { setup } = require('../src/server-setup');
  const s = setup({ argv: ['node', 'x', '--product=audio'] });
  const names = s.server.tools().map((t) => t.name);
  assert.ok(names.includes('vocals_split') && !names.includes('ffmpeg_compress'));
  assert.ok(s.getAllSpecs().some((x) => x.id === 'ffmpeg'), 'prepare helpers must come from the whole catalog');
  assert.ok(/getAllSpecs \|\| getSpecs/.test(fs.readFileSync(path.join(__dirname, '..', 'src', 'core', 'mcp.js'), 'utf8')));
  assert.ok(/specs: allSpecs/.test(fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8')));
  delete process.env.GUIHUB_CATALOG; delete process.env.GUIHUB_USER_DATA;
});
