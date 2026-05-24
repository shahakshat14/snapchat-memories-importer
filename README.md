# Snapchat Memories Importer

A macOS desktop app that imports a Snapchat data export into Google Photos, Apple Photos, or a portable merged EXIF zip.

The app can ask for:

1. A Snapchat export `.zip`
2. A Google OAuth Desktop client JSON, only if uploading to Google Photos
3. Google Photos login, only if uploading to Google Photos

Then it extracts the export, finds photos/videos and metadata, writes available EXIF/XMP date and GPS data into copied media files, and shows a preview for confirmation.

After reviewing the preview, you can:

- Export a new `.zip` containing the merged EXIF media.
- Import the merged media into Apple Photos.
- Upload the merged media to Google Photos.

## Why Google OAuth JSON Is Required

Google Photos upload is not anonymous. Before the app can show a Google login, Google requires an OAuth client ID from a Google Cloud project where the Google Photos Library API is enabled.

Create it once:

1. Go to Google Cloud Console.
2. Enable **Google Photos Library API**.
3. Create an OAuth client for **Desktop app**.
4. Download the JSON file.
5. Select that JSON inside the app.

The app requests only `https://www.googleapis.com/auth/photoslibrary.appendonly`.

## Development

```bash
npm install
npm start
```

## QA

Run the importer QA fixtures:

```bash
npm run qa
```

The QA script creates Snapchat-style zip files, extracts them, merges EXIF/XMP metadata, verifies the preview summary, exports a merged zip, re-extracts it, and reads the output back with ExifTool. It covers both media embedded in the zip and metadata-only exports with download links.

## Build DMG

```bash
npm run dist
```

The DMG will be created in `dist/`.

The local DMG is unsigned and not notarized. On first launch, macOS may require right-clicking the app and choosing **Open**, or allowing it in Privacy & Security settings.

## Google Photos API Notes

Google Photos upload uses the current two-step flow:

1. Upload raw bytes to get an upload token.
2. Create media items with `mediaItems:batchCreate`.

The app creates media items serially in batches of up to 50, matching Google's upload guidance.

## Apple Photos Notes

Apple Photos import uses the local macOS Photos app through AppleScript. macOS may ask you to grant automation permission the first time the app controls Photos.

## Merged ZIP Notes

The merged ZIP is created next to the preview folder in Documents. It contains the merged media folder with EXIF/XMP already written, so you can manually upload it anywhere.

## Snapchat Export Notes

Snapchat documents that `My Data` downloads arrive as a zip file. For Memories-only exports, Snapchat says to extract the zip, open `index.html`, choose **Memories**, and download individual Memories or all Memories from that page.

Because of that, the importer supports both export shapes:

- Media files already embedded inside the zip, with JSON/CSV metadata matched by filename, stem, or SHA-256.
- Metadata or HTML files that include download links for the actual Memories media.
