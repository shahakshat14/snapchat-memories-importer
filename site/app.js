const FALLBACK_RELEASE = {
  tag_name: 'v0.1.0',
  html_url: 'https://github.com/shahakshat14/snapchat-memories-importer/releases/tag/v0.1.0',
  assets: [
    {
      name: 'Snapchat-Memories-Importer-0.1.0.dmg',
      browser_download_url: 'https://github.com/shahakshat14/snapchat-memories-importer/releases/download/v0.1.0/Snapchat-Memories-Importer-0.1.0.dmg',
      digest: 'sha256:e3c1e6e055209e8dcb058168e13ca027089dafdeb6e83444e3e13f5cfc021e82'
    },
    {
      name: 'Snapchat-Memories-Importer-Setup-0.1.0.exe',
      browser_download_url: 'https://github.com/shahakshat14/snapchat-memories-importer/releases/download/v0.1.0/Snapchat-Memories-Importer-Setup-0.1.0.exe',
      digest: 'sha256:b5bfe7f81c8cde628c5df1c5347ded2bfe302322b7c285da1005109afbe0a342'
    }
  ]
};

loadRelease().then(applyRelease).catch(() => applyRelease(FALLBACK_RELEASE));

async function loadRelease() {
  const response = await fetch('https://api.github.com/repos/shahakshat14/snapchat-memories-importer/releases/latest', {
    headers: { Accept: 'application/vnd.github+json' }
  });
  if (!response.ok) return FALLBACK_RELEASE;
  return response.json();
}

function applyRelease(release) {
  const version = release.tag_name || FALLBACK_RELEASE.tag_name;
  for (const node of document.querySelectorAll('[data-version]')) node.textContent = version;
  const mac = findAsset(release, /\.dmg$/i);
  const windows = findAsset(release, /\.exe$/i);
  updateDownload('mac', mac);
  updateDownload('windows', windows);
  for (const link of document.querySelectorAll('a[href*="/releases/tag/"]')) {
    link.href = release.html_url || FALLBACK_RELEASE.html_url;
  }
}

function findAsset(release, pattern) {
  return (release.assets || []).find((asset) => pattern.test(asset.name))
    || (FALLBACK_RELEASE.assets || []).find((asset) => pattern.test(asset.name));
}

function updateDownload(kind, asset) {
  if (!asset) return;
  for (const link of document.querySelectorAll(`[data-download="${kind}"]`)) {
    link.href = asset.browser_download_url;
  }
  const checksum = document.querySelector(`[data-checksum="${kind}"]`);
  if (checksum) checksum.textContent = formatDigest(asset.digest);
}

function formatDigest(digest) {
  if (!digest) return 'SHA-256 listed on GitHub release asset';
  return digest.replace(/^sha256:/i, 'SHA-256 ');
}
