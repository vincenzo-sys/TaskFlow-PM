import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../types/database.js';
import type { UserPreferences, UserPreferencesInsert, UserPreferencesUpdate } from '../types/preferences.js';

type Client = SupabaseClient<Database>;

// ── Queries ──────────────────────────────────────────────────

export async function getUserPreferences(
  client: Client,
  userId: string,
  teamId: string
): Promise<UserPreferences | null> {
  const { data } = await client
    .from('user_preferences')
    .select('*')
    .eq('user_id', userId)
    .eq('team_id', teamId)
    .maybeSingle();
  return data;
}

// ── Mutations ────────────────────────────────────────────────

export async function upsertUserPreferences(
  client: Client,
  prefs: UserPreferencesInsert
): Promise<UserPreferences> {
  const { data, error } = await client
    .from('user_preferences')
    .upsert(prefs, { onConflict: 'user_id,team_id' })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateUserPreferences(
  client: Client,
  userId: string,
  teamId: string,
  updates: UserPreferencesUpdate
): Promise<UserPreferences> {
  const { data, error } = await client
    .from('user_preferences')
    .update(updates)
    .eq('user_id', userId)
    .eq('team_id', teamId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateWorkingOnTaskIds(
  client: Client,
  userId: string,
  teamId: string,
  taskIds: string[]
): Promise<UserPreferences> {
  return updateUserPreferences(client, userId, teamId, {
    working_on_task_ids: taskIds,
  });
}
