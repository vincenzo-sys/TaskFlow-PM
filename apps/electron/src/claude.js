// TaskFlow PM - Claude integration (Claude view, prompt builders, quick actions)

export const ClaudeMixin = {
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
  },

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
  },

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
  },

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
  },

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
  },

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
  },

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
  },

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
  },

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
  },

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
  },

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
  },

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
  },
};
