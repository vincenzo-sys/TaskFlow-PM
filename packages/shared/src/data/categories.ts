import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../types/database.js';
import type { Category, CategoryInsert, CategoryUpdate } from '../types/category.js';

type Client = SupabaseClient<Database>;

// ── Queries ──────────────────────────────────────────────────

export async function getCategoriesByTeam(client: Client, teamId: string): Promise<Category[]> {
  const { data } = await client
    .from('categories')
    .select('*')
    .eq('team_id', teamId)
    .order('sort_order');
  return data ?? [];
}

export async function getCategoryById(client: Client, categoryId: string): Promise<Category | null> {
  const { data } = await client
    .from('categories')
    .select('*')
    .eq('id', categoryId)
    .single();
  return data;
}

// ── Mutations ────────────────────────────────────────────────

export async function createCategory(client: Client, category: CategoryInsert): Promise<Category> {
  const { data, error } = await client
    .from('categories')
    .insert(category)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateCategory(client: Client, categoryId: string, updates: CategoryUpdate): Promise<Category> {
  const { data, error } = await client
    .from('categories')
    .update(updates)
    .eq('id', categoryId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function deleteCategory(client: Client, categoryId: string): Promise<void> {
  const { error } = await client
    .from('categories')
    .delete()
    .eq('id', categoryId);
  if (error) throw error;
}

export async function reorderCategories(client: Client, orderedIds: string[]): Promise<void> {
  const updates = orderedIds.map((id, index) =>
    client.from('categories').update({ sort_order: index }).eq('id', id)
  );
  await Promise.all(updates);
}
