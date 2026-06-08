const { app, BrowserWindow, dialog, ipcMain, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');
const fss = require('node:fs');
const os = require('node:os');
const http = require('node:http');
const crypto = require('node:crypto');
const { execFile: execFileCallback } = require('node:child_process');
const { promisify } = require('node:util');
const extractZip = require('extract-zip');
const archiver = require('archiver');
const { exiftool } = require('exiftool-vendored');
const { OAuth2Client } = require('google-auth-library');
const mime = require('mime-types');
const importer = require('./importer-core');

const SCOPES = ['https://www.googleapis.com/auth/photoslibrary.appendonly'];
const OAUTH_CLIENT_FILE = '.google-oauth-client.json';
const TOKEN_FILE = '.google-token.json';
const LAST_SESSION_FILE = 'last-import-session.json';
const GOOGLE_AUTH_MISSING_MESSAGE = 'Google Photos sign-in is not configured in this build. Add the Google OAuth Desktop client to the app build, then sign in again.';
const EXPORT_ROOT_NAME = 'Snapchat Memories Export';
const LEGACY_EXPORT_ROOT_NAME = 'Snapchat Google Photos Import';
const APPLE_PHOTOS_MAX_BATCH_FILES = 5;
const APPLE_PHOTOS_MAX_BATCH_BYTES = 650 * 1024 * 1024;
const APPLE_PHOTOS_MAX_BATCH_VIDEOS = 5;
const APPLE_PHOTOS_RESTART_EVERY_BATCHES = 30;
const APPLE_PHOTOS_IMPORT_PAUSE_MS = 500;
const execFile = promisify(execFileCallback);
const MEDIA_EXTENSIONS = new Set([
  '.3g2', '.3gp', '.avif', '.bmp', '.gif', '.heic', '.jpeg', '.jpg', '.m4v',
  '.mov', '.mp4', '.png', '.tif', '.tiff', '.webp'
]);

let mainWindow;
let cancelled = false;
let preparedImport = null;
const isElectronRuntime = Boolean(app && ipcMain);

function getAppPath(name) {
  if (app?.getPath) return app.getPath(name);
  if (name === 'documents') return path.join(os.homedir(), 'Documents');
  if (name === 'userData') return path.join(os.homedir(), 'Library', 'Application Support', 'snapchat-memories-importer');
  return os.homedir();
}

function exportRootNames() {
  return [EXPORT_ROOT_NAME, LEGACY_EXPORT_ROOT_NAME];
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 980,
    height: 720,
    minWidth: 820,
    minHeight: 640,
    title: 'Snapchat Memories Importer',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js')
    }
  });
  mainWindow.loadFile(path.join(__dirname, 'renderer.html'));
}

if (isElectronRuntime) {
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
      title: 'Choose Snapchat Export Zip(s) or Folder',
      properties: ['openFile', 'openDirectory', 'multiSelections'],
      filters: [{ name: 'Zip archives', extensions: ['zip'] }]
    });
    return result.canceled ? null : result.filePaths;
  });

  ipcMain.handle('sign-in', async () => {
    const auth = await signInWithGoogle();
    return { email: auth.email };
  });

  ipcMain.handle('google-auth-status', async () => googleAuthStatus());

  ipcMain.handle('run-preflight', async (_event, options = {}) => runPreflight(options));

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

  ipcMain.handle('open-external', async (_event, targetUrl) => {
    if (!/^https:\/\/github\.com\/shahakshat14\/snapchat-memories-importer\//.test(String(targetUrl))) {
      throw new Error('Only official project links can be opened from the app.');
    }
    await shell.openExternal(targetUrl);
    return true;
  });

  ipcMain.handle('prepare-import', async (_event, options) => {
    cancelled = false;
    preparedImport = null;
    return prepareImportPreview(options);
  });

  ipcMain.handle('resume-last-preview', async () => {
    cancelled = false;
    return resumeLastPreview();
  });

  ipcMain.handle('last-session-status', async () => lastSessionStatus());

  ipcMain.handle('upload-prepared', async (_event, options = {}) => {
    cancelled = false;
    ensurePreparedReady();
    const accessToken = await getValidAccessToken();
    if (!accessToken) throw new Error('Sign in with Google before uploading.');
    return uploadPreparedImport(accessToken, options);
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

  ipcMain.handle('delete-reviewed-duplicates', async () => {
    cancelled = false;
    ensurePreparedReady();
    return deleteReviewedDuplicates();
  });

  ipcMain.handle('cleanup-artifacts', async (_event, options = {}) => {
    ensurePreparedReady();
    return cleanupImportArtifacts(options);
  });

  ipcMain.handle('export-diagnostics', async () => exportDiagnosticsBundle());

  ipcMain.handle('release-readiness', async () => releaseReadiness());
}

async function runPreflight(options) {
  const zipPaths = await resolveSnapchatZipInputs(options.zipPaths || options.zipPath);
  if (!zipPaths.length) throw new Error('Choose at least one Snapchat export before running preflight.');
  const zipStats = await Promise.all(zipPaths.map(async (file) => {
    const stats = await fs.stat(file);
    return { file, fileName: path.basename(file), bytes: stats.size };
  }));
  const zipBytes = zipStats.reduce((total, item) => total + item.bytes, 0);
  const documentsDir = getAppPath('documents');
  const disk = await fs.statfs(documentsDir);
  const freeBytes = Number(disk.bavail) * Number(disk.bsize);
  const estimatedExtractedBytes = Math.round(zipBytes * 1.15);
  const estimatedMergedBytes = Math.round(zipBytes * 0.72);
  const estimatedZipBytes = Math.round(estimatedMergedBytes * 0.96);
  const requiredBytes = estimatedExtractedBytes + estimatedMergedBytes + estimatedZipBytes;
  const estimatedMinutes = Math.max(3, Math.ceil((zipStats.length * 2) + (zipBytes / (1024 ** 3)) * 2.8));
  return {
    checkedAt: new Date().toISOString(),
    zipCount: zipStats.length,
    zipBytes,
    zipFiles: zipStats,
    freeBytes,
    estimatedExtractedBytes,
    estimatedMergedBytes,
    estimatedZipBytes,
    requiredBytes,
    hasEnoughSpace: freeBytes > requiredBytes * 1.15,
    estimatedMinutes,
    recommendation: freeBytes > requiredBytes * 1.15
      ? 'Ready to run. There is enough headroom for extraction, merged output, and ZIP export.'
      : 'Free more disk space before running a full import.'
  };
}

async function prepareImportPreview(options) {
  const startedAt = new Date();
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'snapchat-google-photos-'));
  const extractDir = path.join(workspace, 'extracted');
  const sampleLimit = Number.isFinite(Number(options?.sampleLimit)) ? Math.max(0, Math.floor(Number(options.sampleLimit))) : 0;
  const mergedDir = path.join(getAppPath('documents'), EXPORT_ROOT_NAME, `${formatFolderDate(startedAt)}${sampleLimit ? '-sample' : ''}`);
  const previewReportPath = path.join(mergedDir, 'preview-report.json');
  await fs.mkdir(extractDir, { recursive: true });
  await fs.mkdir(mergedDir, { recursive: true });

  try {
    progress('extracting', 4, 'Finding Snapchat export archives');
    const zipPaths = await resolveSnapchatZipInputs(options.zipPaths || options.zipPath);
    if (!zipPaths.length) throw new Error('Choose at least one Snapchat My Data zip file, or a folder containing My Data zip files.');

    progress('extracting', 4, `Extracting ${zipPaths.length} Snapchat export archive${zipPaths.length === 1 ? '' : 's'}`);
    const extractedArchives = await extractSnapchatArchives(zipPaths, extractDir);
    checkCancelled();

    progress('scanning', 10, 'Finding media and metadata');
    const files = await importer.walkFiles(extractDir);
    const mediaFiles = files.filter((file) => MEDIA_EXTENSIONS.has(path.extname(file).toLowerCase()));
    const metadataEntries = await importer.loadMetadataEntries(files);
    const matches = await importer.buildMatches(mediaFiles, metadataEntries);
    const runMatches = sampleLimit ? matches.slice(0, sampleLimit) : matches;
    const matched = runMatches.filter((match) => match.metadata);
    const downloadable = sampleLimit ? [] : metadataEntries.filter((entry) => !matched.some((match) => match.metadata === entry) && importer.findDownloadUrl(entry));
    checkCancelled();

    progress('merging', 18, `Preparing ${matched.length + downloadable.length} Snapchat memories`);
    const merged = await importer.materializeMedia(runMatches, metadataEntries, mergedDir, (complete, total, detail = {}) => {
      checkCancelled();
      const percent = 18 + Math.floor((complete / Math.max(total, 1)) * 42);
      progress('merging', percent, detail.message || `Merged ${complete} of ${total}`, {
        ...detail,
        complete,
        total
      });
    });

    progress('verifying', 72, 'Verifying merged EXIF/XMP metadata');
    const verification = await importer.verifyMergedMedia(merged, 25);
    const riskScore = importer.calculateRiskScore({
      verification,
      skippedDownloadLinks: merged.skippedDownloads || [],
      exifWriteWarnings: merged.exifWriteWarnings || [],
      mediaRepairResults: merged.mediaRepairResults || []
    });
    const albumPlan = importer.buildAlbumPlan(merged);
    progress('verifying', 86, 'Building timeline audit and review folders');
    const reviewArtifacts = await importer.createReviewArtifacts({
      mergedDir,
      media: merged,
      verification,
      skippedDownloadLinks: merged.skippedDownloads || [],
      exifWriteWarnings: merged.exifWriteWarnings || [],
      mediaRepairResults: merged.mediaRepairResults || []
    });
    const preview = {
      startedAt: startedAt.toISOString(),
      zipPaths,
      zipPath: zipPaths[0] || null,
      archiveCount: zipPaths.length,
      sampleRun: Boolean(sampleLimit),
      sampleLimit,
      totalCandidateFiles: matches.length,
      extractedArchives,
      extractedMediaFiles: mediaFiles.length,
      metadataEntries: metadataEntries.length,
      matchedFiles: matched.length,
      downloadedFromMetadataLinks: merged.filter((item) => item.source === 'download-link').length,
      skippedDownloadLinks: merged.skippedDownloads || [],
      exifWriteWarnings: merged.exifWriteWarnings || [],
      mediaRepairResults: merged.mediaRepairResults || [],
      unmatchedEmbeddedMediaFiles: matches.filter((match) => !match.metadata).length,
      mergedDir,
      previewReportPath,
      verification,
      timelineAudit: verification.timeline,
      riskScore,
      albumPlan,
      reviewArtifacts,
      readyToUpload: verification.total > 0 && verification.missingFiles === 0
    };
    await fs.writeFile(previewReportPath, JSON.stringify(preview, null, 2));
    preparedImport = {
      ...preview,
      merged
    };
    await saveLastSession(preparedImport);
    progress('preview-ready', 100, `Preview ready. Review ${merged.length} merged files before uploading.`);
    return preview;
  } finally {
    await fs.rm(workspace, { recursive: true, force: true });
  }
}

