import { getSupabaseServerClient } from '@/lib/supabase/server';
import { from } from '@/lib/supabase/typed-client';
import { TodayView } from './today-view';
import type { Task } from '@taskflow/shared/types';

export default async function TodayPage() {
  const supabase = await getSupabaseServerClient();
  const today = new Date().toISOString().split('T')[0];

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: membership } = await from(supabase, 'team_members')
    .select('team_id')
    .eq('user_id', user.id)
    .limit(1)
    .single();

  const teamId = membership?.team_id as string | undefined;
  if (!teamId) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center">
          <h2 className="text-lg font-semibold text-paper-800">No workspace found</h2>
          <p className="mt-1 text-sm text-paper-500">Create or join a workspace to get started.</p>
        </div>
      </div>
    );
  }

  // Fetch today's tasks
  const { data: todayTasks } = await from(supabase, 'tasks')
    .select('*, projects!inner(team_id)')
    .eq('projects.team_id', teamId)
    .is('parent_task_id', null)
    .neq('status', 'done')
    .or(`due_date.eq.${today},scheduled_date.eq.${today}`);

  // Completed today count
  const { count: completedCount } = await from(supabase, 'tasks')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'done')
    .gte('completed_at', `${today}T00:00:00`);

  // User preferences
  const { data: prefs } = await from(supabase, 'user_preferences')
    .select('working_on_task_ids')
    .eq('user_id', user.id)
    .eq('team_id', teamId)
    .maybeSingle();

  // Brain dumps
  const { data: brainDumps } = await from(supabase, 'tasks')
    .select('id, name, context, created_at, projects!inner(team_id, is_inbox)')
    .eq('projects.team_id', teamId)
    .eq('projects.is_inbox', true)
    .neq('context', '')
    .neq('status', 'done')
    .order('created_at', { ascending: false })
    .limit(5);

  return (
    <TodayView
      tasks={(todayTasks ?? []) as Task[]}
      completedCount={(completedCount ?? 0) as number}
      workingOnTaskIds={(prefs?.working_on_task_ids ?? []) as string[]}
      brainDumps={(brainDumps ?? []).map((b: any) => ({ id: b.id, name: b.name, context: b.context }))}
      teamId={teamId}
      userId={user.id}
    />
  );
}
