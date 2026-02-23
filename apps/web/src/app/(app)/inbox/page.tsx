import { getSupabaseServerClient } from '@/lib/supabase/server';
import { from } from '@/lib/supabase/typed-client';
import { InboxView } from './inbox-view';
import type { Task } from '@taskflow/shared/types';

export default async function InboxPage() {
  const supabase = await getSupabaseServerClient();

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

  // Inbox tasks
  const { data: inboxTasks } = await from(supabase, 'tasks')
    .select('*, projects!inner(team_id, is_inbox)')
    .eq('projects.team_id', teamId)
    .eq('projects.is_inbox', true)
    .is('parent_task_id', null)
    .neq('status', 'done')
    .order('created_at', { ascending: false });

  // All projects for move-to
  const { data: projects } = await from(supabase, 'projects')
    .select('id, name, color')
    .eq('team_id', teamId)
    .eq('status', 'active')
    .order('name');

  return (
    <InboxView
      tasks={(inboxTasks ?? []) as Task[]}
      projects={(projects ?? []) as Array<{ id: string; name: string; color: string }>}
    />
  );
}
