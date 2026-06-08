# Windows Install Guide

Snapchat Memories Importer is currently distributed as a free GitHub beta. The Windows installer is not backed by a paid code-signing certificate yet, so Windows Defender SmartScreen may show a warning the first time you install it.

## Requirements

- Windows 10 or Windows 11
- Enough free disk space for your Snapchat export plus the merged preview output

## Install

1. Download `Snapchat-Memories-Importer-Setup-0.1.0.exe` from the latest GitHub Release.
2. Open the downloaded installer.
3. Follow the installer prompts.
4. Launch **Snapchat Memories Importer** from the Start menu or desktop shortcut.

## If Windows SmartScreen Blocks the Installer

Windows may show:

```text
Windows protected your PC
Microsoft Defender SmartScreen prevented an unrecognized app from starting.
```

That warning appears because this free beta does not yet have paid Windows publisher reputation. To continue:

1. Click **More info**.
2. Confirm the app name is **Snapchat Memories Importer**.
3. Click **Run anyway**.

If your browser warns that the file is uncommon, choose the option to keep the file only if the filename matches the GitHub Release download exactly:

```text
Snapchat-Memories-Importer-Setup-0.1.0.exe
```

## Privacy

The app processes your Snapchat export locally on your computer. Google Photos upload only starts after you sign in and choose the Google Photos destination.

## Troubleshooting

If the installer will not open:

1. Make sure you downloaded the latest `.exe` from GitHub Releases.
2. Delete partial downloads and download it again.
3. Right-click the installer, choose **Properties**, and if Windows shows an **Unblock** checkbox, check it and click **Apply**.
4. Run the installer again.

Unsigned Windows apps can trigger SmartScreen until a paid signing certificate and reputation are established. The public beta uses GitHub Releases so the source, downloads, and install instructions stay in one place.
