import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { DataStore } from '../data/store.js';
import { textResult, errorResult } from '../types.js';
import { generateId, todayDate, getAllTasks, findTask, formatTaskForDisplay } from '../helpers.js';

const TIME_REGEX = /^([01]?[0-9]|2[0-3]):([0-5][0-9])$/;

function addMinutesToTime(time: string, minutes: number): string {
  const [h, m] = time.split(':').map(Number);
  const totalMinutes = h * 60 + m + minutes;
  const endH = Math.floor(totalMinutes / 60) % 24;
  const endM = totalMinutes % 60;
  return `${String(endH).padStart(2, '0')}:${String(endM).padStart(2, '0')}`;
}

export function registerSchedulingTools(server: McpServer, store: DataStore): void {

  // -- set_scheduled_time ---------------------------------------------------
  server.tool(
    'set_scheduled_time',
    'Schedule a task for a specific time. Sets the scheduled time, date, and optionally the estimated duration.',
    {
      taskId: z.string().describe('ID of the task to schedule'),
      scheduledTime: z.string().describe('Time to schedule in HH:MM format (e.g., "09:00", "14:30")'),
      scheduledDate: z.string().optional().describe('Date to schedule on (YYYY-MM-DD). Defaults to today.'),
      estimatedMinutes: z.number().optional().describe('Estimated duration in minutes (e.g., 15, 30, 60)'),
    },
    async (args) => {
      if (!TIME_REGEX.test(args.scheduledTime)) {
        return errorResult(
          `Invalid time format "${args.scheduledTime}". Use HH:MM (e.g., "09:00", "14:30").`
        );
      }

      const data = store.loadData();
      const result = findTask(data, args.taskId);
      if (!result) {
        return errorResult(`Task ${args.taskId} not found`);
      }

      const { task } = result;
      const today = todayDate();
      const date = args.scheduledDate || today;

      task.scheduledTime = args.scheduledTime;
      task.scheduledDate = date;

      if (args.estimatedMinutes !== undefined) {
        task.estimatedMinutes = args.estimatedMinutes;
      }

      // If no due date, set it to the scheduled date
      if (!task.dueDate) {
        task.dueDate = date;
      }

      task.updatedAt = new Date().toISOString();
      store.saveData(data);

      let response = `Scheduled "${task.name}" at ${args.scheduledTime} on ${date}`;
      if (args.estimatedMinutes) {
        const endTime = addMinutesToTime(args.scheduledTime, args.estimatedMinutes);
        response += ` (${args.estimatedMinutes}m, ends ~${endTime})`;
      }

      return textResult(response);
    }
  );

  // -- get_scheduled_tasks --------------------------------------------------
  server.tool(
    'get_scheduled_tasks',
    'Get all tasks scheduled for a specific date with their time blocks, sorted chronologically.',
    {
      date: z.string().optional().describe('Date to check (YYYY-MM-DD). Defaults to today.'),
    },
    async (args) => {
      const data = store.loadData();
      const date = args.date || todayDate();

      const tasks = getAllTasks(data).filter(
        (t: any) =>
          t.scheduledDate === date &&
          t.scheduledTime &&
          t.status !== 'done'
      );

      if (tasks.length === 0) {
        return textResult(`No tasks scheduled for ${date}.`);
      }

      tasks.sort((a: any, b: any) => a.scheduledTime.localeCompare(b.scheduledTime));

      let totalMinutes = 0;
      const lines = tasks.map((t: any) => {
        let line = `- ${t.scheduledTime}`;
        if (t.estimatedMinutes) {
          const endTime = addMinutesToTime(t.scheduledTime, t.estimatedMinutes);
          line += `-${endTime}`;
          totalMinutes += t.estimatedMinutes;
        }
        line += ` [${t.id}] ${t.name}`;
        if (t.priority && t.priority !== 'none') line += ` !${t.priority}`;
        if (t.projectName) line += ` [${t.projectName}]`;
        return line;
      });

      let output = `## Scheduled Tasks for ${date} (${tasks.length})\n\n${lines.join('\n')}`;

      if (totalMinutes > 0) {
        const hours = Math.floor(totalMinutes / 60);
        const mins = totalMinutes % 60;
        output += `\n\n**Total scheduled time:** ${hours > 0 ? `${hours}h ` : ''}${mins}m`;
      }

      return textResult(output);
    }
  );

  // -- clear_scheduled_time -------------------------------------------------
  server.tool(
    'clear_scheduled_time',
    'Remove the scheduled time and date from a task, keeping the task itself.',
    {
      taskId: z.string().describe('ID of the task to unschedule'),
    },
    async (args) => {
      const data = store.loadData();
      const result = findTask(data, args.taskId);
      if (!result) {
        return errorResult(`Task ${args.taskId} not found`);
      }

      const { task } = result;
      const prevTime = task.scheduledTime;
      const prevDate = task.scheduledDate;

      delete task.scheduledTime;
      delete task.scheduledDate;
      task.updatedAt = new Date().toISOString();

      store.saveData(data);

      let response = `Cleared schedule for "${task.name}"`;
      if (prevTime && prevDate) {
        response += ` (was ${prevTime} on ${prevDate})`;
      }

      return textResult(response);
    }
  );

  // -- bulk_schedule_today --------------------------------------------------
  server.tool(
    'bulk_schedule_today',
    'Schedule multiple tasks for today in one call. Useful for planning the entire day at once.',
    {
      schedule: z.array(
        z.object({
          taskId: z.string().describe('ID of the task to schedule'),
          scheduledTime: z.string().describe('Time in HH:MM format'),
          estimatedMinutes: z.number().optional().describe('Duration in minutes'),
        })
      ).describe('Array of tasks to schedule with their times'),
    },
    async (args) => {
      const data = store.loadData();
      const today = todayDate();

      const results: string[] = [];
      const errors: string[] = [];

      for (const entry of args.schedule) {
        // Validate time format
        if (!TIME_REGEX.test(entry.scheduledTime)) {
          errors.push(`[${entry.taskId}] Invalid time "${entry.scheduledTime}"`);
          continue;
        }

        const result = findTask(data, entry.taskId);
        if (!result) {
          errors.push(`[${entry.taskId}] Task not found`);
          continue;
        }

        const { task } = result;
        task.scheduledTime = entry.scheduledTime;
        task.scheduledDate = today;

        if (entry.estimatedMinutes !== undefined) {
          task.estimatedMinutes = entry.estimatedMinutes;
        }

        // Set due date if not already set
        if (!task.dueDate) {
          task.dueDate = today;
        }

        task.updatedAt = new Date().toISOString();

        let line = `${entry.scheduledTime} - ${task.name}`;
        if (entry.estimatedMinutes) {
          const endTime = addMinutesToTime(entry.scheduledTime, entry.estimatedMinutes);
          line += ` (${entry.estimatedMinutes}m, ends ~${endTime})`;
        }
        results.push(line);
      }

      store.saveData(data);

      let output = `## Bulk Schedule for ${today}\n\n`;

      if (results.length > 0) {
        output += `**Scheduled (${results.length}):**\n${results.map((r) => `- ${r}`).join('\n')}\n`;
      }

      if (errors.length > 0) {
        output += `\n**Errors (${errors.length}):**\n${errors.map((e) => `- ${e}`).join('\n')}\n`;
      }

      // Calculate total scheduled time
      let totalMinutes = 0;
      for (const entry of args.schedule) {
        if (entry.estimatedMinutes && TIME_REGEX.test(entry.scheduledTime)) {
          totalMinutes += entry.estimatedMinutes;
        }
      }
      if (totalMinutes > 0) {
        const hours = Math.floor(totalMinutes / 60);
        const mins = totalMinutes % 60;
        output += `\n**Total time blocked:** ${hours > 0 ? `${hours}h ` : ''}${mins}m`;
      }

      return textResult(output);
    }
  );
}
