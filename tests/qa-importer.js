const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs/promises');
const fss = require('node:fs');
const os = require('node:os');
const http = require('node:http');
const { execFileSync } = require('node:child_process');
const extractZip = require('extract-zip');
const { exiftool } = require('exiftool-vendored');
const importer = require('../src/importer-core');
const mainProcess = require('../src/main');

const SAMPLE_JPEG_BASE64 =
  '/9j/4AAQSkZJRgABAQAAAQABAAD/2wCEAAkGBxAQEBAQDxAQDw8QDw8PDw8PDw8QDw8QFREWFhURFRUYHSggGBolGxUVITEhJSkrLi4uFx8zODMtNygtLisBCgoKDg0OGxAQGi0lHyUtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLf/AABEIAAEAAQMBIgACEQEDEQH/xAAWAAEBAQAAAAAAAAAAAAAAAAAAAQf/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAH/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAEFAqf/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAEDAQE/ASP/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAECAQE/ASP/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAY/Al//xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAE/IV//2gAMAwEAAgADAAAAEP/EFBQRAQAAAAAAAAAAAAAAAAAAARD/2gAIAQMBAT8QH//EFBQRAQAAAAAAAAAAAAAAAAAAARD/2gAIAQIBAT8QH//EFBABAQAAAAAAAAAAAAAAAAAAARD/2gAIAQEAAT8QH//Z';

async function main() {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'snapchat-importer-qa-'));
  try {
    await testZipWithEmbeddedMedia(tempRoot);
    await testZipWithDownloadLinks(tempRoot);
    await testFailedMediaDownloadIsSkipped(tempRoot);
    await testSnapchatMemoryDateFallback(tempRoot);
    await testReadableFilenameCollisions(tempRoot);
    await testDamagedVideoRepairIsReported(tempRoot);
    await testMultipleMyDataZips(tempRoot);
    console.log('QA importer tests passed');
  } finally {
    await exiftool.end();
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
}

async function testReadableFilenameCollisions(tempRoot) {
  const fixture = path.join(tempRoot, 'readable-filename-collisions');
  const source = path.join(fixture, 'source');
  const extractDir = path.join(fixture, 'extract');
  const mergedDir = path.join(fixture, 'merged');
  await fs.mkdir(path.join(source, 'memories'), { recursive: true });
  await fs.mkdir(path.join(source, 'json'), { recursive: true });

  await writeSampleJpeg(path.join(source, 'memories', 'burst-a.jpg'));
  await writeSampleJpeg(path.join(source, 'memories', 'burst-b.jpg'));
  await fs.writeFile(
    path.join(source, 'json', 'memories_history.json'),
    JSON.stringify([
      { Date: '2024-02-03T04:05:06.000Z', 'File Name': 'burst-a.jpg' },
      { Date: '2024-02-03T04:05:06.000Z', 'File Name': 'burst-b.jpg' }
    ])
  );

  const zipPath = await zipFixture(source, path.join(fixture, 'snapchat-readable-names.zip'));
  await fs.mkdir(extractDir, { recursive: true });
  await extractZip(zipPath, { dir: extractDir });
  const result = await importer.prepareMergedMedia({ extractedDir: extractDir, mergedDir });
  const names = result.media.map((item) => path.basename(item.mergedPath)).sort();

  assert.deepEqual(names, [
    '2024-02-03_04-05-06_snapchat-memory-2.jpg',
    '2024-02-03_04-05-06_snapchat-memory.jpg'
  ]);
}

