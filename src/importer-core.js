const path = require('node:path');
const fs = require('node:fs/promises');
const fss = require('node:fs');
const crypto = require('node:crypto');
const { execFile } = require('node:child_process');
const { pipeline } = require('node:stream/promises');
const { Readable } = require('node:stream');
const { promisify } = require('node:util');
const { exiftool } = require('exiftool-vendored');
const ffmpegStaticPath = require('ffmpeg-static');
const mime = require('mime-types');

const execFileAsync = promisify(execFile);

const MEDIA_EXTENSIONS = new Set([
  '.3g2', '.3gp', '.avif', '.bmp', '.gif', '.heic', '.jpeg', '.jpg', '.m4v',
  '.mov', '.mp4', '.png', '.tif', '.tiff', '.webp'
]);
const DATE_KEYS = ['date', 'datetime', 'timestamp', 'saved', 'created', 'creation', 'taken', 'time'];
const FILE_KEYS = ['file', 'filename', 'path', 'media', 'download', 'url', 'link'];
const LAT_KEYS = ['latitude', 'lat'];
const LON_KEYS = ['longitude', 'lng', 'lon', 'long'];

async function prepareMergedMedia({ extractedDir, mergedDir, onProgress = () => {} }) {
  const files = await walkFiles(extractedDir);
  const mediaFiles = files.filter((file) => MEDIA_EXTENSIONS.has(path.extname(file).toLowerCase()));
  const metadataEntries = await loadMetadataEntries(files);
  const directMatches = await buildMatches(mediaFiles, metadataEntries);
  const media = await materializeMedia(directMatches, metadataEntries, mergedDir, onProgress);
  return {
    files,
    mediaFiles,
    metadataEntries,
    directMatches,
    media,
    skippedDownloads: media.skippedDownloads || [],
    mediaRepairResults: media.mediaRepairResults || []
  };
}

async function verifyMergedMedia(media, sampleSize = 25) {
  const sample = [];
  const metadataComparisons = [];
  const issueFiles = [];
  const byYear = {};
  const byMonth = {};
  const timestampGroups = new Map();
  const hashGroups = new Map();
  const matchCounts = {};
  let withDate = 0;
  let withGps = 0;
  let missingFiles = 0;
  let unreadableFiles = 0;
  let oldest = null;
  let newest = null;
  const sourceCounts = {};
  const warnings = [];

  for (const item of media) {
    sourceCounts[item.source] = (sourceCounts[item.source] || 0) + 1;
    matchCounts[item.matchedBy || 'unknown'] = (matchCounts[item.matchedBy || 'unknown'] || 0) + 1;
    if (!fss.existsSync(item.mergedPath)) {
      missingFiles += 1;
      issueFiles.push(issueRecord(item, 'missing-file', 'Merged file is missing from disk.'));
      continue;
    }
    const stats = await fs.stat(item.mergedPath).catch(() => null);
    const fileHash = await sha256File(item.mergedPath).catch(() => null);
    if (stats && fileHash) {
      if (!hashGroups.has(fileHash)) hashGroups.set(fileHash, []);
      hashGroups.get(fileHash).push({
        fileName: path.basename(item.mergedPath),
        path: item.mergedPath,
        size: stats.size,
        source: item.source,
        matchedBy: item.matchedBy,
        dateSource: item.dateSource || null,
        takenAt: item.takenAt instanceof Date && !Number.isNaN(item.takenAt.getTime()) ? item.takenAt.toISOString() : null
      });
    }

    let tags;
    try {
      tags = await exiftool.read(item.mergedPath);
    } catch (error) {
      unreadableFiles += 1;
      warnings.push({
        fileName: path.basename(item.mergedPath),
        path: item.mergedPath,
        reason: error?.message || String(error)
      });
      issueFiles.push(issueRecord(item, 'unreadable-file', error?.message || String(error)));
      continue;
    }
    const dateValue = tags.DateTimeOriginal?.rawValue || tags.DateCreated?.rawValue || null;
    const date = parseExifDateValue(dateValue);
    const hasDate = Boolean(dateValue);
    const hasGps = Number.isFinite(Number(tags.GPSLatitude)) && Number.isFinite(Number(tags.GPSLongitude));
    if (hasDate) {
      withDate += 1;
      if (date) {
        oldest = !oldest || date < oldest ? date : oldest;
        newest = !newest || date > newest ? date : newest;
        byYear[String(date.getUTCFullYear())] = (byYear[String(date.getUTCFullYear())] || 0) + 1;
        const monthKey = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
        byMonth[monthKey] = (byMonth[monthKey] || 0) + 1;
        const timestampKey = date.toISOString();
        if (!timestampGroups.has(timestampKey)) timestampGroups.set(timestampKey, []);
        timestampGroups.get(timestampKey).push(path.basename(item.mergedPath));
      }
    } else {
      issueFiles.push(issueRecord(item, 'missing-date', 'No embedded EXIF/XMP/QuickTime date was readable after merge.'));
    }
    if (hasGps) withGps += 1;

    if (sample.length < sampleSize) {
      const originalTags = await readOriginalMetadataSample(item);
      const comparison = metadataComparisonRecord(item, tags, originalTags);
      sample.push({
        fileName: path.basename(item.mergedPath),
        source: item.source,
        matchedBy: item.matchedBy,
        dateSource: item.dateSource || null,
        date: tags.DateTimeOriginal?.rawValue || tags.DateCreated?.rawValue || null,
        latitude: Number.isFinite(Number(tags.GPSLatitude)) ? Number(tags.GPSLatitude) : null,
        longitude: Number.isFinite(Number(tags.GPSLongitude)) ? Number(tags.GPSLongitude) : null,
        path: item.mergedPath
      });
      metadataComparisons.push(comparison);
    }
  }

  const duplicateTimestamps = [...timestampGroups.entries()]
    .filter(([, files]) => files.length > 1)
    .map(([timestamp, files]) => ({ timestamp, count: files.length, files: files.slice(0, 10) }))
    .sort((left, right) => right.count - left.count || left.timestamp.localeCompare(right.timestamp));
  const duplicateFileGroups = [...hashGroups.entries()]
    .filter(([, files]) => files.length > 1)
    .map(([sha256, files], index) => {
      const sorted = files
        .slice()
        .sort((left, right) => (left.takenAt || '').localeCompare(right.takenAt || '') || left.fileName.localeCompare(right.fileName));
      const [keeper, ...duplicates] = sorted;
      return {
        id: `${sha256.slice(0, 12)}-${index + 1}`,
        sha256,
        count: sorted.length,
        duplicateCount: duplicates.length,
        size: sorted[0]?.size || 0,
        totalReclaimableBytes: duplicates.reduce((total, item) => total + (item.size || 0), 0),
        mediaTypes: [...new Set(sorted.map((item) => mediaTypeFromExtension(item.fileName)).filter(Boolean))],
        recommendation: duplicates.length
          ? `Keep ${sorted[0]?.fileName || 'the first file'} and move ${duplicates.length} byte-identical duplicate${duplicates.length === 1 ? '' : 's'} to Trash after review.`
          : 'No removable duplicate candidate.',
        keeper,
        duplicates
      };
    })
    .sort((left, right) => right.duplicateCount - left.duplicateCount || left.keeper.fileName.localeCompare(right.keeper.fileName));

  return {
    total: media.length,
    withDate,
    withGps,
    missingFiles,
    unreadableFiles,
    sourceCounts,
    matchCounts,
    timeline: {
      oldest: oldest ? oldest.toISOString() : null,
      newest: newest ? newest.toISOString() : null,
      byYear,
      byMonth,
      duplicateTimestamps
    },
    duplicateFileGroups,
    duplicateFiles: duplicateFileGroups.reduce((total, group) => total + group.duplicateCount, 0),
    issueFiles,
    warnings,
    sample,
    metadataComparisons
  };
}

