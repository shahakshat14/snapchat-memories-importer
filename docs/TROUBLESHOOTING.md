# Troubleshooting

Start with the symptom you see.

## Mac Will Not Open

Use the Mac install guide:

[MAC_INSTALL.md](MAC_INSTALL.md)

Most users need either:

- Right-click or Control-click the app, then choose **Open**
- **System Settings > Privacy & Security > Open Anyway**

## Windows Blocked Installer

Use the Windows install guide:

[WINDOWS_INSTALL.md](WINDOWS_INSTALL.md)

Most users need:

- **More info**
- Confirm the app name
- **Run anyway**

## Apple Photos Rejected Files

Open the app's final report and look for:

- Apple Photos failed files
- Damaged videos
- Duplicate-resolved files
- Accounted files

If you open an issue, include rejected filenames only. Do not attach private media.

## Google Login Missing

Direct Google upload needs the app OAuth Desktop client bundled into the build. ZIP export and Apple Photos still work without it.

See:

[GOOGLE_PHOTOS_OAUTH.md](GOOGLE_PHOTOS_OAUTH.md)

## Snapchat Links Expired

Some Snapchat exports contain metadata links instead of embedded media. Those links can expire or redirect to Snapchat support pages.

The importer skips support/help links and reports skipped downloads. If possible, request a fresh Snapchat export with Memories media embedded.

## Dates Look Wrong

Use the app's Metadata Inspector. Copy the before/after row for one affected file into a GitHub issue.

Also check whether the app recovered a missing date from the filename. Filename fallback is useful, but it is still worth reviewing if a file date looks suspicious.

## Support Bundle

Use **Support Bundle** in the app and paste the non-private summary into a GitHub issue.
