const { app, BrowserWindow, ipcMain, dialog, screen, globalShortcut, Notification } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

let mainWindow;
let pillWindow = null;
let captureWindow = null;
let floatingBarWindow = null;
const dataPath = path.join(app.getPath('userData'), 'taskflow-data.json');

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    },
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#ffffff',
      symbolColor: '#57534e',
      height: 40
    },
    icon: path.join(__dirname, 'icon.png')
  });

  mainWindow.loadFile('index.html');

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function startApp() {
  createWindow();
  registerGlobalShortcut();
}

function loadData() {
  try {
    if (fs.existsSync(dataPath)) {
      const data = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));
      return migrateData(data);
    }
  } catch (error) {
    console.error('Error loading data:', error);
  }
  return getDefaultData();
}

function migrateData(data) {
  let needsSave = false;

  // Migration: Add categories if missing
  if (!data.categories) {
    data.categories = [
      { id: 'cat-work', name: 'Work', color: '#6366f1', order: 0, collapsed: false },
      { id: 'cat-personal', name: 'Personal', color: '#10b981', order: 1, collapsed: false },
      { id: 'cat-side', name: 'Side Projects', color: '#f59e0b', order: 2, collapsed: false }
    ];
    needsSave = true;
  }

  // Migration: Add favorites array if missing
  if (!data.favorites) {
    data.favorites = [];
    needsSave = true;
  }

  // Migration: Ensure projects have new fields and assign to default category
  if (data.projects) {
    for (const project of data.projects) {
      if (!project.isInbox) {
        // Add categoryId if missing - default to Personal (skip subprojects)
        if (!project.categoryId && !project.parentProjectId) {
          // Only assign default category if the category actually exists
          if (data.categories && data.categories.some(c => c.id === 'cat-personal')) {
            project.categoryId = 'cat-personal';
            needsSave = true;
          }
        }
        // Add status if missing - use open-ended statuses: active/paused/blocked
        if (!project.status || project.status === 'completed') {
          project.status = 'active';
          needsSave = true;
        }
        // Add goal field if missing
        if (project.goal === undefined) {
          project.goal = '';
          needsSave = true;
        }
      }
      // Migrate tasks: ensure blockedBy is an array and add blocks field
      if (project.tasks) {
        for (const task of project.tasks) {
          // Convert old blockedBy (string) to blockedBy (array)
          if (task.blockedBy && typeof task.blockedBy === 'string') {
            // Keep the old string value but don't convert - it was a description
            task.blockedByReason = task.blockedBy;
            task.blockedBy = [];
            needsSave = true;
          }
          if (!Array.isArray(task.blockedBy)) {
            task.blockedBy = [];
            needsSave = true;
          }
          if (!Array.isArray(task.blocks)) {
            task.blocks = [];
            needsSave = true;
          }
        }
      }
    }
  }

  // Migration: Add updatedAt to tasks that don't have it
  if (data.projects) {
    for (const project of data.projects) {
      if (project.tasks) {
        for (const task of project.tasks) {
          if (!task.updatedAt) {
            task.updatedAt = task.completedAt || task.createdAt || new Date().toISOString();
            needsSave = true;
          }
        }
      }
    }
  }

  // Migration: Add startDate, endDate, assignee to tasks
  if (data.projects) {
    for (const project of data.projects) {
      if (project.tasks) {
        for (const task of project.tasks) {
          if (task.startDate === undefined) {
            task.startDate = task.scheduledDate || null;
            needsSave = true;
          }
          if (task.endDate === undefined) {
            task.endDate = task.dueDate || null;
            needsSave = true;
          }
          if (task.assignee === undefined) {
            task.assignee = null;
            needsSave = true;
          }
        }
      }
    }
  }

  // Migration: Initialize teamMembers setting
  if (!data.settings) {
    data.settings = {};
    needsSave = true;
  }
  if (!data.settings.teamMembers) {
    data.settings.teamMembers = [];
    needsSave = true;
  }

  // Migration: Initialize workingDirectory, notebooks, launchers on projects
  data.projects.forEach(project => {
    if (project.workingDirectory === undefined) {
      project.workingDirectory = null;
      needsSave = true;
    }
    if (!Array.isArray(project.notebooks)) {
      project.notebooks = [];
      needsSave = true;
    }
    if (!Array.isArray(project.launchers)) {
      project.launchers = [];
      needsSave = true;
    }
  });

  // Migration: Initialize parentProjectId on projects
  if (data.projects) {
    for (const project of data.projects) {
      if (project.parentProjectId === undefined) {
        project.parentProjectId = null;
        needsSave = true;
      }
    }
  }

  // Save if migrations occurred
  if (needsSave) {
    saveData(data);
  }

  return data;
}

