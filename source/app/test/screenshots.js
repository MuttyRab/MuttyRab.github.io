#!/usr/bin/env node
'use strict';
// Takes real screenshots of the app's forms (no fake output) for the website.
// usage: xvfb-run -a node test/screenshots.js <outDir>
const fs = require('fs');
const os = require('os');
const path = require('path');
const { _electron: electron } = require('playwright');

const appDir = path.join(__dirname, '..');
const out = process.argv[2] || path.join(appDir, '..', 'site', 'assets');
fs.mkdirSync(out, { recursive: true });
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'gh-shots-'));

const shots = [
  { file: 'video-compress.png', tool: 'Video Toolkit', tab: 'Compress', fill: { quality: '28', size: '720' }, picks: { Video: '/Users/you/Movies/birthday-party.mov', 'Save as': '/Users/you/Movies/birthday-party-small.mp4' } },
  { file: 'pdf-merge.png', tool: 'PDF Toolkit', tab: 'Merge', picks: { 'PDFs to merge': ['/Users/you/Documents/contract.pdf', '/Users/you/Documents/appendix.pdf', '/Users/you/Documents/signatures.pdf'], 'Save merged PDF as': '/Users/you/Documents/contract-complete.pdf' } },
  { file: 'rename.png', tool: 'Rename Many Files', tab: 'Find & replace', text: { find: 'IMG_', replace: 'italy-2026-{%03d}' }, picks: { Folder: '/Users/you/Pictures/Italy trip' } },
  { file: 'image-compress.png', tool: 'Image Compressor', tab: 'Compress images', fill: { mode: 'size', maxSize: '500000', resize: '1920', format: 'webp' }, picks: { Images: ['/Users/you/Pictures/beach.jpg', '/Users/you/Pictures/dinner.jpg', '/Users/you/Pictures/sunset.png'], 'Save compressed copies in': '/Users/you/Pictures/for-website' } },
  { file: 'pdf-maker.png', tool: 'PDF Maker', tab: 'Write a PDF', text: { source: '#set page(paper: "a4", margin: 2cm)\n#set text(font: "New Computer Modern", size: 11pt)\n\n= Invoice 2026-031\n\n*Acme Ltd.* · due 29 November 2026\n\n#table(columns: (1fr, auto, auto),\n  [*Work*], [*Hours*], [*Amount*],\n  [Website redesign], [12], [$960],\n)' }, picks: { 'Save PDF as': '/Users/you/Documents/invoice-2026-031.pdf' } },
  { file: 'send-files.png', tool: 'Send Big Files', tab: 'Send files', picks: { 'Files or folders': ['/Users/you/Desktop/wedding-photos'] } },
];

(async () => {
  const app = await electron.launch({ executablePath: require('electron'), args: [appDir, '--no-sandbox'], env: { ...process.env, GUIHUB_USER_DATA: userData, GUIHUB_CATALOG: path.join(appDir, '..', 'catalog') } });
  let picks = {};
  await app.evaluate(({ ipcMain }) => {
    ipcMain.removeHandler('dialog:pick');
    ipcMain.handle('dialog:pick', (_e, { title }) => global.__picks[title] ?? null);
  });
  const page = await app.firstWindow();
  await page.setViewportSize({ width: 1100, height: 720 });
  await page.waitForSelector('.tool-item');
  for (const s of shots) {
    picks = s.picks || {};
    await app.evaluate((_e, p) => { global.__picks = p; }, picks);
    await page.click(`.tool-item:has-text("${s.tool}")`);
    await page.click(`.tab:has-text("${s.tab}")`);
    for (const [label] of Object.entries(picks)) {
      await page.click(`.field:has(label:text-is("${label} *")) button:has-text("…"), .field:has(label:text-is("${label}")) button:has-text("…")`).catch(async () => {
        await page.locator('.field', { has: page.locator(`label:has-text("${label}")`) }).locator('button', { hasText: /Choose|Add/ }).first().click();
      });
    }
    for (const [id, v] of Object.entries(s.text || {})) await page.fill(`#f-${id}`, v);
    for (const [id, v] of Object.entries(s.fill || {})) await page.selectOption(`#f-${id}`, v);
    await page.evaluate(() => { document.querySelector('.main').scrollTop = 0; });
    await page.screenshot({ path: path.join(out, s.file) });
    console.log('saved', s.file);
  }
  await app.close();
})().catch((e) => { console.error(e); process.exit(1); });
