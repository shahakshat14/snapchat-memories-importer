# Safety And Privacy

Snapchat Memories Importer is designed to process your export locally first.

## What Stays Local

- Snapchat export extraction
- Metadata matching
- EXIF/XMP writing
- Date and GPS verification
- Duplicate detection
- Final reports
- Merged ZIP export

## Google Photos

Google Photos upload starts only after:

1. A preview is prepared.
2. You approve the preview.
3. You choose Google Photos.
4. You sign in through the browser.

The app requests only:

```text
https://www.googleapis.com/auth/photoslibrary.appendonly
```

That scope lets the app add new media. It does not request broad read access to your Google Photos library.

## Support Bundle

The Support Bundle is meant for troubleshooting without sharing private media.

It may include:

- App version
- OS and CPU information
- Import counts
- Report paths
- Failed or rejected filenames
- Google OAuth configured/not configured status

It does not include:

- Photo or video contents
- Snapchat export zip files
- OAuth access tokens
- Google refresh tokens
- Google OAuth client secrets

## Why macOS And Windows Warn

The free beta is distributed through GitHub Releases. It is not Apple-notarized and not Windows trusted-signed yet because those require paid developer credentials or certificates.

The source, release assets, checksums, and install guides are public in this repository.