function saveData(data) {
  try {
    fs.writeFileSync(dataPath, JSON.stringify(data, null, 2));
    return true;
  } catch (error) {
    console.error('Error saving data:', error);
    return false;
  }
}

function getDefaultData() {
  return {
    projects: [],
    categories: [
      { id: 'cat-work', name: 'Work', color: '#6366f1', order: 0, collapsed: false },
      { id: 'cat-personal', name: 'Personal', color: '#10b981', order: 1, collapsed: false },
      { id: 'cat-side', name: 'Side Projects', color: '#f59e0b', order: 2, collapsed: false }
    ],
    favorites: [],
    tags: [
      { id: 'tag-1', name: 'Work', color: '#3498db' },
      { id: 'tag-2', name: 'Personal', color: '#2ecc71' },
      { id: 'tag-3', name: 'Urgent', color: '#e74c3c' }
    ],
    settings: {
      theme: 'dark',
      defaultView: 'list'
    }
  };
}

app.whenReady().then(() => {
  startApp();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      startApp();
    }
  });
});

app.on('will-quit', () => {
  // Unregister all shortcuts when quitting
  globalShortcut.unregisterAll();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// ── Data IPC Handlers ────────────────────────────────────────

ipcMain.handle('load-data', () => {
  return loadData();
});

ipcMain.handle('save-data', (event, data) => {
  return saveData(data);
});

ipcMain.handle('export-data', async (event, data) => {
  const result = await dialog.showSaveDialog(mainWindow, {
    title: 'Export Data',
    defaultPath: 'taskflow-backup.json',
    filters: [{ name: 'JSON Files', extensions: ['json'] }]
  });

  if (!result.canceled && result.filePath) {
    fs.writeFileSync(result.filePath, JSON.stringify(data, null, 2));
    return true;
  }
  return false;
});

ipcMain.handle('import-data', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Import Data',
    filters: [{ name: 'JSON Files', extensions: ['json'] }],
    properties: ['openFile']
  });

  if (!result.canceled && result.filePaths.length > 0) {
    try {
      const data = fs.readFileSync(result.filePaths[0], 'utf-8');
      return JSON.parse(data);
    } catch (error) {
      return null;
    }
  }
  return null;
});

// File operations
ipcMain.handle('open-path', async (event, filePath) => {
  const { shell } = require('electron');
  try {
    await shell.openPath(filePath);
    return true;
  } catch (error) {
    console.error('Failed to open path:', error);
    return false;
  }
});

ipcMain.handle('browse-file', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Select File or Folder',
    properties: ['openFile', 'openDirectory']
  });

  if (!result.canceled && result.filePaths.length > 0) {
    return result.filePaths[0];
  }
  return null;
});

ipcMain.handle('write-file', async (event, { filePath, content }) => {
  try {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(filePath, content, 'utf-8');
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('copy-to-clipboard', async (event, text) => {
  const { clipboard } = require('electron');
  clipboard.writeText(text);
  return true;
});

ipcMain.handle('open-external', async (event, url) => {
  const { shell } = require('electron');
  await shell.openExternal(url);
  return true;
});

// Trigger Ctrl+Win+Space keyboard shortcut
ipcMain.handle('trigger-shortcut', async () => {
  const { exec } = require('child_process');
  // Use PowerShell to send Ctrl+Win+Space
  const psScript = `
    Add-Type -AssemblyName System.Windows.Forms
    [System.Windows.Forms.SendKeys]::SendWait('^{LWin} ')
  `;

  return new Promise((resolve) => {
    exec(`powershell -Command "${psScript.replace(/\n/g, ' ')}"`, (error) => {
      if (error) {
        console.error('Shortcut trigger error:', error);
        resolve(false);
      } else {
        resolve(true);
      }
    });
  });
});

// Focus Pill Window
function createPillWindow() {
  if (pillWindow) {
    pillWindow.show();
    return;
  }

  const { width, height } = screen.getPrimaryDisplay().workAreaSize;

  pillWindow = new BrowserWindow({
    width: 340,
    height: 80,
    x: width - 360,
    y: height - 100,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    hasShadow: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload-pill.js')
    }
  });

  pillWindow.loadFile('focus-pill.html');
  pillWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  pillWindow.on('closed', () => {
    pillWindow = null;
  });
}

function closePillWindow() {
  if (pillWindow) {
    pillWindow.close();
    pillWindow = null;
  }
}

function updatePillWindow(data) {
  if (pillWindow && !pillWindow.isDestroyed()) {
    pillWindow.webContents.send('pill-update', data);
  }
}

// Pill IPC handlers
ipcMain.handle('show-pill', () => {
  createPillWindow();
  return true;
});

ipcMain.handle('hide-pill', () => {
  closePillWindow();
  return true;
});

ipcMain.handle('update-pill', (event, data) => {
  updatePillWindow(data);
  return true;
});

ipcMain.on('pill-action', (event, action) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('pill-action', action);
  }
});

