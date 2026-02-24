// TaskFlow PM - Navigation (view switching, rendering dispatch, status bar)

export const NavigationMixin = {
  setView(view) {
    this.currentView = view;
    document.querySelectorAll('.nav-item[data-view]').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.view === view);
    });
    document.querySelectorAll('.project-item, .tag-item').forEach(item => {
      item.classList.remove('active');
    });

    if (view.startsWith('project-')) {
      const projectItem = document.querySelector(`.project-item[data-id="${view.replace('project-', '')}"]`);
      if (projectItem) projectItem.classList.add('active');
    } else if (view.startsWith('tag-')) {
      const tagItem = document.querySelector(`.tag-item[data-id="${view.replace('tag-', '')}"]`);
      if (tagItem) tagItem.classList.add('active');
    }

    // Hide all views first
    document.getElementById('task-list-view').classList.remove('active');
    document.getElementById('task-board-view').classList.remove('active');
    document.getElementById('calendar-view').classList.remove('active');
    const commandCenterView = document.getElementById('command-center-view');
    if (commandCenterView) commandCenterView.classList.remove('active');
    const claudeView = document.getElementById('claude-view');
    if (claudeView) claudeView.classList.remove('active');

    // Handle special views
    if (view === 'command-center' || view === 'today') {
      if (commandCenterView) commandCenterView.classList.add('active');
      document.querySelector('.view-options').style.display = 'none';
      document.querySelector('.sort-select').style.display = 'none';
      document.querySelector('.filter-select').style.display = 'none';
      this.renderCommandCenter();
    } else if (view === 'calendar' || view === 'upcoming') {
      this.currentView = 'calendar';
      document.getElementById('calendar-view').classList.add('active');
      document.querySelector('.view-options').style.display = 'none';
      document.querySelector('.sort-select').style.display = 'none';
      document.querySelector('.filter-select').style.display = 'none';
      this.renderCalendar();
    } else if (view === 'recaps') {
      document.getElementById('task-list-view').classList.add('active');
      document.querySelector('.view-options').style.display = 'none';
      document.querySelector('.sort-select').style.display = 'none';
      document.querySelector('.filter-select').style.display = 'none';
      this.renderRecapsView();
    } else if (view === 'inbox') {
      document.getElementById('task-list-view').classList.add('active');
      document.querySelector('.view-options').style.display = 'none';
      document.querySelector('.sort-select').style.display = 'none';
      document.querySelector('.filter-select').style.display = 'none';
      this.renderInbox();
    } else if (view === 'master-list') {
      document.getElementById('task-list-view').classList.add('active');
      document.querySelector('.view-options').style.display = 'none';
      document.querySelector('.sort-select').style.display = 'none';
      document.querySelector('.filter-select').style.display = 'none';
      this.renderMasterList();
    } else if (view === 'dashboard') {
      document.getElementById('task-list-view').classList.add('active');
      document.querySelector('.view-options').style.display = 'none';
      document.querySelector('.sort-select').style.display = 'none';
      document.querySelector('.filter-select').style.display = 'none';
      this.renderDashboard();
    } else if (view === 'claude') {
      document.getElementById('claude-view').classList.add('active');
      document.querySelector('.view-options').style.display = 'none';
      document.querySelector('.sort-select').style.display = 'none';
      document.querySelector('.filter-select').style.display = 'none';
      this.renderClaudeView();
    } else if (view.startsWith('project-')) {
      document.getElementById('task-list-view').classList.add('active');
      document.querySelector('.view-options').style.display = 'none';
      document.querySelector('.sort-select').style.display = 'none';
      document.querySelector('.filter-select').style.display = 'none';
      this.renderProjectView();
    } else {
      // Show list or board view based on current mode
      if (this.currentViewMode === 'list') {
        document.getElementById('task-list-view').classList.add('active');
      } else {
        document.getElementById('task-board-view').classList.add('active');
      }
      document.querySelector('.view-options').style.display = '';
      document.querySelector('.sort-select').style.display = '';
      document.querySelector('.filter-select').style.display = '';
      this.renderTasks();
    }

    this.updateViewTitle();
    this.closeDetailPanel();
  },

  setViewMode(mode) {
    this.currentViewMode = mode;
    document.querySelectorAll('.view-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.viewMode === mode);
    });
    document.getElementById('task-list-view').classList.toggle('active', mode === 'list');
    document.getElementById('task-board-view').classList.toggle('active', mode === 'board');
    document.getElementById('calendar-view').classList.toggle('active', false);
    this.renderTasks();
  },

  updateViewTitle() {
    const titleEl = document.getElementById('view-title');
    const subtitleEl = document.getElementById('view-subtitle');

    const titles = {
      inbox: 'Inbox',
      today: 'Today',
      upcoming: 'Upcoming',
      completed: 'Completed',
      calendar: 'Calendar',
      waiting: 'Waiting',
      'command-center': 'Command Center',
      'master-list': 'Master List',
      'dashboard': 'Dashboard',
      'recaps': 'Daily Recaps'
    };

    const subtitles = {
      inbox: 'Process and organize your captures',
      calendar: 'View your accomplishments and upcoming work',
      waiting: 'Tasks blocked on someone or something',
      'command-center': 'Your AI-powered mission control',
      'master-list': 'All tasks in one compact view',
      'dashboard': 'Project health at a glance',
      'recaps': 'Track your progress and learnings'
    };

    if (titles[this.currentView]) {
      titleEl.textContent = titles[this.currentView];
      subtitleEl.textContent = subtitles[this.currentView] || '';
    } else if (this.currentView.startsWith('project-')) {
      const project = this.data.projects.find(p => p.id === this.currentView.replace('project-', ''));
      titleEl.textContent = project ? project.name : 'Project';
      subtitleEl.textContent = project ? project.description : '';
    } else if (this.currentView.startsWith('tag-')) {
      const tag = this.data.tags.find(t => t.id === this.currentView.replace('tag-', ''));
      titleEl.textContent = tag ? `#${tag.name}` : 'Tag';
      subtitleEl.textContent = '';
    }
  },

  // Rendering
  render() {
    this.renderProjects();
    this.renderTags();
    this.updateCounts();

    // Highlight correct nav item
    document.querySelectorAll('.nav-item[data-view]').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.view === this.currentView);
    });

    // Hide all views first
    document.querySelectorAll('.task-view').forEach(v => v.classList.remove('active'));

    // Helper to hide header controls
    const hideHeaderControls = () => {
      document.querySelector('.view-options')?.style && (document.querySelector('.view-options').style.display = 'none');
      document.querySelector('.sort-select')?.style && (document.querySelector('.sort-select').style.display = 'none');
      document.querySelector('.filter-select')?.style && (document.querySelector('.filter-select').style.display = 'none');
    };
    const showHeaderControls = () => {
      document.querySelector('.view-options')?.style && (document.querySelector('.view-options').style.display = '');
      document.querySelector('.sort-select')?.style && (document.querySelector('.sort-select').style.display = '');
      document.querySelector('.filter-select')?.style && (document.querySelector('.filter-select').style.display = '');
    };

    // Render the appropriate view
    if (this.currentView === 'today' || this.currentView === 'command-center') {
      document.getElementById('command-center-view')?.classList.add('active');
      hideHeaderControls();
      this.renderCommandCenter();
    } else if (this.currentView === 'calendar' || this.currentView === 'upcoming') {
      document.getElementById('calendar-view')?.classList.add('active');
      hideHeaderControls();
      this.renderCalendar();
    } else if (this.currentView === 'recaps') {
      document.getElementById('task-list-view')?.classList.add('active');
      hideHeaderControls();
      this.renderRecapsView();
    } else if (this.currentView === 'master-list') {
      document.getElementById('task-list-view')?.classList.add('active');
      hideHeaderControls();
      this.renderMasterList();
    } else if (this.currentView === 'inbox') {
      document.getElementById('task-list-view')?.classList.add('active');
      hideHeaderControls();
      this.renderInbox();
    } else if (this.currentView === 'dashboard') {
      document.getElementById('task-list-view')?.classList.add('active');
      hideHeaderControls();
      this.renderDashboard();
    } else if (this.currentView === 'claude') {
      document.getElementById('claude-view')?.classList.add('active');
      hideHeaderControls();
      this.renderClaudeView();
    } else if (this.currentView.startsWith('project-')) {
      document.getElementById('task-list-view')?.classList.add('active');
      hideHeaderControls();
      this.renderProjectView();
    } else {
      showHeaderControls();
      this.renderTasks();
    }

    this.updateStatusBar();
  },

  updateStatusBar() {
    const bar = document.getElementById('status-bar');
    if (!bar) return;

    const today = new Date().toISOString().split('T')[0];
    const allTasks = this.getAllTasks();
    const todayTasks = allTasks.filter(t =>
      t.status !== 'done' && (t.dueDate === today || t.scheduledDate === today)
    );
    const priorityOrder = { urgent: 0, high: 1, medium: 2, low: 3, none: 4 };

    // Current active task
    const workingIds = this.data.workingOnTaskIds || this.todayView?.workingOnTaskIds || [];
    const currentTask = workingIds.length > 0 ? this.findTask(workingIds[0]) : null;

    const dot = bar.querySelector('.status-dot');
    const taskName = bar.querySelector('.status-task-name');
    if (currentTask) {
      dot.classList.add('active');
      taskName.textContent = currentTask.name;
    } else {
      dot.classList.remove('active');
      taskName.textContent = 'No active task';
    }

    // Next task from today queue (first non-active by priority)
    const nextTask = todayTasks
      .filter(t => !workingIds.includes(t.id))
      .sort((a, b) => (priorityOrder[a.priority] || 4) - (priorityOrder[b.priority] || 4))[0];
    const nextNameEl = bar.querySelector('.status-next-name');
    if (nextNameEl) {
      nextNameEl.textContent = nextTask ? nextTask.name : '--';
    }

    // Count
    const countEl = document.getElementById('status-bar-count');
    if (countEl) {
      countEl.textContent = `${todayTasks.length} task${todayTasks.length !== 1 ? 's' : ''} today`;
    }
  },
};
