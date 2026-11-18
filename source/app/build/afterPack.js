'use strict';
// Ad-hoc sign the macOS app bundle before the DMG is made. Without any signature, Apple-silicon
// Macs report a downloaded app as "damaged" and offer no "Open Anyway". Ad-hoc signing (no Apple
// certificate) turns that into the normal "unverified developer → Open Anyway" flow.
const { execFileSync } = require('child_process');
const path = require('path');

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return;
  const app = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', app], { stdio: 'inherit' });
  try { execFileSync('codesign', ['--verify', '--deep', '--strict', '--verbose=4', app], { stdio: 'inherit' }); } catch (e) {
    // Say exactly what is wrong (usually a symlink that points nowhere or outside the bundle).
    try { console.log(execFileSync('find', [app, '-type', 'l', '-exec', 'sh', '-c', 'for l; do t=$(readlink "$l"); [ -e "$l" ] || echo "DANGLING $l -> $t"; case "$t" in /*) echo "ABSOLUTE $l -> $t";; esac; done', 'sh', '{}', '+']).toString()); } catch (_) { /* best effort */ }
    throw e;
  }
  console.log(`ad-hoc signed ${app}`);
};
