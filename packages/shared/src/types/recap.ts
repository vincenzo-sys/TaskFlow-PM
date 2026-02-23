import type { Database } from './database.js';

export type RecapEntryType = Database['public']['Enums']['recap_entry_type'];
export type RecapPeriod = Database['public']['Enums']['recap_period'];

export type RecapEntry = Database['public']['Tables']['recap_entries']['Row'];
export type RecapEntryInsert = Database['public']['Tables']['recap_entries']['Insert'];

export type SavedRecap = Database['public']['Tables']['saved_recaps']['Row'];
export type SavedRecapInsert = Database['public']['Tables']['saved_recaps']['Insert'];

export interface RecapStats {
  tasksCompleted: number;
  timeMinutes: number;
  accomplishments: number;
  decisions: number;
  notes: number;
  learnings: number;
}
