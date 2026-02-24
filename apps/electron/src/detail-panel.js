// TaskFlow PM - Detail panel (task details, completion, Claude prompts, status toggle)

export const DetailPanelMixin = {
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
  },

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
  },

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
  },

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
  },

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
  },

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
  },

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
  },

  closeDetailPanel() {
    document.getElementById('detail-panel').classList.remove('open');
    this.selectedTask = null;
  },

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
  },

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
  },

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
  },
};
