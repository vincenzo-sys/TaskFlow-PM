/**
 * SupabaseDataStore — implements DataStore for MCP server using Supabase.
 *
 * Reads the Electron app's saved auth session from disk, authenticates
 * with Supabase, and provides the same nested data format that all
 * MCP tools expect (matching LocalDataStore output exactly).
 *
 * Architecture:
 * - init() authenticates + fetches all data into cache
 * - loadData() re-fetches from Supabase (tools run in async handlers)
 * - saveData() syncs changes to Supabase + updates cache
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { DataStore } from './store.js';

// ── Constants ────────────────────────────────────────────────────────────

const SUPABASE_URL = 'https://xteoofowswtvtxgroxog.supabase.co';
const SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inh0ZW9vZm93c3d0dnR4Z3JveG9nIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDAyNDE5NTIsImV4cCI6MjA1NTgxNzk1Mn0.6R-jRPoNSaKeBpVGbpMBKb6CE0MmB8FACxvFE7vi_H8';

const AUTH_SESSION_PATH = path.join(
  process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'),
  'taskflow-pm',
  'supabase-auth.json'
);

// ── File-based auth storage (mirrors Electron's FileAuthStorage) ─────────

class FileAuthStorage {
  private filePath: string;
  private cache: Record<string, string>;

  constructor(filePath: string) {
    this.filePath = filePath;
    this.cache = {};
    this._load();
  }

  private _load(): void {
    try {
      if (fs.existsSync(this.filePath)) {
        this.cache = JSON.parse(fs.readFileSync(this.filePath, 'utf-8'));
      }
    } catch {
      this.cache = {};
    }
  }

  getItem(key: string): string | null {
    return this.cache[key] ?? null;
  }

  setItem(key: string, value: string): void {
    this.cache[key] = value;
    // Don't write back — MCP server is read-only for auth
  }

  removeItem(key: string): void {
    delete this.cache[key];
  }
}

// ── Transform helpers (inline — mirrors apps/electron/data-transform.js) ──

function buildMultiMap<T>(items: T[], key: keyof T): Map<any, T[]> {
  const map = new Map<any, T[]>();
  for (const item of items) {
    const k = (item as any)[key];
    if (!map.has(k)) map.set(k, []);
    map.get(k)!.push(item);
  }
  return map;
}

function mapProjectStatus(status: string | null): string {
  return status || 'active';
}

function mapProjectStatusToSupabase(status: string | undefined): string {
  if (status === 'paused' || status === 'blocked') return 'inactive';
  if (status === 'archived') return 'archived';
  return 'active';
}

interface SupaFetchResult {
  projects: any[];
  tasks: any[];
  categories: any[];
  tags: any[];
  taskTags: any[];
  taskFiles: any[];
  taskDependencies: any[];
  notebooks: any[];
  launchers: any[];
  recapEntries: any[];
  savedRecaps: any[];
  preferences: any | null;
}

/**
 * Transform flat Supabase rows into the nested format that MCP tools expect.
 * This is a direct port of apps/electron/data-transform.js supabaseToLocal().
 */
