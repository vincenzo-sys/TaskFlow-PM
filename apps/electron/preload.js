const { contextBridge, ipcRenderer, webFrame } = require('electron');

contextBridge.exposeInMainWorld('api', {
  setZoomFactor: (factor) => webFrame.setZoomFactor(factor),
  loadData: () => ipcRenderer.invoke('load-data'),
  saveData: (data) => ipcRenderer.invoke('save-data', data),
  exportData: (data) => ipcRenderer.invoke('export-data', data),
  importData: () => ipcRenderer.invoke('import-data'),

  // ── Auth APIs ──────────────────────────────────────────────
  auth: {
    logout: () => ipcRenderer.invoke('supabase-logout'),
    getSession: () => ipcRenderer.invoke('supabase-get-session'),
  },

  // ── DataService APIs (granular Supabase CRUD) ──────────────
  ds: {
    loadData: () => ipcRenderer.invoke('ds:load-data'),
    createTask: (taskData) => ipcRenderer.invoke('ds:create-task', taskData),
    updateTask: (taskId, updates) => ipcRenderer.invoke('ds:update-task', taskId, updates),
    deleteTask: (taskId) => ipcRenderer.invoke('ds:delete-task', taskId),
    completeTask: (taskId) => ipcRenderer.invoke('ds:complete-task', taskId),
    createProject: (projectData) => ipcRenderer.invoke('ds:create-project', projectData),
    updateProject: (projectId, updates) => ipcRenderer.invoke('ds:update-project', projectId, updates),
    deleteProject: (projectId) => ipcRenderer.invoke('ds:delete-project', projectId),
    createSubtask: (parentTaskId, subtaskData) => ipcRenderer.invoke('ds:create-subtask', parentTaskId, subtaskData),
    updateSubtask: (subtaskId, updates) => ipcRenderer.invoke('ds:update-subtask', subtaskId, updates),
    deleteSubtask: (subtaskId) => ipcRenderer.invoke('ds:delete-subtask', subtaskId),
    createTag: (tagData) => ipcRenderer.invoke('ds:create-tag', tagData),
    updateTag: (tagId, updates) => ipcRenderer.invoke('ds:update-tag', tagId, updates),
    deleteTag: (tagId) => ipcRenderer.invoke('ds:delete-tag', tagId),
    createCategory: (catData) => ipcRenderer.invoke('ds:create-category', catData),
    updateCategory: (catId, updates) => ipcRenderer.invoke('ds:update-category', catId, updates),
    deleteCategory: (catId) => ipcRenderer.invoke('ds:delete-category', catId),
    createNotebook: (notebookData) => ipcRenderer.invoke('ds:create-notebook', notebookData),
    updateNotebook: (notebookId, updates) => ipcRenderer.invoke('ds:update-notebook', notebookId, updates),
    deleteNotebook: (notebookId) => ipcRenderer.invoke('ds:delete-notebook', notebookId),
    addRecapEntry: (entryData) => ipcRenderer.invoke('ds:add-recap-entry', entryData),
    saveRecap: (recapData) => ipcRenderer.invoke('ds:save-recap', recapData),
    updateWorkingOn: (taskIds) => ipcRenderer.invoke('ds:update-working-on', taskIds),
    updatePreferences: (updates) => ipcRenderer.invoke('ds:update-preferences', updates),
    // Team & Invitations
    getTeamMembers: () => ipcRenderer.invoke('ds:get-team-members'),
    inviteMember: (email, role) => ipcRenderer.invoke('ds:invite-member', email, role),
    getInvitations: () => ipcRenderer.invoke('ds:get-invitations'),
    getMyInvitations: () => ipcRenderer.invoke('ds:get-my-invitations'),
    acceptInvitation: (id) => ipcRenderer.invoke('ds:accept-invitation', id),
    declineInvitation: (id) => ipcRenderer.invoke('ds:decline-invitation', id),
    // Project Members
    getProjectMembers: (projectId) => ipcRenderer.invoke('ds:get-project-members', projectId),
    addProjectMember: (projectId, userId, role) => ipcRenderer.invoke('ds:add-project-member', projectId, userId, role),
    updateProjectMemberRole: (projectId, userId, role) => ipcRenderer.invoke('ds:update-project-member-role', projectId, userId, role),
    removeProjectMember: (projectId, userId) => ipcRenderer.invoke('ds:remove-project-member', projectId, userId),
  },

  // ── Realtime sync ────────────────────────────────────────
  onRealtimeChange: (callback) => {
    ipcRenderer.on('realtime-change', (event, data) => callback(data));
  },

  // ── Focus Pill APIs ────────────────────────────────────────
  showPill: () => ipcRenderer.invoke('show-pill'),
  hidePill: () => ipcRenderer.invoke('hide-pill'),
  updatePill: (data) => ipcRenderer.invoke('update-pill', data),
  onPillAction: (callback) => {
    ipcRenderer.on('pill-action', (event, action) => callback(action));
  },

  // ── Quick Capture APIs ─────────────────────────────────────
  showCapture: () => ipcRenderer.invoke('show-capture'),
  onTaskCaptured: (callback) => {
    ipcRenderer.on('task-captured', (event, task) => callback(task));
  },
  onShortcutRegistered: (callback) => {
    ipcRenderer.on('shortcut-registered', (event, shortcut) => callback(shortcut));
  },

  // ── File operations ────────────────────────────────────────
  openPath: (filePath) => ipcRenderer.invoke('open-path', filePath),
  browseFile: () => ipcRenderer.invoke('browse-file'),
  writeFile: (filePath, content) => ipcRenderer.invoke('write-file', { filePath, content }),

  // ── Clipboard ──────────────────────────────────────────────
  copyToClipboard: (text) => ipcRenderer.invoke('copy-to-clipboard', text),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),

  // ── Keyboard shortcut trigger ──────────────────────────────
  triggerShortcut: () => ipcRenderer.invoke('trigger-shortcut'),

  // ── Floating Task Bar ──────────────────────────────────────
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

  // ── Claude Queue ───────────────────────────────────────────
  runClaudeQueue: () => ipcRenderer.invoke('run-claude-queue'),
  launchClaudeSession: (context) => ipcRenderer.invoke('launch-claude-session', context),
  launchClaudeWithConfig: (config) => ipcRenderer.invoke('launch-claude-with-config', config)
});
