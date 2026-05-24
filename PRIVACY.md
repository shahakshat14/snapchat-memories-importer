# Privacy

Snapchat Memories Importer is intended to run locally on your computer.

## Local Processing

The app extracts the selected Snapchat export zip locally, writes EXIF/XMP metadata into copied media files, and stores preview/output folders under your Documents folder.

## Network Access

Network access is used only when:

- Downloading Snapchat Memories from download links found in your export.
- Connecting to Google OAuth and uploading to Google Photos, if you choose the Google Photos output.

## Apple Photos

Apple Photos import uses macOS automation to ask the local Photos app to import the merged media files.

## No Telemetry

The app does not include analytics or telemetry.

## Credentials

Google OAuth Desktop client JSON files and OAuth tokens are local secrets. Do not commit or share them. The repository ignores `client_secret.json` and local token files.
