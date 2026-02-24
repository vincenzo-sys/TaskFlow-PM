import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../types/database.js';
import type { Team, TeamMember, TeamRole } from '../types/team.js';

type Client = SupabaseClient<Database>;

// ── Queries ──────────────────────────────────────────────────

export async function getTeamsForUser(client: Client, userId: string): Promise<Team[]> {
  const { data } = await client
    .from('team_members')
    .select('teams(*)')
    .eq('user_id', userId);

  return (data ?? []).map((row: any) => row.teams).filter(Boolean);
}

export async function getUserTeamMembership(
  client: Client,
  userId: string
): Promise<{ team: Team; role: TeamRole } | null> {
  const { data } = await client
    .from('team_members')
    .select('role, teams(*)')
    .eq('user_id', userId)
    .limit(1)
    .single();

  if (!data) return null;
  return {
    team: (data as any).teams as Team,
    role: data.role,
  };
}

export async function getTeamMembers(client: Client, teamId: string): Promise<TeamMember[]> {
  const { data } = await client
    .from('team_members')
    .select('*')
    .eq('team_id', teamId);
  return data ?? [];
}

// ── Mutations ────────────────────────────────────────────────

export async function createTeamWithOwner(
  client: Client,
  opts: { name: string; slug: string; userId: string }
): Promise<{ team: Team; membership: TeamMember }> {
  // Create team
  const { data: team, error: teamError } = await client
    .from('teams')
    .insert({ name: opts.name, slug: opts.slug })
    .select()
    .single();
  if (teamError) throw teamError;

  // Add owner membership
  const { data: membership, error: memberError } = await client
    .from('team_members')
    .insert({ team_id: team.id, user_id: opts.userId, role: 'owner' })
    .select()
    .single();
  if (memberError) throw memberError;

  // Create default preferences
  await client
    .from('user_preferences')
    .insert({ user_id: opts.userId, team_id: team.id });

  return { team, membership };
}
