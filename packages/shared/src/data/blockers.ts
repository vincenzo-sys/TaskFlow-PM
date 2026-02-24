import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../types/database.js';
import type {
  BlockerInfo, BlockerInfoInsert, BlockerInfoUpdate,
  BlockerNote, BlockerNoteInsert, BlockerWithNotes,
} from '../types/blocker.js';

type Client = SupabaseClient<Database>;

// ── Queries ──────────────────────────────────────────────────

export async function getBlockerInfo(client: Client, taskId: string): Promise<BlockerWithNotes | null> {
  const { data } = await client
    .from('blocker_info')
    .select('*, blocker_notes(*)')
    .eq('task_id', taskId)
    .maybeSingle();

  if (!data) return null;
  return {
    ...(data as any),
    notes: ((data as any).blocker_notes ?? []) as BlockerNote[],
    blocker_notes: undefined,
  } as BlockerWithNotes;
}

// ── Blocker Info Mutations ───────────────────────────────────

export async function createBlockerInfo(client: Client, info: BlockerInfoInsert): Promise<BlockerInfo> {
  const { data, error } = await client
    .from('blocker_info')
    .insert(info)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateBlockerInfo(
  client: Client,
  blockerInfoId: string,
  updates: BlockerInfoUpdate
): Promise<BlockerInfo> {
  const { data, error } = await client
    .from('blocker_info')
    .update(updates)
    .eq('id', blockerInfoId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function deleteBlockerInfo(client: Client, blockerInfoId: string): Promise<void> {
  const { error } = await client
    .from('blocker_info')
    .delete()
    .eq('id', blockerInfoId);
  if (error) throw error;
}

// ── Blocker Notes Mutations ──────────────────────────────────

export async function addBlockerNote(client: Client, note: BlockerNoteInsert): Promise<BlockerNote> {
  const { data, error } = await client
    .from('blocker_notes')
    .insert(note)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function deleteBlockerNote(client: Client, noteId: string): Promise<void> {
  const { error } = await client
    .from('blocker_notes')
    .delete()
    .eq('id', noteId);
  if (error) throw error;
}
