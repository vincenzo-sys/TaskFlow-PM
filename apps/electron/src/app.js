// TaskFlow PM - Application entry point
// Assembles all modules into the TaskFlowApp class via mixins

import { TaskFlowApp, PRIORITY_COLORS, CoreMixin } from './core.js';
import { DataOpsMixin } from './data-ops.js';
import { EventsMixin } from './events.js';
import { NavigationMixin } from './navigation.js';
import { SidebarMixin } from './sidebar.js';
import { TaskListMixin } from './task-list.js';
import { CalendarMixin } from './calendar.js';
import { TodayViewMixin } from './today-view.js';
import { InboxMixin } from './inbox.js';
import { FocusModeMixin } from './focus-mode.js';
import { DetailPanelMixin } from './detail-panel.js';
import { ProjectViewsMixin } from './project-views.js';
import { RecapsMixin } from './recaps.js';
import { ClaudeMixin } from './claude.js';
import { ModalsMixin } from './modals.js';
import { UtilitiesMixin } from './utilities.js';
import { DragDropMixin } from './drag-drop.js';
import { CommandPaletteMixin } from './command-palette.js';

// Apply all mixins to TaskFlowApp prototype
const mixins = [
  CoreMixin,
  DataOpsMixin,
  EventsMixin,
  NavigationMixin,
  SidebarMixin,
  TaskListMixin,
  CalendarMixin,
  TodayViewMixin,
  InboxMixin,
  FocusModeMixin,
  DetailPanelMixin,
  ProjectViewsMixin,
  RecapsMixin,
  ClaudeMixin,
  ModalsMixin,
  UtilitiesMixin,
  DragDropMixin,
  CommandPaletteMixin,
];

for (const mixin of mixins) {
  Object.assign(TaskFlowApp.prototype, mixin);
}

// Make PRIORITY_COLORS available globally (used by some inline styles)
window.PRIORITY_COLORS = PRIORITY_COLORS;

// Initialize drag and drop for board view
document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.column-tasks').forEach(column => {
    column.addEventListener('dragover', (e) => {
      e.preventDefault();
      column.classList.add('drag-over');
    });

    column.addEventListener('dragleave', () => {
      column.classList.remove('drag-over');
    });

    column.addEventListener('drop', (e) => {
      e.preventDefault();
      column.classList.remove('drag-over');
      const taskId = e.dataTransfer.getData('text/plain');
      const newStatus = column.dataset.status;

      if (window.app) {
        window.app.updateTask(taskId, { status: newStatus });
        window.app.render();
      }
    });
  });
});

// Start the application
window.app = new TaskFlowApp();
