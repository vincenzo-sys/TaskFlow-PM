import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../types/database.js';
import type { Project, ProjectInsert, ProjectUpdate, ProjectWithCounts } from '../types/project.js';

type Client = SupabaseClient<Database>;

// ── Queries ──────────────────────────────────────────────────

export async function getProjectsByTeam(client: Client, teamId: string): Promise<Project[]> {
  const { data } = await client
    .from('projects')
    .select('*')
    .eq('team_id', teamId)
    .order('is_inbox', { ascending: false })
    .order('name');
  return data ?? [];
}

export async function getProjectById(client: Client, projectId: string): Promise<Project | null> {
  const { data } = await client
    .from('projects')
    .select('*')
    .eq('id', projectId)
    .single();
  return data;
}

export async function getInboxProject(client: Client, teamId: string): Promise<Project | null> {
  const { data } = await client
    .from('projects')
    .select('*')
    .eq('team_id', teamId)
    .eq('is_inbox', true)
    .single();
  return data;
}

export async function getProjectsWithCounts(client: Client, teamId: string): Promise<ProjectWithCounts[]> {
  const projects = await getProjectsByTeam(client, teamId);

  const counts = await Promise.all(
    projects.map(async (p) => {
      const [total, done, overdue] = await Promise.all([
        client.from('tasks').select('id', { count: 'exact', head: true })
          .eq('project_id', p.id).is('parent_task_id', null),
        client.from('tasks').select('id', { count: 'exact', head: true })
          .eq('project_id', p.id).is('parent_task_id', null).eq('status', 'done'),
        client.from('tasks').select('id', { count: 'exact', head: true })
          .eq('project_id', p.id).is('parent_task_id', null).neq('status', 'done')
          .lt('due_date', new Date().toISOString().split('T')[0]),
      ]);
      return {
        ...p,
        task_count: total.count ?? 0,
        done_count: done.count ?? 0,
        overdue_count: overdue.count ?? 0,
      };
    })
  );

  return counts;
}

// ── Mutations ────────────────────────────────────────────────

export async function createProject(client: Client, project: ProjectInsert): Promise<Project> {
  const { data, error } = await client
    .from('projects')
    .insert(project)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateProject(client: Client, projectId: string, updates: ProjectUpdate): Promise<Project> {
  const { data, error } = await client
    .from('projects')
    .update(updates)
    .eq('id', projectId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function deleteProject(client: Client, projectId: string): Promise<void> {
  const { error } = await client
    .from('projects')
    .delete()
    .eq('id', projectId);
  if (error) throw error;
}