// Run Claude Queue
ipcMain.handle('run-claude-queue', async () => {
  const { exec } = require('child_process');
  const queuePath = 'C:\\Users\\vince\\OneDrive\\Vincenzo\\Claude\\Claude Queue\\run_queue.bat';

  return new Promise((resolve) => {
    exec(`start cmd /c "${queuePath}"`, { cwd: path.dirname(queuePath) }, (error) => {
      if (error) {
        console.error('Error running queue:', error);
        resolve({ success: false, error: error.message });
      } else {
        resolve({ success: true });
      }
    });
  });
});

// Launch Claude Session
ipcMain.handle('launch-claude-session', async (event, { prompt, workingDir, sessionLabel }) => {
  const { exec } = require('child_process');
  const { clipboard } = require('electron');

  try {
    // Copy prompt to clipboard (avoids cmd.exe 8191-char limit)
    clipboard.writeText(prompt);

    const cwd = workingDir || path.dirname(dataPath);
    const title = (sessionLabel || 'Claude').replace(/"/g, "'");

    return new Promise((resolve) => {
      exec(`start "TaskFlow: ${title}" cmd /k "cd /d "${cwd}" && claude"`, { cwd }, (error) => {
        if (error) {
          console.error('Error launching Claude session:', error);
          resolve({ success: false, error: error.message });
        } else {
          resolve({ success: true });
        }
      });
    });
  } catch (err) {
    console.error('Error launching Claude session:', err);
    return { success: false, error: err.message };
  }
});

// Launch Claude with config (for project launchers)
ipcMain.handle('launch-claude-with-config', async (event, config) => {
  const { exec } = require('child_process');
  const { workDir, title, flags } = config;

  try {
    const cwd = workDir || path.dirname(dataPath);
    const safeTitle = (title || 'Claude').replace(/"/g, "'");
    const flagStr = flags ? ` ${flags}` : '';

    return new Promise((resolve) => {
      exec(`start "TaskFlow: ${safeTitle}" cmd /k "cd /d "${cwd}" && claude${flagStr}"`, { cwd }, (error) => {
        if (error) {
          console.error('Error launching Claude with config:', error);
          resolve({ success: false, error: error.message });
        } else {
          resolve({ success: true });
        }
      });
    });
  } catch (err) {
    console.error('Error launching Claude with config:', err);
    return { success: false, error: err.message };
  }
});

// Quick Capture Window
function createCaptureWindow() {
  if (captureWindow && !captureWindow.isDestroyed()) {
    captureWindow.focus();
    return;
  }

  const { width: screenWidth, height: screenHeight } = screen.getPrimaryDisplay().workAreaSize;

  captureWindow = new BrowserWindow({
    width: 650,
    height: 380,
    x: Math.round((screenWidth - 650) / 2),
    y: Math.round(screenHeight * 0.2),
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    hasShadow: true,
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload-capture.js')
    }
  });

  captureWindow.loadFile('quick-capture.html');

  captureWindow.once('ready-to-show', () => {
    captureWindow.show();
  });

  captureWindow.on('blur', () => {
    // Close when clicking outside
    if (captureWindow && !captureWindow.isDestroyed()) {
      captureWindow.close();
    }
  });

  captureWindow.on('closed', () => {
    captureWindow = null;
  });
}

function closeCaptureWindow() {
  if (captureWindow && !captureWindow.isDestroyed()) {
    captureWindow.close();
    captureWindow = null;
  }
}

// Floating Task Bar Window
function createFloatingBar() {
  if (floatingBarWindow && !floatingBarWindow.isDestroyed()) {
    floatingBarWindow.show();
    return;
  }

  const { width } = screen.getPrimaryDisplay().workAreaSize;

  floatingBarWindow = new BrowserWindow({
    width: 420,
    height: 48,
    minWidth: 120,
    minHeight: 32,
    x: Math.floor(width / 2 - 190),
    y: 60,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: true,
    hasShadow: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload-floating-bar.js')
    }
  });

  floatingBarWindow.loadFile('floating-bar.html');
  floatingBarWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  floatingBarWindow.on('closed', () => {
    floatingBarWindow = null;
  });
}

function closeFloatingBar() {
  if (floatingBarWindow && !floatingBarWindow.isDestroyed()) {
    floatingBarWindow.close();
    floatingBarWindow = null;
  }
}

function updateFloatingBar(tasks) {
  if (floatingBarWindow && !floatingBarWindow.isDestroyed()) {
    floatingBarWindow.webContents.send('floating-bar-tasks', tasks);
  }
}

