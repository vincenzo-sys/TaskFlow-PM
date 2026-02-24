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

    const categories = this.data.categories || [];
    const projects = this.data.projects.filter(p => !p.isInbox);

    // Sort categories by order
    const sortedCategories = [...categories].sort((a, b) => (a.order || 0) - (b.order || 0));

    // Render each category
    for (const category of sortedCategories) {
      const categoryProjects = projects.filter(p => p.categoryId === category.id);
      const totalTasks = categoryProjects.reduce((sum, p) =>
        sum + p.tasks.filter(t => t.status !== 'done').length, 0);

      const group = document.createElement('div');
      group.className = `category-group${category.collapsed ? ' collapsed' : ''}`;
      group.dataset.categoryId = category.id;

      group.innerHTML = `
        <div class="category-header">
          <span class="category-toggle">&#9660;</span>
          <span class="category-color" style="background:${category.color}"></span>
          <span class="category-name">${this.escapeHtml(category.name)}</span>
          <span class="category-count">${totalTasks}</span>
          <button class="category-edit" title="Edit">&#9998;</button>
        </div>
        <div class="category-projects" style="max-height: ${category.collapsed ? 0 : categoryProjects.length * 40 + 8}px"></div>
      `;

      // Toggle collapse on header click
      group.querySelector('.category-header').addEventListener('click', (e) => {
        if (!e.target.classList.contains('category-edit')) {
          this.toggleCategoryCollapsed(category.id);
        }
      });

      // Edit category
      group.querySelector('.category-edit').addEventListener('click', (e) => {
        e.stopPropagation();
        this.openCategoryModal(category.id);
      });

      // Add projects to category
      const projectsContainer = group.querySelector('.category-projects');
      for (const project of categoryProjects) {
        projectsContainer.appendChild(this.createProjectItem(project, false));
      }

      container.appendChild(group);
    }

    // Render uncategorized projects
    const uncategorized = projects.filter(p => !p.categoryId);
    if (uncategorized.length > 0) {
      const group = document.createElement('div');
      group.className = 'category-group';

      const totalTasks = uncategorized.reduce((sum, p) =>
        sum + p.tasks.filter(t => t.status !== 'done').length, 0);

      group.innerHTML = `
        <div class="category-header">
          <span class="category-toggle">&#9660;</span>
          <span class="category-color" style="background:var(--text-muted)"></span>
          <span class="category-name">Uncategorized</span>
          <span class="category-count">${totalTasks}</span>
        </div>
        <div class="category-projects" style="max-height: ${uncategorized.length * 40 + 8}px"></div>
      `;

      group.querySelector('.category-header').addEventListener('click', () => {
        group.classList.toggle('collapsed');
        const projectsContainer = group.querySelector('.category-projects');
        if (group.classList.contains('collapsed')) {
          projectsContainer.style.maxHeight = '0';
        } else {
          projectsContainer.style.maxHeight = uncategorized.length * 40 + 8 + 'px';
        }
      });

      const projectsContainer = group.querySelector('.category-projects');
      for (const project of uncategorized) {
        projectsContainer.appendChild(this.createProjectItem(project, false));
      }

      container.appendChild(group);
    }
  },

  createProjectItem(project, inFavorites) {
    const taskCount = project.tasks.filter(t => t.status !== 'done').length;
    const isFavorite = this.isFavorite(project.id);

    const el = document.createElement('button');
    el.className = 'project-item';
    el.dataset.id = project.id;

    el.innerHTML = `
      <span class="project-color" style="background:${project.color}"></span>
      <span class="project-name">${this.escapeHtml(project.name)}</span>
      <span class="project-count">${taskCount}</span>
      <button class="project-favorite-btn ${isFavorite ? 'favorited' : ''}" title="${isFavorite ? 'Remove from favorites' : 'Add to favorites'}">
        ${isFavorite ? '&#9733;' : '&#9734;'}
      </button>
      <button class="project-edit" title="Edit">&#9998;</button>
    `;

    el.addEventListener('click', (e) => {
      if (!e.target.classList.contains('project-edit') &&
          !e.target.classList.contains('project-favorite-btn')) {
        this.setView(`project-${project.id}`);
      }
    });

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
      container.appendChild(this.createProjectItem(project, false));
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
