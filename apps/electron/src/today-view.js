// TaskFlow PM - Today view (command center, active tasks, up next queue)

export const TodayViewMixin = {
  refreshCommandCenter() {
    // Only refresh if the elements exist (command center view is in DOM)
    if (document.getElementById('cc-focus-queue')) {
      this.updateCommandCenterStats();
      this.renderFocusQueue();
      this.renderDualTrackTimeline();
      this.renderCompletions();
    }
  },

  // ==================== TODAY VIEW (Priority-Based Attack List) ====================

  renderCommandCenter() {
    // Redirect to new Today view
    this.renderTodayView();
  },

  renderTodayView() {
    const today = this.getLocalDateString();
    const allTasks = this.getAllTasks();

    // Auto-roll on first render (once per session)
    if (!this._autoRollDone) {
      this._autoRollDone = true;
      this.autoRollTasks();
    }

    // Render project summary cards row
    this.renderTodayProjectCards();

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
  },

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
  },

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
  },

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
      // Build breadcrumb path: ancestors + project name
      let projectBreadcrumb = '';
      if (project && !project.isInbox) {
        const ancestors = this.getProjectAncestors(project.id);
        const pathParts = [...ancestors.map(a => this.escapeHtml(a.name)), this.escapeHtml(project.name)];
        projectBreadcrumb = pathParts.join(' &rsaquo; ');
      }
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
              ${projectBreadcrumb ? `<span class="today-task-project">${projectBreadcrumb}</span>` : ''}
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
  },

  renderWorkingOnNow() {
    this.renderActiveTasks();
  },

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
  },


  renderTodayNotes() {
    // Load daily notes (for recaps)
    const dailyInput = document.getElementById('today-daily-notes-input');
    if (dailyInput) {
      const today = this.getLocalDateString();
      dailyInput.value = this.data.dailyNotes?.[today] || '';
    }
  },

  renderTodayProjectCards() {
    const container = document.getElementById('today-projects-row');
    if (!container) return;

    const topLevelProjects = this.data.projects.filter(p =>
      !p.parentProjectId && !p.isInbox && p.status !== 'archived'
    );

    if (topLevelProjects.length === 0) {
      container.innerHTML = '';
      return;
    }

    container.innerHTML = topLevelProjects.map(p => {
      const allTasks = this.getProjectWithDescendantTasks(p.id);
      const activeCount = allTasks.filter(t => t.status !== 'done').length;
      return `<button class="today-project-card" data-project-id="${p.id}">
        <span class="today-project-dot" style="background:${p.color}"></span>
        <span class="today-project-name">${this.escapeHtml(p.name)}</span>
        <span class="today-project-count">${activeCount}</span>
      </button>`;
    }).join('');

    // Bind click handlers
    container.querySelectorAll('.today-project-card').forEach(card => {
      card.addEventListener('click', () => {
        this.setView('project-' + card.dataset.projectId);
      });
    });
  },

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
  },

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
  },

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
  },

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
  },

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
  },

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
  },
};
