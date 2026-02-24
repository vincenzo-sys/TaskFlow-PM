// TaskFlow PM - Command palette (Ctrl+K search, actions)

export const CommandPaletteMixin = {
  openCommandPalette() {
    const overlay = document.getElementById('command-palette');
    if (!overlay) return;
    overlay.style.display = 'flex';
    this._paletteIndex = 0;
    this._paletteResults = [];

    const input = document.getElementById('command-palette-input');
    input.value = '';
    input.focus();

    // Build search index
    this._paletteAllTasks = [];
    const tagLookup = {};
    (this.data.tags || []).forEach(t => { tagLookup[t.id] = t.name; });

    for (const project of (this.data.projects || [])) {
      for (const task of (project.tasks || [])) {
        const tags = (task.tags || []).map(id => tagLookup[id]).filter(Boolean);
        this._paletteAllTasks.push({
          task,
          projectName: project.isInbox ? '' : project.name,
          tagNames: tags,
          searchText: [
            task.name,
            project.name,
            ...tags,
            task.description || '',
            task.assignedTo || '',
          ].join(' ').toLowerCase(),
        });
      }
    }

    this.updateCommandPaletteResults('');

    // Event handlers
    input.oninput = () => {
      this._paletteIndex = 0;
      this.updateCommandPaletteResults(input.value);
    };

    input.onkeydown = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        this.closeCommandPalette();
      } else if (e.key === 'ArrowDown' || (e.key === 'j' && e.ctrlKey)) {
        e.preventDefault();
        this._paletteIndex = Math.min(this._paletteIndex + 1, this._paletteResults.length - 1);
        this.highlightPaletteItem();
      } else if (e.key === 'ArrowUp' || (e.key === 'k' && e.ctrlKey)) {
        e.preventDefault();
        this._paletteIndex = Math.max(this._paletteIndex - 1, 0);
        this.highlightPaletteItem();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        this.paletteAction('open');
      } else if (e.key === 'a' && e.altKey) {
        e.preventDefault();
        this.paletteAction('active');
      } else if (e.key === 'q' && e.altKey) {
        e.preventDefault();
        this.paletteAction('claude');
      } else if (e.key === 's' && e.altKey) {
        e.preventDefault();
        this.paletteAction('today');
      }
    };

    // Click outside to close
    overlay.onclick = (e) => {
      if (e.target === overlay) this.closeCommandPalette();
    };
  },

  closeCommandPalette() {
    const overlay = document.getElementById('command-palette');
    if (overlay) overlay.style.display = 'none';
    this._paletteAllTasks = null;
  },

  updateCommandPaletteResults(query) {
    const container = document.getElementById('command-palette-results');
    if (!container) return;

    const q = query.toLowerCase().trim();
    let results;

    if (!q) {
      // Show recent / today's tasks when empty
      const today = this.getLocalDateString();
      results = this._paletteAllTasks
        .filter(r => r.task.status !== 'done')
        .sort((a, b) => {
          // Today's tasks first, then by updatedAt
          const aToday = (a.task.dueDate === today || a.task.scheduledDate === today) ? 0 : 1;
          const bToday = (b.task.dueDate === today || b.task.scheduledDate === today) ? 0 : 1;
          if (aToday !== bToday) return aToday - bToday;
          return new Date(b.task.updatedAt || b.task.createdAt) - new Date(a.task.updatedAt || a.task.createdAt);
        })
        .slice(0, 15);
    } else {
      // Fuzzy search: split query into words, all must match
      const words = q.split(/\s+/);
      results = this._paletteAllTasks
        .filter(r => words.every(w => r.searchText.includes(w)))
        .sort((a, b) => {
          // Exact name match first
          const aExact = a.task.name.toLowerCase().includes(q) ? 0 : 1;
          const bExact = b.task.name.toLowerCase().includes(q) ? 0 : 1;
          if (aExact !== bExact) return aExact - bExact;
          // Then non-done first
          const aDone = a.task.status === 'done' ? 1 : 0;
          const bDone = b.task.status === 'done' ? 1 : 0;
          return aDone - bDone;
        })
        .slice(0, 20);
    }

    this._paletteResults = results;
    this._paletteIndex = Math.min(this._paletteIndex, results.length - 1);
    if (this._paletteIndex < 0) this._paletteIndex = 0;

    if (results.length === 0) {
      container.innerHTML = `<div class="command-palette-empty">No tasks found</div>`;
      return;
    }

    container.innerHTML = results.map((r, i) => {
      const t = r.task;
      let name = this.escapeHtml(t.name);

      // Highlight matching text
      if (q) {
        const words = q.split(/\s+/);
        for (const w of words) {
          const regex = new RegExp(`(${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
          name = name.replace(regex, '<mark>$1</mark>');
        }
      }

      const meta = [
        r.projectName,
        ...r.tagNames.map(t => `#${t}`),
        t.estimatedMinutes ? `${t.estimatedMinutes}m` : '',
        t.assignedTo ? `@${t.assignedTo}` : '',
      ].filter(Boolean).join(' · ');

      const palExecType = t.executionType || 'manual';
      const palExecBadge = palExecType !== 'manual' ? `<span class="exec-badge exec-badge-${palExecType}" style="margin-left:6px;">${palExecType === 'ai' ? 'Claude' : 'Hybrid'}</span>` : '';

      return `
        <div class="command-palette-item ${i === this._paletteIndex ? 'selected' : ''}"
             data-index="${i}" data-task-id="${t.id}">
          <span class="command-palette-item-priority ${t.priority || 'none'}"></span>
          <div class="command-palette-item-content">
            <div class="command-palette-item-name">${name}${palExecBadge}</div>
            ${meta ? `<div class="command-palette-item-meta">${this.escapeHtml(meta)}</div>` : ''}
          </div>
          <span class="command-palette-item-status ${t.status}">${t.status}</span>
        </div>
      `;
    }).join('');

    // Click to open
    container.querySelectorAll('.command-palette-item').forEach(el => {
      el.addEventListener('click', () => {
        this._paletteIndex = parseInt(el.dataset.index);
        this.paletteAction('open');
      });
      el.addEventListener('mouseenter', () => {
        this._paletteIndex = parseInt(el.dataset.index);
        this.highlightPaletteItem();
      });
    });
  },

  highlightPaletteItem() {
    const container = document.getElementById('command-palette-results');
    if (!container) return;
    container.querySelectorAll('.command-palette-item').forEach((el, i) => {
      el.classList.toggle('selected', i === this._paletteIndex);
      if (i === this._paletteIndex) {
        el.scrollIntoView({ block: 'nearest' });
      }
    });
  },

  paletteAction(action) {
    if (!this._paletteResults || this._paletteResults.length === 0) return;
    const result = this._paletteResults[this._paletteIndex];
    if (!result) return;
    const task = result.task;
    const today = this.getLocalDateString();

    switch (action) {
      case 'open':
        this.closeCommandPalette();
        this.openDetailPanel(task.id);
        break;
      case 'active':
        if (this.todayView.workingOnTaskIds.includes(task.id)) {
          this.removeActiveTask(task.id);
          this.showToast(`Removed "${task.name}" from active`);
        } else {
          this.addActiveTask(task.id);
          this.showToast(`Added "${task.name}" to active`);
        }
        this.closeCommandPalette();
        this.render();
        break;
      case 'claude':
        const newAssignment = task.assignedTo === 'claude' ? null : 'claude';
        this.updateTask(task.id, { assignedTo: newAssignment });
        this.showToast(newAssignment ? `Assigned "${task.name}" to Claude` : `Unassigned "${task.name}"`);
        this.closeCommandPalette();
        this.render();
        break;
      case 'today':
        if (task.scheduledDate === today) {
          this.updateTask(task.id, { scheduledDate: null });
          this.showToast(`Removed "${task.name}" from today`);
        } else {
          this.updateTask(task.id, { scheduledDate: today });
          this.showToast(`Added "${task.name}" to today`);
        }
        this.closeCommandPalette();
        this.render();
        break;
    }
  },
};
