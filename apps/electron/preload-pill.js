const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('pillApi', {
  onUpdate: (callback) => {
    ipcRenderer.on('pill-update', (event, data) => callback(data));
  },
  action: (action) => ipcRenderer.send('pill-action', action)
});
