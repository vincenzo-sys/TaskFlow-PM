// TaskFlow PM - Sidebar (navigation, categories tree, favorites, tags, counts)

export const SidebarMixin = {
  renderSidebar() {
    this.renderFavorites();
    this.renderCategoriesTree();
  },

  renderFavorites() {
    const container = document.getElementById('sidebar-favorites');
    if (!container) return;
    container.innerHTML = '';

    const favoriteIds = this.data.favorites || [];
    const favorites = favoriteIds
      .map(id => this.data.projects.find(p => p.id === id))
      .filter(p => p && !p.isInbox);

    if (favorites.length === 0) {
      return;
    }

    // Add favorites header
    const header = document.createElement('div');
    header.className = 'favorites-header';
    header.innerHTML = '<span class="star-icon">&#9733;</span><span>Favorites</span>';
    container.appendChild(header);

    for (const project of favorites) {
      container.appendChild(this.createProjectItem(project, true));
    }
  },

  renderCategoriesTree() {
    const container = document.getElementById('categories-tree');
    if (!container) return;
    container.innerHTML = '';

    if (!this._showArchivedProjects) this._showArchivedProjects = false;

    // Render top-level projects directly — no category wrappers
    const topLevel = this.data.projects.filter(p => !p.isInbox && !p.parentProjectId);

    // Filter out archived unless toggle is on
    const visible = this._showArchivedProjects
      ? topLevel
      : topLevel.filter(p => p.status !== 'archived');

    for (const project of visible) {
      this.appendProjectTree(container, project, 0);
    }

    // Count archived (including nested)
    const archivedCount = this.data.projects.filter(p => !p.isInbox && p.status === 'archived').length;
    if (archivedCount > 0) {
      const toggle = document.createElement('button');
      toggle.className = 'show-archived-toggle';
      toggle.innerHTML = `${this._showArchivedProjects ? '&#9660;' : '&#9654;'} <span>Show archived (${archivedCount})</span>`;
      toggle.addEventListener('click', () => {
        this._showArchivedProjects = !this._showArchivedProjects;
        this.renderCategoriesTree();
      });
      container.appendChild(toggle);
    }
  },

  // Recursively append a project and its children to the container
  appendProjectTree(container, project, depth) {
    const allChildren = this.data.projects.filter(p => p.parentProjectId === project.id);
    const children = this._showArchivedProjects
      ? allChildren
      : allChildren.filter(p => p.status !== 'archived');
    const hasChildren = children.length > 0;
    if (!this._collapsedSubprojects) this._collapsedSubprojects = new Set();
    const isExpanded = !this._collapsedSubprojects.has(project.id);

    container.appendChild(this.createProjectItem(project, false, depth, hasChildren, isExpanded));

    if (hasChildren && isExpanded) {
      for (const child of children) {
        this.appendProjectTree(container, child, depth + 1);
      }
    }
  },

  toggleSubprojectCollapsed(projectId) {
    if (!this._collapsedSubprojects) this._collapsedSubprojects = new Set();
    if (this._collapsedSubprojects.has(projectId)) {
      this._collapsedSubprojects.delete(projectId);
    } else {
      this._collapsedSubprojects.add(projectId);
    }
    this.renderSidebar();
  },

  createProjectItem(project, inFavorites, depth = 0, hasChildren = false, isExpanded = true) {
    // Count own tasks + descendant tasks
    const ownTaskCount = project.tasks.filter(t => t.status !== 'done').length;
    const descendantIds = this.getProjectDescendantIds(project.id);
    let descendantTaskCount = 0;
    for (const descId of descendantIds) {
      const descProject = this.data.projects.find(p => p.id === descId);
      if (descProject) {
        descendantTaskCount += descProject.tasks.filter(t => t.status !== 'done').length;
      }
    }
    const totalCount = ownTaskCount + descendantTaskCount;
    const isFavorite = this.isFavorite(project.id);

    const el = document.createElement('button');
    el.className = 'project-item';
    if (depth > 0) el.classList.add('subproject-item');
    if (project.status === 'archived') el.classList.add('project-archived');
    el.dataset.id = project.id;
    el.style.paddingLeft = `${12 + depth * 18}px`;

    const toggleHtml = hasChildren
      ? `<span class="subproject-toggle ${isExpanded ? '' : 'collapsed'}" data-project-id="${project.id}">&#9660;</span>`
      : (depth > 0 ? '<span class="subproject-spacer"></span>' : '');

    el.innerHTML = `
      ${toggleHtml}
      <span class="project-color" style="background:${project.color}"></span>
      <span class="project-name">${this.escapeHtml(project.name)}</span>
      <span class="project-count">${totalCount}${descendantTaskCount > 0 ? '<span class="subproject-count-detail"> (' + ownTaskCount + '+' + descendantTaskCount + ')</span>' : ''}</span>
      <button class="project-favorite-btn ${isFavorite ? 'favorited' : ''}" title="${isFavorite ? 'Remove from favorites' : 'Add to favorites'}">
        ${isFavorite ? '&#9733;' : '&#9734;'}
      </button>
      <button class="project-edit" title="Edit">&#9998;</button>
    `;

    el.addEventListener('click', (e) => {
      if (!e.target.classList.contains('project-edit') &&
          !e.target.classList.contains('project-favorite-btn') &&
          !e.target.classList.contains('subproject-toggle')) {
        this.setView(`project-${project.id}`);
      }
    });

    // Subproject toggle
    const toggle = el.querySelector('.subproject-toggle');
    if (toggle) {
      toggle.addEventListener('click', (e) => {
        e.stopPropagation();
        this.toggleSubprojectCollapsed(project.id);
      });
    }

    el.querySelector('.project-favorite-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggleFavorite(project.id);
    });

    el.querySelector('.project-edit').addEventListener('click', (e) => {
      e.stopPropagation();
      this.openProjectModal(project.id);
    });

    return el;
  },

  filterProjects(query) {
    const projects = this.data.projects.filter(p => !p.isInbox);
    if (!query) {
      this.renderCategoriesTree();
      return;
    }

    const lowerQuery = query.toLowerCase();
    const matching = projects.filter(p =>
      p.name.toLowerCase().includes(lowerQuery)
    );

    const container = document.getElementById('categories-tree');
    if (!container) return;
    container.innerHTML = '';

    for (const project of matching) {
      // Show breadcrumb path when filtering
      const ancestors = this.getProjectAncestors(project.id);
      const depth = 0; // Flat list when filtering
      container.appendChild(this.createProjectItem(project, false, depth, false, false));
    }
  },

  // Legacy method for compatibility
  renderProjects() {
    this.renderSidebar();
  },

  renderTags() {
    const container = document.getElementById('tags-list');
    container.innerHTML = '';

    for (const tag of this.data.tags) {
      const tagCount = this.getAllTasks().filter(t => t.tags.includes(tag.id) && t.status !== 'done').length;
      const el = document.createElement('button');
      el.className = 'tag-item';
      el.dataset.id = tag.id;
      el.innerHTML = `
        <span class="tag-color" style="background:${tag.color}"></span>
        <span class="tag-name">${this.escapeHtml(tag.name)}</span>
        <span class="tag-count">${tagCount}</span>
        <button class="tag-edit" title="Edit">&#9998;</button>
      `;

      el.addEventListener('click', (e) => {
        if (!e.target.classList.contains('tag-edit')) {
          this.setView(`tag-${tag.id}`);
        }
      });

      el.querySelector('.tag-edit').addEventListener('click', (e) => {
        e.stopPropagation();
        this.openTagModal(tag.id);
      });

      container.appendChild(el);
    }

    // Update tag selector in task form
    this.renderTagsSelector();
  },

  renderTagsSelector() {
    const container = document.getElementById('tags-selector');
    container.innerHTML = '';

    for (const tag of this.data.tags) {
      const label = document.createElement('label');
      label.className = 'tag-checkbox';
      label.style.color = tag.color;
      label.innerHTML = `
        <input type="checkbox" value="${tag.id}">
        <span class="tag-color" style="background:${tag.color}"></span>
        <span>${this.escapeHtml(tag.name)}</span>
      `;

      label.querySelector('input').addEventListener('change', () => {
        label.classList.toggle('selected', label.querySelector('input').checked);
      });

      container.appendChild(label);
    }
  },

  updateCounts() {
    // Inbox count
    const inbox = this.data.projects.find(p => p.id === 'inbox' || p.isInbox);
    const inboxCount = inbox ? inbox.tasks.filter(t => t.status !== 'done').length : 0;
    document.getElementById('inbox-count').textContent = inboxCount;

    // Today count (due today OR scheduled today)
    const today = this.getLocalDateString();
    const allTasks = this.getAllTasks();
    const todayCount = allTasks.filter(t =>
      (t.dueDate === today || t.scheduledDate === today) && t.status !== 'done'
    ).length;
    document.getElementById('today-count').textContent = todayCount;

    // Waiting count
    const waitingCount = allTasks.filter(t => t.status === 'waiting').length;
    const waitingCountEl = document.getElementById('waiting-count');
    if (waitingCountEl) waitingCountEl.textContent = waitingCount;
  },
};
