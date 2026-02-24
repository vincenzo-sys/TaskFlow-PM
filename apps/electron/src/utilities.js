// TaskFlow PM - Utilities (formatting, escaping, drag/drop helpers, context menus)

export const UtilitiesMixin = {
  // Utilities
  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  },

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
  },

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
  },

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
  },

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
  },

  updateDragGhostPosition(e) {
    // Kept for compatibility but main tracking is now via document dragover
    const ghost = document.getElementById('drag-ghost');
    if (ghost && e.clientX && e.clientY) {
      ghost.style.left = `${e.clientX + 15}px`;
      ghost.style.top = `${e.clientY + 15}px`;
    }
  },

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
  },

  // P2.2 - Time validation for drop zones
  isTimePast(timeStr) {
    const now = new Date();
    const [hours, minutes] = timeStr.split(':').map(Number);
    const slotTime = new Date();
    slotTime.setHours(hours, minutes, 0, 0);
    return slotTime < now;
  },

  formatTimeDisplay(timeStr) {
    const [hours, minutes] = timeStr.split(':').map(Number);
    const period = hours >= 12 ? 'PM' : 'AM';
    const displayHour = hours > 12 ? hours - 12 : hours === 0 ? 12 : hours;
    return `${displayHour}:${minutes.toString().padStart(2, '0')} ${period}`;
  },

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
        <span class="context-menu-arrow">&#9656;</span>
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
  },

  hideContextMenu() {
    const menu = document.getElementById('context-menu');
    if (menu) {
      menu.remove();
    }
    this.contextMenuTask = null;
  },

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
  },

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
  },

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
  },

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
  },

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
  },

  // Font Scale
  changeFontScale(delta) {
    const current = this.data.fontScale || 100;
    const next = Math.min(150, Math.max(70, current + delta));
    if (next === current) return;
    this.data.fontScale = next;
    this.applyFontScale();
    this.updateFontSizeDisplay();
    this.saveData();
  },

  resetFontScale() {
    this.data.fontScale = 100;
    this.applyFontScale();
    this.updateFontSizeDisplay();
    this.saveData();
  },

  applyFontScale() {
    const scale = this.data.fontScale || 100;
    // Use Electron's native webFrame zoom — scales everything correctly
    // without breaking scroll or layout calculations
    if (window.api && window.api.setZoomFactor) {
      window.api.setZoomFactor(scale / 100);
    }
  },

  updateFontSizeDisplay() {
    const el = document.getElementById('font-size-value');
    if (el) el.textContent = (this.data.fontScale || 100) + '%';
  },

  // Export/Import
  async exportData() {
    await window.api.exportData(this.data);
    this.closeModal('settings-modal');
  },

  async importData() {
    const data = await window.api.importData();
    if (data) {
      this.data = data;
      await this.saveData();
      this.applyFontScale();
      this.render();
    }
    this.closeModal('settings-modal');
  },

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
  },

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
  },
};
