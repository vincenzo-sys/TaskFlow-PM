'use client';

import { useState, useCallback } from 'react';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';
import { from } from '@/lib/supabase/typed-client';
import { useToast } from '@/components/toast';
import type { Task, TaskPriority } from '@taskflow/shared/types';

const PRIORITY_OPTIONS: { value: TaskPriority; label: string; color: string }[] = [
  { value: 'urgent', label: 'Urgent', color: 'bg-priority-urgent' },
  { value: 'high', label: 'High', color: 'bg-priority-high' },
  { value: 'medium', label: 'Medium', color: 'bg-priority-medium' },
  { value: 'low', label: 'Low', color: 'bg-priority-low' },
  { value: 'none', label: 'None', color: 'bg-paper-300' },
];

interface InboxViewProps {
  tasks: Task[];
  projects: Array<{ id: string; name: string; color: string }>;
}

export function InboxView({ tasks: initialTasks, projects }: InboxViewProps) {
  const [tasks, setTasks] = useState(initialTasks);
  const { showToast } = useToast();
  const supabase = getSupabaseBrowserClient();

  const handleSetPriority = useCallback(async (taskId: string, priority: TaskPriority) => {
    setTasks((prev) =>
      prev.map((t) => (t.id === taskId ? { ...t, priority } : t)),
    );
    await from(supabase, 'tasks').update({ priority }).eq('id', taskId);
  }, [supabase]);

  const handleMoveToProject = useCallback(async (taskId: string, projectId: string) => {
    const task = tasks.find((t) => t.id === taskId);
    const project = projects.find((p) => p.id === projectId);
    if (!task || !project) return;

    setTasks((prev) => prev.filter((t) => t.id !== taskId));
    showToast(`"${task.name}" moved to ${project.name}`);

    await from(supabase, 'tasks').update({ project_id: projectId }).eq('id', taskId);
  }, [tasks, projects, supabase, showToast]);

  const handleScheduleToday = useCallback(async (taskId: string) => {
    const today = new Date().toISOString().split('T')[0];
    const task = tasks.find((t) => t.id === taskId);
    if (!task) return;

    setTasks((prev) =>
      prev.map((t) => (t.id === taskId ? { ...t, scheduled_date: today } : t)),
    );
    showToast(`"${task.name}" scheduled for today`);

    await from(supabase, 'tasks').update({ scheduled_date: today }).eq('id', taskId);
  }, [tasks, supabase, showToast]);

  const handleDelete = useCallback(async (taskId: string) => {
    const task = tasks.find((t) => t.id === taskId);
    if (!task) return;

    setTasks((prev) => prev.filter((t) => t.id !== taskId));
    showToast(`"${task.name}" deleted`);

    await from(supabase, 'tasks').delete().eq('id', taskId);
  }, [tasks, supabase, showToast]);

  return (
    <div className="h-full overflow-auto p-6 animate-fade-in">
      <div className="mb-6 flex items-baseline justify-between">
        <h1 className="text-xl font-bold text-paper-900">Inbox</h1>
        <span className="text-sm text-paper-400">{tasks.length} items</span>
      </div>

      {tasks.length === 0 ? (
        <div className="rounded-lg border border-dashed border-paper-300 py-12 text-center">
          <p className="text-sm text-paper-400">Inbox is empty — all caught up!</p>
        </div>
      ) : (
        <div className="space-y-2">
          {tasks.map((task) => (
            <div
              key={task.id}
              className="group rounded-lg border border-paper-300 bg-white px-4 py-3 transition-all hover:shadow-sm"
            >
              <div className="flex items-start gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-paper-800">{task.name}</p>
                  {task.context && (
                    <p className="mt-0.5 text-xs text-paper-500 line-clamp-2">{task.context}</p>
                  )}
                  {task.description && !task.context && (
                    <p className="mt-0.5 text-xs text-paper-500 line-clamp-2">{task.description}</p>
                  )}
                  <div className="mt-2 text-[11px] text-paper-400">
                    {new Date(task.created_at).toLocaleDateString()}
                  </div>
                </div>

                {/* Quick actions */}
                <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                  {/* Priority */}
                  <select
                    value={task.priority}
                    onChange={(e) => handleSetPriority(task.id, e.target.value as TaskPriority)}
                    className="rounded border border-paper-200 bg-paper-50 px-1.5 py-1 text-xs text-paper-600"
                  >
                    {PRIORITY_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>

                  {/* Move to project */}
                  <select
                    defaultValue=""
                    onChange={(e) => {
                      if (e.target.value) handleMoveToProject(task.id, e.target.value);
                      e.target.value = '';
                    }}
                    className="rounded border border-paper-200 bg-paper-50 px-1.5 py-1 text-xs text-paper-600"
                  >
                    <option value="" disabled>
                      Move to...
                    </option>
                    {projects
                      .filter((p) => p.id !== (task as any).project_id)
                      .map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                  </select>

                  {/* Schedule today */}
                  <button
                    onClick={() => handleScheduleToday(task.id)}
                    className="rounded border border-paper-200 bg-paper-50 px-1.5 py-1 text-xs text-paper-600 hover:bg-accent/10 hover:text-accent"
                    title="Schedule for today"
                  >
                    Today
                  </button>

                  {/* Delete */}
                  <button
                    onClick={() => handleDelete(task.id)}
                    className="rounded border border-paper-200 bg-paper-50 px-1.5 py-1 text-xs text-red-400 hover:bg-red-50 hover:text-red-600"
                    title="Delete"
                  >
                    <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
                    </svg>
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
