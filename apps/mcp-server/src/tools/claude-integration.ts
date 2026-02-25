import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import fs from 'fs';
import { DataStore } from '../data/store.js';
import { textResult, errorResult } from '../types.js';
import { generateId, todayDate, getAllTasks, findTask } from '../helpers.js';

export function registerClaudeIntegrationTools(server: McpServer, store: DataStore): void {

  // ── sync_claude_queue ───────────────────────────────────────────────
  server.tool(
    'sync_claude_queue',
    'Generate a Claude Queue markdown file with all tasks/subtasks assigned to Claude. Writes to the shared Claude Queue directory.',
    {
      todayOnly: z.boolean().optional().describe('Only include tasks scheduled/due today (default: false)'),
    },
    async (args) => {
      const data = await store.loadData();
      const todayOnly = args.todayOnly || false;
      const today = todayDate();
      const now = new Date().toISOString();

      // Collect all tasks and subtasks assigned to Claude that are not done
      const queueItems: Array<{
        type: 'task' | 'subtask';
        task: any;
        parentTask?: any;
        project: any;
      }> = [];

      for (const project of data.projects) {
        for (const task of project.tasks) {
          // Check main task assigned to Claude
          if (task.assignedTo === 'claude' && task.status !== 'done') {
            if (todayOnly && task.scheduledDate !== today && task.dueDate !== today) {
              continue;
            }
            queueItems.push({ type: 'task', task, project });
          }

          // Check subtasks assigned to Claude
          if (task.subtasks) {
            for (const subtask of task.subtasks) {
              if (subtask.assignedTo === 'claude' && subtask.status !== 'done') {
                if (todayOnly && task.scheduledDate !== today && task.dueDate !== today) {
                  continue;
                }
                queueItems.push({ type: 'subtask', task: subtask, parentTask: task, project });
              }
            }
          }
        }
      }

      if (queueItems.length === 0) {
        const filterNote = todayOnly ? ' for today' : '';
        return textResult(`No tasks assigned to Claude${filterNote}. Nothing to sync.`);
      }

      // Sort by priority
      const priorityOrder: Record<string, number> = { urgent: 0, high: 1, medium: 2, low: 3, none: 4 };
      queueItems.sort((a, b) => {
        const aPriority = a.type === 'task' ? (a.task.priority || 'none') : (a.parentTask?.priority || 'none');
        const bPriority = b.type === 'task' ? (b.task.priority || 'none') : (b.parentTask?.priority || 'none');
        return (priorityOrder[aPriority] || 4) - (priorityOrder[bPriority] || 4);
      });

      // Build markdown queue file
      let md = `# Claude Queue\n\n`;
      md += `> **Owner:** Claude\n`;
      md += `> **Generated:** ${now}\n`;
      md += `> **Date:** ${today}\n`;
      md += `> **Run Order:** Top to bottom by priority\n`;
      md += `> **Output Location:** C:\\\\Users\\\\vince\\\\OneDrive\\\\Vincenzo\\\\Claude\\\\outputs\\\\\n\n`;
      md += `---\n\n`;
      md += `## Tasks (${queueItems.length})\n\n`;

      let taskNumber = 0;
      for (const item of queueItems) {
        taskNumber++;
        const isSubtask = item.type === 'subtask';
        const mainTask = isSubtask ? item.parentTask : item.task;
        const displayTask = item.task;
        const project = item.project;

        md += `### ${taskNumber}. ${isSubtask ? '[Subtask] ' : ''}${displayTask.name}\n\n`;
        md += `- [ ] **Status:** ${displayTask.status}\n`;
        md += `- **ID:** ${displayTask.id}\n`;
        md += `- **Project:** ${project.name}\n`;

        const priority = isSubtask ? (mainTask?.priority || 'none') : (displayTask.priority || 'none');
        if (priority !== 'none') {
          md += `- **Priority:** ${priority}\n`;
        }

        const dueDate = isSubtask ? mainTask?.dueDate : displayTask.dueDate;
        if (dueDate) {
          md += `- **Due:** ${dueDate}\n`;
        }

        if (isSubtask && mainTask) {
          md += `- **Parent Task:** ${mainTask.name} (${mainTask.id})\n`;
        }

        // Objective = description
        const description = isSubtask ? (mainTask?.description || '') : (displayTask.description || '');
        if (description) {
          md += `\n**Objective:**\n${description}\n`;
        }

        // Context
        const context = isSubtask ? (mainTask?.context || '') : (displayTask.context || '');
        if (context) {
          md += `\n**Context:**\n${context}\n`;
        }

        // Subtasks (for main tasks only)
        if (!isSubtask && mainTask.subtasks && mainTask.subtasks.length > 0) {
          md += `\n**Subtasks:**\n`;
          for (const st of mainTask.subtasks) {
            const done = st.status === 'done' ? 'x' : ' ';
            const assignee = st.assignedTo ? ` [${st.assignedTo}]` : '';
            md += `- [${done}] ${st.name}${assignee}\n`;
          }
        }

        md += `\n---\n\n`;
      }

      // Completion checklist
      md += `## Completion Checklist\n\n`;
      for (let i = 1; i <= taskNumber; i++) {
        const item = queueItems[i - 1];
        const name = item.task.name;
        md += `- [ ] Task ${i}: ${name}\n`;
      }
      md += `\n`;

      // Done summary placeholder
      md += `## Done Summary\n\n`;
      md += `_Fill in after completing all tasks._\n\n`;
      md += `- **Tasks Completed:** 0/${taskNumber}\n`;
      md += `- **Time Taken:** TBD\n`;
      md += `- **Notes:** \n`;

      // Write to file
      const queueDir = 'C:\\Users\\vince\\OneDrive\\Vincenzo\\Claude\\Claude Queue';
      const queuePath = `${queueDir}\\claude_queue.md`;

      try {
        // Ensure directory exists
        if (!fs.existsSync(queueDir)) {
          fs.mkdirSync(queueDir, { recursive: true });
        }
        fs.writeFileSync(queuePath, md, 'utf-8');
      } catch (err: any) {
        return errorResult(`Failed to write queue file: ${err.message}`);
      }

      // Build response
      let output = `## Claude Queue Synced\n\n`;
      output += `**File:** ${queuePath}\n`;
      output += `**Tasks:** ${queueItems.length}\n`;
      output += `**Filter:** ${todayOnly ? 'Today only' : 'All pending'}\n\n`;

      output += `### Task List\n\n`;
      for (let i = 0; i < queueItems.length; i++) {
        const item = queueItems[i];
        const isSubtask = item.type === 'subtask';
        const priority = isSubtask ? (item.parentTask?.priority || 'none') : (item.task.priority || 'none');
        const priorityLabel = priority !== 'none' ? ` !${priority}` : '';
        const typeLabel = isSubtask ? ' (subtask)' : '';
        output += `${i + 1}. ${item.task.name}${typeLabel}${priorityLabel} [${item.project.name}]\n`;
      }

      return textResult(output);
    }
  );
}
