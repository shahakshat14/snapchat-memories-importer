# Auto-Update Plan

Automatic updates should wait until public release discipline is stable.

## Why It Is Not Enabled Yet

- macOS builds are currently ad-hoc signed and not Apple-notarized.
- Windows builds are not backed by a trusted code-signing certificate.
- Unsigned auto-updating apps can make operating system trust warnings feel scarier, not smoother.

## Safe Path

1. Keep GitHub Releases as the source of truth.
2. Show users the latest release from the website and in-app Updates link.
3. Add signed update artifacts after Apple Developer ID and Windows Authenticode signing are available.
4. Enable Electron auto-update only after signed Mac and Windows builds are published consistently.

## Requirements Before Enabling

- Stable semantic versioning.
- Green `Build` and `Pages` workflows on `main`.
- Release checklist completed for every release.
- Apple notarization or an explicit Mac beta update warning.
- Windows trusted signing or an explicit Windows beta update warning.

## First Implementation Target

Use GitHub Releases as the update feed and add a manual **Check for Updates** flow before enabling background updates.
