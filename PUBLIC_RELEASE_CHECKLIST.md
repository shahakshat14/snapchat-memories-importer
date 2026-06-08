# Public Release Checklist

Use this before publishing or replacing GitHub Release assets.

## App QA

- Run `npm ci`.
- Run `node --check src/main.js src/preload.js src/renderer.js src/importer-core.js tests/qa-importer.js`.
- Run `npm audit --omit=dev`.
- Run `npm run qa`.
- Run a local `Test 25` sample with real Snapchat `mydata*.zip` exports.
- Run one full preview and confirm `Import Summary.html` opens.
- Confirm Support Bundle export opens and does not include media contents or tokens.

## macOS

- Run `npm run dist:mac`.
- Verify the DMG with `hdiutil verify dist/Snapchat-Memories-Importer-0.1.0.dmg`.
- Install locally with `npm run install:mac`.
- Confirm the app opens on Apple Silicon.
- Confirm the Mac install guide still matches the Gatekeeper warning flow.

## Windows

- Run `npm run dist:win` on Windows or let GitHub Actions build it.
- Confirm the EXE appears on the release.
- Confirm the Windows install guide still matches the SmartScreen warning flow.

## Website

- Confirm `site/index.html`, `site/styles.css`, and `site/app.js` pass the static checks.
- Confirm the GitHub Pages workflow is green.
- Confirm the website download buttons point to the latest release assets.
- Confirm SHA-256 checksums appear for Mac and Windows downloads.

## Release

- Update `RELEASE_NOTES.md`.
- Upload or replace release assets.
- Confirm direct DMG and EXE URLs return successful redirects.
- Confirm GitHub Actions `Build` is green on `main`.
- Confirm GitHub Actions `Pages` is green on `main`.

## Known Trust Limits

- Apple Developer ID notarization is not enabled without paid Apple credentials.
- Windows trusted signing is not enabled without a paid code-signing certificate.
- Direct Google Photos upload needs a bundled Google OAuth Desktop client.
