// TaskFlow PM - Recaps & analytics (recap views, daily review, saved recaps)

export const RecapsMixin = {
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
  },

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
  },

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
            <div class="cc-completion-check">&#10003;</div>
            <div class="cc-completion-content">
              <div class="cc-completion-name">${this.escapeHtml(task.name)}</div>
              <div class="cc-completion-meta">
                ${projectName ? `<span class="cc-completion-project">${this.escapeHtml(projectName)}</span>` : ''}
                <span class="cc-completion-time">${timeStr}</span>
              </div>
            </div>
            <div class="cc-completion-actions">
              <button class="cc-completion-summary-btn" data-task-id="${task.id}" title="${hasSummary ? 'Edit note' : 'Add a note about what was accomplished'}">
                ${hasSummary ? '&#128221; Edit' : '&#128221; Note'}
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
  },

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
            <button class="modal-close-btn" id="close-summary-modal">&times;</button>
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
  },

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
  },

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
        timeInfo = `<span class="cc-list-time">&#128197; ${displayTime}</span>`;
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
              <span class="subtasks-chevron">&#9654;</span>
              <span class="subtasks-count">${completedSubtasks}/${subtasks.length} subtasks</span>
            </button>
            <div class="cc-list-subtasks-items">
              ${subtasks.map(sub => `
                <div class="cc-list-subtask ${sub.completed ? 'completed' : ''}" data-subtask-id="${sub.id}" data-task-id="${task.id}">
                  <span class="subtask-check">${sub.completed ? '&#10003;' : ''}</span>
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
            ${isComplete ? '&#10003;' : ''}
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
          <button class="cc-list-edit" data-task-id="${task.id}" title="Edit task">&#9998;</button>
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
  },

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
      accomplishment: '&#10003;',
      decision: '&#9878;',
      note: '&#128221;'
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
  },

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
      daily: '&#128197;',
      weekly: '&#128198;',
      monthly: '&#128467;'
    };

    container.innerHTML = sorted.slice(0, 10).map(recap => {
      const savedDate = new Date(recap.savedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      return `
        <div class="cc-saved-recap-card" data-recap-id="${recap.id}">
          <div class="cc-saved-recap-header">
            <span class="cc-saved-recap-icon">${periodIcon[recap.period] || '&#128202;'}</span>
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
  },

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
                <button class="recap-type-btn active" data-type="accomplishment">&#10003; Accomplishment</button>
                <button class="recap-type-btn" data-type="decision">&#9878; Decision</button>
                <button class="recap-type-btn" data-type="note">&#128221; Note</button>
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
  },

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
                <button class="recap-period-btn active" data-period="daily">&#128197; Daily</button>
                <button class="recap-period-btn" data-period="weekly">&#128198; Weekly</button>
                <button class="recap-period-btn" data-period="monthly">&#128467; Monthly</button>
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
  },

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
  },

  deleteRecapEntry(entryId) {
    if (!this.data.recapLog) return;

    const index = this.data.recapLog.findIndex(e => e.id === entryId);
    if (index !== -1) {
      this.data.recapLog.splice(index, 1);
      this.saveData();
      this.renderRecaps();
    }
  },

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
  },

  renderStars(rating) {
    if (!rating) return '<span class="cc-recap-star">No rating</span>';
    let stars = '';
    for (let i = 1; i <= 5; i++) {
      stars += `<span class="cc-recap-star ${i <= rating ? 'filled' : ''}">&#9733;</span>`;
    }
    return stars;
  },

  formatRecapDate(dateStr) {
    const today = this.getLocalDateString();
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = this.getLocalDateString(yesterday);

    if (dateStr === today) return 'Today';
    if (dateStr === yesterdayStr) return 'Yesterday';

    const date = new Date(dateStr + 'T00:00:00');
    return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  },

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
  },

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
  },

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
            <span class="review-task-check">&#10003;</span>
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
  },

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
  },
};
