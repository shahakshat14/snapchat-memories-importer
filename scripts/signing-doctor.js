const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const checkMac = process.argv.includes('--mac') || !process.argv.includes('--win');
const checkWin = process.argv.includes('--win') || !process.argv.includes('--mac');
let failed = false;

if (checkMac) {
  section('macOS Signing And Notarization');
  const identity = process.env.MAC_SIGN_IDENTITY;
  if (!identity || identity === '-') {
    fail('MAC_SIGN_IDENTITY is not set. Set it to a Developer ID Application identity name.');
  } else {
    const identities = execFileSync('/usr/bin/security', ['find-identity', '-v', '-p', 'codesigning'], { encoding: 'utf8' });
    if (!identities.includes(identity)) fail(`Developer ID signing identity was not found in the keychain: ${identity}`);
    else ok(`Found signing identity: ${identity}`);
  }
  if (process.env.APPLE_NOTARY_PROFILE) ok('APPLE_NOTARY_PROFILE is set.');
  else if (process.env.APPLE_ID && process.env.APPLE_APP_SPECIFIC_PASSWORD && process.env.APPLE_TEAM_ID) ok('Apple ID notarization environment is set.');
  else fail('Notarization credentials are missing. Set APPLE_NOTARY_PROFILE or APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, and APPLE_TEAM_ID.');
  if (!fs.existsSync(path.join(root, 'build', 'icon.icns'))) fail('Missing build/icon.icns. Run npm run icons:generate.');
}

if (checkWin) {
  section('Windows Trusted Signing');
  if (process.env.CSC_LINK && process.env.CSC_KEY_PASSWORD) ok('CSC_LINK and CSC_KEY_PASSWORD are set for Authenticode signing.');
  else if (process.env.WIN_CSC_LINK && process.env.WIN_CSC_KEY_PASSWORD) ok('WIN_CSC_LINK and WIN_CSC_KEY_PASSWORD are set for Authenticode signing.');
  else fail('Windows signing credentials are missing. Set CSC_LINK + CSC_KEY_PASSWORD, or WIN_CSC_LINK + WIN_CSC_KEY_PASSWORD.');
  if (!fs.existsSync(path.join(root, 'build', 'icon.ico'))) fail('Missing build/icon.ico. Run npm run icons:generate.');
}

if (failed) process.exit(1);
console.log('Signing doctor passed.');

function section(title) {
  console.log(`\n${title}`);
}

function ok(message) {
  console.log(`OK  ${message}`);
}

function fail(message) {
  failed = true;
  console.log(`ERR ${message}`);
}
