/**
 * Transform Electron local JSON data into Supabase insert objects.
 *
 * Handles:
 * - camelCase → snake_case field mapping
 * - Flattening nested projects[].tasks[] into separate arrays
 * - Subtask extraction (tasks with parent_task_id)
 * - File paths → task_files rows
 * - blockedBy/blocks → task_dependencies rows (second pass)
 * - Categories, tags, recap entries, saved recaps
 * - ID mapping (local IDs → new UUIDs)
 */

// ── Types for the Electron local JSON format ─────────────────

interface LocalTask {
  id: string;
  name: string;
  description?: string;
  context?: string;
  workNotes?: string;
  status?: string;
  priority?: string;
  dueDate?: string | null;
  scheduledDate?: string | null;
  scheduledTime?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  estimatedMinutes?: number | null;
  complexity?: number | null;
  executionType?: string;
  assignee?: string | null;
  assigneeName?: string;
  waitingReason?: string;
  completedAt?: string | null;
  createdAt?: string;
  updatedAt?: string;
  subtasks?: LocalTask[];
  filePaths?: string[];
  blockedBy?: string[];
  blocks?: string[];
  blockerInfo?: {
    type?: string;
    description?: string;
    followUpDate?: string | null;
    notes?: Array<{ note: string; createdAt?: string }>;
  };
  tags?: string[];
  sortOrder?: number;
}

interface LocalProject {
  id: string;
  name: string;
  description?: string;
  color?: string;
  isInbox?: boolean;
  status?: string;
  goal?: string;
  categoryId?: string;
  workingDirectory?: string | null;
  tasks?: LocalTask[];
  notebooks?: Array<{
    id: string;
    title: string;
    content: string;
    icon?: string;
    pinned?: boolean;
    createdAt?: string;
    updatedAt?: string;
  }>;
  launchers?: Array<{
    id: string;
    name: string;
    memory?: string;
    prompt?: string;
    outputDir?: string;
    flags?: string;
    createdAt?: string;
    updatedAt?: string;
  }>;
}

interface LocalCategory {
  id: string;
  name: string;
  color?: string;
  order?: number;
  collapsed?: boolean;
}

interface LocalTag {
  id: string;
  name: string;
  color?: string;
}

interface LocalRecapEntry {
  id: string;
  type: string;
  content: string;
  date?: string;
  relatedTaskId?: string | null;
  tags?: string[];
  createdAt?: string;
}

interface LocalSavedRecap {
  id: string;
  period: string;
  periodLabel: string;
  startDate: string;
  endDate: string;
  content: string;
  stats?: Record<string, unknown>;
  savedAt?: string;
}

export interface LocalData {
  projects?: LocalProject[];
  categories?: LocalCategory[];
  tags?: LocalTag[];
  recapLog?: LocalRecapEntry[];
  savedRecaps?: LocalSavedRecap[];
  workingOnTaskIds?: string[];
  settings?: Record<string, unknown>;
}

// ── Output types ─────────────────────────────────────────────

export interface TransformResult {
  categories: Array<Record<string, unknown>>;
  tags: Array<Record<string, unknown>>;
  projects: Array<Record<string, unknown>>;
  tasks: Array<Record<string, unknown>>;
  taskFiles: Array<Record<string, unknown>>;
  taskDependencies: Array<Record<string, unknown>>;
  taskTags: Array<Record<string, unknown>>;
  notebooks: Array<Record<string, unknown>>;
  launchers: Array<Record<string, unknown>>;
  recapEntries: Array<Record<string, unknown>>;
  recapEntryTags: Array<Record<string, unknown>>;
  savedRecaps: Array<Record<string, unknown>>;
  workingOnTaskIds: string[];
  /** Maps local IDs → Supabase UUIDs for debugging */
  idMap: Record<string, string>;
  stats: {
    projects: number;
    tasks: number;
    subtasks: number;
    categories: number;
    tags: number;
    notebooks: number;
    launchers: number;
    recapEntries: number;
    savedRecaps: number;
    dependencies: number;
    files: number;
  };
}

// ── Helpers ──────────────────────────────────────────────────

function uuid(): string {
  return crypto.randomUUID();
}

function mapStatus(s?: string): string {
  const valid = ['todo', 'in-progress', 'review', 'waiting', 'done'];
  if (s && valid.includes(s)) return s;
  return 'todo';
}

function mapPriority(p?: string): string {
  const valid = ['none', 'low', 'medium', 'high', 'urgent'];
  if (p && valid.includes(p)) return p;
  return 'none';
}

