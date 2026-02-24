/**
 * Transform Supabase flat rows ↔ Electron nested format.
 *
 * Supabase stores data in normalized tables (snake_case).
 * Electron renderer expects nested objects (camelCase) with
 * tasks nested under projects, subtasks under tasks, etc.
 */

// ── Snake_case ↔ camelCase helpers ──────────────────────────

function snakeToCamel(str) {
  return str.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
}

function camelToSnake(str) {
  return str.replace(/[A-Z]/g, c => `_${c.toLowerCase()}`);
}

function convertKeys(obj, converter) {
  if (Array.isArray(obj)) return obj.map(item => convertKeys(item, converter));
  if (obj && typeof obj === 'object' && !(obj instanceof Date)) {
    const result = {};
    for (const [key, value] of Object.entries(obj)) {
      result[converter(key)] = convertKeys(value, converter);
    }
    return result;
  }
  return obj;
}

// ── Supabase → Local (for renderer.js) ─────────────────────

/**
 * Transform flat Supabase data into the nested format renderer.js expects.
 *
 * @param {Object} supaData - Flat data from Supabase queries
 * @param {Array} supaData.projects
 * @param {Array} supaData.tasks - All tasks (flat, including subtasks)
 * @param {Array} supaData.categories
 * @param {Array} supaData.tags
 * @param {Array} supaData.taskTags - Junction rows {task_id, tag_id}
 * @param {Array} supaData.taskFiles - {task_id, file_path}
 * @param {Array} supaData.taskDependencies - {blocked_task_id, blocking_task_id}
 * @param {Array} supaData.notebooks
 * @param {Array} supaData.launchers
 * @param {Array} supaData.recapEntries - With tags
 * @param {Array} supaData.savedRecaps
 * @param {Object} supaData.preferences - user_preferences row
 * @returns {Object} Nested data in renderer.js format
 */
