import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { DataStore } from '../data/store.js';
import { textResult, errorResult } from '../types.js';
import { generateId, todayDate, getAllTasks, findTask } from '../helpers.js';

export function registerUtilitiesTools(server: McpServer, store: DataStore): void {

  // ── append_context ──────────────────────────────────────────────────
  server.tool(
    'append_context',
    'Append additional context or notes to a task. Timestamps each addition and separates with dividers.',
    {
      taskId: z.string().describe('ID of the task to add context to'),
      context: z.string().describe('The context text to append'),
    },
    async (args) => {
      const data = await store.loadData();
      const result = findTask(data, args.taskId);
      if (!result) {
        return errorResult(`Task ${args.taskId} not found`);
      }

      const { task } = result;
      const timestamp = new Date().toLocaleString();
      const newContext = task.context
        ? `${task.context}\n\n---\n[Added ${timestamp}]\n${args.context}`
        : args.context;

      task.context = newContext;
      await store.saveData(data);

      return textResult(`Added context to "${task.name}"`);
    }
  );

  // ── delete_all_completed ────────────────────────────────────────────
  server.tool(
    'delete_all_completed',
    'Permanently delete all completed tasks and subtasks. Optionally filter by project name.',
    {
      projectName: z.string().optional().describe('Filter to a specific project name. If omitted, deletes from all projects.'),
    },
    async (args) => {
      const data = await store.loadData();
      let deletedCount = 0;
      const projectFilter = args.projectName?.toLowerCase();

      for (const project of data.projects) {
        if (projectFilter && project.name.toLowerCase() !== projectFilter) {
          continue;
        }

        const beforeCount = project.tasks.length;
        project.tasks = project.tasks.filter((t: any) => t.status !== 'done');
        deletedCount += beforeCount - project.tasks.length;

        // Also clean up completed subtasks
        for (const task of project.tasks) {
          if (task.subtasks) {
            const subtasksBefore = task.subtasks.length;
            task.subtasks = task.subtasks.filter((st: any) => st.status !== 'done');
            deletedCount += subtasksBefore - task.subtasks.length;
          }
        }
      }

      await store.saveData(data);

      const scopeMsg = projectFilter ? ` from "${args.projectName}"` : '';
      return textResult(`Deleted ${deletedCount} completed tasks${scopeMsg}`);
    }
  );

  // ── set_blocker ─────────────────────────────────────────────────────
  server.tool(
    'set_blocker',
    'Mark a task as blocked with detailed blocker information including type, description, and follow-up tracking.',
    {
      taskId: z.string().describe('ID of the task to block'),
      type: z.enum(['person', 'external', 'dependency', 'resource', 'decision']).describe('Type of blocker'),
      description: z.string().describe('Description of what is blocking the task'),
      expectedResolution: z.string().optional().describe('When the blocker is expected to be resolved'),
      followUpDate: z.string().optional().describe('Date to follow up on the blocker (YYYY-MM-DD)'),
      contactInfo: z.string().optional().describe('Contact info for the person/entity related to the blocker'),
    },
    async (args) => {
      const data = await store.loadData();
      const result = findTask(data, args.taskId);
      if (!result) {
        return errorResult(`Task ${args.taskId} not found`);
      }

      const { task } = result;
      task.status = 'waiting';
      task.blockerInfo = {
        type: args.type,
        description: args.description,
        blockedSince: new Date().toISOString(),
        expectedResolution: args.expectedResolution || null,
        followUpDate: args.followUpDate || null,
        contactInfo: args.contactInfo || null,
        notes: [],
      };

      await store.saveData(data);

      let output = `## Blocker Set\n\n`;
      output += `**Task:** ${task.name}\n`;
      output += `**Type:** ${args.type}\n`;
      output += `**Reason:** ${args.description}\n`;
      if (args.expectedResolution) output += `**Expected Resolution:** ${args.expectedResolution}\n`;
      if (args.followUpDate) output += `**Follow-up Date:** ${args.followUpDate}\n`;
      if (args.contactInfo) output += `**Contact:** ${args.contactInfo}\n`;

      return textResult(output);
    }
  );

  // ── get_blockers_summary ────────────────────────────────────────────
  server.tool(
    'get_blockers_summary',
    'Get a summary of all blocked/waiting tasks, grouped by blocker type with age indicators (critical >14d, warning 7-14d, recent).',
    {
      includeResolved: z.boolean().optional().describe('Include tasks with resolved blockers. Default: false.'),
    },
    async (args) => {
      const data = await store.loadData();
      const tasks = getAllTasks(data);
      let blocked = tasks.filter((t: any) =>
        t.status === 'waiting' || t.blockerInfo?.type
      );

      if (!args.includeResolved) {
        blocked = blocked.filter((t: any) => !t.blockerInfo?.resolvedAt);
      }

      if (blocked.length === 0) {
        return textResult('No blocked tasks! All clear.');
      }

      const now = new Date();
      const getAgeDays = (task: any): number => {
        const since = task.blockerInfo?.blockedSince || task.createdAt;
        if (!since) return 0;
        return Math.floor((now.getTime() - new Date(since).getTime()) / (1000 * 60 * 60 * 24));
      };

      // Group by type
      const byType: Record<string, any[]> = {};
      blocked.forEach((t: any) => {
        const type = t.blockerInfo?.type || 'unspecified';
        if (!byType[type]) byType[type] = [];
        byType[type].push(t);
      });

      let output = `## Blockers Summary\n\n`;
      output += `**Total Blocked:** ${blocked.length}\n`;
      output += `**Critical (>14d):** ${blocked.filter((t: any) => getAgeDays(t) > 14).length}\n`;
      output += `**Warning (7-14d):** ${blocked.filter((t: any) => getAgeDays(t) > 7 && getAgeDays(t) <= 14).length}\n\n`;

      for (const [type, typeTasks] of Object.entries(byType)) {
        output += `### ${type.charAt(0).toUpperCase() + type.slice(1)} (${typeTasks.length})\n\n`;
        typeTasks.forEach((t: any) => {
          const age = getAgeDays(t);
          const ageLabel = age > 14 ? 'CRITICAL' : age > 7 ? 'Warning' : 'Recent';
          output += `**${t.name}** - ${ageLabel} (${age}d)\n`;
          output += `  ID: ${t.id}\n`;
          if (t.blockerInfo?.description) {
            output += `  Reason: ${t.blockerInfo.description}\n`;
          }
          if (t.blockerInfo?.followUpDate) {
            output += `  Follow-up: ${t.blockerInfo.followUpDate}\n`;
          }
          output += `\n`;
        });
      }

      return textResult(output);
    }
  );

  // ── clear_blocker ───────────────────────────────────────────────────
  server.tool(
    'clear_blocker',
    'Clear a blocker on a task, setting its status back to ready. Optionally record a resolution note.',
    {
      taskId: z.string().describe('ID of the blocked task'),
      resolution: z.string().optional().describe('Description of how the blocker was resolved'),
    },
    async (args) => {
      const data = await store.loadData();
      const result = findTask(data, args.taskId);
      if (!result) {
        return errorResult(`Task ${args.taskId} not found`);
      }

      const { task } = result;
      task.status = 'ready';

      if (task.blockerInfo) {
        task.blockerInfo.resolvedAt = new Date().toISOString();
        if (args.resolution) {
          task.blockerInfo.notes = task.blockerInfo.notes || [];
          task.blockerInfo.notes.push({
            date: new Date().toISOString(),
            note: `RESOLVED: ${args.resolution}`,
          });
        }
      }

      await store.saveData(data);

      return textResult(`Blocker cleared for "${task.name}". Task is now ready.`);
    }
  );

  // ── log_follow_up ───────────────────────────────────────────────────
  server.tool(
    'log_follow_up',
    'Log a follow-up note on a blocked task and optionally update the next follow-up date.',
    {
      taskId: z.string().describe('ID of the blocked task'),
      note: z.string().describe('Follow-up note to record'),
      newFollowUpDate: z.string().optional().describe('New follow-up date (YYYY-MM-DD)'),
    },
    async (args) => {
      const data = await store.loadData();
      const result = findTask(data, args.taskId);
      if (!result) {
        return errorResult(`Task ${args.taskId} not found`);
      }

      const { task } = result;
      if (!task.blockerInfo) {
        task.blockerInfo = { notes: [] };
      }
      if (!task.blockerInfo.notes) {
        task.blockerInfo.notes = [];
      }

      task.blockerInfo.notes.push({
        date: new Date().toISOString(),
        note: args.note,
      });

      if (args.newFollowUpDate) {
        task.blockerInfo.followUpDate = args.newFollowUpDate;
      }

      await store.saveData(data);

      return textResult(`Follow-up logged for "${task.name}": ${args.note}`);
    }
  );
}
