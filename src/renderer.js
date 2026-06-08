const state = {
  zipPaths: [],
  signedIn: false,
  running: false,
  preview: null,
  finalReport: null,
  lastError: null,
  googleAuthConfigured: true,
  activity: {
    lastStage: null,
    lastMilestones: {},
    stats: {
      merged: 0,
      exif: 0,
      downloads: 0,
      attention: 0
    }
  }
};

const elements = {
  zipButton: document.querySelector('#zipButton'),
  resumeButton: document.querySelector('#resumeButton'),
  signInButton: document.querySelector('#signInButton'),
  createAlbumsCheckbox: document.querySelector('#createAlbumsCheckbox'),
  preflightButton: document.querySelector('#preflightButton'),
  sampleButton: document.querySelector('#sampleButton'),
  prepareButton: document.querySelector('#prepareButton'),
  uploadButton: document.querySelector('#uploadButton'),
  zipExportButton: document.querySelector('#zipExportButton'),
  applePhotosButton: document.querySelector('#applePhotosButton'),
  deleteDuplicatesButton: document.querySelector('#deleteDuplicatesButton'),
  cancelButton: document.querySelector('#cancelButton'),
  clearLogButton: document.querySelector('#clearLogButton'),
  openMergedButton: document.querySelector('#openMergedButton'),
  openSummaryButton: document.querySelector('#openSummaryButton'),
  openFinalReportButton: document.querySelector('#openFinalReportButton'),
  openFinalFolderButton: document.querySelector('#openFinalFolderButton'),
  openFinalZipButton: document.querySelector('#openFinalZipButton'),
  cleanupButton: document.querySelector('#cleanupButton'),
  diagnosticsButton: document.querySelector('#diagnosticsButton'),
  releaseReadinessButton: document.querySelector('#releaseReadinessButton'),
  macHelpButton: document.querySelector('#macHelpButton'),
  windowsHelpButton: document.querySelector('#windowsHelpButton'),
  updatesButton: document.querySelector('#updatesButton'),
  openNeedsReviewButton: document.querySelector('#openNeedsReviewButton'),
  reviewCheckbox: document.querySelector('#reviewCheckbox'),
  zipPath: document.querySelector('#zipPath'),
  accountLabel: document.querySelector('#accountLabel'),
  workflowSelect: document.querySelector('#workflowSelect'),
  workflowPreview: document.querySelector('#workflowPreview'),
  workflowSend: document.querySelector('#workflowSend'),
  actionTitle: document.querySelector('#actionTitle'),
  actionHint: document.querySelector('#actionHint'),
  statusPill: document.querySelector('#statusPill'),
  stageLabel: document.querySelector('#stageLabel'),
  percentLabel: document.querySelector('#percentLabel'),
  progressBar: document.querySelector('#progressBar'),
  message: document.querySelector('#message'),
  emptyState: document.querySelector('#emptyState'),
  preflightPanel: document.querySelector('#preflightPanel'),
  preflightSummary: document.querySelector('#preflightSummary'),
  preflightGrid: document.querySelector('#preflightGrid'),
  previewPanel: document.querySelector('#previewPanel'),
  previewLocation: document.querySelector('#previewLocation'),
  readinessBanner: document.querySelector('#readinessBanner'),
  readinessTitle: document.querySelector('#readinessTitle'),
  readinessDetail: document.querySelector('#readinessDetail'),
  qualityPill: document.querySelector('#qualityPill'),
  activityLog: document.querySelector('#activityLog'),
  currentActivity: document.querySelector('#currentActivity'),
  currentActivityDetail: document.querySelector('#currentActivityDetail'),
  mergedStat: document.querySelector('#mergedStat'),
  exifStat: document.querySelector('#exifStat'),
  downloadStat: document.querySelector('#downloadStat'),
  attentionStat: document.querySelector('#attentionStat'),
  totalMetric: document.querySelector('#totalMetric'),
  dateMetric: document.querySelector('#dateMetric'),
  gpsMetric: document.querySelector('#gpsMetric'),
  missingMetric: document.querySelector('#missingMetric'),
  skippedMetric: document.querySelector('#skippedMetric'),
  repairMetric: document.querySelector('#repairMetric'),
  warningMetric: document.querySelector('#warningMetric'),
  issueMetric: document.querySelector('#issueMetric'),
  duplicateFileMetric: document.querySelector('#duplicateFileMetric'),
  oldestDate: document.querySelector('#oldestDate'),
  newestDate: document.querySelector('#newestDate'),
  duplicateMetric: document.querySelector('#duplicateMetric'),
  riskScoreMetric: document.querySelector('#riskScoreMetric'),
  riskScoreDetail: document.querySelector('#riskScoreDetail'),
  albumPlanMetric: document.querySelector('#albumPlanMetric'),
  albumPlanDetail: document.querySelector('#albumPlanDetail'),
  dateRecoveryMetric: document.querySelector('#dateRecoveryMetric'),
  dateCoverageMetric: document.querySelector('#dateCoverageMetric'),
  gpsCoverageMetric: document.querySelector('#gpsCoverageMetric'),
  topMatchMetric: document.querySelector('#topMatchMetric'),
  timelineBars: document.querySelector('#timelineBars'),
  albumPlanList: document.querySelector('#albumPlanList'),
  reviewList: document.querySelector('#reviewList'),
  reviewItems: document.querySelector('#reviewItems'),
  duplicateReview: document.querySelector('#duplicateReview'),
  duplicateSummary: document.querySelector('#duplicateSummary'),
  duplicateItems: document.querySelector('#duplicateItems'),
  fixProblemsPanel: document.querySelector('#fixProblemsPanel'),
  fixProblemsSummary: document.querySelector('#fixProblemsSummary'),
  fixProblemItems: document.querySelector('#fixProblemItems'),
  metadataInspectorSummary: document.querySelector('#metadataInspectorSummary'),
  metadataInspectorSelect: document.querySelector('#metadataInspectorSelect'),
  metadataInspector: document.querySelector('#metadataInspector'),
  finalReportPanel: document.querySelector('#finalReportPanel'),
  finalReportTitle: document.querySelector('#finalReportTitle'),
  finalReportDetail: document.querySelector('#finalReportDetail'),
  finalReportPill: document.querySelector('#finalReportPill'),
  finalReportMetrics: document.querySelector('#finalReportMetrics'),
  sampleRows: document.querySelector('#sampleRows')
};

