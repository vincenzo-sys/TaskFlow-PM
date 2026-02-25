// TaskFlow PM - Modals (task/project/category/tag forms, confirmations, team, dependencies)

export const ModalsMixin = {
  openModal(modalId) {
    document.getElementById(modalId).classList.add('open');
  },

  closeModal(modalId) {
    document.getElementById(modalId).classList.remove('open');
  },

  closeAllModals() {
    document.querySelectorAll('.modal').forEach(m => m.classList.remove('open'));
  },

  openTaskModal(taskId = null, preselectedProjectId = null) {
    const modal = document.getElementById('task-modal');
    const form = document.getElementById('task-form');
    const title = document.getElementById('task-modal-title');

    form.reset();
    document.getElementById('task-id').value = '';
    document.getElementById('task-parent-id').value = '';

    // Reset context guide
    const contextToggle = document.getElementById('context-guide-toggle');
    const contextGuide = document.getElementById('context-guide');
    if (contextToggle && contextGuide) {
      contextToggle.classList.remove('expanded');
      contextGuide.classList.remove('show');
      contextToggle.querySelector('span').textContent = 'Show prompts';
    }

    // Reset tag checkboxes
    document.querySelectorAll('#tags-selector input').forEach(cb => {
      cb.checked = false;
      cb.parentElement.classList.remove('selected');
    });

    // Populate project dropdown
    const projectSelect = document.getElementById('task-project');
    projectSelect.innerHTML = '<option value="">No Project (Inbox)</option>';
    this.data.projects.filter(p => !p.isInbox).forEach(p => {
      projectSelect.innerHTML += `<option value="${p.id}">${this.escapeHtml(p.name)}</option>`;
    });

    // Reset scheduling fields
    document.getElementById('task-scheduled-time').value = '';
    document.getElementById('task-scheduled-date').value = '';
    document.getElementById('task-estimated-minutes').value = '';
    document.querySelectorAll('.duration-btn').forEach(btn => btn.classList.remove('selected'));

    // Reset timeline fields
    const startDateInput = document.getElementById('task-start-date');
    const endDateInput = document.getElementById('task-end-date');
    const assigneeInput = document.getElementById('task-assignee');
    if (startDateInput) startDateInput.value = '';
    if (endDateInput) endDateInput.value = '';
    if (assigneeInput) {
      this.populateAssigneeDropdown(assigneeInput);
      assigneeInput.value = '';
    }

    if (taskId) {
      const task = this.findTask(taskId);
      if (task) {
        title.textContent = 'Edit Task';
        document.getElementById('task-id').value = task.id;
        document.getElementById('task-name').value = task.name;
        document.getElementById('task-description').value = task.description || '';
        document.getElementById('task-context').value = task.context || '';
        document.getElementById('task-project').value = task.projectId || '';
        document.getElementById('task-status').value = task.status;
        document.getElementById('task-priority').value = task.priority;
        document.getElementById('task-due-date').value = task.dueDate || '';

        // Set scheduling fields
        document.getElementById('task-scheduled-time').value = task.scheduledTime || '';
        document.getElementById('task-scheduled-date').value = task.scheduledDate || '';
        document.getElementById('task-estimated-minutes').value = task.estimatedMinutes || '';

        // Set timeline fields
        const startDateEl = document.getElementById('task-start-date');
        const endDateEl = document.getElementById('task-end-date');
        const assigneeEl = document.getElementById('task-assignee');
        if (startDateEl) startDateEl.value = task.startDate || '';
        if (endDateEl) endDateEl.value = task.endDate || '';
        if (assigneeEl) {
          this.populateAssigneeDropdown(assigneeEl);
          assigneeEl.value = task.assignee || '';
        }

        // Select duration button if estimatedMinutes is set
        if (task.estimatedMinutes) {
          const durationBtn = document.querySelector(`.duration-btn[data-minutes="${task.estimatedMinutes}"]`);
          if (durationBtn) durationBtn.classList.add('selected');
        }

        // Set tags
        task.tags.forEach(tagId => {
          const cb = document.querySelector(`#tags-selector input[value="${tagId}"]`);
          if (cb) {
            cb.checked = true;
            cb.parentElement.classList.add('selected');
          }
        });
      }
    } else {
      title.textContent = 'Add Task';

      // Pre-select project if specified or if viewing a project
      const presetProjectId = preselectedProjectId || (this.currentView.startsWith('project-') ? this.currentView.replace('project-', '') : null);
      if (presetProjectId) {
        document.getElementById('task-project').value = presetProjectId;
      }
      // Clear temp file paths for new tasks
      this._tempFilePaths = [];
    }

    // Render file paths
    this.renderFilePathsInModal();

    this.openModal('task-modal');
    document.getElementById('task-name').focus();
  },

  saveTaskForm() {
    const taskId = document.getElementById('task-id').value;
    const selectedTags = Array.from(document.querySelectorAll('#tags-selector input:checked'))
      .map(cb => cb.value);

    // Get scheduling fields
    const scheduledTime = document.getElementById('task-scheduled-time').value || null;
    const scheduledDate = document.getElementById('task-scheduled-date').value || null;
    const estimatedMinutes = parseInt(document.getElementById('task-estimated-minutes').value) || null;

    // Get timeline fields
    const startDate = document.getElementById('task-start-date')?.value || null;
    const endDate = document.getElementById('task-end-date')?.value || null;
    const assigneeEl = document.getElementById('task-assignee');
    const assignee = assigneeEl ? (assigneeEl.value || null) : null;

    const taskData = {
      name: document.getElementById('task-name').value.trim(),
      description: document.getElementById('task-description').value.trim(),
      context: document.getElementById('task-context').value.trim(),
      projectId: document.getElementById('task-project').value || null,
      status: document.getElementById('task-status').value,
      priority: document.getElementById('task-priority').value,
      dueDate: document.getElementById('task-due-date').value || null,
      scheduledTime: scheduledTime,
      scheduledDate: scheduledDate || (scheduledTime ? this.getLocalDateString() : null),
      startDate: startDate,
      endDate: endDate,
      assignee: assignee,
      estimatedMinutes: estimatedMinutes,
      tags: selectedTags,
      filePaths: this._tempFilePaths || []
    };

    if (taskId) {
      // Don't overwrite file paths when editing - they're managed separately
      delete taskData.filePaths;
      this.updateTask(taskId, taskData);
    } else {
      this.createTask(taskData);
    }

    this.closeModal('task-modal');
    this.render();
  },

  populateAssigneeDropdown(selectEl) {
    const members = this.data.teamMembers || [];
    selectEl.innerHTML = '<option value="">Unassigned</option>';
    members.forEach(m => {
      selectEl.innerHTML += `<option value="${this.escapeHtml(m.userId)}">${this.escapeHtml(m.displayName)}</option>`;
    });
    // Always add Claude as a special option
    selectEl.innerHTML += '<option value="claude">Claude</option>';
  },

  /**
   * Build <option> HTML for assignedTo dropdowns from team members.
   */
  buildAssignedToOptions(currentValue) {
    const members = this.data.teamMembers || [];
    let html = `<option value="" ${!currentValue ? 'selected' : ''}>Unassigned</option>`;
    members.forEach(m => {
      html += `<option value="${this.escapeHtml(m.userId)}" ${currentValue === m.userId ? 'selected' : ''}>${this.escapeHtml(m.displayName)}</option>`;
    });
    html += `<option value="claude" ${currentValue === 'claude' ? 'selected' : ''}>Claude</option>`;
    return html;
  },

  /**
   * Look up display name for an assignedTo value.
   */
  getAssignedToDisplayName(assignedTo) {
    if (!assignedTo) return null;
    if (assignedTo === 'claude') return 'Claude';
    const member = (this.data.teamMembers || []).find(m => m.userId === assignedTo);
    return member ? member.displayName : assignedTo;
  },

  openProjectModal(projectId = null) {
    const modal = document.getElementById('project-modal');
    const form = document.getElementById('project-form');
    const title = document.getElementById('project-modal-title');
    const deleteBtn = document.getElementById('delete-project-btn');

    form.reset();
    document.getElementById('project-id').value = '';

    // Populate category dropdown
    const categorySelect = document.getElementById('project-category');
    if (categorySelect) {
      categorySelect.innerHTML = '<option value="">No Category</option>';
      for (const category of this.data.categories || []) {
        const option = document.createElement('option');
        option.value = category.id;
        option.textContent = category.name;
        categorySelect.appendChild(option);
      }
    }

    // Reset color selection
    document.querySelectorAll('#project-color-picker .color-option').forEach(o => o.classList.remove('selected'));
    document.querySelector('#project-color-picker .color-option').classList.add('selected');
    document.getElementById('project-color').value = '#3498db';

    // Reset goal, status, working directory
    const goalInput = document.getElementById('project-goal');
    if (goalInput) goalInput.value = '';
    const statusSelect = document.getElementById('project-status');
    if (statusSelect) statusSelect.value = 'active';
    const workingDirInput = document.getElementById('project-working-dir');
    if (workingDirInput) workingDirInput.value = '';

    if (projectId) {
      const project = this.data.projects.find(p => p.id === projectId);
      if (project) {
        title.textContent = 'Edit Project';
        document.getElementById('project-id').value = project.id;
        document.getElementById('project-name').value = project.name;
        document.getElementById('project-description').value = project.description || '';
        document.getElementById('project-color').value = project.color;

        // Set category
        if (categorySelect && project.categoryId) {
          categorySelect.value = project.categoryId;
        }

        // Set goal
        if (goalInput && project.goal) {
          goalInput.value = project.goal;
        }

        // Set status
        if (statusSelect && project.status) {
          statusSelect.value = project.status;
        }

        // Set working directory
        if (workingDirInput && project.workingDirectory) {
          workingDirInput.value = project.workingDirectory;
        }

        // Select color
        document.querySelectorAll('#project-color-picker .color-option').forEach(o => {
          o.classList.toggle('selected', o.dataset.color === project.color);
        });

        deleteBtn.style.display = 'block';
      }
    } else {
      title.textContent = 'Add Project';
      deleteBtn.style.display = 'none';
    }

    this.openModal('project-modal');
    document.getElementById('project-name').focus();
  },

  saveProjectForm() {
    const projectId = document.getElementById('project-id').value;
    const categorySelect = document.getElementById('project-category');
    const goalInput = document.getElementById('project-goal');
    const statusSelect = document.getElementById('project-status');

    const workingDirInput = document.getElementById('project-working-dir');
    const projectData = {
      name: document.getElementById('project-name').value.trim(),
      description: document.getElementById('project-description').value.trim(),
      color: document.getElementById('project-color').value,
      categoryId: categorySelect ? categorySelect.value || null : null,
      goal: goalInput ? goalInput.value.trim() : '',
      status: statusSelect ? statusSelect.value : 'active',
      workingDirectory: workingDirInput ? workingDirInput.value.trim() || null : null
    };

    if (projectId) {
      this.updateProject(projectId, projectData);
    } else {
      this.createProject(projectData);
    }

    this.closeModal('project-modal');
    this.render();
  },

  // Category Modal Methods
  openCategoryModal(categoryId = null) {
    const modal = document.getElementById('category-modal');
    if (!modal) return;

    const form = document.getElementById('category-form');
    const title = document.getElementById('category-modal-title');
    const deleteBtn = document.getElementById('delete-category-btn');

    form.reset();
    document.getElementById('category-id').value = '';

    // Reset color selection
    document.querySelectorAll('#category-color-picker .color-option').forEach(o => o.classList.remove('selected'));
    const firstColor = document.querySelector('#category-color-picker .color-option');
    if (firstColor) firstColor.classList.add('selected');
    document.getElementById('category-color').value = '#6366f1';

    if (categoryId) {
      const category = this.data.categories.find(c => c.id === categoryId);
      if (category) {
        title.textContent = 'Edit Category';
        document.getElementById('category-id').value = category.id;
        document.getElementById('category-name').value = category.name;
        document.getElementById('category-color').value = category.color;

        // Select color
        document.querySelectorAll('#category-color-picker .color-option').forEach(o => {
          o.classList.toggle('selected', o.dataset.color === category.color);
        });

        deleteBtn.style.display = 'block';
      }
    } else {
      title.textContent = 'Add Category';
      deleteBtn.style.display = 'none';
    }

    this.openModal('category-modal');
    document.getElementById('category-name').focus();
  },

  saveCategoryForm() {
    const categoryId = document.getElementById('category-id').value;
    const categoryData = {
      name: document.getElementById('category-name').value.trim(),
      color: document.getElementById('category-color').value
    };

    if (categoryId) {
      this.updateCategory(categoryId, categoryData);
    } else {
      this.createCategory(categoryData);
    }

    this.closeModal('category-modal');
    this.render();
  },

  confirmDeleteCategory() {
    const categoryId = document.getElementById('category-id').value;
    if (!categoryId) return;

    const category = this.data.categories.find(c => c.id === categoryId);
    if (!category) return;

    // Count projects in this category
    const projectCount = this.data.projects.filter(p => p.categoryId === categoryId).length;

    this.showConfirmDialog(
      'Delete Category',
      `Delete "${category.name}"? ${projectCount > 0 ? `${projectCount} project(s) will become uncategorized.` : ''}`,
      () => {
        this.deleteCategory(categoryId);
        this.closeModal('category-modal');
        this.render();
      }
    );
  },

  // Dependency Modal Methods
  openDependencyModal(taskId) {
    const task = this.findTask(taskId);
    if (!task) return;

    const modal = document.getElementById('dependency-modal');
    if (!modal) return;

    document.getElementById('dependency-task-id').value = taskId;
    document.querySelector('#dependency-task-info .dependency-task-name').textContent = task.name;

    // Render blocked by list
    this.renderBlockedByList(task);

    // Render blocks list
    this.renderBlocksList(task);

    // Populate available tasks for adding blockers
    this.populateBlockerSelect(task);

    this.openModal('dependency-modal');
  },

  renderBlockedByList(task) {
    const container = document.getElementById('blocked-by-list');
    const countEl = document.getElementById('blocked-by-count');
    container.innerHTML = '';

    const blockers = (task.blockedBy || [])
      .map(id => this.findTask(id))
      .filter(Boolean);

    countEl.textContent = `(${blockers.length})`;

    if (blockers.length === 0) {
      container.innerHTML = '<div class="dependency-empty">No blockers</div>';
      return;
    }

    for (const blocker of blockers) {
      const item = document.createElement('div');
      item.className = 'dependency-item';
      item.innerHTML = `
        <span class="dependency-item-status ${blocker.status}"></span>
        <span class="dependency-item-name">${this.escapeHtml(blocker.name)}</span>
        <button class="dependency-item-remove" title="Remove blocker" data-blocker-id="${blocker.id}">&#10005;</button>
      `;

      item.querySelector('.dependency-item-remove').addEventListener('click', () => {
        this.removeDependency(task.id, blocker.id);
        this.openDependencyModal(task.id); // Refresh modal
        this.render();
      });

      container.appendChild(item);
    }
  },

  renderBlocksList(task) {
    const container = document.getElementById('blocks-list');
    const countEl = document.getElementById('blocks-count');
    container.innerHTML = '';

    const blocked = (task.blocks || [])
      .map(id => this.findTask(id))
      .filter(Boolean);

    countEl.textContent = `(${blocked.length})`;

    if (blocked.length === 0) {
      container.innerHTML = '<div class="dependency-empty">Not blocking any tasks</div>';
      return;
    }

    for (const blockedTask of blocked) {
      const item = document.createElement('div');
      item.className = 'dependency-item';
      item.innerHTML = `
        <span class="dependency-item-status ${blockedTask.status}"></span>
        <span class="dependency-item-name">${this.escapeHtml(blockedTask.name)}</span>
      `;
      container.appendChild(item);
    }
  },

  populateBlockerSelect(task) {
    const select = document.getElementById('add-blocker-select');
    if (!select) return;

    select.innerHTML = '<option value="">Select a task...</option>';

    const allTasks = this.getAllTasks();
    const currentBlockers = task.blockedBy || [];

    for (const t of allTasks) {
      // Skip current task, already blockers, and completed tasks
      if (t.id === task.id || currentBlockers.includes(t.id) || t.status === 'done') {
        continue;
      }
      // Skip if adding would create circular dependency
      if (this.wouldCreateCircularDependency(task.id, t.id)) {
        continue;
      }

      const option = document.createElement('option');
      option.value = t.id;
      option.textContent = t.name;
      select.appendChild(option);
    }
  },

  addBlockerFromModal() {
    const taskId = document.getElementById('dependency-task-id').value;
    const select = document.getElementById('add-blocker-select');
    const blockerId = select.value;

    if (!taskId || !blockerId) return;

    this.addDependency(taskId, blockerId);
    this.openDependencyModal(taskId); // Refresh modal
    this.render();
  },

  openTagModal(tagId = null) {
    const modal = document.getElementById('tag-modal');
    const form = document.getElementById('tag-form');
    const title = document.getElementById('tag-modal-title');
    const deleteBtn = document.getElementById('delete-tag-btn');

    form.reset();
    document.getElementById('tag-id').value = '';

    // Reset color selection
    document.querySelectorAll('#tag-color-picker .color-option').forEach(o => o.classList.remove('selected'));
    document.querySelector('#tag-color-picker .color-option').classList.add('selected');
    document.getElementById('tag-color').value = '#3498db';

    if (tagId) {
      const tag = this.data.tags.find(t => t.id === tagId);
      if (tag) {
        title.textContent = 'Edit Tag';
        document.getElementById('tag-id').value = tag.id;
        document.getElementById('tag-name').value = tag.name;
        document.getElementById('tag-color').value = tag.color;

        // Select color
        document.querySelectorAll('#tag-color-picker .color-option').forEach(o => {
          o.classList.toggle('selected', o.dataset.color === tag.color);
        });

        deleteBtn.style.display = 'block';
      }
    } else {
      title.textContent = 'Add Tag';
      deleteBtn.style.display = 'none';
    }

    this.openModal('tag-modal');
    document.getElementById('tag-name').focus();
  },

  saveTagForm() {
    const tagId = document.getElementById('tag-id').value;
    const tagData = {
      name: document.getElementById('tag-name').value.trim(),
      color: document.getElementById('tag-color').value
    };

    if (tagId) {
      this.updateTag(tagId, tagData);
    } else {
      this.createTag(tagData);
    }

    this.closeModal('tag-modal');
    this.render();
  },

  // Confirmations
  showConfirmDialog(title, message, onConfirm) {
    document.getElementById('confirm-title').textContent = title;
    document.getElementById('confirm-message').textContent = message;

    const okBtn = document.getElementById('confirm-ok');
    const cancelBtn = document.getElementById('confirm-cancel');

    const handleOk = () => {
      onConfirm();
      cleanup();
    };

    const handleCancel = () => {
      cleanup();
    };

    const cleanup = () => {
      okBtn.removeEventListener('click', handleOk);
      cancelBtn.removeEventListener('click', handleCancel);
      this.closeModal('confirm-modal');
    };

    okBtn.addEventListener('click', handleOk);
    cancelBtn.addEventListener('click', handleCancel);
    this.openModal('confirm-modal');
  },

  confirmDeleteTask(taskId) {
    const task = this.findTask(taskId);
    if (!task) return;

    document.getElementById('confirm-title').textContent = 'Delete Task';
    document.getElementById('confirm-message').textContent = `Are you sure you want to delete "${task.name}"?`;

    const okBtn = document.getElementById('confirm-ok');
    const cancelBtn = document.getElementById('confirm-cancel');

    const handleOk = () => {
      this.deleteTask(taskId);
      this.closeDetailPanel();
      this.render();
      cleanup();
    };

    const handleCancel = () => {
      cleanup();
    };

    const cleanup = () => {
      okBtn.removeEventListener('click', handleOk);
      cancelBtn.removeEventListener('click', handleCancel);
      this.closeModal('confirm-modal');
    };

    okBtn.addEventListener('click', handleOk);
    cancelBtn.addEventListener('click', handleCancel);
    this.openModal('confirm-modal');
  },

  confirmDeleteProject() {
    const projectId = document.getElementById('project-id').value;
    const project = this.data.projects.find(p => p.id === projectId);
    if (!project) return;

    document.getElementById('confirm-title').textContent = 'Delete Project';
    document.getElementById('confirm-message').textContent = `Are you sure you want to delete "${project.name}" and all its tasks?`;

    const okBtn = document.getElementById('confirm-ok');
    const cancelBtn = document.getElementById('confirm-cancel');

    const handleOk = () => {
      this.deleteProject(projectId);
      this.closeModal('project-modal');
      this.render();
      cleanup();
    };

    const handleCancel = () => {
      cleanup();
    };

    const cleanup = () => {
      okBtn.removeEventListener('click', handleOk);
      cancelBtn.removeEventListener('click', handleCancel);
      this.closeModal('confirm-modal');
    };

    okBtn.addEventListener('click', handleOk);
    cancelBtn.addEventListener('click', handleCancel);
    this.openModal('confirm-modal');
  },

  confirmDeleteTag() {
    const tagId = document.getElementById('tag-id').value;
    const tag = this.data.tags.find(t => t.id === tagId);
    if (!tag) return;

    document.getElementById('confirm-title').textContent = 'Delete Tag';
    document.getElementById('confirm-message').textContent = `Are you sure you want to delete the tag "${tag.name}"?`;

    const okBtn = document.getElementById('confirm-ok');
    const cancelBtn = document.getElementById('confirm-cancel');

    const handleOk = () => {
      this.deleteTag(tagId);
      this.closeModal('tag-modal');
      this.render();
      cleanup();
    };

    const handleCancel = () => {
      cleanup();
    };

    const cleanup = () => {
      okBtn.removeEventListener('click', handleOk);
      cancelBtn.removeEventListener('click', handleCancel);
      this.closeModal('confirm-modal');
    };

    okBtn.addEventListener('click', handleOk);
    cancelBtn.addEventListener('click', handleCancel);
    this.openModal('confirm-modal');
  }
};
