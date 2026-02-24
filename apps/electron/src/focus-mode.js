// TaskFlow PM - Focus mode (timer, task queue, celebrations, AI copilot)

export const FocusModeMixin = {
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
  },

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
  },

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
  },

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
  },

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
  },

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
  },

  updateMiniWidget() {
    const task = this.focusMode.taskQueue[this.focusMode.currentIndex];
    if (!task) return;

    document.getElementById('focus-mini-task').textContent = task.name;
    this.updateMiniTimerDisplay();
  },

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
  },

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
  },

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
  },

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
  },

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
  },

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
  },

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
  },

  updateSessionStats() {
    const completedEl = document.getElementById('focus-completed-count');
    const pomodoroEl = document.getElementById('focus-pomodoro-count');
    const streakEl = document.getElementById('focus-streak-count');

    if (completedEl) completedEl.textContent = this.focusMode.completedCount;
    if (pomodoroEl) pomodoroEl.textContent = this.focusMode.pomodoroCount;
    if (streakEl) streakEl.textContent = this.focusMode.streak;
  },

  focusNextTask() {
    if (this.focusMode.currentIndex < this.focusMode.taskQueue.length - 1) {
      this.focusMode.currentIndex++;
      this.setTimerForCurrentTask(); // Reset timer for new task
      if (this.focusMode.active) this.renderFocusTask();
      if (this.focusMode.minimized) this.updateMiniWidget();
    }
  },

  focusPrevTask() {
    if (this.focusMode.currentIndex > 0) {
      this.focusMode.currentIndex--;
      this.setTimerForCurrentTask(); // Reset timer for new task
      if (this.focusMode.active) this.renderFocusTask();
      if (this.focusMode.minimized) this.updateMiniWidget();
    }
  },

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
  },

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
  },

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
  },

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
  },

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
  },

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
  },

  toggleSettingsPanel(open = null) {
    const panel = document.getElementById('focus-settings-panel');
    this.focusMode.settingsPanelOpen = open !== null ? open : !this.focusMode.settingsPanelOpen;
    panel.classList.toggle('open', this.focusMode.settingsPanelOpen);

    document.getElementById('focus-work-duration').textContent = this.focusMode.workDuration / 60;
    document.getElementById('focus-break-duration').textContent = this.focusMode.breakDuration / 60;
    document.getElementById('focus-auto-start').checked = this.focusMode.autoStart;
    document.getElementById('focus-sounds').checked = this.focusMode.soundEnabled;
  },

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
  },

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
  },

  updateAIContext(task) {
    const statusEl = document.getElementById('ai-status');
    if (statusEl) {
      statusEl.textContent = `Helping with: ${task.name.substring(0, 25)}${task.name.length > 25 ? '...' : ''}`;
    }
  },

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
  },

  sendAIMessage() {
    const input = document.getElementById('ai-input');
    const message = input.value.trim();
    if (!message) return;

    input.value = '';
    this.addAIMessage(message, 'user');

    const task = this.focusMode.taskQueue[this.focusMode.currentIndex];
    this.generateAIResponse('custom', task, message);
  },

  addAIMessage(text, type) {
    const chat = document.getElementById('ai-chat');
    const messageEl = document.createElement('div');
    messageEl.className = `ai-message ${type === 'user' ? 'user-message' : 'ai-response'}`;
    messageEl.innerHTML = `<p>${text}</p>`;
    chat.appendChild(messageEl);
    chat.scrollTop = chat.scrollHeight;
  },

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
  },

  generateBreakdownResponse(task) {
    const taskName = task.name;
    return `Here's how I'd break down <strong>"${taskName}"</strong>:<br><br>
      1. <strong>Clarify the outcome</strong> - What does 'done' look like?<br>
      2. <strong>Identify the first action</strong> - What's the very first thing to do?<br>
      3. <strong>Set a 10-min focus sprint</strong> - Just get started, momentum will follow<br>
      4. <strong>Check your progress</strong> - Adjust as needed<br><br>
      What's your first tiny action?`;
  },

  generateUnstuckResponse(task) {
    const tips = [
      `Sometimes the hardest part is starting. Try this: spend just <strong>2 minutes</strong> on "${task.name}" - that's it. Often you'll want to keep going.`,
      `Feeling stuck? Try changing your environment or taking a 5-minute walk. Fresh perspective can unlock new ideas.`,
      `Break it smaller. What's the <strong>tiniest</strong> possible step? Even opening a document counts.`,
      `Talk it out loud. Explain what you're trying to do as if teaching someone. This often reveals the next step.`
    ];
    return tips[Math.floor(Math.random() * tips.length)];
  },

  generateMotivationResponse(task) {
    const motivations = [
      `You've already started by opening Focus Mode. That's the hardest part! <strong>"${task.name}"</strong> is within reach.`,
      `Think about how good it'll feel when this is done. That's just ${this.focusMode.workDuration / 60} minutes of focused work away.`,
      `You've got this. Every task completed builds momentum. Let's make "${task.name}" the next win! 💪`,
      `Remember why this matters. Small progress compounds into big results. One task at a time!`
    ];
    return motivations[Math.floor(Math.random() * motivations.length)];
  },

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
  },

  generateCustomResponse(task, message) {
    const responses = [
      `Interesting question about "${task.name}". The key is to start small and build momentum.`,
      `That's a great point. For this task, I'd suggest focusing on the most impactful action first.`,
      `I hear you. Sometimes the best approach is to just begin, even imperfectly. Progress beats perfection.`
    ];
    return responses[Math.floor(Math.random() * responses.length)];
  },
};
