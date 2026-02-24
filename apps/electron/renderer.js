// TaskFlow PM - Main Application Logic

// Shared priority color map — matches CSS variables
const PRIORITY_COLORS = {
  urgent: '#dc2626',
  high: '#f97316',
  medium: '#eab308',
  low: '#22c55e',
  none: '#dbd8d3'
};

class TaskFlowApp {
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

  }

  handleFloatingBarComplete(taskId) {
    // Show completion summary modal
    this.showCompletionSummaryModal(taskId, () => {
      if (this.todayView.workingOnTaskIds.includes(taskId)) {
        this.removeActiveTask(taskId);
      }
      this.updateFloatingBar();
      this.render();
    });
  }

  // Add a task to the active list and persist so Claude can see it via MCP
  addActiveTask(taskId) {
    if (!taskId || this.todayView.workingOnTaskIds.includes(taskId)) return;
    this.todayView.workingOnTaskIds.push(taskId);
    this.data.workingOnTaskIds = [...this.todayView.workingOnTaskIds];
    this.saveData();
  }

  // Remove a task from the active list
  removeActiveTask(taskId) {
    this.todayView.workingOnTaskIds = this.todayView.workingOnTaskIds.filter(id => id !== taskId);
    this.data.workingOnTaskIds = [...this.todayView.workingOnTaskIds];
    this.saveData();
  }

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
  }

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
  }

  updateProjectViewPref(projectId, key, value) {
    const state = this.getProjectViewState(projectId);
    state[key] = value;
    if (!this.data.projectViewPrefs[projectId]) this.data.projectViewPrefs[projectId] = {};
    this.data.projectViewPrefs[projectId][key] = value;
    this.saveData();
    this.renderProjectView();
  }

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
  }

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
  }

  handleTaskCaptured(task) {
    // Reload data and refresh
    window.api.loadData().then(data => {
      this.data = data;
      this.render();
    });
  }

  async refreshData() {
    this.data = await window.api.loadData();
    this.render();
    this.showToast('Data refreshed');
  }

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
  }

  // ── Undo System ────────────────────────────────────────────────

  pushUndo(description, undoFn) {
    this.undoStack.push({ description, undoFn, timestamp: Date.now() });
    if (this.undoStack.length > 30) this.undoStack.shift();
  }

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
  }

  // Data Management
  async saveData() {
    await window.api.saveData(this.data);
  }

  generateId() {
    // Use UUID for Supabase compatibility
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
      return crypto.randomUUID();
    }
    // Fallback for older environments
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
      const r = Math.random() * 16 | 0;
      return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
  }

  // Get today's date in local timezone as YYYY-MM-DD
  getLocalDateString(date = new Date()) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  // Convert ISO timestamp to local date string
  isoToLocalDate(isoString) {
    if (!isoString) return null;
    return this.getLocalDateString(new Date(isoString));
  }

  // Task CRUD
  createTask(taskData) {
    const task = {
      id: this.generateId(),
      name: taskData.name,
      description: taskData.description || '',
      context: taskData.context || '',  // Brain dump context for AI
      filePaths: taskData.filePaths || [],  // Attached file/folder paths
      projectId: taskData.projectId || null,
      status: taskData.status || 'todo',
      priority: taskData.priority || 'none',
      dueDate: taskData.dueDate || null,
      // Time blocking fields
      scheduledTime: taskData.scheduledTime || null,  // HH:MM format
      scheduledDate: taskData.scheduledDate || null,  // YYYY-MM-DD format
      startDate: taskData.startDate || null,  // YYYY-MM-DD — timeline start
      endDate: taskData.endDate || null,      // YYYY-MM-DD — timeline end
      assignee: taskData.assignee || null,    // Team member name
      estimatedMinutes: taskData.estimatedMinutes || null,  // Duration preset
      waitingReason: taskData.waitingReason || null,  // Why task is blocked
      blockedBy: taskData.blockedBy || null,  // Who/what is blocking
      complexity: taskData.complexity || null,  // 1-5 complexity score
      // Parallel execution field
      executionType: taskData.executionType || 'manual',  // 'ai' | 'manual' | 'hybrid'
      tags: taskData.tags || [],
      subtasks: [],
      parentId: taskData.parentId || null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      completedAt: null
    };

    if (task.parentId) {
      const parentTask = this.findTask(task.parentId);
      if (parentTask) {
        parentTask.subtasks.push(task);
      }
    } else {
      const project = this.data.projects.find(p => p.id === task.projectId);
      if (project) {
        project.tasks.push(task);
      } else {
        // Create inbox project if needed
        let inbox = this.data.projects.find(p => p.id === 'inbox');
        if (!inbox) {
          inbox = { id: 'inbox', name: 'Inbox', color: '#6366f1', tasks: [], isInbox: true };
          this.data.projects.unshift(inbox);
        }
        inbox.tasks.push(task);
      }
    }

    this.saveData();
    return task;
  }

  updateTask(taskId, updates) {
    const task = this.findTask(taskId);
    if (task) {
      Object.assign(task, updates);
      task.updatedAt = new Date().toISOString();
      if (updates.status === 'done' && !task.completedAt) {
        task.completedAt = new Date().toISOString();
      } else if (updates.status !== 'done') {
        task.completedAt = null;
      }
      this.saveData();
    }
    return task;
  }

  updateSubtask(parentTaskId, subtaskId, updates) {
    const parentTask = this.findTask(parentTaskId);
    if (parentTask && parentTask.subtasks) {
      const subtask = parentTask.subtasks.find(st => st.id === subtaskId);
      if (subtask) {
        Object.assign(subtask, updates);
        this.saveData();
        return subtask;
      }
    }
    return null;
  }

  deleteTask(taskId) {
    for (const project of this.data.projects) {
      const index = project.tasks.findIndex(t => t.id === taskId);
      if (index !== -1) {
        project.tasks.splice(index, 1);
        this.saveData();
        return true;
      }
      // Check subtasks
      for (const task of project.tasks) {
        const subIndex = task.subtasks.findIndex(st => st.id === taskId);
        if (subIndex !== -1) {
          task.subtasks.splice(subIndex, 1);
          this.saveData();
          return true;
        }
      }
    }
    return false;
  }

  findTask(taskId) {
    for (const project of this.data.projects) {
      const task = project.tasks.find(t => t.id === taskId);
      if (task) return task;
      for (const t of project.tasks) {
        const subtask = t.subtasks.find(st => st.id === taskId);
        if (subtask) return subtask;
      }
    }
    return null;
  }

  getAllTasks(includeSubtasks = false) {
    let tasks = [];
    for (const project of this.data.projects) {
      tasks = tasks.concat(project.tasks);
      if (includeSubtasks) {
        for (const task of project.tasks) {
          tasks = tasks.concat(task.subtasks);
        }
      }
    }
    return tasks;
  }

  getFilteredTasks() {
    let tasks = [];

    switch (this.currentView) {
      case 'inbox':
        const inbox = this.data.projects.find(p => p.id === 'inbox' || p.isInbox);
        if (inbox) tasks = inbox.tasks.filter(t => t.status !== 'done');
        break;
      case 'today':
        const today = this.getLocalDateString();
        tasks = this.getAllTasks().filter(t => t.dueDate === today && t.status !== 'done');
        break;
      case 'upcoming':
        const now = this.getLocalDateString();
        tasks = this.getAllTasks()
          .filter(t => {
            if (t.status === 'done') return false;
            // Include tasks with scheduledDate or dueDate in the future
            const schedDate = t.scheduledDate;
            const dueDate = t.dueDate;
            return (schedDate && schedDate >= now) || (dueDate && dueDate >= now);
          })
          .sort((a, b) => {
            // Sort by scheduledDate first, then dueDate
            const aDate = a.scheduledDate || a.dueDate || '9999-12-31';
            const bDate = b.scheduledDate || b.dueDate || '9999-12-31';
            return aDate.localeCompare(bDate);
          });
        break;
      case 'completed':
        tasks = this.getAllTasks().filter(t => t.status === 'done');
        break;
      case 'waiting':
        tasks = this.getAllTasks().filter(t => t.status === 'waiting');
        break;
      case 'master-list':
        tasks = this.getAllTasks();
        break;
      default:
        if (this.currentView.startsWith('project-')) {
          const projectId = this.currentView.replace('project-', '');
          const project = this.data.projects.find(p => p.id === projectId);
          if (project) tasks = project.tasks;
        } else if (this.currentView.startsWith('tag-')) {
          const tagId = this.currentView.replace('tag-', '');
          tasks = this.getAllTasks().filter(t => t.tags.includes(tagId));
        }
    }

    // Apply search filter
    if (this.searchQuery) {
      const query = this.searchQuery.toLowerCase();
      tasks = tasks.filter(t =>
        t.name.toLowerCase().includes(query) ||
        t.description.toLowerCase().includes(query)
      );
    }

    // Apply status filter
    if (this.filterStatus !== 'all') {
      tasks = tasks.filter(t => t.status === this.filterStatus);
    }

    // Apply sort
    tasks.sort((a, b) => {
      switch (this.sortBy) {
        case 'dueDate':
          if (!a.dueDate && !b.dueDate) return 0;
          if (!a.dueDate) return 1;
          if (!b.dueDate) return -1;
          return a.dueDate.localeCompare(b.dueDate);
        case 'priority':
          const priorities = { urgent: 0, high: 1, medium: 2, low: 3, none: 4 };
          return priorities[a.priority] - priorities[b.priority];
        case 'name':
          return a.name.localeCompare(b.name);
        default:
          return new Date(b.createdAt) - new Date(a.createdAt);
      }
    });

    return tasks;
  }

  // Project CRUD
  createProject(projectData) {
    const project = {
      id: this.generateId(),
      name: projectData.name,
      description: projectData.description || '',
      goal: projectData.goal || '',
      color: projectData.color || '#6366f1',
      categoryId: projectData.categoryId || null,
      status: projectData.status || 'active',
      workingDirectory: projectData.workingDirectory || null,
      tasks: [],
      createdAt: new Date().toISOString()
    };
    this.data.projects.push(project);
    this.saveData();
    return project;
  }

  // Category CRUD
  createCategory(categoryData) {
    const maxOrder = Math.max(0, ...this.data.categories.map(c => c.order || 0));
    const category = {
      id: this.generateId(),
      name: categoryData.name,
      color: categoryData.color || '#6366f1',
      order: maxOrder + 1,
      collapsed: false
    };
    this.data.categories.push(category);
    this.saveData();
    return category;
  }

  updateCategory(categoryId, updates) {
    const category = this.data.categories.find(c => c.id === categoryId);
    if (category) {
      Object.assign(category, updates);
      this.saveData();
    }
    return category;
  }

  deleteCategory(categoryId) {
    const index = this.data.categories.findIndex(c => c.id === categoryId);
    if (index !== -1) {
      // Move projects in this category to uncategorized
      for (const project of this.data.projects) {
        if (project.categoryId === categoryId) {
          project.categoryId = null;
        }
      }
      this.data.categories.splice(index, 1);
      this.saveData();
      return true;
    }
    return false;
  }

  toggleCategoryCollapsed(categoryId) {
    const category = this.data.categories.find(c => c.id === categoryId);
    if (category) {
      category.collapsed = !category.collapsed;
      this.saveData();
      this.renderSidebar();
    }
  }

  // Favorites management
  toggleFavorite(projectId) {
    if (!this.data.favorites) {
      this.data.favorites = [];
    }
    const index = this.data.favorites.indexOf(projectId);
    if (index === -1) {
      this.data.favorites.push(projectId);
    } else {
      this.data.favorites.splice(index, 1);
    }
    this.saveData();
    this.renderSidebar();
  }

  isFavorite(projectId) {
    return this.data.favorites && this.data.favorites.includes(projectId);
  }

  // Task Dependencies
  addDependency(taskId, blockerTaskId) {
    const task = this.findTask(taskId);
    const blocker = this.findTask(blockerTaskId);

    if (!task || !blocker || taskId === blockerTaskId) {
      return false;
    }

    // Check for circular dependency
    if (this.wouldCreateCircularDependency(taskId, blockerTaskId)) {
      return false;
    }

    // Initialize arrays if needed
    if (!Array.isArray(task.blockedBy)) task.blockedBy = [];
    if (!Array.isArray(blocker.blocks)) blocker.blocks = [];

    // Add dependency if not already present
    if (!task.blockedBy.includes(blockerTaskId)) {
      task.blockedBy.push(blockerTaskId);
    }
    if (!blocker.blocks.includes(taskId)) {
      blocker.blocks.push(taskId);
    }

    this.saveData();
    return true;
  }

  removeDependency(taskId, blockerTaskId) {
    const task = this.findTask(taskId);
    const blocker = this.findTask(blockerTaskId);

    if (task && Array.isArray(task.blockedBy)) {
      task.blockedBy = task.blockedBy.filter(id => id !== blockerTaskId);
    }
    if (blocker && Array.isArray(blocker.blocks)) {
      blocker.blocks = blocker.blocks.filter(id => id !== taskId);
    }

    this.saveData();
    return true;
  }

  wouldCreateCircularDependency(taskId, newBlockerId) {
    // Check if adding newBlockerId as a blocker of taskId would create a cycle
    const visited = new Set();
    const stack = [newBlockerId];

    while (stack.length > 0) {
      const currentId = stack.pop();
      if (currentId === taskId) {
        return true; // Cycle detected
      }
      if (visited.has(currentId)) {
        continue;
      }
      visited.add(currentId);

      const currentTask = this.findTask(currentId);
      if (currentTask && Array.isArray(currentTask.blockedBy)) {
        for (const blockerId of currentTask.blockedBy) {
          stack.push(blockerId);
        }
      }
    }
    return false;
  }

  isTaskBlocked(task) {
    if (!task || !Array.isArray(task.blockedBy) || task.blockedBy.length === 0) {
      return false;
    }
    // Check if any blocker is not done
    for (const blockerId of task.blockedBy) {
      const blocker = this.findTask(blockerId);
      if (blocker && blocker.status !== 'done') {
        return true;
      }
    }
    return false;
  }

  getBlockingTasks(task) {
    if (!task || !Array.isArray(task.blockedBy)) return [];
    return task.blockedBy
      .map(id => this.findTask(id))
      .filter(t => t && t.status !== 'done');
  }

  getBlockedTasks(task) {
    if (!task || !Array.isArray(task.blocks)) return [];
    return task.blocks
      .map(id => this.findTask(id))
      .filter(Boolean);
  }

  updateProject(projectId, updates) {
    const project = this.data.projects.find(p => p.id === projectId);
    if (project) {
      Object.assign(project, updates);
      this.saveData();
    }
    return project;
  }

  deleteProject(projectId) {
    const index = this.data.projects.findIndex(p => p.id === projectId);
    if (index !== -1 && !this.data.projects[index].isInbox) {
      this.data.projects.splice(index, 1);
      this.saveData();
      if (this.currentView === `project-${projectId}`) {
        this.currentView = 'inbox';
      }
      return true;
    }
    return false;
  }

  // Tag CRUD
  createTag(tagData) {
    const tag = {
      id: this.generateId(),
      name: tagData.name,
      color: tagData.color || '#6366f1'
    };
    this.data.tags.push(tag);
    this.saveData();
    return tag;
  }

  updateTag(tagId, updates) {
    const tag = this.data.tags.find(t => t.id === tagId);
    if (tag) {
      Object.assign(tag, updates);
      this.saveData();
    }
    return tag;
  }

  deleteTag(tagId) {
    const index = this.data.tags.findIndex(t => t.id === tagId);
    if (index !== -1) {
      this.data.tags.splice(index, 1);
      // Remove tag from all tasks
      for (const project of this.data.projects) {
        for (const task of project.tasks) {
          task.tags = task.tags.filter(t => t !== tagId);
        }
      }
      this.saveData();
      return true;
    }
    return false;
  }

  // Event Bindings
  bindEvents() {
    // Navigation
    document.querySelectorAll('.nav-item[data-view]').forEach(btn => {
      btn.addEventListener('click', () => this.setView(btn.dataset.view));
    });

    // View mode toggle
    document.querySelectorAll('.view-btn').forEach(btn => {
      btn.addEventListener('click', () => this.setViewMode(btn.dataset.viewMode));
    });

    // Search
    document.getElementById('search-input').addEventListener('input', (e) => {
      this.searchQuery = e.target.value;
      this.renderTasks();
    });

    // Sort and filter
    document.getElementById('sort-select').addEventListener('change', (e) => {
      this.sortBy = e.target.value;
      this.renderTasks();
    });

    document.getElementById('filter-status').addEventListener('change', (e) => {
      this.filterStatus = e.target.value;
      this.renderTasks();
    });

    // Add task button
    document.getElementById('quick-add-btn').addEventListener('click', () => this.openTaskModal());

    // Add project button
    document.getElementById('add-project-btn').addEventListener('click', () => this.openProjectModal());

    // Add tag button
    document.getElementById('add-tag-btn').addEventListener('click', () => this.openTagModal());

    // MCP Tools button
    document.getElementById('mcp-tools-btn').addEventListener('click', () => {
      this.openModal('mcp-tools-modal');
    });

    // Run Queue button
    document.getElementById('run-queue-btn').addEventListener('click', async () => {
      this.showToast('Starting Claude Queue...');
      const result = await window.api.runClaudeQueue();
      if (result.success) {
        this.showToast('Queue running in new window');
      } else {
        this.showToast('Failed to start queue: ' + result.error);
      }
    });

    // Settings button
    document.getElementById('settings-btn').addEventListener('click', () => {
      this.updateFontSizeDisplay();
      this.renderTeamMembersList();
      this.renderPendingInvitations();
      this.openModal('settings-modal');
    });

    // Team member invitation
    document.getElementById('invite-member-btn')?.addEventListener('click', () => this.inviteTeamMember());
    document.getElementById('invite-email-input')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); this.inviteTeamMember(); }
    });

    // Modal close buttons
    document.querySelectorAll('.modal-close').forEach(btn => {
      btn.addEventListener('click', () => this.closeModal(btn.dataset.modal));
    });

    // Click outside modal to close
    document.querySelectorAll('.modal').forEach(modal => {
      modal.addEventListener('click', (e) => {
        if (e.target === modal) this.closeModal(modal.id);
      });
    });

    // Task form
    document.getElementById('task-form').addEventListener('submit', (e) => {
      e.preventDefault();
      this.saveTaskForm();
    });

    // Project form
    document.getElementById('project-form').addEventListener('submit', (e) => {
      e.preventDefault();
      this.saveProjectForm();
    });

    // Tag form
    document.getElementById('tag-form').addEventListener('submit', (e) => {
      e.preventDefault();
      this.saveTagForm();
    });

    // Context guide toggle
    const contextToggle = document.getElementById('context-guide-toggle');
    const contextGuide = document.getElementById('context-guide');
    if (contextToggle && contextGuide) {
      contextToggle.addEventListener('click', () => {
        contextToggle.classList.toggle('expanded');
        contextGuide.classList.toggle('show');
        contextToggle.querySelector('span').textContent =
          contextGuide.classList.contains('show') ? 'Hide prompts' : 'Show prompts';
      });
    }

    // Color pickers
    this.bindColorPicker('project-color-picker', 'project-color');
    this.bindColorPicker('tag-color-picker', 'tag-color');
    this.bindColorPicker('category-color-picker', 'category-color');

    // Search projects button
    const searchProjectsBtn = document.getElementById('search-projects-btn');
    if (searchProjectsBtn) {
      searchProjectsBtn.addEventListener('click', () => {
        const searchBar = document.getElementById('project-search-bar');
        const searchInput = document.getElementById('project-search-input');
        if (searchBar) {
          searchBar.classList.toggle('hidden');
          if (!searchBar.classList.contains('hidden') && searchInput) {
            searchInput.focus();
          } else if (searchInput) {
            searchInput.value = '';
            this.filterProjects('');
          }
        }
      });
    }

    // Project search input
    const projectSearchInput = document.getElementById('project-search-input');
    if (projectSearchInput) {
      projectSearchInput.addEventListener('input', (e) => {
        this.filterProjects(e.target.value);
      });
    }

    // Category form
    const categoryForm = document.getElementById('category-form');
    if (categoryForm) {
      categoryForm.addEventListener('submit', (e) => {
        e.preventDefault();
        this.saveCategoryForm();
      });
    }

    // Delete category button
    const deleteCategoryBtn = document.getElementById('delete-category-btn');
    if (deleteCategoryBtn) {
      deleteCategoryBtn.addEventListener('click', () => this.confirmDeleteCategory());
    }

    // Dependency modal
    const addBlockerBtn = document.getElementById('add-blocker-btn');
    if (addBlockerBtn) {
      addBlockerBtn.addEventListener('click', () => this.addBlockerFromModal());
    }

    // Duration preset buttons
    document.querySelectorAll('.duration-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.duration-btn').forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
        document.getElementById('task-estimated-minutes').value = btn.dataset.minutes;
      });
    });

    // Delete buttons
    document.getElementById('delete-project-btn').addEventListener('click', () => this.confirmDeleteProject());
    document.getElementById('delete-tag-btn').addEventListener('click', () => this.confirmDeleteTag());

    // Close detail panel
    document.getElementById('close-detail').addEventListener('click', () => this.closeDetailPanel());

    // Export/Import
    document.getElementById('export-btn').addEventListener('click', () => this.exportData());
    document.getElementById('import-btn').addEventListener('click', () => this.importData());

    // Font size controls (using delegation on settings modal)
    document.getElementById('settings-modal').addEventListener('click', (e) => {
      const btn = e.target.closest('#font-size-decrease, #font-size-increase, #font-size-reset');
      if (!btn) return;
      if (btn.id === 'font-size-decrease') this.changeFontScale(-10);
      else if (btn.id === 'font-size-increase') this.changeFontScale(10);
      else if (btn.id === 'font-size-reset') this.resetFontScale();
    });

    // Calendar navigation
    document.getElementById('calendar-prev').addEventListener('click', () => this.navigateCalendar(-1));
    document.getElementById('calendar-next').addEventListener('click', () => this.navigateCalendar(1));
    document.getElementById('calendar-today').addEventListener('click', () => this.goToTodayCalendar());

    // Focus Mode button
    document.getElementById('focus-mode-btn').addEventListener('click', () => this.enterFocusMode());

    // Floating task bar toggle
    document.getElementById('floating-bar-btn')?.addEventListener('click', async () => {
      if (window.api && window.api.showFloatingBar) {
        this.floatingBarVisible = !this.floatingBarVisible;
        if (this.floatingBarVisible) {
          await window.api.showFloatingBar();
          this.updateFloatingBar();
        } else {
          await window.api.hideFloatingBar();
        }
      }
    });

    // Focus Mode controls
    document.getElementById('focus-exit-btn').addEventListener('click', () => this.exitFocusMode());
    document.getElementById('focus-prev-btn').addEventListener('click', () => this.focusPrevTask());
    document.getElementById('focus-next-btn').addEventListener('click', () => this.focusNextTask());
    document.getElementById('focus-minimize-btn').addEventListener('click', () => this.minimizeFocusMode());
    document.getElementById('focus-timer-toggle').addEventListener('click', () => this.toggleFocusTimer());
    document.getElementById('focus-complete-btn').addEventListener('click', () => this.completeFocusTask());
    document.getElementById('focus-skip-btn').addEventListener('click', () => this.skipFocusTask());
    document.getElementById('focus-settings-btn').addEventListener('click', () => this.toggleSettingsPanel());
    document.getElementById('focus-settings-close').addEventListener('click', () => this.toggleSettingsPanel(false));
    document.getElementById('settings-overlay').addEventListener('click', () => this.toggleSettingsPanel(false));

    // Timer settings
    document.querySelectorAll('.setting-btn').forEach(btn => {
      btn.addEventListener('click', () => this.handleTimerSetting(btn.dataset.action));
    });

    document.getElementById('focus-auto-start').addEventListener('change', (e) => {
      this.focusMode.autoStart = e.target.checked;
    });

    document.getElementById('focus-sounds').addEventListener('change', (e) => {
      this.focusMode.soundEnabled = e.target.checked;
    });

    // Mini focus widget
    document.getElementById('focus-mini-expand').addEventListener('click', () => this.expandFocusMode());
    document.getElementById('focus-mini-complete').addEventListener('click', () => this.completeFocusTask());
    document.getElementById('focus-mini-timer-toggle').addEventListener('click', () => this.toggleFocusTimer());

    // Make mini widget draggable
    this.initMiniWidgetDrag();

    // File path buttons
    const addFilePathBtn = document.getElementById('add-file-path-btn');
    if (addFilePathBtn) {
      addFilePathBtn.addEventListener('click', () => {
        const input = document.getElementById('file-path-input');
        const path = input.value.trim();
        if (path) {
          this.addFilePathToModal(path);
          input.value = '';
        }
      });
    }

    const browseFileBtn = document.getElementById('browse-file-btn');
    if (browseFileBtn) {
      browseFileBtn.addEventListener('click', async () => {
        if (window.api && window.api.browseFile) {
          const path = await window.api.browseFile();
          if (path) {
            this.addFilePathToModal(path);
          }
        }
      });
    }

    // Browse button for project working directory
    const browseDirBtn = document.getElementById('project-browse-dir');
    if (browseDirBtn) {
      browseDirBtn.addEventListener('click', async () => {
        if (window.api && window.api.browseFile) {
          const dirPath = await window.api.browseFile();
          if (dirPath) {
            document.getElementById('project-working-dir').value = dirPath;
          }
        }
      });
    }

    // Command Center buttons
    const startFocusBtn = document.getElementById('cc-start-focus');
    if (startFocusBtn) startFocusBtn.addEventListener('click', () => this.enterFocusMode());

    const processInboxBtn = document.getElementById('cc-process-inbox');
    if (processInboxBtn) processInboxBtn.addEventListener('click', () => this.setView('inbox'));

    // Toggle track button removed - always single-track mode now

    // Claude Queue buttons (sidebar)
    const openQueueBtn = document.getElementById('sidebar-open-queue');
    if (openQueueBtn) {
      openQueueBtn.addEventListener('click', () => {
        this.openFilePath('C:\\Users\\vince\\OneDrive\\Vincenzo\\Claude\\Claude Queue\\claude_queue.md');
      });
    }

    const runQueueBtn = document.getElementById('sidebar-run-queue');
    if (runQueueBtn) {
      runQueueBtn.addEventListener('click', () => {
        this.openFilePath('C:\\Users\\vince\\OneDrive\\Vincenzo\\Claude\\Claude Queue\\run_queue.bat');
      });
    }

    // Daily Recaps button
    const newRecapBtn = document.getElementById('cc-new-recap-btn');
    if (newRecapBtn) newRecapBtn.addEventListener('click', () => this.openDailyReview());

    // Daily Review modal
    const saveReviewBtn = document.getElementById('save-review-btn');
    if (saveReviewBtn) saveReviewBtn.addEventListener('click', () => this.saveDailyReview());

    // Rating buttons in Daily Review
    document.querySelectorAll('.rating-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.rating-btn').forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
      });
    });

    // Listen for actions from native pill window
    window.api.onPillAction((action) => this.handlePillAction(action));

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
      // Ctrl+Plus / Ctrl+Minus / Ctrl+0 for zoom
      if (e.ctrlKey && (e.key === '=' || e.key === '+')) {
        e.preventDefault();
        this.changeFontScale(10);
        return;
      }
      if (e.ctrlKey && e.key === '-') {
        e.preventDefault();
        this.changeFontScale(-10);
        return;
      }
      if (e.ctrlKey && e.key === '0') {
        e.preventDefault();
        this.resetFontScale();
        return;
      }

      // Check if we're in an input field
      const isInputFocused = document.activeElement.tagName === 'INPUT' ||
                             document.activeElement.tagName === 'TEXTAREA' ||
                             document.activeElement.tagName === 'SELECT';

      if (this.focusMode.active || this.focusMode.minimized) {
        // Focus mode keyboard shortcuts
        if (e.key === 'Escape') {
          e.preventDefault();
          if (this.focusMode.settingsPanelOpen) {
            this.toggleSettingsPanel(false);
          } else if (this.focusMode.minimized) {
            this.exitFocusMode();
          } else {
            this.exitFocusMode();
          }
        } else if (e.key === ' ' && !isInputFocused) {
          e.preventDefault();
          this.completeFocusTask();
        } else if (e.key === 'ArrowRight' || (e.key === 'l' && !isInputFocused)) {
          e.preventDefault();
          this.focusNextTask();
        } else if (e.key === 'ArrowLeft' || (e.key === 'h' && !isInputFocused)) {
          e.preventDefault();
          this.focusPrevTask();
        } else if ((e.key === 't' || e.key === 'T') && !isInputFocused) {
          e.preventDefault();
          this.toggleFocusTimer();
        } else if ((e.key === 's' || e.key === 'S') && !isInputFocused) {
          e.preventDefault();
          this.skipFocusTask();
        } else if ((e.key === 'm' || e.key === 'M') && !isInputFocused) {
          e.preventDefault();
          if (this.focusMode.minimized) {
            this.expandFocusMode();
          } else {
            this.minimizeFocusMode();
          }
        }
      } else {
        // Normal mode keyboard shortcuts
        if (e.key === 'Escape') {
          this.closeAllModals();
          this.closeDetailPanel();
          this.clearTaskSelection();
        }

        // Ctrl/Cmd shortcuts (work even in inputs)
        if (e.key === 'z' && (e.ctrlKey || e.metaKey) && !e.shiftKey) {
          e.preventDefault();
          this.undo();
          return;
        }

        if (e.key === 'n' && (e.ctrlKey || e.metaKey)) {
          e.preventDefault();
          this.openTaskModal();
        }

        if (e.key === 'k' && (e.ctrlKey || e.metaKey)) {
          e.preventDefault();
          this.openCommandPalette();
          return;
        }

        // Skip single-key shortcuts if in an input field
        if (isInputFocused) return;

        switch (e.key.toLowerCase()) {
          // Navigation
          case 't':
            if (!e.ctrlKey && !e.metaKey) {
              e.preventDefault();
              this.setView('today');
            }
            break;
          case 'i':
            e.preventDefault();
            this.setView('inbox');
            break;
          case 'c':
            e.preventDefault();
            this.setView('command-center');
            break;
          case 'p':
            e.preventDefault();
            this.setView('projects');
            break;

          // Quick add
          case 'n':
            e.preventDefault();
            this.openTaskModal();
            break;
          case 'b':
            e.preventDefault();
            // Open quick capture for brain dump
            if (window.api && window.api.showCapture) {
              window.api.showCapture();
            }
            break;

          // Task navigation
          case 'j':
          case 'arrowdown':
            e.preventDefault();
            this.selectNextTask();
            break;
          case 'k':
          case 'arrowup':
            e.preventDefault();
            this.selectPrevTask();
            break;

          // Task actions
          case ' ':
            e.preventDefault();
            this.toggleSelectedTaskComplete();
            break;
          case 'enter':
            e.preventDefault();
            this.openSelectedTaskDetail();
            break;
          case 'e':
            e.preventDefault();
            this.editSelectedTask();
            break;
          case 'd':
            if (e.shiftKey) {
              e.preventDefault();
              this.deleteSelectedTask();
            }
            break;

          // Priority cycling: 1-4 or P to cycle
          case '1':
            e.preventDefault();
            this.setSelectedTaskPriority('low');
            break;
          case '2':
            e.preventDefault();
            this.setSelectedTaskPriority('medium');
            break;
          case '3':
            e.preventDefault();
            this.setSelectedTaskPriority('high');
            break;
          case '4':
            e.preventDefault();
            this.setSelectedTaskPriority('urgent');
            break;

          // Schedule for today (toggle)
          case 's':
            e.preventDefault();
            this.toggleSelectedTaskToday();
            break;

          // Focus mode
          case 'f':
            e.preventDefault();
            this.enterFocusMode();
            break;

          // Refresh data
          case 'r':
            e.preventDefault();
            this.refreshData();
            break;

          // Help
          case '?':
            e.preventDefault();
            this.showKeyboardShortcuts();
            break;

          // Assign to Claude
          case 'q':
            e.preventDefault();
            this.toggleSelectedTaskClaude();
            break;

          // Command palette
          case '/':
            e.preventDefault();
            this.openCommandPalette();
            break;

          // Toggle subtask expand (Today view)
          case 'x':
            e.preventDefault();
            this.toggleSelectedTaskSubtasks();
            break;

          // Add to active / working on now (Today view)
          case 'a':
            e.preventDefault();
            this.addSelectedTaskToActive();
            break;
        }

        // F5 to refresh (not lowercase, handle separately)
        if (e.key === 'F5') {
          e.preventDefault();
          this.refreshData();
        }
      }
    });

    // Track selected task for keyboard navigation
    this.selectedTaskIndex = -1;
    this.selectedTaskId = null;
  }

  // Keyboard navigation helpers
  getVisibleTasks() {
    const taskElements = document.querySelectorAll('.task-item, .task-card, .focus-queue-item, .today-task-item');
    return Array.from(taskElements).filter(el => el.offsetParent !== null);
  }

  selectNextTask() {
    const tasks = this.getVisibleTasks();
    if (tasks.length === 0) return;

    this.selectedTaskIndex = Math.min(this.selectedTaskIndex + 1, tasks.length - 1);
    this.highlightSelectedTask(tasks);
  }

  selectPrevTask() {
    const tasks = this.getVisibleTasks();
    if (tasks.length === 0) return;

    this.selectedTaskIndex = Math.max(this.selectedTaskIndex - 1, 0);
    this.highlightSelectedTask(tasks);
  }

  highlightSelectedTask(tasks) {
    // Remove previous selection
    document.querySelectorAll('.task-item, .task-card, .focus-queue-item, .today-task-item').forEach(el => {
      el.classList.remove('keyboard-selected');
    });

    if (this.selectedTaskIndex >= 0 && this.selectedTaskIndex < tasks.length) {
      const selected = tasks[this.selectedTaskIndex];
      selected.classList.add('keyboard-selected');
      selected.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      this.selectedTaskId = selected.dataset.taskId || selected.dataset.id;
    }
  }

  clearTaskSelection() {
    this.selectedTaskIndex = -1;
    this.selectedTaskId = null;
    document.querySelectorAll('.keyboard-selected').forEach(el => {
      el.classList.remove('keyboard-selected');
    });
  }

  selectTask(taskId, element) {
    // Clear previous selection
    document.querySelectorAll('.keyboard-selected').forEach(el => {
      el.classList.remove('keyboard-selected');
    });

    // Set new selection
    this.selectedTaskId = taskId;
    if (element) {
      element.classList.add('keyboard-selected');
      // Update index for J/K navigation
      const tasks = this.getVisibleTasks();
      this.selectedTaskIndex = tasks.indexOf(element);
    }
  }

  toggleSelectedTaskComplete() {
    if (!this.selectedTaskId) return;
    const task = this.findTask(this.selectedTaskId);
    if (task) {
      const wasDone = task.status === 'done';
      this.updateTask(this.selectedTaskId, {
        status: wasDone ? 'todo' : 'done'
      });
      if (!wasDone) {
        this.showToast(`${task.name} completed`, 2000, 'success');
        this.addCompletionToRecap(task.name, null);
        if (this.todayView.workingOnTaskIds.includes(this.selectedTaskId)) {
          this.removeActiveTask(this.selectedTaskId);
          this.updateFloatingBar();
        }
      }
      this.render();
    }
  }

  openSelectedTaskDetail() {
    if (this.selectedTaskId) {
      this.openDetailPanel(this.selectedTaskId);
    }
  }

  editSelectedTask() {
    if (this.selectedTaskId) {
      this.openEditTaskModal(this.selectedTaskId);
    }
  }

  deleteSelectedTask() {
    if (this.selectedTaskId) {
      if (confirm('Delete this task?')) {
        this.deleteTask(this.selectedTaskId);
        this.clearTaskSelection();
      }
    }
  }

  setSelectedTaskPriority(priority) {
    if (!this.selectedTaskId) return;
    this.updateTask(this.selectedTaskId, { priority });
    this.render();
  }

  toggleSelectedTaskToday() {
    if (!this.selectedTaskId) return;
    this.openSnoozePopup(this.selectedTaskId);
  }

  // Snooze / Reschedule popup
  openSnoozePopup(taskId) {
    const task = this.findTask(taskId);
    if (!task) return;

    this._snoozeTaskId = taskId;

    const overlay = document.getElementById('snooze-popup');
    const datePicker = document.getElementById('snooze-date-picker');
    if (!overlay) return;

    // Reset date picker
    datePicker.style.display = 'none';
    datePicker.value = '';

    // Show popup with animation
    overlay.style.display = 'flex';
    requestAnimationFrame(() => overlay.classList.add('visible'));

    // Bind events once
    if (!this._snoozePopupBound) {
      this._snoozePopupBound = true;

      // Click on option buttons
      overlay.querySelectorAll('.snooze-option').forEach(btn => {
        btn.addEventListener('click', () => {
          this.handleSnoozeAction(btn.dataset.action);
        });
      });

      // Click outside to close
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) this.closeSnoozePopup();
      });

      // Date picker change
      datePicker.addEventListener('change', () => {
        if (datePicker.value) {
          this.rescheduleTask(this._snoozeTaskId, datePicker.value);
          this.closeSnoozePopup();
        }
      });

      // Keyboard handler
      document.addEventListener('keydown', (e) => {
        if (!this._snoozeTaskId) return;
        const popup = document.getElementById('snooze-popup');
        if (!popup || popup.style.display === 'none') return;

        switch (e.key.toLowerCase()) {
          case 'escape':
            e.preventDefault();
            e.stopPropagation();
            this.closeSnoozePopup();
            break;
          case 't':
            e.preventDefault();
            e.stopPropagation();
            this.handleSnoozeAction('tomorrow');
            break;
          case 'n':
            e.preventDefault();
            e.stopPropagation();
            this.handleSnoozeAction('next-week');
            break;
          case 'd':
            e.preventDefault();
            e.stopPropagation();
            this.handleSnoozeAction('pick-date');
            break;
          case 'r':
            e.preventDefault();
            e.stopPropagation();
            this.handleSnoozeAction('remove');
            break;
          case 's':
            e.preventDefault();
            e.stopPropagation();
            this.handleSnoozeAction('today');
            break;
        }
      }, true); // capture phase so it fires before other handlers
    }
  }

  closeSnoozePopup() {
    const overlay = document.getElementById('snooze-popup');
    if (!overlay) return;

    overlay.classList.remove('visible');
    setTimeout(() => {
      overlay.style.display = 'none';
    }, 200);

    this._snoozeTaskId = null;
  }

  handleSnoozeAction(action) {
    const taskId = this._snoozeTaskId;
    if (!taskId) return;

    if (action === 'pick-date') {
      const datePicker = document.getElementById('snooze-date-picker');
      datePicker.style.display = 'block';
      datePicker.focus();
      datePicker.showPicker?.();
      return;
    }

    let targetDate = null;

    if (action === 'tomorrow') {
      const d = new Date();
      d.setDate(d.getDate() + 1);
      targetDate = this.getLocalDateString(d);
    } else if (action === 'next-week') {
      const d = new Date();
      d.setDate(d.getDate() + 7);
      targetDate = this.getLocalDateString(d);
    } else if (action === 'today') {
      targetDate = this.getLocalDateString();
    } else if (action === 'remove') {
      targetDate = null;
    }

    this.rescheduleTask(taskId, targetDate);
    this.closeSnoozePopup();
  }

  rescheduleTask(taskId, newDate) {
    const task = this.findTask(taskId);
    const updates = { scheduledDate: newDate, scheduledTime: null };

    // Track snooze count when rescheduling to a different date (not removing)
    if (newDate && task) {
      updates.snoozeCount = (task.snoozeCount || 0) + 1;
    }

    this.updateTask(taskId, updates);

    if (newDate) {
      const count = updates.snoozeCount || 0;
      const suffix = count > 1 ? ` (snoozed ${count}x)` : '';
      this.showToast(`Rescheduled to ${newDate}${suffix}`);
    } else {
      this.showToast('Schedule removed');
    }

    this.render();
  }

  // Blocker reason popup
  showBlockerReasonPopup(taskId, onComplete) {
    const overlay = document.getElementById('blocker-popup');
    if (!overlay) return;

    overlay.style.display = 'flex';
    requestAnimationFrame(() => overlay.classList.add('visible'));

    const close = () => {
      overlay.classList.remove('visible');
      setTimeout(() => { overlay.style.display = 'none'; }, 200);
    };

    // One-time binding
    if (!this._blockerPopupBound) {
      this._blockerPopupBound = true;

      overlay.querySelectorAll('.blocker-option').forEach(btn => {
        btn.addEventListener('click', () => {
          if (!this._blockerTaskId) return;
          const reason = btn.dataset.reason;
          this.updateTask(this._blockerTaskId, { status: 'waiting', waitingReason: reason });
          this.showToast(`Marked waiting — ${reason}`);
          close();
          if (this._blockerCallback) this._blockerCallback();
        });
      });

      document.getElementById('blocker-skip').addEventListener('click', () => {
        if (!this._blockerTaskId) return;
        this.updateTask(this._blockerTaskId, { status: 'waiting' });
        this.showToast('Marked waiting');
        close();
        if (this._blockerCallback) this._blockerCallback();
      });

      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) {
          close();
          this._blockerTaskId = null;
        }
      });
    }

    this._blockerTaskId = taskId;
    this._blockerCallback = onComplete;
  }

  toggleSelectedTaskClaude() {
    if (!this.selectedTaskId) return;

    const task = this.findTask(this.selectedTaskId);
    if (!task) return;

    const newAssignment = task.assignedTo === 'claude' ? null : 'claude';
    this.updateTask(this.selectedTaskId, { assignedTo: newAssignment });

    if (newAssignment === 'claude') {
      this.showToast('Assigned to Claude');
    } else {
      this.showToast('Unassigned from Claude');
    }
    this.render();
  }

  toggleSelectedTaskSubtasks() {
    if (!this.selectedTaskId) return;
    if (!this.todayView?.expandedUpNextIds) return;
    if (this.todayView.expandedUpNextIds.has(this.selectedTaskId)) {
      this.todayView.expandedUpNextIds.delete(this.selectedTaskId);
    } else {
      this.todayView.expandedUpNextIds.add(this.selectedTaskId);
    }
    this.renderTodayView();
  }

  addSelectedTaskToActive() {
    if (!this.selectedTaskId) return;
    if (this.todayView.workingOnTaskIds.includes(this.selectedTaskId)) {
      this.removeActiveTask(this.selectedTaskId);
      this.showToast('Removed from active');
    } else {
      this.addActiveTask(this.selectedTaskId);
      this.showToast('Added to active');
    }
    this.renderTodayView();
  }

  showKeyboardShortcuts() {
    const shortcuts = `
      <div class="shortcuts-modal-content">
        <h3>Keyboard Shortcuts</h3>
        <div class="shortcuts-grid">
          <div class="shortcut-section">
            <h4>Navigation</h4>
            <div class="shortcut-item"><kbd>T</kbd> Today view</div>
            <div class="shortcut-item"><kbd>I</kbd> Inbox</div>
            <div class="shortcut-item"><kbd>C</kbd> Command Center</div>
            <div class="shortcut-item"><kbd>P</kbd> Projects</div>
          </div>
          <div class="shortcut-section">
            <h4>Tasks</h4>
            <div class="shortcut-item"><kbd>N</kbd> New task</div>
            <div class="shortcut-item"><kbd>B</kbd> Brain dump (quick capture)</div>
            <div class="shortcut-item"><kbd>J</kbd>/<kbd>K</kbd> Navigate up/down</div>
            <div class="shortcut-item"><kbd>Space</kbd> Complete task</div>
            <div class="shortcut-item"><kbd>Enter</kbd> Open task details</div>
            <div class="shortcut-item"><kbd>E</kbd> Edit task</div>
            <div class="shortcut-item"><kbd>S</kbd> Reschedule task</div>
            <div class="shortcut-item"><kbd>Q</kbd> Assign to Claude</div>
            <div class="shortcut-item"><kbd>A</kbd> Add/remove from active</div>
            <div class="shortcut-item"><kbd>X</kbd> Toggle subtasks</div>
            <div class="shortcut-item"><kbd>Shift+D</kbd> Delete task</div>
          </div>
          <div class="shortcut-section">
            <h4>Priority</h4>
            <div class="shortcut-item"><kbd>1</kbd> Low</div>
            <div class="shortcut-item"><kbd>2</kbd> Medium</div>
            <div class="shortcut-item"><kbd>3</kbd> High</div>
            <div class="shortcut-item"><kbd>4</kbd> Urgent</div>
          </div>
          <div class="shortcut-section">
            <h4>Other</h4>
            <div class="shortcut-item"><kbd>/</kbd> or <kbd>Ctrl+K</kbd> Search tasks</div>
            <div class="shortcut-item"><kbd>F</kbd> Focus mode</div>
            <div class="shortcut-item"><kbd>R</kbd> / <kbd>F5</kbd> Refresh data</div>
            <div class="shortcut-item"><kbd>Esc</kbd> Close/cancel</div>
            <div class="shortcut-item"><kbd>?</kbd> This help</div>
          </div>
        </div>
      </div>
    `;

    // Create temporary modal
    const modal = document.createElement('div');
    modal.className = 'modal visible';
    modal.id = 'shortcuts-modal';
    modal.innerHTML = `<div class="modal-content shortcuts-modal">${shortcuts}</div>`;
    document.body.appendChild(modal);

    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        modal.remove();
      }
    });

    document.addEventListener('keydown', function escHandler(e) {
      if (e.key === 'Escape') {
        modal.remove();
        document.removeEventListener('keydown', escHandler);
      }
    });
  }

  bindColorPicker(pickerId, inputId) {
    const picker = document.getElementById(pickerId);
    const input = document.getElementById(inputId);

    picker.querySelectorAll('.color-option').forEach(option => {
      option.addEventListener('click', () => {
        picker.querySelectorAll('.color-option').forEach(o => o.classList.remove('selected'));
        option.classList.add('selected');
        input.value = option.dataset.color;
      });
    });
  }

  // View Management
  setView(view) {
    this.currentView = view;
    document.querySelectorAll('.nav-item[data-view]').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.view === view);
    });
    document.querySelectorAll('.project-item, .tag-item').forEach(item => {
      item.classList.remove('active');
    });

    if (view.startsWith('project-')) {
      const projectItem = document.querySelector(`.project-item[data-id="${view.replace('project-', '')}"]`);
      if (projectItem) projectItem.classList.add('active');
    } else if (view.startsWith('tag-')) {
      const tagItem = document.querySelector(`.tag-item[data-id="${view.replace('tag-', '')}"]`);
      if (tagItem) tagItem.classList.add('active');
    }

    // Hide all views first
    document.getElementById('task-list-view').classList.remove('active');
    document.getElementById('task-board-view').classList.remove('active');
    document.getElementById('calendar-view').classList.remove('active');
    const commandCenterView = document.getElementById('command-center-view');
    if (commandCenterView) commandCenterView.classList.remove('active');
    const claudeView = document.getElementById('claude-view');
    if (claudeView) claudeView.classList.remove('active');

    // Handle special views
    if (view === 'command-center' || view === 'today') {
      if (commandCenterView) commandCenterView.classList.add('active');
      document.querySelector('.view-options').style.display = 'none';
      document.querySelector('.sort-select').style.display = 'none';
      document.querySelector('.filter-select').style.display = 'none';
      this.renderCommandCenter();
    } else if (view === 'calendar' || view === 'upcoming') {
      this.currentView = 'calendar';
      document.getElementById('calendar-view').classList.add('active');
      document.querySelector('.view-options').style.display = 'none';
      document.querySelector('.sort-select').style.display = 'none';
      document.querySelector('.filter-select').style.display = 'none';
      this.renderCalendar();
    } else if (view === 'recaps') {
      document.getElementById('task-list-view').classList.add('active');
      document.querySelector('.view-options').style.display = 'none';
      document.querySelector('.sort-select').style.display = 'none';
      document.querySelector('.filter-select').style.display = 'none';
      this.renderRecapsView();
    } else if (view === 'inbox') {
      document.getElementById('task-list-view').classList.add('active');
      document.querySelector('.view-options').style.display = 'none';
      document.querySelector('.sort-select').style.display = 'none';
      document.querySelector('.filter-select').style.display = 'none';
      this.renderInbox();
    } else if (view === 'master-list') {
      document.getElementById('task-list-view').classList.add('active');
      document.querySelector('.view-options').style.display = 'none';
      document.querySelector('.sort-select').style.display = 'none';
      document.querySelector('.filter-select').style.display = 'none';
      this.renderMasterList();
    } else if (view === 'dashboard') {
      document.getElementById('task-list-view').classList.add('active');
      document.querySelector('.view-options').style.display = 'none';
      document.querySelector('.sort-select').style.display = 'none';
      document.querySelector('.filter-select').style.display = 'none';
      this.renderDashboard();
    } else if (view === 'claude') {
      document.getElementById('claude-view').classList.add('active');
      document.querySelector('.view-options').style.display = 'none';
      document.querySelector('.sort-select').style.display = 'none';
      document.querySelector('.filter-select').style.display = 'none';
      this.renderClaudeView();
    } else if (view.startsWith('project-')) {
      document.getElementById('task-list-view').classList.add('active');
      document.querySelector('.view-options').style.display = 'none';
      document.querySelector('.sort-select').style.display = 'none';
      document.querySelector('.filter-select').style.display = 'none';
      this.renderProjectView();
    } else {
      // Show list or board view based on current mode
      if (this.currentViewMode === 'list') {
        document.getElementById('task-list-view').classList.add('active');
      } else {
        document.getElementById('task-board-view').classList.add('active');
      }
      document.querySelector('.view-options').style.display = '';
      document.querySelector('.sort-select').style.display = '';
      document.querySelector('.filter-select').style.display = '';
      this.renderTasks();
    }

    this.updateViewTitle();
    this.closeDetailPanel();
  }

  setViewMode(mode) {
    this.currentViewMode = mode;
    document.querySelectorAll('.view-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.viewMode === mode);
    });
    document.getElementById('task-list-view').classList.toggle('active', mode === 'list');
    document.getElementById('task-board-view').classList.toggle('active', mode === 'board');
    document.getElementById('calendar-view').classList.toggle('active', false);
    this.renderTasks();
  }

  // Calendar Methods
  navigateCalendar(direction) {
    this.calendar.currentDate.setMonth(this.calendar.currentDate.getMonth() + direction);
    this.renderCalendar();
  }

  goToTodayCalendar() {
    this.calendar.currentDate = new Date();
    this.calendar.selectedDate = this.getLocalDateString();
    this.renderCalendar();
    this.renderCalendarDetail(this.calendar.selectedDate);
  }

  renderCalendar() {
    // Bind view toggle buttons
    this.bindCalendarViewToggle();

    // Show/hide views based on mode
    const monthView = document.getElementById('calendar-month-view');
    const weekView = document.getElementById('calendar-week-view');
    const dayView = document.getElementById('calendar-day-view');

    if (monthView) monthView.classList.toggle('hidden', this.calendar.viewMode !== 'month');
    if (weekView) weekView.classList.toggle('hidden', this.calendar.viewMode !== 'week');
    if (dayView) dayView.classList.toggle('hidden', this.calendar.viewMode !== 'day');

    // Render based on view mode
    switch (this.calendar.viewMode) {
      case 'week':
        this.renderCalendarWeekView();
        break;
      case 'day':
        this.renderCalendarDayView();
        break;
      default:
        this.renderCalendarMonthView();
    }
  }

  bindCalendarViewToggle() {
    document.querySelectorAll('.calendar-view-btn').forEach(btn => {
      btn.onclick = () => {
        document.querySelectorAll('.calendar-view-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.calendar.viewMode = btn.dataset.calendarView;
        this.renderCalendar();
      };
    });
  }

  renderCalendarMonthView() {
    const year = this.calendar.currentDate.getFullYear();
    const month = this.calendar.currentDate.getMonth();

    // Update title
    const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
                        'July', 'August', 'September', 'October', 'November', 'December'];
    document.getElementById('calendar-month').textContent = `${monthNames[month]} ${year}`;

    // Get first and last day of month
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const startDate = new Date(firstDay);
    startDate.setDate(startDate.getDate() - firstDay.getDay());

    const endDate = new Date(lastDay);
    endDate.setDate(endDate.getDate() + (6 - lastDay.getDay()));

    const grid = document.getElementById('calendar-grid');
    grid.innerHTML = '';

    const today = this.getLocalDateString();
    const tasks = this.getAllTasks(true);

    // Build day data
    const currentDate = new Date(startDate);
    while (currentDate <= endDate) {
      const dateStr = this.getLocalDateString(currentDate);
      const isCurrentMonth = currentDate.getMonth() === month;
      const isToday = dateStr === today;
      const isSelected = dateStr === this.calendar.selectedDate;

      // Get tasks for this day
      const dueTasks = tasks.filter(t => t.dueDate === dateStr && t.status !== 'done');
      const completedTasks = tasks.filter(t => t.completedAt && this.isoToLocalDate(t.completedAt) === dateStr);
      const overdueTasks = tasks.filter(t => t.dueDate === dateStr && t.dueDate < today && t.status !== 'done');

      const dayEl = document.createElement('div');
      dayEl.className = 'calendar-day';
      if (!isCurrentMonth) dayEl.classList.add('other-month');
      if (isToday) dayEl.classList.add('today');
      if (isSelected) dayEl.classList.add('selected');
      if (dueTasks.length > 0) dayEl.classList.add('has-tasks');
      if (completedTasks.length > 0) dayEl.classList.add('has-completed');

      let indicatorsHtml = '';
      if (overdueTasks.length > 0) {
        indicatorsHtml += '<span class="day-indicator overdue"></span>';
      }
      if (dueTasks.length > 0) {
        indicatorsHtml += '<span class="day-indicator due"></span>';
      }
      if (completedTasks.length > 0) {
        indicatorsHtml += '<span class="day-indicator completed"></span>';
      }

      let statsHtml = '';
      if (completedTasks.length > 0 || dueTasks.length > 0) {
        const parts = [];
        if (completedTasks.length > 0) parts.push(`${completedTasks.length} done`);
        if (dueTasks.length > 0) parts.push(`${dueTasks.length} due`);
        statsHtml = `<span class="day-stats">${parts.join(', ')}</span>`;
      }

      dayEl.innerHTML = `
        <span class="day-number">${currentDate.getDate()}</span>
        <div class="day-indicators">${indicatorsHtml}</div>
        ${statsHtml}
      `;

      dayEl.addEventListener('click', () => {
        document.querySelectorAll('.calendar-day.selected').forEach(d => d.classList.remove('selected'));
        dayEl.classList.add('selected');
        this.calendar.selectedDate = dateStr;
        this.renderCalendarDetail(dateStr);
      });

      grid.appendChild(dayEl);
      currentDate.setDate(currentDate.getDate() + 1);
    }
  }

  renderCalendarWeekView() {
    const weekStart = new Date(this.calendar.currentDate);
    weekStart.setDate(weekStart.getDate() - weekStart.getDay()); // Start on Sunday

    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekEnd.getDate() + 6);

    // Update title
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const startMonth = monthNames[weekStart.getMonth()];
    const endMonth = monthNames[weekEnd.getMonth()];
    const title = startMonth === endMonth
      ? `${startMonth} ${weekStart.getDate()} - ${weekEnd.getDate()}, ${weekEnd.getFullYear()}`
      : `${startMonth} ${weekStart.getDate()} - ${endMonth} ${weekEnd.getDate()}, ${weekEnd.getFullYear()}`;
    document.getElementById('calendar-month').textContent = title;

    const headerContainer = document.getElementById('week-header');
    const gridContainer = document.getElementById('week-grid');
    const today = this.getLocalDateString();
    const tasks = this.getAllTasks(true);
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

    // Build header with day columns
    let headerHtml = '<div class="week-time-column"></div>';
    for (let i = 0; i < 7; i++) {
      const date = new Date(weekStart);
      date.setDate(date.getDate() + i);
      const dateStr = this.getLocalDateString(date);
      const isToday = dateStr === today;
      headerHtml += `
        <div class="week-day-header ${isToday ? 'today' : ''}" data-date="${dateStr}">
          <span class="week-day-name">${dayNames[i]}</span>
          <span class="week-day-date">${date.getDate()}</span>
        </div>
      `;
    }
    headerContainer.innerHTML = headerHtml;

    // Build time grid (6am - 10pm, 15-minute slots)
    let gridHtml = '';
    for (let hour = 6; hour <= 22; hour++) {
      for (let quarter = 0; quarter < 4; quarter++) {
        const timeStr = `${String(hour).padStart(2, '0')}:${String(quarter * 15).padStart(2, '0')}`;
        const displayTime = quarter === 0 ? this.formatTimeDisplay(hour, 0) : '';

        gridHtml += `<div class="week-time-slot">${displayTime}</div>`;

        for (let day = 0; day < 7; day++) {
          const date = new Date(weekStart);
          date.setDate(date.getDate() + day);
          const dateStr = this.getLocalDateString(date);
          const isToday = dateStr === today;

          gridHtml += `
            <div class="week-cell ${isToday ? 'today' : ''}"
                 data-date="${dateStr}"
                 data-time="${timeStr}">
            </div>
          `;
        }
      }
    }
    gridContainer.innerHTML = gridHtml;

    // Render scheduled tasks on the grid
    for (let day = 0; day < 7; day++) {
      const date = new Date(weekStart);
      date.setDate(date.getDate() + day);
      const dateStr = this.getLocalDateString(date);

      const dayTasks = tasks.filter(t =>
        (t.scheduledDate === dateStr || t.dueDate === dateStr) &&
        t.scheduledTime &&
        t.status !== 'done'
      );

      dayTasks.forEach(task => {
        const cell = gridContainer.querySelector(`[data-date="${dateStr}"][data-time="${task.scheduledTime}"]`);
        if (cell) {
          const duration = task.estimatedMinutes || 30;
          const slots = Math.ceil(duration / 15);
          const taskEl = document.createElement('div');
          taskEl.className = `week-task-block priority-${task.priority || 'none'}`;
          taskEl.style.height = `${slots * 20}px`;
          taskEl.innerHTML = `<span class="week-task-name">${this.escapeHtml(task.name)}</span>`;
          taskEl.dataset.taskId = task.id;
          taskEl.onclick = () => this.openDetailPanel(task.id);
          cell.appendChild(taskEl);
        }
      });
    }

    // Bind drop zones for scheduling
    gridContainer.querySelectorAll('.week-cell').forEach(cell => {
      cell.addEventListener('dragover', (e) => {
        e.preventDefault();
        cell.classList.add('drag-over');
      });
      cell.addEventListener('dragleave', () => cell.classList.remove('drag-over'));
      cell.addEventListener('drop', (e) => {
        e.preventDefault();
        cell.classList.remove('drag-over');
        const taskId = e.dataTransfer.getData('text/plain');
        if (taskId) {
          this.updateTask(taskId, {
            scheduledDate: cell.dataset.date,
            scheduledTime: cell.dataset.time
          });
          this.renderCalendar();
        }
      });
    });
  }

  renderCalendarDayView() {
    const currentDate = new Date(this.calendar.currentDate);
    const dateStr = this.getLocalDateString(currentDate);
    const today = this.getLocalDateString();
    const isToday = dateStr === today;

    // Update title
    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
                        'July', 'August', 'September', 'October', 'November', 'December'];
    const title = `${dayNames[currentDate.getDay()]}, ${monthNames[currentDate.getMonth()]} ${currentDate.getDate()}`;
    document.getElementById('calendar-month').textContent = title;

    const headerContainer = document.getElementById('day-header');
    const timelineContainer = document.getElementById('day-timeline');
    const unscheduledContainer = document.getElementById('day-unscheduled');
    const tasks = this.getAllTasks(true);

    // Day header
    headerContainer.innerHTML = `
      <div class="day-header-content ${isToday ? 'today' : ''}">
        <span class="day-header-date">${currentDate.getDate()}</span>
        <span class="day-header-label">${isToday ? 'Today' : dayNames[currentDate.getDay()]}</span>
      </div>
    `;

    // Get tasks for this day
    const dayTasks = tasks.filter(t =>
      (t.dueDate === dateStr || t.scheduledDate === dateStr) && t.status !== 'done'
    );
    const scheduledTasks = dayTasks.filter(t => t.scheduledTime);
    const unscheduledTasks = dayTasks.filter(t => !t.scheduledTime);

    // Build timeline (6am - 10pm, 15-minute slots)
    let timelineHtml = '';
    for (let hour = 6; hour <= 22; hour++) {
      for (let quarter = 0; quarter < 4; quarter++) {
        const timeStr = `${String(hour).padStart(2, '0')}:${String(quarter * 15).padStart(2, '0')}`;
        const displayTime = quarter === 0 ? this.formatTimeDisplay(hour, 0) : '';
        const isHourStart = quarter === 0;

        timelineHtml += `
          <div class="day-time-row ${isHourStart ? 'hour-start' : ''}" data-time="${timeStr}">
            <div class="day-time-label">${displayTime}</div>
            <div class="day-time-slot" data-date="${dateStr}" data-time="${timeStr}"></div>
          </div>
        `;
      }
    }
    timelineContainer.innerHTML = timelineHtml;

    // Render scheduled tasks
    scheduledTasks.forEach(task => {
      const slot = timelineContainer.querySelector(`.day-time-slot[data-time="${task.scheduledTime}"]`);
      if (slot) {
        const duration = task.estimatedMinutes || 30;
        const slots = Math.ceil(duration / 15);
        const taskEl = document.createElement('div');
        taskEl.className = `day-task-block priority-${task.priority || 'none'}`;
        taskEl.style.height = `${slots * 24 - 4}px`;
        taskEl.innerHTML = `
          <div class="day-task-name">${this.escapeHtml(task.name)}</div>
          <div class="day-task-time">${this.formatTimeDisplay(...task.scheduledTime.split(':').map(Number))} · ${duration}m</div>
        `;
        taskEl.dataset.taskId = task.id;
        taskEl.onclick = () => this.openDetailPanel(task.id);
        slot.appendChild(taskEl);
      }
    });

    // Render unscheduled tasks
    if (unscheduledTasks.length > 0) {
      unscheduledContainer.innerHTML = `
        <div class="day-unscheduled-header">
          <span>Unscheduled (${unscheduledTasks.length})</span>
          <span class="day-unscheduled-hint">Drag to timeline to schedule</span>
        </div>
        <div class="day-unscheduled-list">
          ${unscheduledTasks.map(task => `
            <div class="day-unscheduled-task priority-${task.priority || 'none'}"
                 data-task-id="${task.id}"
                 draggable="true">
              <span class="day-task-name">${this.escapeHtml(task.name)}</span>
              <span class="day-task-duration">${task.estimatedMinutes || 30}m</span>
            </div>
          `).join('')}
        </div>
      `;

      // Bind drag events for unscheduled tasks
      unscheduledContainer.querySelectorAll('.day-unscheduled-task').forEach(item => {
        item.addEventListener('dragstart', (e) => {
          e.dataTransfer.setData('text/plain', item.dataset.taskId);
          item.classList.add('dragging');
        });
        item.addEventListener('dragend', () => item.classList.remove('dragging'));
        item.addEventListener('click', () => this.openDetailPanel(item.dataset.taskId));
      });
    } else {
      unscheduledContainer.innerHTML = '';
    }

    // Bind drop zones
    timelineContainer.querySelectorAll('.day-time-slot').forEach(slot => {
      slot.addEventListener('dragover', (e) => {
        e.preventDefault();
        slot.classList.add('drag-over');
      });
      slot.addEventListener('dragleave', () => slot.classList.remove('drag-over'));
      slot.addEventListener('drop', (e) => {
        e.preventDefault();
        slot.classList.remove('drag-over');
        const taskId = e.dataTransfer.getData('text/plain');
        if (taskId) {
          this.updateTask(taskId, {
            scheduledDate: slot.dataset.date,
            scheduledTime: slot.dataset.time
          });
          this.renderCalendar();
        }
      });
    });
  }

  formatTimeDisplay(hour, minute) {
    const ampm = hour >= 12 ? 'PM' : 'AM';
    const displayHour = hour > 12 ? hour - 12 : (hour === 0 ? 12 : hour);
    return minute === 0 ? `${displayHour} ${ampm}` : `${displayHour}:${String(minute).padStart(2, '0')} ${ampm}`;
  }

  renderCalendarDetail(dateStr) {
    const detail = document.getElementById('calendar-detail');
    const tasks = this.getAllTasks(true);
    const today = this.getLocalDateString();

    const dueTasks = tasks.filter(t => t.dueDate === dateStr);
    const completedTasks = tasks.filter(t => t.completedAt && this.isoToLocalDate(t.completedAt) === dateStr);

    const date = new Date(dateStr + 'T00:00:00');
    const dateLabel = date.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });

    if (dueTasks.length === 0 && completedTasks.length === 0) {
      detail.innerHTML = `
        <div class="calendar-detail-header">
          <span class="calendar-detail-date">${dateLabel}</span>
        </div>
        <div class="calendar-empty">
          <p>No tasks or accomplishments for this day</p>
        </div>
      `;
      return;
    }

    let html = `
      <div class="calendar-detail-header">
        <span class="calendar-detail-date">${dateLabel}</span>
        <div class="calendar-detail-stats">
          ${completedTasks.length > 0 ? `<span class="calendar-stat"><span class="calendar-stat-value">${completedTasks.length}</span> completed</span>` : ''}
          ${dueTasks.filter(t => t.status !== 'done').length > 0 ? `<span class="calendar-stat"><span class="calendar-stat-value">${dueTasks.filter(t => t.status !== 'done').length}</span> due</span>` : ''}
        </div>
      </div>
    `;

    if (completedTasks.length > 0) {
      html += `
        <div class="calendar-section">
          <div class="calendar-section-title">Accomplished</div>
          <div class="calendar-task-list">
      `;
      completedTasks.forEach(t => {
        const project = this.data.projects.find(p => p.tasks.some(pt => pt.id === t.id));
        const execCls = t.executionType ? `exec-${t.executionType}` : '';
        html += `
          <div class="calendar-task-item completed ${execCls}">
            <span class="calendar-task-status completed"></span>
            <span class="calendar-task-name">${this.escapeHtml(t.name)}</span>
            ${project && !project.isInbox ? `<span class="calendar-task-project">${this.escapeHtml(project.name)}</span>` : ''}
          </div>
        `;
      });
      html += '</div></div>';
    }

    const pendingDue = dueTasks.filter(t => t.status !== 'done');
    if (pendingDue.length > 0) {
      const isOverdue = dateStr < today;
      html += `
        <div class="calendar-section">
          <div class="calendar-section-title">${isOverdue ? 'Was Due (Overdue)' : 'Due'}</div>
          <div class="calendar-task-list">
      `;
      pendingDue.forEach(t => {
        const project = this.data.projects.find(p => p.tasks.some(pt => pt.id === t.id));
        const execCls = t.executionType ? `exec-${t.executionType}` : '';
        html += `
          <div class="calendar-task-item ${execCls}">
            <span class="calendar-task-status ${isOverdue ? 'overdue' : 'due'}"></span>
            <span class="calendar-task-name">${this.escapeHtml(t.name)}</span>
            ${project && !project.isInbox ? `<span class="calendar-task-project">${this.escapeHtml(project.name)}</span>` : ''}
          </div>
        `;
      });
      html += '</div></div>';
    }

    detail.innerHTML = html;
  }

  updateViewTitle() {
    const titleEl = document.getElementById('view-title');
    const subtitleEl = document.getElementById('view-subtitle');

    const titles = {
      inbox: 'Inbox',
      today: 'Today',
      upcoming: 'Upcoming',
      completed: 'Completed',
      calendar: 'Calendar',
      waiting: 'Waiting',
      'command-center': 'Command Center',
      'master-list': 'Master List',
      'dashboard': 'Dashboard',
      'recaps': 'Daily Recaps'
    };

    const subtitles = {
      inbox: 'Process and organize your captures',
      calendar: 'View your accomplishments and upcoming work',
      waiting: 'Tasks blocked on someone or something',
      'command-center': 'Your AI-powered mission control',
      'master-list': 'All tasks in one compact view',
      'dashboard': 'Project health at a glance',
      'recaps': 'Track your progress and learnings'
    };

    if (titles[this.currentView]) {
      titleEl.textContent = titles[this.currentView];
      subtitleEl.textContent = subtitles[this.currentView] || '';
    } else if (this.currentView.startsWith('project-')) {
      const project = this.data.projects.find(p => p.id === this.currentView.replace('project-', ''));
      titleEl.textContent = project ? project.name : 'Project';
      subtitleEl.textContent = project ? project.description : '';
    } else if (this.currentView.startsWith('tag-')) {
      const tag = this.data.tags.find(t => t.id === this.currentView.replace('tag-', ''));
      titleEl.textContent = tag ? `#${tag.name}` : 'Tag';
      subtitleEl.textContent = '';
    }
  }

  // Rendering
  render() {
    this.renderProjects();
    this.renderTags();
    this.updateCounts();

    // Highlight correct nav item
    document.querySelectorAll('.nav-item[data-view]').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.view === this.currentView);
    });

    // Hide all views first
    document.querySelectorAll('.task-view').forEach(v => v.classList.remove('active'));

    // Helper to hide header controls
    const hideHeaderControls = () => {
      document.querySelector('.view-options')?.style && (document.querySelector('.view-options').style.display = 'none');
      document.querySelector('.sort-select')?.style && (document.querySelector('.sort-select').style.display = 'none');
      document.querySelector('.filter-select')?.style && (document.querySelector('.filter-select').style.display = 'none');
    };
    const showHeaderControls = () => {
      document.querySelector('.view-options')?.style && (document.querySelector('.view-options').style.display = '');
      document.querySelector('.sort-select')?.style && (document.querySelector('.sort-select').style.display = '');
      document.querySelector('.filter-select')?.style && (document.querySelector('.filter-select').style.display = '');
    };

    // Render the appropriate view
    if (this.currentView === 'today' || this.currentView === 'command-center') {
      document.getElementById('command-center-view')?.classList.add('active');
      hideHeaderControls();
      this.renderCommandCenter();
    } else if (this.currentView === 'calendar' || this.currentView === 'upcoming') {
      document.getElementById('calendar-view')?.classList.add('active');
      hideHeaderControls();
      this.renderCalendar();
    } else if (this.currentView === 'recaps') {
      document.getElementById('task-list-view')?.classList.add('active');
      hideHeaderControls();
      this.renderRecapsView();
    } else if (this.currentView === 'master-list') {
      document.getElementById('task-list-view')?.classList.add('active');
      hideHeaderControls();
      this.renderMasterList();
    } else if (this.currentView === 'inbox') {
      document.getElementById('task-list-view')?.classList.add('active');
      hideHeaderControls();
      this.renderInbox();
    } else if (this.currentView === 'dashboard') {
      document.getElementById('task-list-view')?.classList.add('active');
      hideHeaderControls();
      this.renderDashboard();
    } else if (this.currentView === 'claude') {
      document.getElementById('claude-view')?.classList.add('active');
      hideHeaderControls();
      this.renderClaudeView();
    } else if (this.currentView.startsWith('project-')) {
      document.getElementById('task-list-view')?.classList.add('active');
      hideHeaderControls();
      this.renderProjectView();
    } else {
      showHeaderControls();
      this.renderTasks();
    }

    this.updateStatusBar();
  }

  updateStatusBar() {
    const bar = document.getElementById('status-bar');
    if (!bar) return;

    const today = new Date().toISOString().split('T')[0];
    const allTasks = this.getAllTasks();
    const todayTasks = allTasks.filter(t =>
      t.status !== 'done' && (t.dueDate === today || t.scheduledDate === today)
    );
    const priorityOrder = { urgent: 0, high: 1, medium: 2, low: 3, none: 4 };

    // Current active task
    const workingIds = this.data.workingOnTaskIds || this.todayView?.workingOnTaskIds || [];
    const currentTask = workingIds.length > 0 ? this.findTask(workingIds[0]) : null;

    const dot = bar.querySelector('.status-dot');
    const taskName = bar.querySelector('.status-task-name');
    if (currentTask) {
      dot.classList.add('active');
      taskName.textContent = currentTask.name;
    } else {
      dot.classList.remove('active');
      taskName.textContent = 'No active task';
    }

    // Next task from today queue (first non-active by priority)
    const nextTask = todayTasks
      .filter(t => !workingIds.includes(t.id))
      .sort((a, b) => (priorityOrder[a.priority] || 4) - (priorityOrder[b.priority] || 4))[0];
    const nextNameEl = bar.querySelector('.status-next-name');
    if (nextNameEl) {
      nextNameEl.textContent = nextTask ? nextTask.name : '--';
    }

    // Count
    const countEl = document.getElementById('status-bar-count');
    if (countEl) {
      countEl.textContent = `${todayTasks.length} task${todayTasks.length !== 1 ? 's' : ''} today`;
    }
  }

  renderSidebar() {
    this.renderFavorites();
    this.renderCategoriesTree();
  }

  renderFavorites() {
    const container = document.getElementById('sidebar-favorites');
    if (!container) return;
    container.innerHTML = '';

    const favoriteIds = this.data.favorites || [];
    const favorites = favoriteIds
      .map(id => this.data.projects.find(p => p.id === id))
      .filter(p => p && !p.isInbox);

    if (favorites.length === 0) {
      return;
    }

    // Add favorites header
    const header = document.createElement('div');
    header.className = 'favorites-header';
    header.innerHTML = '<span class="star-icon">&#9733;</span><span>Favorites</span>';
    container.appendChild(header);

    for (const project of favorites) {
      container.appendChild(this.createProjectItem(project, true));
    }
  }

  renderCategoriesTree() {
    const container = document.getElementById('categories-tree');
    if (!container) return;
    container.innerHTML = '';

    const categories = this.data.categories || [];
    const projects = this.data.projects.filter(p => !p.isInbox);

    // Sort categories by order
    const sortedCategories = [...categories].sort((a, b) => (a.order || 0) - (b.order || 0));

    // Render each category
    for (const category of sortedCategories) {
      const categoryProjects = projects.filter(p => p.categoryId === category.id);
      const totalTasks = categoryProjects.reduce((sum, p) =>
        sum + p.tasks.filter(t => t.status !== 'done').length, 0);

      const group = document.createElement('div');
      group.className = `category-group${category.collapsed ? ' collapsed' : ''}`;
      group.dataset.categoryId = category.id;

      group.innerHTML = `
        <div class="category-header">
          <span class="category-toggle">&#9660;</span>
          <span class="category-color" style="background:${category.color}"></span>
          <span class="category-name">${this.escapeHtml(category.name)}</span>
          <span class="category-count">${totalTasks}</span>
          <button class="category-edit" title="Edit">&#9998;</button>
        </div>
        <div class="category-projects" style="max-height: ${category.collapsed ? 0 : categoryProjects.length * 40 + 8}px"></div>
      `;

      // Toggle collapse on header click
      group.querySelector('.category-header').addEventListener('click', (e) => {
        if (!e.target.classList.contains('category-edit')) {
          this.toggleCategoryCollapsed(category.id);
        }
      });

      // Edit category
      group.querySelector('.category-edit').addEventListener('click', (e) => {
        e.stopPropagation();
        this.openCategoryModal(category.id);
      });

      // Add projects to category
      const projectsContainer = group.querySelector('.category-projects');
      for (const project of categoryProjects) {
        projectsContainer.appendChild(this.createProjectItem(project, false));
      }

      container.appendChild(group);
    }

    // Render uncategorized projects
    const uncategorized = projects.filter(p => !p.categoryId);
    if (uncategorized.length > 0) {
      const group = document.createElement('div');
      group.className = 'category-group';

      const totalTasks = uncategorized.reduce((sum, p) =>
        sum + p.tasks.filter(t => t.status !== 'done').length, 0);

      group.innerHTML = `
        <div class="category-header">
          <span class="category-toggle">&#9660;</span>
          <span class="category-color" style="background:var(--text-muted)"></span>
          <span class="category-name">Uncategorized</span>
          <span class="category-count">${totalTasks}</span>
        </div>
        <div class="category-projects" style="max-height: ${uncategorized.length * 40 + 8}px"></div>
      `;

      group.querySelector('.category-header').addEventListener('click', () => {
        group.classList.toggle('collapsed');
        const projectsContainer = group.querySelector('.category-projects');
        if (group.classList.contains('collapsed')) {
          projectsContainer.style.maxHeight = '0';
        } else {
          projectsContainer.style.maxHeight = uncategorized.length * 40 + 8 + 'px';
        }
      });

      const projectsContainer = group.querySelector('.category-projects');
      for (const project of uncategorized) {
        projectsContainer.appendChild(this.createProjectItem(project, false));
      }

      container.appendChild(group);
    }
  }

  createProjectItem(project, inFavorites) {
    const taskCount = project.tasks.filter(t => t.status !== 'done').length;
    const isFavorite = this.isFavorite(project.id);

    const el = document.createElement('button');
    el.className = 'project-item';
    el.dataset.id = project.id;

    el.innerHTML = `
      <span class="project-color" style="background:${project.color}"></span>
      <span class="project-name">${this.escapeHtml(project.name)}</span>
      <span class="project-count">${taskCount}</span>
      <button class="project-favorite-btn ${isFavorite ? 'favorited' : ''}" title="${isFavorite ? 'Remove from favorites' : 'Add to favorites'}">
        ${isFavorite ? '&#9733;' : '&#9734;'}
      </button>
      <button class="project-edit" title="Edit">&#9998;</button>
    `;

    el.addEventListener('click', (e) => {
      if (!e.target.classList.contains('project-edit') &&
          !e.target.classList.contains('project-favorite-btn')) {
        this.setView(`project-${project.id}`);
      }
    });

    el.querySelector('.project-favorite-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggleFavorite(project.id);
    });

    el.querySelector('.project-edit').addEventListener('click', (e) => {
      e.stopPropagation();
      this.openProjectModal(project.id);
    });

    return el;
  }

  filterProjects(query) {
    const projects = this.data.projects.filter(p => !p.isInbox);
    if (!query) {
      this.renderCategoriesTree();
      return;
    }

    const lowerQuery = query.toLowerCase();
    const matching = projects.filter(p =>
      p.name.toLowerCase().includes(lowerQuery)
    );

    const container = document.getElementById('categories-tree');
    if (!container) return;
    container.innerHTML = '';

    for (const project of matching) {
      container.appendChild(this.createProjectItem(project, false));
    }
  }

  // Legacy method for compatibility
  renderProjects() {
    this.renderSidebar();
  }

  renderTags() {
    const container = document.getElementById('tags-list');
    container.innerHTML = '';

    for (const tag of this.data.tags) {
      const tagCount = this.getAllTasks().filter(t => t.tags.includes(tag.id) && t.status !== 'done').length;
      const el = document.createElement('button');
      el.className = 'tag-item';
      el.dataset.id = tag.id;
      el.innerHTML = `
        <span class="tag-color" style="background:${tag.color}"></span>
        <span class="tag-name">${this.escapeHtml(tag.name)}</span>
        <span class="tag-count">${tagCount}</span>
        <button class="tag-edit" title="Edit">&#9998;</button>
      `;

      el.addEventListener('click', (e) => {
        if (!e.target.classList.contains('tag-edit')) {
          this.setView(`tag-${tag.id}`);
        }
      });

      el.querySelector('.tag-edit').addEventListener('click', (e) => {
        e.stopPropagation();
        this.openTagModal(tag.id);
      });

      container.appendChild(el);
    }

    // Update tag selector in task form
    this.renderTagsSelector();
  }

  renderTagsSelector() {
    const container = document.getElementById('tags-selector');
    container.innerHTML = '';

    for (const tag of this.data.tags) {
      const label = document.createElement('label');
      label.className = 'tag-checkbox';
      label.style.color = tag.color;
      label.innerHTML = `
        <input type="checkbox" value="${tag.id}">
        <span class="tag-color" style="background:${tag.color}"></span>
        <span>${this.escapeHtml(tag.name)}</span>
      `;

      label.querySelector('input').addEventListener('change', () => {
        label.classList.toggle('selected', label.querySelector('input').checked);
      });

      container.appendChild(label);
    }
  }

  updateCounts() {
    // Inbox count
    const inbox = this.data.projects.find(p => p.id === 'inbox' || p.isInbox);
    const inboxCount = inbox ? inbox.tasks.filter(t => t.status !== 'done').length : 0;
    document.getElementById('inbox-count').textContent = inboxCount;

    // Today count (due today OR scheduled today)
    const today = this.getLocalDateString();
    const allTasks = this.getAllTasks();
    const todayCount = allTasks.filter(t =>
      (t.dueDate === today || t.scheduledDate === today) && t.status !== 'done'
    ).length;
    document.getElementById('today-count').textContent = todayCount;

    // Waiting count
    const waitingCount = allTasks.filter(t => t.status === 'waiting').length;
    const waitingCountEl = document.getElementById('waiting-count');
    if (waitingCountEl) waitingCountEl.textContent = waitingCount;
  }

  renderTasks() {
    // Show appropriate view container
    if (this.currentView === 'master-list') {
      document.getElementById('task-list-view')?.classList.add('active');
      this.renderMasterList();
    } else if (this.currentViewMode === 'list') {
      document.getElementById('task-list-view')?.classList.add('active');
      this.renderTaskList();
    } else {
      document.getElementById('task-board-view')?.classList.add('active');
      this.renderTaskBoard();
    }
  }

  renderMasterList() {
    const container = document.getElementById('tasks-container');
    let tasks = this.getFilteredTasks();

    // Initialize master list filter state
    if (this._masterListFilter === undefined) {
      this._masterListFilter = {
        hideCompleted: true,
        status: 'all',
        priority: 'all',
        project: 'all'
      };
    }

    // Apply master list filters
    if (this._masterListFilter.hideCompleted) {
      tasks = tasks.filter(t => t.status !== 'done');
    }
    if (this._masterListFilter.status !== 'all') {
      tasks = tasks.filter(t => t.status === this._masterListFilter.status);
    }
    if (this._masterListFilter.priority !== 'all') {
      tasks = tasks.filter(t => t.priority === this._masterListFilter.priority);
    }
    if (this._masterListFilter.project !== 'all') {
      tasks = tasks.filter(t => {
        const project = this.data.projects.find(p => p.tasks.some(pt => pt.id === t.id));
        return project && project.id === this._masterListFilter.project;
      });
    }

    const allTasks = this.getAllTasks();
    const activeCount = allTasks.filter(t => t.status !== 'done').length;
    const completedCount = allTasks.filter(t => t.status === 'done').length;

    // Calculate time budget
    const totalMinutes = tasks.reduce((sum, t) => sum + (t.estimatedMinutes || 30), 0);
    const budgetHours = Math.floor(totalMinutes / 60);
    const budgetMins = totalMinutes % 60;

    // Build project options
    const projectOptions = this.data.projects
      .filter(p => !p.isInbox)
      .map(p => `<option value="${p.id}" ${this._masterListFilter.project === p.id ? 'selected' : ''}>${this.escapeHtml(p.name)}</option>`)
      .join('');

    container.innerHTML = `
      <div class="master-list-view">
        <div class="master-list-header">
          <span class="master-list-count">${tasks.length} shown (${activeCount} active, ${completedCount} done)</span>
          <span class="master-list-time-budget">${budgetHours}h ${budgetMins}m total</span>
          <button class="btn btn-small btn-plan-day" id="impact-review-btn" title="Copy strategic impact review prompt for Claude">Impact Review</button>
        </div>

        <!-- Bulk Actions Toolbar -->
        <div class="master-list-bulk-toolbar ${this._selectedTasks.size > 0 ? '' : 'hidden'}">
          <span class="bulk-select-count">${this._selectedTasks.size} selected</span>
          <button class="bulk-action-btn" data-action="complete">&#10003; Complete</button>
          <button class="bulk-action-btn" data-action="schedule-today">&#128197; Today</button>
          <button class="bulk-action-btn" data-action="set-priority">&#9733; Priority</button>
          <button class="bulk-action-btn" data-action="add-to-queue">&#9654; Add to Queue</button>
          <button class="bulk-action-btn danger" data-action="delete">&#128465; Delete</button>
          <button class="bulk-action-btn" data-action="clear">Clear Selection</button>
        </div>

        <div class="master-list-filters">
          <label class="master-filter-toggle">
            <input type="checkbox" id="ml-hide-completed" ${this._masterListFilter.hideCompleted ? 'checked' : ''}>
            <span>Hide completed</span>
          </label>
          <select id="ml-filter-status" class="master-filter-select">
            <option value="all" ${this._masterListFilter.status === 'all' ? 'selected' : ''}>All Statuses</option>
            <option value="todo" ${this._masterListFilter.status === 'todo' ? 'selected' : ''}>Inbox</option>
            <option value="ready" ${this._masterListFilter.status === 'ready' ? 'selected' : ''}>Ready</option>
            <option value="in-progress" ${this._masterListFilter.status === 'in-progress' ? 'selected' : ''}>In Progress</option>
            <option value="waiting" ${this._masterListFilter.status === 'waiting' ? 'selected' : ''}>Waiting</option>
          </select>
          <select id="ml-filter-priority" class="master-filter-select">
            <option value="all" ${this._masterListFilter.priority === 'all' ? 'selected' : ''}>All Priorities</option>
            <option value="urgent" ${this._masterListFilter.priority === 'urgent' ? 'selected' : ''}>Urgent</option>
            <option value="high" ${this._masterListFilter.priority === 'high' ? 'selected' : ''}>High</option>
            <option value="medium" ${this._masterListFilter.priority === 'medium' ? 'selected' : ''}>Medium</option>
            <option value="low" ${this._masterListFilter.priority === 'low' ? 'selected' : ''}>Low</option>
          </select>
          <select id="ml-filter-project" class="master-filter-select">
            <option value="all" ${this._masterListFilter.project === 'all' ? 'selected' : ''}>All Projects</option>
            ${projectOptions}
          </select>
          <div class="master-list-grouping-selector">
            <label>Group by:</label>
            <select id="ml-group-by">
              <option value="none" ${this._masterListGroupBy === 'none' ? 'selected' : ''}>None</option>
              <option value="project" ${this._masterListGroupBy === 'project' ? 'selected' : ''}>Project</option>
              <option value="priority" ${this._masterListGroupBy === 'priority' ? 'selected' : ''}>Priority</option>
              <option value="status" ${this._masterListGroupBy === 'status' ? 'selected' : ''}>Status</option>
              <option value="dueDate" ${this._masterListGroupBy === 'dueDate' ? 'selected' : ''}>Due Date</option>
            </select>
          </div>
        </div>
        <div class="master-list-container" id="master-list-container"></div>
      </div>
    `;

    // Impact Review button
    const impactBtn = document.getElementById('impact-review-btn');
    if (impactBtn) {
      impactBtn.onclick = () => this.impactReviewPrompt();
    }

    // Bind filter events
    document.getElementById('ml-hide-completed').addEventListener('change', (e) => {
      this._masterListFilter.hideCompleted = e.target.checked;
      this.renderMasterList();
    });
    document.getElementById('ml-filter-status').addEventListener('change', (e) => {
      this._masterListFilter.status = e.target.value;
      this.renderMasterList();
    });
    document.getElementById('ml-filter-priority').addEventListener('change', (e) => {
      this._masterListFilter.priority = e.target.value;
      this.renderMasterList();
    });
    document.getElementById('ml-filter-project').addEventListener('change', (e) => {
      this._masterListFilter.project = e.target.value;
      this.renderMasterList();
    });
    document.getElementById('ml-group-by').addEventListener('change', (e) => {
      this._masterListGroupBy = e.target.value;
      this.renderMasterList();
    });

    // Bind bulk action buttons
    document.querySelectorAll('.bulk-action-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const action = btn.dataset.action;
        if (action === 'clear') {
          this.clearTaskSelection();
        } else {
          this.executeBulkAction(action);
        }
      });
    });

    const listContainer = document.getElementById('master-list-container');

    if (tasks.length === 0) {
      listContainer.innerHTML = `<div class="master-list-empty">No tasks match filters</div>`;
      return;
    }

    // Group tasks if grouping is enabled
    if (this._masterListGroupBy !== 'none') {
      const groups = this.groupTasksBy(tasks, this._masterListGroupBy);

      // Sort groups
      const sortedGroupKeys = Object.keys(groups).sort((a, b) => {
        if (this._masterListGroupBy === 'priority') {
          const order = { urgent: 0, high: 1, medium: 2, low: 3, none: 4 };
          return (order[a] ?? 5) - (order[b] ?? 5);
        }
        return groups[b].tasks.length - groups[a].tasks.length;
      });

      sortedGroupKeys.forEach(key => {
        const group = groups[key];
        const groupEl = document.createElement('div');
        groupEl.className = 'master-list-group';
        groupEl.dataset.groupKey = key;

        groupEl.innerHTML = `
          <div class="master-list-group-header">
            <span class="master-list-group-toggle">&#9660;</span>
            <span class="master-list-group-color" style="background: ${group.color}; width: 12px; height: 12px; border-radius: 3px;"></span>
            <span class="master-list-group-name">${this.escapeHtml(group.label)}</span>
            <span class="master-list-group-count">${group.tasks.length} tasks</span>
          </div>
          <div class="master-list-group-tasks"></div>
        `;

        const tasksContainer = groupEl.querySelector('.master-list-group-tasks');
        group.tasks.forEach(task => {
          tasksContainer.appendChild(this.createMasterListItem(task));
        });

        // Toggle collapse
        groupEl.querySelector('.master-list-group-header').addEventListener('click', () => {
          groupEl.classList.toggle('collapsed');
        });

        listContainer.appendChild(groupEl);
      });
    } else {
      // Render flat list
      tasks.forEach(task => {
        listContainer.appendChild(this.createMasterListItem(task));
      });
    }
  }

  createMasterListItem(task) {
    const project = this.data.projects.find(p => p.tasks.some(t => t.id === task.id));
    const isCompleted = task.status === 'done';
    const isSelected = this._selectedTasks.has(task.id);

    const el = document.createElement('div');
    el.className = `master-list-item ${isCompleted ? 'completed' : ''} ${isSelected ? 'selected' : ''} priority-${task.priority}`;
    el.dataset.id = task.id;

    // Tags HTML with colors
    let tagsHtml = '';
    if (task.tags && task.tags.length > 0) {
      tagsHtml = task.tags.map(tagId => {
        const tag = this.data.tags.find(t => t.id === tagId);
        return tag ? `<span class="master-list-tag" style="background:${tag.color}">${this.escapeHtml(tag.name)}</span>` : '';
      }).join('');
    }

    let filesHtml = '';
    if (task.filePaths && task.filePaths.length > 0) {
      filesHtml = `<div class="master-list-files">
        ${task.filePaths.map(fp => `<span class="master-list-file-icon" title="${this.escapeHtml(fp)}" data-path="${this.escapeHtml(fp)}">📄</span>`).join('')}
      </div>`;
    }

    // Project with color
    let projectHtml = '';
    if (project && !project.isInbox) {
      projectHtml = `<span class="master-list-project" style="border-left: 3px solid ${project.color}">${this.escapeHtml(project.name)}</span>`;
    }

    // Duration badge
    let durationHtml = '';
    if (task.estimatedMinutes) {
      durationHtml = `<span class="master-list-duration">${task.estimatedMinutes}m</span>`;
    }

    // Today indicators
    const today = this.getLocalDateString();
    const isWorkingOn = this.todayView.workingOnTaskIds.includes(task.id);
    const isScheduledToday = task.scheduledDate === today || task.dueDate === today;

    let todayBadgeHtml = '';
    if (isWorkingOn) {
      todayBadgeHtml = `<span class="master-list-badge working-on">Working On</span>`;
    } else if (isScheduledToday && !isCompleted) {
      todayBadgeHtml = `<span class="master-list-badge scheduled-today">Today</span>`;
    }

    el.innerHTML = `
      <button class="master-list-select ${isSelected ? 'selected' : ''}" data-action="select">${isSelected ? '✓' : ''}</button>
      <button class="master-list-checkbox ${isCompleted ? 'checked' : ''}" data-action="toggle">${isCompleted ? '✓' : ''}</button>
      <span class="master-list-name" data-action="edit-name">${this.escapeHtml(task.name)}</span>
      ${todayBadgeHtml}
      ${durationHtml}
      ${tagsHtml}
      ${projectHtml}
      ${task.priority !== 'none' ? `<span class="master-list-priority ${task.priority}">${task.priority}</span>` : ''}
      <span class="master-list-status ${task.status}">${this.formatStatus(task.status)}</span>
      ${filesHtml}
    `;

    // Selection checkbox
    el.querySelector('[data-action="select"]').addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggleTaskSelection(task.id, e.shiftKey);
    });

    // Complete checkbox
    el.querySelector('[data-action="toggle"]').addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggleTaskStatus(task.id);
    });

    // Inline editing on double-click
    const nameEl = el.querySelector('[data-action="edit-name"]');
    nameEl.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      this.enableMasterListInlineEdit(el, task);
    });

    // File icons
    el.querySelectorAll('.master-list-file-icon').forEach(icon => {
      icon.addEventListener('click', (e) => {
        e.stopPropagation();
        this.openFilePath(icon.dataset.path);
      });
    });

    // Open detail panel on single click
    el.addEventListener('click', () => {
      this.selectTask(task.id, el);
      this.openDetailPanel(task.id);
    });

    return el;
  }

  enableMasterListInlineEdit(itemEl, task) {
    const nameEl = itemEl.querySelector('.master-list-name');
    const currentName = task.name;

    // Replace with input
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'master-list-name-input';
    input.value = currentName;

    nameEl.replaceWith(input);
    input.focus();
    input.select();

    const saveEdit = () => {
      const newName = input.value.trim();
      if (newName && newName !== currentName) {
        task.name = newName;
        this.saveData();
        this.showToast('Task updated');
      }
      this.renderMasterList();
    };

    input.addEventListener('blur', saveEdit);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        saveEdit();
      } else if (e.key === 'Escape') {
        this.renderMasterList();
      }
    });
  }

  // File Path Methods
  openFilePath(filePath) {
    if (filePath && window.api && window.api.openPath) {
      window.api.openPath(filePath);
    }
  }

  renderFilePathsInModal() {
    const container = document.getElementById('file-paths-container');
    const taskId = document.getElementById('task-id').value;
    let filePaths = [];

    if (taskId) {
      const task = this.findTask(taskId);
      if (task && task.filePaths) {
        filePaths = task.filePaths;
      }
    }

    // Store in temp for new tasks
    if (!this._tempFilePaths) this._tempFilePaths = [];
    if (!taskId) filePaths = this._tempFilePaths;

    container.innerHTML = filePaths.map((fp, index) => `
      <div class="file-path-item" data-index="${index}">
        <span class="file-path-icon">📄</span>
        <span class="file-path-text" title="${this.escapeHtml(fp)}">${this.escapeHtml(fp)}</span>
        <button type="button" class="file-path-remove" data-action="remove">✕</button>
      </div>
    `).join('');

    container.querySelectorAll('.file-path-text').forEach(el => {
      el.addEventListener('click', () => this.openFilePath(el.title));
    });

    container.querySelectorAll('[data-action="remove"]').forEach(btn => {
      btn.addEventListener('click', () => {
        const index = parseInt(btn.closest('.file-path-item').dataset.index);
        if (taskId) {
          const task = this.findTask(taskId);
          if (task) {
            task.filePaths.splice(index, 1);
            this.saveData();
          }
        } else {
          this._tempFilePaths.splice(index, 1);
        }
        this.renderFilePathsInModal();
      });
    });
  }

  addFilePathToModal(path) {
    const taskId = document.getElementById('task-id').value;
    if (taskId) {
      const task = this.findTask(taskId);
      if (task) {
        if (!task.filePaths) task.filePaths = [];
        task.filePaths.push(path);
        this.saveData();
      }
    } else {
      if (!this._tempFilePaths) this._tempFilePaths = [];
      this._tempFilePaths.push(path);
    }
    this.renderFilePathsInModal();
  }

  renderTaskList() {
    const container = document.getElementById('tasks-container');
    const tasks = this.getFilteredTasks();

    container.innerHTML = '';

    // Special rendering for upcoming view - group by date
    if (this.currentView === 'upcoming') {
      this.renderUpcomingList(container, tasks);
      return;
    }

    // Render project header if viewing a project
    if (this.currentView.startsWith('project-')) {
      const projectId = this.currentView.replace('project-', '');
      const project = this.data.projects.find(p => p.id === projectId);
      if (project) {
        container.appendChild(this.createProjectHeader(project));
      }
    }

    if (tasks.length === 0) {
      const emptyState = document.createElement('div');
      emptyState.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">&#128203;</div>
          <h3>No tasks here</h3>
          <p>Click "Add Task" to create your first task</p>
        </div>
      `;
      container.appendChild(emptyState);
      return;
    }

    for (const task of tasks) {
      container.appendChild(this.createTaskElement(task));
    }
  }

  renderUpcomingList(container, tasks) {
    if (tasks.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">📅</div>
          <h3>No upcoming tasks</h3>
          <p>Schedule tasks to see them here</p>
        </div>
      `;
      return;
    }

    // Group tasks by date (scheduledDate or dueDate)
    const groupedTasks = {};
    const today = this.getLocalDateString();

    for (const task of tasks) {
      const taskDate = task.scheduledDate || task.dueDate || 'unscheduled';
      if (!groupedTasks[taskDate]) {
        groupedTasks[taskDate] = [];
      }
      groupedTasks[taskDate].push(task);
    }

    // Sort tasks within each date by scheduledTime
    for (const date of Object.keys(groupedTasks)) {
      groupedTasks[date].sort((a, b) => {
        // Tasks with scheduledTime come first, sorted by time
        const timeA = a.scheduledTime || '99:99';
        const timeB = b.scheduledTime || '99:99';
        return timeA.localeCompare(timeB);
      });
    }

    // Sort dates
    const sortedDates = Object.keys(groupedTasks).sort((a, b) => {
      if (a === 'unscheduled') return 1;
      if (b === 'unscheduled') return -1;
      return a.localeCompare(b);
    });

    // Initialize collapsed state if not exists
    if (!this._upcomingCollapsedDates) {
      this._upcomingCollapsedDates = {};
    }

    for (const date of sortedDates) {
      const dateGroup = document.createElement('div');
      dateGroup.className = 'upcoming-date-group';

      const isCollapsed = this._upcomingCollapsedDates[date] || false;
      const taskCount = groupedTasks[date].length;
      const scheduledCount = groupedTasks[date].filter(t => t.scheduledTime).length;

      // Create date header
      const header = document.createElement('div');
      header.className = `upcoming-date-header ${isCollapsed ? 'collapsed' : ''}`;
      header.innerHTML = `
        <span class="upcoming-date-toggle">${isCollapsed ? '▶' : '▼'}</span>
        <span class="upcoming-date-label">${this.formatUpcomingDate(date, today)}</span>
        <span class="upcoming-date-count">${taskCount} task${taskCount !== 1 ? 's' : ''}${scheduledCount > 0 ? ` (${scheduledCount} scheduled)` : ''}</span>
      `;

      header.addEventListener('click', () => {
        this._upcomingCollapsedDates[date] = !this._upcomingCollapsedDates[date];
        this.renderTasks();
      });

      dateGroup.appendChild(header);

      // Create tasks container
      if (!isCollapsed) {
        const tasksContainer = document.createElement('div');
        tasksContainer.className = 'upcoming-tasks-container';

        for (const task of groupedTasks[date]) {
          const taskEl = this.createTaskElement(task, true); // true = collapsible subtasks

          // Add time badge if scheduled
          if (task.scheduledTime) {
            const timeBadge = document.createElement('span');
            timeBadge.className = 'upcoming-time-badge';
            timeBadge.textContent = this.formatTime(task.scheduledTime);
            const taskContent = taskEl.querySelector('.task-content');
            if (taskContent) {
              taskContent.insertBefore(timeBadge, taskContent.firstChild);
            }
          }

          tasksContainer.appendChild(taskEl);
        }

        dateGroup.appendChild(tasksContainer);
      }

      container.appendChild(dateGroup);
    }
  }

  formatTime(timeStr) {
    if (!timeStr) return '';
    const [hours, minutes] = timeStr.split(':').map(Number);
    const ampm = hours >= 12 ? 'PM' : 'AM';
    const hour12 = hours % 12 || 12;
    return `${hour12}:${minutes.toString().padStart(2, '0')} ${ampm}`;
  }

  formatUpcomingDate(dateStr, today) {
    if (dateStr === 'unscheduled') return 'Unscheduled';

    const date = new Date(dateStr + 'T00:00:00');
    const todayDate = new Date(today + 'T00:00:00');
    const diffDays = Math.round((date - todayDate) / (1000 * 60 * 60 * 24));

    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return 'Tomorrow';
    if (diffDays === -1) return 'Yesterday';

    // Within the next week, show day name
    if (diffDays > 0 && diffDays < 7) {
      const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
      return dayNames[date.getDay()];
    }

    // Otherwise show formatted date
    const options = { weekday: 'short', month: 'short', day: 'numeric' };
    return date.toLocaleDateString('en-US', options);
  }

  createProjectHeader(project) {
    const tasks = project.tasks || [];
    const activeTasks = tasks.filter(t => t.status !== 'done');
    const completedTasks = tasks.filter(t => t.status === 'done');
    const blockedTasks = activeTasks.filter(t => this.isTaskBlocked(t));

    // Calculate momentum - completions this week and month
    const today = new Date();
    const weekAgo = new Date(today);
    weekAgo.setDate(weekAgo.getDate() - 7);
    const monthAgo = new Date(today);
    monthAgo.setDate(monthAgo.getDate() - 30);

    const completedThisWeek = completedTasks.filter(t => {
      if (!t.completedAt) return false;
      const completed = new Date(t.completedAt);
      return completed >= weekAgo;
    }).length;

    const completedThisMonth = completedTasks.filter(t => {
      if (!t.completedAt) return false;
      const completed = new Date(t.completedAt);
      return completed >= monthAgo;
    }).length;

    // Find next action - highest priority active task that's not blocked
    const nextAction = activeTasks
      .filter(t => !this.isTaskBlocked(t))
      .sort((a, b) => {
        const priorities = { urgent: 0, high: 1, medium: 2, low: 3, none: 4 };
        return (priorities[a.priority] || 4) - (priorities[b.priority] || 4);
      })[0];

    // Status badge
    const statusConfig = {
      active: { icon: '⚡', label: 'Active', class: 'status-active' },
      paused: { icon: '💤', label: 'Paused', class: 'status-paused' },
      blocked: { icon: '🚫', label: 'Blocked', class: 'status-blocked' }
    };
    const status = statusConfig[project.status] || statusConfig.active;

    const header = document.createElement('div');
    header.className = 'project-header-card';

    header.innerHTML = `
      <div class="project-header-top">
        <span class="project-header-color" style="background:${project.color}"></span>
        <h2 class="project-header-name">${this.escapeHtml(project.name)}</h2>
        <span class="project-status-badge ${status.class}">${status.icon} ${status.label}</span>
        <button class="project-header-edit" title="Edit Project">&#9998;</button>
      </div>
      ${project.goal ? `<p class="project-header-goal">"${this.escapeHtml(project.goal)}"</p>` : ''}
      ${project.description ? `<p class="project-header-description">${this.escapeHtml(project.description)}</p>` : ''}

      <div class="project-momentum-section">
        <div class="momentum-stats">
          <div class="momentum-stat">
            <span class="momentum-value">${activeTasks.length}</span>
            <span class="momentum-label">active</span>
          </div>
          <div class="momentum-stat highlight">
            <span class="momentum-value">${completedThisWeek}</span>
            <span class="momentum-label">this week</span>
          </div>
          <div class="momentum-stat">
            <span class="momentum-value">${completedThisMonth}</span>
            <span class="momentum-label">this month</span>
          </div>
          ${blockedTasks.length > 0 ? `
          <div class="momentum-stat blocked">
            <span class="momentum-value">${blockedTasks.length}</span>
            <span class="momentum-label">blocked</span>
          </div>
          ` : ''}
        </div>
      </div>

      ${nextAction ? `
      <div class="project-next-action">
        <span class="next-action-label">Next up:</span>
        <span class="next-action-task" data-task-id="${nextAction.id}">
          ${nextAction.priority !== 'none' ? `<span class="priority-dot ${nextAction.priority}"></span>` : ''}
          ${this.escapeHtml(nextAction.name)}
        </span>
      </div>
      ` : `
      <div class="project-next-action empty">
        <span class="next-action-label">No active tasks</span>
      </div>
      `}
    `;

    header.querySelector('.project-header-edit').addEventListener('click', () => {
      this.openProjectModal(project.id);
    });

    // Make next action clickable
    const nextActionEl = header.querySelector('.next-action-task');
    if (nextActionEl) {
      nextActionEl.addEventListener('click', () => {
        this.openDetailPanel(nextAction.id);
      });
    }

    return header;
  }

  createTaskElement(task, collapsibleSubtasks = false) {
    const project = this.data.projects.find(p => p.tasks.some(t => t.id === task.id));
    const el = document.createElement('div');

    // Check dependency status
    const isBlocked = this.isTaskBlocked(task);
    const blocksCount = (task.blocks || []).filter(id => {
      const t = this.findTask(id);
      return t && t.status !== 'done';
    }).length;
    const blockedByCount = this.getBlockingTasks(task).length;

    let dependencyClass = '';
    if (isBlocked) dependencyClass = 'is-blocked';
    else if (blocksCount > 0) dependencyClass = 'is-blocking';

    el.className = `task-item ${task.status === 'done' ? 'completed' : ''} ${dependencyClass}`;
    el.dataset.id = task.id;

    const priorityClass = task.priority !== 'none' ? `priority-${task.priority}` : '';
    const checkClass = task.status === 'done' ? 'checked' : '';

    let dueDateHtml = '';
    if (task.dueDate) {
      const today = this.getLocalDateString();
      const dateClass = task.dueDate < today ? 'overdue' : (task.dueDate === today ? 'today' : '');
      const dateLabel = this.formatDate(task.dueDate);
      dueDateHtml = `<span class="task-due-date ${dateClass}">&#128197; ${dateLabel}</span>`;
    }

    let tagsHtml = '';
    if (task.tags.length > 0) {
      tagsHtml = '<div class="task-tags">' + task.tags.map(tagId => {
        const tag = this.data.tags.find(t => t.id === tagId);
        return tag ? `<span class="task-tag" style="background:${tag.color}">${this.escapeHtml(tag.name)}</span>` : '';
      }).join('') + '</div>';
    }

    let projectBadge = '';
    if (project && !project.isInbox && this.currentView !== `project-${project.id}`) {
      projectBadge = `<span class="task-project-badge"><span class="dot" style="background:${project.color}"></span>${this.escapeHtml(project.name)}</span>`;
    }

    let priorityBadge = '';
    if (task.priority !== 'none') {
      priorityBadge = `<span class="task-priority-badge ${task.priority}">${task.priority}</span>`;
    }

    let subtaskCount = '';
    if (task.subtasks && task.subtasks.length > 0) {
      const completed = task.subtasks.filter(st => st.status === 'done').length;
      subtaskCount = `<span class="task-subtask-count">&#9744; ${completed}/${task.subtasks.length}</span>`;
    }

    // Dependency badges
    let dependencyBadges = '';
    if (isBlocked || blocksCount > 0) {
      dependencyBadges = '<div class="task-dependency-badges">';
      if (isBlocked) {
        dependencyBadges += `<span class="dependency-badge blocked" data-action="dependencies" title="Blocked by ${blockedByCount} task(s)">&#128274; Blocked (${blockedByCount})</span>`;
      }
      if (blocksCount > 0) {
        dependencyBadges += `<span class="dependency-badge blocking" data-action="dependencies" title="Blocks ${blocksCount} task(s)">&#9939; Blocks ${blocksCount}</span>`;
      }
      dependencyBadges += '</div>';
    }

    let assignedBadge = '';
    if (task.assignedTo === 'claude') {
      assignedBadge = '<span class="assigned-badge claude-badge" title="Assigned to Claude">&#129302;</span>';
    } else if (task.assignedTo) {
      const name = this.getAssignedToDisplayName(task.assignedTo);
      const initial = name ? name.charAt(0).toUpperCase() : '?';
      assignedBadge = `<span class="assigned-badge member-badge" title="Assigned to ${this.escapeHtml(name || '')}">${initial}</span>`;
    }

    el.innerHTML = `
      <button type="button" class="task-checkbox ${checkClass} ${priorityClass}" data-action="toggle" data-task-id="${task.id}">${task.status === 'done' ? '&#10003;' : ''}</button>
      <div class="task-content">
        <div class="task-header">
          <span class="task-name">${this.escapeHtml(task.name)}</span>
          ${assignedBadge}
          ${priorityBadge}
          ${dependencyBadges}
        </div>
        <div class="task-meta">
          ${projectBadge}
          ${dueDateHtml}
          ${subtaskCount}
          ${tagsHtml}
        </div>
      </div>
      <div class="task-actions">
        <button class="task-action-btn" data-action="dependencies" title="Dependencies">&#128279;</button>
        <button class="task-action-btn" data-action="edit" title="Edit">&#9998;</button>
        <button class="task-action-btn" data-action="delete" title="Delete">&#128465;</button>
      </div>
    `;

    // Event listeners - use both click and mousedown for reliability
    const checkbox = el.querySelector('[data-action="toggle"]');
    checkbox.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.toggleTaskStatus(task.id);
    });
    checkbox.addEventListener('mousedown', (e) => {
      e.stopPropagation();
    });

    el.querySelector('[data-action="edit"]').addEventListener('click', (e) => {
      e.stopPropagation();
      this.openTaskModal(task.id);
    });

    el.querySelector('[data-action="delete"]').addEventListener('click', (e) => {
      e.stopPropagation();
      this.confirmDeleteTask(task.id);
    });

    // Dependency button/badges
    el.querySelectorAll('[data-action="dependencies"]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.openDependencyModal(task.id);
      });
    });

    el.addEventListener('click', () => {
      this.selectTask(task.id, el);
      this.openDetailPanel(task.id);
    });

    // Render subtasks
    if (task.subtasks && task.subtasks.length > 0) {
      const completed = task.subtasks.filter(st => st.status === 'done').length;
      const total = task.subtasks.length;

      // Initialize collapsed state for this task if not exists
      if (!this._collapsedSubtasks) {
        this._collapsedSubtasks = {};
      }
      const isCollapsed = collapsibleSubtasks && this._collapsedSubtasks[task.id];

      const subtasksWrapper = document.createElement('div');
      subtasksWrapper.className = 'subtasks-wrapper';

      // Add toggle button if collapsible
      if (collapsibleSubtasks) {
        const toggleBtn = document.createElement('button');
        toggleBtn.type = 'button';
        toggleBtn.className = `subtasks-toggle ${isCollapsed ? 'collapsed' : ''}`;
        toggleBtn.innerHTML = `
          <span class="subtasks-toggle-icon">${isCollapsed ? '▶' : '▼'}</span>
          <span class="subtasks-toggle-label">${completed}/${total} subtasks</span>
        `;
        toggleBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          this._collapsedSubtasks[task.id] = !this._collapsedSubtasks[task.id];
          this.renderTasks();
        });
        subtasksWrapper.appendChild(toggleBtn);
      }

      if (!isCollapsed) {
        const subtasksContainer = document.createElement('div');
        subtasksContainer.className = 'subtasks-container';

        for (const subtask of task.subtasks) {
          subtasksContainer.appendChild(this.createSubtaskElement(subtask));
        }

        subtasksWrapper.appendChild(subtasksContainer);
      }

      el.querySelector('.task-content').appendChild(subtasksWrapper);
    }

    return el;
  }

  createSubtaskElement(subtask) {
    const el = document.createElement('div');
    el.className = `subtask-item ${subtask.status === 'done' ? 'completed' : ''}`;
    let assignedBadge = '';
    if (subtask.assignedTo === 'claude') {
      assignedBadge = '<span class="assigned-badge claude-badge" title="Assigned to Claude">&#129302;</span>';
    } else if (subtask.assignedTo) {
      const name = this.getAssignedToDisplayName(subtask.assignedTo);
      const initial = name ? name.charAt(0).toUpperCase() : '?';
      assignedBadge = `<span class="assigned-badge member-badge" title="Assigned to ${this.escapeHtml(name || '')}">${initial}</span>`;
    }
    el.innerHTML = `
      <button type="button" class="subtask-checkbox ${subtask.status === 'done' ? 'checked' : ''}">${subtask.status === 'done' ? '&#10003;' : ''}</button>
      <span class="subtask-name">${this.escapeHtml(subtask.name)}</span>
      ${assignedBadge}
    `;

    const checkbox = el.querySelector('.subtask-checkbox');
    checkbox.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.toggleTaskStatus(subtask.id);
    });

    return el;
  }

  renderTaskBoard() {
    const tasks = this.getFilteredTasks();
    // Map new statuses to board columns:
    // - 'ready' displays in 'todo' column
    // - 'waiting' displays in 'review' column
    const statusMap = {
      'todo': ['todo', 'ready'],
      'in-progress': ['in-progress'],
      'review': ['review', 'waiting'],
      'done': ['done']
    };

    Object.entries(statusMap).forEach(([columnStatus, taskStatuses]) => {
      const column = document.querySelector(`.column-tasks[data-status="${columnStatus}"]`);
      const countEl = document.querySelector(`.board-column[data-status="${columnStatus}"] .column-count`);
      if (!column || !countEl) return;

      const statusTasks = tasks.filter(t => taskStatuses.includes(t.status));

      countEl.textContent = statusTasks.length;
      column.innerHTML = '';

      for (const task of statusTasks) {
        column.appendChild(this.createBoardTaskElement(task));
      }
    });
  }

  createBoardTaskElement(task) {
    const el = document.createElement('div');
    const execCls = task.executionType ? `exec-${task.executionType}` : '';
    el.className = `board-task ${execCls}`;
    el.dataset.id = task.id;
    el.draggable = true;

    let priorityBadge = '';
    if (task.priority !== 'none') {
      priorityBadge = `<span class="task-priority-badge ${task.priority}">${task.priority}</span>`;
    }

    let dueDateHtml = '';
    if (task.dueDate) {
      const today = this.getLocalDateString();
      const dateClass = task.dueDate < today ? 'overdue' : (task.dueDate === today ? 'today' : '');
      dueDateHtml = `<span class="task-due-date ${dateClass}">&#128197; ${this.formatDate(task.dueDate)}</span>`;
    }

    let tagsHtml = task.tags.slice(0, 2).map(tagId => {
      const tag = this.data.tags.find(t => t.id === tagId);
      return tag ? `<span class="task-tag" style="background:${tag.color}">${this.escapeHtml(tag.name)}</span>` : '';
    }).join('');

    el.innerHTML = `
      <div class="board-task-header">
        <span class="board-task-name">${this.escapeHtml(task.name)}</span>
        ${priorityBadge}
      </div>
      <div class="board-task-meta">
        ${dueDateHtml}
        ${tagsHtml}
      </div>
    `;

    el.addEventListener('click', () => {
      this.selectTask(task.id, el);
      this.openDetailPanel(task.id);
    });

    // Drag events
    el.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('text/plain', task.id);
      el.classList.add('dragging');
    });

    el.addEventListener('dragend', () => {
      el.classList.remove('dragging');
    });

    return el;
  }

  // Modal Management
  openModal(modalId) {
    document.getElementById(modalId).classList.add('open');
  }

  closeModal(modalId) {
    document.getElementById(modalId).classList.remove('open');
  }

  closeAllModals() {
    document.querySelectorAll('.modal').forEach(m => m.classList.remove('open'));
  }

  openTaskModal(taskId = null, preselectedProjectId = null) {
    const modal = document.getElementById('task-modal');
    const form = document.getElementById('task-form');
    const title = document.getElementById('task-modal-title');

    form.reset();
    document.getElementById('task-id').value = '';
    document.getElementById('task-parent-id').value = '';

    // Reset context guide
    const contextToggle = document.getElementById('context-guide-toggle');
    const contextGuide = document.getElementById('context-guide');
    if (contextToggle && contextGuide) {
      contextToggle.classList.remove('expanded');
      contextGuide.classList.remove('show');
      contextToggle.querySelector('span').textContent = 'Show prompts';
    }

    // Reset tag checkboxes
    document.querySelectorAll('#tags-selector input').forEach(cb => {
      cb.checked = false;
      cb.parentElement.classList.remove('selected');
    });

    // Populate project dropdown
    const projectSelect = document.getElementById('task-project');
    projectSelect.innerHTML = '<option value="">No Project (Inbox)</option>';
    this.data.projects.filter(p => !p.isInbox).forEach(p => {
      projectSelect.innerHTML += `<option value="${p.id}">${this.escapeHtml(p.name)}</option>`;
    });

    // Reset scheduling fields
    document.getElementById('task-scheduled-time').value = '';
    document.getElementById('task-scheduled-date').value = '';
    document.getElementById('task-estimated-minutes').value = '';
    document.querySelectorAll('.duration-btn').forEach(btn => btn.classList.remove('selected'));

    // Reset timeline fields
    const startDateInput = document.getElementById('task-start-date');
    const endDateInput = document.getElementById('task-end-date');
    const assigneeInput = document.getElementById('task-assignee');
    if (startDateInput) startDateInput.value = '';
    if (endDateInput) endDateInput.value = '';
    if (assigneeInput) {
      this.populateAssigneeDropdown(assigneeInput);
      assigneeInput.value = '';
    }

    if (taskId) {
      const task = this.findTask(taskId);
      if (task) {
        title.textContent = 'Edit Task';
        document.getElementById('task-id').value = task.id;
        document.getElementById('task-name').value = task.name;
        document.getElementById('task-description').value = task.description || '';
        document.getElementById('task-context').value = task.context || '';
        document.getElementById('task-project').value = task.projectId || '';
        document.getElementById('task-status').value = task.status;
        document.getElementById('task-priority').value = task.priority;
        document.getElementById('task-due-date').value = task.dueDate || '';

        // Set scheduling fields
        document.getElementById('task-scheduled-time').value = task.scheduledTime || '';
        document.getElementById('task-scheduled-date').value = task.scheduledDate || '';
        document.getElementById('task-estimated-minutes').value = task.estimatedMinutes || '';

        // Set timeline fields
        const startDateEl = document.getElementById('task-start-date');
        const endDateEl = document.getElementById('task-end-date');
        const assigneeEl = document.getElementById('task-assignee');
        if (startDateEl) startDateEl.value = task.startDate || '';
        if (endDateEl) endDateEl.value = task.endDate || '';
        if (assigneeEl) {
          this.populateAssigneeDropdown(assigneeEl);
          assigneeEl.value = task.assignee || '';
        }

        // Select duration button if estimatedMinutes is set
        if (task.estimatedMinutes) {
          const durationBtn = document.querySelector(`.duration-btn[data-minutes="${task.estimatedMinutes}"]`);
          if (durationBtn) durationBtn.classList.add('selected');
        }

        // Set tags
        task.tags.forEach(tagId => {
          const cb = document.querySelector(`#tags-selector input[value="${tagId}"]`);
          if (cb) {
            cb.checked = true;
            cb.parentElement.classList.add('selected');
          }
        });
      }
    } else {
      title.textContent = 'Add Task';

      // Pre-select project if specified or if viewing a project
      const presetProjectId = preselectedProjectId || (this.currentView.startsWith('project-') ? this.currentView.replace('project-', '') : null);
      if (presetProjectId) {
        document.getElementById('task-project').value = presetProjectId;
      }
      // Clear temp file paths for new tasks
      this._tempFilePaths = [];
    }

    // Render file paths
    this.renderFilePathsInModal();

    this.openModal('task-modal');
    document.getElementById('task-name').focus();
  }

  saveTaskForm() {
    const taskId = document.getElementById('task-id').value;
    const selectedTags = Array.from(document.querySelectorAll('#tags-selector input:checked'))
      .map(cb => cb.value);

    // Get scheduling fields
    const scheduledTime = document.getElementById('task-scheduled-time').value || null;
    const scheduledDate = document.getElementById('task-scheduled-date').value || null;
    const estimatedMinutes = parseInt(document.getElementById('task-estimated-minutes').value) || null;

    // Get timeline fields
    const startDate = document.getElementById('task-start-date')?.value || null;
    const endDate = document.getElementById('task-end-date')?.value || null;
    const assigneeEl = document.getElementById('task-assignee');
    const assignee = assigneeEl ? (assigneeEl.value || null) : null;

    const taskData = {
      name: document.getElementById('task-name').value.trim(),
      description: document.getElementById('task-description').value.trim(),
      context: document.getElementById('task-context').value.trim(),
      projectId: document.getElementById('task-project').value || null,
      status: document.getElementById('task-status').value,
      priority: document.getElementById('task-priority').value,
      dueDate: document.getElementById('task-due-date').value || null,
      scheduledTime: scheduledTime,
      scheduledDate: scheduledDate || (scheduledTime ? this.getLocalDateString() : null),
      startDate: startDate,
      endDate: endDate,
      assignee: assignee,
      estimatedMinutes: estimatedMinutes,
      tags: selectedTags,
      filePaths: this._tempFilePaths || []
    };

    if (taskId) {
      // Don't overwrite file paths when editing - they're managed separately
      delete taskData.filePaths;
      this.updateTask(taskId, taskData);
    } else {
      this.createTask(taskData);
    }

    this.closeModal('task-modal');
    this.render();
  }

  populateAssigneeDropdown(selectEl) {
    const members = this.data.teamMembers || [];
    selectEl.innerHTML = '<option value="">Unassigned</option>';
    members.forEach(m => {
      selectEl.innerHTML += `<option value="${this.escapeHtml(m.userId)}">${this.escapeHtml(m.displayName)}</option>`;
    });
    // Always add Claude as a special option
    selectEl.innerHTML += '<option value="claude">Claude</option>';
  }

  /**
   * Build <option> HTML for assignedTo dropdowns from team members.
   */
  buildAssignedToOptions(currentValue) {
    const members = this.data.teamMembers || [];
    let html = `<option value="" ${!currentValue ? 'selected' : ''}>Unassigned</option>`;
    members.forEach(m => {
      html += `<option value="${this.escapeHtml(m.userId)}" ${currentValue === m.userId ? 'selected' : ''}>${this.escapeHtml(m.displayName)}</option>`;
    });
    html += `<option value="claude" ${currentValue === 'claude' ? 'selected' : ''}>Claude</option>`;
    return html;
  }

  /**
   * Look up display name for an assignedTo value.
   */
  getAssignedToDisplayName(assignedTo) {
    if (!assignedTo) return null;
    if (assignedTo === 'claude') return 'Claude';
    const member = (this.data.teamMembers || []).find(m => m.userId === assignedTo);
    return member ? member.displayName : assignedTo;
  }

  renderTeamMembersList() {
    const container = document.getElementById('team-members-list');
    if (!container) return;
    const members = this.data.teamMembers || [];
    if (members.length === 0) {
      container.innerHTML = '<span class="settings-text" style="font-size:12px;color:var(--text-muted)">No team members yet.</span>';
      return;
    }
    container.innerHTML = members.map(m => `
      <div class="team-member-chip">
        <span>${this.escapeHtml(m.displayName)}</span>
        <span class="team-member-role">${this.escapeHtml(m.role || 'member')}</span>
      </div>
    `).join('');
  }

  async renderPendingInvitations() {
    const container = document.getElementById('pending-invitations-list');
    if (!container) return;
    try {
      const invitations = await window.api.ds.getInvitations();
      if (!invitations || invitations.length === 0) {
        container.innerHTML = '<span class="settings-text" style="font-size:12px;color:var(--text-muted)">No pending invitations.</span>';
        return;
      }
      container.innerHTML = invitations.map(inv => `
        <div class="invitation-item">
          <span class="invitation-email">${this.escapeHtml(inv.email)}</span>
          <span class="invitation-role">${this.escapeHtml(inv.role)}</span>
          <span class="invitation-status-badge pending">Pending</span>
          <button class="btn btn-small btn-danger invitation-cancel" data-id="${inv.id}" title="Cancel invitation">&times;</button>
        </div>
      `).join('');
      container.querySelectorAll('.invitation-cancel').forEach(btn => {
        btn.addEventListener('click', async () => {
          try {
            await window.api.ds.declineInvitation(btn.dataset.id);
            this.showToast('Invitation cancelled');
            this.renderPendingInvitations();
          } catch (err) {
            this.showToast('Failed to cancel: ' + err.message);
          }
        });
      });
    } catch (err) {
      container.innerHTML = '<span class="settings-text" style="font-size:12px;color:var(--text-muted)">Could not load invitations.</span>';
    }
  }

  async inviteTeamMember() {
    const emailInput = document.getElementById('invite-email-input');
    const roleSelect = document.getElementById('invite-role-select');
    if (!emailInput) return;
    const email = emailInput.value.trim();
    if (!email) return;
    const role = roleSelect ? roleSelect.value : 'member';

    try {
      await window.api.ds.inviteMember(email, role);
      this.showToast(`Invitation sent to ${email} (email notification sent)`);
      emailInput.value = '';
      this.renderPendingInvitations();
    } catch (err) {
      this.showToast('Failed to invite: ' + (err.message || 'Unknown error'));
    }
  }

  async checkPendingInvitationsForMe() {
    try {
      const invitations = await window.api.ds.getMyInvitations();
      if (!invitations || invitations.length === 0) return;

      const banner = document.getElementById('invitation-banner');
      if (!banner) return;

      const inv = invitations[0]; // Show the first pending invitation
      banner.innerHTML = `
        <span class="invitation-banner-text">
          You've been invited to join <strong>${this.escapeHtml(inv.team_name)}</strong> by ${this.escapeHtml(inv.invited_by_name)}.
        </span>
        <div class="invitation-banner-actions">
          <button class="btn btn-small btn-primary" id="accept-invitation-btn">Accept</button>
          <button class="btn btn-small btn-ghost" id="decline-invitation-btn">Decline</button>
        </div>
      `;
      banner.classList.remove('hidden');
      banner.dataset.invitationId = inv.id;

      document.getElementById('accept-invitation-btn')?.addEventListener('click', async () => {
        try {
          await window.api.ds.acceptInvitation(inv.id);
          this.showToast('Invitation accepted! Reloading...');
          banner.classList.add('hidden');
          // Reload data to get new team context
          this.data = await window.api.loadData();
          this.currentUserId = this.data.currentUserId || null;
          if (!this.data.teamMembers) this.data.teamMembers = [];
          this.render();
        } catch (err) {
          this.showToast('Failed to accept: ' + err.message);
        }
      });

      document.getElementById('decline-invitation-btn')?.addEventListener('click', async () => {
        try {
          await window.api.ds.declineInvitation(inv.id);
          banner.classList.add('hidden');
          this.showToast('Invitation declined');
        } catch (err) {
          this.showToast('Failed to decline: ' + err.message);
        }
      });
    } catch (err) {
      // Silently fail — invitations are not critical
      console.error('Failed to check invitations:', err.message);
    }
  }

  async openProjectMembersModal(projectId) {
    const project = this.data.projects.find(p => p.id === projectId);
    if (!project) return;

    // Get team members and current project members
    const teamMembers = this.data.teamMembers || [];
    let projectMembers = [];
    try {
      projectMembers = await window.api.ds.getProjectMembers(projectId);
    } catch (err) {
      // If table doesn't exist yet (migration not run), show empty
      console.error('Could not load project members:', err.message);
    }

    const pmUserIds = new Set(projectMembers.map(pm => pm.userId));

    // Build modal HTML
    const overlay = document.createElement('div');
    overlay.className = 'modal open';
    overlay.innerHTML = `
      <div class="modal-content" style="max-width:480px;">
        <div class="modal-header">
          <h3>Share: ${this.escapeHtml(project.name)}</h3>
          <button class="modal-close-btn">&times;</button>
        </div>
        <div class="modal-body" style="padding:16px;">
          <p style="font-size:13px;color:var(--text-muted);margin:0 0 12px;">
            ${projectMembers.length === 0
              ? 'No specific members — visible to all team members (default).'
              : `${projectMembers.length} member${projectMembers.length !== 1 ? 's' : ''} — only these members can access this project.`}
          </p>

          <div id="pm-current-members" style="margin-bottom:16px;">
            ${projectMembers.map(pm => `
              <div class="team-member-chip" style="justify-content:space-between;margin-bottom:4px;">
                <span>${this.escapeHtml(pm.displayName)} <small style="color:var(--text-muted)">${this.escapeHtml(pm.email)}</small></span>
                <div style="display:flex;align-items:center;gap:6px;">
                  <select class="pm-role-select" data-user-id="${pm.userId}" style="font-size:11px;padding:2px 4px;border:1px solid var(--border);border-radius:4px;">
                    <option value="viewer" ${pm.role === 'viewer' ? 'selected' : ''}>Viewer</option>
                    <option value="editor" ${pm.role === 'editor' ? 'selected' : ''}>Editor</option>
                    <option value="admin" ${pm.role === 'admin' ? 'selected' : ''}>Admin</option>
                  </select>
                  <button class="btn btn-small btn-danger pm-remove" data-user-id="${pm.userId}" title="Remove">&times;</button>
                </div>
              </div>
            `).join('')}
          </div>

          <h4 style="font-size:13px;font-weight:600;margin:0 0 8px;">Add team member</h4>
          <div style="display:flex;gap:8px;align-items:center;">
            <select id="pm-add-member-select" style="flex:1;padding:6px 8px;border:1px solid var(--border);border-radius:6px;font-size:13px;">
              <option value="">Select a team member...</option>
              ${teamMembers.filter(tm => !pmUserIds.has(tm.userId)).map(tm => `
                <option value="${tm.userId}">${this.escapeHtml(tm.displayName)} (${this.escapeHtml(tm.email)})</option>
              `).join('')}
            </select>
            <select id="pm-add-role-select" style="padding:6px 4px;border:1px solid var(--border);border-radius:6px;font-size:13px;">
              <option value="editor">Editor</option>
              <option value="viewer">Viewer</option>
              <option value="admin">Admin</option>
            </select>
            <button class="btn btn-small btn-primary" id="pm-add-btn">Add</button>
          </div>

          <p style="font-size:11px;color:var(--text-muted);margin:12px 0 0;">
            Tip: If no members are added, the project is visible to everyone on the team.
            Adding specific members restricts access to only those people (plus team admins).
          </p>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    // Close modal
    const close = () => overlay.remove();
    overlay.querySelector('.modal-close-btn').addEventListener('click', close);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

    // Add member
    overlay.querySelector('#pm-add-btn').addEventListener('click', async () => {
      const userId = overlay.querySelector('#pm-add-member-select').value;
      const role = overlay.querySelector('#pm-add-role-select').value;
      if (!userId) return;
      try {
        await window.api.ds.addProjectMember(projectId, userId, role);
        this.showToast('Member added');
        close();
        this.openProjectMembersModal(projectId); // Re-open to refresh
      } catch (err) {
        this.showToast('Failed: ' + err.message);
      }
    });

    // Change role
    overlay.querySelectorAll('.pm-role-select').forEach(select => {
      select.addEventListener('change', async () => {
        try {
          await window.api.ds.updateProjectMemberRole(projectId, select.dataset.userId, select.value);
          this.showToast('Role updated');
        } catch (err) {
          this.showToast('Failed: ' + err.message);
        }
      });
    });

    // Remove member
    overlay.querySelectorAll('.pm-remove').forEach(btn => {
      btn.addEventListener('click', async () => {
        try {
          await window.api.ds.removeProjectMember(projectId, btn.dataset.userId);
          this.showToast('Member removed');
          close();
          this.openProjectMembersModal(projectId); // Re-open to refresh
        } catch (err) {
          this.showToast('Failed: ' + err.message);
        }
      });
    });
  }

  openProjectModal(projectId = null) {
    const modal = document.getElementById('project-modal');
    const form = document.getElementById('project-form');
    const title = document.getElementById('project-modal-title');
    const deleteBtn = document.getElementById('delete-project-btn');

    form.reset();
    document.getElementById('project-id').value = '';

    // Populate category dropdown
    const categorySelect = document.getElementById('project-category');
    if (categorySelect) {
      categorySelect.innerHTML = '<option value="">No Category</option>';
      for (const category of this.data.categories || []) {
        const option = document.createElement('option');
        option.value = category.id;
        option.textContent = category.name;
        categorySelect.appendChild(option);
      }
    }

    // Reset color selection
    document.querySelectorAll('#project-color-picker .color-option').forEach(o => o.classList.remove('selected'));
    document.querySelector('#project-color-picker .color-option').classList.add('selected');
    document.getElementById('project-color').value = '#3498db';

    // Reset goal, status, working directory
    const goalInput = document.getElementById('project-goal');
    if (goalInput) goalInput.value = '';
    const statusSelect = document.getElementById('project-status');
    if (statusSelect) statusSelect.value = 'active';
    const workingDirInput = document.getElementById('project-working-dir');
    if (workingDirInput) workingDirInput.value = '';

    if (projectId) {
      const project = this.data.projects.find(p => p.id === projectId);
      if (project) {
        title.textContent = 'Edit Project';
        document.getElementById('project-id').value = project.id;
        document.getElementById('project-name').value = project.name;
        document.getElementById('project-description').value = project.description || '';
        document.getElementById('project-color').value = project.color;

        // Set category
        if (categorySelect && project.categoryId) {
          categorySelect.value = project.categoryId;
        }

        // Set goal
        if (goalInput && project.goal) {
          goalInput.value = project.goal;
        }

        // Set status
        if (statusSelect && project.status) {
          statusSelect.value = project.status;
        }

        // Set working directory
        if (workingDirInput && project.workingDirectory) {
          workingDirInput.value = project.workingDirectory;
        }

        // Select color
        document.querySelectorAll('#project-color-picker .color-option').forEach(o => {
          o.classList.toggle('selected', o.dataset.color === project.color);
        });

        deleteBtn.style.display = 'block';
      }
    } else {
      title.textContent = 'Add Project';
      deleteBtn.style.display = 'none';
    }

    this.openModal('project-modal');
    document.getElementById('project-name').focus();
  }

  saveProjectForm() {
    const projectId = document.getElementById('project-id').value;
    const categorySelect = document.getElementById('project-category');
    const goalInput = document.getElementById('project-goal');
    const statusSelect = document.getElementById('project-status');

    const workingDirInput = document.getElementById('project-working-dir');
    const projectData = {
      name: document.getElementById('project-name').value.trim(),
      description: document.getElementById('project-description').value.trim(),
      color: document.getElementById('project-color').value,
      categoryId: categorySelect ? categorySelect.value || null : null,
      goal: goalInput ? goalInput.value.trim() : '',
      status: statusSelect ? statusSelect.value : 'active',
      workingDirectory: workingDirInput ? workingDirInput.value.trim() || null : null
    };

    if (projectId) {
      this.updateProject(projectId, projectData);
    } else {
      this.createProject(projectData);
    }

    this.closeModal('project-modal');
    this.render();
  }

  // Category Modal Methods
  openCategoryModal(categoryId = null) {
    const modal = document.getElementById('category-modal');
    if (!modal) return;

    const form = document.getElementById('category-form');
    const title = document.getElementById('category-modal-title');
    const deleteBtn = document.getElementById('delete-category-btn');

    form.reset();
    document.getElementById('category-id').value = '';

    // Reset color selection
    document.querySelectorAll('#category-color-picker .color-option').forEach(o => o.classList.remove('selected'));
    const firstColor = document.querySelector('#category-color-picker .color-option');
    if (firstColor) firstColor.classList.add('selected');
    document.getElementById('category-color').value = '#6366f1';

    if (categoryId) {
      const category = this.data.categories.find(c => c.id === categoryId);
      if (category) {
        title.textContent = 'Edit Category';
        document.getElementById('category-id').value = category.id;
        document.getElementById('category-name').value = category.name;
        document.getElementById('category-color').value = category.color;

        // Select color
        document.querySelectorAll('#category-color-picker .color-option').forEach(o => {
          o.classList.toggle('selected', o.dataset.color === category.color);
        });

        deleteBtn.style.display = 'block';
      }
    } else {
      title.textContent = 'Add Category';
      deleteBtn.style.display = 'none';
    }

    this.openModal('category-modal');
    document.getElementById('category-name').focus();
  }

  saveCategoryForm() {
    const categoryId = document.getElementById('category-id').value;
    const categoryData = {
      name: document.getElementById('category-name').value.trim(),
      color: document.getElementById('category-color').value
    };

    if (categoryId) {
      this.updateCategory(categoryId, categoryData);
    } else {
      this.createCategory(categoryData);
    }

    this.closeModal('category-modal');
    this.render();
  }

  confirmDeleteCategory() {
    const categoryId = document.getElementById('category-id').value;
    if (!categoryId) return;

    const category = this.data.categories.find(c => c.id === categoryId);
    if (!category) return;

    // Count projects in this category
    const projectCount = this.data.projects.filter(p => p.categoryId === categoryId).length;

    this.showConfirmDialog(
      'Delete Category',
      `Delete "${category.name}"? ${projectCount > 0 ? `${projectCount} project(s) will become uncategorized.` : ''}`,
      () => {
        this.deleteCategory(categoryId);
        this.closeModal('category-modal');
        this.render();
      }
    );
  }

  // Dependency Modal Methods
  openDependencyModal(taskId) {
    const task = this.findTask(taskId);
    if (!task) return;

    const modal = document.getElementById('dependency-modal');
    if (!modal) return;

    document.getElementById('dependency-task-id').value = taskId;
    document.querySelector('#dependency-task-info .dependency-task-name').textContent = task.name;

    // Render blocked by list
    this.renderBlockedByList(task);

    // Render blocks list
    this.renderBlocksList(task);

    // Populate available tasks for adding blockers
    this.populateBlockerSelect(task);

    this.openModal('dependency-modal');
  }

  renderBlockedByList(task) {
    const container = document.getElementById('blocked-by-list');
    const countEl = document.getElementById('blocked-by-count');
    container.innerHTML = '';

    const blockers = (task.blockedBy || [])
      .map(id => this.findTask(id))
      .filter(Boolean);

    countEl.textContent = `(${blockers.length})`;

    if (blockers.length === 0) {
      container.innerHTML = '<div class="dependency-empty">No blockers</div>';
      return;
    }

    for (const blocker of blockers) {
      const item = document.createElement('div');
      item.className = 'dependency-item';
      item.innerHTML = `
        <span class="dependency-item-status ${blocker.status}"></span>
        <span class="dependency-item-name">${this.escapeHtml(blocker.name)}</span>
        <button class="dependency-item-remove" title="Remove blocker" data-blocker-id="${blocker.id}">&#10005;</button>
      `;

      item.querySelector('.dependency-item-remove').addEventListener('click', () => {
        this.removeDependency(task.id, blocker.id);
        this.openDependencyModal(task.id); // Refresh modal
        this.render();
      });

      container.appendChild(item);
    }
  }

  renderBlocksList(task) {
    const container = document.getElementById('blocks-list');
    const countEl = document.getElementById('blocks-count');
    container.innerHTML = '';

    const blocked = (task.blocks || [])
      .map(id => this.findTask(id))
      .filter(Boolean);

    countEl.textContent = `(${blocked.length})`;

    if (blocked.length === 0) {
      container.innerHTML = '<div class="dependency-empty">Not blocking any tasks</div>';
      return;
    }

    for (const blockedTask of blocked) {
      const item = document.createElement('div');
      item.className = 'dependency-item';
      item.innerHTML = `
        <span class="dependency-item-status ${blockedTask.status}"></span>
        <span class="dependency-item-name">${this.escapeHtml(blockedTask.name)}</span>
      `;
      container.appendChild(item);
    }
  }

  populateBlockerSelect(task) {
    const select = document.getElementById('add-blocker-select');
    if (!select) return;

    select.innerHTML = '<option value="">Select a task...</option>';

    const allTasks = this.getAllTasks();
    const currentBlockers = task.blockedBy || [];

    for (const t of allTasks) {
      // Skip current task, already blockers, and completed tasks
      if (t.id === task.id || currentBlockers.includes(t.id) || t.status === 'done') {
        continue;
      }
      // Skip if adding would create circular dependency
      if (this.wouldCreateCircularDependency(task.id, t.id)) {
        continue;
      }

      const option = document.createElement('option');
      option.value = t.id;
      option.textContent = t.name;
      select.appendChild(option);
    }
  }

  addBlockerFromModal() {
    const taskId = document.getElementById('dependency-task-id').value;
    const select = document.getElementById('add-blocker-select');
    const blockerId = select.value;

    if (!taskId || !blockerId) return;

    this.addDependency(taskId, blockerId);
    this.openDependencyModal(taskId); // Refresh modal
    this.render();
  }

  openTagModal(tagId = null) {
    const modal = document.getElementById('tag-modal');
    const form = document.getElementById('tag-form');
    const title = document.getElementById('tag-modal-title');
    const deleteBtn = document.getElementById('delete-tag-btn');

    form.reset();
    document.getElementById('tag-id').value = '';

    // Reset color selection
    document.querySelectorAll('#tag-color-picker .color-option').forEach(o => o.classList.remove('selected'));
    document.querySelector('#tag-color-picker .color-option').classList.add('selected');
    document.getElementById('tag-color').value = '#3498db';

    if (tagId) {
      const tag = this.data.tags.find(t => t.id === tagId);
      if (tag) {
        title.textContent = 'Edit Tag';
        document.getElementById('tag-id').value = tag.id;
        document.getElementById('tag-name').value = tag.name;
        document.getElementById('tag-color').value = tag.color;

        // Select color
        document.querySelectorAll('#tag-color-picker .color-option').forEach(o => {
          o.classList.toggle('selected', o.dataset.color === tag.color);
        });

        deleteBtn.style.display = 'block';
      }
    } else {
      title.textContent = 'Add Tag';
      deleteBtn.style.display = 'none';
    }

    this.openModal('tag-modal');
    document.getElementById('tag-name').focus();
  }

  saveTagForm() {
    const tagId = document.getElementById('tag-id').value;
    const tagData = {
      name: document.getElementById('tag-name').value.trim(),
      color: document.getElementById('tag-color').value
    };

    if (tagId) {
      this.updateTag(tagId, tagData);
    } else {
      this.createTag(tagData);
    }

    this.closeModal('tag-modal');
    this.render();
  }

  // Confirmations
  showConfirmDialog(title, message, onConfirm) {
    document.getElementById('confirm-title').textContent = title;
    document.getElementById('confirm-message').textContent = message;

    const okBtn = document.getElementById('confirm-ok');
    const cancelBtn = document.getElementById('confirm-cancel');

    const handleOk = () => {
      onConfirm();
      cleanup();
    };

    const handleCancel = () => {
      cleanup();
    };

    const cleanup = () => {
      okBtn.removeEventListener('click', handleOk);
      cancelBtn.removeEventListener('click', handleCancel);
      this.closeModal('confirm-modal');
    };

    okBtn.addEventListener('click', handleOk);
    cancelBtn.addEventListener('click', handleCancel);
    this.openModal('confirm-modal');
  }

  confirmDeleteTask(taskId) {
    const task = this.findTask(taskId);
    if (!task) return;

    document.getElementById('confirm-title').textContent = 'Delete Task';
    document.getElementById('confirm-message').textContent = `Are you sure you want to delete "${task.name}"?`;

    const okBtn = document.getElementById('confirm-ok');
    const cancelBtn = document.getElementById('confirm-cancel');

    const handleOk = () => {
      this.deleteTask(taskId);
      this.closeDetailPanel();
      this.render();
      cleanup();
    };

    const handleCancel = () => {
      cleanup();
    };

    const cleanup = () => {
      okBtn.removeEventListener('click', handleOk);
      cancelBtn.removeEventListener('click', handleCancel);
      this.closeModal('confirm-modal');
    };

    okBtn.addEventListener('click', handleOk);
    cancelBtn.addEventListener('click', handleCancel);
    this.openModal('confirm-modal');
  }

  confirmDeleteProject() {
    const projectId = document.getElementById('project-id').value;
    const project = this.data.projects.find(p => p.id === projectId);
    if (!project) return;

    document.getElementById('confirm-title').textContent = 'Delete Project';
    document.getElementById('confirm-message').textContent = `Are you sure you want to delete "${project.name}" and all its tasks?`;

    const okBtn = document.getElementById('confirm-ok');
    const cancelBtn = document.getElementById('confirm-cancel');

    const handleOk = () => {
      this.deleteProject(projectId);
      this.closeModal('project-modal');
      this.render();
      cleanup();
    };

    const handleCancel = () => {
      cleanup();
    };

    const cleanup = () => {
      okBtn.removeEventListener('click', handleOk);
      cancelBtn.removeEventListener('click', handleCancel);
      this.closeModal('confirm-modal');
    };

    okBtn.addEventListener('click', handleOk);
    cancelBtn.addEventListener('click', handleCancel);
    this.openModal('confirm-modal');
  }

  confirmDeleteTag() {
    const tagId = document.getElementById('tag-id').value;
    const tag = this.data.tags.find(t => t.id === tagId);
    if (!tag) return;

    document.getElementById('confirm-title').textContent = 'Delete Tag';
    document.getElementById('confirm-message').textContent = `Are you sure you want to delete the tag "${tag.name}"?`;

    const okBtn = document.getElementById('confirm-ok');
    const cancelBtn = document.getElementById('confirm-cancel');

    const handleOk = () => {
      this.deleteTag(tagId);
      this.closeModal('tag-modal');
      this.render();
      cleanup();
    };

    const handleCancel = () => {
      cleanup();
    };

    const cleanup = () => {
      okBtn.removeEventListener('click', handleOk);
      cancelBtn.removeEventListener('click', handleCancel);
      this.closeModal('confirm-modal');
    };

    okBtn.addEventListener('click', handleOk);
    cancelBtn.addEventListener('click', handleCancel);
    this.openModal('confirm-modal');
  }

  // Detail Panel
  openDetailPanel(taskId) {
    const task = this.findTask(taskId);
    if (!task) return;

    this.selectedTask = task;
    const panel = document.getElementById('detail-panel');
    const content = document.getElementById('detail-content');

    const project = this.data.projects.find(p => p.tasks.some(t => t.id === task.id));

    let statusOptions = ['todo', 'ready', 'in-progress', 'waiting', 'review', 'done'].map(s =>
      `<option value="${s}" ${task.status === s ? 'selected' : ''}>${this.formatStatus(s)}</option>`
    ).join('');

    let priorityOptions = ['none', 'low', 'medium', 'high', 'urgent'].map(p =>
      `<option value="${p}" ${task.priority === p ? 'selected' : ''}>${p.charAt(0).toUpperCase() + p.slice(1)}</option>`
    ).join('');

    let subtasksHtml = '';
    if (task.subtasks && task.subtasks.length > 0) {
      subtasksHtml = task.subtasks.map(st => `
        <div class="subtask-item ${st.status === 'done' ? 'completed' : ''}" data-id="${st.id}">
          <div class="subtask-checkbox ${st.status === 'done' ? 'checked' : ''}">${st.status === 'done' ? '&#10003;' : ''}</div>
          <span class="subtask-name">${this.escapeHtml(st.name)}</span>
          <select class="subtask-assigned-to" data-subtask-id="${st.id}">
            ${this.buildAssignedToOptions(st.assignedTo).replace('Unassigned', '-')}
          </select>
          <button class="task-action-btn delete-subtask" title="Delete">&#10005;</button>
        </div>
      `).join('');
    }

    // File paths HTML
    let filePathsHtml = '';
    if (task.filePaths && task.filePaths.length > 0) {
      filePathsHtml = `
        <div class="detail-section">
          <h4>Attached Files</h4>
          <div class="detail-files">
            ${task.filePaths.map(fp => `
              <div class="detail-file-item" data-path="${this.escapeHtml(fp)}">
                <span class="detail-file-icon">📄</span>
                <span class="detail-file-path">${this.escapeHtml(fp)}</span>
              </div>
            `).join('')}
          </div>
        </div>
      `;
    }

    content.innerHTML = `
      <div class="detail-section detail-header-section">
        <h4 class="detail-task-name">${this.escapeHtml(task.name)}</h4>
        <button class="btn btn-small btn-ghost" id="detail-copy-btn" title="Copy task to clipboard">📋 Copy</button>
      </div>
      ${task.description ? `<p class="detail-description">${this.escapeHtml(task.description)}</p>` : ''}
      ${task.context ? `
        <div class="detail-context">
          <div class="detail-context-header">Brain Dump / Context</div>
          <div class="detail-context-content">${this.escapeHtml(task.context)}</div>
        </div>
      ` : ''}

      <div class="detail-section">
        <div class="detail-field">
          <span class="detail-field-label">Status</span>
          <select class="detail-field-value" id="detail-status">${statusOptions}</select>
        </div>
        <div class="detail-field">
          <span class="detail-field-label">Priority</span>
          <select class="detail-field-value" id="detail-priority">${priorityOptions}</select>
        </div>
        <div class="detail-field">
          <span class="detail-field-label">Due Date</span>
          <input type="date" class="detail-field-value" id="detail-due-date" value="${task.dueDate || ''}">
        </div>
        <div class="detail-field">
          <span class="detail-field-label">Project</span>
          <span class="detail-field-value">${project && !project.isInbox ? this.escapeHtml(project.name) : 'Inbox'}</span>
        </div>
        <div class="detail-field">
          <span class="detail-field-label">Assigned To</span>
          <select class="detail-field-value" id="detail-assigned-to">
            ${this.buildAssignedToOptions(task.assignedTo)}
          </select>
        </div>
      </div>

      ${task.scheduledDate || task.scheduledTime || task.estimatedMinutes || task.waitingReason ? `
      <div class="detail-section detail-scheduling">
        <h4>Scheduling</h4>
        ${task.scheduledDate || task.scheduledTime ? `
        <div class="detail-field">
          <span class="detail-field-label">Scheduled</span>
          <span class="detail-field-value">${task.scheduledTime ? `${task.scheduledTime} on ` : ''}${task.scheduledDate || 'today'}</span>
        </div>` : ''}
        ${task.estimatedMinutes ? `
        <div class="detail-field">
          <span class="detail-field-label">Estimated Duration</span>
          <span class="detail-field-value">${task.estimatedMinutes} minutes</span>
        </div>` : ''}
        ${task.waitingReason ? `
        <div class="detail-field detail-waiting-reason">
          <span class="detail-field-label">Waiting Reason</span>
          <span class="detail-field-value">${this.escapeHtml(task.waitingReason)}${task.blockedBy ? ` (${this.escapeHtml(task.blockedBy)})` : ''}</span>
        </div>` : ''}
      </div>` : ''}

      ${filePathsHtml}

      <div class="detail-section">
        <h4>Subtasks</h4>
        <div class="detail-subtasks">
          ${subtasksHtml}
        </div>
        <div class="detail-add-subtask">
          <input type="text" id="new-subtask-input" placeholder="Add a subtask...">
          <button class="btn btn-primary" id="add-subtask-btn">Add</button>
        </div>
      </div>

      <div class="detail-section">
        <h4>Notes</h4>
        <textarea class="detail-notes" id="detail-notes" placeholder="Add notes about this task...">${this.escapeHtml(task.workNotes || '')}</textarea>
      </div>

      ${task.status === 'done' && task.completionSummary ? `
      <div class="detail-section detail-completion">
        <h4>Completion Summary</h4>
        <div class="detail-completion-content">${this.escapeHtml(task.completionSummary)}</div>
      </div>
      ` : ''}

      <div class="detail-actions">
        <button class="btn btn-claude" id="detail-claude-btn">Claude</button>
        <button class="btn btn-secondary" id="detail-edit-btn">Edit</button>
        <button class="btn btn-danger" id="detail-delete-btn">Delete</button>
      </div>
    `;

    // Bind detail panel events
    content.querySelector('#detail-status').addEventListener('change', (e) => {
      const newStatus = e.target.value;
      if (newStatus === 'done' && task.status !== 'done') {
        // Show completion summary modal
        this.showCompletionSummaryModal(task.id, () => {
          this.render();
          this.refreshCommandCenter();
          this.openDetailPanel(task.id);
        });
      } else if (newStatus === 'waiting' && task.status !== 'waiting') {
        this.showBlockerReasonPopup(task.id, () => {
          this.render();
          this.refreshCommandCenter();
          this.openDetailPanel(task.id);
        });
      } else {
        this.updateTask(task.id, { status: newStatus });
        this.render();
        this.refreshCommandCenter();
      }
    });

    content.querySelector('#detail-priority').addEventListener('change', (e) => {
      this.updateTask(task.id, { priority: e.target.value });
      this.render();
      this.refreshCommandCenter();
    });

    content.querySelector('#detail-due-date').addEventListener('change', (e) => {
      this.updateTask(task.id, { dueDate: e.target.value || null });
      this.render();
      this.refreshCommandCenter();
    });

    content.querySelector('#detail-assigned-to').addEventListener('change', (e) => {
      this.updateTask(task.id, { assignedTo: e.target.value || null });
      this.render();
      this.refreshCommandCenter();
    });

    content.querySelector('#add-subtask-btn').addEventListener('click', () => {
      const input = content.querySelector('#new-subtask-input');
      const name = input.value.trim();
      if (name) {
        this.createTask({ name, parentId: task.id });
        input.value = '';
        this.openDetailPanel(task.id);
        this.render();
      }
    });

    content.querySelector('#new-subtask-input').addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        content.querySelector('#add-subtask-btn').click();
      }
    });

    content.querySelectorAll('.subtask-checkbox').forEach(cb => {
      cb.addEventListener('click', () => {
        const subtaskId = cb.closest('.subtask-item').dataset.id;
        this.toggleTaskStatus(subtaskId);
        this.openDetailPanel(task.id);
      });
    });

    content.querySelectorAll('.delete-subtask').forEach(btn => {
      btn.addEventListener('click', () => {
        const subtaskId = btn.closest('.subtask-item').dataset.id;
        this.deleteTask(subtaskId);
        this.openDetailPanel(task.id);
        this.render();
      });
    });

    content.querySelectorAll('.subtask-assigned-to').forEach(select => {
      select.addEventListener('change', (e) => {
        const subtaskId = e.target.dataset.subtaskId;
        this.updateSubtask(task.id, subtaskId, { assignedTo: e.target.value || null });
        this.render();
      });
    });

    content.querySelector('#detail-edit-btn').addEventListener('click', () => {
      this.openTaskModal(task.id);
    });

    content.querySelector('#detail-delete-btn').addEventListener('click', () => {
      this.confirmDeleteTask(task.id);
    });

    // Copy button
    content.querySelector('#detail-copy-btn').addEventListener('click', () => {
      this.copyTaskToClipboard(task);
    });

    // Claude button
    content.querySelector('#detail-claude-btn').addEventListener('click', () => {
      const prompt = this.buildTaskClaudePrompt(task.id);
      const project = this.data.projects.find(p => p.tasks.some(t => t.id === task.id));
      this.launchClaudeSession(prompt, task.name, project ? project.id : null);
    });

    // File path clicks
    content.querySelectorAll('.detail-file-item').forEach(item => {
      item.addEventListener('click', () => {
        this.openFilePath(item.dataset.path);
      });
    });

    // Notes - save on blur
    const notesInput = content.querySelector('#detail-notes');
    if (notesInput) {
      notesInput.addEventListener('blur', () => {
        this.updateTask(task.id, { workNotes: notesInput.value });
      });
    }

    panel.classList.add('open');
  }

  copyTaskToClipboard(task) {
    const project = this.data.projects.find(p => p.tasks.some(t => t.id === task.id));
    const projectName = project && !project.isInbox ? project.name : 'Inbox';

    let text = `# ${task.name}\n\n`;
    text += `**Status:** ${this.formatStatus(task.status)}\n`;
    text += `**Priority:** ${task.priority}\n`;
    text += `**Project:** ${projectName}\n`;
    if (task.dueDate) text += `**Due:** ${task.dueDate}\n`;

    if (task.description) {
      text += `\n## Description\n${task.description}\n`;
    }

    if (task.context) {
      text += `\n## Context / Brain Dump\n${task.context}\n`;
    }

    if (task.filePaths && task.filePaths.length > 0) {
      text += `\n## Attached Files\n`;
      task.filePaths.forEach(fp => {
        text += `- ${fp}\n`;
      });
    }

    if (task.subtasks && task.subtasks.length > 0) {
      text += `\n## Subtasks\n`;
      task.subtasks.forEach(st => {
        text += `- [${st.status === 'done' ? 'x' : ' '}] ${st.name}\n`;
      });
    }

    if (window.api && window.api.copyToClipboard) {
      window.api.copyToClipboard(text);
      // Show quick feedback
      const btn = document.getElementById('detail-copy-btn');
      const original = btn.textContent;
      btn.textContent = '✓ Copied!';
      setTimeout(() => { btn.textContent = original; }, 1500);
    }
  }

  buildTaskClaudePrompt(taskId) {
    const task = this.findTask(taskId);
    if (!task) return '';

    const project = this.data.projects.find(p => p.tasks.some(t => t.id === taskId));
    const projectName = project && !project.isInbox ? project.name : 'Inbox';

    let prompt = `# Task: ${task.name}\n\n`;
    prompt += `**Status:** ${this.formatStatus(task.status)}\n`;
    prompt += `**Priority:** ${task.priority}\n`;
    prompt += `**Project:** ${projectName}\n`;
    if (task.executionType) prompt += `**Execution Type:** ${task.executionType}\n`;
    if (task.assignee) prompt += `**Assignee:** ${task.assignee}\n`;
    if (task.dueDate) prompt += `**Due Date:** ${task.dueDate}\n`;
    if (task.estimatedMinutes) prompt += `**Estimated Duration:** ${task.estimatedMinutes} minutes\n`;

    if (task.description) {
      prompt += `\n## Description\n${task.description}\n`;
    }

    if (task.context) {
      prompt += `\n## Context / Brain Dump\n${task.context}\n`;
    }

    if (task.workNotes) {
      prompt += `\n## Work Notes\n${task.workNotes}\n`;
    }

    if (task.subtasks && task.subtasks.length > 0) {
      prompt += `\n## Subtasks\n`;
      task.subtasks.forEach(st => {
        prompt += `- [${st.status === 'done' ? 'x' : ' '}] ${st.name}\n`;
      });
    }

    if (task.filePaths && task.filePaths.length > 0) {
      prompt += `\n## Attached Files\n`;
      task.filePaths.forEach(fp => {
        prompt += `- ${fp}\n`;
      });
    }

    if (task.blockedBy && task.blockedBy.length > 0) {
      prompt += `\n## Blocked By\n`;
      task.blockedBy.forEach(id => {
        const blocker = this.findTask(id);
        prompt += `- ${blocker ? blocker.name : id}\n`;
      });
    }

    if (task.status === 'waiting' && task.waitingReason) {
      prompt += `\n## Waiting Reason\n${task.waitingReason}\n`;
    }

    if (project && !project.isInbox) {
      prompt += `\n## Project Context\n`;
      prompt += `**Project:** ${project.name}\n`;
      if (project.goal) prompt += `**Goal:** ${project.goal}\n`;
    }

    prompt += `\n---\nHelp me work on this task. The context has been copied to your clipboard — this is the task I need help with.`;

    return prompt;
  }

  buildProjectClaudePrompt(projectId) {
    const project = this.data.projects.find(p => p.id === projectId);
    if (!project) return '';

    const activeTasks = project.tasks.filter(t => t.status !== 'done');
    const completedTasks = project.tasks.filter(t => t.status === 'done');

    let prompt = `# Project: ${project.name}\n\n`;
    if (project.goal) prompt += `**Goal:** ${project.goal}\n`;
    if (project.description) prompt += `**Description:** ${project.description}\n`;
    prompt += `**Tasks:** ${activeTasks.length} active, ${completedTasks.length} completed\n`;

    if (activeTasks.length > 0) {
      prompt += `\n## Active Tasks\n`;
      const priorityOrder = { urgent: 0, high: 1, medium: 2, low: 3, none: 4 };
      const sorted = [...activeTasks].sort((a, b) =>
        (priorityOrder[a.priority] ?? 4) - (priorityOrder[b.priority] ?? 4)
      );

      sorted.forEach(task => {
        prompt += `\n### ${task.name}\n`;
        prompt += `- **Status:** ${this.formatStatus(task.status)} | **Priority:** ${task.priority}`;
        if (task.executionType) prompt += ` | **Type:** ${task.executionType}`;
        prompt += `\n`;
        if (task.description) prompt += `- ${task.description}\n`;
        if (task.subtasks && task.subtasks.length > 0) {
          task.subtasks.forEach(st => {
            prompt += `  - [${st.status === 'done' ? 'x' : ' '}] ${st.name}\n`;
          });
        }
      });
    }

    prompt += `\n---\nHelp me work on this project. The context has been copied to your clipboard.`;

    return prompt;
  }

  generateProjectClaudeMd(projectId) {
    const project = this.data.projects.find(p => p.id === projectId);
    if (!project) return '';

    const activeTasks = project.tasks.filter(t => t.status !== 'done');
    const completedTasks = project.tasks.filter(t => t.status === 'done');
    const priorityOrder = { urgent: 0, high: 1, medium: 2, low: 3, none: 4 };
    const sorted = [...activeTasks].sort((a, b) =>
      (priorityOrder[a.priority] ?? 4) - (priorityOrder[b.priority] ?? 4)
    );

    let md = `# ${project.name}\n\n`;
    if (project.goal) md += `**Goal:** ${project.goal}\n\n`;
    if (project.description) md += `${project.description}\n\n`;
    if (project.status) md += `**Status:** ${project.status}\n\n`;

    // Active tasks
    if (sorted.length > 0) {
      md += `## Active Tasks (${sorted.length})\n\n`;
      sorted.forEach(task => {
        const badges = [];
        badges.push(this.formatStatus(task.status));
        badges.push(task.priority);
        if (task.executionType) badges.push(task.executionType);
        if (task.assignee) badges.push(`@${task.assignee}`);
        if (task.dueDate) badges.push(`due ${task.dueDate}`);

        md += `### ${task.name}\n`;
        md += `${badges.join(' | ')}\n\n`;
        if (task.description) md += `${task.description}\n\n`;
        if (task.subtasks && task.subtasks.length > 0) {
          md += `**Subtasks:**\n`;
          task.subtasks.forEach(st => {
            md += `- [${st.status === 'done' ? 'x' : ' '}] ${st.name}\n`;
          });
          md += `\n`;
        }
        if (task.filePaths && task.filePaths.length > 0) {
          md += `**Files:** ${task.filePaths.join(', ')}\n\n`;
        }
        if (task.blockedBy && task.blockedBy.length > 0) {
          const blockerNames = task.blockedBy.map(id => {
            const b = this.findTask(id);
            return b ? b.name : id;
          });
          md += `**Blocked by:** ${blockerNames.join(', ')}\n\n`;
        }
      });
    }

    // Completed summary
    if (completedTasks.length > 0) {
      md += `## Completed Tasks\n\n${completedTasks.length} tasks completed.\n\n`;
    }

    // Reference section
    md += `## TaskFlow Context\n\n`;
    md += `- **Execution types:** ai (Claude works autonomously), manual (human action), hybrid (collaborative)\n`;
    md += `- **Statuses:** todo, in-progress, waiting, done\n`;
    md += `- **Priorities:** urgent > high > medium > low > none\n`;

    return md;
  }

  showSetDirectoryDialog(projectName) {
    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.className = 'modal-overlay active';
      overlay.innerHTML = `
        <div class="modal" style="max-width: 460px;">
          <div class="modal-header">
            <h2>Set Working Directory</h2>
          </div>
          <div class="modal-body">
            <p style="margin-bottom: 16px;">"${this.escapeHtml(projectName)}" doesn't have a working directory set. Claude sessions need a directory to launch in and write CLAUDE.md to.</p>
            <div class="form-group" style="margin-bottom: 0;">
              <div class="form-row" style="gap: 8px;">
                <input type="text" id="set-dir-path" placeholder="Choose a folder..." style="flex: 1;" readonly>
                <button type="button" class="btn btn-secondary" id="set-dir-browse">Browse</button>
              </div>
            </div>
          </div>
          <div class="modal-footer">
            <button class="btn btn-secondary" id="set-dir-skip">Skip</button>
            <button class="btn btn-primary" id="set-dir-confirm" disabled>Launch Here</button>
          </div>
        </div>
      `;
      document.body.appendChild(overlay);

      const pathInput = overlay.querySelector('#set-dir-path');
      const confirmBtn = overlay.querySelector('#set-dir-confirm');

      overlay.querySelector('#set-dir-browse').addEventListener('click', async () => {
        const dirPath = await window.api.browseFile();
        if (dirPath) {
          pathInput.value = dirPath;
          confirmBtn.disabled = false;
        }
      });

      overlay.querySelector('#set-dir-skip').addEventListener('click', () => {
        document.body.removeChild(overlay);
        resolve(null);
      });

      confirmBtn.addEventListener('click', () => {
        const chosen = pathInput.value;
        document.body.removeChild(overlay);
        resolve(chosen || null);
      });

      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) {
          document.body.removeChild(overlay);
          resolve(null);
        }
      });
    });
  }

  async launchClaudeSession(prompt, sessionLabel, projectId = null) {
    let project = null;
    let workingDir = null;

    if (projectId) {
      project = this.data.projects.find(p => p.id === projectId);
    }

    if (project && project.workingDirectory) {
      workingDir = project.workingDirectory;
    } else if (project && !project.isInbox) {
      // No directory set — ask user to pick one
      const chosenDir = await this.showSetDirectoryDialog(project.name);
      if (chosenDir) {
        project.workingDirectory = chosenDir;
        this.saveData();
        workingDir = chosenDir;
      } else {
        // User skipped — clipboard only, no terminal
        this.showToast('Context copied to clipboard (no directory set)');
        await window.api.copyToClipboard(prompt);
        return;
      }
    }

    // Write CLAUDE.md if we have a working directory and a project
    if (workingDir && project) {
      const claudeMd = this.generateProjectClaudeMd(project.id);
      const filePath = workingDir.replace(/\\/g, '/') + '/CLAUDE.md';
      try {
        await window.api.writeFile(filePath, claudeMd);
      } catch (err) {
        console.error('Failed to write CLAUDE.md:', err);
      }
    }

    this.showToast('Launching Claude — context copied to clipboard');
    try {
      const result = await window.api.launchClaudeSession({
        prompt,
        workingDir,
        sessionLabel
      });
      if (!result.success) {
        this.showToast('Failed to launch Claude: ' + (result.error || 'Unknown error'), 4000);
      }
    } catch (err) {
      this.showToast('Failed to launch Claude session', 4000);
    }
  }

  closeDetailPanel() {
    document.getElementById('detail-panel').classList.remove('open');
    this.selectedTask = null;
  }

  showCompletionSummaryModal(taskId, onComplete) {
    const task = this.findTask(taskId);
    if (!task) return;

    // Remove existing modal if any
    document.querySelector('.completion-modal')?.remove();

    const modal = document.createElement('div');
    modal.className = 'completion-modal';
    modal.innerHTML = `
      <div class="completion-modal-backdrop"></div>
      <div class="completion-modal-content">
        <div class="completion-modal-header">
          <span class="completion-modal-icon">✓</span>
          <h3>Task Complete!</h3>
        </div>
        <div class="completion-modal-task">${this.escapeHtml(task.name)}</div>
        <div class="completion-modal-body">
          <label for="completion-summary">What did you accomplish? (optional)</label>
          <textarea id="completion-summary" placeholder="Brief summary of what was done, decisions made, or outcomes..."></textarea>
          <div class="completion-energy-row">
            <label>How did that feel?</label>
            <div class="completion-energy-options">
              <button type="button" class="energy-choice" data-rating="1" title="Drained">&#128553;</button>
              <button type="button" class="energy-choice" data-rating="2" title="Neutral">&#128528;</button>
              <button type="button" class="energy-choice" data-rating="3" title="Energized">&#128170;</button>
            </div>
          </div>
        </div>
        <div class="completion-modal-actions">
          <button class="btn btn-secondary" id="completion-skip">Skip</button>
          <button class="btn btn-success" id="completion-save">Save & Complete</button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    // Focus textarea
    setTimeout(() => modal.querySelector('#completion-summary').focus(), 100);

    let selectedEnergy = null;

    // Energy rating buttons
    modal.querySelectorAll('.energy-choice').forEach(btn => {
      btn.addEventListener('click', () => {
        modal.querySelectorAll('.energy-choice').forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
        selectedEnergy = parseInt(btn.dataset.rating);
      });
    });

    const closeModal = () => {
      modal.remove();
    };

    // Skip button - complete without summary
    modal.querySelector('#completion-skip').addEventListener('click', () => {
      const updates = { status: 'done' };
      if (selectedEnergy) updates.energyRating = selectedEnergy;
      this.updateTask(taskId, updates);
      this.addCompletionToRecap(task.name, null);
      closeModal();
      if (onComplete) onComplete();
    });

    // Save button - complete with summary
    modal.querySelector('#completion-save').addEventListener('click', () => {
      const summary = modal.querySelector('#completion-summary').value.trim();
      const updates = {
        status: 'done',
        completionSummary: summary || null
      };
      if (selectedEnergy) updates.energyRating = selectedEnergy;
      this.updateTask(taskId, updates);
      this.addCompletionToRecap(task.name, summary || null);
      closeModal();
      if (onComplete) onComplete();
    });

    // Backdrop click closes
    modal.querySelector('.completion-modal-backdrop').addEventListener('click', () => {
      // Revert the status dropdown if they cancel
      closeModal();
      this.openDetailPanel(taskId);
    });

    // Enter key saves
    modal.querySelector('#completion-summary').addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && e.ctrlKey) {
        modal.querySelector('#completion-save').click();
      }
    });
  }

  // Log completed task to recap
  addCompletionToRecap(taskName, summary) {
    if (!this.data.recapLog) this.data.recapLog = [];
    const content = summary
      ? `Completed: ${taskName} — ${summary}`
      : `Completed: ${taskName}`;
    this.data.recapLog.push({
      id: this.generateId(),
      type: 'accomplishment',
      content: content,
      date: this.getLocalDateString(),
      relatedTaskId: null,
      tags: [],
      createdAt: new Date().toISOString()
    });
    this.saveData();
  }

  // Task Actions
  toggleTaskStatus(taskId) {
    const task = this.findTask(taskId);
    if (task) {
      const wasDone = task.status === 'done';
      const newStatus = wasDone ? 'todo' : 'done';
      this.updateTask(taskId, { status: newStatus });
      if (!wasDone) {
        this.showToast(`${task.name} completed`, 2000, 'success');
        this.addCompletionToRecap(task.name, null);
      }
      this.render();
    }
  }

  // Export/Import
  async exportData() {
    await window.api.exportData(this.data);
    this.closeModal('settings-modal');
  }

  async importData() {
    const data = await window.api.importData();
    if (data) {
      this.data = data;
      await this.saveData();
      this.applyFontScale();
      this.render();
    }
    this.closeModal('settings-modal');
  }

  // Font Scale
  changeFontScale(delta) {
    const current = this.data.fontScale || 100;
    const next = Math.min(150, Math.max(70, current + delta));
    if (next === current) return;
    this.data.fontScale = next;
    this.applyFontScale();
    this.updateFontSizeDisplay();
    this.saveData();
  }

  resetFontScale() {
    this.data.fontScale = 100;
    this.applyFontScale();
    this.updateFontSizeDisplay();
    this.saveData();
  }

  applyFontScale() {
    const scale = this.data.fontScale || 100;
    // Use Electron's native webFrame zoom — scales everything correctly
    // without breaking scroll or layout calculations
    if (window.api && window.api.setZoomFactor) {
      window.api.setZoomFactor(scale / 100);
    }
  }

  updateFontSizeDisplay() {
    const el = document.getElementById('font-size-value');
    if (el) el.textContent = (this.data.fontScale || 100) + '%';
  }

  // Focus Mode Methods
  getFocusTaskQueue() {
    const today = this.getLocalDateString();
    const priorities = { urgent: 0, high: 1, medium: 2, low: 3, none: 4 };

    // Only get tasks relevant for TODAY:
    // - Scheduled for today
    // - Due today
    // - Overdue
    let tasks = this.getAllTasks().filter(t => {
      if (t.status === 'done') return false;

      const isScheduledToday = t.scheduledDate === today;
      const isDueToday = t.dueDate === today;
      const isOverdue = t.dueDate && t.dueDate < today;

      return isScheduledToday || isDueToday || isOverdue;
    });

    tasks.sort((a, b) => {
      // First: Tasks scheduled for today, sorted by scheduled time
      const aScheduledToday = a.scheduledDate === today && a.scheduledTime;
      const bScheduledToday = b.scheduledDate === today && b.scheduledTime;

      if (aScheduledToday && !bScheduledToday) return -1;
      if (!aScheduledToday && bScheduledToday) return 1;
      if (aScheduledToday && bScheduledToday) {
        return a.scheduledTime.localeCompare(b.scheduledTime);
      }

      // Then: Overdue tasks
      const aOverdue = a.dueDate && a.dueDate < today;
      const bOverdue = b.dueDate && b.dueDate < today;
      if (aOverdue && !bOverdue) return -1;
      if (!aOverdue && bOverdue) return 1;

      // Then: By priority
      const aPriority = priorities[a.priority] || 4;
      const bPriority = priorities[b.priority] || 4;
      if (aPriority !== bPriority) return aPriority - bPriority;

      return new Date(a.createdAt) - new Date(b.createdAt);
    });

    return tasks;
  }

  enterFocusMode() {
    const taskQueue = this.getFocusTaskQueue();

    if (taskQueue.length === 0) {
      this.showFocusEmpty();
      return;
    }

    this.focusMode.active = true;
    this.focusMode.minimized = false;
    this.focusMode.taskQueue = taskQueue;
    this.focusMode.currentIndex = 0;
    this.focusMode.completedCount = 0;
    this.focusMode.aiMessages = [];

    const focusModeEl = document.getElementById('focus-mode');
    focusModeEl.classList.add('active');
    document.getElementById('focus-mini').classList.remove('active');

    // Focus the overlay to capture keyboard events
    setTimeout(() => focusModeEl.focus(), 100);

    // Set timer based on current task's duration
    this.setTimerForCurrentTask();

    this.renderFocusTask();
    this.updateSessionStats();
    this.resetAIChat();
  }

  // Set timer based on current task's estimated duration
  setTimerForCurrentTask() {
    const task = this.focusMode.taskQueue[this.focusMode.currentIndex];
    if (!task) return;

    // Use task's estimatedMinutes or default to 25 minutes
    const duration = task.estimatedMinutes || 25;
    this.focusMode.timerSeconds = duration * 60;
    this.focusMode.workDuration = duration * 60;

    // Stop any running timer
    if (this.focusMode.timerInterval) {
      clearInterval(this.focusMode.timerInterval);
      this.focusMode.timerInterval = null;
    }
    this.focusMode.timerRunning = false;
    this.focusMode.isBreak = false;

    this.updateTimerDisplay();
  }

  exitFocusMode() {
    const focusModeEl = document.getElementById('focus-mode');
    const miniEl = document.getElementById('focus-mini');

    focusModeEl.classList.add('closing');

    if (this.focusMode.timerInterval) {
      clearInterval(this.focusMode.timerInterval);
      this.focusMode.timerInterval = null;
    }

    // Hide native pill window
    window.api.hidePill();

    setTimeout(() => {
      this.focusMode.active = false;
      this.focusMode.minimized = false;
      this.focusMode.timerRunning = false;
      this.focusMode.settingsPanelOpen = false;
      focusModeEl.classList.remove('active', 'closing', 'break');
      miniEl.classList.remove('active', 'running', 'break');
      document.getElementById('focus-settings-panel').classList.remove('open');
      this.render();
    }, 400);
  }

  minimizeFocusMode() {
    this.focusMode.active = false;
    this.focusMode.minimized = true;

    document.getElementById('focus-mode').classList.remove('active');

    // Hide in-app mini widget
    const miniEl = document.getElementById('focus-mini');
    miniEl.classList.remove('active');

    document.getElementById('focus-settings-panel').classList.remove('open');
    this.focusMode.settingsPanelOpen = false;

    // Show native OS pill window
    window.api.showPill();
    // Update after a short delay to ensure window is ready
    setTimeout(() => this.updateNativePill(), 200);
  }

  expandFocusMode() {
    this.focusMode.active = true;
    this.focusMode.minimized = false;

    // Hide native pill window
    window.api.hidePill();

    document.getElementById('focus-mini').classList.remove('active');
    const focusModeEl = document.getElementById('focus-mode');
    focusModeEl.classList.add('active');

    // Focus the overlay to capture keyboard events
    setTimeout(() => focusModeEl.focus(), 100);

    this.renderFocusTask();
  }

  updateMiniWidget() {
    const task = this.focusMode.taskQueue[this.focusMode.currentIndex];
    if (!task) return;

    document.getElementById('focus-mini-task').textContent = task.name;
    this.updateMiniTimerDisplay();
  }

  updateMiniTimerDisplay() {
    const minutes = Math.floor(this.focusMode.timerSeconds / 60);
    const seconds = this.focusMode.timerSeconds % 60;
    const timeStr = `${minutes}:${seconds.toString().padStart(2, '0')}`;

    document.getElementById('focus-mini-time').textContent = timeStr;

    const totalSeconds = this.focusMode.isBreak ?
      this.focusMode.breakDuration : this.focusMode.workDuration;
    const progress = this.focusMode.timerSeconds / totalSeconds;
    const circumference = 2 * Math.PI * 18;
    const miniProgress = document.getElementById('focus-mini-progress');
    if (miniProgress) {
      miniProgress.style.strokeDashoffset = circumference * (1 - progress);
    }

    const miniEl = document.getElementById('focus-mini');
    miniEl.classList.toggle('break', this.focusMode.isBreak);
    miniEl.classList.toggle('running', this.focusMode.timerRunning);

    // Also update native pill if minimized
    if (this.focusMode.minimized) {
      this.updateNativePill();
    }
  }

  updateNativePill() {
    const task = this.focusMode.taskQueue[this.focusMode.currentIndex];
    if (!task) return;

    const minutes = Math.floor(this.focusMode.timerSeconds / 60);
    const seconds = this.focusMode.timerSeconds % 60;
    const timeStr = `${minutes}:${seconds.toString().padStart(2, '0')}`;

    const totalSeconds = this.focusMode.isBreak ?
      this.focusMode.breakDuration : this.focusMode.workDuration;
    const progress = this.focusMode.timerSeconds / totalSeconds;

    window.api.updatePill({
      taskName: task.name,
      time: timeStr,
      progress: progress,
      running: this.focusMode.timerRunning,
      isBreak: this.focusMode.isBreak
    });
  }

  handlePillAction(action) {
    switch (action) {
      case 'complete':
        this.completeFocusTask();
        break;
      case 'toggle-timer':
        this.toggleFocusTimer();
        break;
      case 'expand':
        this.expandFocusMode();
        break;
      case 'close':
        // Immediately hide pill in case exitFocusMode has issues
        window.api.hidePill();
        this.exitFocusMode();
        break;
      case 'request-state':
        // Pill window is ready, send current state
        this.updateNativePill();
        break;
    }
  }

  initMiniWidgetDrag() {
    const mini = document.getElementById('focus-mini');
    let isDragging = false;
    let startX, startY, initialX, initialY;

    mini.addEventListener('mousedown', (e) => {
      if (e.target.closest('.mini-btn')) return;
      isDragging = true;
      startX = e.clientX;
      startY = e.clientY;
      const rect = mini.getBoundingClientRect();
      initialX = rect.left;
      initialY = rect.top;
      mini.style.transition = 'none';
      mini.style.cursor = 'grabbing';
    });

    document.addEventListener('mousemove', (e) => {
      if (!isDragging) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      mini.style.left = `${initialX + dx}px`;
      mini.style.top = `${initialY + dy}px`;
      mini.style.right = 'auto';
      mini.style.bottom = 'auto';
    });

    document.addEventListener('mouseup', () => {
      if (isDragging) {
        isDragging = false;
        mini.style.transition = '';
        mini.style.cursor = 'default';
      }
    });
  }

  showFocusEmpty() {
    document.getElementById('focus-mode').classList.add('active');
    this.focusMode.active = true;

    const taskSection = document.querySelector('.focus-task-section');
    if (taskSection) {
      taskSection.innerHTML = `
        <div class="focus-empty">
          <div class="focus-empty-icon">🎉</div>
          <h2>All Done!</h2>
          <p>You've completed all your tasks. Time to celebrate or add new goals!</p>
        </div>
      `;
    }

    document.querySelector('.focus-nav').style.display = 'none';
  }

  renderFocusTask() {
    const task = this.focusMode.taskQueue[this.focusMode.currentIndex];
    if (!task) {
      this.showFocusEmpty();
      return;
    }

    // Update task card
    const priorityEl = document.getElementById('focus-priority');
    const nameEl = document.getElementById('focus-task-name');
    const descEl = document.getElementById('focus-task-description');
    const metaEl = document.getElementById('focus-task-meta');

    if (priorityEl) {
      priorityEl.textContent = task.priority !== 'none' ? task.priority.toUpperCase() : '';
      priorityEl.className = `focus-task-priority ${task.priority}`;
    }

    if (nameEl) nameEl.textContent = task.name;
    if (descEl) descEl.textContent = task.description || '';

    if (metaEl) {
      let metaHtml = '';
      if (task.dueDate) {
        const today = this.getLocalDateString();
        const dateClass = task.dueDate < today ? 'overdue' : (task.dueDate === today ? 'today' : '');
        metaHtml += `<span class="focus-meta-item ${dateClass}">📅 ${this.formatDate(task.dueDate)}</span>`;
      }

      const project = this.data.projects.find(p => p.tasks.some(t => t.id === task.id));
      if (project && !project.isInbox) {
        metaHtml += `<span class="focus-meta-item">📁 ${this.escapeHtml(project.name)}</span>`;
      }

      if (task.tags.length > 0) {
        const tagNames = task.tags.map(tagId => {
          const tag = this.data.tags.find(t => t.id === tagId);
          return tag ? `#${this.escapeHtml(tag.name)}` : '';
        }).filter(Boolean).join(' ');
        if (tagNames) metaHtml += `<span class="focus-meta-item">${tagNames}</span>`;
      }

      metaEl.innerHTML = metaHtml;
    }

    // Render subtasks if any
    this.renderFocusSubtasks(task);

    // Update progress
    const progressEl = document.getElementById('focus-progress');
    if (progressEl) {
      progressEl.textContent = `${this.focusMode.currentIndex + 1} / ${this.focusMode.taskQueue.length}`;
    }

    // Update nav buttons
    const prevBtn = document.getElementById('focus-prev-btn');
    const nextBtn = document.getElementById('focus-next-btn');
    if (prevBtn) prevBtn.disabled = this.focusMode.currentIndex === 0;
    if (nextBtn) nextBtn.disabled = this.focusMode.currentIndex >= this.focusMode.taskQueue.length - 1;

    // Update timer
    this.updateTimerDisplay();

    // Update AI context
    this.updateAIContext(task);
  }

  renderFocusSubtasks(task) {
    let subtasksContainer = document.getElementById('focus-subtasks');

    // Create container if it doesn't exist
    if (!subtasksContainer) {
      const taskCard = document.getElementById('focus-task-card');
      subtasksContainer = document.createElement('div');
      subtasksContainer.id = 'focus-subtasks';
      subtasksContainer.className = 'focus-subtasks';
      taskCard.appendChild(subtasksContainer);
    }

    if (!task.subtasks || task.subtasks.length === 0) {
      subtasksContainer.innerHTML = '';
      subtasksContainer.style.display = 'none';
      return;
    }

    subtasksContainer.style.display = 'block';
    const completedCount = task.subtasks.filter(st => st.status === 'done').length;

    let html = `
      <div class="focus-subtasks-header">
        <span class="subtasks-title">Action Plan</span>
        <span class="subtasks-progress">${completedCount}/${task.subtasks.length}</span>
      </div>
      <div class="focus-subtasks-list">
    `;

    task.subtasks.forEach(st => {
      const isChecked = st.status === 'done';
      html += `
        <div class="focus-subtask-item ${isChecked ? 'completed' : ''}" data-id="${st.id}">
          <button class="focus-subtask-check ${isChecked ? 'checked' : ''}" data-subtask-id="${st.id}">
            ${isChecked ? '✓' : ''}
          </button>
          <span class="focus-subtask-name">${this.escapeHtml(st.name)}</span>
        </div>
      `;
    });

    html += '</div>';
    subtasksContainer.innerHTML = html;

    // Bind click handlers for subtask checkboxes
    subtasksContainer.querySelectorAll('.focus-subtask-check').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const subtaskId = btn.dataset.subtaskId;
        this.toggleTaskStatus(subtaskId);
        this.renderFocusTask();
      });
    });
  }

  updateSessionStats() {
    const completedEl = document.getElementById('focus-completed-count');
    const pomodoroEl = document.getElementById('focus-pomodoro-count');
    const streakEl = document.getElementById('focus-streak-count');

    if (completedEl) completedEl.textContent = this.focusMode.completedCount;
    if (pomodoroEl) pomodoroEl.textContent = this.focusMode.pomodoroCount;
    if (streakEl) streakEl.textContent = this.focusMode.streak;
  }

  focusNextTask() {
    if (this.focusMode.currentIndex < this.focusMode.taskQueue.length - 1) {
      this.focusMode.currentIndex++;
      this.setTimerForCurrentTask(); // Reset timer for new task
      if (this.focusMode.active) this.renderFocusTask();
      if (this.focusMode.minimized) this.updateMiniWidget();
    }
  }

  focusPrevTask() {
    if (this.focusMode.currentIndex > 0) {
      this.focusMode.currentIndex--;
      this.setTimerForCurrentTask(); // Reset timer for new task
      if (this.focusMode.active) this.renderFocusTask();
      if (this.focusMode.minimized) this.updateMiniWidget();
    }
  }

  completeFocusTask() {
    const task = this.focusMode.taskQueue[this.focusMode.currentIndex];
    if (!task) return;

    this.updateTask(task.id, { status: 'done' });
    this.focusMode.completedCount++;
    this.focusMode.streak++;
    this.focusMode.taskQueue.splice(this.focusMode.currentIndex, 1);

    if (this.focusMode.currentIndex >= this.focusMode.taskQueue.length) {
      this.focusMode.currentIndex = Math.max(0, this.focusMode.taskQueue.length - 1);
    }

    if (this.focusMode.active) {
      this.showCelebration();
    }

    this.updateSessionStats();

    setTimeout(() => {
      if (this.focusMode.taskQueue.length === 0) {
        this.showFocusEmpty();
      } else {
        this.setTimerForCurrentTask(); // Set timer for next task
        if (this.focusMode.active) this.renderFocusTask();
        if (this.focusMode.minimized) this.updateMiniWidget();
      }
    }, 1500);
  }

  showCelebration() {
    const celebration = document.getElementById('focus-celebration');
    const titles = ["Nice work!", "Crushed it!", "Keep going!", "Awesome!", "Boom!"];
    const messages = [
      "Keep the momentum going",
      "You're in the zone",
      "One step closer to your goals",
      "That's how it's done",
      "Unstoppable!"
    ];

    document.getElementById('celebration-title').textContent =
      titles[Math.floor(Math.random() * titles.length)];
    document.getElementById('celebration-message').textContent =
      messages[Math.floor(Math.random() * messages.length)];

    // Create confetti
    this.createConfetti();

    celebration.classList.add('show');
    setTimeout(() => celebration.classList.remove('show'), 1400);
  }

  createConfetti() {
    const container = document.getElementById('confetti-container');
    container.innerHTML = '';
    const colors = ['#f97316', '#22c55e', '#8b5cf6', '#eab308', '#ef4444', '#06b6d4'];

    for (let i = 0; i < 50; i++) {
      const confetti = document.createElement('div');
      confetti.className = 'confetti';
      confetti.style.left = Math.random() * 100 + '%';
      confetti.style.background = colors[Math.floor(Math.random() * colors.length)];
      confetti.style.animationDelay = Math.random() * 0.5 + 's';
      confetti.style.animationDuration = (2 + Math.random()) + 's';
      container.appendChild(confetti);
    }
  }

  skipFocusTask() {
    const task = this.focusMode.taskQueue[this.focusMode.currentIndex];
    if (!task || this.focusMode.taskQueue.length <= 1) return;

    this.focusMode.taskQueue.splice(this.focusMode.currentIndex, 1);
    this.focusMode.taskQueue.push(task);

    if (this.focusMode.currentIndex >= this.focusMode.taskQueue.length) {
      this.focusMode.currentIndex = 0;
    }

    this.setTimerForCurrentTask(); // Set timer for new current task
    if (this.focusMode.active) this.renderFocusTask();
    if (this.focusMode.minimized) this.updateMiniWidget();
  }

  toggleFocusTimer() {
    const timerRing = document.getElementById('focus-timer-ring');
    const timerBtn = document.getElementById('focus-timer-toggle');
    const focusModeEl = document.getElementById('focus-mode');

    if (this.focusMode.timerRunning) {
      clearInterval(this.focusMode.timerInterval);
      this.focusMode.timerInterval = null;
      this.focusMode.timerRunning = false;
      if (timerRing) timerRing.classList.remove('running');
      if (timerBtn) timerBtn.classList.remove('running');
    } else {
      this.focusMode.timerRunning = true;
      if (timerRing) timerRing.classList.add('running');
      if (timerBtn) timerBtn.classList.add('running');

      this.focusMode.timerInterval = setInterval(() => {
        this.focusMode.timerSeconds--;

        if (this.focusMode.timerSeconds <= 0) {
          if (!this.focusMode.isBreak) {
            this.focusMode.pomodoroCount++;
            this.updateSessionStats();
          }
          this.focusMode.isBreak = !this.focusMode.isBreak;
          this.focusMode.timerSeconds = this.focusMode.isBreak ?
            this.focusMode.breakDuration : this.focusMode.workDuration;

          if (timerRing) timerRing.classList.toggle('break', this.focusMode.isBreak);
          if (timerBtn) timerBtn.classList.toggle('break', this.focusMode.isBreak);
          if (focusModeEl) focusModeEl.classList.toggle('break', this.focusMode.isBreak);
        }

        this.updateTimerDisplay();
        if (this.focusMode.minimized) this.updateMiniTimerDisplay();
      }, 1000);
    }

    this.updateTimerDisplay();
    if (this.focusMode.minimized) {
      this.updateMiniTimerDisplay();
      this.updateNativePill();
    }
  }

  updateTimerDisplay() {
    const timerRing = document.getElementById('focus-timer-ring');
    const displayEl = document.getElementById('focus-timer-display');
    const labelEl = document.getElementById('focus-timer-label');
    const progressEl = document.getElementById('focus-timer-progress');

    if (!displayEl || !labelEl) return;

    const minutes = Math.floor(this.focusMode.timerSeconds / 60);
    const seconds = this.focusMode.timerSeconds % 60;
    displayEl.textContent = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    labelEl.textContent = this.focusMode.isBreak ? 'BREAK' : 'FOCUS';

    const totalSeconds = this.focusMode.isBreak ?
      this.focusMode.breakDuration : this.focusMode.workDuration;
    const progress = this.focusMode.timerSeconds / totalSeconds;
    const circumference = 2 * Math.PI * 45;
    if (progressEl) {
      progressEl.style.strokeDashoffset = circumference * (1 - progress);
    }

    if (timerRing) {
      timerRing.classList.toggle('break', this.focusMode.isBreak);
      timerRing.classList.toggle('running', this.focusMode.timerRunning);
    }
  }

  toggleSettingsPanel(open = null) {
    const panel = document.getElementById('focus-settings-panel');
    this.focusMode.settingsPanelOpen = open !== null ? open : !this.focusMode.settingsPanelOpen;
    panel.classList.toggle('open', this.focusMode.settingsPanelOpen);

    document.getElementById('focus-work-duration').textContent = this.focusMode.workDuration / 60;
    document.getElementById('focus-break-duration').textContent = this.focusMode.breakDuration / 60;
    document.getElementById('focus-auto-start').checked = this.focusMode.autoStart;
    document.getElementById('focus-sounds').checked = this.focusMode.soundEnabled;
  }

  handleTimerSetting(action) {
    switch (action) {
      case 'work-plus':
        this.focusMode.workDuration = Math.min(60 * 60, this.focusMode.workDuration + 5 * 60);
        break;
      case 'work-minus':
        this.focusMode.workDuration = Math.max(5 * 60, this.focusMode.workDuration - 5 * 60);
        break;
      case 'break-plus':
        this.focusMode.breakDuration = Math.min(30 * 60, this.focusMode.breakDuration + 1 * 60);
        break;
      case 'break-minus':
        this.focusMode.breakDuration = Math.max(1 * 60, this.focusMode.breakDuration - 1 * 60);
        break;
    }

    if (!this.focusMode.timerRunning) {
      this.focusMode.timerSeconds = this.focusMode.isBreak ?
        this.focusMode.breakDuration : this.focusMode.workDuration;
      this.updateTimerDisplay();
    }

    document.getElementById('focus-work-duration').textContent = this.focusMode.workDuration / 60;
    document.getElementById('focus-break-duration').textContent = this.focusMode.breakDuration / 60;
  }

  // AI Copilot Methods
  resetAIChat() {
    const chat = document.getElementById('ai-chat');
    if (chat) {
      chat.innerHTML = `
        <div class="ai-message ai-welcome">
          <p>I'm here to help you focus. What can I assist with?</p>
        </div>
      `;
    }
    this.focusMode.aiMessages = [];
  }

  updateAIContext(task) {
    const statusEl = document.getElementById('ai-status');
    if (statusEl) {
      statusEl.textContent = `Helping with: ${task.name.substring(0, 25)}${task.name.length > 25 ? '...' : ''}`;
    }
  }

  handleAISuggestion(promptType) {
    const task = this.focusMode.taskQueue[this.focusMode.currentIndex];
    if (!task) return;

    const prompts = {
      'break-down': 'Break down this task into smaller steps',
      'stuck': 'I\'m feeling stuck on this task',
      'motivate': 'Give me motivation to complete this',
      'estimate': 'How long might this take?'
    };

    this.addAIMessage(prompts[promptType] || promptType, 'user');
    this.generateAIResponse(promptType, task);
  }

  sendAIMessage() {
    const input = document.getElementById('ai-input');
    const message = input.value.trim();
    if (!message) return;

    input.value = '';
    this.addAIMessage(message, 'user');

    const task = this.focusMode.taskQueue[this.focusMode.currentIndex];
    this.generateAIResponse('custom', task, message);
  }

  addAIMessage(text, type) {
    const chat = document.getElementById('ai-chat');
    const messageEl = document.createElement('div');
    messageEl.className = `ai-message ${type === 'user' ? 'user-message' : 'ai-response'}`;
    messageEl.innerHTML = `<p>${text}</p>`;
    chat.appendChild(messageEl);
    chat.scrollTop = chat.scrollHeight;
  }

  generateAIResponse(promptType, task, customMessage = '') {
    const chat = document.getElementById('ai-chat');

    // Show typing indicator
    const typingEl = document.createElement('div');
    typingEl.className = 'ai-typing';
    typingEl.innerHTML = '<span></span><span></span><span></span>';
    chat.appendChild(typingEl);
    chat.scrollTop = chat.scrollHeight;

    setTimeout(() => {
      typingEl.remove();
      let response = '';

      switch (promptType) {
        case 'break-down':
          response = this.generateBreakdownResponse(task);
          break;
        case 'stuck':
          response = this.generateUnstuckResponse(task);
          break;
        case 'motivate':
          response = this.generateMotivationResponse(task);
          break;
        case 'estimate':
          response = this.generateEstimateResponse(task);
          break;
        default:
          response = this.generateCustomResponse(task, customMessage);
      }

      this.addAIMessage(response, 'ai');
    }, 1000 + Math.random() * 500);
  }

  generateBreakdownResponse(task) {
    const taskName = task.name;
    return `Here's how I'd break down <strong>"${taskName}"</strong>:<br><br>
      1. <strong>Clarify the outcome</strong> - What does 'done' look like?<br>
      2. <strong>Identify the first action</strong> - What's the very first thing to do?<br>
      3. <strong>Set a 10-min focus sprint</strong> - Just get started, momentum will follow<br>
      4. <strong>Check your progress</strong> - Adjust as needed<br><br>
      What's your first tiny action?`;
  }

  generateUnstuckResponse(task) {
    const tips = [
      `Sometimes the hardest part is starting. Try this: spend just <strong>2 minutes</strong> on "${task.name}" - that's it. Often you'll want to keep going.`,
      `Feeling stuck? Try changing your environment or taking a 5-minute walk. Fresh perspective can unlock new ideas.`,
      `Break it smaller. What's the <strong>tiniest</strong> possible step? Even opening a document counts.`,
      `Talk it out loud. Explain what you're trying to do as if teaching someone. This often reveals the next step.`
    ];
    return tips[Math.floor(Math.random() * tips.length)];
  }

  generateMotivationResponse(task) {
    const motivations = [
      `You've already started by opening Focus Mode. That's the hardest part! <strong>"${task.name}"</strong> is within reach.`,
      `Think about how good it'll feel when this is done. That's just ${this.focusMode.workDuration / 60} minutes of focused work away.`,
      `You've got this. Every task completed builds momentum. Let's make "${task.name}" the next win! 💪`,
      `Remember why this matters. Small progress compounds into big results. One task at a time!`
    ];
    return motivations[Math.floor(Math.random() * motivations.length)];
  }

  generateEstimateResponse(task) {
    const priority = task.priority;
    const hasDesc = task.description && task.description.length > 30;
    let estimate = '15-25 min';
    let tip = '';

    if (priority === 'urgent' || priority === 'high') {
      estimate = hasDesc ? '45-75 min' : '30-45 min';
      tip = 'This seems important. Consider blocking focused time.';
    } else if (priority === 'medium') {
      estimate = hasDesc ? '25-40 min' : '15-25 min';
      tip = 'Should be manageable in one or two pomodoros.';
    } else {
      tip = 'Quick win! Perfect for a single focus session.';
    }

    return `<strong>Estimate:</strong> ${estimate}<br><br>${tip}<br><br>Start the timer and let's find out! ⏱️`;
  }

  generateCustomResponse(task, message) {
    const responses = [
      `Interesting question about "${task.name}". The key is to start small and build momentum.`,
      `That's a great point. For this task, I'd suggest focusing on the most impactful action first.`,
      `I hear you. Sometimes the best approach is to just begin, even imperfectly. Progress beats perfection.`
    ];
    return responses[Math.floor(Math.random() * responses.length)];
  }

  // Command Center Methods

  // Refresh command center components (can be called from any view)
  refreshCommandCenter() {
    // Only refresh if the elements exist (command center view is in DOM)
    if (document.getElementById('cc-focus-queue')) {
      this.updateCommandCenterStats();
      this.renderFocusQueue();
      this.renderDualTrackTimeline();
      this.renderCompletions();
    }
  }

  // ==================== TODAY VIEW (Priority-Based Attack List) ====================

  renderCommandCenter() {
    // Redirect to new Today view
    this.renderTodayView();
  }

  renderTodayView() {
    const today = this.getLocalDateString();
    const allTasks = this.getAllTasks();

    // Auto-roll on first render (once per session)
    if (!this._autoRollDone) {
      this._autoRollDone = true;
      this.autoRollTasks();
    }

    // Render Working On Now section
    this.renderWorkingOnNow();

    // Render Notes section
    this.renderTodayNotes();

    // Get today's tasks (due today or scheduled for today), excluding done
    let todayTasks = allTasks.filter(t =>
      (t.dueDate === today || t.scheduledDate === today) && t.status !== 'done'
    );

    // Get overdue tasks
    let overdueTasks = allTasks.filter(t =>
      t.dueDate && t.dueDate < today && t.status !== 'done'
    );

    // Apply "My Tasks" filter if active
    if (this.todayView.myTasksFilter && this.currentUserId) {
      const uid = this.currentUserId;
      todayTasks = todayTasks.filter(t => t.assignedTo === uid || !t.assignedTo);
      overdueTasks = overdueTasks.filter(t => t.assignedTo === uid || !t.assignedTo);
    }

    // Update toggle button state in DOM
    const toggleAll = document.querySelector('#my-tasks-toggle [data-filter="all"]');
    const toggleMine = document.querySelector('#my-tasks-toggle [data-filter="mine"]');
    if (toggleAll && toggleMine) {
      toggleAll.classList.toggle('active', !this.todayView.myTasksFilter);
      toggleMine.classList.toggle('active', this.todayView.myTasksFilter);
    }

    // Combine and sort by priority (urgent first, then high, medium, low, none)
    const priorityOrder = { urgent: 0, high: 1, medium: 2, low: 3, none: 4 };
    const allActiveTasks = [...overdueTasks, ...todayTasks]
      .filter((t, i, arr) => arr.findIndex(a => a.id === t.id) === i) // dedupe
      .filter(t => !this.todayView.workingOnTaskIds.includes(t.id)) // exclude active tasks
      .sort((a, b) => {
        const pa = priorityOrder[a.priority] ?? 4;
        const pb = priorityOrder[b.priority] ?? 4;
        if (pa !== pb) return pa - pb;
        return new Date(a.createdAt) - new Date(b.createdAt);
      });

    // Render flat queue
    this.renderUpNextQueue(allActiveTasks);

    // Show/hide empty state
    const emptyState = document.getElementById('today-empty-state');
    const upNext = document.getElementById('today-up-next');
    const hasWorkingOn = this.todayView.workingOnTaskIds.length > 0;
    if (allActiveTasks.length === 0 && !hasWorkingOn) {
      if (emptyState) emptyState.classList.remove('hidden');
      if (upNext) upNext.classList.add('hidden');
    } else {
      if (emptyState) emptyState.classList.add('hidden');
      if (upNext) upNext.classList.remove('hidden');
    }

    // Bind events
    this.bindTodayViewEvents();
  }

  planMyDay() {
    const today = this.getLocalDateString();
    const allTasks = this.getAllTasks().filter(t => t.status !== 'done');

    const overdue = allTasks.filter(t => t.dueDate && t.dueDate < today);
    const dueToday = allTasks.filter(t => t.dueDate === today);
    const scheduledToday = allTasks.filter(t => t.scheduledDate === today && !dueToday.some(d => d.id === t.id));
    const highPriority = allTasks.filter(t =>
      (t.priority === 'urgent' || t.priority === 'high') &&
      !dueToday.some(d => d.id === t.id) &&
      !overdue.some(d => d.id === t.id) &&
      !scheduledToday.some(d => d.id === t.id)
    );
    const inProgress = allTasks.filter(t =>
      t.status === 'in-progress' &&
      !dueToday.some(d => d.id === t.id) &&
      !overdue.some(d => d.id === t.id) &&
      !highPriority.some(d => d.id === t.id)
    );
    const waiting = allTasks.filter(t => t.status === 'waiting');
    const activeIds = this.todayView.workingOnTaskIds || [];

    // Get project names for context
    const projectLookup = {};
    (this.data.projects || []).forEach(p => {
      (p.tasks || []).forEach(t => { projectLookup[t.id] = p.name; });
    });

    // Get tag names
    const tagLookup = {};
    (this.data.tags || []).forEach(t => { tagLookup[t.id] = t.name; });

    const formatTask = (t) => {
      let s = `- **${t.name}**`;
      s += ` | Priority: ${t.priority} | Type: ${t.executionType || 'manual'}`;
      if (t.assignedTo) s += ` | Assigned: ${t.assignedTo}`;
      if (t.estimatedMinutes) s += ` | Est: ${t.estimatedMinutes}min`;
      if (t.complexity) s += ` | Complexity: ${t.complexity}/5`;
      const proj = projectLookup[t.id];
      if (proj && proj !== 'Inbox') s += ` | Project: ${proj}`;
      const tags = (t.tags || []).map(id => tagLookup[id]).filter(Boolean);
      if (tags.length) s += ` | Tags: ${tags.join(', ')}`;
      s += '\n';

      if (t.description) s += `  Description: ${t.description.slice(0, 200)}\n`;
      if (t.context) s += `  Context: ${t.context.slice(0, 200)}\n`;
      if (t.workNotes) s += `  Work notes: ${t.workNotes.slice(0, 200)}\n`;
      if (t.waitingReason) s += `  Waiting on: ${t.waitingReason}\n`;

      if (t.subtasks?.length > 0) {
        const done = t.subtasks.filter(st => st.status === 'done').length;
        s += `  Subtasks (${done}/${t.subtasks.length} done):\n`;
        t.subtasks.forEach(st => {
          const check = st.status === 'done' ? '[x]' : '[ ]';
          let stLine = `    ${check} ${st.name}`;
          if (st.assignedTo) stLine += ` (${st.assignedTo})`;
          s += stLine + '\n';
        });
      }

      return s;
    };

    let prompt = `# Plan My Day\n\n`;
    prompt += `Today is **${today}**. I have **${allTasks.length} open tasks**. `;
    prompt += `Please analyze everything below and help me have the most productive day possible.\n\n`;

    if (activeIds.length > 0) {
      prompt += `## Currently Active\n`;
      activeIds.forEach(id => {
        const t = this.findTask(id);
        if (t) prompt += formatTask(t);
      });
      prompt += '\n';
    }

    if (overdue.length > 0) {
      prompt += `## OVERDUE (${overdue.length})\n`;
      overdue.forEach(t => prompt += formatTask(t));
      prompt += '\n';
    }

    if (dueToday.length > 0) {
      prompt += `## Due Today (${dueToday.length})\n`;
      dueToday.forEach(t => prompt += formatTask(t));
      prompt += '\n';
    }

    if (scheduledToday.length > 0) {
      prompt += `## Scheduled Today (${scheduledToday.length})\n`;
      scheduledToday.forEach(t => prompt += formatTask(t));
      prompt += '\n';
    }

    if (highPriority.length > 0) {
      prompt += `## High/Urgent Priority (${highPriority.length})\n`;
      highPriority.forEach(t => prompt += formatTask(t));
      prompt += '\n';
    }

    if (inProgress.length > 0) {
      prompt += `## In Progress (${inProgress.length})\n`;
      inProgress.forEach(t => prompt += formatTask(t));
      prompt += '\n';
    }

    if (waiting.length > 0) {
      prompt += `## Waiting/Blocked (${waiting.length})\n`;
      waiting.forEach(t => prompt += formatTask(t));
      prompt += '\n';
    }

    // Include remaining tasks summary
    const categorized = new Set([
      ...activeIds,
      ...overdue.map(t => t.id),
      ...dueToday.map(t => t.id),
      ...scheduledToday.map(t => t.id),
      ...highPriority.map(t => t.id),
      ...inProgress.map(t => t.id),
      ...waiting.map(t => t.id),
    ]);
    const other = allTasks.filter(t => !categorized.has(t.id));
    if (other.length > 0) {
      prompt += `## Other Open Tasks (${other.length})\n`;
      other.forEach(t => prompt += formatTask(t));
      prompt += '\n';
    }

    prompt += `---\n\n`;
    prompt += `## Your Role\n\n`;
    prompt += `You are my Chief of Staff — a sharp, proactive executive partner. You see the full picture, think strategically, and drive results. Don't just organize my list — lead my day. Be ambitious about what we can accomplish together but targeted in your recommendations.\n\n`;

    prompt += `## Step 1: Ask Me Questions First\n\n`;
    prompt += `Before making your plan, ask me:\n`;
    prompt += `- What are my biggest goals this week? What outcome matters most today?\n`;
    prompt += `- Are there any hard deadlines, meetings, or commitments I haven't captured?\n`;
    prompt += `- Any tasks I'm dreading or avoiding? (Those often need to go first)\n`;
    prompt += `- How much energy do I have today — full throttle or need an easier day?\n`;
    prompt += `- Anything from yesterday that's still on my mind?\n\n`;
    prompt += `Wait for my answers before proceeding to Step 2.\n\n`;

    prompt += `## Step 2: Build the Plan\n\n`;
    prompt += `After I respond, create a targeted day plan:\n\n`;

    prompt += `**Divide and Conquer** — Split everything into two tracks:\n`;
    prompt += `- **What I (Vin) should focus on**: The high-leverage tasks only I can do — decisions, calls, creative work, reviews, anything requiring human judgment. Sequence them smartly (hardest when energy is high, admin when it dips).\n`;
    prompt += `- **What you (Claude) will handle**: Everything you can run with autonomously — research, drafting, analysis, code generation, summarizing, organizing. Be aggressive here — take as much off my plate as possible.\n`;
    prompt += `- **Collaborative**: Tasks we should do together in real-time.\n\n`;

    prompt += `**Break Down the Unclear**: Any task that's vague, too big, or missing subtasks — decompose it into clear, concrete next actions. Use \`create_subtasks\` to make each one a specific deliverable, not a wish.\n\n`;

    prompt += `**Set the Pace**: Add time estimates to anything missing them. Be realistic but don't pad — we move fast.\n\n`;

    prompt += `**Call Out What to Skip**: Not everything needs to happen today. Be honest about what should be deferred, delegated, or dropped entirely. Don't let busywork crowd out important work.\n\n`;

    prompt += `**Flag Dependencies & Blockers**: If something is stuck, say so. If a task unlocks three others, prioritize it. Think in terms of cascading impact.\n\n`;

    prompt += `## Step 3: Take Action\n\n`;
    prompt += `Don't just plan — set it up. Use the MCP tools to:\n`;
    prompt += `- \`update_task\` — set priorities, assignedTo (claude/vin), executionType (ai/manual/hybrid), estimates\n`;
    prompt += `- \`create_subtasks\` — break down complex tasks into actionable steps\n\n`;

    prompt += `## Step 4: Queue Your Work\n\n`;
    prompt += `After updating the tasks, use the \`sync_claude_queue\` tool to write all Claude-assigned tasks into the queue file. Do NOT start executing them yet — I'll review the queue and run it when I'm ready. The queue is my launchpad, not an auto-pilot.\n\n`;
    prompt += `Tell me when the queue is ready so I can review it and hit "Run Queue" to kick things off.\n\n`;

    prompt += `Be bold. Be specific. Drive output. Let's have a great day.`;

    window.api.copyToClipboard(prompt);

    const btn = document.getElementById('plan-my-day-btn');
    if (btn) {
      btn.textContent = 'Copied!';
      btn.classList.add('copied');
      setTimeout(() => {
        btn.textContent = 'Plan My Day';
        btn.classList.remove('copied');
      }, 2000);
    }

    this.showToast('Prompt copied — paste into Claude Desktop', 3000);
  }

  autoRollTasks() {
    const today = this.getLocalDateString();
    const allTasks = this.getAllTasks();
    let rolledCount = 0;

    allTasks.forEach(t => {
      if (t.status === 'done') return;
      const isOldScheduled = t.scheduledDate && t.scheduledDate < today;
      const isOldDue = t.dueDate && t.dueDate < today;
      if (isOldScheduled || isOldDue) {
        if (isOldScheduled) {
          t.scheduledDate = today;
          t.scheduledTime = null; // clear stale time
          t.snoozeCount = (t.snoozeCount || 0) + 1;
        }
        if (isOldDue) {
          t.dueDate = today;
        }
        rolledCount++;
      }
    });

    if (rolledCount > 0) {
      this.saveData();
      const banner = document.getElementById('today-roll-banner');
      const bannerText = document.getElementById('roll-banner-text');
      if (banner && bannerText) {
        bannerText.textContent = `${rolledCount} task${rolledCount > 1 ? 's' : ''} rolled forward from yesterday`;
        banner.classList.remove('hidden');
      }
    }
  }

  renderUpNextQueue(tasks) {
    const container = document.getElementById('up-next-tasks');
    if (!container) return;

    if (tasks.length === 0) {
      container.innerHTML = '';
      return;
    }

    const today = this.getLocalDateString();
    container.innerHTML = tasks.map((task, index) => {
      const project = this.data.projects.find(p => p.tasks.some(t => t.id === task.id));
      const projectName = project && !project.isInbox ? project.name : '';
      const isOverdue = task.dueDate && task.dueDate < today;
      const duration = task.estimatedMinutes || 30;
      const subtaskCount = task.subtasks?.length || 0;
      const subtasksDone = task.subtasks?.filter(s => s.status === 'done').length || 0;
      const isExpanded = this.todayView.expandedUpNextIds.has(task.id);
      const priorityDot = {
        urgent: '<span class="priority-dot priority-dot-urgent"></span>',
        high: '<span class="priority-dot priority-dot-high"></span>',
        medium: '<span class="priority-dot priority-dot-medium"></span>',
        low: '<span class="priority-dot priority-dot-low"></span>',
        none: ''
      }[task.priority || 'none'];

      const subtaskDropdown = subtaskCount > 0 ? `
        <div class="up-next-subtasks ${isExpanded ? 'expanded' : ''}" data-task-id="${task.id}">
          ${task.subtasks.map(st => `
            <label class="working-now-subtask ${st.status === 'done' ? 'done' : ''}">
              <input type="checkbox" ${st.status === 'done' ? 'checked' : ''} data-task-id="${task.id}" data-subtask-id="${st.id}" class="up-next-subtask-check" />
              <span class="working-now-subtask-name">${this.escapeHtml(st.name)}</span>
            </label>
          `).join('')}
        </div>
      ` : '';

      const execType = task.executionType || 'manual';
      const execBadge = execType !== 'manual' ? `<span class="exec-badge exec-badge-${execType}">${execType === 'ai' ? 'Claude' : 'Hybrid'}</span>` : '';

      return `
        <div class="today-task-item exec-${execType} ${isOverdue ? 'overdue' : ''}" data-task-id="${task.id}" draggable="true">
          <button class="today-task-check" data-task-id="${task.id}" title="Complete">
            <span class="check-icon"></span>
          </button>
          ${priorityDot}
          <div class="today-task-content">
            <div class="today-task-name">${this.escapeHtml(task.name)}${execBadge}</div>
            <div class="today-task-meta">
              ${projectName ? `<span class="today-task-project">${this.escapeHtml(projectName)}</span>` : ''}
              ${isOverdue ? `<span class="today-task-overdue">Overdue</span>` : ''}
              <span class="today-task-duration">${duration}m</span>
              ${subtaskCount > 0 ? `<span class="today-task-subtasks">${subtasksDone}/${subtaskCount}</span>` : ''}
            </div>
          </div>
          <div class="today-task-actions">
            ${subtaskCount > 0 ? `<button class="up-next-subtask-toggle ${isExpanded ? 'expanded' : ''}" data-task-id="${task.id}" title="Toggle subtasks">&#9660;</button>` : ''}
            <button class="today-task-focus" data-task-id="${task.id}" title="Add to active">
              <span>&#9678;</span>
            </button>
          </div>
        </div>
        ${subtaskDropdown}
      `;
    }).join('');
  }

  renderWorkingOnNow() {
    this.renderActiveTasks();
  }

  renderActiveTasks() {
    const container = document.getElementById('working-now-task');
    const section = document.getElementById('today-working-now');
    if (!container) return;

    // Clean up: remove completed/deleted tasks from active list
    const allTasks = this.getAllTasks();
    const validIds = this.todayView.workingOnTaskIds.filter(id => {
      const task = allTasks.find(t => t.id === id);
      return task && task.status !== 'done';
    });
    if (validIds.length !== this.todayView.workingOnTaskIds.length) {
      this.todayView.workingOnTaskIds = validIds;
      this.data.workingOnTaskIds = [...validIds];
      this.saveData();
    }

    const notesSection = document.getElementById('working-now-notes');
    const notesInput = document.getElementById('working-now-notes-input');

    if (this.todayView.workingOnTaskIds.length === 0) {
      section?.classList.remove('has-task');
      container.innerHTML = `<span class="working-now-empty">Drag a task here or click its focus button</span>`;
      if (notesSection) notesSection.classList.add('hidden');
      return;
    }

    section?.classList.add('has-task');

    // Render each active task as a compact card
    container.innerHTML = this.todayView.workingOnTaskIds.map(taskId => {
      const task = allTasks.find(t => t.id === taskId);
      if (!task) return '';

      const project = this.data.projects.find(p => p.tasks.some(t => t.id === task.id));
      const projectName = project && !project.isInbox ? project.name : '';
      const duration = task.estimatedMinutes || 30;
      const subtaskCount = task.subtasks?.length || 0;
      const subtasksDone = task.subtasks?.filter(s => s.status === 'done').length || 0;

      const subtasksHtml = subtaskCount > 0 ? `
        <div class="active-card-subtask-list">
          ${task.subtasks.map(st => `
            <label class="working-now-subtask ${st.status === 'done' ? 'done' : ''}" data-subtask-id="${st.id}">
              <input type="checkbox" ${st.status === 'done' ? 'checked' : ''} data-task-id="${task.id}" data-subtask-id="${st.id}" class="active-card-subtask-check" />
              <span class="working-now-subtask-name">${this.escapeHtml(st.name)}</span>
            </label>
          `).join('')}
        </div>
      ` : '';

      const execType = task.executionType || 'manual';
      const execBadge = execType !== 'manual' ? `<span class="exec-badge exec-badge-${execType}">${execType === 'ai' ? 'Claude' : 'Hybrid'}</span>` : '';

      return `
        <div class="active-task-card exec-${execType}" data-task-id="${task.id}">
          <div class="active-card-header">
            <div class="active-card-info" data-task-id="${task.id}">
              <div class="active-card-name">${this.escapeHtml(task.name)}${execBadge}</div>
              <div class="active-card-meta">
                ${projectName ? `<span class="working-now-project">${this.escapeHtml(projectName)}</span>` : ''}
                <span class="working-now-duration">${duration}m</span>
                ${subtaskCount > 0 ? `<span class="working-now-subtasks">${subtasksDone}/${subtaskCount} subtasks</span>` : ''}
              </div>
            </div>
            <div class="active-card-actions">
              <button class="btn btn-success btn-small active-card-complete" data-task-id="${task.id}" title="Complete">&#10003;</button>
              <button class="active-card-remove" data-task-id="${task.id}" title="Remove from active">&times;</button>
            </div>
          </div>
          ${subtasksHtml}
        </div>
      `;
    }).join('');

    // Show notes for the first active task
    const firstTask = allTasks.find(t => t.id === this.todayView.workingOnTaskIds[0]);
    if (notesSection && firstTask) {
      notesSection.classList.remove('hidden');
      if (notesInput) notesInput.value = firstTask.workNotes || '';
    } else if (notesSection) {
      notesSection.classList.add('hidden');
    }
  }


  renderTodayNotes() {
    // Load daily notes (for recaps)
    const dailyInput = document.getElementById('today-daily-notes-input');
    if (dailyInput) {
      const today = this.getLocalDateString();
      dailyInput.value = this.data.dailyNotes?.[today] || '';
    }
  }

  // renderQuickCaptures() removed — brain dumps live in Inbox triage view

  // ── Inbox Triage View ──────────────────────────────────────────

  getRelativeTime(isoDate) {
    if (!isoDate) return '';
    const now = Date.now();
    const then = new Date(isoDate).getTime();
    const diffMs = now - then;
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 1) return 'just now';
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHr = Math.floor(diffMin / 60);
    if (diffHr < 24) return `${diffHr}h ago`;
    const diffDay = Math.floor(diffHr / 24);
    if (diffDay === 1) return 'yesterday';
    if (diffDay < 30) return `${diffDay}d ago`;
    const diffMonth = Math.floor(diffDay / 30);
    return `${diffMonth}mo ago`;
  }

  moveTaskToProject(taskId, targetProjectId) {
    let task = null;
    let sourceProject = null;
    for (const project of this.data.projects) {
      const idx = project.tasks.findIndex(t => t.id === taskId);
      if (idx !== -1) {
        task = project.tasks.splice(idx, 1)[0];
        sourceProject = project;
        break;
      }
    }
    if (!task) return false;
    const target = this.data.projects.find(p => p.id === targetProjectId);
    if (!target) {
      // Put it back if target not found
      sourceProject.tasks.push(task);
      return false;
    }
    target.tasks.push(task);
    this.saveData();
    return true;
  }

  renderInbox() {
    const container = document.getElementById('tasks-container');
    if (!container) return;

    const inbox = this.data.projects.find(p => p.isInbox || p.id === 'inbox');
    const tasks = inbox ? inbox.tasks.filter(t => t.status !== 'done') : [];

    // Sort newest first
    tasks.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    const projects = this.data.projects.filter(p => !p.isInbox);
    const today = this.getLocalDateString();
    const tomorrow = (() => { const d = new Date(); d.setDate(d.getDate() + 1); return d.toISOString().split('T')[0]; })();
    const nextWeek = (() => { const d = new Date(); d.setDate(d.getDate() + 7); return d.toISOString().split('T')[0]; })();

    if (tasks.length === 0) {
      container.innerHTML = `
        <div class="inbox-triage-empty">
          <div class="inbox-triage-empty-icon">&#10024;</div>
          <p class="inbox-triage-empty-title">Inbox zero</p>
          <p class="inbox-triage-empty-subtitle">Nothing to process — nice work!</p>
        </div>
      `;
      return;
    }

    container.innerHTML = `
      <div class="inbox-triage-header">
        <span class="inbox-triage-count">${tasks.length} item${tasks.length !== 1 ? 's' : ''} to process</span>
        <button class="btn btn-small btn-plan-day" id="process-inbox-btn" title="Copy inbox processing prompt for Claude">Process with Claude</button>
      </div>
      <div class="inbox-triage-list">
        ${tasks.map(task => `
          <div class="inbox-triage-item" data-task-id="${task.id}">
            <div class="inbox-triage-top">
              <span class="inbox-triage-name" data-task-id="${task.id}">${this.escapeHtml(task.name)}</span>
              <span class="inbox-triage-age">${this.getRelativeTime(task.createdAt)}</span>
            </div>
            ${task.context ? `<div class="inbox-triage-context">${this.escapeHtml(task.context.substring(0, 120))}${task.context.length > 120 ? '...' : ''}</div>` : ''}
            <div class="inbox-triage-actions">
              <button class="inbox-triage-btn inbox-triage-btn-today" data-task-id="${task.id}" title="Schedule for today">Today</button>
              <select class="inbox-triage-dropdown inbox-triage-schedule" data-task-id="${task.id}" title="Schedule">
                <option value="">Schedule</option>
                <option value="${tomorrow}">Tomorrow</option>
                <option value="${nextWeek}">Next Week</option>
                <option value="pick">Pick Date...</option>
                <option value="none">Leave Unscheduled</option>
              </select>
              <select class="inbox-triage-dropdown inbox-triage-priority" data-task-id="${task.id}" title="Priority">
                <option value="">${task.priority && task.priority !== 'none' ? task.priority.charAt(0).toUpperCase() + task.priority.slice(1) : 'Priority'}</option>
                <option value="urgent">Urgent</option>
                <option value="high">High</option>
                <option value="medium">Medium</option>
                <option value="low">Low</option>
                <option value="none">None</option>
              </select>
              <select class="inbox-triage-dropdown inbox-triage-project" data-task-id="${task.id}" title="Move to project">
                <option value="">Project</option>
                ${projects.map(p => `<option value="${p.id}">${this.escapeHtml(p.name)}</option>`).join('')}
              </select>
              <button class="inbox-triage-btn inbox-triage-btn-delete" data-task-id="${task.id}" title="Delete">&#128465;</button>
            </div>
          </div>
        `).join('')}
      </div>
    `;

    this.bindInboxEvents();
  }

  bindInboxEvents() {
    const today = this.getLocalDateString();

    // Process with Claude button
    const processBtn = document.getElementById('process-inbox-btn');
    if (processBtn) {
      processBtn.onclick = () => this.processInboxPrompt();
    }

    // Click task name → open detail panel
    document.querySelectorAll('.inbox-triage-name').forEach(el => {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        this.openDetailPanel(el.dataset.taskId);
      });
    });

    // "Today" button
    document.querySelectorAll('.inbox-triage-btn-today').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const taskId = btn.dataset.taskId;
        const task = this.findTask(taskId);
        const oldDueDate = task ? task.dueDate : null;
        this.pushUndo('schedule to Today', () => {
          const t = this.findTask(taskId);
          if (t) t.dueDate = oldDueDate;
        });
        this.updateTask(taskId, { dueDate: today });
        this.showToast('Moved to Today');
        this.renderInbox();
      });
    });

    // Schedule dropdown
    document.querySelectorAll('.inbox-triage-schedule').forEach(sel => {
      sel.addEventListener('change', (e) => {
        e.stopPropagation();
        const taskId = sel.dataset.taskId;
        const value = sel.value;
        if (!value) return;
        if (value === 'none') {
          // Leave unscheduled — clear any existing date
          const task = this.findTask(taskId);
          const oldDueDate = task ? task.dueDate : null;
          this.pushUndo('clear schedule', () => {
            const t = this.findTask(taskId);
            if (t) t.dueDate = oldDueDate;
          });
          this.updateTask(taskId, { dueDate: null, scheduledDate: null });
          this.showToast('Left unscheduled');
          this.renderInbox();
          return;
        }
        if (value === 'pick') {
          const dateInput = document.createElement('input');
          dateInput.type = 'date';
          dateInput.style.position = 'absolute';
          dateInput.style.opacity = '0';
          dateInput.style.pointerEvents = 'none';
          document.body.appendChild(dateInput);
          dateInput.addEventListener('change', () => {
            if (dateInput.value) {
              const task = this.findTask(taskId);
              const oldDueDate = task ? task.dueDate : null;
              this.pushUndo('schedule task', () => {
                const t = this.findTask(taskId);
                if (t) t.dueDate = oldDueDate;
              });
              this.updateTask(taskId, { dueDate: dateInput.value });
              this.showToast(`Scheduled for ${dateInput.value}`);
              this.renderInbox();
            }
            dateInput.remove();
          });
          dateInput.addEventListener('blur', () => {
            setTimeout(() => dateInput.remove(), 200);
          });
          dateInput.showPicker();
          return;
        }
        const task = this.findTask(taskId);
        const oldDueDate = task ? task.dueDate : null;
        this.pushUndo('schedule task', () => {
          const t = this.findTask(taskId);
          if (t) t.dueDate = oldDueDate;
        });
        this.updateTask(taskId, { dueDate: value });
        this.showToast('Task scheduled');
        this.renderInbox();
      });
    });

    // Priority dropdown
    document.querySelectorAll('.inbox-triage-priority').forEach(sel => {
      sel.addEventListener('change', (e) => {
        e.stopPropagation();
        const taskId = sel.dataset.taskId;
        if (sel.value) {
          const task = this.findTask(taskId);
          const oldPriority = task ? task.priority : 'none';
          this.pushUndo('change priority', () => {
            const t = this.findTask(taskId);
            if (t) t.priority = oldPriority;
          });
          this.updateTask(taskId, { priority: sel.value });
          this.showToast(`Priority set to ${sel.value}`);
          this.renderInbox();
        }
      });
    });

    // Project dropdown
    document.querySelectorAll('.inbox-triage-project').forEach(sel => {
      sel.addEventListener('change', (e) => {
        e.stopPropagation();
        const taskId = sel.dataset.taskId;
        if (sel.value) {
          const inbox = this.data.projects.find(p => p.isInbox || p.id === 'inbox');
          const inboxId = inbox ? inbox.id : null;
          const project = this.data.projects.find(p => p.id === sel.value);
          this.pushUndo(`move to ${project ? project.name : 'project'}`, () => {
            if (inboxId) this.moveTaskToProject(taskId, inboxId);
          });
          this.moveTaskToProject(taskId, sel.value);
          this.showToast(`Moved to ${project ? project.name : 'project'}`);
          this.renderInbox();
        }
      });
    });

    // Delete button
    document.querySelectorAll('.inbox-triage-btn-delete').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const taskId = btn.dataset.taskId;
        const task = this.findTask(taskId);
        if (confirm(`Delete "${task ? task.name : 'this task'}"?`)) {
          // Snapshot the task for undo
          const taskCopy = JSON.parse(JSON.stringify(task));
          const inbox = this.data.projects.find(p => p.isInbox || p.id === 'inbox');
          const inboxId = inbox ? inbox.id : null;
          this.pushUndo('delete task', () => {
            if (inboxId) {
              const target = this.data.projects.find(p => p.id === inboxId);
              if (target) target.tasks.push(taskCopy);
            }
          });
          this.deleteTask(taskId);
          this.showToast('Task deleted');
          this.renderInbox();
        }
      });
    });
  }

  processInboxPrompt() {
    const inbox = this.data.projects.find(p => p.isInbox || p.id === 'inbox');
    const tasks = inbox ? inbox.tasks.filter(t => t.status !== 'done') : [];

    if (tasks.length === 0) {
      this.showToast('Inbox is empty');
      return;
    }

    // Get project names and tags for context
    const projects = this.data.projects.filter(p => !p.isInbox);
    const tagLookup = {};
    (this.data.tags || []).forEach(t => { tagLookup[t.id] = t.name; });

    const formatTask = (t, i) => {
      let s = `${i + 1}. **${t.name}**\n`;
      if (t.description) s += `   Description: ${t.description.slice(0, 300)}\n`;
      if (t.context) s += `   Brain dump: ${t.context.slice(0, 500)}\n`;
      const tags = (t.tags || []).map(id => tagLookup[id]).filter(Boolean);
      if (tags.length) s += `   Tags: ${tags.join(', ')}\n`;
      if (t.priority && t.priority !== 'none') s += `   Current priority: ${t.priority}\n`;
      if (t.subtasks?.length > 0) {
        s += `   Subtasks: ${t.subtasks.map(st => st.name).join(', ')}\n`;
      }
      s += `   Added: ${this.getRelativeTime(t.createdAt)}\n`;
      return s;
    };

    let prompt = `# Process My Inbox\n\n`;
    prompt += `I have **${tasks.length} unprocessed items** in my inbox. `;
    prompt += `Please help me triage and organize them so nothing falls through the cracks.\n\n`;

    prompt += `## Inbox Items\n\n`;
    tasks.forEach((t, i) => { prompt += formatTask(t, i) + '\n'; });

    prompt += `## Available Projects\n\n`;
    if (projects.length > 0) {
      projects.forEach(p => { prompt += `- **${p.name}**${p.description ? ` — ${p.description.slice(0, 100)}` : ''}\n`; });
    } else {
      prompt += `(No projects yet — suggest creating some if it makes sense)\n`;
    }

    prompt += `\n---\n\n`;

    prompt += `## Your Role\n\n`;
    prompt += `You are my inbox processor. Your job is to turn this raw pile into organized, actionable work. Be decisive — don't leave things vague.\n\n`;

    prompt += `## Step 1: Quick Assessment\n\n`;
    prompt += `For each item, tell me:\n`;
    prompt += `- **What it actually is**: A clear one-line restatement (the name might be rough)\n`;
    prompt += `- **Priority**: urgent / high / medium / low — based on deadlines, impact, and dependencies\n`;
    prompt += `- **Type**: ai (Claude can do it alone), manual (I have to do it), or hybrid (we work together)\n`;
    prompt += `- **Project**: Which existing project it belongs to, or suggest a new one\n`;
    prompt += `- **Next action**: What's the concrete first step?\n`;
    prompt += `- **Needs breakdown?**: If it's big or vague, flag it for subtask creation\n\n`;

    prompt += `## Step 2: Ask Me About Ambiguous Items\n\n`;
    prompt += `If any items are unclear, group your questions. Don't guess — ask. For example:\n`;
    prompt += `- "Item 3 says 'handle the thing' — what thing? Is this urgent?"\n`;
    prompt += `- "Items 5 and 8 seem related — should they be one task?"\n\n`;
    prompt += `Wait for my answers before proceeding to Step 3.\n\n`;

    prompt += `## Step 3: Take Action\n\n`;
    prompt += `Once we've clarified everything, use the MCP tools to:\n\n`;
    prompt += `1. **\`update_task\`** — Set priority, executionType (ai/manual/hybrid), assignedTo (claude/vin), estimatedMinutes, clean up names/descriptions\n`;
    prompt += `2. **\`move_task_to_project\`** — Move each task to the right project (use \`get_projects\` first to see available project IDs)\n`;
    prompt += `3. **\`create_subtasks\`** — Break down any complex items into concrete next actions\n`;
    prompt += `4. **\`update_task\` with scheduledDate** — Anything that needs to happen today or tomorrow, set scheduledDate (YYYY-MM-DD format)\n`;
    prompt += `5. **Identify quick wins** — Flag anything that takes <5 minutes so I can knock it out fast\n\n`;

    prompt += `## Guidelines\n\n`;
    prompt += `- **Rename vague tasks**: "Do the thing" → "Draft Q1 budget proposal for marketing team"\n`;
    prompt += `- **Merge duplicates**: If two items are the same work, combine them\n`;
    prompt += `- **Split monsters**: If one item is really 3+ tasks, break it apart\n`;
    prompt += `- **Kill dead weight**: If something is clearly outdated or irrelevant, recommend deleting it\n`;
    prompt += `- **Brain dumps → tasks**: If an item has rich context/brain dump, extract the actual tasks from it\n\n`;

    prompt += `Be thorough but fast. Let's clear this inbox.`;

    window.api.copyToClipboard(prompt);

    const btn = document.getElementById('process-inbox-btn');
    if (btn) {
      btn.textContent = 'Copied!';
      btn.classList.add('copied');
      setTimeout(() => {
        btn.textContent = 'Process with Claude';
        btn.classList.remove('copied');
      }, 2000);
    }

    this.showToast('Inbox prompt copied — paste into Claude');
  }

  impactReviewPrompt() {
    const allTasks = this.getAllTasks().filter(t => t.status !== 'done');

    if (allTasks.length === 0) {
      this.showToast('No active tasks to review');
      return;
    }

    // Build project lookup and tag lookup
    const projectLookup = {};
    (this.data.projects || []).forEach(p => {
      (p.tasks || []).forEach(t => { projectLookup[t.id] = p.name; });
    });
    const tagLookup = {};
    (this.data.tags || []).forEach(t => { tagLookup[t.id] = t.name; });

    // Group tasks by project
    const byProject = {};
    allTasks.forEach(t => {
      const proj = projectLookup[t.id] || 'Inbox';
      if (!byProject[proj]) byProject[proj] = [];
      byProject[proj].push(t);
    });

    const formatTask = (t) => {
      let s = `- **${t.name}**`;
      s += ` | Status: ${t.status} | Priority: ${t.priority || 'none'}`;
      if (t.executionType) s += ` | Type: ${t.executionType}`;
      if (t.assignedTo) s += ` | Assigned: ${t.assignedTo}`;
      if (t.estimatedMinutes) s += ` | Est: ${t.estimatedMinutes}min`;
      if (t.dueDate) s += ` | Due: ${t.dueDate}`;
      const tags = (t.tags || []).map(id => tagLookup[id]).filter(Boolean);
      if (tags.length) s += ` | Tags: ${tags.join(', ')}`;
      s += '\n';
      if (t.description) s += `  Description: ${t.description.slice(0, 250)}\n`;
      if (t.context) s += `  Context: ${t.context.slice(0, 300)}\n`;
      if (t.subtasks?.length > 0) {
        const done = t.subtasks.filter(st => st.status === 'done').length;
        s += `  Subtasks: ${done}/${t.subtasks.length} done\n`;
      }
      return s;
    };

    let prompt = `# Strategic Impact Review\n\n`;
    prompt += `I have **${allTasks.length} active tasks** across ${Object.keys(byProject).length} projects. `;
    prompt += `I need you to be my strategic advisor and help me focus on what truly moves the needle.\n\n`;

    // List tasks grouped by project
    for (const [projName, tasks] of Object.entries(byProject)) {
      prompt += `## ${projName} (${tasks.length} tasks)\n\n`;
      tasks.forEach(t => { prompt += formatTask(t) + '\n'; });
    }

    prompt += `---\n\n`;

    prompt += `## Your Role\n\n`;
    prompt += `You are my Chief of Staff and strategic advisor. You see the full landscape of my work and think like a CEO — ruthlessly focused on impact. Your job is not to help me do more, but to help me do what matters most. Be honest and direct, even if it means telling me to drop things I'm attached to.\n\n`;

    prompt += `## Step 1: Score Every Task on Impact\n\n`;
    prompt += `For each task, assess and present in a clear table:\n\n`;
    prompt += `| Task | Impact | Effort | Risk | Score | Verdict |\n`;
    prompt += `|------|--------|--------|------|-------|---------|\n\n`;
    prompt += `**Impact** (1-5): How much does completing this move the business/life forward?\n`;
    prompt += `- 5 = Game-changing. Unlocks revenue, removes major bottleneck, or creates lasting leverage\n`;
    prompt += `- 4 = Significant. Meaningful progress on a key goal\n`;
    prompt += `- 3 = Moderate. Useful but not transformative\n`;
    prompt += `- 2 = Minor. Nice to have, incremental improvement\n`;
    prompt += `- 1 = Negligible. Busywork, maintenance, or low-stakes\n\n`;

    prompt += `**Effort** (1-5): How much time/energy does this require?\n`;
    prompt += `- 1 = Quick win (<15 min) · 2 = Light (15-60 min) · 3 = Medium (1-3 hrs) · 4 = Heavy (half day+) · 5 = Major (multi-day)\n\n`;

    prompt += `**Risk** (1-5): What's the downside of NOT doing this soon?\n`;
    prompt += `- 5 = Critical deadline, legal/financial consequence, blocking others\n`;
    prompt += `- 3 = Will cause problems eventually, opportunity cost\n`;
    prompt += `- 1 = No real consequence of delay\n\n`;

    prompt += `**Score** = (Impact × 2 + Risk) / Effort — higher is better. This is your prioritization signal.\n\n`;

    prompt += `**Verdict**: One of:\n`;
    prompt += `- **DO NOW** — High impact, can't wait. These are your top priorities.\n`;
    prompt += `- **SCHEDULE** — Important but not urgent. Lock in a date.\n`;
    prompt += `- **DELEGATE TO CLAUDE** — Claude can handle autonomously. Assign it.\n`;
    prompt += `- **DEFER** — Low impact right now. Push to next week or later.\n`;
    prompt += `- **DROP** — Not worth doing. Recommend deleting or archiving.\n`;
    prompt += `- **QUICK WIN** — Low effort, decent impact. Batch these together.\n\n`;

    prompt += `## Step 2: Strategic Insights\n\n`;
    prompt += `After scoring, give me:\n\n`;
    prompt += `1. **Top 5 highest-impact tasks** — These should dominate my week. Explain why each one matters.\n`;
    prompt += `2. **Hidden blockers** — Are any tasks blocking high-impact work? Call out dependency chains.\n`;
    prompt += `3. **Quick win batch** — Group the low-effort/decent-impact items I can knock out in one focused session.\n`;
    prompt += `4. **What to drop** — Be aggressive. What's on this list that shouldn't be? What am I doing out of habit or guilt that isn't actually important?\n`;
    prompt += `5. **What's missing?** — Based on my projects and priorities, is there work I should be doing that's NOT on this list?\n\n`;

    prompt += `## Step 3: Ask Me Before Acting\n\n`;
    prompt += `Present your analysis and recommendations. Ask me:\n`;
    prompt += `- Do I agree with the top 5? Would I reorder anything?\n`;
    prompt += `- Any tasks you recommended dropping that I want to keep? Why?\n`;
    prompt += `- Any context you're missing that would change the scoring?\n\n`;
    prompt += `Wait for my answers before proceeding to Step 4.\n\n`;

    prompt += `## Step 4: Take Action\n\n`;
    prompt += `After I confirm, use the MCP tools to execute the plan:\n\n`;
    prompt += `1. **\`update_task\`** — Set priorities based on impact scores (urgent for DO NOW, high for SCHEDULE, etc.)\n`;
    prompt += `2. **\`update_task\`** — Set executionType and assignedTo for DELEGATE items\n`;
    prompt += `3. **\`update_task\` with scheduledDate** — Schedule the top priorities for today/this week\n`;
    prompt += `4. **\`move_task_to_project\`** — Reorganize any misplaced tasks\n`;
    prompt += `5. **\`create_subtasks\`** — Break down any DO NOW tasks that are too vague to start\n`;
    prompt += `6. Tell me which tasks to delete — I'll confirm the deletions\n\n`;

    prompt += `Think like a CEO. Cut the noise. Focus on leverage. Let's make this week count.`;

    window.api.copyToClipboard(prompt);

    const btn = document.getElementById('impact-review-btn');
    if (btn) {
      btn.textContent = 'Copied!';
      btn.classList.add('copied');
      setTimeout(() => {
        btn.textContent = 'Impact Review';
        btn.classList.remove('copied');
      }, 2000);
    }

    this.showToast('Impact review prompt copied — paste into Claude');
  }

  coachMePrompt() {
    const allTasks = this.getAllTasks();
    const activeTasks = allTasks.filter(t => t.status !== 'done');
    const today = this.getLocalDateString();

    // Recent completions (last 14 days)
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 14);
    const recentCompleted = allTasks
      .filter(t => t.status === 'done' && t.completedAt && new Date(t.completedAt) >= cutoff)
      .sort((a, b) => new Date(b.completedAt) - new Date(a.completedAt));

    // Snoozed tasks
    const snoozed = activeTasks
      .filter(t => (t.snoozeCount || 0) > 0)
      .sort((a, b) => (b.snoozeCount || 0) - (a.snoozeCount || 0));

    // Waiting tasks with reasons
    const waiting = activeTasks.filter(t => t.status === 'waiting');

    // Energy data
    const withEnergy = recentCompleted.filter(t => t.energyRating);
    const energizing = withEnergy.filter(t => t.energyRating === 3);
    const draining = withEnergy.filter(t => t.energyRating === 1);

    // Oldest tasks
    const oldest = activeTasks
      .filter(t => t.createdAt)
      .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))
      .slice(0, 5);

    // Recap entries
    const recentRecaps = (this.data.recapLog || [])
      .filter(r => new Date(r.createdAt) >= cutoff)
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .slice(0, 20);

    // Daily notes
    const dailyNotes = this.data.dailyNotes || {};
    const recentNotes = Object.entries(dailyNotes)
      .filter(([date]) => date >= this.getLocalDateString(cutoff))
      .sort((a, b) => b[0].localeCompare(a[0]))
      .slice(0, 7);

    let prompt = `# Coach Me\n\n`;
    prompt += `Today is **${today}**. I want you to be my work coach. Look at my patterns, not just my task list. Help me work smarter, not just harder.\n\n`;

    prompt += `## My Recent Data\n\n`;

    prompt += `### Completions (last 14 days): ${recentCompleted.length} tasks\n`;
    if (recentCompleted.length > 0) {
      recentCompleted.slice(0, 15).forEach(t => {
        const energy = t.energyRating ? [' ', ' (drained)', ' (neutral)', ' (energized)'][t.energyRating] : '';
        const summary = t.completionSummary ? ` — ${t.completionSummary.slice(0, 80)}` : '';
        prompt += `- ${t.name}${energy}${summary} [${t.completedAt.split('T')[0]}]\n`;
      });
      prompt += '\n';
    }

    if (withEnergy.length > 0) {
      const avg = (withEnergy.reduce((s, t) => s + t.energyRating, 0) / withEnergy.length).toFixed(1);
      prompt += `### Energy Patterns (avg: ${avg}/3)\n`;
      if (energizing.length > 0) prompt += `- Energizing: ${energizing.map(t => t.name).join(', ')}\n`;
      if (draining.length > 0) prompt += `- Draining: ${draining.map(t => t.name).join(', ')}\n`;
      prompt += '\n';
    }

    if (snoozed.length > 0) {
      prompt += `### Frequently Deferred (${snoozed.length} tasks)\n`;
      snoozed.slice(0, 8).forEach(t => {
        prompt += `- **${t.name}** — snoozed ${t.snoozeCount}x, priority: ${t.priority || 'none'}\n`;
      });
      prompt += '\n';
    }

    if (waiting.length > 0) {
      prompt += `### Currently Blocked (${waiting.length} tasks)\n`;
      waiting.forEach(t => {
        prompt += `- **${t.name}** — ${t.waitingReason || 'no reason given'}\n`;
      });
      prompt += '\n';
    }

    if (oldest.length > 0) {
      prompt += `### Oldest Active Tasks\n`;
      oldest.forEach(t => {
        const age = Math.floor((new Date() - new Date(t.createdAt)) / (24 * 60 * 60 * 1000));
        prompt += `- **${t.name}** — ${age} days old\n`;
      });
      prompt += '\n';
    }

    if (recentRecaps.length > 0) {
      prompt += `### My Recent Notes & Reflections\n`;
      recentRecaps.slice(0, 10).forEach(r => {
        prompt += `- [${r.date}] ${r.content.slice(0, 150)}\n`;
      });
      prompt += '\n';
    }

    if (recentNotes.length > 0) {
      prompt += `### Daily Journal Entries\n`;
      recentNotes.forEach(([date, text]) => {
        if (text.trim()) prompt += `- [${date}] ${text.trim().slice(0, 200)}\n`;
      });
      prompt += '\n';
    }

    prompt += `---\n\n`;

    prompt += `## Your Role\n\n`;
    prompt += `You are my personal work coach. You have access to my TaskFlow data via MCP tools — use \`get_work_context\` to get even more detail if needed. You're not here to organize my task list (I have other prompts for that). You're here to help me understand **how I'm working** and **how to improve**.\n\n`;

    prompt += `## What I Want From You\n\n`;

    prompt += `### 1. Pattern Recognition\n`;
    prompt += `Look at the data above and tell me what you notice. Be specific and honest:\n`;
    prompt += `- What am I avoiding? (Look at snooze counts and task ages)\n`;
    prompt += `- What energizes vs drains me? (Look at energy ratings)\n`;
    prompt += `- Where am I stuck? (Look at blockers and waiting tasks)\n`;
    prompt += `- Am I making progress on what matters, or just staying busy?\n`;
    prompt += `- Any concerning patterns? (overcommitting, neglecting projects, always reactive)\n\n`;

    prompt += `### 2. Honest Feedback\n`;
    prompt += `Don't sugarcoat it. If I'm:\n`;
    prompt += `- Avoiding something important, call it out and ask me why\n`;
    prompt += `- Spending energy on low-impact work, flag it\n`;
    prompt += `- Stuck in a pattern that isn't serving me, name it\n`;
    prompt += `- Doing well somewhere, acknowledge it — I need wins too\n\n`;

    prompt += `### 3. Actionable Advice\n`;
    prompt += `Give me 2-3 concrete things I can do differently this week. Not vague "prioritize better" — specific:\n`;
    prompt += `- "Task X has been snoozed 5 times — either do it tomorrow morning first thing, delegate it, or delete it"\n`;
    prompt += `- "Your energizing tasks are all creative work — try front-loading those before 11am"\n`;
    prompt += `- "You have 4 tasks blocked on the same person — schedule one conversation to unblock all of them"\n\n`;

    prompt += `### 4. Questions for Me\n`;
    prompt += `Ask me things that will help you coach better:\n`;
    prompt += `- What's stressing me out most right now?\n`;
    prompt += `- What am I proud of this week?\n`;
    prompt += `- Is there something I keep putting off that I need help thinking through?\n\n`;

    prompt += `Start with your observations, then we'll have a conversation. Be direct, be specific, be helpful.`;

    window.api.copyToClipboard(prompt);

    const btn = document.getElementById('coach-me-btn');
    if (btn) {
      btn.textContent = 'Copied!';
      btn.classList.add('copied');
      setTimeout(() => {
        btn.textContent = 'Coach Me';
        btn.classList.remove('copied');
      }, 2000);
    }

    this.showToast('Coach prompt copied — paste into Claude');
  }

  // ============================================
  // CLAUDE INTEGRATION VIEW
  // ============================================

  renderClaudeView() {
    const container = document.getElementById('claude-view');
    if (!container) return;

    document.getElementById('view-title').textContent = 'Claude';
    document.getElementById('view-subtitle').textContent = 'Integration Hub';

    const stats = this.getClaudeContextStats();
    const sessions = this.data.claudeSessions || [];
    const recentSessions = sessions.slice(-5).reverse();

    container.innerHTML = `
      <div class="claude-container">
        <div class="claude-main">
          <div>
            <div class="claude-section-header">Quick Actions</div>
            <div class="claude-quick-actions">
              <div class="claude-action-card" data-action="plan-day">
                <div class="claude-action-info">
                  <div class="claude-action-icon">&#128197;</div>
                  <div class="claude-action-text">
                    <div class="claude-action-name">Plan My Day</div>
                    <div class="claude-action-desc">Organize today's tasks, set priorities, assign work to Claude</div>
                  </div>
                </div>
                <span class="claude-action-arrow">&#8250;</span>
              </div>
              <div class="claude-action-card" data-action="brain-dump">
                <div class="claude-action-info">
                  <div class="claude-action-icon">&#129504;</div>
                  <div class="claude-action-text">
                    <div class="claude-action-name">Process Brain Dumps</div>
                    <div class="claude-action-desc">Convert unprocessed thoughts into structured tasks</div>
                  </div>
                </div>
                <span class="claude-action-arrow">&#8250;</span>
              </div>
              <div class="claude-action-card" data-action="prioritize">
                <div class="claude-action-info">
                  <div class="claude-action-icon">&#9878;</div>
                  <div class="claude-action-text">
                    <div class="claude-action-name">Prioritize Tasks</div>
                    <div class="claude-action-desc">Review all tasks and suggest priority changes</div>
                  </div>
                </div>
                <span class="claude-action-arrow">&#8250;</span>
              </div>
              <div class="claude-action-card" data-action="weekly-review">
                <div class="claude-action-info">
                  <div class="claude-action-icon">&#128202;</div>
                  <div class="claude-action-text">
                    <div class="claude-action-name">Weekly Review</div>
                    <div class="claude-action-desc">Summarize accomplishments, flag blockers, plan ahead</div>
                  </div>
                </div>
                <span class="claude-action-arrow">&#8250;</span>
              </div>
              <div class="claude-action-card" data-action="next-actions">
                <div class="claude-action-info">
                  <div class="claude-action-icon">&#9889;</div>
                  <div class="claude-action-text">
                    <div class="claude-action-name">Suggest Next Actions</div>
                    <div class="claude-action-desc">What to work on next based on current progress</div>
                  </div>
                </div>
                <span class="claude-action-arrow">&#8250;</span>
              </div>
              <div class="claude-action-card" data-action="coach">
                <div class="claude-action-info">
                  <div class="claude-action-icon">&#127942;</div>
                  <div class="claude-action-text">
                    <div class="claude-action-name">Coach Me</div>
                    <div class="claude-action-desc">Analyze work patterns, give honest feedback and advice</div>
                  </div>
                </div>
                <span class="claude-action-arrow">&#8250;</span>
              </div>
            </div>
          </div>

          <div>
            <div class="claude-section-header">Custom Prompt</div>
            <div class="claude-prompt-builder">
              <textarea class="claude-prompt-textarea" id="claude-custom-prompt" placeholder="Ask Claude anything about your tasks...\n\nExamples:\n- Which tasks should I delegate?\n- Break down my biggest project into phases\n- What am I forgetting about?"></textarea>
              <div class="claude-prompt-actions">
                <button class="claude-prompt-send" id="claude-send-prompt">
                  <span>&#128203;</span> Copy to Clipboard
                </button>
                <span class="claude-prompt-hint">Paste into Claude Desktop — MCP tools give full access to your tasks</span>
              </div>
            </div>
          </div>
        </div>

        <div class="claude-sidebar">
          <div>
            <div class="claude-section-header">Claude Can See</div>
            <div class="claude-context-box">
              <div class="claude-context-stats">
                <div class="claude-context-stat">
                  <span class="claude-context-stat-label">Tasks today</span>
                  <span class="claude-context-stat-value">${stats.todayTasks}</span>
                </div>
                <div class="claude-context-stat">
                  <span class="claude-context-stat-label">Overdue</span>
                  <span class="claude-context-stat-value">${stats.overdueTasks}</span>
                </div>
                <div class="claude-context-stat">
                  <span class="claude-context-stat-label">Brain dumps</span>
                  <span class="claude-context-stat-value">${stats.brainDumps}</span>
                </div>
                <div class="claude-context-stat">
                  <span class="claude-context-stat-label">Active projects</span>
                  <span class="claude-context-stat-value">${stats.projects}</span>
                </div>
                <div class="claude-context-stat">
                  <span class="claude-context-stat-label">Total open tasks</span>
                  <span class="claude-context-stat-value">${stats.totalOpen}</span>
                </div>
              </div>
            </div>
          </div>

          <div>
            <div class="claude-section-header">Recent Sessions</div>
            ${recentSessions.length > 0 ? `
              <div class="claude-sessions-list">
                ${recentSessions.map(s => `
                  <div class="claude-session-item">
                    <span class="claude-session-label">${this.escapeHtml(s.label)}</span>
                    <span class="claude-session-time">${this.formatRelativeTime(s.timestamp)}</span>
                  </div>
                `).join('')}
              </div>
            ` : `
              <div class="claude-empty-sessions">No sessions yet. Use a quick action to get started!</div>
            `}
          </div>

          <div>
            <div class="claude-section-header">How It Works</div>
            <div class="claude-mcp-info">
              <p>Quick actions build rich prompts with your task data and copy them to the clipboard.</p>
              <p>Paste into <strong>Claude Desktop</strong> — it has <span class="claude-mcp-tool-count">35+ MCP tools</span> to read and modify your tasks directly.</p>
              <p>When you switch back, TaskFlow auto-refreshes to show changes Claude made.</p>
            </div>
          </div>
        </div>
      </div>
    `;

    // Bind quick action clicks
    container.querySelectorAll('.claude-action-card').forEach(card => {
      card.addEventListener('click', () => {
        const action = card.dataset.action;
        this.handleClaudeQuickAction(action);
      });
    });

    // Bind custom prompt send
    const sendBtn = document.getElementById('claude-send-prompt');
    const textarea = document.getElementById('claude-custom-prompt');
    if (sendBtn && textarea) {
      sendBtn.addEventListener('click', () => {
        const text = textarea.value.trim();
        if (!text) {
          this.showToast('Type a prompt first');
          return;
        }
        this.launchClaudeWithPrompt(this.buildCustomPrompt(text), 'Custom prompt');
      });
    }
  }

  getClaudeContextStats() {
    const today = this.getLocalDateString();
    const allTasks = this.getAllTasks();
    const openTasks = allTasks.filter(t => t.status !== 'done');

    const todayTasks = openTasks.filter(t =>
      t.dueDate === today || t.scheduledDate === today
    ).length;

    const overdueTasks = openTasks.filter(t =>
      t.dueDate && t.dueDate < today
    ).length;

    const brainDumps = allTasks.filter(t =>
      t.context && t.context.trim() && t.status === 'todo'
    ).length;

    const projects = this.data.projects.filter(p =>
      !p.isInbox && (p.status || 'active') === 'active'
    ).length;

    return {
      todayTasks,
      overdueTasks,
      brainDumps,
      projects,
      totalOpen: openTasks.length
    };
  }

  handleClaudeQuickAction(action) {
    let prompt, label;
    switch (action) {
      case 'plan-day':
        prompt = this.buildPlanMyDayPrompt();
        label = 'Plan My Day';
        break;
      case 'brain-dump':
        prompt = this.buildBrainDumpPrompt();
        label = 'Process Brain Dumps';
        break;
      case 'prioritize':
        prompt = this.buildPrioritizePrompt();
        label = 'Prioritize Tasks';
        break;
      case 'weekly-review':
        prompt = this.buildWeeklyReviewPrompt();
        label = 'Weekly Review';
        break;
      case 'next-actions':
        prompt = this.buildNextActionsPrompt();
        label = 'Suggest Next Actions';
        break;
      case 'coach':
        prompt = this.buildCoachPrompt();
        label = 'Coach Me';
        break;
      default:
        return;
    }
    this.launchClaudeWithPrompt(prompt, label);
  }

  launchClaudeWithPrompt(prompt, label) {
    window.api.copyToClipboard(prompt);

    // Record session
    if (!this.data.claudeSessions) this.data.claudeSessions = [];
    this.data.claudeSessions.push({
      label,
      timestamp: new Date().toISOString()
    });
    // Keep only last 20 sessions
    if (this.data.claudeSessions.length > 20) {
      this.data.claudeSessions = this.data.claudeSessions.slice(-20);
    }
    this._lastClaudeSession = Date.now();
    this.saveData();

    this.showToast('Prompt copied — paste into Claude Desktop', 3000);

    // Re-render to show updated recent sessions
    if (this.currentView === 'claude') {
      this.renderClaudeView();
    }
  }

  buildPlanMyDayPrompt() {
    // Reuse existing planMyDay logic but return prompt instead of copying
    const today = this.getLocalDateString();
    const allTasks = this.getAllTasks().filter(t => t.status !== 'done');

    const overdue = allTasks.filter(t => t.dueDate && t.dueDate < today);
    const dueToday = allTasks.filter(t => t.dueDate === today);
    const scheduledToday = allTasks.filter(t => t.scheduledDate === today && !dueToday.some(d => d.id === t.id));
    const highPriority = allTasks.filter(t =>
      (t.priority === 'urgent' || t.priority === 'high') &&
      !dueToday.some(d => d.id === t.id) &&
      !overdue.some(d => d.id === t.id) &&
      !scheduledToday.some(d => d.id === t.id)
    );
    const inProgress = allTasks.filter(t =>
      t.status === 'in-progress' &&
      !dueToday.some(d => d.id === t.id) &&
      !overdue.some(d => d.id === t.id) &&
      !highPriority.some(d => d.id === t.id)
    );
    const waiting = allTasks.filter(t => t.status === 'waiting');
    const activeIds = this.todayView.workingOnTaskIds || [];

    const formatTask = this._formatTaskForPrompt.bind(this);

    let prompt = `# Plan My Day\n\n`;
    prompt += `Today is **${today}**. I have **${allTasks.length} open tasks**. `;
    prompt += `Please analyze everything below and help me have the most productive day possible.\n\n`;

    if (activeIds.length > 0) {
      prompt += `## Currently Active\n`;
      activeIds.forEach(id => {
        const t = this.findTask(id);
        if (t) prompt += formatTask(t);
      });
      prompt += '\n';
    }

    if (overdue.length > 0) {
      prompt += `## OVERDUE (${overdue.length})\n`;
      overdue.forEach(t => prompt += formatTask(t));
      prompt += '\n';
    }

    if (dueToday.length > 0) {
      prompt += `## Due Today (${dueToday.length})\n`;
      dueToday.forEach(t => prompt += formatTask(t));
      prompt += '\n';
    }

    if (scheduledToday.length > 0) {
      prompt += `## Scheduled Today (${scheduledToday.length})\n`;
      scheduledToday.forEach(t => prompt += formatTask(t));
      prompt += '\n';
    }

    if (highPriority.length > 0) {
      prompt += `## High/Urgent Priority (${highPriority.length})\n`;
      highPriority.forEach(t => prompt += formatTask(t));
      prompt += '\n';
    }

    if (inProgress.length > 0) {
      prompt += `## In Progress (${inProgress.length})\n`;
      inProgress.forEach(t => prompt += formatTask(t));
      prompt += '\n';
    }

    if (waiting.length > 0) {
      prompt += `## Waiting/Blocked (${waiting.length})\n`;
      waiting.forEach(t => prompt += formatTask(t));
      prompt += '\n';
    }

    const categorized = new Set([
      ...activeIds, ...overdue.map(t => t.id), ...dueToday.map(t => t.id),
      ...scheduledToday.map(t => t.id), ...highPriority.map(t => t.id),
      ...inProgress.map(t => t.id), ...waiting.map(t => t.id),
    ]);
    const other = allTasks.filter(t => !categorized.has(t.id));
    if (other.length > 0) {
      prompt += `## Other Open Tasks (${other.length})\n`;
      other.forEach(t => prompt += formatTask(t));
      prompt += '\n';
    }

    prompt += `---\n\n`;
    prompt += `## Your Role\n\n`;
    prompt += `You are my Chief of Staff. Analyze my tasks and help me plan the most productive day. Use MCP tools to read full task details and make changes.\n\n`;
    prompt += `## Instructions\n\n`;
    prompt += `1. Ask me 2-3 quick questions about my priorities and energy level\n`;
    prompt += `2. Then create a focused plan splitting work between me and Claude\n`;
    prompt += `3. Use \`update_task\` to set priorities, assignees, and estimates\n`;
    prompt += `4. Use \`create_subtasks\` to break down complex tasks\n`;
    prompt += `5. Use \`sync_claude_queue\` to queue Claude-assigned work\n`;

    return prompt;
  }

  buildBrainDumpPrompt() {
    const allTasks = this.getAllTasks();
    const brainDumps = allTasks.filter(t => t.context && t.context.trim() && t.status === 'todo');

    let prompt = `# Process Brain Dumps\n\n`;
    prompt += `I have **${brainDumps.length} unprocessed brain dump${brainDumps.length !== 1 ? 's' : ''}** that need to be turned into structured, actionable tasks.\n\n`;

    if (brainDumps.length === 0) {
      prompt += `Actually, there are no brain dumps to process right now. Instead, use \`get_inbox_tasks\` to check for unprocessed inbox items and help me organize those.\n`;
      return prompt;
    }

    brainDumps.forEach((t, i) => {
      prompt += `### Brain Dump ${i + 1}: ${t.name}\n`;
      prompt += `Context: ${t.context}\n`;
      if (t.description) prompt += `Description: ${t.description}\n`;
      prompt += '\n';
    });

    prompt += `---\n\n`;
    prompt += `## Instructions\n\n`;
    prompt += `For each brain dump:\n`;
    prompt += `1. Parse the raw thoughts into clear, actionable tasks\n`;
    prompt += `2. Use \`update_task\` to set proper name, description, priority, and clear the context field\n`;
    prompt += `3. Use \`create_subtasks\` if the task needs breaking down\n`;
    prompt += `4. Suggest which project each belongs in\n`;
    prompt += `5. Set \`executionType\` (ai/manual/hybrid) for each\n`;

    return prompt;
  }

  buildPrioritizePrompt() {
    const allTasks = this.getAllTasks().filter(t => t.status !== 'done');
    const formatTask = this._formatTaskForPrompt.bind(this);

    let prompt = `# Prioritize Tasks\n\n`;
    prompt += `I have **${allTasks.length} open tasks**. Review them all and suggest priority changes.\n\n`;

    // Group by current priority
    const groups = { urgent: [], high: [], medium: [], low: [], none: [] };
    allTasks.forEach(t => {
      const p = t.priority || 'none';
      if (groups[p]) groups[p].push(t);
    });

    for (const [priority, tasks] of Object.entries(groups)) {
      if (tasks.length > 0) {
        prompt += `## ${priority.charAt(0).toUpperCase() + priority.slice(1)} (${tasks.length})\n`;
        tasks.forEach(t => prompt += formatTask(t));
        prompt += '\n';
      }
    }

    prompt += `---\n\n`;
    prompt += `## Instructions\n\n`;
    prompt += `1. Review every task's current priority\n`;
    prompt += `2. Suggest changes — explain your reasoning\n`;
    prompt += `3. After I approve, use \`update_task\` to set new priorities\n`;
    prompt += `4. Flag tasks that should be archived, deferred, or deleted\n`;

    return prompt;
  }

  buildWeeklyReviewPrompt() {
    const today = this.getLocalDateString();
    const allTasks = this.getAllTasks();
    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 7);
    const weekAgoStr = this.getLocalDateString(weekAgo);

    const completedThisWeek = allTasks.filter(t =>
      t.status === 'done' && t.completedAt && t.completedAt.split('T')[0] >= weekAgoStr
    );
    const overdue = allTasks.filter(t => t.status !== 'done' && t.dueDate && t.dueDate < today);
    const openTasks = allTasks.filter(t => t.status !== 'done');

    const recapEntries = (this.data.recapLog || []).filter(r => r.date >= weekAgoStr);

    let prompt = `# Weekly Review\n\n`;
    prompt += `Week ending **${today}**.\n\n`;

    prompt += `## Completed This Week (${completedThisWeek.length})\n`;
    if (completedThisWeek.length > 0) {
      completedThisWeek.forEach(t => {
        prompt += `- **${t.name}**`;
        if (t.completionSummary) prompt += ` — ${t.completionSummary.slice(0, 100)}`;
        prompt += '\n';
      });
    } else {
      prompt += `(none)\n`;
    }
    prompt += '\n';

    if (overdue.length > 0) {
      prompt += `## Overdue (${overdue.length})\n`;
      overdue.forEach(t => {
        prompt += `- **${t.name}** — due ${t.dueDate}, priority: ${t.priority || 'none'}\n`;
      });
      prompt += '\n';
    }

    prompt += `## Open Tasks: ${openTasks.length}\n\n`;

    if (recapEntries.length > 0) {
      prompt += `## Recap Entries This Week\n`;
      recapEntries.forEach(r => {
        prompt += `- [${r.type}] ${r.content.slice(0, 150)}\n`;
      });
      prompt += '\n';
    }

    prompt += `---\n\n`;
    prompt += `## Instructions\n\n`;
    prompt += `1. Summarize what was accomplished this week\n`;
    prompt += `2. Identify patterns (what went well, what didn't)\n`;
    prompt += `3. Flag overdue items that need attention\n`;
    prompt += `4. Suggest focus areas for next week\n`;
    prompt += `5. Use \`get_productivity_stats\` for additional data\n`;

    return prompt;
  }

  buildNextActionsPrompt() {
    const today = this.getLocalDateString();
    const allTasks = this.getAllTasks();
    const openTasks = allTasks.filter(t => t.status !== 'done');
    const activeIds = this.todayView.workingOnTaskIds || [];
    const formatTask = this._formatTaskForPrompt.bind(this);

    const completedToday = allTasks.filter(t =>
      t.status === 'done' && t.completedAt && t.completedAt.split('T')[0] === today
    );

    let prompt = `# Suggest Next Actions\n\n`;
    prompt += `Today is **${today}**. I've completed **${completedToday.length} tasks** today so far.\n\n`;

    if (activeIds.length > 0) {
      prompt += `## Currently Working On\n`;
      activeIds.forEach(id => {
        const t = this.findTask(id);
        if (t) prompt += formatTask(t);
      });
      prompt += '\n';
    }

    if (completedToday.length > 0) {
      prompt += `## Completed Today\n`;
      completedToday.slice(0, 10).forEach(t => {
        prompt += `- ~~${t.name}~~\n`;
      });
      prompt += '\n';
    }

    // Show top candidates
    const candidates = openTasks
      .filter(t => !activeIds.includes(t.id))
      .sort((a, b) => {
        const pOrd = { urgent: 0, high: 1, medium: 2, low: 3, none: 4 };
        return (pOrd[a.priority] || 4) - (pOrd[b.priority] || 4);
      })
      .slice(0, 15);

    if (candidates.length > 0) {
      prompt += `## Top Candidates (${candidates.length} of ${openTasks.length})\n`;
      candidates.forEach(t => prompt += formatTask(t));
      prompt += '\n';
    }

    prompt += `---\n\n`;
    prompt += `## Instructions\n\n`;
    prompt += `Based on what I've done today and what's left:\n`;
    prompt += `1. Suggest the best 3-5 tasks to work on next\n`;
    prompt += `2. Explain why each one (urgency, momentum, dependencies)\n`;
    prompt += `3. Consider energy level — it's ${new Date().getHours() < 12 ? 'morning' : new Date().getHours() < 17 ? 'afternoon' : 'evening'}\n`;
    prompt += `4. Flag anything I should defer to tomorrow\n`;

    return prompt;
  }

  buildCoachPrompt() {
    // Delegate to existing coachMePrompt logic but return the prompt
    const allTasks = this.getAllTasks();
    const activeTasks = allTasks.filter(t => t.status !== 'done');
    const today = this.getLocalDateString();

    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 14);
    const recentCompleted = allTasks
      .filter(t => t.status === 'done' && t.completedAt && new Date(t.completedAt) >= cutoff)
      .sort((a, b) => new Date(b.completedAt) - new Date(a.completedAt));

    const snoozed = activeTasks
      .filter(t => (t.snoozeCount || 0) > 0)
      .sort((a, b) => (b.snoozeCount || 0) - (a.snoozeCount || 0));

    const waiting = activeTasks.filter(t => t.status === 'waiting');

    let prompt = `# Coach Me\n\n`;
    prompt += `Today is **${today}**. Be my work coach — analyze patterns, give honest feedback.\n\n`;

    prompt += `## Recent Data\n`;
    prompt += `- **${recentCompleted.length}** tasks completed in 14 days\n`;
    prompt += `- **${activeTasks.length}** open tasks\n`;
    prompt += `- **${snoozed.length}** frequently deferred tasks\n`;
    prompt += `- **${waiting.length}** blocked/waiting tasks\n\n`;

    if (snoozed.length > 0) {
      prompt += `### Frequently Deferred\n`;
      snoozed.slice(0, 5).forEach(t => {
        prompt += `- **${t.name}** — snoozed ${t.snoozeCount}x\n`;
      });
      prompt += '\n';
    }

    prompt += `---\n\n`;
    prompt += `## Instructions\n\n`;
    prompt += `Use \`get_work_context\` and \`get_productivity_stats\` for full data, then:\n`;
    prompt += `1. Identify patterns — what am I avoiding? What energizes me?\n`;
    prompt += `2. Give honest feedback — don't sugarcoat\n`;
    prompt += `3. Suggest 2-3 concrete changes for this week\n`;
    prompt += `4. Ask me questions to coach better\n`;

    return prompt;
  }

  buildCustomPrompt(userText) {
    const stats = this.getClaudeContextStats();

    let prompt = `# Custom Request\n\n`;
    prompt += userText + '\n\n';
    prompt += `---\n\n`;
    prompt += `## Task Context\n`;
    prompt += `- ${stats.todayTasks} tasks today, ${stats.overdueTasks} overdue, ${stats.totalOpen} total open\n`;
    prompt += `- ${stats.projects} active projects, ${stats.brainDumps} brain dumps to process\n\n`;
    prompt += `Use MCP tools (\`get_all_tasks\`, \`get_today_tasks\`, etc.) to access full task data and make changes.\n`;

    return prompt;
  }

  _formatTaskForPrompt(t) {
    const projectLookup = {};
    (this.data.projects || []).forEach(p => {
      (p.tasks || []).forEach(task => { projectLookup[task.id] = p.name; });
    });
    const tagLookup = {};
    (this.data.tags || []).forEach(tag => { tagLookup[tag.id] = tag.name; });

    let s = `- **${t.name}**`;
    s += ` | Priority: ${t.priority || 'none'} | Type: ${t.executionType || 'manual'}`;
    if (t.estimatedMinutes) s += ` | Est: ${t.estimatedMinutes}min`;
    const proj = projectLookup[t.id];
    if (proj && proj !== 'Inbox') s += ` | Project: ${proj}`;
    const tags = (t.tags || []).map(id => tagLookup[id]).filter(Boolean);
    if (tags.length) s += ` | Tags: ${tags.join(', ')}`;
    s += '\n';
    if (t.description) s += `  Description: ${t.description.slice(0, 200)}\n`;
    if (t.context) s += `  Context: ${t.context.slice(0, 200)}\n`;
    if (t.subtasks?.length > 0) {
      const done = t.subtasks.filter(st => st.status === 'done').length;
      s += `  Subtasks (${done}/${t.subtasks.length} done)\n`;
    }
    return s;
  }

  setupFocusReturnRefresh() {
    if (this._focusReturnBound) return;
    this._focusReturnBound = true;

    window.addEventListener('focus', async () => {
      // Only auto-refresh if a Claude session was launched recently (within 30 min)
      if (this._lastClaudeSession && Date.now() - this._lastClaudeSession < 30 * 60 * 1000) {
        const oldData = JSON.stringify(this.data);
        this.data = await window.api.loadData();
        if (JSON.stringify(this.data) !== oldData) {
          this.render();
          this.showToast('Tasks updated by Claude');
        }
      }
    });
  }

  // ============================================
  // PROJECT HEALTH DASHBOARD
  // ============================================

  renderDashboard() {
    const container = document.getElementById('tasks-container');
    if (!container) return;

    const projects = this.data.projects.filter(p => !p.isInbox);
    const inbox = this.data.projects.find(p => p.isInbox);
    const today = new Date();
    const weekAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
    const twoWeeksAgo = new Date(today.getTime() - 14 * 24 * 60 * 60 * 1000);
    const todayStr = this.getLocalDateString();

    // Calculate stats for each project
    const projectStats = projects.map(p => {
      const tasks = p.tasks || [];
      const total = tasks.length;
      const done = tasks.filter(t => t.status === 'done').length;
      const active = total - done;
      const pct = total > 0 ? Math.round((done / total) * 100) : 0;

      // Velocity: completions this week vs last week
      const thisWeek = tasks.filter(t => t.completedAt && new Date(t.completedAt) >= weekAgo).length;
      const lastWeek = tasks.filter(t => {
        if (!t.completedAt) return false;
        const d = new Date(t.completedAt);
        return d >= twoWeeksAgo && d < weekAgo;
      }).length;

      let velocityTrend = 'flat';
      if (thisWeek > lastWeek) velocityTrend = 'up';
      else if (thisWeek < lastWeek) velocityTrend = 'down';

      // Red flags
      const flags = [];
      const heavilySnoozed = tasks.filter(t => t.status !== 'done' && (t.snoozeCount || 0) >= 3);
      if (heavilySnoozed.length > 0) flags.push({ type: 'snoozed', count: heavilySnoozed.length, label: `${heavilySnoozed.length} snoozed 3+ times` });

      const stale = tasks.filter(t => {
        if (t.status === 'done') return false;
        const age = (today - new Date(t.createdAt)) / (24 * 60 * 60 * 1000);
        return age > 14 && !t.completedAt;
      });
      if (stale.length > 0) flags.push({ type: 'stale', count: stale.length, label: `${stale.length} older than 2 weeks` });

      const blocked = tasks.filter(t => t.status === 'waiting');
      if (blocked.length > 0) flags.push({ type: 'blocked', count: blocked.length, label: `${blocked.length} blocked` });

      const overdue = tasks.filter(t => t.status !== 'done' && t.dueDate && t.dueDate < todayStr);
      if (overdue.length > 0) flags.push({ type: 'overdue', count: overdue.length, label: `${overdue.length} overdue` });

      // Most recent completion
      const lastCompletion = tasks
        .filter(t => t.completedAt)
        .sort((a, b) => new Date(b.completedAt) - new Date(a.completedAt))[0];
      const daysSinceCompletion = lastCompletion
        ? Math.floor((today - new Date(lastCompletion.completedAt)) / (24 * 60 * 60 * 1000))
        : null;

      if (daysSinceCompletion !== null && daysSinceCompletion > 7 && active > 0) {
        flags.push({ type: 'inactive', count: daysSinceCompletion, label: `No completions in ${daysSinceCompletion}d` });
      }

      // Next action: highest priority active task
      const priorityOrder = { urgent: 0, high: 1, medium: 2, low: 3, none: 4 };
      const nextAction = tasks
        .filter(t => t.status !== 'done' && t.status !== 'waiting')
        .sort((a, b) => (priorityOrder[a.priority] || 4) - (priorityOrder[b.priority] || 4))[0];

      // Energy data
      const withEnergy = tasks.filter(t => t.energyRating && t.status === 'done');
      const avgEnergy = withEnergy.length > 0
        ? (withEnergy.reduce((s, t) => s + t.energyRating, 0) / withEnergy.length).toFixed(1)
        : null;

      return {
        project: p,
        total, done, active, pct,
        thisWeek, lastWeek, velocityTrend,
        flags, nextAction, daysSinceCompletion, avgEnergy
      };
    });

    // Sort: projects with flags first, then by active tasks count
    projectStats.sort((a, b) => {
      if (a.flags.length !== b.flags.length) return b.flags.length - a.flags.length;
      return b.active - a.active;
    });

    // Overall stats
    const totalActive = projectStats.reduce((s, p) => s + p.active, 0);
    const totalDone = projectStats.reduce((s, p) => s + p.done, 0);
    const totalFlags = projectStats.reduce((s, p) => s + p.flags.length, 0);
    const inboxCount = inbox ? inbox.tasks.filter(t => t.status !== 'done').length : 0;

    const velocityArrow = (trend) => {
      if (trend === 'up') return '<span class="dash-trend dash-trend-up" title="Trending up">&#9650;</span>';
      if (trend === 'down') return '<span class="dash-trend dash-trend-down" title="Trending down">&#9660;</span>';
      return '<span class="dash-trend dash-trend-flat" title="Flat">&#9644;</span>';
    };

    container.innerHTML = `
      <div class="dashboard-view">
        <div class="dash-summary">
          <div class="dash-stat">
            <span class="dash-stat-value">${projects.length}</span>
            <span class="dash-stat-label">Projects</span>
          </div>
          <div class="dash-stat">
            <span class="dash-stat-value">${totalActive}</span>
            <span class="dash-stat-label">Active Tasks</span>
          </div>
          <div class="dash-stat">
            <span class="dash-stat-value">${totalDone}</span>
            <span class="dash-stat-label">Completed</span>
          </div>
          <div class="dash-stat ${totalFlags > 0 ? 'dash-stat-warn' : ''}">
            <span class="dash-stat-value">${totalFlags}</span>
            <span class="dash-stat-label">Flags</span>
          </div>
          <div class="dash-stat ${inboxCount > 5 ? 'dash-stat-warn' : ''}">
            <span class="dash-stat-value">${inboxCount}</span>
            <span class="dash-stat-label">Inbox</span>
          </div>
        </div>

        <div class="dash-projects">
          ${projectStats.map(s => `
            <div class="dash-card" data-project-id="${s.project.id}" style="--project-color: ${s.project.color}">
              <div class="dash-card-header">
                <div class="dash-card-title-row">
                  <span class="dash-card-dot" style="background: ${s.project.color}"></span>
                  <span class="dash-card-name">${this.escapeHtml(s.project.name)}</span>
                  ${velocityArrow(s.velocityTrend)}
                </div>
                <span class="dash-card-counts">${s.active} active · ${s.done} done</span>
              </div>

              <div class="dash-progress-row">
                <div class="dash-progress-bar">
                  <div class="dash-progress-fill" style="width: ${s.pct}%; background: ${s.project.color}"></div>
                </div>
                <span class="dash-progress-pct">${s.pct}%</span>
              </div>

              <div class="dash-card-meta">
                <span class="dash-velocity">This week: ${s.thisWeek} ${s.lastWeek > 0 ? `(prev: ${s.lastWeek})` : ''}</span>
                ${s.avgEnergy ? `<span class="dash-energy">Energy: ${s.avgEnergy}/3</span>` : ''}
              </div>

              ${s.flags.length > 0 ? `
                <div class="dash-flags">
                  ${s.flags.map(f => `<span class="dash-flag dash-flag-${f.type}">${f.label}</span>`).join('')}
                </div>
              ` : ''}

              ${s.nextAction ? `
                <div class="dash-next-action">
                  <span class="dash-next-label">Next:</span>
                  <span class="dash-next-task">${this.escapeHtml(s.nextAction.name)}</span>
                  <span class="dash-next-priority priority-${s.nextAction.priority || 'none'}">${s.nextAction.priority || ''}</span>
                </div>
              ` : '<div class="dash-next-action"><span class="dash-next-label">No active tasks</span></div>'}
            </div>
          `).join('')}

          ${projectStats.length === 0 ? `
            <div class="dash-empty">
              <p>No projects yet. Create a project to see it here.</p>
            </div>
          ` : ''}
        </div>
      </div>
    `;

    // Click card to navigate to project
    container.querySelectorAll('.dash-card').forEach(card => {
      card.addEventListener('click', () => {
        this.setView('project-' + card.dataset.projectId);
      });
    });
  }

  // Legacy methods removed — priority sections and completed section replaced by flat queue

  bindTodayViewEvents() {
    // My Tasks toggle
    document.querySelectorAll('#my-tasks-toggle .my-tasks-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        this.todayView.myTasksFilter = btn.dataset.filter === 'mine';
        this.renderTodayView();
      });
    });

    // Plan My Day button
    const planBtn = document.getElementById('plan-my-day-btn');
    if (planBtn) {
      planBtn.onclick = () => this.planMyDay();
    }

    // Coach Me button
    const coachBtn = document.getElementById('coach-me-btn');
    if (coachBtn) {
      coachBtn.onclick = () => this.coachMePrompt();
    }

    // Roll banner dismiss
    const rollDismiss = document.getElementById('roll-banner-dismiss');
    if (rollDismiss) {
      rollDismiss.onclick = () => {
        document.getElementById('today-roll-banner')?.classList.add('hidden');
      };
    }

    // Complete task buttons — shows toast, auto-advances Working On
    document.querySelectorAll('.today-task-check').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const taskId = btn.dataset.taskId;
        const task = this.findTask(taskId);
        const taskName = task ? task.name : 'Task';
        const item = btn.closest('.today-task-item');
        item?.classList.add('completing');

        this.showCompletionSummaryModal(taskId, () => {
          if (this.todayView.workingOnTaskIds.includes(taskId)) {
            this.removeActiveTask(taskId);
          }
          this.showToast(`${taskName} completed`, 2000, 'success');
          this.renderTodayView();
        });
      });
    });

    // Focus on task buttons - adds to active list
    document.querySelectorAll('.today-task-focus').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const taskId = btn.dataset.taskId;
        this.addActiveTask(taskId);
        this.updateFloatingBar();
        this.renderTodayView();
      });
    });

    // Up Next subtask expand toggles
    document.querySelectorAll('.up-next-subtask-toggle').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const taskId = btn.dataset.taskId;
        if (this.todayView.expandedUpNextIds.has(taskId)) {
          this.todayView.expandedUpNextIds.delete(taskId);
        } else {
          this.todayView.expandedUpNextIds.add(taskId);
        }
        this.renderTodayView();
      });
    });

    // Up Next subtask checkboxes
    document.querySelectorAll('.up-next-subtask-check').forEach(cb => {
      cb.addEventListener('change', (e) => {
        e.stopPropagation();
        const taskId = e.target.dataset.taskId;
        const subtaskId = e.target.dataset.subtaskId;
        const task = this.findTask(taskId);
        if (task) {
          const subtask = task.subtasks.find(s => s.id === subtaskId);
          if (subtask) {
            subtask.status = e.target.checked ? 'done' : 'todo';
            this.saveData();
            this.renderTodayView();
          }
        }
      });
    });

    // Click task to open details
    document.querySelectorAll('.today-task-item').forEach(item => {
      item.addEventListener('click', (e) => {
        if (!e.target.closest('button')) {
          this.openDetailPanel(item.dataset.taskId);
        }
      });

      // Drag and drop for reordering
      item.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('text/plain', item.dataset.taskId);
        e.dataTransfer.effectAllowed = 'move';
        item.classList.add('dragging');
        setTimeout(() => item.style.opacity = '0.5', 0);
      });

      item.addEventListener('dragend', () => {
        item.classList.remove('dragging');
        item.style.opacity = '1';
        document.querySelectorAll('.today-task-item.drag-over').forEach(el => {
          el.classList.remove('drag-over');
        });
      });

      item.addEventListener('dragover', (e) => {
        e.preventDefault();
        const dragging = document.querySelector('.today-task-item.dragging');
        if (dragging && dragging !== item) {
          item.classList.add('drag-over');
        }
      });

      item.addEventListener('dragleave', () => {
        item.classList.remove('drag-over');
      });

      item.addEventListener('drop', (e) => {
        e.preventDefault();
        item.classList.remove('drag-over');
        const draggedTaskId = e.dataTransfer.getData('text/plain');
        const targetTaskId = item.dataset.taskId;

        if (draggedTaskId && targetTaskId && draggedTaskId !== targetTaskId) {
          this.reorderTodayTask(draggedTaskId, targetTaskId);
        }
      });
    });

    // Working On Now section events - including drop zone
    const workingNowSection = document.getElementById('today-working-now');
    if (workingNowSection) {
      workingNowSection.addEventListener('dragover', (e) => {
        e.preventDefault();
        workingNowSection.classList.add('drop-target');
      });

      workingNowSection.addEventListener('dragleave', (e) => {
        if (!workingNowSection.contains(e.relatedTarget)) {
          workingNowSection.classList.remove('drop-target');
        }
      });

      workingNowSection.addEventListener('drop', (e) => {
        e.preventDefault();
        workingNowSection.classList.remove('drop-target');
        const taskId = e.dataTransfer.getData('text/plain');
        if (taskId) {
          this.addActiveTask(taskId);
          this.updateFloatingBar();
          this.renderTodayView();
        }
      });
    }

    const workingNowClear = document.getElementById('working-now-clear');
    if (workingNowClear) {
      workingNowClear.onclick = () => {
        this.todayView.workingOnTaskIds = [];
        this.data.workingOnTaskIds = [];
        this.saveData();
        this.updateFloatingBar();
        this.renderTodayView();
      };
    }

    // Active card complete buttons
    document.querySelectorAll('.active-card-complete').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const taskId = btn.dataset.taskId;
        const task = this.findTask(taskId);
        const taskName = task ? task.name : 'Task';
        this.showCompletionSummaryModal(taskId, () => {
          this.removeActiveTask(taskId);
          this.updateFloatingBar();
          this.showToast(`${taskName} completed`, 2000, 'success');
          this.renderTodayView();
        });
      });
    });

    // Active card remove buttons
    document.querySelectorAll('.active-card-remove').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const taskId = btn.dataset.taskId;
        this.removeActiveTask(taskId);
        this.updateFloatingBar();
        this.renderTodayView();
      });
    });

    // Subtask checkboxes in active cards
    document.querySelectorAll('.active-card-subtask-check').forEach(cb => {
      cb.addEventListener('change', (e) => {
        e.stopPropagation();
        const taskId = e.target.dataset.taskId;
        const subtaskId = e.target.dataset.subtaskId;
        const task = this.findTask(taskId);
        if (task) {
          const subtask = task.subtasks.find(s => s.id === subtaskId);
          if (subtask) {
            subtask.status = e.target.checked ? 'done' : 'todo';
            this.saveData();
            this.renderActiveTasks();
            this.bindTodayViewEvents();
          }
        }
      });
    });

    // Click active card info to open details
    document.querySelectorAll('.active-card-info').forEach(el => {
      el.addEventListener('click', (e) => {
        if (!e.target.closest('button')) {
          this.openDetailPanel(el.dataset.taskId);
        }
      });
    });

    // Task-specific notes (in Working On Now section)
    const taskNotesInput = document.getElementById('working-now-notes-input');
    if (taskNotesInput) {
      let saveTimeout;
      taskNotesInput.addEventListener('input', () => {
        clearTimeout(saveTimeout);
        saveTimeout = setTimeout(() => {
          const firstActiveId = this.todayView.workingOnTaskIds[0];
          if (firstActiveId) {
            const task = this.findTask(firstActiveId);
            if (task) {
              task.workNotes = taskNotesInput.value;
              this.saveData();
            }
          }
        }, 500);
      });
    }

    // Daily notes for recaps
    const dailyNotesInput = document.getElementById('today-daily-notes-input');
    if (dailyNotesInput) {
      let saveTimeout;
      dailyNotesInput.addEventListener('input', () => {
        clearTimeout(saveTimeout);
        saveTimeout = setTimeout(() => {
          const today = this.getLocalDateString();
          if (!this.data.dailyNotes) this.data.dailyNotes = {};
          this.data.dailyNotes[today] = dailyNotesInput.value;
          this.saveData();
        }, 500);
      });
    }

    // Add tasks button
    const addBtn = document.getElementById('today-add-tasks');
    if (addBtn) {
      addBtn.onclick = () => this.setView('master-list');
    }

    // Start focus button
    const focusBtn = document.getElementById('today-start-focus');
    if (focusBtn) {
      focusBtn.onclick = () => this.startFocusMode();
    }
  }

  // Auto-advance: remove completed tasks from active list (no auto-pick with multi-active)
  autoAdvanceWorkingOn() {
    // Clean up: remove any done tasks from active list
    const allTasks = this.getAllTasks();
    this.todayView.workingOnTaskIds = this.todayView.workingOnTaskIds.filter(id => {
      const task = allTasks.find(t => t.id === id);
      return task && task.status !== 'done';
    });
    this.data.workingOnTaskIds = [...this.todayView.workingOnTaskIds];
    this.saveData();
  }

  reorderTodayTask(draggedTaskId, targetTaskId) {
    // Get both tasks
    const draggedTask = this.findTask(draggedTaskId);
    const targetTask = this.findTask(targetTaskId);

    if (!draggedTask || !targetTask) return;

    // Copy priority from target task to reorder within same priority
    // Or swap priorities to move between sections
    if (draggedTask.priority !== targetTask.priority) {
      // Moving to different priority section - adopt that priority
      draggedTask.priority = targetTask.priority;
      this.saveData();
      this.renderTodayView();
    } else {
      // Same priority - just visual feedback, tasks stay sorted by their properties
      // Could implement custom sort order here if needed
      this.renderTodayView();
    }
  }

  startFocusModeWithTask(taskId) {
    // Build queue with this task first
    const today = this.getLocalDateString();
    const allTasks = this.getAllTasks().filter(t =>
      (t.dueDate === today || t.scheduledDate === today) && t.status !== 'done'
    );

    // Put the selected task first
    const selectedTask = allTasks.find(t => t.id === taskId);
    const otherTasks = allTasks.filter(t => t.id !== taskId);
    this.focusMode.taskQueue = selectedTask ? [selectedTask, ...otherTasks] : allTasks;
    this.focusMode.currentIndex = 0;

    this.startFocusMode();
  }

  renderDailySchedule() {
    const container = document.getElementById('cc-schedule');
    const today = this.getLocalDateString();
    const allTodayTasks = this.getAllTasks().filter(t =>
      (t.dueDate === today || t.scheduledDate === today) && t.status !== 'done'
    );

    // Separate scheduled and unscheduled tasks
    const scheduledTasks = allTodayTasks
      .filter(t => t.scheduledTime)
      .sort((a, b) => a.scheduledTime.localeCompare(b.scheduledTime));
    const unscheduledTasks = allTodayTasks.filter(t => !t.scheduledTime);

    if (allTodayTasks.length === 0) {
      container.innerHTML = `
        <div class="cc-schedule-empty">
          <p>No tasks scheduled for today</p>
          <button class="btn btn-primary" id="cc-add-to-today">Add Tasks to Today</button>
        </div>
      `;
      container.querySelector('#cc-add-to-today')?.addEventListener('click', () => {
        this.setView('master-list');
      });
      return;
    }

    // Calculate total scheduled time
    const totalScheduledMins = scheduledTasks.reduce((sum, t) => sum + (t.estimatedMinutes || 30), 0);
    const totalHours = Math.floor(totalScheduledMins / 60);
    const totalMins = totalScheduledMins % 60;

    let html = `<div class="schedule-time-slots">`;

    // Show scheduled tasks with time blocks
    if (scheduledTasks.length > 0) {
      html += `<div class="schedule-header">
        <span class="schedule-header-title">Time-Blocked (${scheduledTasks.length})</span>
        <span class="schedule-header-total">${totalHours}h ${totalMins}m</span>
      </div>`;

      scheduledTasks.forEach(task => {
        const priorityClass = task.priority !== 'none' ? `priority-${task.priority}` : '';
        const statusClass = task.status === 'in-progress' ? 'active' : '';
        const duration = task.estimatedMinutes || 30;

        // Calculate end time
        const [h, m] = task.scheduledTime.split(':').map(Number);
        const endMins = h * 60 + m + duration;
        const endH = Math.floor(endMins / 60) % 24;
        const endM = endMins % 60;
        const endTime = `${String(endH).padStart(2, '0')}:${String(endM).padStart(2, '0')}`;

        html += `
          <div class="schedule-slot scheduled ${priorityClass} ${statusClass}" data-task-id="${task.id}">
            <div class="schedule-slot-time">
              <span class="time-start">${task.scheduledTime}</span>
              <span class="time-end">${endTime}</span>
            </div>
            <div class="schedule-slot-content">
              <span class="schedule-slot-name">${this.escapeHtml(task.name)}</span>
              <span class="schedule-slot-duration">${duration}m</span>
            </div>
            <button class="schedule-slot-check" data-action="complete">✓</button>
          </div>
        `;
      });
    }

    // Show unscheduled tasks
    if (unscheduledTasks.length > 0) {
      html += `<div class="schedule-header unscheduled">
        <span class="schedule-header-title">Due Today - Unscheduled (${unscheduledTasks.length})</span>
      </div>`;

      unscheduledTasks.forEach(task => {
        const priorityClass = task.priority !== 'none' ? `priority-${task.priority}` : '';
        const statusClass = task.status === 'in-progress' ? 'active' : '';

        html += `
          <div class="schedule-slot unscheduled ${priorityClass} ${statusClass}" data-task-id="${task.id}">
            <div class="schedule-slot-time">--:--</div>
            <div class="schedule-slot-content">
              <span class="schedule-slot-name">${this.escapeHtml(task.name)}</span>
              ${task.estimatedMinutes ? `<span class="schedule-slot-duration">${task.estimatedMinutes}m</span>` : ''}
            </div>
            <button class="schedule-slot-check" data-action="complete">✓</button>
          </div>
        `;
      });
    }

    html += `</div>`;
    container.innerHTML = html;

    // Bind events
    container.querySelectorAll('.schedule-slot').forEach(slot => {
      slot.addEventListener('click', (e) => {
        if (!e.target.classList.contains('schedule-slot-check')) {
          this.openDetailPanel(slot.dataset.taskId);
        }
      });
      slot.querySelector('[data-action="complete"]')?.addEventListener('click', (e) => {
        e.stopPropagation();
        this.updateTask(slot.dataset.taskId, { status: 'done' });
        this.renderCommandCenter();
      });
    });

    // Also render the dual-track timeline
    this.renderDualTrackTimeline();
  }

  renderDualTrackTimeline() {
    const timelineBody = document.getElementById('timeline-body');
    const emptyState = document.getElementById('cc-schedule-empty');
    const timeline = document.getElementById('dual-track-timeline');
    const nowIndicator = document.getElementById('timeline-now-indicator');

    if (!timelineBody || !timeline) return;

    const today = this.getLocalDateString();
    const now = new Date();
    const currentHour = now.getHours();
    const currentMinute = now.getMinutes();

    // Get all tasks for today (scheduled or due)
    const allTodayTasks = this.getAllTasks().filter(t =>
      (t.dueDate === today || t.scheduledDate === today) && t.status !== 'done'
    );

    // Get focus queue for task picker
    const focusQueue = this.getFocusTaskQueue();

    // Always show timeline - users can click to schedule even if empty
    timeline.style.display = 'block';
    emptyState?.classList.remove('visible');

    // Build 15-MINUTE time slots from 6 AM to 10 PM
    let html = '';
    for (let hour = 6; hour <= 22; hour++) {
      for (let quarter = 0; quarter < 4; quarter++) {
        const minute = quarter * 15;
        const minuteStr = String(minute).padStart(2, '0');
        const hourStr = String(hour).padStart(2, '0');
        const timeSlot = `${hourStr}:${minuteStr}`;

        // Display format - show time label for ALL 15-minute slots
        const displayHour = hour > 12 ? hour - 12 : hour === 0 ? 12 : hour;
        const ampm = hour >= 12 ? 'PM' : 'AM';
        const displayTime = `${displayHour}:${minuteStr} ${ampm}`;

        // Determine if this slot is past or current
        const slotMinutes = hour * 60 + minute;
        const currentMinutes = currentHour * 60 + currentMinute;
        const isPast = slotMinutes + 15 <= currentMinutes;
        const isCurrent = currentMinutes >= slotMinutes && currentMinutes < slotMinutes + 15;

        // Filter function for this 15-minute slot
        const inSlot = (t) => {
          if (!t.scheduledTime) return false;
          const [h, m] = t.scheduledTime.split(':').map(Number);
          return h === hour && m >= minute && m < minute + 15;
        };

        // Slot type classes for styling
        const slotType = minute === 0 ? 'hour-start' : minute === 30 ? 'half-hour' : 'quarter-hour';
        const rowClass = `timeline-row single-track ${isCurrent ? 'current-slot' : ''} ${isPast ? 'past-slot' : ''} ${slotType}`;

        // Single track mode - all tasks in one column
        const slotTasks = allTodayTasks.filter(inSlot);

        html += `
          <div class="${rowClass}" data-hour="${hour}" data-minute="${minute}" data-time="${timeSlot}">
            <div class="timeline-time">${displayTime}</div>
            <div class="timeline-track drop-zone" data-time="${timeSlot}" data-track="schedule">
              ${this.renderTimelineTasks(slotTasks, 'schedule', isPast, isCurrent, currentMinute)}
            </div>
          </div>
        `;
      }
    }

    timelineBody.innerHTML = html;

    // Position NOW indicator
    if (currentHour >= 6 && currentHour <= 22) {
      nowIndicator?.classList.add('visible');
      // Calculate position based on current time (15-minute slots)
      const rowHeight = 36; // height of each 15-minute slot (compact)
      const headerHeight = 40; // approximate header height
      const totalQuarters = (currentHour - 6) * 4 + Math.floor(currentMinute / 15);
      const minuteWithinSlot = currentMinute % 15;
      const minuteOffset = (minuteWithinSlot / 15) * rowHeight;
      const topPosition = headerHeight + (totalQuarters * rowHeight) + minuteOffset;
      nowIndicator.style.top = `${topPosition}px`;
    } else {
      nowIndicator?.classList.remove('visible');
    }

    // Scroll to current time slot
    const currentRow = timelineBody.querySelector('.timeline-row.current-slot');
    if (currentRow) {
      currentRow.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    // Bind click and drag events for existing tasks
    timelineBody.querySelectorAll('.timeline-task').forEach(taskEl => {
      // Click to view details
      taskEl.addEventListener('click', (e) => {
        if (e.target.classList.contains('timeline-task-remove')) return;
        if (e.target.classList.contains('timeline-task-duration-select')) return;
        e.stopPropagation();
        this.showTaskQuickEdit(taskEl.dataset.taskId, taskEl);
      });

      // Drag to move task
      taskEl.addEventListener('dragstart', (e) => {
        e.stopPropagation();
        taskEl.classList.add('dragging');
        e.dataTransfer.setData('text/plain', taskEl.dataset.taskId);
        e.dataTransfer.setData('application/x-timeline-task', 'true');
        e.dataTransfer.effectAllowed = 'move';
      });

      taskEl.addEventListener('dragend', () => {
        taskEl.classList.remove('dragging');
        document.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
      });
    });

    // Bind remove button events
    timelineBody.querySelectorAll('.timeline-task-remove').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const taskId = btn.dataset.taskId;
        this.updateTask(taskId, {
          scheduledTime: null,
          scheduledDate: null
        });
        this.renderCommandCenter();
      });
    });

    // Bind duration select change
    timelineBody.querySelectorAll('.timeline-task-duration-select').forEach(selectEl => {
      selectEl.addEventListener('click', (e) => e.stopPropagation());
      selectEl.addEventListener('change', (e) => {
        e.stopPropagation();
        const taskId = selectEl.dataset.taskId;
        const newDuration = parseInt(selectEl.value);
        this.updateTask(taskId, { estimatedMinutes: newDuration });
        this.renderCommandCenter();
      });
    });

    // Bind click-to-schedule on empty track cells
    timelineBody.querySelectorAll('.timeline-track').forEach(track => {
      track.addEventListener('click', (e) => {
        // Only trigger if clicking on empty area (not on a task)
        if (e.target.classList.contains('timeline-track') ||
            e.target.classList.contains('timeline-track-empty')) {
          const time = track.dataset.time;
          const trackType = track.dataset.track;
          this.openTaskPicker(time, trackType);
        }
      });
    });

    // Bind drop zone events for drag-and-drop scheduling
    this.bindTimelineDropZones();
  }

  bindTimelineDropZones() {
    const timelineBody = document.getElementById('timeline-body');
    if (!timelineBody) return;

    // Use event delegation on the timeline body for drop events
    // This avoids issues with cloning and duplicate listeners
    timelineBody.addEventListener('dragover', (e) => {
      const dropZone = e.target.closest('.drop-zone');
      if (dropZone) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        dropZone.classList.add('drag-over');
      }
    });

    timelineBody.addEventListener('dragleave', (e) => {
      const dropZone = e.target.closest('.drop-zone');
      if (dropZone && !dropZone.contains(e.relatedTarget)) {
        dropZone.classList.remove('drag-over');
      }
    });

    timelineBody.addEventListener('drop', (e) => {
      const dropZone = e.target.closest('.drop-zone');
      if (!dropZone) return;

      e.preventDefault();
      dropZone.classList.remove('drag-over');

      const taskId = e.dataTransfer.getData('text/plain');
      const time = dropZone.dataset.time;

      if (taskId && time) {
        const today = this.getLocalDateString();
        const task = this.findTask(taskId);

        const updates = {
          scheduledTime: time,
          scheduledDate: today
        };

        // Keep existing duration if task has one
        if (!task || !task.estimatedMinutes) {
          updates.estimatedMinutes = 30;
        }

        this.updateTask(taskId, updates);
        this.renderCommandCenter();
      }
    });
  }

  openTaskPicker(time, trackType) {
    // Get unscheduled tasks from focus queue
    const unscheduledTasks = this.getFocusTaskQueue().filter(t => !t.scheduledTime);

    if (unscheduledTasks.length === 0) {
      // No tasks to schedule - could show a message or open new task modal
      alert('No unscheduled tasks available. Add some tasks first!');
      return;
    }

    // Parse time string (e.g., "09:30" or "14:00")
    const [hourStr, minuteStr] = time.split(':');
    const hour = parseInt(hourStr);
    const displayHour = hour > 12 ? hour - 12 : hour === 0 ? 12 : hour;
    const ampm = hour >= 12 ? 'PM' : 'AM';
    const displayTime = `${displayHour}:${minuteStr} ${ampm}`;

    // Create modal HTML
    const modalHtml = `
      <div class="task-picker-overlay visible" id="task-picker-overlay">
        <div class="task-picker-modal">
          <div class="task-picker-header">
            <h3>Schedule Task</h3>
            <span class="task-picker-time">${displayTime}</span>
            <button class="task-picker-close" id="task-picker-close">×</button>
          </div>
          <div class="task-picker-list">
            ${unscheduledTasks.map(task => {
              const project = this.data.projects.find(p => p.tasks.some(t => t.id === task.id));
              const projectName = project && !project.isInbox ? project.name : '';
              return `
                <div class="task-picker-item" data-task-id="${task.id}">
                  <div class="task-picker-item-priority ${task.priority || 'none'}"></div>
                  <span class="task-picker-item-name">${this.escapeHtml(task.name)}</span>
                  ${projectName ? `<span class="task-picker-item-project">${this.escapeHtml(projectName)}</span>` : ''}
                </div>
              `;
            }).join('')}
          </div>
        </div>
      </div>
    `;

    // Add to DOM
    document.body.insertAdjacentHTML('beforeend', modalHtml);

    // Bind events
    const overlay = document.getElementById('task-picker-overlay');
    const closeBtn = document.getElementById('task-picker-close');

    const closeModal = () => {
      overlay.classList.remove('visible');
      setTimeout(() => overlay.remove(), 200);
    };

    closeBtn.addEventListener('click', closeModal);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) closeModal();
    });

    // Bind task selection
    overlay.querySelectorAll('.task-picker-item').forEach(item => {
      item.addEventListener('click', () => {
        const taskId = item.dataset.taskId;
        const today = this.getLocalDateString();
        const task = this.findTask(taskId);

        const updates = {
          scheduledTime: time,
          scheduledDate: today
        };

        // Only set default duration if task doesn't have one
        if (!task || !task.estimatedMinutes) {
          updates.estimatedMinutes = 30;
        }

        this.updateTask(taskId, updates);

        closeModal();
        this.renderCommandCenter();
      });
    });

    // Close on Escape key
    document.addEventListener('keydown', function escHandler(e) {
      if (e.key === 'Escape') {
        closeModal();
        document.removeEventListener('keydown', escHandler);
      }
    });
  }

  openDurationPicker(taskId, anchorEl) {
    console.log('openDurationPicker called with taskId:', taskId);
    const task = this.findTask(taskId);
    console.log('Task found:', task);
    if (!task) {
      console.log('Task not found, returning');
      return;
    }

    const currentDuration = task.estimatedMinutes || 30;
    console.log('Current duration:', currentDuration);

    // Duration options in minutes
    const durations = [
      { label: '15m', value: 15 },
      { label: '30m', value: 30 },
      { label: '45m', value: 45 },
      { label: '1h', value: 60 },
      { label: '1.5h', value: 90 },
      { label: '2h', value: 120 },
      { label: '3h', value: 180 },
      { label: '4h', value: 240 }
    ];

    // Remove any existing picker
    document.querySelector('.duration-picker-popup')?.remove();

    // Create popup
    const popup = document.createElement('div');
    popup.className = 'duration-picker-popup';
    popup.innerHTML = `
      <div class="duration-picker-header">Duration</div>
      <div class="duration-picker-options">
        ${durations.map(d => `
          <button class="duration-option ${d.value === currentDuration ? 'active' : ''}" data-value="${d.value}">
            ${d.label}
          </button>
        `).join('')}
      </div>
      <div class="duration-picker-custom">
        <input type="number" class="duration-custom-input" placeholder="Custom" min="5" step="5" value="${currentDuration}">
        <span>min</span>
      </div>
    `;

    // Position popup near the anchor element
    const rect = anchorEl.getBoundingClientRect();
    popup.style.position = 'fixed';
    popup.style.top = `${rect.bottom + 5}px`;
    popup.style.left = `${rect.left}px`;
    popup.style.zIndex = '1000';

    document.body.appendChild(popup);

    // Handle option clicks
    popup.querySelectorAll('.duration-option').forEach(btn => {
      btn.addEventListener('click', () => {
        const value = parseInt(btn.dataset.value);
        this.updateTask(taskId, { estimatedMinutes: value });
        popup.remove();
        this.renderCommandCenter();
      });
    });

    // Handle custom input
    const customInput = popup.querySelector('.duration-custom-input');
    customInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const value = parseInt(customInput.value) || 30;
        this.updateTask(taskId, { estimatedMinutes: Math.max(5, value) });
        popup.remove();
        this.renderCommandCenter();
      }
    });

    // Close on click outside
    const closeHandler = (e) => {
      if (!popup.contains(e.target) && e.target !== anchorEl) {
        popup.remove();
        document.removeEventListener('click', closeHandler);
      }
    };
    setTimeout(() => document.addEventListener('click', closeHandler), 10);

    // Close on Escape
    const escHandler = (e) => {
      if (e.key === 'Escape') {
        popup.remove();
        document.removeEventListener('keydown', escHandler);
      }
    };
    document.addEventListener('keydown', escHandler);
  }

  renderTimelineTasks(tasks, trackType, isPast, isCurrent, currentMinute) {
    if (tasks.length === 0) {
      return '';
    }

    return tasks.map(task => {
      const duration = task.estimatedMinutes || 30;
      const priorityClass = task.priority ? `priority-${task.priority}` : '';

      // Check if this specific task is current (within its time block)
      let isCurrentTask = false;
      if (isCurrent && task.scheduledTime) {
        const [taskH, taskM] = task.scheduledTime.split(':').map(Number);
        const taskEndMin = taskM + duration;
        isCurrentTask = currentMinute >= taskM && currentMinute < taskEndMin;
      }

      const currentClass = isCurrentTask ? 'is-current' : '';
      const pastClass = isPast ? 'is-past' : '';

      // In dual-track mode, use type-based styling
      let typeClass = '';
      let icon = '';
      if (trackType === 'ai' || trackType === 'manual') {
        typeClass = task.executionType === 'hybrid' ? 'type-hybrid' : `type-${trackType}`;
        icon = task.executionType === 'ai' ? '🤖' :
               task.executionType === 'hybrid' ? '🤝' : '👤';
      } else {
        // Single track mode - use priority-based styling
        // Show execution type icon if set
        if (task.executionType === 'ai') icon = '🤖';
        else if (task.executionType === 'hybrid') icon = '🤝';
      }

      // Priority indicator dot (only in single-track mode without type styling)
      const priorityDot = (!typeClass && task.priority && task.priority !== 'none')
        ? `<span class="timeline-task-priority-dot ${task.priority}"></span>`
        : '';

      const iconHtml = icon ? `<span class="timeline-task-icon">${icon}</span>` : '';

      // Calculate height based on duration (36px per 15-min slot)
      const rowHeight = 36;
      const slots = Math.ceil(duration / 15);
      const taskHeight = (slots * rowHeight) - 4; // -4 for padding

      // Add compact class for small tasks (15-30 min)
      const compactClass = duration <= 30 ? 'compact' : '';

      return `
        <div class="timeline-task ${typeClass} ${priorityClass} ${currentClass} ${pastClass} ${compactClass}"
             data-task-id="${task.id}"
             data-duration="${duration}"
             draggable="true"
             style="height: ${taskHeight}px; min-height: ${taskHeight}px;">
          ${iconHtml}
          ${priorityDot}
          <span class="timeline-task-name">${this.escapeHtml(task.name)}</span>
          <span class="timeline-task-duration-badge">${duration}m</span>
          <select class="timeline-task-duration-select" data-task-id="${task.id}" title="Change duration">
            <option value="15" ${duration === 15 ? 'selected' : ''}>15m</option>
            <option value="30" ${duration === 30 ? 'selected' : ''}>30m</option>
            <option value="45" ${duration === 45 ? 'selected' : ''}>45m</option>
            <option value="60" ${duration === 60 ? 'selected' : ''}>1h</option>
            <option value="90" ${duration === 90 ? 'selected' : ''}>1.5h</option>
            <option value="120" ${duration === 120 ? 'selected' : ''}>2h</option>
            <option value="180" ${duration === 180 ? 'selected' : ''}>3h</option>
            <option value="240" ${duration === 240 ? 'selected' : ''}>4h</option>
          </select>
          <button class="timeline-task-remove" data-task-id="${task.id}" title="Remove from schedule">×</button>
        </div>
      `;
    }).join('');
  }

  // Task quick-edit popup for timeline
  showTaskQuickEdit(taskId, anchorEl) {
    // Remove any existing popup
    document.getElementById('task-quick-edit')?.remove();

    const task = this.findTask(taskId);
    if (!task) return;

    const rect = anchorEl.getBoundingClientRect();
    const popup = document.createElement('div');
    popup.id = 'task-quick-edit';
    popup.className = 'task-quick-edit-popup';

    // Position popup - try to keep it on screen
    const popupWidth = 280;
    const popupHeight = 320;
    let left = rect.left;
    let top = rect.bottom + 8;

    // Adjust if would go off right edge
    if (left + popupWidth > window.innerWidth - 20) {
      left = window.innerWidth - popupWidth - 20;
    }
    // Adjust if would go off bottom
    if (top + popupHeight > window.innerHeight - 20) {
      top = rect.top - popupHeight - 8;
    }

    popup.style.left = `${left}px`;
    popup.style.top = `${top}px`;

    const currentDuration = task.estimatedMinutes || 30;
    const priorities = ['none', 'low', 'medium', 'high', 'urgent'];

    popup.innerHTML = `
      <div class="quick-edit-header">
        <input type="text" class="quick-edit-name" value="${this.escapeHtml(task.name)}" id="qe-name">
        <button class="quick-edit-close" id="qe-close">×</button>
      </div>

      <div class="quick-edit-section">
        <label>Duration</label>
        <div class="quick-edit-duration-options">
          <button class="duration-opt ${currentDuration === 15 ? 'selected' : ''}" data-minutes="15">15m</button>
          <button class="duration-opt ${currentDuration === 30 ? 'selected' : ''}" data-minutes="30">30m</button>
          <button class="duration-opt ${currentDuration === 45 ? 'selected' : ''}" data-minutes="45">45m</button>
          <button class="duration-opt ${currentDuration === 60 ? 'selected' : ''}" data-minutes="60">1h</button>
          <button class="duration-opt ${currentDuration === 90 ? 'selected' : ''}" data-minutes="90">1.5h</button>
          <button class="duration-opt ${currentDuration === 120 ? 'selected' : ''}" data-minutes="120">2h</button>
        </div>
      </div>

      <div class="quick-edit-section">
        <label>Priority</label>
        <div class="quick-edit-priority-options">
          ${priorities.map(p => `
            <button class="priority-opt ${p} ${task.priority === p ? 'selected' : ''}" data-priority="${p}">
              ${p === 'none' ? '—' : p.charAt(0).toUpperCase()}
            </button>
          `).join('')}
        </div>
      </div>

      <div class="quick-edit-section">
        <label>Time</label>
        <input type="time" class="quick-edit-time" value="${task.scheduledTime || ''}" id="qe-time">
      </div>

      <div class="quick-edit-actions">
        <button class="btn btn-small btn-secondary" id="qe-unschedule">Unschedule</button>
        <button class="btn btn-small btn-secondary" id="qe-details">Full Details</button>
        <button class="btn btn-small btn-primary" id="qe-save">Save</button>
      </div>
    `;

    document.body.appendChild(popup);

    // Focus name input
    const nameInput = popup.querySelector('#qe-name');
    nameInput.focus();
    nameInput.select();

    // Bind duration options
    popup.querySelectorAll('.duration-opt').forEach(opt => {
      opt.addEventListener('click', () => {
        popup.querySelectorAll('.duration-opt').forEach(o => o.classList.remove('selected'));
        opt.classList.add('selected');
      });
    });

    // Bind priority options
    popup.querySelectorAll('.priority-opt').forEach(opt => {
      opt.addEventListener('click', () => {
        popup.querySelectorAll('.priority-opt').forEach(o => o.classList.remove('selected'));
        opt.classList.add('selected');
      });
    });

    // Close button
    popup.querySelector('#qe-close').addEventListener('click', () => popup.remove());

    // Unschedule button
    popup.querySelector('#qe-unschedule').addEventListener('click', () => {
      this.updateTask(taskId, { scheduledTime: null, scheduledDate: null });
      popup.remove();
      this.renderCommandCenter();
    });

    // Full details button
    popup.querySelector('#qe-details').addEventListener('click', () => {
      popup.remove();
      this.openDetailPanel(taskId);
    });

    // Save button
    popup.querySelector('#qe-save').addEventListener('click', () => {
      const newName = popup.querySelector('#qe-name').value.trim();
      const newTime = popup.querySelector('#qe-time').value;
      const selectedDuration = popup.querySelector('.duration-opt.selected');
      const selectedPriority = popup.querySelector('.priority-opt.selected');

      const updates = {};
      if (newName && newName !== task.name) updates.name = newName;
      if (newTime && newTime !== task.scheduledTime) updates.scheduledTime = newTime;
      if (selectedDuration) updates.estimatedMinutes = parseInt(selectedDuration.dataset.minutes);
      if (selectedPriority) updates.priority = selectedPriority.dataset.priority;

      if (Object.keys(updates).length > 0) {
        this.updateTask(taskId, updates);
      }
      popup.remove();
      this.renderCommandCenter();
    });

    // Close on Escape
    const escHandler = (e) => {
      if (e.key === 'Escape') {
        popup.remove();
        document.removeEventListener('keydown', escHandler);
      }
    };
    document.addEventListener('keydown', escHandler);

    // Close on outside click (with delay to prevent immediate close)
    setTimeout(() => {
      const clickHandler = (e) => {
        if (!popup.contains(e.target) && e.target !== anchorEl) {
          popup.remove();
          document.removeEventListener('click', clickHandler);
        }
      };
      document.addEventListener('click', clickHandler);
    }, 100);
  }

  renderTimeGrid() {
    const container = document.getElementById('time-grid-container');
    if (!container) return;

    const today = this.getLocalDateString();
    const allTasks = this.getAllTasks().filter(t =>
      (t.dueDate === today || t.scheduledDate === today) && t.status !== 'done'
    );

    // Build hour slots from 6 AM to 10 PM
    let html = '';
    for (let hour = 6; hour <= 22; hour++) {
      const hourStr = String(hour).padStart(2, '0');
      const displayHour = hour > 12 ? `${hour - 12} PM` : hour === 12 ? '12 PM' : `${hour} AM`;

      // Find tasks scheduled for this hour
      const hourTasks = allTasks.filter(t => {
        if (!t.scheduledTime) return false;
        const [h] = t.scheduledTime.split(':').map(Number);
        return h === hour;
      });

      html += `
        <div class="time-grid-slot" data-hour="${hourStr}:00">
          <div class="time-grid-hour">${displayHour}</div>
          <div class="time-grid-content" data-hour="${hourStr}">
      `;

      if (hourTasks.length > 0) {
        hourTasks.forEach(task => {
          const duration = task.estimatedMinutes || 30;
          const priorityClass = task.priority !== 'none' ? `priority-${task.priority}` : '';
          html += `
            <div class="time-grid-task ${priorityClass}" data-task-id="${task.id}" draggable="true" style="--duration: ${duration}">
              <span class="time-grid-task-name">${this.escapeHtml(task.name)}</span>
              <span class="time-grid-task-duration">${duration}m</span>
            </div>
          `;
        });
      }

      html += `</div></div>`;
    }

    container.innerHTML = html;

    // Make grid slots droppable
    container.querySelectorAll('.time-grid-content').forEach(slot => {
      slot.addEventListener('dragover', (e) => {
        e.preventDefault();
        slot.classList.add('drag-over');
      });

      slot.addEventListener('dragleave', () => {
        slot.classList.remove('drag-over');
      });

      slot.addEventListener('drop', (e) => {
        e.preventDefault();
        slot.classList.remove('drag-over');
        const taskId = e.dataTransfer.getData('text/plain');
        const hour = slot.dataset.hour;
        if (taskId && hour) {
          this.updateTask(taskId, {
            scheduledTime: `${hour}:00`,
            scheduledDate: this.getLocalDateString()
          });
          this.renderCommandCenter();
        }
      });
    });

    // Make tasks draggable
    container.querySelectorAll('.time-grid-task').forEach(taskEl => {
      taskEl.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('text/plain', taskEl.dataset.taskId);
        taskEl.classList.add('dragging');
      });

      taskEl.addEventListener('dragend', () => {
        taskEl.classList.remove('dragging');
      });

      taskEl.addEventListener('click', () => {
        this.openDetailPanel(taskEl.dataset.taskId);
      });
    });
  }

  toggleTimeGrid() {
    const gridEl = document.getElementById('cc-time-grid');
    const scheduleEl = document.getElementById('cc-schedule');
    const toggleBtn = document.getElementById('cc-toggle-grid');

    if (gridEl && scheduleEl) {
      const showGrid = gridEl.classList.contains('hidden');
      gridEl.classList.toggle('hidden', !showGrid);
      scheduleEl.classList.toggle('hidden', showGrid);

      if (toggleBtn) {
        toggleBtn.textContent = showGrid ? 'List' : 'Grid';
      }

      if (showGrid) {
        this.renderTimeGrid();
      }
    }
  }

  updateTimelineHeader() {
    // Always single-track mode - no header update needed
    const headerTracks = document.getElementById('timeline-header-tracks');
    if (headerTracks) {
      headerTracks.innerHTML = 'SCHEDULED';
    }
  }

  renderRecapsView() {
    const container = document.getElementById('task-list-view');
    if (!container) return;

    const allTasks = this.getAllTasks(true); // include completed
    const completedTasks = allTasks
      .filter(t => t.status === 'done' && t.completedAt)
      .sort((a, b) => new Date(b.completedAt) - new Date(a.completedAt));

    let html = `<div class="recaps-view recaps-clean">
      <div class="recaps-header">
        <h2>Completed</h2>
      </div>`;

    if (completedTasks.length === 0) {
      html += `
        <div class="recaps-empty">
          <div class="empty-icon">&#10003;</div>
          <p>No completed tasks yet</p>
        </div>`;
    } else {
      // Group by date
      const byDate = {};
      completedTasks.forEach(t => {
        const date = this.isoToLocalDate(t.completedAt);
        if (!byDate[date]) byDate[date] = [];
        byDate[date].push(t);
      });

      html += '<div class="completed-list-grouped">';
      Object.keys(byDate).forEach(date => {
        const dateLabel = this.formatRecapDate(date);
        const tasks = byDate[date];
        html += `<div class="completed-date-group">
          <div class="completed-date-header">${dateLabel} <span class="completed-date-count">${tasks.length}</span></div>`;
        tasks.forEach(task => {
          const project = this.data.projects.find(p => p.tasks.some(pt => pt.id === task.id));
          const projectName = project && !project.isInbox ? project.name : '';
          html += `
            <div class="completed-item" data-task-id="${task.id}">
              <span class="completed-item-check">&#10003;</span>
              <div class="completed-item-info">
                <span class="completed-item-name">${this.escapeHtml(task.name)}</span>
                ${projectName ? `<span class="completed-item-project">${this.escapeHtml(projectName)}</span>` : ''}
              </div>
              ${task.completionSummary ? `<span class="completed-item-summary">${this.escapeHtml(task.completionSummary)}</span>` : ''}
            </div>`;
        });
        html += '</div>';
      });
      html += '</div>';
    }

    html += '</div>';
    container.innerHTML = html;

    // Click to open task detail
    container.querySelectorAll('.completed-item').forEach(item => {
      item.addEventListener('click', () => {
        this.openDetailPanel(item.dataset.taskId);
      });
    });
  }

  renderRecaps() {
    const container = document.getElementById('cc-recaps-list');
    if (!container) return;

    // Initialize data structures if needed
    if (!this.data.recapLog) this.data.recapLog = [];
    if (!this.data.savedRecaps) this.data.savedRecaps = [];

    // Check which tab is active
    const activeTab = document.querySelector('.cc-recap-tab.active');
    const tabType = activeTab ? activeTab.dataset.tab : 'log';

    if (tabType === 'log') {
      this.renderRecapLog(container);
    } else {
      this.renderSavedRecaps(container);
    }

    // Bind tab events
    document.querySelectorAll('.cc-recap-tab').forEach(tab => {
      tab.onclick = () => {
        document.querySelectorAll('.cc-recap-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        this.renderRecaps();
      };
    });

    // Bind add entry button
    const addEntryBtn = document.getElementById('cc-add-entry-btn');
    if (addEntryBtn) {
      addEntryBtn.onclick = () => this.openAddRecapEntryModal();
    }

    // Bind save recap button
    const saveRecapBtn = document.getElementById('cc-save-recap-btn');
    if (saveRecapBtn) {
      saveRecapBtn.onclick = () => this.openSaveRecapModal();
    }
  }

  // Today's Completions - Shows tasks completed today
  renderCompletions() {
    const container = document.getElementById('cc-completions-list');
    const countEl = document.getElementById('cc-completions-count');
    if (!container) return;

    const today = this.getLocalDateString();
    const allTasks = this.getAllTasks();

    // Get tasks completed today
    const completedToday = allTasks.filter(t =>
      t.status === 'done' &&
      t.completedAt &&
      this.isoToLocalDate(t.completedAt) === today
    );

    // Update count
    if (countEl) {
      countEl.textContent = `${completedToday.length} done`;
    }

    if (completedToday.length === 0) {
      container.innerHTML = `
        <div class="cc-empty-state">
          <p>No completed tasks yet today.</p>
          <p class="cc-empty-hint">Complete tasks from your Focus Queue to see them here!</p>
        </div>
      `;
      return;
    }

    // Sort by completion time (most recent first)
    completedToday.sort((a, b) => new Date(b.completedAt) - new Date(a.completedAt));

    container.innerHTML = completedToday.map(task => {
      const project = this.data.projects.find(p => p.tasks.some(t => t.id === task.id));
      const projectName = project && !project.isInbox ? project.name : '';
      const completedTime = new Date(task.completedAt);
      const timeStr = completedTime.toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true
      });

      const hasSummary = task.completionSummary && task.completionSummary.trim();

      return `
        <div class="cc-completion-item ${hasSummary ? 'has-summary' : ''}" data-task-id="${task.id}">
          <div class="cc-completion-main">
            <div class="cc-completion-check">✓</div>
            <div class="cc-completion-content">
              <div class="cc-completion-name">${this.escapeHtml(task.name)}</div>
              <div class="cc-completion-meta">
                ${projectName ? `<span class="cc-completion-project">${this.escapeHtml(projectName)}</span>` : ''}
                <span class="cc-completion-time">${timeStr}</span>
              </div>
            </div>
            <div class="cc-completion-actions">
              <button class="cc-completion-summary-btn" data-task-id="${task.id}" title="${hasSummary ? 'Edit note' : 'Add a note about what was accomplished'}">
                ${hasSummary ? '📝 Edit' : '📝 Note'}
              </button>
              <button class="cc-completion-undo-btn" data-task-id="${task.id}" title="Mark as incomplete">Undo</button>
            </div>
          </div>
          ${hasSummary ? `
            <div class="cc-completion-summary">
              <div class="cc-completion-summary-text">${this.escapeHtml(task.completionSummary)}</div>
            </div>
          ` : ''}
        </div>
      `;
    }).join('');

    // Bind undo buttons
    container.querySelectorAll('.cc-completion-undo-btn').forEach(btn => {
      btn.onclick = (e) => {
        e.stopPropagation();
        const taskId = btn.dataset.taskId;
        this.updateTask(taskId, { status: 'todo', completedAt: null });
        this.renderCompletions();
        this.renderFocusQueue();
        this.updateCommandCenterStats();
        this.renderDualTrackTimeline();
      };
    });

    // Bind summary buttons
    container.querySelectorAll('.cc-completion-summary-btn').forEach(btn => {
      btn.onclick = (e) => {
        e.stopPropagation();
        const taskId = btn.dataset.taskId;
        this.openCompletionSummaryModal(taskId);
      };
    });

    // Click on summary text to edit
    container.querySelectorAll('.cc-completion-summary').forEach(summary => {
      summary.onclick = (e) => {
        e.stopPropagation();
        const taskId = summary.closest('.cc-completion-item').dataset.taskId;
        this.openCompletionSummaryModal(taskId);
      };
    });
  }

  openCompletionSummaryModal(taskId) {
    const task = this.findTask(taskId);
    if (!task) return;

    const existingSummary = task.completionSummary || '';

    // Create modal
    const modalHtml = `
      <div class="completion-summary-modal" id="completion-summary-modal">
        <div class="completion-summary-dialog">
          <div class="completion-summary-header">
            <h3>Completion Summary</h3>
            <button class="modal-close-btn" id="close-summary-modal">×</button>
          </div>
          <div class="completion-summary-task-name">${this.escapeHtml(task.name)}</div>
          <textarea
            class="completion-summary-input"
            id="completion-summary-input"
            placeholder="What was accomplished? Any decisions made or learnings?"
            rows="4"
          >${this.escapeHtml(existingSummary)}</textarea>
          <div class="completion-summary-footer">
            <button class="btn btn-secondary" id="cancel-summary">Cancel</button>
            <button class="btn btn-primary" id="save-summary">Save</button>
          </div>
        </div>
      </div>
    `;

    // Remove existing modal if any
    const existingModal = document.getElementById('completion-summary-modal');
    if (existingModal) existingModal.remove();

    document.body.insertAdjacentHTML('beforeend', modalHtml);

    const modal = document.getElementById('completion-summary-modal');
    const input = document.getElementById('completion-summary-input');

    // Focus input
    setTimeout(() => input.focus(), 100);

    // Close handlers
    document.getElementById('close-summary-modal').onclick = () => modal.remove();
    document.getElementById('cancel-summary').onclick = () => modal.remove();
    modal.onclick = (e) => { if (e.target === modal) modal.remove(); };

    // Save handler
    document.getElementById('save-summary').onclick = () => {
      const summary = input.value.trim();
      this.updateTask(taskId, { completionSummary: summary });
      modal.remove();
      this.renderCompletions();
    };

    // Enter to save (Ctrl+Enter for multiline)
    input.onkeydown = (e) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        document.getElementById('save-summary').click();
      }
      if (e.key === 'Escape') {
        modal.remove();
      }
    };
  }

  // View toggle between Command Center and List view
  bindViewToggle() {
    const toggleBtns = document.querySelectorAll('.cc-view-btn');
    const commandCenterMode = document.getElementById('cc-command-center-mode');
    const listMode = document.getElementById('cc-list-mode');

    toggleBtns.forEach(btn => {
      btn.onclick = () => {
        const viewMode = btn.dataset.viewMode;

        // Update active button
        toggleBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');

        // Toggle visibility
        if (viewMode === 'command-center') {
          if (commandCenterMode) commandCenterMode.classList.remove('hidden');
          if (listMode) listMode.classList.add('hidden');
        } else if (viewMode === 'list') {
          if (commandCenterMode) commandCenterMode.classList.add('hidden');
          if (listMode) listMode.classList.remove('hidden');
          this.renderListView();
        }
      };
    });

    // Bind add task button in list view
    const listAddBtn = document.getElementById('cc-list-add-task');
    if (listAddBtn) {
      listAddBtn.onclick = () => this.openTaskModal();
    }
  }

  // Simple list view of today's tasks
  renderListView() {
    const container = document.getElementById('cc-list-tasks');
    if (!container) return;

    const today = this.getLocalDateString();
    const allTasks = this.getAllTasks();

    // Get tasks for today (due today, scheduled today, overdue, or completed today)
    // Include completed tasks - they'll be shown crossed off at the bottom
    const todayTasks = allTasks.filter(t => {
      const isDueToday = t.dueDate === today;
      const isScheduledToday = t.scheduledDate === today;
      const isOverdue = t.dueDate && t.dueDate < today && t.status !== 'done';
      const isCompletedToday = t.status === 'done' && t.completedAt &&
                               this.isoToLocalDate(t.completedAt) === today;

      return isDueToday || isScheduledToday || isOverdue || isCompletedToday;
    });

    // Sort: incomplete tasks by scheduled time (soonest first), completed at bottom by scheduled time
    todayTasks.sort((a, b) => {
      // Completed tasks always at the bottom
      const aComplete = a.status === 'done';
      const bComplete = b.status === 'done';
      if (aComplete && !bComplete) return 1;
      if (!aComplete && bComplete) return -1;

      // Both completed - sort by scheduled time (earliest first), then by completion time
      if (aComplete && bComplete) {
        const aSchedTime = a.scheduledTime || '99:99';
        const bSchedTime = b.scheduledTime || '99:99';
        if (aSchedTime !== bSchedTime) {
          return aSchedTime.localeCompare(bSchedTime);
        }
        // If same scheduled time, sort by when completed
        return new Date(a.completedAt) - new Date(b.completedAt);
      }

      // Both incomplete - sort by scheduled time (soonest first)
      const aTime = a.scheduledTime || '99:99';
      const bTime = b.scheduledTime || '99:99';
      return aTime.localeCompare(bTime);
    });

    if (todayTasks.length === 0) {
      container.innerHTML = `
        <div class="cc-empty-state">
          <p>No tasks for today.</p>
          <p class="cc-empty-hint">Add tasks or schedule some for today!</p>
        </div>
      `;
      return;
    }

    container.innerHTML = todayTasks.map(task => {
      const project = this.data.projects.find(p => p.tasks.some(t => t.id === task.id));
      const projectName = project && !project.isInbox ? project.name : '';
      const isOverdue = task.dueDate && task.dueDate < today && task.status !== 'done';
      const isComplete = task.status === 'done';
      const isInProgress = task.status === 'in-progress';

      // Status class for glow effect
      let statusClass = '';
      if (isComplete) statusClass = 'completed';
      else if (isOverdue) statusClass = 'overdue';
      else if (isInProgress) statusClass = 'in-progress';

      let timeInfo = '';
      if (task.scheduledTime) {
        const [h, m] = task.scheduledTime.split(':').map(Number);
        const displayTime = h > 12 ? `${h - 12}:${String(m).padStart(2, '0')} PM` :
                           h === 12 ? `12:${String(m).padStart(2, '0')} PM` :
                           `${h}:${String(m).padStart(2, '0')} AM`;
        timeInfo = `<span class="cc-list-time">📅 ${displayTime}</span>`;
      }

      // Subtasks section
      const subtasks = task.subtasks || [];
      const hasSubtasks = subtasks.length > 0;
      const completedSubtasks = subtasks.filter(s => s.completed).length;

      let subtasksHtml = '';
      if (hasSubtasks) {
        subtasksHtml = `
          <div class="cc-list-subtasks collapsed" data-task-id="${task.id}">
            <button class="cc-list-subtasks-toggle" data-task-id="${task.id}">
              <span class="subtasks-chevron">▶</span>
              <span class="subtasks-count">${completedSubtasks}/${subtasks.length} subtasks</span>
            </button>
            <div class="cc-list-subtasks-items">
              ${subtasks.map(sub => `
                <div class="cc-list-subtask ${sub.completed ? 'completed' : ''}" data-subtask-id="${sub.id}" data-task-id="${task.id}">
                  <span class="subtask-check">${sub.completed ? '✓' : ''}</span>
                  <span class="subtask-name">${this.escapeHtml(sub.name)}</span>
                </div>
              `).join('')}
            </div>
          </div>
        `;
      }

      return `
        <div class="cc-list-item ${statusClass} ${hasSubtasks ? 'has-subtasks' : ''}" data-task-id="${task.id}">
          <button class="cc-list-check ${isComplete ? 'checked' : ''}" data-action="${isComplete ? 'uncomplete' : 'complete'}" data-task-id="${task.id}" title="${isComplete ? 'Mark incomplete' : 'Mark complete'}">
            ${isComplete ? '✓' : ''}
          </button>
          <div class="cc-list-content">
            <div class="cc-list-name">${this.escapeHtml(task.name)}</div>
            <div class="cc-list-meta">
              ${projectName ? `<span class="cc-list-project">${this.escapeHtml(projectName)}</span>` : ''}
              ${timeInfo}
              ${isOverdue ? '<span class="cc-list-overdue">Overdue</span>' : ''}
            </div>
            ${subtasksHtml}
          </div>
          <button class="cc-list-edit" data-task-id="${task.id}" title="Edit task">✎</button>
        </div>
      `;
    }).join('');

    // Bind events for list items
    container.querySelectorAll('.cc-list-check').forEach(btn => {
      btn.onclick = (e) => {
        e.stopPropagation();
        const taskId = btn.dataset.taskId;
        const action = btn.dataset.action;
        if (action === 'complete') {
          this.updateTask(taskId, { status: 'done' });
        } else {
          this.updateTask(taskId, { status: 'todo', completedAt: null });
        }
        this.renderListView();
        this.updateCommandCenterStats();
        this.renderCompletions();
        this.refreshCommandCenter();
      };
    });

    container.querySelectorAll('.cc-list-edit').forEach(btn => {
      btn.onclick = (e) => {
        e.stopPropagation();
        const taskId = btn.dataset.taskId;
        this.openTaskModal(taskId);
      };
    });

    // Click on task bar to toggle completion (but not on subtasks area)
    container.querySelectorAll('.cc-list-item').forEach(item => {
      item.onclick = (e) => {
        // Don't toggle if clicking on subtasks section
        if (e.target.closest('.cc-list-subtasks')) return;

        const taskId = item.dataset.taskId;
        const task = this.findTask(taskId);
        if (task) {
          if (task.status === 'done') {
            this.updateTask(taskId, { status: 'todo', completedAt: null });
          } else {
            this.updateTask(taskId, { status: 'done' });
          }
          this.renderListView();
          this.updateCommandCenterStats();
          this.renderCompletions();
          this.refreshCommandCenter();
        }
      };
    });

    // Toggle subtasks collapse
    container.querySelectorAll('.cc-list-subtasks-toggle').forEach(btn => {
      btn.onclick = (e) => {
        e.stopPropagation();
        const subtasksContainer = btn.closest('.cc-list-subtasks');
        subtasksContainer.classList.toggle('collapsed');
      };
    });

    // Click subtask to toggle completion
    container.querySelectorAll('.cc-list-subtask').forEach(sub => {
      sub.onclick = (e) => {
        e.stopPropagation();
        const taskId = sub.dataset.taskId;
        const subtaskId = sub.dataset.subtaskId;
        const task = this.findTask(taskId);
        if (task && task.subtasks) {
          const subtask = task.subtasks.find(s => s.id === subtaskId);
          if (subtask) {
            subtask.completed = !subtask.completed;
            this.saveData();
            this.renderListView();
          }
        }
      };
    });
  }

  renderRecapLog(container) {
    const entries = this.data.recapLog || [];

    if (entries.length === 0) {
      container.innerHTML = `
        <div class="cc-empty-state">
          <p>No entries logged yet.</p>
          <p class="cc-empty-hint">Log accomplishments, decisions, and notes as you work.</p>
        </div>
      `;
      return;
    }

    // Sort by date descending, then by createdAt
    const sorted = [...entries].sort((a, b) => {
      if (b.date !== a.date) return b.date.localeCompare(a.date);
      return new Date(b.createdAt) - new Date(a.createdAt);
    });

    // Group by date
    const byDate = {};
    sorted.forEach(entry => {
      if (!byDate[entry.date]) byDate[entry.date] = [];
      byDate[entry.date].push(entry);
    });

    const typeEmoji = {
      accomplishment: '✓',
      decision: '⚖',
      note: '📝'
    };

    const typeClass = {
      accomplishment: 'success',
      decision: 'accent',
      note: 'muted'
    };

    let html = '';
    const dates = Object.keys(byDate).slice(0, 7); // Last 7 days with entries

    dates.forEach(date => {
      const dateLabel = this.formatRecapDate(date);
      html += `<div class="cc-recap-date-group">
        <div class="cc-recap-date-header">${dateLabel}</div>`;

      byDate[date].forEach(entry => {
        html += `
          <div class="cc-recap-entry ${typeClass[entry.type]}" data-entry-id="${entry.id}">
            <span class="cc-recap-type-icon">${typeEmoji[entry.type]}</span>
            <div class="cc-recap-entry-content">
              <span class="cc-recap-entry-text">${this.escapeHtml(entry.content)}</span>
              ${entry.tags && entry.tags.length > 0 ? `<span class="cc-recap-tags">${entry.tags.map(t => `#${t}`).join(' ')}</span>` : ''}
            </div>
            <button class="cc-recap-delete-btn" title="Delete entry">&times;</button>
          </div>
        `;
      });

      html += '</div>';
    });

    container.innerHTML = html;

    // Bind delete buttons
    container.querySelectorAll('.cc-recap-delete-btn').forEach(btn => {
      btn.onclick = (e) => {
        e.stopPropagation();
        const entryId = btn.closest('.cc-recap-entry').dataset.entryId;
        this.deleteRecapEntry(entryId);
      };
    });
  }

  renderSavedRecaps(container) {
    const recaps = this.data.savedRecaps || [];

    if (recaps.length === 0) {
      container.innerHTML = `
        <div class="cc-empty-state">
          <p>No saved recaps yet.</p>
          <p class="cc-empty-hint">Click "Save Recap" to create a daily, weekly, or monthly summary.</p>
        </div>
      `;
      return;
    }

    // Sort by savedAt descending
    const sorted = [...recaps].sort((a, b) => new Date(b.savedAt) - new Date(a.savedAt));

    const periodIcon = {
      daily: '📅',
      weekly: '📆',
      monthly: '🗓'
    };

    container.innerHTML = sorted.slice(0, 10).map(recap => {
      const savedDate = new Date(recap.savedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      return `
        <div class="cc-saved-recap-card" data-recap-id="${recap.id}">
          <div class="cc-saved-recap-header">
            <span class="cc-saved-recap-icon">${periodIcon[recap.period] || '📊'}</span>
            <span class="cc-saved-recap-label">${this.escapeHtml(recap.periodLabel)}</span>
            <span class="cc-saved-recap-type">${recap.period}</span>
          </div>
          <div class="cc-saved-recap-stats">
            <span>${recap.stats?.tasksCompleted || 0} tasks</span>
            <span>${recap.stats?.accomplishments || 0} accomplishments</span>
            <span>${recap.stats?.decisions || 0} decisions</span>
          </div>
          <div class="cc-saved-recap-footer">
            <span class="cc-saved-recap-date">Saved ${savedDate}</span>
          </div>
        </div>
      `;
    }).join('');

    // Bind click to view full recap
    container.querySelectorAll('.cc-saved-recap-card').forEach(card => {
      card.onclick = () => {
        const recapId = card.dataset.recapId;
        this.showSavedRecapDetail(recapId);
      };
    });
  }

  openAddRecapEntryModal() {
    const modalHtml = `
      <div class="modal-overlay active" id="recap-entry-modal">
        <div class="modal" style="max-width: 500px;">
          <div class="modal-header">
            <h3>Log Entry</h3>
            <button class="modal-close" id="close-recap-entry-modal">&times;</button>
          </div>
          <div class="modal-body">
            <div class="form-group">
              <label>Type</label>
              <div class="recap-type-buttons">
                <button class="recap-type-btn active" data-type="accomplishment">✓ Accomplishment</button>
                <button class="recap-type-btn" data-type="decision">⚖ Decision</button>
                <button class="recap-type-btn" data-type="note">📝 Note</button>
              </div>
            </div>
            <div class="form-group">
              <label>What happened?</label>
              <textarea id="recap-entry-content" rows="3" placeholder="Describe what was accomplished, decided, or noted..."></textarea>
            </div>
            <div class="form-group">
              <label>Tags (optional, comma-separated)</label>
              <input type="text" id="recap-entry-tags" placeholder="e.g., frontend, bugfix, planning">
            </div>
          </div>
          <div class="modal-footer">
            <button class="btn btn-secondary" id="cancel-recap-entry">Cancel</button>
            <button class="btn btn-primary" id="save-recap-entry">Save Entry</button>
          </div>
        </div>
      </div>
    `;

    document.body.insertAdjacentHTML('beforeend', modalHtml);

    let selectedType = 'accomplishment';

    // Type button handlers
    document.querySelectorAll('.recap-type-btn').forEach(btn => {
      btn.onclick = () => {
        document.querySelectorAll('.recap-type-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        selectedType = btn.dataset.type;
      };
    });

    // Close handlers
    const closeModal = () => {
      document.getElementById('recap-entry-modal').remove();
    };

    document.getElementById('close-recap-entry-modal').onclick = closeModal;
    document.getElementById('cancel-recap-entry').onclick = closeModal;

    // Save handler
    document.getElementById('save-recap-entry').onclick = async () => {
      const content = document.getElementById('recap-entry-content').value.trim();
      if (!content) return;

      const tagsInput = document.getElementById('recap-entry-tags').value.trim();
      const tags = tagsInput ? tagsInput.split(',').map(t => t.trim()).filter(Boolean) : [];

      const entry = {
        id: this.generateId(),
        type: selectedType,
        content: content,
        date: this.getLocalDateString(),
        tags: tags,
        createdAt: new Date().toISOString()
      };

      if (!this.data.recapLog) this.data.recapLog = [];
      this.data.recapLog.push(entry);
      await this.saveData();

      closeModal();
      this.renderRecaps();
    };
  }

  openSaveRecapModal() {
    const today = this.getLocalDateString();

    const modalHtml = `
      <div class="modal-overlay active" id="save-recap-modal">
        <div class="modal" style="max-width: 500px;">
          <div class="modal-header">
            <h3>Save Recap</h3>
            <button class="modal-close" id="close-save-recap-modal">&times;</button>
          </div>
          <div class="modal-body">
            <div class="form-group">
              <label>Period</label>
              <div class="recap-type-buttons">
                <button class="recap-period-btn active" data-period="daily">📅 Daily</button>
                <button class="recap-period-btn" data-period="weekly">📆 Weekly</button>
                <button class="recap-period-btn" data-period="monthly">🗓 Monthly</button>
              </div>
            </div>
            <div class="form-group">
              <label>Reference Date</label>
              <input type="date" id="recap-date" value="${today}">
            </div>
            <div class="form-group">
              <label>Summary (optional)</label>
              <textarea id="recap-summary" rows="2" placeholder="Executive summary or highlights..."></textarea>
            </div>
          </div>
          <div class="modal-footer">
            <button class="btn btn-secondary" id="cancel-save-recap">Cancel</button>
            <button class="btn btn-primary" id="confirm-save-recap">Generate & Save</button>
          </div>
        </div>
      </div>
    `;

    document.body.insertAdjacentHTML('beforeend', modalHtml);

    let selectedPeriod = 'daily';

    // Period button handlers
    document.querySelectorAll('.recap-period-btn').forEach(btn => {
      btn.onclick = () => {
        document.querySelectorAll('.recap-period-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        selectedPeriod = btn.dataset.period;
      };
    });

    // Close handlers
    const closeModal = () => {
      document.getElementById('save-recap-modal').remove();
    };

    document.getElementById('close-save-recap-modal').onclick = closeModal;
    document.getElementById('cancel-save-recap').onclick = closeModal;

    // Save handler
    document.getElementById('confirm-save-recap').onclick = async () => {
      const refDate = document.getElementById('recap-date').value;
      const summary = document.getElementById('recap-summary').value.trim();

      const recap = this.generateRecap(selectedPeriod, refDate, summary);

      if (!this.data.savedRecaps) this.data.savedRecaps = [];
      this.data.savedRecaps.push(recap);
      await this.saveData();

      closeModal();

      // Switch to saved tab and render
      document.querySelectorAll('.cc-recap-tab').forEach(t => t.classList.remove('active'));
      document.querySelector('.cc-recap-tab[data-tab="saved"]').classList.add('active');
      this.renderRecaps();

      // Show the recap
      this.showSavedRecapDetail(recap.id);
    };
  }

  generateRecap(period, refDateStr, summary) {
    const refDate = new Date(refDateStr + 'T12:00:00');
    let startDate, endDate, periodLabel;

    if (period === 'daily') {
      startDate = refDateStr;
      endDate = refDateStr;
      periodLabel = refDateStr;
    } else if (period === 'weekly') {
      const dayOfWeek = refDate.getDay();
      const weekStart = new Date(refDate);
      weekStart.setDate(refDate.getDate() - dayOfWeek);
      const weekEnd = new Date(weekStart);
      weekEnd.setDate(weekStart.getDate() + 6);
      startDate = this.getLocalDateString(weekStart);
      endDate = this.getLocalDateString(weekEnd);
      periodLabel = `Week of ${startDate}`;
    } else {
      startDate = new Date(refDate.getFullYear(), refDate.getMonth(), 1).toISOString().split('T')[0];
      endDate = new Date(refDate.getFullYear(), refDate.getMonth() + 1, 0).toISOString().split('T')[0];
      periodLabel = refDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    }

    // Gather completed tasks
    const allTasks = this.getAllTasks();
    const completedTasks = allTasks.filter(t => {
      if (!t.completedAt) return false;
      const completed = t.completedAt.split('T')[0];
      return completed >= startDate && completed <= endDate;
    });

    // Gather recap log entries
    const logEntries = (this.data.recapLog || []).filter(entry => {
      return entry.date >= startDate && entry.date <= endDate;
    });

    const accomplishments = logEntries.filter(e => e.type === 'accomplishment');
    const decisions = logEntries.filter(e => e.type === 'decision');
    const notes = logEntries.filter(e => e.type === 'note');

    // Build content
    let content = `# ${period.charAt(0).toUpperCase() + period.slice(1)} Recap: ${periodLabel}\n\n`;
    content += `*Generated: ${new Date().toISOString()}*\n\n`;

    if (summary) {
      content += `## Summary\n${summary}\n\n`;
    }

    content += `## Overview\n`;
    content += `- **Period:** ${startDate} to ${endDate}\n`;
    content += `- **Tasks Completed:** ${completedTasks.length}\n`;
    content += `- **Accomplishments Logged:** ${accomplishments.length}\n`;
    content += `- **Decisions Made:** ${decisions.length}\n\n`;

    if (completedTasks.length > 0) {
      content += `## Completed Tasks\n`;
      completedTasks.forEach(t => {
        content += `- ✓ ${t.name}\n`;
      });
      content += `\n`;
    }

    if (accomplishments.length > 0) {
      content += `## Accomplishments\n`;
      accomplishments.forEach(a => {
        content += `- ${a.content}\n`;
      });
      content += `\n`;
    }

    if (decisions.length > 0) {
      content += `## Decisions Made\n`;
      decisions.forEach(d => {
        content += `- ⚖ ${d.content}\n`;
      });
      content += `\n`;
    }

    if (notes.length > 0) {
      content += `## Notes\n`;
      notes.forEach(n => {
        content += `- ${n.content}\n`;
      });
      content += `\n`;
    }

    return {
      id: this.generateId(),
      period,
      periodLabel,
      startDate,
      endDate,
      content,
      stats: {
        tasksCompleted: completedTasks.length,
        accomplishments: accomplishments.length,
        decisions: decisions.length,
        notes: notes.length
      },
      savedAt: new Date().toISOString()
    };
  }

  deleteRecapEntry(entryId) {
    if (!this.data.recapLog) return;

    const index = this.data.recapLog.findIndex(e => e.id === entryId);
    if (index !== -1) {
      this.data.recapLog.splice(index, 1);
      this.saveData();
      this.renderRecaps();
    }
  }

  showSavedRecapDetail(recapId) {
    const recap = (this.data.savedRecaps || []).find(r => r.id === recapId);
    if (!recap) return;

    // Convert markdown-ish content to HTML for display
    const contentHtml = recap.content
      .replace(/^# (.+)$/gm, '<h2>$1</h2>')
      .replace(/^## (.+)$/gm, '<h3>$1</h3>')
      .replace(/^\*(.+)\*$/gm, '<em>$1</em>')
      .replace(/^\- (.+)$/gm, '<li>$1</li>')
      .replace(/\n\n/g, '</p><p>')
      .replace(/<\/li>\n<li>/g, '</li><li>');

    const modalHtml = `
      <div class="modal-overlay active" id="recap-detail-modal">
        <div class="modal" style="max-width: 600px; max-height: 80vh;">
          <div class="modal-header">
            <h3>${this.escapeHtml(recap.periodLabel)}</h3>
            <button class="modal-close" id="close-recap-detail">&times;</button>
          </div>
          <div class="modal-body" style="overflow-y: auto; max-height: 60vh;">
            <div class="recap-detail-content">${contentHtml}</div>
          </div>
          <div class="modal-footer">
            <button class="btn btn-secondary" id="close-recap-detail-btn">Close</button>
          </div>
        </div>
      </div>
    `;

    document.body.insertAdjacentHTML('beforeend', modalHtml);

    const closeModal = () => {
      document.getElementById('recap-detail-modal').remove();
    };

    document.getElementById('close-recap-detail').onclick = closeModal;
    document.getElementById('close-recap-detail-btn').onclick = closeModal;
  }

  renderStars(rating) {
    if (!rating) return '<span class="cc-recap-star">No rating</span>';
    let stars = '';
    for (let i = 1; i <= 5; i++) {
      stars += `<span class="cc-recap-star ${i <= rating ? 'filled' : ''}">★</span>`;
    }
    return stars;
  }

  formatRecapDate(dateStr) {
    const today = this.getLocalDateString();
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = this.getLocalDateString(yesterday);

    if (dateStr === today) return 'Today';
    if (dateStr === yesterdayStr) return 'Yesterday';

    const date = new Date(dateStr + 'T00:00:00');
    return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  }

  showRecapDetail(dateStr) {
    const review = (this.data.reviews || []).find(r => r.date === dateStr);
    if (!review) return;

    const dateLabel = this.formatRecapDate(review.date);
    const stars = this.renderStars(review.rating);

    // Create a simple modal or alert for now
    const content = `
      <strong>${dateLabel}</strong><br><br>
      <strong>Rating:</strong> ${review.rating ? review.rating + '/5' : 'Not rated'}<br><br>
      <strong>Learnings:</strong><br>${review.learnings || 'None recorded'}
    `;

    // Use existing modal infrastructure
    document.getElementById('confirm-title').textContent = 'Daily Recap';
    document.getElementById('confirm-message').innerHTML = content;
    document.getElementById('confirm-ok').style.display = 'none';
    document.getElementById('confirm-cancel').textContent = 'Close';
    this.openModal('confirm-modal');

    // Reset after close
    document.getElementById('confirm-cancel').onclick = () => {
      this.closeModal('confirm-modal');
      document.getElementById('confirm-ok').style.display = '';
      document.getElementById('confirm-cancel').textContent = 'Cancel';
    };
  }

  formatRelativeTime(dateString) {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  // Daily Review Methods
  openDailyReview() {
    const today = this.getLocalDateString();
    const allTasks = this.getAllTasks();

    // Get today's completed tasks
    const completedToday = allTasks.filter(t =>
      t.status === 'done' &&
      t.completedAt &&
      this.isoToLocalDate(t.completedAt) === today
    );

    // Populate accomplishments
    const accomplishmentsContainer = document.getElementById('review-accomplishments');
    if (accomplishmentsContainer) {
      if (completedToday.length > 0) {
        accomplishmentsContainer.innerHTML = completedToday.map(task => `
          <div class="review-task-item">
            <span class="review-task-check">✓</span>
            <span class="review-task-name">${this.escapeHtml(task.name)}</span>
          </div>
        `).join('');
      } else {
        accomplishmentsContainer.innerHTML = '<div class="review-empty">No tasks completed today yet</div>';
      }
    }

    // Calculate focus time
    const focusMinutes = this.focusMode.pomodoroCount * (this.focusMode.workDuration / 60);
    const focusHours = Math.floor(focusMinutes / 60);
    const remainingMins = Math.round(focusMinutes % 60);

    const totalTimeEl = document.getElementById('review-total-time');
    if (totalTimeEl) {
      totalTimeEl.textContent = focusHours > 0 ? `${focusHours}h ${remainingMins}m` : `${remainingMins}m`;
    }

    const pomodorosEl = document.getElementById('review-pomodoros');
    if (pomodorosEl) {
      pomodorosEl.textContent = this.focusMode.pomodoroCount;
    }

    // Clear previous inputs
    const learningsEl = document.getElementById('review-learnings');
    if (learningsEl) learningsEl.value = '';

    // Clear tomorrow task inputs
    ['tomorrow-1', 'tomorrow-2', 'tomorrow-3'].forEach(id => {
      const input = document.getElementById(id);
      if (input) input.value = '';
    });

    // Reset rating
    document.querySelectorAll('.rating-btn').forEach(btn => btn.classList.remove('selected'));

    this.openModal('daily-review-modal');
  }

  saveDailyReview() {
    const learningsEl = document.getElementById('review-learnings');
    const learnings = learningsEl ? learningsEl.value.trim() : '';
    const rating = document.querySelector('.rating-btn.selected')?.dataset.rating || null;

    // Store review data
    if (!this.data.reviews) this.data.reviews = [];

    this.data.reviews.push({
      id: this.generateId(),
      date: this.getLocalDateString(),
      learnings,
      rating: rating ? parseInt(rating) : null,
      createdAt: new Date().toISOString()
    });

    // Create tomorrow's tasks from individual inputs
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowDate = this.getLocalDateString(tomorrow);

    ['tomorrow-1', 'tomorrow-2', 'tomorrow-3'].forEach((id, index) => {
      const input = document.getElementById(id);
      const taskName = input ? input.value.trim() : '';
      if (taskName) {
        this.createTask({
          name: taskName,
          dueDate: tomorrowDate,
          status: 'todo',
          priority: index === 0 ? 'high' : (index === 1 ? 'medium' : 'low')
        });
      }
    });

    this.saveData();
    this.closeModal('daily-review-modal');
    this.render();
  }


  // Utilities
  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  formatDate(dateString) {
    const date = new Date(dateString + 'T00:00:00');
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const taskDate = new Date(date);
    taskDate.setHours(0, 0, 0, 0);

    if (taskDate.getTime() === today.getTime()) return 'Today';
    if (taskDate.getTime() === tomorrow.getTime()) return 'Tomorrow';

    const options = { month: 'short', day: 'numeric' };
    if (taskDate.getFullYear() !== today.getFullYear()) {
      options.year = 'numeric';
    }
    return date.toLocaleDateString('en-US', options);
  }

  formatRelativeDate(isoString) {
    if (!isoString) return '';
    const date = new Date(isoString);
    const now = new Date();
    const diffMs = now - date;
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 1) return 'just now';
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHours = Math.floor(diffMin / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    const diffDays = Math.floor(diffHours / 24);
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  formatStatus(status) {
    const labels = {
      'todo': 'Inbox',
      'ready': 'Ready',
      'in-progress': 'In Progress',
      'waiting': 'Waiting',
      'review': 'Review',
      'done': 'Done'
    };
    return labels[status] || status;
  }

  // ================================================
  // PRIORITY 2 & 3 ENHANCEMENTS
  // ================================================

  // P2.1 - Drag Ghost Preview
  createDragGhost(task, initialX, initialY) {
    // Remove any existing ghost first
    this.removeDragGhost();

    const ghost = document.createElement('div');
    ghost.className = 'drag-ghost';
    ghost.id = 'drag-ghost';
    ghost.innerHTML = `
      <div class="drag-ghost-content">
        <span class="drag-ghost-priority ${task.priority || 'none'}"></span>
        <span class="drag-ghost-name">${this.escapeHtml(task.name)}</span>
        <span class="drag-ghost-time">${task.estimatedMinutes || 30}m</span>
      </div>
    `;

    // Set initial position
    ghost.style.left = `${initialX + 15}px`;
    ghost.style.top = `${initialY + 15}px`;

    document.body.appendChild(ghost);

    // Use document-level dragover to track position (more reliable than drag event)
    this._ghostDragHandler = (e) => {
      if (e.clientX && e.clientY) {
        ghost.style.left = `${e.clientX + 15}px`;
        ghost.style.top = `${e.clientY + 15}px`;
      }
    };
    document.addEventListener('dragover', this._ghostDragHandler);

    return ghost;
  }

  updateDragGhostPosition(e) {
    // Kept for compatibility but main tracking is now via document dragover
    const ghost = document.getElementById('drag-ghost');
    if (ghost && e.clientX && e.clientY) {
      ghost.style.left = `${e.clientX + 15}px`;
      ghost.style.top = `${e.clientY + 15}px`;
    }
  }

  removeDragGhost() {
    const ghost = document.getElementById('drag-ghost');
    if (ghost) {
      ghost.remove();
    }
    // Remove the dragover listener
    if (this._ghostDragHandler) {
      document.removeEventListener('dragover', this._ghostDragHandler);
      this._ghostDragHandler = null;
    }
    this.draggedTask = null;
  }

  // P2.2 - Time validation for drop zones
  isTimePast(timeStr) {
    const now = new Date();
    const [hours, minutes] = timeStr.split(':').map(Number);
    const slotTime = new Date();
    slotTime.setHours(hours, minutes, 0, 0);
    return slotTime < now;
  }

  formatTimeDisplay(timeStr) {
    const [hours, minutes] = timeStr.split(':').map(Number);
    const period = hours >= 12 ? 'PM' : 'AM';
    const displayHour = hours > 12 ? hours - 12 : hours === 0 ? 12 : hours;
    return `${displayHour}:${minutes.toString().padStart(2, '0')} ${period}`;
  }

  // P3.1 - Context Menu
  showContextMenu(e, task) {
    e.preventDefault();
    this.hideContextMenu();

    const menu = document.createElement('div');
    menu.className = 'context-menu';
    menu.id = 'context-menu';
    menu.innerHTML = `
      <div class="context-menu-item" data-action="edit">
        <span class="context-menu-icon">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
          </svg>
        </span>
        <span class="context-menu-label">Edit Task</span>
        <span class="context-menu-shortcut">E</span>
      </div>
      <div class="context-menu-item" data-action="schedule">
        <span class="context-menu-icon">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
            <line x1="16" y1="2" x2="16" y2="6"/>
            <line x1="8" y1="2" x2="8" y2="6"/>
            <line x1="3" y1="10" x2="21" y2="10"/>
          </svg>
        </span>
        <span class="context-menu-label">Schedule...</span>
        <span class="context-menu-shortcut">S</span>
      </div>
      <div class="context-menu-item context-menu-has-submenu" data-action="priority">
        <span class="context-menu-icon">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
            <polyline points="22 4 12 14.01 9 11.01"/>
          </svg>
        </span>
        <span class="context-menu-label">Set Priority</span>
        <span class="context-menu-arrow">▸</span>
        <div class="context-submenu">
          <div class="context-submenu-item" data-priority="urgent">
            <span class="context-priority-dot urgent"></span>
            <span>Urgent</span>
          </div>
          <div class="context-submenu-item" data-priority="high">
            <span class="context-priority-dot high"></span>
            <span>High</span>
          </div>
          <div class="context-submenu-item" data-priority="medium">
            <span class="context-priority-dot medium"></span>
            <span>Medium</span>
          </div>
          <div class="context-submenu-item" data-priority="low">
            <span class="context-priority-dot low"></span>
            <span>Low</span>
          </div>
          <div class="context-submenu-item" data-priority="none">
            <span class="context-priority-dot none"></span>
            <span>None</span>
          </div>
        </div>
      </div>
      <div class="context-menu-divider"></div>
      <div class="context-menu-item" data-action="complete">
        <span class="context-menu-icon">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="20 6 9 17 4 12"/>
          </svg>
        </span>
        <span class="context-menu-label">${task.status === 'done' ? 'Mark Incomplete' : 'Mark Complete'}</span>
        <span class="context-menu-shortcut">Space</span>
      </div>
      <div class="context-menu-item" data-action="duplicate">
        <span class="context-menu-icon">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
          </svg>
        </span>
        <span class="context-menu-label">Duplicate</span>
      </div>
      <div class="context-menu-divider"></div>
      <div class="context-menu-item context-menu-danger" data-action="delete">
        <span class="context-menu-icon">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="3 6 5 6 21 6"/>
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
          </svg>
        </span>
        <span class="context-menu-label">Delete</span>
        <span class="context-menu-shortcut">Del</span>
      </div>
    `;

    // Position menu
    let x = e.clientX;
    let y = e.clientY;

    document.body.appendChild(menu);

    // Adjust if near edge
    const rect = menu.getBoundingClientRect();
    if (x + rect.width > window.innerWidth) {
      x = window.innerWidth - rect.width - 10;
    }
    if (y + rect.height > window.innerHeight) {
      y = window.innerHeight - rect.height - 10;
    }

    menu.style.left = `${x}px`;
    menu.style.top = `${y}px`;

    // Store current task for actions
    this.contextMenuTask = task;

    // Bind actions
    menu.querySelectorAll('.context-menu-item[data-action]').forEach(item => {
      item.addEventListener('click', (ev) => {
        ev.stopPropagation();
        const action = item.dataset.action;
        if (action !== 'priority') {
          this.handleContextAction(action, task);
          this.hideContextMenu();
        }
      });
    });

    // Bind priority submenu
    menu.querySelectorAll('.context-submenu-item[data-priority]').forEach(item => {
      item.addEventListener('click', (ev) => {
        ev.stopPropagation();
        const priority = item.dataset.priority;
        this.updateTask(task.id, { priority });
        this.hideContextMenu();
        this.render();
      });
    });

    // Close on click outside
    setTimeout(() => {
      const closeHandler = (ev) => {
        if (!menu.contains(ev.target)) {
          this.hideContextMenu();
          document.removeEventListener('click', closeHandler);
        }
      };
      document.addEventListener('click', closeHandler);
    }, 0);

    // Close on Escape
    const escHandler = (ev) => {
      if (ev.key === 'Escape') {
        this.hideContextMenu();
        document.removeEventListener('keydown', escHandler);
      }
    };
    document.addEventListener('keydown', escHandler);
  }

  hideContextMenu() {
    const menu = document.getElementById('context-menu');
    if (menu) {
      menu.remove();
    }
    this.contextMenuTask = null;
  }

  handleContextAction(action, task) {
    switch (action) {
      case 'edit':
        this.openTaskModal(task.id);
        break;
      case 'schedule':
        this.openTaskModal(task.id);
        // Could implement a dedicated schedule modal in future
        break;
      case 'complete':
        const newStatus = task.status === 'done' ? 'todo' : 'done';
        this.updateTask(task.id, { status: newStatus });
        this.render();
        break;
      case 'duplicate':
        this.duplicateTask(task);
        break;
      case 'delete':
        if (confirm(`Delete "${task.name}"?`)) {
          this.deleteTask(task.id);
          this.render();
        }
        break;
    }
  }

  duplicateTask(task) {
    const newTask = {
      name: task.name + ' (copy)',
      description: task.description || '',
      context: task.context || '',
      priority: task.priority,
      dueDate: task.dueDate,
      estimatedMinutes: task.estimatedMinutes,
      tags: [...(task.tags || [])],
      status: 'todo'
    };

    // Find project
    for (const project of this.data.projects) {
      if (project.tasks.some(t => t.id === task.id)) {
        newTask.projectId = project.id;
        break;
      }
    }

    this.createTask(newTask);
    this.render();
  }

  // P3.2 - Inline Edit
  enableInlineEdit(taskElement, task) {
    // Find the name element - check all possible class names used in the app
    const nameEl = taskElement.querySelector('.task-name, .focus-queue-name, .timeline-task-name, .board-task-name, .master-list-name');
    if (!nameEl || nameEl.classList.contains('editing')) return;

    const originalText = task.name;
    nameEl.contentEditable = 'true';
    nameEl.classList.add('editing', 'task-name-editable');
    nameEl.focus();

    // Select all text
    const range = document.createRange();
    range.selectNodeContents(nameEl);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);

    const finishEdit = (save) => {
      nameEl.contentEditable = 'false';
      nameEl.classList.remove('editing');

      const newText = nameEl.textContent.trim();
      if (save && newText && newText !== originalText) {
        this.updateTask(task.id, { name: newText });
      } else {
        nameEl.textContent = originalText;
      }
    };

    const keyHandler = (ev) => {
      if (ev.key === 'Enter') {
        ev.preventDefault();
        finishEdit(true);
        nameEl.removeEventListener('keydown', keyHandler);
        nameEl.removeEventListener('blur', blurHandler);
      } else if (ev.key === 'Escape') {
        ev.preventDefault();
        finishEdit(false);
        nameEl.removeEventListener('keydown', keyHandler);
        nameEl.removeEventListener('blur', blurHandler);
      }
    };

    const blurHandler = () => {
      finishEdit(true);
      nameEl.removeEventListener('keydown', keyHandler);
      nameEl.removeEventListener('blur', blurHandler);
    };

    nameEl.addEventListener('keydown', keyHandler);
    nameEl.addEventListener('blur', blurHandler);
  }

  // P3.3 - Task Resize
  makeTaskResizable(taskBlock, task) {
    const handle = document.createElement('div');
    handle.className = 'resize-handle';
    taskBlock.appendChild(handle);

    let startY, startHeight, startMinutes;

    handle.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();

      startY = e.clientY;
      startHeight = taskBlock.offsetHeight;
      startMinutes = task.estimatedMinutes || 30;

      taskBlock.classList.add('resizing');

      const onMouseMove = (ev) => {
        const deltaY = ev.clientY - startY;
        const slotHeight = 35; // Height of one 30-min slot
        const deltaSlots = Math.round(deltaY / slotHeight);
        const newMinutes = Math.max(15, Math.min(240, startMinutes + (deltaSlots * 30)));

        // Visual feedback
        taskBlock.style.height = `${Math.max(30, startHeight + deltaY)}px`;
        taskBlock.dataset.previewDuration = `${newMinutes}m`;
      };

      const onMouseUp = (ev) => {
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);

        taskBlock.classList.remove('resizing');
        taskBlock.style.height = '';
        delete taskBlock.dataset.previewDuration;

        const deltaY = ev.clientY - startY;
        const slotHeight = 35;
        const deltaSlots = Math.round(deltaY / slotHeight);
        const newMinutes = Math.max(15, Math.min(240, startMinutes + (deltaSlots * 30)));

        if (newMinutes !== task.estimatedMinutes) {
          this.updateTask(task.id, { estimatedMinutes: newMinutes });
          this.render();
        }
      };

      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    });
  }

  // Bind context menu and inline edit to task elements using event delegation
  bindTaskInteractions() {
    // Only set up delegation once
    if (!this._taskInteractionsBound) {
      this._taskInteractionsBound = true;

      // Context menu on right-click (delegated to document)
      document.addEventListener('contextmenu', (e) => {
        const taskEl = e.target.closest('.task-item, .focus-queue-item, .timeline-task-block');
        if (taskEl) {
          const taskId = taskEl.dataset.taskId;
          const task = this.findTask(taskId);
          if (task) {
            this.showContextMenu(e, task);
          }
        }
      });

      // Double-click to edit (delegated to document)
      document.addEventListener('dblclick', (e) => {
        // Check if clicked on a task name element
        const nameClasses = ['task-name', 'focus-queue-name', 'timeline-task-name', 'board-task-name', 'master-list-name'];
        const isNameElement = nameClasses.some(cls => e.target.classList.contains(cls));

        if (isNameElement) {
          const taskEl = e.target.closest('.task-item, .focus-queue-item, .timeline-task-block');
          if (taskEl) {
            const taskId = taskEl.dataset.taskId;
            const task = this.findTask(taskId);
            if (task) {
              e.preventDefault();
              e.stopPropagation();
              this.enableInlineEdit(taskEl, task);
            }
          }
        }
      });
    }

    // Add resize handles to timeline task blocks (these need to be added per-render)
    document.querySelectorAll('.timeline-task-block').forEach(block => {
      const taskId = block.dataset.taskId;
      const task = this.findTask(taskId);
      if (task && !block.querySelector('.resize-handle')) {
        this.makeTaskResizable(block, task);
      }
    });
  }

  // ================================================
  // ================================================
  // ANALYTICS VIEW
  // ================================================

  renderAnalyticsView() {
    const container = document.getElementById('analytics-container');
    if (!container) return;

    // Initialize analytics data if not present
    if (!this.data.analytics) {
      this.data.analytics = {
        dailyStats: {},
        streaks: { current: 0, longest: 0, lastActive: null }
      };
    }

    // Calculate stats for the selected period
    const now = new Date();
    const periodDays = this._analyticsPeriod === 'week' ? 7 :
                       this._analyticsPeriod === 'month' ? 30 : 90;

    const startDate = new Date(now);
    startDate.setDate(startDate.getDate() - periodDays);

    // Get completed tasks in period
    const allTasks = this.getAllTasks();
    const completedInPeriod = allTasks.filter(t => {
      if (t.status !== 'done' || !t.completedAt) return false;
      const completed = new Date(t.completedAt);
      return completed >= startDate && completed <= now;
    });

    // Calculate daily completions for chart
    const dailyCompletions = {};
    for (let d = new Date(startDate); d <= now; d.setDate(d.getDate() + 1)) {
      const dateStr = this.getLocalDateString(d);
      dailyCompletions[dateStr] = 0;
    }

    completedInPeriod.forEach(t => {
      const dateStr = this.isoToLocalDate(t.completedAt);
      if (dailyCompletions[dateStr] !== undefined) {
        dailyCompletions[dateStr]++;
      }
    });

    // Calculate total focus time
    let totalFocusMinutes = 0;
    completedInPeriod.forEach(t => {
      totalFocusMinutes += t.estimatedMinutes || 30;
    });

    // Calculate streak
    let currentStreak = 0;
    const today = this.getLocalDateString();
    let checkDate = new Date(now);
    while (true) {
      const dateStr = this.getLocalDateString(checkDate);
      if (dailyCompletions[dateStr] && dailyCompletions[dateStr] > 0) {
        currentStreak++;
        checkDate.setDate(checkDate.getDate() - 1);
      } else if (dateStr === today) {
        // Today hasn't been completed yet, check yesterday
        checkDate.setDate(checkDate.getDate() - 1);
      } else {
        break;
      }
      if (currentStreak > periodDays) break;
    }

    // Completion rate
    const totalActive = allTasks.filter(t => t.status !== 'done').length;
    const completionRate = totalActive + completedInPeriod.length > 0
      ? Math.round((completedInPeriod.length / (totalActive + completedInPeriod.length)) * 100)
      : 0;

    // Project breakdown
    const projectStats = {};
    completedInPeriod.forEach(t => {
      const project = this.data.projects.find(p => p.tasks.some(pt => pt.id === t.id));
      const projectName = project?.name || 'Inbox';
      if (!projectStats[projectName]) {
        projectStats[projectName] = { count: 0, minutes: 0, color: project?.color || '#6366f1' };
      }
      projectStats[projectName].count++;
      projectStats[projectName].minutes += t.estimatedMinutes || 30;
    });

    // Build chart bars
    const dates = Object.keys(dailyCompletions).slice(-14); // Last 14 days for chart
    const maxCount = Math.max(...dates.map(d => dailyCompletions[d]), 1);

    const chartBars = dates.map(date => {
      const count = dailyCompletions[date];
      const height = (count / maxCount) * 100;
      const dayLabel = new Date(date + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short' });
      return `
        <div class="analytics-bar">
          <span class="analytics-bar-value">${count || ''}</span>
          <div class="analytics-bar-fill" style="height: ${height}%"></div>
          <span class="analytics-bar-label">${dayLabel}</span>
        </div>
      `;
    }).join('');

    // Build project cards
    const projectCards = Object.entries(projectStats)
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 6)
      .map(([name, stats]) => `
        <div class="analytics-project-card">
          <div class="analytics-project-header">
            <span class="analytics-project-color" style="background: ${stats.color}"></span>
            <span class="analytics-project-name">${this.escapeHtml(name)}</span>
          </div>
          <div class="analytics-project-stats">
            <span>${stats.count} tasks</span>
            <span>${Math.round(stats.minutes / 60)}h ${stats.minutes % 60}m</span>
          </div>
        </div>
      `).join('');

    container.innerHTML = `
      <div class="analytics-header">
        <h2>Productivity Analytics</h2>
        <div class="analytics-period-selector">
          <button class="analytics-period-btn ${this._analyticsPeriod === 'week' ? 'active' : ''}" data-period="week">Week</button>
          <button class="analytics-period-btn ${this._analyticsPeriod === 'month' ? 'active' : ''}" data-period="month">Month</button>
          <button class="analytics-period-btn ${this._analyticsPeriod === 'quarter' ? 'active' : ''}" data-period="quarter">Quarter</button>
        </div>
      </div>

      <div class="analytics-stats-row">
        <div class="analytics-stat-card">
          <div class="analytics-stat-value">${completedInPeriod.length}</div>
          <div class="analytics-stat-label">Tasks Completed</div>
        </div>
        <div class="analytics-stat-card">
          <div class="analytics-stat-value">${Math.round(totalFocusMinutes / 60)}h</div>
          <div class="analytics-stat-label">Focus Time</div>
        </div>
        <div class="analytics-stat-card">
          <div class="analytics-stat-value">${currentStreak}</div>
          <div class="analytics-stat-label">Day Streak</div>
        </div>
        <div class="analytics-stat-card">
          <div class="analytics-stat-value">${completionRate}%</div>
          <div class="analytics-stat-label">Completion Rate</div>
        </div>
      </div>

      <div class="analytics-chart-section">
        <div class="analytics-chart-header">
          <h3>Daily Completions</h3>
        </div>
        <div class="analytics-bar-chart">
          ${chartBars}
        </div>
      </div>

      <div class="analytics-chart-section">
        <div class="analytics-chart-header">
          <h3>By Project</h3>
        </div>
        <div class="analytics-projects-section">
          ${projectCards || '<p class="analytics-empty">No project data for this period</p>'}
        </div>
      </div>
    `;

    // Bind period selector
    container.querySelectorAll('.analytics-period-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        this._analyticsPeriod = btn.dataset.period;
        this.renderAnalyticsView();
      });
    });
  }

  // ================================================
  // ENHANCED MASTER LIST - Bulk Selection & Grouping
  // ================================================

  toggleTaskSelection(taskId, extend = false) {
    if (extend) {
      // Shift+click: range select
      // For simplicity, just toggle for now
      if (this._selectedTasks.has(taskId)) {
        this._selectedTasks.delete(taskId);
      } else {
        this._selectedTasks.add(taskId);
      }
    } else {
      // Regular click: toggle single
      if (this._selectedTasks.has(taskId)) {
        this._selectedTasks.delete(taskId);
      } else {
        this._selectedTasks.add(taskId);
      }
    }
    this.updateBulkToolbar();
    this.updateTaskSelectionUI();
  }

  selectAllTasks() {
    const tasks = this.getFilteredTasks().filter(t => t.status !== 'done');
    tasks.forEach(t => this._selectedTasks.add(t.id));
    this.updateBulkToolbar();
    this.updateTaskSelectionUI();
  }

  clearTaskSelection() {
    this._selectedTasks.clear();
    this.updateBulkToolbar();
    this.updateTaskSelectionUI();
  }

  updateBulkToolbar() {
    const toolbar = document.querySelector('.master-list-bulk-toolbar');
    if (!toolbar) return;

    const count = this._selectedTasks.size;
    if (count > 0) {
      toolbar.classList.remove('hidden');
      toolbar.querySelector('.bulk-select-count').textContent = `${count} selected`;
    } else {
      toolbar.classList.add('hidden');
    }
  }

  updateTaskSelectionUI() {
    document.querySelectorAll('.master-list-item').forEach(item => {
      const taskId = item.dataset.id;
      const selectBox = item.querySelector('.master-list-select');
      const isSelected = this._selectedTasks.has(taskId);

      item.classList.toggle('selected', isSelected);
      if (selectBox) {
        selectBox.classList.toggle('selected', isSelected);
        selectBox.innerHTML = isSelected ? '✓' : '';
      }
    });
  }

  executeBulkAction(action) {
    const taskIds = Array.from(this._selectedTasks);
    if (taskIds.length === 0) return;

    switch (action) {
      case 'complete':
        taskIds.forEach(id => {
          const task = this.findTask(id);
          if (task) {
            task.status = 'done';
            task.completedAt = new Date().toISOString();
          }
        });
        this.showToast(`Completed ${taskIds.length} tasks`, 2000, 'success');
        break;

      case 'schedule-today':
        const today = this.getLocalDateString();
        taskIds.forEach(id => {
          const task = this.findTask(id);
          if (task) {
            task.dueDate = today;
            task.scheduledDate = today;
          }
        });
        this.showToast(`Scheduled ${taskIds.length} tasks for today`);
        break;

      case 'set-priority':
        const priority = prompt('Enter priority (urgent, high, medium, low, none):');
        if (['urgent', 'high', 'medium', 'low', 'none'].includes(priority)) {
          taskIds.forEach(id => {
            const task = this.findTask(id);
            if (task) task.priority = priority;
          });
          this.showToast(`Set priority to ${priority} for ${taskIds.length} tasks`);
        }
        break;

      case 'delete':
        if (confirm(`Delete ${taskIds.length} tasks? This cannot be undone.`)) {
          taskIds.forEach(id => this.deleteTask(id));
          this.showToast(`Deleted ${taskIds.length} tasks`);
        }
        break;

      case 'add-to-queue':
        taskIds.forEach(id => {
          if (!this.executeMode.queue.includes(id)) {
            this.executeMode.queue.push(id);
          }
        });
        this.showToast(`Added ${taskIds.length} tasks to execution queue`);
        break;
    }

    this.saveData();
    this._selectedTasks.clear();
    this.renderMasterList();
  }

  // ============================================
  // PROJECT VIEW - Enhanced Multi-View System
  // ============================================

  renderProjectView() {
    const container = document.getElementById('tasks-container');
    if (!container) return;

    const projectId = this.currentView.replace('project-', '');
    const project = this.data.projects.find(p => p.id === projectId);
    if (!project) {
      container.innerHTML = '<div class="empty-state"><h3>Project not found</h3></div>';
      return;
    }

    const viewState = this.getProjectViewState(projectId);
    const tasks = this.getProjectFilteredTasks(project, viewState);

    container.innerHTML = '';

    // Enhanced header
    container.appendChild(this.createEnhancedProjectHeader(project));

    // Launchers bar (below header, above planning)
    container.appendChild(this.createProjectLaunchersBar(project));

    // Planning section — what to focus on
    container.appendChild(this.createProjectPlanningSection(project));

    // Toolbar
    container.appendChild(this.createProjectToolbar(projectId, viewState));

    // View content container
    const viewContent = document.createElement('div');
    viewContent.className = 'project-view-content';
    container.appendChild(viewContent);

    // Render based on view mode
    switch (viewState.viewMode) {
      case 'board':
        this.renderProjectBoardView(viewContent, project, tasks, viewState);
        break;
      case 'timeline':
        this.renderProjectTimelineView(viewContent, project, tasks, viewState);
        break;
      case 'roadmap':
        this.renderProjectRoadmapView(viewContent, project, tasks, viewState);
        break;
      case 'notebooks':
        this.renderProjectNotebooks(viewContent, project);
        break;
      case 'list':
      default:
        this.renderProjectListView(viewContent, project, tasks, viewState);
        break;
    }
  }

  createProjectPlanningSection(project) {
    const today = this.getLocalDateString();
    const activeTasks = (project.tasks || []).filter(t => t.status !== 'done');

    // Overdue tasks
    const overdueTasks = activeTasks.filter(t => t.dueDate && t.dueDate < today)
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate));

    // Blocked tasks
    const blockedTasks = activeTasks.filter(t => this.isTaskBlocked(t) || (t.status === 'waiting' && t.waitingReason));

    // AI-ready tasks (executionType is ai, not yet assigned to claude)
    const aiReadyTasks = activeTasks.filter(t =>
      (t.executionType === 'ai' || t.executionType === 'hybrid') && t.assignedTo !== 'claude'
    );
    const claudeQueuedTasks = activeTasks.filter(t => t.assignedTo === 'claude');

    const hasAttention = overdueTasks.length > 0 || blockedTasks.length > 0;
    const hasClaude = aiReadyTasks.length > 0 || claudeQueuedTasks.length > 0;

    if (!hasAttention && !hasClaude) {
      const section = document.createElement('div');
      section.className = 'project-planning';
      return section;
    }

    const section = document.createElement('div');
    section.className = 'project-planning';
    let html = '';

    // Needs Attention card
    if (hasAttention) {
      html += '<div class="project-attention-card">';
      html += '<div class="attention-header">Needs Attention</div>';

      if (overdueTasks.length > 0) {
        const overdueExtra = (task) => {
          const diffMs = new Date(today + 'T00:00:00') - new Date(task.dueDate + 'T00:00:00');
          const days = Math.round(diffMs / 86400000);
          return `${days}d overdue`;
        };
        html += `<div class="attention-row overdue">
          <span class="attention-label">OVERDUE</span>
          <div class="attention-pills">${overdueTasks.map(t => this._planningTaskPill(t, overdueExtra(t))).join('')}</div>
        </div>`;
      }

      if (blockedTasks.length > 0) {
        const blockedExtra = (task) => {
          const blockers = this.getBlockingTasks(task);
          if (blockers.length > 0) return '\u2190 ' + blockers.map(b => b.name).join(', ');
          if (task.waitingReason) return '\u2190 ' + task.waitingReason;
          return '';
        };
        html += `<div class="attention-row blocked">
          <span class="attention-label">BLOCKED</span>
          <div class="attention-pills">${blockedTasks.map(t => this._planningTaskPill(t, blockedExtra(t))).join('')}</div>
        </div>`;
      }

      html += '</div>';
    }

    // Claude Can Help card
    if (hasClaude) {
      html += '<div class="project-claude-card">';
      html += '<div class="claude-card-header">';
      html += '<div class="attention-header">Claude Can Help</div>';
      if (aiReadyTasks.length > 0) {
        html += `<button class="claude-queue-btn" data-action="queue-all">\u{1F916} Queue ${aiReadyTasks.length} for Tonight</button>`;
      }
      html += '</div>';

      if (aiReadyTasks.length > 0) {
        html += `<div class="attention-row claude-ready">
          <span class="attention-label">${aiReadyTasks.length} READY</span>
          <div class="attention-pills">${aiReadyTasks.map(t => this._planningTaskPill(t)).join('')}</div>
        </div>`;
      }

      if (claudeQueuedTasks.length > 0) {
        html += `<div class="attention-row claude-queued">
          <span class="claude-queued-label">\u2713 Already queued: ${claudeQueuedTasks.length} task${claudeQueuedTasks.length !== 1 ? 's' : ''}</span>
        </div>`;
      }

      html += '</div>';
    }

    section.innerHTML = html;

    // Bind pill clicks
    section.querySelectorAll('.planning-pill').forEach(pill => {
      pill.addEventListener('click', () => {
        this.openDetailPanel(pill.dataset.taskId);
      });
    });

    // Bind "Queue All" button
    const queueBtn = section.querySelector('[data-action="queue-all"]');
    if (queueBtn) {
      queueBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        aiReadyTasks.forEach(task => {
          task.assignedTo = 'claude';
        });
        this.saveData();
        this.showToast(`Queued ${aiReadyTasks.length} tasks for Claude`);
        this.renderProjectView();
      });
    }

    return section;
  }

  _planningTaskPill(task, extra = '') {
    const borderColor = PRIORITY_COLORS[task.priority] || PRIORITY_COLORS.none;
    const execType = task.executionType || 'manual';
    const execTag = execType === 'ai' ? ' <span class="pill-exec ai">AI</span>' : execType === 'hybrid' ? ' <span class="pill-exec hybrid">HY</span>' : '';

    const extraTag = extra ? ` <span class="pill-extra">${this.escapeHtml(extra)}</span>` : '';

    return `<span class="planning-pill" data-task-id="${task.id}" style="border-left-color:${borderColor}">
      ${this.escapeHtml(task.name)}${execTag}${extraTag}
    </span>`;
  }

  createEnhancedProjectHeader(project) {
    const tasks = project.tasks || [];
    const totalTasks = tasks.length;
    const completedTasks = tasks.filter(t => t.status === 'done');
    const activeTasks = tasks.filter(t => t.status !== 'done');

    const estMinutesRemaining = activeTasks.reduce((sum, t) => sum + (t.estimatedMinutes || 0), 0);
    const progressPercent = totalTasks > 0 ? Math.round(completedTasks.length / totalTasks * 100) : 0;

    // Stats summary line
    const blockedCount = activeTasks.filter(t => this.isTaskBlocked(t)).length;
    const claudeCount = activeTasks.filter(t => t.assignedTo === 'claude' || t.executionType === 'ai').length;

    const statParts = [`${activeTasks.length} remaining`];
    if (blockedCount > 0) statParts.push(`${blockedCount} blocked`);
    if (claudeCount > 0) statParts.push(`${claudeCount} for Claude`);
    if (estMinutesRemaining > 0) {
      const h = Math.round(estMinutesRemaining / 60 * 10) / 10;
      statParts.push(`~${h}h est.`);
    }
    statParts.push(`${completedTasks.length}/${totalTasks} done`);

    const header = document.createElement('div');
    header.className = 'project-header-card';

    header.innerHTML = `
      <div class="project-header-top">
        <span class="project-header-color" style="background:${project.color}"></span>
        <h2 class="project-header-name">${this.escapeHtml(project.name)}</h2>
        <button class="project-header-share" title="Manage Members">&#128101; Share</button>
        <button class="project-header-edit" title="Edit Project">&#9998;</button>
      </div>
      ${project.goal ? `<p class="project-header-goal">${this.escapeHtml(project.goal)}</p>` : ''}
      <div class="project-progress-section">
        <div class="project-progress-inline">
          <div class="project-progress-track">
            <div class="project-progress-fill" style="width: ${progressPercent}%"></div>
          </div>
          <span class="project-progress-pct">${progressPercent}%</span>
        </div>
        <span class="project-progress-stats">${statParts.join(' &middot; ')}</span>
      </div>
    `;

    header.querySelector('.project-header-share').addEventListener('click', () => {
      this.openProjectMembersModal(project.id);
    });
    header.querySelector('.project-header-edit').addEventListener('click', () => {
      this.openProjectModal(project.id);
    });

    return header;
  }

  createProjectToolbar(projectId, viewState) {
    const toolbar = document.createElement('div');
    toolbar.className = 'project-toolbar';

    toolbar.innerHTML = `
      <div class="project-view-switcher">
        <button class="project-view-btn ${viewState.viewMode === 'list' ? 'active' : ''}" data-mode="list" title="List view">List</button>
        <button class="project-view-btn ${viewState.viewMode === 'board' ? 'active' : ''}" data-mode="board" title="Board view">Board</button>
        <button class="project-view-btn ${viewState.viewMode === 'timeline' ? 'active' : ''}" data-mode="timeline" title="Timeline view">Timeline</button>
        <button class="project-view-btn ${viewState.viewMode === 'roadmap' ? 'active' : ''}" data-mode="roadmap" title="Roadmap view">Roadmap</button>
        <button class="project-view-btn ${viewState.viewMode === 'notebooks' ? 'active' : ''}" data-mode="notebooks" title="Notebooks">Notes</button>
      </div>
      <div class="project-filters">
        <select class="project-filter-select" data-filter="filterStatus">
          <option value="active" ${viewState.filterStatus === 'active' ? 'selected' : ''}>Active</option>
          <option value="all" ${viewState.filterStatus === 'all' ? 'selected' : ''}>All</option>
          <option value="todo" ${viewState.filterStatus === 'todo' ? 'selected' : ''}>To Do</option>
          <option value="in-progress" ${viewState.filterStatus === 'in-progress' ? 'selected' : ''}>In Progress</option>
          <option value="waiting" ${viewState.filterStatus === 'waiting' ? 'selected' : ''}>Waiting</option>
          <option value="done" ${viewState.filterStatus === 'done' ? 'selected' : ''}>Done</option>
        </select>
        <select class="project-filter-select" data-filter="sortBy">
          <option value="priority" ${viewState.sortBy === 'priority' ? 'selected' : ''}>Priority</option>
          <option value="dueDate" ${viewState.sortBy === 'dueDate' ? 'selected' : ''}>Due Date</option>
          <option value="created" ${viewState.sortBy === 'created' ? 'selected' : ''}>Created</option>
          <option value="name" ${viewState.sortBy === 'name' ? 'selected' : ''}>Name</option>
        </select>
      </div>
      <button class="project-claude-btn" title="Launch Claude session for this project">Claude</button>
      <button class="project-add-task-btn" title="Add task to this project">+ Add Task</button>
    `;

    // View switcher events
    toolbar.querySelectorAll('.project-view-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        this.updateProjectViewPref(projectId, 'viewMode', btn.dataset.mode);
      });
    });

    // Filter events
    toolbar.querySelectorAll('.project-filter-select').forEach(select => {
      select.addEventListener('change', () => {
        this.updateProjectViewPref(projectId, select.dataset.filter, select.value);
      });
    });

    // Claude session button
    toolbar.querySelector('.project-claude-btn').addEventListener('click', () => {
      const prompt = this.buildProjectClaudePrompt(projectId);
      const project = this.data.projects.find(p => p.id === projectId);
      this.launchClaudeSession(prompt, project ? project.name : 'Project', projectId);
    });

    // Add task button
    toolbar.querySelector('.project-add-task-btn').addEventListener('click', () => {
      this.openTaskModal(null, projectId);
    });

    return toolbar;
  }

  // ========================================
  // PROJECT NOTEBOOKS
  // ========================================

  renderProjectNotebooks(container, project) {
    if (!project.notebooks) project.notebooks = [];

    const layout = document.createElement('div');
    layout.className = 'project-notebooks-layout';

    // Sidebar — notebook list
    const sidebar = document.createElement('div');
    sidebar.className = 'notebooks-sidebar';

    const addBtn = document.createElement('button');
    addBtn.className = 'notebooks-add-btn';
    addBtn.textContent = '+ New Notebook';
    addBtn.addEventListener('click', () => {
      this.createNotebook(project.id);
    });
    sidebar.appendChild(addBtn);

    const listEl = document.createElement('div');
    listEl.className = 'notebooks-list';

    // Sort: pinned first, then by updatedAt desc
    const sorted = [...project.notebooks].sort((a, b) => {
      if (a.pinned && !b.pinned) return -1;
      if (!a.pinned && b.pinned) return 1;
      return new Date(b.updatedAt) - new Date(a.updatedAt);
    });

    // Track selected notebook
    const selectedId = this._selectedNotebookId || (sorted.length > 0 ? sorted[0].id : null);

    sorted.forEach(nb => {
      const item = document.createElement('div');
      item.className = `notebook-item ${nb.id === selectedId ? 'active' : ''}`;
      item.innerHTML = `
        <span class="notebook-item-icon">${this.escapeHtml(nb.icon || '\u{1F4DD}')}</span>
        <div class="notebook-item-info">
          <span class="notebook-item-title">${this.escapeHtml(nb.title)}</span>
          <span class="notebook-item-date">${this.formatRelativeDate(nb.updatedAt)}</span>
        </div>
        ${nb.pinned ? '<span class="notebook-item-pin" title="Pinned">\u{1F4CC}</span>' : ''}
      `;
      item.addEventListener('click', () => {
        this._selectedNotebookId = nb.id;
        this.renderProjectView();
      });
      listEl.appendChild(item);
    });

    sidebar.appendChild(listEl);
    layout.appendChild(sidebar);

    // Editor panel
    const editor = document.createElement('div');
    editor.className = 'notebook-editor';

    if (selectedId) {
      const notebook = project.notebooks.find(n => n.id === selectedId);
      if (notebook) {
        this.renderNotebookEditor(editor, project, notebook);
      } else {
        editor.innerHTML = '<div class="notebook-empty">Select a notebook</div>';
      }
    } else {
      editor.innerHTML = '<div class="notebook-empty">No notebooks yet. Create one to get started.</div>';
    }

    layout.appendChild(editor);
    container.appendChild(layout);
  }

  renderNotebookEditor(container, project, notebook) {
    const isPreview = this._notebookPreviewMode === notebook.id;

    container.innerHTML = `
      <div class="notebook-editor-header">
        <input class="notebook-title-input" type="text" value="${this.escapeHtml(notebook.title)}" placeholder="Notebook title..." />
        <div class="notebook-editor-actions">
          <button class="notebook-pin-btn" title="${notebook.pinned ? 'Unpin' : 'Pin'}">${notebook.pinned ? '\u{1F4CC}' : 'Pin'}</button>
          <button class="notebook-preview-btn">${isPreview ? 'Edit' : 'Preview'}</button>
          <button class="notebook-delete-btn" title="Delete notebook">\u{1F5D1}</button>
        </div>
      </div>
      <div class="notebook-editor-body">
        ${isPreview
          ? `<div class="notebook-preview">${this.renderMarkdownSimple(notebook.content || '')}</div>`
          : `<textarea class="notebook-content-textarea" placeholder="Write your notes in markdown...">${this.escapeHtml(notebook.content || '')}</textarea>`
        }
      </div>
    `;

    // Title change
    const titleInput = container.querySelector('.notebook-title-input');
    titleInput.addEventListener('blur', () => {
      const newTitle = titleInput.value.trim();
      if (newTitle && newTitle !== notebook.title) {
        notebook.title = newTitle;
        notebook.updatedAt = new Date().toISOString();
        this.saveData();
      }
    });

    // Content autosave on blur
    const textarea = container.querySelector('.notebook-content-textarea');
    if (textarea) {
      textarea.addEventListener('blur', () => {
        if (textarea.value !== notebook.content) {
          notebook.content = textarea.value;
          notebook.updatedAt = new Date().toISOString();
          this.saveData();
        }
      });
    }

    // Preview toggle
    container.querySelector('.notebook-preview-btn').addEventListener('click', () => {
      // Save content before toggling if in edit mode
      if (!isPreview && textarea) {
        notebook.content = textarea.value;
        notebook.updatedAt = new Date().toISOString();
        this.saveData();
      }
      this._notebookPreviewMode = isPreview ? null : notebook.id;
      this.renderProjectView();
    });

    // Pin toggle
    container.querySelector('.notebook-pin-btn').addEventListener('click', () => {
      notebook.pinned = !notebook.pinned;
      notebook.updatedAt = new Date().toISOString();
      this.saveData();
      this.renderProjectView();
    });

    // Delete
    container.querySelector('.notebook-delete-btn').addEventListener('click', () => {
      if (confirm(`Delete notebook "${notebook.title}"?`)) {
        this.deleteNotebook(project.id, notebook.id);
      }
    });
  }

  createNotebook(projectId) {
    const project = this.data.projects.find(p => p.id === projectId);
    if (!project) return;
    if (!project.notebooks) project.notebooks = [];

    const now = new Date().toISOString();
    const nb = {
      id: this.generateId(),
      title: 'Untitled Notebook',
      content: '',
      icon: '',
      pinned: false,
      createdAt: now,
      updatedAt: now
    };
    project.notebooks.push(nb);
    this._selectedNotebookId = nb.id;
    this.saveData();
    this.renderProjectView();
  }

  deleteNotebook(projectId, notebookId) {
    const project = this.data.projects.find(p => p.id === projectId);
    if (!project || !project.notebooks) return;
    project.notebooks = project.notebooks.filter(n => n.id !== notebookId);
    if (this._selectedNotebookId === notebookId) {
      this._selectedNotebookId = project.notebooks.length > 0 ? project.notebooks[0].id : null;
    }
    this._notebookPreviewMode = null;
    this.saveData();
    this.renderProjectView();
    this.showToast('Notebook deleted');
  }

  renderMarkdownSimple(md) {
    // Simple markdown to HTML (headings, bold, italic, lists, code blocks, links)
    let html = this.escapeHtml(md);
    // Code blocks
    html = html.replace(/```(\w*)\n([\s\S]*?)```/g, '<pre><code>$2</code></pre>');
    // Inline code
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
    // Headers
    html = html.replace(/^### (.+)$/gm, '<h4>$1</h4>');
    html = html.replace(/^## (.+)$/gm, '<h3>$1</h3>');
    html = html.replace(/^# (.+)$/gm, '<h2>$1</h2>');
    // Bold and italic
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
    // Links
    html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank">$1</a>');
    // Unordered lists
    html = html.replace(/^- (.+)$/gm, '<li>$1</li>');
    html = html.replace(/(<li>.*<\/li>\n?)+/g, '<ul>$&</ul>');
    // Line breaks (for non-block content)
    html = html.replace(/\n/g, '<br>');
    // Clean up extra <br> after block elements
    html = html.replace(/<\/(h[234]|pre|ul|li)><br>/g, '</$1>');
    html = html.replace(/<br><(h[234]|pre|ul)/g, '<$1');
    return html;
  }

  // ========================================
  // PROJECT LAUNCHERS
  // ========================================

  createProjectLaunchersBar(project) {
    const bar = document.createElement('div');
    bar.className = 'project-launchers-bar';

    if (!project.launchers) project.launchers = [];

    if (project.launchers.length === 0 && !project.isInbox) {
      // Show a subtle "+ Add Launcher" link when no launchers exist
      const addLink = document.createElement('button');
      addLink.className = 'launcher-add-first';
      addLink.textContent = '+ Add Claude Launcher';
      addLink.addEventListener('click', () => {
        this.openLauncherModal(project.id);
      });
      bar.appendChild(addLink);
      return bar;
    }

    if (project.isInbox) return bar;

    const label = document.createElement('span');
    label.className = 'launchers-label';
    label.textContent = 'LAUNCHERS';
    bar.appendChild(label);

    project.launchers.forEach(launcher => {
      const pill = document.createElement('div');
      pill.className = 'launcher-pill';

      const nameSpan = document.createElement('span');
      nameSpan.className = 'launcher-pill-name';
      nameSpan.textContent = launcher.name;
      nameSpan.addEventListener('click', () => {
        this.openLauncherModal(project.id, launcher.id);
      });

      const playBtn = document.createElement('button');
      playBtn.className = 'launcher-pill-play';
      playBtn.innerHTML = '&#9654;';
      playBtn.title = `Launch "${launcher.name}" Claude session`;
      playBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.launchClaudeFromLauncher(project.id, launcher.id);
      });

      pill.appendChild(nameSpan);
      pill.appendChild(playBtn);
      bar.appendChild(pill);
    });

    const addBtn = document.createElement('button');
    addBtn.className = 'launcher-pill launcher-add-btn';
    addBtn.textContent = '+ New';
    addBtn.addEventListener('click', () => {
      this.openLauncherModal(project.id);
    });
    bar.appendChild(addBtn);

    return bar;
  }

  openLauncherModal(projectId, launcherId = null) {
    const project = this.data.projects.find(p => p.id === projectId);
    if (!project) return;
    if (!project.launchers) project.launchers = [];

    const existing = launcherId ? project.launchers.find(l => l.id === launcherId) : null;
    const isEdit = !!existing;

    // Remove any existing modal
    document.querySelector('.launcher-modal')?.remove();

    const modal = document.createElement('div');
    modal.className = 'launcher-modal';
    modal.innerHTML = `
      <div class="launcher-modal-backdrop"></div>
      <div class="launcher-modal-content">
        <h3>${isEdit ? 'Edit' : 'New'} Launcher</h3>
        <div class="launcher-form">
          <label>Name</label>
          <input class="launcher-name-input" type="text" value="${this.escapeHtml(existing?.name || '')}" placeholder="e.g. Research, Code Gen, Analysis" />

          <label>Memory / Context <span class="launcher-form-hint">Written to CLAUDE.md — Claude reads this automatically on startup</span></label>
          <textarea class="launcher-memory-input" rows="6" placeholder="Project background, conventions, file paths, data model...">${this.escapeHtml(existing?.memory || '')}</textarea>

          <label>Prompt Template <span class="launcher-form-hint">Copied to clipboard when you launch — paste as your first message</span></label>
          <textarea class="launcher-prompt-input" rows="4" placeholder="You are working on... Your goal is to...">${this.escapeHtml(existing?.prompt || '')}</textarea>

          <label>Flags <span class="launcher-form-hint">Optional CLI flags for claude command</span></label>
          <input class="launcher-flags-input" type="text" value="${this.escapeHtml(existing?.flags || '')}" placeholder="e.g. --dangerously-skip-permissions" />
        </div>
        <div class="launcher-modal-actions">
          ${isEdit ? '<button class="launcher-delete-btn">Delete</button>' : ''}
          <div class="launcher-modal-right">
            <button class="launcher-cancel-btn">Cancel</button>
            <button class="launcher-save-btn">${isEdit ? 'Save' : 'Create'}</button>
          </div>
        </div>
      </div>
    `;

    // Backdrop close
    modal.querySelector('.launcher-modal-backdrop').addEventListener('click', () => modal.remove());

    // Cancel
    modal.querySelector('.launcher-cancel-btn').addEventListener('click', () => modal.remove());

    // Save / Create
    modal.querySelector('.launcher-save-btn').addEventListener('click', () => {
      const name = modal.querySelector('.launcher-name-input').value.trim();
      if (!name) {
        this.showToast('Launcher name is required');
        return;
      }

      const now = new Date().toISOString();
      const data = {
        name,
        memory: modal.querySelector('.launcher-memory-input').value,
        prompt: modal.querySelector('.launcher-prompt-input').value,
        flags: modal.querySelector('.launcher-flags-input').value.trim(),
        updatedAt: now
      };

      if (isEdit) {
        Object.assign(existing, data);
      } else {
        project.launchers.push({
          id: this.generateId(),
          ...data,
          createdAt: now
        });
      }

      this.saveData();
      modal.remove();
      this.renderProjectView();
      this.showToast(isEdit ? 'Launcher updated' : 'Launcher created');
    });

    // Delete
    if (isEdit) {
      modal.querySelector('.launcher-delete-btn').addEventListener('click', () => {
        if (confirm(`Delete launcher "${existing.name}"?`)) {
          project.launchers = project.launchers.filter(l => l.id !== launcherId);
          this.saveData();
          modal.remove();
          this.renderProjectView();
          this.showToast('Launcher deleted');
        }
      });
    }

    document.body.appendChild(modal);
    modal.querySelector('.launcher-name-input').focus();
  }

  async launchClaudeFromLauncher(projectId, launcherId) {
    const project = this.data.projects.find(p => p.id === projectId);
    if (!project) return;
    const launcher = (project.launchers || []).find(l => l.id === launcherId);
    if (!launcher) return;

    let workDir = project.workingDirectory;

    if (!workDir && !project.isInbox) {
      const chosenDir = await this.showSetDirectoryDialog(project.name);
      if (chosenDir) {
        project.workingDirectory = chosenDir;
        this.saveData();
        workDir = chosenDir;
      } else {
        this.showToast('No working directory set — cannot launch');
        return;
      }
    }

    // Build CLAUDE.md: project context + launcher memory
    if (workDir) {
      let claudeMd = this.generateProjectClaudeMd(project.id);

      if (launcher.memory) {
        claudeMd += `\n\n---\n\n## Launcher: ${launcher.name}\n\n${launcher.memory}`;
      }
      if (launcher.outputDir) {
        claudeMd += `\n\nOutput directory: ${launcher.outputDir}`;
      }

      const filePath = workDir.replace(/\\/g, '/') + '/CLAUDE.md';
      try {
        await window.api.writeFile(filePath, claudeMd);
      } catch (err) {
        console.error('Failed to write CLAUDE.md:', err);
      }
    }

    // Copy only the prompt to clipboard (if present)
    if (launcher.prompt) {
      await window.api.copyToClipboard(launcher.prompt);
      this.showToast(`Launching "${launcher.name}" — prompt copied to clipboard`);
    } else {
      this.showToast(`Launching "${launcher.name}"`);
    }

    try {
      const result = await window.api.launchClaudeWithConfig({
        workDir: workDir || undefined,
        title: `${project.name}: ${launcher.name}`,
        flags: launcher.flags || ''
      });
      if (!result.success) {
        this.showToast('Failed to launch: ' + (result.error || 'Unknown error'), 4000);
      }
    } catch (err) {
      this.showToast('Failed to launch Claude session', 4000);
    }
  }

  createEnhancedTaskCard(task, options = {}) {
    const { compact = false } = options;
    const el = document.createElement('div');
    el.className = `enhanced-task-card ${compact ? 'compact' : ''} ${task.status === 'done' ? 'completed' : ''}`;
    el.dataset.id = task.id;
    el.draggable = true;

    // Priority stripe color
    const stripeColor = PRIORITY_COLORS[task.priority] || 'transparent';

    // Only show exec badge for non-default types (AI, Hybrid)
    const execType = task.executionType || 'manual';
    let execBadge = '';
    if (execType === 'ai') execBadge = '<span class="exec-badge exec-ai">AI</span>';
    else if (execType === 'hybrid') execBadge = '<span class="exec-badge exec-hybrid">Hybrid</span>';

    // Claude assign button / queued indicator
    let claudeBadge = '';
    if (execType === 'ai' || execType === 'hybrid') {
      if (task.assignedTo === 'claude') {
        claudeBadge = '<span class="claude-queued-indicator" title="Queued for Claude">\u{1F916}</span>';
      } else {
        claudeBadge = `<button type="button" class="assign-claude-btn" data-action="assign-claude" data-task-id="${task.id}" title="Queue for Claude">\u{1F916}</button>`;
      }
    }

    // Due date — short inline
    let dueHtml = '';
    if (task.dueDate) {
      const today = this.getLocalDateString();
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const tomorrowStr = tomorrow.toISOString().split('T')[0];

      let dueClass = '', dueLabel = this.formatDate(task.dueDate);
      if (task.dueDate < today) { dueClass = 'overdue'; dueLabel = 'Overdue'; }
      else if (task.dueDate === today) { dueClass = 'due-today'; dueLabel = 'Today'; }
      else if (task.dueDate === tomorrowStr) { dueClass = 'due-tomorrow'; dueLabel = 'Tomorrow'; }
      dueHtml = `<span class="due-badge ${dueClass}">${dueLabel}</span>`;
    }

    // Subtask count
    let subtaskHtml = '';
    if (task.subtasks && task.subtasks.length > 0) {
      const done = task.subtasks.filter(st => st.status === 'done').length;
      subtaskHtml = `<span class="subtask-count-badge">${done}/${task.subtasks.length}</span>`;
    }

    // Time estimate
    let timeHtml = '';
    if (task.estimatedMinutes) {
      const m = task.estimatedMinutes;
      timeHtml = `<span class="task-time-badge">${m >= 60 ? Math.round(m / 60 * 10) / 10 + 'h' : m + 'm'}</span>`;
    }

    const checkClass = task.status === 'done' ? 'checked' : '';
    const priorityClass = task.priority !== 'none' ? `priority-${task.priority}` : '';

    // Single row: [stripe] [checkbox] [name] [badges...right-aligned]
    el.innerHTML = `
      <div class="task-card-priority-stripe" style="background:${stripeColor}"></div>
      <div class="task-card-body">
        <button type="button" class="task-checkbox ${checkClass} ${priorityClass}" data-action="toggle" data-task-id="${task.id}">${task.status === 'done' ? '&#10003;' : ''}</button>
        <span class="task-card-name">${this.escapeHtml(task.name)}</span>
        <div class="task-card-badges">
          ${execBadge}
          ${claudeBadge}
          ${subtaskHtml}
          ${timeHtml}
          ${dueHtml}
        </div>
      </div>
    `;

    // Checkbox
    const checkbox = el.querySelector('[data-action="toggle"]');
    checkbox.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.toggleTaskStatus(task.id);
    });
    checkbox.addEventListener('mousedown', (e) => e.stopPropagation());

    // Assign to Claude button
    const assignBtn = el.querySelector('[data-action="assign-claude"]');
    if (assignBtn) {
      assignBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.updateTask(task.id, { assignedTo: 'claude' });
        this.showToast(`Queued "${task.name}" for Claude`);
        this.render();
      });
      assignBtn.addEventListener('mousedown', (e) => e.stopPropagation());
    }

    // Click to open detail
    el.addEventListener('click', () => {
      this.openDetailPanel(task.id);
    });

    // Drag events
    el.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('text/plain', task.id);
      el.classList.add('dragging');
    });
    el.addEventListener('dragend', () => {
      el.classList.remove('dragging');
    });

    return el;
  }

  // ---- LIST VIEW ----

  renderProjectListView(container, project, tasks, viewState) {
    if (tasks.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">&#128203;</div>
          <h3>No tasks match filters</h3>
          <p>Try adjusting your filters or add a new task</p>
        </div>
      `;
      return;
    }

    if (viewState.groupBy !== 'none') {
      const groups = this.groupTasksBy(tasks, viewState.groupBy);

      // Sort group keys
      const sortedKeys = Object.keys(groups).sort((a, b) => {
        if (viewState.groupBy === 'priority') {
          const order = { urgent: 0, high: 1, medium: 2, low: 3, none: 4 };
          return (order[a] ?? 5) - (order[b] ?? 5);
        }
        if (viewState.groupBy === 'status') {
          const order = { 'in-progress': 0, todo: 1, ready: 2, waiting: 3, done: 4 };
          return (order[a] ?? 5) - (order[b] ?? 5);
        }
        if (a === 'overdue') return -1;
        if (b === 'overdue') return 1;
        if (a === 'today') return -1;
        if (b === 'today') return 1;
        if (a === 'no-date') return 1;
        if (b === 'no-date') return -1;
        return a.localeCompare(b);
      });

      // Initialize collapsed groups state
      if (!this._projectCollapsedGroups) this._projectCollapsedGroups = {};

      sortedKeys.forEach(key => {
        const group = groups[key];
        const section = document.createElement('div');
        section.className = 'project-list-group';

        const isCollapsed = this._projectCollapsedGroups[key] || false;

        const groupHeader = document.createElement('div');
        groupHeader.className = `project-list-group-header ${isCollapsed ? 'collapsed' : ''}`;
        groupHeader.innerHTML = `
          <span class="group-toggle">${isCollapsed ? '&#9654;' : '&#9660;'}</span>
          <span class="group-color-dot" style="background:${group.color}"></span>
          <span class="group-label">${this.escapeHtml(group.label)}</span>
          <span class="group-count">${group.tasks.length}</span>
        `;
        groupHeader.addEventListener('click', () => {
          this._projectCollapsedGroups[key] = !this._projectCollapsedGroups[key];
          this.renderProjectView();
        });
        section.appendChild(groupHeader);

        if (!isCollapsed) {
          const tasksContainer = document.createElement('div');
          tasksContainer.className = 'project-list-group-tasks';
          group.tasks.forEach(task => {
            tasksContainer.appendChild(this.createEnhancedTaskCard(task));
          });
          section.appendChild(tasksContainer);
        }

        container.appendChild(section);
      });
    } else {
      tasks.forEach(task => {
        container.appendChild(this.createEnhancedTaskCard(task));
      });
    }
  }

  // ---- BOARD VIEW ----

  renderProjectBoardView(container, project, tasks, viewState) {
    // Board always shows all statuses, so get tasks without status filter
    const allTasks = this.getProjectFilteredTasks(project, { ...viewState, filterStatus: 'all' });

    const board = document.createElement('div');
    board.className = 'project-board';

    const columns = [
      { status: 'todo', label: 'To Do', dot: 'todo' },
      { status: 'in-progress', label: 'In Progress', dot: 'in-progress' },
      { status: 'waiting', label: 'Waiting', dot: 'waiting' },
      { status: 'done', label: 'Done', dot: 'done' }
    ];

    columns.forEach(col => {
      const colTasks = allTasks.filter(t => t.status === col.status);
      const column = document.createElement('div');
      column.className = 'project-board-column';
      column.dataset.status = col.status;

      column.innerHTML = `
        <div class="project-board-column-header">
          <span class="column-dot ${col.dot}"></span>
          <h3>${col.label}</h3>
          <span class="column-count">${colTasks.length}</span>
        </div>
      `;

      const tasksDiv = document.createElement('div');
      tasksDiv.className = 'project-board-tasks';
      tasksDiv.dataset.status = col.status;

      colTasks.forEach(task => {
        tasksDiv.appendChild(this.createEnhancedTaskCard(task, { compact: true }));
      });

      // Drop zone handlers
      tasksDiv.addEventListener('dragover', (e) => {
        e.preventDefault();
        tasksDiv.classList.add('drag-over');
      });
      tasksDiv.addEventListener('dragleave', (e) => {
        if (!tasksDiv.contains(e.relatedTarget)) {
          tasksDiv.classList.remove('drag-over');
        }
      });
      tasksDiv.addEventListener('drop', (e) => {
        e.preventDefault();
        tasksDiv.classList.remove('drag-over');
        const taskId = e.dataTransfer.getData('text/plain');
        if (taskId) {
          this.updateTask(taskId, { status: col.status });
          this.renderProjectView();
        }
      });

      column.appendChild(tasksDiv);
      board.appendChild(column);
    });

    container.appendChild(board);
  }

  // ---- ROADMAP VIEW ----

  computeRoadmapPhases(tasks) {
    const activeTasks = tasks.filter(t => t.status !== 'done');
    const taskMap = new Map(activeTasks.map(t => [t.id, t]));
    const depthCache = new Map();

    const getDepth = (task, visiting = new Set()) => {
      if (depthCache.has(task.id)) return depthCache.get(task.id);
      if (visiting.has(task.id)) {
        depthCache.set(task.id, 0);
        return 0; // cycle guard
      }
      if (!task.blockedBy || task.blockedBy.length === 0) {
        depthCache.set(task.id, 0);
        return 0;
      }
      visiting.add(task.id);
      let maxBlockerDepth = -1;
      for (const blockerId of task.blockedBy) {
        const blocker = taskMap.get(blockerId);
        if (blocker) {
          maxBlockerDepth = Math.max(maxBlockerDepth, getDepth(blocker, visiting));
        }
      }
      const depth = maxBlockerDepth >= 0 ? maxBlockerDepth + 1 : 0;
      depthCache.set(task.id, depth);
      return depth;
    };

    // Compute depth for all active tasks
    for (const task of activeTasks) {
      getDepth(task);
    }

    // Group by depth
    const phaseMap = new Map();
    for (const task of activeTasks) {
      const depth = depthCache.get(task.id) || 0;
      if (!phaseMap.has(depth)) phaseMap.set(depth, []);
      phaseMap.get(depth).push(task);
    }

    // Sort phases by depth, tasks within by priority then name
    const priorities = { urgent: 0, high: 1, medium: 2, low: 3, none: 4 };
    const phases = [];
    const sortedDepths = [...phaseMap.keys()].sort((a, b) => a - b);

    for (const depth of sortedDepths) {
      const phaseTasks = phaseMap.get(depth).sort((a, b) => {
        const pa = priorities[a.priority] ?? 4;
        const pb = priorities[b.priority] ?? 4;
        if (pa !== pb) return pa - pb;
        return (a.name || '').localeCompare(b.name || '');
      });

      // Compute phase date range from task dates
      let startDate = null;
      let endDate = null;
      for (const t of phaseTasks) {
        if (t.startDate) {
          if (!startDate || t.startDate < startDate) startDate = t.startDate;
        }
        if (t.endDate) {
          if (!endDate || t.endDate > endDate) endDate = t.endDate;
        }
      }

      phases.push({
        phaseNumber: depth + 1,
        depth,
        tasks: phaseTasks,
        startDate,
        endDate
      });
    }

    return phases;
  }

  cascadeScheduleDates(project) {
    const activeTasks = (project.tasks || []).filter(t => t.status !== 'done');
    if (activeTasks.length === 0) {
      this.showToast('No active tasks to schedule');
      return;
    }

    const phases = this.computeRoadmapPhases(project.tasks || []);
    const taskCount = phases.reduce((sum, p) => sum + p.tasks.length, 0);

    this.showConfirmDialog(
      'Cascade Dates',
      `This will set start/end dates for ${taskCount} active tasks based on dependency order and estimated durations. Continue?`,
      () => {
        const startDateStr = project.roadmapStartDate || this.getLocalDateString();
        const endDateMap = new Map(); // taskId -> endDate string

        for (const phase of phases) {
          for (const task of phase.tasks) {
            // Determine task start date
            let taskStart = startDateStr;
            if (task.blockedBy && task.blockedBy.length > 0) {
              let latestBlockerEnd = null;
              for (const blockerId of task.blockedBy) {
                const blockerEnd = endDateMap.get(blockerId);
                if (blockerEnd && (!latestBlockerEnd || blockerEnd > latestBlockerEnd)) {
                  latestBlockerEnd = blockerEnd;
                }
              }
              if (latestBlockerEnd) {
                taskStart = this.shiftDate(latestBlockerEnd, 1);
              }
            }

            // Compute duration in days (8h workday)
            const estMinutes = task.estimatedMinutes || 480; // default 1 day
            const durationDays = Math.max(1, Math.ceil(estMinutes / 480));
            const taskEnd = this.shiftDate(taskStart, durationDays - 1);

            endDateMap.set(task.id, taskEnd);
            this.updateTask(task.id, { startDate: taskStart, endDate: taskEnd });
          }
        }

        this.showToast(`Dates cascaded for ${taskCount} tasks`);
        this.renderProjectView();
      }
    );
  }

  renderProjectRoadmapView(container, project, tasks, viewState) {
    const phases = this.computeRoadmapPhases(tasks);
    const completedTasks = (tasks || []).filter(t => t.status === 'done');

    const roadmap = document.createElement('div');
    roadmap.className = 'roadmap-view';

    // Toolbar: project start date + cascade button
    const toolbar = document.createElement('div');
    toolbar.className = 'roadmap-toolbar';
    const currentStart = project.roadmapStartDate || this.getLocalDateString();
    toolbar.innerHTML = `
      <div class="roadmap-toolbar-left">
        <label class="roadmap-start-label">Project start:
          <input type="date" class="roadmap-start-input" value="${this.escapeHtml(currentStart)}" />
        </label>
      </div>
      <button class="roadmap-cascade-btn">Cascade Dates</button>
    `;

    toolbar.querySelector('.roadmap-start-input').addEventListener('change', (e) => {
      const val = e.target.value;
      if (val) {
        this.updateProject(project.id, { roadmapStartDate: val });
      }
    });

    toolbar.querySelector('.roadmap-cascade-btn').addEventListener('click', () => {
      // Re-fetch project in case start date just changed
      const proj = this.data.projects.find(p => p.id === project.id);
      this.cascadeScheduleDates(proj);
    });

    roadmap.appendChild(toolbar);

    // Phases
    if (phases.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'roadmap-empty';
      empty.textContent = 'No active tasks in this project.';
      roadmap.appendChild(empty);
    } else {
      for (const phase of phases) {
        const phaseEl = document.createElement('div');
        phaseEl.className = 'roadmap-phase';

        // Phase header
        const depLabel = phase.depth === 0
          ? 'No blockers'
          : `Depends on Phase ${phase.depth}`;
        const dateRange = (phase.startDate && phase.endDate)
          ? `${this.formatDate(phase.startDate)} \u2013 ${this.formatDate(phase.endDate)}`
          : (phase.startDate ? `Starts ${this.formatDate(phase.startDate)}` : 'Dates not set');

        const header = document.createElement('div');
        header.className = 'roadmap-phase-header';
        header.innerHTML = `
          <div class="roadmap-phase-title">
            <span class="roadmap-phase-num">Phase ${phase.phaseNumber}</span>
            <span class="roadmap-phase-dep">\u2014 ${this.escapeHtml(depLabel)}</span>
          </div>
          <span class="roadmap-phase-dates">${dateRange}</span>
        `;
        phaseEl.appendChild(header);

        // Task rows
        for (const task of phase.tasks) {
          const row = document.createElement('div');
          row.className = 'roadmap-task-row';

          // Priority stripe color
          const prioColors = { urgent: '#ef4444', high: '#f97316', medium: '#eab308', low: '#3b82f6', none: '#6b7280' };
          const prioColor = prioColors[task.priority] || prioColors.none;

          // Status icon
          const statusIcons = { 'todo': '\u25CB', 'in-progress': '\u25D4', 'waiting': '\u23F8' };
          const statusIcon = statusIcons[task.status] || '\u25CB';

          // Execution badge
          const execBadge = task.executionType && task.executionType !== 'manual'
            ? `<span class="roadmap-exec-badge roadmap-exec-${this.escapeHtml(task.executionType)}">${this.escapeHtml(task.executionType)}</span>`
            : '';

          // Duration
          const estMin = task.estimatedMinutes;
          let durationLabel = '';
          if (estMin) {
            const days = Math.ceil(estMin / 480);
            durationLabel = days === 1 ? '1d' : `${days}d`;
          }

          // Assignee
          const assignee = task.assignee ? this.escapeHtml(task.assignee) : '';

          // Date range
          let taskDates = '';
          if (task.startDate && task.endDate) {
            taskDates = `${this.formatDate(task.startDate)} \u2013 ${this.formatDate(task.endDate)}`;
          } else if (task.startDate) {
            taskDates = `Starts ${this.formatDate(task.startDate)}`;
          }

          // Dependency labels
          let depLabels = '';
          if (task.blockedBy && task.blockedBy.length > 0) {
            const blockerNames = task.blockedBy
              .map(id => this.findTask(id))
              .filter(Boolean)
              .map(t => this.escapeHtml(t.name.length > 25 ? t.name.slice(0, 25) + '\u2026' : t.name));
            if (blockerNames.length > 0) {
              depLabels = `<span class="roadmap-dep-label">blocked by ${blockerNames.join(', ')}</span>`;
            }
          }

          row.innerHTML = `
            <div class="roadmap-task-stripe" style="background: ${prioColor}"></div>
            <span class="roadmap-task-status">${statusIcon}</span>
            <span class="roadmap-task-name">${this.escapeHtml(task.name)}</span>
            ${execBadge}
            ${durationLabel ? `<span class="roadmap-task-duration">[${durationLabel}]</span>` : ''}
            ${assignee ? `<span class="roadmap-task-assignee">[${assignee}]</span>` : ''}
            ${taskDates ? `<span class="roadmap-task-dates">${taskDates}</span>` : ''}
            ${depLabels}
          `;

          row.addEventListener('click', () => this.openDetailPanel(task.id));
          phaseEl.appendChild(row);
        }

        roadmap.appendChild(phaseEl);
      }
    }

    // Completed tasks summary
    if (completedTasks.length > 0) {
      const completed = document.createElement('div');
      completed.className = 'roadmap-completed-summary';
      completed.innerHTML = `<span class="roadmap-completed-icon">\u2713</span> ${completedTasks.length} completed task${completedTasks.length !== 1 ? 's' : ''}`;
      roadmap.appendChild(completed);
    }

    container.appendChild(roadmap);
  }

  // ---- TIMELINE VIEW ----

  renderProjectTimelineView(container, project, tasks, viewState) {
    // Clean up previous event listeners
    if (this._tlCleanup) {
      this._tlCleanup();
      this._tlCleanup = null;
    }

    const projectId = project.id;

    // Initialize timeline state
    if (!this._projectTimelineState[projectId]) {
      this._projectTimelineState[projectId] = {
        anchorDate: this.getLocalDateString(),
        tableWidth: 280,
        groupBy: 'none'
      };
    }
    const tlState = this._projectTimelineState[projectId];
    const range = viewState.timelineRange || 'month';

    // Calculate date range
    const anchor = new Date(tlState.anchorDate + 'T12:00:00');
    let startDate, endDate;

    if (range === 'week') {
      const dayOfWeek = anchor.getDay();
      startDate = new Date(anchor);
      startDate.setDate(anchor.getDate() - dayOfWeek);
      endDate = new Date(startDate);
      endDate.setDate(startDate.getDate() + 6);
    } else {
      startDate = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
      endDate = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0);
    }

    // Generate day columns
    const days = [];
    const cur = new Date(startDate);
    while (cur <= endDate) {
      days.push(new Date(cur));
      cur.setDate(cur.getDate() + 1);
    }

    const todayStr = this.getLocalDateString();
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

    const rangeLabel = range === 'week'
      ? `${monthNames[startDate.getMonth()]} ${startDate.getDate()} - ${monthNames[endDate.getMonth()]} ${endDate.getDate()}, ${endDate.getFullYear()}`
      : `${monthNames[startDate.getMonth()]} ${startDate.getFullYear()}`;

    // Get tasks
    const allTasks = this.getProjectFilteredTasks(project, { ...this.getProjectViewState(projectId), filterStatus: 'active' });
    const datedTasks = [];
    const undatedTasks = [];
    allTasks.forEach(task => {
      const hasDate = task.startDate || task.endDate || task.scheduledDate || task.dueDate;
      if (hasDate) datedTasks.push(task);
      else undatedTasks.push(task);
    });

    // Resolve effective start/end for each task
    const taskDateInfo = datedTasks.map(task => {
      const s = task.startDate || task.scheduledDate || task.endDate || task.dueDate;
      const e = task.endDate || task.dueDate || task.startDate || task.scheduledDate;
      return { task, startStr: s < e ? s : e, endStr: e > s ? e : s };
    });

    const dayStrs = days.map(d => this.getLocalDateString(d));
    const firstDayStr = dayStrs[0];
    const lastDayStr = dayStrs[dayStrs.length - 1];
    const colWidth = range === 'week' ? 120 : 40;
    const rowHeight = 40;

    // Group tasks
    const groupBy = tlState.groupBy || 'none';
    let groups;
    if (groupBy === 'assignee') {
      const byAssignee = {};
      taskDateInfo.forEach(info => {
        const key = info.task.assignee || 'Unassigned';
        if (!byAssignee[key]) byAssignee[key] = [];
        byAssignee[key].push(info);
      });
      groups = Object.entries(byAssignee).map(([name, items]) => ({ label: name, items }));
    } else {
      groups = [{ label: null, items: taskDateInfo }];
    }

    // Build DOM
    const timeline = document.createElement('div');
    timeline.className = 'project-timeline';

    // Toolbar
    const toolbar = document.createElement('div');
    toolbar.className = 'project-timeline-toolbar';
    toolbar.innerHTML = `
      <button class="tl-nav-btn" data-dir="prev">&#9664; Prev</button>
      <span class="tl-range-label">${rangeLabel}</span>
      <button class="tl-nav-btn" data-dir="next">Next &#9654;</button>
      <div class="tl-range-toggle">
        <button class="tl-range-btn ${range === 'week' ? 'active' : ''}" data-range="week">Week</button>
        <button class="tl-range-btn ${range === 'month' ? 'active' : ''}" data-range="month">Month</button>
      </div>
      <div class="tl-group-control">
        <label>Group:</label>
        <select class="tl-group-select">
          <option value="none" ${groupBy === 'none' ? 'selected' : ''}>None</option>
          <option value="assignee" ${groupBy === 'assignee' ? 'selected' : ''}>Assignee</option>
        </select>
      </div>
    `;
    timeline.appendChild(toolbar);

    // Navigation events
    toolbar.querySelectorAll('.tl-nav-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const dir = btn.dataset.dir;
        const current = new Date(tlState.anchorDate + 'T12:00:00');
        if (range === 'week') {
          current.setDate(current.getDate() + (dir === 'next' ? 7 : -7));
        } else {
          current.setMonth(current.getMonth() + (dir === 'next' ? 1 : -1));
        }
        tlState.anchorDate = this.getLocalDateString(current);
        this.renderProjectView();
      });
    });

    toolbar.querySelectorAll('.tl-range-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        this.updateProjectViewPref(projectId, 'timelineRange', btn.dataset.range);
      });
    });

    toolbar.querySelector('.tl-group-select').addEventListener('change', (e) => {
      tlState.groupBy = e.target.value;
      this.renderProjectView();
    });

    // Split-panel body
    const body = document.createElement('div');
    body.className = 'tl-body';
    body.style.setProperty('--tl-table-width', `${tlState.tableWidth}px`);

    // === LEFT TABLE PANEL ===
    const tablePanel = document.createElement('div');
    tablePanel.className = 'tl-table-panel';

    const tableHeader = document.createElement('div');
    tableHeader.className = 'tl-table-header';
    tableHeader.innerHTML = `
      <div class="tl-th tl-th-name">Task</div>
      <div class="tl-th tl-th-assignee">Assignee</div>
      <div class="tl-th tl-th-start">Start</div>
      <div class="tl-th tl-th-end">End</div>
    `;
    tablePanel.appendChild(tableHeader);

    const tableBody = document.createElement('div');
    tableBody.className = 'tl-table-body';
    this.renderTLTable(tableBody, groups, rowHeight);
    tablePanel.appendChild(tableBody);

    body.appendChild(tablePanel);

    // === RESIZE HANDLE ===
    const resizeHandle = document.createElement('div');
    resizeHandle.className = 'tl-resize-handle';
    body.appendChild(resizeHandle);

    // === RIGHT CHART PANEL ===
    const chartPanel = document.createElement('div');
    chartPanel.className = 'tl-chart-panel';

    const chartHeader = document.createElement('div');
    chartHeader.className = 'tl-chart-header';
    chartHeader.style.width = `${days.length * colWidth}px`;
    days.forEach(day => {
      const dayStr = this.getLocalDateString(day);
      const isToday = dayStr === todayStr;
      const isWeekend = day.getDay() === 0 || day.getDay() === 6;
      const col = document.createElement('div');
      col.className = `tl-col-header ${isToday ? 'tl-today' : ''} ${isWeekend ? 'tl-weekend' : ''}`;
      col.style.width = `${colWidth}px`;
      col.innerHTML = `<span class="tl-day-name">${dayNames[day.getDay()]}</span><span class="tl-day-num">${day.getDate()}</span>`;
      chartHeader.appendChild(col);
    });

    const chartHeaderWrap = document.createElement('div');
    chartHeaderWrap.className = 'tl-chart-header-wrap';
    chartHeaderWrap.appendChild(chartHeader);
    chartPanel.appendChild(chartHeaderWrap);

    const chartBody = document.createElement('div');
    chartBody.className = 'tl-chart-body';

    const chartInner = document.createElement('div');
    chartInner.className = 'tl-chart-inner';
    chartInner.style.width = `${days.length * colWidth}px`;

    // Column background lines
    const colBg = document.createElement('div');
    colBg.className = 'tl-col-backgrounds';
    colBg.style.width = `${days.length * colWidth}px`;
    days.forEach((day, i) => {
      const dayStr = this.getLocalDateString(day);
      const isToday = dayStr === todayStr;
      const isWeekend = day.getDay() === 0 || day.getDay() === 6;
      const bg = document.createElement('div');
      bg.className = `tl-col-bg ${isToday ? 'tl-today-bg' : ''} ${isWeekend ? 'tl-weekend-bg' : ''}`;
      bg.style.left = `${i * colWidth}px`;
      bg.style.width = `${colWidth}px`;
      colBg.appendChild(bg);
    });
    chartInner.appendChild(colBg);

    // Today indicator line
    const todayIdx = dayStrs.indexOf(todayStr);
    if (todayIdx >= 0) {
      const todayLine = document.createElement('div');
      todayLine.className = 'tl-today-line';
      todayLine.style.left = `${todayIdx * colWidth + colWidth / 2}px`;
      chartInner.appendChild(todayLine);
    }

    // Render bars
    this.renderTLChart(chartInner, groups, dayStrs, colWidth, rowHeight, firstDayStr, lastDayStr);

    // SVG arrow layer
    const svgNS = 'http://www.w3.org/2000/svg';
    const arrowSvg = document.createElementNS(svgNS, 'svg');
    arrowSvg.classList.add('tl-arrows-svg');
    arrowSvg.setAttribute('width', `${days.length * colWidth}`);
    arrowSvg.setAttribute('height', '100%');
    // Arrowhead marker
    const defs = document.createElementNS(svgNS, 'defs');
    const marker = document.createElementNS(svgNS, 'marker');
    marker.setAttribute('id', 'tl-arrowhead');
    marker.setAttribute('markerWidth', '8');
    marker.setAttribute('markerHeight', '6');
    marker.setAttribute('refX', '8');
    marker.setAttribute('refY', '3');
    marker.setAttribute('orient', 'auto');
    const arrowPath = document.createElementNS(svgNS, 'path');
    arrowPath.setAttribute('d', 'M0,0 L8,3 L0,6 Z');
    arrowPath.setAttribute('fill', 'var(--text-muted)');
    marker.appendChild(arrowPath);
    defs.appendChild(marker);
    arrowSvg.appendChild(defs);
    chartInner.appendChild(arrowSvg);

    chartBody.appendChild(chartInner);
    chartPanel.appendChild(chartBody);
    body.appendChild(chartPanel);
    timeline.appendChild(body);

    // Undated drawer
    if (undatedTasks.length > 0) {
      const drawer = document.createElement('div');
      drawer.className = 'tl-undated-drawer';
      const drawerToggle = document.createElement('div');
      drawerToggle.className = 'tl-undated-toggle';
      drawerToggle.innerHTML = `<span class="tl-undated-arrow">&#9654;</span> No Date Assigned (${undatedTasks.length} tasks)`;
      drawerToggle.addEventListener('click', () => {
        drawer.classList.toggle('expanded');
        drawerToggle.querySelector('.tl-undated-arrow').innerHTML = drawer.classList.contains('expanded') ? '&#9660;' : '&#9654;';
      });
      drawer.appendChild(drawerToggle);
      const drawerList = document.createElement('div');
      drawerList.className = 'tl-undated-list';
      undatedTasks.forEach(task => {
        drawerList.appendChild(this.createEnhancedTaskCard(task, { compact: true }));
      });
      drawer.appendChild(drawerList);
      timeline.appendChild(drawer);
    }

    container.appendChild(timeline);

    // Bind interactions after DOM is in place
    this.bindTLEvents(projectId, body, tlState, dayStrs, colWidth, rowHeight, firstDayStr, lastDayStr);

    // Render dependency arrows after layout
    requestAnimationFrame(() => {
      this.renderTLArrows(arrowSvg, chartInner, groups, dayStrs, colWidth, rowHeight, firstDayStr, lastDayStr);
    });
  }

  renderTLTable(tableBody, groups, rowHeight) {
    groups.forEach(group => {
      if (group.label) {
        const groupRow = document.createElement('div');
        groupRow.className = 'tl-table-group-row';
        groupRow.style.height = `${rowHeight}px`;
        groupRow.innerHTML = `<span class="tl-group-label">${this.escapeHtml(group.label)}</span> <span class="tl-group-count">(${group.items.length})</span>`;
        tableBody.appendChild(groupRow);
      }
      group.items.forEach(({ task }) => {
        const row = document.createElement('div');
        row.className = `tl-table-row ${task.status === 'done' ? 'tl-completed' : ''} ${this.isTaskBlocked(task) ? 'tl-blocked' : ''}`;
        row.style.height = `${rowHeight}px`;
        row.dataset.taskId = task.id;

        const dotColor = PRIORITY_COLORS[task.priority || 'none'] || 'transparent';

        row.innerHTML = `
          <div class="tl-td tl-td-name" title="${this.escapeHtml(task.name)}">
            <span class="tl-priority-dot" style="background:${dotColor}"></span>
            ${this.escapeHtml(task.name)}
          </div>
          <div class="tl-td tl-td-assignee">${this.escapeHtml(task.assignee || '-')}</div>
          <div class="tl-td tl-td-start">${task.startDate ? this.formatShortDate(task.startDate) : '-'}</div>
          <div class="tl-td tl-td-end">${task.endDate ? this.formatShortDate(task.endDate) : '-'}</div>
        `;
        row.addEventListener('click', () => this.openDetailPanel(task.id));
        tableBody.appendChild(row);
      });
    });
  }

  renderTLChart(chartInner, groups, dayStrs, colWidth, rowHeight, firstDayStr, lastDayStr) {
    const assigneePalette = ['#6366f1', '#059669', '#0284c7', '#dc2626', '#ea580c', '#7c3aed', '#0891b2', '#be185d'];
    const assigneeColors = {};
    let colorIdx = 0;

    let rowIndex = 0;
    groups.forEach(group => {
      if (group.label) {
        // Group header takes one row of space
        rowIndex++;
      }
      group.items.forEach(({ task, startStr, endStr }) => {
        // Get color
        const assignee = task.assignee || 'Unassigned';
        if (!assigneeColors[assignee]) {
          assigneeColors[assignee] = assigneePalette[colorIdx % assigneePalette.length];
          colorIdx++;
        }

        // Calculate bar position
        const clampedStart = startStr < firstDayStr ? firstDayStr : (startStr > lastDayStr ? lastDayStr : startStr);
        const clampedEnd = endStr > lastDayStr ? lastDayStr : (endStr < firstDayStr ? firstDayStr : endStr);
        const startIdx = dayStrs.indexOf(clampedStart);
        const endIdx = dayStrs.indexOf(clampedEnd);

        if (startStr > lastDayStr || endStr < firstDayStr) {
          rowIndex++;
          return;
        }

        const effectiveStart = startIdx >= 0 ? startIdx : 0;
        const effectiveEnd = endIdx >= 0 ? endIdx : dayStrs.length - 1;

        const barLeft = effectiveStart * colWidth;
        const barWidth = (effectiveEnd - effectiveStart + 1) * colWidth;
        const barTop = rowIndex * rowHeight + 8; // 8px vertical padding

        const bar = document.createElement('div');
        bar.className = `tl-gantt-bar ${task.status === 'done' ? 'tl-bar-completed' : ''} ${this.isTaskBlocked(task) ? 'tl-bar-blocked' : ''}`;
        bar.dataset.taskId = task.id;
        bar.style.left = `${barLeft}px`;
        bar.style.width = `${barWidth}px`;
        bar.style.top = `${barTop}px`;
        bar.style.backgroundColor = assigneeColors[assignee];

        bar.innerHTML = `
          <div class="tl-bar-resize-left"></div>
          <span class="tl-bar-label">${this.escapeHtml(task.name)}</span>
          <div class="tl-bar-resize-right"></div>
        `;

        // Tooltip
        const tips = [task.name];
        if (task.assignee) tips.push(`Assignee: ${task.assignee}`);
        if (task.startDate) tips.push(`Start: ${task.startDate}`);
        if (task.endDate) tips.push(`End: ${task.endDate}`);
        if (task.priority !== 'none') tips.push(`Priority: ${task.priority}`);
        bar.title = tips.join('\n');

        bar.addEventListener('click', (e) => {
          if (!e.target.classList.contains('tl-bar-resize-left') && !e.target.classList.contains('tl-bar-resize-right')) {
            this.openDetailPanel(task.id);
          }
        });

        chartInner.appendChild(bar);
        rowIndex++;
      });
    });

    // Set chart inner height
    chartInner.style.minHeight = `${rowIndex * rowHeight}px`;
  }

  renderTLArrows(svg, chartInner, groups, dayStrs, colWidth, rowHeight, firstDayStr, lastDayStr) {
    // Clear existing paths
    svg.querySelectorAll('path.tl-dep-arrow').forEach(p => p.remove());

    // Build task-to-row-index map
    const taskRowMap = {};
    let rowIndex = 0;
    groups.forEach(group => {
      if (group.label) rowIndex++;
      group.items.forEach(({ task }) => {
        taskRowMap[task.id] = rowIndex;
        rowIndex++;
      });
    });

    // Set SVG height
    const totalHeight = rowIndex * rowHeight;
    svg.setAttribute('height', totalHeight);

    const svgNS = 'http://www.w3.org/2000/svg';

    // For each task with blockedBy, draw arrows from blocker to blocked
    groups.forEach(group => {
      group.items.forEach(({ task, startStr }) => {
        if (!Array.isArray(task.blockedBy) || task.blockedBy.length === 0) return;

        const toRow = taskRowMap[task.id];
        if (toRow === undefined) return;

        // Target bar left edge
        const toStart = startStr < firstDayStr ? firstDayStr : (startStr > lastDayStr ? lastDayStr : startStr);
        const toIdx = dayStrs.indexOf(toStart);
        if (toIdx < 0) return;
        const toX = toIdx * colWidth;
        const toY = toRow * rowHeight + rowHeight / 2;

        task.blockedBy.forEach(blockerId => {
          const fromRow = taskRowMap[blockerId];
          if (fromRow === undefined) return;

          // Find blocker's end date
          const blockerInfo = null;
          let blockerEndStr = null;
          for (const g of groups) {
            for (const info of g.items) {
              if (info.task.id === blockerId) {
                blockerEndStr = info.endStr;
                break;
              }
            }
            if (blockerEndStr) break;
          }
          if (!blockerEndStr) return;

          const fromEnd = blockerEndStr > lastDayStr ? lastDayStr : (blockerEndStr < firstDayStr ? firstDayStr : blockerEndStr);
          const fromIdx = dayStrs.indexOf(fromEnd);
          if (fromIdx < 0) return;
          const fromX = (fromIdx + 1) * colWidth;
          const fromY = fromRow * rowHeight + rowHeight / 2;

          // Draw bezier curve
          const midX = (fromX + toX) / 2;
          const path = document.createElementNS(svgNS, 'path');
          path.classList.add('tl-dep-arrow');
          path.setAttribute('d', `M${fromX},${fromY} C${midX},${fromY} ${midX},${toY} ${toX},${toY}`);
          path.setAttribute('fill', 'none');
          path.setAttribute('stroke', 'var(--text-muted)');
          path.setAttribute('stroke-width', '1.5');
          path.setAttribute('marker-end', 'url(#tl-arrowhead)');
          path.dataset.from = blockerId;
          path.dataset.to = task.id;
          svg.appendChild(path);
        });
      });
    });
  }

  formatShortDate(dateStr) {
    if (!dateStr) return '';
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const d = new Date(dateStr + 'T12:00:00');
    return `${monthNames[d.getMonth()]} ${d.getDate()}`;
  }

  dayToTLPixel(dateStr, dayStrs, colWidth) {
    const idx = dayStrs.indexOf(dateStr);
    return idx >= 0 ? idx * colWidth : -1;
  }

  pixelToTLDate(px, dayStrs, colWidth) {
    const idx = Math.round(px / colWidth);
    const clamped = Math.max(0, Math.min(idx, dayStrs.length - 1));
    return dayStrs[clamped];
  }

  shiftDate(dateStr, numDays) {
    const d = new Date(dateStr + 'T12:00:00');
    d.setDate(d.getDate() + numDays);
    return this.getLocalDateString(d);
  }

  bindTLEvents(projectId, body, tlState, dayStrs, colWidth, rowHeight, firstDayStr, lastDayStr) {
    const tableBody = body.querySelector('.tl-table-body');
    const chartBody = body.querySelector('.tl-chart-body');
    const chartHeaderWrap = body.querySelector('.tl-chart-header-wrap');
    const resizeHandle = body.querySelector('.tl-resize-handle');

    // Scroll sync: table body ↔ chart body vertical
    const syncScroll = (source, target, dir) => {
      source.addEventListener('scroll', () => {
        if (dir === 'vertical') target.scrollTop = source.scrollTop;
        if (dir === 'horizontal') target.scrollLeft = source.scrollLeft;
      });
    };
    syncScroll(tableBody, chartBody, 'vertical');
    syncScroll(chartBody, tableBody, 'vertical');

    // Chart body horizontal → chart header horizontal
    chartBody.addEventListener('scroll', () => {
      chartHeaderWrap.scrollLeft = chartBody.scrollLeft;
    });

    // Panel resize handle
    let resizing = false;
    let resizeStartX = 0;
    let resizeStartWidth = 0;

    resizeHandle.addEventListener('mousedown', (e) => {
      resizing = true;
      resizeStartX = e.clientX;
      resizeStartWidth = tlState.tableWidth;
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
      e.preventDefault();
    });

    const onResizeMove = (e) => {
      if (!resizing) return;
      const delta = e.clientX - resizeStartX;
      const newWidth = Math.max(180, Math.min(500, resizeStartWidth + delta));
      tlState.tableWidth = newWidth;
      body.style.setProperty('--tl-table-width', `${newWidth}px`);
    };

    const onResizeUp = () => {
      if (!resizing) return;
      resizing = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    document.addEventListener('mousemove', onResizeMove);
    document.addEventListener('mouseup', onResizeUp);

    // Bar drag (move) and resize (edge)
    const chartInner = chartBody.querySelector('.tl-chart-inner');
    let dragging = null; // { taskId, type: 'move'|'resize-left'|'resize-right', startX, origLeft, origWidth, origStartDate, origEndDate }

    chartInner.addEventListener('mousedown', (e) => {
      const bar = e.target.closest('.tl-gantt-bar');
      if (!bar) return;

      const taskId = bar.dataset.taskId;
      const task = this.findTask(taskId);
      if (!task) return;

      const rect = chartInner.getBoundingClientRect();
      const startX = e.clientX - rect.left + chartBody.scrollLeft;

      const origStartDate = task.startDate || task.scheduledDate || task.endDate || task.dueDate;
      const origEndDate = task.endDate || task.dueDate || task.startDate || task.scheduledDate;

      let type = 'move';
      if (e.target.classList.contains('tl-bar-resize-left')) type = 'resize-left';
      else if (e.target.classList.contains('tl-bar-resize-right')) type = 'resize-right';

      dragging = {
        taskId,
        bar,
        type,
        startX,
        origLeft: parseInt(bar.style.left),
        origWidth: parseInt(bar.style.width),
        origStartDate,
        origEndDate
      };

      document.body.style.cursor = type === 'move' ? 'grabbing' : 'col-resize';
      document.body.style.userSelect = 'none';
      e.preventDefault();
    });

    const onDragMove = (e) => {
      if (!dragging) return;
      const rect = chartInner.getBoundingClientRect();
      const mouseX = e.clientX - rect.left + chartBody.scrollLeft;
      const delta = mouseX - dragging.startX;

      if (dragging.type === 'move') {
        const newLeft = Math.max(0, dragging.origLeft + delta);
        dragging.bar.style.left = `${newLeft}px`;
      } else if (dragging.type === 'resize-left') {
        const newLeft = Math.max(0, dragging.origLeft + delta);
        const newWidth = dragging.origWidth - delta;
        if (newWidth >= colWidth) {
          dragging.bar.style.left = `${newLeft}px`;
          dragging.bar.style.width = `${newWidth}px`;
        }
      } else if (dragging.type === 'resize-right') {
        const newWidth = Math.max(colWidth, dragging.origWidth + delta);
        dragging.bar.style.width = `${newWidth}px`;
      }
    };

    const onDragUp = (e) => {
      if (!dragging) return;

      const rect = chartInner.getBoundingClientRect();
      const mouseX = e.clientX - rect.left + chartBody.scrollLeft;
      const delta = mouseX - dragging.startX;

      const task = this.findTask(dragging.taskId);
      if (task && Math.abs(delta) > 5) {
        if (dragging.type === 'move') {
          const dayShift = Math.round(delta / colWidth);
          if (dayShift !== 0) {
            const updates = {};
            if (task.startDate) updates.startDate = this.shiftDate(task.startDate, dayShift);
            if (task.endDate) updates.endDate = this.shiftDate(task.endDate, dayShift);
            if (task.scheduledDate) updates.scheduledDate = this.shiftDate(task.scheduledDate, dayShift);
            if (task.dueDate) updates.dueDate = this.shiftDate(task.dueDate, dayShift);
            this.updateTask(dragging.taskId, updates);
          }
        } else if (dragging.type === 'resize-left') {
          const newLeft = Math.max(0, dragging.origLeft + delta);
          const newDate = this.pixelToTLDate(newLeft, dayStrs, colWidth);
          if (newDate && task.startDate) {
            this.updateTask(dragging.taskId, { startDate: newDate });
          } else if (newDate && task.scheduledDate) {
            this.updateTask(dragging.taskId, { scheduledDate: newDate });
          }
        } else if (dragging.type === 'resize-right') {
          const newRight = dragging.origLeft + Math.max(colWidth, dragging.origWidth + delta);
          const newDate = this.pixelToTLDate(newRight - 1, dayStrs, colWidth);
          if (newDate && task.endDate) {
            this.updateTask(dragging.taskId, { endDate: newDate });
          } else if (newDate && task.dueDate) {
            this.updateTask(dragging.taskId, { dueDate: newDate });
          }
        }
        this.renderProjectView();
      }

      dragging = null;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    document.addEventListener('mousemove', onDragMove);
    document.addEventListener('mouseup', onDragUp);

    // Highlight arrows on bar hover
    chartInner.addEventListener('mouseover', (e) => {
      const bar = e.target.closest('.tl-gantt-bar');
      if (!bar) return;
      const taskId = bar.dataset.taskId;
      chartInner.querySelectorAll('.tl-dep-arrow').forEach(path => {
        if (path.dataset.from === taskId || path.dataset.to === taskId) {
          path.classList.add('tl-arrow-highlight');
        }
      });
    });

    chartInner.addEventListener('mouseout', (e) => {
      const bar = e.target.closest('.tl-gantt-bar');
      if (!bar) return;
      chartInner.querySelectorAll('.tl-dep-arrow.tl-arrow-highlight').forEach(path => {
        path.classList.remove('tl-arrow-highlight');
      });
    });

    // Clean up on next render
    this._tlCleanup = () => {
      document.removeEventListener('mousemove', onResizeMove);
      document.removeEventListener('mouseup', onResizeUp);
      document.removeEventListener('mousemove', onDragMove);
      document.removeEventListener('mouseup', onDragUp);
    };
  }

  groupTasksBy(tasks, groupBy) {
    const groups = {};

    tasks.forEach(task => {
      let key;
      let label;
      let color;

      switch (groupBy) {
        case 'project':
          const project = this.data.projects.find(p => p.tasks.some(t => t.id === task.id));
          key = project?.id || 'inbox';
          label = project?.name || 'Inbox';
          color = project?.color || '#6366f1';
          break;

        case 'priority':
          key = task.priority || 'none';
          label = key.charAt(0).toUpperCase() + key.slice(1);
          color = PRIORITY_COLORS[key] || '#9ca3af';
          break;

        case 'status':
          key = task.status || 'todo';
          label = this.formatStatus(key);
          const statusColors = { todo: '#6b7280', ready: '#0284c7', 'in-progress': '#d97706', waiting: '#dc2626', done: '#059669' };
          color = statusColors[key];
          break;

        case 'dueDate':
          const dueDate = task.dueDate;
          const today = this.getLocalDateString();
          if (!dueDate) {
            key = 'no-date';
            label = 'No Due Date';
          } else if (dueDate < today) {
            key = 'overdue';
            label = 'Overdue';
          } else if (dueDate === today) {
            key = 'today';
            label = 'Today';
          } else {
            key = dueDate;
            label = this.formatDate(dueDate);
          }
          color = '#6366f1';
          break;

        default:
          key = 'all';
          label = 'All Tasks';
          color = '#6366f1';
      }

      if (!groups[key]) {
        groups[key] = { label, color, tasks: [] };
      }
      groups[key].tasks.push(task);
    });

    return groups;
  }

  // --- Command Palette ---

  openCommandPalette() {
    const overlay = document.getElementById('command-palette');
    if (!overlay) return;
    overlay.style.display = 'flex';
    this._paletteIndex = 0;
    this._paletteResults = [];

    const input = document.getElementById('command-palette-input');
    input.value = '';
    input.focus();

    // Build search index
    this._paletteAllTasks = [];
    const tagLookup = {};
    (this.data.tags || []).forEach(t => { tagLookup[t.id] = t.name; });

    for (const project of (this.data.projects || [])) {
      for (const task of (project.tasks || [])) {
        const tags = (task.tags || []).map(id => tagLookup[id]).filter(Boolean);
        this._paletteAllTasks.push({
          task,
          projectName: project.isInbox ? '' : project.name,
          tagNames: tags,
          searchText: [
            task.name,
            project.name,
            ...tags,
            task.description || '',
            task.assignedTo || '',
          ].join(' ').toLowerCase(),
        });
      }
    }

    this.updateCommandPaletteResults('');

    // Event handlers
    input.oninput = () => {
      this._paletteIndex = 0;
      this.updateCommandPaletteResults(input.value);
    };

    input.onkeydown = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        this.closeCommandPalette();
      } else if (e.key === 'ArrowDown' || (e.key === 'j' && e.ctrlKey)) {
        e.preventDefault();
        this._paletteIndex = Math.min(this._paletteIndex + 1, this._paletteResults.length - 1);
        this.highlightPaletteItem();
      } else if (e.key === 'ArrowUp' || (e.key === 'k' && e.ctrlKey)) {
        e.preventDefault();
        this._paletteIndex = Math.max(this._paletteIndex - 1, 0);
        this.highlightPaletteItem();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        this.paletteAction('open');
      } else if (e.key === 'a' && e.altKey) {
        e.preventDefault();
        this.paletteAction('active');
      } else if (e.key === 'q' && e.altKey) {
        e.preventDefault();
        this.paletteAction('claude');
      } else if (e.key === 's' && e.altKey) {
        e.preventDefault();
        this.paletteAction('today');
      }
    };

    // Click outside to close
    overlay.onclick = (e) => {
      if (e.target === overlay) this.closeCommandPalette();
    };
  }

  closeCommandPalette() {
    const overlay = document.getElementById('command-palette');
    if (overlay) overlay.style.display = 'none';
    this._paletteAllTasks = null;
  }

  updateCommandPaletteResults(query) {
    const container = document.getElementById('command-palette-results');
    if (!container) return;

    const q = query.toLowerCase().trim();
    let results;

    if (!q) {
      // Show recent / today's tasks when empty
      const today = this.getLocalDateString();
      results = this._paletteAllTasks
        .filter(r => r.task.status !== 'done')
        .sort((a, b) => {
          // Today's tasks first, then by updatedAt
          const aToday = (a.task.dueDate === today || a.task.scheduledDate === today) ? 0 : 1;
          const bToday = (b.task.dueDate === today || b.task.scheduledDate === today) ? 0 : 1;
          if (aToday !== bToday) return aToday - bToday;
          return new Date(b.task.updatedAt || b.task.createdAt) - new Date(a.task.updatedAt || a.task.createdAt);
        })
        .slice(0, 15);
    } else {
      // Fuzzy search: split query into words, all must match
      const words = q.split(/\s+/);
      results = this._paletteAllTasks
        .filter(r => words.every(w => r.searchText.includes(w)))
        .sort((a, b) => {
          // Exact name match first
          const aExact = a.task.name.toLowerCase().includes(q) ? 0 : 1;
          const bExact = b.task.name.toLowerCase().includes(q) ? 0 : 1;
          if (aExact !== bExact) return aExact - bExact;
          // Then non-done first
          const aDone = a.task.status === 'done' ? 1 : 0;
          const bDone = b.task.status === 'done' ? 1 : 0;
          return aDone - bDone;
        })
        .slice(0, 20);
    }

    this._paletteResults = results;
    this._paletteIndex = Math.min(this._paletteIndex, results.length - 1);
    if (this._paletteIndex < 0) this._paletteIndex = 0;

    if (results.length === 0) {
      container.innerHTML = `<div class="command-palette-empty">No tasks found</div>`;
      return;
    }

    container.innerHTML = results.map((r, i) => {
      const t = r.task;
      let name = this.escapeHtml(t.name);

      // Highlight matching text
      if (q) {
        const words = q.split(/\s+/);
        for (const w of words) {
          const regex = new RegExp(`(${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
          name = name.replace(regex, '<mark>$1</mark>');
        }
      }

      const meta = [
        r.projectName,
        ...r.tagNames.map(t => `#${t}`),
        t.estimatedMinutes ? `${t.estimatedMinutes}m` : '',
        t.assignedTo ? `@${t.assignedTo}` : '',
      ].filter(Boolean).join(' · ');

      const palExecType = t.executionType || 'manual';
      const palExecBadge = palExecType !== 'manual' ? `<span class="exec-badge exec-badge-${palExecType}" style="margin-left:6px;">${palExecType === 'ai' ? 'Claude' : 'Hybrid'}</span>` : '';

      return `
        <div class="command-palette-item ${i === this._paletteIndex ? 'selected' : ''}"
             data-index="${i}" data-task-id="${t.id}">
          <span class="command-palette-item-priority ${t.priority || 'none'}"></span>
          <div class="command-palette-item-content">
            <div class="command-palette-item-name">${name}${palExecBadge}</div>
            ${meta ? `<div class="command-palette-item-meta">${this.escapeHtml(meta)}</div>` : ''}
          </div>
          <span class="command-palette-item-status ${t.status}">${t.status}</span>
        </div>
      `;
    }).join('');

    // Click to open
    container.querySelectorAll('.command-palette-item').forEach(el => {
      el.addEventListener('click', () => {
        this._paletteIndex = parseInt(el.dataset.index);
        this.paletteAction('open');
      });
      el.addEventListener('mouseenter', () => {
        this._paletteIndex = parseInt(el.dataset.index);
        this.highlightPaletteItem();
      });
    });
  }

  highlightPaletteItem() {
    const container = document.getElementById('command-palette-results');
    if (!container) return;
    container.querySelectorAll('.command-palette-item').forEach((el, i) => {
      el.classList.toggle('selected', i === this._paletteIndex);
      if (i === this._paletteIndex) {
        el.scrollIntoView({ block: 'nearest' });
      }
    });
  }

  paletteAction(action) {
    if (!this._paletteResults || this._paletteResults.length === 0) return;
    const result = this._paletteResults[this._paletteIndex];
    if (!result) return;
    const task = result.task;
    const today = this.getLocalDateString();

    switch (action) {
      case 'open':
        this.closeCommandPalette();
        this.openDetailPanel(task.id);
        break;
      case 'active':
        if (this.todayView.workingOnTaskIds.includes(task.id)) {
          this.removeActiveTask(task.id);
          this.showToast(`Removed "${task.name}" from active`);
        } else {
          this.addActiveTask(task.id);
          this.showToast(`Added "${task.name}" to active`);
        }
        this.closeCommandPalette();
        this.render();
        break;
      case 'claude':
        const newAssignment = task.assignedTo === 'claude' ? null : 'claude';
        this.updateTask(task.id, { assignedTo: newAssignment });
        this.showToast(newAssignment ? `Assigned "${task.name}" to Claude` : `Unassigned "${task.name}"`);
        this.closeCommandPalette();
        this.render();
        break;
      case 'today':
        if (task.scheduledDate === today) {
          this.updateTask(task.id, { scheduledDate: null });
          this.showToast(`Removed "${task.name}" from today`);
        } else {
          this.updateTask(task.id, { scheduledDate: today });
          this.showToast(`Added "${task.name}" to today`);
        }
        this.closeCommandPalette();
        this.render();
        break;
    }
  }

}

// Initialize drag and drop for board view
document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.column-tasks').forEach(column => {
    column.addEventListener('dragover', (e) => {
      e.preventDefault();
      column.classList.add('drag-over');
    });

    column.addEventListener('dragleave', () => {
      column.classList.remove('drag-over');
    });

    column.addEventListener('drop', (e) => {
      e.preventDefault();
      column.classList.remove('drag-over');
      const taskId = e.dataTransfer.getData('text/plain');
      const newStatus = column.dataset.status;

      if (window.app) {
        window.app.updateTask(taskId, { status: newStatus });
        window.app.render();
      }
    });
  });
});

// Start the application
window.app = new TaskFlowApp();
