const { app, BrowserWindow, dialog, ipcMain, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');
const fss = require('node:fs');
const os = require('node:os');
const http = require('node:http');
const extractZip = require('extract-zip');
const { exiftool } = require('exiftool-vendored');
const { OAuth2Client } = require('google-auth-library');
const mime = require('mime-types');
const importer = require('./importer-core');

const SCOPES = ['https://www.googleapis.com/auth/photoslibrary.appendonly'];
const MEDIA_EXTENSIONS = new Set([
  '.3g2', '.3gp', '.avif', '.bmp', '.gif', '.heic', '.jpeg', '.jpg', '.m4v',
  '.mov', '.mp4', '.png', '.tif', '.tiff', '.webp'
]);

let mainWindow;
let cancelled = false;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 980,
    height: 720,
    minWidth: 820,
    minHeight: 640,
    title: 'Snapchat to Google Photos',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js')
    }
  });
  mainWindow.loadFile(path.join(__dirname, 'renderer.html'));
}

app.whenReady().then(createWindow);
app.on('window-all-closed', async () => {
  await exiftool.end();
  if (process.platform !== 'darwin') app.quit();
});
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

ipcMain.handle('choose-zip', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Choose Snapchat Export Zip',
    properties: ['openFile'],
    filters: [{ name: 'Zip archives', extensions: ['zip'] }]
  });
  return result.canceled ? null : result.filePaths[0];
});

ipcMain.handle('choose-credentials', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Choose Google OAuth Desktop Client JSON',
    properties: ['openFile'],
    filters: [{ name: 'JSON', extensions: ['json'] }]
  });
  return result.canceled ? null : result.filePaths[0];
});

ipcMain.handle('sign-in', async (_event, credentialsPath) => {
  const auth = await signInWithGoogle(credentialsPath);
  return { email: auth.email };
});

ipcMain.handle('cancel-import', () => {
  cancelled = true;
  return true;
});

ipcMain.handle('start-import', async (_event, options) => {
  cancelled = false;
  const accessToken = await getValidAccessToken();
  if (!accessToken) throw new Error('Sign in with Google before importing.');
  return runImport({ ...options, accessToken });
});

async function runImport(options) {
  const startedAt = new Date();
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'snapchat-google-photos-'));
  const extractDir = path.join(workspace, 'extracted');
  const mergedDir = path.join(app.getPath('documents'), 'Snapchat Google Photos Import', formatFolderDate(startedAt));
  const reportPath = path.join(mergedDir, 'import-report.json');
  await fs.mkdir(extractDir, { recursive: true });
  await fs.mkdir(mergedDir, { recursive: true });

  try {
    progress('extracting', 4, 'Extracting Snapchat export');
    await extractZip(options.zipPath, { dir: extractDir });
    checkCancelled();

    progress('scanning', 10, 'Finding media and metadata');
    const files = await importer.walkFiles(extractDir);
    const mediaFiles = files.filter((file) => MEDIA_EXTENSIONS.has(path.extname(file).toLowerCase()));
    const metadataEntries = await importer.loadMetadataEntries(files);
    const matches = await importer.buildMatches(mediaFiles, metadataEntries);
    const matched = matches.filter((match) => match.metadata);
    const downloadable = metadataEntries.filter((entry) => !matched.some((match) => match.metadata === entry) && importer.findDownloadUrl(entry));
    checkCancelled();

    progress('merging', 18, `Preparing ${matched.length + downloadable.length} Snapchat memories`);
    const merged = await importer.materializeMedia(matches, metadataEntries, mergedDir, (complete, total) => {
      checkCancelled();
      progress('merging', 18 + Math.floor((complete / Math.max(total, 1)) * 22), `Merged ${complete} of ${total}`);
    });

    progress('uploading', 42, `Uploading ${merged.length} files to Google Photos`);
    const uploadResults = await uploadToGooglePhotos(merged, options.accessToken);
    const report = {
      startedAt: startedAt.toISOString(),
      zipPath: options.zipPath,
      extractedMediaFiles: mediaFiles.length,
      metadataEntries: metadataEntries.length,
      matchedFiles: matched.length,
      downloadedFromMetadataLinks: merged.filter((item) => item.source === 'download-link').length,
      mergedDir,
      uploadedFiles: uploadResults.filter((result) => result.status === 'created').length,
      results: uploadResults
    };
    await fs.writeFile(reportPath, JSON.stringify(report, null, 2));
    progress('complete', 100, `Done. Merged files and report saved to ${mergedDir}`);
    return report;
  } finally {
    await fs.rm(workspace, { recursive: true, force: true });
  }
}

