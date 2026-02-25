// TaskFlow PM - Task list views (master list, board, task elements, bulk operations)

import { PRIORITY_COLORS } from './core.js';

export const TaskListMixin = {
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
  },

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
  },

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
  },

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
  },

  // File Path Methods
  openFilePath(filePath) {
    if (filePath && window.api && window.api.openPath) {
      window.api.openPath(filePath);
    }
  },

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
  },

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
  },

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
  },

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
  },

  formatTime(timeStr) {
    if (!timeStr) return '';
    const [hours, minutes] = timeStr.split(':').map(Number);
    const ampm = hours >= 12 ? 'PM' : 'AM';
    const hour12 = hours % 12 || 12;
    return `${hour12}:${minutes.toString().padStart(2, '0')} ${ampm}`;
  },

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
  },

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

    const owner = this.getProjectOwner(project);
    const ownerHtml = owner ? `<span class="project-header-owner" title="Owner: ${this.escapeHtml(owner.displayName)}"><span class="owner-avatar">${this.escapeHtml(owner.displayName.charAt(0).toUpperCase())}</span>${this.escapeHtml(owner.displayName)}</span>` : '';

    header.innerHTML = `
      <div class="project-header-top">
        <span class="project-header-color" style="background:${project.color}"></span>
        <h2 class="project-header-name">${this.escapeHtml(project.name)}</h2>
        ${ownerHtml}
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
  },

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
  },

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
  },

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
  },

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
  },

  // Bulk selection operations
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
  },

  selectAllTasks() {
    const tasks = this.getFilteredTasks().filter(t => t.status !== 'done');
    tasks.forEach(t => this._selectedTasks.add(t.id));
    this.updateBulkToolbar();
    this.updateTaskSelectionUI();
  },

  clearTaskSelection() {
    this._selectedTasks.clear();
    this.updateBulkToolbar();
    this.updateTaskSelectionUI();
  },

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
  },

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
  },

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
  },

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
  },
};
