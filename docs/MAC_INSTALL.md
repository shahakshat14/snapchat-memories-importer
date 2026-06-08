# Mac Install Guide

Snapchat Memories Importer is currently distributed as a free GitHub beta. The app is ad-hoc signed but not Apple-notarized, because Apple Developer ID notarization requires a paid Apple Developer Program account.

## Requirements

- macOS 12 Monterey or newer
- Intel Mac or Apple Silicon Mac
- Enough free disk space for your Snapchat export plus the merged preview output

## Install

1. Download `Snapchat-Memories-Importer-0.1.0.dmg` from the latest GitHub Release.
2. Open the downloaded `.dmg`.
3. Drag **Snapchat Memories Importer** into **Applications**.
4. Eject the installer disk image.

## If macOS Blocks the App

macOS may show:

```text
Apple could not verify "Snapchat Memories Importer" is free of malware that may harm your Mac or compromise your privacy.
```

That warning appears because this free beta is not Apple-notarized. To open it:

1. Open **Applications**.
2. Right-click or Control-click **Snapchat Memories Importer**.
3. Choose **Open**.
4. Click **Open** again if macOS asks for confirmation.

If that still does not work:

1. Open **System Settings**.
2. Go to **Privacy & Security**.
3. Scroll down to the security message about **Snapchat Memories Importer**.
4. Click **Open Anyway**.
5. Enter your Mac password or use Touch ID if prompted.

After the first successful launch, macOS should remember your choice.

## Privacy

The app processes your Snapchat export locally on your Mac. It does not include telemetry. Google Photos upload only starts after you sign in and choose the Google Photos destination.

## Troubleshooting

If the app says it is damaged or cannot run on your version of macOS:

1. Make sure you downloaded the latest `.dmg` from GitHub Releases.
2. Make sure your Mac is running macOS 12 Monterey or newer.
3. Delete the app from **Applications** and reinstall it from the latest `.dmg`.
4. If you are on Apple Silicon, make sure you downloaded the universal Mac `.dmg`, not a partial build from an older test.

If Apple Photos import shows rejected items, use the app's final report to identify damaged videos or unsupported files. The importer tries to fix media when possible, but files with missing video indexes or incomplete Snapchat downloads may still need review.
