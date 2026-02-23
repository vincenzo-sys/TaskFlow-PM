import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { DataStore } from '../data/store.js';
import { textResult, errorResult } from '../types.js';
import { generateId, todayDate, getAllTasks, findTask } from '../helpers.js';

export function registerAiProcessingTools(server: McpServer, store: DataStore): void {

  // ── process_brain_dump ──────────────────────────────────────────────
  server.tool(
    'process_brain_dump',
    'Analyze a brain dump task and extract structured information: priority signals, complexity, questions, action items, and blockers.',
    {
      taskId: z.string().describe('ID of the task to analyze'),
    },
    async (args) => {
      const data = store.loadData();
      const result = findTask(data, args.taskId);
      if (!result) {
        return errorResult(`Task ${args.taskId} not found`);
      }

      const { task, project } = result;
      const context = `${task.name} ${task.description || ''} ${task.context || ''}`.toLowerCase();

      const analysis: any = {
        suggestedName: task.name,
        hasDescription: !!task.description,
        hasContext: !!task.context,
        suggestedPriority: 'medium',
        suggestedComplexity: 3,
        suggestedProject: project?.name || null,
        keyPhrases: [],
        actionItems: [],
        questions: [],
        blockers: [],
      };

      // Analyze priority signals
      if (context.includes('urgent') || context.includes('asap') || context.includes('critical') || context.includes('emergency')) {
        analysis.suggestedPriority = 'urgent';
      } else if (context.includes('important') || context.includes('high priority') || context.includes('deadline')) {
        analysis.suggestedPriority = 'high';
      } else if (context.includes('when i get time') || context.includes('nice to have') || context.includes('eventually')) {
        analysis.suggestedPriority = 'low';
      }

      // Analyze complexity signals
      let complexityScore = 3;
      if (context.includes('simple') || context.includes('quick') || context.includes('easy')) complexityScore--;
      if (context.includes('complex') || context.includes('complicated') || context.includes('multiple')) complexityScore++;
      if (context.includes('research') || context.includes('investigate') || context.includes('figure out')) complexityScore++;
      if (context.length > 500) complexityScore++;
      if (context.length < 100) complexityScore--;
      analysis.suggestedComplexity = Math.max(1, Math.min(5, complexityScore));

      // Extract questions (lines ending with ?)
      const fullText = task.context || task.description || '';
      const questions = fullText.match(/[^.!?]*\?/g) || [];
      analysis.questions = questions.slice(0, 3);

      // Look for action words to suggest subtasks
      const actionPatterns = [
        /need to ([^.!?]+)/gi,
        /should ([^.!?]+)/gi,
        /have to ([^.!?]+)/gi,
        /must ([^.!?]+)/gi,
        /will ([^.!?]+)/gi,
      ];

      actionPatterns.forEach(pattern => {
        const matches = fullText.match(pattern) || [];
        analysis.actionItems.push(...matches.slice(0, 2));
      });
      analysis.actionItems = [...new Set(analysis.actionItems)].slice(0, 5);

      // Look for blocker signals
      if (context.includes('waiting') || context.includes('blocked') || context.includes('depends on') || context.includes('need from')) {
        analysis.blockers.push('Potential dependency or blocker detected in context');
      }

      let output = `## Brain Dump Analysis: ${task.name}\n\n`;
      output += `### Current State\n`;
      output += `- Has description: ${analysis.hasDescription ? 'Yes' : 'No'}\n`;
      output += `- Has context/brain dump: ${analysis.hasContext ? 'Yes' : 'No'}\n`;
      output += `- Current priority: ${task.priority}\n`;
      output += `- Current status: ${task.status}\n\n`;

      output += `### Suggestions\n`;
      output += `- **Suggested Priority:** ${analysis.suggestedPriority}`;
      if (analysis.suggestedPriority !== task.priority) output += ` (currently: ${task.priority})`;
      output += `\n`;
      output += `- **Complexity Score:** ${analysis.suggestedComplexity}/5\n`;

      if (analysis.questions.length > 0) {
        output += `\n### Questions Found\n`;
        analysis.questions.forEach((q: string) => output += `- ${q.trim()}\n`);
      }

      if (analysis.actionItems.length > 0) {
        output += `\n### Potential Action Items\n`;
        analysis.actionItems.forEach((a: string) => output += `- ${a.trim()}\n`);
      }

      if (analysis.blockers.length > 0) {
        output += `\n### Potential Blockers\n`;
        analysis.blockers.forEach((b: string) => output += `- ${b}\n`);
      }

      output += `\n### Recommended Next Steps\n`;
      if (!analysis.hasContext && !analysis.hasDescription) {
        output += `1. Add more context to clarify what needs to be done\n`;
      }
      if (task.status === 'todo') {
        output += `2. Change status to 'ready' once clarified\n`;
      }
      if (analysis.suggestedPriority !== task.priority) {
        output += `3. Consider updating priority to '${analysis.suggestedPriority}'\n`;
      }
      if (analysis.actionItems.length > 0) {
        output += `4. Consider breaking into subtasks using suggest_subtasks\n`;
      }

      return textResult(output);
    }
  );

  // ── suggest_subtasks ────────────────────────────────────────────────
  server.tool(
    'suggest_subtasks',
    'Analyze a task and suggest subtasks based on its context, description, and common workflow patterns.',
    {
      taskId: z.string().describe('ID of the task to suggest subtasks for'),
    },
    async (args) => {
      const data = store.loadData();
      const result = findTask(data, args.taskId);
      if (!result) {
        return errorResult(`Task ${args.taskId} not found`);
      }

      const { task } = result;
      const fullText = `${task.name} ${task.description || ''} ${task.context || ''}`;
      const suggestions: string[] = [];

      // Common action patterns
      const patterns = [
        { pattern: /need to ([^.!?]+)/gi },
        { pattern: /should ([^.!?]+)/gi },
        { pattern: /have to ([^.!?]+)/gi },
        { pattern: /must ([^.!?]+)/gi },
        { pattern: /first,? ([^.!?,]+)/gi },
        { pattern: /then,? ([^.!?,]+)/gi },
        { pattern: /finally,? ([^.!?,]+)/gi },
        { pattern: /\d+\.\s*([^.!?\n]+)/gi },  // Numbered items
        { pattern: /-\s*([^.!?\n]+)/gi },        // Bullet points
      ];

      patterns.forEach(({ pattern }) => {
        const matches = fullText.matchAll(pattern);
        for (const match of matches) {
          const suggestion = match[1].trim();
          if (suggestion.length > 5 && suggestion.length < 100 && !suggestions.includes(suggestion)) {
            suggestions.push(suggestion);
          }
        }
      });

      // Add standard workflow suggestions based on task type
      const taskLower = fullText.toLowerCase();

      if (taskLower.includes('write') || taskLower.includes('document') || taskLower.includes('article')) {
        if (!suggestions.some(s => s.includes('outline'))) suggestions.push('Create outline');
        if (!suggestions.some(s => s.includes('draft'))) suggestions.push('Write first draft');
        if (!suggestions.some(s => s.includes('review'))) suggestions.push('Review and edit');
      }

      if (taskLower.includes('research') || taskLower.includes('investigate')) {
        if (!suggestions.some(s => s.includes('gather'))) suggestions.push('Gather sources');
        if (!suggestions.some(s => s.includes('summarize'))) suggestions.push('Summarize findings');
      }

      if (taskLower.includes('meeting') || taskLower.includes('present')) {
        if (!suggestions.some(s => s.includes('agenda'))) suggestions.push('Prepare agenda');
        if (!suggestions.some(s => s.includes('slides'))) suggestions.push('Create slides/materials');
        if (!suggestions.some(s => s.includes('follow'))) suggestions.push('Send follow-up notes');
      }

      if (taskLower.includes('code') || taskLower.includes('develop') || taskLower.includes('implement') || taskLower.includes('build')) {
        if (!suggestions.some(s => s.includes('design'))) suggestions.push('Design approach');
        if (!suggestions.some(s => s.includes('implement'))) suggestions.push('Implement solution');
        if (!suggestions.some(s => s.includes('test'))) suggestions.push('Write tests');
        if (!suggestions.some(s => s.includes('review'))) suggestions.push('Code review');
      }

      // Limit to 7 suggestions
      const finalSuggestions = suggestions.slice(0, 7);

      let output = `## Suggested Subtasks for: ${task.name}\n\n`;

      if (finalSuggestions.length === 0) {
        output += `No obvious subtasks detected from the context.\n\n`;
        output += `### Generic Suggestions\n`;
        output += `Consider breaking this down into:\n`;
        output += `- Research/gather information\n`;
        output += `- Plan approach\n`;
        output += `- Execute main work\n`;
        output += `- Review/finalize\n`;
      } else {
        output += `Based on the task context, here are suggested subtasks:\n\n`;
        finalSuggestions.forEach((s, i) => {
          output += `${i + 1}. ${s}\n`;
        });
        output += `\n### To apply these subtasks:\n`;
        output += `Use create_subtasks with the subtasks you want to create.\n`;
      }

      // Return as JSON for programmatic use
      output += `\n---\n`;
      output += `\`\`\`json\n${JSON.stringify({ taskId: task.id, suggestions: finalSuggestions }, null, 2)}\n\`\`\``;

      return textResult(output);
    }
  );

  // ── suggest_priority ────────────────────────────────────────────────
  server.tool(
    'suggest_priority',
    'Analyze a task and suggest an appropriate priority based on text signals, due dates, and current status.',
    {
      taskId: z.string().describe('ID of the task to analyze'),
    },
    async (args) => {
      const data = store.loadData();
      const result = findTask(data, args.taskId);
      if (!result) {
        return errorResult(`Task ${args.taskId} not found`);
      }

      const { task } = result;
      const fullText = `${task.name} ${task.description || ''} ${task.context || ''}`.toLowerCase();
      const today = todayDate();

      let suggestedPriority = 'medium';
      const reasons: string[] = [];

      // Check for urgency signals in text
      if (fullText.includes('urgent') || fullText.includes('asap') || fullText.includes('emergency') || fullText.includes('critical')) {
        suggestedPriority = 'urgent';
        reasons.push('Contains urgency keywords (urgent, asap, emergency, critical)');
      } else if (fullText.includes('important') || fullText.includes('high priority') || fullText.includes('crucial')) {
        suggestedPriority = 'high';
        reasons.push('Contains importance keywords (important, high priority, crucial)');
      } else if (fullText.includes('eventually') || fullText.includes('nice to have') || fullText.includes('when i get time') || fullText.includes('low priority')) {
        suggestedPriority = 'low';
        reasons.push('Contains low-priority keywords (eventually, nice to have)');
      }

      // Check due date
      if (task.dueDate) {
        if (task.dueDate < today) {
          if (suggestedPriority !== 'urgent') {
            suggestedPriority = 'urgent';
            reasons.push(`Task is OVERDUE (was due ${task.dueDate})`);
          }
        } else if (task.dueDate === today) {
          if (suggestedPriority === 'low' || suggestedPriority === 'medium') {
            suggestedPriority = 'high';
            reasons.push('Task is due TODAY');
          }
        } else {
          const dueDate = new Date(task.dueDate);
          const todayDateObj = new Date(today);
          const daysUntil = Math.ceil((dueDate.getTime() - todayDateObj.getTime()) / (1000 * 60 * 60 * 24));
          if (daysUntil <= 2 && suggestedPriority === 'low') {
            suggestedPriority = 'medium';
            reasons.push(`Task is due in ${daysUntil} days`);
          }
        }
      }

      // Check for blocked status
      if (task.status === 'waiting') {
        reasons.push('Task is currently blocked/waiting - priority may be less relevant until unblocked');
      }

      let output = `## Priority Suggestion: ${task.name}\n\n`;
      output += `**Current Priority:** ${task.priority}\n`;
      output += `**Suggested Priority:** ${suggestedPriority}\n\n`;

      if (reasons.length > 0) {
        output += `### Reasoning\n`;
        reasons.forEach(r => output += `- ${r}\n`);
        output += `\n`;
      }

      if (suggestedPriority !== task.priority) {
        output += `### Action\n`;
        output += `To update the priority, use:\n`;
        output += `\`update_task\` with taskId: "${task.id}" and priority: "${suggestedPriority}"\n`;
      } else {
        output += `Current priority appears appropriate.\n`;
      }

      return textResult(output);
    }
  );

  // ── suggest_next_task ───────────────────────────────────────────────
  server.tool(
    'suggest_next_task',
    'Analyze all active tasks and suggest the best next task to work on based on scheduling, due dates, priority, and status.',
    {},
    async () => {
      const data = store.loadData();
      const today = todayDate();
      const tasks = getAllTasks(data).filter((t: any) =>
        t.status !== 'done' && t.status !== 'waiting'
      );

      if (tasks.length === 0) {
        return textResult('No active tasks available! Either all tasks are complete, or they\'re blocked/waiting.');
      }

      // Score each task
      const scored = tasks.map((task: any) => {
        let score = 0;
        const reasons: string[] = [];

        // Scheduled now/soon
        if (task.scheduledDate === today && task.scheduledTime) {
          const now = new Date();
          const [h, m] = task.scheduledTime.split(':').map(Number);
          const scheduledMins = h * 60 + m;
          const currentMins = now.getHours() * 60 + now.getMinutes();

          if (currentMins >= scheduledMins && currentMins <= scheduledMins + (task.estimatedMinutes || 60)) {
            score += 100;
            reasons.push('Scheduled for RIGHT NOW');
          } else if (currentMins < scheduledMins && scheduledMins - currentMins <= 60) {
            score += 50;
            reasons.push('Scheduled within the next hour');
          }
        }

        // Overdue
        if (task.dueDate && task.dueDate < today) {
          score += 80;
          reasons.push(`OVERDUE since ${task.dueDate}`);
        }

        // Due today
        if (task.dueDate === today) {
          score += 40;
          reasons.push('Due TODAY');
        }

        // Priority
        if (task.priority === 'urgent') {
          score += 35;
          reasons.push('Marked as URGENT');
        } else if (task.priority === 'high') {
          score += 25;
          reasons.push('High priority');
        } else if (task.priority === 'medium') {
          score += 10;
          reasons.push('Medium priority');
        }

        // Status
        if (task.status === 'in-progress') {
          score += 20;
          reasons.push('Already in progress');
        } else if (task.status === 'ready') {
          score += 10;
          reasons.push('Ready to work on');
        }

        // Complexity preference (prefer simpler tasks for quick wins)
        if (task.complexity === 1) score += 5;
        if (task.complexity === 2) score += 3;

        return { task, score, reasons };
      });

      scored.sort((a: any, b: any) => b.score - a.score);
      const top = scored[0];
      const project = data.projects.find((p: any) => p.tasks.some((t: any) => t.id === top.task.id));

      let output = `## Recommended Next Task\n\n`;
      output += `### ${top.task.name}\n\n`;
      output += `**ID:** ${top.task.id}\n`;
      output += `**Status:** ${top.task.status}\n`;
      output += `**Priority:** ${top.task.priority}\n`;
      if (top.task.dueDate) output += `**Due:** ${top.task.dueDate}\n`;
      if (project && !project.isInbox) output += `**Project:** ${project.name}\n`;
      if (top.task.estimatedMinutes) output += `**Estimated:** ${top.task.estimatedMinutes} min\n`;
      output += `\n`;

      output += `### Why This Task?\n`;
      top.reasons.forEach((r: string) => output += `- ${r}\n`);
      output += `\n`;

      if (top.task.context || top.task.description) {
        output += `### Context\n`;
        output += top.task.description ? `${top.task.description}\n` : '';
        if (top.task.context) {
          const preview = top.task.context.length > 200
            ? top.task.context.substring(0, 200) + '...'
            : top.task.context;
          output += preview + '\n';
        }
        output += `\n`;
      }

      output += `### Next Steps\n`;
      output += `1. Start working on this task\n`;
      output += `2. Use \`update_task\` to set status to 'in-progress'\n`;
      if (top.task.subtasks && top.task.subtasks.length > 0) {
        const pending = top.task.subtasks.filter((s: any) => s.status !== 'done').length;
        output += `3. ${pending} subtask(s) pending\n`;
      }

      return textResult(output);
    }
  );

  // ── suggest_parallel_tasks ──────────────────────────────────────────
  server.tool(
    'suggest_parallel_tasks',
    'Suggest tasks that can be worked on in parallel - pairing AI tasks with manual tasks for maximum productivity.',
    {
      date: z.string().optional().describe('Date to analyze (YYYY-MM-DD). Defaults to today.'),
    },
    async (args) => {
      const data = store.loadData();
      const targetDate = args.date || todayDate();
      const tasks = getAllTasks(data).filter((t: any) =>
        t.status !== 'done' && t.status !== 'waiting'
      );

      // Get tasks for today
      const todayTasks = tasks.filter((t: any) =>
        t.scheduledDate === targetDate ||
        t.dueDate === targetDate ||
        t.status === 'ready' ||
        t.status === 'in-progress'
      );

      // Separate by execution type (default to manual if not set)
      const aiTasks = todayTasks.filter((t: any) => t.executionType === 'ai');
      const manualTasks = todayTasks.filter((t: any) => !t.executionType || t.executionType === 'manual');
      const hybridTasks = todayTasks.filter((t: any) => t.executionType === 'hybrid');

      // Find good parallel pairs
      const suggestions: any[] = [];

      // Pair AI tasks with manual tasks that can be done simultaneously
      for (const aiTask of aiTasks) {
        for (const manualTask of manualTasks) {
          // Check if they don't conflict (not same scheduled time)
          const noTimeConflict = !aiTask.scheduledTime || !manualTask.scheduledTime ||
            aiTask.scheduledTime !== manualTask.scheduledTime;

          if (noTimeConflict) {
            suggestions.push({
              aiTask: { id: aiTask.id, name: aiTask.name, estimated: aiTask.estimatedMinutes || 30 },
              manualTask: { id: manualTask.id, name: manualTask.name, estimated: manualTask.estimatedMinutes || 30 },
              reason: 'These can be done in parallel - Claude works on one while you do the other',
            });
          }
        }
      }

      // Also identify untagged tasks
      const untaggedTasks = todayTasks.filter((t: any) => !t.executionType);

      let output = `## Parallel Task Suggestions for ${targetDate}\n\n`;

      if (suggestions.length > 0) {
        output += `### Recommended Parallel Pairs\n\n`;
        suggestions.slice(0, 3).forEach((s, i) => {
          output += `**Pair ${i + 1}:**\n`;
          output += `- Claude: "${s.aiTask.name}" (~${s.aiTask.estimated}m)\n`;
          output += `- You: "${s.manualTask.name}" (~${s.manualTask.estimated}m)\n`;
          output += `- _${s.reason}_\n\n`;
        });
      } else if (aiTasks.length === 0 && manualTasks.length > 0) {
        output += `### No AI tasks defined yet\n\n`;
        output += `Consider marking some tasks as AI-executable using set_execution_type.\n`;
        output += `Good candidates for AI tasks:\n`;
        output += `- Research and summarization\n`;
        output += `- Code generation and refactoring\n`;
        output += `- Writing first drafts\n`;
        output += `- Data analysis\n\n`;
      }

      output += `### Current Task Distribution\n`;
      output += `- AI tasks: ${aiTasks.length}\n`;
      output += `- Manual tasks: ${manualTasks.length}\n`;
      output += `- Hybrid tasks: ${hybridTasks.length}\n`;
      output += `- Untagged: ${untaggedTasks.length}\n`;

      return textResult(output);
    }
  );

  // ── suggest_day_schedule ────────────────────────────────────────────
  server.tool(
    'suggest_day_schedule',
    'Generate a suggested day schedule by assigning time slots to priority tasks with 15-minute buffers.',
    {
      date: z.string().optional().describe('Date to schedule (YYYY-MM-DD). Defaults to today.'),
      startHour: z.number().optional().describe('Start of working day (hour, 0-23). Default: 9'),
      endHour: z.number().optional().describe('End of working day (hour, 0-23). Default: 18'),
      taskIds: z.array(z.string()).optional().describe('Specific task IDs to schedule. If omitted, uses top priority unscheduled tasks.'),
    },
    async (args) => {
      const data = store.loadData();
      const targetDate = args.date || todayDate();
      const startHour = args.startHour ?? 9;
      const endHour = args.endHour ?? 18;
      const allTasks = getAllTasks(data);

      // Get tasks to schedule
      let toSchedule: any[];
      if (args.taskIds && args.taskIds.length > 0) {
        toSchedule = args.taskIds.map(id => findTask(data, id)?.task).filter(Boolean);
      } else {
        // Get top priority unscheduled tasks
        toSchedule = allTasks
          .filter((t: any) => t.status !== 'done' && !t.scheduledTime)
          .sort((a: any, b: any) => {
            const priorityOrder: Record<string, number> = { urgent: 0, high: 1, medium: 2, low: 3, none: 4 };
            const aPri = priorityOrder[a.priority] ?? 4;
            const bPri = priorityOrder[b.priority] ?? 4;
            if (aPri !== bPri) return aPri - bPri;
            if (a.dueDate && b.dueDate) return a.dueDate.localeCompare(b.dueDate);
            if (a.dueDate) return -1;
            if (b.dueDate) return 1;
            return 0;
          })
          .slice(0, 10);
      }

      // Build schedule
      const schedule: any[] = [];
      let currentMinutes = startHour * 60;
      const endMinutes = endHour * 60;

      for (const task of toSchedule) {
        const duration = task.estimatedMinutes || 30;
        if (currentMinutes + duration > endMinutes) break;

        const hour = Math.floor(currentMinutes / 60);
        const minute = currentMinutes % 60;
        const time = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;

        schedule.push({
          taskId: task.id,
          name: task.name,
          scheduledTime: time,
          estimatedMinutes: duration,
        });

        currentMinutes += duration + 15; // 15 min buffer between tasks
      }

      let output = `## Suggested Schedule for ${targetDate}\n\n`;
      output += `Working hours: ${startHour}:00 - ${endHour}:00\n\n`;

      if (schedule.length === 0) {
        output += 'No tasks to schedule.\n';
      } else {
        let totalMinutes = 0;
        schedule.forEach(item => {
          output += `**${item.scheduledTime}** - ${item.name} (${item.estimatedMinutes}m)\n`;
          output += `  ID: ${item.taskId}\n\n`;
          totalMinutes += item.estimatedMinutes;
        });

        output += `---\n`;
        output += `**Total:** ${schedule.length} tasks, ${Math.floor(totalMinutes / 60)}h ${totalMinutes % 60}m\n\n`;
        output += `### To apply this schedule:\n`;
        output += `Use bulk_schedule_today with:\n`;
        output += '```json\n' + JSON.stringify({
          schedule: schedule.map(s => ({
            taskId: s.taskId,
            scheduledTime: s.scheduledTime,
            estimatedMinutes: s.estimatedMinutes,
          })),
        }, null, 2) + '\n```';
      }

      return textResult(output);
    }
  );

  // ── suggest_project_breakdown ───────────────────────────────────────
  server.tool(
    'suggest_project_breakdown',
    'Analyze a project and suggest a structured task breakdown with 5 phases: Planning, Setup, Implementation, Testing, Documentation.',
    {
      projectId: z.string().optional().describe('ID of the project to analyze'),
      projectName: z.string().optional().describe('Name of the project to analyze'),
    },
    async (args) => {
      const data = store.loadData();
      let project = null;

      if (args.projectId) {
        project = data.projects.find((p: any) => p.id === args.projectId);
      } else if (args.projectName) {
        project = data.projects.find((p: any) =>
          p.name.toLowerCase().includes(args.projectName!.toLowerCase())
        );
      }

      if (!project) {
        return errorResult('Project not found. Provide a valid projectId or projectName.');
      }

      const tasks = project.tasks;
      const activeTasks = tasks.filter((t: any) => t.status !== 'done');
      const completedTasks = tasks.filter((t: any) => t.status === 'done');

      // Analyze existing task patterns
      const hasSubtasks = tasks.some((t: any) => t.subtasks && t.subtasks.length > 0);
      const hasPriorities = tasks.some((t: any) => t.priority && t.priority !== 'none');
      const hasDueDates = tasks.some((t: any) => t.dueDate);
      const hasScheduled = tasks.some((t: any) => t.scheduledTime);

      let output = `## Project Analysis: ${project.name}\n\n`;

      output += `### Current State\n`;
      output += `- Active tasks: ${activeTasks.length}\n`;
      output += `- Completed tasks: ${completedTasks.length}\n`;
      output += `- Has subtasks: ${hasSubtasks ? 'Yes' : 'No'}\n`;
      output += `- Uses priorities: ${hasPriorities ? 'Yes' : 'No'}\n`;
      output += `- Has due dates: ${hasDueDates ? 'Yes' : 'No'}\n`;
      output += `- Has scheduled times: ${hasScheduled ? 'Yes' : 'No'}\n\n`;

      output += `### Suggested Task Breakdown\n\n`;
      output += `Based on the project "${project.name}", here's a suggested structure:\n\n`;

      output += `**1. Planning & Research** (AI-suitable)\n`;
      output += `   - Define project scope and requirements\n`;
      output += `   - Research best practices and approaches\n`;
      output += `   - Create technical specification\n\n`;

      output += `**2. Setup & Foundation** (Hybrid)\n`;
      output += `   - Set up project structure\n`;
      output += `   - Configure tools and dependencies\n`;
      output += `   - Create initial scaffolding\n\n`;

      output += `**3. Core Implementation** (Varies by task)\n`;
      output += `   - Implement main features\n`;
      output += `   - Build key components\n`;
      output += `   - Integrate dependencies\n\n`;

      output += `**4. Testing & Review** (Hybrid)\n`;
      output += `   - Write and run tests\n`;
      output += `   - Code review and refinement\n`;
      output += `   - Fix bugs and issues\n\n`;

      output += `**5. Documentation & Polish** (AI-suitable)\n`;
      output += `   - Write documentation\n`;
      output += `   - Clean up code\n`;
      output += `   - Final review\n\n`;

      if (activeTasks.length > 0) {
        output += `### Existing Tasks to Categorize\n`;
        activeTasks.forEach((t: any) => {
          output += `- ${t.name}${t.priority !== 'none' ? ` [${t.priority}]` : ''}\n`;
        });
        output += `\n`;
      }

      output += `---\n`;
      output += `**Next Steps:** Would you like me to create specific tasks for any of these phases? `;
      output += `I can also suggest dependencies between tasks to ensure proper execution order.\n`;

      return textResult(output);
    }
  );

  // ── prioritize_inbox ────────────────────────────────────────────────
  server.tool(
    'prioritize_inbox',
    'Analyze and rank all unprocessed inbox items by urgency, importance, due dates, context richness, and age.',
    {},
    async () => {
      const data = store.loadData();
      const inbox = data.projects.find((p: any) => p.isInbox || p.id === 'inbox');
      if (!inbox || inbox.tasks.length === 0) {
        return textResult('Inbox is empty! No items to prioritize.');
      }

      const inboxTasks = inbox.tasks.filter((t: any) => t.status === 'todo');
      if (inboxTasks.length === 0) {
        return textResult('No unprocessed inbox items. All tasks have been organized.');
      }

      const today = todayDate();

      // Score and prioritize
      const prioritized = inboxTasks.map((task: any) => {
        const fullText = `${task.name} ${task.description || ''} ${task.context || ''}`.toLowerCase();
        let suggestedPriority = 'medium';
        let score = 50;
        const signals: string[] = [];

        // Urgency signals
        if (fullText.includes('urgent') || fullText.includes('asap') || fullText.includes('emergency')) {
          suggestedPriority = 'urgent';
          score += 40;
          signals.push('urgency keywords');
        } else if (fullText.includes('important') || fullText.includes('deadline') || fullText.includes('due')) {
          suggestedPriority = 'high';
          score += 25;
          signals.push('importance keywords');
        } else if (fullText.includes('eventually') || fullText.includes('someday') || fullText.includes('nice to have')) {
          suggestedPriority = 'low';
          score -= 20;
          signals.push('low-priority keywords');
        }

        // Due date
        if (task.dueDate) {
          if (task.dueDate < today) {
            suggestedPriority = 'urgent';
            score += 50;
            signals.push('OVERDUE');
          } else if (task.dueDate === today) {
            if (suggestedPriority !== 'urgent') suggestedPriority = 'high';
            score += 30;
            signals.push('due today');
          }
        }

        // Context richness (more context = probably more thought through)
        if (task.context && task.context.length > 100) {
          score += 10;
          signals.push('detailed context');
        }

        // Age (older items might need attention)
        const age = (Date.now() - new Date(task.createdAt).getTime()) / (1000 * 60 * 60 * 24);
        if (age > 7) {
          score += 5;
          signals.push(`${Math.floor(age)} days old`);
        }

        return { task, suggestedPriority, score, signals };
      });

      prioritized.sort((a: any, b: any) => b.score - a.score);

      let output = `## Inbox Prioritization (${inboxTasks.length} items)\n\n`;
      output += `Items ranked by suggested importance:\n\n`;

      prioritized.forEach((item: any, index: number) => {
        output += `### ${index + 1}. ${item.task.name}\n`;
        output += `- **ID:** ${item.task.id}\n`;
        output += `- **Current Priority:** ${item.task.priority}\n`;
        output += `- **Suggested Priority:** ${item.suggestedPriority}\n`;
        if (item.signals.length > 0) {
          output += `- **Signals:** ${item.signals.join(', ')}\n`;
        }
        output += `\n`;
      });

      output += `---\n`;
      output += `### Summary\n`;
      const urgent = prioritized.filter((p: any) => p.suggestedPriority === 'urgent').length;
      const high = prioritized.filter((p: any) => p.suggestedPriority === 'high').length;
      const medium = prioritized.filter((p: any) => p.suggestedPriority === 'medium').length;
      const low = prioritized.filter((p: any) => p.suggestedPriority === 'low').length;

      output += `- Urgent: ${urgent}\n`;
      output += `- High: ${high}\n`;
      output += `- Medium: ${medium}\n`;
      output += `- Low: ${low}\n`;
      output += `\nUse \`update_task\` to apply suggested priorities.\n`;

      return textResult(output);
    }
  );
}
