const state = {
  zipPath: null,
  credentialsPath: null,
  signedIn: false,
  running: false
};

const elements = {
  zipButton: document.querySelector('#zipButton'),
  credentialsButton: document.querySelector('#credentialsButton'),
  signInButton: document.querySelector('#signInButton'),
  startButton: document.querySelector('#startButton'),
  cancelButton: document.querySelector('#cancelButton'),
  zipPath: document.querySelector('#zipPath'),
  credentialsPath: document.querySelector('#credentialsPath'),
  accountLabel: document.querySelector('#accountLabel'),
  statusPill: document.querySelector('#statusPill'),
  stageLabel: document.querySelector('#stageLabel'),
  percentLabel: document.querySelector('#percentLabel'),
  progressBar: document.querySelector('#progressBar'),
  message: document.querySelector('#message')
};

elements.zipButton.addEventListener('click', async () => {
  const zipPath = await window.snapImporter.chooseZip();
  if (!zipPath) return;
  state.zipPath = zipPath;
  elements.zipPath.textContent = zipPath;
  setMessage('Snapchat zip selected.');
  updateButtons();
});

elements.credentialsButton.addEventListener('click', async () => {
  const credentialsPath = await window.snapImporter.chooseCredentials();
  if (!credentialsPath) return;
  state.credentialsPath = credentialsPath;
  elements.credentialsPath.textContent = credentialsPath;
  setMessage('Google OAuth JSON selected.');
  updateButtons();
});

elements.signInButton.addEventListener('click', async () => {
  try {
    setBusy(true, 'Opening Google login');
    const account = await window.snapImporter.signIn(state.credentialsPath);
    state.signedIn = true;
    elements.accountLabel.textContent = account.email;
    setProgress({ stage: 'connected', percent: 0, message: 'Google Photos connected.' });
  } catch (error) {
    setError(error);
  } finally {
    setBusy(false);
    updateButtons();
  }
});

elements.startButton.addEventListener('click', async () => {
  try {
    setBusy(true, 'Starting import');
    const report = await window.snapImporter.startImport({
      zipPath: state.zipPath,
      credentialsPath: state.credentialsPath
    });
    setProgress({
      stage: 'complete',
      percent: 100,
      message: `Uploaded ${report.uploadedFiles} files. Merged folder: ${report.mergedDir}`
    });
  } catch (error) {
    setError(error);
  } finally {
    setBusy(false);
    updateButtons();
  }
});

elements.cancelButton.addEventListener('click', async () => {
  await window.snapImporter.cancelImport();
  setMessage('Cancelling after the current file finishes.');
});

window.snapImporter.onProgress((payload) => setProgress(payload));
updateButtons();

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
  elements.signInButton.disabled = state.running || !state.credentialsPath;
  elements.startButton.disabled = state.running || !state.zipPath || !state.signedIn;
  elements.cancelButton.disabled = !state.running;
  elements.zipButton.disabled = state.running;
  elements.credentialsButton.disabled = state.running;
}

function titleCase(value) {
  return String(value)
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}