function supabaseToLocal(supaData) {
  const {
    projects = [],
    tasks = [],
    categories = [],
    tags = [],
    taskTags = [],
    taskFiles = [],
    taskDependencies = [],
    notebooks = [],
    launchers = [],
    recapEntries = [],
    savedRecaps = [],
    preferences = null,
  } = supaData;

  // Build lookup maps
  const tagMap = new Map(tags.map(t => [t.id, t]));
  const taskTagMap = buildMultiMap(taskTags, 'task_id');
  const taskFileMap = buildMultiMap(taskFiles, 'task_id');
  const blockedByMap = buildMultiMap(taskDependencies, 'blocked_task_id');  // tasks that block me
  const blocksMap = buildMultiMap(taskDependencies, 'blocking_task_id');    // tasks I block
  const notebookMap = buildMultiMap(notebooks, 'project_id');
  const launcherMap = buildMultiMap(launchers, 'project_id');

  // Separate top-level tasks and subtasks
  const topLevelTasks = tasks.filter(t => !t.parent_task_id);
  const subtaskMap = buildMultiMap(tasks.filter(t => t.parent_task_id), 'parent_task_id');

  // Build task lookup for dependency names
  const taskLookup = new Map(tasks.map(t => [t.id, t]));

  // Transform tasks to local format
  function transformTask(task) {
    const taskId = task.id;
    const subtasks = (subtaskMap.get(taskId) || []).map(st => transformTask(st));
    const filePaths = (taskFileMap.get(taskId) || []).map(f => f.file_path);
    const taskTagIds = (taskTagMap.get(taskId) || []).map(tt => tt.tag_id);
    const taskTagObjects = taskTagIds.map(id => tagMap.get(id)).filter(Boolean)
      .map(t => ({ id: t.id, name: t.name, color: t.color }));

    // Build blockedBy/blocks arrays with task names
    const blockedByDeps = blockedByMap.get(taskId) || [];
    const blocksDeps = blocksMap.get(taskId) || [];
    const blockedBy = blockedByDeps.map(dep => {
      const blockingTask = taskLookup.get(dep.blocking_task_id);
      return blockingTask ? blockingTask.id : dep.blocking_task_id;
    });
    const blocks = blocksDeps.map(dep => {
      const blockedTask = taskLookup.get(dep.blocked_task_id);
      return blockedTask ? blockedTask.id : dep.blocked_task_id;
    });

    return {
      id: task.id,
      name: task.name,
      description: task.description || '',
      context: task.context || '',
      workNotes: task.work_notes || '',
      status: task.status,
      priority: task.priority,
      dueDate: task.due_date,
      scheduledDate: task.scheduled_date,
      scheduledTime: task.scheduled_time,
      startDate: task.start_date,
      endDate: task.end_date,
      estimatedMinutes: task.estimated_minutes,
      complexity: task.complexity,
      executionType: task.execution_type,
      assignedTo: task.assigned_to,
      assignee: task.assignee_name,
      waitingReason: task.waiting_reason,
      sortOrder: task.sort_order,
      subtasks,
      filePaths,
      tags: taskTagObjects,
      blockedBy,
      blocks,
      createdAt: task.created_at,
      updatedAt: task.updated_at,
      completedAt: task.completed_at,
      // Keep Supabase IDs for sync
      projectId: task.project_id,
      parentTaskId: task.parent_task_id,
    };
  }

  // Build nested projects
  const localProjects = projects.map(project => {
    const projectTasks = topLevelTasks
      .filter(t => t.project_id === project.id)
      .map(transformTask);
    const projectNotebooks = (notebookMap.get(project.id) || []).map(nb => ({
      id: nb.id,
      title: nb.title,
      content: nb.content,
      icon: nb.icon,
      pinned: nb.pinned,
      createdAt: nb.created_at,
      updatedAt: nb.updated_at,
    }));
    const projectLaunchers = (launcherMap.get(project.id) || []).map(ln => ({
      id: ln.id,
      name: ln.name,
      memory: ln.memory,
      prompt: ln.prompt,
      outputDir: ln.output_dir,
      flags: ln.flags,
      createdAt: ln.created_at,
      updatedAt: ln.updated_at,
    }));

    return {
      id: project.id,
      name: project.name,
      description: project.description || '',
      color: project.color,
      isInbox: project.is_inbox,
      status: mapProjectStatus(project.status),
      goal: project.goal || '',
      categoryId: project.category_id,
      workingDirectory: project.working_directory,
      notebooks: projectNotebooks,
      launchers: projectLaunchers,
      tasks: projectTasks,
      createdAt: project.created_at,
      updatedAt: project.updated_at,
    };
  });

  // Transform categories
  const localCategories = categories.map(c => ({
    id: c.id,
    name: c.name,
    color: c.color,
    order: c.sort_order,
    collapsed: c.collapsed,
  }));

  // Transform tags
  const localTags = tags.map(t => ({
    id: t.id,
    name: t.name,
    color: t.color,
  }));

  // Transform recap log
  const localRecapLog = recapEntries.map(entry => ({
    id: entry.id,
    type: entry.entry_type,
    content: entry.content,
    date: entry.date,
    relatedTaskId: entry.related_task_id,
    tags: entry.tags || [],
    createdAt: entry.created_at,
  }));

  // Transform saved recaps
  const localSavedRecaps = savedRecaps.map(recap => ({
    id: recap.id,
    period: recap.period,
    periodLabel: recap.period_label,
    startDate: recap.start_date,
    endDate: recap.end_date,
    content: recap.content,
    stats: recap.stats || {},
    savedAt: recap.saved_at,
  }));

  // Build settings/preferences
  const workingOnTaskIds = preferences?.working_on_task_ids || [];
  const favorites = preferences?.favorites || [];
  const settings = {
    theme: preferences?.theme || 'dark',
    defaultView: preferences?.default_view || 'today',
    fontScale: preferences?.font_scale || 100,
    teamMembers: [], // Team members come from team_members table, not preferences
  };

  return {
    projects: localProjects,
    categories: localCategories,
    tags: localTags,
    favorites,
    recapLog: localRecapLog,
    savedRecaps: localSavedRecaps,
    workingOnTaskIds,
    settings,
  };
}

// ── Local → Supabase (for individual item writes) ───────────

/**
 * Convert a local task object to Supabase insert/update format.
 */
