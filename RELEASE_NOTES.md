# Snapchat Memories Importer 0.1.0 Beta

This is a free GitHub beta for importing Snapchat Memories into Apple Photos, Google Photos, or a portable merged EXIF ZIP.

## Downloads

- macOS: `Snapchat-Memories-Importer-0.1.0.dmg`
- Windows: `Snapchat-Memories-Importer-Setup-0.1.0.exe`

## Important macOS Note

The macOS app is not Apple-notarized yet because Apple Developer ID notarization requires a paid Apple Developer Program account. macOS may show a warning that Apple cannot verify the app.

To open it:

1. Install the app into **Applications**.
2. Right-click or Control-click **Snapchat Memories Importer**.
3. Choose **Open**.
4. If needed, go to **System Settings > Privacy & Security** and choose **Open Anyway**.

Full guide: https://github.com/shahakshat14/snapchat-memories-importer/blob/main/docs/MAC_INSTALL.md

## Important Windows Note

The Windows app is not backed by a paid code-signing certificate yet, so Microsoft Defender SmartScreen may show a warning.

To open it:

1. Click **More info**.
2. Confirm the app name is **Snapchat Memories Importer**.
3. Click **Run anyway**.

Full guide: https://github.com/shahakshat14/snapchat-memories-importer/blob/main/docs/WINDOWS_INSTALL.md

## Highlights

- Merge Snapchat Memories metadata into copied photo/video files.
- Preview metadata before upload or export.
- Run a small `Test 25` sample before processing the full archive.
- Export a privacy-conscious Support Bundle when reporting issues.
- Export a new merged EXIF ZIP.
- Import into Apple Photos with safer batching and final verification.
- Upload into Google Photos after browser sign-in.
- Review damaged files, missing dates, duplicate candidates, and skipped items in the final report.

## Privacy

Processing happens locally. Google Photos upload only starts after you sign in and choose that destination.

## Checksums

```text
macOS DMG    SHA-256 e3c1e6e055209e8dcb058168e13ca027089dafdeb6e83444e3e13f5cfc021e82
Windows EXE  SHA-256 b5bfe7f81c8cde628c5df1c5347ded2bfe302322b7c285da1005109afbe0a342
```
