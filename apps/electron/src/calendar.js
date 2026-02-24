// TaskFlow PM - Calendar views (month, week, day)

export const CalendarMixin = {
  navigateCalendar(direction) {
    this.calendar.currentDate.setMonth(this.calendar.currentDate.getMonth() + direction);
    this.renderCalendar();
  },

  goToTodayCalendar() {
    this.calendar.currentDate = new Date();
    this.calendar.selectedDate = this.getLocalDateString();
    this.renderCalendar();
    this.renderCalendarDetail(this.calendar.selectedDate);
  },

  renderCalendar() {
    // Bind view toggle buttons
    this.bindCalendarViewToggle();

    // Show/hide views based on mode
    const monthView = document.getElementById('calendar-month-view');
    const weekView = document.getElementById('calendar-week-view');
    const dayView = document.getElementById('calendar-day-view');

    if (monthView) monthView.classList.toggle('hidden', this.calendar.viewMode !== 'month');
    if (weekView) weekView.classList.toggle('hidden', this.calendar.viewMode !== 'week');
    if (dayView) dayView.classList.toggle('hidden', this.calendar.viewMode !== 'day');

    // Render based on view mode
    switch (this.calendar.viewMode) {
      case 'week':
        this.renderCalendarWeekView();
        break;
      case 'day':
        this.renderCalendarDayView();
        break;
      default:
        this.renderCalendarMonthView();
    }
  },

  bindCalendarViewToggle() {
    document.querySelectorAll('.calendar-view-btn').forEach(btn => {
      btn.onclick = () => {
        document.querySelectorAll('.calendar-view-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.calendar.viewMode = btn.dataset.calendarView;
        this.renderCalendar();
      };
    });
  },

  renderCalendarMonthView() {
    const year = this.calendar.currentDate.getFullYear();
    const month = this.calendar.currentDate.getMonth();

    // Update title
    const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
                        'July', 'August', 'September', 'October', 'November', 'December'];
    document.getElementById('calendar-month').textContent = `${monthNames[month]} ${year}`;

    // Get first and last day of month
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const startDate = new Date(firstDay);
    startDate.setDate(startDate.getDate() - firstDay.getDay());

    const endDate = new Date(lastDay);
    endDate.setDate(endDate.getDate() + (6 - lastDay.getDay()));

    const grid = document.getElementById('calendar-grid');
    grid.innerHTML = '';

    const today = this.getLocalDateString();
    const tasks = this.getAllTasks(true);

    // Build day data
    const currentDate = new Date(startDate);
    while (currentDate <= endDate) {
      const dateStr = this.getLocalDateString(currentDate);
      const isCurrentMonth = currentDate.getMonth() === month;
      const isToday = dateStr === today;
      const isSelected = dateStr === this.calendar.selectedDate;

      // Get tasks for this day
      const dueTasks = tasks.filter(t => t.dueDate === dateStr && t.status !== 'done');
      const completedTasks = tasks.filter(t => t.completedAt && this.isoToLocalDate(t.completedAt) === dateStr);
      const overdueTasks = tasks.filter(t => t.dueDate === dateStr && t.dueDate < today && t.status !== 'done');

      const dayEl = document.createElement('div');
      dayEl.className = 'calendar-day';
      if (!isCurrentMonth) dayEl.classList.add('other-month');
      if (isToday) dayEl.classList.add('today');
      if (isSelected) dayEl.classList.add('selected');
      if (dueTasks.length > 0) dayEl.classList.add('has-tasks');
      if (completedTasks.length > 0) dayEl.classList.add('has-completed');

      let indicatorsHtml = '';
      if (overdueTasks.length > 0) {
        indicatorsHtml += '<span class="day-indicator overdue"></span>';
      }
      if (dueTasks.length > 0) {
        indicatorsHtml += '<span class="day-indicator due"></span>';
      }
      if (completedTasks.length > 0) {
        indicatorsHtml += '<span class="day-indicator completed"></span>';
      }

      let statsHtml = '';
      if (completedTasks.length > 0 || dueTasks.length > 0) {
        const parts = [];
        if (completedTasks.length > 0) parts.push(`${completedTasks.length} done`);
        if (dueTasks.length > 0) parts.push(`${dueTasks.length} due`);
        statsHtml = `<span class="day-stats">${parts.join(', ')}</span>`;
      }

      dayEl.innerHTML = `
        <span class="day-number">${currentDate.getDate()}</span>
        <div class="day-indicators">${indicatorsHtml}</div>
        ${statsHtml}
      `;

      dayEl.addEventListener('click', () => {
        document.querySelectorAll('.calendar-day.selected').forEach(d => d.classList.remove('selected'));
        dayEl.classList.add('selected');
        this.calendar.selectedDate = dateStr;
        this.renderCalendarDetail(dateStr);
      });

      grid.appendChild(dayEl);
      currentDate.setDate(currentDate.getDate() + 1);
    }
  },

  renderCalendarWeekView() {
    const weekStart = new Date(this.calendar.currentDate);
    weekStart.setDate(weekStart.getDate() - weekStart.getDay()); // Start on Sunday

    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekEnd.getDate() + 6);

    // Update title
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const startMonth = monthNames[weekStart.getMonth()];
    const endMonth = monthNames[weekEnd.getMonth()];
    const title = startMonth === endMonth
      ? `${startMonth} ${weekStart.getDate()} - ${weekEnd.getDate()}, ${weekEnd.getFullYear()}`
      : `${startMonth} ${weekStart.getDate()} - ${endMonth} ${weekEnd.getDate()}, ${weekEnd.getFullYear()}`;
    document.getElementById('calendar-month').textContent = title;

    const headerContainer = document.getElementById('week-header');
    const gridContainer = document.getElementById('week-grid');
    const today = this.getLocalDateString();
    const tasks = this.getAllTasks(true);
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

    // Build header with day columns
    let headerHtml = '<div class="week-time-column"></div>';
    for (let i = 0; i < 7; i++) {
      const date = new Date(weekStart);
      date.setDate(date.getDate() + i);
      const dateStr = this.getLocalDateString(date);
      const isToday = dateStr === today;
      headerHtml += `
        <div class="week-day-header ${isToday ? 'today' : ''}" data-date="${dateStr}">
          <span class="week-day-name">${dayNames[i]}</span>
          <span class="week-day-date">${date.getDate()}</span>
        </div>
      `;
    }
    headerContainer.innerHTML = headerHtml;

    // Build time grid (6am - 10pm, 15-minute slots)
    let gridHtml = '';
    for (let hour = 6; hour <= 22; hour++) {
      for (let quarter = 0; quarter < 4; quarter++) {
        const timeStr = `${String(hour).padStart(2, '0')}:${String(quarter * 15).padStart(2, '0')}`;
        const displayTime = quarter === 0 ? this.formatCalendarTimeDisplay(hour, 0) : '';

        gridHtml += `<div class="week-time-slot">${displayTime}</div>`;

        for (let day = 0; day < 7; day++) {
          const date = new Date(weekStart);
          date.setDate(date.getDate() + day);
          const dateStr = this.getLocalDateString(date);
          const isToday = dateStr === today;

          gridHtml += `
            <div class="week-cell ${isToday ? 'today' : ''}"
                 data-date="${dateStr}"
                 data-time="${timeStr}">
            </div>
          `;
        }
      }
    }
    gridContainer.innerHTML = gridHtml;

    // Render scheduled tasks on the grid
    for (let day = 0; day < 7; day++) {
      const date = new Date(weekStart);
      date.setDate(date.getDate() + day);
      const dateStr = this.getLocalDateString(date);

      const dayTasks = tasks.filter(t =>
        (t.scheduledDate === dateStr || t.dueDate === dateStr) &&
        t.scheduledTime &&
        t.status !== 'done'
      );

      dayTasks.forEach(task => {
        const cell = gridContainer.querySelector(`[data-date="${dateStr}"][data-time="${task.scheduledTime}"]`);
        if (cell) {
          const duration = task.estimatedMinutes || 30;
          const slots = Math.ceil(duration / 15);
          const taskEl = document.createElement('div');
          taskEl.className = `week-task-block priority-${task.priority || 'none'}`;
          taskEl.style.height = `${slots * 20}px`;
          taskEl.innerHTML = `<span class="week-task-name">${this.escapeHtml(task.name)}</span>`;
          taskEl.dataset.taskId = task.id;
          taskEl.onclick = () => this.openDetailPanel(task.id);
          cell.appendChild(taskEl);
        }
      });
    }

    // Bind drop zones for scheduling
    gridContainer.querySelectorAll('.week-cell').forEach(cell => {
      cell.addEventListener('dragover', (e) => {
        e.preventDefault();
        cell.classList.add('drag-over');
      });
      cell.addEventListener('dragleave', () => cell.classList.remove('drag-over'));
      cell.addEventListener('drop', (e) => {
        e.preventDefault();
        cell.classList.remove('drag-over');
        const taskId = e.dataTransfer.getData('text/plain');
        if (taskId) {
          this.updateTask(taskId, {
            scheduledDate: cell.dataset.date,
            scheduledTime: cell.dataset.time
          });
          this.renderCalendar();
        }
      });
    });
  },

  renderCalendarDayView() {
    const currentDate = new Date(this.calendar.currentDate);
    const dateStr = this.getLocalDateString(currentDate);
    const today = this.getLocalDateString();
    const isToday = dateStr === today;

    // Update title
    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
                        'July', 'August', 'September', 'October', 'November', 'December'];
    const title = `${dayNames[currentDate.getDay()]}, ${monthNames[currentDate.getMonth()]} ${currentDate.getDate()}`;
    document.getElementById('calendar-month').textContent = title;

    const headerContainer = document.getElementById('day-header');
    const timelineContainer = document.getElementById('day-timeline');
    const unscheduledContainer = document.getElementById('day-unscheduled');
    const tasks = this.getAllTasks(true);

    // Day header
    headerContainer.innerHTML = `
      <div class="day-header-content ${isToday ? 'today' : ''}">
        <span class="day-header-date">${currentDate.getDate()}</span>
        <span class="day-header-label">${isToday ? 'Today' : dayNames[currentDate.getDay()]}</span>
      </div>
    `;

    // Get tasks for this day
    const dayTasks = tasks.filter(t =>
      (t.dueDate === dateStr || t.scheduledDate === dateStr) && t.status !== 'done'
    );
    const scheduledTasks = dayTasks.filter(t => t.scheduledTime);
    const unscheduledTasks = dayTasks.filter(t => !t.scheduledTime);

    // Build timeline (6am - 10pm, 15-minute slots)
    let timelineHtml = '';
    for (let hour = 6; hour <= 22; hour++) {
      for (let quarter = 0; quarter < 4; quarter++) {
        const timeStr = `${String(hour).padStart(2, '0')}:${String(quarter * 15).padStart(2, '0')}`;
        const displayTime = quarter === 0 ? this.formatCalendarTimeDisplay(hour, 0) : '';
        const isHourStart = quarter === 0;

        timelineHtml += `
          <div class="day-time-row ${isHourStart ? 'hour-start' : ''}" data-time="${timeStr}">
            <div class="day-time-label">${displayTime}</div>
            <div class="day-time-slot" data-date="${dateStr}" data-time="${timeStr}"></div>
          </div>
        `;
      }
    }
    timelineContainer.innerHTML = timelineHtml;

    // Render scheduled tasks
    scheduledTasks.forEach(task => {
      const slot = timelineContainer.querySelector(`.day-time-slot[data-time="${task.scheduledTime}"]`);
      if (slot) {
        const duration = task.estimatedMinutes || 30;
        const slots = Math.ceil(duration / 15);
        const taskEl = document.createElement('div');
        taskEl.className = `day-task-block priority-${task.priority || 'none'}`;
        taskEl.style.height = `${slots * 24 - 4}px`;
        taskEl.innerHTML = `
          <div class="day-task-name">${this.escapeHtml(task.name)}</div>
          <div class="day-task-time">${this.formatCalendarTimeDisplay(...task.scheduledTime.split(':').map(Number))} · ${duration}m</div>
        `;
        taskEl.dataset.taskId = task.id;
        taskEl.onclick = () => this.openDetailPanel(task.id);
        slot.appendChild(taskEl);
      }
    });

    // Render unscheduled tasks
    if (unscheduledTasks.length > 0) {
      unscheduledContainer.innerHTML = `
        <div class="day-unscheduled-header">
          <span>Unscheduled (${unscheduledTasks.length})</span>
          <span class="day-unscheduled-hint">Drag to timeline to schedule</span>
        </div>
        <div class="day-unscheduled-list">
          ${unscheduledTasks.map(task => `
            <div class="day-unscheduled-task priority-${task.priority || 'none'}"
                 data-task-id="${task.id}"
                 draggable="true">
              <span class="day-task-name">${this.escapeHtml(task.name)}</span>
              <span class="day-task-duration">${task.estimatedMinutes || 30}m</span>
            </div>
          `).join('')}
        </div>
      `;

      // Bind drag events for unscheduled tasks
      unscheduledContainer.querySelectorAll('.day-unscheduled-task').forEach(item => {
        item.addEventListener('dragstart', (e) => {
          e.dataTransfer.setData('text/plain', item.dataset.taskId);
          item.classList.add('dragging');
        });
        item.addEventListener('dragend', () => item.classList.remove('dragging'));
        item.addEventListener('click', () => this.openDetailPanel(item.dataset.taskId));
      });
    } else {
      unscheduledContainer.innerHTML = '';
    }

    // Bind drop zones
    timelineContainer.querySelectorAll('.day-time-slot').forEach(slot => {
      slot.addEventListener('dragover', (e) => {
        e.preventDefault();
        slot.classList.add('drag-over');
      });
      slot.addEventListener('dragleave', () => slot.classList.remove('drag-over'));
      slot.addEventListener('drop', (e) => {
        e.preventDefault();
        slot.classList.remove('drag-over');
        const taskId = e.dataTransfer.getData('text/plain');
        if (taskId) {
          this.updateTask(taskId, {
            scheduledDate: slot.dataset.date,
            scheduledTime: slot.dataset.time
          });
          this.renderCalendar();
        }
      });
    });
  },

  // Calendar-specific time formatting — takes (hour, minute) as numbers.
  // Distinct from the general formatTimeDisplay(timeStr) in utilities.js
  // which takes a "HH:MM" string. Renamed to avoid the naming conflict.
  formatCalendarTimeDisplay(hour, minute) {
    const ampm = hour >= 12 ? 'PM' : 'AM';
    const displayHour = hour > 12 ? hour - 12 : (hour === 0 ? 12 : hour);
    return minute === 0 ? `${displayHour} ${ampm}` : `${displayHour}:${String(minute).padStart(2, '0')} ${ampm}`;
  },

  renderCalendarDetail(dateStr) {
    const detail = document.getElementById('calendar-detail');
    const tasks = this.getAllTasks(true);
    const today = this.getLocalDateString();

    const dueTasks = tasks.filter(t => t.dueDate === dateStr);
    const completedTasks = tasks.filter(t => t.completedAt && this.isoToLocalDate(t.completedAt) === dateStr);

    const date = new Date(dateStr + 'T00:00:00');
    const dateLabel = date.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });

    if (dueTasks.length === 0 && completedTasks.length === 0) {
      detail.innerHTML = `
        <div class="calendar-detail-header">
          <span class="calendar-detail-date">${dateLabel}</span>
        </div>
        <div class="calendar-empty">
          <p>No tasks or accomplishments for this day</p>
        </div>
      `;
      return;
    }

    let html = `
      <div class="calendar-detail-header">
        <span class="calendar-detail-date">${dateLabel}</span>
        <div class="calendar-detail-stats">
          ${completedTasks.length > 0 ? `<span class="calendar-stat"><span class="calendar-stat-value">${completedTasks.length}</span> completed</span>` : ''}
          ${dueTasks.filter(t => t.status !== 'done').length > 0 ? `<span class="calendar-stat"><span class="calendar-stat-value">${dueTasks.filter(t => t.status !== 'done').length}</span> due</span>` : ''}
        </div>
      </div>
    `;

    if (completedTasks.length > 0) {
      html += `
        <div class="calendar-section">
          <div class="calendar-section-title">Accomplished</div>
          <div class="calendar-task-list">
      `;
      completedTasks.forEach(t => {
        const project = this.data.projects.find(p => p.tasks.some(pt => pt.id === t.id));
        const execCls = t.executionType ? `exec-${t.executionType}` : '';
        html += `
          <div class="calendar-task-item completed ${execCls}">
            <span class="calendar-task-status completed"></span>
            <span class="calendar-task-name">${this.escapeHtml(t.name)}</span>
            ${project && !project.isInbox ? `<span class="calendar-task-project">${this.escapeHtml(project.name)}</span>` : ''}
          </div>
        `;
      });
      html += '</div></div>';
    }

    const pendingDue = dueTasks.filter(t => t.status !== 'done');
    if (pendingDue.length > 0) {
      const isOverdue = dateStr < today;
      html += `
        <div class="calendar-section">
          <div class="calendar-section-title">${isOverdue ? 'Was Due (Overdue)' : 'Due'}</div>
          <div class="calendar-task-list">
      `;
      pendingDue.forEach(t => {
        const project = this.data.projects.find(p => p.tasks.some(pt => pt.id === t.id));
        const execCls = t.executionType ? `exec-${t.executionType}` : '';
        html += `
          <div class="calendar-task-item ${execCls}">
            <span class="calendar-task-status ${isOverdue ? 'overdue' : 'due'}"></span>
            <span class="calendar-task-name">${this.escapeHtml(t.name)}</span>
            ${project && !project.isInbox ? `<span class="calendar-task-project">${this.escapeHtml(project.name)}</span>` : ''}
          </div>
        `;
      });
      html += '</div></div>';
    }

    detail.innerHTML = html;
  },
};
