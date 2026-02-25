import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { DataStore } from '../data/store.js';
import { textResult, errorResult } from '../types.js';
import { generateId, todayDate, getAllTasks, findTask } from '../helpers.js';

export function registerAnalyticsTools(server: McpServer, store: DataStore): void {

  // ── get_productivity_stats ──────────────────────────────────────────
  server.tool(
    'get_productivity_stats',
    'Get productivity statistics over a date range: daily breakdown, project breakdown, and overview.',
    {
      startDate: z.string().optional().describe('Start date YYYY-MM-DD (default: 7 days ago)'),
      endDate: z.string().optional().describe('End date YYYY-MM-DD (default: today)'),
    },
    async (args) => {
      const data = await store.loadData();
      const today = new Date();
      const endDate = args.endDate || today.toISOString().split('T')[0];
      const startDate = args.startDate || new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      const allTasks = getAllTasks(data);

      // Completed tasks in range
      const completed = allTasks.filter((t: any) => {
        if (t.status !== 'done' || !t.completedAt) return false;
        const date = t.completedAt.split('T')[0];
        return date >= startDate && date <= endDate;
      });

      // Daily breakdown
      const dailyCounts: Record<string, { count: number; minutes: number }> = {};
      for (const task of completed) {
        const date = task.completedAt.split('T')[0];
        if (!dailyCounts[date]) dailyCounts[date] = { count: 0, minutes: 0 };
        dailyCounts[date].count++;
        dailyCounts[date].minutes += task.estimatedMinutes || 30;
      }

      // Also count time log entries
      for (const task of allTasks) {
        if (!task.timeLog) continue;
        for (const entry of task.timeLog) {
          if (entry.loggedAt) {
            const date = entry.loggedAt.split('T')[0];
            if (date >= startDate && date <= endDate) {
              if (!dailyCounts[date]) dailyCounts[date] = { count: 0, minutes: 0 };
              // Don't double-count; time log is actual logged time, we track it separately
            }
          }
        }
      }

      // Project breakdown
      const byProject: Record<string, { count: number; minutes: number }> = {};
      for (const task of completed) {
        const projectName = task.projectName || 'Inbox';
        if (!byProject[projectName]) byProject[projectName] = { count: 0, minutes: 0 };
        byProject[projectName].count++;
        byProject[projectName].minutes += task.estimatedMinutes || 30;
      }

      // Total time logged in range
      let totalLoggedMinutes = 0;
      for (const task of allTasks) {
        if (!task.timeLog) continue;
        for (const entry of task.timeLog) {
          if (entry.loggedAt) {
            const date = entry.loggedAt.split('T')[0];
            if (date >= startDate && date <= endDate) {
              totalLoggedMinutes += entry.minutes;
            }
          }
        }
      }

      const totalEstimatedMinutes = completed.reduce((sum: number, t: any) => sum + (t.estimatedMinutes || 30), 0);
      const numDays = Math.max(1, Math.ceil((new Date(endDate).getTime() - new Date(startDate).getTime()) / (24 * 60 * 60 * 1000)) + 1);
      const avgPerDay = (completed.length / numDays).toFixed(1);

      let output = `## Productivity Stats: ${startDate} to ${endDate}\n\n`;

      // Overview
      output += `### Overview\n\n`;
      output += `- **Tasks Completed:** ${completed.length}\n`;
      output += `- **Average per Day:** ${avgPerDay}\n`;
      output += `- **Estimated Time:** ${Math.floor(totalEstimatedMinutes / 60)}h ${totalEstimatedMinutes % 60}m\n`;
      output += `- **Logged Time:** ${Math.floor(totalLoggedMinutes / 60)}h ${totalLoggedMinutes % 60}m\n`;
      output += `- **Days in Range:** ${numDays}\n\n`;

      // Daily breakdown
      output += `### Daily Breakdown\n\n`;
      const sortedDays = Object.entries(dailyCounts).sort(([a], [b]) => a.localeCompare(b));
      if (sortedDays.length === 0) {
        output += `_No activity in this range._\n\n`;
      } else {
        for (const [date, stats] of sortedDays) {
          const h = Math.floor(stats.minutes / 60);
          const m = stats.minutes % 60;
          output += `- **${date}**: ${stats.count} tasks, ~${h}h ${m}m\n`;
        }
        output += `\n`;
      }

      // By project
      output += `### By Project\n\n`;
      const sortedProjects = Object.entries(byProject).sort(([, a], [, b]) => b.count - a.count);
      if (sortedProjects.length === 0) {
        output += `_No project data._\n\n`;
      } else {
        for (const [project, stats] of sortedProjects) {
          const h = Math.floor(stats.minutes / 60);
          const m = stats.minutes % 60;
          output += `- **${project}**: ${stats.count} tasks, ~${h}h ${m}m\n`;
        }
        output += `\n`;
      }

      return textResult(output);
    }
  );

  // ── get_productivity_insights ───────────────────────────────────────
  server.tool(
    'get_productivity_insights',
    'Analyze productivity patterns: most productive day of week, peak hours, priority distribution.',
    {
      period: z.enum(['week', 'month', 'quarter']).optional().describe('Analysis period (default: week)'),
    },
    async (args) => {
      const data = await store.loadData();
      const period = args.period || 'week';
      const today = new Date();

      let daysBack: number;
      if (period === 'week') daysBack = 7;
      else if (period === 'month') daysBack = 30;
      else daysBack = 90;

      const startDate = new Date(today.getTime() - daysBack * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      const endDate = today.toISOString().split('T')[0];
      const allTasks = getAllTasks(data);

      const completed = allTasks.filter((t: any) => {
        if (t.status !== 'done' || !t.completedAt) return false;
        const date = t.completedAt.split('T')[0];
        return date >= startDate && date <= endDate;
      });

      // By day of week (0=Sunday, 6=Saturday)
      const dayOfWeekNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
      const byDayOfWeek: number[] = [0, 0, 0, 0, 0, 0, 0];
      for (const task of completed) {
        const day = new Date(task.completedAt).getDay();
        byDayOfWeek[day]++;
      }

      // By hour (0-23)
      const byHour: number[] = new Array(24).fill(0);
      for (const task of completed) {
        const hour = new Date(task.completedAt).getHours();
        byHour[hour]++;
      }

      // Most/least productive day
      let mostProductiveDay = 0;
      let leastProductiveDay = 0;
      for (let i = 0; i < 7; i++) {
        if (byDayOfWeek[i] > byDayOfWeek[mostProductiveDay]) mostProductiveDay = i;
        if (byDayOfWeek[i] < byDayOfWeek[leastProductiveDay]) leastProductiveDay = i;
      }

      // Peak hour
      let peakHour = 0;
      for (let i = 0; i < 24; i++) {
        if (byHour[i] > byHour[peakHour]) peakHour = i;
      }

      // Priority distribution
      const priorityCounts: Record<string, number> = { urgent: 0, high: 0, medium: 0, low: 0, none: 0 };
      for (const task of completed) {
        const p = task.priority || 'none';
        priorityCounts[p] = (priorityCounts[p] || 0) + 1;
      }

      // Execution type distribution
      const execCounts: Record<string, number> = { ai: 0, manual: 0, hybrid: 0 };
      for (const task of completed) {
        const et = task.executionType || 'manual';
        execCounts[et] = (execCounts[et] || 0) + 1;
      }

      let output = `## Productivity Insights (${period}: ${startDate} to ${endDate})\n\n`;
      output += `**Total Completed:** ${completed.length} tasks\n\n`;

      // Patterns
      output += `### Patterns\n\n`;
      output += `- **Most Productive Day:** ${dayOfWeekNames[mostProductiveDay]} (${byDayOfWeek[mostProductiveDay]} tasks)\n`;
      output += `- **Least Productive Day:** ${dayOfWeekNames[leastProductiveDay]} (${byDayOfWeek[leastProductiveDay]} tasks)\n`;
      output += `- **Peak Hour:** ${peakHour}:00 (${byHour[peakHour]} tasks completed)\n\n`;

      // Day of week breakdown
      output += `### By Day of Week\n\n`;
      for (let i = 0; i < 7; i++) {
        const bar = '\u2588'.repeat(Math.min(byDayOfWeek[i], 30));
        output += `${dayOfWeekNames[i].padEnd(10)} ${bar} ${byDayOfWeek[i]}\n`;
      }
      output += `\n`;

      // Hour breakdown (only show hours with activity)
      output += `### By Hour\n\n`;
      for (let i = 0; i < 24; i++) {
        if (byHour[i] > 0) {
          const bar = '\u2588'.repeat(Math.min(byHour[i], 30));
          const hourLabel = `${i.toString().padStart(2, '0')}:00`;
          output += `${hourLabel} ${bar} ${byHour[i]}\n`;
        }
      }
      output += `\n`;

      // Priority distribution
      output += `### Priority Distribution\n\n`;
      for (const [priority, count] of Object.entries(priorityCounts)) {
        if (count > 0) {
          const pct = completed.length > 0 ? Math.round(count / completed.length * 100) : 0;
          output += `- **${priority}**: ${count} (${pct}%)\n`;
        }
      }
      output += `\n`;

      // Execution type distribution
      output += `### Execution Type Distribution\n\n`;
      for (const [execType, count] of Object.entries(execCounts)) {
        if (count > 0) {
          const pct = completed.length > 0 ? Math.round(count / completed.length * 100) : 0;
          output += `- **${execType}**: ${count} (${pct}%)\n`;
        }
      }
      output += `\n`;

      // Raw data as JSON
      output += `### Raw Data\n\n`;
      output += '```json\n';
      output += JSON.stringify({
        byDayOfWeek: dayOfWeekNames.map((name, i) => ({ day: name, count: byDayOfWeek[i] })),
        byHour: byHour.map((count, i) => ({ hour: i, count })).filter(h => h.count > 0),
        priorityDistribution: priorityCounts,
        executionTypeDistribution: execCounts,
        mostProductiveDay: dayOfWeekNames[mostProductiveDay],
        leastProductiveDay: dayOfWeekNames[leastProductiveDay],
        peakHour,
      }, null, 2);
      output += '\n```\n';

      return textResult(output);
    }
  );

  // ── get_work_context ────────────────────────────────────────────────
  server.tool(
    'get_work_context',
    'Get comprehensive work context: recent completions, snoozed/waiting tasks, blockers, energy patterns, project velocity, and recent recap entries.',
    {
      days: z.number().optional().describe('Number of days to look back (default: 14)'),
    },
    async (args) => {
      const data = await store.loadData();
      const lookbackDays = args.days || 14;
      const today = new Date();
      const startDate = new Date(today.getTime() - lookbackDays * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      const endDate = today.toISOString().split('T')[0];
      const allTasks = getAllTasks(data);

      // Recent completions with energy ratings
      const recentCompleted = allTasks
        .filter((t: any) => {
          if (t.status !== 'done' || !t.completedAt) return false;
          const date = t.completedAt.split('T')[0];
          return date >= startDate && date <= endDate;
        })
        .sort((a: any, b: any) => b.completedAt.localeCompare(a.completedAt));

      // Snoozed tasks (by snoozeCount)
      const snoozed = allTasks
        .filter((t: any) => t.snoozeCount && t.snoozeCount > 0 && t.status !== 'done')
        .sort((a: any, b: any) => (b.snoozeCount || 0) - (a.snoozeCount || 0));

      // Waiting tasks with reasons
      const waiting = allTasks
        .filter((t: any) => t.status === 'waiting')
        .map((t: any) => ({
          name: t.name,
          id: t.id,
          reason: t.waitingReason || 'No reason specified',
          blockedBy: t.blockedBy || null,
          projectName: t.projectName,
        }));

      // Blocker pattern counts
      const blockerCounts: Record<string, number> = {};
      for (const task of waiting) {
        const blocker = task.blockedBy || task.reason;
        blockerCounts[blocker] = (blockerCounts[blocker] || 0) + 1;
      }

      // Energy by rating (1-3)
      const energyCounts: Record<number, number> = { 1: 0, 2: 0, 3: 0 };
      for (const task of allTasks) {
        if (task.energyRating && task.energyRating >= 1 && task.energyRating <= 3) {
          energyCounts[task.energyRating]++;
        }
      }

      // Project velocity (completed in range per project)
      const projectVelocity: Record<string, number> = {};
      for (const task of recentCompleted) {
        const projectName = task.projectName || 'Inbox';
        projectVelocity[projectName] = (projectVelocity[projectName] || 0) + 1;
      }

      // Recent recap entries (30 max)
      const recapLog = data.recapLog || [];
      const recentRecaps = recapLog
        .filter((e: any) => e.date >= startDate && e.date <= endDate)
        .sort((a: any, b: any) => b.date.localeCompare(a.date))
        .slice(0, 30);

      // Oldest active tasks (10 max)
      const oldestActive = allTasks
        .filter((t: any) => t.status !== 'done')
        .sort((a: any, b: any) => (a.createdAt || '').localeCompare(b.createdAt || ''))
        .slice(0, 10);

      let output = `## Work Context (Last ${lookbackDays} Days)\n\n`;

      // Recent completions
      output += `### Recent Completions (${recentCompleted.length})\n\n`;
      for (const task of recentCompleted.slice(0, 20)) {
        const energy = task.energyRating ? ` [energy: ${task.energyRating}/3]` : '';
        output += `- [x] ${task.name} (${task.completedAt.split('T')[0]}) [${task.projectName || 'Inbox'}]${energy}\n`;
      }
      if (recentCompleted.length > 20) {
        output += `_...and ${recentCompleted.length - 20} more_\n`;
      }
      output += `\n`;

      // Snoozed tasks
      if (snoozed.length > 0) {
        output += `### Frequently Snoozed (${snoozed.length})\n\n`;
        for (const task of snoozed.slice(0, 10)) {
          output += `- ${task.name} (snoozed ${task.snoozeCount}x) [${task.projectName || 'Inbox'}]\n`;
        }
        output += `\n`;
      }

      // Waiting tasks
      if (waiting.length > 0) {
        output += `### Waiting Tasks (${waiting.length})\n\n`;
        for (const task of waiting) {
          output += `- ${task.name}: ${task.reason}`;
          if (task.blockedBy) output += ` (blocked by: ${task.blockedBy})`;
          output += ` [${task.projectName || 'Inbox'}]\n`;
        }
        output += `\n`;
      }

      // Blocker patterns
      if (Object.keys(blockerCounts).length > 0) {
        output += `### Blocker Patterns\n\n`;
        const sorted = Object.entries(blockerCounts).sort(([, a], [, b]) => b - a);
        for (const [blocker, count] of sorted) {
          output += `- **${blocker}**: ${count} tasks\n`;
        }
        output += `\n`;
      }

      // Energy distribution
      const totalEnergy = energyCounts[1] + energyCounts[2] + energyCounts[3];
      if (totalEnergy > 0) {
        output += `### Energy Distribution\n\n`;
        output += `- **Low (1):** ${energyCounts[1]} tasks\n`;
        output += `- **Medium (2):** ${energyCounts[2]} tasks\n`;
        output += `- **High (3):** ${energyCounts[3]} tasks\n\n`;
      }

      // Project velocity
      output += `### Project Velocity (${lookbackDays} days)\n\n`;
      const sortedVelocity = Object.entries(projectVelocity).sort(([, a], [, b]) => b - a);
      if (sortedVelocity.length === 0) {
        output += `_No completions in this period._\n\n`;
      } else {
        for (const [project, count] of sortedVelocity) {
          output += `- **${project}**: ${count} completed\n`;
        }
        output += `\n`;
      }

      // Recent recap entries
      if (recentRecaps.length > 0) {
        output += `### Recent Recap Entries (${recentRecaps.length})\n\n`;
        const emoji: Record<string, string> = { accomplishment: '\u2713', decision: '\u2696', note: '\ud83d\udcdd' };
        for (const entry of recentRecaps) {
          const e = emoji[entry.type] || '';
          output += `- ${e} ${entry.date} **${entry.type}**: ${entry.content}\n`;
        }
        output += `\n`;
      }

      // Oldest active tasks
      if (oldestActive.length > 0) {
        output += `### Oldest Active Tasks\n\n`;
        for (const task of oldestActive) {
          const age = task.createdAt
            ? Math.floor((today.getTime() - new Date(task.createdAt).getTime()) / (24 * 60 * 60 * 1000))
            : '?';
          output += `- ${task.name} (${age} days old) [${task.projectName || 'Inbox'}] — ${task.status}\n`;
        }
        output += `\n`;
      }

      return textResult(output);
    }
  );
}