async function refreshPreparedPreview({ startedAt = new Date(preparedImport.startedAt) } = {}) {
  const verification = await importer.verifyMergedMedia(preparedImport.merged, 25);
  const riskScore = importer.calculateRiskScore({
    verification,
    skippedDownloadLinks: preparedImport.skippedDownloadLinks || [],
    exifWriteWarnings: preparedImport.exifWriteWarnings || [],
    mediaRepairResults: preparedImport.mediaRepairResults || []
  });
  const albumPlan = importer.buildAlbumPlan(preparedImport.merged);
  const reviewArtifacts = await importer.createReviewArtifacts({
    mergedDir: preparedImport.mergedDir,
    media: preparedImport.merged,
    verification,
    skippedDownloadLinks: preparedImport.skippedDownloadLinks || [],
    exifWriteWarnings: preparedImport.exifWriteWarnings || [],
    mediaRepairResults: preparedImport.mediaRepairResults || []
  });
  const preview = {
    ...preparedImport,
    startedAt: startedAt.toISOString(),
    verification,
    timelineAudit: verification.timeline,
    riskScore,
    albumPlan,
    reviewArtifacts,
    readyToUpload: verification.total > 0 && verification.missingFiles === 0
  };
  const merged = preparedImport.merged;
  await fs.writeFile(preparedImport.previewReportPath, JSON.stringify({ ...preview, merged: undefined }, null, 2));
  preparedImport = {
    ...preview,
    merged
  };
  await saveLastSession(preparedImport);
  const { merged: _merged, ...publicPreview } = preparedImport;
  return publicPreview;
}

async function saveLastSession(session) {
  const { merged = [], ...publicSession } = session;
  const payload = {
    ...publicSession,
    resumable: true,
    savedAt: new Date().toISOString(),
    mergedManifest: merged.map((item) => ({
      ...item,
      takenAt: item.takenAt instanceof Date && !Number.isNaN(item.takenAt.getTime()) ? item.takenAt.toISOString() : null,
      metadata: undefined
    }))
  };
  await fs.mkdir(getAppPath('userData'), { recursive: true });
  await fs.writeFile(path.join(getAppPath('userData'), LAST_SESSION_FILE), JSON.stringify(payload, null, 2), { mode: 0o600 });
}

async function saveOperationCheckpoint(operation, detail) {
  if (!preparedImport) return;
  preparedImport.pipeline = {
    ...(preparedImport.pipeline || {}),
    [operation]: {
      ...(preparedImport.pipeline?.[operation] || {}),
      ...detail,
      updatedAt: new Date().toISOString()
    }
  };
  await saveLastSession(preparedImport);
}

