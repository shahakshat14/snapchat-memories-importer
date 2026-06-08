const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('snapImporter', {
  platform: process.platform,
  chooseZip: () => ipcRenderer.invoke('choose-zip'),
  signIn: () => ipcRenderer.invoke('sign-in'),
  googleAuthStatus: () => ipcRenderer.invoke('google-auth-status'),
  runPreflight: (options) => ipcRenderer.invoke('run-preflight', options),
  prepareImport: (options) => ipcRenderer.invoke('prepare-import', options),
  resumeLastPreview: () => ipcRenderer.invoke('resume-last-preview'),
  lastSessionStatus: () => ipcRenderer.invoke('last-session-status'),
  uploadPrepared: (options) => ipcRenderer.invoke('upload-prepared', options),
  exportPreparedZip: () => ipcRenderer.invoke('export-prepared-zip'),
  importApplePhotos: () => ipcRenderer.invoke('import-apple-photos'),
  deleteReviewedDuplicates: () => ipcRenderer.invoke('delete-reviewed-duplicates'),
  cleanupArtifacts: (options) => ipcRenderer.invoke('cleanup-artifacts', options),
  exportDiagnostics: () => ipcRenderer.invoke('export-diagnostics'),
  releaseReadiness: () => ipcRenderer.invoke('release-readiness'),
  openPath: (path) => ipcRenderer.invoke('open-path', path),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  cancelImport: () => ipcRenderer.invoke('cancel-import'),
  onProgress: (callback) => {
    ipcRenderer.on('progress', (_event, payload) => callback(payload));
  }
});
