const state = {
  zipPaths: [],
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
  clearLogButton: document.querySelector('#clearLogButton'),
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
  activityLog: document.querySelector('#activityLog'),
  totalMetric: document.querySelector('#totalMetric'),
  dateMetric: document.querySelector('#dateMetric'),
  gpsMetric: document.querySelector('#gpsMetric'),
  missingMetric: document.querySelector('#missingMetric'),
  skippedMetric: document.querySelector('#skippedMetric'),
  repairMetric: document.querySelector('#repairMetric'),
  warningMetric: document.querySelector('#warningMetric'),
  issueMetric: document.querySelector('#issueMetric'),
  oldestDate: document.querySelector('#oldestDate'),
  newestDate: document.querySelector('#newestDate'),
  duplicateMetric: document.querySelector('#duplicateMetric'),
  dateCoverageMetric: document.querySelector('#dateCoverageMetric'),
  gpsCoverageMetric: document.querySelector('#gpsCoverageMetric'),
  topMatchMetric: document.querySelector('#topMatchMetric'),
  timelineBars: document.querySelector('#timelineBars'),
  reviewList: document.querySelector('#reviewList'),
  reviewItems: document.querySelector('#reviewItems'),
  sampleRows: document.querySelector('#sampleRows')
};

elements.zipButton.addEventListener('click', async () => {
  const zipPaths = await window.snapImporter.chooseZip();
  if (!zipPaths?.length) return;
  state.zipPaths = zipPaths;
  state.preview = null;
  elements.zipPath.textContent = formatSelectedExports(zipPaths);
  hidePreview();
  setMessage(`${zipPaths.length} Snapchat export source${zipPaths.length === 1 ? '' : 's'} selected. Prepare a preview before uploading.`);
  updateButtons();
});

elements.credentialsButton.addEventListener('click', async () => {
  try {
    const credentialsPath = await window.snapImporter.chooseCredentials();
    if (!credentialsPath) return;
    state.credentialsPath = credentialsPath;
    state.signedIn = false;
    elements.credentialsPath.textContent = credentialsPath;
    elements.accountLabel.textContent = 'Not connected';
    updateButtons();
    await connectGoogle();
  } catch (error) {
    setError(error);
  } finally {
    setBusy(false);
    updateButtons();
  }
});

elements.signInButton.addEventListener('click', async () => {
  try {
    await connectGoogle();
  } catch (error) {
    setError(error);
  } finally {
    setBusy(false);
    updateButtons();
  }
});