async function resumeLastPreview() {
  const file = path.join(getAppPath('userData'), LAST_SESSION_FILE);
  if (!fss.existsSync(file)) throw new Error('No resumable import session was found.');
  const saved = JSON.parse(await fs.readFile(file, 'utf8'));
  const merged = (saved.mergedManifest || [])
    .map((item) => ({
      ...item,
      takenAt: item.takenAt ? new Date(item.takenAt) : null
    }))
    .filter((item) => item.mergedPath && fss.existsSync(item.mergedPath));
  if (!merged.length) throw new Error('The last import session no longer has merged files on disk.');
  preparedImport = {
    ...saved,
    merged,
    resumedAt: new Date().toISOString()
  };
  const { merged: _merged, mergedManifest: _manifest, ...publicPreview } = preparedImport;
  progress('preview-ready', 100, `Resumed ${merged.length} merged files from the last session.`);
  return publicPreview;
}

async function lastSessionStatus() {
  const file = path.join(getAppPath('userData'), LAST_SESSION_FILE);
  if (!fss.existsSync(file)) return { available: false };
  const saved = JSON.parse(await fs.readFile(file, 'utf8'));
  const pipeline = saved.pipeline || {};
  const interrupted = Object.entries(pipeline)
    .filter(([, value]) => value?.status === 'started' || value?.status === 'running')
    .map(([operation, value]) => ({ operation, ...value }));
  return {
    available: true,
    savedAt: saved.savedAt,
    mergedDir: saved.mergedDir,
    totalFiles: saved.verification?.total || saved.mergedManifest?.length || 0,
    interrupted,
    lastOperation: interrupted.at(-1) || null
  };
}

async function resolveSnapchatZipInputs(input) {
  const selected = Array.isArray(input) ? input : input ? [input] : [];
  const zipPaths = [];
  const seen = new Set();

  for (const selectedPath of selected) {
    let stats;
    try {
      stats = await fs.stat(selectedPath);
    } catch {
      continue;
    }

    const candidates = stats.isDirectory()
      ? (await importer.walkFiles(selectedPath)).filter((file) => path.extname(file).toLowerCase() === '.zip')
      : [selectedPath].filter((file) => path.extname(file).toLowerCase() === '.zip');

    for (const candidate of candidates.sort(compareSnapchatZipNames)) {
      const resolved = await fs.realpath(candidate).catch(() => path.resolve(candidate));
      if (seen.has(resolved)) continue;
      seen.add(resolved);
      zipPaths.push(resolved);
    }
  }

  return zipPaths.sort(compareSnapchatZipNames);
}

async function extractSnapchatArchives(zipPaths, extractDir) {
  const extractedArchives = [];
  for (let index = 0; index < zipPaths.length; index += 1) {
    checkCancelled();
    const zipPath = zipPaths[index];
    const archiveDir = path.join(extractDir, `${String(index + 1).padStart(3, '0')}-${safeArchiveName(zipPath)}`);
    await fs.mkdir(archiveDir, { recursive: true });
    progress('extracting', 4 + Math.floor(((index + 1) / Math.max(zipPaths.length, 1)) * 5), `Extracting ${path.basename(zipPath)}`);
    await extractZip(zipPath, { dir: archiveDir });
    extractedArchives.push({ zipPath, extractedDir: archiveDir });
  }
  return extractedArchives;
}

