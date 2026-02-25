import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { DataStore } from '../data/store.js';
import { textResult, errorResult } from '../types.js';
import { generateId, todayDate, getAllTasks, findTask } from '../helpers.js';

export function registerTimeGoalsTools(server: McpServer, store: DataStore): void {

  // ── log_time ────────────────────────────────────────────────────────
  server.tool(
    'log_time',
    'Log time spent working on a task. Tracks cumulative time with notes per entry.',
    {
      taskId: z.string().describe('ID of the task to log time for'),
      minutes: z.number().describe('Number of minutes to log'),
      notes: z.string().optional().describe('Optional notes about what was done during this time'),
    },
    async (args) => {
      const data = await store.loadData();
      const result = findTask(data, args.taskId);
      if (!result) {
        return errorResult(`Task ${args.taskId} not found`);
      }

      const { task } = result;
      if (!task.timeLog) task.timeLog = [];

      const entry = {
        id: generateId(),
        minutes: args.minutes,
        notes: args.notes || '',
        loggedAt: new Date().toISOString(),
      };

      task.timeLog.push(entry);
      await store.saveData(data);

      const totalMinutes = task.timeLog.reduce((sum: number, e: any) => sum + e.minutes, 0);
      const hours = Math.floor(totalMinutes / 60);
      const mins = totalMinutes % 60;

      return textResult(`Logged ${args.minutes} min on "${task.name}"\nTotal time: ${hours}h ${mins}m`);
    }
  );

  // ── set_task_goal ───────────────────────────────────────────────────
  server.tool(
    'set_task_goal',
    'Set a goal or success criteria for a task. Helps define what "done" looks like.',
    {
      taskId: z.string().describe('ID of the task'),
      goal: z.string().describe('The goal or success criteria for this task'),
    },
    async (args) => {
      const data = await store.loadData();
      const result = findTask(data, args.taskId);
      if (!result) {
        return errorResult(`Task ${args.taskId} not found`);
      }

      result.task.goal = args.goal;
      await store.saveData(data);

      return textResult(`Set goal for "${result.task.name}":\n"${args.goal}"`);
    }
  );

  // ── add_learning ────────────────────────────────────────────────────
  server.tool(
    'add_learning',
    'Record a learning or insight from working on a task. Useful for retrospectives and knowledge capture.',
    {
      taskId: z.string().describe('ID of the task'),
      learning: z.string().describe('The learning or insight to record'),
    },
    async (args) => {
      const data = await store.loadData();
      const result = findTask(data, args.taskId);
      if (!result) {
        return errorResult(`Task ${args.taskId} not found`);
      }

      const { task } = result;
      if (!task.learnings) task.learnings = [];

      task.learnings.push({
        id: generateId(),
        text: args.learning,
        addedAt: new Date().toISOString(),
      });

      await store.saveData(data);

      return textResult(`Added learning to "${task.name}":\n"${args.learning}"`);
    }
  );
}
