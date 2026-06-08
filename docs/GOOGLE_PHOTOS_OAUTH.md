# Google Photos OAuth

Google Photos direct upload needs a Google OAuth Desktop client bundled into the app build. This is different from the user signing in.

## What Users Do

Users click **Google** in the app after preview approval. The app opens the Google login page in the browser and starts upload after consent.

## What The Build Needs

The app build needs one OAuth Desktop client configured by the app publisher. Users should not need to create their own OAuth JSON for normal release builds.

If OAuth is not bundled:

- ZIP export still works.
- Apple Photos import still works on macOS.
- Google Photos direct upload is disabled with a clear message.

## Required Scope

The app requests only:

```text
https://www.googleapis.com/auth/photoslibrary.appendonly
```

That lets the app add new media to Google Photos. It does not grant broad read access to the user's library.
