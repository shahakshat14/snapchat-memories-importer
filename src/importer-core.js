const path = require('node:path');
const fs = require('node:fs/promises');
const fss = require('node:fs');
const crypto = require('node:crypto');
const { pipeline } = require('node:stream/promises');
const { Readable } = require('node:stream');
const { exiftool } = require('exiftool-vendored');
const mime = require('mime-types');

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
    media
  };
}

async function verifyMergedMedia(media, sampleSize = 25) {
  const sample = [];
  let withDate = 0;
  let withGps = 0;
  let missingFiles = 0;
  const sourceCounts = {};

  for (const item of media) {
    sourceCounts[item.source] = (sourceCounts[item.source] || 0) + 1;
    if (!fss.existsSync(item.mergedPath)) {
      missingFiles += 1;
      continue;
    }

    const tags = await exiftool.read(item.mergedPath);
    const hasDate = Boolean(tags.DateTimeOriginal?.rawValue || tags.DateCreated?.rawValue);
    const hasGps = Number.isFinite(Number(tags.GPSLatitude)) && Number.isFinite(Number(tags.GPSLongitude));
    if (hasDate) withDate += 1;
    if (hasGps) withGps += 1;

    if (sample.length < sampleSize) {
      sample.push({
        fileName: path.basename(item.mergedPath),
        source: item.source,
        matchedBy: item.matchedBy,
        date: tags.DateTimeOriginal?.rawValue || tags.DateCreated?.rawValue || null,
        latitude: Number.isFinite(Number(tags.GPSLatitude)) ? Number(tags.GPSLatitude) : null,
        longitude: Number.isFinite(Number(tags.GPSLongitude)) ? Number(tags.GPSLongitude) : null,
        path: item.mergedPath
      });
    }
  }

  return {
    total: media.length,
    withDate,
    withGps,
    missingFiles,
    sourceCounts,
    sample
  };
}

async function materializeMedia(directMatches, metadataEntries, mergedDir, onProgress = () => {}) {
  await fs.mkdir(mergedDir, { recursive: true });
  const usedMetadata = new Set();
  const materialized = [];
  const matchedDirect = directMatches.filter((match) => match.metadata);

  for (const match of matchedDirect) {
    usedMetadata.add(match.metadata);
    const destination = await uniqueDestination(path.join(mergedDir, path.basename(match.file)));
    await fs.copyFile(match.file, destination);
    await writeExif(destination, match);
    materialized.push({ ...match, source: 'zip-media', mergedPath: destination });
    onProgress(materialized.length, matchedDirect.length);
  }

  const downloadable = metadataEntries.filter((entry) => !usedMetadata.has(entry) && findDownloadUrl(entry));
  for (const entry of downloadable) {
    const downloadUrl = findDownloadUrl(entry);
    const filename = filenameForMetadata(entry, downloadUrl);
    const destination = await uniqueDestination(path.join(mergedDir, filename));
    const downloadedPath = await downloadMedia(downloadUrl, destination);
    const match = metadataMatchFromEntry(downloadedPath, entry, 'download-link');
    await writeExif(downloadedPath, match);
    materialized.push({ ...match, source: 'download-link', mergedPath: downloadedPath });
    onProgress(materialized.length, matchedDirect.length + downloadable.length);
  }

  return materialized;
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
  return matches;
}

function metadataMatchFromEntry(file, metadata, matchedBy) {
  return {
    file,
    metadata,
    matchedBy,
    takenAt: metadata ? findDatetime(metadata) : null,
    latitude: metadata ? findFloat(metadata, LAT_KEYS) : null,
    longitude: metadata ? findFloat(metadata, LON_KEYS) : null
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

function formatExifDate(date) {
  const pad = (value) => String(value).padStart(2, '0');
  return [
    date.getUTCFullYear(),
    pad(date.getUTCMonth() + 1),
    pad(date.getUTCDate())
  ].join(':') + ` ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}`;
}

async function downloadMedia(url, destination) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not download Snapchat media: ${response.status} ${url}`);
  const contentType = response.headers.get('content-type');
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
    if (/^https?:\/\//i.test(value.trim())) return value.trim();
  }
  return null;
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
  materializeMedia,
  loadMetadataEntries,
  buildMatches,
  writeExif,
  findDatetime,
  findDownloadUrl,
  walkFiles
};
