const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('captureApi', {
  save: (data) => ipcRenderer.send('capture-save', data),
  close: () => ipcRenderer.send('capture-close')
});
