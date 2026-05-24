const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('snapImporter', {
  platform: process.platform,
  chooseZip: () => ipcRenderer.invoke('choose-zip'),
  chooseCredentials: () => ipcRenderer.invoke('choose-credentials'),
  signIn: (credentialsPath) => ipcRenderer.invoke('sign-in', credentialsPath),
  prepareImport: (options) => ipcRenderer.invoke('prepare-import', options),
  uploadPrepared: () => ipcRenderer.invoke('upload-prepared'),
  exportPreparedZip: () => ipcRenderer.invoke('export-prepared-zip'),
  importApplePhotos: () => ipcRenderer.invoke('import-apple-photos'),
  openPath: (path) => ipcRenderer.invoke('open-path', path),
  cancelImport: () => ipcRenderer.invoke('cancel-import'),
  onProgress: (callback) => {
    ipcRenderer.on('progress', (_event, payload) => callback(payload));
  }
});