async function readOriginalMetadataSample(item) {
  if (!item?.file || !fss.existsSync(item.file)) return null;
  if (item.mergedPath && path.resolve(item.file) === path.resolve(item.mergedPath)) return null;
  try {
    return await exiftool.read(item.file);
  } catch {
    return null;
  }
}

function metadataComparisonRecord(item, mergedTags, originalTags) {
  const snapchatDate = item.takenAt instanceof Date && !Number.isNaN(item.takenAt.getTime()) ? item.takenAt : null;
  const mergedDateValue = mergedTags.DateTimeOriginal?.rawValue || mergedTags.DateCreated?.rawValue || mergedTags.CreateDate?.rawValue || null;
  const mergedDate = parseExifDateValue(mergedDateValue);
  const originalDateValue = originalTags?.DateTimeOriginal?.rawValue || originalTags?.DateCreated?.rawValue || originalTags?.CreateDate?.rawValue || null;
  const originalDate = parseExifDateValue(originalDateValue);
  const snapchatLatitude = Number.isFinite(item.latitude) ? item.latitude : null;
  const snapchatLongitude = Number.isFinite(item.longitude) ? item.longitude : null;
  const mergedLatitude = Number.isFinite(Number(mergedTags.GPSLatitude)) ? Number(mergedTags.GPSLatitude) : null;
  const mergedLongitude = Number.isFinite(Number(mergedTags.GPSLongitude)) ? Number(mergedTags.GPSLongitude) : null;
  const originalLatitude = Number.isFinite(Number(originalTags?.GPSLatitude)) ? Number(originalTags.GPSLatitude) : null;
  const originalLongitude = Number.isFinite(Number(originalTags?.GPSLongitude)) ? Number(originalTags.GPSLongitude) : null;

  return {
    fileName: item?.mergedPath ? path.basename(item.mergedPath) : item?.file ? path.basename(item.file) : 'Unknown file',
    originalFileName: item?.file ? path.basename(item.file) : null,
    path: item?.mergedPath || null,
    source: item?.source || null,
    matchedBy: item?.matchedBy || null,
    dateSource: item?.dateSource || null,
    snapchat: {
      date: snapchatDate ? snapchatDate.toISOString() : null,
      latitude: snapchatLatitude,
      longitude: snapchatLongitude,
      sourceFile: item?.metadata?._sourceFile || null
    },
    originalEmbedded: {
      date: originalDate ? originalDate.toISOString() : originalDateValue || null,
      latitude: originalLatitude,
      longitude: originalLongitude
    },
    mergedEmbedded: {
      date: mergedDate ? mergedDate.toISOString() : mergedDateValue || null,
      latitude: mergedLatitude,
      longitude: mergedLongitude
    },
    status: {
      date: compareDates(snapchatDate, mergedDate),
      gps: compareGps(snapchatLatitude, snapchatLongitude, mergedLatitude, mergedLongitude)
    }
  };
}

function compareDates(expected, actual) {
  if (!expected && !actual) return 'missing';
  if (!expected) return 'added-from-file';
  if (!actual) return 'missing-after-merge';
  return Math.abs(expected.getTime() - actual.getTime()) <= 1000 ? 'matched' : 'changed';
}

function compareGps(expectedLatitude, expectedLongitude, actualLatitude, actualLongitude) {
  const hasExpected = Number.isFinite(expectedLatitude) && Number.isFinite(expectedLongitude);
  const hasActual = Number.isFinite(actualLatitude) && Number.isFinite(actualLongitude);
  if (!hasExpected && !hasActual) return 'missing';
  if (!hasExpected) return 'added-from-file';
  if (!hasActual) return 'missing-after-merge';
  return Math.abs(expectedLatitude - actualLatitude) <= 0.00001 && Math.abs(expectedLongitude - actualLongitude) <= 0.00001 ? 'matched' : 'changed';
}

