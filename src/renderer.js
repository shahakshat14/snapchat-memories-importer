const state = {
  zipPath: null,
  credentialsPath: null,
  signedIn: false,
  running: false,
  preview: null
};

const elements = {
  zipButton: document.querySelector('#zipButton'),
  credentialsButton: document.querySelector('#credentialsButton'),
  signInButton: document.querySelector('#signInButton'),
  prepareButton: document.querySelector('#prepareButton'),
  uploadButton: document.querySelector('#uploadButton'),
  zipExportButton: document.querySelector('#zipExportButton'),
  applePhotosButton: document.querySelector('#applePhotosButton'),
  cancelButton: document.querySelector('#cancelButton'),
  openMergedButton: document.querySelector('#openMergedButton'),
  reviewCheckbox: document.querySelector('#reviewCheckbox'),
  zipPath: document.querySelector('#zipPath'),
  credentialsPath: document.querySelector('#credentialsPath'),
  accountLabel: document.querySelector('#accountLabel'),
  statusPill: document.querySelector('#statusPill'),
  stageLabel: document.querySelector('#stageLabel'),
  percentLabel: document.querySelector('#percentLabel'),
  progressBar: document.querySelector('#progressBar'),
  message: document.querySelector('#message'),
  previewPanel: document.querySelector('#previewPanel'),
  previewLocation: document.querySelector('#previewLocation'),
  totalMetric: document.querySelector('#totalMetric'),
  dateMetric: document.querySelector('#dateMetric'),
  gpsMetric: document.querySelector('#gpsMetric'),
  missingMetric: document.querySelector('#missingMetric'),
  sampleRows: document.querySelector('#sampleRows')
};

elements.zipButton.addEventListener('click', async () => {
  const zipPath = await window.snapImporter.chooseZip();
  if (!zipPath) return;
  state.zipPath = zipPath;
  state.preview = null;
  elements.zipPath.textContent = zipPath;
  hidePreview();
  setMessage('Snapchat zip selected. Prepare a preview before uploading.');
  updateButtons();
});

elements.credentialsButton.addEventListener('click', async () => {
  const credentialsPath = await window.snapImporter.chooseCredentials();
  if (!credentialsPath) return;
  state.credentialsPath = credentialsPath;
  state.signedIn = false;
  elements.credentialsPath.textContent = credentialsPath;
  elements.accountLabel.textContent = 'Not connected';
  setMessage('Google OAuth JSON selected.');
  updateButtons();
});

elements.signInButton.addEventListener('click', async () => {
  try {
    setBusy(true, 'Opening Google login');
    const account = await window.snapImporter.signIn(state.credentialsPath);
    state.signedIn = true;
    elements.accountLabel.textContent = account.email;
    setProgress({ stage: 'connected', percent: 0, message: 'Google Photos connected. Upload is available after preview approval.' });
  } catch (error) {
    setError(error);
  } finally {
    setBusy(false);
    updateButtons();
  }
});

elements.prepareButton.addEventListener('click', async () => {
  try {
    setBusy(true, 'Preparing preview');
    state.preview = await window.snapImporter.prepareImport({ zipPath: state.zipPath });
    renderPreview(state.preview);
    setProgress({
      stage: 'preview-ready',
      percent: 100,
      message: `Preview ready. Review ${state.preview.verification.total} files, then confirm upload.`
    });
  } catch (error) {
    setError(error);
  } finally {
    setBusy(false);
    updateButtons();
  }
});

elements.uploadButton.addEventListener('click', async () => {
  try {
    setBusy(true, 'Uploading reviewed files');
    const report = await window.snapImporter.uploadPrepared();
    setProgress({
      stage: 'complete',
      percent: 100,
      message: `Uploaded ${report.uploadedFiles} files. Report saved in ${report.mergedDir}`
    });
  } catch (error) {
    setError(error);
  } finally {
    setBusy(false);
    updateButtons();
  }
});

