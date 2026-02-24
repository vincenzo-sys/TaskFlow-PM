import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../types/database.js';
import type { Notebook, NotebookInsert, NotebookUpdate } from '../types/notebook.js';

type Client = SupabaseClient<Database>;

// ── Queries ──────────────────────────────────────────────────

export async function getNotebooksByProject(client: Client, projectId: string): Promise<Notebook[]> {
  const { data } = await client
    .from('notebooks')
    .select('*')
    .eq('project_id', projectId)
    .order('pinned', { ascending: false })
    .order('updated_at', { ascending: false });
  return data ?? [];
}

export async function getNotebookById(client: Client, notebookId: string): Promise<Notebook | null> {
  const { data } = await client
    .from('notebooks')
    .select('*')
    .eq('id', notebookId)
    .single();
  return data;
}

// ── Mutations ────────────────────────────────────────────────

export async function createNotebook(client: Client, notebook: NotebookInsert): Promise<Notebook> {
  const { data, error } = await client
    .from('notebooks')
    .insert(notebook)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateNotebook(client: Client, notebookId: string, updates: NotebookUpdate): Promise<Notebook> {
  const { data, error } = await client
    .from('notebooks')
    .update(updates)
    .eq('id', notebookId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function deleteNotebook(client: Client, notebookId: string): Promise<void> {
  const { error } = await client
    .from('notebooks')
    .delete()
    .eq('id', notebookId);
  if (error) throw error;
}

export async function appendToNotebook(client: Client, notebookId: string, text: string): Promise<Notebook> {
  const existing = await getNotebookById(client, notebookId);
  if (!existing) throw new Error(`Notebook ${notebookId} not found`);
  const newContent = existing.content ? `${existing.content}\n${text}` : text;
  return updateNotebook(client, notebookId, { content: newContent });
}
