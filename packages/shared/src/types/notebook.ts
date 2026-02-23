import type { Database } from './database.js';

export type Notebook = Database['public']['Tables']['notebooks']['Row'];
export type NotebookInsert = Database['public']['Tables']['notebooks']['Insert'];
export type NotebookUpdate = Database['public']['Tables']['notebooks']['Update'];
