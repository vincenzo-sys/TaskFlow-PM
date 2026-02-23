import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { DataStore } from '../data/store.js';
import { textResult, errorResult } from '../types.js';
import { generateId, todayDate, getAllTasks, findTask, formatTaskForDisplay, formatDate } from '../helpers.js';

const PRIORITY_ORDER: Record<string, number> = {
  urgent: 0,
  high: 1,
  medium: 2,
  low: 3,
  none: 4,
};

export function registerViewTools(server: McpServer, store: DataStore): void {

  // -- get_today_tasks ------------------------------------------------------
  server.tool(
    'get_today_tasks',
    'Get all tasks scheduled or due today that are not yet done.',
    {},
    async () => {
      const data = store.loadData();
      const today = todayDate();
      const tasks = getAllTasks(data).filter(
        (t: any) =>
          t.status !== 'done' &&
          (t.dueDate === today || t.scheduledDate === today)
      );

      if (tasks.length === 0) {
        return textResult('No tasks scheduled or due today.');
      }

      tasks.sort((a: any, b: any) => (PRIORITY_ORDER[a.priority] ?? 4) - (PRIORITY_ORDER[b.priority] ?? 4));

      const lines = tasks.map((t: any) => {
        let line = `- [${t.id}] ${t.name}`;
        if (t.priority && t.priority !== 'none') line += ` !${t.priority}`;
        if (t.scheduledTime) line += ` @ ${t.scheduledTime}`;
        if (t.estimatedMinutes) line += ` (${t.estimatedMinutes}m)`;
        if (t.projectName) line += ` [${t.projectName}]`;
        return line;
      });

      return textResult(`## Today's Tasks (${tasks.length})\n\n${lines.join('\n')}`);
    }
  );

  // -- get_overdue_tasks ----------------------------------------------------
  server.tool(
    'get_overdue_tasks',
    'Get all tasks with a due date before today that are not done. Sorted by due date ascending.',
    {},
    async () => {
      const data = store.loadData();
      const today = todayDate();
      const tasks = getAllTasks(data).filter(
        (t: any) => t.status !== 'done' && t.dueDate && t.dueDate < today
      );

      if (tasks.length === 0) {
        return textResult('No overdue tasks. You are all caught up!');
      }

      tasks.sort((a: any, b: any) => (a.dueDate as string).localeCompare(b.dueDate as string));

      const lines = tasks.map((t: any) => {
        let line = `- [${t.id}] ${t.name} (due: ${t.dueDate})`;
        if (t.priority && t.priority !== 'none') line += ` !${t.priority}`;
        if (t.projectName) line += ` [${t.projectName}]`;
        return line;
      });

      return textResult(`## Overdue Tasks (${tasks.length})\n\n${lines.join('\n')}`);
    }
  );

  // -- get_upcoming_tasks ---------------------------------------------------
  server.tool(
    'get_upcoming_tasks',
    'Get tasks due within the next N days (default 7). Excludes completed tasks.',
    {
      days: z.number().optional().describe('Number of days to look ahead. Default: 7'),
    },
    async (args) => {
      const data = store.loadData();
      const today = todayDate();
      const lookAhead = args.days ?? 7;
      const endDate = formatDate(new Date(Date.now() + lookAhead * 86400000));

      const tasks = getAllTasks(data).filter(
        (t: any) =>
          t.status !== 'done' &&
          t.dueDate &&
          t.dueDate >= today &&
          t.dueDate <= endDate
      );

      if (tasks.length === 0) {
        return textResult(`No tasks due in the next ${lookAhead} days.`);
      }

      tasks.sort((a: any, b: any) => (a.dueDate as string).localeCompare(b.dueDate as string));

      const lines = tasks.map((t: any) => {
        let line = `- [${t.id}] ${t.name} (due: ${t.dueDate})`;
        if (t.priority && t.priority !== 'none') line += ` !${t.priority}`;
        if (t.projectName) line += ` [${t.projectName}]`;
        return line;
      });

      return textResult(`## Upcoming Tasks - Next ${lookAhead} Days (${tasks.length})\n\n${lines.join('\n')}`);
    }
  );

  // -- get_projects ---------------------------------------------------------
  server.tool(
    'get_projects',
    'Get all projects with task counts and metadata.',
    {},
    async () => {
      const data = store.loadData();

      const projects = data.projects.map((p: any) => {
        const activeTasks = p.tasks.filter((t: any) => t.status !== 'done').length;
        return {
          id: p.id,
          name: p.name,
          description: p.description || '',
          color: p.color || '#6366f1',
          totalTasks: p.tasks.length,
          activeTasks,
          isInbox: p.isInbox || p.id === 'inbox',
        };
      });

      return textResult(JSON.stringify(projects, null, 2));
    }
  );

  // -- get_focus_task -------------------------------------------------------
  server.tool(
    'get_focus_task',
    'Get the single most important task to focus on right now, scored by urgency, due date, priority, and status.',
    {},
    async () => {
      const data = store.loadData();
      const today = todayDate();
      const tasks = getAllTasks(data).filter((t: any) => t.status !== 'done');

      if (tasks.length === 0) {
        return textResult('No active tasks. Enjoy the free time!');
      }

      // Score each task
      const scored = tasks.map((t: any) => {
        let score = 0;
        if (t.dueDate && t.dueDate < today) score += 100;      // overdue
        if (t.dueDate === today) score += 50;                   // due today
        if (t.priority === 'urgent') score += 40;
        if (t.priority === 'high') score += 30;
        if (t.status === 'in-progress') score += 20;
        if (t.priority === 'medium') score += 10;
        return { ...t, _score: score };
      });

      scored.sort((a: any, b: any) => b._score - a._score);
      const top = scored[0];

      const project = data.projects.find((p: any) => p.id === top.projectId);
      let output = `## Focus Task\n\n`;
      output += `**${top.name}**\n`;
      output += `- ID: ${top.id}\n`;
      output += `- Project: ${project?.name || 'Inbox'}\n`;
      output += `- Priority: ${top.priority || 'none'}\n`;
      output += `- Status: ${top.status}\n`;
      if (top.dueDate) output += `- Due: ${top.dueDate}${top.dueDate < today ? ' (OVERDUE)' : ''}\n`;
      if (top.estimatedMinutes) output += `- Estimated: ${top.estimatedMinutes}m\n`;
      if (top.description) output += `- Description: ${top.description}\n`;

      if (top.subtasks && top.subtasks.length > 0) {
        const done = top.subtasks.filter((st: any) => st.status === 'done').length;
        output += `\n### Subtasks (${done}/${top.subtasks.length})\n`;
        for (const st of top.subtasks) {
          output += `- [${st.status === 'done' ? 'x' : ' '}] ${st.name}\n`;
        }
      }

      output += `\n_Score: ${top._score} (higher = more urgent)_`;
      return textResult(output);
    }
  );

  // -- get_inbox_tasks ------------------------------------------------------
  server.tool(
    'get_inbox_tasks',
    'Get all active tasks in the Inbox project, with context preview for brain dumps.',
    {},
    async () => {
      const data = store.loadData();
      const inbox = data.projects.find((p: any) => p.isInbox || p.id === 'inbox');

      if (!inbox) {
        return textResult('No Inbox project found.');
      }

      const tasks = inbox.tasks.filter((t: any) => t.status !== 'done');

      if (tasks.length === 0) {
        return textResult('Inbox is empty. All tasks have been processed or completed.');
      }

      const lines = tasks.map((t: any) => {
        let line = `- [${t.id}] ${t.name}`;
        if (t.priority && t.priority !== 'none') line += ` !${t.priority}`;
        if (t.dueDate) line += ` (due: ${t.dueDate})`;
        if (t.context) {
          const preview = t.context.length > 200 ? t.context.substring(0, 200) + '...' : t.context;
          line += `\n  Context: ${preview}`;
        }
        return line;
      });

      return textResult(`## Inbox (${tasks.length} tasks)\n\n${lines.join('\n')}`);
    }
  );

  // -- get_working_on_task --------------------------------------------------
  server.tool(
    'get_working_on_task',
    'Get full details of the task(s) currently being worked on (the active/focus tasks).',
    {},
    async () => {
      const data = store.loadData();

      // Support both array (new) and single ID (legacy) formats
      let taskIds: string[] = [];
      if (Array.isArray(data.workingOnTaskIds) && data.workingOnTaskIds.length > 0) {
        taskIds = data.workingOnTaskIds;
      } else if (data.workingOnTaskId) {
        taskIds = [data.workingOnTaskId];
      }

      if (taskIds.length === 0) {
        return textResult('No task currently set as "Working On". Use the app UI or set_working_on_task to pick one.');
      }

      const sections: string[] = [];

      for (const id of taskIds) {
        const result = findTask(data, id);
        if (!result) {
          sections.push(`- [${id}] Task not found (may have been deleted)`);
          continue;
        }

        const { task, project } = result;
        let output = `### ${task.name}\n`;
        output += `- ID: ${task.id}\n`;
        output += `- Project: ${project?.name || 'Unknown'}\n`;
        output += `- Status: ${task.status}\n`;
        output += `- Priority: ${task.priority || 'none'}\n`;
        if (task.description) output += `- Description: ${task.description}\n`;
        if (task.context) output += `- Context/Brain Dump: ${task.context}\n`;
        if (task.workNotes) output += `- Work Notes: ${task.workNotes}\n`;
        if (task.dueDate) output += `- Due: ${task.dueDate}\n`;
        if (task.scheduledTime) output += `- Scheduled: ${task.scheduledTime}\n`;
        if (task.estimatedMinutes) output += `- Estimated: ${task.estimatedMinutes}m\n`;
        if (task.executionType) output += `- Execution: ${task.executionType}\n`;

        if (task.subtasks && task.subtasks.length > 0) {
          const done = task.subtasks.filter((st: any) => st.status === 'done').length;
          output += `\n**Subtasks (${done}/${task.subtasks.length}):**\n`;
          for (const st of task.subtasks) {
            output += `  - [${st.status === 'done' ? 'x' : ' '}] ${st.name}`;
            if (st.estimatedMinutes) output += ` (${st.estimatedMinutes}m)`;
            output += '\n';
          }
        }

        sections.push(output);
      }

      return textResult(`## Currently Working On (${taskIds.length})\n\n${sections.join('\n---\n\n')}`);
    }
  );

  // -- get_ready_tasks ------------------------------------------------------
  server.tool(
    'get_ready_tasks',
    'Get tasks that are ready to work on. With highPriorityOnly, returns a scored ranking of all active tasks.',
    {
      projectName: z.string().optional().describe('Filter by project name'),
      highPriorityOnly: z.boolean().optional().describe('If true, score and rank all active tasks by urgency/priority instead of filtering by "ready" status'),
      limit: z.number().optional().describe('Maximum number of tasks to return'),
    },
    async (args) => {
      const data = store.loadData();
      const today = todayDate();

      if (args.highPriorityOnly) {
        // Score all active tasks
        let tasks = getAllTasks(data).filter((t: any) => t.status !== 'done');

        if (args.projectName) {
          tasks = tasks.filter((t: any) =>
            t.projectName?.toLowerCase().includes(args.projectName!.toLowerCase())
          );
        }

        const scored = tasks.map((t: any) => {
          let score = 0;
          // Scheduled today with time gets highest score + time-based bonus
          if (t.scheduledDate === today && t.scheduledTime) {
            score += 200;
            // Earlier time = higher bonus (09:00 gets +14, 23:00 gets +0)
            const hour = parseInt(t.scheduledTime.split(':')[0], 10);
            score += Math.max(0, 23 - hour);
          }
          if (t.dueDate && t.dueDate < today) score += 100;  // overdue
          if (t.dueDate === today) score += 50;               // due today
          if (t.priority === 'urgent') score += 40;
          if (t.priority === 'high') score += 30;
          if (t.status === 'in-progress') score += 20;
          if (t.priority === 'medium') score += 10;
          if (t.status === 'ready') score += 5;
          return { ...t, _score: score };
        });

        scored.sort((a: any, b: any) => b._score - a._score);

        const limited = args.limit ? scored.slice(0, args.limit) : scored;

        if (limited.length === 0) {
          return textResult('No active tasks found.');
        }

        const lines = limited.map((t: any, i: number) => {
          let line = `${i + 1}. [${t.id}] ${t.name} (score: ${t._score})`;
          if (t.priority && t.priority !== 'none') line += ` !${t.priority}`;
          if (t.dueDate) line += ` due:${t.dueDate}`;
          if (t.scheduledTime) line += ` @${t.scheduledTime}`;
          if (t.projectName) line += ` [${t.projectName}]`;
          return line;
        });

        return textResult(`## Priority-Ranked Tasks (${limited.length})\n\n${lines.join('\n')}`);
      }

      // Standard: filter by 'ready' status
      let tasks = getAllTasks(data).filter((t: any) => t.status === 'ready');

      if (args.projectName) {
        tasks = tasks.filter((t: any) =>
          t.projectName?.toLowerCase().includes(args.projectName!.toLowerCase())
        );
      }

      tasks.sort((a: any, b: any) => (PRIORITY_ORDER[a.priority] ?? 4) - (PRIORITY_ORDER[b.priority] ?? 4));

      if (args.limit) {
        tasks = tasks.slice(0, args.limit);
      }

      if (tasks.length === 0) {
        return textResult('No tasks with status "ready" found.');
      }

      const lines = tasks.map((t: any) => {
        let line = `- [${t.id}] ${t.name}`;
        if (t.priority && t.priority !== 'none') line += ` !${t.priority}`;
        if (t.dueDate) line += ` (due: ${t.dueDate})`;
        if (t.projectName) line += ` [${t.projectName}]`;
        return line;
      });

      return textResult(`## Ready Tasks (${tasks.length})\n\n${lines.join('\n')}`);
    }
  );

  // -- get_calendar_view ----------------------------------------------------
  server.tool(
    'get_calendar_view',
    'Get a calendar view of tasks for a date range, showing due, completed, and time-logged tasks per day.',
    {
      startDate: z.string().optional().describe('Start date (YYYY-MM-DD). Default: first day of current month.'),
      endDate: z.string().optional().describe('End date (YYYY-MM-DD). Default: last day of current month.'),
    },
    async (args) => {
      const data = store.loadData();
      const now = new Date();

      // Default to current month
      const start = args.startDate || formatDate(new Date(now.getFullYear(), now.getMonth(), 1));
      const end = args.endDate || formatDate(new Date(now.getFullYear(), now.getMonth() + 1, 0));

      const allTasks = getAllTasks(data);

      // Build day-by-day map
      const calendar: Record<string, { due: any[]; completed: any[]; timeLogged: number }> = {};

      // Initialize all days in range
      const current = new Date(start + 'T00:00:00');
      const endDt = new Date(end + 'T00:00:00');
      while (current <= endDt) {
        calendar[formatDate(current)] = { due: [], completed: [], timeLogged: 0 };
        current.setDate(current.getDate() + 1);
      }

      for (const task of allTasks) {
        // Track completed tasks by completedAt date
        if (task.completedAt) {
          const completedDay = task.completedAt.split('T')[0];
          if (calendar[completedDay]) {
            calendar[completedDay].completed.push(task);
          }
        }

        // Track due tasks (not done) by dueDate
        if (task.dueDate && task.status !== 'done' && calendar[task.dueDate]) {
          calendar[task.dueDate].due.push(task);
        }

        // Track time logged from timeLog entries
        if (task.timeLog && Array.isArray(task.timeLog)) {
          for (const entry of task.timeLog) {
            const logDay = entry.date || (entry.startedAt ? entry.startedAt.split('T')[0] : null);
            if (logDay && calendar[logDay] && entry.minutes) {
              calendar[logDay].timeLogged += entry.minutes;
            }
          }
        }
      }

      // Format output
      let output = `## Calendar: ${start} to ${end}\n\n`;

      for (const [day, info] of Object.entries(calendar)) {
        const dayOfWeek = new Date(day + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short' });
        const hasTasks = info.due.length > 0 || info.completed.length > 0 || info.timeLogged > 0;

        if (!hasTasks) continue;

        output += `### ${dayOfWeek} ${day}\n`;

        if (info.completed.length > 0) {
          output += `  Completed (${info.completed.length}):`;
          for (const t of info.completed) {
            output += `\n    - [x] ${t.name}`;
          }
          output += '\n';
        }

        if (info.due.length > 0) {
          output += `  Due (${info.due.length}):`;
          for (const t of info.due) {
            let line = `\n    - [ ] ${t.name}`;
            if (t.priority && t.priority !== 'none') line += ` !${t.priority}`;
            output += line;
          }
          output += '\n';
        }

        if (info.timeLogged > 0) {
          output += `  Time logged: ${info.timeLogged}m\n`;
        }

        output += '\n';
      }

      // Summary stats
      const totalDue = Object.values(calendar).reduce((sum, d) => sum + d.due.length, 0);
      const totalCompleted = Object.values(calendar).reduce((sum, d) => sum + d.completed.length, 0);
      const totalTime = Object.values(calendar).reduce((sum, d) => sum + d.timeLogged, 0);

      output += `---\n**Summary:** ${totalDue} tasks due, ${totalCompleted} completed`;
      if (totalTime > 0) output += `, ${totalTime}m logged`;

      return textResult(output);
    }
  );

  // -- get_task_context -----------------------------------------------------
  server.tool(
    'get_task_context',
    'Get full context and details for a specific task including description, brain dump, subtasks, learnings, and time investment.',
    {
      taskId: z.string().describe('ID of the task to get context for'),
    },
    async (args) => {
      const data = store.loadData();
      const result = findTask(data, args.taskId);

      if (!result) {
        return errorResult(`Task ${args.taskId} not found`);
      }

      const { task, project } = result;

      let output = `## Task Context: ${task.name}\n\n`;
      output += `- **ID:** ${task.id}\n`;
      output += `- **Status:** ${task.status}\n`;
      output += `- **Priority:** ${task.priority || 'none'}\n`;
      if (task.dueDate) output += `- **Due:** ${task.dueDate}\n`;
      output += `- **Project:** ${project?.name || 'Unknown'}\n`;
      if (task.executionType) output += `- **Execution type:** ${task.executionType}\n`;

      if (task.description) {
        output += `\n### Description\n${task.description}\n`;
      }

      if (task.context) {
        output += `\n### Brain Dump / Context\n${task.context}\n`;
      }

      if (task.goal) {
        output += `\n### Goal\n${task.goal}\n`;
      }

      if (task.subtasks && task.subtasks.length > 0) {
        const done = task.subtasks.filter((st: any) => st.status === 'done').length;
        output += `\n### Subtasks (${done}/${task.subtasks.length} complete)\n`;
        for (const st of task.subtasks) {
          output += `- [${st.status === 'done' ? 'x' : ' '}] ${st.name}`;
          if (st.estimatedMinutes) output += ` (${st.estimatedMinutes}m)`;
          output += '\n';
        }
      }

      if (task.learnings) {
        output += `\n### Learnings\n${task.learnings}\n`;
      }

      // Calculate time invested from timeLog or estimatedMinutes
      let timeInvested = 0;
      if (task.timeLog && Array.isArray(task.timeLog)) {
        timeInvested = task.timeLog.reduce((sum: number, entry: any) => sum + (entry.minutes || 0), 0);
      }
      if (timeInvested > 0) {
        const hours = Math.floor(timeInvested / 60);
        const mins = timeInvested % 60;
        output += `\n### Time Invested\n${hours > 0 ? `${hours}h ` : ''}${mins}m\n`;
      } else if (task.estimatedMinutes) {
        output += `\n### Estimated Time\n${task.estimatedMinutes}m (no time logged yet)\n`;
      }

      return textResult(output);
    }
  );
}