function safeArchiveName(zipPath) {
  return path.basename(zipPath, path.extname(zipPath))
    .replace(/[^a-z0-9._-]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'snapchat-export';
}

function compareSnapchatZipNames(left, right) {
  const leftKey = snapchatZipSortKey(left);
  const rightKey = snapchatZipSortKey(right);
  return leftKey.root.localeCompare(rightKey.root, undefined, { numeric: true, sensitivity: 'base' })
    || leftKey.part - rightKey.part
    || leftKey.name.localeCompare(rightKey.name, undefined, { numeric: true, sensitivity: 'base' });
}

function snapchatZipSortKey(zipPath) {
  const name = path.basename(zipPath, path.extname(zipPath));
  const match = name.match(/^(.*?)(?:[-_](\d+))?$/);
  return {
    name,
    root: match?.[1] || name,
    part: match?.[2] ? Number(match[2]) : 0
  };
}

async function uploadPreparedImport(accessToken, options = {}) {
  const reportPath = path.join(preparedImport.mergedDir, 'import-report.json');
  await saveOperationCheckpoint('google-upload', { status: 'started', expectedFiles: preparedImport.merged.length });
  progress('uploading', 2, `Uploading ${preparedImport.merged.length} reviewed files to Google Photos`);
  const uploadResults = await uploadToGooglePhotos(preparedImport.merged, accessToken, {
    albumPlan: preparedImport.albumPlan || [],
    createAlbums: Boolean(options.createAlbums)
  });
  const uploadVerification = verifyUploadResults(preparedImport.merged, uploadResults);
  const report = {
    ...preparedImport,
    reportPath,
    uploadedAt: new Date().toISOString(),
    uploadedFiles: uploadResults.filter((result) => result.status === 'created').length,
    uploadVerification,
    createdAlbums: uploadResults.createdAlbums || [],
    results: uploadResults
  };
  delete report.merged;
  await fs.writeFile(reportPath, JSON.stringify(report, null, 2));
  preparedImport.googleUploadReportPath = reportPath;
  preparedImport.uploadedAt = report.uploadedAt;
  preparedImport.uploadedFiles = report.uploadedFiles;
  preparedImport.uploadVerification = uploadVerification;
  await saveOperationCheckpoint('google-upload', { status: 'complete', reportPath, uploadedFiles: report.uploadedFiles, uploadVerification });
  progress('complete', 100, `Upload complete. Report saved to ${reportPath}`);
  return report;
}

function verifyUploadResults(merged, uploadResults) {
  const expectedFiles = merged.length;
  const createdFiles = uploadResults.filter((result) => result.status === 'created').length;
  const failedFiles = uploadResults.filter((result) => result.status !== 'created');
  const createdFilenames = new Set(uploadResults.filter((result) => result.status === 'created').map((result) => result.filename).filter(Boolean));
  const missingFromCreated = merged
    .map((item) => path.basename(item.mergedPath))
    .filter((fileName) => !createdFilenames.has(fileName));
  return {
    expectedFiles,
    createdFiles,
    failedFiles: failedFiles.length,
    missingFromCreated,
    passed: createdFiles === expectedFiles && failedFiles.length === 0,
    checkedAt: new Date().toISOString()
  };
}

async function exportPreparedZip() {
  const reportPath = path.join(preparedImport.mergedDir, 'zip-export-report.json');
  const zipPath = path.join(
    path.dirname(preparedImport.mergedDir),
    `${path.basename(preparedImport.mergedDir)}-merged-exif.zip`
  );
  progress('exporting', 5, 'Creating merged EXIF zip');
  await createZipFromFolder(preparedImport.mergedDir, zipPath);
  const report = {
    ...preparedImport,
    reportPath,
    exportedZipAt: new Date().toISOString(),
    exportedZipPath: zipPath
  };
  delete report.merged;
  await fs.writeFile(reportPath, JSON.stringify(report, null, 2));
  preparedImport.reportPath = reportPath;
  preparedImport.exportedZipPath = zipPath;
  preparedImport.exportedZipAt = report.exportedZipAt;
  await saveOperationCheckpoint('zip-export', { status: 'complete', reportPath, exportedZipPath: zipPath });
  progress('complete', 100, `Merged EXIF zip created at ${zipPath}`);
  return report;
}

async function importPreparedIntoApplePhotos() {
  if (process.platform !== 'darwin') {
    throw new Error('Apple Photos import is only available on macOS.');
  }
  const mediaItems = preparedImport.merged.filter((item) => item.mergedPath && fss.existsSync(item.mergedPath));
  if (!mediaItems.length) throw new Error('No merged media files are available to import.');

  progress('apple-photos', 1, 'Scanning Apple Photos for files that are already imported');
  const beforeNames = await readApplePhotosFilenames();
  const missingMediaItems = mediaItems.filter((item) => !beforeNames.has(path.basename(item.mergedPath)));
  const alreadyInPhotos = mediaItems.length - missingMediaItems.length;
  if (!missingMediaItems.length) {
    const report = await buildApplePhotosReport({
      imported: 0,
      alreadyInPhotos,
      staging: { stagingDir: null, files: [], normalizedFiles: 0, failedFiles: [] },
      importPlan: { totalFiles: 0, totalBytes: 0, batches: [] },
      failedFiles: [],
      beforeNames,
      afterNames: beforeNames
    });
    progress('complete', 100, `Apple Photos already has all ${mediaItems.length} importable filenames.`);
    return report;
  }

  progress('apple-photos', 2, `Preparing ${missingMediaItems.length} missing Apple Photos files`);
  const staging = await prepareApplePhotosStaging(missingMediaItems, path.join(preparedImport.mergedDir, `_Apple Photos Ready ${formatFolderDate(new Date())}`));
  const importPlan = await buildApplePhotosImportPlan(staging.files.map((item) => item.path));
  const totalBatches = importPlan.batches.length;
  if (!totalBatches) throw new Error('No importable files were found for Apple Photos.');

  let imported = 0;
  const failedFiles = [];
  await saveOperationCheckpoint('apple-photos', { status: 'started', expectedFiles: importPlan.totalFiles, alreadyInPhotos, batchCount: totalBatches });
  progress('apple-photos', 5, `Importing ${importPlan.totalFiles} missing files in ${totalBatches} small Apple Photos batches`);
  for (let index = 0; index < importPlan.batches.length; index += 1) {
    checkCancelled();
    if (index > 0 && index % APPLE_PHOTOS_RESTART_EVERY_BATCHES === 0) {
      progress('apple-photos', 5 + Math.floor((imported / importPlan.totalFiles) * 80), 'Refreshing Apple Photos before the next batch');
      await restartApplePhotos();
    }
    const batch = importPlan.batches[index];
    progress('apple-photos', 5 + Math.floor((imported / importPlan.totalFiles) * 85), `Apple Photos batch ${index + 1} of ${totalBatches}: ${batch.files.length} files`);
    const result = await importApplePhotosBatch(batch.files, { batchIndex: index + 1 });
    imported += result.imported;
    failedFiles.push(...result.failedFiles);
    await saveOperationCheckpoint('apple-photos', { status: 'running', imported, failedFiles: failedFiles.length, completedBatches: index + 1, batchCount: totalBatches });
    progress('apple-photos', 5 + Math.floor((imported / importPlan.totalFiles) * 90), `Imported ${imported} of ${importPlan.totalFiles} missing files into Apple Photos`);
    if (APPLE_PHOTOS_IMPORT_PAUSE_MS > 0) await sleep(APPLE_PHOTOS_IMPORT_PAUSE_MS);
  }

  if (!imported && failedFiles.length) {
    const firstFailure = failedFiles[0];
    throw new Error(`Apple Photos import failed for every file. First error: ${firstFailure.reason}`);
  }

  progress('apple-photos', 96, 'Verifying Apple Photos import results');
  const afterNames = await readApplePhotosFilenames();
  const report = await buildApplePhotosReport({ imported, alreadyInPhotos, staging, importPlan, failedFiles, beforeNames, afterNames });
  preparedImport.applePhotosImportedAt = report.applePhotosImportedAt;
  preparedImport.applePhotosImportedFiles = report.applePhotosImportedFiles;
  preparedImport.applePhotosSkippedFiles = report.applePhotosSkippedFiles;
  preparedImport.applePhotosReportPath = report.reportPath;
  await saveOperationCheckpoint('apple-photos', { status: 'complete', imported: report.applePhotosImportedFiles, failedFiles: report.applePhotosSkippedFiles, reportPath: report.reportPath });
  progress('complete', 100, report.applePhotosSkippedFiles
    ? `Apple Photos has ${report.applePhotosAccountedFiles} of ${mediaItems.length}. ${report.applePhotosSkippedFiles} files need review.`
    : `Apple Photos has all ${mediaItems.length} importable files.`);
  return report;
}

async function buildApplePhotosReport({ imported, alreadyInPhotos, staging, importPlan, failedFiles, beforeNames, afterNames }) {
  const exactMissing = preparedImport.merged
    .filter((item) => item.mergedPath && fss.existsSync(item.mergedPath))
    .filter((item) => !afterNames.has(path.basename(item.mergedPath)));
  const duplicateResolved = await findDuplicateResolvedApplePhotosFiles(exactMissing, afterNames);
  const duplicateResolvedNames = new Set(duplicateResolved.map((item) => item.fileName));
  const unresolvedMissing = exactMissing
    .filter((item) => !duplicateResolvedNames.has(path.basename(item.mergedPath)))
    .map((item) => ({
      file: item.mergedPath,
      fileName: path.basename(item.mergedPath),
      reason: 'File was not found in Apple Photos after import verification.'
    }));
  const combinedFailedFiles = [...(staging.failedFiles || []), ...failedFiles, ...unresolvedMissing];
  const report = {
    ...preparedImport,
    reportPath: path.join(preparedImport.mergedDir, 'apple-photos-import-report.json'),
    applePhotosImportedAt: new Date().toISOString(),
    applePhotosAlreadyImportedFiles: alreadyInPhotos,
    applePhotosNewlyImportedFiles: imported,
    applePhotosImportedFiles: alreadyInPhotos + imported,
    applePhotosAccountedFiles: preparedImport.merged.length - unresolvedMissing.length,
    applePhotosSkippedFiles: unresolvedMissing.length,
    applePhotosDuplicateResolvedFiles: duplicateResolved,
    applePhotosImportPlan: {
      totalFiles: importPlan.totalFiles,
      totalBytes: importPlan.totalBytes,
      batchCount: importPlan.batches.length,
      maxBatchFiles: APPLE_PHOTOS_MAX_BATCH_FILES,
      maxBatchBytes: APPLE_PHOTOS_MAX_BATCH_BYTES,
      maxBatchVideos: APPLE_PHOTOS_MAX_BATCH_VIDEOS,
      restartEveryBatches: APPLE_PHOTOS_RESTART_EVERY_BATCHES,
      stagingDir: staging.stagingDir,
      normalizedFiles: staging.normalizedFiles,
      stagingFailures: staging.failedFiles?.length || 0,
      photosFilenamesBefore: beforeNames.size,
      photosFilenamesAfter: afterNames.size
    },
    applePhotosFailedFiles: combinedFailedFiles,
    applePhotosVerification: buildApplePhotosVerification(importPlan, alreadyInPhotos + imported, combinedFailedFiles, {
      alreadyInPhotos,
      duplicateResolved: duplicateResolved.length,
      exactMissing: exactMissing.length,
      unresolvedMissing: unresolvedMissing.length
    })
  };
  delete report.merged;
  await fs.writeFile(report.reportPath, JSON.stringify(report, null, 2));
  return report;
}

async function deleteReviewedDuplicates() {
  const groups = preparedImport.verification?.duplicateFileGroups || [];
  if (!groups.length) {
    return { deletedFiles: 0, preview: await refreshPreparedPreview() };
  }

  const mergedRoot = await fs.realpath(preparedImport.mergedDir);
  const duplicatePaths = groups.flatMap((group) => group.duplicates || []).map((item) => item.path).filter(Boolean);
  const deleted = [];
  const skipped = [];

  for (const duplicatePath of duplicatePaths) {
    const resolved = await fs.realpath(duplicatePath).catch(() => null);
    if (!resolved || !isPathInside(resolved, mergedRoot) || !fss.existsSync(resolved)) {
      skipped.push({ path: duplicatePath, reason: 'File is missing or outside the merged output folder.' });
      continue;
    }
    await shell.trashItem(resolved);
    deleted.push(resolved);
  }

  preparedImport.merged = preparedImport.merged.filter((item) => item.mergedPath && fss.existsSync(item.mergedPath));
  const report = {
    reportPath: path.join(preparedImport.mergedDir, 'duplicate-cleanup-report.json'),
    mergedDir: preparedImport.mergedDir,
    deletedAt: new Date().toISOString(),
    deletedFiles: deleted.length,
    deleted,
    skipped
  };
  await fs.writeFile(report.reportPath, JSON.stringify(report, null, 2));
  progress('verifying', 92, `Removed ${deleted.length} duplicate file${deleted.length === 1 ? '' : 's'} and refreshed preview`);
  return {
    ...report,
    preview: await refreshPreparedPreview()
  };
}

async function cleanupImportArtifacts(options = {}) {
  const cleaned = [];
  const skipped = [];
  const mergedRoot = await fs.realpath(preparedImport.mergedDir).catch(() => null);
  const candidates = [];
  if (options.removeNeedsReview && preparedImport.reviewArtifacts?.reviewDir) candidates.push({ type: 'needs-review', path: preparedImport.reviewArtifacts.reviewDir });
  if (options.removeMergedOutput && mergedRoot) candidates.push({ type: 'merged-output', path: mergedRoot });
  if (options.removeExportZip && preparedImport.exportedZipPath) candidates.push({ type: 'exported-zip', path: preparedImport.exportedZipPath });

  for (const candidate of candidates) {
    const resolved = await fs.realpath(candidate.path).catch(() => null);
    if (!resolved || !fss.existsSync(resolved)) {
      skipped.push({ ...candidate, reason: 'Path no longer exists.' });
      continue;
    }
    const allowedRoots = exportRootNames().map((name) => path.join(getAppPath('documents'), name));
    if (!allowedRoots.some((allowedRoot) => isPathInside(resolved, allowedRoot) || resolved === allowedRoot)) {
      skipped.push({ ...candidate, reason: 'Path is outside the import output folder.' });
      continue;
    }
    await shell.trashItem(resolved);
    cleaned.push({ ...candidate, path: resolved });
  }

  const reportPath = path.join(getAppPath('documents'), EXPORT_ROOT_NAME, `cleanup-${formatFolderDate(new Date())}.json`);
  const report = {
    reportPath,
    cleanedAt: new Date().toISOString(),
    cleaned,
    skipped,
    note: 'Cleanup moves selected generated artifacts to Trash. Original Snapchat export zips are never removed automatically.'
  };
  await fs.mkdir(path.dirname(reportPath), { recursive: true });
  await fs.writeFile(reportPath, JSON.stringify(report, null, 2));
  progress('complete', 100, `Cleanup complete. ${cleaned.length} item${cleaned.length === 1 ? '' : 's'} moved to Trash.`);
  return report;
}

async function exportDiagnosticsBundle() {
  const diagnosticsDir = path.join(getAppPath('documents'), EXPORT_ROOT_NAME, 'Diagnostics');
  const diagnosticsPath = path.join(diagnosticsDir, `support-bundle-${formatFolderDate(new Date())}.json`);
  const auth = await googleAuthStatus().catch((error) => ({ configured: false, error: error.message }));
  const release = await releaseReadiness().catch((error) => ({ error: error.message }));
  const preview = preparedImport ? publicSessionSummary(preparedImport) : null;
  const lastSession = await lastSessionStatus().catch(() => ({ available: false }));
  const diagnostics = {
    createdAt: new Date().toISOString(),
    app: {
      name: app.getName(),
      version: app.getVersion(),
      electron: process.versions.electron,
      node: process.versions.node
    },
    system: {
      platform: process.platform,
      arch: process.arch,
      release: os.release(),
      totalMemory: os.totalmem(),
      freeMemory: os.freemem()
    },
    googleAuth: auth,
    releaseReadiness: release,
    lastSession,
    preview,
    recentReports: preparedImport ? supportReportPointers(preparedImport) : [],
    failedFilenames: preparedImport ? supportFailedFilenames(preparedImport).slice(0, 250) : [],
    privacy: 'No photo contents, OAuth secrets, access tokens, or original Snapchat export archives are included. Failed merged filenames may be included to help troubleshoot.'
  };
  await fs.mkdir(diagnosticsDir, { recursive: true });
  await fs.writeFile(diagnosticsPath, JSON.stringify(diagnostics, null, 2), { mode: 0o600 });
  return { diagnosticsPath, diagnostics };
}

function publicSessionSummary(session) {
  return {
    startedAt: session.startedAt,
    archiveCount: session.archiveCount,
    extractedMediaFiles: session.extractedMediaFiles,
    metadataEntries: session.metadataEntries,
    mergedDir: session.mergedDir,
    mergedFiles: session.verification?.total || session.merged?.length || 0,
    withDate: session.verification?.withDate || 0,
    withGps: session.verification?.withGps || 0,
    issueFiles: session.verification?.issueFiles?.length || 0,
    duplicateFiles: session.verification?.duplicateFiles || 0,
    riskScore: session.riskScore || null
  };
}

function supportReportPointers(session) {
  return [
    session.previewReportPath,
    session.reviewArtifacts?.summaryPath,
    session.reviewArtifacts?.reviewReportPath,
    session.reviewArtifacts?.duplicateReportPath
  ].filter(Boolean);
}

function supportFailedFilenames(session) {
  const issueFiles = session.verification?.issueFiles || [];
  const skippedLinks = session.skippedDownloadLinks || [];
  const repairFailures = (session.mediaRepairResults || []).filter((item) => item.repaired === false);
  return [
    ...issueFiles.map((item) => ({ type: item.type || 'issue', fileName: item.fileName || path.basename(item.file || '') })),
    ...skippedLinks.map((item) => ({ type: 'skipped-download', fileName: item.fileName || null, reason: item.reason || null })),
    ...repairFailures.map((item) => ({ type: 'damaged-video', fileName: item.fileName || path.basename(item.file || ''), reason: item.reason || null }))
  ].filter((item) => item.fileName || item.reason);
}

async function releaseReadiness() {
  const appBundle = process.platform === 'darwin' ? path.join('/Applications', 'Snapchat Memories Importer.app') : null;
  const dmgPath = path.join(__dirname, '..', 'dist', 'Snapchat-Memories-Importer-0.1.0.dmg');
  const winPath = path.join(__dirname, '..', 'dist', 'Snapchat-Memories-Importer-Setup-0.1.0.exe');
  const iconConfigured = Boolean(require('../package.json').build?.mac?.icon || require('../package.json').build?.win?.icon);
  const oauth = await googleAuthStatus().catch(() => ({ configured: false }));
  return {
    checkedAt: new Date().toISOString(),
    oauthConfigured: Boolean(oauth.configured),
    macDmgBuilt: fss.existsSync(dmgPath),
    windowsInstallerBuilt: fss.existsSync(winPath),
    appIconConfigured: iconConfigured,
    appleDeveloperSigned: false,
    appleNotarized: false,
    windowsTrustedCodeSigned: false,
    blockers: [
      ...(!iconConfigured ? ['Add a real application icon.'] : []),
      'Apple Developer ID signing and notarization require Apple developer credentials.',
      'Windows trusted signing requires a code-signing certificate.'
    ]
  };
}

function isPathInside(candidate, root) {
  const relative = path.relative(root, candidate);
  return relative && !relative.startsWith('..') && !path.isAbsolute(relative);
}

async function signInWithGoogle() {
  const config = await loadOAuthClientConfig();
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
  await saveToken(tokens);
  return { email: tokenInfo.email || 'Google account connected' };
}

async function loadOAuthClientConfig() {
  const saved = await readOAuthClientConfig(savedOAuthClientPath());
  if (saved) return saved;

  const bundled = await readOAuthClientConfig(path.join(__dirname, '..', 'config', 'google-oauth-client.json'));
  if (bundled) {
    await saveOAuthClientConfig(bundled);
    return bundled;
  }

  if (process.env.GOOGLE_OAUTH_CLIENT_ID && process.env.GOOGLE_OAUTH_CLIENT_SECRET) {
    const config = {
      client_id: process.env.GOOGLE_OAUTH_CLIENT_ID,
      client_secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET
    };
    await saveOAuthClientConfig(config);
    return config;
  }

  throw new Error(GOOGLE_AUTH_MISSING_MESSAGE);
}

async function googleAuthStatus() {
  const saved = await readOAuthClientConfig(savedOAuthClientPath());
  if (saved) return { configured: true, source: 'saved' };

  const bundled = await readOAuthClientConfig(path.join(__dirname, '..', 'config', 'google-oauth-client.json'));
  if (bundled) return { configured: true, source: 'bundled' };

  if (process.env.GOOGLE_OAUTH_CLIENT_ID && process.env.GOOGLE_OAUTH_CLIENT_SECRET) {
    return { configured: true, source: 'environment' };
  }

  return {
    configured: false,
    source: null,
    message: GOOGLE_AUTH_MISSING_MESSAGE
  };
}

async function readOAuthClientConfig(file) {
  if (!file || !fss.existsSync(file)) return null;
  const raw = JSON.parse(await fs.readFile(file, 'utf8'));
  const config = raw.installed || raw.web || raw;
  if (!config?.client_id || !config?.client_secret) return null;
  return {
    client_id: config.client_id,
    client_secret: config.client_secret
  };
}

async function saveOAuthClientConfig(config) {
  await fs.mkdir(getAppPath('userData'), { recursive: true });
  await fs.writeFile(savedOAuthClientPath(), JSON.stringify({ installed: config }, null, 2), { mode: 0o600 });
}

function savedOAuthClientPath() {
  return path.join(getAppPath('userData'), OAUTH_CLIENT_FILE);
}

async function uploadToGooglePhotos(merged, accessToken, { albumPlan = [], createAlbums = false } = {}) {
  const results = [];
  const createdAlbums = [];
  const albumIds = createAlbums ? await createGoogleAlbums(albumPlan, accessToken, createdAlbums) : new Map();
  const batches = new Map();
  for (let index = 0; index < merged.length; index += 1) {
    checkCancelled();
    const item = merged[index];
    const uploadToken = await uploadBytes(item.mergedPath, accessToken);
    const albumKey = albumKeyForDate(item.takenAt);
    const batchKey = createAlbums && albumIds.has(albumKey) ? albumKey : 'flat';
    if (!batches.has(batchKey)) batches.set(batchKey, []);
    const batch = batches.get(batchKey);
    batch.push({
      description: item.takenAt ? `Imported from Snapchat. Original date: ${item.takenAt.toISOString()}` : 'Imported from Snapchat.',
      simpleMediaItem: {
        fileName: path.basename(item.mergedPath),
        uploadToken
      }
    });
    progress('uploading', 2 + Math.floor(((index + 1) / Math.max(merged.length, 1)) * 90), `Uploaded bytes ${index + 1} of ${merged.length}`);
    if (batch.length === 50) {
      const created = await createMediaItems(batch, accessToken, albumIds.get(batchKey));
      results.push(...created);
      await saveOperationCheckpoint('google-upload', { status: 'running', uploadedBytes: index + 1, createdFiles: results.filter((item) => item.status === 'created').length, failedFiles: results.filter((item) => item.status !== 'created').length });
      batches.set(batchKey, []);
    }
  }
  for (const [batchKey, batch] of batches.entries()) {
    if (batch.length) {
      const created = await createMediaItems(batch, accessToken, albumIds.get(batchKey));
      results.push(...created);
      await saveOperationCheckpoint('google-upload', { status: 'running', createdFiles: results.filter((item) => item.status === 'created').length, failedFiles: results.filter((item) => item.status !== 'created').length });
    }
  }
  results.createdAlbums = createdAlbums;
  return results;
}

async function createGoogleAlbums(albumPlan, accessToken, createdAlbums) {
  const albumIds = new Map();
  for (const album of albumPlan) {
    checkCancelled();
    const response = await retryFetch('https://photoslibrary.googleapis.com/v1/albums', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ album: { title: album.title } })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(`Google album create failed for ${album.title}: ${response.status} ${JSON.stringify(payload)}`);
    if (payload.id) {
      albumIds.set(album.key, payload.id);
      createdAlbums.push({ key: album.key, title: album.title, id: payload.id, productUrl: payload.productUrl || null, count: album.count });
    }
  }
  return albumIds;
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

async function createMediaItems(items, accessToken, albumId = null) {
  const response = await retryFetch('https://photoslibrary.googleapis.com/v1/mediaItems:batchCreate', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ ...(albumId ? { albumId } : {}), newMediaItems: items })
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

function albumKeyForDate(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return null;
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
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
  await fs.mkdir(getAppPath('userData'), { recursive: true });
  await fs.writeFile(path.join(getAppPath('userData'), TOKEN_FILE), JSON.stringify(token, null, 2), { mode: 0o600 });
}

async function getSavedToken() {
  const file = path.join(getAppPath('userData'), TOKEN_FILE);
  if (!fss.existsSync(file)) return null;
  return JSON.parse(await fs.readFile(file, 'utf8'));
}

async function getValidAccessToken() {
  const token = await getSavedToken();
  if (!token?.access_token) return null;
  const expiresAt = token.expiry_date || 0;
  if (expiresAt > Date.now() + 60_000) return token.access_token;
  if (!token.refresh_token) return token.access_token;

  const config = await loadOAuthClientConfig();
  if (!config) return token.access_token;
  const oauth2Client = new OAuth2Client(config.client_id, config.client_secret);
  oauth2Client.setCredentials(token);
  const refreshed = await oauth2Client.refreshAccessToken();
  const credentials = { ...token, ...refreshed.credentials };
  await saveToken(credentials);
  return credentials.access_token;
}

function progress(stage, percent, message, detail = {}) {
  mainWindow?.webContents.send('progress', {
    stage,
    percent,
    message,
    detail,
    at: new Date().toISOString()
  });
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

async function prepareApplePhotosStaging(mediaItems, stagingDir) {
  await fs.rm(stagingDir, { recursive: true, force: true });
  await fs.mkdir(stagingDir, { recursive: true });
  const files = [];
  const failedFiles = [];
  let normalizedFiles = 0;
  for (let index = 0; index < mediaItems.length; index += 1) {
    checkCancelled();
    const item = mediaItems[index];
    const destination = path.join(stagingDir, path.basename(item.mergedPath));
    try {
      const normalized = await stageApplePhotosFile(item, destination);
      if (normalized) normalizedFiles += 1;
      await importer.writeExif(destination, item).catch(() => {});
      if (item.takenAt instanceof Date && !Number.isNaN(item.takenAt.getTime())) {
        await fs.utimes(destination, item.takenAt, item.takenAt).catch(() => {});
      }
      files.push({ path: destination, sourcePath: item.mergedPath, normalized });
    } catch (error) {
      failedFiles.push({
        file: item.mergedPath,
        fileName: path.basename(item.mergedPath),
        reason: error?.message || String(error)
      });
    }
    if ((index + 1) % 100 === 0 || index === mediaItems.length - 1) {
      progress('apple-photos', 2 + Math.floor(((index + 1) / mediaItems.length) * 8), `Prepared ${index + 1} of ${mediaItems.length} for Apple Photos`);
    }
  }
  return { stagingDir, files, normalizedFiles, failedFiles };
}

async function stageApplePhotosFile(item, destination) {
  const source = item.mergedPath;
  const extension = path.extname(source).toLowerCase();
  if (['.jpg', '.jpeg'].includes(extension)) {
    await execFile('/usr/bin/sips', ['-s', 'format', 'jpeg', source, '--out', destination], { timeout: 5 * 60 * 1000, maxBuffer: 1024 * 1024 });
    return true;
  }
  if (isVideoFile(source)) {
    await remuxApplePhotosVideo(source, destination);
    return true;
  }
  await fs.copyFile(source, destination);
  return false;
}

async function remuxApplePhotosVideo(source, destination) {
  const ffmpegPath = require('ffmpeg-static');
  const copyArgs = buildApplePhotosVideoArgs(source, destination, { transcode: false });
  try {
    await execFile(ffmpegPath, copyArgs, {
      timeout: 15 * 60 * 1000,
      maxBuffer: 4 * 1024 * 1024
    });
    return;
  } catch {
    const transcodeArgs = buildApplePhotosVideoArgs(source, destination, { transcode: true });
    await execFile(ffmpegPath, transcodeArgs, {
      timeout: 30 * 60 * 1000,
      maxBuffer: 4 * 1024 * 1024
    });
  }
}

function buildApplePhotosVideoArgs(source, destination, { transcode }) {
  const codecArgs = transcode
    ? ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '160k']
    : ['-c:v', 'copy', '-c:a', 'copy'];
  return [
    '-y',
    '-i', source,
    '-map', '0:v:0',
    '-map', '0:a?',
    '-dn',
    '-sn',
    ...codecArgs,
    '-movflags', '+faststart',
    destination
  ];
}

async function buildApplePhotosImportPlan(files) {
  const batches = [];
  let current = emptyApplePhotosBatch();
  let totalBytes = 0;
  for (const file of files) {
    const stats = await fs.stat(file).catch(() => null);
    if (!stats?.size) continue;
    const entry = {
      file,
      size: stats.size,
      isVideo: isVideoFile(file)
    };
    totalBytes += stats.size;
    if (current.files.length && applePhotosBatchWouldOverflow(current, entry)) {
      batches.push(current);
      current = emptyApplePhotosBatch();
    }
    current.files.push(entry.file);
    current.bytes += entry.size;
    if (entry.isVideo) current.videoCount += 1;
  }
  if (current.files.length) batches.push(current);
  return {
    totalFiles: batches.reduce((total, batch) => total + batch.files.length, 0),
    totalBytes,
    batches
  };
}

function emptyApplePhotosBatch() {
  return {
    files: [],
    bytes: 0,
    videoCount: 0
  };
}

function applePhotosBatchWouldOverflow(batch, entry) {
  return batch.files.length >= APPLE_PHOTOS_MAX_BATCH_FILES
    || batch.bytes + entry.size > APPLE_PHOTOS_MAX_BATCH_BYTES
    || (entry.isVideo && batch.videoCount >= APPLE_PHOTOS_MAX_BATCH_VIDEOS);
}

function isVideoFile(file) {
  return ['.3g2', '.3gp', '.m4v', '.mov', '.mp4'].includes(path.extname(file).toLowerCase());
}

function buildApplePhotosVerification(importPlan, imported, failedFiles, detail = {}) {
  return {
    checkedAt: new Date().toISOString(),
    method: 'AppleScript acknowledgements with full Apple Photos filename inventory before and after import',
    expectedFiles: importPlan.totalFiles,
    acknowledgedImportedFiles: imported,
    failedFiles: failedFiles.length,
    passed: imported === importPlan.totalFiles && failedFiles.length === 0,
    ...detail,
    note: 'The app imports only filenames missing from Photos, uses small batches, restarts Photos periodically, then compares the final Photos filename list and treats byte-identical local duplicates as resolved.'
  };
}

async function importApplePhotosBatch(files, { batchIndex }) {
  try {
    const result = await runPhotosImportScript(files, { timeoutMs: 45 * 60 * 1000 });
    const acknowledged = countApplePhotosImportResults(result.stdout);
    if (acknowledged >= files.length) return { imported: files.length, failedFiles: [] };
    progress('apple-photos', null, `Apple Photos acknowledged ${acknowledged} of ${files.length} files in batch ${batchIndex}. Refreshing Photos and retrying one by one.`);
    await restartApplePhotos();
    return retryApplePhotosFiles(files);
  } catch (error) {
    progress('apple-photos', null, `Apple Photos batch ${batchIndex} failed. Retrying files one by one.`);
    await restartApplePhotos().catch(() => {});
    return retryApplePhotosFiles(files, error);
  }
}

async function retryApplePhotosFiles(files, batchError = null) {
  const failedFiles = [];
  let imported = 0;
  for (const file of files) {
    checkCancelled();
    try {
      const result = await runPhotosImportScript([file], { timeoutMs: 10 * 60 * 1000 });
      const acknowledged = countApplePhotosImportResults(result.stdout);
      if (acknowledged) {
        imported += 1;
      } else {
        failedFiles.push({
          file,
          fileName: path.basename(file),
          reason: 'Photos did not acknowledge this file after import retry.'
        });
      }
    } catch (singleError) {
      failedFiles.push({
        file,
        fileName: path.basename(file),
        reason: singleError?.message || batchError?.message || String(singleError)
      });
    }
  }
  return { imported, failedFiles };
}

async function runPhotosImportScript(files, { timeoutMs }) {
  const scriptPath = path.join(os.tmpdir(), `snapchat-photos-import-${process.pid}-${Date.now()}-${crypto.randomUUID()}.applescript`);
  try {
    await fs.writeFile(scriptPath, buildPhotosImportScript(files), { mode: 0o600 });
    return await execFile('/usr/bin/osascript', [scriptPath], { timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024 });
  } finally {
    await fs.rm(scriptPath, { force: true }).catch(() => {});
  }
}

function countApplePhotosImportResults(stdout = '') {
  return (stdout.match(/media item id /g) || []).length;
}

async function readApplePhotosFilenames() {
  const scriptPath = path.join(os.tmpdir(), `snapchat-photos-filenames-${process.pid}-${Date.now()}-${crypto.randomUUID()}.applescript`);
  try {
    await fs.writeFile(scriptPath, buildPhotosFilenameInventoryScript(), { mode: 0o600 });
    const { stdout } = await execFile('/usr/bin/osascript', [scriptPath], { timeout: 20 * 60 * 1000, maxBuffer: 16 * 1024 * 1024 });
    return new Set(stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean));
  } finally {
    await fs.rm(scriptPath, { force: true }).catch(() => {});
  }
}

