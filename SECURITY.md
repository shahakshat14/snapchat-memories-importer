# Security Policy

## Supported Versions

Security fixes are handled on the latest `main` branch.

## Reporting a Vulnerability

Please open a private security advisory on GitHub if available, or contact the repository owner directly.

Do not include Snapchat exports, Google OAuth client secrets, Google OAuth tokens, or personal photos/videos in public issues.

## Sensitive Data

This app is designed to process files locally. Keep these files private:

- Snapchat export zips
- Merged media folders
- Generated merged ZIP files
- Google OAuth Desktop client JSON files
- Google OAuth tokens

The repository `.gitignore` excludes generated app outputs, dependencies, OAuth credentials, and local token files.

## Build Trust

The local development DMG and Windows installer are unsigned unless you configure platform signing certificates. Unsigned builds may trigger operating system warnings.