elements.zipButton.addEventListener('click', async () => {
  const zipPaths = await window.snapImporter.chooseZip();
  if (!zipPaths?.length) return;
  state.zipPaths = zipPaths;
  state.preview = null;
  state.finalReport = null;
  elements.zipPath.textContent = formatSelectedExports(zipPaths);
  hidePreview();
  hideFinalReport();
  hidePreflight();
  setMessage(`${zipPaths.length} Snapchat export source${zipPaths.length === 1 ? '' : 's'} selected. Start with Test 25 for a quick metadata check, then run the full preview.`);
  updateButtons();
});

elements.resumeButton.addEventListener('click', async () => {
  try {
    clearActivityLog();
    hideFinalReport();
    setBusy(true, 'Resuming last preview');
    state.preview = await window.snapImporter.resumeLastPreview();
    state.zipPaths = state.preview.zipPaths || [];
    elements.zipPath.textContent = state.zipPaths.length ? formatSelectedExports(state.zipPaths) : 'Restored from last session';
    renderPreview(state.preview);
    setProgress({
      stage: 'preview-ready',
      percent: 100,
      message: `Resumed ${state.preview.verification.total} merged files from the last session.`
    });
  } catch (error) {
    setError(error);
  } finally {
    setBusy(false);
    updateButtons();
  }
});

elements.signInButton.addEventListener('click', async () => {
  try {
    await startGoogleUploadFlow();
  } catch (error) {
    setError(error);
  } finally {
    setBusy(false);
    updateButtons();
  }
});

elements.prepareButton.addEventListener('click', async () => {
  await preparePreview();
});

elements.sampleButton.addEventListener('click', async () => {
  await preparePreview({ sampleLimit: 25 });
});

async function preparePreview(options = {}) {
  try {
    clearActivityLog();
    hideFinalReport();
    appendLogLine(options.sampleLimit ? `Preparing ${options.sampleLimit}-file sample run` : 'Preparing preview run');
    setBusy(true, options.sampleLimit ? 'Preparing sample preview' : 'Preparing preview');
    state.preview = await window.snapImporter.prepareImport({ zipPaths: state.zipPaths, ...options });
    state.lastError = null;
    renderPreview(state.preview);
    setProgress({
      stage: 'preview-ready',
      percent: 100,
      message: state.preview.sampleRun
        ? `Sample preview ready. Review ${state.preview.verification.total} files, then run the full preview when ready.`
        : `Preview ready. Review ${state.preview.verification.total} files, then choose a destination.`
    });
  } catch (error) {
    setError(error);
  } finally {
    setBusy(false);
    updateButtons();
  }
}

elements.preflightButton.addEventListener('click', async () => {
  try {
    setBusy(true, 'Running preflight');
    const report = await window.snapImporter.runPreflight({ zipPaths: state.zipPaths });
    renderPreflight(report);
    setProgress({
      stage: report.hasEnoughSpace ? 'complete' : 'warning',
      percent: 100,
      message: report.recommendation
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
    await startGoogleUploadFlow();
  } catch (error) {
    setError(error);
  } finally {
    setBusy(false);
    updateButtons();
  }
});

async function startGoogleUploadFlow() {
  if (!state.googleAuthConfigured) {
    setGoogleAuthMissing();
    return;
  }
  if (!state.preview) {
    setProgress({ stage: 'waiting', percent: 0, message: 'Prepare a preview before uploading to Google Photos.' });
    return;
  }
  if (!elements.reviewCheckbox.checked) {
    setProgress({ stage: 'waiting', percent: 100, message: 'Review the preview and tick the approval box before Google upload.' });
    return;
  }
  if (!state.preview.readyToUpload) {
    setProgress({ stage: 'error', percent: 0, message: 'Preview is not ready for upload. Check the review items first.' });
    return;
  }

  if (!state.signedIn) await connectGoogle();
  setBusy(true, 'Uploading to Google Photos');
  appendLogLine('Google login complete. Uploading reviewed files to Google Photos', 'uploading');
  const report = await window.snapImporter.uploadPrepared({ createAlbums: elements.createAlbumsCheckbox.checked });
  setProgress({
    stage: 'complete',
    percent: 100,
    message: `Uploaded ${report.uploadedFiles} files. Report saved in ${report.mergedDir}`
  });
  renderFinalReport('Google Photos Upload', report);
}

async function connectGoogle() {
  setBusy(true, 'Opening Google login');
  appendLogLine('Opening Google login in your browser. Upload starts after login.', 'connected');
  const account = await window.snapImporter.signIn();
  state.signedIn = true;
  elements.accountLabel.textContent = account.email;
  setProgress({ stage: 'connected', percent: 0, message: 'Google Photos connected. Starting upload now.' });
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
    renderFinalReport('ZIP Export', report);
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
      message: report.applePhotosSkippedFiles
        ? `Imported ${report.applePhotosImportedFiles} files into Apple Photos. ${report.applePhotosSkippedFiles} need review.`
        : `Imported ${report.applePhotosImportedFiles} files into Apple Photos.`
    });
    renderFinalReport('Apple Photos Import', report);
  } catch (error) {
    setError(error);
  } finally {
    setBusy(false);
    updateButtons();
  }
});

elements.cleanupButton.addEventListener('click', async () => {
  try {
    setBusy(true, 'Cleaning generated artifacts');
    const report = await window.snapImporter.cleanupArtifacts({
      removeNeedsReview: true,
      removeMergedOutput: false,
      removeExportZip: false
    });
    renderFinalReport('Cleanup', report);
    setProgress({ stage: 'complete', percent: 100, message: `Cleanup report saved at ${report.reportPath}` });
  } catch (error) {
    setError(error);
  } finally {
    setBusy(false);
    updateButtons();
  }
});

elements.diagnosticsButton.addEventListener('click', async () => {
  try {
    setBusy(true, 'Creating support bundle');
    const report = await window.snapImporter.exportDiagnostics();
    await window.snapImporter.openPath(report.diagnosticsPath);
    setProgress({ stage: 'complete', percent: 100, message: `Support bundle exported to ${report.diagnosticsPath}` });
  } catch (error) {
    setError(error);
  } finally {
    setBusy(false);
    updateButtons();
  }
});

elements.macHelpButton.addEventListener('click', () => openProjectLink('https://github.com/shahakshat14/snapchat-memories-importer/blob/main/docs/MAC_INSTALL.md'));
elements.windowsHelpButton.addEventListener('click', () => openProjectLink('https://github.com/shahakshat14/snapchat-memories-importer/blob/main/docs/WINDOWS_INSTALL.md'));
elements.updatesButton.addEventListener('click', () => openProjectLink('https://github.com/shahakshat14/snapchat-memories-importer/releases/latest'));

