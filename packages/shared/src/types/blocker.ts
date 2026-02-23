import type { Database } from './database.js';

export type BlockerType = Database['public']['Enums']['blocker_type'];
export type BlockerInfo = Database['public']['Tables']['blocker_info']['Row'];
export type BlockerInfoInsert = Database['public']['Tables']['blocker_info']['Insert'];
export type BlockerInfoUpdate = Database['public']['Tables']['blocker_info']['Update'];

export type BlockerNote = Database['public']['Tables']['blocker_notes']['Row'];
export type BlockerNoteInsert = Database['public']['Tables']['blocker_notes']['Insert'];

export interface BlockerWithNotes extends BlockerInfo {
  notes: BlockerNote[];
}
