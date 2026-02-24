// TaskFlow PM - Core module (class definition, constructor, init)

// Shared priority color map — matches CSS variables
export const PRIORITY_COLORS = {
  urgent: '#dc2626',
  high: '#f97316',
  medium: '#eab308',
  low: '#22c55e',
  none: '#dbd8d3'
};

export class TaskFlowApp {
  constructor() {
    this.data = null;
    this.currentView = 'today';  // Default to Today view for focus
    this.currentViewMode = 'list';
    this.selectedTask = null;
    this.searchQuery = '';
    this.sortBy = 'created';
    this.filterStatus = 'all';

    // Calendar state
    this.calendar = {
      currentDate: new Date(),
      selectedDate: null,
      viewMode: 'month'  // month, week, day
    };

    // Today view state
    this.todayView = {
      showCompleted: false,
      workingOnTaskIds: [],
      notesExpanded: true,
      expandedUpNextIds: new Set(),
      myTasksFilter: false, // false = All Tasks, true = My Tasks only
    };

    // Undo stack (in-memory, max 30 actions)
    this.undoStack = [];

    // Floating bar state
    this.floatingBarVisible = false;

    // Focus Mode state
    this.focusMode = {
      active: false,
      minimized: false,
      currentIndex: 0,
      taskQueue: [],
      timerRunning: false,
      timerInterval: null,
      timerSeconds: 25 * 60,
      isBreak: false,
      workDuration: 25 * 60,
      breakDuration: 5 * 60,
      autoStart: true,
      soundEnabled: true,
      completedCount: 0,
      pomodoroCount: 0,
      streak: 0,
      settingsPanelOpen: false,
      aiMessages: []
    };

    // Current user ID (from Supabase)
    this.currentUserId = null;

    // Timeline view mode: 'single' or 'dual'
    this.timelineMode = 'single';

    // Master list state
    this._selectedTasks = new Set();  // For bulk selection
    this._masterListGroupBy = 'none'; // none, project, priority, status

    // Analytics state
    this._analyticsPeriod = 'week';  // week, month, quarter

    // Project view state (per-project view preferences)
    this._projectViewState = {};
    this._projectTimelineState = {};

    this.init();
  }
}