async function testDamagedVideoRepairIsReported(tempRoot) {
  const fixture = path.join(tempRoot, 'damaged-video');
  const source = path.join(fixture, 'source');
  const extractDir = path.join(fixture, 'extract');
  const mergedDir = path.join(fixture, 'merged');
  await fs.mkdir(path.join(source, 'memories'), { recursive: true });
  await fs.mkdir(path.join(source, 'json'), { recursive: true });

  await fs.writeFile(path.join(source, 'memories', '2025-01-02_DAMAGED-main.mp4'), Buffer.from('not a valid mp4'));
  await fs.writeFile(
    path.join(source, 'json', 'memories_history.json'),
    JSON.stringify({
      'Saved Media': [
        {
          Date: '2025-01-02 03:04:05 UTC',
          'Media Type': 'Video',
          Location: 'Latitude, Longitude: 43.1, -79.2',
          'Download Link': '',
          'Media Download Url': ''
        }
      ]
    })
  );

  const zipPath = await zipFixture(source, path.join(fixture, 'snapchat-damaged-video.zip'));
  await fs.mkdir(extractDir, { recursive: true });
  await extractZip(zipPath, { dir: extractDir });
  const result = await importer.prepareMergedMedia({ extractedDir: extractDir, mergedDir });
  const verification = await importer.verifyMergedMedia(result.media, 10);
  const review = await importer.createReviewArtifacts({
    mergedDir,
    media: result.media,
    verification,
    skippedDownloadLinks: result.skippedDownloads,
    exifWriteWarnings: result.media.exifWriteWarnings,
    mediaRepairResults: result.media.mediaRepairResults
  });

  assert.equal(result.media.length, 1, 'damaged videos should still be copied into the preview output');
  assert.equal(result.media.exifWriteWarnings.length, 1, 'damaged videos should report EXIF repair/write warnings without aborting preview');
  assert.equal(result.media.mediaRepairResults.length, 1, 'damaged videos should run through the automatic repair path');
  assert.equal(result.media.mediaRepairResults[0].repaired, false, 'unrepairable fake video should be marked as not repaired');
  assert.match(result.media.exifWriteWarnings[0].repairStatus, /repair-failed|ffmpeg-unavailable/);
  assert.equal(review.counts.damagedVideos, 1, 'damaged videos should be copied into Needs Review');
  assert.ok(fss.existsSync(path.join(mergedDir, '_Needs Review', 'review-report.json')), 'review report should be written for damaged media');
  assert.ok(fss.existsSync(path.join(mergedDir, 'Import Summary.html')), 'human-readable import summary should be written');
}

async function testSnapchatMemoryDateFallback(tempRoot) {
  const fixture = path.join(tempRoot, 'snapchat-memory-date-fallback');
  const source = path.join(fixture, 'source');
  const extractDir = path.join(fixture, 'extract');
  const mergedDir = path.join(fixture, 'merged');
  await fs.mkdir(path.join(source, 'memories'), { recursive: true });
  await fs.mkdir(path.join(source, 'json'), { recursive: true });

  await writeSampleJpeg(path.join(source, 'memories', '2025-05-24_F052114D-7BD5-45F1-B64A-180F3A40806D-main.jpg'));
  await writeSampleJpeg(path.join(source, 'memories', '2025-05-24_F052114D-7BD5-45F1-B64A-180F3A40806D-overlay.png'));
  await fs.writeFile(
    path.join(source, 'json', 'memories_history.json'),
    JSON.stringify({
      'Saved Media': [
        {
          Date: '2025-05-24 02:56:57 UTC',
          'Media Type': 'Image',
          Location: 'Latitude, Longitude: 43.72698, -79.45044',
          'Download Link': '',
          'Media Download Url': ''
        }
      ]
    })
  );

  const zipPath = await zipFixture(source, path.join(fixture, 'snapchat-date-fallback.zip'));
  await fs.mkdir(extractDir, { recursive: true });
  await extractZip(zipPath, { dir: extractDir });
  const result = await importer.prepareMergedMedia({ extractedDir: extractDir, mergedDir });
  const verification = await importer.verifyMergedMedia(result.media, 10);

  assert.equal(result.metadataEntries.length, 1, 'Saved Media wrapper should flatten into individual records');
  assert.equal(result.media.length, 1, 'date fallback should merge the primary Snapchat memory file');
  assert.equal(result.media[0].matchedBy, 'snapchat-date-media-order');
  assert.equal(path.basename(result.media[0].mergedPath), '2025-05-24_02-56-57_snapchat-memory.jpg');
  assert.equal(verification.withDate, 1, 'date fallback should write the metadata date');
  assert.equal(verification.withGps, 1, 'date fallback should parse the Snapchat Location string');
  await assertExif(result.media[0].mergedPath, {
    datePrefix: '2025:05:24 02:56:57',
    latitude: 43.72698,
    longitude: -79.45044
  });
}

