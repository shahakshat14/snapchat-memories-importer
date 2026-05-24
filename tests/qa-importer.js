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

const SAMPLE_JPEG_BASE64 =
  '/9j/4AAQSkZJRgABAQAAAQABAAD/2wCEAAkGBxAQEBAQDxAQDw8QDw8PDw8PDw8QDw8QFREWFhURFRUYHSggGBolGxUVITEhJSkrLi4uFx8zODMtNygtLisBCgoKDg0OGxAQGi0lHyUtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLf/AABEIAAEAAQMBIgACEQEDEQH/xAAWAAEBAQAAAAAAAAAAAAAAAAAAAQf/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAH/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAEFAqf/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAEDAQE/ASP/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAECAQE/ASP/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAY/Al//xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAE/IV//2gAMAwEAAgADAAAAEP/EFBQRAQAAAAAAAAAAAAAAAAAAARD/2gAIAQMBAT8QH//EFBQRAQAAAAAAAAAAAAAAAAAAARD/2gAIAQIBAT8QH//EFBABAQAAAAAAAAAAAAAAAAAAARD/2gAIAQEAAT8QH//Z';

async function main() {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'snapchat-importer-qa-'));
  try {
    await testZipWithEmbeddedMedia(tempRoot);
    await testZipWithDownloadLinks(tempRoot);
    console.log('QA importer tests passed');
  } finally {
    await exiftool.end();
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
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

  assert.equal(result.media.length, 1, 'embedded zip should produce one merged media file');
  assert.equal(result.media[0].source, 'zip-media');
  assert.equal(verification.total, 1, 'preview verification should see one file');
  assert.equal(verification.withDate, 1, 'preview verification should see embedded date');
  assert.equal(verification.withGps, 1, 'preview verification should see embedded GPS');
  assert.equal(verification.missingFiles, 0, 'preview verification should not have missing files');
  await assertExif(result.media[0].mergedPath, {
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

async function assertExif(file, expected) {
  assert.ok(fss.existsSync(file), `merged file missing: ${file}`);
  const tags = await exiftool.read(file);
  assert.equal(tags.DateTimeOriginal?.rawValue, expected.datePrefix, `wrong DateTimeOriginal: ${tags.DateTimeOriginal?.rawValue}`);
  assert.ok(tags.DateCreated?.rawValue?.startsWith(expected.datePrefix), `wrong XMP DateCreated: ${tags.DateCreated?.rawValue}`);
  assert.ok(Math.abs(Number(tags.GPSLatitude) - expected.latitude) < 0.0002, `wrong GPSLatitude: ${tags.GPSLatitude}`);
  assert.ok(Math.abs(Number(tags.GPSLongitude) - expected.longitude) < 0.0002, `wrong GPSLongitude: ${tags.GPSLongitude}`);
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

main().catch(async (error) => {
  await exiftool.end();
  console.error(error);
  process.exit(1);
});
