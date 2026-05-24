const { app, BrowserWindow, dialog, ipcMain, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');
const fss = require('node:fs');
const os = require('node:os');
const http = require('node:http');
const { execFile: execFileCallback } = require('node:child_process');
const { promisify } = require('node:util');
const extractZip = require('extract-zip');
const { exiftool } = require('exiftool-vendored');
const { OAuth2Client } = require('google-auth-library');
const mime = require('mime-types');
const importer = require('./importer-core');

const SCOPES = ['https://www.googleapis.com/auth/photoslibrary.appendonly'];
const execFile = promisify(execFileCallback);
const MEDIA_EXTENSIONS = new Set([
  '.3g2', '.3gp', '.avif', '.bmp', '.gif', '.heic', '.jpeg', '.jpg', '.m4v',
  '.mov', '.mp4', '.png', '.tif', '.tiff', '.webp'
]);

let mainWindow;
let cancelled = false;
let preparedImport = null;

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

ipcMain.handle('open-path', async (_event, targetPath) => {
  if (!targetPath) return null;
  const result = await shell.openPath(targetPath);
  if (result) throw new Error(result);
  return true;
});

ipcMain.handle('prepare-import', async (_event, options) => {
  cancelled = false;
  preparedImport = null;
  return prepareImportPreview(options);
});

ipcMain.handle('upload-prepared', async () => {
  cancelled = false;
  ensurePreparedReady();
  const accessToken = await getValidAccessToken();
  if (!accessToken) throw new Error('Sign in with Google before uploading.');
  return uploadPreparedImport(accessToken);
});

ipcMain.handle('export-prepared-zip', async () => {
  cancelled = false;
  ensurePreparedReady();
  return exportPreparedZip();
});

ipcMain.handle('import-apple-photos', async () => {
  cancelled = false;
  ensurePreparedReady();
  return importPreparedIntoApplePhotos();
});

async function prepareImportPreview(options) {
  const startedAt = new Date();
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'snapchat-google-photos-'));
  const extractDir = path.join(workspace, 'extracted');
  const mergedDir = path.join(app.getPath('documents'), 'Snapchat Google Photos Import', formatFolderDate(startedAt));
  const previewReportPath = path.join(mergedDir, 'preview-report.json');
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
      progress('merging', 18 + Math.floor((complete / Math.max(total, 1)) * 42), `Merged ${complete} of ${total}`);
    });

    progress('verifying', 72, 'Verifying merged EXIF/XMP metadata');
    const verification = await importer.verifyMergedMedia(merged, 25);
    const preview = {
      startedAt: startedAt.toISOString(),
      zipPath: options.zipPath,
      extractedMediaFiles: mediaFiles.length,
      metadataEntries: metadataEntries.length,
      matchedFiles: matched.length,
      downloadedFromMetadataLinks: merged.filter((item) => item.source === 'download-link').length,
      unmatchedEmbeddedMediaFiles: matches.filter((match) => !match.metadata).length,
      mergedDir,
      previewReportPath,
      verification,
      readyToUpload: verification.total > 0 && verification.missingFiles === 0
    };
    await fs.writeFile(previewReportPath, JSON.stringify(preview, null, 2));
    preparedImport = {
      ...preview,
      merged
    };
    progress('preview-ready', 100, `Preview ready. Review ${merged.length} merged files before uploading.`);
    return preview;
  } finally {
    await fs.rm(workspace, { recursive: true, force: true });
  }
}

async function uploadPreparedImport(accessToken) {
  const reportPath = path.join(preparedImport.mergedDir, 'import-report.json');
  progress('uploading', 2, `Uploading ${preparedImport.merged.length} reviewed files to Google Photos`);
  const uploadResults = await uploadToGooglePhotos(preparedImport.merged, accessToken);
  const report = {
    ...preparedImport,
    uploadedAt: new Date().toISOString(),
    uploadedFiles: uploadResults.filter((result) => result.status === 'created').length,
    results: uploadResults
  };
  delete report.merged;
  await fs.writeFile(reportPath, JSON.stringify(report, null, 2));
  progress('complete', 100, `Upload complete. Report saved to ${reportPath}`);
  return report;
}

async function exportPreparedZip() {
  const zipPath = path.join(
    path.dirname(preparedImport.mergedDir),
    `${path.basename(preparedImport.mergedDir)}-merged-exif.zip`
  );
  progress('exporting', 5, 'Creating merged EXIF zip');
  await execFile('/usr/bin/ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', preparedImport.mergedDir, zipPath]);
  const report = {
    ...preparedImport,
    exportedZipAt: new Date().toISOString(),
    exportedZipPath: zipPath
  };
  delete report.merged;
  await fs.writeFile(path.join(preparedImport.mergedDir, 'zip-export-report.json'), JSON.stringify(report, null, 2));
  progress('complete', 100, `Merged EXIF zip created at ${zipPath}`);
  return report;
}

async function importPreparedIntoApplePhotos() {
  const mediaPaths = preparedImport.merged.map((item) => item.mergedPath).filter((file) => fss.existsSync(file));
  if (!mediaPaths.length) throw new Error('No merged media files are available to import.');

  progress('apple-photos', 5, `Opening Apple Photos and importing ${mediaPaths.length} files`);
  let imported = 0;
  for (const chunk of chunkArray(mediaPaths, 100)) {
    checkCancelled();
    await execFile('/usr/bin/osascript', ['-e', buildPhotosImportScript(chunk)]);
    imported += chunk.length;
    progress('apple-photos', 5 + Math.floor((imported / mediaPaths.length) * 90), `Imported ${imported} of ${mediaPaths.length} into Apple Photos`);
  }

  const report = {
    ...preparedImport,
    applePhotosImportedAt: new Date().toISOString(),
    applePhotosImportedFiles: imported
  };
  delete report.merged;
  await fs.writeFile(path.join(preparedImport.mergedDir, 'apple-photos-import-report.json'), JSON.stringify(report, null, 2));
  progress('complete', 100, `Imported ${imported} files into Apple Photos`);
  return report;
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
    progress('uploading', 2 + Math.floor(((index + 1) / Math.max(merged.length, 1)) * 90), `Uploaded bytes ${index + 1} of ${merged.length}`);
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

function ensurePreparedReady() {
  if (!preparedImport) throw new Error('Prepare and review a preview first.');
  if (!preparedImport.readyToUpload) throw new Error('Preview is not ready because merged verification failed.');
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

function chunkArray(items, size) {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function buildPhotosImportScript(files) {
  const fileList = files.map((file) => `POSIX file ${JSON.stringify(file)}`).join(', ');
  return [
    'tell application "Photos"',
    'activate',
    `import {${fileList}} skip check duplicates yes`,
    'end tell'
  ].join('\n');
}
