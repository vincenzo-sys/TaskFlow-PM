'use client';

import type { Task } from '@taskflow/shared/types';

const EXEC_BORDER: Record<string, string> = {
  ai: 'border-l-exec-ai',
  manual: 'border-l-exec-manual',
  hybrid: 'border-l-exec-hybrid',
};

interface ActiveTaskCardProps {
  task: Task;
  subtasks?: Task[];
  onComplete: (taskId: string) => void;
  onRemoveActive: (taskId: string) => void;
  onToggleSubtask?: (subtaskId: string, done: boolean) => void;
}

export function ActiveTaskCard({
  task,
  subtasks = [],
  onComplete,
  onRemoveActive,
  onToggleSubtask,
}: ActiveTaskCardProps) {
  const borderColor = EXEC_BORDER[task.execution_type] ?? 'border-l-accent';

  return (
    <div className={`rounded-lg border border-paper-300 bg-white shadow-sm ${borderColor} border-l-[3px]`}>
      <div className="px-4 py-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <h3 className="text-sm font-semibold text-paper-900">{task.name}</h3>
            {task.description && (
              <p className="mt-0.5 text-xs text-paper-500 line-clamp-2">{task.description}</p>
            )}
          </div>

          <div className="flex items-center gap-1 flex-shrink-0">
            <button
              onClick={() => onComplete(task.id)}
              className="rounded-lg bg-green-50 px-2.5 py-1.5 text-xs font-medium text-green-700 hover:bg-green-100 transition-colors"
            >
              Done
            </button>
            <button
              onClick={() => onRemoveActive(task.id)}
              className="rounded-lg px-2 py-1.5 text-xs text-paper-400 hover:bg-paper-100 hover:text-paper-600 transition-colors"
              title="Remove from active"
            >
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Subtasks */}
        {subtasks.length > 0 && (
          <div className="mt-3 space-y-1.5 border-t border-paper-200 pt-2.5">
            {subtasks.map((sub) => (
              <label
                key={sub.id}
                className="flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 text-xs hover:bg-paper-50"
              >
                <input
                  type="checkbox"
                  checked={sub.status === 'done'}
                  onChange={(e) => onToggleSubtask?.(sub.id, e.target.checked)}
                  className="h-3.5 w-3.5 rounded border-paper-400 text-accent focus:ring-accent"
                />
                <span className={sub.status === 'done' ? 'text-paper-400 line-through' : 'text-paper-700'}>
                  {sub.name}
                </span>
              </label>
            ))}
          </div>
        )}

        {/* Meta */}
        <div className="mt-2 flex items-center gap-3 text-[11px] text-paper-400">
          {task.estimated_minutes && <span>{task.estimated_minutes}m est.</span>}
          <span className="capitalize">{task.execution_type}</span>
          {task.priority !== 'none' && <span className="capitalize">{task.priority}</span>}
        </div>
      </div>
    </div>
  );
}
