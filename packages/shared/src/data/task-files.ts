import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../types/database.js';

type Client = SupabaseClient<Database>;

type TaskFile = Database['public']['Tables']['task_files']['Row'];

// ── Queries ──────────────────────────────────────────────────

export async function getFilesForTask(client: Client, taskId: string): Promise<string[]> {
  const { data } = await client
    .from('task_files')
    .select('file_path')
    .eq('task_id', taskId);
  return (data ?? []).map(f => f.file_path);
}

// ── Mutations ────────────────────────────────────────────────

export async function addFileToTask(client: Client, taskId: string, filePath: string): Promise<TaskFile> {
  const { data, error } = await client
    .from('task_files')
    .insert({ task_id: taskId, file_path: filePath })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function removeFileFromTask(client: Client, taskId: string, filePath: string): Promise<void> {
  const { error } = await client
    .from('task_files')
    .delete()
    .eq('task_id', taskId)
    .eq('file_path', filePath);
  if (error) throw error;
}

export async function setTaskFiles(client: Client, taskId: string, filePaths: string[]): Promise<void> {
  // Remove existing
  await client.from('task_files').delete().eq('task_id', taskId);
  // Insert new
  if (filePaths.length > 0) {
    const rows = filePaths.map(fp => ({ task_id: taskId, file_path: fp }));
    const { error } = await client.from('task_files').insert(rows);
    if (error) throw error;
  }
}
