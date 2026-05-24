const { app, BrowserWindow, dialog, ipcMain, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');
const fss = require('node:fs');
const os = require('node:os');
const crypto = require('node:crypto');
const http = require('node:http');
const extractZip = require('extract-zip');
const { exiftool } = require('exiftool-vendored');
const { OAuth2Client } = require('google-auth-library');
const mime = require('mime-types');

const SCOPES = ['https://www.googleapis.com/auth/photoslibrary.appendonly'];
const MEDIA_EXTENSIONS = new Set([
  '.3g2', '.3gp', '.avif', '.bmp', '.gif', '.heic', '.jpeg', '.jpg', '.m4v',
  '.mov', '.mp4', '.png', '.tif', '.tiff', '.webp'
]);
const DATE_KEYS = ['date', 'datetime', 'timestamp', 'saved', 'created', 'creation', 'taken', 'time'];
const FILE_KEYS = ['file', 'filename', 'path', 'media', 'download', 'url', 'link'];
const LAT_KEYS = ['latitude', 'lat'];
const LON_KEYS = ['longitude', 'lng', 'lon', 'long'];

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
    const files = await walkFiles(extractDir);
    const mediaFiles = files.filter((file) => MEDIA_EXTENSIONS.has(path.extname(file).toLowerCase()));
    const metadataEntries = await loadMetadataEntries(files);
    const matches = await buildMatches(mediaFiles, metadataEntries);
    checkCancelled();

    const matched = matches.filter((match) => match.metadata);
    progress('merging', 18, `Writing EXIF/XMP metadata for ${matched.length} matched files`);
    const merged = [];
    let mergeIndex = 0;
    for (const match of matched) {
      checkCancelled();
      const destination = await uniqueDestination(path.join(mergedDir, path.basename(match.file)));
      await fs.copyFile(match.file, destination);
      await writeExif(destination, match);
      merged.push({ ...match, mergedPath: destination });
      mergeIndex += 1;
      progress('merging', 18 + Math.floor((mergeIndex / Math.max(matched.length, 1)) * 22), `Merged ${mergeIndex} of ${matched.length}`);
    }

    progress('uploading', 42, `Uploading ${merged.length} files to Google Photos`);
    const uploadResults = await uploadToGooglePhotos(merged, options.accessToken);
    const report = {
      startedAt: startedAt.toISOString(),
      zipPath: options.zipPath,
      extractedMediaFiles: mediaFiles.length,
      metadataEntries: metadataEntries.length,
      matchedFiles: matched.length,
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

async function loadMetadataEntries(files) {
  const metadataFiles = files.filter((file) => ['.json', '.csv'].includes(path.extname(file).toLowerCase()));
  const entries = [];
  for (const file of metadataFiles) {
    try {
      if (file.endsWith('.json')) {
        const payload = JSON.parse(await fs.readFile(file, 'utf8'));
        for (const entry of flattenJsonRecords(payload)) entries.push({ ...entry, _sourceFile: file });
      } else if (file.endsWith('.csv')) {
        const rows = parseCsv(await fs.readFile(file, 'utf8'));
        for (const row of rows) entries.push({ ...row, _sourceFile: file });
      }
    } catch {
      // Snapchat exports sometimes include JSON that is unrelated to media. Ignore parser misses.
    }
  }
  return entries;
}

async function buildMatches(mediaFiles, metadataEntries) {
  const byName = new Map();
  const byStem = new Map();
  const byHash = new Map();
  for (const entry of metadataEntries) {
    for (const token of candidateFileTokens(entry)) {
      const filename = normalizeFileToken(token);
      if (!filename) continue;
      byName.set(filename.toLowerCase(), entry);
      byStem.set(path.parse(filename).name.toLowerCase(), entry);
    }
    for (const [key, value] of walkScalars(entry)) {
      if (key.toLowerCase().includes('sha') && typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value.trim())) {
        byHash.set(value.trim().toLowerCase(), entry);
      }
    }
  }

  const matches = [];
  for (const file of mediaFiles) {
    const sha = await sha256File(file);
    const name = path.basename(file).toLowerCase();
    const stem = path.parse(file).name.toLowerCase();
    const metadata = byHash.get(sha) || byName.get(name) || byStem.get(stem) || null;
    matches.push({
      file,
      metadata,
      matchedBy: byHash.has(sha) ? 'sha256' : byName.has(name) ? 'filename' : byStem.has(stem) ? 'stem' : 'none',
      takenAt: metadata ? findDatetime(metadata) : null,
      latitude: metadata ? findFloat(metadata, LAT_KEYS) : null,
      longitude: metadata ? findFloat(metadata, LON_KEYS) : null
    });
  }
  return matches;
}

async function writeExif(file, match) {
  const tags = {};
  if (match.takenAt) {
    tags.DateTimeOriginal = match.takenAt;
    tags.CreateDate = match.takenAt;
    tags.ModifyDate = match.takenAt;
    tags['XMP:DateCreated'] = match.takenAt.toISOString();
  }
  if (Number.isFinite(match.latitude) && Number.isFinite(match.longitude)) {
    tags.GPSLatitude = Math.abs(match.latitude);
    tags.GPSLatitudeRef = match.latitude >= 0 ? 'N' : 'S';
    tags.GPSLongitude = Math.abs(match.longitude);
    tags.GPSLongitudeRef = match.longitude >= 0 ? 'E' : 'W';
  }
  if (Object.keys(tags).length) await exiftool.write(file, tags, ['-overwrite_original']);
}

function flattenJsonRecords(payload) {
  if (Array.isArray(payload)) return payload.flatMap(flattenJsonRecords);
  if (payload && typeof payload === 'object') {
    if (looksLikeRecord(payload)) return [payload];
    return Object.values(payload).flatMap(flattenJsonRecords);
  }
  return [];
}

function looksLikeRecord(value) {
  const keys = Object.keys(value).join(' ').toLowerCase();
  return [...DATE_KEYS, ...FILE_KEYS, ...LAT_KEYS, ...LON_KEYS].some((key) => keys.includes(key));
}

function candidateFileTokens(entry) {
  const tokens = [];
  for (const [key, value] of walkScalars(entry)) {
    if (typeof value !== 'string') continue;
    const lowerKey = key.toLowerCase();
    const lowerValue = value.toLowerCase();
    if (FILE_KEYS.some((hint) => lowerKey.includes(hint)) || [...MEDIA_EXTENSIONS].some((ext) => lowerValue.endsWith(ext))) {
      tokens.push(value);
    }
  }
  return tokens;
}

function normalizeFileToken(token) {
  let value = token.trim();
  if (!value) return null;
  try {
    const parsed = new URL(value);
    value = parsed.pathname;
  } catch {
    // Not a URL.
  }
  return path.basename(decodeURIComponent(value));
}

function findDatetime(entry) {
  let best = null;
  for (const [key, value] of walkScalars(entry)) {
    const parsed = parseDatetime(value);
    if (!parsed) continue;
    const score = DATE_KEYS.some((hint) => key.toLowerCase().includes(hint)) ? 0 : 1;
    if (!best || score < best.score) best = { score, parsed };
  }
  return best?.parsed || null;
}

function parseDatetime(value) {
  if (typeof value === 'number') return parseEpoch(value);
  if (typeof value !== 'string') return null;
  const raw = value.trim();
  if (!raw) return null;
  if (/^\d{10,13}$/.test(raw)) return parseEpoch(Number(raw));
  const normalized = raw.replace(/\s+UTC$/i, 'Z');
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function parseEpoch(value) {
  let timestamp = value;
  if (timestamp > 10_000_000_000) timestamp /= 1000;
  if (timestamp <= 0 || timestamp > 4_102_444_800) return null;
  return new Date(timestamp * 1000);
}

function findFloat(entry, hints) {
  for (const [key, value] of walkScalars(entry)) {
    const leaf = key.split('.').pop().toLowerCase();
    if (!hints.some((hint) => leaf === hint || leaf.includes(hint))) continue;
    const parsed = Number.parseFloat(String(value).trim());
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function walkScalars(value, prefix = '') {
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => walkScalars(item, `${prefix}[${index}]`));
  }
  if (value && typeof value === 'object') {
    return Object.entries(value).flatMap(([key, nested]) => walkScalars(nested, prefix ? `${prefix}.${key}` : key));
  }
  return [[prefix, value]];
}

function parseCsv(text) {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return [];
  const headers = splitCsvLine(lines[0]);
  return lines.slice(1).map((line) => {
    const values = splitCsvLine(line);
    return Object.fromEntries(headers.map((header, index) => [header, values[index] || '']));
  });
}

function splitCsvLine(line) {
  const values = [];
  let current = '';
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];
    if (char === '"' && quoted && next === '"') {
      current += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === ',' && !quoted) {
      values.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  values.push(current);
  return values;
}

async function walkFiles(root) {
  const entries = await fs.readdir(root, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) files.push(...await walkFiles(fullPath));
    else if (entry.isFile()) files.push(fullPath);
  }
  return files;
}

async function sha256File(file) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    fss.createReadStream(file)
      .on('data', (chunk) => hash.update(chunk))
      .on('end', () => resolve(hash.digest('hex')))
      .on('error', reject);
  });
}

async function uniqueDestination(candidate) {
  if (!fss.existsSync(candidate)) return candidate;
  const parsed = path.parse(candidate);
  for (let index = 2; ; index += 1) {
    const next = path.join(parsed.dir, `${parsed.name}-${index}${parsed.ext}`);
    if (!fss.existsSync(next)) return next;
  }
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
