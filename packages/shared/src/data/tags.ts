import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../types/database.js';
import type { Tag, TagInsert, TagUpdate } from '../types/tag.js';

type Client = SupabaseClient<Database>;

// ── Queries ──────────────────────────────────────────────────

export async function getTagsByTeam(client: Client, teamId: string): Promise<Tag[]> {
  const { data } = await client
    .from('tags')
    .select('*')
    .eq('team_id', teamId)
    .order('name');
  return data ?? [];
}

export async function getTagById(client: Client, tagId: string): Promise<Tag | null> {
  const { data } = await client
    .from('tags')
    .select('*')
    .eq('id', tagId)
    .single();
  return data;
}

export async function getTagsForTask(client: Client, taskId: string): Promise<Tag[]> {
  const { data } = await client
    .from('task_tags')
    .select('tags(*)')
    .eq('task_id', taskId);
  return (data ?? []).map((row: any) => row.tags).filter(Boolean);
}

// ── Mutations ────────────────────────────────────────────────

export async function createTag(client: Client, tag: TagInsert): Promise<Tag> {
  const { data, error } = await client
    .from('tags')
    .insert(tag)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateTag(client: Client, tagId: string, updates: TagUpdate): Promise<Tag> {
  const { data, error } = await client
    .from('tags')
    .update(updates)
    .eq('id', tagId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function deleteTag(client: Client, tagId: string): Promise<void> {
  const { error } = await client
    .from('tags')
    .delete()
    .eq('id', tagId);
  if (error) throw error;
}

// ── Task-Tag Junction ────────────────────────────────────────

export async function addTagToTask(client: Client, taskId: string, tagId: string): Promise<void> {
  const { error } = await client
    .from('task_tags')
    .insert({ task_id: taskId, tag_id: tagId });
  if (error) throw error;
}

export async function removeTagFromTask(client: Client, taskId: string, tagId: string): Promise<void> {
  const { error } = await client
    .from('task_tags')
    .delete()
    .eq('task_id', taskId)
    .eq('tag_id', tagId);
  if (error) throw error;
}

export async function setTaskTags(client: Client, taskId: string, tagIds: string[]): Promise<void> {
  // Remove existing tags
  await client.from('task_tags').delete().eq('task_id', taskId);
  // Insert new tags
  if (tagIds.length > 0) {
    const rows = tagIds.map(tagId => ({ task_id: taskId, tag_id: tagId }));
    const { error } = await client.from('task_tags').insert(rows);
    if (error) throw error;
  }
}
