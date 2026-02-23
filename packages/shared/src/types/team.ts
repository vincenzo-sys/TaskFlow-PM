import type { Database } from './database.js';

export type TeamRole = Database['public']['Enums']['team_role'];
export type Team = Database['public']['Tables']['teams']['Row'];
export type TeamInsert = Database['public']['Tables']['teams']['Insert'];

export type TeamMember = Database['public']['Tables']['team_members']['Row'];
export type Profile = Database['public']['Tables']['profiles']['Row'];

export interface TeamMemberWithProfile extends TeamMember {
  profile: Profile;
}
