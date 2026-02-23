import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import fs from "fs";
import path from "path";
import os from "os";

// Data file path - same location as Electron app
const DATA_PATH = path.join(
  process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"),
  "taskflow-pm",
  "taskflow-data.json"
);

// Helper functions
function loadData() {
  try {
    if (fs.existsSync(DATA_PATH)) {
      return JSON.parse(fs.readFileSync(DATA_PATH, "utf-8"));
    }
  } catch (error) {
    console.error("Error loading data:", error);
  }
  return { projects: [], tags: [], settings: {} };
}

function saveData(data) {
  try {
    const dir = path.dirname(DATA_PATH);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(DATA_PATH, JSON.stringify(data, null, 2));
    return true;
  } catch (error) {
    console.error("Error saving data:", error);
    return false;
  }
}

function generateId() {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

function getAllTasks(data) {
  const tasks = [];
  for (const project of data.projects) {
    for (const task of project.tasks) {
      tasks.push({
        ...task,
        projectId: project.id,
        projectName: project.name,
      });
    }
  }
  return tasks;
}

function findTask(data, taskId) {
  for (const project of data.projects) {
    const task = project.tasks.find((t) => t.id === taskId);
    if (task) return { task, project };
    for (const t of project.tasks) {
      const subtask = t.subtasks?.find((st) => st.id === taskId);
      if (subtask) return { task: subtask, parentTask: t, project };
    }
  }
  return null;
}

function formatTaskForDisplay(task, project, tags) {
  const tagNames = task.tags
    ?.map((tagId) => {
      const tag = tags.find((t) => t.id === tagId);
      return tag ? `#${tag.name}` : null;
    })
    .filter(Boolean)
    .join(" ");

  let display = `- [${task.status === "done" ? "x" : " "}] ${task.name}`;
  if (task.priority && task.priority !== "none") display += ` !${task.priority}`;
  if (task.dueDate) display += ` (due: ${task.dueDate})`;
  if (tagNames) display += ` ${tagNames}`;
  if (project && !project.isInbox) display += ` [${project.name}]`;

  return display;
}

// Create MCP Server
const server = new Server(
  {
    name: "taskflow-mcp-server",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
      resources: {},
    },
  }
);

// List available tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "get_all_tasks",
        description: "Get all tasks from TaskFlow. Returns tasks organized by status with project and tag info.",
        inputSchema: {
          type: "object",
          properties: {
            status: {
              type: "string",
              enum: ["all", "todo", "in-progress", "review", "done"],
              description: "Filter by status. Default: all",
            },
            project: {
              type: "string",
              description: "Filter by project name",
            },
          },
        },
      },
      {
        name: "get_today_tasks",
        description: "Get tasks due today. Perfect for daily planning.",
        inputSchema: {
          type: "object",
          properties: {},
        },
      },
      {
        name: "get_overdue_tasks",
        description: "Get overdue tasks that need attention.",
        inputSchema: {
          type: "object",
          properties: {},
        },
      },
      {
        name: "get_upcoming_tasks",
        description: "Get tasks due in the next 7 days.",
        inputSchema: {
          type: "object",
          properties: {
            days: {
              type: "number",
              description: "Number of days to look ahead. Default: 7",
            },
          },
        },
      },
      {
        name: "get_projects",
        description: "Get all projects with task counts.",
        inputSchema: {
          type: "object",
          properties: {},
        },
      },
      {
        name: "create_task",
        description: "Create a new task in TaskFlow. Supports scheduling with time blocks.",
        inputSchema: {
          type: "object",
          properties: {
            name: {
              type: "string",
              description: "Task name (required)",
            },
            description: {
              type: "string",
              description: "Task description",
            },
            context: {
              type: "string",
              description: "Brain dump / context for AI assistance",
            },
            project: {
              type: "string",
              description: "Project name to add task to. Creates project if doesn't exist.",
            },
            priority: {
              type: "string",
              enum: ["none", "low", "medium", "high", "urgent"],
              description: "Task priority",
            },
            dueDate: {
              type: "string",
              description: "Due date in YYYY-MM-DD format",
            },
            scheduledTime: {
              type: "string",
              description: "Scheduled start time in HH:MM format (e.g., '09:00')",
            },
            scheduledDate: {
              type: "string",
              description: "Scheduled date in YYYY-MM-DD format. Defaults to dueDate or today.",
            },
            estimatedMinutes: {
              type: "number",
              description: "Estimated duration in minutes (15, 30, 45, 60, 90, 120)",
            },
            tags: {
              type: "array",
              items: { type: "string" },
              description: "Tag names to apply",
            },
            status: {
              type: "string",
              enum: ["todo", "ready", "in-progress", "waiting", "done"],
              description: "Initial status. Default: todo",
            },
            executionType: {
              type: "string",
              enum: ["ai", "manual", "hybrid"],
              description: "How the task should be executed: 'ai' = Claude can do autonomously, 'manual' = requires human action, 'hybrid' = collaborative. Default: manual",
            },
            startDate: {
              type: "string",
              description: "Timeline start date in YYYY-MM-DD format (for Gantt chart)",
            },
            endDate: {
              type: "string",
              description: "Timeline end date in YYYY-MM-DD format (for Gantt chart)",
            },
            assignee: {
              type: "string",
              description: "Team member name to assign this task to",
            },
          },
          required: ["name"],
        },
      },
      {
        name: "create_subtasks",
        description: "Break down a task into subtasks. Great for action planning.",
        inputSchema: {
          type: "object",
          properties: {
            taskId: {
              type: "string",
              description: "ID of the parent task",
            },
            subtasks: {
              type: "array",
              items: { type: "string" },
              description: "List of subtask names to create",
            },
          },
          required: ["taskId", "subtasks"],
        },
      },
      {
        name: "complete_task",
        description: "Mark a task as complete.",
        inputSchema: {
          type: "object",
          properties: {
            taskId: {
              type: "string",
              description: "ID of the task to complete",
            },
          },
          required: ["taskId"],
        },
      },
      {
        name: "update_task",
        description: "Update a task's properties. Supports all task fields including scheduling, assignment, and execution type.",
        inputSchema: {
          type: "object",
          properties: {
            taskId: {
              type: "string",
              description: "ID of the task to update",
            },
            name: { type: "string", description: "Task name" },
            description: { type: "string", description: "Task description" },
            context: { type: "string", description: "Brain dump / context for AI processing" },
            status: {
              type: "string",
              enum: ["todo", "ready", "in-progress", "waiting", "done"],
              description: "Task status",
            },
            priority: {
              type: "string",
              enum: ["none", "low", "medium", "high", "urgent"],
            },
            dueDate: { type: "string", description: "Due date (YYYY-MM-DD) or null to clear" },
            scheduledDate: { type: "string", description: "Scheduled date (YYYY-MM-DD) or null to clear. Use this to add a task to Today." },
            scheduledTime: { type: "string", description: "Scheduled time (HH:MM) or null to clear" },
            estimatedMinutes: { type: "number", description: "Estimated duration in minutes" },
            executionType: {
              type: "string",
              enum: ["ai", "manual", "hybrid"],
              description: "Who executes: ai (Claude alone), manual (human), hybrid (together)",
            },
            assignedTo: { type: "string", description: "Assigned to: 'claude', 'vin', or null to clear" },
            startDate: { type: "string", description: "Timeline start date (YYYY-MM-DD) or null to clear" },
            endDate: { type: "string", description: "Timeline end date (YYYY-MM-DD) or null to clear" },
            assignee: { type: "string", description: "Team member name or null to clear" },
          },
          required: ["taskId"],
        },
      },
      {
        name: "move_task_to_project",
        description: "Move a task from its current project to a different project. Use get_projects to see available projects.",
        inputSchema: {
          type: "object",
          properties: {
            taskId: {
              type: "string",
              description: "ID of the task to move",
            },
            projectId: {
              type: "string",
              description: "ID of the target project to move the task into",
            },
          },
          required: ["taskId", "projectId"],
        },
      },
      {
        name: "create_project",
        description: "Create a new project.",
        inputSchema: {
          type: "object",
          properties: {
            name: {
              type: "string",
              description: "Project name",
            },
            description: {
              type: "string",
              description: "Project description",
            },
            color: {
              type: "string",
              description: "Hex color code (e.g., #3498db)",
            },
          },
          required: ["name"],
        },
      },
      {
        name: "get_focus_task",
        description: "Get the single most important task to focus on right now. Considers due dates, priorities, and status.",
        inputSchema: {
          type: "object",
          properties: {},
        },
      },
      {
        name: "plan_my_day",
        description: "Get a suggested plan for today based on due dates and priorities. Shows task goals and action plans.",
        inputSchema: {
          type: "object",
          properties: {},
        },
      },
      {
        name: "delete_task",
        description: "Delete a task permanently.",
        inputSchema: {
          type: "object",
          properties: {
            taskId: {
              type: "string",
              description: "ID of the task to delete",
            },
          },
          required: ["taskId"],
        },
      },
      {
        name: "log_time",
        description: "Log time spent working on a task.",
        inputSchema: {
          type: "object",
          properties: {
            taskId: {
              type: "string",
              description: "ID of the task",
            },
            minutes: {
              type: "number",
              description: "Minutes spent on the task",
            },
            notes: {
              type: "string",
              description: "Optional notes about what was done",
            },
          },
          required: ["taskId", "minutes"],
        },
      },
      {
        name: "set_task_goal",
        description: "Set the goal/purpose for a task - why this task matters.",
        inputSchema: {
          type: "object",
          properties: {
            taskId: {
              type: "string",
              description: "ID of the task",
            },
            goal: {
              type: "string",
              description: "The goal or purpose of this task",
            },
          },
          required: ["taskId", "goal"],
        },
      },
      {
        name: "add_learning",
        description: "Record something learned while working on a task.",
        inputSchema: {
          type: "object",
          properties: {
            taskId: {
              type: "string",
              description: "ID of the task",
            },
            learning: {
              type: "string",
              description: "What was learned",
            },
          },
          required: ["taskId", "learning"],
        },
      },
      {
        name: "daily_recap",
        description: "Get a recap of what was accomplished today and learnings.",
        inputSchema: {
          type: "object",
          properties: {
            date: {
              type: "string",
              description: "Date in YYYY-MM-DD format. Defaults to today.",
            },
          },
        },
      },
      {
        name: "weekly_review",
        description: "Get a comprehensive review of the past week - accomplishments, time spent, learnings, and patterns.",
        inputSchema: {
          type: "object",
          properties: {},
        },
      },
      {
        name: "add_recap_entry",
        description: "Log an accomplishment, decision, or note to the recap journal. Use this to document important things as they happen.",
        inputSchema: {
          type: "object",
          properties: {
            type: {
              type: "string",
              enum: ["accomplishment", "decision", "note"],
              description: "Type of entry: accomplishment (something completed), decision (choice made), or note (observation/insight)",
            },
            content: {
              type: "string",
              description: "The content of the entry - what was accomplished, decided, or noted",
            },
            date: {
              type: "string",
              description: "Date in YYYY-MM-DD format. Defaults to today.",
            },
            relatedTaskId: {
              type: "string",
              description: "Optional task ID this entry relates to",
            },
            tags: {
              type: "array",
              items: { type: "string" },
              description: "Optional tags/categories for the entry",
            },
          },
          required: ["type", "content"],
        },
      },
      {
        name: "get_recap_log",
        description: "View logged recap entries (accomplishments, decisions, notes) for a date range.",
        inputSchema: {
          type: "object",
          properties: {
            startDate: {
              type: "string",
              description: "Start date in YYYY-MM-DD format. Defaults to today.",
            },
            endDate: {
              type: "string",
              description: "End date in YYYY-MM-DD format. Defaults to startDate.",
            },
            type: {
              type: "string",
              enum: ["accomplishment", "decision", "note", "all"],
              description: "Filter by entry type. Defaults to 'all'.",
            },
          },
        },
      },
      {
        name: "save_recap",
        description: "Generate and save a recap document for a specific period. This creates a permanent record combining task data with logged entries.",
        inputSchema: {
          type: "object",
          properties: {
            period: {
              type: "string",
              enum: ["daily", "weekly", "monthly"],
              description: "Period type for the recap",
            },
            date: {
              type: "string",
              description: "Reference date in YYYY-MM-DD format. For daily: that day. For weekly: week containing that date. For monthly: that month. Defaults to today.",
            },
            summary: {
              type: "string",
              description: "Optional executive summary or highlights to include",
            },
            highlights: {
              type: "array",
              items: { type: "string" },
              description: "Optional list of key highlights to feature",
            },
          },
          required: ["period"],
        },
      },
      {
        name: "get_saved_recaps",
        description: "View previously saved recap documents.",
        inputSchema: {
          type: "object",
          properties: {
            period: {
              type: "string",
              enum: ["daily", "weekly", "monthly", "all"],
              description: "Filter by period type. Defaults to 'all'.",
            },
            limit: {
              type: "number",
              description: "Max number of recaps to return. Defaults to 10.",
            },
          },
        },
      },
      {
        name: "get_recap_by_id",
        description: "View the full content of a saved recap document by its ID.",
        inputSchema: {
          type: "object",
          properties: {
            recapId: {
              type: "string",
              description: "ID of the saved recap to view",
            },
          },
          required: ["recapId"],
        },
      },
      {
        name: "delete_recap_entry",
        description: "Delete a recap log entry by ID.",
        inputSchema: {
          type: "object",
          properties: {
            entryId: {
              type: "string",
              description: "ID of the recap entry to delete",
            },
          },
          required: ["entryId"],
        },
      },
      {
        name: "get_calendar_view",
        description: "Get a calendar view of tasks and accomplishments for a date range.",
        inputSchema: {
          type: "object",
          properties: {
            startDate: {
              type: "string",
              description: "Start date in YYYY-MM-DD format",
            },
            endDate: {
              type: "string",
              description: "End date in YYYY-MM-DD format",
            },
          },
        },
      },
      {
        name: "get_task_context",
        description: "Get the full context/brain dump for a task. Use this to understand what the user needs help with.",
        inputSchema: {
          type: "object",
          properties: {
            taskId: {
              type: "string",
              description: "ID of the task",
            },
          },
          required: ["taskId"],
        },
      },
      {
        name: "append_context",
        description: "Add additional context or notes to a task's brain dump field.",
        inputSchema: {
          type: "object",
          properties: {
            taskId: {
              type: "string",
              description: "ID of the task",
            },
            context: {
              type: "string",
              description: "Additional context to append",
            },
          },
          required: ["taskId", "context"],
        },
      },
      {
        name: "get_inbox_tasks",
        description: "Get all unorganized tasks from the Inbox. These are brain dumps that need processing.",
        inputSchema: {
          type: "object",
          properties: {},
        },
      },
      {
        name: "get_working_on_task",
        description: "Get the task the user is currently working on. This shows what they've marked as 'Working On Now' in TaskFlow.",
        inputSchema: {
          type: "object",
          properties: {},
        },
      },
      {
        name: "delete_project",
        description: "Delete a project and all its tasks permanently.",
        inputSchema: {
          type: "object",
          properties: {
            projectId: {
              type: "string",
              description: "ID of the project to delete",
            },
            projectName: {
              type: "string",
              description: "Name of the project to delete (alternative to projectId)",
            },
          },
        },
      },
      {
        name: "delete_all_completed",
        description: "Delete all completed tasks. Optionally filter by project.",
        inputSchema: {
          type: "object",
          properties: {
            projectName: {
              type: "string",
              description: "Optional: Only delete completed tasks from this project",
            },
          },
        },
      },
      // ============================================
      // TIME BLOCKING TOOLS (Step 1A)
      // ============================================
      {
        name: "set_scheduled_time",
        description: "Schedule a task for a specific time slot. Sets when the task should be worked on.",
        inputSchema: {
          type: "object",
          properties: {
            taskId: {
              type: "string",
              description: "ID of the task to schedule",
            },
            scheduledTime: {
              type: "string",
              description: "Time in HH:MM format (24-hour), e.g., '09:00', '14:30'",
            },
            scheduledDate: {
              type: "string",
              description: "Date in YYYY-MM-DD format. Defaults to today if not provided.",
            },
            estimatedMinutes: {
              type: "number",
              description: "Estimated duration in minutes. Suggested values: 15, 30, 45, 60, 90, 120",
            },
          },
          required: ["taskId", "scheduledTime"],
        },
      },
      {
        name: "get_scheduled_tasks",
        description: "Get all tasks scheduled for a specific date, ordered by scheduled time.",
        inputSchema: {
          type: "object",
          properties: {
            date: {
              type: "string",
              description: "Date in YYYY-MM-DD format. Defaults to today.",
            },
          },
        },
      },
      {
        name: "clear_scheduled_time",
        description: "Remove the scheduled time from a task.",
        inputSchema: {
          type: "object",
          properties: {
            taskId: {
              type: "string",
              description: "ID of the task to unschedule",
            },
          },
          required: ["taskId"],
        },
      },
      // ============================================
      // AI WORKFLOW TOOLS (Step 2)
      // ============================================
      {
        name: "process_brain_dump",
        description: "Analyze raw brain dump text and extract structured task information. Returns suggested task name, description, project, priority, and complexity.",
        inputSchema: {
          type: "object",
          properties: {
            taskId: {
              type: "string",
              description: "ID of the task containing the brain dump to process",
            },
          },
          required: ["taskId"],
        },
      },
      {
        name: "get_ready_tasks",
        description: "Get tasks that are ready to work on. Can filter by status 'ready' or get top prioritized tasks (replaces get_focus_queue).",
        inputSchema: {
          type: "object",
          properties: {
            projectName: {
              type: "string",
              description: "Optional: Filter by project name",
            },
            highPriorityOnly: {
              type: "boolean",
              description: "If true, returns top 5 prioritized tasks based on urgency, priority, schedule (focus queue mode)",
            },
            limit: {
              type: "number",
              description: "Maximum number of tasks to return. Default: all for ready tasks, 5 for focus queue",
            },
          },
        },
      },
      {
        name: "set_waiting_reason",
        description: "Set or update the reason why a task is blocked/waiting.",
        inputSchema: {
          type: "object",
          properties: {
            taskId: {
              type: "string",
              description: "ID of the task",
            },
            reason: {
              type: "string",
              description: "Reason why the task is waiting/blocked (e.g., 'Waiting for client feedback', 'Blocked by API issue')",
            },
            blockedBy: {
              type: "string",
              description: "Optional: Who/what is blocking this task",
            },
          },
          required: ["taskId", "reason"],
        },
      },
      {
        name: "bulk_schedule_today",
        description: "Schedule multiple tasks for today with time slots. Efficient batch scheduling.",
        inputSchema: {
          type: "object",
          properties: {
            schedule: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  taskId: { type: "string" },
                  scheduledTime: { type: "string", description: "HH:MM format" },
                  estimatedMinutes: { type: "number" },
                },
                required: ["taskId", "scheduledTime"],
              },
              description: "Array of tasks to schedule with their time slots",
            },
          },
          required: ["schedule"],
        },
      },
      // ============================================
      // SUGGEST SUBTASKS TOOLS (Step 3)
      // ============================================
      {
        name: "suggest_subtasks",
        description: "Analyze a task and suggest a breakdown into actionable subtasks. Returns suggestions with reasoning - user decides which to apply.",
        inputSchema: {
          type: "object",
          properties: {
            taskId: {
              type: "string",
              description: "ID of the task to break down",
            },
          },
          required: ["taskId"],
        },
      },
      // ============================================
      // PARALLEL EXECUTION TOOLS
      // ============================================
      {
        name: "set_execution_type",
        description: "Set how a task should be executed: 'ai' (Claude does autonomously), 'manual' (requires human), or 'hybrid' (collaborative).",
        inputSchema: {
          type: "object",
          properties: {
            taskId: {
              type: "string",
              description: "ID of the task",
            },
            executionType: {
              type: "string",
              enum: ["ai", "manual", "hybrid"],
              description: "Execution type: 'ai' for Claude-driven, 'manual' for human-driven, 'hybrid' for collaborative",
            },
          },
          required: ["taskId", "executionType"],
        },
      },
      {
        name: "suggest_parallel_tasks",
        description: "Analyze ready/scheduled tasks and suggest pairs that can be done in parallel - one for Claude (AI), one for the human (manual).",
        inputSchema: {
          type: "object",
          properties: {
            date: {
              type: "string",
              description: "Date in YYYY-MM-DD format. Defaults to today.",
            },
          },
        },
      },
      {
        name: "get_parallel_schedule",
        description: "Get the dual-track schedule for a date - showing AI tasks on one track and manual tasks on another, allowing parallel execution.",
        inputSchema: {
          type: "object",
          properties: {
            date: {
              type: "string",
              description: "Date in YYYY-MM-DD format. Defaults to today.",
            },
          },
        },
      },
      // ============================================
      // PRIORITY RECOMMENDATION TOOLS (Step 4)
      // ============================================
      {
        name: "suggest_priority",
        description: "Analyze a task and suggest an appropriate priority level with reasoning.",
        inputSchema: {
          type: "object",
          properties: {
            taskId: {
              type: "string",
              description: "ID of the task to analyze",
            },
          },
          required: ["taskId"],
        },
      },
      {
        name: "suggest_next_task",
        description: "Analyze all ready tasks and recommend the single most important task to work on next, with reasoning.",
        inputSchema: {
          type: "object",
          properties: {},
        },
      },
      {
        name: "prioritize_inbox",
        description: "Analyze all inbox/brain dump items and return a ranked list with suggested priorities.",
        inputSchema: {
          type: "object",
          properties: {},
        },
      },
      // ============================================
      // ENHANCED PROJECT TRACKING TOOLS
      // ============================================
      {
        name: "get_categories",
        description: "Get all project categories with their project counts.",
        inputSchema: {
          type: "object",
          properties: {},
        },
      },
      {
        name: "create_category",
        description: "Create a new project category.",
        inputSchema: {
          type: "object",
          properties: {
            name: {
              type: "string",
              description: "Category name (required)",
            },
            color: {
              type: "string",
              description: "Hex color code (e.g., #6366f1)",
            },
          },
          required: ["name"],
        },
      },
      {
        name: "suggest_project_breakdown",
        description: "Analyze a project and suggest a task breakdown structure. Returns suggestions for user review - does NOT auto-create tasks. Use this when starting a new project or when a project needs better organization.",
        inputSchema: {
          type: "object",
          properties: {
            projectId: {
              type: "string",
              description: "ID of the project to analyze",
            },
            projectName: {
              type: "string",
              description: "Name of the project to analyze (alternative to projectId)",
            },
          },
        },
      },
      {
        name: "add_task_dependency",
        description: "Create a blocking relationship between tasks. The blocked task cannot start until the blocker is complete.",
        inputSchema: {
          type: "object",
          properties: {
            taskId: {
              type: "string",
              description: "ID of the task to be blocked",
            },
            blockedByTaskId: {
              type: "string",
              description: "ID of the blocking task (must complete first)",
            },
          },
          required: ["taskId", "blockedByTaskId"],
        },
      },
      {
        name: "remove_task_dependency",
        description: "Remove a blocking relationship between tasks.",
        inputSchema: {
          type: "object",
          properties: {
            taskId: {
              type: "string",
              description: "ID of the blocked task",
            },
            blockedByTaskId: {
              type: "string",
              description: "ID of the blocker task to remove",
            },
          },
          required: ["taskId", "blockedByTaskId"],
        },
      },
      {
        name: "get_dependency_graph",
        description: "Get a text-based visualization of task dependencies within a project or across all projects.",
        inputSchema: {
          type: "object",
          properties: {
            projectId: {
              type: "string",
              description: "Optional project ID to filter dependencies. If not provided, shows all dependencies.",
            },
          },
        },
      },
      {
        name: "suggest_task_order",
        description: "Recommend execution order for tasks based on dependencies, priorities, and due dates.",
        inputSchema: {
          type: "object",
          properties: {
            projectId: {
              type: "string",
              description: "Optional project ID to filter tasks",
            },
            includeCompleted: {
              type: "boolean",
              description: "Include completed tasks in analysis. Default: false",
            },
          },
        },
      },
      // ============================================
      // PLANNING & SCHEDULING TOOLS
      // ============================================
      {
        name: "get_planning_context",
        description: "Get comprehensive context for day planning: overdue tasks, unscheduled high-priority items, yesterday's incomplete tasks, and available time slots.",
        inputSchema: {
          type: "object",
          properties: {
            date: {
              type: "string",
              description: "Date to plan for in YYYY-MM-DD format. Defaults to today.",
            },
          },
        },
      },
      {
        name: "suggest_day_schedule",
        description: "Generate a time-blocked schedule for the day based on task priorities, durations, and available time.",
        inputSchema: {
          type: "object",
          properties: {
            date: {
              type: "string",
              description: "Date to schedule in YYYY-MM-DD format. Defaults to today.",
            },
            startHour: {
              type: "number",
              description: "Hour to start scheduling (0-23). Defaults to 9.",
            },
            endHour: {
              type: "number",
              description: "Hour to end scheduling (0-23). Defaults to 18.",
            },
            taskIds: {
              type: "array",
              items: { type: "string" },
              description: "Optional: Specific task IDs to schedule. If not provided, uses top priority tasks.",
            },
          },
        },
      },
      {
        name: "bulk_update_tasks",
        description: "Update multiple tasks at once with the same changes. Efficient for batch operations.",
        inputSchema: {
          type: "object",
          properties: {
            taskIds: {
              type: "array",
              items: { type: "string" },
              description: "Array of task IDs to update",
            },
            updates: {
              type: "object",
              properties: {
                status: { type: "string", enum: ["todo", "ready", "in-progress", "waiting", "done"] },
                priority: { type: "string", enum: ["none", "low", "medium", "high", "urgent"] },
                dueDate: { type: "string" },
                scheduledDate: { type: "string" },
                executionType: { type: "string", enum: ["ai", "manual", "hybrid"] },
              },
              description: "Updates to apply to all specified tasks",
            },
          },
          required: ["taskIds", "updates"],
        },
      },
      // ============================================
      // BLOCKER MANAGEMENT TOOLS
      // ============================================
      {
        name: "set_blocker",
        description: "Set detailed blocker information for a waiting task.",
        inputSchema: {
          type: "object",
          properties: {
            taskId: {
              type: "string",
              description: "ID of the task",
            },
            type: {
              type: "string",
              enum: ["person", "external", "dependency", "resource", "decision"],
              description: "Type of blocker",
            },
            description: {
              type: "string",
              description: "Description of what's blocking the task",
            },
            expectedResolution: {
              type: "string",
              description: "Expected resolution date in YYYY-MM-DD format",
            },
            followUpDate: {
              type: "string",
              description: "Date to follow up in YYYY-MM-DD format",
            },
            contactInfo: {
              type: "string",
              description: "Contact info for person blockers (email, name, etc.)",
            },
          },
          required: ["taskId", "type", "description"],
        },
      },
      {
        name: "log_follow_up",
        description: "Record a follow-up attempt for a blocked task.",
        inputSchema: {
          type: "object",
          properties: {
            taskId: {
              type: "string",
              description: "ID of the blocked task",
            },
            note: {
              type: "string",
              description: "What was done to follow up",
            },
            newFollowUpDate: {
              type: "string",
              description: "Optional: Set a new follow-up date",
            },
          },
          required: ["taskId", "note"],
        },
      },
      {
        name: "get_blockers_summary",
        description: "Get a summary of all blocked tasks with aging analysis.",
        inputSchema: {
          type: "object",
          properties: {
            includeResolved: {
              type: "boolean",
              description: "Include recently resolved blockers. Default: false",
            },
          },
        },
      },
      {
        name: "clear_blocker",
        description: "Mark a blocker as resolved and set task status to ready.",
        inputSchema: {
          type: "object",
          properties: {
            taskId: {
              type: "string",
              description: "ID of the blocked task",
            },
            resolution: {
              type: "string",
              description: "How the blocker was resolved",
            },
          },
          required: ["taskId"],
        },
      },
      // ============================================
      // ANALYTICS TOOLS
      // ============================================
      {
        name: "get_productivity_stats",
        description: "Get productivity statistics for a date range.",
        inputSchema: {
          type: "object",
          properties: {
            startDate: {
              type: "string",
              description: "Start date in YYYY-MM-DD format",
            },
            endDate: {
              type: "string",
              description: "End date in YYYY-MM-DD format",
            },
          },
        },
      },
      {
        name: "get_productivity_insights",
        description: "Get AI-ready insights about productivity patterns for Claude to analyze.",
        inputSchema: {
          type: "object",
          properties: {
            period: {
              type: "string",
              enum: ["week", "month", "quarter"],
              description: "Time period to analyze. Default: week",
            },
          },
        },
      },
      {
        name: "get_work_context",
        description: "Get rich work context for coaching: recent completions with energy ratings, snoozed/deferred tasks, blocker patterns, project velocity, and daily notes. Use this before giving productivity advice.",
        inputSchema: {
          type: "object",
          properties: {
            days: {
              type: "number",
              description: "Number of days of history to include. Default: 14",
            },
          },
        },
      },
      {
        name: "get_project_analytics",
        description: "Get analytics breakdown by project.",
        inputSchema: {
          type: "object",
          properties: {
            startDate: {
              type: "string",
              description: "Start date in YYYY-MM-DD format",
            },
            endDate: {
              type: "string",
              description: "End date in YYYY-MM-DD format",
            },
          },
        },
      },
      // ============================================
      // SUB-PROJECT & HIERARCHY TOOLS
      // ============================================
      {
        name: "create_subproject",
        description: "Create a project as a child of another project.",
        inputSchema: {
          type: "object",
          properties: {
            parentProjectId: {
              type: "string",
              description: "ID of the parent project",
            },
            name: {
              type: "string",
              description: "Name of the sub-project",
            },
            description: {
              type: "string",
              description: "Description of the sub-project",
            },
            color: {
              type: "string",
              description: "Hex color code",
            },
          },
          required: ["parentProjectId", "name"],
        },
      },
      {
        name: "get_project_tree",
        description: "Get hierarchical view of projects with progress stats.",
        inputSchema: {
          type: "object",
          properties: {},
        },
      },
      // ============================================
      // ENHANCED SUBTASK TOOLS
      // ============================================
      {
        name: "create_subtasks_enhanced",
        description: "Create subtasks with time estimates and scheduling capability.",
        inputSchema: {
          type: "object",
          properties: {
            taskId: {
              type: "string",
              description: "ID of the parent task",
            },
            subtasks: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  name: { type: "string" },
                  estimatedMinutes: { type: "number" },
                  scheduledTime: { type: "string" },
                  scheduledDate: { type: "string" },
                },
                required: ["name"],
              },
              description: "Subtasks to create with optional time estimates and scheduling",
            },
          },
          required: ["taskId", "subtasks"],
        },
      },
      {
        name: "schedule_subtask",
        description: "Schedule a subtask to appear on the timeline.",
        inputSchema: {
          type: "object",
          properties: {
            taskId: {
              type: "string",
              description: "ID of the parent task",
            },
            subtaskId: {
              type: "string",
              description: "ID of the subtask to schedule",
            },
            scheduledTime: {
              type: "string",
              description: "Time in HH:MM format",
            },
            scheduledDate: {
              type: "string",
              description: "Date in YYYY-MM-DD format. Defaults to today.",
            },
            estimatedMinutes: {
              type: "number",
              description: "Duration in minutes",
            },
          },
          required: ["taskId", "subtaskId", "scheduledTime"],
        },
      },
      {
        name: "assign_task",
        description: "Assign a task or subtask to Claude or the user. Use this to indicate who will work on the task.",
        inputSchema: {
          type: "object",
          properties: {
            taskId: {
              type: "string",
              description: "ID of the task or subtask to assign",
            },
            assignTo: {
              type: "string",
              enum: ["claude", "user", "none"],
              description: "Who to assign the task to: 'claude' for AI tasks, 'user' for manual tasks, 'none' to unassign",
            },
          },
          required: ["taskId", "assignTo"],
        },
      },
      {
        name: "get_claude_tasks",
        description: "Get all tasks and subtasks assigned to Claude with full context. Returns task details, descriptions, brain dump context, and parent task info for subtasks.",
        inputSchema: {
          type: "object",
          properties: {
            todayOnly: {
              type: "boolean",
              description: "If true, only return tasks scheduled for today. Default: false (returns all Claude tasks)",
            },
          },
        },
      },
      {
        name: "get_project_notebooks",
        description: "List all notebooks for a project. Returns id, title, updatedAt, and a content preview for each.",
        inputSchema: {
          type: "object",
          properties: {
            projectId: {
              type: "string",
              description: "The project ID to get notebooks for",
            },
          },
          required: ["projectId"],
        },
      },
      {
        name: "get_notebook",
        description: "Get the full content of a specific notebook.",
        inputSchema: {
          type: "object",
          properties: {
            projectId: {
              type: "string",
              description: "The project ID",
            },
            notebookId: {
              type: "string",
              description: "The notebook ID",
            },
          },
          required: ["projectId", "notebookId"],
        },
      },
      {
        name: "create_notebook",
        description: "Create a new notebook in a project.",
        inputSchema: {
          type: "object",
          properties: {
            projectId: {
              type: "string",
              description: "The project ID to create the notebook in",
            },
            title: {
              type: "string",
              description: "Notebook title",
            },
            content: {
              type: "string",
              description: "Initial markdown content (optional)",
            },
            icon: {
              type: "string",
              description: "Emoji icon for the notebook (optional)",
            },
          },
          required: ["projectId", "title"],
        },
      },
      {
        name: "update_notebook",
        description: "Update an existing notebook's title and/or content.",
        inputSchema: {
          type: "object",
          properties: {
            projectId: {
              type: "string",
              description: "The project ID",
            },
            notebookId: {
              type: "string",
              description: "The notebook ID",
            },
            title: {
              type: "string",
              description: "New title (optional)",
            },
            content: {
              type: "string",
              description: "New markdown content (optional)",
            },
            icon: {
              type: "string",
              description: "New emoji icon (optional)",
            },
            pinned: {
              type: "boolean",
              description: "Pin/unpin the notebook (optional)",
            },
          },
          required: ["projectId", "notebookId"],
        },
      },
      {
        name: "delete_notebook",
        description: "Delete a notebook from a project.",
        inputSchema: {
          type: "object",
          properties: {
            projectId: {
              type: "string",
              description: "The project ID",
            },
            notebookId: {
              type: "string",
              description: "The notebook ID to delete",
            },
          },
          required: ["projectId", "notebookId"],
        },
      },
      {
        name: "append_to_notebook",
        description: "Append content to an existing notebook. Useful for logging research findings, meeting notes, or execution results.",
        inputSchema: {
          type: "object",
          properties: {
            projectId: {
              type: "string",
              description: "The project ID",
            },
            notebookId: {
              type: "string",
              description: "The notebook ID",
            },
            content: {
              type: "string",
              description: "Markdown content to append",
            },
            separator: {
              type: "string",
              description: "Separator before appended content. Default: '\\n\\n---\\n\\n'",
            },
          },
          required: ["projectId", "notebookId", "content"],
        },
      },
      {
        name: "sync_claude_queue",
        description: "Write all Claude-assigned tasks to the claude_queue.md file for overnight/batch processing. This overwrites the queue file with current Claude tasks.",
        inputSchema: {
          type: "object",
          properties: {
            todayOnly: {
              type: "boolean",
              description: "If true, only include tasks scheduled for today. Default: false",
            },
          },
        },
      },
    ],
  };
});

