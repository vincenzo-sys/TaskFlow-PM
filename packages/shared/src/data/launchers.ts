import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../types/database.js';
import type { Launcher, LauncherInsert, LauncherUpdate } from '../types/launcher.js';

type Client = SupabaseClient<Database>;

// ── Queries ──────────────────────────────────────────────────

export async function getLaunchersByProject(client: Client, projectId: string): Promise<Launcher[]> {
  const { data } = await client
    .from('launchers')
    .select('*')
    .eq('project_id', projectId)
    .order('created_at');
  return data ?? [];
}

export async function getLauncherById(client: Client, launcherId: string): Promise<Launcher | null> {
  const { data } = await client
    .from('launchers')
    .select('*')
    .eq('id', launcherId)
    .single();
  return data;
}

// ── Mutations ────────────────────────────────────────────────

export async function createLauncher(client: Client, launcher: LauncherInsert): Promise<Launcher> {
  const { data, error } = await client
    .from('launchers')
    .insert(launcher)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateLauncher(client: Client, launcherId: string, updates: LauncherUpdate): Promise<Launcher> {
  const { data, error } = await client
    .from('launchers')
    .update(updates)
    .eq('id', launcherId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function deleteLauncher(client: Client, launcherId: string): Promise<void> {
  const { error } = await client
    .from('launchers')
    .delete()
    .eq('id', launcherId);
  if (error) throw error;
}
