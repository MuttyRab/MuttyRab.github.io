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
    ['--quality', '80', '--no-upscale', '--format', 'original', '--output', '/out', '--overwrite', 'never', '/a.jpg', '/b.png']);
  assert.deepStrictEqual(buildCommand(action('caesium', 'compress'), { ...base, mode: 'size', maxSize: '200000', resize: '1280', format: 'webp', exif: true }).argv,
    ['--max-size', '200000', '--long-edge', '1280', '--no-upscale', '--format', 'webp', '--exif', '--output', '/out', '--overwrite', 'never', '/a.jpg', '/b.png']);
  assert.deepStrictEqual(buildCommand(action('caesium', 'compress'), { ...base, mode: 'lossless' }).argv.slice(0, 2), ['--lossless', '--no-upscale']);
  const f = buildCommand(action('caesium', 'folder'), { folder: '/pics', recursive: true, outDir: '/out' }).argv;
  assert.deepStrictEqual([f[0], f[1], f[f.length - 1]], ['--recursive', '--keep-structure', '/pics']);
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
  assert.strictEqual(reloaded.state.status, 'revoked');
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
