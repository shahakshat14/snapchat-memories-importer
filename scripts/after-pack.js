const { execFileSync } = require('node:child_process');

module.exports = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return;
  execFileSync('/usr/bin/xattr', ['-cr', context.appOutDir], { stdio: 'ignore' });
};