function buildPhotosFilenameInventoryScript() {
  return [
    'with timeout of 1200 seconds',
    'tell application "Photos"',
    'set allNames to filename of media items',
    'end tell',
    'end timeout',
    'set AppleScript\'s text item delimiters to linefeed',
    'return allNames as text'
  ].join('\n');
}

async function restartApplePhotos() {
  await execFile('/usr/bin/osascript', ['-e', 'tell application "Photos" to quit']).catch(() => {});
  await sleep(5000);
  await execFile('/usr/bin/osascript', ['-e', 'tell application "Photos" to activate']);
  await sleep(5000);
}

async function findDuplicateResolvedApplePhotosFiles(missingItems, photosNames) {
  const byHash = new Map();
  for (const item of preparedImport.merged) {
    if (!item.mergedPath || !fss.existsSync(item.mergedPath)) continue;
    const hash = await sha256File(item.mergedPath).catch(() => null);
    if (!hash) continue;
    if (!byHash.has(hash)) byHash.set(hash, []);
    byHash.get(hash).push(item);
  }
  const resolved = [];
  for (const item of missingItems) {
    const hash = await sha256File(item.mergedPath).catch(() => null);
    const siblings = hash ? byHash.get(hash) || [] : [];
    const presentSibling = siblings.find((candidate) => candidate.mergedPath !== item.mergedPath && photosNames.has(path.basename(candidate.mergedPath)));
    if (presentSibling) {
      resolved.push({
        fileName: path.basename(item.mergedPath),
        duplicateOf: path.basename(presentSibling.mergedPath),
        hash
      });
    }
  }
  return resolved;
}

