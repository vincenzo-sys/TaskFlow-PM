// TaskFlow PM - Event binding and keyboard/selection handlers

export const EventsMixin = {
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
  },

  // Keyboard navigation helpers
  getVisibleTasks() {
    const taskElements = document.querySelectorAll('.task-item, .task-card, .focus-queue-item, .today-task-item');
    return Array.from(taskElements).filter(el => el.offsetParent !== null);
  },

  selectNextTask() {
    const tasks = this.getVisibleTasks();
    if (tasks.length === 0) return;

    this.selectedTaskIndex = Math.min(this.selectedTaskIndex + 1, tasks.length - 1);
    this.highlightSelectedTask(tasks);
  },

  selectPrevTask() {
    const tasks = this.getVisibleTasks();
    if (tasks.length === 0) return;

    this.selectedTaskIndex = Math.max(this.selectedTaskIndex - 1, 0);
    this.highlightSelectedTask(tasks);
  },

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
  },

  clearTaskSelection() {
    this.selectedTaskIndex = -1;
    this.selectedTaskId = null;
    document.querySelectorAll('.keyboard-selected').forEach(el => {
      el.classList.remove('keyboard-selected');
    });
  },

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
  },

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
  },

  openSelectedTaskDetail() {
    if (this.selectedTaskId) {
      this.openDetailPanel(this.selectedTaskId);
    }
  },

  editSelectedTask() {
    if (this.selectedTaskId) {
      this.openEditTaskModal(this.selectedTaskId);
    }
  },

  deleteSelectedTask() {
    if (this.selectedTaskId) {
      if (confirm('Delete this task?')) {
        this.deleteTask(this.selectedTaskId);
        this.clearTaskSelection();
      }
    }
  },

  setSelectedTaskPriority(priority) {
    if (!this.selectedTaskId) return;
    this.updateTask(this.selectedTaskId, { priority });
    this.render();
  },

  toggleSelectedTaskToday() {
    if (!this.selectedTaskId) return;
    this.openSnoozePopup(this.selectedTaskId);
  },

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
  },

  closeSnoozePopup() {
    const overlay = document.getElementById('snooze-popup');
    if (!overlay) return;

    overlay.classList.remove('visible');
    setTimeout(() => {
      overlay.style.display = 'none';
    }, 200);

    this._snoozeTaskId = null;
  },

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
  },

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
  },

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
  },

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
  },

  toggleSelectedTaskSubtasks() {
    if (!this.selectedTaskId) return;
    if (!this.todayView?.expandedUpNextIds) return;
    if (this.todayView.expandedUpNextIds.has(this.selectedTaskId)) {
      this.todayView.expandedUpNextIds.delete(this.selectedTaskId);
    } else {
      this.todayView.expandedUpNextIds.add(this.selectedTaskId);
    }
    this.renderTodayView();
  },

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
  },

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
  },

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
  },
};