// Floating bar IPC handlers
ipcMain.handle('show-floating-bar', () => {
  createFloatingBar();
  return true;
});

ipcMain.handle('hide-floating-bar', () => {
  closeFloatingBar();
  return true;
});

ipcMain.handle('update-floating-bar', (event, tasks) => {
  updateFloatingBar(tasks);
  return true;
});

ipcMain.on('floating-bar-close', () => {
  closeFloatingBar();
});

ipcMain.on('floating-bar-complete', (event, taskId) => {
  // Notify main window to complete the task
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('floating-bar-complete-task', taskId);
  }
});

ipcMain.on('floating-bar-remove-task', (event, taskId) => {
  // Notify main window to remove task from active list
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('floating-bar-remove-task', taskId);
  }
});

ipcMain.on('floating-bar-toggle-subtask', (event, taskId, subtaskId) => {
  // Notify main window to toggle subtask
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('floating-bar-toggle-subtask', taskId, subtaskId);
  }
});

ipcMain.on('floating-bar-resize', () => {
  if (floatingBarWindow && !floatingBarWindow.isDestroyed()) {
    // Let the window auto-size based on content
    floatingBarWindow.webContents.executeJavaScript(`
      document.getElementById('floating-bar').offsetHeight
    `).then(height => {
      const bounds = floatingBarWindow.getBounds();
      floatingBarWindow.setBounds({ ...bounds, height: Math.min(height + 2, 500) });
    }).catch(() => {});
  }
});

ipcMain.on('floating-bar-set-size', (event, width, height) => {
  if (floatingBarWindow && !floatingBarWindow.isDestroyed()) {
    const bounds = floatingBarWindow.getBounds();
    floatingBarWindow.setBounds({ x: bounds.x, y: bounds.y, width, height });
  }
});

ipcMain.on('floating-bar-show-main', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) {
      mainWindow.restore();
    }
    mainWindow.show();
    mainWindow.focus();
  }
});

ipcMain.on('floating-bar-copy', (event, text) => {
  const { clipboard } = require('electron');
  clipboard.writeText(text);
});

// Register global shortcut
function registerGlobalShortcut() {
  // Unregister any existing shortcuts first
  globalShortcut.unregisterAll();

  const shortcuts = [
    { key: 'CommandOrControl+Alt+Q', label: 'Ctrl+Alt+Q' },
    { key: 'CommandOrControl+Shift+Q', label: 'Ctrl+Shift+Q' },
    { key: 'CommandOrControl+Alt+N', label: 'Ctrl+Alt+N' }
  ];

  let registeredShortcut = null;

  for (const shortcut of shortcuts) {
    try {
      const registered = globalShortcut.register(shortcut.key, () => {
        createCaptureWindow();
      });

      if (registered) {
        registeredShortcut = shortcut.label;
        console.log(`Quick capture shortcut registered: ${shortcut.label}`);
        break;
      } else {
        console.warn(`Shortcut ${shortcut.label} unavailable, trying next...`);
      }
    } catch (err) {
      console.warn(`Error registering ${shortcut.label}:`, err.message);
    }
  }

  // Notify user of result after app is ready
  if (!registeredShortcut) {
    console.error('All shortcuts failed to register');
    // Show notification after a brief delay to ensure app is ready
    setTimeout(() => {
      if (Notification.isSupported()) {
        new Notification({
          title: 'TaskFlow Quick Capture',
          body: 'Global shortcut unavailable. Use the app to capture tasks.'
        }).show();
      }
    }, 2000);
  } else {
    // Notify main window of active shortcut
    setTimeout(() => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('shortcut-registered', registeredShortcut);
      }
    }, 1000);
  }
}

// Capture window IPC handlers
ipcMain.on('capture-save', (event, data) => {
  // Create the task with brain dump context
  const appData = loadData();

  // Find or create inbox
  let inbox = appData.projects.find(p => p.isInbox || p.id === 'inbox');
  if (!inbox) {
    inbox = { id: 'inbox', name: 'Inbox', color: '#6366f1', tasks: [], isInbox: true };
    appData.projects.unshift(inbox);
  }

  // Create the task with context field
  const task = {
    id: crypto.randomUUID(),
    name: data.name,
    description: '',
    context: data.context || '',  // Brain dump context
    status: 'todo',
    priority: 'none',
    dueDate: null,
    tags: [],
    subtasks: [],
    createdAt: new Date().toISOString(),
    completedAt: null
  };

  inbox.tasks.push(task);
  saveData(appData);

  // Notify main window to refresh
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('task-captured', task);
  }
});

ipcMain.on('capture-close', () => {
  closeCaptureWindow();
});

// Quick capture IPC handler (for renderer to trigger)
ipcMain.handle('show-capture', () => {
  createCaptureWindow();
  return true;
});
