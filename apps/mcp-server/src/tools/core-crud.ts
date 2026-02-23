import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { DataStore } from '../data/store.js';
import { textResult, errorResult } from '../types.js';
import { generateId, todayDate, getAllTasks, findTask, formatTaskForDisplay } from '../helpers.js';

export function registerCoreCrudTools(server: McpServer, store: DataStore): void {

  // ── get_all_tasks ───────────────────────────────────────────────────
  server.tool(
    'get_all_tasks',
    'Get all tasks from TaskFlow. Returns tasks organized by status with project and tag info.',
    {
      status: z.enum(['all', 'todo', 'in-progress', 'review', 'done']).optional().describe('Filter by status. Default: all'),
      project: z.string().optional().describe('Filter by project name'),
    },
    async (args) => {
      const data = store.loadData();
      let tasks = getAllTasks(data);

      if (args.status && args.status !== 'all') {
        tasks = tasks.filter((t: any) => t.status === args.status);
      }
      if (args.project) {
        tasks = tasks.filter((t: any) =>
          t.projectName?.toLowerCase().includes(args.project!.toLowerCase())
        );
      }

      const output = tasks.map((task: any) => {
        const project = data.projects.find((p: any) => p.id === task.projectId);
        return {
          id: task.id,
          name: task.name,
          status: task.status,
          priority: task.priority,
          dueDate: task.dueDate,
          project: project?.name || 'Inbox',
          subtasks: task.subtasks?.length || 0,
          description: task.description,
        };
      });

      return textResult(JSON.stringify(output, null, 2));
    }
  );

  // ── create_task ─────────────────────────────────────────────────────
  server.tool(
    'create_task',
    'Create a new task in TaskFlow. Supports scheduling with time blocks.',
    {
      name: z.string().describe('Task name (required)'),
      description: z.string().optional().describe('Task description'),
      context: z.string().optional().describe('Brain dump / context for AI assistance'),
      project: z.string().optional().describe('Project name to add task to. Creates project if doesn\'t exist.'),
      priority: z.enum(['none', 'low', 'medium', 'high', 'urgent']).optional().describe('Task priority'),
      dueDate: z.string().optional().describe('Due date in YYYY-MM-DD format'),
      scheduledTime: z.string().optional().describe('Scheduled start time in HH:MM format (e.g., \'09:00\')'),
      scheduledDate: z.string().optional().describe('Scheduled date in YYYY-MM-DD format. Defaults to dueDate or today.'),
      estimatedMinutes: z.number().optional().describe('Estimated duration in minutes (15, 30, 45, 60, 90, 120)'),
      tags: z.array(z.string()).optional().describe('Tag names to apply'),
      status: z.enum(['todo', 'ready', 'in-progress', 'waiting', 'done']).optional().describe('Initial status. Default: todo'),
      executionType: z.enum(['ai', 'manual', 'hybrid']).optional().describe('How the task should be executed: \'ai\' = Claude can do autonomously, \'manual\' = requires human action, \'hybrid\' = collaborative. Default: manual'),
      startDate: z.string().optional().describe('Timeline start date in YYYY-MM-DD format (for Gantt chart)'),
      endDate: z.string().optional().describe('Timeline end date in YYYY-MM-DD format (for Gantt chart)'),
      assignee: z.string().optional().describe('Team member name to assign this task to'),
    },
    async (args) => {
      const data = store.loadData();

      // Find or create project
      let project: any = null;
      if (args.project) {
        project = data.projects.find(
          (p: any) => p.name.toLowerCase() === args.project!.toLowerCase()
        );
        if (!project) {
          project = {
            id: generateId(),
            name: args.project,
            description: '',
            color: '#6366f1',
            tasks: [],
            createdAt: new Date().toISOString(),
          };
          data.projects.push(project);
        }
      } else {
        project = data.projects.find((p: any) => p.isInbox || p.id === 'inbox');
        if (!project) {
          project = { id: 'inbox', name: 'Inbox', color: '#6366f1', tasks: [], isInbox: true };
          data.projects.unshift(project);
        }
      }

      // Resolve tag IDs
      const tagIds: string[] = [];
      if (args.tags) {
        for (const tagName of args.tags) {
          let tag = data.tags.find(
            (t: any) => t.name.toLowerCase() === tagName.toLowerCase()
          );
          if (!tag) {
            tag = { id: generateId(), name: tagName, color: '#6366f1' };
            data.tags.push(tag);
          }
          tagIds.push(tag.id);
        }
      }

      const today = todayDate();
      const task: any = {
        id: generateId(),
        name: args.name,
        description: args.description || '',
        context: args.context || '',
        status: args.status || 'todo',
        priority: args.priority || 'none',
        dueDate: args.dueDate || null,
        scheduledTime: args.scheduledTime || null,
        scheduledDate: args.scheduledDate || args.dueDate || (args.scheduledTime ? today : null),
        estimatedMinutes: args.estimatedMinutes || null,
        executionType: args.executionType || 'manual',
        startDate: args.startDate || null,
        endDate: args.endDate || null,
        assignee: args.assignee || null,
        tags: tagIds,
        subtasks: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        completedAt: null,
      };

      // If scheduled but no due date, set due date to scheduled date
      if (task.scheduledDate && !task.dueDate) {
        task.dueDate = task.scheduledDate;
      }

      project.tasks.push(task);
      store.saveData(data);

      let response = `Created task: "${task.name}"\nID: ${task.id}\nProject: ${project.name}`;
      if (task.scheduledTime) {
        response += `\nScheduled: ${task.scheduledTime} on ${task.scheduledDate}`;
        if (task.estimatedMinutes) {
          response += ` (${task.estimatedMinutes}m)`;
        }
      }

      return textResult(response);
    }
  );

  // ── create_subtasks ─────────────────────────────────────────────────
  server.tool(
    'create_subtasks',
    'Break down a task into subtasks. Great for action planning.',
    {
      taskId: z.string().describe('ID of the parent task'),
      subtasks: z.array(z.string()).describe('List of subtask names to create'),
    },
    async (args) => {
      const data = store.loadData();
      const result = findTask(data, args.taskId);
      if (!result) {
        return errorResult(`Task ${args.taskId} not found`);
      }

      const { task } = result;
      if (!task.subtasks) task.subtasks = [];

      const created: string[] = [];
      for (const subtaskName of args.subtasks) {
        const subtask = {
          id: generateId(),
          name: subtaskName,
          status: 'todo',
          priority: 'none',
          createdAt: new Date().toISOString(),
        };
        task.subtasks.push(subtask);
        created.push(subtaskName);
      }

      store.saveData(data);

      return textResult(
        `Added ${created.length} subtasks to "${task.name}":\n${created.map((s) => `- ${s}`).join('\n')}`
      );
    }
  );

  // ── create_subtasks_enhanced ────────────────────────────────────────
  server.tool(
    'create_subtasks_enhanced',
    'Create subtasks with time estimates and scheduling capability.',
    {
      taskId: z.string().describe('ID of the parent task'),
      subtasks: z.array(z.object({
        name: z.string().describe('Subtask name'),
        estimatedMinutes: z.number().optional().describe('Estimated duration in minutes'),
        scheduledTime: z.string().optional().describe('Scheduled time in HH:MM format'),
        scheduledDate: z.string().optional().describe('Scheduled date in YYYY-MM-DD format'),
      })).describe('Subtasks to create with optional time estimates and scheduling'),
    },
    async (args) => {
      const data = store.loadData();
      const result = findTask(data, args.taskId);
      if (!result) {
        return errorResult(`Task ${args.taskId} not found`);
      }

      const { task } = result;
      if (!task.subtasks) task.subtasks = [];

      const created: Array<{ name: string; duration?: number; scheduled?: string | null }> = [];
      for (const st of args.subtasks) {
        if (!st.name) continue;

        const subtask = {
          id: generateId(),
          name: st.name,
          status: 'todo',
          estimatedMinutes: st.estimatedMinutes || null,
          scheduledTime: st.scheduledTime || null,
          scheduledDate: st.scheduledDate || null,
          createdAt: new Date().toISOString(),
        };

        task.subtasks.push(subtask);
        created.push({
          name: st.name,
          duration: st.estimatedMinutes,
          scheduled: st.scheduledTime ? `${st.scheduledTime} on ${st.scheduledDate || 'today'}` : null,
        });
      }

      store.saveData(data);

      let output = `## Created ${created.length} Subtasks for "${task.name}"\n\n`;
      created.forEach((st) => {
        output += `- ${st.name}`;
        if (st.duration) output += ` (${st.duration}m)`;
        if (st.scheduled) output += ` @ ${st.scheduled}`;
        output += '\n';
      });

      return textResult(output);
    }
  );

  // ── complete_task ───────────────────────────────────────────────────
  server.tool(
    'complete_task',
    'Mark a task as complete.',
    {
      taskId: z.string().describe('ID of the task to complete'),
    },
    async (args) => {
      const data = store.loadData();
      const result = findTask(data, args.taskId);
      if (!result) {
        return errorResult(`Task ${args.taskId} not found`);
      }

      result.task.status = 'done';
      result.task.completedAt = new Date().toISOString();
      store.saveData(data);

      return textResult(`Completed: "${result.task.name}"`);
    }
  );

  // ── update_task ─────────────────────────────────────────────────────
  server.tool(
    'update_task',
    'Update a task\'s properties. Supports all task fields including scheduling, assignment, and execution type.',
    {
      taskId: z.string().describe('ID of the task to update'),
      name: z.string().optional().describe('Task name'),
      description: z.string().optional().describe('Task description'),
      context: z.string().optional().describe('Brain dump / context for AI processing'),
      status: z.enum(['todo', 'ready', 'in-progress', 'waiting', 'done']).optional().describe('Task status'),
      priority: z.enum(['none', 'low', 'medium', 'high', 'urgent']).optional().describe('Task priority'),
      dueDate: z.string().nullable().optional().describe('Due date (YYYY-MM-DD) or null to clear'),
      scheduledDate: z.string().nullable().optional().describe('Scheduled date (YYYY-MM-DD) or null to clear. Use this to add a task to Today.'),
      scheduledTime: z.string().nullable().optional().describe('Scheduled time (HH:MM) or null to clear'),
      estimatedMinutes: z.number().optional().describe('Estimated duration in minutes'),
      executionType: z.enum(['ai', 'manual', 'hybrid']).optional().describe('Who executes: ai (Claude alone), manual (human), hybrid (together)'),
      assignedTo: z.string().nullable().optional().describe('Assigned to: \'claude\', \'vin\', or null to clear'),
      startDate: z.string().nullable().optional().describe('Timeline start date (YYYY-MM-DD) or null to clear'),
      endDate: z.string().nullable().optional().describe('Timeline end date (YYYY-MM-DD) or null to clear'),
      assignee: z.string().nullable().optional().describe('Team member name or null to clear'),
    },
    async (args) => {
      const data = store.loadData();
      const result = findTask(data, args.taskId);
      if (!result) {
        return errorResult(`Task ${args.taskId} not found`);
      }

      const { task } = result;
      const changes: string[] = [];

      if (args.name !== undefined) { task.name = args.name; changes.push('name'); }
      if (args.description !== undefined) { task.description = args.description; changes.push('description'); }
      if (args.context !== undefined) { task.context = args.context; changes.push('context'); }
      if (args.status !== undefined) {
        task.status = args.status;
        if (args.status === 'done') {
          task.completedAt = new Date().toISOString();
        } else {
          task.completedAt = null;
        }
        changes.push('status -> ' + args.status);
      }
      if (args.priority !== undefined) { task.priority = args.priority; changes.push('priority -> ' + args.priority); }
      if (args.dueDate !== undefined) { task.dueDate = args.dueDate || null; changes.push('dueDate -> ' + (args.dueDate || 'cleared')); }
      if (args.scheduledDate !== undefined) { task.scheduledDate = args.scheduledDate || null; changes.push('scheduledDate -> ' + (args.scheduledDate || 'cleared')); }
      if (args.scheduledTime !== undefined) { task.scheduledTime = args.scheduledTime || null; changes.push('scheduledTime -> ' + (args.scheduledTime || 'cleared')); }
      if (args.estimatedMinutes !== undefined) { task.estimatedMinutes = args.estimatedMinutes; changes.push('estimate -> ' + args.estimatedMinutes + 'min'); }
      if (args.executionType !== undefined) { task.executionType = args.executionType; changes.push('type -> ' + args.executionType); }
      if (args.assignedTo !== undefined) { task.assignedTo = args.assignedTo || null; changes.push('assigned -> ' + (args.assignedTo || 'unassigned')); }
      if (args.startDate !== undefined) { task.startDate = args.startDate || null; changes.push('startDate -> ' + (args.startDate || 'cleared')); }
      if (args.endDate !== undefined) { task.endDate = args.endDate || null; changes.push('endDate -> ' + (args.endDate || 'cleared')); }
      if (args.assignee !== undefined) { task.assignee = args.assignee || null; changes.push('assignee -> ' + (args.assignee || 'unassigned')); }

      task.updatedAt = new Date().toISOString();
      store.saveData(data);

      return textResult(`Updated task: "${task.name}" (${changes.join(', ')})`);
    }
  );

  // ── delete_task ─────────────────────────────────────────────────────
  server.tool(
    'delete_task',
    'Delete a task permanently.',
    {
      taskId: z.string().describe('ID of the task to delete'),
    },
    async (args) => {
      const data = store.loadData();
      const result = findTask(data, args.taskId);
      if (!result) {
        return errorResult(`Task ${args.taskId} not found`);
      }

      const { task, project, parentTask } = result;
      const taskName = task.name;

      if (parentTask) {
        // It's a subtask
        parentTask.subtasks = parentTask.subtasks.filter((st: any) => st.id !== args.taskId);
      } else {
        // It's a main task
        project.tasks = project.tasks.filter((t: any) => t.id !== args.taskId);
      }

      store.saveData(data);
      return textResult(`Deleted task: "${taskName}"`);
    }
  );
}
