const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('authApi', {
  login: (email, password) => ipcRenderer.invoke('supabase-login', email, password),
  signup: (email, password, displayName) => ipcRenderer.invoke('supabase-signup', email, password, displayName),
  continueOffline: () => ipcRenderer.invoke('continue-offline'),
});
