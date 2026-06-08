const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');

async function main() {
  const config = configFromEnvironment();
  if (!config) {
    console.log('Google OAuth client config not provided; Google sign-in will be disabled in this build.');
    return;
  }

  const localInstall = process.argv.includes('--local-user');
  const configDir = localInstall
    ? path.join(os.homedir(), 'Library', 'Application Support', 'snapchat-memories-importer')
    : path.join(__dirname, '..', 'config');
  const configPath = path.join(configDir, 'google-oauth-client.json');
  const savedConfigPath = localInstall ? path.join(configDir, '.google-oauth-client.json') : configPath;
  await fs.mkdir(configDir, { recursive: true });
  await fs.writeFile(savedConfigPath, JSON.stringify({ installed: config }, null, 2), { mode: 0o600 });
  console.log(`Wrote Google OAuth client config to ${savedConfigPath}`);
}

function configFromEnvironment() {
  if (process.env.GOOGLE_OAUTH_CLIENT_JSON) {
    const parsed = JSON.parse(process.env.GOOGLE_OAUTH_CLIENT_JSON);
    const config = parsed.installed || parsed.web || parsed;
    return normalizeConfig(config);
  }

  if (process.env.GOOGLE_OAUTH_CLIENT_ID && process.env.GOOGLE_OAUTH_CLIENT_SECRET) {
    return normalizeConfig({
      client_id: process.env.GOOGLE_OAUTH_CLIENT_ID,
      client_secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET
    });
  }

  return null;
}

function normalizeConfig(config) {
  if (!config?.client_id || !config?.client_secret) {
    throw new Error('Google OAuth config must include client_id and client_secret.');
  }
  return {
    client_id: config.client_id,
    client_secret: config.client_secret
  };
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
