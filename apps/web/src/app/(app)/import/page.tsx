import { getSupabaseServerClient } from '@/lib/supabase/server';
import { from } from '@/lib/supabase/typed-client';
import { ImportView } from './import-view';

export default async function ImportPage() {
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

  return <ImportView teamId={teamId} userId={user.id} />;
}
