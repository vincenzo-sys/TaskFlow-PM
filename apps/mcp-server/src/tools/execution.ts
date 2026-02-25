import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { DataStore } from '../data/store.js';
import { textResult, errorResult } from '../types.js';
import { generateId, todayDate, getAllTasks, findTask } from '../helpers.js';

export function registerExecutionTools(server: McpServer, store: DataStore): void {

  // ── set_execution_type ──────────────────────────────────────────────
  server.tool(
    'set_execution_type',
    'Set who executes a task: AI (Claude autonomous), manual (human), or hybrid (collaborative).',
    {
      taskId: z.string().describe('Task ID'),
      executionType: z.enum(['ai', 'manual', 'hybrid']).describe('Execution type: ai, manual, or hybrid'),
    },
    async (args) => {
      const data = await store.loadData();

      const result = findTask(data, args.taskId);
      if (!result) {
        return errorResult(`Task ${args.taskId} not found`);
      }

      const { task } = result;
      task.executionType = args.executionType;
      await store.saveData(data);

      const typeLabels: Record<string, string> = {
        ai: 'AI (Claude can do autonomously)',
        manual: 'Manual (requires your action)',
        hybrid: 'Hybrid (collaborative)',
      };

      return textResult(`Updated "${task.name}" execution type to: ${typeLabels[args.executionType]}`);
    }
  );

  // ── get_parallel_schedule ───────────────────────────────────────────
  server.tool(
    'get_parallel_schedule',
    'View the dual-track parallel schedule for a date: Claude track (AI tasks), your track (manual tasks), and collaborative tasks.',
    {
      date: z.string().optional().describe('Target date YYYY-MM-DD (default: today)'),
    },
    async (args) => {
      const data = await store.loadData();
      const targetDate = args.date || todayDate();
      const tasks = getAllTasks(data).filter((t: any) =>
        t.status !== 'done' &&
        (t.scheduledDate === targetDate || t.dueDate === targetDate)
      );

      // Separate by execution type
      const aiTasks = tasks.filter((t: any) => t.executionType === 'ai')
        .sort((a: any, b: any) => (a.scheduledTime || '99:99').localeCompare(b.scheduledTime || '99:99'));
      const manualTasks = tasks.filter((t: any) => !t.executionType || t.executionType === 'manual')
        .sort((a: any, b: any) => (a.scheduledTime || '99:99').localeCompare(b.scheduledTime || '99:99'));
      const hybridTasks = tasks.filter((t: any) => t.executionType === 'hybrid')
        .sort((a: any, b: any) => (a.scheduledTime || '99:99').localeCompare(b.scheduledTime || '99:99'));

      let output = `## Parallel Schedule for ${targetDate}\n\n`;

      // AI Track
      output += `### CLAUDE TRACK\n`;
      if (aiTasks.length === 0) {
        output += `_No AI tasks scheduled_\n\n`;
      } else {
        aiTasks.forEach((t: any) => {
          const time = t.scheduledTime || 'Unscheduled';
          const duration = t.estimatedMinutes ? `(${t.estimatedMinutes}m)` : '';
          output += `- **${time}** ${t.name} ${duration}\n`;
          output += `  ID: ${t.id}\n`;
        });
        output += `\n`;
      }

      // Manual Track
      output += `### YOUR TRACK\n`;
      if (manualTasks.length === 0) {
        output += `_No manual tasks scheduled_\n\n`;
      } else {
        manualTasks.forEach((t: any) => {
          const time = t.scheduledTime || 'Unscheduled';
          const duration = t.estimatedMinutes ? `(${t.estimatedMinutes}m)` : '';
          output += `- **${time}** ${t.name} ${duration}\n`;
          output += `  ID: ${t.id}\n`;
        });
        output += `\n`;
      }

      // Hybrid Track
      if (hybridTasks.length > 0) {
        output += `### COLLABORATIVE TRACK\n`;
        hybridTasks.forEach((t: any) => {
          const time = t.scheduledTime || 'Unscheduled';
          const duration = t.estimatedMinutes ? `(${t.estimatedMinutes}m)` : '';
          output += `- **${time}** ${t.name} ${duration}\n`;
          output += `  ID: ${t.id}\n`;
        });
        output += `\n`;
      }

      // Summary
      const totalAiMins = aiTasks.reduce((sum: number, t: any) => sum + (t.estimatedMinutes || 30), 0);
      const totalManualMins = manualTasks.reduce((sum: number, t: any) => sum + (t.estimatedMinutes || 30), 0);

      output += `---\n`;
      output += `**Summary:**\n`;
      output += `- Claude track: ${aiTasks.length} tasks, ~${Math.floor(totalAiMins / 60)}h ${totalAiMins % 60}m\n`;
      output += `- Your track: ${manualTasks.length} tasks, ~${Math.floor(totalManualMins / 60)}h ${totalManualMins % 60}m\n`;
      output += `- Collaborative: ${hybridTasks.length} tasks\n`;

      return textResult(output);
    }
  );

  // ── assign_task ─────────────────────────────────────────────────────
  server.tool(
    'assign_task',
    'Assign a task or subtask to Claude, user, or unassign it.',
    {
      taskId: z.string().describe('Task or subtask ID'),
      assignTo: z.enum(['claude', 'user', 'none']).describe('Who to assign to: claude, user, or none'),
    },
    async (args) => {
      const data = await store.loadData();

      const result = findTask(data, args.taskId);
      if (!result) {
        return errorResult(`Task ${args.taskId} not found`);
      }

      const { task, parentTask } = result;
      const assignValue = args.assignTo === 'none' ? null : args.assignTo;
      task.assignedTo = assignValue;

      await store.saveData(data);

      const taskType = parentTask ? 'Subtask' : 'Task';
      const assignedLabel = assignValue ? `to ${assignValue}` : '(unassigned)';
      return textResult(`${taskType} "${task.name}" assigned ${assignedLabel}`);
    }
  );

  // ── get_claude_tasks ────────────────────────────────────────────────
  server.tool(
    'get_claude_tasks',
    'Get all tasks and subtasks assigned to Claude with full context (descriptions, brain dumps, subtask lists).',
    {
      todayOnly: z.boolean().optional().describe('Only show tasks scheduled/due today (default: false)'),
    },
    async (args) => {
      const data = await store.loadData();
      const todayOnly = args.todayOnly || false;
      const today = todayDate();
      const claudeTasks: any[] = [];

      for (const project of data.projects) {
        for (const task of project.tasks) {
          // Check if main task is assigned to Claude
          if (task.assignedTo === 'claude' && task.status !== 'done') {
            // Apply todayOnly filter
            if (todayOnly && task.scheduledDate !== today && task.dueDate !== today) {
              continue;
            }

            // Get subtasks assigned to Claude for this task
            const claudeSubtasks = (task.subtasks || [])
              .filter((st: any) => st.assignedTo === 'claude' && st.status !== 'done')
              .map((st: any) => st.name);

            claudeTasks.push({
              type: 'task',
              id: task.id,
              name: task.name,
              description: task.description || '',
              context: task.context || '',
              priority: task.priority,
              dueDate: task.dueDate,
              scheduledDate: task.scheduledDate,
              scheduledTime: task.scheduledTime,
              estimatedMinutes: task.estimatedMinutes,
              projectName: project.name,
              subtasks: task.subtasks ? task.subtasks.map((st: any) => ({
                name: st.name,
                status: st.status,
                assignedTo: st.assignedTo,
              })) : [],
              claudeSubtasks,
            });
          }

          // Check subtasks assigned to Claude (where parent task is NOT assigned to Claude)
          if (task.subtasks && task.assignedTo !== 'claude') {
            for (const subtask of task.subtasks) {
              if (subtask.assignedTo === 'claude' && subtask.status !== 'done') {
                // Apply todayOnly filter based on parent task
                if (todayOnly && task.scheduledDate !== today && task.dueDate !== today) {
                  continue;
                }

                claudeTasks.push({
                  type: 'subtask',
                  id: subtask.id,
                  name: subtask.name,
                  parentTask: {
                    id: task.id,
                    name: task.name,
                    description: task.description || '',
                    context: task.context || '',
                    priority: task.priority,
                    dueDate: task.dueDate,
                    scheduledDate: task.scheduledDate,
                    allSubtasks: task.subtasks.map((st: any) => ({
                      name: st.name,
                      status: st.status,
                      assignedTo: st.assignedTo,
                    })),
                  },
                  projectName: project.name,
                });
              }
            }
          }
        }
      }

      if (claudeTasks.length === 0) {
        const filterNote = todayOnly ? ' for today' : '';
        return textResult(`No tasks assigned to Claude${filterNote}.`);
      }

      const filterNote = todayOnly ? ' (Today Only)' : '';
      let output = `## Claude's Tasks${filterNote} (${claudeTasks.length})\n\n`;

      for (const item of claudeTasks) {
        if (item.type === 'task') {
          output += `### TASK: ${item.name}\n`;
          output += `**ID:** ${item.id}\n`;
          output += `**Project:** ${item.projectName}\n`;
          if (item.priority && item.priority !== 'none') output += `**Priority:** ${item.priority}\n`;
          if (item.dueDate) output += `**Due:** ${item.dueDate}\n`;
          if (item.scheduledDate) output += `**Scheduled:** ${item.scheduledDate}${item.scheduledTime ? ' at ' + item.scheduledTime : ''}\n`;
          if (item.estimatedMinutes) output += `**Estimated:** ${item.estimatedMinutes} minutes\n`;
          output += `\n`;
          if (item.description) output += `**Description:**\n${item.description}\n\n`;
          if (item.context) output += `**Context/Brain Dump:**\n${item.context}\n\n`;
          if (item.subtasks && item.subtasks.length > 0) {
            output += `**Subtasks:**\n`;
            for (const st of item.subtasks) {
              const status = st.status === 'done' ? 'v' : 'o';
              const assignee = st.assignedTo ? ` [${st.assignedTo}]` : '';
              output += `- ${status} ${st.name}${assignee}\n`;
            }
            output += `\n`;
          }
          output += `---\n\n`;
        } else {
          output += `### SUBTASK: ${item.name}\n`;
          output += `**ID:** ${item.id}\n`;
          output += `**Project:** ${item.projectName}\n`;
          output += `\n**Parent Task:** ${item.parentTask.name}\n`;
          if (item.parentTask.priority && item.parentTask.priority !== 'none') output += `**Parent Priority:** ${item.parentTask.priority}\n`;
          if (item.parentTask.dueDate) output += `**Parent Due:** ${item.parentTask.dueDate}\n`;
          output += `\n`;
          if (item.parentTask.description) output += `**Parent Description:**\n${item.parentTask.description}\n\n`;
          if (item.parentTask.context) output += `**Parent Context/Brain Dump:**\n${item.parentTask.context}\n\n`;
          if (item.parentTask.allSubtasks && item.parentTask.allSubtasks.length > 0) {
            output += `**All Subtasks in Parent:**\n`;
            for (const st of item.parentTask.allSubtasks) {
              const status = st.status === 'done' ? 'v' : 'o';
              const assignee = st.assignedTo ? ` [${st.assignedTo}]` : '';
              const isCurrent = st.name === item.name ? ' <- THIS ONE' : '';
              output += `- ${status} ${st.name}${assignee}${isCurrent}\n`;
            }
            output += `\n`;
          }
          output += `---\n\n`;
        }
      }

      return textResult(output);
    }
  );

  // ── set_waiting_reason ──────────────────────────────────────────────
  server.tool(
    'set_waiting_reason',
    'Set a waiting reason for a task and automatically change its status to waiting.',
    {
      taskId: z.string().describe('Task ID'),
      reason: z.string().describe('Why the task is waiting'),
      blockedBy: z.string().optional().describe('What or who is blocking this task'),
    },
    async (args) => {
      const data = await store.loadData();

      const result = findTask(data, args.taskId);
      if (!result) {
        return errorResult(`Task ${args.taskId} not found`);
      }

      const { task } = result;
      task.waitingReason = args.reason;
      if (args.blockedBy) {
        task.blockedBy = args.blockedBy;
      }

      // Automatically set status to waiting if not already
      if (task.status !== 'waiting') {
        task.status = 'waiting';
      }

      await store.saveData(data);

      let output = `Updated "${task.name}":\n`;
      output += `- Status: waiting\n`;
      output += `- Reason: ${args.reason}\n`;
      if (args.blockedBy) {
        output += `- Blocked by: ${args.blockedBy}\n`;
      }

      return textResult(output);
    }
  );
}
