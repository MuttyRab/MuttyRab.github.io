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
  execFileSync('codesign', ['--verify', '--deep', '--strict', '--verbose=2', app], { stdio: 'inherit' });
  console.log(`ad-hoc signed ${app}`);
};
