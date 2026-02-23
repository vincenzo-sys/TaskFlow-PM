'use client';

import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';
import { from } from '@/lib/supabase/typed-client';
import { TaskCard } from '@/components/task-card';
import { ActiveTaskCard } from '@/components/active-task-card';
import { useToast } from '@/components/toast';
import type { Task } from '@taskflow/shared/types';

const PRIORITY_ORDER: Record<string, number> = {
  urgent: 0,
  high: 1,
  medium: 2,
  low: 3,
  none: 4,
};

interface TodayViewProps {
  tasks: Task[];
  completedCount: number;
  workingOnTaskIds: string[];
  brainDumps: Array<{ id: string; name: string; context: string }>;
  teamId: string;
  userId: string;
}

export function TodayView({
  tasks: initialTasks,
  completedCount: initialCompletedCount,
  workingOnTaskIds: initialWorkingOn,
  brainDumps,
  teamId,
  userId,
}: TodayViewProps) {
  const [tasks, setTasks] = useState(initialTasks);
  const [workingOnIds, setWorkingOnIds] = useState<string[]>(initialWorkingOn);
  const [completedCount, setCompletedCount] = useState(initialCompletedCount);
  const router = useRouter();
  const { showToast } = useToast();
  const supabase = getSupabaseBrowserClient();

  // Sort: active first, then by priority
  const sorted = [...tasks].sort((a, b) => {
    const aPri = PRIORITY_ORDER[a.priority] ?? 4;
    const bPri = PRIORITY_ORDER[b.priority] ?? 4;
    return aPri - bPri;
  });

  const activeTasks = sorted.filter((t) => workingOnIds.includes(t.id));
  const upNextTasks = sorted.filter((t) => !workingOnIds.includes(t.id));

  const saveWorkingOn = useCallback(async (ids: string[]) => {
    await from(supabase, 'user_preferences')
      .upsert({
        user_id: userId,
        team_id: teamId,
        working_on_task_ids: ids,
      }, { onConflict: 'user_id,team_id' });
  }, [supabase, userId, teamId]);

  const handleComplete = useCallback(async (taskId: string) => {
    const task = tasks.find((t) => t.id === taskId);
    if (!task) return;

    // Optimistic update
    setTasks((prev) => prev.filter((t) => t.id !== taskId));
    setWorkingOnIds((prev) => {
      const next = prev.filter((id) => id !== taskId);
      saveWorkingOn(next);
      return next;
    });
    setCompletedCount((c) => c + 1);
    showToast(`"${task.name}" completed`);

    await from(supabase, 'tasks')
      .update({ status: 'done', completed_at: new Date().toISOString() })
      .eq('id', taskId);
  }, [tasks, supabase, saveWorkingOn, showToast]);

  const handleSetActive = useCallback(async (taskId: string) => {
    setWorkingOnIds((prev) => {
      const next = [...prev, taskId];
      saveWorkingOn(next);
      return next;
    });
  }, [saveWorkingOn]);

  const handleRemoveActive = useCallback(async (taskId: string) => {
    setWorkingOnIds((prev) => {
      const next = prev.filter((id) => id !== taskId);
      saveWorkingOn(next);
      return next;
    });
  }, [saveWorkingOn]);

  return (
    <div className="flex h-full animate-fade-in">
      {/* Main queue */}
      <div className="flex-1 overflow-auto p-6">
        <h1 className="text-xl font-bold text-paper-900">Today</h1>

        {/* Active tasks */}
        {activeTasks.length > 0 && (
          <section className="mt-5">
            <h2 className="mb-2.5 text-xs font-semibold uppercase tracking-wider text-paper-400">
              Working on now
            </h2>
            <div className="space-y-2">
              {activeTasks.map((task) => (
                <ActiveTaskCard
                  key={task.id}
                  task={task}
                  onComplete={handleComplete}
                  onRemoveActive={handleRemoveActive}
                />
              ))}
            </div>
          </section>
        )}

        {/* Up next */}
        <section className="mt-6">
          <h2 className="mb-2.5 text-xs font-semibold uppercase tracking-wider text-paper-400">
            Up next {upNextTasks.length > 0 && <span className="text-paper-300">({upNextTasks.length})</span>}
          </h2>
          {upNextTasks.length === 0 ? (
            <div className="rounded-lg border border-dashed border-paper-300 py-8 text-center">
              <p className="text-sm text-paper-400">No more tasks for today</p>
            </div>
          ) : (
            <div className="space-y-1.5">
              {upNextTasks.map((task) => (
                <TaskCard
                  key={task.id}
                  task={task}
                  onComplete={handleComplete}
                  onSetActive={handleSetActive}
                />
              ))}
            </div>
          )}
        </section>
      </div>

      {/* Right sidebar */}
      <div className="w-72 flex-shrink-0 border-l border-paper-300 bg-paper-100 p-5 overflow-auto">
        {/* Stats */}
        <section>
          <h2 className="text-xs font-semibold uppercase tracking-wider text-paper-400">Stats</h2>
          <div className="mt-2 flex gap-4 text-sm">
            <div>
              <span className="text-lg font-bold text-paper-800">{tasks.length}</span>
              <span className="ml-1 text-paper-500">left</span>
            </div>
            <div>
              <span className="text-lg font-bold text-green-600">{completedCount}</span>
              <span className="ml-1 text-paper-500">done</span>
            </div>
          </div>
        </section>

        {/* Brain dumps */}
        {brainDumps.length > 0 && (
          <section className="mt-6">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-paper-400">Brain dumps</h2>
            <div className="mt-2 space-y-2">
              {brainDumps.map((dump) => (
                <div key={dump.id} className="rounded-lg bg-white p-3 text-xs text-paper-600 border border-paper-200">
                  <p className="font-medium text-paper-700 mb-0.5">{dump.name}</p>
                  <p className="line-clamp-2">{dump.context}</p>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