async function createReviewArtifacts({ mergedDir, media, verification, skippedDownloadLinks = [], exifWriteWarnings = [], mediaRepairResults = [] }) {
  const reviewDir = path.join(mergedDir, '_Needs Review');
  const reviewReportPath = path.join(reviewDir, 'review-report.json');
  const summaryPath = path.join(mergedDir, 'Import Summary.html');
  const damagedDir = path.join(reviewDir, 'Damaged Videos');
  const missingDatesDir = path.join(reviewDir, 'Missing Dates');
  const skippedDownloadsDir = path.join(reviewDir, 'Skipped Downloads');
  const duplicatesDir = path.join(reviewDir, 'Duplicates');
  const duplicateReportPath = path.join(duplicatesDir, 'duplicate-files.json');
  const copied = [];

  const damagedPaths = new Set([
    ...exifWriteWarnings.map((item) => item.path).filter(Boolean),
    ...mediaRepairResults.filter((item) => !item.repaired).map((item) => item.path).filter(Boolean)
  ]);
  const missingDatePaths = new Set((verification.issueFiles || [])
    .filter((item) => item.type === 'missing-date')
    .map((item) => item.path)
    .filter(Boolean));

  for (const file of damagedPaths) {
    if (!fss.existsSync(file)) continue;
    await fs.mkdir(damagedDir, { recursive: true });
    const destination = await uniqueDestination(path.join(damagedDir, path.basename(file)));
    await fs.copyFile(file, destination);
    copied.push({ type: 'damaged-video', originalPath: file, reviewPath: destination });
  }

  for (const file of missingDatePaths) {
    if (!fss.existsSync(file) || damagedPaths.has(file)) continue;
    await fs.mkdir(missingDatesDir, { recursive: true });
    const destination = await uniqueDestination(path.join(missingDatesDir, path.basename(file)));
    await fs.copyFile(file, destination);
    copied.push({ type: 'missing-date', originalPath: file, reviewPath: destination });
  }

  if (skippedDownloadLinks.length) {
    await fs.mkdir(skippedDownloadsDir, { recursive: true });
    await fs.writeFile(path.join(skippedDownloadsDir, 'skipped-downloads.json'), JSON.stringify(skippedDownloadLinks, null, 2));
  }
  if (verification.duplicateFileGroups?.length) {
    await fs.mkdir(duplicatesDir, { recursive: true });
    await fs.writeFile(duplicateReportPath, JSON.stringify(verification.duplicateFileGroups, null, 2));
  }

  const report = {
    createdAt: new Date().toISOString(),
    reviewDir,
    reviewReportPath,
    summaryPath,
    duplicateReportPath: verification.duplicateFileGroups?.length ? duplicateReportPath : null,
    copied,
    counts: {
      damagedVideos: copied.filter((item) => item.type === 'damaged-video').length,
      missingDates: copied.filter((item) => item.type === 'missing-date').length,
      skippedDownloads: skippedDownloadLinks.length,
      exifWarnings: exifWriteWarnings.length,
      duplicateGroups: verification.duplicateFileGroups?.length || 0,
      duplicateFiles: verification.duplicateFiles || 0
    },
    issues: verification.issueFiles || [],
    dateRepairSuggestions: buildDateRepairSuggestions(media, verification.issueFiles || []),
    skippedDownloadLinks,
    exifWriteWarnings,
    mediaRepairResults
  };

  if (copied.length || skippedDownloadLinks.length || exifWriteWarnings.length || (verification.issueFiles || []).length || verification.duplicateFileGroups?.length) {
    await fs.mkdir(reviewDir, { recursive: true });
    await fs.writeFile(reviewReportPath, JSON.stringify(report, null, 2));
  }

  await fs.writeFile(summaryPath, renderImportSummaryHtml({ media, verification, report }));
  return report;
}

function buildDateRepairSuggestions(media, issueFiles) {
  const byName = new Map(media.map((item) => [path.basename(item.mergedPath || item.file || ''), item]));
  const dated = media
    .filter((item) => item.takenAt instanceof Date && !Number.isNaN(item.takenAt.getTime()))
    .sort((left, right) => left.takenAt - right.takenAt);
  return issueFiles
    .filter((item) => item.type === 'missing-date')
    .slice(0, 100)
    .map((issue) => {
      const source = byName.get(issue.fileName) || {};
      const filenameDate = source.mergedPath ? findDatetimeInFilename(path.basename(source.mergedPath)) : null;
      const neighbors = nearestDatedNeighbors(dated, source);
      return {
        fileName: issue.fileName,
        path: issue.path,
        suggestedDate: filenameDate ? filenameDate.toISOString() : neighbors[0]?.takenAt || null,
        confidence: filenameDate ? 'high' : neighbors.length ? 'low' : 'none',
        reason: filenameDate ? 'Recovered from filename.' : neighbors.length ? 'Estimated from nearby dated memories.' : 'No local date clue found.',
        neighbors
      };
    });
}

function nearestDatedNeighbors(dated, source) {
  if (!source?.mergedPath) return [];
  const sourceName = path.basename(source.mergedPath);
  return dated
    .map((item) => ({
      fileName: path.basename(item.mergedPath || item.file || ''),
      takenAt: item.takenAt.toISOString(),
      distance: Math.abs((item.file || '').localeCompare(sourceName))
    }))
    .sort((left, right) => left.distance - right.distance)
    .slice(0, 3)
    .map(({ distance: _distance, ...item }) => item);
}