async function testMultipleMyDataZips(tempRoot) {
  const fixture = path.join(tempRoot, 'multiple-mydata');
  const sourceOne = path.join(fixture, 'source-one', 'mydata');
  const sourceTwo = path.join(fixture, 'source-two', 'mydata');
  const selectedDir = path.join(fixture, 'selected');
  const extractDir = path.join(fixture, 'extract');
  const mergedDir = path.join(fixture, 'merged');
  await fs.mkdir(path.join(sourceOne, 'memories'), { recursive: true });
  await fs.mkdir(path.join(sourceOne, 'json'), { recursive: true });
  await fs.mkdir(path.join(sourceTwo, 'memories'), { recursive: true });
  await fs.mkdir(path.join(sourceTwo, 'json'), { recursive: true });
  await fs.mkdir(selectedDir, { recursive: true });

  await writeSampleJpeg(path.join(sourceOne, 'memories', 'snap-one.jpg'));
  await writeSampleJpeg(path.join(sourceTwo, 'memories', 'snap-two.jpg'));
  await fs.writeFile(path.join(sourceOne, 'index.html'), '<a href="html/memories_history.html">Memories</a>');
  await fs.writeFile(path.join(sourceTwo, 'index.html'), '<a href="html/memories_history.html">Memories</a>');
  await fs.writeFile(
    path.join(sourceOne, 'json', 'memories_history.json'),
    JSON.stringify([{ Date: '2020-01-02T03:04:05.000Z', 'File Name': 'snap-one.jpg' }])
  );
  await fs.writeFile(
    path.join(sourceTwo, 'json', 'memories_history.json'),
    JSON.stringify([{ Date: '2022-03-04T05:06:07.000Z', 'File Name': 'snap-two.jpg' }])
  );

  const firstZip = await zipFixture(path.join(fixture, 'source-one'), path.join(selectedDir, 'mydata.zip'));
  const secondZip = await zipFixture(path.join(fixture, 'source-two'), path.join(selectedDir, 'mydata-1.zip'));
  const zipPaths = await mainProcess.resolveSnapchatZipInputs(selectedDir);
  assert.deepEqual(zipPaths.map((file) => path.basename(file)), [path.basename(firstZip), path.basename(secondZip)], 'folder selection should discover split mydata zips in stable order');
  const multiSelectZipPaths = await mainProcess.resolveSnapchatZipInputs([secondZip, firstZip]);
  assert.deepEqual(multiSelectZipPaths.map((file) => path.basename(file)), [path.basename(firstZip), path.basename(secondZip)], 'multi-select mydata zips should be sorted before extraction');

  await mainProcess.extractSnapchatArchives(zipPaths, extractDir);
  const files = await importer.walkFiles(extractDir);
  assert.equal(files.filter((file) => path.basename(file) === 'memories_history.json').length, 2, 'duplicate Snapchat metadata paths should be preserved');

  const result = await importer.prepareMergedMedia({ extractedDir: extractDir, mergedDir });
  const verification = await importer.verifyMergedMedia(result.media, 10);
  assert.equal(result.media.length, 2, 'multiple mydata zips should merge both archives');
  assert.equal(verification.withDate, 2, 'both split archive dates should be written');
  await assertExif(path.join(mergedDir, '2020-01-02_03-04-05_snapchat-memory.jpg'), { datePrefix: '2020:01:02 03:04:05' });
  await assertExif(path.join(mergedDir, '2022-03-04_05-06-07_snapchat-memory.jpg'), { datePrefix: '2022:03:04 05:06:07' });
}

