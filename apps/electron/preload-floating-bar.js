const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('floatingBarApi', {
  onTasksUpdate: (callback) => {
    ipcRenderer.on('floating-bar-tasks', (event, tasks) => callback(tasks));
  },
  completeTask: (taskId) => ipcRenderer.send('floating-bar-complete', taskId),
  removeTask: (taskId) => ipcRenderer.send('floating-bar-remove-task', taskId),
  toggleSubtask: (taskId, subtaskId) => ipcRenderer.send('floating-bar-toggle-subtask', taskId, subtaskId),
  close: () => ipcRenderer.send('floating-bar-close'),
  resize: () => ipcRenderer.send('floating-bar-resize'),
  setSize: (width, height) => ipcRenderer.send('floating-bar-set-size', width, height),
  showMain: () => ipcRenderer.send('floating-bar-show-main'),
  copyToClipboard: (text) => ipcRenderer.send('floating-bar-copy', text),
  startResize: () => ipcRenderer.send('floating-bar-start-resize'),
  doResize: (deltaX, deltaY) => ipcRenderer.send('floating-bar-do-resize', deltaX, deltaY)
});
