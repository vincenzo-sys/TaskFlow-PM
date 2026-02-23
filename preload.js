const { contextBridge, ipcRenderer, webFrame } = require('electron');

contextBridge.exposeInMainWorld('api', {
  setZoomFactor: (factor) => webFrame.setZoomFactor(factor),
  loadData: () => ipcRenderer.invoke('load-data'),
  saveData: (data) => ipcRenderer.invoke('save-data', data),
  exportData: (data) => ipcRenderer.invoke('export-data', data),
  importData: () => ipcRenderer.invoke('import-data'),
  // Focus Pill APIs
  showPill: () => ipcRenderer.invoke('show-pill'),
  hidePill: () => ipcRenderer.invoke('hide-pill'),
  updatePill: (data) => ipcRenderer.invoke('update-pill', data),
  onPillAction: (callback) => {
    ipcRenderer.on('pill-action', (event, action) => callback(action));
  },
  // Quick Capture APIs
  showCapture: () => ipcRenderer.invoke('show-capture'),
  onTaskCaptured: (callback) => {
    ipcRenderer.on('task-captured', (event, task) => callback(task));
  },
  onShortcutRegistered: (callback) => {
    ipcRenderer.on('shortcut-registered', (event, shortcut) => callback(shortcut));
  },
  // File operations
  openPath: (filePath) => ipcRenderer.invoke('open-path', filePath),
  browseFile: () => ipcRenderer.invoke('browse-file'),
  writeFile: (filePath, content) => ipcRenderer.invoke('write-file', { filePath, content }),
  // Clipboard
  copyToClipboard: (text) => ipcRenderer.invoke('copy-to-clipboard', text),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  // Keyboard shortcut trigger
  triggerShortcut: () => ipcRenderer.invoke('trigger-shortcut'),
  // Floating Task Bar
  showFloatingBar: () => ipcRenderer.invoke('show-floating-bar'),
  hideFloatingBar: () => ipcRenderer.invoke('hide-floating-bar'),
  updateFloatingBar: (task) => ipcRenderer.invoke('update-floating-bar', task),
  onFloatingBarComplete: (callback) => {
    ipcRenderer.on('floating-bar-complete-task', (event, taskId) => callback(taskId));
  },
  onFloatingBarToggleSubtask: (callback) => {
    ipcRenderer.on('floating-bar-toggle-subtask', (event, taskId, subtaskId) => callback(taskId, subtaskId));
  },
  onFloatingBarRemoveTask: (callback) => {
    ipcRenderer.on('floating-bar-remove-task', (event, taskId) => callback(taskId));
  },
  // Claude Queue
  runClaudeQueue: () => ipcRenderer.invoke('run-claude-queue'),
  // Claude Session
  launchClaudeSession: (context) => ipcRenderer.invoke('launch-claude-session', context),
  // Claude Launcher (project-specific launchers with config)
  launchClaudeWithConfig: (config) => ipcRenderer.invoke('launch-claude-with-config', config)
});
