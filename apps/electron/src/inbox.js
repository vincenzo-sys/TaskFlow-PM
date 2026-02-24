// TaskFlow PM - Inbox view (brain dumps, triage, prompts)

export const InboxMixin = {
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
  },

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
  },

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
  },

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
  },

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
  },
};
