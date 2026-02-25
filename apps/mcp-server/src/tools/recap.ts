import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { DataStore } from '../data/store.js';
import { textResult, errorResult } from '../types.js';
import { generateId, todayDate, getAllTasks, findTask } from '../helpers.js';

export function registerRecapTools(server: McpServer, store: DataStore): void {

  // ── daily_recap ─────────────────────────────────────────────────────
  server.tool(
    'daily_recap',
    'Generate a daily recap with completed tasks, time invested, and learnings for a given date.',
    {
      date: z.string().optional().describe('Date to recap YYYY-MM-DD (default: today)'),
    },
    async (args) => {
      const data = await store.loadData();
      const targetDate = args.date || todayDate();
      const allTasks = getAllTasks(data);

      // Completed tasks on that date
      const completed = allTasks.filter((t: any) => {
        if (t.status !== 'done' || !t.completedAt) return false;
        return t.completedAt.split('T')[0] === targetDate;
      });

      // Time logged that day
      let totalMinutesLogged = 0;
      const timeEntries: Array<{ taskName: string; minutes: number; notes: string }> = [];
      for (const task of allTasks) {
        if (!task.timeLog) continue;
        for (const entry of task.timeLog) {
          if (entry.loggedAt && entry.loggedAt.split('T')[0] === targetDate) {
            totalMinutesLogged += entry.minutes;
            timeEntries.push({
              taskName: task.name,
              minutes: entry.minutes,
              notes: entry.notes || '',
            });
          }
        }
      }

      // Learnings added that day
      const learnings: Array<{ taskName: string; text: string }> = [];
      for (const task of allTasks) {
        if (!task.learnings) continue;
        for (const learning of task.learnings) {
          if (learning.addedAt && learning.addedAt.split('T')[0] === targetDate) {
            learnings.push({ taskName: task.name, text: learning.text });
          }
        }
      }

      let output = `## Daily Recap: ${targetDate}\n\n`;

      // Accomplishments
      output += `### Accomplishments (${completed.length} tasks completed)\n\n`;
      if (completed.length === 0) {
        output += `_No tasks completed on this date._\n\n`;
      } else {
        for (const task of completed) {
          const priority = task.priority && task.priority !== 'none' ? ` !${task.priority}` : '';
          const project = task.projectName ? ` [${task.projectName}]` : '';
          output += `- [x] ${task.name}${priority}${project}\n`;
        }
        output += `\n`;
      }

      // Time invested
      const hours = Math.floor(totalMinutesLogged / 60);
      const mins = totalMinutesLogged % 60;
      output += `### Time Invested: ${hours}h ${mins}m\n\n`;
      if (timeEntries.length === 0) {
        output += `_No time logged on this date._\n\n`;
      } else {
        for (const entry of timeEntries) {
          output += `- **${entry.taskName}**: ${entry.minutes}m`;
          if (entry.notes) output += ` - ${entry.notes}`;
          output += `\n`;
        }
        output += `\n`;
      }

      // Learnings
      output += `### What We Learned (${learnings.length})\n\n`;
      if (learnings.length === 0) {
        output += `_No learnings recorded on this date._\n\n`;
      } else {
        for (const l of learnings) {
          output += `- **${l.taskName}**: ${l.text}\n`;
        }
        output += `\n`;
      }

      return textResult(output);
    }
  );

  // ── weekly_review ───────────────────────────────────────────────────
  server.tool(
    'weekly_review',
    'Generate a weekly review: summary, accomplishments, time by project, learnings, and items needing attention.',
    {},
    async () => {
      const data = await store.loadData();
      const today = new Date();
      const weekAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
      const startDate = weekAgo.toISOString().split('T')[0];
      const endDate = today.toISOString().split('T')[0];
      const allTasks = getAllTasks(data);

      // Completed tasks in range
      const completed = allTasks.filter((t: any) => {
        if (t.status !== 'done' || !t.completedAt) return false;
        const date = t.completedAt.split('T')[0];
        return date >= startDate && date <= endDate;
      });

      // Time by project
      const timeByProject: Record<string, number> = {};
      for (const task of allTasks) {
        if (!task.timeLog) continue;
        for (const entry of task.timeLog) {
          if (entry.loggedAt) {
            const date = entry.loggedAt.split('T')[0];
            if (date >= startDate && date <= endDate) {
              const projectName = task.projectName || 'Inbox';
              timeByProject[projectName] = (timeByProject[projectName] || 0) + entry.minutes;
            }
          }
        }
      }

      // Learnings in range
      const learnings: Array<{ taskName: string; text: string }> = [];
      for (const task of allTasks) {
        if (!task.learnings) continue;
        for (const learning of task.learnings) {
          if (learning.addedAt) {
            const date = learning.addedAt.split('T')[0];
            if (date >= startDate && date <= endDate) {
              learnings.push({ taskName: task.name, text: learning.text });
            }
          }
        }
      }

      // Active and overdue
      const active = allTasks.filter((t: any) => t.status !== 'done');
      const overdue = allTasks.filter((t: any) => {
        if (t.status === 'done') return false;
        return t.dueDate && t.dueDate < endDate;
      });
      const waiting = allTasks.filter((t: any) => t.status === 'waiting');

      let output = `## Weekly Review: ${startDate} to ${endDate}\n\n`;

      // Summary
      output += `### Summary\n\n`;
      output += `- **Completed:** ${completed.length} tasks\n`;
      output += `- **Active:** ${active.length} tasks\n`;
      output += `- **Overdue:** ${overdue.length} tasks\n`;
      output += `- **Waiting:** ${waiting.length} tasks\n\n`;

      // Accomplishments
      output += `### Accomplishments\n\n`;
      if (completed.length === 0) {
        output += `_No tasks completed this week._\n\n`;
      } else {
        // Group by project
        const byProject: Record<string, any[]> = {};
        for (const task of completed) {
          const projectName = task.projectName || 'Inbox';
          if (!byProject[projectName]) byProject[projectName] = [];
          byProject[projectName].push(task);
        }
        for (const [project, tasks] of Object.entries(byProject)) {
          output += `**${project}** (${tasks.length})\n`;
          for (const task of tasks) {
            output += `- [x] ${task.name}\n`;
          }
          output += `\n`;
        }
      }

      // Time by project
      output += `### Time by Project\n\n`;
      const totalTime = Object.values(timeByProject).reduce((a, b) => a + b, 0);
      if (totalTime === 0) {
        output += `_No time logged this week._\n\n`;
      } else {
        const sorted = Object.entries(timeByProject).sort(([, a], [, b]) => b - a);
        for (const [project, minutes] of sorted) {
          const h = Math.floor(minutes / 60);
          const m = minutes % 60;
          output += `- **${project}**: ${h}h ${m}m\n`;
        }
        const totalH = Math.floor(totalTime / 60);
        const totalM = totalTime % 60;
        output += `\n**Total:** ${totalH}h ${totalM}m\n\n`;
      }

      // Learnings
      output += `### Learnings (${learnings.length})\n\n`;
      if (learnings.length === 0) {
        output += `_No learnings recorded this week._\n\n`;
      } else {
        for (const l of learnings) {
          output += `- **${l.taskName}**: ${l.text}\n`;
        }
        output += `\n`;
      }

      // Needs attention
      output += `### Needs Attention\n\n`;
      if (overdue.length > 0) {
        output += `**Overdue (${overdue.length}):**\n`;
        for (const task of overdue.slice(0, 10)) {
          output += `- ${task.name} (due: ${task.dueDate}) [${task.projectName || 'Inbox'}]\n`;
        }
        output += `\n`;
      }
      if (waiting.length > 0) {
        output += `**Waiting (${waiting.length}):**\n`;
        for (const task of waiting.slice(0, 10)) {
          const reason = task.waitingReason ? ` - ${task.waitingReason}` : '';
          output += `- ${task.name}${reason} [${task.projectName || 'Inbox'}]\n`;
        }
        output += `\n`;
      }
      if (overdue.length === 0 && waiting.length === 0) {
        output += `_Nothing needs immediate attention._\n\n`;
      }

      return textResult(output);
    }
  );

  // ── add_recap_entry ─────────────────────────────────────────────────
  server.tool(
    'add_recap_entry',
    'Add an entry to the recap log (accomplishment, decision, or note).',
    {
      type: z.enum(['accomplishment', 'decision', 'note']).describe('Entry type'),
      content: z.string().describe('Entry content'),
      date: z.string().optional().describe('Date YYYY-MM-DD (default: today)'),
      relatedTaskId: z.string().optional().describe('Related task ID'),
      tags: z.array(z.string()).optional().describe('Tags for categorization'),
    },
    async (args) => {
      const data = await store.loadData();

      if (!data.recapLog) data.recapLog = [];

      const entry = {
        id: generateId(),
        type: args.type,
        content: args.content,
        date: args.date || todayDate(),
        relatedTaskId: args.relatedTaskId || null,
        tags: args.tags || [],
        createdAt: new Date().toISOString(),
      };

      data.recapLog.push(entry);
      await store.saveData(data);

      const emoji: Record<string, string> = {
        accomplishment: '\u2713',
        decision: '\u2696',
        note: '\ud83d\udcdd',
      };

      return textResult(`${emoji[args.type]} Added ${args.type}: "${args.content}"\nID: ${entry.id}\nDate: ${entry.date}`);
    }
  );

  // ── get_recap_log ───────────────────────────────────────────────────
  server.tool(
    'get_recap_log',
    'Get recap log entries filtered by date range and type.',
    {
      startDate: z.string().optional().describe('Start date YYYY-MM-DD'),
      endDate: z.string().optional().describe('End date YYYY-MM-DD'),
      type: z.enum(['accomplishment', 'decision', 'note', 'all']).optional().describe('Filter by type (default: all)'),
    },
    async (args) => {
      const data = await store.loadData();
      const recapLog = data.recapLog || [];

      let entries = [...recapLog];

      if (args.startDate) {
        entries = entries.filter((e: any) => e.date >= args.startDate!);
      }
      if (args.endDate) {
        entries = entries.filter((e: any) => e.date <= args.endDate!);
      }
      if (args.type && args.type !== 'all') {
        entries = entries.filter((e: any) => e.type === args.type);
      }

      // Sort by date descending
      entries.sort((a: any, b: any) => b.date.localeCompare(a.date));

      if (entries.length === 0) {
        return textResult('No recap entries found matching the criteria.');
      }

      // Group by date
      const byDate: Record<string, any[]> = {};
      for (const entry of entries) {
        if (!byDate[entry.date]) byDate[entry.date] = [];
        byDate[entry.date].push(entry);
      }

      const emoji: Record<string, string> = {
        accomplishment: '\u2713',
        decision: '\u2696',
        note: '\ud83d\udcdd',
      };

      let output = `## Recap Log\n\n`;

      // Counts
      const counts = {
        accomplishment: entries.filter((e: any) => e.type === 'accomplishment').length,
        decision: entries.filter((e: any) => e.type === 'decision').length,
        note: entries.filter((e: any) => e.type === 'note').length,
      };
      output += `**Total:** ${entries.length} entries (\u2713 ${counts.accomplishment} accomplishments, \u2696 ${counts.decision} decisions, \ud83d\udcdd ${counts.note} notes)\n\n`;

      for (const [date, dateEntries] of Object.entries(byDate)) {
        output += `### ${date}\n\n`;
        for (const entry of dateEntries) {
          const e = emoji[entry.type] || '';
          const tags = entry.tags && entry.tags.length > 0 ? ` [${entry.tags.join(', ')}]` : '';
          output += `- ${e} **${entry.type}**: ${entry.content}${tags}\n`;
          output += `  _ID: ${entry.id}_\n`;
        }
        output += `\n`;
      }

      return textResult(output);
    }
  );

  // ── save_recap ──────────────────────────────────────────────────────
  server.tool(
    'save_recap',
    'Generate and save a formatted recap document for a period (daily, weekly, monthly).',
    {
      period: z.enum(['daily', 'weekly', 'monthly']).describe('Recap period'),
      date: z.string().optional().describe('Reference date YYYY-MM-DD (default: today)'),
      summary: z.string().optional().describe('Custom summary to include'),
      highlights: z.array(z.string()).optional().describe('Key highlights to feature'),
    },
    async (args) => {
      const data = await store.loadData();
      const refDate = new Date(args.date || todayDate());
      const allTasks = getAllTasks(data);
      const recapLog = data.recapLog || [];

      // Calculate date range
      let startDate: string;
      let endDate: string;
      let periodLabel: string;

      if (args.period === 'daily') {
        startDate = refDate.toISOString().split('T')[0];
        endDate = startDate;
        periodLabel = startDate;
      } else if (args.period === 'weekly') {
        const dayOfWeek = refDate.getDay();
        const weekStart = new Date(refDate.getTime() - dayOfWeek * 24 * 60 * 60 * 1000);
        const weekEnd = new Date(weekStart.getTime() + 6 * 24 * 60 * 60 * 1000);
        startDate = weekStart.toISOString().split('T')[0];
        endDate = weekEnd.toISOString().split('T')[0];
        periodLabel = `Week of ${startDate}`;
      } else {
        // monthly
        const monthStart = new Date(refDate.getFullYear(), refDate.getMonth(), 1);
        const monthEnd = new Date(refDate.getFullYear(), refDate.getMonth() + 1, 0);
        startDate = monthStart.toISOString().split('T')[0];
        endDate = monthEnd.toISOString().split('T')[0];
        const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
          'July', 'August', 'September', 'October', 'November', 'December'];
        periodLabel = `${monthNames[refDate.getMonth()]} ${refDate.getFullYear()}`;
      }

      // Gather completed tasks in range
      const completed = allTasks.filter((t: any) => {
        if (t.status !== 'done' || !t.completedAt) return false;
        const date = t.completedAt.split('T')[0];
        return date >= startDate && date <= endDate;
      });

      // Gather recap entries in range
      const entries = recapLog.filter((e: any) => e.date >= startDate && e.date <= endDate);
      const accomplishments = entries.filter((e: any) => e.type === 'accomplishment');
      const decisions = entries.filter((e: any) => e.type === 'decision');
      const notes = entries.filter((e: any) => e.type === 'note');

      // Calculate time
      let totalMinutes = 0;
      for (const task of allTasks) {
        if (!task.timeLog) continue;
        for (const entry of task.timeLog) {
          if (entry.loggedAt) {
            const date = entry.loggedAt.split('T')[0];
            if (date >= startDate && date <= endDate) {
              totalMinutes += entry.minutes;
            }
          }
        }
      }

      // Gather learnings
      const learnings: string[] = [];
      for (const task of allTasks) {
        if (!task.learnings) continue;
        for (const learning of task.learnings) {
          if (learning.addedAt) {
            const date = learning.addedAt.split('T')[0];
            if (date >= startDate && date <= endDate) {
              learnings.push(`${task.name}: ${learning.text}`);
            }
          }
        }
      }

      // Build markdown document
      let content = `# ${args.period.charAt(0).toUpperCase() + args.period.slice(1)} Recap: ${periodLabel}\n\n`;
      content += `_Period: ${startDate} to ${endDate}_\n\n`;

      if (args.summary) {
        content += `## Summary\n\n${args.summary}\n\n`;
      }

      if (args.highlights && args.highlights.length > 0) {
        content += `## Highlights\n\n`;
        for (const h of args.highlights) {
          content += `- ${h}\n`;
        }
        content += `\n`;
      }

      content += `## Stats\n\n`;
      content += `- **Tasks Completed:** ${completed.length}\n`;
      const h = Math.floor(totalMinutes / 60);
      const m = totalMinutes % 60;
      content += `- **Time Invested:** ${h}h ${m}m\n`;
      content += `- **Accomplishments:** ${accomplishments.length}\n`;
      content += `- **Decisions:** ${decisions.length}\n`;
      content += `- **Notes:** ${notes.length}\n`;
      content += `- **Learnings:** ${learnings.length}\n\n`;

      if (completed.length > 0) {
        content += `## Completed Tasks (${completed.length})\n\n`;
        for (const task of completed) {
          content += `- [x] ${task.name} [${task.projectName || 'Inbox'}]\n`;
        }
        content += `\n`;
      }

      if (accomplishments.length > 0) {
        content += `## Accomplishments\n\n`;
        for (const a of accomplishments) {
          content += `- ${a.content}\n`;
        }
        content += `\n`;
      }

      if (decisions.length > 0) {
        content += `## Decisions\n\n`;
        for (const d of decisions) {
          content += `- ${d.content}\n`;
        }
        content += `\n`;
      }

      if (notes.length > 0) {
        content += `## Notes\n\n`;
        for (const n of notes) {
          content += `- ${n.content}\n`;
        }
        content += `\n`;
      }

      if (learnings.length > 0) {
        content += `## Learnings\n\n`;
        for (const l of learnings) {
          content += `- ${l}\n`;
        }
        content += `\n`;
      }

      // Save
      if (!data.savedRecaps) data.savedRecaps = [];

      const recap = {
        id: generateId(),
        period: args.period,
        periodLabel,
        startDate,
        endDate,
        content,
        stats: {
          tasksCompleted: completed.length,
          timeMinutes: totalMinutes,
          accomplishments: accomplishments.length,
          decisions: decisions.length,
          notes: notes.length,
          learnings: learnings.length,
        },
        savedAt: new Date().toISOString(),
      };

      data.savedRecaps.push(recap);
      await store.saveData(data);

      return textResult(`Saved ${args.period} recap: "${periodLabel}"\nID: ${recap.id}\n\n${content}`);
    }
  );

  // ── get_saved_recaps ────────────────────────────────────────────────
  server.tool(
    'get_saved_recaps',
    'List saved recap documents filtered by period.',
    {
      period: z.enum(['daily', 'weekly', 'monthly', 'all']).optional().describe('Filter by period (default: all)'),
      limit: z.number().optional().describe('Max results (default: 10)'),
    },
    async (args) => {
      const data = await store.loadData();
      const savedRecaps = data.savedRecaps || [];
      const limit = args.limit || 10;

      let recaps = [...savedRecaps];

      if (args.period && args.period !== 'all') {
        recaps = recaps.filter((r: any) => r.period === args.period);
      }

      // Sort by savedAt descending
      recaps.sort((a: any, b: any) => b.savedAt.localeCompare(a.savedAt));
      recaps = recaps.slice(0, limit);

      if (recaps.length === 0) {
        return textResult('No saved recaps found.');
      }

      let output = `## Saved Recaps (${recaps.length})\n\n`;

      for (const recap of recaps) {
        output += `### ${recap.periodLabel}\n`;
        output += `- **Period:** ${recap.period} (${recap.startDate} to ${recap.endDate})\n`;
        output += `- **Tasks Completed:** ${recap.stats.tasksCompleted}\n`;
        const h = Math.floor(recap.stats.timeMinutes / 60);
        const m = recap.stats.timeMinutes % 60;
        output += `- **Time:** ${h}h ${m}m\n`;
        output += `- **Entries:** ${recap.stats.accomplishments} accomplishments, ${recap.stats.decisions} decisions, ${recap.stats.notes} notes\n`;
        output += `- **ID:** ${recap.id}\n\n`;
      }

      return textResult(output);
    }
  );

  // ── get_recap_by_id ─────────────────────────────────────────────────
  server.tool(
    'get_recap_by_id',
    'Get a saved recap document by its ID.',
    {
      recapId: z.string().describe('Recap ID'),
    },
    async (args) => {
      const data = await store.loadData();
      const savedRecaps = data.savedRecaps || [];

      const recap = savedRecaps.find((r: any) => r.id === args.recapId);
      if (!recap) {
        return errorResult(`Recap ${args.recapId} not found`);
      }

      return textResult(recap.content);
    }
  );

  // ── delete_recap_entry ──────────────────────────────────────────────
  server.tool(
    'delete_recap_entry',
    'Delete a recap log entry by its ID.',
    {
      entryId: z.string().describe('Recap entry ID to delete'),
    },
    async (args) => {
      const data = await store.loadData();

      if (!data.recapLog) data.recapLog = [];

      const index = data.recapLog.findIndex((e: any) => e.id === args.entryId);
      if (index === -1) {
        return errorResult(`Recap entry ${args.entryId} not found`);
      }

      const entry = data.recapLog[index];
      data.recapLog.splice(index, 1);
      await store.saveData(data);

      return textResult(`Deleted ${entry.type} entry: "${entry.content}"`);
    }
  );
}
