// TaskFlow PM - Timeline scheduling (dual-track timeline, drag-drop, time blocking)

export const DragDropMixin = {
  renderDailySchedule() {
    const container = document.getElementById('cc-schedule');
    const today = this.getLocalDateString();
    const allTodayTasks = this.getAllTasks().filter(t =>
      (t.dueDate === today || t.scheduledDate === today) && t.status !== 'done'
    );

    // Separate scheduled and unscheduled tasks
    const scheduledTasks = allTodayTasks
      .filter(t => t.scheduledTime)
      .sort((a, b) => a.scheduledTime.localeCompare(b.scheduledTime));
    const unscheduledTasks = allTodayTasks.filter(t => !t.scheduledTime);

    if (allTodayTasks.length === 0) {
      container.innerHTML = `
        <div class="cc-schedule-empty">
          <p>No tasks scheduled for today</p>
          <button class="btn btn-primary" id="cc-add-to-today">Add Tasks to Today</button>
        </div>
      `;
      container.querySelector('#cc-add-to-today')?.addEventListener('click', () => {
        this.setView('master-list');
      });
      return;
    }

    // Calculate total scheduled time
    const totalScheduledMins = scheduledTasks.reduce((sum, t) => sum + (t.estimatedMinutes || 30), 0);
    const totalHours = Math.floor(totalScheduledMins / 60);
    const totalMins = totalScheduledMins % 60;

    let html = `<div class="schedule-time-slots">`;

    // Show scheduled tasks with time blocks
    if (scheduledTasks.length > 0) {
      html += `<div class="schedule-header">
        <span class="schedule-header-title">Time-Blocked (${scheduledTasks.length})</span>
        <span class="schedule-header-total">${totalHours}h ${totalMins}m</span>
      </div>`;

      scheduledTasks.forEach(task => {
        const priorityClass = task.priority !== 'none' ? `priority-${task.priority}` : '';
        const statusClass = task.status === 'in-progress' ? 'active' : '';
        const duration = task.estimatedMinutes || 30;

        // Calculate end time
        const [h, m] = task.scheduledTime.split(':').map(Number);
        const endMins = h * 60 + m + duration;
        const endH = Math.floor(endMins / 60) % 24;
        const endM = endMins % 60;
        const endTime = `${String(endH).padStart(2, '0')}:${String(endM).padStart(2, '0')}`;

        html += `
          <div class="schedule-slot scheduled ${priorityClass} ${statusClass}" data-task-id="${task.id}">
            <div class="schedule-slot-time">
              <span class="time-start">${task.scheduledTime}</span>
              <span class="time-end">${endTime}</span>
            </div>
            <div class="schedule-slot-content">
              <span class="schedule-slot-name">${this.escapeHtml(task.name)}</span>
              <span class="schedule-slot-duration">${duration}m</span>
            </div>
            <button class="schedule-slot-check" data-action="complete">✓</button>
          </div>
        `;
      });
    }

    // Show unscheduled tasks
    if (unscheduledTasks.length > 0) {
      html += `<div class="schedule-header unscheduled">
        <span class="schedule-header-title">Due Today - Unscheduled (${unscheduledTasks.length})</span>
      </div>`;

      unscheduledTasks.forEach(task => {
        const priorityClass = task.priority !== 'none' ? `priority-${task.priority}` : '';
        const statusClass = task.status === 'in-progress' ? 'active' : '';

        html += `
          <div class="schedule-slot unscheduled ${priorityClass} ${statusClass}" data-task-id="${task.id}">
            <div class="schedule-slot-time">--:--</div>
            <div class="schedule-slot-content">
              <span class="schedule-slot-name">${this.escapeHtml(task.name)}</span>
              ${task.estimatedMinutes ? `<span class="schedule-slot-duration">${task.estimatedMinutes}m</span>` : ''}
            </div>
            <button class="schedule-slot-check" data-action="complete">✓</button>
          </div>
        `;
      });
    }

    html += `</div>`;
    container.innerHTML = html;

    // Bind events
    container.querySelectorAll('.schedule-slot').forEach(slot => {
      slot.addEventListener('click', (e) => {
        if (!e.target.classList.contains('schedule-slot-check')) {
          this.openDetailPanel(slot.dataset.taskId);
        }
      });
      slot.querySelector('[data-action="complete"]')?.addEventListener('click', (e) => {
        e.stopPropagation();
        this.updateTask(slot.dataset.taskId, { status: 'done' });
        this.renderCommandCenter();
      });
    });

    // Also render the dual-track timeline
    this.renderDualTrackTimeline();
  },

  renderDualTrackTimeline() {
    const timelineBody = document.getElementById('timeline-body');
    const emptyState = document.getElementById('cc-schedule-empty');
    const timeline = document.getElementById('dual-track-timeline');
    const nowIndicator = document.getElementById('timeline-now-indicator');

    if (!timelineBody || !timeline) return;

    const today = this.getLocalDateString();
    const now = new Date();
    const currentHour = now.getHours();
    const currentMinute = now.getMinutes();

    // Get all tasks for today (scheduled or due)
    const allTodayTasks = this.getAllTasks().filter(t =>
      (t.dueDate === today || t.scheduledDate === today) && t.status !== 'done'
    );

    // Get focus queue for task picker
    const focusQueue = this.getFocusTaskQueue();

    // Always show timeline - users can click to schedule even if empty
    timeline.style.display = 'block';
    emptyState?.classList.remove('visible');

    // Build 15-MINUTE time slots from 6 AM to 10 PM
    let html = '';
    for (let hour = 6; hour <= 22; hour++) {
      for (let quarter = 0; quarter < 4; quarter++) {
        const minute = quarter * 15;
        const minuteStr = String(minute).padStart(2, '0');
        const hourStr = String(hour).padStart(2, '0');
        const timeSlot = `${hourStr}:${minuteStr}`;

        // Display format - show time label for ALL 15-minute slots
        const displayHour = hour > 12 ? hour - 12 : hour === 0 ? 12 : hour;
        const ampm = hour >= 12 ? 'PM' : 'AM';
        const displayTime = `${displayHour}:${minuteStr} ${ampm}`;

        // Determine if this slot is past or current
        const slotMinutes = hour * 60 + minute;
        const currentMinutes = currentHour * 60 + currentMinute;
        const isPast = slotMinutes + 15 <= currentMinutes;
        const isCurrent = currentMinutes >= slotMinutes && currentMinutes < slotMinutes + 15;

        // Filter function for this 15-minute slot
        const inSlot = (t) => {
          if (!t.scheduledTime) return false;
          const [h, m] = t.scheduledTime.split(':').map(Number);
          return h === hour && m >= minute && m < minute + 15;
        };

        // Slot type classes for styling
        const slotType = minute === 0 ? 'hour-start' : minute === 30 ? 'half-hour' : 'quarter-hour';
        const rowClass = `timeline-row single-track ${isCurrent ? 'current-slot' : ''} ${isPast ? 'past-slot' : ''} ${slotType}`;

        // Single track mode - all tasks in one column
        const slotTasks = allTodayTasks.filter(inSlot);

        html += `
          <div class="${rowClass}" data-hour="${hour}" data-minute="${minute}" data-time="${timeSlot}">
            <div class="timeline-time">${displayTime}</div>
            <div class="timeline-track drop-zone" data-time="${timeSlot}" data-track="schedule">
              ${this.renderTimelineTasks(slotTasks, 'schedule', isPast, isCurrent, currentMinute)}
            </div>
          </div>
        `;
      }
    }

    timelineBody.innerHTML = html;

    // Position NOW indicator
    if (currentHour >= 6 && currentHour <= 22) {
      nowIndicator?.classList.add('visible');
      // Calculate position based on current time (15-minute slots)
      const rowHeight = 36; // height of each 15-minute slot (compact)
      const headerHeight = 40; // approximate header height
      const totalQuarters = (currentHour - 6) * 4 + Math.floor(currentMinute / 15);
      const minuteWithinSlot = currentMinute % 15;
      const minuteOffset = (minuteWithinSlot / 15) * rowHeight;
      const topPosition = headerHeight + (totalQuarters * rowHeight) + minuteOffset;
      nowIndicator.style.top = `${topPosition}px`;
    } else {
      nowIndicator?.classList.remove('visible');
    }

    // Scroll to current time slot
    const currentRow = timelineBody.querySelector('.timeline-row.current-slot');
    if (currentRow) {
      currentRow.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    // Bind click and drag events for existing tasks
    timelineBody.querySelectorAll('.timeline-task').forEach(taskEl => {
      // Click to view details
      taskEl.addEventListener('click', (e) => {
        if (e.target.classList.contains('timeline-task-remove')) return;
        if (e.target.classList.contains('timeline-task-duration-select')) return;
        e.stopPropagation();
        this.showTaskQuickEdit(taskEl.dataset.taskId, taskEl);
      });

      // Drag to move task
      taskEl.addEventListener('dragstart', (e) => {
        e.stopPropagation();
        taskEl.classList.add('dragging');
        e.dataTransfer.setData('text/plain', taskEl.dataset.taskId);
        e.dataTransfer.setData('application/x-timeline-task', 'true');
        e.dataTransfer.effectAllowed = 'move';
      });

      taskEl.addEventListener('dragend', () => {
        taskEl.classList.remove('dragging');
        document.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
      });
    });

    // Bind remove button events
    timelineBody.querySelectorAll('.timeline-task-remove').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const taskId = btn.dataset.taskId;
        this.updateTask(taskId, {
          scheduledTime: null,
          scheduledDate: null
        });
        this.renderCommandCenter();
      });
    });

    // Bind duration select change
    timelineBody.querySelectorAll('.timeline-task-duration-select').forEach(selectEl => {
      selectEl.addEventListener('click', (e) => e.stopPropagation());
      selectEl.addEventListener('change', (e) => {
        e.stopPropagation();
        const taskId = selectEl.dataset.taskId;
        const newDuration = parseInt(selectEl.value);
        this.updateTask(taskId, { estimatedMinutes: newDuration });
        this.renderCommandCenter();
      });
    });

    // Bind click-to-schedule on empty track cells
    timelineBody.querySelectorAll('.timeline-track').forEach(track => {
      track.addEventListener('click', (e) => {
        // Only trigger if clicking on empty area (not on a task)
        if (e.target.classList.contains('timeline-track') ||
            e.target.classList.contains('timeline-track-empty')) {
          const time = track.dataset.time;
          const trackType = track.dataset.track;
          this.openTaskPicker(time, trackType);
        }
      });
    });

    // Bind drop zone events for drag-and-drop scheduling
    this.bindTimelineDropZones();
  },

  bindTimelineDropZones() {
    const timelineBody = document.getElementById('timeline-body');
    if (!timelineBody) return;

    // Use event delegation on the timeline body for drop events
    // This avoids issues with cloning and duplicate listeners
    timelineBody.addEventListener('dragover', (e) => {
      const dropZone = e.target.closest('.drop-zone');
      if (dropZone) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        dropZone.classList.add('drag-over');
      }
    });

    timelineBody.addEventListener('dragleave', (e) => {
      const dropZone = e.target.closest('.drop-zone');
      if (dropZone && !dropZone.contains(e.relatedTarget)) {
        dropZone.classList.remove('drag-over');
      }
    });

    timelineBody.addEventListener('drop', (e) => {
      const dropZone = e.target.closest('.drop-zone');
      if (!dropZone) return;

      e.preventDefault();
      dropZone.classList.remove('drag-over');

      const taskId = e.dataTransfer.getData('text/plain');
      const time = dropZone.dataset.time;

      if (taskId && time) {
        const today = this.getLocalDateString();
        const task = this.findTask(taskId);

        const updates = {
          scheduledTime: time,
          scheduledDate: today
        };

        // Keep existing duration if task has one
        if (!task || !task.estimatedMinutes) {
          updates.estimatedMinutes = 30;
        }

        this.updateTask(taskId, updates);
        this.renderCommandCenter();
      }
    });
  },

  openTaskPicker(time, trackType) {
    // Get unscheduled tasks from focus queue
    const unscheduledTasks = this.getFocusTaskQueue().filter(t => !t.scheduledTime);

    if (unscheduledTasks.length === 0) {
      // No tasks to schedule - could show a message or open new task modal
      alert('No unscheduled tasks available. Add some tasks first!');
      return;
    }

    // Parse time string (e.g., "09:30" or "14:00")
    const [hourStr, minuteStr] = time.split(':');
    const hour = parseInt(hourStr);
    const displayHour = hour > 12 ? hour - 12 : hour === 0 ? 12 : hour;
    const ampm = hour >= 12 ? 'PM' : 'AM';
    const displayTime = `${displayHour}:${minuteStr} ${ampm}`;

    // Create modal HTML
    const modalHtml = `
      <div class="task-picker-overlay visible" id="task-picker-overlay">
        <div class="task-picker-modal">
          <div class="task-picker-header">
            <h3>Schedule Task</h3>
            <span class="task-picker-time">${displayTime}</span>
            <button class="task-picker-close" id="task-picker-close">×</button>
          </div>
          <div class="task-picker-list">
            ${unscheduledTasks.map(task => {
              const project = this.data.projects.find(p => p.tasks.some(t => t.id === task.id));
              const projectName = project && !project.isInbox ? project.name : '';
              return `
                <div class="task-picker-item" data-task-id="${task.id}">
                  <div class="task-picker-item-priority ${task.priority || 'none'}"></div>
                  <span class="task-picker-item-name">${this.escapeHtml(task.name)}</span>
                  ${projectName ? `<span class="task-picker-item-project">${this.escapeHtml(projectName)}</span>` : ''}
                </div>
              `;
            }).join('')}
          </div>
        </div>
      </div>
    `;

    // Add to DOM
    document.body.insertAdjacentHTML('beforeend', modalHtml);

    // Bind events
    const overlay = document.getElementById('task-picker-overlay');
    const closeBtn = document.getElementById('task-picker-close');

    const closeModal = () => {
      overlay.classList.remove('visible');
      setTimeout(() => overlay.remove(), 200);
    };

    closeBtn.addEventListener('click', closeModal);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) closeModal();
    });

    // Bind task selection
    overlay.querySelectorAll('.task-picker-item').forEach(item => {
      item.addEventListener('click', () => {
        const taskId = item.dataset.taskId;
        const today = this.getLocalDateString();
        const task = this.findTask(taskId);

        const updates = {
          scheduledTime: time,
          scheduledDate: today
        };

        // Only set default duration if task doesn't have one
        if (!task || !task.estimatedMinutes) {
          updates.estimatedMinutes = 30;
        }

        this.updateTask(taskId, updates);

        closeModal();
        this.renderCommandCenter();
      });
    });

    // Close on Escape key
    document.addEventListener('keydown', function escHandler(e) {
      if (e.key === 'Escape') {
        closeModal();
        document.removeEventListener('keydown', escHandler);
      }
    });
  },

  openDurationPicker(taskId, anchorEl) {
    console.log('openDurationPicker called with taskId:', taskId);
    const task = this.findTask(taskId);
    console.log('Task found:', task);
    if (!task) {
      console.log('Task not found, returning');
      return;
    }

    const currentDuration = task.estimatedMinutes || 30;
    console.log('Current duration:', currentDuration);

    // Duration options in minutes
    const durations = [
      { label: '15m', value: 15 },
      { label: '30m', value: 30 },
      { label: '45m', value: 45 },
      { label: '1h', value: 60 },
      { label: '1.5h', value: 90 },
      { label: '2h', value: 120 },
      { label: '3h', value: 180 },
      { label: '4h', value: 240 }
    ];

    // Remove any existing picker
    document.querySelector('.duration-picker-popup')?.remove();

    // Create popup
    const popup = document.createElement('div');
    popup.className = 'duration-picker-popup';
    popup.innerHTML = `
      <div class="duration-picker-header">Duration</div>
      <div class="duration-picker-options">
        ${durations.map(d => `
          <button class="duration-option ${d.value === currentDuration ? 'active' : ''}" data-value="${d.value}">
            ${d.label}
          </button>
        `).join('')}
      </div>
      <div class="duration-picker-custom">
        <input type="number" class="duration-custom-input" placeholder="Custom" min="5" step="5" value="${currentDuration}">
        <span>min</span>
      </div>
    `;

    // Position popup near the anchor element
    const rect = anchorEl.getBoundingClientRect();
    popup.style.position = 'fixed';
    popup.style.top = `${rect.bottom + 5}px`;
    popup.style.left = `${rect.left}px`;
    popup.style.zIndex = '1000';

    document.body.appendChild(popup);

    // Handle option clicks
    popup.querySelectorAll('.duration-option').forEach(btn => {
      btn.addEventListener('click', () => {
        const value = parseInt(btn.dataset.value);
        this.updateTask(taskId, { estimatedMinutes: value });
        popup.remove();
        this.renderCommandCenter();
      });
    });

    // Handle custom input
    const customInput = popup.querySelector('.duration-custom-input');
    customInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const value = parseInt(customInput.value) || 30;
        this.updateTask(taskId, { estimatedMinutes: Math.max(5, value) });
        popup.remove();
        this.renderCommandCenter();
      }
    });

    // Close on click outside
    const closeHandler = (e) => {
      if (!popup.contains(e.target) && e.target !== anchorEl) {
        popup.remove();
        document.removeEventListener('click', closeHandler);
      }
    };
    setTimeout(() => document.addEventListener('click', closeHandler), 10);

    // Close on Escape
    const escHandler = (e) => {
      if (e.key === 'Escape') {
        popup.remove();
        document.removeEventListener('keydown', escHandler);
      }
    };
    document.addEventListener('keydown', escHandler);
  },

  renderTimelineTasks(tasks, trackType, isPast, isCurrent, currentMinute) {
    if (tasks.length === 0) {
      return '';
    }

    return tasks.map(task => {
      const duration = task.estimatedMinutes || 30;
      const priorityClass = task.priority ? `priority-${task.priority}` : '';

      // Check if this specific task is current (within its time block)
      let isCurrentTask = false;
      if (isCurrent && task.scheduledTime) {
        const [taskH, taskM] = task.scheduledTime.split(':').map(Number);
        const taskEndMin = taskM + duration;
        isCurrentTask = currentMinute >= taskM && currentMinute < taskEndMin;
      }

      const currentClass = isCurrentTask ? 'is-current' : '';
      const pastClass = isPast ? 'is-past' : '';

      // In dual-track mode, use type-based styling
      let typeClass = '';
      let icon = '';
      if (trackType === 'ai' || trackType === 'manual') {
        typeClass = task.executionType === 'hybrid' ? 'type-hybrid' : `type-${trackType}`;
        icon = task.executionType === 'ai' ? '🤖' :
               task.executionType === 'hybrid' ? '🤝' : '👤';
      } else {
        // Single track mode - use priority-based styling
        // Show execution type icon if set
        if (task.executionType === 'ai') icon = '🤖';
        else if (task.executionType === 'hybrid') icon = '🤝';
      }

      // Priority indicator dot (only in single-track mode without type styling)
      const priorityDot = (!typeClass && task.priority && task.priority !== 'none')
        ? `<span class="timeline-task-priority-dot ${task.priority}"></span>`
        : '';

      const iconHtml = icon ? `<span class="timeline-task-icon">${icon}</span>` : '';

      // Calculate height based on duration (36px per 15-min slot)
      const rowHeight = 36;
      const slots = Math.ceil(duration / 15);
      const taskHeight = (slots * rowHeight) - 4; // -4 for padding

      // Add compact class for small tasks (15-30 min)
      const compactClass = duration <= 30 ? 'compact' : '';

      return `
        <div class="timeline-task ${typeClass} ${priorityClass} ${currentClass} ${pastClass} ${compactClass}"
             data-task-id="${task.id}"
             data-duration="${duration}"
             draggable="true"
             style="height: ${taskHeight}px; min-height: ${taskHeight}px;">
          ${iconHtml}
          ${priorityDot}
          <span class="timeline-task-name">${this.escapeHtml(task.name)}</span>
          <span class="timeline-task-duration-badge">${duration}m</span>
          <select class="timeline-task-duration-select" data-task-id="${task.id}" title="Change duration">
            <option value="15" ${duration === 15 ? 'selected' : ''}>15m</option>
            <option value="30" ${duration === 30 ? 'selected' : ''}>30m</option>
            <option value="45" ${duration === 45 ? 'selected' : ''}>45m</option>
            <option value="60" ${duration === 60 ? 'selected' : ''}>1h</option>
            <option value="90" ${duration === 90 ? 'selected' : ''}>1.5h</option>
            <option value="120" ${duration === 120 ? 'selected' : ''}>2h</option>
            <option value="180" ${duration === 180 ? 'selected' : ''}>3h</option>
            <option value="240" ${duration === 240 ? 'selected' : ''}>4h</option>
          </select>
          <button class="timeline-task-remove" data-task-id="${task.id}" title="Remove from schedule">×</button>
        </div>
      `;
    }).join('');
  },

  // Task quick-edit popup for timeline
  showTaskQuickEdit(taskId, anchorEl) {
    // Remove any existing popup
    document.getElementById('task-quick-edit')?.remove();

    const task = this.findTask(taskId);
    if (!task) return;

    const rect = anchorEl.getBoundingClientRect();
    const popup = document.createElement('div');
    popup.id = 'task-quick-edit';
    popup.className = 'task-quick-edit-popup';

    // Position popup - try to keep it on screen
    const popupWidth = 280;
    const popupHeight = 320;
    let left = rect.left;
    let top = rect.bottom + 8;

    // Adjust if would go off right edge
    if (left + popupWidth > window.innerWidth - 20) {
      left = window.innerWidth - popupWidth - 20;
    }
    // Adjust if would go off bottom
    if (top + popupHeight > window.innerHeight - 20) {
      top = rect.top - popupHeight - 8;
    }

    popup.style.left = `${left}px`;
    popup.style.top = `${top}px`;

    const currentDuration = task.estimatedMinutes || 30;
    const priorities = ['none', 'low', 'medium', 'high', 'urgent'];

    popup.innerHTML = `
      <div class="quick-edit-header">
        <input type="text" class="quick-edit-name" value="${this.escapeHtml(task.name)}" id="qe-name">
        <button class="quick-edit-close" id="qe-close">×</button>
      </div>

      <div class="quick-edit-section">
        <label>Duration</label>
        <div class="quick-edit-duration-options">
          <button class="duration-opt ${currentDuration === 15 ? 'selected' : ''}" data-minutes="15">15m</button>
          <button class="duration-opt ${currentDuration === 30 ? 'selected' : ''}" data-minutes="30">30m</button>
          <button class="duration-opt ${currentDuration === 45 ? 'selected' : ''}" data-minutes="45">45m</button>
          <button class="duration-opt ${currentDuration === 60 ? 'selected' : ''}" data-minutes="60">1h</button>
          <button class="duration-opt ${currentDuration === 90 ? 'selected' : ''}" data-minutes="90">1.5h</button>
          <button class="duration-opt ${currentDuration === 120 ? 'selected' : ''}" data-minutes="120">2h</button>
        </div>
      </div>

      <div class="quick-edit-section">
        <label>Priority</label>
        <div class="quick-edit-priority-options">
          ${priorities.map(p => `
            <button class="priority-opt ${p} ${task.priority === p ? 'selected' : ''}" data-priority="${p}">
              ${p === 'none' ? '—' : p.charAt(0).toUpperCase()}
            </button>
          `).join('')}
        </div>
      </div>

      <div class="quick-edit-section">
        <label>Time</label>
        <input type="time" class="quick-edit-time" value="${task.scheduledTime || ''}" id="qe-time">
      </div>

      <div class="quick-edit-actions">
        <button class="btn btn-small btn-secondary" id="qe-unschedule">Unschedule</button>
        <button class="btn btn-small btn-secondary" id="qe-details">Full Details</button>
        <button class="btn btn-small btn-primary" id="qe-save">Save</button>
      </div>
    `;

    document.body.appendChild(popup);

    // Focus name input
    const nameInput = popup.querySelector('#qe-name');
    nameInput.focus();
    nameInput.select();

    // Bind duration options
    popup.querySelectorAll('.duration-opt').forEach(opt => {
      opt.addEventListener('click', () => {
        popup.querySelectorAll('.duration-opt').forEach(o => o.classList.remove('selected'));
        opt.classList.add('selected');
      });
    });

    // Bind priority options
    popup.querySelectorAll('.priority-opt').forEach(opt => {
      opt.addEventListener('click', () => {
        popup.querySelectorAll('.priority-opt').forEach(o => o.classList.remove('selected'));
        opt.classList.add('selected');
      });
    });

    // Close button
    popup.querySelector('#qe-close').addEventListener('click', () => popup.remove());

    // Unschedule button
    popup.querySelector('#qe-unschedule').addEventListener('click', () => {
      this.updateTask(taskId, { scheduledTime: null, scheduledDate: null });
      popup.remove();
      this.renderCommandCenter();
    });

    // Full details button
    popup.querySelector('#qe-details').addEventListener('click', () => {
      popup.remove();
      this.openDetailPanel(taskId);
    });

    // Save button
    popup.querySelector('#qe-save').addEventListener('click', () => {
      const newName = popup.querySelector('#qe-name').value.trim();
      const newTime = popup.querySelector('#qe-time').value;
      const selectedDuration = popup.querySelector('.duration-opt.selected');
      const selectedPriority = popup.querySelector('.priority-opt.selected');

      const updates = {};
      if (newName && newName !== task.name) updates.name = newName;
      if (newTime && newTime !== task.scheduledTime) updates.scheduledTime = newTime;
      if (selectedDuration) updates.estimatedMinutes = parseInt(selectedDuration.dataset.minutes);
      if (selectedPriority) updates.priority = selectedPriority.dataset.priority;

      if (Object.keys(updates).length > 0) {
        this.updateTask(taskId, updates);
      }
      popup.remove();
      this.renderCommandCenter();
    });

    // Close on Escape
    const escHandler = (e) => {
      if (e.key === 'Escape') {
        popup.remove();
        document.removeEventListener('keydown', escHandler);
      }
    };
    document.addEventListener('keydown', escHandler);

    // Close on outside click (with delay to prevent immediate close)
    setTimeout(() => {
      const clickHandler = (e) => {
        if (!popup.contains(e.target) && e.target !== anchorEl) {
          popup.remove();
          document.removeEventListener('click', clickHandler);
        }
      };
      document.addEventListener('click', clickHandler);
    }, 100);
  },

  renderTimeGrid() {
    const container = document.getElementById('time-grid-container');
    if (!container) return;

    const today = this.getLocalDateString();
    const allTasks = this.getAllTasks().filter(t =>
      (t.dueDate === today || t.scheduledDate === today) && t.status !== 'done'
    );

    // Build hour slots from 6 AM to 10 PM
    let html = '';
    for (let hour = 6; hour <= 22; hour++) {
      const hourStr = String(hour).padStart(2, '0');
      const displayHour = hour > 12 ? `${hour - 12} PM` : hour === 12 ? '12 PM' : `${hour} AM`;

      // Find tasks scheduled for this hour
      const hourTasks = allTasks.filter(t => {
        if (!t.scheduledTime) return false;
        const [h] = t.scheduledTime.split(':').map(Number);
        return h === hour;
      });

      html += `
        <div class="time-grid-slot" data-hour="${hourStr}:00">
          <div class="time-grid-hour">${displayHour}</div>
          <div class="time-grid-content" data-hour="${hourStr}">
      `;

      if (hourTasks.length > 0) {
        hourTasks.forEach(task => {
          const duration = task.estimatedMinutes || 30;
          const priorityClass = task.priority !== 'none' ? `priority-${task.priority}` : '';
          html += `
            <div class="time-grid-task ${priorityClass}" data-task-id="${task.id}" draggable="true" style="--duration: ${duration}">
              <span class="time-grid-task-name">${this.escapeHtml(task.name)}</span>
              <span class="time-grid-task-duration">${duration}m</span>
            </div>
          `;
        });
      }

      html += `</div></div>`;
    }

    container.innerHTML = html;

    // Make grid slots droppable
    container.querySelectorAll('.time-grid-content').forEach(slot => {
      slot.addEventListener('dragover', (e) => {
        e.preventDefault();
        slot.classList.add('drag-over');
      });

      slot.addEventListener('dragleave', () => {
        slot.classList.remove('drag-over');
      });

      slot.addEventListener('drop', (e) => {
        e.preventDefault();
        slot.classList.remove('drag-over');
        const taskId = e.dataTransfer.getData('text/plain');
        const hour = slot.dataset.hour;
        if (taskId && hour) {
          this.updateTask(taskId, {
            scheduledTime: `${hour}:00`,
            scheduledDate: this.getLocalDateString()
          });
          this.renderCommandCenter();
        }
      });
    });

    // Make tasks draggable
    container.querySelectorAll('.time-grid-task').forEach(taskEl => {
      taskEl.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('text/plain', taskEl.dataset.taskId);
        taskEl.classList.add('dragging');
      });

      taskEl.addEventListener('dragend', () => {
        taskEl.classList.remove('dragging');
      });

      taskEl.addEventListener('click', () => {
        this.openDetailPanel(taskEl.dataset.taskId);
      });
    });
  },

  toggleTimeGrid() {
    const gridEl = document.getElementById('cc-time-grid');
    const scheduleEl = document.getElementById('cc-schedule');
    const toggleBtn = document.getElementById('cc-toggle-grid');

    if (gridEl && scheduleEl) {
      const showGrid = gridEl.classList.contains('hidden');
      gridEl.classList.toggle('hidden', !showGrid);
      scheduleEl.classList.toggle('hidden', showGrid);

      if (toggleBtn) {
        toggleBtn.textContent = showGrid ? 'List' : 'Grid';
      }

      if (showGrid) {
        this.renderTimeGrid();
      }
    }
  },

  updateTimelineHeader() {
    // Always single-track mode - no header update needed
    const headerTracks = document.getElementById('timeline-header-tracks');
    if (headerTracks) {
      headerTracks.innerHTML = 'SCHEDULED';
    }
  },
};
