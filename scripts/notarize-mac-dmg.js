const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const dmgPath = process.argv[2] || path.join(root, 'dist', 'Snapchat-Memories-Importer-0.1.0.dmg');

if (!fs.existsSync(dmgPath)) {
  throw new Error(`DMG not found: ${dmgPath}`);
}

const args = ['notarytool', 'submit', dmgPath, '--wait'];
if (process.env.APPLE_NOTARY_PROFILE) {
  args.push('--keychain-profile', process.env.APPLE_NOTARY_PROFILE);
} else {
  const { APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, APPLE_TEAM_ID } = process.env;
  if (!APPLE_ID || !APPLE_APP_SPECIFIC_PASSWORD || !APPLE_TEAM_ID) {
    throw new Error('Set APPLE_NOTARY_PROFILE or APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, and APPLE_TEAM_ID before notarizing.');
  }
  args.push('--apple-id', APPLE_ID, '--password', APPLE_APP_SPECIFIC_PASSWORD, '--team-id', APPLE_TEAM_ID);
}

run('/usr/bin/xcrun', args);
run('/usr/bin/xcrun', ['stapler', 'staple', dmgPath]);
run('/usr/bin/xcrun', ['stapler', 'validate', dmgPath]);

function run(command, args) {
  execFileSync(command, args, { stdio: 'inherit' });
}