async function materializeMedia(directMatches, metadataEntries, mergedDir, onProgress = () => {}) {
  await fs.mkdir(mergedDir, { recursive: true });
  const usedMetadata = new Set();
  const materialized = [];
  const skippedDownloads = [];
  const exifWriteWarnings = [];
  const mediaRepairResults = [];
  const matchedDirect = directMatches.filter((match) => match.metadata);
  let totalWork = matchedDirect.length;

  for (let index = 0; index < matchedDirect.length; index += 1) {
    const match = matchedDirect[index];
    usedMetadata.add(match.metadata);
    const outputName = outputFilenameForMatch(match, path.basename(match.file));
    const destination = await uniqueDestination(path.join(mergedDir, outputName));
    emitMaterializeProgress(onProgress, materialized.length, totalWork, `Copying ${path.basename(match.file)} as ${path.basename(destination)}`, match.file, 'copying');
    await fs.copyFile(match.file, destination);
    emitMaterializeProgress(onProgress, materialized.length, totalWork, `Writing metadata to ${path.basename(destination)}`, destination, 'writing-exif');
    const exifResult = await tryWriteExif(destination, match);
    if (exifResult.warning) {
      exifWriteWarnings.push(exifResult.warning);
      emitMaterializeProgress(onProgress, materialized.length, totalWork, `Could not write metadata to ${path.basename(destination)}`, destination, 'warning');
    }
    if (exifResult.repair) {
      mediaRepairResults.push(exifResult.repair);
      emitMaterializeProgress(onProgress, materialized.length, totalWork, `${exifResult.repair.repaired ? 'Repaired' : 'Repair failed for'} ${path.basename(destination)}`, destination, exifResult.repair.repaired ? 'repaired' : 'repair-failed');
    }
    await setFilesystemDates(destination, match.takenAt);
    materialized.push({ ...match, source: 'zip-media', mergedPath: destination, exifWarning: exifResult.warning || null, repair: exifResult.repair || null });
    emitMaterializeProgress(onProgress, materialized.length, totalWork, `Merged ${path.basename(destination)} (${index + 1} of ${matchedDirect.length})`, destination, 'merged');
  }

  const downloadable = metadataEntries.filter((entry) => !usedMetadata.has(entry) && findDownloadUrl(entry));
  totalWork = matchedDirect.length + downloadable.length;
  for (const entry of downloadable) {
    const downloadUrl = findDownloadUrl(entry);
    const filename = filenameForMetadata(entry, downloadUrl);
    const matchName = outputFilenameForMatch(metadataMatchFromEntry(filename, entry, 'download-link'), filename);
    const destination = await uniqueDestination(path.join(mergedDir, matchName));
    try {
      emitMaterializeProgress(onProgress, materialized.length + skippedDownloads.length, totalWork, `Downloading ${filename} as ${path.basename(destination)}`, downloadUrl, 'downloading');
      const downloadedPath = await downloadMedia(downloadUrl, destination);
      const match = metadataMatchFromEntry(downloadedPath, entry, 'download-link');
      emitMaterializeProgress(onProgress, materialized.length + skippedDownloads.length, totalWork, `Writing metadata to ${path.basename(downloadedPath)}`, downloadedPath, 'writing-exif');
      const exifResult = await tryWriteExif(downloadedPath, match);
      if (exifResult.warning) exifWriteWarnings.push(exifResult.warning);
      if (exifResult.repair) mediaRepairResults.push(exifResult.repair);
      await setFilesystemDates(downloadedPath, match.takenAt);
      materialized.push({ ...match, source: 'download-link', mergedPath: downloadedPath, exifWarning: exifResult.warning || null, repair: exifResult.repair || null });
    } catch (error) {
      skippedDownloads.push({
        url: downloadUrl,
        reason: error?.message || String(error),
        sourceFile: entry._sourceFile || null
      });
      emitMaterializeProgress(onProgress, materialized.length + skippedDownloads.length, totalWork, `Skipped failed download ${filename}`, downloadUrl, 'skipped-download');
    }
    emitMaterializeProgress(onProgress, materialized.length + skippedDownloads.length, totalWork, `Prepared ${materialized.length + skippedDownloads.length} of ${totalWork}`, filename, 'merged');
  }

  materialized.skippedDownloads = skippedDownloads;
  materialized.exifWriteWarnings = exifWriteWarnings;
  materialized.mediaRepairResults = mediaRepairResults;
  return materialized;
}

function emitMaterializeProgress(onProgress, complete, total, message, subject, action) {
  onProgress(complete, total, {
    action,
    message,
    subject,
    fileName: subject && typeof subject === 'string' ? path.basename(subject) : null
  });
}

function outputFilenameForMatch(match, fallbackName) {
  const extension = normalizedMediaExtension(fallbackName || match.file);
  if (!match.takenAt) return sanitizeFilename(fallbackName || `snapchat-memory${extension}`);
  return `${formatFilenameDate(match.takenAt)}_snapchat-memory${extension}`;
}

function normalizedMediaExtension(file) {
  const value = String(file || '');
  const extension = (value.startsWith('.') && !value.slice(1).includes('.'))
    ? value.toLowerCase()
    : path.extname(value).toLowerCase();
  return MEDIA_EXTENSIONS.has(extension) ? extension : '.jpg';
}

function formatFilenameDate(date) {
  const pad = (value) => String(value).padStart(2, '0');
  return [
    date.getUTCFullYear(),
    pad(date.getUTCMonth() + 1),
    pad(date.getUTCDate())
  ].join('-') + `_${pad(date.getUTCHours())}-${pad(date.getUTCMinutes())}-${pad(date.getUTCSeconds())}`;
}

function sanitizeFilename(filename) {
  const parsed = path.parse(path.basename(filename || 'snapchat-memory.jpg'));
  const name = parsed.name
    .replace(/[^a-z0-9._-]+/gi, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '') || 'snapchat-memory';
  const extension = normalizedMediaExtension(parsed.ext || filename);
  return `${name}${extension}`;
}

async function setFilesystemDates(file, date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return;
  await fs.utimes(file, date, date).catch(() => {});
  if (process.platform !== 'darwin' || !fss.existsSync('/usr/bin/SetFile')) return;
  await execFileAsync('/usr/bin/SetFile', ['-d', formatSetFileDate(date), '-m', formatSetFileDate(date), file], {
    timeout: 5000,
    maxBuffer: 1024 * 64
  }).catch(() => {});
}

