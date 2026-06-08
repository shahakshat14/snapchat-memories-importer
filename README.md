# Snapchat Memories Importer

A desktop app that imports a Snapchat data export into Google Photos, Apple Photos, or a portable merged EXIF zip.

## Direct Downloads

- [Download for macOS (.dmg)](https://github.com/shahakshat14/snapchat-memories-importer/releases/latest/download/Snapchat-Memories-Importer-0.1.0.dmg)
- [Download for Windows (.exe)](https://github.com/shahakshat14/snapchat-memories-importer/releases/latest/download/Snapchat-Memories-Importer-Setup-0.1.0.exe)

### macOS beta install note

The free GitHub beta build is not Apple-notarized yet, so macOS may show **"Apple could not verify Snapchat Memories Importer is free of malware"**. This does not mean the app failed to install; it means the app was downloaded outside the Mac App Store and is not notarized with a paid Apple Developer ID certificate.

To open it on macOS:

1. Download the `.dmg`.
2. Open the `.dmg` and drag **Snapchat Memories Importer** into **Applications**.
3. In **Applications**, right-click or Control-click the app and choose **Open**.
4. If macOS still blocks it, open **System Settings > Privacy & Security**, scroll to the security message for Snapchat Memories Importer, and choose **Open Anyway**.

Full Mac instructions: [docs/MAC_INSTALL.md](docs/MAC_INSTALL.md).

The macOS DMG is universal for Intel and Apple Silicon Macs. It requires macOS 12 Monterey or newer because Electron 39 relies on Chromium versions that no longer support Big Sur or older macOS releases.

The app can ask for:

1. One or more Snapchat export `.zip` files, or a folder containing Snapchat export `.zip` files
2. Google Photos login, only if uploading to Google Photos

Then it extracts each export into an isolated folder, finds photos/videos and metadata across all archives, writes available EXIF/XMP date and GPS data into copied media files, gives the merged media clean chronological filenames, and shows a preview with timeline and issue audits before any export/import/upload action.

After reviewing the preview, you can:

- Export a new `.zip` containing the merged EXIF media.
- Import the merged media into Apple Photos.
- Upload the merged media to Google Photos.

## Google Photos Login

Google Photos upload is not anonymous. After the preview is approved, click **Google Photos** or **Upload to Google Photos**. The app opens Google login in your browser, waits for the login to finish, then uploads the reviewed files automatically.

Release builds should bundle the app's Google OAuth Desktop client so that Google login opens directly. Users should not need to choose an OAuth JSON file.

To configure a build:

1. Go to Google Cloud Console.
2. Enable **Google Photos Library API**.
3. Create an OAuth client for **Desktop app**.
4. Download the JSON file.
5. Add the full JSON as the `GOOGLE_OAUTH_CLIENT_JSON` GitHub Actions secret, or set `GOOGLE_OAUTH_CLIENT_ID` and `GOOGLE_OAUTH_CLIENT_SECRET`.

Local builds can run `npm run prepare:google-auth` with those same environment variables before packaging. The script writes `config/google-oauth-client.json`, which is bundled into the app but ignored by git.

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

The QA script creates Snapchat-style zip files, extracts them, merges EXIF/XMP metadata, verifies the preview summary, exports a merged zip, re-extracts it, and reads the output back with ExifTool. It covers media embedded in the zip, metadata-only exports with download links, and multiple `mydata` zip files with duplicate internal paths.

## Build DMG

```bash
npm run icons:generate
npm run dist:mac
```

The DMG will be created in `dist/`.

Local DMGs are ad-hoc signed unless you provide Developer ID signing and notarization credentials.

For a Gatekeeper-friendly public release, install a **Developer ID Application** certificate in the build machine keychain and run:

```bash
npm run signing:doctor -- --mac

MAC_SIGN_IDENTITY="Developer ID Application: Your Name (TEAMID)" \
APPLE_ID="apple-id@example.com" \
APPLE_APP_SPECIFIC_PASSWORD="app-specific-password" \
APPLE_TEAM_ID="TEAMID" \
npm run dist:mac:signed
```

You can also set `APPLE_NOTARY_PROFILE` instead of the Apple ID, app-specific password, and team ID values if you already stored notarytool credentials in the keychain.

Signed macOS builds use `build/icon.icns`, hardened runtime entitlements from `build/entitlements.mac.plist`, `xcrun notarytool submit --wait`, and `xcrun stapler`.

## Build Windows EXE

```bash
npm run icons:generate
npm run dist:win
```

The Windows installer will be created in `dist/`. The easiest supported way to build the Windows EXE is on Windows or through the included GitHub Actions workflow.

For a trusted Windows public release, provide an Authenticode code-signing certificate and run:

```bash
npm run signing:doctor -- --win

CSC_LINK="path-or-base64-p12" \
CSC_KEY_PASSWORD="certificate-password" \
npm run dist:win:signed
```

Windows builds use `build/icon.ico`. Unsigned installers may still trigger SmartScreen reputation warnings until a trusted certificate and reputation are established.

## Google Photos API Notes

Google Photos upload uses the current two-step flow:

1. Upload raw bytes to get an upload token.
2. Create media items with `mediaItems:batchCreate`.

The app creates media items serially in batches of up to 50, matching Google's upload guidance.

## Apple Photos Notes

Apple Photos import uses the local macOS Photos app through AppleScript. macOS may ask you to grant automation permission the first time the app controls Photos.

## Merged ZIP Notes

The merged ZIP is created next to the preview folder in Documents. It contains the merged media folder with EXIF/XMP already written, so you can manually upload it anywhere.

Merged media files are renamed to a readable chronological format:

```text
YYYY-MM-DD_HH-mm-ss_snapchat-memory.jpg
YYYY-MM-DD_HH-mm-ss_snapchat-memory-2.jpg
```

The suffix is added only when multiple Memories share the same timestamp.

Each preview folder also includes:

- `Import Summary.html`, a human-readable audit with date range, year counts, duplicate timestamps, and files needing review.
- `_Needs Review/review-report.json`, when damaged files, missing dates, skipped downloads, or unreadable outputs are detected.
- `_Needs Review/Damaged Videos/` and `_Needs Review/Missing Dates/`, when media needs a closer look.

## Security and Privacy

This app processes Snapchat exports locally and does not include telemetry. See [SECURITY.md](SECURITY.md) and [PRIVACY.md](PRIVACY.md).

Do not commit:

- Snapchat export zips
- Merged media folders
- Generated merged ZIP files
- Google OAuth Desktop client JSON files
- Google OAuth tokens

## License

This repository is source-available. See [LICENSE](LICENSE).

## Snapchat Export Notes

Snapchat documents that `My Data` downloads arrive as a zip file. For Memories-only exports, Snapchat says to extract the zip, open `index.html`, choose **Memories**, and download individual Memories or all Memories from that page.

Because of that, the importer supports these export shapes:

- Media files already embedded inside the zip, with JSON/CSV metadata matched by filename, stem, or SHA-256.
- Metadata or HTML files that include download links for the actual Memories media.
- Multiple `mydata` zip files selected together, or a folder containing `mydata*.zip` files. Each archive is extracted into its own isolated folder so duplicate paths like `index.html`, `html/memories_history.html`, and `json/memories_history.json` do not overwrite each other.