function mapExecutionType(e?: string): string {
  const valid = ['ai', 'manual', 'hybrid'];
  if (e && valid.includes(e)) return e;
  return 'manual';
}

function mapProjectStatus(s?: string): string {
  const valid = ['active', 'inactive', 'archived'];
  if (s && valid.includes(s)) return s;
  // Map old Electron values
  if (s === 'paused') return 'inactive';
  if (s === 'blocked') return 'active';
  return 'active';
}

function mapBlockerType(t?: string): string {
  const valid = ['person', 'external', 'technical', 'decision', 'other'];
  if (t && valid.includes(t)) return t;
  return 'other';
}

function mapRecapEntryType(t?: string): string {
  const valid = ['accomplishment', 'decision', 'note'];
  if (t && valid.includes(t)) return t;
  return 'note';
}

function mapRecapPeriod(p?: string): string {
  const valid = ['daily', 'weekly', 'monthly'];
  if (p && valid.includes(p)) return p;
  return 'daily';
}

// ── Main Transform ───────────────────────────────────────────

export function transformLocalToSupabase(
  local: LocalData,
  teamId: string,
  userId: string
): TransformResult {
  const idMap: Record<string, string> = {};
  const result: TransformResult = {
    categories: [],
    tags: [],
    projects: [],
    tasks: [],
    taskFiles: [],
    taskDependencies: [],
    taskTags: [],
    notebooks: [],
    launchers: [],
    recapEntries: [],
    recapEntryTags: [],
    savedRecaps: [],
    workingOnTaskIds: [],
    idMap,
    stats: {
      projects: 0, tasks: 0, subtasks: 0, categories: 0, tags: 0,
      notebooks: 0, launchers: 0, recapEntries: 0, savedRecaps: 0,
      dependencies: 0, files: 0,
    },
  };

  // -- Categories --
  for (const cat of local.categories ?? []) {
    const newId = uuid();
    idMap[cat.id] = newId;
    result.categories.push({
      id: newId,
      team_id: teamId,
      name: cat.name,
      color: cat.color ?? '#6366f1',
      sort_order: cat.order ?? 0,
      collapsed: cat.collapsed ?? false,
    });
    result.stats.categories++;
  }

  // -- Tags --
  const tagNameToId: Record<string, string> = {};
  for (const tag of local.tags ?? []) {
    const newId = uuid();
    idMap[tag.id] = newId;
    tagNameToId[tag.name.toLowerCase()] = newId;
    result.tags.push({
      id: newId,
      team_id: teamId,
      name: tag.name,
      color: tag.color ?? '#6366f1',
    });
    result.stats.tags++;
  }

  // -- Projects --
  for (const proj of local.projects ?? []) {
    const newProjectId = uuid();
    idMap[proj.id] = newProjectId;

    result.projects.push({
      id: newProjectId,
      team_id: teamId,
      category_id: proj.categoryId ? (idMap[proj.categoryId] ?? null) : null,
      name: proj.name,
      description: proj.description ?? '',
      color: proj.color ?? '#6366f1',
      is_inbox: proj.isInbox ?? false,
      status: mapProjectStatus(proj.status),
      goal: proj.goal ?? '',
      working_directory: proj.workingDirectory ?? null,
    });
    result.stats.projects++;

    // -- Tasks within project --
    for (const task of proj.tasks ?? []) {
      transformTask(task, newProjectId, null, result, idMap, tagNameToId);
    }

    // -- Notebooks --
    for (const nb of proj.notebooks ?? []) {
      const newNbId = uuid();
      idMap[nb.id] = newNbId;
      result.notebooks.push({
        id: newNbId,
        project_id: newProjectId,
        title: nb.title ?? 'Untitled',
        content: nb.content ?? '',
        icon: nb.icon ?? '',
        pinned: nb.pinned ?? false,
      });
      result.stats.notebooks++;
    }

    // -- Launchers --
    for (const lnch of proj.launchers ?? []) {
      const newLnchId = uuid();
      idMap[lnch.id] = newLnchId;
      result.launchers.push({
        id: newLnchId,
        project_id: newProjectId,
        name: lnch.name ?? '',
        memory: lnch.memory ?? '',
        prompt: lnch.prompt ?? '',
        output_dir: lnch.outputDir ?? '',
        flags: lnch.flags ?? '',
      });
      result.stats.launchers++;
    }
  }

  // -- Dependencies (second pass — all task IDs are mapped now) --
  for (const proj of local.projects ?? []) {
    for (const task of proj.tasks ?? []) {
      addDependencies(task, result, idMap);
      for (const sub of task.subtasks ?? []) {
        addDependencies(sub, result, idMap);
      }
    }
  }

  // -- Recap entries --
  for (const entry of local.recapLog ?? []) {
    const newId = uuid();
    idMap[entry.id] = newId;
    result.recapEntries.push({
      id: newId,
      team_id: teamId,
      user_id: userId,
      entry_type: mapRecapEntryType(entry.type),
      content: entry.content,
      date: entry.date ?? new Date().toISOString().split('T')[0],
      related_task_id: entry.relatedTaskId ? (idMap[entry.relatedTaskId] ?? null) : null,
    });
    result.stats.recapEntries++;

    // Recap entry tags
    for (const tag of entry.tags ?? []) {
      result.recapEntryTags.push({
        id: uuid(),
        recap_entry_id: newId,
        tag: tag,
      });
    }
  }

  // -- Saved recaps --
  for (const recap of local.savedRecaps ?? []) {
    const newId = uuid();
    idMap[recap.id] = newId;
    result.savedRecaps.push({
      id: newId,
      team_id: teamId,
      user_id: userId,
      period: mapRecapPeriod(recap.period),
      period_label: recap.periodLabel ?? '',
      start_date: recap.startDate,
      end_date: recap.endDate,
      content: recap.content ?? '',
      stats: recap.stats ?? {},
    });
    result.stats.savedRecaps++;
  }

  // -- Working on task IDs (map to new UUIDs) --
  for (const oldId of local.workingOnTaskIds ?? []) {
    const newId = idMap[oldId];
    if (newId) result.workingOnTaskIds.push(newId);
  }

  return result;
}