async function testZipWithEmbeddedMedia(tempRoot) {
  const fixture = path.join(tempRoot, 'embedded');
  const source = path.join(fixture, 'source');
  const extractDir = path.join(fixture, 'extract');
  const mergedDir = path.join(fixture, 'merged');
  await fs.mkdir(path.join(source, 'memories'), { recursive: true });
  await fs.mkdir(path.join(source, 'json'), { recursive: true });

  await writeSampleJpeg(path.join(source, 'memories', 'snap-local.jpg'));
  await fs.writeFile(
    path.join(source, 'json', 'memories_history.json'),
    JSON.stringify({
      Memories: [
        {
          Date: '2024-01-02T03:04:05.000Z',
          'Media Type': 'Image',
          'File Name': 'snap-local.jpg',
          Latitude: '43.6532',
          Longitude: '-79.3832'
        }
      ]
    })
  );

  const zipPath = await zipFixture(source, path.join(fixture, 'snapchat-embedded.zip'));
  await fs.mkdir(extractDir, { recursive: true });
  await extractZip(zipPath, { dir: extractDir });
  const result = await importer.prepareMergedMedia({ extractedDir: extractDir, mergedDir });
  const verification = await importer.verifyMergedMedia(result.media, 10);
  const exportedZip = path.join(fixture, 'merged-export.zip');

  assert.equal(result.media.length, 1, 'embedded zip should produce one merged media file');
  assert.equal(result.media[0].source, 'zip-media');
  assert.equal(verification.total, 1, 'preview verification should see one file');
  assert.equal(verification.withDate, 1, 'preview verification should see embedded date');
  assert.equal(verification.withGps, 1, 'preview verification should see embedded GPS');
  assert.equal(verification.missingFiles, 0, 'preview verification should not have missing files');
  assert.equal(verification.timeline.oldest, '2024-01-02T03:04:05.000Z', 'timeline audit should capture oldest date');
  assert.equal(verification.timeline.newest, '2024-01-02T03:04:05.000Z', 'timeline audit should capture newest date');
  assert.equal(verification.timeline.byYear['2024'], 1, 'timeline audit should count files by year');
  await assertExif(result.media[0].mergedPath, {
    datePrefix: '2024:01:02 03:04:05',
    latitude: 43.6532,
    longitude: -79.3832
  });
  exportMergedZip(mergedDir, exportedZip);
  assert.equal(path.basename(result.media[0].mergedPath), '2024-01-02_03-04-05_snapchat-memory.jpg');
  await assertExportedZipContainsExif(exportedZip, path.basename(mergedDir), '2024-01-02_03-04-05_snapchat-memory.jpg', {
    datePrefix: '2024:01:02 03:04:05',
    latitude: 43.6532,
    longitude: -79.3832
  });
}

async function testZipWithDownloadLinks(tempRoot) {
  const fixture = path.join(tempRoot, 'download-link');
  const source = path.join(fixture, 'source');
  const extractDir = path.join(fixture, 'extract');
  const mergedDir = path.join(fixture, 'merged');
  await fs.mkdir(path.join(source, 'json'), { recursive: true });
  const server = await createMediaServer();
  try {
    await fs.writeFile(
      path.join(source, 'json', 'memories_history.json'),
      JSON.stringify([
        {
          Date: '2021-06-07T08:09:10.000Z',
          'Media Type': 'Image',
          'Download Link': `${server.url}/snap-remote.jpg`,
          Latitude: '37.7749',
          Longitude: '-122.4194'
        },
        {
          Date: '2021-06-08T08:09:10.000Z',
          'Download Link': 'https://help.snapchat.com/hc/requests/new?utm_source=dmd&utm_medium=missing&utm_campaign=faq'
        }
      ])
    );

    const zipPath = await zipFixture(source, path.join(fixture, 'snapchat-download-link.zip'));
    await fs.mkdir(extractDir, { recursive: true });
    await extractZip(zipPath, { dir: extractDir });
    const result = await importer.prepareMergedMedia({ extractedDir: extractDir, mergedDir });
    const verification = await importer.verifyMergedMedia(result.media, 10);

    assert.equal(result.mediaFiles.length, 0, 'link-only zip should not need embedded media');
    assert.equal(result.media.length, 1, 'link-only zip should download and merge one media file');
    assert.equal(result.skippedDownloads.length, 0, 'Snapchat help request links should not be treated as downloads');
    assert.equal(importer.findDownloadUrl({ 'Download Link': 'https://help.snapchat.com/hc/requests/new?utm_source=dmd&utm_medium=missing&utm_campaign=faq' }), null);
    assert.equal(result.media[0].source, 'download-link');
    assert.equal(verification.total, 1, 'preview verification should see downloaded file');
    assert.equal(verification.withDate, 1, 'preview verification should see downloaded date');
    assert.equal(verification.withGps, 1, 'preview verification should see downloaded GPS');
    assert.equal(verification.missingFiles, 0, 'preview verification should not have missing downloaded files');
    await assertExif(result.media[0].mergedPath, {
      datePrefix: '2021:06:07 08:09:10',
      latitude: 37.7749,
      longitude: -122.4194
    });
  } finally {
    await server.close();
  }
}

