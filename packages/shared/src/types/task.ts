import type { Database } from './database.js';

type TaskRow = Database['public']['Tables']['tasks']['Row'];

export type TaskStatus = Database['public']['Enums']['task_status'];
export type TaskPriority = Database['public']['Enums']['task_priority'];
export type ExecutionType = Database['public']['Enums']['execution_type'];

export type Task = TaskRow;

export type TaskInsert = Database['public']['Tables']['tasks']['Insert'];
export type TaskUpdate = Database['public']['Tables']['tasks']['Update'];

/** Task with all related data joined */
export interface TaskWithRelations extends Task {
  subtasks: Task[];
  tags: Array<{ id: string; name: string; color: string }>;
  blocked_by: Array<{ id: string; name: string; status: TaskStatus }>;
  blocks: Array<{ id: string; name: string; status: TaskStatus }>;
  blocker_info: {
    id: string;
    blocker_type: string;
    description: string;
    follow_up_date: string | null;
    notes: Array<{ id: string; note: string; created_at: string }>;
  } | null;
  time_logs: Array<{ id: string; minutes: number; notes: string; logged_at: string }>;
  learnings: Array<{ id: string; learning: string; added_at: string }>;
  file_paths: string[];
}

/** Lightweight task for list views */
export interface TaskSummary {
  id: string;
  name: string;
  status: TaskStatus;
  priority: TaskPriority;
  execution_type: ExecutionType;
  due_date: string | null;
  scheduled_date: string | null;
  estimated_minutes: number | null;
  assignee_name: string | null;
  subtask_count: number;
  subtask_done_count: number;
  has_blocker: boolean;
}
