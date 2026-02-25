import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { DataStore } from '../data/store.js';
import { textResult, errorResult } from '../types.js';
import { generateId, todayDate, getAllTasks, findTask } from '../helpers.js';

export function registerNotebookTools(server: McpServer, store: DataStore): void {

  // ── get_project_notebooks ───────────────────────────────────────────
  server.tool(
    'get_project_notebooks',
    'List all notebooks for a project with previews.',
    {
      projectId: z.string().describe('Project ID'),
    },
    async (args) => {
      const data = await store.loadData();

      const project = data.projects.find((p: any) => p.id === args.projectId);
      if (!project) {
        return errorResult(`Project ${args.projectId} not found`);
      }

      const notebooks = project.notebooks || [];

      if (notebooks.length === 0) {
        return textResult(`No notebooks in "${project.name}". Use create_notebook to add one.`);
      }

      let output = `## Notebooks in "${project.name}" (${notebooks.length})\n\n`;

      // Show pinned first, then by updatedAt
      const sorted = [...notebooks].sort((a: any, b: any) => {
        if (a.pinned && !b.pinned) return -1;
        if (!a.pinned && b.pinned) return 1;
        return (b.updatedAt || b.createdAt || '').localeCompare(a.updatedAt || a.createdAt || '');
      });

      for (const nb of sorted) {
        const pinned = nb.pinned ? ' (pinned)' : '';
        const icon = nb.icon || '\ud83d\udcd3';
        const preview = nb.content
          ? nb.content.substring(0, 120).replace(/\n/g, ' ') + (nb.content.length > 120 ? '...' : '')
          : '_empty_';
        const updated = nb.updatedAt ? nb.updatedAt.split('T')[0] : 'never';

        output += `### ${icon} ${nb.title}${pinned}\n`;
        output += `- **ID:** ${nb.id}\n`;
        output += `- **Updated:** ${updated}\n`;
        output += `- **Preview:** ${preview}\n\n`;
      }

      return textResult(output);
    }
  );

  // ── get_notebook ────────────────────────────────────────────────────
  server.tool(
    'get_notebook',
    'Get the full content of a specific notebook.',
    {
      projectId: z.string().describe('Project ID'),
      notebookId: z.string().describe('Notebook ID'),
    },
    async (args) => {
      const data = await store.loadData();

      const project = data.projects.find((p: any) => p.id === args.projectId);
      if (!project) {
        return errorResult(`Project ${args.projectId} not found`);
      }

      const notebooks = project.notebooks || [];
      const notebook = notebooks.find((nb: any) => nb.id === args.notebookId);
      if (!notebook) {
        return errorResult(`Notebook ${args.notebookId} not found in "${project.name}"`);
      }

      let output = `## ${notebook.icon || '\ud83d\udcd3'} ${notebook.title}\n\n`;
      output += `**Project:** ${project.name}\n`;
      output += `**ID:** ${notebook.id}\n`;
      output += `**Pinned:** ${notebook.pinned ? 'Yes' : 'No'}\n`;
      output += `**Created:** ${notebook.createdAt || 'unknown'}\n`;
      output += `**Updated:** ${notebook.updatedAt || 'unknown'}\n\n`;
      output += `---\n\n`;
      output += notebook.content || '_No content yet._';

      return textResult(output);
    }
  );

  // ── create_notebook ─────────────────────────────────────────────────
  server.tool(
    'create_notebook',
    'Create a new notebook in a project.',
    {
      projectId: z.string().describe('Project ID'),
      title: z.string().describe('Notebook title'),
      content: z.string().optional().describe('Initial content (markdown)'),
      icon: z.string().optional().describe('Emoji icon for the notebook'),
    },
    async (args) => {
      const data = await store.loadData();

      const project = data.projects.find((p: any) => p.id === args.projectId);
      if (!project) {
        return errorResult(`Project ${args.projectId} not found`);
      }

      if (!project.notebooks) project.notebooks = [];

      const now = new Date().toISOString();
      const notebook = {
        id: `nb-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
        title: args.title,
        content: args.content || '',
        icon: args.icon || '\ud83d\udcd3',
        pinned: false,
        createdAt: now,
        updatedAt: now,
      };

      project.notebooks.push(notebook);
      await store.saveData(data);

      return textResult(`Created notebook "${notebook.title}" in "${project.name}"\nID: ${notebook.id}`);
    }
  );

  // ── update_notebook ─────────────────────────────────────────────────
  server.tool(
    'update_notebook',
    'Update an existing notebook (title, content, icon, or pinned status).',
    {
      projectId: z.string().describe('Project ID'),
      notebookId: z.string().describe('Notebook ID'),
      title: z.string().optional().describe('New title'),
      content: z.string().optional().describe('New content (replaces existing)'),
      icon: z.string().optional().describe('New emoji icon'),
      pinned: z.boolean().optional().describe('Pin or unpin the notebook'),
    },
    async (args) => {
      const data = await store.loadData();

      const project = data.projects.find((p: any) => p.id === args.projectId);
      if (!project) {
        return errorResult(`Project ${args.projectId} not found`);
      }

      const notebooks = project.notebooks || [];
      const notebook = notebooks.find((nb: any) => nb.id === args.notebookId);
      if (!notebook) {
        return errorResult(`Notebook ${args.notebookId} not found in "${project.name}"`);
      }

      const changes: string[] = [];

      if (args.title !== undefined) {
        notebook.title = args.title;
        changes.push('title');
      }
      if (args.content !== undefined) {
        notebook.content = args.content;
        changes.push('content');
      }
      if (args.icon !== undefined) {
        notebook.icon = args.icon;
        changes.push('icon');
      }
      if (args.pinned !== undefined) {
        notebook.pinned = args.pinned;
        changes.push(args.pinned ? 'pinned' : 'unpinned');
      }

      notebook.updatedAt = new Date().toISOString();
      await store.saveData(data);

      return textResult(`Updated notebook "${notebook.title}" (${changes.join(', ')})`);
    }
  );

  // ── delete_notebook ─────────────────────────────────────────────────
  server.tool(
    'delete_notebook',
    'Delete a notebook from a project.',
    {
      projectId: z.string().describe('Project ID'),
      notebookId: z.string().describe('Notebook ID'),
    },
    async (args) => {
      const data = await store.loadData();

      const project = data.projects.find((p: any) => p.id === args.projectId);
      if (!project) {
        return errorResult(`Project ${args.projectId} not found`);
      }

      const notebooks = project.notebooks || [];
      const index = notebooks.findIndex((nb: any) => nb.id === args.notebookId);
      if (index === -1) {
        return errorResult(`Notebook ${args.notebookId} not found in "${project.name}"`);
      }

      const title = notebooks[index].title;
      notebooks.splice(index, 1);
      await store.saveData(data);

      return textResult(`Deleted notebook "${title}" from "${project.name}"`);
    }
  );

  // ── append_to_notebook ──────────────────────────────────────────────
  server.tool(
    'append_to_notebook',
    'Append content to an existing notebook with a separator.',
    {
      projectId: z.string().describe('Project ID'),
      notebookId: z.string().describe('Notebook ID'),
      content: z.string().describe('Content to append (markdown)'),
      separator: z.string().optional().describe('Separator between existing and new content (default: \\n\\n---\\n\\n)'),
    },
    async (args) => {
      const data = await store.loadData();

      const project = data.projects.find((p: any) => p.id === args.projectId);
      if (!project) {
        return errorResult(`Project ${args.projectId} not found`);
      }

      const notebooks = project.notebooks || [];
      const notebook = notebooks.find((nb: any) => nb.id === args.notebookId);
      if (!notebook) {
        return errorResult(`Notebook ${args.notebookId} not found in "${project.name}"`);
      }

      const separator = args.separator !== undefined ? args.separator : '\n\n---\n\n';

      if (notebook.content) {
        notebook.content += separator + args.content;
      } else {
        notebook.content = args.content;
      }

      notebook.updatedAt = new Date().toISOString();
      await store.saveData(data);

      const previewLength = Math.min(args.content.length, 80);
      const preview = args.content.substring(0, previewLength) + (args.content.length > 80 ? '...' : '');

      return textResult(`Appended to "${notebook.title}":\n${preview}`);
    }
  );
}
