const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const distDir = path.join(root, 'dist');
const appDir = path.join(distDir, 'mac-universal', 'Snapchat Memories Importer.app');
const appExecutable = path.join(appDir, 'Contents', 'MacOS', 'Snapchat Memories Importer');
const dmgPath = path.join(distDir, 'Snapchat-Memories-Importer-0.1.0.dmg');
const volumeName = 'Snapchat Memories Importer 0.1.0';
const tempDmg = path.join(os.tmpdir(), `snapchat-memories-${Date.now()}.dmg`);
const signingIdentity = process.env.MAC_SIGN_IDENTITY || '-';
const isAdHocSign = signingIdentity === '-';

run('npx', ['electron-builder', '--mac', 'dir', '--universal', '--publish', 'never'], { cwd: root });
verifyUniversalBinary(appExecutable);
run('/usr/bin/xattr', ['-cr', appDir]);
run('/usr/bin/codesign', codeSignArgs(appDir));
removeFinderInfo(appDir);
run('/usr/bin/codesign', ['--verify', '--deep', '--verbose=2', appDir]);

fs.rmSync(dmgPath, { force: true });
run('/usr/bin/hdiutil', [
  'create',
  '-size',
  `${imageSizeMegabytes(appDir)}m`,
  '-fs',
  'HFS+',
  '-volname',
  volumeName,
  '-layout',
  'NONE',
  '-ov',
  '-type',
  'UDIF',
  tempDmg,
]);
const mountPoint = attachDmg(tempDmg);
try {
  const mountedAppDir = path.join(mountPoint, 'Snapchat Memories Importer.app');
  run('/usr/bin/ditto', [appDir, mountedAppDir]);
  run('/usr/bin/xattr', ['-cr', mountedAppDir]);
  removeFinderInfo(mountedAppDir);
  run('/usr/bin/codesign', ['--verify', '--deep', '--strict', '--verbose=2', mountedAppDir]);
} finally {
  run('/usr/bin/hdiutil', ['detach', mountPoint]);
}
run('/usr/bin/hdiutil', ['convert', tempDmg, '-format', 'UDZO', '-o', dmgPath]);
run('/usr/bin/hdiutil', ['verify', dmgPath]);
fs.rmSync(tempDmg, { force: true });

if (!isAdHocSign) {
  run('/usr/bin/codesign', ['--force', '--sign', signingIdentity, '--timestamp', dmgPath]);
  run('/usr/bin/codesign', ['--verify', '--verbose=2', dmgPath]);
  notarize(dmgPath);
}

function run(command, args, options = {}) {
  execFileSync(command, args, { stdio: 'inherit', ...options });
}

function codeSignArgs(target) {
  const args = ['--force', '--deep', '--sign', signingIdentity, '--options', 'runtime'];
  if (!isAdHocSign) args.push('--timestamp');
  args.push(target);
  return args;
}

function removeFinderInfo(target) {
  const files = execFileSync('/usr/bin/find', [target, '-xattrname', 'com.apple.FinderInfo', '-print'], { encoding: 'utf8' })
    .split('\n')
    .filter(Boolean);
  for (const file of files) {
    execFileSync('/usr/bin/xattr', ['-d', 'com.apple.FinderInfo', file], { stdio: 'ignore' });
  }
}

function imageSizeMegabytes(target) {
  const output = execFileSync('/usr/bin/du', ['-sm', target], { encoding: 'utf8' });
  const size = Number.parseInt(output.split(/\s+/)[0], 10);
  return Math.max(300, size + 150);
}

function attachDmg(target) {
  const output = execFileSync('/usr/bin/hdiutil', ['attach', '-nobrowse', target], { encoding: 'utf8' });
  const line = output
    .split('\n')
    .find((value) => value.includes(`/Volumes/${volumeName}`));
  if (!line) throw new Error(`Could not find mounted volume in hdiutil output:\n${output}`);
  return line.slice(line.indexOf('/Volumes/')).trim();
}

function verifyUniversalBinary(target) {
  const archs = execFileSync('/usr/bin/lipo', ['-archs', target], { encoding: 'utf8' })
    .trim()
    .split(/\s+/)
    .sort();
  const requiredArchs = ['arm64', 'x86_64'];
  const missingArchs = requiredArchs.filter((arch) => !archs.includes(arch));
  if (missingArchs.length > 0) {
    throw new Error(`macOS app is not universal. Missing architecture(s): ${missingArchs.join(', ')}`);
  }
  console.log(`Verified universal macOS binary architectures: ${archs.join(', ')}`);
}

function notarize(target) {
  const args = ['notarytool', 'submit', target, '--wait'];
  if (process.env.APPLE_NOTARY_PROFILE) {
    args.push('--keychain-profile', process.env.APPLE_NOTARY_PROFILE);
  } else {
    const appleId = process.env.APPLE_ID;
    const password = process.env.APPLE_APP_SPECIFIC_PASSWORD;
    const teamId = process.env.APPLE_TEAM_ID;
    if (!appleId || !password || !teamId) {
      throw new Error(
        'Developer ID signing is enabled, but notarization credentials are missing. Set APPLE_NOTARY_PROFILE or APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, and APPLE_TEAM_ID.'
      );
    }
    args.push('--apple-id', appleId, '--password', password, '--team-id', teamId);
  }
  run('/usr/bin/xcrun', args);
  run('/usr/bin/xcrun', ['stapler', 'staple', target]);
  run('/usr/bin/xcrun', ['stapler', 'validate', target]);
}
