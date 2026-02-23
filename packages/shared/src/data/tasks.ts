import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../types/database.js';
import type { Task, TaskInsert, TaskUpdate, TaskWithRelations } from '../types/task.js';

type Client = SupabaseClient<Database>;

function todayDate(): string {
  return new Date().toISOString().split('T')[0];
}

// ── Queries ──────────────────────────────────────────────────

export async function getTaskById(client: Client, taskId: string): Promise<Task | null> {
  const { data } = await client
    .from('tasks')
    .select('*')
    .eq('id', taskId)
    .single();
  return data;
}

export async function getTaskWithRelations(client: Client, taskId: string): Promise<TaskWithRelations | null> {
  const { data: task } = await client
    .from('tasks')
    .select('*')
    .eq('id', taskId)
    .single();
  if (!task) return null;

  const [subtasks, tags, blockedBy, blocks, blockerInfo, timeLogs, learnings, files] = await Promise.all([
    client.from('tasks').select('*').eq('parent_task_id', taskId).order('sort_order'),
    client.from('task_tags').select('tag_id, tags(id, name, color)').eq('task_id', taskId),
    client.from('task_dependencies').select('blocking_task_id, tasks!task_dependencies_blocking_task_id_fkey(id, name, status)').eq('blocked_task_id', taskId),
    client.from('task_dependencies').select('blocked_task_id, tasks!task_dependencies_blocked_task_id_fkey(id, name, status)').eq('blocking_task_id', taskId),
    client.from('blocker_info').select('*, blocker_notes(*)').eq('task_id', taskId).maybeSingle(),
    client.from('time_logs').select('id, minutes, notes, logged_at').eq('task_id', taskId).order('logged_at', { ascending: false }),
    client.from('task_learnings').select('id, learning, added_at').eq('task_id', taskId).order('added_at', { ascending: false }),
    client.from('task_files').select('file_path').eq('task_id', taskId),
  ]);

  return {
    ...task,
    subtasks: (subtasks.data ?? []) as Task[],
    tags: (tags.data ?? []).map((t: any) => t.tags).filter(Boolean),
    blocked_by: (blockedBy.data ?? []).map((d: any) => d.tasks).filter(Boolean),
    blocks: (blocks.data ?? []).map((d: any) => d.tasks).filter(Boolean),
    blocker_info: blockerInfo.data ? {
      ...(blockerInfo.data as any),
      notes: (blockerInfo.data as any).blocker_notes ?? [],
    } : null,
    time_logs: (timeLogs.data ?? []) as TaskWithRelations['time_logs'],
    learnings: (learnings.data ?? []) as TaskWithRelations['learnings'],
    file_paths: (files.data ?? []).map((f: any) => f.file_path),
  } as TaskWithRelations;
}

export async function getTasksByProject(client: Client, projectId: string): Promise<Task[]> {
  const { data } = await client
    .from('tasks')
    .select('*')
    .eq('project_id', projectId)
    .is('parent_task_id', null)
    .order('sort_order')
    .order('created_at');
  return data ?? [];
}

export async function getTodayTasks(client: Client, teamId: string): Promise<Task[]> {
  const today = todayDate();
  const { data } = await client
    .from('tasks')
    .select('*, projects!inner(team_id)')
    .eq('projects.team_id', teamId)
    .is('parent_task_id', null)
    .neq('status', 'done')
    .or(`due_date.eq.${today},scheduled_date.eq.${today}`);
  return data ?? [];
}

export async function getOverdueTasks(client: Client, teamId: string): Promise<Task[]> {
  const today = todayDate();
  const { data } = await client
    .from('tasks')
    .select('*, projects!inner(team_id)')
    .eq('projects.team_id', teamId)
    .is('parent_task_id', null)
    .neq('status', 'done')
    .lt('due_date', today);
  return data ?? [];
}

export async function getUpcomingTasks(client: Client, teamId: string, days: number = 7): Promise<Task[]> {
  const today = todayDate();
  const future = new Date();
  future.setDate(future.getDate() + days);
  const futureDate = future.toISOString().split('T')[0];

  const { data } = await client
    .from('tasks')
    .select('*, projects!inner(team_id)')
    .eq('projects.team_id', teamId)
    .is('parent_task_id', null)
    .neq('status', 'done')
    .gte('due_date', today)
    .lte('due_date', futureDate)
    .order('due_date');
  return data ?? [];
}

export async function getInboxTasks(client: Client, teamId: string): Promise<Task[]> {
  const { data } = await client
    .from('tasks')
    .select('*, projects!inner(team_id, is_inbox)')
    .eq('projects.team_id', teamId)
    .eq('projects.is_inbox', true)
    .is('parent_task_id', null)
    .neq('status', 'done')
    .order('created_at', { ascending: false });
  return data ?? [];
}

export async function getSubtasks(client: Client, parentTaskId: string): Promise<Task[]> {
  const { data } = await client
    .from('tasks')
    .select('*')
    .eq('parent_task_id', parentTaskId)
    .order('sort_order');
  return data ?? [];
}

export async function getScheduledTasks(client: Client, teamId: string, date?: string): Promise<Task[]> {
  const targetDate = date ?? todayDate();
  const { data } = await client
    .from('tasks')
    .select('*, projects!inner(team_id)')
    .eq('projects.team_id', teamId)
    .eq('scheduled_date', targetDate)
    .neq('status', 'done')
    .not('scheduled_time', 'is', null)
    .order('scheduled_time');
  return data ?? [];
}

// ── Mutations ────────────────────────────────────────────────

export async function createTask(client: Client, task: TaskInsert): Promise<Task> {
  const { data, error } = await client
    .from('tasks')
    .insert(task)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateTask(client: Client, taskId: string, updates: TaskUpdate): Promise<Task> {
  // Auto-set completed_at when marking done
  if (updates.status === 'done' && !updates.completed_at) {
    updates.completed_at = new Date().toISOString();
  }
  // Clear completed_at when un-completing
  if (updates.status && updates.status !== 'done') {
    updates.completed_at = null;
  }

  const { data, error } = await client
    .from('tasks')
    .update(updates)
    .eq('id', taskId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function deleteTask(client: Client, taskId: string): Promise<void> {
  const { error } = await client
    .from('tasks')
    .delete()
    .eq('id', taskId);
  if (error) throw error;
}

export async function completeTask(client: Client, taskId: string): Promise<Task> {
  return updateTask(client, taskId, {
    status: 'done',
    completed_at: new Date().toISOString(),
  });
}

export async function moveTaskToProject(client: Client, taskId: string, projectId: string): Promise<Task> {
  return updateTask(client, taskId, { project_id: projectId });
}

export async function reorderTasks(client: Client, orderedIds: string[]): Promise<void> {
  const updates = orderedIds.map((id, index) =>
    client.from('tasks').update({ sort_order: index }).eq('id', id)
  );
  await Promise.all(updates);
}

// ── Auto-roll (move overdue scheduled tasks to today) ────────

export async function autoRollTasks(client: Client, teamId: string): Promise<number> {
  const today = todayDate();
  const { data } = await client
    .from('tasks')
    .select('id, projects!inner(team_id)')
    .eq('projects.team_id', teamId)
    .neq('status', 'done')
    .lt('scheduled_date', today);

  if (!data || data.length === 0) return 0;

  const ids = data.map((t: any) => t.id);
  await client
    .from('tasks')
    .update({ scheduled_date: today, scheduled_time: null })
    .in('id', ids);

  return ids.length;
}