async function signInWithGoogle(credentialsPath) {
  if (!credentialsPath) throw new Error('Choose a Google OAuth Desktop client JSON first.');
  const raw = JSON.parse(await fs.readFile(credentialsPath, 'utf8'));
  const config = raw.installed || raw.web;
  if (!config?.client_id || !config?.client_secret) {
    throw new Error('OAuth JSON must contain an installed Desktop client.');
  }

  const server = http.createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const redirectUri = `http://127.0.0.1:${port}/oauth2callback`;
  const oauth2Client = new OAuth2Client(config.client_id, config.client_secret, redirectUri);
  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: SCOPES
  });

  const codePromise = new Promise((resolve, reject) => {
    server.on('request', (request, response) => {
      const requestUrl = new URL(request.url, redirectUri);
      if (requestUrl.pathname !== '/oauth2callback') return;
      const error = requestUrl.searchParams.get('error');
      const code = requestUrl.searchParams.get('code');
      response.writeHead(200, { 'Content-Type': 'text/html' });
      response.end('<h1>Google Photos connected</h1><p>You can return to the app.</p>');
      server.close();
      if (error) reject(new Error(error));
      else resolve(code);
    });
  });

  await shell.openExternal(authUrl);
  const code = await codePromise;
  const { tokens } = await oauth2Client.getToken(code);
  oauth2Client.setCredentials(tokens);
  const tokenInfo = await oauth2Client.getTokenInfo(tokens.access_token);
  await saveToken({ ...tokens, credentialsPath });
  return { email: tokenInfo.email || 'Google account connected' };
}

async function uploadToGooglePhotos(merged, accessToken) {
  const results = [];
  let batch = [];
  for (let index = 0; index < merged.length; index += 1) {
    checkCancelled();
    const item = merged[index];
    const uploadToken = await uploadBytes(item.mergedPath, accessToken);
    batch.push({
      description: item.takenAt ? `Imported from Snapchat. Original date: ${item.takenAt.toISOString()}` : 'Imported from Snapchat.',
      simpleMediaItem: {
        fileName: path.basename(item.mergedPath),
        uploadToken
      }
    });
    progress('uploading', 42 + Math.floor(((index + 1) / Math.max(merged.length, 1)) * 45), `Uploaded bytes ${index + 1} of ${merged.length}`);
    if (batch.length === 50) {
      results.push(...await createMediaItems(batch, accessToken));
      batch = [];
    }
  }
  if (batch.length) results.push(...await createMediaItems(batch, accessToken));
  return results;
}

async function uploadBytes(file, accessToken) {
  const fileBuffer = await fs.readFile(file);
  const response = await retryFetch('https://photoslibrary.googleapis.com/v1/uploads', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/octet-stream',
      'X-Goog-Upload-Content-Type': mime.lookup(file) || 'application/octet-stream',
      'X-Goog-Upload-Protocol': 'raw'
    },
    body: fileBuffer
  });
  if (!response.ok) throw new Error(`Google byte upload failed for ${path.basename(file)}: ${response.status} ${await response.text()}`);
  return response.text();
}

async function createMediaItems(items, accessToken) {
  const response = await retryFetch('https://photoslibrary.googleapis.com/v1/mediaItems:batchCreate', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ newMediaItems: items })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`Google media create failed: ${response.status} ${JSON.stringify(payload)}`);
  return (payload.newMediaItemResults || []).map((result) => ({
    status: result.status?.message ? 'error' : 'created',
    message: result.status?.message || 'created',
    filename: result.mediaItem?.filename || null,
    productUrl: result.mediaItem?.productUrl || null
  }));
}

async function retryFetch(url, options) {
  let lastResponse;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    lastResponse = await fetch(url, options);
    if (!new Set([429, 500, 502, 503, 504]).has(lastResponse.status)) return lastResponse;
    await sleep(Math.max(1500, 2 ** attempt * 1000));
  }
  return lastResponse;
}

async function saveToken(token) {
  await fs.mkdir(app.getPath('userData'), { recursive: true });
  await fs.writeFile(path.join(app.getPath('userData'), '.google-token.json'), JSON.stringify(token, null, 2));
}

async function getSavedToken() {
  const file = path.join(app.getPath('userData'), '.google-token.json');
  if (!fss.existsSync(file)) return null;
  return JSON.parse(await fs.readFile(file, 'utf8'));
}

async function getValidAccessToken() {
  const token = await getSavedToken();
  if (!token?.access_token) return null;
  const expiresAt = token.expiry_date || 0;
  if (expiresAt > Date.now() + 60_000) return token.access_token;
  if (!token.refresh_token || !token.credentialsPath) return token.access_token;

  const raw = JSON.parse(await fs.readFile(token.credentialsPath, 'utf8'));
  const config = raw.installed || raw.web;
  const oauth2Client = new OAuth2Client(config.client_id, config.client_secret);
  oauth2Client.setCredentials(token);
  const refreshed = await oauth2Client.refreshAccessToken();
  const credentials = { ...token, ...refreshed.credentials };
  await saveToken(credentials);
  return credentials.access_token;
}

function progress(stage, percent, message) {
  mainWindow?.webContents.send('progress', { stage, percent, message });
}

function checkCancelled() {
  if (cancelled) throw new Error('Import cancelled.');
}

function formatFolderDate(date) {
  return date.toISOString().replace(/[:.]/g, '-');
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
