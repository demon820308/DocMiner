const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  saveAsPDF: () => ipcRenderer.send('save-as-pdf'),
  saveAsMD: (content, filename) => ipcRenderer.send('save-as-md', content, filename),
  
  // Software Update APIs
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  openExternal: (url) => ipcRenderer.send('open-external', url),
  startDownload: (url) => ipcRenderer.send('start-download', url),
  cancelDownload: () => ipcRenderer.send('cancel-download'),
  installUpdate: (filePath) => ipcRenderer.send('install-update', filePath),
  onDownloadStatus: (callback) => {
    const listener = (event, data) => callback(data);
    ipcRenderer.on('download-status', listener);
    return () => ipcRenderer.removeListener('download-status', listener);
  }
});
