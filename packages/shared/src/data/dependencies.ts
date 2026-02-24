import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../types/database.js';

type Client = SupabaseClient<Database>;

type TaskDependency = Database['public']['Tables']['task_dependencies']['Row'];

// ── Queries ──────────────────────────────────────────────────

export async function getBlockedBy(
  client: Client,
  taskId: string
): Promise<Array<{ id: string; name: string; status: string }>> {
  const { data } = await client
    .from('task_dependencies')
    .select('blocking_task_id, tasks!task_dependencies_blocking_task_id_fkey(id, name, status)')
    .eq('blocked_task_id', taskId);
  return (data ?? []).map((d: any) => d.tasks).filter(Boolean);
}

export async function getBlocks(
  client: Client,
  taskId: string
): Promise<Array<{ id: string; name: string; status: string }>> {
  const { data } = await client
    .from('task_dependencies')
    .select('blocked_task_id, tasks!task_dependencies_blocked_task_id_fkey(id, name, status)')
    .eq('blocking_task_id', taskId);
  return (data ?? []).map((d: any) => d.tasks).filter(Boolean);
}

export async function getDependenciesForProject(
  client: Client,
  projectId: string
): Promise<TaskDependency[]> {
  const { data } = await client
    .from('task_dependencies')
    .select('*, tasks!task_dependencies_blocked_task_id_fkey(project_id)')
    .eq('tasks.project_id', projectId);
  return data ?? [];
}

// ── Mutations ────────────────────────────────────────────────

export async function addDependency(
  client: Client,
  blockedTaskId: string,
  blockingTaskId: string
): Promise<void> {
  const { error } = await client
    .from('task_dependencies')
    .insert({ blocked_task_id: blockedTaskId, blocking_task_id: blockingTaskId });
  if (error) throw error;
}

export async function removeDependency(
  client: Client,
  blockedTaskId: string,
  blockingTaskId: string
): Promise<void> {
  const { error } = await client
    .from('task_dependencies')
    .delete()
    .eq('blocked_task_id', blockedTaskId)
    .eq('blocking_task_id', blockingTaskId);
  if (error) throw error;
}

export async function setDependencies(
  client: Client,
  blockedTaskId: string,
  blockingTaskIds: string[]
): Promise<void> {
  // Remove existing
  await client.from('task_dependencies').delete().eq('blocked_task_id', blockedTaskId);
  // Insert new
  if (blockingTaskIds.length > 0) {
    const rows = blockingTaskIds.map(id => ({
      blocked_task_id: blockedTaskId,
      blocking_task_id: id,
    }));
    const { error } = await client.from('task_dependencies').insert(rows);
    if (error) throw error;
  }
}
