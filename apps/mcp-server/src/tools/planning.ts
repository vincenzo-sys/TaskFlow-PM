import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { DataStore } from '../data/store.js';
import { textResult, errorResult } from '../types.js';
import { generateId, todayDate, getAllTasks, findTask } from '../helpers.js';

export function registerPlanningTools(server: McpServer, store: DataStore): void {

  // ── plan_my_day ─────────────────────────────────────────────────────
  server.tool(
    'plan_my_day',
    'Generate a prioritized day plan with overdue tasks, due today, high priority, and in-progress items. Shows scheduled time blocks with start/end times.',
    {},
    async () => {
      const data = store.loadData();
      const today = todayDate();
      const tasks = getAllTasks(data).filter((t: any) => t.status !== 'done');

      const overdue = tasks.filter((t: any) => t.dueDate && t.dueDate < today);
      const dueToday = tasks.filter((t: any) => t.dueDate === today);
      const highPriority = tasks.filter(
        (t: any) => (t.priority === 'urgent' || t.priority === 'high') &&
          !dueToday.includes(t) && !overdue.includes(t)
      );
      const inProgress = tasks.filter(
        (t: any) => t.status === 'in-progress' &&
          !dueToday.includes(t) && !overdue.includes(t) && !highPriority.includes(t)
      );

      // Get scheduled tasks for today
      const scheduledToday = tasks
        .filter((t: any) => t.scheduledDate === today && t.scheduledTime)
        .sort((a: any, b: any) => a.scheduledTime.localeCompare(b.scheduledTime));

      // Helper to format a task with goal and action plan
      const formatTaskWithDetails = (t: any): string => {
        let str = `**${t.name}**`;
        if (t.priority !== 'none') str += ` !${t.priority}`;
        str += `\n`;
        str += `  ID: ${t.id}\n`;

        // Add scheduling info
        if (t.scheduledTime) {
          str += `  Scheduled: ${t.scheduledTime}`;
          if (t.estimatedMinutes) str += ` (${t.estimatedMinutes}m)`;
          str += `\n`;
        } else if (t.estimatedMinutes) {
          str += `  Estimated: ${t.estimatedMinutes}m\n`;
        }

        if (t.goal) {
          str += `  Goal: ${t.goal}\n`;
        }

        if (t.subtasks && t.subtasks.length > 0) {
          str += `  Action Plan:\n`;
          t.subtasks.forEach((st: any) => {
            str += `    ${st.status === 'done' ? 'v' : 'o'} ${st.name}\n`;
          });
        }

        if (t.timeLog && t.timeLog.length > 0) {
          const totalMins = t.timeLog.reduce((sum: number, e: any) => sum + e.minutes, 0);
          str += `  Time invested: ${Math.floor(totalMins / 60)}h ${totalMins % 60}m\n`;
        }

        return str;
      };

      let output = `## Your Day Plan\n\n`;

      // Show scheduled tasks first as a time-blocked schedule
      if (scheduledToday.length > 0) {
        output += `### Today's Schedule\n\n`;
        let totalScheduledMins = 0;
        scheduledToday.forEach((t: any) => {
          const duration = t.estimatedMinutes || 30;
          totalScheduledMins += duration;
          const [h, m] = t.scheduledTime.split(':').map(Number);
          const endMins = h * 60 + m + duration;
          const endH = Math.floor(endMins / 60) % 24;
          const endM = endMins % 60;
          const endTime = `${String(endH).padStart(2, '0')}:${String(endM).padStart(2, '0')}`;

          output += `**${t.scheduledTime} - ${endTime}** ${t.name}`;
          if (t.priority !== 'none') output += ` !${t.priority}`;
          output += `\n`;
          output += `  ID: ${t.id}\n\n`;
        });
        const schedH = Math.floor(totalScheduledMins / 60);
        const schedM = totalScheduledMins % 60;
        output += `Total scheduled: ${schedH}h ${schedM}m\n\n`;
      }

      if (overdue.length > 0) {
        output += `### Overdue - Handle First\n\n`;
        overdue.forEach((t: any) => {
          output += formatTaskWithDetails(t);
          output += `  Was due: ${t.dueDate}\n\n`;
        });
      }

      // Filter out already-scheduled tasks from due today
      const unscheduledDueToday = dueToday.filter((t: any) => !t.scheduledTime);
      if (unscheduledDueToday.length > 0) {
        output += `### Due Today (Unscheduled)\n\n`;
        unscheduledDueToday.forEach((t: any) => {
          output += formatTaskWithDetails(t) + `\n`;
        });
      }

      if (highPriority.length > 0) {
        output += `### High Priority\n\n`;
        highPriority.slice(0, 3).forEach((t: any) => {
          output += formatTaskWithDetails(t) + `\n`;
        });
      }

      if (inProgress.length > 0) {
        output += `### Continue Working On\n\n`;
        inProgress.slice(0, 3).forEach((t: any) => {
          output += formatTaskWithDetails(t) + `\n`;
        });
      }

      const totalForToday = overdue.length + dueToday.length + Math.min(highPriority.length, 3);
      output += `---\n`;
      output += `**Suggested focus:** ${totalForToday} tasks for today\n`;

      // Calculate total estimated time
      const allDayTasks = [...overdue, ...dueToday, ...highPriority.slice(0, 3)];
      const totalEstMins = allDayTasks.reduce((sum: number, t: any) => sum + (t.estimatedMinutes || 30), 0);
      const estH = Math.floor(totalEstMins / 60);
      const estM = totalEstMins % 60;
      output += `**Estimated time:** ~${estH}h ${estM}m\n`;

      if (totalForToday === 0) {
        output += `\nNo urgent tasks! Consider:\n`;
        output += `- Working on upcoming deadlines\n`;
        output += `- Tackling low-priority items\n`;
        output += `- Planning future projects\n`;
      }

      return textResult(output);
    }
  );

  // ── get_planning_context ────────────────────────────────────────────
  server.tool(
    'get_planning_context',
    'Get planning context for a date: overdue tasks, yesterday incomplete, unscheduled high-priority, already scheduled, and available time budget.',
    {
      date: z.string().optional().describe('Target date YYYY-MM-DD (default: today)'),
    },
    async (args) => {
      const data = store.loadData();
      const targetDate = args.date || todayDate();
      const tasks = getAllTasks(data);
      const yesterday = new Date(targetDate);
      yesterday.setDate(yesterday.getDate() - 1);
      const yesterdayStr = yesterday.toISOString().split('T')[0];

      // Overdue tasks
      const overdue = tasks.filter((t: any) =>
        t.status !== 'done' && t.dueDate && t.dueDate < targetDate
      ).sort((a: any, b: any) => a.dueDate.localeCompare(b.dueDate));

      // Unscheduled high-priority
      const unscheduledHighPriority = tasks.filter((t: any) =>
        t.status !== 'done' &&
        !t.scheduledTime &&
        (t.priority === 'urgent' || t.priority === 'high')
      );

      // Yesterday's incomplete (were scheduled but not done)
      const yesterdayIncomplete = tasks.filter((t: any) =>
        t.status !== 'done' &&
        t.scheduledDate === yesterdayStr
      );

      // Already scheduled for target date
      const alreadyScheduled = tasks.filter((t: any) =>
        t.scheduledDate === targetDate && t.scheduledTime && t.status !== 'done'
      ).sort((a: any, b: any) => a.scheduledTime.localeCompare(b.scheduledTime));

      // Calculate available time (9-18 = 9 hours = 540 min)
      const scheduledMinutes = alreadyScheduled.reduce((sum: number, t: any) => sum + (t.estimatedMinutes || 30), 0);
      const availableMinutes = 540 - scheduledMinutes;

      let output = `## Planning Context for ${targetDate}\n\n`;

      if (overdue.length > 0) {
        output += `### Overdue Tasks (${overdue.length})\n`;
        overdue.forEach((t: any) => {
          output += `- **${t.name}** (due: ${t.dueDate}) [ID: ${t.id}]\n`;
        });
        output += `\n`;
      }

      if (yesterdayIncomplete.length > 0) {
        output += `### Incomplete from Yesterday (${yesterdayIncomplete.length})\n`;
        yesterdayIncomplete.forEach((t: any) => {
          output += `- **${t.name}** [ID: ${t.id}]\n`;
        });
        output += `\n`;
      }

      if (unscheduledHighPriority.length > 0) {
        output += `### High Priority - Unscheduled (${unscheduledHighPriority.length})\n`;
        unscheduledHighPriority.forEach((t: any) => {
          output += `- **${t.name}** [${t.priority}] [ID: ${t.id}]\n`;
        });
        output += `\n`;
      }

      if (alreadyScheduled.length > 0) {
        output += `### Already Scheduled (${alreadyScheduled.length})\n`;
        alreadyScheduled.forEach((t: any) => {
          output += `- ${t.scheduledTime}: **${t.name}** (${t.estimatedMinutes || 30}m)\n`;
        });
        output += `\n`;
      }

      output += `### Time Budget\n`;
      output += `- Scheduled: ${Math.floor(scheduledMinutes / 60)}h ${scheduledMinutes % 60}m\n`;
      output += `- Available: ${Math.floor(availableMinutes / 60)}h ${availableMinutes % 60}m\n`;

      return textResult(output);
    }
  );

  // ── get_dependency_graph ────────────────────────────────────────────
  server.tool(
    'get_dependency_graph',
    'Visualize task dependency chains. Shows blocked, blocking, and ready tasks.',
    {
      projectId: z.string().optional().describe('Filter to a specific project'),
    },
    async (args) => {
      const data = store.loadData();
      const tasks = getAllTasks(data);
      let projectTasks = tasks;

      if (args.projectId) {
        projectTasks = tasks.filter((t: any) => t.projectId === args.projectId);
      }

      // Find tasks with dependencies
      const withDeps = projectTasks.filter((t: any) =>
        (t.blockedBy && t.blockedBy.length > 0) || (t.blocks && t.blocks.length > 0)
      );

      if (withDeps.length === 0) {
        return textResult('No task dependencies found.');
      }

      let output = '## Task Dependency Graph\n\n';

      // Build adjacency visualization
      const taskMap = new Map(tasks.map((t: any) => [t.id, t]));

      // Group by status
      const blocked = withDeps.filter((t: any) =>
        t.blockedBy && t.blockedBy.some((id: string) => {
          const blocker = taskMap.get(id);
          return blocker && blocker.status !== 'done';
        })
      );

      const blocking = withDeps.filter((t: any) =>
        t.blocks && t.blocks.length > 0 && t.status !== 'done'
      );

      const ready = withDeps.filter((t: any) =>
        (!t.blockedBy || t.blockedBy.length === 0 ||
          t.blockedBy.every((id: string) => {
            const blocker = taskMap.get(id);
            return !blocker || blocker.status === 'done';
          })) &&
        t.status !== 'done'
      );

      output += `### Status Summary\n`;
      output += `- Ready to start: ${ready.length}\n`;
      output += `- Currently blocked: ${blocked.length}\n`;
      output += `- Blocking others: ${blocking.length}\n\n`;

      output += `### Dependency Chains\n\n`;

      for (const task of withDeps) {
        if (task.status === 'done') continue;

        const statusEmoji = blocked.includes(task) ? '[BLOCKED]' : blocking.includes(task) ? '[BLOCKING]' : '[READY]';
        output += `${statusEmoji} **${task.name}**`;
        if (task.projectName) output += ` [${task.projectName}]`;
        output += `\n`;

        if (task.blockedBy && task.blockedBy.length > 0) {
          output += `   Blocked by:\n`;
          task.blockedBy.forEach((id: string) => {
            const blocker = taskMap.get(id);
            if (blocker) {
              const blockerStatus = blocker.status === 'done' ? 'v' : 'o';
              output += `   ${blockerStatus} ${blocker.name}\n`;
            }
          });
        }

        if (task.blocks && task.blocks.length > 0) {
          output += `   Blocks:\n`;
          task.blocks.forEach((id: string) => {
            const blockedTask = taskMap.get(id);
            if (blockedTask) {
              output += `   -> ${blockedTask.name}\n`;
            }
          });
        }

        output += `\n`;
      }

      return textResult(output);
    }
  );

  // ── add_task_dependency ─────────────────────────────────────────────
  server.tool(
    'add_task_dependency',
    'Add a dependency between two tasks. The first task will be blocked by the second.',
    {
      taskId: z.string().describe('ID of the task that will be blocked'),
      blockedByTaskId: z.string().describe('ID of the task that blocks it'),
    },
    async (args) => {
      if (args.taskId === args.blockedByTaskId) {
        return errorResult('A task cannot block itself');
      }

      const data = store.loadData();

      const taskResult = findTask(data, args.taskId);
      const blockerResult = findTask(data, args.blockedByTaskId);

      if (!taskResult) {
        return errorResult(`Task ${args.taskId} not found`);
      }
      if (!blockerResult) {
        return errorResult(`Blocker task ${args.blockedByTaskId} not found`);
      }

      const task = taskResult.task;
      const blocker = blockerResult.task;

      // Initialize arrays if needed
      if (!Array.isArray(task.blockedBy)) task.blockedBy = [];
      if (!Array.isArray(blocker.blocks)) blocker.blocks = [];

      // Check for circular dependency
      const visited = new Set<string>();
      const stack = [args.blockedByTaskId];
      while (stack.length > 0) {
        const currentId = stack.pop()!;
        if (currentId === args.taskId) {
          return errorResult('This would create a circular dependency');
        }
        if (visited.has(currentId)) continue;
        visited.add(currentId);

        const current = findTask(data, currentId);
        if (current && Array.isArray(current.task.blockedBy)) {
          stack.push(...current.task.blockedBy);
        }
      }

      // Check if already exists
      if (task.blockedBy.includes(args.blockedByTaskId)) {
        return textResult(`Dependency already exists: "${blocker.name}" blocks "${task.name}"`);
      }

      // Add the dependency
      task.blockedBy.push(args.blockedByTaskId);
      blocker.blocks.push(args.taskId);
      store.saveData(data);

      return textResult(
        `Dependency created!\n\n"${task.name}" is now blocked by "${blocker.name}"\n\nThe blocked task cannot start until the blocker is completed.`
      );
    }
  );

  // ── remove_task_dependency ──────────────────────────────────────────
  server.tool(
    'remove_task_dependency',
    'Remove a dependency between two tasks.',
    {
      taskId: z.string().describe('ID of the blocked task'),
      blockedByTaskId: z.string().describe('ID of the blocker task to remove'),
    },
    async (args) => {
      const data = store.loadData();

      const taskResult = findTask(data, args.taskId);
      const blockerResult = findTask(data, args.blockedByTaskId);

      if (!taskResult) {
        return errorResult(`Task ${args.taskId} not found`);
      }

      const task = taskResult.task;

      // Remove from blockedBy
      if (Array.isArray(task.blockedBy)) {
        task.blockedBy = task.blockedBy.filter((id: string) => id !== args.blockedByTaskId);
      }

      // Remove from blocks
      if (blockerResult && Array.isArray(blockerResult.task.blocks)) {
        blockerResult.task.blocks = blockerResult.task.blocks.filter((id: string) => id !== args.taskId);
      }

      store.saveData(data);

      return textResult(
        `Dependency removed! "${task.name}" is no longer blocked by "${blockerResult?.task.name || args.blockedByTaskId}"`
      );
    }
  );

  // ── suggest_task_order ──────────────────────────────────────────────
  server.tool(
    'suggest_task_order',
    'Suggest optimal task execution order based on dependencies, priorities, and due dates using topological sort.',
    {
      projectId: z.string().optional().describe('Filter to a specific project'),
      includeCompleted: z.boolean().optional().describe('Include completed tasks (default: false)'),
    },
    async (args) => {
      const data = store.loadData();
      const tasks = getAllTasks(data);
      let projectTasks = tasks;

      if (args.projectId) {
        projectTasks = tasks.filter((t: any) => t.projectId === args.projectId);
      }

      // Filter to active tasks unless includeCompleted
      if (!args.includeCompleted) {
        projectTasks = projectTasks.filter((t: any) => t.status !== 'done');
      }

      if (projectTasks.length === 0) {
        return textResult('No tasks found to order.');
      }

      const taskMap = new Map(projectTasks.map((t: any) => [t.id, t]));

      // Topological sort based on dependencies
      const visited = new Set<string>();
      const sorted: any[] = [];

      function visit(taskId: string): void {
        if (visited.has(taskId)) return;
        visited.add(taskId);

        const task = taskMap.get(taskId);
        if (!task) return;

        // Visit blockers first
        if (task.blockedBy) {
          for (const blockerId of task.blockedBy) {
            if (taskMap.has(blockerId)) {
              visit(blockerId);
            }
          }
        }

        sorted.push(task);
      }

      // Start with tasks that aren't blocked
      const unblocked = projectTasks.filter((t: any) =>
        !t.blockedBy || t.blockedBy.length === 0 ||
        t.blockedBy.every((id: string) => !taskMap.has(id))
      );

      unblocked.forEach((t: any) => visit(t.id));

      // Visit remaining
      projectTasks.forEach((t: any) => {
        if (!visited.has(t.id)) visit(t.id);
      });

      // Now sort by priority and due date within unblocked groups
      const priorityOrder: Record<string, number> = { urgent: 0, high: 1, medium: 2, low: 3, none: 4 };

      sorted.sort((a: any, b: any) => {
        // Check if one blocks the other
        if (a.blockedBy?.includes(b.id)) return 1;
        if (b.blockedBy?.includes(a.id)) return -1;

        // Then by priority
        const aPri = priorityOrder[a.priority] ?? 4;
        const bPri = priorityOrder[b.priority] ?? 4;
        if (aPri !== bPri) return aPri - bPri;

        // Then by due date
        if (a.dueDate && b.dueDate) return a.dueDate.localeCompare(b.dueDate);
        if (a.dueDate) return -1;
        if (b.dueDate) return 1;

        return 0;
      });

      let output = '## Suggested Task Order\n\n';
      output += 'Based on dependencies, priorities, and due dates:\n\n';

      sorted.forEach((task: any, idx: number) => {
        const isBlocked = task.blockedBy?.some((id: string) => {
          const blocker = taskMap.get(id);
          return blocker && blocker.status !== 'done';
        });

        const statusIcon = isBlocked ? '[BLOCKED]' : task.status === 'done' ? '[DONE]' : `${idx + 1}.`;

        output += `${statusIcon} **${task.name}**`;
        if (task.priority && task.priority !== 'none') output += ` [${task.priority}]`;
        if (task.dueDate) output += ` (due: ${task.dueDate})`;
        if (task.projectName) output += ` [${task.projectName}]`;
        if (isBlocked) output += ' <- Blocked';
        output += `\n`;
      });

      output += `\n---\n`;
      output += `**Total:** ${sorted.length} tasks\n`;
      output += `**Ready now:** ${sorted.filter((t: any) =>
        !t.blockedBy?.some((id: string) => {
          const blocker = taskMap.get(id);
          return blocker && blocker.status !== 'done';
        })
      ).length}\n`;

      return textResult(output);
    }
  );
}