// List resources
server.setRequestHandler(ListResourcesRequestSchema, async () => {
  return {
    resources: [
      {
        uri: "taskflow://tasks",
        name: "All Tasks",
        description: "Complete task list from TaskFlow",
        mimeType: "text/plain",
      },
      {
        uri: "taskflow://summary",
        name: "Task Summary",
        description: "Quick summary of task status",
        mimeType: "text/plain",
      },
    ],
  };
});

// Read resources
server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  const data = loadData();
  const tasks = getAllTasks(data);

  if (request.params.uri === "taskflow://tasks") {
    let content = "# TaskFlow Tasks\n\n";

    const byStatus = {
      "todo": tasks.filter((t) => t.status === "todo"),
      "in-progress": tasks.filter((t) => t.status === "in-progress"),
      "review": tasks.filter((t) => t.status === "review"),
      "done": tasks.filter((t) => t.status === "done"),
    };

    for (const [status, statusTasks] of Object.entries(byStatus)) {
      if (statusTasks.length > 0) {
        content += `## ${status.toUpperCase()} (${statusTasks.length})\n`;
        for (const task of statusTasks) {
          const project = data.projects.find((p) => p.id === task.projectId);
          content += formatTaskForDisplay(task, project, data.tags) + "\n";
        }
        content += "\n";
      }
    }

    return {
      contents: [{ uri: request.params.uri, mimeType: "text/plain", text: content }],
    };
  }

  if (request.params.uri === "taskflow://summary") {
    const today = new Date().toISOString().split("T")[0];
    const active = tasks.filter((t) => t.status !== "done");
    const todayTasks = active.filter((t) => t.dueDate === today);
    const overdue = active.filter((t) => t.dueDate && t.dueDate < today);
    const highPriority = active.filter((t) => t.priority === "high" || t.priority === "urgent");

    const content = `# TaskFlow Summary

**Total Active Tasks:** ${active.length}
**Due Today:** ${todayTasks.length}
**Overdue:** ${overdue.length}
**High Priority:** ${highPriority.length}

## Projects
${data.projects
  .filter((p) => !p.isInbox)
  .map((p) => `- ${p.name}: ${p.tasks.filter((t) => t.status !== "done").length} active tasks`)
  .join("\n")}
`;

    return {
      contents: [{ uri: request.params.uri, mimeType: "text/plain", text: content }],
    };
  }

  throw new Error(`Unknown resource: ${request.params.uri}`);
});

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const data = loadData();

  switch (name) {
    case "get_all_tasks": {
      let tasks = getAllTasks(data);

      if (args?.status && args.status !== "all") {
        tasks = tasks.filter((t) => t.status === args.status);
      }
      if (args?.project) {
        tasks = tasks.filter((t) =>
          t.projectName?.toLowerCase().includes(args.project.toLowerCase())
        );
      }

      const output = tasks.map((task) => {
        const project = data.projects.find((p) => p.id === task.projectId);
        return {
          id: task.id,
          name: task.name,
          status: task.status,
          priority: task.priority,
          dueDate: task.dueDate,
          project: project?.name || "Inbox",
          subtasks: task.subtasks?.length || 0,
          description: task.description,
        };
      });

      return {
        content: [{ type: "text", text: JSON.stringify(output, null, 2) }],
      };
    }

    case "get_today_tasks": {
      const today = new Date().toISOString().split("T")[0];
      const tasks = getAllTasks(data).filter(
        (t) => t.dueDate === today && t.status !== "done"
      );

      if (tasks.length === 0) {
        return {
          content: [{ type: "text", text: "No tasks due today! Consider working on high-priority items or upcoming tasks." }],
        };
      }

      let output = `## Tasks Due Today (${tasks.length})\n\n`;
      tasks.forEach((task) => {
        const project = data.projects.find((p) => p.id === task.projectId);
        output += formatTaskForDisplay(task, project, data.tags) + `\n  ID: ${task.id}\n`;
      });

      return { content: [{ type: "text", text: output }] };
    }

    case "get_overdue_tasks": {
      const today = new Date().toISOString().split("T")[0];
      const tasks = getAllTasks(data).filter(
        (t) => t.dueDate && t.dueDate < today && t.status !== "done"
      );

      if (tasks.length === 0) {
        return { content: [{ type: "text", text: "No overdue tasks! You're on track." }] };
      }

      let output = `## Overdue Tasks (${tasks.length})\n\n`;
      tasks
        .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
        .forEach((task) => {
          const project = data.projects.find((p) => p.id === task.projectId);
          output += formatTaskForDisplay(task, project, data.tags) + `\n  ID: ${task.id}\n`;
        });

      return { content: [{ type: "text", text: output }] };
    }

    case "get_upcoming_tasks": {
      const days = args?.days || 7;
      const today = new Date();
      const future = new Date(today);
      future.setDate(future.getDate() + days);

      const todayStr = today.toISOString().split("T")[0];
      const futureStr = future.toISOString().split("T")[0];

      const tasks = getAllTasks(data).filter(
        (t) => t.dueDate && t.dueDate >= todayStr && t.dueDate <= futureStr && t.status !== "done"
      );

      if (tasks.length === 0) {
        return { content: [{ type: "text", text: `No tasks due in the next ${days} days.` }] };
      }

      let output = `## Upcoming Tasks - Next ${days} Days (${tasks.length})\n\n`;
      tasks
        .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
        .forEach((task) => {
          const project = data.projects.find((p) => p.id === task.projectId);
          output += formatTaskForDisplay(task, project, data.tags) + `\n  ID: ${task.id}\n`;
        });

      return { content: [{ type: "text", text: output }] };
    }

    case "get_projects": {
      const projects = data.projects.map((p) => ({
        id: p.id,
        name: p.name,
        description: p.description,
        color: p.color,
        totalTasks: p.tasks.length,
        activeTasks: p.tasks.filter((t) => t.status !== "done").length,
        isInbox: p.isInbox || false,
      }));

      return {
        content: [{ type: "text", text: JSON.stringify(projects, null, 2) }],
      };
    }

    case "create_task": {
      if (!args?.name) {
        return { content: [{ type: "text", text: "Error: Task name is required" }] };
      }

      // Find or create project
      let project = null;
      if (args.project) {
        project = data.projects.find(
          (p) => p.name.toLowerCase() === args.project.toLowerCase()
        );
        if (!project) {
          project = {
            id: generateId(),
            name: args.project,
            description: "",
            color: "#6366f1",
            tasks: [],
            createdAt: new Date().toISOString(),
          };
          data.projects.push(project);
        }
      } else {
        project = data.projects.find((p) => p.isInbox || p.id === "inbox");
        if (!project) {
          project = { id: "inbox", name: "Inbox", color: "#6366f1", tasks: [], isInbox: true };
          data.projects.unshift(project);
        }
      }

      // Resolve tag IDs
      const tagIds = [];
      if (args.tags) {
        for (const tagName of args.tags) {
          let tag = data.tags.find(
            (t) => t.name.toLowerCase() === tagName.toLowerCase()
          );
          if (!tag) {
            tag = { id: generateId(), name: tagName, color: "#6366f1" };
            data.tags.push(tag);
          }
          tagIds.push(tag.id);
        }
      }

      const today = new Date().toISOString().split("T")[0];
      const task = {
        id: generateId(),
        name: args.name,
        description: args.description || "",
        context: args.context || "",
        status: args.status || "todo",
        priority: args.priority || "none",
        dueDate: args.dueDate || null,
        scheduledTime: args.scheduledTime || null,
        scheduledDate: args.scheduledDate || args.dueDate || (args.scheduledTime ? today : null),
        estimatedMinutes: args.estimatedMinutes || null,
        executionType: args.executionType || "manual", // 'ai' | 'manual' | 'hybrid'
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
      saveData(data);

      let response = `Created task: "${task.name}"\nID: ${task.id}\nProject: ${project.name}`;
      if (task.scheduledTime) {
        response += `\nScheduled: ${task.scheduledTime} on ${task.scheduledDate}`;
        if (task.estimatedMinutes) {
          response += ` (${task.estimatedMinutes}m)`;
        }
      }

      return {
        content: [
          {
            type: "text",
            text: response,
          },
        ],
      };
    }

    case "create_subtasks": {
      if (!args?.taskId || !args?.subtasks) {
        return { content: [{ type: "text", text: "Error: taskId and subtasks are required" }] };
      }

      const result = findTask(data, args.taskId);
      if (!result) {
        return { content: [{ type: "text", text: `Error: Task ${args.taskId} not found` }] };
      }

      const { task } = result;
      if (!task.subtasks) task.subtasks = [];

      const created = [];
      for (const subtaskName of args.subtasks) {
        const subtask = {
          id: generateId(),
          name: subtaskName,
          status: "todo",
          priority: "none",
          createdAt: new Date().toISOString(),
        };
        task.subtasks.push(subtask);
        created.push(subtaskName);
      }

      saveData(data);

      return {
        content: [
          {
            type: "text",
            text: `Added ${created.length} subtasks to "${task.name}":\n${created.map((s) => `- ${s}`).join("\n")}`,
          },
        ],
      };
    }

    case "complete_task": {
      if (!args?.taskId) {
        return { content: [{ type: "text", text: "Error: taskId is required" }] };
      }

      const result = findTask(data, args.taskId);
      if (!result) {
        return { content: [{ type: "text", text: `Error: Task ${args.taskId} not found` }] };
      }

      result.task.status = "done";
      result.task.completedAt = new Date().toISOString();
      saveData(data);

      return {
        content: [{ type: "text", text: `Completed: "${result.task.name}"` }],
      };
    }

    case "update_task": {
      if (!args?.taskId) {
        return { content: [{ type: "text", text: "Error: taskId is required" }] };
      }

      const result = findTask(data, args.taskId);
      if (!result) {
        return { content: [{ type: "text", text: `Error: Task ${args.taskId} not found` }] };
      }

      const { task } = result;
      const changes = [];
      if (args.name) { task.name = args.name; changes.push("name"); }
      if (args.description !== undefined) { task.description = args.description; changes.push("description"); }
      if (args.context !== undefined) { task.context = args.context; changes.push("context"); }
      if (args.status) {
        task.status = args.status;
        if (args.status === "done") {
          task.completedAt = new Date().toISOString();
        } else {
          task.completedAt = null;
        }
        changes.push("status → " + args.status);
      }
      if (args.priority) { task.priority = args.priority; changes.push("priority → " + args.priority); }
      if (args.dueDate !== undefined) { task.dueDate = args.dueDate || null; changes.push("dueDate → " + (args.dueDate || "cleared")); }
      if (args.scheduledDate !== undefined) { task.scheduledDate = args.scheduledDate || null; changes.push("scheduledDate → " + (args.scheduledDate || "cleared")); }
      if (args.scheduledTime !== undefined) { task.scheduledTime = args.scheduledTime || null; changes.push("scheduledTime → " + (args.scheduledTime || "cleared")); }
      if (args.estimatedMinutes !== undefined) { task.estimatedMinutes = args.estimatedMinutes; changes.push("estimate → " + args.estimatedMinutes + "min"); }
      if (args.executionType) { task.executionType = args.executionType; changes.push("type → " + args.executionType); }
      if (args.assignedTo !== undefined) { task.assignedTo = args.assignedTo || null; changes.push("assigned → " + (args.assignedTo || "unassigned")); }
      if (args.startDate !== undefined) { task.startDate = args.startDate || null; changes.push("startDate → " + (args.startDate || "cleared")); }
      if (args.endDate !== undefined) { task.endDate = args.endDate || null; changes.push("endDate → " + (args.endDate || "cleared")); }
      if (args.assignee !== undefined) { task.assignee = args.assignee || null; changes.push("assignee → " + (args.assignee || "unassigned")); }
      task.updatedAt = new Date().toISOString();

      saveData(data);

      return {
        content: [{ type: "text", text: `Updated task: "${task.name}" (${changes.join(", ")})` }],
      };
    }

    case "move_task_to_project": {
      if (!args?.taskId || !args?.projectId) {
        return { content: [{ type: "text", text: "Error: taskId and projectId are required" }] };
      }

      const moveResult = findTask(data, args.taskId);
      if (!moveResult) {
        return { content: [{ type: "text", text: `Error: Task ${args.taskId} not found` }] };
      }

      const targetProject = data.projects.find(p => p.id === args.projectId);
      if (!targetProject) {
        return { content: [{ type: "text", text: `Error: Project ${args.projectId} not found` }] };
      }

      // Remove from source project
      const sourceProject = moveResult.project;
      const taskIndex = sourceProject.tasks.findIndex(t => t.id === args.taskId);
      if (taskIndex === -1) {
        return { content: [{ type: "text", text: "Error: Task not found in source project" }] };
      }
      const [movedTask] = sourceProject.tasks.splice(taskIndex, 1);
      movedTask.updatedAt = new Date().toISOString();

      // Add to target project
      targetProject.tasks.push(movedTask);
      saveData(data);

      return {
        content: [{ type: "text", text: `Moved "${movedTask.name}" from "${sourceProject.name}" to "${targetProject.name}"` }],
      };
    }

    case "create_project": {
      if (!args?.name) {
        return { content: [{ type: "text", text: "Error: Project name is required" }] };
      }

      const existing = data.projects.find(
        (p) => p.name.toLowerCase() === args.name.toLowerCase()
      );
      if (existing) {
        return { content: [{ type: "text", text: `Project "${args.name}" already exists` }] };
      }

      const project = {
        id: generateId(),
        name: args.name,
        description: args.description || "",
        color: args.color || "#6366f1",
        tasks: [],
        createdAt: new Date().toISOString(),
      };

      data.projects.push(project);
      saveData(data);

      return {
        content: [{ type: "text", text: `Created project: "${project.name}"` }],
      };
    }

    case "get_focus_task": {
      const today = new Date().toISOString().split("T")[0];
      const tasks = getAllTasks(data).filter((t) => t.status !== "done");

      if (tasks.length === 0) {
        return {
          content: [{ type: "text", text: "No active tasks! Time to add some or take a break." }],
        };
      }

      // Score tasks: overdue > due today > high priority > in progress > other
      const scored = tasks.map((task) => {
        let score = 0;
        if (task.dueDate && task.dueDate < today) score += 100; // Overdue
        if (task.dueDate === today) score += 50; // Due today
        if (task.priority === "urgent") score += 40;
        if (task.priority === "high") score += 30;
        if (task.status === "in-progress") score += 20; // Already started
        if (task.priority === "medium") score += 10;
        return { task, score };
      });

      scored.sort((a, b) => b.score - a.score);
      const focus = scored[0].task;
      const project = data.projects.find((p) => p.id === focus.projectId);

      let output = `## Focus on This Task\n\n`;
      output += `**${focus.name}**\n`;
      if (focus.description) output += `${focus.description}\n`;
      output += `\n`;
      output += `- Status: ${focus.status}\n`;
      output += `- Priority: ${focus.priority}\n`;
      if (focus.dueDate) output += `- Due: ${focus.dueDate}\n`;
      if (project) output += `- Project: ${project.name}\n`;
      output += `- ID: ${focus.id}\n`;

      if (focus.subtasks?.length > 0) {
        output += `\n### Subtasks\n`;
        focus.subtasks.forEach((st) => {
          output += `- [${st.status === "done" ? "x" : " "}] ${st.name}\n`;
        });
      }

      return { content: [{ type: "text", text: output }] };
    }

    case "plan_my_day": {
      const today = new Date().toISOString().split("T")[0];
      const tasks = getAllTasks(data).filter((t) => t.status !== "done");

      const overdue = tasks.filter((t) => t.dueDate && t.dueDate < today);
      const dueToday = tasks.filter((t) => t.dueDate === today);
      const highPriority = tasks.filter(
        (t) => (t.priority === "urgent" || t.priority === "high") && !dueToday.includes(t) && !overdue.includes(t)
      );
      const inProgress = tasks.filter(
        (t) => t.status === "in-progress" && !dueToday.includes(t) && !overdue.includes(t) && !highPriority.includes(t)
      );

      // Get scheduled tasks for today
      const scheduledToday = tasks.filter(t => t.scheduledDate === today && t.scheduledTime)
        .sort((a, b) => a.scheduledTime.localeCompare(b.scheduledTime));

      // Helper to format a task with goal and action plan
      const formatTaskWithDetails = (t) => {
        let str = `**${t.name}**`;
        if (t.priority !== "none") str += ` !${t.priority}`;
        str += `\n`;
        str += `  ID: ${t.id}\n`;

        // Add scheduling info
        if (t.scheduledTime) {
          str += `  Scheduled: ${t.scheduledTime}`;
          if (t.estimatedMinutes) str += ` (${t.estimatedMinutes}m)`;
          str += `\n`;
        } else if (t.estimatedMinutes) {
          str += `  Estimated: ${t.estimatedMinutes}m\n`;
        }

        if (t.goal) {
          str += `  Goal: ${t.goal}\n`;
        }

        if (t.subtasks && t.subtasks.length > 0) {
          str += `  Action Plan:\n`;
          t.subtasks.forEach((st) => {
            str += `    ${st.status === "done" ? "✓" : "○"} ${st.name}\n`;
          });
        }

        if (t.timeLog && t.timeLog.length > 0) {
          const totalMins = t.timeLog.reduce((sum, e) => sum + e.minutes, 0);
          str += `  Time invested: ${Math.floor(totalMins / 60)}h ${totalMins % 60}m\n`;
        }

        return str;
      };

      let output = `## Your Day Plan\n\n`;

      // Show scheduled tasks first as a time-blocked schedule
      if (scheduledToday.length > 0) {
        output += `### ⏰ Today's Schedule\n\n`;
        let totalScheduledMins = 0;
        scheduledToday.forEach((t) => {
          const duration = t.estimatedMinutes || 30;
          totalScheduledMins += duration;
          const [h, m] = t.scheduledTime.split(":").map(Number);
          const endMins = h * 60 + m + duration;
          const endH = Math.floor(endMins / 60) % 24;
          const endM = endMins % 60;
          const endTime = `${String(endH).padStart(2, "0")}:${String(endM).padStart(2, "0")}`;

          output += `**${t.scheduledTime} - ${endTime}** ${t.name}`;
          if (t.priority !== "none") output += ` !${t.priority}`;
          output += `\n`;
          output += `  ID: ${t.id}\n\n`;
        });
        const schedH = Math.floor(totalScheduledMins / 60);
        const schedM = totalScheduledMins % 60;
        output += `Total scheduled: ${schedH}h ${schedM}m\n\n`;
      }

      if (overdue.length > 0) {
        output += `### 🔴 Overdue - Handle First\n\n`;
        overdue.forEach((t) => {
          output += formatTaskWithDetails(t);
          output += `  Was due: ${t.dueDate}\n\n`;
        });
      }

      // Filter out already-scheduled tasks from due today
      const unscheduledDueToday = dueToday.filter(t => !t.scheduledTime);
      if (unscheduledDueToday.length > 0) {
        output += `### 🟡 Due Today (Unscheduled)\n\n`;
        unscheduledDueToday.forEach((t) => {
          output += formatTaskWithDetails(t) + `\n`;
        });
      }

      if (highPriority.length > 0) {
        output += `### 🟠 High Priority\n\n`;
        highPriority.slice(0, 3).forEach((t) => {
          output += formatTaskWithDetails(t) + `\n`;
        });
      }

      if (inProgress.length > 0) {
        output += `### 🔵 Continue Working On\n\n`;
        inProgress.slice(0, 3).forEach((t) => {
          output += formatTaskWithDetails(t) + `\n`;
        });
      }

      const totalForToday = overdue.length + dueToday.length + Math.min(highPriority.length, 3);
      output += `---\n`;
      output += `**Suggested focus:** ${totalForToday} tasks for today\n`;

      // Calculate total estimated time
      const allDayTasks = [...overdue, ...dueToday, ...highPriority.slice(0, 3)];
      const totalEstMins = allDayTasks.reduce((sum, t) => sum + (t.estimatedMinutes || 30), 0);
      const estH = Math.floor(totalEstMins / 60);
      const estM = totalEstMins % 60;
      output += `**Estimated time:** ~${estH}h ${estM}m\n`;

      if (totalForToday === 0) {
        output += `\nNo urgent tasks! Consider:\n`;
        output += `- Working on upcoming deadlines\n`;
        output += `- Tackling low-priority items\n`;
        output += `- Planning future projects\n`;
      }

      return { content: [{ type: "text", text: output }] };
    }

    case "delete_task": {
      if (!args?.taskId) {
        return { content: [{ type: "text", text: "Error: taskId is required" }] };
      }

      const result = findTask(data, args.taskId);
      if (!result) {
        return { content: [{ type: "text", text: `Error: Task ${args.taskId} not found` }] };
      }

      const { task, project, parentTask } = result;
      const taskName = task.name;

      if (parentTask) {
        // It's a subtask
        parentTask.subtasks = parentTask.subtasks.filter((st) => st.id !== args.taskId);
      } else {
        // It's a main task
        project.tasks = project.tasks.filter((t) => t.id !== args.taskId);
      }

      saveData(data);
      return { content: [{ type: "text", text: `Deleted task: "${taskName}"` }] };
    }

    case "log_time": {
      if (!args?.taskId || !args?.minutes) {
        return { content: [{ type: "text", text: "Error: taskId and minutes are required" }] };
      }

      const result = findTask(data, args.taskId);
      if (!result) {
        return { content: [{ type: "text", text: `Error: Task ${args.taskId} not found` }] };
      }

      const { task } = result;
      if (!task.timeLog) task.timeLog = [];

      const entry = {
        id: generateId(),
        minutes: args.minutes,
        notes: args.notes || "",
        loggedAt: new Date().toISOString(),
      };

      task.timeLog.push(entry);
      saveData(data);

      const totalMinutes = task.timeLog.reduce((sum, e) => sum + e.minutes, 0);
      const hours = Math.floor(totalMinutes / 60);
      const mins = totalMinutes % 60;

      return {
        content: [
          {
            type: "text",
            text: `Logged ${args.minutes} min on "${task.name}"\nTotal time: ${hours}h ${mins}m`,
          },
        ],
      };
    }

    case "set_task_goal": {
      if (!args?.taskId || !args?.goal) {
        return { content: [{ type: "text", text: "Error: taskId and goal are required" }] };
      }

      const result = findTask(data, args.taskId);
      if (!result) {
        return { content: [{ type: "text", text: `Error: Task ${args.taskId} not found` }] };
      }

      result.task.goal = args.goal;
      saveData(data);

      return {
        content: [{ type: "text", text: `Set goal for "${result.task.name}":\n"${args.goal}"` }],
      };
    }

    case "add_learning": {
      if (!args?.taskId || !args?.learning) {
        return { content: [{ type: "text", text: "Error: taskId and learning are required" }] };
      }

      const result = findTask(data, args.taskId);
      if (!result) {
        return { content: [{ type: "text", text: `Error: Task ${args.taskId} not found` }] };
      }

      const { task } = result;
      if (!task.learnings) task.learnings = [];

      task.learnings.push({
        id: generateId(),
        text: args.learning,
        addedAt: new Date().toISOString(),
      });

      saveData(data);

      return {
        content: [{ type: "text", text: `Added learning to "${task.name}":\n"${args.learning}"` }],
      };
    }

    case "daily_recap": {
      const targetDate = args?.date || new Date().toISOString().split("T")[0];
      const tasks = getAllTasks(data);

      // Tasks completed on this date
      const completedToday = tasks.filter((t) => {
        if (!t.completedAt) return false;
        return t.completedAt.split("T")[0] === targetDate;
      });

      // Time logged on this date
      let totalMinutesLogged = 0;
      const timeEntries = [];
      tasks.forEach((t) => {
        if (t.timeLog) {
          t.timeLog.forEach((entry) => {
            if (entry.loggedAt.split("T")[0] === targetDate) {
              totalMinutesLogged += entry.minutes;
              timeEntries.push({ task: t.name, ...entry });
            }
          });
        }
      });

      // Learnings from today
      const todaysLearnings = [];
      tasks.forEach((t) => {
        if (t.learnings) {
          t.learnings.forEach((l) => {
            if (l.addedAt.split("T")[0] === targetDate) {
              todaysLearnings.push({ task: t.name, learning: l.text });
            }
          });
        }
      });

      const hours = Math.floor(totalMinutesLogged / 60);
      const mins = totalMinutesLogged % 60;

      let output = `## Daily Recap: ${targetDate}\n\n`;

      output += `### Accomplished (${completedToday.length} tasks)\n`;
      if (completedToday.length > 0) {
        completedToday.forEach((t) => {
          output += `- ✓ ${t.name}`;
          if (t.goal) output += `\n  Goal: ${t.goal}`;
          output += `\n`;
        });
      } else {
        output += `No tasks completed.\n`;
      }

      output += `\n### Time Invested: ${hours}h ${mins}m\n`;
      if (timeEntries.length > 0) {
        timeEntries.forEach((e) => {
          output += `- ${e.task}: ${e.minutes} min`;
          if (e.notes) output += ` - ${e.notes}`;
          output += `\n`;
        });
      }

      output += `\n### What We Learned\n`;
      if (todaysLearnings.length > 0) {
        todaysLearnings.forEach((l) => {
          output += `- ${l.learning} (from: ${l.task})\n`;
        });
      } else {
        output += `No learnings recorded today.\n`;
      }

      return { content: [{ type: "text", text: output }] };
    }

    case "weekly_review": {
      const today = new Date();
      const weekAgo = new Date(today);
      weekAgo.setDate(weekAgo.getDate() - 7);

      const todayStr = today.toISOString().split("T")[0];
      const weekAgoStr = weekAgo.toISOString().split("T")[0];

      const tasks = getAllTasks(data);

      // Completed this week
      const completedThisWeek = tasks.filter((t) => {
        if (!t.completedAt) return false;
        const completed = t.completedAt.split("T")[0];
        return completed >= weekAgoStr && completed <= todayStr;
      });

      // Time logged this week
      let totalMinutes = 0;
      const projectTime = {};
      tasks.forEach((t) => {
        if (t.timeLog) {
          const project = data.projects.find((p) => p.id === t.projectId);
          const projectName = project?.name || "Inbox";

          t.timeLog.forEach((entry) => {
            const logDate = entry.loggedAt.split("T")[0];
            if (logDate >= weekAgoStr && logDate <= todayStr) {
              totalMinutes += entry.minutes;
              projectTime[projectName] = (projectTime[projectName] || 0) + entry.minutes;
            }
          });
        }
      });

      // All learnings this week
      const weekLearnings = [];
      tasks.forEach((t) => {
        if (t.learnings) {
          t.learnings.forEach((l) => {
            const learnDate = l.addedAt.split("T")[0];
            if (learnDate >= weekAgoStr && learnDate <= todayStr) {
              weekLearnings.push({ task: t.name, learning: l.text });
            }
          });
        }
      });

      // Still active tasks
      const activeTasks = tasks.filter((t) => t.status !== "done");
      const overdue = activeTasks.filter((t) => t.dueDate && t.dueDate < todayStr);

      const hours = Math.floor(totalMinutes / 60);
      const mins = totalMinutes % 60;

      let output = `## Weekly Review (${weekAgoStr} to ${todayStr})\n\n`;

      output += `### Summary\n`;
      output += `- **Tasks Completed:** ${completedThisWeek.length}\n`;
      output += `- **Time Invested:** ${hours}h ${mins}m\n`;
      output += `- **Active Tasks:** ${activeTasks.length}\n`;
      output += `- **Overdue:** ${overdue.length}\n\n`;

      output += `### Accomplishments\n`;
      if (completedThisWeek.length > 0) {
        completedThisWeek.forEach((t) => {
          const project = data.projects.find((p) => p.id === t.projectId);
          output += `- ✓ ${t.name}`;
          if (project && !project.isInbox) output += ` [${project.name}]`;
          output += `\n`;
        });
      } else {
        output += `No tasks completed this week.\n`;
      }

      output += `\n### Time by Project\n`;
      if (Object.keys(projectTime).length > 0) {
        Object.entries(projectTime)
          .sort((a, b) => b[1] - a[1])
          .forEach(([project, minutes]) => {
            const h = Math.floor(minutes / 60);
            const m = minutes % 60;
            output += `- ${project}: ${h}h ${m}m\n`;
          });
      } else {
        output += `No time logged this week.\n`;
      }

      output += `\n### What We Learned Together\n`;
      if (weekLearnings.length > 0) {
        weekLearnings.forEach((l) => {
          output += `- ${l.learning}\n`;
        });
      } else {
        output += `No learnings recorded this week.\n`;
      }

      if (overdue.length > 0) {
        output += `\n### Needs Attention (Overdue)\n`;
        overdue.forEach((t) => {
          output += `- ${t.name} (was due ${t.dueDate})\n`;
        });
      }

      return { content: [{ type: "text", text: output }] };
    }

    case "add_recap_entry": {
      if (!args?.type || !args?.content) {
        return { content: [{ type: "text", text: "Error: type and content are required" }] };
      }

      // Initialize recapLog if it doesn't exist
      if (!data.recapLog) {
        data.recapLog = [];
      }

      const entry = {
        id: generateId(),
        type: args.type,
        content: args.content,
        date: args.date || new Date().toISOString().split("T")[0],
        relatedTaskId: args.relatedTaskId || null,
        tags: args.tags || [],
        createdAt: new Date().toISOString(),
      };

      data.recapLog.push(entry);
      saveData(data);

      const typeEmoji = {
        accomplishment: "✓",
        decision: "⚖",
        note: "📝",
      };

      return {
        content: [{
          type: "text",
          text: `${typeEmoji[entry.type]} Logged ${entry.type}: "${entry.content}"\n\nEntry ID: ${entry.id}\nDate: ${entry.date}`,
        }],
      };
    }

    case "get_recap_log": {
      const today = new Date().toISOString().split("T")[0];
      const startDate = args?.startDate || today;
      const endDate = args?.endDate || startDate;
      const filterType = args?.type || "all";

      if (!data.recapLog || data.recapLog.length === 0) {
        return { content: [{ type: "text", text: "No recap entries logged yet. Use add_recap_entry to start logging accomplishments and decisions." }] };
      }

      const entries = data.recapLog.filter((entry) => {
        const dateMatch = entry.date >= startDate && entry.date <= endDate;
        const typeMatch = filterType === "all" || entry.type === filterType;
        return dateMatch && typeMatch;
      });

      if (entries.length === 0) {
        return { content: [{ type: "text", text: `No entries found for ${startDate} to ${endDate}${filterType !== "all" ? ` (type: ${filterType})` : ""}` }] };
      }

      // Group by date
      const byDate = {};
      entries.forEach((entry) => {
        if (!byDate[entry.date]) byDate[entry.date] = [];
        byDate[entry.date].push(entry);
      });

      const typeEmoji = {
        accomplishment: "✓",
        decision: "⚖",
        note: "📝",
      };

      let output = `## Recap Log: ${startDate}${startDate !== endDate ? ` to ${endDate}` : ""}\n\n`;

      Object.keys(byDate)
        .sort()
        .reverse()
        .forEach((date) => {
          const dayName = new Date(date + "T12:00:00").toLocaleDateString("en-US", { weekday: "long" });
          output += `### ${date} (${dayName})\n`;

          byDate[date].forEach((entry) => {
            output += `- ${typeEmoji[entry.type]} **${entry.type}:** ${entry.content}`;
            if (entry.tags && entry.tags.length > 0) {
              output += ` [${entry.tags.join(", ")}]`;
            }
            output += `\n  ID: ${entry.id}\n`;
          });
          output += `\n`;
        });

      const counts = {
        accomplishment: entries.filter((e) => e.type === "accomplishment").length,
        decision: entries.filter((e) => e.type === "decision").length,
        note: entries.filter((e) => e.type === "note").length,
      };

      output += `---\n**Summary:** ${counts.accomplishment} accomplishments, ${counts.decision} decisions, ${counts.note} notes\n`;

      return { content: [{ type: "text", text: output }] };
    }

    case "save_recap": {
      if (!args?.period) {
        return { content: [{ type: "text", text: "Error: period is required (daily, weekly, or monthly)" }] };
      }

      const today = new Date();
      const refDate = args.date ? new Date(args.date + "T12:00:00") : today;
      let startDate, endDate, periodLabel;

      if (args.period === "daily") {
        startDate = refDate.toISOString().split("T")[0];
        endDate = startDate;
        periodLabel = startDate;
      } else if (args.period === "weekly") {
        // Get week start (Sunday) and end (Saturday)
        const dayOfWeek = refDate.getDay();
        const weekStart = new Date(refDate);
        weekStart.setDate(refDate.getDate() - dayOfWeek);
        const weekEnd = new Date(weekStart);
        weekEnd.setDate(weekStart.getDate() + 6);
        startDate = weekStart.toISOString().split("T")[0];
        endDate = weekEnd.toISOString().split("T")[0];
        periodLabel = `Week of ${startDate}`;
      } else if (args.period === "monthly") {
        startDate = new Date(refDate.getFullYear(), refDate.getMonth(), 1).toISOString().split("T")[0];
        endDate = new Date(refDate.getFullYear(), refDate.getMonth() + 1, 0).toISOString().split("T")[0];
        const monthName = refDate.toLocaleDateString("en-US", { month: "long", year: "numeric" });
        periodLabel = monthName;
      }

      // Initialize savedRecaps if needed
      if (!data.savedRecaps) {
        data.savedRecaps = [];
      }

      // Gather tasks completed in this period
      const tasks = getAllTasks(data);
      const completedTasks = tasks.filter((t) => {
        if (!t.completedAt) return false;
        const completed = t.completedAt.split("T")[0];
        return completed >= startDate && completed <= endDate;
      });

      // Gather recap log entries
      const logEntries = (data.recapLog || []).filter((entry) => {
        return entry.date >= startDate && entry.date <= endDate;
      });

      const accomplishments = logEntries.filter((e) => e.type === "accomplishment");
      const decisions = logEntries.filter((e) => e.type === "decision");
      const notes = logEntries.filter((e) => e.type === "note");

      // Calculate time invested
      let totalMinutes = 0;
      tasks.forEach((t) => {
        if (t.timeLog) {
          t.timeLog.forEach((entry) => {
            const logDate = entry.loggedAt.split("T")[0];
            if (logDate >= startDate && logDate <= endDate) {
              totalMinutes += entry.minutes;
            }
          });
        }
      });
      const hours = Math.floor(totalMinutes / 60);
      const mins = totalMinutes % 60;

      // Build the recap document
      let content = `# ${args.period.charAt(0).toUpperCase() + args.period.slice(1)} Recap: ${periodLabel}\n\n`;
      content += `*Generated: ${new Date().toISOString()}*\n\n`;

      if (args.summary) {
        content += `## Executive Summary\n${args.summary}\n\n`;
      }

      if (args.highlights && args.highlights.length > 0) {
        content += `## Key Highlights\n`;
        args.highlights.forEach((h) => {
          content += `- ${h}\n`;
        });
        content += `\n`;
      }

      content += `## Overview\n`;
      content += `- **Period:** ${startDate} to ${endDate}\n`;
      content += `- **Tasks Completed:** ${completedTasks.length}\n`;
      content += `- **Time Invested:** ${hours}h ${mins}m\n`;
      content += `- **Accomplishments Logged:** ${accomplishments.length}\n`;
      content += `- **Decisions Made:** ${decisions.length}\n\n`;

      if (completedTasks.length > 0) {
        content += `## Completed Tasks\n`;
        completedTasks.forEach((t) => {
          const project = data.projects.find((p) => p.id === t.projectId);
          content += `- ✓ ${t.name}`;
          if (project && !project.isInbox) content += ` [${project.name}]`;
          content += `\n`;
        });
        content += `\n`;
      }

      if (accomplishments.length > 0) {
        content += `## Accomplishments\n`;
        accomplishments.forEach((a) => {
          content += `- ${a.content}`;
          if (a.tags && a.tags.length > 0) content += ` [${a.tags.join(", ")}]`;
          content += `\n`;
        });
        content += `\n`;
      }

      if (decisions.length > 0) {
        content += `## Decisions Made\n`;
        decisions.forEach((d) => {
          content += `- ⚖ ${d.content}`;
          if (d.tags && d.tags.length > 0) content += ` [${d.tags.join(", ")}]`;
          content += `\n`;
        });
        content += `\n`;
      }

      if (notes.length > 0) {
        content += `## Notes & Insights\n`;
        notes.forEach((n) => {
          content += `- ${n.content}\n`;
        });
        content += `\n`;
      }

      // Gather learnings from tasks
      const learnings = [];
      tasks.forEach((t) => {
        if (t.learnings) {
          t.learnings.forEach((l) => {
            const learnDate = l.addedAt.split("T")[0];
            if (learnDate >= startDate && learnDate <= endDate) {
              learnings.push({ task: t.name, learning: l.text });
            }
          });
        }
      });

      if (learnings.length > 0) {
        content += `## What We Learned\n`;
        learnings.forEach((l) => {
          content += `- ${l.learning}\n`;
        });
        content += `\n`;
      }

      // Save the recap
      const savedRecap = {
        id: generateId(),
        period: args.period,
        periodLabel,
        startDate,
        endDate,
        content,
        stats: {
          tasksCompleted: completedTasks.length,
          timeMinutes: totalMinutes,
          accomplishments: accomplishments.length,
          decisions: decisions.length,
          notes: notes.length,
          learnings: learnings.length,
        },
        savedAt: new Date().toISOString(),
      };

      data.savedRecaps.push(savedRecap);
      saveData(data);

      return {
        content: [{
          type: "text",
          text: `## Recap Saved!\n\n**ID:** ${savedRecap.id}\n**Period:** ${periodLabel}\n\n---\n\n${content}`,
        }],
      };
    }

    case "get_saved_recaps": {
      if (!data.savedRecaps || data.savedRecaps.length === 0) {
        return { content: [{ type: "text", text: "No saved recaps yet. Use save_recap to create one." }] };
      }

      const filterPeriod = args?.period || "all";
      const limit = args?.limit || 10;

      let recaps = [...data.savedRecaps];

      if (filterPeriod !== "all") {
        recaps = recaps.filter((r) => r.period === filterPeriod);
      }

      recaps.sort((a, b) => new Date(b.savedAt) - new Date(a.savedAt));
      recaps = recaps.slice(0, limit);

      if (recaps.length === 0) {
        return { content: [{ type: "text", text: `No ${filterPeriod} recaps found.` }] };
      }

      let output = `## Saved Recaps${filterPeriod !== "all" ? ` (${filterPeriod})` : ""}\n\n`;

      recaps.forEach((recap) => {
        output += `### ${recap.periodLabel}\n`;
        output += `- **ID:** ${recap.id}\n`;
        output += `- **Period:** ${recap.period} (${recap.startDate} to ${recap.endDate})\n`;
        output += `- **Saved:** ${recap.savedAt.split("T")[0]}\n`;
        output += `- **Stats:** ${recap.stats.tasksCompleted} tasks, ${recap.stats.accomplishments} accomplishments, ${recap.stats.decisions} decisions\n`;
        output += `\n`;
      });

      output += `---\n`;
      output += `To view full recap content, the documents are stored in the data file.\n`;
      output += `Total saved recaps: ${data.savedRecaps.length}\n`;

      return { content: [{ type: "text", text: output }] };
    }

    case "get_recap_by_id": {
      if (!args?.recapId) {
        return { content: [{ type: "text", text: "Error: recapId is required" }] };
      }

      if (!data.savedRecaps || data.savedRecaps.length === 0) {
        return { content: [{ type: "text", text: "No saved recaps exist." }] };
      }

      const recap = data.savedRecaps.find((r) => r.id === args.recapId);
      if (!recap) {
        return { content: [{ type: "text", text: `Recap ${args.recapId} not found.` }] };
      }

      return { content: [{ type: "text", text: recap.content }] };
    }

    case "delete_recap_entry": {
      if (!args?.entryId) {
        return { content: [{ type: "text", text: "Error: entryId is required" }] };
      }

      if (!data.recapLog || data.recapLog.length === 0) {
        return { content: [{ type: "text", text: "No recap entries exist." }] };
      }

      const entryIndex = data.recapLog.findIndex((e) => e.id === args.entryId);
      if (entryIndex === -1) {
        return { content: [{ type: "text", text: `Entry ${args.entryId} not found.` }] };
      }

      const deleted = data.recapLog.splice(entryIndex, 1)[0];
      saveData(data);

      return {
        content: [{
          type: "text",
          text: `Deleted ${deleted.type} entry: "${deleted.content}" (${deleted.date})`,
        }],
      };
    }

    case "get_calendar_view": {
      const today = new Date();
      const startDate = args?.startDate || new Date(today.getFullYear(), today.getMonth(), 1).toISOString().split("T")[0];
      const endDate = args?.endDate || new Date(today.getFullYear(), today.getMonth() + 1, 0).toISOString().split("T")[0];

      const tasks = getAllTasks(data);

      // Build day-by-day view
      const days = {};
      let currentDate = new Date(startDate);
      const end = new Date(endDate);

      while (currentDate <= end) {
        const dateStr = currentDate.toISOString().split("T")[0];
        days[dateStr] = {
          completed: [],
          due: [],
          timeLogged: 0,
        };
        currentDate.setDate(currentDate.getDate() + 1);
      }

      // Fill in data
      tasks.forEach((t) => {
        // Completed tasks
        if (t.completedAt) {
          const completed = t.completedAt.split("T")[0];
          if (days[completed]) {
            days[completed].completed.push(t.name);
          }
        }

        // Due tasks (not completed)
        if (t.dueDate && t.status !== "done" && days[t.dueDate]) {
          days[t.dueDate].due.push(t.name);
        }

        // Time logged
        if (t.timeLog) {
          t.timeLog.forEach((entry) => {
            const logDate = entry.loggedAt.split("T")[0];
            if (days[logDate]) {
              days[logDate].timeLogged += entry.minutes;
            }
          });
        }
      });

      let output = `## Calendar View: ${startDate} to ${endDate}\n\n`;

      Object.entries(days).forEach(([date, info]) => {
        const hasActivity = info.completed.length > 0 || info.due.length > 0 || info.timeLogged > 0;
        if (hasActivity) {
          const dayName = new Date(date).toLocaleDateString("en-US", { weekday: "short" });
          output += `### ${date} (${dayName})\n`;

          if (info.completed.length > 0) {
            output += `✓ Completed: ${info.completed.join(", ")}\n`;
          }
          if (info.due.length > 0) {
            output += `📅 Due: ${info.due.join(", ")}\n`;
          }
          if (info.timeLogged > 0) {
            const h = Math.floor(info.timeLogged / 60);
            const m = info.timeLogged % 60;
            output += `⏱ Time: ${h}h ${m}m\n`;
          }
          output += `\n`;
        }
      });

      return { content: [{ type: "text", text: output }] };
    }

    case "get_task_context": {
      if (!args?.taskId) {
        return { content: [{ type: "text", text: "Error: taskId is required" }] };
      }

      const result = findTask(data, args.taskId);
      if (!result) {
        return { content: [{ type: "text", text: `Error: Task ${args.taskId} not found` }] };
      }

      const { task, project } = result;

      let output = `## Task Context: ${task.name}\n\n`;
      output += `**ID:** ${task.id}\n`;
      output += `**Status:** ${task.status}\n`;
      output += `**Priority:** ${task.priority}\n`;
      if (task.dueDate) output += `**Due:** ${task.dueDate}\n`;
      if (project) output += `**Project:** ${project.name}\n`;
      output += `\n`;

      if (task.description) {
        output += `### Description\n${task.description}\n\n`;
      }

      if (task.context) {
        output += `### Brain Dump / Context\n${task.context}\n\n`;
      }

      if (task.goal) {
        output += `### Goal\n${task.goal}\n\n`;
      }

      if (task.subtasks && task.subtasks.length > 0) {
        output += `### Action Plan (${task.subtasks.filter(s => s.status === 'done').length}/${task.subtasks.length} done)\n`;
        task.subtasks.forEach(st => {
          output += `- [${st.status === 'done' ? 'x' : ' '}] ${st.name}\n`;
        });
        output += `\n`;
      }

      if (task.learnings && task.learnings.length > 0) {
        output += `### Learnings\n`;
        task.learnings.forEach(l => {
          output += `- ${l.text}\n`;
        });
        output += `\n`;
      }

      if (task.timeLog && task.timeLog.length > 0) {
        const totalMins = task.timeLog.reduce((sum, e) => sum + e.minutes, 0);
        output += `### Time Invested: ${Math.floor(totalMins / 60)}h ${totalMins % 60}m\n`;
      }

      return { content: [{ type: "text", text: output }] };
    }

    case "append_context": {
      if (!args?.taskId || !args?.context) {
        return { content: [{ type: "text", text: "Error: taskId and context are required" }] };
      }

      const result = findTask(data, args.taskId);
      if (!result) {
        return { content: [{ type: "text", text: `Error: Task ${args.taskId} not found` }] };
      }

      const { task } = result;
      const timestamp = new Date().toLocaleString();
      const newContext = task.context
        ? `${task.context}\n\n---\n[Added ${timestamp}]\n${args.context}`
        : args.context;

      task.context = newContext;
      saveData(data);

      return {
        content: [{ type: "text", text: `Added context to "${task.name}"` }],
      };
    }

    case "get_inbox_tasks": {
      const inbox = data.projects.find(p => p.isInbox || p.id === "inbox");
      if (!inbox || inbox.tasks.length === 0) {
        return { content: [{ type: "text", text: "Inbox is empty! No unorganized tasks." }] };
      }

      const pendingTasks = inbox.tasks.filter(t => t.status !== "done");

      let output = `## Inbox (${pendingTasks.length} unorganized tasks)\n\n`;
      output += `These are brain dumps that may need processing:\n\n`;

      pendingTasks.forEach(t => {
        output += `### ${t.name}\n`;
        output += `ID: ${t.id}\n`;
        if (t.context) {
          output += `Context: ${t.context.substring(0, 200)}${t.context.length > 200 ? '...' : ''}\n`;
        }
        output += `Created: ${t.createdAt.split('T')[0]}\n\n`;
      });

      return { content: [{ type: "text", text: output }] };
    }

    case "get_working_on_task": {
      // Support both old single ID and new array format
      const workingOnTaskIds = data.workingOnTaskIds || (data.workingOnTaskId ? [data.workingOnTaskId] : []);

      if (workingOnTaskIds.length === 0) {
        return { content: [{ type: "text", text: "No tasks currently marked as 'Active'. The user hasn't selected any tasks to focus on." }] };
      }

      let output = `## Currently Active Tasks (${workingOnTaskIds.length})\n\n`;

      workingOnTaskIds.forEach((taskId, index) => {
        const result = findTask(data, taskId);
        if (!result) {
          output += `### Task ${index + 1} (not found - may have been deleted)\n\n`;
          return;
        }

        const { task, project } = result;

        output += `### ${task.name}\n`;
        output += `ID: ${task.id}\n`;
        output += `Project: ${project?.name || 'Inbox'}\n`;
        output += `Status: ${task.status}\n`;
        output += `Priority: ${task.priority || 'none'}\n`;

        if (task.description) {
          output += `\n**Description:**\n${task.description}\n`;
        }

        if (task.context) {
          output += `\n**Context/Brain Dump:**\n${task.context}\n`;
        }

        if (task.workNotes) {
          output += `\n**Work Notes:**\n${task.workNotes}\n`;
        }

        if (task.subtasks && task.subtasks.length > 0) {
          output += `\n**Subtasks:**\n`;
          task.subtasks.forEach(st => {
            output += `- [${st.status === 'done' ? 'x' : ' '}] ${st.name}\n`;
          });
        }

        if (task.dueDate) {
          output += `\nDue: ${task.dueDate}\n`;
        }

        if (task.scheduledTime) {
          output += `Scheduled: ${task.scheduledDate || 'today'} at ${task.scheduledTime}\n`;
        }

        if (task.estimatedMinutes) {
          output += `Estimated: ${task.estimatedMinutes} minutes\n`;
        }

        output += `\n---\n\n`;
      });

      return { content: [{ type: "text", text: output }] };
    }

    case "delete_project": {
      if (!args?.projectId && !args?.projectName) {
        return { content: [{ type: "text", text: "Error: projectId or projectName is required" }] };
      }

      let project = null;
      let projectIndex = -1;

      if (args.projectId) {
        projectIndex = data.projects.findIndex((p) => p.id === args.projectId);
        project = data.projects[projectIndex];
      } else if (args.projectName) {
        projectIndex = data.projects.findIndex(
          (p) => p.name.toLowerCase() === args.projectName.toLowerCase()
        );
        project = data.projects[projectIndex];
      }

      if (!project || projectIndex === -1) {
        return { content: [{ type: "text", text: `Error: Project not found` }] };
      }

      if (project.isInbox || project.id === "inbox") {
        return { content: [{ type: "text", text: "Error: Cannot delete the Inbox project" }] };
      }

      const taskCount = project.tasks.length;
      const projectName = project.name;

      data.projects.splice(projectIndex, 1);
      saveData(data);

      return {
        content: [{ type: "text", text: `Deleted project "${projectName}" and ${taskCount} tasks` }],
      };
    }

    case "delete_all_completed": {
      let deletedCount = 0;
      const projectFilter = args?.projectName?.toLowerCase();

      for (const project of data.projects) {
        if (projectFilter && project.name.toLowerCase() !== projectFilter) {
          continue;
        }

        const beforeCount = project.tasks.length;
        project.tasks = project.tasks.filter((t) => t.status !== "done");
        deletedCount += beforeCount - project.tasks.length;

        // Also clean up completed subtasks
        for (const task of project.tasks) {
          if (task.subtasks) {
            const subtasksBefore = task.subtasks.length;
            task.subtasks = task.subtasks.filter((st) => st.status !== "done");
            deletedCount += subtasksBefore - task.subtasks.length;
          }
        }
      }

      saveData(data);

      const scopeMsg = projectFilter ? ` from "${args.projectName}"` : "";
      return {
        content: [{ type: "text", text: `Deleted ${deletedCount} completed tasks${scopeMsg}` }],
      };
    }

    // ============================================
    // TIME BLOCKING TOOLS (Step 1A)
    // ============================================

    case "set_scheduled_time": {
      if (!args?.taskId || !args?.scheduledTime) {
        return { content: [{ type: "text", text: "Error: taskId and scheduledTime are required" }] };
      }

      // Validate time format
      const timeRegex = /^([01]?[0-9]|2[0-3]):([0-5][0-9])$/;
      if (!timeRegex.test(args.scheduledTime)) {
        return { content: [{ type: "text", text: "Error: scheduledTime must be in HH:MM format (e.g., '09:00', '14:30')" }] };
      }

      const result = findTask(data, args.taskId);
      if (!result) {
        return { content: [{ type: "text", text: `Error: Task ${args.taskId} not found` }] };
      }

      const { task } = result;
      const today = new Date().toISOString().split("T")[0];

      task.scheduledTime = args.scheduledTime;
      task.scheduledDate = args.scheduledDate || today;
      if (args.estimatedMinutes) {
        task.estimatedMinutes = args.estimatedMinutes;
      }

      // If task doesn't have a due date, set it to the scheduled date
      if (!task.dueDate) {
        task.dueDate = task.scheduledDate;
      }

      saveData(data);

      let output = `Scheduled "${task.name}" for ${task.scheduledTime} on ${task.scheduledDate}`;
      if (task.estimatedMinutes) {
        output += ` (${task.estimatedMinutes} min estimated)`;
      }

      return { content: [{ type: "text", text: output }] };
    }

    case "get_scheduled_tasks": {
      const targetDate = args?.date || new Date().toISOString().split("T")[0];
      const tasks = getAllTasks(data);

      const scheduledTasks = tasks
        .filter(t => t.scheduledDate === targetDate && t.scheduledTime && t.status !== "done")
        .sort((a, b) => a.scheduledTime.localeCompare(b.scheduledTime));

      if (scheduledTasks.length === 0) {
        return { content: [{ type: "text", text: `No tasks scheduled for ${targetDate}` }] };
      }

      let output = `## Scheduled Tasks for ${targetDate}\n\n`;
      let totalMinutes = 0;

      scheduledTasks.forEach(task => {
        const project = data.projects.find(p => p.id === task.projectId);
        const duration = task.estimatedMinutes || 30;
        totalMinutes += duration;

        // Calculate end time
        const [hours, mins] = task.scheduledTime.split(":").map(Number);
        const endMins = hours * 60 + mins + duration;
        const endHour = Math.floor(endMins / 60) % 24;
        const endMin = endMins % 60;
        const endTime = `${String(endHour).padStart(2, "0")}:${String(endMin).padStart(2, "0")}`;

        output += `**${task.scheduledTime} - ${endTime}** (${duration}m)\n`;
        output += `  ${task.name}`;
        if (task.priority !== "none") output += ` !${task.priority}`;
        if (project && !project.isInbox) output += ` [${project.name}]`;
        output += `\n  ID: ${task.id}\n\n`;
      });

      const hours = Math.floor(totalMinutes / 60);
      const mins = totalMinutes % 60;
      output += `---\n**Total scheduled:** ${scheduledTasks.length} tasks, ${hours}h ${mins}m\n`;

      return { content: [{ type: "text", text: output }] };
    }

    case "clear_scheduled_time": {
      if (!args?.taskId) {
        return { content: [{ type: "text", text: "Error: taskId is required" }] };
      }

      const result = findTask(data, args.taskId);
      if (!result) {
        return { content: [{ type: "text", text: `Error: Task ${args.taskId} not found` }] };
      }

      const { task } = result;
      delete task.scheduledTime;
      delete task.scheduledDate;

      saveData(data);

      return { content: [{ type: "text", text: `Cleared scheduled time for "${task.name}"` }] };
    }

    // ============================================
    // AI WORKFLOW TOOLS (Step 2)
    // ============================================

    case "process_brain_dump": {
      if (!args?.taskId) {
        return { content: [{ type: "text", text: "Error: taskId is required" }] };
      }

      const result = findTask(data, args.taskId);
      if (!result) {
        return { content: [{ type: "text", text: `Error: Task ${args.taskId} not found` }] };
      }

      const { task, project } = result;
      const context = `${task.name} ${task.description || ''} ${task.context || ''}`.toLowerCase();

      // Extract structured information from the brain dump
      const analysis = {
        suggestedName: task.name,
        hasDescription: !!task.description,
        hasContext: !!task.context,
        suggestedPriority: "medium",
        suggestedComplexity: 3,
        suggestedProject: project?.name || null,
        keyPhrases: [],
        actionItems: [],
        questions: [],
        blockers: [],
      };

      // Analyze priority signals
      if (context.includes("urgent") || context.includes("asap") || context.includes("critical") || context.includes("emergency")) {
        analysis.suggestedPriority = "urgent";
      } else if (context.includes("important") || context.includes("high priority") || context.includes("deadline")) {
        analysis.suggestedPriority = "high";
      } else if (context.includes("when i get time") || context.includes("nice to have") || context.includes("eventually")) {
        analysis.suggestedPriority = "low";
      }

      // Analyze complexity signals
      let complexityScore = 3;
      if (context.includes("simple") || context.includes("quick") || context.includes("easy")) complexityScore--;
      if (context.includes("complex") || context.includes("complicated") || context.includes("multiple")) complexityScore++;
      if (context.includes("research") || context.includes("investigate") || context.includes("figure out")) complexityScore++;
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
      if (context.includes("waiting") || context.includes("blocked") || context.includes("depends on") || context.includes("need from")) {
        analysis.blockers.push("Potential dependency or blocker detected in context");
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
        analysis.questions.forEach(q => output += `- ${q.trim()}\n`);
      }

      if (analysis.actionItems.length > 0) {
        output += `\n### Potential Action Items\n`;
        analysis.actionItems.forEach(a => output += `- ${a.trim()}\n`);
      }

      if (analysis.blockers.length > 0) {
        output += `\n### Potential Blockers\n`;
        analysis.blockers.forEach(b => output += `- ${b}\n`);
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

      return { content: [{ type: "text", text: output }] };
    }

    case "get_ready_tasks": {
      const today = new Date().toISOString().split("T")[0];

      // Focus queue mode - prioritized top tasks
      if (args?.highPriorityOnly) {
        let tasks = getAllTasks(data).filter(t => t.status !== "done");

        if (tasks.length === 0) {
          return { content: [{ type: "text", text: "No active tasks! Time to add some or take a break." }] };
        }

        // Score tasks for prioritization
        const scored = tasks.map(task => {
          let score = 0;

          // Scheduled for today with time = highest priority
          if (task.scheduledDate === today && task.scheduledTime) {
            score += 200;
            // Earlier scheduled times get higher priority
            const [h, m] = task.scheduledTime.split(":").map(Number);
            score += (24 * 60 - (h * 60 + m)) / 10;
          }

          // Overdue
          if (task.dueDate && task.dueDate < today) score += 100;

          // Due today (but not scheduled)
          if (task.dueDate === today && !task.scheduledTime) score += 50;

          // Priority
          if (task.priority === "urgent") score += 40;
          if (task.priority === "high") score += 30;
          if (task.status === "in-progress") score += 20;
          if (task.priority === "medium") score += 10;
          if (task.status === "ready") score += 5;

          return { task, score };
        });

        scored.sort((a, b) => b.score - a.score);
        const limit = args.limit || 5;
        const topTasks = scored.slice(0, limit);

        let output = `## Focus Queue (Top ${limit})\n\n`;
        topTasks.forEach((item, index) => {
          const t = item.task;
          const project = data.projects.find(p => p.id === t.projectId);

          output += `### ${index + 1}. ${t.name}\n`;
          output += `ID: ${t.id}\n`;
          if (t.scheduledTime) output += `Scheduled: ${t.scheduledTime}`;
          if (t.estimatedMinutes) output += ` (${t.estimatedMinutes}m)`;
          if (t.scheduledTime) output += `\n`;
          if (t.priority !== "none") output += `Priority: ${t.priority}\n`;
          if (t.dueDate) output += `Due: ${t.dueDate}\n`;
          if (project && !project.isInbox) output += `Project: ${project.name}\n`;
          output += `\n`;
        });

        return { content: [{ type: "text", text: output }] };
      }

      // Standard mode - tasks with status 'ready'
      let tasks = getAllTasks(data).filter(t => t.status === "ready");

      if (args?.projectName) {
        tasks = tasks.filter(t => {
          const project = data.projects.find(p => p.tasks.some(pt => pt.id === t.id));
          return project?.name.toLowerCase().includes(args.projectName.toLowerCase());
        });
      }

      if (args?.limit) {
        tasks = tasks.slice(0, args.limit);
      }

      if (tasks.length === 0) {
        return { content: [{ type: "text", text: "No tasks with 'ready' status found." }] };
      }

      let output = `## Ready Tasks (${tasks.length})\n\n`;
      output += `These tasks are clarified and ready to work on:\n\n`;

      tasks.forEach(task => {
        const project = data.projects.find(p => p.tasks.some(t => t.id === task.id));
        output += `**${task.name}**\n`;
        output += `  ID: ${task.id}\n`;
        if (task.priority !== "none") output += `  Priority: ${task.priority}\n`;
        if (task.dueDate) output += `  Due: ${task.dueDate}\n`;
        if (project && !project.isInbox) output += `  Project: ${project.name}\n`;
        if (task.estimatedMinutes) output += `  Estimated: ${task.estimatedMinutes}m\n`;
        output += `\n`;
      });

      return { content: [{ type: "text", text: output }] };
    }

    case "set_waiting_reason": {
      if (!args?.taskId || !args?.reason) {
        return { content: [{ type: "text", text: "Error: taskId and reason are required" }] };
      }

      const result = findTask(data, args.taskId);
      if (!result) {
        return { content: [{ type: "text", text: `Error: Task ${args.taskId} not found` }] };
      }

      const { task } = result;
      task.waitingReason = args.reason;
      if (args.blockedBy) {
        task.blockedBy = args.blockedBy;
      }

      // Automatically set status to waiting if not already
      if (task.status !== "waiting") {
        task.status = "waiting";
      }

      saveData(data);

      let output = `Updated "${task.name}":\n`;
      output += `- Status: waiting\n`;
      output += `- Reason: ${args.reason}\n`;
      if (args.blockedBy) {
        output += `- Blocked by: ${args.blockedBy}\n`;
      }

      return { content: [{ type: "text", text: output }] };
    }

    case "bulk_schedule_today": {
      if (!args?.schedule || !Array.isArray(args.schedule)) {
        return { content: [{ type: "text", text: "Error: schedule array is required" }] };
      }

      const today = new Date().toISOString().split("T")[0];
      const results = [];
      const errors = [];

      for (const item of args.schedule) {
        if (!item.taskId || !item.scheduledTime) {
          errors.push(`Invalid schedule item: missing taskId or scheduledTime`);
          continue;
        }

        const result = findTask(data, item.taskId);
        if (!result) {
          errors.push(`Task ${item.taskId} not found`);
          continue;
        }

        const { task } = result;
        task.scheduledTime = item.scheduledTime;
        task.scheduledDate = today;
        if (item.estimatedMinutes) {
          task.estimatedMinutes = item.estimatedMinutes;
        }
        if (!task.dueDate) {
          task.dueDate = today;
        }

        results.push(`${task.scheduledTime} - ${task.name}${item.estimatedMinutes ? ` (${item.estimatedMinutes}m)` : ''}`);
      }

      saveData(data);

      let output = `## Bulk Schedule Results for ${today}\n\n`;

      if (results.length > 0) {
        output += `### Scheduled (${results.length})\n`;
        results.forEach(r => output += `- ${r}\n`);
      }

      if (errors.length > 0) {
        output += `\n### Errors (${errors.length})\n`;
        errors.forEach(e => output += `- ${e}\n`);
      }

      return { content: [{ type: "text", text: output }] };
    }

    // ============================================
    // SUGGEST SUBTASKS TOOLS (Step 3)
    // ============================================

    case "suggest_subtasks": {
      if (!args?.taskId) {
        return { content: [{ type: "text", text: "Error: taskId is required" }] };
      }

      const result = findTask(data, args.taskId);
      if (!result) {
        return { content: [{ type: "text", text: `Error: Task ${args.taskId} not found` }] };
      }

      const { task } = result;
      const fullText = `${task.name} ${task.description || ''} ${task.context || ''}`;
      const suggestions = [];

      // Common action patterns
      const patterns = [
        { pattern: /need to ([^.!?]+)/gi, prefix: "" },
        { pattern: /should ([^.!?]+)/gi, prefix: "" },
        { pattern: /have to ([^.!?]+)/gi, prefix: "" },
        { pattern: /must ([^.!?]+)/gi, prefix: "" },
        { pattern: /first,? ([^.!?,]+)/gi, prefix: "" },
        { pattern: /then,? ([^.!?,]+)/gi, prefix: "" },
        { pattern: /finally,? ([^.!?,]+)/gi, prefix: "" },
        { pattern: /\d+\.\s*([^.!?\n]+)/gi, prefix: "" }, // Numbered items
        { pattern: /-\s*([^.!?\n]+)/gi, prefix: "" }, // Bullet points
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

      if (taskLower.includes("write") || taskLower.includes("document") || taskLower.includes("article")) {
        if (!suggestions.some(s => s.includes("outline"))) suggestions.push("Create outline");
        if (!suggestions.some(s => s.includes("draft"))) suggestions.push("Write first draft");
        if (!suggestions.some(s => s.includes("review"))) suggestions.push("Review and edit");
      }

      if (taskLower.includes("research") || taskLower.includes("investigate")) {
        if (!suggestions.some(s => s.includes("gather"))) suggestions.push("Gather sources");
        if (!suggestions.some(s => s.includes("summarize"))) suggestions.push("Summarize findings");
      }

      if (taskLower.includes("meeting") || taskLower.includes("present")) {
        if (!suggestions.some(s => s.includes("agenda"))) suggestions.push("Prepare agenda");
        if (!suggestions.some(s => s.includes("slides"))) suggestions.push("Create slides/materials");
        if (!suggestions.some(s => s.includes("follow"))) suggestions.push("Send follow-up notes");
      }

      if (taskLower.includes("code") || taskLower.includes("develop") || taskLower.includes("implement") || taskLower.includes("build")) {
        if (!suggestions.some(s => s.includes("design"))) suggestions.push("Design approach");
        if (!suggestions.some(s => s.includes("implement"))) suggestions.push("Implement solution");
        if (!suggestions.some(s => s.includes("test"))) suggestions.push("Write tests");
        if (!suggestions.some(s => s.includes("review"))) suggestions.push("Code review");
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

      return { content: [{ type: "text", text: output }] };
    }

    // ============================================
    // PARALLEL EXECUTION TOOLS
    // ============================================

    case "set_execution_type": {
      if (!args?.taskId || !args?.executionType) {
        return { content: [{ type: "text", text: "Error: taskId and executionType are required" }] };
      }

      const validTypes = ["ai", "manual", "hybrid"];
      if (!validTypes.includes(args.executionType)) {
        return { content: [{ type: "text", text: `Error: executionType must be one of: ${validTypes.join(", ")}` }] };
      }

      const result = findTask(data, args.taskId);
      if (!result) {
        return { content: [{ type: "text", text: `Error: Task ${args.taskId} not found` }] };
      }

      const { task } = result;
      task.executionType = args.executionType;
      saveData(data);

      const typeLabels = {
        ai: "🤖 AI (Claude can do autonomously)",
        manual: "👤 Manual (requires your action)",
        hybrid: "🤝 Hybrid (collaborative)",
      };

      return {
        content: [{ type: "text", text: `Updated "${task.name}" execution type to: ${typeLabels[args.executionType]}` }],
      };
    }

    case "suggest_parallel_tasks": {
      const targetDate = args?.date || new Date().toISOString().split("T")[0];
      const tasks = getAllTasks(data).filter(t =>
        t.status !== "done" && t.status !== "waiting"
      );

      // Get tasks for today
      const todayTasks = tasks.filter(t =>
        t.scheduledDate === targetDate ||
        t.dueDate === targetDate ||
        t.status === "ready" ||
        t.status === "in-progress"
      );

      // Separate by execution type (default to manual if not set)
      const aiTasks = todayTasks.filter(t => t.executionType === "ai");
      const manualTasks = todayTasks.filter(t => !t.executionType || t.executionType === "manual");
      const hybridTasks = todayTasks.filter(t => t.executionType === "hybrid");

      // Find good parallel pairs
      const suggestions = [];

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
              reason: "These can be done in parallel - Claude works on one while you do the other",
            });
          }
        }
      }

      // Also suggest untagged tasks that could be parallelized
      const untaggedTasks = todayTasks.filter(t => !t.executionType);

      let output = `## Parallel Task Suggestions for ${targetDate}\n\n`;

      if (suggestions.length > 0) {
        output += `### Recommended Parallel Pairs\n\n`;
        suggestions.slice(0, 3).forEach((s, i) => {
          output += `**Pair ${i + 1}:**\n`;
          output += `- 🤖 Claude: "${s.aiTask.name}" (~${s.aiTask.estimated}m)\n`;
          output += `- 👤 You: "${s.manualTask.name}" (~${s.manualTask.estimated}m)\n`;
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
      output += `- 🤖 AI tasks: ${aiTasks.length}\n`;
      output += `- 👤 Manual tasks: ${manualTasks.length}\n`;
      output += `- 🤝 Hybrid tasks: ${hybridTasks.length}\n`;
      output += `- ❓ Untagged: ${untaggedTasks.length}\n`;

      return { content: [{ type: "text", text: output }] };
    }

    case "get_parallel_schedule": {
      const targetDate = args?.date || new Date().toISOString().split("T")[0];
      const tasks = getAllTasks(data).filter(t =>
        t.status !== "done" &&
        (t.scheduledDate === targetDate || t.dueDate === targetDate)
      );

      // Separate by execution type
      const aiTasks = tasks.filter(t => t.executionType === "ai")
        .sort((a, b) => (a.scheduledTime || "99:99").localeCompare(b.scheduledTime || "99:99"));
      const manualTasks = tasks.filter(t => !t.executionType || t.executionType === "manual")
        .sort((a, b) => (a.scheduledTime || "99:99").localeCompare(b.scheduledTime || "99:99"));
      const hybridTasks = tasks.filter(t => t.executionType === "hybrid")
        .sort((a, b) => (a.scheduledTime || "99:99").localeCompare(b.scheduledTime || "99:99"));

      let output = `## Parallel Schedule for ${targetDate}\n\n`;

      // AI Track
      output += `### 🤖 CLAUDE TRACK\n`;
      if (aiTasks.length === 0) {
        output += `_No AI tasks scheduled_\n\n`;
      } else {
        aiTasks.forEach(t => {
          const time = t.scheduledTime || "Unscheduled";
          const duration = t.estimatedMinutes ? `(${t.estimatedMinutes}m)` : "";
          output += `- **${time}** ${t.name} ${duration}\n`;
          output += `  ID: ${t.id}\n`;
        });
        output += `\n`;
      }

      // Manual Track
      output += `### 👤 YOUR TRACK\n`;
      if (manualTasks.length === 0) {
        output += `_No manual tasks scheduled_\n\n`;
      } else {
        manualTasks.forEach(t => {
          const time = t.scheduledTime || "Unscheduled";
          const duration = t.estimatedMinutes ? `(${t.estimatedMinutes}m)` : "";
          output += `- **${time}** ${t.name} ${duration}\n`;
          output += `  ID: ${t.id}\n`;
        });
        output += `\n`;
      }

      // Hybrid Track
      if (hybridTasks.length > 0) {
        output += `### 🤝 COLLABORATIVE TRACK\n`;
        hybridTasks.forEach(t => {
          const time = t.scheduledTime || "Unscheduled";
          const duration = t.estimatedMinutes ? `(${t.estimatedMinutes}m)` : "";
          output += `- **${time}** ${t.name} ${duration}\n`;
          output += `  ID: ${t.id}\n`;
        });
        output += `\n`;
      }

      // Summary
      const totalAiMins = aiTasks.reduce((sum, t) => sum + (t.estimatedMinutes || 30), 0);
      const totalManualMins = manualTasks.reduce((sum, t) => sum + (t.estimatedMinutes || 30), 0);

      output += `---\n`;
      output += `**Summary:**\n`;
      output += `- Claude track: ${aiTasks.length} tasks, ~${Math.floor(totalAiMins / 60)}h ${totalAiMins % 60}m\n`;
      output += `- Your track: ${manualTasks.length} tasks, ~${Math.floor(totalManualMins / 60)}h ${totalManualMins % 60}m\n`;
      output += `- Collaborative: ${hybridTasks.length} tasks\n`;

      return { content: [{ type: "text", text: output }] };
    }

    // ============================================
    // PRIORITY RECOMMENDATION TOOLS (Step 4)
    // ============================================

    case "suggest_priority": {
      if (!args?.taskId) {
        return { content: [{ type: "text", text: "Error: taskId is required" }] };
      }

      const result = findTask(data, args.taskId);
      if (!result) {
        return { content: [{ type: "text", text: `Error: Task ${args.taskId} not found` }] };
      }

      const { task } = result;
      const fullText = `${task.name} ${task.description || ''} ${task.context || ''}`.toLowerCase();
      const today = new Date().toISOString().split("T")[0];

      let suggestedPriority = "medium";
      const reasons = [];

      // Check for urgency signals in text
      if (fullText.includes("urgent") || fullText.includes("asap") || fullText.includes("emergency") || fullText.includes("critical")) {
        suggestedPriority = "urgent";
        reasons.push("Contains urgency keywords (urgent, asap, emergency, critical)");
      } else if (fullText.includes("important") || fullText.includes("high priority") || fullText.includes("crucial")) {
        suggestedPriority = "high";
        reasons.push("Contains importance keywords (important, high priority, crucial)");
      } else if (fullText.includes("eventually") || fullText.includes("nice to have") || fullText.includes("when i get time") || fullText.includes("low priority")) {
        suggestedPriority = "low";
        reasons.push("Contains low-priority keywords (eventually, nice to have)");
      }

      // Check due date
      if (task.dueDate) {
        if (task.dueDate < today) {
          if (suggestedPriority !== "urgent") {
            suggestedPriority = "urgent";
            reasons.push(`Task is OVERDUE (was due ${task.dueDate})`);
          }
        } else if (task.dueDate === today) {
          if (suggestedPriority === "low" || suggestedPriority === "medium") {
            suggestedPriority = "high";
            reasons.push("Task is due TODAY");
          }
        } else {
          const dueDate = new Date(task.dueDate);
          const todayDate = new Date(today);
          const daysUntil = Math.ceil((dueDate - todayDate) / (1000 * 60 * 60 * 24));
          if (daysUntil <= 2 && suggestedPriority === "low") {
            suggestedPriority = "medium";
            reasons.push(`Task is due in ${daysUntil} days`);
          }
        }
      }

      // Check for blocked status
      if (task.status === "waiting") {
        reasons.push("Task is currently blocked/waiting - priority may be less relevant until unblocked");
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

      return { content: [{ type: "text", text: output }] };
    }

    case "suggest_next_task": {
      const today = new Date().toISOString().split("T")[0];
      const tasks = getAllTasks(data).filter(t =>
        t.status !== "done" && t.status !== "waiting"
      );

      if (tasks.length === 0) {
        return { content: [{ type: "text", text: "No active tasks available! Either all tasks are complete, or they're blocked/waiting." }] };
      }

      // Score each task
      const scored = tasks.map(task => {
        let score = 0;
        const reasons = [];

        // Scheduled now/soon
        if (task.scheduledDate === today && task.scheduledTime) {
          const now = new Date();
          const [h, m] = task.scheduledTime.split(":").map(Number);
          const scheduledMins = h * 60 + m;
          const currentMins = now.getHours() * 60 + now.getMinutes();

          if (currentMins >= scheduledMins && currentMins <= scheduledMins + (task.estimatedMinutes || 60)) {
            score += 100;
            reasons.push("Scheduled for RIGHT NOW");
          } else if (currentMins < scheduledMins && scheduledMins - currentMins <= 60) {
            score += 50;
            reasons.push("Scheduled within the next hour");
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
          reasons.push("Due TODAY");
        }

        // Priority
        if (task.priority === "urgent") {
          score += 35;
          reasons.push("Marked as URGENT");
        } else if (task.priority === "high") {
          score += 25;
          reasons.push("High priority");
        } else if (task.priority === "medium") {
          score += 10;
          reasons.push("Medium priority");
        }

        // Status
        if (task.status === "in-progress") {
          score += 20;
          reasons.push("Already in progress");
        } else if (task.status === "ready") {
          score += 10;
          reasons.push("Ready to work on");
        }

        // Complexity preference (prefer simpler tasks for quick wins)
        if (task.complexity === 1) score += 5;
        if (task.complexity === 2) score += 3;

        return { task, score, reasons };
      });

      scored.sort((a, b) => b.score - a.score);
      const top = scored[0];
      const project = data.projects.find(p => p.tasks.some(t => t.id === top.task.id));

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
      top.reasons.forEach(r => output += `- ${r}\n`);
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
        const pending = top.task.subtasks.filter(s => s.status !== 'done').length;
        output += `3. ${pending} subtask(s) pending\n`;
      }

      return { content: [{ type: "text", text: output }] };
    }

    case "prioritize_inbox": {
      const inbox = data.projects.find(p => p.isInbox || p.id === "inbox");
      if (!inbox || inbox.tasks.length === 0) {
        return { content: [{ type: "text", text: "Inbox is empty! No items to prioritize." }] };
      }

      const inboxTasks = inbox.tasks.filter(t => t.status === "todo");
      if (inboxTasks.length === 0) {
        return { content: [{ type: "text", text: "No unprocessed inbox items. All tasks have been organized." }] };
      }

      const today = new Date().toISOString().split("T")[0];

      // Score and prioritize
      const prioritized = inboxTasks.map(task => {
        const fullText = `${task.name} ${task.description || ''} ${task.context || ''}`.toLowerCase();
        let suggestedPriority = "medium";
        let score = 50;
        const signals = [];

        // Urgency signals
        if (fullText.includes("urgent") || fullText.includes("asap") || fullText.includes("emergency")) {
          suggestedPriority = "urgent";
          score += 40;
          signals.push("urgency keywords");
        } else if (fullText.includes("important") || fullText.includes("deadline") || fullText.includes("due")) {
          suggestedPriority = "high";
          score += 25;
          signals.push("importance keywords");
        } else if (fullText.includes("eventually") || fullText.includes("someday") || fullText.includes("nice to have")) {
          suggestedPriority = "low";
          score -= 20;
          signals.push("low-priority keywords");
        }

        // Due date
        if (task.dueDate) {
          if (task.dueDate < today) {
            suggestedPriority = "urgent";
            score += 50;
            signals.push("OVERDUE");
          } else if (task.dueDate === today) {
            if (suggestedPriority !== "urgent") suggestedPriority = "high";
            score += 30;
            signals.push("due today");
          }
        }

        // Context richness (more context = probably more thought through)
        if (task.context && task.context.length > 100) {
          score += 10;
          signals.push("detailed context");
        }

        // Age (older items might need attention)
        const age = (Date.now() - new Date(task.createdAt).getTime()) / (1000 * 60 * 60 * 24);
        if (age > 7) {
          score += 5;
          signals.push(`${Math.floor(age)} days old`);
        }

        return { task, suggestedPriority, score, signals };
      });

      prioritized.sort((a, b) => b.score - a.score);

      let output = `## Inbox Prioritization (${inboxTasks.length} items)\n\n`;
      output += `Items ranked by suggested importance:\n\n`;

      prioritized.forEach((item, index) => {
        output += `### ${index + 1}. ${item.task.name}\n`;
        output += `- **ID:** ${item.task.id}\n`;
        output += `- **Current Priority:** ${item.task.priority}\n`;
        output += `- **Suggested Priority:** ${item.suggestedPriority}\n`;
        if (item.signals.length > 0) {
          output += `- **Signals:** ${item.signals.join(", ")}\n`;
        }
        output += `\n`;
      });

      output += `---\n`;
      output += `### Summary\n`;
      const urgent = prioritized.filter(p => p.suggestedPriority === "urgent").length;
      const high = prioritized.filter(p => p.suggestedPriority === "high").length;
      const medium = prioritized.filter(p => p.suggestedPriority === "medium").length;
      const low = prioritized.filter(p => p.suggestedPriority === "low").length;

      output += `- Urgent: ${urgent}\n`;
      output += `- High: ${high}\n`;
      output += `- Medium: ${medium}\n`;
      output += `- Low: ${low}\n`;
      output += `\nUse \`update_task\` to apply suggested priorities.\n`;

      return { content: [{ type: "text", text: output }] };
    }

    // ============================================
    // ENHANCED PROJECT TRACKING TOOL HANDLERS
    // ============================================

    case "get_categories": {
      // Initialize categories if missing
      if (!data.categories) {
        data.categories = [
          { id: "cat-work", name: "Work", color: "#6366f1", order: 0, collapsed: false },
          { id: "cat-personal", name: "Personal", color: "#10b981", order: 1, collapsed: false },
          { id: "cat-side", name: "Side Projects", color: "#f59e0b", order: 2, collapsed: false },
        ];
        saveData(data);
      }

      const categories = data.categories.map((cat) => {
        const projects = data.projects.filter((p) => p.categoryId === cat.id && !p.isInbox);
        const totalTasks = projects.reduce((sum, p) => sum + p.tasks.filter((t) => t.status !== "done").length, 0);
        const completedTasks = projects.reduce((sum, p) => sum + p.tasks.filter((t) => t.status === "done").length, 0);

        return {
          id: cat.id,
          name: cat.name,
          color: cat.color,
          projectCount: projects.length,
          activeTasks: totalTasks,
          completedTasks: completedTasks,
        };
      });

      // Count uncategorized
      const uncategorized = data.projects.filter((p) => !p.categoryId && !p.isInbox);
      if (uncategorized.length > 0) {
        categories.push({
          id: null,
          name: "Uncategorized",
          color: "#9ca3af",
          projectCount: uncategorized.length,
          activeTasks: uncategorized.reduce((sum, p) => sum + p.tasks.filter((t) => t.status !== "done").length, 0),
          completedTasks: uncategorized.reduce((sum, p) => sum + p.tasks.filter((t) => t.status === "done").length, 0),
        });
      }

      return { content: [{ type: "text", text: JSON.stringify(categories, null, 2) }] };
    }

    case "create_category": {
      if (!args?.name) {
        return { content: [{ type: "text", text: "Error: name is required" }] };
      }

      // Initialize categories if missing
      if (!data.categories) {
        data.categories = [];
      }

      const maxOrder = Math.max(0, ...data.categories.map((c) => c.order || 0));
      const category = {
        id: generateId(),
        name: args.name,
        color: args.color || "#6366f1",
        order: maxOrder + 1,
        collapsed: false,
      };

      data.categories.push(category);
      saveData(data);

      return {
        content: [{
          type: "text",
          text: `Category created!\n\nName: ${category.name}\nColor: ${category.color}\nID: ${category.id}`,
        }],
      };
    }

    case "suggest_project_breakdown": {
      let project = null;

      if (args?.projectId) {
        project = data.projects.find((p) => p.id === args.projectId);
      } else if (args?.projectName) {
        project = data.projects.find((p) =>
          p.name.toLowerCase().includes(args.projectName.toLowerCase())
        );
      }

      if (!project) {
        return { content: [{ type: "text", text: "Error: Project not found. Provide a valid projectId or projectName." }] };
      }

      const tasks = project.tasks;
      const activeTasks = tasks.filter((t) => t.status !== "done");
      const completedTasks = tasks.filter((t) => t.status === "done");

      // Analyze existing task patterns
      const hasSubtasks = tasks.some((t) => t.subtasks && t.subtasks.length > 0);
      const hasPriorities = tasks.some((t) => t.priority && t.priority !== "none");
      const hasDueDates = tasks.some((t) => t.dueDate);
      const hasScheduled = tasks.some((t) => t.scheduledTime);

      let output = `## Project Analysis: ${project.name}\n\n`;

      output += `### Current State\n`;
      output += `- Active tasks: ${activeTasks.length}\n`;
      output += `- Completed tasks: ${completedTasks.length}\n`;
      output += `- Has subtasks: ${hasSubtasks ? "Yes" : "No"}\n`;
      output += `- Uses priorities: ${hasPriorities ? "Yes" : "No"}\n`;
      output += `- Has due dates: ${hasDueDates ? "Yes" : "No"}\n`;
      output += `- Has scheduled times: ${hasScheduled ? "Yes" : "No"}\n\n`;

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
        activeTasks.forEach((t) => {
          output += `- ${t.name}${t.priority !== "none" ? ` [${t.priority}]` : ""}\n`;
        });
        output += `\n`;
      }

      output += `---\n`;
      output += `**Next Steps:** Would you like me to create specific tasks for any of these phases? `;
      output += `I can also suggest dependencies between tasks to ensure proper execution order.\n`;

      return { content: [{ type: "text", text: output }] };
    }

    case "add_task_dependency": {
      if (!args?.taskId || !args?.blockedByTaskId) {
        return { content: [{ type: "text", text: "Error: taskId and blockedByTaskId are required" }] };
      }

      if (args.taskId === args.blockedByTaskId) {
        return { content: [{ type: "text", text: "Error: A task cannot block itself" }] };
      }

      const taskResult = findTask(data, args.taskId);
      const blockerResult = findTask(data, args.blockedByTaskId);

      if (!taskResult) {
        return { content: [{ type: "text", text: `Error: Task ${args.taskId} not found` }] };
      }
      if (!blockerResult) {
        return { content: [{ type: "text", text: `Error: Blocker task ${args.blockedByTaskId} not found` }] };
      }

      const task = taskResult.task;
      const blocker = blockerResult.task;

      // Initialize arrays if needed
      if (!Array.isArray(task.blockedBy)) task.blockedBy = [];
      if (!Array.isArray(blocker.blocks)) blocker.blocks = [];

      // Check for circular dependency
      const visited = new Set();
      const stack = [args.blockedByTaskId];
      while (stack.length > 0) {
        const currentId = stack.pop();
        if (currentId === args.taskId) {
          return { content: [{ type: "text", text: "Error: This would create a circular dependency" }] };
        }
        if (visited.has(currentId)) continue;
        visited.add(currentId);

        const current = findTask(data, currentId);
        if (current && Array.isArray(current.task.blockedBy)) {
          stack.push(...current.task.blockedBy);
        }
      }

      // Check if already exists
      if (task.blockedBy.includes(args.blockedByTaskId)) {
        return { content: [{ type: "text", text: `Dependency already exists: "${blocker.name}" blocks "${task.name}"` }] };
      }

      // Add the dependency
      task.blockedBy.push(args.blockedByTaskId);
      blocker.blocks.push(args.taskId);
      saveData(data);

      return {
        content: [{
          type: "text",
          text: `Dependency created!\n\n"${task.name}" is now blocked by "${blocker.name}"\n\nThe blocked task cannot start until the blocker is completed.`,
        }],
      };
    }

    case "remove_task_dependency": {
      if (!args?.taskId || !args?.blockedByTaskId) {
        return { content: [{ type: "text", text: "Error: taskId and blockedByTaskId are required" }] };
      }

      const taskResult = findTask(data, args.taskId);
      const blockerResult = findTask(data, args.blockedByTaskId);

      if (!taskResult) {
        return { content: [{ type: "text", text: `Error: Task ${args.taskId} not found` }] };
      }

      const task = taskResult.task;

      // Remove from blockedBy
      if (Array.isArray(task.blockedBy)) {
        task.blockedBy = task.blockedBy.filter((id) => id !== args.blockedByTaskId);
      }

      // Remove from blocks
      if (blockerResult && Array.isArray(blockerResult.task.blocks)) {
        blockerResult.task.blocks = blockerResult.task.blocks.filter((id) => id !== args.taskId);
      }

      saveData(data);

      return {
        content: [{
          type: "text",
          text: `Dependency removed! "${task.name}" is no longer blocked by "${blockerResult?.task.name || args.blockedByTaskId}"`,
        }],
      };
    }

    case "get_dependency_graph": {
      const tasks = getAllTasks(data);
      let projectTasks = tasks;

      if (args?.projectId) {
        projectTasks = tasks.filter((t) => t.projectId === args.projectId);
      }

      // Find tasks with dependencies
      const withDeps = projectTasks.filter((t) =>
        (t.blockedBy && t.blockedBy.length > 0) || (t.blocks && t.blocks.length > 0)
      );

      if (withDeps.length === 0) {
        return { content: [{ type: "text", text: "No task dependencies found." }] };
      }

      let output = "## Task Dependency Graph\n\n";

      // Build adjacency visualization
      const taskMap = new Map(tasks.map((t) => [t.id, t]));

      // Group by status
      const blocked = withDeps.filter((t) =>
        t.blockedBy && t.blockedBy.some((id) => {
          const blocker = taskMap.get(id);
          return blocker && blocker.status !== "done";
        })
      );

      const blocking = withDeps.filter((t) =>
        t.blocks && t.blocks.length > 0 && t.status !== "done"
      );

      const ready = withDeps.filter((t) =>
        (!t.blockedBy || t.blockedBy.length === 0 ||
          t.blockedBy.every((id) => {
            const blocker = taskMap.get(id);
            return !blocker || blocker.status === "done";
          })) &&
        t.status !== "done"
      );

      output += `### Status Summary\n`;
      output += `- Ready to start: ${ready.length}\n`;
      output += `- Currently blocked: ${blocked.length}\n`;
      output += `- Blocking others: ${blocking.length}\n\n`;

      output += `### Dependency Chains\n\n`;

      for (const task of withDeps) {
        if (task.status === "done") continue;

        const statusEmoji = blocked.includes(task) ? "🔒" : blocking.includes(task) ? "⛓" : "✅";
        output += `${statusEmoji} **${task.name}**`;
        if (task.projectName) output += ` [${task.projectName}]`;
        output += `\n`;

        if (task.blockedBy && task.blockedBy.length > 0) {
          output += `   Blocked by:\n`;
          task.blockedBy.forEach((id) => {
            const blocker = taskMap.get(id);
            if (blocker) {
              const blockerStatus = blocker.status === "done" ? "✓" : "○";
              output += `   ${blockerStatus} ${blocker.name}\n`;
            }
          });
        }

        if (task.blocks && task.blocks.length > 0) {
          output += `   Blocks:\n`;
          task.blocks.forEach((id) => {
            const blocked = taskMap.get(id);
            if (blocked) {
              output += `   → ${blocked.name}\n`;
            }
          });
        }

        output += `\n`;
      }

      return { content: [{ type: "text", text: output }] };
    }

    case "suggest_task_order": {
      const tasks = getAllTasks(data);
      let projectTasks = tasks;

      if (args?.projectId) {
        projectTasks = tasks.filter((t) => t.projectId === args.projectId);
      }

      // Filter to active tasks unless includeCompleted
      if (!args?.includeCompleted) {
        projectTasks = projectTasks.filter((t) => t.status !== "done");
      }

      if (projectTasks.length === 0) {
        return { content: [{ type: "text", text: "No tasks found to order." }] };
      }

      const taskMap = new Map(projectTasks.map((t) => [t.id, t]));

      // Topological sort based on dependencies
      const visited = new Set();
      const sorted = [];

      function visit(taskId) {
        if (visited.has(taskId)) return;
        visited.add(taskId);

        const task = taskMap.get(taskId);
        if (!task) return;

        // Visit blockers first
        if (task.blockedBy) {
          for (const blockerId of task.blockedBy) {
            if (taskMap.has(blockerId)) {
              visit(blockerId);
            }
          }
        }

        sorted.push(task);
      }

      // Start with tasks that aren't blocked
      const unblocked = projectTasks.filter((t) =>
        !t.blockedBy || t.blockedBy.length === 0 ||
        t.blockedBy.every((id) => !taskMap.has(id))
      );

      unblocked.forEach((t) => visit(t.id));

      // Visit remaining
      projectTasks.forEach((t) => {
        if (!visited.has(t.id)) visit(t.id);
      });

      // Now sort by priority and due date within unblocked groups
      const priorityOrder = { urgent: 0, high: 1, medium: 2, low: 3, none: 4 };

      sorted.sort((a, b) => {
        // First by dependency order (already handled by topological sort)
        const aIdx = sorted.indexOf(a);
        const bIdx = sorted.indexOf(b);

        // Check if one blocks the other
        if (a.blockedBy?.includes(b.id)) return 1;
        if (b.blockedBy?.includes(a.id)) return -1;

        // Then by priority
        const aPri = priorityOrder[a.priority] ?? 4;
        const bPri = priorityOrder[b.priority] ?? 4;
        if (aPri !== bPri) return aPri - bPri;

        // Then by due date
        if (a.dueDate && b.dueDate) return a.dueDate.localeCompare(b.dueDate);
        if (a.dueDate) return -1;
        if (b.dueDate) return 1;

        return 0;
      });

      let output = "## Suggested Task Order\n\n";
      output += "Based on dependencies, priorities, and due dates:\n\n";

      sorted.forEach((task, idx) => {
        const isBlocked = task.blockedBy?.some((id) => {
          const blocker = taskMap.get(id);
          return blocker && blocker.status !== "done";
        });

        const statusIcon = isBlocked ? "🔒" : task.status === "done" ? "✓" : `${idx + 1}.`;

        output += `${statusIcon} **${task.name}**`;
        if (task.priority && task.priority !== "none") output += ` [${task.priority}]`;
        if (task.dueDate) output += ` (due: ${task.dueDate})`;
        if (task.projectName) output += ` [${task.projectName}]`;
        if (isBlocked) output += " ← Blocked";
        output += `\n`;
      });

      output += `\n---\n`;
      output += `**Total:** ${sorted.length} tasks\n`;
      output += `**Ready now:** ${sorted.filter((t) =>
        !t.blockedBy?.some((id) => {
          const blocker = taskMap.get(id);
          return blocker && blocker.status !== "done";
        })
      ).length}\n`;

      return { content: [{ type: "text", text: output }] };
    }

    // ============================================
    // PLANNING & SCHEDULING TOOLS
    // ============================================

    case "get_planning_context": {
      const targetDate = args?.date || new Date().toISOString().split("T")[0];
      const tasks = getAllTasks(data);
      const yesterday = new Date(targetDate);
      yesterday.setDate(yesterday.getDate() - 1);
      const yesterdayStr = yesterday.toISOString().split("T")[0];

      // Overdue tasks
      const overdue = tasks.filter(t =>
        t.status !== "done" && t.dueDate && t.dueDate < targetDate
      ).sort((a, b) => a.dueDate.localeCompare(b.dueDate));

      // Unscheduled high-priority
      const unscheduledHighPriority = tasks.filter(t =>
        t.status !== "done" &&
        !t.scheduledTime &&
        (t.priority === "urgent" || t.priority === "high")
      );

      // Yesterday's incomplete (were scheduled but not done)
      const yesterdayIncomplete = tasks.filter(t =>
        t.status !== "done" &&
        t.scheduledDate === yesterdayStr
      );

      // Already scheduled for target date
      const alreadyScheduled = tasks.filter(t =>
        t.scheduledDate === targetDate && t.scheduledTime && t.status !== "done"
      ).sort((a, b) => a.scheduledTime.localeCompare(b.scheduledTime));

      // Calculate available time (9-18 = 9 hours = 540 min)
      let scheduledMinutes = alreadyScheduled.reduce((sum, t) => sum + (t.estimatedMinutes || 30), 0);
      const availableMinutes = 540 - scheduledMinutes;

      let output = `## Planning Context for ${targetDate}\n\n`;

      if (overdue.length > 0) {
        output += `### ⚠️ Overdue Tasks (${overdue.length})\n`;
        overdue.forEach(t => {
          output += `- **${t.name}** (due: ${t.dueDate}) [ID: ${t.id}]\n`;
        });
        output += `\n`;
      }

      if (yesterdayIncomplete.length > 0) {
        output += `### 📅 Incomplete from Yesterday (${yesterdayIncomplete.length})\n`;
        yesterdayIncomplete.forEach(t => {
          output += `- **${t.name}** [ID: ${t.id}]\n`;
        });
        output += `\n`;
      }

      if (unscheduledHighPriority.length > 0) {
        output += `### 🔥 High Priority - Unscheduled (${unscheduledHighPriority.length})\n`;
        unscheduledHighPriority.forEach(t => {
          output += `- **${t.name}** [${t.priority}] [ID: ${t.id}]\n`;
        });
        output += `\n`;
      }

      if (alreadyScheduled.length > 0) {
        output += `### ⏰ Already Scheduled (${alreadyScheduled.length})\n`;
        alreadyScheduled.forEach(t => {
          output += `- ${t.scheduledTime}: **${t.name}** (${t.estimatedMinutes || 30}m)\n`;
        });
        output += `\n`;
      }

      output += `### Time Budget\n`;
      output += `- Scheduled: ${Math.floor(scheduledMinutes / 60)}h ${scheduledMinutes % 60}m\n`;
      output += `- Available: ${Math.floor(availableMinutes / 60)}h ${availableMinutes % 60}m\n`;

      return { content: [{ type: "text", text: output }] };
    }

    case "suggest_day_schedule": {
      const targetDate = args?.date || new Date().toISOString().split("T")[0];
      const startHour = args?.startHour ?? 9;
      const endHour = args?.endHour ?? 18;
      const tasks = getAllTasks(data);

      // Get tasks to schedule
      let toSchedule;
      if (args?.taskIds && args.taskIds.length > 0) {
        toSchedule = args.taskIds.map(id => findTask(data, id)?.task).filter(Boolean);
      } else {
        // Get top priority unscheduled tasks
        toSchedule = tasks
          .filter(t => t.status !== "done" && !t.scheduledTime)
          .sort((a, b) => {
            const priorityOrder = { urgent: 0, high: 1, medium: 2, low: 3, none: 4 };
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
      const schedule = [];
      let currentMinutes = startHour * 60;
      const endMinutes = endHour * 60;

      for (const task of toSchedule) {
        const duration = task.estimatedMinutes || 30;
        if (currentMinutes + duration > endMinutes) break;

        const hour = Math.floor(currentMinutes / 60);
        const minute = currentMinutes % 60;
        const time = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;

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
        output += "No tasks to schedule.\n";
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
        output += "```json\n" + JSON.stringify({
          schedule: schedule.map(s => ({
            taskId: s.taskId,
            scheduledTime: s.scheduledTime,
            estimatedMinutes: s.estimatedMinutes
          }))
        }, null, 2) + "\n```";
      }

      return { content: [{ type: "text", text: output }] };
    }

    case "bulk_update_tasks": {
      if (!args?.taskIds || !Array.isArray(args.taskIds) || !args?.updates) {
        return { content: [{ type: "text", text: "Error: taskIds array and updates object are required" }] };
      }

      const results = [];
      const errors = [];

      for (const taskId of args.taskIds) {
        const result = findTask(data, taskId);
        if (!result) {
          errors.push(`Task ${taskId} not found`);
          continue;
        }

        const { task } = result;
        const updates = args.updates;

        if (updates.status) task.status = updates.status;
        if (updates.priority) task.priority = updates.priority;
        if (updates.dueDate !== undefined) task.dueDate = updates.dueDate;
        if (updates.scheduledDate !== undefined) task.scheduledDate = updates.scheduledDate;
        if (updates.executionType) task.executionType = updates.executionType;

        if (updates.status === "done" && !task.completedAt) {
          task.completedAt = new Date().toISOString();
        }

        results.push(task.name);
      }

      saveData(data);

      let output = `## Bulk Update Results\n\n`;
      output += `**Updated ${results.length} tasks:**\n`;
      results.forEach(name => output += `- ${name}\n`);

      if (errors.length > 0) {
        output += `\n**Errors (${errors.length}):**\n`;
        errors.forEach(e => output += `- ${e}\n`);
      }

      return { content: [{ type: "text", text: output }] };
    }

    // ============================================
    // BLOCKER MANAGEMENT TOOLS
    // ============================================

    case "set_blocker": {
      if (!args?.taskId || !args?.type || !args?.description) {
        return { content: [{ type: "text", text: "Error: taskId, type, and description are required" }] };
      }

      const result = findTask(data, args.taskId);
      if (!result) {
        return { content: [{ type: "text", text: `Error: Task ${args.taskId} not found` }] };
      }

      const { task } = result;
      task.status = "waiting";
      task.blockerInfo = {
        type: args.type,
        description: args.description,
        blockedSince: new Date().toISOString(),
        expectedResolution: args.expectedResolution || null,
        followUpDate: args.followUpDate || null,
        contactInfo: args.contactInfo || null,
        notes: []
      };

      saveData(data);

      let output = `## Blocker Set\n\n`;
      output += `**Task:** ${task.name}\n`;
      output += `**Type:** ${args.type}\n`;
      output += `**Reason:** ${args.description}\n`;
      if (args.expectedResolution) output += `**Expected Resolution:** ${args.expectedResolution}\n`;
      if (args.followUpDate) output += `**Follow-up Date:** ${args.followUpDate}\n`;
      if (args.contactInfo) output += `**Contact:** ${args.contactInfo}\n`;

      return { content: [{ type: "text", text: output }] };
    }

    case "log_follow_up": {
      if (!args?.taskId || !args?.note) {
        return { content: [{ type: "text", text: "Error: taskId and note are required" }] };
      }

      const result = findTask(data, args.taskId);
      if (!result) {
        return { content: [{ type: "text", text: `Error: Task ${args.taskId} not found` }] };
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
        note: args.note
      });

      if (args.newFollowUpDate) {
        task.blockerInfo.followUpDate = args.newFollowUpDate;
      }

      saveData(data);

      return {
        content: [{ type: "text", text: `Follow-up logged for "${task.name}": ${args.note}` }]
      };
    }

    case "get_blockers_summary": {
      const tasks = getAllTasks(data);
      const blocked = tasks.filter(t =>
        t.status === "waiting" || t.blockerInfo?.type
      );

      if (blocked.length === 0) {
        return { content: [{ type: "text", text: "No blocked tasks! All clear." }] };
      }

      const now = new Date();
      const getAgeDays = (task) => {
        const since = task.blockerInfo?.blockedSince || task.createdAt;
        if (!since) return 0;
        return Math.floor((now - new Date(since)) / (1000 * 60 * 60 * 24));
      };

      // Group by type
      const byType = {};
      blocked.forEach(t => {
        const type = t.blockerInfo?.type || "unspecified";
        if (!byType[type]) byType[type] = [];
        byType[type].push(t);
      });

      let output = `## Blockers Summary\n\n`;
      output += `**Total Blocked:** ${blocked.length}\n`;
      output += `**Critical (>14d):** ${blocked.filter(t => getAgeDays(t) > 14).length}\n`;
      output += `**Warning (7-14d):** ${blocked.filter(t => getAgeDays(t) > 7 && getAgeDays(t) <= 14).length}\n\n`;

      for (const [type, tasks] of Object.entries(byType)) {
        output += `### ${type.charAt(0).toUpperCase() + type.slice(1)} (${tasks.length})\n\n`;
        tasks.forEach(t => {
          const age = getAgeDays(t);
          const ageLabel = age > 14 ? "🔴 CRITICAL" : age > 7 ? "🟡 Warning" : "🟢 Recent";
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

      return { content: [{ type: "text", text: output }] };
    }

    case "clear_blocker": {
      if (!args?.taskId) {
        return { content: [{ type: "text", text: "Error: taskId is required" }] };
      }

      const result = findTask(data, args.taskId);
      if (!result) {
        return { content: [{ type: "text", text: `Error: Task ${args.taskId} not found` }] };
      }

      const { task } = result;
      task.status = "ready";

      if (task.blockerInfo) {
        task.blockerInfo.resolvedAt = new Date().toISOString();
        if (args.resolution) {
          task.blockerInfo.notes = task.blockerInfo.notes || [];
          task.blockerInfo.notes.push({
            date: new Date().toISOString(),
            note: `RESOLVED: ${args.resolution}`
          });
        }
      }

      saveData(data);

      return {
        content: [{ type: "text", text: `Blocker cleared for "${task.name}". Task is now ready.` }]
      };
    }

    // ============================================
    // ANALYTICS TOOLS
    // ============================================

    case "get_productivity_stats": {
      const today = new Date();
      const startDate = args?.startDate || new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
      const endDate = args?.endDate || today.toISOString().split("T")[0];

      const tasks = getAllTasks(data);
      const completed = tasks.filter(t => {
        if (t.status !== "done" || !t.completedAt) return false;
        const completedDate = t.completedAt.split("T")[0];
        return completedDate >= startDate && completedDate <= endDate;
      });

      // Daily breakdown
      const dailyStats = {};
      completed.forEach(t => {
        const date = t.completedAt.split("T")[0];
        if (!dailyStats[date]) {
          dailyStats[date] = { count: 0, minutes: 0 };
        }
        dailyStats[date].count++;
        dailyStats[date].minutes += t.estimatedMinutes || 30;
      });

      // Project breakdown
      const projectStats = {};
      completed.forEach(t => {
        const project = data.projects.find(p => p.tasks.some(pt => pt.id === t.id));
        const name = project?.name || "Inbox";
        if (!projectStats[name]) {
          projectStats[name] = { count: 0, minutes: 0 };
        }
        projectStats[name].count++;
        projectStats[name].minutes += t.estimatedMinutes || 30;
      });

      const totalMinutes = completed.reduce((sum, t) => sum + (t.estimatedMinutes || 30), 0);

      let output = `## Productivity Stats: ${startDate} to ${endDate}\n\n`;
      output += `### Overview\n`;
      output += `- **Tasks Completed:** ${completed.length}\n`;
      output += `- **Total Time:** ${Math.floor(totalMinutes / 60)}h ${totalMinutes % 60}m\n`;
      output += `- **Daily Average:** ${(completed.length / Object.keys(dailyStats).length || 0).toFixed(1)} tasks\n\n`;

      output += `### Daily Breakdown\n`;
      Object.keys(dailyStats).sort().forEach(date => {
        const stats = dailyStats[date];
        output += `- ${date}: ${stats.count} tasks (${Math.floor(stats.minutes / 60)}h ${stats.minutes % 60}m)\n`;
      });

      output += `\n### By Project\n`;
      Object.entries(projectStats)
        .sort((a, b) => b[1].count - a[1].count)
        .forEach(([name, stats]) => {
          output += `- ${name}: ${stats.count} tasks (${Math.floor(stats.minutes / 60)}h ${stats.minutes % 60}m)\n`;
        });

      return { content: [{ type: "text", text: output }] };
    }

    case "get_productivity_insights": {
      const period = args?.period || "week";
      const periodDays = period === "week" ? 7 : period === "month" ? 30 : 90;

      const today = new Date();
      const startDate = new Date(today.getTime() - periodDays * 24 * 60 * 60 * 1000);

      const tasks = getAllTasks(data);
      const completed = tasks.filter(t => {
        if (t.status !== "done" || !t.completedAt) return false;
        return new Date(t.completedAt) >= startDate;
      });

      // Analyze patterns
      const byDayOfWeek = [0, 0, 0, 0, 0, 0, 0]; // Sun-Sat
      const byHour = Array(24).fill(0);

      completed.forEach(t => {
        const date = new Date(t.completedAt);
        byDayOfWeek[date.getDay()]++;
        byHour[date.getHours()]++;
      });

      const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
      const mostProductiveDay = dayNames[byDayOfWeek.indexOf(Math.max(...byDayOfWeek))];
      const leastProductiveDay = dayNames[byDayOfWeek.indexOf(Math.min(...byDayOfWeek))];

      const peakHour = byHour.indexOf(Math.max(...byHour));

      // Priority distribution
      const byPriority = { urgent: 0, high: 0, medium: 0, low: 0, none: 0 };
      completed.forEach(t => {
        byPriority[t.priority || "none"]++;
      });

      let output = `## Productivity Insights (${period})\n\n`;
      output += `### Patterns\n`;
      output += `- **Most Productive Day:** ${mostProductiveDay} (${Math.max(...byDayOfWeek)} tasks)\n`;
      output += `- **Least Productive Day:** ${leastProductiveDay} (${Math.min(...byDayOfWeek)} tasks)\n`;
      output += `- **Peak Hour:** ${peakHour}:00 (${byHour[peakHour]} tasks completed)\n\n`;

      output += `### Priority Distribution\n`;
      output += `- Urgent: ${byPriority.urgent} (${Math.round(byPriority.urgent / completed.length * 100 || 0)}%)\n`;
      output += `- High: ${byPriority.high} (${Math.round(byPriority.high / completed.length * 100 || 0)}%)\n`;
      output += `- Medium: ${byPriority.medium} (${Math.round(byPriority.medium / completed.length * 100 || 0)}%)\n`;
      output += `- Low: ${byPriority.low} (${Math.round(byPriority.low / completed.length * 100 || 0)}%)\n`;

      output += `\n### Raw Data for Analysis\n`;
      output += "```json\n" + JSON.stringify({
        period,
        totalCompleted: completed.length,
        byDayOfWeek: dayNames.map((d, i) => ({ day: d, count: byDayOfWeek[i] })),
        peakHour,
        byPriority
      }, null, 2) + "\n```";

      return { content: [{ type: "text", text: output }] };
    }

    case "get_work_context": {
      const days = args?.days || 14;
      const today = new Date();
      const cutoff = new Date(today.getTime() - days * 24 * 60 * 60 * 1000);
      const todayStr = today.toISOString().split("T")[0];

      const tasks = getAllTasks(data);

      // Recent completions with energy ratings
      const completed = tasks
        .filter(t => t.status === "done" && t.completedAt && new Date(t.completedAt) >= cutoff)
        .sort((a, b) => new Date(b.completedAt) - new Date(a.completedAt));

      // Frequently snoozed tasks
      const snoozed = tasks
        .filter(t => t.status !== "done" && (t.snoozeCount || 0) > 0)
        .sort((a, b) => (b.snoozeCount || 0) - (a.snoozeCount || 0));

      // Tasks waiting with blocker reasons
      const waiting = tasks.filter(t => t.status === "waiting");

      // Blocker pattern analysis
      const blockerCounts = {};
      waiting.forEach(t => {
        const reason = t.waitingReason || "unspecified";
        blockerCounts[reason] = (blockerCounts[reason] || 0) + 1;
      });

      // Energy pattern analysis
      const energyTasks = completed.filter(t => t.energyRating);
      const energyByRating = { 1: [], 2: [], 3: [] };
      energyTasks.forEach(t => {
        if (energyByRating[t.energyRating]) {
          energyByRating[t.energyRating].push(t.name);
        }
      });
      const avgEnergy = energyTasks.length > 0
        ? (energyTasks.reduce((sum, t) => sum + t.energyRating, 0) / energyTasks.length).toFixed(1)
        : "N/A";

      // Project velocity
      const projectVelocity = {};
      data.projects.forEach(p => {
        const done = p.tasks.filter(t => t.status === "done" && t.completedAt && new Date(t.completedAt) >= cutoff).length;
        const active = p.tasks.filter(t => t.status !== "done").length;
        if (done > 0 || active > 0) {
          projectVelocity[p.name] = { completed: done, active, total: p.tasks.length };
        }
      });

      // Recap entries (daily notes, accomplishments)
      const recentRecaps = (data.recapLog || [])
        .filter(r => new Date(r.createdAt) >= cutoff)
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
        .slice(0, 30);

      // Daily notes
      const dailyNotes = data.dailyNotes || {};

      // Task age analysis (oldest active tasks)
      const oldestActive = tasks
        .filter(t => t.status !== "done" && t.createdAt)
        .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))
        .slice(0, 10);

      // Build output
      let output = `# Work Context (Last ${days} Days)\n\n`;

      output += `## Summary\n`;
      output += `- **Tasks completed:** ${completed.length}\n`;
      output += `- **Currently active:** ${tasks.filter(t => t.status !== "done").length}\n`;
      output += `- **Waiting/blocked:** ${waiting.length}\n`;
      output += `- **Average energy rating:** ${avgEnergy} (1=drained, 3=energized)\n`;
      output += `- **Tasks snoozed at least once:** ${snoozed.length}\n\n`;

      if (completed.length > 0) {
        output += `## Recent Completions\n`;
        completed.slice(0, 15).forEach(t => {
          const energy = t.energyRating ? [" ", "😩", "😐", "💪"][t.energyRating] : "";
          const summary = t.completionSummary ? ` — ${t.completionSummary.slice(0, 100)}` : "";
          output += `- ${t.name}${energy}${summary} (${t.completedAt.split("T")[0]})\n`;
        });
        output += "\n";
      }

      if (energyTasks.length > 0) {
        output += `## Energy Patterns\n`;
        if (energyByRating[3].length > 0) output += `- **Energizing tasks:** ${energyByRating[3].join(", ")}\n`;
        if (energyByRating[1].length > 0) output += `- **Draining tasks:** ${energyByRating[1].join(", ")}\n`;
        if (energyByRating[2].length > 0) output += `- **Neutral tasks:** ${energyByRating[2].join(", ")}\n`;
        output += "\n";
      }

      if (snoozed.length > 0) {
        output += `## Frequently Deferred Tasks\n`;
        snoozed.slice(0, 10).forEach(t => {
          output += `- **${t.name}** — snoozed ${t.snoozeCount}x (priority: ${t.priority || "none"})\n`;
        });
        output += "\n";
      }

      if (waiting.length > 0) {
        output += `## Blocker Analysis\n`;
        output += `Blocker reasons: ${JSON.stringify(blockerCounts)}\n`;
        waiting.forEach(t => {
          output += `- **${t.name}** — ${t.waitingReason || "no reason given"}\n`;
        });
        output += "\n";
      }

      if (Object.keys(projectVelocity).length > 0) {
        output += `## Project Velocity (${days}d)\n`;
        for (const [name, v] of Object.entries(projectVelocity)) {
          output += `- **${name}:** ${v.completed} completed, ${v.active} active\n`;
        }
        output += "\n";
      }

      if (oldestActive.length > 0) {
        output += `## Oldest Active Tasks\n`;
        oldestActive.forEach(t => {
          const age = Math.floor((today - new Date(t.createdAt)) / (24 * 60 * 60 * 1000));
          output += `- **${t.name}** — ${age} days old (priority: ${t.priority || "none"}, snoozed: ${t.snoozeCount || 0}x)\n`;
        });
        output += "\n";
      }

      if (recentRecaps.length > 0) {
        output += `## Recent Notes & Recap Entries\n`;
        recentRecaps.forEach(r => {
          output += `- [${r.date}] ${r.type}: ${r.content.slice(0, 150)}\n`;
        });
        output += "\n";
      }

      return { content: [{ type: "text", text: output }] };
    }

    case "get_project_analytics": {
      const today = new Date();
      const startDate = args?.startDate || new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
      const endDate = args?.endDate || today.toISOString().split("T")[0];

      const projectAnalytics = data.projects.map(project => {
        const completed = project.tasks.filter(t => {
          if (t.status !== "done" || !t.completedAt) return false;
          const date = t.completedAt.split("T")[0];
          return date >= startDate && date <= endDate;
        });

        const active = project.tasks.filter(t => t.status !== "done");
        const blocked = project.tasks.filter(t => t.status === "waiting");
        const totalMinutes = completed.reduce((sum, t) => sum + (t.estimatedMinutes || 30), 0);

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
            : 0
        };
      });

      let output = `## Project Analytics: ${startDate} to ${endDate}\n\n`;

      projectAnalytics
        .filter(p => !p.isInbox)
        .sort((a, b) => b.completed - a.completed)
        .forEach(p => {
          output += `### ${p.name}\n`;
          output += `- Completed: ${p.completed} tasks\n`;
          output += `- Active: ${p.active} tasks\n`;
          output += `- Blocked: ${p.blocked} tasks\n`;
          output += `- Time: ${Math.floor(p.totalMinutes / 60)}h ${p.totalMinutes % 60}m\n`;
          output += `- Completion Rate: ${p.completionRate}%\n\n`;
        });

      return { content: [{ type: "text", text: output }] };
    }

    // ============================================
    // SUB-PROJECT TOOLS
    // ============================================

    case "create_subproject": {
      if (!args?.parentProjectId || !args?.name) {
        return { content: [{ type: "text", text: "Error: parentProjectId and name are required" }] };
      }

      const parent = data.projects.find(p => p.id === args.parentProjectId);
      if (!parent) {
        return { content: [{ type: "text", text: `Error: Parent project ${args.parentProjectId} not found` }] };
      }

      const subproject = {
        id: generateId(),
        name: args.name,
        description: args.description || "",
        color: args.color || parent.color,
        parentProjectId: args.parentProjectId,
        level: (parent.level || 0) + 1,
        tasks: [],
        createdAt: new Date().toISOString()
      };

      data.projects.push(subproject);
      saveData(data);

      return {
        content: [{ type: "text", text: `Created sub-project "${args.name}" under "${parent.name}"\nID: ${subproject.id}` }]
      };
    }

    case "get_project_tree": {
      const projects = data.projects.filter(p => !p.isInbox);

      // Build tree structure
      const tree = [];
      const byId = {};

      projects.forEach(p => {
        byId[p.id] = {
          ...p,
          children: [],
          progress: {
            total: p.tasks.length,
            completed: p.tasks.filter(t => t.status === "done").length,
            active: p.tasks.filter(t => t.status !== "done").length
          }
        };
      });

      projects.forEach(p => {
        if (p.parentProjectId && byId[p.parentProjectId]) {
          byId[p.parentProjectId].children.push(byId[p.id]);
        } else if (!p.parentProjectId) {
          tree.push(byId[p.id]);
        }
      });

      function renderTree(nodes, indent = 0) {
        let output = "";
        nodes.forEach(node => {
          const prefix = "  ".repeat(indent);
          const percent = node.progress.total > 0
            ? Math.round(node.progress.completed / node.progress.total * 100)
            : 0;
          output += `${prefix}📁 **${node.name}** (${node.progress.completed}/${node.progress.total} - ${percent}%)\n`;
          if (node.children.length > 0) {
            output += renderTree(node.children, indent + 1);
          }
        });
        return output;
      }

      let output = `## Project Hierarchy\n\n`;
      output += renderTree(tree);

      return { content: [{ type: "text", text: output }] };
    }

    // ============================================
    // ENHANCED SUBTASK TOOLS
    // ============================================

    case "create_subtasks_enhanced": {
      if (!args?.taskId || !args?.subtasks || !Array.isArray(args.subtasks)) {
        return { content: [{ type: "text", text: "Error: taskId and subtasks array are required" }] };
      }

      const result = findTask(data, args.taskId);
      if (!result) {
        return { content: [{ type: "text", text: `Error: Task ${args.taskId} not found` }] };
      }

      const { task } = result;
      if (!task.subtasks) task.subtasks = [];

      const created = [];
      for (const st of args.subtasks) {
        if (!st.name) continue;

        const subtask = {
          id: generateId(),
          name: st.name,
          status: "todo",
          estimatedMinutes: st.estimatedMinutes || null,
          scheduledTime: st.scheduledTime || null,
          scheduledDate: st.scheduledDate || null,
          createdAt: new Date().toISOString()
        };

        task.subtasks.push(subtask);
        created.push({
          name: st.name,
          duration: st.estimatedMinutes,
          scheduled: st.scheduledTime ? `${st.scheduledTime} on ${st.scheduledDate || "today"}` : null
        });
      }

      saveData(data);

      let output = `## Created ${created.length} Subtasks for "${task.name}"\n\n`;
      created.forEach(st => {
        output += `- ${st.name}`;
        if (st.duration) output += ` (${st.duration}m)`;
        if (st.scheduled) output += ` @ ${st.scheduled}`;
        output += `\n`;
      });

      return { content: [{ type: "text", text: output }] };
    }

    case "schedule_subtask": {
      if (!args?.taskId || !args?.subtaskId || !args?.scheduledTime) {
        return { content: [{ type: "text", text: "Error: taskId, subtaskId, and scheduledTime are required" }] };
      }

      const result = findTask(data, args.taskId);
      if (!result) {
        return { content: [{ type: "text", text: `Error: Task ${args.taskId} not found` }] };
      }

      const { task } = result;
      const subtask = task.subtasks?.find(st => st.id === args.subtaskId);
      if (!subtask) {
        return { content: [{ type: "text", text: `Error: Subtask ${args.subtaskId} not found` }] };
      }

      subtask.scheduledTime = args.scheduledTime;
      subtask.scheduledDate = args.scheduledDate || new Date().toISOString().split("T")[0];
      if (args.estimatedMinutes) {
        subtask.estimatedMinutes = args.estimatedMinutes;
      }

      saveData(data);

      return {
        content: [{ type: "text", text: `Scheduled subtask "${subtask.name}" at ${subtask.scheduledTime} on ${subtask.scheduledDate}` }]
      };
    }

    case "assign_task": {
      if (!args?.taskId || !args?.assignTo) {
        return { content: [{ type: "text", text: "Error: taskId and assignTo are required" }] };
      }

      const result = findTask(data, args.taskId);
      if (!result) {
        return { content: [{ type: "text", text: `Error: Task ${args.taskId} not found` }] };
      }

      const { task, parentTask } = result;
      const assignValue = args.assignTo === "none" ? null : args.assignTo;
      task.assignedTo = assignValue;

      saveData(data);

      const taskType = parentTask ? "Subtask" : "Task";
      const assignedLabel = assignValue ? `to ${assignValue}` : "(unassigned)";
      return {
        content: [{ type: "text", text: `${taskType} "${task.name}" assigned ${assignedLabel}` }]
      };
    }

    case "get_claude_tasks": {
      const todayOnly = args?.todayOnly || false;
      const today = new Date().toISOString().split("T")[0];
      const claudeTasks = [];

      for (const project of data.projects) {
        for (const task of project.tasks) {
          // Check if main task is assigned to Claude
          if (task.assignedTo === "claude" && task.status !== "done") {
            // Apply todayOnly filter
            if (todayOnly && task.scheduledDate !== today && task.dueDate !== today) {
              continue;
            }

            // Get subtasks assigned to Claude for this task
            const claudeSubtasks = (task.subtasks || [])
              .filter(st => st.assignedTo === "claude" && st.status !== "done")
              .map(st => st.name);

            claudeTasks.push({
              type: "task",
              id: task.id,
              name: task.name,
              description: task.description || "",
              context: task.context || "",
              priority: task.priority,
              dueDate: task.dueDate,
              scheduledDate: task.scheduledDate,
              scheduledTime: task.scheduledTime,
              estimatedMinutes: task.estimatedMinutes,
              projectName: project.name,
              subtasks: task.subtasks ? task.subtasks.map(st => ({
                name: st.name,
                status: st.status,
                assignedTo: st.assignedTo
              })) : [],
              claudeSubtasks: claudeSubtasks,
            });
          }

          // Check subtasks assigned to Claude (where parent task is NOT assigned to Claude)
          if (task.subtasks && task.assignedTo !== "claude") {
            for (const subtask of task.subtasks) {
              if (subtask.assignedTo === "claude" && subtask.status !== "done") {
                // Apply todayOnly filter based on parent task
                if (todayOnly && task.scheduledDate !== today && task.dueDate !== today) {
                  continue;
                }

                claudeTasks.push({
                  type: "subtask",
                  id: subtask.id,
                  name: subtask.name,
                  parentTask: {
                    id: task.id,
                    name: task.name,
                    description: task.description || "",
                    context: task.context || "",
                    priority: task.priority,
                    dueDate: task.dueDate,
                    scheduledDate: task.scheduledDate,
                    allSubtasks: task.subtasks.map(st => ({
                      name: st.name,
                      status: st.status,
                      assignedTo: st.assignedTo
                    })),
                  },
                  projectName: project.name,
                });
              }
            }
          }
        }
      }

      if (claudeTasks.length === 0) {
        const filterNote = todayOnly ? " for today" : "";
        return { content: [{ type: "text", text: `No tasks assigned to Claude${filterNote}.` }] };
      }

      const filterNote = todayOnly ? " (Today Only)" : "";
      let output = `## Claude's Tasks${filterNote} (${claudeTasks.length})\n\n`;

      for (const item of claudeTasks) {
        if (item.type === "task") {
          output += `### TASK: ${item.name}\n`;
          output += `**ID:** ${item.id}\n`;
          output += `**Project:** ${item.projectName}\n`;
          if (item.priority && item.priority !== "none") output += `**Priority:** ${item.priority}\n`;
          if (item.dueDate) output += `**Due:** ${item.dueDate}\n`;
          if (item.scheduledDate) output += `**Scheduled:** ${item.scheduledDate}${item.scheduledTime ? ' at ' + item.scheduledTime : ''}\n`;
          if (item.estimatedMinutes) output += `**Estimated:** ${item.estimatedMinutes} minutes\n`;
          output += `\n`;
          if (item.description) output += `**Description:**\n${item.description}\n\n`;
          if (item.context) output += `**Context/Brain Dump:**\n${item.context}\n\n`;
          if (item.subtasks && item.subtasks.length > 0) {
            output += `**Subtasks:**\n`;
            for (const st of item.subtasks) {
              const status = st.status === "done" ? "✓" : "○";
              const assignee = st.assignedTo ? ` [${st.assignedTo}]` : "";
              output += `- ${status} ${st.name}${assignee}\n`;
            }
            output += `\n`;
          }
          output += `---\n\n`;
        } else {
          output += `### SUBTASK: ${item.name}\n`;
          output += `**ID:** ${item.id}\n`;
          output += `**Project:** ${item.projectName}\n`;
          output += `\n**Parent Task:** ${item.parentTask.name}\n`;
          if (item.parentTask.priority && item.parentTask.priority !== "none") output += `**Parent Priority:** ${item.parentTask.priority}\n`;
          if (item.parentTask.dueDate) output += `**Parent Due:** ${item.parentTask.dueDate}\n`;
          output += `\n`;
          if (item.parentTask.description) output += `**Parent Description:**\n${item.parentTask.description}\n\n`;
          if (item.parentTask.context) output += `**Parent Context/Brain Dump:**\n${item.parentTask.context}\n\n`;
          if (item.parentTask.allSubtasks && item.parentTask.allSubtasks.length > 0) {
            output += `**All Subtasks in Parent:**\n`;
            for (const st of item.parentTask.allSubtasks) {
              const status = st.status === "done" ? "✓" : "○";
              const assignee = st.assignedTo ? ` [${st.assignedTo}]` : "";
              const isCurrent = st.name === item.name ? " ← THIS ONE" : "";
              output += `- ${status} ${st.name}${assignee}${isCurrent}\n`;
            }
            output += `\n`;
          }
          output += `---\n\n`;
        }
      }

      return { content: [{ type: "text", text: output }] };
    }

    case "sync_claude_queue": {
      const todayOnly = args?.todayOnly || false;
      const today = new Date().toISOString().split("T")[0];
      const claudeTasks = [];

      // Collect Claude tasks
      for (const project of data.projects) {
        for (const task of project.tasks) {
          if (task.assignedTo === "claude" && task.status !== "done") {
            if (todayOnly && task.scheduledDate !== today && task.dueDate !== today) {
              continue;
            }
            claudeTasks.push({
              type: "task",
              task: task,
              projectName: project.name,
            });
          }

          // Check subtasks
          if (task.subtasks) {
            for (const subtask of task.subtasks) {
              if (subtask.assignedTo === "claude" && subtask.status !== "done") {
                if (todayOnly && task.scheduledDate !== today && task.dueDate !== today) {
                  continue;
                }
                claudeTasks.push({
                  type: "subtask",
                  subtask: subtask,
                  parentTask: task,
                  projectName: project.name,
                });
              }
            }
          }
        }
      }

      if (claudeTasks.length === 0) {
        return { content: [{ type: "text", text: "No Claude tasks to sync. Queue file not updated." }] };
      }

      // Build queue file content
      const dateStr = new Date().toLocaleDateString('en-US', {
        weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
      });

      let queueContent = `# CLAUDE QUEUE — ${dateStr}

**Owner:** Vin DeGregorio
**Prepared by:** TaskFlow PM (Auto-synced)
**Run Order:** Tasks 1 → ${claudeTasks.length}
**Output Location:** \`C:\\Users\\vince\\OneDrive\\Vincenzo\\Claude\\outputs\\\`

---

## OVERNIGHT TASKS

`;

      let taskNum = 1;
      for (const item of claudeTasks) {
        if (item.type === "task") {
          const t = item.task;
          queueContent += `### TASK ${taskNum}: ${t.name}

**Status:** [ ] Queued
**Task ID:** ${t.id}
**Project:** ${item.projectName}
${t.priority && t.priority !== "none" ? `**Priority:** ${t.priority}\n` : ""}${t.dueDate ? `**Due Date:** ${t.dueDate}\n` : ""}${t.estimatedMinutes ? `**Estimated:** ${t.estimatedMinutes} minutes\n` : ""}
**Objective:**
${t.description || t.name}

${t.context ? `**Background/Context:**
${t.context}

` : ""}${t.subtasks && t.subtasks.length > 0 ? `**Subtasks:**
${t.subtasks.map(st => `- [${st.status === "done" ? "x" : " "}] ${st.name}${st.assignedTo ? ` (${st.assignedTo})` : ""}`).join("\n")}

` : ""}---

`;
        } else {
          const st = item.subtask;
          const pt = item.parentTask;
          queueContent += `### TASK ${taskNum}: ${st.name} (Subtask)

**Status:** [ ] Queued
**Subtask ID:** ${st.id}
**Parent Task:** ${pt.name}
**Parent Task ID:** ${pt.id}
**Project:** ${item.projectName}
${pt.priority && pt.priority !== "none" ? `**Priority:** ${pt.priority}\n` : ""}${pt.dueDate ? `**Due Date:** ${pt.dueDate}\n` : ""}
**Objective:**
${st.name}

${pt.description ? `**Parent Task Description:**
${pt.description}

` : ""}${pt.context ? `**Parent Task Context:**
${pt.context}

` : ""}---

`;
        }
        taskNum++;
      }

      // Add completion checklist
      queueContent += `## COMPLETION CHECKLIST

`;
      taskNum = 1;
      for (const item of claudeTasks) {
        const name = item.type === "task" ? item.task.name : item.subtask.name;
        queueContent += `- [ ] Task ${taskNum}: ${name}\n`;
        taskNum++;
      }

      queueContent += `
---

## DONE — OVERNIGHT RUN SUMMARY

*[Clawdbot fills this in after completing all tasks]*
`;

      // Write to file
      const queuePath = "C:\\Users\\vince\\OneDrive\\Vincenzo\\Claude\\Claude Queue\\claude_queue.md";
      try {
        fs.writeFileSync(queuePath, queueContent, "utf-8");
        return {
          content: [{
            type: "text",
            text: `Queue synced! ${claudeTasks.length} task(s) written to claude_queue.md.\n\nTasks queued:\n${claudeTasks.map((item, i) => `${i + 1}. ${item.type === "task" ? item.task.name : item.subtask.name}`).join("\n")}`
          }]
        };
      } catch (err) {
        return { content: [{ type: "text", text: `Error writing queue file: ${err.message}` }] };
      }
    }

    // ============================
    // NOTEBOOK TOOLS
    // ============================

    case "get_project_notebooks": {
      const project = data.projects.find(p => p.id === args.projectId);
      if (!project) {
        return { content: [{ type: "text", text: `Project ${args.projectId} not found.` }] };
      }
      const notebooks = project.notebooks || [];
      if (notebooks.length === 0) {
        return { content: [{ type: "text", text: `No notebooks in project "${project.name}".` }] };
      }
      const list = notebooks.map(nb => {
        const preview = (nb.content || '').substring(0, 120).replace(/\n/g, ' ');
        return `- **${nb.title}** (id: ${nb.id})\n  Updated: ${nb.updatedAt || 'unknown'}${nb.pinned ? ' [pinned]' : ''}\n  Preview: ${preview}${(nb.content || '').length > 120 ? '...' : ''}`;
      }).join('\n\n');
      return { content: [{ type: "text", text: `## Notebooks in "${project.name}"\n\n${list}` }] };
    }

    case "get_notebook": {
      const project = data.projects.find(p => p.id === args.projectId);
      if (!project) {
        return { content: [{ type: "text", text: `Project ${args.projectId} not found.` }] };
      }
      const notebook = (project.notebooks || []).find(n => n.id === args.notebookId);
      if (!notebook) {
        return { content: [{ type: "text", text: `Notebook ${args.notebookId} not found.` }] };
      }
      return {
        content: [{
          type: "text",
          text: `# ${notebook.title}\n\n**ID:** ${notebook.id}\n**Updated:** ${notebook.updatedAt}\n**Pinned:** ${notebook.pinned ? 'Yes' : 'No'}\n\n---\n\n${notebook.content || '(empty)'}`,
        }],
      };
    }

    case "create_notebook": {
      const project = data.projects.find(p => p.id === args.projectId);
      if (!project) {
        return { content: [{ type: "text", text: `Project ${args.projectId} not found.` }] };
      }
      if (!project.notebooks) project.notebooks = [];
      const now = new Date().toISOString();
      const nb = {
        id: `nb-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
        title: args.title,
        content: args.content || '',
        icon: args.icon || '',
        pinned: false,
        createdAt: now,
        updatedAt: now,
      };
      project.notebooks.push(nb);
      saveData(data);
      return {
        content: [{
          type: "text",
          text: `Created notebook "${nb.title}" (id: ${nb.id}) in project "${project.name}".`,
        }],
      };
    }

    case "update_notebook": {
      const project = data.projects.find(p => p.id === args.projectId);
      if (!project) {
        return { content: [{ type: "text", text: `Project ${args.projectId} not found.` }] };
      }
      const notebook = (project.notebooks || []).find(n => n.id === args.notebookId);
      if (!notebook) {
        return { content: [{ type: "text", text: `Notebook ${args.notebookId} not found.` }] };
      }
      if (args.title !== undefined) notebook.title = args.title;
      if (args.content !== undefined) notebook.content = args.content;
      if (args.icon !== undefined) notebook.icon = args.icon;
      if (args.pinned !== undefined) notebook.pinned = args.pinned;
      notebook.updatedAt = new Date().toISOString();
      saveData(data);
      return {
        content: [{
          type: "text",
          text: `Updated notebook "${notebook.title}" (id: ${notebook.id}).`,
        }],
      };
    }

    case "delete_notebook": {
      const project = data.projects.find(p => p.id === args.projectId);
      if (!project) {
        return { content: [{ type: "text", text: `Project ${args.projectId} not found.` }] };
      }
      if (!project.notebooks) project.notebooks = [];
      const idx = project.notebooks.findIndex(n => n.id === args.notebookId);
      if (idx === -1) {
        return { content: [{ type: "text", text: `Notebook ${args.notebookId} not found.` }] };
      }
      const deleted = project.notebooks.splice(idx, 1)[0];
      saveData(data);
      return {
        content: [{
          type: "text",
          text: `Deleted notebook "${deleted.title}" from project "${project.name}".`,
        }],
      };
    }

    case "append_to_notebook": {
      const project = data.projects.find(p => p.id === args.projectId);
      if (!project) {
        return { content: [{ type: "text", text: `Project ${args.projectId} not found.` }] };
      }
      const notebook = (project.notebooks || []).find(n => n.id === args.notebookId);
      if (!notebook) {
        return { content: [{ type: "text", text: `Notebook ${args.notebookId} not found.` }] };
      }
      const separator = args.separator || '\n\n---\n\n';
      notebook.content = (notebook.content || '') + separator + args.content;
      notebook.updatedAt = new Date().toISOString();
      saveData(data);
      return {
        content: [{
          type: "text",
          text: `Appended content to notebook "${notebook.title}". Total length: ${notebook.content.length} chars.`,
        }],
      };
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
});

// Start server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("TaskFlow MCP Server running");
}

main().catch(console.error);
