import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { DataStore } from './data/store.js';
import { LocalDataStore } from './data/local-store.js';
import { getAllTasks, formatTaskForDisplay } from './helpers.js';

// Tool registrations
import { registerCoreCrudTools } from './tools/core-crud.js';
import { registerViewTools } from './tools/views.js';
import { registerSchedulingTools } from './tools/scheduling.js';
import { registerProjectMgmtTools } from './tools/project-mgmt.js';
import { registerPlanningTools } from './tools/planning.js';
import { registerExecutionTools } from './tools/execution.js';
import { registerTimeGoalsTools } from './tools/time-goals.js';
import { registerUtilitiesTools } from './tools/utilities.js';
import { registerAiProcessingTools } from './tools/ai-processing.js';
import { registerRecapTools } from './tools/recap.js';
import { registerAnalyticsTools } from './tools/analytics.js';
import { registerNotebookTools } from './tools/notebooks.js';
import { registerClaudeIntegrationTools } from './tools/claude-integration.js';

const server = new McpServer({
  name: 'taskflow-mcp-server',
  version: '1.0.0',
});

// ── Initialize data store (local JSON) ────────────────────────────────

let store: DataStore;

// ── Resources ─────────────────────────────────────────────────────────

server.resource('all-tasks', 'taskflow://tasks', async (uri) => {
  const data = await store.loadData();
  const tasks = getAllTasks(data);

  let content = '# TaskFlow Tasks\n\n';

  const byStatus: Record<string, any[]> = {
    'todo': tasks.filter((t: any) => t.status === 'todo'),
    'in-progress': tasks.filter((t: any) => t.status === 'in-progress'),
    'review': tasks.filter((t: any) => t.status === 'review'),
    'done': tasks.filter((t: any) => t.status === 'done'),
  };

  for (const [status, statusTasks] of Object.entries(byStatus)) {
    if (statusTasks.length > 0) {
      content += `## ${status.toUpperCase()} (${statusTasks.length})\n`;
      for (const task of statusTasks) {
        const project = data.projects.find((p: any) => p.id === task.projectId);
        content += formatTaskForDisplay(task, project, data.tags) + '\n';
      }
      content += '\n';
    }
  }

  return { contents: [{ uri: uri.href, mimeType: 'text/plain', text: content }] };
});

server.resource('task-summary', 'taskflow://summary', async (uri) => {
  const data = await store.loadData();
  const tasks = getAllTasks(data);
  const today = new Date().toISOString().split('T')[0];

  const active = tasks.filter((t: any) => t.status !== 'done');
  const todayTasks = active.filter((t: any) => t.dueDate === today);
  const overdue = active.filter((t: any) => t.dueDate && t.dueDate < today);
  const highPriority = active.filter((t: any) => t.priority === 'high' || t.priority === 'urgent');

  const projectLines = data.projects
    .filter((p: any) => !p.isInbox)
    .map((p: any) => `- ${p.name}: ${p.tasks.filter((t: any) => t.status !== 'done').length} active tasks`)
    .join('\n');

  const content = [
    '# TaskFlow Summary',
    '',
    `**Total Active Tasks:** ${active.length}`,
    `**Due Today:** ${todayTasks.length}`,
    `**Overdue:** ${overdue.length}`,
    `**High Priority:** ${highPriority.length}`,
    '',
    '## Projects',
    projectLines,
    '',
  ].join('\n');

  return { contents: [{ uri: uri.href, mimeType: 'text/plain', text: content }] };
});

// ── Tool Registration ─────────────────────────────────────────────────

function registerAllTools(s: McpServer, st: DataStore): void {
  registerCoreCrudTools(s, st);
  registerViewTools(s, st);
  registerSchedulingTools(s, st);
  registerProjectMgmtTools(s, st);
  registerPlanningTools(s, st);
  registerExecutionTools(s, st);
  registerTimeGoalsTools(s, st);
  registerUtilitiesTools(s, st);
  registerAiProcessingTools(s, st);
  registerRecapTools(s, st);
  registerAnalyticsTools(s, st);
  registerNotebookTools(s, st);
  registerClaudeIntegrationTools(s, st);
}

// ── Start Server ──────────────────────────────────────────────────────

async function main() {
  store = new LocalDataStore();
  registerAllTools(server, store);

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('TaskFlow MCP Server running');
}

main().catch(console.error);