function formatSetFileDate(date) {
  const pad = (value) => String(value).padStart(2, '0');
  return [
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    date.getFullYear()
  ].join('/') + ` ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

async function loadMetadataEntries(files) {
  const metadataFiles = files.filter((file) => ['.json', '.csv', '.html', '.htm'].includes(path.extname(file).toLowerCase()));
  const entries = [];
  for (const file of metadataFiles) {
    try {
      const extension = path.extname(file).toLowerCase();
      if (extension === '.json') {
        const payload = JSON.parse(await fs.readFile(file, 'utf8'));
        for (const entry of flattenJsonRecords(payload)) entries.push({ ...entry, _sourceFile: file });
      } else if (extension === '.csv') {
        const rows = parseCsv(await fs.readFile(file, 'utf8'));
        for (const row of rows) entries.push({ ...row, _sourceFile: file });
      } else {
        for (const entry of parseHtmlRecords(await fs.readFile(file, 'utf8'), file)) entries.push(entry);
      }
    } catch {
      // Snapchat exports include files unrelated to Memories. Ignore parser misses.
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
    matches.push(metadataMatchFromEntry(file, metadata, byHash.has(sha) ? 'sha256' : byName.has(name) ? 'filename' : byStem.has(stem) ? 'stem' : 'none'));
  }
  matchSnapchatMemoriesByDate(matches, metadataEntries);
  return matches;
}

function matchSnapchatMemoriesByDate(matches, metadataEntries) {
  const metadataByDateAndType = new Map();
  const matchedMetadata = new Set(matches.filter((match) => match.metadata).map((match) => match.metadata));

  for (const entry of metadataEntries) {
    if (matchedMetadata.has(entry)) continue;
    const takenAt = findDatetime(entry);
    const mediaType = normalizedMediaType(entry);
    if (!takenAt || !mediaType) continue;
    const key = `${dateKey(takenAt)}|${mediaType}`;
    if (!metadataByDateAndType.has(key)) metadataByDateAndType.set(key, []);
    metadataByDateAndType.get(key).push(entry);
  }

  for (const entries of metadataByDateAndType.values()) {
    entries.sort((left, right) => findDatetime(left) - findDatetime(right));
  }

  const snapchatMemoryMatches = matches
    .filter((match) => !match.metadata && isPrimarySnapchatMemoryFile(match.file))
    .sort((left, right) => path.basename(left.file).localeCompare(path.basename(right.file)));

  for (const match of snapchatMemoryMatches) {
    const key = `${snapchatDateFromFilename(match.file)}|${mediaTypeFromExtension(match.file)}`;
    const candidates = metadataByDateAndType.get(key);
    if (!candidates?.length) continue;
    const metadata = candidates.shift();
    Object.assign(match, metadataMatchFromEntry(match.file, metadata, 'snapchat-date-media-order'));
  }
}

function metadataMatchFromEntry(file, metadata, matchedBy) {
  const metadataDate = metadata ? findDatetime(metadata) : null;
  const filenameDate = metadataDate ? null : findDatetimeInFilename(file);
  const dateRecovery = metadataDate
    ? { source: 'metadata', confidence: 1, reason: 'Snapchat metadata date matched this media item.' }
    : filenameDate
      ? { source: 'filename', confidence: 0.82, reason: 'No Snapchat date was present, so the date was recovered from the media filename.' }
      : { source: null, confidence: 0, reason: 'No reliable date source was found.' };
  return {
    file,
    metadata,
    matchedBy,
    takenAt: metadataDate || filenameDate,
    dateSource: dateRecovery.source,
    dateConfidence: dateRecovery.confidence,
    dateRecovery,
    latitude: metadata ? findFloat(metadata, LAT_KEYS) : null,
    longitude: metadata ? findFloat(metadata, LON_KEYS) : null
  };
}

function buildAlbumPlan(media, { maxPreviewItems = 8 } = {}) {
  const groups = new Map();
  for (const item of media || []) {
    if (!(item.takenAt instanceof Date) || Number.isNaN(item.takenAt.getTime())) continue;
    const key = `${item.takenAt.getUTCFullYear()}-${String(item.takenAt.getUTCMonth() + 1).padStart(2, '0')}`;
    if (!groups.has(key)) {
      groups.set(key, {
        key,
        title: `Snapchat Memories ${key}`,
        year: item.takenAt.getUTCFullYear(),
        month: item.takenAt.getUTCMonth() + 1,
        count: 0,
        files: []
      });
    }
    const group = groups.get(key);
    group.count += 1;
    if (group.files.length < maxPreviewItems) group.files.push(path.basename(item.mergedPath || item.file || 'memory'));
  }
  return [...groups.values()].sort((left, right) => left.key.localeCompare(right.key));
}

function calculateRiskScore({ verification = {}, skippedDownloadLinks = [], exifWriteWarnings = [], mediaRepairResults = [] }) {
  const total = Math.max(verification.total || 0, 1);
  const missingDates = (verification.issueFiles || []).filter((item) => item?.type === 'missing-date').length;
  const unreadable = verification.unreadableFiles || 0;
  const missingFiles = verification.missingFiles || 0;
  const duplicates = verification.duplicateFiles || 0;
  const damaged = mediaRepairResults.filter((item) => item.repaired === false).length;
  const dateCoverage = (verification.withDate || 0) / total;
  const gpsCoverage = (verification.withGps || 0) / total;
  const filenameRecovered = (verification.metadataComparisons || []).filter((item) => item.dateSource === 'filename').length;

  const penalties = [
    { label: 'Missing files', value: missingFiles, weight: 26 },
    { label: 'Unreadable files', value: unreadable, weight: 22 },
    { label: 'Missing dates', value: missingDates, weight: 18 },
    { label: 'Skipped Snapchat links', value: skippedDownloadLinks.length, weight: 12 },
    { label: 'EXIF warnings', value: exifWriteWarnings.length + (verification.warnings?.length || 0), weight: 12 },
    { label: 'Damaged videos', value: damaged, weight: 10 },
    { label: 'Exact duplicates', value: duplicates, weight: 8 }
  ];

  const activeFactors = penalties.filter((item) => item.value > 0);
  let score = 100;
  for (const item of penalties) {
    score -= Math.min(item.weight, (item.value / total) * item.weight * 8);
  }
  score -= Math.max(0, 1 - dateCoverage) * 30;
  score -= Math.max(0, 0.5 - gpsCoverage) * 10;
  score = Math.max(0, Math.min(100, Math.round(score)));
  if (activeFactors.length) score = Math.min(score, 98);

  return {
    score,
    level: score >= 90 ? 'excellent' : score >= 80 ? 'good' : score >= 55 ? 'review' : 'blocked',
    dateCoverage: Math.round(dateCoverage * 100),
    gpsCoverage: Math.round(gpsCoverage * 100),
    filenameRecovered,
    factors: activeFactors
  };
}

async function writeExif(file, match) {
  const tags = {};
  if (match.takenAt) {
    const exifDate = formatExifDate(match.takenAt);
    tags.DateTimeOriginal = exifDate;
    tags.CreateDate = exifDate;
    tags.ModifyDate = exifDate;
    tags['XMP:DateCreated'] = match.takenAt.toISOString();
  }
  if (Number.isFinite(match.latitude) && Number.isFinite(match.longitude)) {
    tags.GPSLatitude = match.latitude;
    tags.GPSLongitude = match.longitude;
  }
  if (Object.keys(tags).length) await exiftool.write(file, tags, ['-overwrite_original']);
}

async function tryWriteExif(file, match) {
  try {
    await writeExif(file, match);
    return {};
  } catch (error) {
    const firstError = error?.message || String(error);
    const repair = await repairMediaForExif(file, firstError);
    if (repair.repaired) {
      try {
        await writeExif(file, match);
        return { repair };
      } catch (retryError) {
        return {
          repair,
          warning: {
            fileName: path.basename(file),
            path: file,
            reason: retryError?.message || String(retryError),
            repairStatus: 'repaired-but-exif-retry-failed',
            originalReason: firstError
          }
        };
      }
    }

    return {
      repair,
      warning: {
        fileName: path.basename(file),
        path: file,
        reason: firstError,
        repairStatus: repair.status,
        repairReason: repair.reason || null
      }
    };
  }
}

async function repairMediaForExif(file, originalReason = '') {
  if (!isVideoFile(file)) {
    return {
      fileName: path.basename(file),
      path: file,
      repaired: false,
      status: 'unsupported-media-type',
      reason: originalReason
    };
  }

  const ffmpegPath = resolveFfmpegPath();
  if (!ffmpegPath) {
    return {
      fileName: path.basename(file),
      path: file,
      repaired: false,
      status: 'ffmpeg-unavailable',
      reason: 'Bundled ffmpeg binary is not available.'
    };
  }

  const parsed = path.parse(file);
  const repairedPath = path.join(parsed.dir, `${parsed.name}.repair-${crypto.randomUUID()}${parsed.ext}`);
  try {
    await execFileAsync(ffmpegPath, [
      '-y',
      '-hide_banner',
      '-loglevel', 'error',
      '-err_detect', 'ignore_err',
      '-i', file,
      '-map', '0',
      '-c', 'copy',
      '-movflags', '+faststart',
      repairedPath
    ], { maxBuffer: 1024 * 1024 * 8, timeout: 30_000 });

    const stats = await fs.stat(repairedPath);
    if (!stats.size) throw new Error('ffmpeg produced an empty repaired file.');
    await fs.copyFile(repairedPath, file);
    return {
      fileName: path.basename(file),
      path: file,
      repaired: true,
      status: 'remuxed-video-container',
      reason: originalReason
    };
  } catch (error) {
    return {
      fileName: path.basename(file),
      path: file,
      repaired: false,
      status: 'repair-failed',
      reason: error?.stderr || error?.message || String(error),
      originalReason
    };
  } finally {
    await fs.rm(repairedPath, { force: true }).catch(() => {});
  }
}

function resolveFfmpegPath() {
  if (!ffmpegStaticPath) return null;
  const unpackedPath = ffmpegStaticPath.replace(`${path.sep}app.asar${path.sep}`, `${path.sep}app.asar.unpacked${path.sep}`);
  if (fss.existsSync(unpackedPath)) return unpackedPath;
  return fss.existsSync(ffmpegStaticPath) ? ffmpegStaticPath : null;
}

function isVideoFile(file) {
  return ['.3g2', '.3gp', '.m4v', '.mov', '.mp4'].includes(path.extname(file).toLowerCase());
}

function formatExifDate(date) {
  const pad = (value) => String(value).padStart(2, '0');
  return [
    date.getUTCFullYear(),
    pad(date.getUTCMonth() + 1),
    pad(date.getUTCDate())
  ].join(':') + ` ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}`;
}

function parseExifDateValue(value) {
  if (!value) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  const raw = typeof value === 'object' && value.rawValue ? value.rawValue : String(value);
  const normalized = raw
    .replace(/^(\d{4}):(\d{2}):(\d{2})/, '$1-$2-$3')
    .replace(/\.000Z$/, 'Z')
    .replace(/\s+/, 'T');
  const parsed = new Date(normalized.endsWith('Z') || /[+-]\d{2}:?\d{2}$/.test(normalized) ? normalized : `${normalized}Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function issueRecord(item, type, reason) {
  return {
    type,
    reason,
    fileName: item?.mergedPath ? path.basename(item.mergedPath) : item?.file ? path.basename(item.file) : null,
    path: item?.mergedPath || item?.file || null,
    source: item?.source || null,
    matchedBy: item?.matchedBy || null
  };
}