elements.prepareButton.addEventListener('click', async () => {
  try {
    clearActivityLog();
    appendLogLine('Preparing preview run');
    setBusy(true, 'Preparing preview');
    state.preview = await window.snapImporter.prepareImport({ zipPaths: state.zipPaths });
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
    if (!state.signedIn) await connectGoogle();
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

async function connectGoogle() {
  if (!state.credentialsPath) {
    throw new Error('Choose the Google OAuth JSON first.');
  }
  setBusy(true, 'Opening Google login');
  appendLogLine('Opening Google login in your browser', 'connected');
  const account = await window.snapImporter.signIn(state.credentialsPath);
  state.signedIn = true;
  elements.accountLabel.textContent = account.email;
  setProgress({ stage: 'connected', percent: 0, message: 'Google Photos connected. Upload is available after preview approval.' });
}

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
  appendLogLine('Cancel requested. Waiting for the current file operation to finish.', 'cancel');
});

elements.clearLogButton.addEventListener('click', clearActivityLog);

window.snapImporter.onProgress((payload) => {
  setProgress(payload);
  appendProgressLog(payload);
});
if (window.snapImporter.platform !== 'darwin') {
  elements.applePhotosButton.title = 'Apple Photos import is only available on macOS.';
}
updateButtons();

function renderPreview(preview) {
  const verification = preview.verification;
  const timeline = preview.timelineAudit || verification.timeline || {};
  const reviewIssues = verification.issueFiles || [];
  elements.previewPanel.hidden = false;
  elements.reviewCheckbox.checked = false;
  elements.previewLocation.textContent = preview.mergedDir;
  elements.totalMetric.textContent = verification.total;
  elements.dateMetric.textContent = verification.withDate;
  elements.gpsMetric.textContent = verification.withGps;
  elements.missingMetric.textContent = verification.missingFiles;
  elements.skippedMetric.textContent = preview.skippedDownloadLinks?.length || 0;
  elements.repairMetric.textContent = (preview.mediaRepairResults || []).filter((item) => item.repaired).length;
  elements.warningMetric.textContent = (preview.exifWriteWarnings?.length || 0) + (verification.warnings?.length || 0);
  elements.issueMetric.textContent = reviewIssues.length;
  elements.oldestDate.textContent = formatDate(timeline.oldest);
  elements.newestDate.textContent = formatDate(timeline.newest);
  elements.duplicateMetric.textContent = timeline.duplicateTimestamps?.length || 0;
  elements.dateCoverageMetric.textContent = percent(verification.withDate, verification.total);
  elements.gpsCoverageMetric.textContent = percent(verification.withGps, verification.total);
  elements.topMatchMetric.textContent = topMatchLabel(verification.matchCounts);
  renderTimelineBars(timeline.byYear || {});
  renderReviewIssues(reviewIssues);
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
  elements.timelineBars.innerHTML = '';
  elements.reviewItems.innerHTML = '';
  elements.reviewList.hidden = true;
}

function cell(value) {
  const element = document.createElement('td');
  element.textContent = value;
  return element;
}

function renderTimelineBars(byYear) {
  elements.timelineBars.innerHTML = '';
  const entries = Object.entries(byYear).sort(([left], [right]) => left.localeCompare(right));
  const max = Math.max(...entries.map(([, count]) => count), 1);
  for (const [year, count] of entries) {
    const row = document.createElement('div');
    row.className = 'timeline-row';
    const label = document.createElement('span');
    label.textContent = year;
    const track = document.createElement('div');
    track.className = 'timeline-track';
    const bar = document.createElement('div');
    bar.style.width = `${Math.max(4, Math.round((count / max) * 100))}%`;
    track.append(bar);
    const value = document.createElement('strong');
    value.textContent = count;
    row.append(label, track, value);
    elements.timelineBars.append(row);
  }
}

function renderReviewIssues(issues) {
  elements.reviewItems.innerHTML = '';
  elements.reviewList.hidden = !issues.length;
  for (const item of issues.slice(0, 8)) {
    const li = document.createElement('li');
    li.textContent = `${titleCase(item.type || 'issue')}: ${item.fileName || 'Unknown file'}`;
    elements.reviewItems.append(li);
  }
  if (issues.length > 8) {
    const li = document.createElement('li');
    li.textContent = `${issues.length - 8} more in _Needs Review`;
    elements.reviewItems.append(li);
  }
}

function percent(value, total) {
  if (!total) return '0%';
  return `${Math.round((value / total) * 100)}%`;
}

function formatDate(value) {
  if (!value) return 'Unknown';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Unknown' : date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function topMatchLabel(matchCounts = {}) {
  const [name, count] = Object.entries(matchCounts).sort((left, right) => right[1] - left[1])[0] || [];
  return name ? `${titleCase(name)} (${count})` : 'Unknown';
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

function appendProgressLog(payload) {
  const detail = payload.detail || {};
  const complete = Number.isFinite(detail.complete) && Number.isFinite(detail.total)
    ? ` ${detail.complete}/${detail.total}`
    : '';
  const action = detail.action ? ` ${detail.action}` : '';
  appendLogLine(`${titleCase(payload.stage || 'working')}${action}${complete}: ${payload.message || ''}`, payload.stage);
}

function appendLogLine(message, stage = 'info') {
  const line = document.createElement('div');
  line.className = `terminal-line ${stage || 'info'}`;
  const time = new Date().toLocaleTimeString([], { hour12: false });
  line.textContent = `[${time}] ${message}`;
  elements.activityLog.append(line);
  while (elements.activityLog.children.length > 600) {
    elements.activityLog.firstElementChild?.remove();
  }
  elements.activityLog.scrollTop = elements.activityLog.scrollHeight;
}

function clearActivityLog() {
  elements.activityLog.innerHTML = '';
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
  elements.prepareButton.disabled = state.running || !state.zipPaths.length;
  elements.zipExportButton.disabled = state.running || !reviewedReady;
  elements.applePhotosButton.disabled = state.running || !reviewedReady || window.snapImporter.platform !== 'darwin';
  elements.uploadButton.disabled = state.running || !reviewedReady || (!state.signedIn && !state.credentialsPath);
  elements.cancelButton.disabled = !state.running;
  elements.zipButton.disabled = state.running;
  elements.credentialsButton.disabled = state.running;
  elements.openMergedButton.disabled = state.running || !state.preview?.mergedDir;
}

function formatSelectedExports(paths) {
  if (paths.length === 1) return paths[0];
  return `${paths.length} selected: ${paths.map((item) => item.split(/[\\/]/).pop()).join(', ')}`;
}

function titleCase(value) {
  return String(value)
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}