function localTaskToSupabase(task, projectId) {
  return {
    id: task.id || undefined,
    project_id: projectId || task.projectId,
    parent_task_id: task.parentTaskId || null,
    name: task.name,
    description: task.description || '',
    context: task.context || '',
    work_notes: task.workNotes || null,
    status: task.status || 'todo',
    priority: task.priority || 'none',
    due_date: task.dueDate || null,
    scheduled_date: task.scheduledDate || null,
    scheduled_time: task.scheduledTime || null,
    start_date: task.startDate || null,
    end_date: task.endDate || null,
    estimated_minutes: task.estimatedMinutes || null,
    complexity: task.complexity || null,
    execution_type: task.executionType || 'manual',
    assigned_to: task.assignedTo || null,
    assignee_name: task.assignee || null,
    waiting_reason: task.waitingReason || null,
    sort_order: task.sortOrder || 0,
    completed_at: task.completedAt || null,
  };
}

/**
 * Convert a local project object to Supabase insert/update format.
 */
function localProjectToSupabase(project, teamId) {
  return {
    id: project.id || undefined,
    team_id: teamId,
    name: project.name,
    description: project.description || '',
    color: project.color || '#6366f1',
    is_inbox: project.isInbox || false,
    status: mapProjectStatusToSupabase(project.status),
    goal: project.goal || '',
    category_id: project.categoryId || null,
    working_directory: project.workingDirectory || null,
  };
}

/**
 * Convert a local category to Supabase format.
 */
function localCategoryToSupabase(category, teamId) {
  return {
    id: category.id || undefined,
    team_id: teamId,
    name: category.name,
    color: category.color || '#6366f1',
    sort_order: category.order ?? 0,
    collapsed: category.collapsed || false,
  };
}

/**
 * Convert a local tag to Supabase format.
 */
function localTagToSupabase(tag, teamId) {
  return {
    id: tag.id || undefined,
    team_id: teamId,
    name: tag.name,
    color: tag.color || '#6366f1',
  };
}

/**
 * Convert a local notebook to Supabase format.
 */
function localNotebookToSupabase(notebook, projectId) {
  return {
    id: notebook.id || undefined,
    project_id: projectId,
    title: notebook.title || 'Untitled',
    content: notebook.content || '',
    icon: notebook.icon || '',
    pinned: notebook.pinned || false,
  };
}

/**
 * Convert a local launcher to Supabase format.
 */
function localLauncherToSupabase(launcher, projectId) {
  return {
    id: launcher.id || undefined,
    project_id: projectId,
    name: launcher.name || '',
    memory: launcher.memory || '',
    prompt: launcher.prompt || '',
    output_dir: launcher.outputDir || '',
    flags: launcher.flags || '',
  };
}

/**
 * Convert a local recap entry to Supabase format.
 */
function localRecapEntryToSupabase(entry, teamId, userId) {
  return {
    id: entry.id || undefined,
    team_id: teamId,
    user_id: userId,
    entry_type: entry.type,
    content: entry.content,
    date: entry.date,
    related_task_id: entry.relatedTaskId || null,
  };
}

/**
 * Convert a local saved recap to Supabase format.
 */
function localSavedRecapToSupabase(recap, teamId, userId) {
  return {
    id: recap.id || undefined,
    team_id: teamId,
    user_id: userId,
    period: recap.period,
    period_label: recap.periodLabel,
    start_date: recap.startDate,
    end_date: recap.endDate,
    content: recap.content || '',
    stats: recap.stats || {},
  };
}

// ── Helpers ─────────────────────────────────────────────────

function buildMultiMap(items, key) {
  const map = new Map();
  for (const item of items) {
    const k = item[key];
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(item);
  }
  return map;
}

// Map Supabase project_status to local status format
function mapProjectStatus(status) {
  // Supabase: 'active' | 'inactive' | 'archived'
  // Local may use: 'active' | 'paused' | 'blocked' | 'archived'
  return status || 'active';
}

function mapProjectStatusToSupabase(status) {
  // Local: 'active' | 'paused' | 'blocked' | 'archived'
  // Supabase: 'active' | 'inactive' | 'archived'
  if (status === 'paused' || status === 'blocked') return 'inactive';
  if (status === 'archived') return 'archived';
  return 'active';
}

module.exports = {
  supabaseToLocal,
  localTaskToSupabase,
  localProjectToSupabase,
  localCategoryToSupabase,
  localTagToSupabase,
  localNotebookToSupabase,
  localLauncherToSupabase,
  localRecapEntryToSupabase,
  localSavedRecapToSupabase,
};
