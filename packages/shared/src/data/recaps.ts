import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../types/database.js';
import type { RecapEntry, RecapEntryInsert, SavedRecap, SavedRecapInsert } from '../types/recap.js';

type Client = SupabaseClient<Database>;

// ── Recap Entries ────────────────────────────────────────────

export async function getRecapEntries(
  client: Client,
  teamId: string,
  opts?: { startDate?: string; endDate?: string }
): Promise<(RecapEntry & { tags: string[] })[]> {
  let query = client
    .from('recap_entries')
    .select('*, recap_entry_tags(tag)')
    .eq('team_id', teamId)
    .order('date', { ascending: false })
    .order('created_at', { ascending: false });

  if (opts?.startDate) query = query.gte('date', opts.startDate);
  if (opts?.endDate) query = query.lte('date', opts.endDate);

  const { data } = await query;
  return (data ?? []).map((entry: any) => ({
    ...entry,
    tags: (entry.recap_entry_tags ?? []).map((t: any) => t.tag),
    recap_entry_tags: undefined,
  }));
}

export async function getRecapEntryById(
  client: Client,
  entryId: string
): Promise<(RecapEntry & { tags: string[] }) | null> {
  const { data } = await client
    .from('recap_entries')
    .select('*, recap_entry_tags(tag)')
    .eq('id', entryId)
    .single();

  if (!data) return null;
  return {
    ...(data as any),
    tags: ((data as any).recap_entry_tags ?? []).map((t: any) => t.tag),
    recap_entry_tags: undefined,
  };
}

export async function createRecapEntry(
  client: Client,
  entry: RecapEntryInsert,
  tags?: string[]
): Promise<RecapEntry> {
  const { data, error } = await client
    .from('recap_entries')
    .insert(entry)
    .select()
    .single();
  if (error) throw error;

  if (tags && tags.length > 0) {
    const tagRows = tags.map(tag => ({ recap_entry_id: data.id, tag }));
    await client.from('recap_entry_tags').insert(tagRows);
  }

  return data;
}

export async function deleteRecapEntry(client: Client, entryId: string): Promise<void> {
  const { error } = await client
    .from('recap_entries')
    .delete()
    .eq('id', entryId);
  if (error) throw error;
}

// ── Saved Recaps ─────────────────────────────────────────────

export async function getSavedRecaps(client: Client, teamId: string): Promise<SavedRecap[]> {
  const { data } = await client
    .from('saved_recaps')
    .select('*')
    .eq('team_id', teamId)
    .order('saved_at', { ascending: false });
  return data ?? [];
}

export async function getSavedRecapById(client: Client, recapId: string): Promise<SavedRecap | null> {
  const { data } = await client
    .from('saved_recaps')
    .select('*')
    .eq('id', recapId)
    .single();
  return data;
}

export async function createSavedRecap(client: Client, recap: SavedRecapInsert): Promise<SavedRecap> {
  const { data, error } = await client
    .from('saved_recaps')
    .insert(recap)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function deleteSavedRecap(client: Client, recapId: string): Promise<void> {
  const { error } = await client
    .from('saved_recaps')
    .delete()
    .eq('id', recapId);
  if (error) throw error;
}
