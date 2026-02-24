// TaskFlow PM - Project views (list, board, timeline, roadmap, notebooks, launchers, analytics)

import { PRIORITY_COLORS } from './core.js';

export const ProjectViewsMixin = {
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
  },

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
  },

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
  },

  _planningTaskPill(task, extra = '') {
    const borderColor = PRIORITY_COLORS[task.priority] || PRIORITY_COLORS.none;
    const execType = task.executionType || 'manual';
    const execTag = execType === 'ai' ? ' <span class="pill-exec ai">AI</span>' : execType === 'hybrid' ? ' <span class="pill-exec hybrid">HY</span>' : '';

    const extraTag = extra ? ` <span class="pill-extra">${this.escapeHtml(extra)}</span>` : '';

    return `<span class="planning-pill" data-task-id="${task.id}" style="border-left-color:${borderColor}">
      ${this.escapeHtml(task.name)}${execTag}${extraTag}
    </span>`;
  },

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
  },

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
  },

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
  },

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
  },

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
  },

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
  },

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
  },

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
  },

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
  },

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
  },

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
  },

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
  },

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
  },

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
  },

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
  },

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
  },

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
  },

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
  },

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
  },

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
  },

  formatShortDate(dateStr) {
    if (!dateStr) return '';
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const d = new Date(dateStr + 'T12:00:00');
    return `${monthNames[d.getMonth()]} ${d.getDate()}`;
  },

  dayToTLPixel(dateStr, dayStrs, colWidth) {
    const idx = dayStrs.indexOf(dateStr);
    return idx >= 0 ? idx * colWidth : -1;
  },

  pixelToTLDate(px, dayStrs, colWidth) {
    const idx = Math.round(px / colWidth);
    const clamped = Math.max(0, Math.min(idx, dayStrs.length - 1));
    return dayStrs[clamped];
  },

  shiftDate(dateStr, numDays) {
    const d = new Date(dateStr + 'T12:00:00');
    d.setDate(d.getDate() + numDays);
    return this.getLocalDateString(d);
  },

  bindTLEvents(projectId, body, tlState, dayStrs, colWidth, rowHeight, firstDayStr, lastDayStr) {
    const tableBody = body.querySelector('.tl-table-body');
    const chartBody = body.querySelector('.tl-chart-body');
    const chartHeaderWrap = body.querySelector('.tl-chart-header-wrap');
    const resizeHandle = body.querySelector('.tl-resize-handle');

    // Scroll sync: table body <-> chart body vertical
    const syncScroll = (source, target, dir) => {
      source.addEventListener('scroll', () => {
        if (dir === 'vertical') target.scrollTop = source.scrollTop;
        if (dir === 'horizontal') target.scrollLeft = source.scrollLeft;
      });
    };
    syncScroll(tableBody, chartBody, 'vertical');
    syncScroll(chartBody, tableBody, 'vertical');

    // Chart body horizontal -> chart header horizontal
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
  },
};