// Core mixin — methods that run during init or manage top-level app state
export const CoreMixin = {
  async init() {
    this.data = await window.api.loadData();

    // Store current user ID for filtering
    this.currentUserId = this.data.currentUserId || null;

    // Ensure teamMembers array exists
    if (!this.data.teamMembers) this.data.teamMembers = [];

    // Migrate old single workingOnTaskId to array
    if (this.data.workingOnTaskId && !this.data.workingOnTaskIds) {
      this.data.workingOnTaskIds = [this.data.workingOnTaskId];
      delete this.data.workingOnTaskId;
      this.saveData();
    }

    // Initialize project view preferences
    if (!this.data.projectViewPrefs) this.data.projectViewPrefs = {};

    // Restore active tasks from persisted data
    if (this.data.workingOnTaskIds && this.data.workingOnTaskIds.length > 0) {
      this.todayView.workingOnTaskIds = [...this.data.workingOnTaskIds];
    }

    // Apply saved font scale
    this.applyFontScale();

    this.bindEvents();
    this.setupFocusReturnRefresh();
    this.render();

    // Check for pending team invitations
    this.checkPendingInvitationsForMe();

    // Listen for quick capture
    window.api.onTaskCaptured((task) => {
      this.handleTaskCaptured(task);
    });

    // Listen for floating bar task completion
    window.api.onFloatingBarComplete?.((taskId) => {
      this.handleFloatingBarComplete(taskId);
    });

    // Listen for floating bar subtask toggle
    window.api.onFloatingBarToggleSubtask?.((taskId, subtaskId) => {
      this.toggleTaskStatus(subtaskId);
      this.updateFloatingBar();
    });

    // Listen for floating bar remove task
    window.api.onFloatingBarRemoveTask?.((taskId) => {
      this.removeActiveTask(taskId);
      this.updateFloatingBar();
      this.render();
    });

    // Listen for realtime changes from teammates
    window.api.onRealtimeChange?.(async (change) => {
      console.log(`Realtime: ${change.eventType} on ${change.table}`);
      try {
        const freshData = await window.api.loadData();
        // Preserve local-only state
        const workingOnTaskIds = this.data.workingOnTaskIds;
        this.data = freshData;
        if (workingOnTaskIds) this.data.workingOnTaskIds = workingOnTaskIds;
        this.render();
      } catch (err) {
        console.error('Realtime refresh failed:', err.message);
      }
    });

  },

  handleFloatingBarComplete(taskId) {
    // Show completion summary modal
    this.showCompletionSummaryModal(taskId, () => {
      if (this.todayView.workingOnTaskIds.includes(taskId)) {
        this.removeActiveTask(taskId);
      }
      this.updateFloatingBar();
      this.render();
    });
  },

  // Add a task to the active list and persist so Claude can see it via MCP
  addActiveTask(taskId) {
    if (!taskId || this.todayView.workingOnTaskIds.includes(taskId)) return;
    this.todayView.workingOnTaskIds.push(taskId);
    this.data.workingOnTaskIds = [...this.todayView.workingOnTaskIds];
    this.saveData();
  },

  // Remove a task from the active list
  removeActiveTask(taskId) {
    this.todayView.workingOnTaskIds = this.todayView.workingOnTaskIds.filter(id => id !== taskId);
    this.data.workingOnTaskIds = [...this.todayView.workingOnTaskIds];
    this.saveData();
  },

  // Legacy compat: set a single working on task (replaces all)
  setWorkingOnTask(taskId) {
    if (taskId) {
      if (!this.todayView.workingOnTaskIds.includes(taskId)) {
        this.todayView.workingOnTaskIds.push(taskId);
      }
    } else {
      this.todayView.workingOnTaskIds = [];
    }
    this.data.workingOnTaskIds = [...this.todayView.workingOnTaskIds];
    this.saveData();
  },

  // Project view state helpers
  getProjectViewState(projectId) {
    if (!this._projectViewState[projectId]) {
      const persisted = this.data.projectViewPrefs[projectId] || {};
      this._projectViewState[projectId] = {
        viewMode: persisted.viewMode || 'list',
        filterStatus: persisted.filterStatus || 'active',
        filterPriority: persisted.filterPriority || 'all',
        filterExecType: persisted.filterExecType || 'all',
        sortBy: persisted.sortBy || 'priority',
        groupBy: persisted.groupBy || 'status',
        timelineRange: persisted.timelineRange || 'month'
      };
    }
    return this._projectViewState[projectId];
  },

  updateProjectViewPref(projectId, key, value) {
    const state = this.getProjectViewState(projectId);
    state[key] = value;
    if (!this.data.projectViewPrefs[projectId]) this.data.projectViewPrefs[projectId] = {};
    this.data.projectViewPrefs[projectId][key] = value;
    this.saveData();
    this.renderProjectView();
  },

  getProjectFilteredTasks(project, viewState) {
    let tasks = [...(project.tasks || [])];
    const priorities = { urgent: 0, high: 1, medium: 2, low: 3, none: 4 };

    // Status filter
    if (viewState.filterStatus === 'active') {
      tasks = tasks.filter(t => t.status !== 'done');
    } else if (viewState.filterStatus !== 'all') {
      tasks = tasks.filter(t => t.status === viewState.filterStatus);
    }

    // Priority filter
    if (viewState.filterPriority !== 'all') {
      tasks = tasks.filter(t => t.priority === viewState.filterPriority);
    }

    // Execution type filter
    if (viewState.filterExecType !== 'all') {
      tasks = tasks.filter(t => (t.executionType || 'manual') === viewState.filterExecType);
    }

    // Sort
    tasks.sort((a, b) => {
      switch (viewState.sortBy) {
        case 'priority':
          return (priorities[a.priority] || 4) - (priorities[b.priority] || 4);
        case 'dueDate':
          if (!a.dueDate && !b.dueDate) return 0;
          if (!a.dueDate) return 1;
          if (!b.dueDate) return -1;
          return a.dueDate.localeCompare(b.dueDate);
        case 'name':
          return a.name.localeCompare(b.name);
        case 'created':
        default:
          return new Date(b.createdAt) - new Date(a.createdAt);
      }
    });

    return tasks;
  },

  updateFloatingBar() {
    if (!this.floatingBarVisible || !window.api.updateFloatingBar) return;

    const allTasks = this.getAllTasks();
    const tasksData = this.todayView.workingOnTaskIds
      .map(id => allTasks.find(t => t.id === id))
      .filter(t => t && t.status !== 'done')
      .map(task => ({
        id: task.id,
        name: task.name,
        priority: task.priority || 'none',
        description: task.description || '',
        context: task.context || '',
        workNotes: task.workNotes || '',
        subtasks: (task.subtasks || []).map(st => ({
          id: st.id,
          name: st.name,
          status: st.status
        }))
      }));
    window.api.updateFloatingBar(tasksData);
  },

  handleTaskCaptured(task) {
    // Reload data and refresh
    window.api.loadData().then(data => {
      this.data = data;
      this.render();
    });
  },

  showToast(message, duration = 2000, type = 'default') {
    // Remove existing toast if any
    const existing = document.querySelector('.toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;

    if (type === 'success') {
      toast.innerHTML = `<svg class="toast-check" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"></polyline></svg><span>${this.escapeHtml(message)}</span>`;
    } else {
      toast.textContent = message;
    }

    document.body.appendChild(toast);

    // Trigger animation
    requestAnimationFrame(() => {
      toast.classList.add('show');
    });

    // Remove after duration
    setTimeout(() => {
      toast.classList.remove('show');
      setTimeout(() => toast.remove(), 300);
    }, duration);
  },

  // ── Undo System ────────────────────────────────────────────────

  pushUndo(description, undoFn) {
    this.undoStack.push({ description, undoFn, timestamp: Date.now() });
    if (this.undoStack.length > 30) this.undoStack.shift();
  },

  undo() {
    const action = this.undoStack.pop();
    if (!action) {
      this.showToast('Nothing to undo');
      return;
    }
    action.undoFn();
    this.saveData();
    this.render();
    this.showToast(`Undid: ${action.description}`);
  },
};