async function testFailedMediaDownloadIsSkipped(tempRoot) {
  const fixture = path.join(tempRoot, 'failed-download-link');
  const source = path.join(fixture, 'source');
  const extractDir = path.join(fixture, 'extract');
  const mergedDir = path.join(fixture, 'merged');
  await fs.mkdir(path.join(source, 'json'), { recursive: true });
  const server = http.createServer((_request, response) => {
    response.writeHead(403, { 'Content-Type': 'text/html' });
    response.end('forbidden');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

  try {
    await fs.writeFile(
      path.join(source, 'json', 'memories_history.json'),
      JSON.stringify([{ Date: '2023-01-01T00:00:00.000Z', 'Download Link': `http://127.0.0.1:${server.address().port}/expired.jpg` }])
    );

    const zipPath = await zipFixture(source, path.join(fixture, 'snapchat-expired-link.zip'));
    await fs.mkdir(extractDir, { recursive: true });
    await extractZip(zipPath, { dir: extractDir });
    const result = await importer.prepareMergedMedia({ extractedDir: extractDir, mergedDir });

    assert.equal(result.media.length, 0, 'expired download links should not create merged media');
    assert.equal(result.skippedDownloads.length, 1, 'expired download links should be reported without aborting preview');
    assert.match(result.skippedDownloads[0].reason, /403/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

async function assertExif(file, expected) {
  assert.ok(fss.existsSync(file), `merged file missing: ${file}`);
  const tags = await exiftool.read(file);
  assert.equal(tags.DateTimeOriginal?.rawValue, expected.datePrefix, `wrong DateTimeOriginal: ${tags.DateTimeOriginal?.rawValue}`);
  assert.ok(tags.DateCreated?.rawValue?.startsWith(expected.datePrefix), `wrong XMP DateCreated: ${tags.DateCreated?.rawValue}`);
  if (Number.isFinite(expected.latitude)) {
    assert.ok(Math.abs(Number(tags.GPSLatitude) - expected.latitude) < 0.0002, `wrong GPSLatitude: ${tags.GPSLatitude}`);
  }
  if (Number.isFinite(expected.longitude)) {
    assert.ok(Math.abs(Number(tags.GPSLongitude) - expected.longitude) < 0.0002, `wrong GPSLongitude: ${tags.GPSLongitude}`);
  }
}

async function assertExportedZipContainsExif(zipPath, folderName, fileName, expected) {
  const extractDir = await fs.mkdtemp(path.join(os.tmpdir(), 'snapchat-export-zip-qa-'));
  try {
    await extractZip(zipPath, { dir: extractDir });
    const exportedFile = path.join(extractDir, folderName, fileName);
    await assertExif(exportedFile, expected);
  } finally {
    await fs.rm(extractDir, { recursive: true, force: true });
  }
}

async function createMediaServer() {
  const server = http.createServer((request, response) => {
    if (request.url !== '/snap-remote.jpg') {
      response.writeHead(404);
      response.end('not found');
      return;
    }
    response.writeHead(200, { 'Content-Type': 'image/jpeg' });
    response.end(Buffer.from(SAMPLE_JPEG_BASE64, 'base64'));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((resolve) => server.close(resolve))
  };
}

async function writeSampleJpeg(file) {
  await fs.writeFile(file, Buffer.from(SAMPLE_JPEG_BASE64, 'base64'));
}

async function zipFixture(sourceDir, zipPath) {
  await fs.mkdir(path.dirname(zipPath), { recursive: true });
  execFileSync('/usr/bin/zip', ['-qr', zipPath, '.'], { cwd: sourceDir });
  return zipPath;
}

function exportMergedZip(mergedDir, zipPath) {
  execFileSync('/usr/bin/ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', mergedDir, zipPath]);
}

main().catch(async (error) => {
  await exiftool.end();
  console.error(error);
  process.exit(1);
});