function supabaseToLocal(supaData: SupaFetchResult): any {
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
  const tagMap = new Map(tags.map((t: any) => [t.id, t]));
  const taskTagMap = buildMultiMap(taskTags, 'task_id' as any);
  const taskFileMap = buildMultiMap(taskFiles, 'task_id' as any);
  const blockedByMap = buildMultiMap(taskDependencies, 'blocked_task_id' as any);
  const blocksMap = buildMultiMap(taskDependencies, 'blocking_task_id' as any);
  const notebookMap = buildMultiMap(notebooks, 'project_id' as any);
  const launcherMap = buildMultiMap(launchers, 'project_id' as any);

  // Separate top-level tasks and subtasks
  const topLevelTasks = tasks.filter((t: any) => !t.parent_task_id);
  const subtaskMap = buildMultiMap(
    tasks.filter((t: any) => t.parent_task_id),
    'parent_task_id' as any
  );

  // Build task lookup for dependency names
  const taskLookup = new Map(tasks.map((t: any) => [t.id, t]));

  function transformTask(task: any): any {
    const taskId = task.id;
    const subtasks = (subtaskMap.get(taskId) || []).map((st: any) => transformTask(st));
    const filePaths = (taskFileMap.get(taskId) || []).map((f: any) => f.file_path);
    const taskTagIds = (taskTagMap.get(taskId) || []).map((tt: any) => tt.tag_id);
    const taskTagObjects = taskTagIds
      .map((id: string) => tagMap.get(id))
      .filter(Boolean)
      .map((t: any) => ({ id: t.id, name: t.name, color: t.color }));

    const blockedByDeps = blockedByMap.get(taskId) || [];
    const blocksDeps = blocksMap.get(taskId) || [];
    const blockedBy = blockedByDeps.map((dep: any) => {
      const blockingTask = taskLookup.get(dep.blocking_task_id);
      return blockingTask ? blockingTask.id : dep.blocking_task_id;
    });
    const blocks = blocksDeps.map((dep: any) => {
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
      projectId: task.project_id,
      parentTaskId: task.parent_task_id,
    };
  }

  // Build nested projects
  const localProjects = projects.map((project: any) => {
    const projectTasks = topLevelTasks
      .filter((t: any) => t.project_id === project.id)
      .map(transformTask);
    const projectNotebooks = (notebookMap.get(project.id) || []).map((nb: any) => ({
      id: nb.id,
      title: nb.title,
      content: nb.content,
      icon: nb.icon,
      pinned: nb.pinned,
      createdAt: nb.created_at,
      updatedAt: nb.updated_at,
    }));
    const projectLaunchers = (launcherMap.get(project.id) || []).map((ln: any) => ({
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
  const localCategories = categories.map((c: any) => ({
    id: c.id,
    name: c.name,
    color: c.color,
    order: c.sort_order,
    collapsed: c.collapsed,
  }));

  // Transform tags
  const localTags = tags.map((t: any) => ({
    id: t.id,
    name: t.name,
    color: t.color,
  }));

  // Transform recap log
  const localRecapLog = recapEntries.map((entry: any) => ({
    id: entry.id,
    type: entry.entry_type,
    content: entry.content,
    date: entry.date,
    relatedTaskId: entry.related_task_id,
    tags: entry.tags || [],
    createdAt: entry.created_at,
  }));

  // Transform saved recaps
  const localSavedRecaps = savedRecaps.map((recap: any) => ({
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
    teamMembers: [],
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

// ── Local → Supabase transform helpers ───────────────────────────────────

function localTaskToSupabase(task: any, projectId: string): any {
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

function localProjectToSupabase(project: any, teamId: string): any {
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

function localCategoryToSupabase(category: any, teamId: string): any {
  return {
    id: category.id || undefined,
    team_id: teamId,
    name: category.name,
    color: category.color || '#6366f1',
    sort_order: category.order ?? 0,
    collapsed: category.collapsed || false,
  };
}

function localTagToSupabase(tag: any, teamId: string): any {
  return {
    id: tag.id || undefined,
    team_id: teamId,
    name: tag.name,
    color: tag.color || '#6366f1',
  };
}

function localNotebookToSupabase(notebook: any, projectId: string): any {
  return {
    id: notebook.id || undefined,
    project_id: projectId,
    title: notebook.title || 'Untitled',
    content: notebook.content || '',
    icon: notebook.icon || '',
    pinned: notebook.pinned || false,
  };
}

function localLauncherToSupabase(launcher: any, projectId: string): any {
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

function localRecapEntryToSupabase(entry: any, teamId: string, userId: string): any {
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

function localSavedRecapToSupabase(recap: any, teamId: string, userId: string): any {
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

function isUUID(str: any): boolean {
  return (
    typeof str === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str)
  );
}

// ── SupabaseDataStore class ──────────────────────────────────────────────

export class SupabaseDataStore implements DataStore {
  private client: SupabaseClient;
  private teamId: string | null = null;
  private userId: string | null = null;
  private cachedData: any = null;

  constructor() {
    const storage = new FileAuthStorage(AUTH_SESSION_PATH);
    this.client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        storage,
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: false,
      },
    });
  }

  /**
   * Authenticate using the saved Electron session, resolve user's team,
   * and perform initial data load into cache.
   */
  async init(): Promise<void> {
    // Verify we have a valid session
    const {
      data: { user },
      error: userError,
    } = await this.client.auth.getUser();
    if (userError || !user) {
      throw new Error(
        `Not authenticated — no valid session found at ${AUTH_SESSION_PATH}. ` +
          `Log in via the Electron app first. (${userError?.message || 'no user'})`
      );
    }
    this.userId = user.id;

    // Get user's team
    const { data: membership, error: teamError } = await this.client
      .from('team_members')
      .select('team_id')
      .eq('user_id', this.userId)
      .limit(1)
      .single();
    if (teamError || !membership) {
      throw new Error(
        `No team found for user ${this.userId}. ${teamError?.message || ''}`
      );
    }
    this.teamId = membership.team_id;

    // Initial data load
    this.cachedData = await this.fetchAllData();
    console.error(
      `SupabaseDataStore initialized: user=${this.userId}, team=${this.teamId}, ` +
        `projects=${this.cachedData.projects.length}`
    );
  }

  /**
   * Fetch all data from Supabase and return nested local format.
   * Mirrors apps/electron/data-service.js loadAllData().
   */
  private async fetchAllData(): Promise<any> {
    if (!this.teamId || !this.userId) {
      throw new Error('Not initialized — call init() first');
    }

    // Step 1: Fetch projects
    const projectsRes = await this.client
      .from('projects')
      .select('*')
      .eq('team_id', this.teamId);
    const projectIds = (projectsRes.data || []).map((p: any) => p.id);

    // Step 2: Fetch everything else in parallel
    const [
      tasksRes,
      categoriesRes,
      tagsRes,
      taskTagsRes,
      taskFilesRes,
      taskDepsRes,
      notebooksRes,
      launchersRes,
      recapEntriesRes,
      recapEntryTagsRes,
      savedRecapsRes,
      preferencesRes,
    ] = await Promise.all([
      projectIds.length > 0
        ? this.client
            .from('tasks')
            .select('*')
            .in('project_id', projectIds)
            .order('sort_order')
            .order('created_at')
        : Promise.resolve({ data: [] }),
      this.client
        .from('categories')
        .select('*')
        .eq('team_id', this.teamId)
        .order('sort_order'),
      this.client
        .from('tags')
        .select('*')
        .eq('team_id', this.teamId)
        .order('name'),
      this.fetchTaskJunction('task_tags', 'task_id, tag_id', projectIds),
      this.fetchTaskJunction('task_files', 'task_id, file_path', projectIds),
      this.fetchTaskJunction(
        'task_dependencies',
        'blocked_task_id, blocking_task_id',
        projectIds
      ),
      projectIds.length > 0
        ? this.client.from('notebooks').select('*').in('project_id', projectIds)
        : Promise.resolve({ data: [] }),
      projectIds.length > 0
        ? this.client.from('launchers').select('*').in('project_id', projectIds)
        : Promise.resolve({ data: [] }),
      this.client
        .from('recap_entries')
        .select('*')
        .eq('team_id', this.teamId)
        .order('date', { ascending: false }),
      this.client.from('recap_entry_tags').select('*'),
      this.client
        .from('saved_recaps')
        .select('*')
        .eq('team_id', this.teamId)
        .order('saved_at', { ascending: false }),
      this.client
        .from('user_preferences')
        .select('*')
        .eq('user_id', this.userId!)
        .eq('team_id', this.teamId)
        .maybeSingle(),
    ]);

    // Attach tags to recap entries
    const recapTagMap = new Map<string, string[]>();
    for (const rt of recapEntryTagsRes.data || []) {
      if (!recapTagMap.has(rt.recap_entry_id))
        recapTagMap.set(rt.recap_entry_id, []);
      recapTagMap.get(rt.recap_entry_id)!.push(rt.tag);
    }
    const recapEntriesWithTags = (recapEntriesRes.data || []).map(
      (entry: any) => ({
        ...entry,
        tags: recapTagMap.get(entry.id) || [],
      })
    );

    const supaData: SupaFetchResult = {
      projects: projectsRes.data || [],
      tasks: tasksRes.data || [],
      categories: categoriesRes.data || [],
      tags: tagsRes.data || [],
      taskTags: taskTagsRes.data || [],
      taskFiles: taskFilesRes.data || [],
      taskDependencies: taskDepsRes.data || [],
      notebooks: notebooksRes.data || [],
      launchers: launchersRes.data || [],
      recapEntries: recapEntriesWithTags,
      savedRecaps: savedRecapsRes.data || [],
      preferences: preferencesRes.data,
    };

    return supabaseToLocal(supaData);
  }

  /**
   * Fetch junction table rows for tasks belonging to this team's projects.
   */
  private async fetchTaskJunction(
    table: string,
    selectColumns: string,
    projectIds: string[]
  ): Promise<{ data: any[] }> {
    if (projectIds.length === 0) return { data: [] };

    const taskIdsRes = await this.client
      .from('tasks')
      .select('id')
      .in('project_id', projectIds);
    const taskIds = (taskIdsRes.data || []).map((t: any) => t.id);
    if (taskIds.length === 0) return { data: [] };

    if (table === 'task_dependencies') {
      return this.client
        .from(table)
        .select(selectColumns)
        .or(
          `blocked_task_id.in.(${taskIds.join(',')}),blocking_task_id.in.(${taskIds.join(',')})`
        ) as any;
    }
    return this.client
      .from(table)
      .select(selectColumns)
      .in('task_id', taskIds) as any;
  }

  // ── DataStore interface ──────────────────────────────────────────────

  /**
   * Load data — re-fetches from Supabase to get latest state.
   * Returns the nested local format identical to LocalDataStore.
   */
  async loadData(): Promise<any> {
    try {
      this.cachedData = await this.fetchAllData();
    } catch (err: any) {
      console.error('Supabase fetch failed, using cached data:', err.message);
      if (!this.cachedData) {
        return { projects: [], tags: [], settings: {} };
      }
    }
    return this.cachedData;
  }

  /**
   * Save data — syncs the full nested data object to Supabase.
   * Mirrors apps/electron/data-service.js syncChanges().
   */
  async saveData(data: any): Promise<boolean> {
    if (!this.teamId || !this.userId) {
      console.error('Cannot save — not initialized');
      return false;
    }

    try {
      await this.syncChanges(data);
      this.cachedData = data;
      return true;
    } catch (err: any) {
      console.error('Supabase save error:', err.message);
      return false;
    }
  }

  async getRawData(): Promise<any> {
    return this.loadData();
  }

  async saveRawData(data: any): Promise<void> {
    await this.saveData(data);
  }

  // ── Sync logic (mirrors data-service.js syncChanges) ──────────────

  private async syncChanges(newData: any): Promise<void> {
    // Sync projects + nested entities
    for (const project of newData.projects || []) {
      if (isUUID(project.id)) {
        const supaProject = localProjectToSupabase(project, this.teamId!);
        supaProject.id = project.id;
        await this.client
          .from('projects')
          .upsert(supaProject, { onConflict: 'id' });

        // Sync tasks
        for (const task of project.tasks || []) {
          await this.syncTask(task, project.id);
        }

        // Sync notebooks
        for (const nb of project.notebooks || []) {
          if (isUUID(nb.id)) {
            const supaNb = localNotebookToSupabase(nb, project.id);
            supaNb.id = nb.id;
            await this.client
              .from('notebooks')
              .upsert(supaNb, { onConflict: 'id' });
          }
        }

        // Sync launchers
        for (const ln of project.launchers || []) {
          if (isUUID(ln.id)) {
            const supaLn = localLauncherToSupabase(ln, project.id);
            supaLn.id = ln.id;
            await this.client
              .from('launchers')
              .upsert(supaLn, { onConflict: 'id' });
          }
        }
      }
    }

    // Sync categories
    for (const cat of newData.categories || []) {
      if (isUUID(cat.id)) {
        const supaCat = localCategoryToSupabase(cat, this.teamId!);
        supaCat.id = cat.id;
        await this.client
          .from('categories')
          .upsert(supaCat, { onConflict: 'id' });
      }
    }

    // Sync tags
    for (const tag of newData.tags || []) {
      if (isUUID(tag.id)) {
        const supaTag = localTagToSupabase(tag, this.teamId!);
        supaTag.id = tag.id;
        await this.client.from('tags').upsert(supaTag, { onConflict: 'id' });
      }
    }

    // Sync recap entries + tags
    for (const entry of newData.recapLog || []) {
      if (isUUID(entry.id)) {
        const supaEntry = localRecapEntryToSupabase(
          entry,
          this.teamId!,
          this.userId!
        );
        supaEntry.id = entry.id;
        await this.client
          .from('recap_entries')
          .upsert(supaEntry, { onConflict: 'id' });

        // Replace recap tags
        if (entry.tags) {
          await this.client
            .from('recap_entry_tags')
            .delete()
            .eq('recap_entry_id', entry.id);
          if (entry.tags.length > 0) {
            const tagRows = entry.tags.map((tag: string) => ({
              recap_entry_id: entry.id,
              tag,
            }));
            await this.client.from('recap_entry_tags').insert(tagRows);
          }
        }
      }
    }

    // Sync saved recaps
    for (const recap of newData.savedRecaps || []) {
      if (isUUID(recap.id)) {
        const supaRecap = localSavedRecapToSupabase(
          recap,
          this.teamId!,
          this.userId!
        );
        supaRecap.id = recap.id;
        await this.client
          .from('saved_recaps')
          .upsert(supaRecap, { onConflict: 'id' });
      }
    }

    // Sync preferences
    if (
      newData.workingOnTaskIds ||
      newData.favorites ||
      newData.settings
    ) {
      const prefUpdates: any = {};
      if (newData.workingOnTaskIds)
        prefUpdates.working_on_task_ids =
          newData.workingOnTaskIds.filter(isUUID);
      if (newData.favorites)
        prefUpdates.favorites = newData.favorites.filter(isUUID);
      if (newData.settings) {
        if (newData.settings.theme) prefUpdates.theme = newData.settings.theme;
        if (newData.settings.defaultView)
          prefUpdates.default_view = newData.settings.defaultView;
        if (newData.settings.fontScale)
          prefUpdates.font_scale = newData.settings.fontScale;
      }
      if (Object.keys(prefUpdates).length > 0) {
        await this.client
          .from('user_preferences')
          .update(prefUpdates)
          .eq('user_id', this.userId!)
          .eq('team_id', this.teamId!);
      }
    }
  }

  private async syncTask(task: any, projectId: string): Promise<void> {
    if (!isUUID(task.id)) return;

    const supaTask = localTaskToSupabase(task, projectId);
    supaTask.id = task.id;
    await this.client.from('tasks').upsert(supaTask, { onConflict: 'id' });

    // Sync subtasks
    for (const st of task.subtasks || []) {
      if (isUUID(st.id)) {
        const supaSt = localTaskToSupabase(st, projectId);
        supaSt.id = st.id;
        supaSt.parent_task_id = task.id;
        await this.client.from('tasks').upsert(supaSt, { onConflict: 'id' });
      }
    }

    // Sync task tags — replace all
    if (task.tags) {
      await this.client.from('task_tags').delete().eq('task_id', task.id);
      const tagRows = task.tags
        .map((t: any) => ({
          task_id: task.id,
          tag_id: typeof t === 'string' ? t : t.id,
        }))
        .filter((r: any) => isUUID(r.tag_id));
      if (tagRows.length > 0) {
        await this.client.from('task_tags').insert(tagRows);
      }
    }

    // Sync task files — replace all
    if (task.filePaths) {
      await this.client.from('task_files').delete().eq('task_id', task.id);
      if (task.filePaths.length > 0) {
        const fileRows = task.filePaths.map((fp: string) => ({
          task_id: task.id,
          file_path: fp,
        }));
        await this.client.from('task_files').insert(fileRows);
      }
    }

    // Sync dependencies (blockedBy) — replace all
    if (task.blockedBy) {
      await this.client
        .from('task_dependencies')
        .delete()
        .eq('blocked_task_id', task.id);
      const depRows = task.blockedBy
        .filter((id: string) => isUUID(id))
        .map((blockingId: string) => ({
          blocked_task_id: task.id,
          blocking_task_id: blockingId,
        }));
      if (depRows.length > 0) {
        await this.client.from('task_dependencies').insert(depRows);
      }
    }
  }
}
