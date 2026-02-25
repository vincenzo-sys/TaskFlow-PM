import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { DataStore } from '../data/store.js';
import { textResult, errorResult } from '../types.js';
import { generateId, todayDate, getAllTasks, findTask } from '../helpers.js';

export function registerProjectMgmtTools(server: McpServer, store: DataStore): void {

  // ── create_project ──────────────────────────────────────────────────
  server.tool(
    'create_project',
    'Create a new project in TaskFlow.',
    {
      name: z.string().describe('Project name (required)'),
      description: z.string().optional().describe('Project description'),
      color: z.string().optional().describe('Hex color for the project (default: #6366f1)'),
    },
    async (args) => {
      const data = await store.loadData();

      const existing = data.projects.find(
        (p: any) => p.name.toLowerCase() === args.name.toLowerCase()
      );
      if (existing) {
        return errorResult(`Project "${args.name}" already exists`);
      }

      const project = {
        id: generateId(),
        name: args.name,
        description: args.description || '',
        color: args.color || '#6366f1',
        tasks: [],
        createdAt: new Date().toISOString(),
      };

      data.projects.push(project);
      await store.saveData(data);

      return textResult(`Created project: "${project.name}"`);
    }
  );

  // ── delete_project ──────────────────────────────────────────────────
  server.tool(
    'delete_project',
    'Delete a project and all its tasks. Cannot delete the Inbox.',
    {
      projectId: z.string().optional().describe('Project ID to delete'),
      projectName: z.string().optional().describe('Project name to delete (case-insensitive)'),
    },
    async (args) => {
      if (!args.projectId && !args.projectName) {
        return errorResult('projectId or projectName is required');
      }

      const data = await store.loadData();
      let projectIndex = -1;

      if (args.projectId) {
        projectIndex = data.projects.findIndex((p: any) => p.id === args.projectId);
      } else if (args.projectName) {
        projectIndex = data.projects.findIndex(
          (p: any) => p.name.toLowerCase() === args.projectName!.toLowerCase()
        );
      }

      const project = data.projects[projectIndex];

      if (!project || projectIndex === -1) {
        return errorResult('Project not found');
      }

      if (project.isInbox || project.id === 'inbox') {
        return errorResult('Cannot delete the Inbox project');
      }

      const taskCount = project.tasks.length;
      const projectName = project.name;

      data.projects.splice(projectIndex, 1);
      await store.saveData(data);

      return textResult(`Deleted project "${projectName}" and ${taskCount} tasks`);
    }
  );

  // ── move_task_to_project ────────────────────────────────────────────
  server.tool(
    'move_task_to_project',
    'Move a task from one project to another.',
    {
      taskId: z.string().describe('ID of the task to move'),
      projectId: z.string().describe('ID of the target project'),
    },
    async (args) => {
      const data = await store.loadData();

      const moveResult = findTask(data, args.taskId);
      if (!moveResult) {
        return errorResult(`Task ${args.taskId} not found`);
      }

      const targetProject = data.projects.find((p: any) => p.id === args.projectId);
      if (!targetProject) {
        return errorResult(`Project ${args.projectId} not found`);
      }

      // Remove from source project
      const sourceProject = moveResult.project;
      const taskIndex = sourceProject.tasks.findIndex((t: any) => t.id === args.taskId);
      if (taskIndex === -1) {
        return errorResult('Task not found in source project');
      }
      const [movedTask] = sourceProject.tasks.splice(taskIndex, 1);
      movedTask.updatedAt = new Date().toISOString();

      // Add to target project
      targetProject.tasks.push(movedTask);
      await store.saveData(data);

      return textResult(`Moved "${movedTask.name}" from "${sourceProject.name}" to "${targetProject.name}"`);
    }
  );

  // ── create_category ─────────────────────────────────────────────────
  server.tool(
    'create_category',
    'Create a new category for organizing projects.',
    {
      name: z.string().describe('Category name (required)'),
      color: z.string().optional().describe('Hex color for the category (default: #6366f1)'),
    },
    async (args) => {
      const data = await store.loadData();

      // Initialize categories if missing
      if (!data.categories) {
        data.categories = [];
      }

      const maxOrder = Math.max(0, ...data.categories.map((c: any) => c.order || 0));
      const category = {
        id: generateId(),
        name: args.name,
        color: args.color || '#6366f1',
        order: maxOrder + 1,
        collapsed: false,
      };

      data.categories.push(category);
      await store.saveData(data);

      return textResult(`Category created!\n\nName: ${category.name}\nColor: ${category.color}\nID: ${category.id}`);
    }
  );

  // ── get_categories ──────────────────────────────────────────────────
  server.tool(
    'get_categories',
    'Get all project categories with task counts.',
    {},
    async () => {
      const data = await store.loadData();

      // Initialize categories if missing
      if (!data.categories) {
        data.categories = [
          { id: 'cat-work', name: 'Work', color: '#6366f1', order: 0, collapsed: false },
          { id: 'cat-personal', name: 'Personal', color: '#10b981', order: 1, collapsed: false },
          { id: 'cat-side', name: 'Side Projects', color: '#f59e0b', order: 2, collapsed: false },
        ];
        await store.saveData(data);
      }

      const categories = data.categories.map((cat: any) => {
        const projects = data.projects.filter((p: any) => p.categoryId === cat.id && !p.isInbox);
        const activeTasks = projects.reduce(
          (sum: number, p: any) => sum + p.tasks.filter((t: any) => t.status !== 'done').length, 0
        );
        const completedTasks = projects.reduce(
          (sum: number, p: any) => sum + p.tasks.filter((t: any) => t.status === 'done').length, 0
        );

        return {
          id: cat.id,
          name: cat.name,
          color: cat.color,
          projectCount: projects.length,
          activeTasks,
          completedTasks,
        };
      });

      // Count uncategorized
      const uncategorized = data.projects.filter((p: any) => !p.categoryId && !p.isInbox);
      if (uncategorized.length > 0) {
        categories.push({
          id: null,
          name: 'Uncategorized',
          color: '#9ca3af',
          projectCount: uncategorized.length,
          activeTasks: uncategorized.reduce(
            (sum: number, p: any) => sum + p.tasks.filter((t: any) => t.status !== 'done').length, 0
          ),
          completedTasks: uncategorized.reduce(
            (sum: number, p: any) => sum + p.tasks.filter((t: any) => t.status === 'done').length, 0
          ),
        });
      }

      return textResult(JSON.stringify(categories, null, 2));
    }
  );

  // ── create_subproject ───────────────────────────────────────────────
  server.tool(
    'create_subproject',
    'Create a sub-project under a parent project.',
    {
      parentProjectId: z.string().describe('ID of the parent project'),
      name: z.string().describe('Sub-project name'),
      description: z.string().optional().describe('Sub-project description'),
      color: z.string().optional().describe('Hex color (defaults to parent color)'),
    },
    async (args) => {
      const data = await store.loadData();

      const parent = data.projects.find((p: any) => p.id === args.parentProjectId);
      if (!parent) {
        return errorResult(`Parent project ${args.parentProjectId} not found`);
      }

      const subproject = {
        id: generateId(),
        name: args.name,
        description: args.description || '',
        color: args.color || parent.color,
        parentProjectId: args.parentProjectId,
        level: (parent.level || 0) + 1,
        tasks: [],
        createdAt: new Date().toISOString(),
      };

      data.projects.push(subproject);
      await store.saveData(data);

      return textResult(`Created sub-project "${args.name}" under "${parent.name}"\nID: ${subproject.id}`);
    }
  );

  // ── get_project_tree ────────────────────────────────────────────────
  server.tool(
    'get_project_tree',
    'Get the full project hierarchy as a tree with progress stats.',
    {},
    async () => {
      const data = await store.loadData();
      const projects = data.projects.filter((p: any) => !p.isInbox);

      // Build tree structure
      const byId: Record<string, any> = {};

      projects.forEach((p: any) => {
        byId[p.id] = {
          ...p,
          children: [],
          progress: {
            total: p.tasks.length,
            completed: p.tasks.filter((t: any) => t.status === 'done').length,
            active: p.tasks.filter((t: any) => t.status !== 'done').length,
          },
        };
      });

      const tree: any[] = [];
      projects.forEach((p: any) => {
        if (p.parentProjectId && byId[p.parentProjectId]) {
          byId[p.parentProjectId].children.push(byId[p.id]);
        } else if (!p.parentProjectId) {
          tree.push(byId[p.id]);
        }
      });

      function renderTree(nodes: any[], indent: number = 0): string {
        let output = '';
        nodes.forEach((node: any) => {
          const prefix = '  '.repeat(indent);
          const percent = node.progress.total > 0
            ? Math.round(node.progress.completed / node.progress.total * 100)
            : 0;
          output += `${prefix}**${node.name}** (${node.progress.completed}/${node.progress.total} - ${percent}%)\n`;
          if (node.children.length > 0) {
            output += renderTree(node.children, indent + 1);
          }
        });
        return output;
      }

      let output = `## Project Hierarchy\n\n`;
      output += renderTree(tree);

      return textResult(output);
    }
  );

  // ── get_project_analytics ───────────────────────────────────────────
  server.tool(
    'get_project_analytics',
    'Get analytics for all projects over a date range (default: last 30 days).',
    {
      startDate: z.string().optional().describe('Start date YYYY-MM-DD (default: 30 days ago)'),
      endDate: z.string().optional().describe('End date YYYY-MM-DD (default: today)'),
    },
    async (args) => {
      const data = await store.loadData();
      const today = new Date();
      const startDate = args.startDate || new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      const endDate = args.endDate || today.toISOString().split('T')[0];

      const projectAnalytics = data.projects.map((project: any) => {
        const completed = project.tasks.filter((t: any) => {
          if (t.status !== 'done' || !t.completedAt) return false;
          const date = t.completedAt.split('T')[0];
          return date >= startDate && date <= endDate;
        });

        const active = project.tasks.filter((t: any) => t.status !== 'done');
        const blocked = project.tasks.filter((t: any) => t.status === 'waiting');
        const totalMinutes = completed.reduce((sum: number, t: any) => sum + (t.estimatedMinutes || 30), 0);

        return {
          name: project.name,
          color: project.color,
          isInbox: project.isInbox,
          completed: completed.length,
          active: active.length,
          blocked: blocked.length,
          totalMinutes,
          completionRate: project.tasks.length > 0
            ? Math.round(completed.length / project.tasks.length * 100)
            : 0,
        };
      });

      let output = `## Project Analytics: ${startDate} to ${endDate}\n\n`;

      projectAnalytics
        .filter((p: any) => !p.isInbox)
        .sort((a: any, b: any) => b.completed - a.completed)
        .forEach((p: any) => {
          output += `### ${p.name}\n`;
          output += `- Completed: ${p.completed} tasks\n`;
          output += `- Active: ${p.active} tasks\n`;
          output += `- Blocked: ${p.blocked} tasks\n`;
          output += `- Time: ${Math.floor(p.totalMinutes / 60)}h ${p.totalMinutes % 60}m\n`;
          output += `- Completion Rate: ${p.completionRate}%\n\n`;
        });

      return textResult(output);
    }
  );
}
