#!/usr/bin/env node
const fs = require('node:fs/promises');
const fss = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { exiftool } = require('exiftool-vendored');
const ffmpegPath = require('ffmpeg-static');
const { buildApplePhotosVideoArgs } = require('../src/main');

const execFileAsync = promisify(execFile);
const MEDIA_RE = /\.(jpe?g|mp4|mov)$/i;
const IMPORT_BATCH_SIZE = Number(process.env.IMPORT_BATCH_SIZE || 25);
const RESTART_EVERY_BATCHES = Number(process.env.RESTART_EVERY_BATCHES || 0);
const IMPORT_PAUSE_MS = Number(process.env.IMPORT_PAUSE_MS || 0);
const STOP_ON_ZERO_ACK = process.env.STOP_ON_ZERO_ACK === '1';

async function main() {
  const exportDir = process.argv[2];
  const photosFilenameList = process.argv[3] || '/tmp/photos-all-filenames.txt';
  if (!exportDir) throw new Error('Usage: node scripts/backfill-apple-photos-missing.js <export-dir> [photos-filenames.txt]');
  if (process.platform !== 'darwin') throw new Error('Apple Photos backfill only runs on macOS.');

  const photosNames = new Set((await fs.readFile(photosFilenameList, 'utf8')).split(/\r?\n/).filter(Boolean));
  const localNames = (await fs.readdir(exportDir)).filter((name) => MEDIA_RE.test(name)).sort();
  const missingNames = localNames.filter((name) => !photosNames.has(name));
  const stagingDir = path.join(exportDir, `_Apple Photos Backfill Ready ${new Date().toISOString().replace(/[:.]/g, '-')}`);
  const reportPath = path.join(exportDir, `apple-photos-backfill-report-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);

  const report = {
    startedAt: new Date().toISOString(),
    exportDir,
    photosFilenameList,
    localFiles: localNames.length,
    alreadyInPhotos: localNames.length - missingNames.length,
    missingFiles: missingNames.length,
    stagingDir,
    stagedFiles: 0,
    importedFiles: 0,
    failedFiles: []
  };

  console.log(`Found ${report.alreadyInPhotos} already in Photos and ${missingNames.length} missing.`);
  if (!missingNames.length) {
    await fs.writeFile(reportPath, JSON.stringify({ ...report, completedAt: new Date().toISOString() }, null, 2));
    console.log(`Nothing to import. Report: ${reportPath}`);
    return;
  }

  await fs.rm(stagingDir, { recursive: true, force: true });
  await fs.mkdir(stagingDir, { recursive: true });
  const staged = [];
  for (let index = 0; index < missingNames.length; index += 1) {
    const name = missingNames[index];
    const source = path.join(exportDir, name);
    const destination = path.join(stagingDir, name);
    try {
      await stageFile(source, destination);
      await copyImportantMetadata(source, destination);
      staged.push(destination);
      report.stagedFiles += 1;
    } catch (error) {
      report.failedFiles.push({ fileName: name, source, reason: error?.message || String(error), phase: 'stage' });
    }
    if ((index + 1) % 100 === 0 || index === missingNames.length - 1) {
      console.log(`Staged ${index + 1}/${missingNames.length}`);
      await fs.writeFile(reportPath, JSON.stringify(report, null, 2));
    }
  }

  for (let index = 0; index < staged.length; index += IMPORT_BATCH_SIZE) {
    const batch = staged.slice(index, index + IMPORT_BATCH_SIZE);
    const batchNumber = Math.floor(index / IMPORT_BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(staged.length / IMPORT_BATCH_SIZE);
    if (RESTART_EVERY_BATCHES > 0 && batchNumber > 1 && (batchNumber - 1) % RESTART_EVERY_BATCHES === 0) {
      await restartPhotos();
    }
    try {
      const { stdout } = await runPhotosImport(batch);
      const acknowledged = (stdout.match(/media item id /g) || []).length;
      if (acknowledged >= batch.length) {
        report.importedFiles += batch.length;
      } else {
        if (acknowledged === 0 && STOP_ON_ZERO_ACK) {
          report.failedFiles.push(...batch.map((file) => ({
            fileName: path.basename(file),
            source: file,
            reason: 'Photos acknowledged 0 files; stopped to avoid another rejection loop.',
            phase: 'import'
          })));
          await fs.writeFile(reportPath, JSON.stringify(report, null, 2));
          throw new Error(`Photos acknowledged 0 files in batch ${batchNumber}; stopped so you can rescan and resume.`);
        }
        console.log(`Batch ${batchNumber} acknowledged ${acknowledged}/${batch.length}, retrying batch one by one.`);
        const retry = await importOneByOne(batch);
        report.importedFiles += retry.imported;
        report.failedFiles.push(...retry.failedFiles);
      }
    } catch (error) {
      console.log(`Batch ${batchNumber} failed, retrying one by one.`);
      const retry = await importOneByOne(batch);
      report.importedFiles += retry.imported;
      report.failedFiles.push(...retry.failedFiles.map((failure) => ({
        ...failure,
        reason: `${failure.reason}; batch error: ${error?.message || String(error)}`
      })));
    }
    console.log(`Imported batch ${batchNumber}/${totalBatches}: ${Math.min(index + batch.length, staged.length)}/${staged.length}`);
    await fs.writeFile(reportPath, JSON.stringify(report, null, 2));
    if (IMPORT_PAUSE_MS > 0) await sleep(IMPORT_PAUSE_MS);
  }

  report.completedAt = new Date().toISOString();
  await fs.writeFile(reportPath, JSON.stringify(report, null, 2));
  console.log(`Backfill complete. Report: ${reportPath}`);
}

async function restartPhotos() {
  await execFileAsync('/usr/bin/osascript', ['-e', 'tell application "Photos" to quit']).catch(() => {});
  await sleep(5000);
  await execFileAsync('/usr/bin/osascript', ['-e', 'tell application "Photos" to activate']);
  await sleep(5000);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function importOneByOne(files) {
  const failedFiles = [];
  let imported = 0;
  for (const file of files) {
    try {
      const { stdout } = await runPhotosImport([file]);
      const acknowledged = (stdout.match(/media item id /g) || []).length;
      if (acknowledged) {
        imported += 1;
      } else {
        failedFiles.push({ fileName: path.basename(file), source: file, reason: 'Photos did not acknowledge import.', phase: 'import' });
      }
    } catch (singleError) {
      failedFiles.push({ fileName: path.basename(file), source: file, reason: singleError?.message || String(singleError), phase: 'import' });
    }
  }
  return { imported, failedFiles };
}

async function stageFile(source, destination) {
  const ext = path.extname(source).toLowerCase();
  if (ext === '.jpg' || ext === '.jpeg') {
    await execFileAsync('/usr/bin/sips', ['-s', 'format', 'jpeg', source, '--out', destination], { timeout: 5 * 60 * 1000, maxBuffer: 1024 * 1024 });
    return;
  }
  if (ext === '.mp4' || ext === '.mov') {
    try {
      await execFileAsync(ffmpegPath, buildApplePhotosVideoArgs(source, destination, { transcode: false }), { timeout: 15 * 60 * 1000, maxBuffer: 4 * 1024 * 1024 });
    } catch {
      await execFileAsync(ffmpegPath, buildApplePhotosVideoArgs(source, destination, { transcode: true }), { timeout: 30 * 60 * 1000, maxBuffer: 4 * 1024 * 1024 });
    }
    return;
  }
  await fs.copyFile(source, destination);
}

async function copyImportantMetadata(source, destination) {
  const tags = await exiftool.read(source).catch(() => ({}));
  const takenAt = parseTakenAt(tags) || parseDateFromFilename(path.basename(source));
  const writeTags = {};
  if (takenAt) {
    const exifDate = formatExifDate(takenAt);
    writeTags.DateTimeOriginal = exifDate;
    writeTags.CreateDate = exifDate;
    writeTags.ModifyDate = exifDate;
    writeTags['XMP:DateCreated'] = takenAt.toISOString();
  }
  if (Number.isFinite(Number(tags.GPSLatitude)) && Number.isFinite(Number(tags.GPSLongitude))) {
    writeTags.GPSLatitude = Number(tags.GPSLatitude);
    writeTags.GPSLongitude = Number(tags.GPSLongitude);
  }
  if (Object.keys(writeTags).length) {
    await exiftool.write(destination, writeTags, ['-overwrite_original']).catch(() => {});
  }
  if (takenAt) await fs.utimes(destination, takenAt, takenAt).catch(() => {});
}

function parseTakenAt(tags) {
  const value = tags.DateTimeOriginal?.rawValue || tags.DateCreated?.rawValue || tags.CreateDate?.rawValue || tags.MediaCreateDate?.rawValue || tags.TrackCreateDate?.rawValue;
  if (!value) return null;
  const normalized = String(value).replace(/^(\d{4}):(\d{2}):(\d{2})/, '$1-$2-$3').replace(' ', 'T');
  const date = new Date(normalized.endsWith('Z') ? normalized : `${normalized}Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function parseDateFromFilename(name) {
  const match = name.match(/^(\d{4})-(\d{2})-(\d{2})_(\d{2})-(\d{2})-(\d{2})_/);
  if (!match) return null;
  const [, year, month, day, hour, minute, second] = match;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second)));
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatExifDate(date) {
  const pad = (value) => String(value).padStart(2, '0');
  return `${date.getUTCFullYear()}:${pad(date.getUTCMonth() + 1)}:${pad(date.getUTCDate())} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}`;
}

async function runPhotosImport(files) {
  const script = buildPhotosImportScript(files);
  const scriptPath = path.join(os.tmpdir(), `snapchat-apple-backfill-${process.pid}-${crypto.randomUUID()}.applescript`);
  try {
    await fs.writeFile(scriptPath, script, { mode: 0o600 });
    return await execFileAsync('/usr/bin/osascript', [scriptPath], { timeout: 45 * 60 * 1000, maxBuffer: 4 * 1024 * 1024 });
  } finally {
    await fs.rm(scriptPath, { force: true }).catch(() => {});
  }
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

main().catch(async (error) => {
  await exiftool.end().catch(() => {});
  console.error(error);
  process.exitCode = 1;
}).finally(async () => {
  await exiftool.end().catch(() => {});
});