async function openProjectLink(url) {
  try {
    await window.snapImporter.openExternal(url);
  } catch (error) {
    setError(error);
  }
}

elements.releaseReadinessButton.addEventListener('click', async () => {
  try {
    setBusy(true, 'Checking release readiness');
    const report = await window.snapImporter.releaseReadiness();
    renderReleaseReadiness(report);
    setProgress({
      stage: report.blockers?.length ? 'warning' : 'complete',
      percent: 100,
      message: report.blockers?.length ? `${report.blockers.length} public launch blocker${report.blockers.length === 1 ? '' : 's'} remain.` : 'Release readiness looks good.'
    });
  } catch (error) {
    setError(error);
  } finally {
    setBusy(false);
    updateButtons();
  }
});

elements.deleteDuplicatesButton.addEventListener('click', async () => {
  const duplicateCount = state.preview?.verification?.duplicateFiles || 0;
  if (!duplicateCount) return;
  const confirmed = window.confirm(`Move ${duplicateCount} exact duplicate file${duplicateCount === 1 ? '' : 's'} from the merged output folder to Trash? Snapchat export zips and kept copies will not be touched.`);
  if (!confirmed) return;
  try {
    setBusy(true, 'Moving duplicate files to Trash');
    const report = await window.snapImporter.deleteReviewedDuplicates();
    state.preview = report.preview;
    renderPreview(state.preview);
    setProgress({
      stage: 'preview-ready',
      percent: 100,
      message: `Moved ${report.deletedFiles} duplicate file${report.deletedFiles === 1 ? '' : 's'} to Trash and refreshed the preview.`
    });
    renderFinalReport('Duplicate Cleanup', report);
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

elements.openSummaryButton.addEventListener('click', async () => {
  const summaryPath = state.preview?.reviewArtifacts?.summaryPath;
  if (!summaryPath) return;
  try {
    await window.snapImporter.openPath(summaryPath);
  } catch (error) {
    setError(error);
  }
});

elements.openFinalReportButton.addEventListener('click', async () => {
  const reportPath = state.finalReport?.reportPath;
  if (!reportPath) return;
  try {
    await window.snapImporter.openPath(reportPath);
  } catch (error) {
    setError(error);
  }
});

elements.openFinalFolderButton.addEventListener('click', async () => {
  const folderPath = state.finalReport?.mergedDir || state.preview?.mergedDir;
  if (!folderPath) return;
  try {
    await window.snapImporter.openPath(folderPath);
  } catch (error) {
    setError(error);
  }
});

elements.openFinalZipButton.addEventListener('click', async () => {
  const zipPath = state.finalReport?.exportedZipPath;
  if (!zipPath) return;
  try {
    await window.snapImporter.openPath(zipPath);
  } catch (error) {
    setError(error);
  }
});

elements.openNeedsReviewButton.addEventListener('click', async () => {
  const reviewDir = state.preview?.reviewArtifacts?.reviewDir;
  if (!reviewDir) return;
  try {
    await window.snapImporter.openPath(reviewDir);
  } catch (error) {
    setError(error);
  }
});

elements.metadataInspectorSelect.addEventListener('change', () => {
  const comparisons = state.preview?.verification?.metadataComparisons || [];
  renderMetadataInspector(comparisons[Number(elements.metadataInspectorSelect.value)] || null);
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
refreshGoogleAuthStatus();
refreshLastSessionStatus();
updateButtons();

async function refreshGoogleAuthStatus() {
  if (!window.snapImporter.googleAuthStatus) return;
  try {
    const status = await window.snapImporter.googleAuthStatus();
    state.googleAuthConfigured = status.configured;
    if (!status.configured) {
      elements.accountLabel.textContent = 'Google sign-in not configured in this build';
      elements.signInButton.title = status.message || 'Google sign-in is not configured in this build.';
    } else if (!state.signedIn) {
      elements.accountLabel.textContent = 'After preview approval, login opens in your browser';
      elements.signInButton.title = '';
    }
  } catch {
    state.googleAuthConfigured = false;
    elements.accountLabel.textContent = 'Google sign-in status unavailable';
  } finally {
    updateButtons();
  }
}

async function refreshLastSessionStatus() {
  if (!window.snapImporter.lastSessionStatus) return;
  try {
    const status = await window.snapImporter.lastSessionStatus();
    if (!status.available) return;
    const interrupted = status.lastOperation;
    elements.resumeButton.textContent = interrupted ? 'Resume Interrupted Run' : 'Resume Last Preview';
    elements.resumeButton.title = interrupted
      ? `${titleCase(interrupted.operation)} stopped at ${interrupted.imported || interrupted.completedBatches || 0} processed.`
      : `Last preview saved ${formatDate(status.savedAt)}.`;
    if (interrupted) {
      setMessage(`A previous ${titleCase(interrupted.operation)} run can be resumed from the last prepared preview.`);
    }
  } catch {
    elements.resumeButton.textContent = 'Resume';
  }
}

function renderPreview(preview) {
  const verification = preview.verification;
  const timeline = preview.timelineAudit || verification.timeline || {};
  const reviewIssues = verification.issueFiles || [];
  elements.emptyState.hidden = true;
  elements.previewPanel.hidden = false;
  elements.reviewCheckbox.checked = false;
  elements.previewLocation.textContent = preview.sampleRun
    ? `Sample run: ${preview.verification.total} of ${preview.totalCandidateFiles || 'many'} candidates. ${preview.mergedDir}`
    : preview.mergedDir;
  elements.totalMetric.textContent = verification.total;
  elements.dateMetric.textContent = verification.withDate;
  elements.gpsMetric.textContent = verification.withGps;
  elements.missingMetric.textContent = verification.missingFiles;
  elements.skippedMetric.textContent = preview.skippedDownloadLinks?.length || 0;
  elements.repairMetric.textContent = (preview.mediaRepairResults || []).filter((item) => item.repaired).length;
  elements.warningMetric.textContent = (preview.exifWriteWarnings?.length || 0) + (verification.warnings?.length || 0);
  elements.issueMetric.textContent = reviewIssues.length;
  elements.duplicateFileMetric.textContent = verification.duplicateFiles || 0;
  elements.oldestDate.textContent = formatDate(timeline.oldest);
  elements.newestDate.textContent = formatDate(timeline.newest);
  elements.duplicateMetric.textContent = timeline.duplicateTimestamps?.length || 0;
  renderRiskScore(preview.riskScore);
  renderAlbumPlan(preview.albumPlan || []);
  elements.dateRecoveryMetric.textContent = (verification.metadataComparisons || []).filter((item) => item.dateSource === 'filename').length;
  elements.dateCoverageMetric.textContent = percent(verification.withDate, verification.total);
  elements.gpsCoverageMetric.textContent = percent(verification.withGps, verification.total);
  elements.topMatchMetric.textContent = topMatchLabel(verification.matchCounts);
  renderReadiness(preview, reviewIssues);
  renderTimelineBars(timeline.byYear || {});
  renderReviewIssues(reviewIssues);
  renderDuplicateReview(verification.duplicateFileGroups || []);
  renderFixProblems();
  renderMetadataInspectorPicker(verification.metadataComparisons || []);
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
  elements.emptyState.hidden = false;
  elements.previewPanel.hidden = true;
  elements.reviewCheckbox.checked = false;
  elements.sampleRows.innerHTML = '';
  elements.timelineBars.innerHTML = '';
  elements.albumPlanList.innerHTML = '';
  elements.riskScoreMetric.textContent = '--';
  elements.riskScoreDetail.textContent = 'Waiting for preview';
  elements.albumPlanMetric.textContent = '0';
  elements.albumPlanDetail.textContent = 'Monthly Snapchat albums';
  elements.dateRecoveryMetric.textContent = '0';
  elements.reviewItems.innerHTML = '';
  elements.reviewList.hidden = true;
  elements.duplicateItems.innerHTML = '';
  elements.duplicateReview.hidden = true;
  elements.fixProblemItems.innerHTML = '';
  elements.fixProblemsPanel.hidden = true;
  elements.metadataInspectorSelect.innerHTML = '';
  elements.metadataInspector.innerHTML = '';
  elements.metadataInspectorSummary.textContent = 'Before and after metadata checks appear after preview.';
  renderWorkflow('select');
}

function hideFinalReport() {
  state.finalReport = null;
  elements.finalReportPanel.hidden = true;
  elements.finalReportMetrics.innerHTML = '';
  elements.finalReportDetail.textContent = '';
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

function renderRiskScore(riskScore) {
  if (!riskScore) {
    elements.riskScoreMetric.textContent = '--';
    elements.riskScoreDetail.textContent = 'Waiting for preview';
    return;
  }
  elements.riskScoreMetric.textContent = `${riskScore.score}`;
  elements.riskScoreDetail.textContent = `${titleCase(riskScore.level)} confidence. ${riskScore.dateCoverage}% dates, ${riskScore.gpsCoverage}% GPS.`;
}

function renderAlbumPlan(albumPlan) {
  elements.albumPlanMetric.textContent = albumPlan.length;
  elements.albumPlanDetail.textContent = albumPlan.length ? `${albumPlan.reduce((total, album) => total + album.count, 0)} files grouped by month` : 'Monthly Snapchat albums';
  elements.albumPlanList.innerHTML = '';
  for (const album of albumPlan.slice(0, 8)) {
    const row = document.createElement('div');
    const title = document.createElement('strong');
    title.textContent = album.title;
    const count = document.createElement('span');
    count.textContent = `${album.count} file${album.count === 1 ? '' : 's'}`;
    row.append(title, count);
    elements.albumPlanList.append(row);
  }
  if (albumPlan.length > 8) {
    const row = document.createElement('div');
    row.className = 'album-more';
    row.textContent = `${albumPlan.length - 8} more album${albumPlan.length - 8 === 1 ? '' : 's'} in the final report`;
    elements.albumPlanList.append(row);
  }
}

function renderPreflight(report) {
  elements.preflightPanel.hidden = false;
  elements.preflightSummary.textContent = report.hasEnoughSpace
    ? 'Storage looks ready'
    : 'More free space recommended';
  elements.preflightGrid.innerHTML = '';
  const rows = [
    ['Exports', `${report.zipCount} files`],
    ['Input size', formatBytes(report.zipBytes)],
    ['Needed', formatBytes(report.requiredBytes)],
    ['Available', formatBytes(report.freeBytes)],
    ['Estimate', `${report.estimatedMinutes} min`],
    ['Status', report.hasEnoughSpace ? 'Ready' : 'Low space']
  ];
  for (const [label, value] of rows) {
    const card = document.createElement('div');
    const strong = document.createElement('strong');
    strong.textContent = value;
    const small = document.createElement('small');
    small.textContent = label;
    card.append(strong, small);
    elements.preflightGrid.append(card);
  }
}

function hidePreflight() {
  elements.preflightPanel.hidden = true;
  elements.preflightGrid.innerHTML = '';
}

function renderReleaseReadiness(report) {
  const pseudoReport = {
    reportPath: null,
    mergedDir: state.preview?.mergedDir,
    releaseReadiness: report,
    preview: state.preview,
    verification: state.preview?.verification,
    releaseCheckedAt: report.checkedAt
  };
  renderFinalReport('Release Readiness', pseudoReport);
  elements.finalReportDetail.textContent = report.blockers?.length
    ? report.blockers.join(' ')
    : 'No public launch blockers detected.';
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

function renderDuplicateReview(groups) {
  elements.duplicateItems.innerHTML = '';
  const duplicateCount = groups.reduce((total, group) => total + (group.duplicateCount || 0), 0);
  elements.duplicateReview.hidden = !duplicateCount;
  elements.duplicateSummary.textContent = duplicateCount
    ? `${duplicateCount} exact duplicate file${duplicateCount === 1 ? '' : 's'} across ${groups.length} group${groups.length === 1 ? '' : 's'}. One keeper is preserved in each group.`
    : '';
  for (const group of groups.slice(0, 6)) {
    const li = document.createElement('li');
    const keeper = document.createElement('strong');
    keeper.textContent = `Keep: ${group.keeper?.fileName || 'Unknown file'}`;
    const duplicates = document.createElement('span');
    duplicates.textContent = `Trash candidates: ${(group.duplicates || []).map((item) => item.fileName).slice(0, 4).join(', ')}${group.duplicateCount > 4 ? `, +${group.duplicateCount - 4} more` : ''}`;
    li.append(keeper, duplicates);
    elements.duplicateItems.append(li);
  }
  if (groups.length > 6) {
    const li = document.createElement('li');
    li.textContent = `${groups.length - 6} more duplicate group${groups.length - 6 === 1 ? '' : 's'} in the Import Summary`;
    elements.duplicateItems.append(li);
  }
}

function renderFixProblems() {
  const problems = buildTroubleshooterItems();
  const activeProblems = problems.filter((item) => item.status !== 'ok');
  elements.fixProblemsPanel.hidden = !activeProblems.length;
  elements.fixProblemItems.innerHTML = '';
  elements.fixProblemsSummary.textContent = activeProblems.length
    ? `${activeProblems.length} thing${activeProblems.length === 1 ? '' : 's'} may need attention before uploading.`
    : 'No known problems detected.';
  elements.openNeedsReviewButton.disabled = !state.preview?.reviewArtifacts?.reviewDir;

  for (const item of activeProblems) {
    const row = document.createElement('article');
    row.className = `fix-item ${item.status}`;
    const badge = document.createElement('span');
    badge.className = 'fix-badge';
    badge.textContent = item.status === 'blocked' ? 'Blocked' : 'Fix';
    const body = document.createElement('div');
    const title = document.createElement('strong');
    title.textContent = item.title;
    const detail = document.createElement('p');
    detail.textContent = item.detail;
    const action = document.createElement('small');
    action.textContent = item.action;
    body.append(title, detail, action);
    row.append(badge, body);
    elements.fixProblemItems.append(row);
  }
}

function buildTroubleshooterItems() {
  const preview = state.preview || {};
  const verification = preview.verification || {};
  const issueFiles = verification.issueFiles || [];
  const skippedLinks = preview.skippedDownloadLinks || [];
  const repairResults = preview.mediaRepairResults || [];
  const exifWarnings = preview.exifWriteWarnings || [];
  const lastError = classifyLastError(state.lastError);
  const filenameRecovered = (verification.metadataComparisons || []).filter((item) => item.dateSource === 'filename').length
    || (verification.sample || []).filter((item) => item.dateSource === 'filename').length;
  const missingDates = issueFiles.filter((item) => item.type === 'missing-date').length;
  const expiredLinks = skippedLinks.filter((item) => /403|404|expired|missing|denied|forbidden|not found/i.test(`${item.reason || ''} ${item.url || ''}`)).length;
  const damagedVideos = repairResults.filter((item) => item.repaired === false).length || exifWarnings.filter((item) => /repair|video|ffmpeg|QuickTime/i.test(item.reason || '')).length;
  const exifFailures = exifWarnings.length + (verification.warnings?.length || 0);

  return [
    {
      title: 'Damaged Videos Detected',
      status: damagedVideos ? 'warn' : 'ok',
      detail: `${damagedVideos} video${damagedVideos === 1 ? '' : 's'} could not be repaired automatically.`,
      action: 'Open _Needs Review/Damaged Videos, play the copies, and decide whether to keep, replace, or skip them.'
    },
    {
      title: 'Snapchat Links Expired',
      status: expiredLinks ? 'blocked' : 'ok',
      detail: `${expiredLinks || skippedLinks.length} linked media download${(expiredLinks || skippedLinks.length) === 1 ? '' : 's'} failed.`,
      action: 'Request a fresh Snapchat My Data export; expired hosted links usually cannot be recovered locally.'
    },
    {
      title: 'OAuth Not Configured',
      status: state.googleAuthConfigured ? 'ok' : 'blocked',
      detail: 'Google Photos browser login cannot open until the app has a Google OAuth Desktop client.',
      action: 'Use ZIP export or Apple Photos now, or rebuild/package the app with the OAuth client config.'
    },
    {
      title: 'Google Quota Or Permission Issue',
      status: lastError.google ? 'blocked' : 'ok',
      detail: lastError.google || 'No Google quota or permission error detected.',
      action: 'Retry later for quota/rate limits; for permission errors, sign in again and confirm the Google Photos upload scope.'
    },
    {
      title: 'Apple Photos Permission Issue',
      status: lastError.apple ? 'blocked' : 'ok',
      detail: lastError.apple || 'No Apple Photos permission error detected.',
      action: 'Open macOS System Settings, allow Photos/Automation access for the app, then retry Apple Photos import.'
    },
    {
      title: 'EXIFTool Failure',
      status: exifFailures ? 'warn' : 'ok',
      detail: `${exifFailures} metadata write/read warning${exifFailures === 1 ? '' : 's'} detected.`,
      action: 'Open the summary and _Needs Review. The app keeps going, but those files should be spot-checked.'
    },
    {
      title: 'Missing Dates',
      status: missingDates ? 'warn' : 'ok',
      detail: missingDates
        ? `${missingDates} file${missingDates === 1 ? '' : 's'} still missing dates. ${filenameRecovered} sampled file${filenameRecovered === 1 ? '' : 's'} used filename date recovery.`
        : filenameRecovered
          ? `${filenameRecovered} sampled file${filenameRecovered === 1 ? '' : 's'} recovered dates from filenames.`
          : 'No missing dates detected.',
      action: missingDates
        ? 'If the filename includes a date, rebuild the preview; otherwise edit those files manually in _Needs Review/Missing Dates.'
        : 'No action needed.'
    }
  ];
}

function classifyLastError(error) {
  const message = error?.message || '';
  const google = /Google|photoslibrary|quota|permission|403|429|401|insufficient|rate/i.test(message)
    ? message
    : '';
  const apple = /Apple Photos|osascript|Photos|not authorized|automation|permission|privacy/i.test(message)
    ? message
    : '';
  return { google, apple };
}

function renderMetadataInspectorPicker(comparisons) {
  elements.metadataInspectorSelect.innerHTML = '';
  elements.metadataInspectorSummary.textContent = comparisons.length
    ? `${comparisons.length} sampled file${comparisons.length === 1 ? '' : 's'} checked against the Snapchat metadata and final embedded tags.`
    : 'No metadata comparison sample was available for this preview.';

  for (const [index, item] of comparisons.entries()) {
    const option = document.createElement('option');
    option.value = String(index);
    option.textContent = item.fileName || `Sample ${index + 1}`;
    elements.metadataInspectorSelect.append(option);
  }
  elements.metadataInspectorSelect.disabled = !comparisons.length;
  renderMetadataInspector(comparisons[0] || null);
}

function renderMetadataInspector(item) {
  elements.metadataInspector.innerHTML = '';
  if (!item) {
    const empty = document.createElement('div');
    empty.className = 'metadata-empty';
    empty.textContent = 'No metadata sample to inspect.';
    elements.metadataInspector.append(empty);
    return;
  }

  elements.metadataInspector.append(
    metadataColumn('Before: Snapchat Export', [
      ['Date', formatMetadataValue(item.snapchat?.date)],
      ['GPS', formatGps(item.snapchat?.latitude, item.snapchat?.longitude)],
      ['Match', titleCase(item.matchedBy || 'unknown')],
      ['Source JSON', compactPath(item.snapchat?.sourceFile)]
    ]),
    metadataColumn('Before: Original File', [
      ['Date', formatMetadataValue(item.originalEmbedded?.date)],
      ['GPS', formatGps(item.originalEmbedded?.latitude, item.originalEmbedded?.longitude)],
      ['Original file', item.originalFileName || 'Unavailable'],
      ['Source', titleCase(item.source || 'unknown')]
    ]),
    metadataColumn('After: Merged File', [
      ['Date', formatMetadataValue(item.mergedEmbedded?.date)],
      ['GPS', formatGps(item.mergedEmbedded?.latitude, item.mergedEmbedded?.longitude)],
      ['Date result', metadataStatusLabel(item.status?.date)],
      ['GPS result', metadataStatusLabel(item.status?.gps)]
    ])
  );
}

function metadataColumn(title, rows) {
  const column = document.createElement('section');
  column.className = 'metadata-column';
  const heading = document.createElement('h4');
  heading.textContent = title;
  const list = document.createElement('dl');
  for (const [label, value] of rows) {
    const row = document.createElement('div');
    const term = document.createElement('dt');
    term.textContent = label;
    const description = document.createElement('dd');
    description.textContent = value || 'Missing';
    row.append(term, description);
    list.append(row);
  }
  column.append(heading, list);
  return column;
}

function renderFinalReport(title, report) {
  state.finalReport = report;
  elements.finalReportPanel.hidden = false;
  elements.finalReportTitle.textContent = title;
  elements.finalReportPill.textContent = 'Complete';
  elements.finalReportDetail.textContent = finalReportDetail(title, report);
  elements.finalReportMetrics.innerHTML = '';
  for (const [label, value] of finalReportMetrics(title, report)) {
    const card = document.createElement('div');
    const strong = document.createElement('strong');
    strong.textContent = String(value);
    const small = document.createElement('small');
    small.textContent = label;
    card.append(strong, small);
    elements.finalReportMetrics.append(card);
  }
  elements.openFinalReportButton.disabled = !report.reportPath;
  elements.openFinalFolderButton.disabled = !report.mergedDir;
  elements.openFinalZipButton.hidden = !report.exportedZipPath;
  elements.openFinalZipButton.disabled = !report.exportedZipPath;
  elements.finalReportPanel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function finalReportDetail(title, report) {
  if (report.exportedZipPath) return `Merged ZIP is ready at ${report.exportedZipPath}`;
  if (report.uploadedAt) return `Google Photos upload finished. Report saved in ${report.mergedDir}.`;
  if (report.applePhotosImportedAt) {
    return report.applePhotosSkippedFiles
      ? `Apple Photos accounted for ${report.applePhotosAccountedFiles || report.applePhotosImportedFiles} files. ${report.applePhotosSkippedFiles} file${report.applePhotosSkippedFiles === 1 ? '' : 's'} need review. Report saved in ${report.mergedDir}.`
      : `Apple Photos has all importable files. Report saved in ${report.mergedDir}.`;
  }
  if (report.deletedAt) return `Duplicate cleanup finished. The preview was refreshed and a cleanup report was saved.`;
  return `${title} finished. Report saved in ${report.mergedDir || 'the output folder'}.`;
}

function finalReportMetrics(title, report) {
  const verification = report.preview?.verification || report.verification || state.preview?.verification || {};
  const rows = [
    ['Merged files', verification.total || report.mergedFileCount || 0],
    ['With dates', verification.withDate || 0],
    ['With GPS', verification.withGps || 0]
  ];
  if (report.uploadedFiles !== undefined) rows.unshift(['Uploaded', report.uploadedFiles]);
  if (report.createdAlbums?.length) rows.unshift(['Albums', report.createdAlbums.length]);
  if (report.uploadVerification) rows.unshift(['Verified', report.uploadVerification.passed ? 'Yes' : 'Review']);
  if (report.applePhotosImportedFiles !== undefined) rows.unshift(['Accounted for', report.applePhotosAccountedFiles || report.applePhotosImportedFiles]);
  if (report.applePhotosNewlyImportedFiles !== undefined) rows.unshift(['New imports', report.applePhotosNewlyImportedFiles]);
  if (report.applePhotosAlreadyImportedFiles !== undefined) rows.unshift(['Already there', report.applePhotosAlreadyImportedFiles]);
  if (report.applePhotosDuplicateResolvedFiles?.length) rows.push(['Duplicate resolved', report.applePhotosDuplicateResolvedFiles.length]);
  if (report.applePhotosSkippedFiles) rows.unshift(['Needs review', report.applePhotosSkippedFiles]);
  if (report.applePhotosVerification) rows.unshift(['Verified', report.applePhotosVerification.passed ? 'Yes' : 'Review']);
  if (report.applePhotosImportPlan?.batchCount) rows.push(['Photo batches', report.applePhotosImportPlan.batchCount]);
  if (report.exportedZipPath) rows.unshift(['ZIP files', 1]);
  if (report.deletedFiles !== undefined) rows.unshift(['Moved to Trash', report.deletedFiles]);
  if (report.cleaned) rows.unshift(['Cleaned', report.cleaned.length]);
  if (report.releaseReadiness) rows.unshift(['Blockers', report.releaseReadiness.blockers?.length || 0]);
  rows.push(['Exact duplicates', verification.duplicateFiles || 0]);
  rows.push(['Needs review', verification.issueFiles?.length || 0]);
  return rows;
}

function renderReadiness(preview, reviewIssues) {
  const verification = preview.verification || {};
  const warnings = (preview.exifWriteWarnings?.length || 0) + (verification.warnings?.length || 0);
  const skipped = preview.skippedDownloadLinks?.length || 0;
  const missing = verification.missingFiles || 0;
  const unreadable = verification.unreadableFiles || 0;
  const duplicates = verification.duplicateFiles || 0;
  const issueCount = reviewIssues.length + warnings + skipped + missing + unreadable + duplicates;
  const dateCoverage = percentNumber(verification.withDate, verification.total);
  const gpsCoverage = percentNumber(verification.withGps, verification.total);

  let level = 'good';
  let title = 'Ready to export or upload';
  let detail = `${dateCoverage}% date coverage and ${gpsCoverage}% GPS coverage across ${verification.total || 0} merged files.`;
  let quality = 'Clean preview';

  if (preview.sampleRun && verification.total) {
    title = 'Sample preview ready';
    detail = `${verification.total} sample files were merged and checked. Run the full preview before exporting or uploading.`;
    quality = 'Sample';
  } else if (!verification.total) {
    level = 'bad';
    title = 'Nothing ready yet';
    detail = 'No merged files were found in this preview.';
    quality = 'Blocked';
  } else if (missing || unreadable) {
    level = 'bad';
    title = 'Needs attention before upload';
    detail = `${missing} missing file${missing === 1 ? '' : 's'} and ${unreadable} unreadable file${unreadable === 1 ? '' : 's'} were found.`;
    quality = 'Review required';
  } else if (issueCount) {
    level = 'warn';
    title = 'Ready with review items';
    detail = duplicates
      ? `${issueCount} item${issueCount === 1 ? '' : 's'} should be checked before sending, including ${duplicates} exact duplicate file${duplicates === 1 ? '' : 's'}.`
      : `${issueCount} item${issueCount === 1 ? '' : 's'} should be checked in _Needs Review or the summary before sending.`;
    quality = 'Check summary';
  }

  elements.readinessBanner.className = `readiness ${level}`;
  elements.readinessTitle.textContent = title;
  elements.readinessDetail.textContent = detail;
  elements.qualityPill.textContent = quality;
}

function percent(value, total) {
  if (!total) return '0%';
  return `${percentNumber(value, total)}%`;
}

function percentNumber(value, total) {
  if (!total) return 0;
  return Math.round((value / total) * 100);
}

function formatDate(value) {
  if (!value) return 'Unknown';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Unknown' : date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function formatMetadataValue(value) {
  if (!value) return 'Missing';
  const date = new Date(value);
  if (!Number.isNaN(date.getTime())) {
    return date.toLocaleString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
  }
  return String(value);
}

function formatGps(latitude, longitude) {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return 'Missing';
  return `${latitude.toFixed(6)}, ${longitude.toFixed(6)}`;
}

function formatBytes(bytes) {
  const value = Number(bytes) || 0;
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let size = value;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  return `${size >= 10 || unitIndex === 0 ? Math.round(size) : size.toFixed(1)} ${units[unitIndex]}`;
}

function metadataStatusLabel(status) {
  const labels = {
    matched: 'Matched',
    changed: 'Different',
    missing: 'Missing on both',
    'missing-after-merge': 'Missing after merge',
    'added-from-file': 'Present without Snapchat value'
  };
  return labels[status] || titleCase(status || 'unknown');
}

function compactPath(value) {
  if (!value) return 'Missing';
  const parts = String(value).split(/[\\/]/).filter(Boolean);
  return parts.slice(-3).join('/');
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
  if (stage === 'preview-ready') renderWorkflow('preview');
}

function appendProgressLog(payload) {
  const detail = payload.detail || {};
  updateActivitySummary(payload);
  if (shouldCompactProgressLog(payload)) return;
  const complete = Number.isFinite(detail.complete) && Number.isFinite(detail.total)
    ? ` ${detail.complete}/${detail.total}`
    : '';
  const action = detail.action ? ` ${detail.action}` : '';
  appendLogLine(`${titleCase(payload.stage || 'working')}${action}${complete}: ${payload.message || ''}`, payload.stage);
}

function shouldCompactProgressLog(payload) {
  const detail = payload.detail || {};
  const stage = payload.stage || 'working';
  const action = detail.action || '';
  const noisyMergeActions = new Set(['copying', 'writing-exif', 'merged', 'downloading']);
  const attentionActions = new Set(['warning', 'repair-failed', 'skipped-download']);

  if (attentionActions.has(action) || stage === 'error' || stage === 'complete' || stage === 'preview-ready') {
    return false;
  }

  if (stage !== state.activity.lastStage) {
    state.activity.lastStage = stage;
    return false;
  }

  if (stage === 'merging' && noisyMergeActions.has(action)) {
    return !shouldLogMilestone('merging', detail.complete, detail.total, 250);
  }

  if ((stage === 'uploading' || stage === 'apple-photos') && Number.isFinite(detail.complete)) {
    return !shouldLogMilestone(stage, detail.complete, detail.total, 250);
  }

  return false;
}

function shouldLogMilestone(key, complete, total, interval) {
  if (!Number.isFinite(complete) || !Number.isFinite(total)) return false;
  if (complete === 0) return false;
  if (complete >= total) return true;
  const milestone = Math.floor(complete / interval);
  if (milestone === 0) return false;
  if (state.activity.lastMilestones[key] === milestone) return false;
  state.activity.lastMilestones[key] = milestone;
  return true;
}

function updateActivitySummary(payload) {
  const detail = payload.detail || {};
  const action = detail.action || '';
  const stats = state.activity.stats;

  if (payload.stage === 'merging') {
    if (action === 'writing-exif') stats.exif = Math.max(stats.exif, Math.min((detail.complete || 0) + 1, detail.total || 0));
    if (action === 'merged') stats.merged = Math.max(stats.merged, detail.complete || 0);
    if (action === 'downloading') stats.downloads += 1;
    if (['warning', 'repair-failed', 'skipped-download'].includes(action)) stats.attention += 1;
  }

  elements.currentActivity.textContent = activityTitle(payload);
  elements.currentActivityDetail.textContent = compactActivityDetail(payload);
  elements.mergedStat.textContent = `${stats.merged} merged`;
  elements.exifStat.textContent = `${stats.exif} EXIF writes`;
  elements.downloadStat.textContent = `${stats.downloads} downloads`;
  elements.attentionStat.textContent = `${stats.attention} attention`;
}

function activityTitle(payload) {
  const action = payload.detail?.action;
  if (['warning', 'repair-failed', 'skipped-download'].includes(action)) return 'Needs attention';
  if (payload.stage === 'merging' && action === 'writing-exif') return 'Writing EXIF metadata';
  if (payload.stage === 'merging' && action === 'copying') return 'Copying media';
  if (payload.stage === 'merging' && action === 'downloading') return 'Downloading linked media';
  if (payload.stage === 'merging') return 'Merging memories';
  return titleCase(payload.stage || 'working');
}

function compactActivityDetail(payload) {
  const detail = payload.detail || {};
  if (Number.isFinite(detail.complete) && Number.isFinite(detail.total)) {
    const safeTotal = Math.max(detail.total, 1);
    const percentDone = Math.round((detail.complete / safeTotal) * 100);
    return `${detail.complete} of ${detail.total} (${percentDone}%). ${payload.message || ''}`;
  }
  return payload.message || 'Working';
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
  state.activity.lastStage = null;
  state.activity.lastMilestones = {};
  state.activity.stats = {
    merged: 0,
    exif: 0,
    downloads: 0,
    attention: 0
  };
  elements.currentActivity.textContent = 'Waiting';
  elements.currentActivityDetail.textContent = 'Major steps, warnings, and completion events appear below.';
  elements.mergedStat.textContent = '0 merged';
  elements.exifStat.textContent = '0 EXIF writes';
  elements.downloadStat.textContent = '0 downloads';
  elements.attentionStat.textContent = '0 attention';
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
  state.lastError = error instanceof Error ? error : new Error(error?.message || String(error));
  renderFixProblems();
  const message = error?.message || String(error);
  if (message.includes('Google Photos sign-in is not configured') || message.includes('missing Google Photos sign-in configuration')) {
    setGoogleAuthMissing();
    return;
  }
  setProgress({ stage: 'error', percent: 0, message });
}

function setGoogleAuthMissing() {
  state.googleAuthConfigured = false;
  state.lastError = new Error('Google Photos sign-in is not configured in this build.');
  elements.accountLabel.textContent = 'Google sign-in not configured in this build';
  renderFixProblems();
  setProgress({
    stage: 'error',
    percent: 0,
    message: 'Google Photos sign-in needs the app OAuth client bundled before login can open.'
  });
  appendLogLine('Google Photos sign-in is not configured in this build. ZIP export and Apple Photos still work.', 'warning');
}

function updateButtons() {
  const reviewedReady = state.preview?.readyToUpload && elements.reviewCheckbox.checked;
  elements.signInButton.disabled = state.running;
  elements.prepareButton.disabled = state.running || !state.zipPaths.length;
  elements.sampleButton.disabled = state.running || !state.zipPaths.length;
  elements.preflightButton.disabled = state.running || !state.zipPaths.length;
  elements.prepareButton.textContent = state.preview ? 'Rebuild Preview' : 'Prepare Preview';
  elements.prepareButton.className = state.preview ? 'secondary' : 'primary';
  elements.zipExportButton.disabled = state.running || !reviewedReady || state.preview?.sampleRun;
  elements.applePhotosButton.disabled = state.running || !reviewedReady || state.preview?.sampleRun || window.snapImporter.platform !== 'darwin';
  elements.uploadButton.disabled = state.running || !reviewedReady || state.preview?.sampleRun || !state.googleAuthConfigured;
  elements.createAlbumsCheckbox.disabled = state.running || !state.preview?.albumPlan?.length;
  elements.deleteDuplicatesButton.disabled = state.running || !(state.preview?.verification?.duplicateFiles > 0);
  elements.cancelButton.disabled = !state.running;
  elements.releaseReadinessButton.disabled = state.running;
  elements.cleanupButton.disabled = state.running || !state.finalReport;
  elements.diagnosticsButton.disabled = state.running;
  elements.zipButton.disabled = state.running;
  elements.resumeButton.disabled = state.running;
  elements.openMergedButton.disabled = state.running || !state.preview?.mergedDir;
  elements.openSummaryButton.disabled = state.running || !state.preview?.reviewArtifacts?.summaryPath;
  elements.signInButton.classList.toggle('needs-config', !state.googleAuthConfigured);
  elements.uploadButton.title = state.googleAuthConfigured ? '' : 'Google Photos sign-in is not configured in this build.';
  updateActionCopy(reviewedReady);
  renderWorkflow(reviewedReady ? 'send' : state.preview ? 'preview' : state.zipPaths.length ? 'preview-pending' : 'select');
}

function updateActionCopy(reviewedReady) {
  if (state.running) {
    elements.actionTitle.textContent = 'Working';
    elements.actionHint.textContent = 'Activity shows live progress while the log keeps milestones, warnings, and completion events.';
    return;
  }
  if (!state.zipPaths.length) {
    elements.actionTitle.textContent = 'Next step';
    elements.actionHint.textContent = 'Choose the Snapchat My Data zip files or the folder that contains every mydata part.';
    return;
  }
  if (!state.preview) {
    elements.actionTitle.textContent = 'Preview first';
    elements.actionHint.textContent = 'Start with Test 25 for a quick confidence check, then prepare the full preview when it looks right.';
    return;
  }
  if (state.preview.sampleRun) {
    elements.actionTitle.textContent = 'Sample complete';
    elements.actionHint.textContent = 'The sample looked at a small subset only. Run the full preview before exporting or uploading.';
    return;
  }
  if (!elements.reviewCheckbox.checked) {
    elements.actionTitle.textContent = 'Approve the preview';
    elements.actionHint.textContent = 'Open the summary or folder, check the results, then tick the review box to unlock destinations.';
    return;
  }
  if (!state.preview.readyToUpload) {
    elements.actionTitle.textContent = 'Review required';
    elements.actionHint.textContent = 'Fix or remove blocked files before upload; ZIP export remains disabled until the preview is clean.';
    return;
  }
  elements.actionTitle.textContent = 'Choose destination';
  if (!state.googleAuthConfigured) {
    elements.actionHint.textContent = 'Export ZIP and Apple Photos are available. Google upload needs OAuth client config in the build.';
    return;
  }
  elements.actionHint.textContent = state.signedIn
    ? 'Export a merged ZIP, import into Apple Photos, or upload directly to Google Photos.'
    : 'Export a merged ZIP, import into Apple Photos, or open Google login and upload automatically.';
}

function renderWorkflow(step) {
  const active = {
    select: ['workflowSelect'],
    'preview-pending': ['workflowSelect', 'workflowPreview'],
    preview: ['workflowSelect', 'workflowPreview'],
    send: ['workflowSelect', 'workflowPreview', 'workflowSend']
  }[step] || ['workflowSelect'];
  for (const key of ['workflowSelect', 'workflowPreview', 'workflowSend']) {
    elements[key].classList.toggle('is-active', active.includes(key));
    elements[key].classList.toggle('is-done', active.includes(key) && key !== active.at(-1));
  }
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