function renderImportSummaryHtml({ media, verification, report }) {
  const timeline = verification.timeline || {};
  const issueRows = (verification.issueFiles || []).slice(0, 250)
    .map((item) => `<tr><td>${escapeHtml(item.type)}</td><td>${escapeHtml(item.fileName || '')}</td><td>${escapeHtml(item.reason || '')}</td></tr>`)
    .join('');
  const yearRows = Object.entries(timeline.byYear || {})
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([year, count]) => `<tr><td>${escapeHtml(year)}</td><td>${count}</td></tr>`)
    .join('');
  const duplicateRows = (timeline.duplicateTimestamps || []).slice(0, 100)
    .map((item) => `<tr><td>${escapeHtml(item.timestamp)}</td><td>${item.count}</td><td>${escapeHtml(item.files.join(', '))}</td></tr>`)
    .join('');
  const duplicateFileRows = (verification.duplicateFileGroups || []).slice(0, 100)
    .map((item) => `<tr><td>${escapeHtml(item.keeper.fileName)}</td><td>${item.duplicateCount}</td><td>${escapeHtml(item.duplicates.map((file) => file.fileName).join(', '))}</td></tr>`)
    .join('');
  const metadataRows = (verification.metadataComparisons || []).slice(0, 50)
    .map((item) => `<tr><td>${escapeHtml(item.fileName)}</td><td>${escapeHtml(item.snapchat?.date || 'Missing')}</td><td>${escapeHtml(item.mergedEmbedded?.date || 'Missing')}</td><td>${escapeHtml(item.status?.date || 'unknown')}</td><td>${escapeHtml(formatSummaryGps(item.snapchat?.latitude, item.snapchat?.longitude))}</td><td>${escapeHtml(formatSummaryGps(item.mergedEmbedded?.latitude, item.mergedEmbedded?.longitude))}</td><td>${escapeHtml(item.status?.gps || 'unknown')}</td></tr>`)
    .join('');

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Snapchat Import Summary</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 32px; color: #201f1d; background: #fbfaf7; }
    h1, h2 { margin-bottom: 8px; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 12px; margin: 20px 0; }
    .card { border: 1px solid #ded8ce; border-radius: 8px; background: #fff; padding: 14px; }
    .value { display: block; font-size: 28px; font-weight: 800; }
    table { width: 100%; border-collapse: collapse; background: #fff; margin: 12px 0 28px; }
    th, td { border-bottom: 1px solid #eee8df; padding: 9px; text-align: left; vertical-align: top; overflow-wrap: anywhere; }
    th { background: #f7f3ed; }
  </style>
</head>
<body>
  <h1>Snapchat Import Summary</h1>
  <p>Generated ${escapeHtml(new Date().toISOString())}</p>
  <div class="grid">
    <div class="card"><span class="value">${verification.total}</span>Merged files</div>
    <div class="card"><span class="value">${verification.withDate}</span>With date</div>
    <div class="card"><span class="value">${verification.withGps}</span>With GPS</div>
    <div class="card"><span class="value">${verification.issueFiles?.length || 0}</span>Review issues</div>
    <div class="card"><span class="value">${report.counts?.damagedVideos || 0}</span>Damaged copies</div>
    <div class="card"><span class="value">${timeline.duplicateTimestamps?.length || 0}</span>Duplicate timestamps</div>
    <div class="card"><span class="value">${verification.duplicateFiles || 0}</span>Exact duplicate files</div>
  </div>
  <h2>Date Range</h2>
  <p>${escapeHtml(timeline.oldest || 'Unknown')} to ${escapeHtml(timeline.newest || 'Unknown')}</p>
  <h2>Files By Year</h2>
  <table><thead><tr><th>Year</th><th>Files</th></tr></thead><tbody>${yearRows || '<tr><td colspan="2">No dated files</td></tr>'}</tbody></table>
  <h2>Duplicate Timestamps</h2>
  <table><thead><tr><th>Timestamp</th><th>Count</th><th>Sample files</th></tr></thead><tbody>${duplicateRows || '<tr><td colspan="3">No duplicate timestamps detected</td></tr>'}</tbody></table>
  <h2>Exact Duplicate Files</h2>
  <table><thead><tr><th>Kept file</th><th>Duplicate candidates</th><th>Files safe to remove after review</th></tr></thead><tbody>${duplicateFileRows || '<tr><td colspan="3">No exact duplicate files detected</td></tr>'}</tbody></table>
  <h2>Metadata Inspector Sample</h2>
  <table><thead><tr><th>File</th><th>Snapchat date</th><th>Merged date</th><th>Date result</th><th>Snapchat GPS</th><th>Merged GPS</th><th>GPS result</th></tr></thead><tbody>${metadataRows || '<tr><td colspan="7">No metadata sample available</td></tr>'}</tbody></table>
  <h2>Needs Review</h2>
  <table><thead><tr><th>Type</th><th>File</th><th>Reason</th></tr></thead><tbody>${issueRows || '<tr><td colspan="3">No review issues detected</td></tr>'}</tbody></table>
  <p>Total copied media checked: ${media.length}</p>
</body>
</html>`;
}

function formatSummaryGps(latitude, longitude) {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return 'Missing';
  return `${latitude.toFixed(6)}, ${longitude.toFixed(6)}`;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

async function downloadMedia(url, destination) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not download Snapchat media: ${response.status} ${url}`);
  const contentType = response.headers.get('content-type');
  if (contentType && !/^image\//i.test(contentType) && !/^video\//i.test(contentType) && !/octet-stream/i.test(contentType)) {
    throw new Error(`Download URL did not return media content: ${contentType} ${url}`);
  }
  let output = destination;
  if (!MEDIA_EXTENSIONS.has(path.extname(output).toLowerCase())) {
    const extension = mime.extension(contentType || '') || 'jpg';
    output = `${destination}.${extension}`;
  }
  await pipeline(Readable.fromWeb(response.body), fss.createWriteStream(output));
  return output;
}

function findDownloadUrl(entry) {
  for (const [key, value] of walkScalars(entry)) {
    if (typeof value !== 'string') continue;
    if (!/(download|url|link)/i.test(key)) continue;
    const url = value.trim();
    if (/^https?:\/\//i.test(url) && isLikelyMediaDownloadUrl(url, key)) return url;
  }
  return null;
}

function isLikelyMediaDownloadUrl(value, key = '') {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }

  const hostname = parsed.hostname.toLowerCase();
  const pathname = decodeURIComponent(parsed.pathname).toLowerCase();
  const search = parsed.search.toLowerCase();
  if (hostname === 'help.snapchat.com' || hostname === 'support.snapchat.com') return false;
  if ((hostname === 'snap.com' || hostname.endsWith('.snap.com')) && /\/privacy\//i.test(pathname)) return false;
  if (/\/hc\/(requests|articles)\//i.test(pathname)) return false;
  if (/(^|[?&])utm_medium=missing(&|$)/i.test(search)) return false;

  const extension = path.extname(pathname);
  if (MEDIA_EXTENSIONS.has(extension)) return true;
  if (/download/i.test(key) && !/(help|support|request|missing|faq|contact)/i.test(`${hostname}${pathname}${search}`)) return true;
  return false;
}

function filenameForMetadata(entry, downloadUrl) {
  for (const token of candidateFileTokens(entry)) {
    const filename = normalizeFileToken(token);
    if (filename && MEDIA_EXTENSIONS.has(path.extname(filename).toLowerCase())) return filename;
  }
  const parsed = new URL(downloadUrl);
  const urlName = path.basename(decodeURIComponent(parsed.pathname));
  if (urlName && urlName !== '/') return urlName;
  const takenAt = findDatetime(entry);
  return `${takenAt ? takenAt.toISOString().replace(/[:.]/g, '-') : crypto.randomUUID()}.jpg`;
}

function parseHtmlRecords(html, sourceFile) {
  const records = [];
  const anchorPattern = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = anchorPattern.exec(html))) {
    const href = decodeHtml(match[1]);
    const text = stripTags(match[2]).trim();
    if (!/^https?:\/\//i.test(href)) continue;
    records.push({
      Date: text,
      'Download Link': href,
      _sourceFile: sourceFile
    });
  }
  return records;
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
  const scalarKeys = Object.entries(value)
    .filter(([, nested]) => nested === null || ['string', 'number', 'boolean'].includes(typeof nested))
    .map(([key]) => key.toLowerCase());
  return scalarKeys.some((key) => [...DATE_KEYS, ...FILE_KEYS, ...LAT_KEYS, ...LON_KEYS].some((hint) => key.includes(hint)));
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

function findDatetimeInFilename(file) {
  const name = path.basename(String(file || ''));
  const patterns = [
    /(\d{4})[-_.](\d{2})[-_.](\d{2})[ T_-]?(\d{2})[-_.:]?(\d{2})[-_.:]?(\d{2})/,
    /(\d{4})[-_.](\d{2})[-_.](\d{2})/,
    /(\d{8})[_-]?(\d{6})/,
    /(\d{8})/
  ];

  for (const pattern of patterns) {
    const match = name.match(pattern);
    if (!match) continue;
    const parsed = parseFilenameDateMatch(match);
    if (parsed) return parsed;
  }
  return null;
}

function parseFilenameDateMatch(match) {
  let year;
  let month;
  let day;
  let hour = '00';
  let minute = '00';
  let second = '00';

  if (match[1]?.length === 8) {
    year = match[1].slice(0, 4);
    month = match[1].slice(4, 6);
    day = match[1].slice(6, 8);
    if (match[2]?.length === 6) {
      hour = match[2].slice(0, 2);
      minute = match[2].slice(2, 4);
      second = match[2].slice(4, 6);
    }
  } else {
    [, year, month, day, hour = '00', minute = '00', second = '00'] = match;
  }

  const parsed = new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}Z`);
  if (Number.isNaN(parsed.getTime())) return null;
  if (parsed.getUTCFullYear() < 2000 || parsed.getUTCFullYear() > new Date().getUTCFullYear() + 1) return null;
  return parsed;
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
  const location = findLocationPair(entry);
  if (!location) return null;
  return hints.some((hint) => hint === 'latitude' || hint === 'lat') ? location.latitude : location.longitude;
}

function findLocationPair(entry) {
  for (const [key, value] of walkScalars(entry)) {
    if (!/location|coordinate|gps/i.test(key) || typeof value !== 'string') continue;
    const match = value.match(/(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/);
    if (!match) continue;
    const latitude = Number.parseFloat(match[1]);
    const longitude = Number.parseFloat(match[2]);
    if (Number.isFinite(latitude) && Number.isFinite(longitude)) return { latitude, longitude };
  }
  return null;
}

function isPrimarySnapchatMemoryFile(file) {
  const parent = path.basename(path.dirname(file)).toLowerCase();
  return parent === 'memories' && /_\w[\w-]*-main\.[^.]+$/i.test(path.basename(file));
}

function snapchatDateFromFilename(file) {
  return path.basename(file).match(/^(\d{4}-\d{2}-\d{2})_/)?.[1] || null;
}

function mediaTypeFromExtension(file) {
  const extension = path.extname(file).toLowerCase();
  if (['.mp4', '.mov', '.m4v', '.3gp', '.3g2'].includes(extension)) return 'video';
  if (MEDIA_EXTENSIONS.has(extension)) return 'image';
  return null;
}

function normalizedMediaType(entry) {
  for (const [key, value] of walkScalars(entry)) {
    if (!/media.*type|type/i.test(key) || typeof value !== 'string') continue;
    if (/video/i.test(value)) return 'video';
    if (/image|photo|picture/i.test(value)) return 'image';
  }
  return null;
}

function dateKey(date) {
  return [
    date.getUTCFullYear(),
    String(date.getUTCMonth() + 1).padStart(2, '0'),
    String(date.getUTCDate()).padStart(2, '0')
  ].join('-');
}

function walkScalars(value, prefix = '') {
  if (Array.isArray(value)) return value.flatMap((item, index) => walkScalars(item, `${prefix}[${index}]`));
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

function stripTags(value) {
  return value.replace(/<[^>]+>/g, ' ');
}

function decodeHtml(value) {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
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

module.exports = {
  MEDIA_EXTENSIONS,
  prepareMergedMedia,
  verifyMergedMedia,
  createReviewArtifacts,
  calculateRiskScore,
  buildAlbumPlan,
  materializeMedia,
  loadMetadataEntries,
  buildMatches,
  writeExif,
  findDatetime,
  findDownloadUrl,
  isLikelyMediaDownloadUrl,
  walkFiles
};
