'use client';

import type { Task } from '@taskflow/shared/types';

const PRIORITY_COLORS: Record<string, string> = {
  urgent: 'border-l-priority-urgent',
  high: 'border-l-priority-high',
  medium: 'border-l-priority-medium',
  low: 'border-l-priority-low',
  none: 'border-l-paper-300',
};

const EXEC_BADGES: Record<string, { label: string; className: string }> = {
  ai: { label: 'AI', className: 'bg-exec-ai/10 text-exec-ai' },
  manual: { label: 'Manual', className: 'bg-exec-manual/10 text-exec-manual' },
  hybrid: { label: 'Hybrid', className: 'bg-exec-hybrid/10 text-exec-hybrid' },
};

interface TaskCardProps {
  task: Task;
  onComplete?: (taskId: string) => void;
  onSetActive?: (taskId: string) => void;
  isActive?: boolean;
  compact?: boolean;
}

export function TaskCard({ task, onComplete, onSetActive, isActive, compact }: TaskCardProps) {
  const priorityBorder = PRIORITY_COLORS[task.priority] ?? PRIORITY_COLORS.none;
  const execBadge = EXEC_BADGES[task.execution_type];

  return (
    <div
      className={`group rounded-lg border border-paper-300 bg-white transition-all ${priorityBorder} border-l-[3px] ${
        isActive ? 'ring-2 ring-accent/30 shadow-sm' : 'hover:shadow-sm'
      } ${compact ? 'px-3 py-2' : 'px-4 py-3'}`}
    >
      <div className="flex items-start gap-3">
        {/* Checkbox */}
        <button
          onClick={() => onComplete?.(task.id)}
          className="mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full border-2 border-paper-400 text-paper-400 transition-colors hover:border-green-500 hover:text-green-500"
          title="Complete task"
        >
          <svg className="h-3 w-3 opacity-0 group-hover:opacity-100 transition-opacity" fill="none" viewBox="0 0 24 24" strokeWidth={3} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
          </svg>
        </button>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className={`text-sm font-medium text-paper-800 ${compact ? '' : 'leading-snug'}`}>
              {task.name}
            </span>
            {execBadge && (
              <span className={`inline-flex rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${execBadge.className}`}>
                {execBadge.label}
              </span>
            )}
          </div>

          {!compact && task.description && (
            <p className="mt-0.5 text-xs text-paper-500 line-clamp-1">{task.description}</p>
          )}

          {/* Meta row */}
          <div className="mt-1.5 flex items-center gap-3 text-[11px] text-paper-400">
            {task.estimated_minutes && (
              <span>{task.estimated_minutes}m</span>
            )}
            {task.due_date && (
              <span>{task.due_date}</span>
            )}
            {task.priority !== 'none' && (
              <span className="capitalize">{task.priority}</span>
            )}
          </div>
        </div>

        {/* Actions */}
        {!isActive && onSetActive && (
          <button
            onClick={() => onSetActive(task.id)}
            className="flex-shrink-0 rounded px-2 py-1 text-xs font-medium text-paper-500 opacity-0 transition-opacity hover:bg-paper-100 hover:text-paper-700 group-hover:opacity-100"
          >
            Start
          </button>
        )}
      </div>
    </div>
  );
}