// ── Transform a single task (+ its subtasks recursively) ─────

function transformTask(
  task: LocalTask,
  projectId: string,
  parentTaskId: string | null,
  result: TransformResult,
  idMap: Record<string, string>,
  tagNameToId: Record<string, string>
): void {
  const newTaskId = uuid();
  idMap[task.id] = newTaskId;

  result.tasks.push({
    id: newTaskId,
    project_id: projectId,
    parent_task_id: parentTaskId,
    name: task.name,
    description: task.description ?? '',
    context: task.context ?? '',
    work_notes: task.workNotes ?? null,
    status: mapStatus(task.status),
    priority: mapPriority(task.priority),
    due_date: task.dueDate ?? null,
    scheduled_date: task.scheduledDate ?? null,
    scheduled_time: task.scheduledTime ?? null,
    start_date: task.startDate ?? null,
    end_date: task.endDate ?? null,
    estimated_minutes: task.estimatedMinutes ?? null,
    complexity: task.complexity ?? null,
    execution_type: mapExecutionType(task.executionType),
    assigned_to: null,
    assignee_name: task.assigneeName ?? task.assignee ?? null,
    waiting_reason: task.waitingReason ?? null,
    sort_order: task.sortOrder ?? 0,
    completed_at: task.completedAt ?? null,
  });

  if (parentTaskId) {
    result.stats.subtasks++;
  } else {
    result.stats.tasks++;
  }

  // File paths
  for (const fp of task.filePaths ?? []) {
    result.taskFiles.push({
      id: uuid(),
      task_id: newTaskId,
      file_path: fp,
    });
    result.stats.files++;
  }

  // Task tags (by name match)
  for (const tagName of task.tags ?? []) {
    const tagId = tagNameToId[tagName.toLowerCase()];
    if (tagId) {
      result.taskTags.push({ task_id: newTaskId, tag_id: tagId });
    }
  }

  // Recurse into subtasks
  for (const sub of task.subtasks ?? []) {
    transformTask(sub, projectId, newTaskId, result, idMap, tagNameToId);
  }
}

// ── Add dependency rows (called after all IDs are mapped) ────

function addDependencies(
  task: LocalTask,
  result: TransformResult,
  idMap: Record<string, string>
): void {
  const myId = idMap[task.id];
  if (!myId) return;

  for (const blockerId of task.blockedBy ?? []) {
    const mappedBlocker = idMap[blockerId];
    if (mappedBlocker) {
      result.taskDependencies.push({
        blocked_task_id: myId,
        blocking_task_id: mappedBlocker,
      });
      result.stats.dependencies++;
    }
  }
  // blocks are the inverse — if A blocks B, then B is blocked by A
  // We only need one direction to avoid duplicates; blockedBy is canonical.
}
