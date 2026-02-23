// Auto-generated types placeholder — replace with `supabase gen types typescript` output
// once the Supabase project is created and schema is deployed.
//
// For now, these manual types match the 001_schema.sql migration exactly.

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  public: {
    Tables: {
      teams: {
        Row: {
          id: string;
          name: string;
          slug: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          slug: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          slug?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      profiles: {
        Row: {
          id: string;
          display_name: string;
          email: string | null;
          avatar_url: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          display_name?: string;
          email?: string | null;
          avatar_url?: string | null;
        };
        Update: {
          display_name?: string;
          email?: string | null;
          avatar_url?: string | null;
        };
        Relationships: [];
      };
      team_members: {
        Row: {
          team_id: string;
          user_id: string;
          role: 'owner' | 'admin' | 'member';
          joined_at: string;
        };
        Insert: {
          team_id: string;
          user_id: string;
          role?: 'owner' | 'admin' | 'member';
        };
        Update: {
          role?: 'owner' | 'admin' | 'member';
        };
        Relationships: [
          { foreignKeyName: 'team_members_team_id_fkey'; columns: ['team_id']; referencedRelation: 'teams'; referencedColumns: ['id'] },
          { foreignKeyName: 'team_members_user_id_fkey'; columns: ['user_id']; referencedRelation: 'profiles'; referencedColumns: ['id'] },
        ];
      };
      categories: {
        Row: {
          id: string;
          team_id: string;
          name: string;
          color: string;
          sort_order: number;
          collapsed: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          team_id: string;
          name: string;
          color?: string;
          sort_order?: number;
          collapsed?: boolean;
        };
        Update: {
          name?: string;
          color?: string;
          sort_order?: number;
          collapsed?: boolean;
        };
        Relationships: [
          { foreignKeyName: 'categories_team_id_fkey'; columns: ['team_id']; referencedRelation: 'teams'; referencedColumns: ['id'] },
        ];
      };
      tags: {
        Row: {
          id: string;
          team_id: string;
          name: string;
          color: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          team_id: string;
          name: string;
          color?: string;
        };
        Update: {
          name?: string;
          color?: string;
        };
        Relationships: [
          { foreignKeyName: 'tags_team_id_fkey'; columns: ['team_id']; referencedRelation: 'teams'; referencedColumns: ['id'] },
        ];
      };
      projects: {
        Row: {
          id: string;
          team_id: string;
          parent_project_id: string | null;
          category_id: string | null;
          name: string;
          description: string;
          color: string;
          is_inbox: boolean;
          status: 'active' | 'inactive' | 'archived';
          goal: string;
          working_directory: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          team_id: string;
          parent_project_id?: string | null;
          category_id?: string | null;
          name: string;
          description?: string;
          color?: string;
          is_inbox?: boolean;
          status?: 'active' | 'inactive' | 'archived';
          goal?: string;
          working_directory?: string | null;
        };
        Update: {
          parent_project_id?: string | null;
          category_id?: string | null;
          name?: string;
          description?: string;
          color?: string;
          is_inbox?: boolean;
          status?: 'active' | 'inactive' | 'archived';
          goal?: string;
          working_directory?: string | null;
        };
        Relationships: [
          { foreignKeyName: 'projects_team_id_fkey'; columns: ['team_id']; referencedRelation: 'teams'; referencedColumns: ['id'] },
          { foreignKeyName: 'projects_category_id_fkey'; columns: ['category_id']; referencedRelation: 'categories'; referencedColumns: ['id'] },
        ];
      };
      tasks: {
        Row: {
          id: string;
          project_id: string;
          parent_task_id: string | null;
          name: string;
          description: string;
          context: string;
          work_notes: string | null;
          status: 'todo' | 'in-progress' | 'review' | 'waiting' | 'done';
          priority: 'none' | 'low' | 'medium' | 'high' | 'urgent';
          completed_at: string | null;
          due_date: string | null;
          scheduled_date: string | null;
          scheduled_time: string | null;
          start_date: string | null;
          end_date: string | null;
          estimated_minutes: number | null;
          complexity: number | null;
          execution_type: 'ai' | 'manual' | 'hybrid';
          assigned_to: string | null;
          assignee_name: string | null;
          waiting_reason: string | null;
          sort_order: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          project_id: string;
          parent_task_id?: string | null;
          name: string;
          description?: string;
          context?: string;
          work_notes?: string | null;
          status?: 'todo' | 'in-progress' | 'review' | 'waiting' | 'done';
          priority?: 'none' | 'low' | 'medium' | 'high' | 'urgent';
          completed_at?: string | null;
          due_date?: string | null;
          scheduled_date?: string | null;
          scheduled_time?: string | null;
          start_date?: string | null;
          end_date?: string | null;
          estimated_minutes?: number | null;
          complexity?: number | null;
          execution_type?: 'ai' | 'manual' | 'hybrid';
          assigned_to?: string | null;
          assignee_name?: string | null;
          waiting_reason?: string | null;
          sort_order?: number;
        };
        Update: {
          project_id?: string;
          parent_task_id?: string | null;
          name?: string;
          description?: string;
          context?: string;
          work_notes?: string | null;
          status?: 'todo' | 'in-progress' | 'review' | 'waiting' | 'done';
          priority?: 'none' | 'low' | 'medium' | 'high' | 'urgent';
          completed_at?: string | null;
          due_date?: string | null;
          scheduled_date?: string | null;
          scheduled_time?: string | null;
          start_date?: string | null;
          end_date?: string | null;
          estimated_minutes?: number | null;
          complexity?: number | null;
          execution_type?: 'ai' | 'manual' | 'hybrid';
          assigned_to?: string | null;
          assignee_name?: string | null;
          waiting_reason?: string | null;
          sort_order?: number;
        };
        Relationships: [
          { foreignKeyName: 'tasks_project_id_fkey'; columns: ['project_id']; referencedRelation: 'projects'; referencedColumns: ['id'] },
          { foreignKeyName: 'tasks_parent_task_id_fkey'; columns: ['parent_task_id']; referencedRelation: 'tasks'; referencedColumns: ['id'] },
          { foreignKeyName: 'tasks_assigned_to_fkey'; columns: ['assigned_to']; referencedRelation: 'profiles'; referencedColumns: ['id'] },
        ];
      };
      task_tags: {
        Row: { task_id: string; tag_id: string };
        Insert: { task_id: string; tag_id: string };
        Update: { task_id?: string; tag_id?: string };
        Relationships: [
          { foreignKeyName: 'task_tags_task_id_fkey'; columns: ['task_id']; referencedRelation: 'tasks'; referencedColumns: ['id'] },
          { foreignKeyName: 'task_tags_tag_id_fkey'; columns: ['tag_id']; referencedRelation: 'tags'; referencedColumns: ['id'] },
        ];
      };
      task_dependencies: {
        Row: { blocked_task_id: string; blocking_task_id: string; created_at: string };
        Insert: { blocked_task_id: string; blocking_task_id: string };
        Update: { blocked_task_id?: string; blocking_task_id?: string };
        Relationships: [
          { foreignKeyName: 'task_dependencies_blocked_task_id_fkey'; columns: ['blocked_task_id']; referencedRelation: 'tasks'; referencedColumns: ['id'] },
          { foreignKeyName: 'task_dependencies_blocking_task_id_fkey'; columns: ['blocking_task_id']; referencedRelation: 'tasks'; referencedColumns: ['id'] },
        ];
      };
      blocker_info: {
        Row: {
          id: string;
          task_id: string;
          blocker_type: 'person' | 'external' | 'technical' | 'decision' | 'other';
          description: string;
          follow_up_date: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          task_id: string;
          blocker_type?: 'person' | 'external' | 'technical' | 'decision' | 'other';
          description?: string;
          follow_up_date?: string | null;
        };
        Update: {
          blocker_type?: 'person' | 'external' | 'technical' | 'decision' | 'other';
          description?: string;
          follow_up_date?: string | null;
        };
        Relationships: [
          { foreignKeyName: 'blocker_info_task_id_fkey'; columns: ['task_id']; referencedRelation: 'tasks'; referencedColumns: ['id'] },
        ];
      };
      blocker_notes: {
        Row: {
          id: string;
          blocker_info_id: string;
          note: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          blocker_info_id: string;
          note: string;
        };
        Update: {
          note?: string;
        };
        Relationships: [
          { foreignKeyName: 'blocker_notes_blocker_info_id_fkey'; columns: ['blocker_info_id']; referencedRelation: 'blocker_info'; referencedColumns: ['id'] },
        ];
      };
      time_logs: {
        Row: {
          id: string;
          task_id: string;
          user_id: string | null;
          minutes: number;
          notes: string;
          logged_at: string;
        };
        Insert: {
          id?: string;
          task_id: string;
          user_id?: string | null;
          minutes: number;
          notes?: string;
          logged_at?: string;
        };
        Update: {
          minutes?: number;
          notes?: string;
        };
        Relationships: [
          { foreignKeyName: 'time_logs_task_id_fkey'; columns: ['task_id']; referencedRelation: 'tasks'; referencedColumns: ['id'] },
        ];
      };
      task_learnings: {
        Row: {
          id: string;
          task_id: string;
          learning: string;
          added_at: string;
        };
        Insert: {
          id?: string;
          task_id: string;
          learning: string;
        };
        Update: {
          learning?: string;
        };
        Relationships: [
          { foreignKeyName: 'task_learnings_task_id_fkey'; columns: ['task_id']; referencedRelation: 'tasks'; referencedColumns: ['id'] },
        ];
      };
      task_files: {
        Row: {
          id: string;
          task_id: string;
          file_path: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          task_id: string;
          file_path: string;
        };
        Update: {
          file_path?: string;
        };
        Relationships: [
          { foreignKeyName: 'task_files_task_id_fkey'; columns: ['task_id']; referencedRelation: 'tasks'; referencedColumns: ['id'] },
        ];
      };
      notebooks: {
        Row: {
          id: string;
          project_id: string;
          title: string;
          content: string;
          icon: string;
          pinned: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          project_id: string;
          title?: string;
          content?: string;
          icon?: string;
          pinned?: boolean;
        };
        Update: {
          title?: string;
          content?: string;
          icon?: string;
          pinned?: boolean;
        };
        Relationships: [
          { foreignKeyName: 'notebooks_project_id_fkey'; columns: ['project_id']; referencedRelation: 'projects'; referencedColumns: ['id'] },
        ];
      };
      launchers: {
        Row: {
          id: string;
          project_id: string;
          name: string;
          memory: string;
          prompt: string;
          output_dir: string;
          flags: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          project_id: string;
          name?: string;
          memory?: string;
          prompt?: string;
          output_dir?: string;
          flags?: string;
        };
        Update: {
          name?: string;
          memory?: string;
          prompt?: string;
          output_dir?: string;
          flags?: string;
        };
        Relationships: [
          { foreignKeyName: 'launchers_project_id_fkey'; columns: ['project_id']; referencedRelation: 'projects'; referencedColumns: ['id'] },
        ];
      };
      recap_entries: {
        Row: {
          id: string;
          team_id: string;
          user_id: string | null;
          entry_type: 'accomplishment' | 'decision' | 'note';
          content: string;
          date: string;
          related_task_id: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          team_id: string;
          user_id?: string | null;
          entry_type: 'accomplishment' | 'decision' | 'note';
          content: string;
          date?: string;
          related_task_id?: string | null;
        };
        Update: {
          entry_type?: 'accomplishment' | 'decision' | 'note';
          content?: string;
          date?: string;
          related_task_id?: string | null;
        };
        Relationships: [
          { foreignKeyName: 'recap_entries_team_id_fkey'; columns: ['team_id']; referencedRelation: 'teams'; referencedColumns: ['id'] },
        ];
      };
      recap_entry_tags: {
        Row: { id: string; recap_entry_id: string; tag: string };
        Insert: { id?: string; recap_entry_id: string; tag: string };
        Update: { tag?: string };
        Relationships: [
          { foreignKeyName: 'recap_entry_tags_recap_entry_id_fkey'; columns: ['recap_entry_id']; referencedRelation: 'recap_entries'; referencedColumns: ['id'] },
        ];
      };
      saved_recaps: {
        Row: {
          id: string;
          team_id: string;
          user_id: string | null;
          period: 'daily' | 'weekly' | 'monthly';
          period_label: string;
          start_date: string;
          end_date: string;
          content: string;
          stats: Json;
          saved_at: string;
        };
        Insert: {
          id?: string;
          team_id: string;
          user_id?: string | null;
          period: 'daily' | 'weekly' | 'monthly';
          period_label: string;
          start_date: string;
          end_date: string;
          content?: string;
          stats?: Json;
        };
        Update: {
          content?: string;
          stats?: Json;
        };
        Relationships: [
          { foreignKeyName: 'saved_recaps_team_id_fkey'; columns: ['team_id']; referencedRelation: 'teams'; referencedColumns: ['id'] },
        ];
      };
      user_preferences: {
        Row: {
          id: string;
          user_id: string;
          team_id: string;
          theme: string;
          default_view: string;
          font_scale: number;
          working_on_task_ids: string[];
          favorites: string[];
          project_view_prefs: Json;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          team_id: string;
          theme?: string;
          default_view?: string;
          font_scale?: number;
          working_on_task_ids?: string[];
          favorites?: string[];
          project_view_prefs?: Json;
        };
        Update: {
          theme?: string;
          default_view?: string;
          font_scale?: number;
          working_on_task_ids?: string[];
          favorites?: string[];
          project_view_prefs?: Json;
        };
        Relationships: [
          { foreignKeyName: 'user_preferences_user_id_fkey'; columns: ['user_id']; referencedRelation: 'profiles'; referencedColumns: ['id'] },
          { foreignKeyName: 'user_preferences_team_id_fkey'; columns: ['team_id']; referencedRelation: 'teams'; referencedColumns: ['id'] },
        ];
      };
    };
    Views: {};
    Functions: {};
    Enums: {
      task_status: 'todo' | 'in-progress' | 'review' | 'waiting' | 'done';
      task_priority: 'none' | 'low' | 'medium' | 'high' | 'urgent';
      execution_type: 'ai' | 'manual' | 'hybrid';
      project_status: 'active' | 'inactive' | 'archived';
      recap_period: 'daily' | 'weekly' | 'monthly';
      recap_entry_type: 'accomplishment' | 'decision' | 'note';
      team_role: 'owner' | 'admin' | 'member';
      blocker_type: 'person' | 'external' | 'technical' | 'decision' | 'other';
    };
    CompositeTypes: {};
  };
};