async function sha256File(file) {
  const hash = crypto.createHash('sha256');
  const stream = fss.createReadStream(file);
  for await (const chunk of stream) hash.update(chunk);
  return hash.digest('hex');
}

async function missingApplePhotosFilenames(files) {
  const scriptPath = path.join(os.tmpdir(), `snapchat-photos-verify-${process.pid}-${Date.now()}-${crypto.randomUUID()}.applescript`);
  try {
    await fs.writeFile(scriptPath, buildPhotosFilenameVerificationScript(files), { mode: 0o600 });
    const { stdout } = await execFile('/usr/bin/osascript', [scriptPath], { timeout: 10 * 60 * 1000, maxBuffer: 1024 * 1024 });
    return stdout.split('\n').map((line) => line.trim()).filter(Boolean);
  } finally {
    await fs.rm(scriptPath, { force: true }).catch(() => {});
  }
}

function buildPhotosFilenameVerificationScript(files) {
  const names = files.map((file) => JSON.stringify(path.basename(file))).join(', ');
  return [
    `set targetNames to {${names}}`,
    'set missingNames to {}',
    'tell application "Photos"',
    'repeat with targetName in targetNames',
    'set currentName to contents of targetName',
    'if (count (media items whose filename is currentName)) is 0 then set end of missingNames to currentName',
    'end repeat',
    'end tell',
    'set AppleScript\'s text item delimiters to linefeed',
    'return missingNames as text'
  ].join('\n');
}

function buildPhotosImportScript(files) {
  const fileList = files.map((file) => `POSIX file ${JSON.stringify(file)}`).join(', ');
  return [
    'with timeout of 3600 seconds',
    'tell application "Photos"',
    'activate',
    `import {${fileList}} skip check duplicates yes`,
    'end tell',
    'end timeout'
  ].join('\n');
}

async function createZipFromFolder(sourceDir, zipPath) {
  await fs.mkdir(path.dirname(zipPath), { recursive: true });
  return new Promise((resolve, reject) => {
    const output = fss.createWriteStream(zipPath);
    const archive = archiver('zip', { zlib: { level: 9 } });
    output.on('close', resolve);
    output.on('error', reject);
    archive.on('error', reject);
    archive.pipe(output);
    archive.directory(sourceDir, path.basename(sourceDir));
    archive.finalize();
  });
}

module.exports = {
  resolveSnapchatZipInputs,
  extractSnapchatArchives,
  safeArchiveName,
  compareSnapchatZipNames,
  buildApplePhotosImportPlan,
  buildApplePhotosVideoArgs,
  buildPhotosImportScript,
  buildPhotosFilenameVerificationScript,
  buildPhotosFilenameInventoryScript,
  runPreflight,
  releaseReadiness
};
