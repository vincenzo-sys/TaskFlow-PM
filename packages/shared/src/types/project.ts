import type { Database } from './database.js';

export type ProjectStatus = Database['public']['Enums']['project_status'];
export type Project = Database['public']['Tables']['projects']['Row'];
export type ProjectInsert = Database['public']['Tables']['projects']['Insert'];
export type ProjectUpdate = Database['public']['Tables']['projects']['Update'];

export interface ProjectWithCounts extends Project {
  task_count: number;
  done_count: number;
  overdue_count: number;
}