elements.zipExportButton.addEventListener('click', async () => {
  try {
    setBusy(true, 'Creating merged ZIP');
    const report = await window.snapImporter.exportPreparedZip();
    setProgress({
      stage: 'complete',
      percent: 100,
      message: `Merged EXIF zip created at ${report.exportedZipPath}`
    });
  } catch (error) {
    setError(error);
  } finally {
    setBusy(false);
    updateButtons();
  }
});

elements.applePhotosButton.addEventListener('click', async () => {
  try {
    setBusy(true, 'Importing to Apple Photos');
    const report = await window.snapImporter.importApplePhotos();
    setProgress({
      stage: 'complete',
      percent: 100,
      message: `Imported ${report.applePhotosImportedFiles} files into Apple Photos.`
    });
  } catch (error) {
    setError(error);
  } finally {
    setBusy(false);
    updateButtons();
  }
});

elements.openMergedButton.addEventListener('click', async () => {
  if (!state.preview?.mergedDir) return;
  try {
    await window.snapImporter.openPath(state.preview.mergedDir);
  } catch (error) {
    setError(error);
  }
});

elements.reviewCheckbox.addEventListener('change', () => updateButtons());

elements.cancelButton.addEventListener('click', async () => {
  await window.snapImporter.cancelImport();
  setMessage('Cancelling after the current file finishes.');
});

window.snapImporter.onProgress((payload) => setProgress(payload));
updateButtons();

function renderPreview(preview) {
  const verification = preview.verification;
  elements.previewPanel.hidden = false;
  elements.reviewCheckbox.checked = false;
  elements.previewLocation.textContent = preview.mergedDir;
  elements.totalMetric.textContent = verification.total;
  elements.dateMetric.textContent = verification.withDate;
  elements.gpsMetric.textContent = verification.withGps;
  elements.missingMetric.textContent = verification.missingFiles;
  elements.sampleRows.innerHTML = '';

  for (const item of verification.sample) {
    const row = document.createElement('tr');
    row.append(
      cell(item.fileName),
      cell(item.source),
      cell(item.date || 'Missing'),
      cell(item.latitude === null || item.longitude === null ? 'Missing' : `${item.latitude.toFixed(4)}, ${item.longitude.toFixed(4)}`)
    );
    elements.sampleRows.append(row);
  }
}

function hidePreview() {
  elements.previewPanel.hidden = true;
  elements.reviewCheckbox.checked = false;
  elements.sampleRows.innerHTML = '';
}

function cell(value) {
  const element = document.createElement('td');
  element.textContent = value;
  return element;
}

function setProgress({ stage, percent, message }) {
  const safePercent = Math.max(0, Math.min(100, percent || 0));
  elements.stageLabel.textContent = titleCase(stage || 'working');
  elements.percentLabel.textContent = `${safePercent}%`;
  elements.progressBar.style.width = `${safePercent}%`;
  elements.message.textContent = message || '';
  elements.statusPill.textContent = titleCase(stage || 'Working');
  elements.statusPill.className = `status-pill ${stage || ''}`;
}

function setBusy(running, message) {
  state.running = running;
  if (message) setMessage(message);
  updateButtons();
}

function setMessage(message) {
  elements.message.textContent = message;
}

function setError(error) {
  setProgress({ stage: 'error', percent: 0, message: error?.message || String(error) });
}

function updateButtons() {
  const reviewedReady = state.preview?.readyToUpload && elements.reviewCheckbox.checked;
  elements.signInButton.disabled = state.running || !state.credentialsPath;
  elements.prepareButton.disabled = state.running || !state.zipPath;
  elements.zipExportButton.disabled = state.running || !reviewedReady;
  elements.applePhotosButton.disabled = state.running || !reviewedReady;
  elements.uploadButton.disabled = state.running || !reviewedReady || !state.signedIn;
  elements.cancelButton.disabled = !state.running;
  elements.zipButton.disabled = state.running;
  elements.credentialsButton.disabled = state.running;
  elements.openMergedButton.disabled = state.running || !state.preview?.mergedDir;
}

function titleCase(value) {
  return String(value)
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}
