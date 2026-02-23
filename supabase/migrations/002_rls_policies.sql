-- TaskFlow PM: Row Level Security policies
-- All team-scoped tables check membership via is_team_member()

-- ============================================================
-- HELPER FUNCTION: check team membership
-- ============================================================

CREATE OR REPLACE FUNCTION is_team_member(check_team_id UUID)
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM team_members
    WHERE team_id = check_team_id
      AND user_id = auth.uid()
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE;

CREATE OR REPLACE FUNCTION is_team_admin(check_team_id UUID)
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM team_members
    WHERE team_id = check_team_id
      AND user_id = auth.uid()
      AND role IN ('owner', 'admin')
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- ============================================================
-- ENABLE RLS on all tables
-- ============================================================

ALTER TABLE teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE team_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_dependencies ENABLE ROW LEVEL SECURITY;
ALTER TABLE blocker_info ENABLE ROW LEVEL SECURITY;
ALTER TABLE blocker_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE time_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_learnings ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE notebooks ENABLE ROW LEVEL SECURITY;
ALTER TABLE launchers ENABLE ROW LEVEL SECURITY;
ALTER TABLE recap_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE recap_entry_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE saved_recaps ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_preferences ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- PROFILES
-- ============================================================

-- Users can read any profile (needed for team member display)
CREATE POLICY profiles_select ON profiles
  FOR SELECT USING (true);

-- Users can only update their own profile
CREATE POLICY profiles_update ON profiles
  FOR UPDATE USING (id = auth.uid());

-- ============================================================
-- TEAMS
-- ============================================================

CREATE POLICY teams_select ON teams
  FOR SELECT USING (is_team_member(id));

CREATE POLICY teams_insert ON teams
  FOR INSERT WITH CHECK (true);  -- Anyone can create a team

CREATE POLICY teams_update ON teams
  FOR UPDATE USING (is_team_admin(id));

-- ============================================================
-- TEAM_MEMBERS
-- ============================================================

CREATE POLICY team_members_select ON team_members
  FOR SELECT USING (is_team_member(team_id));

CREATE POLICY team_members_insert ON team_members
  FOR INSERT WITH CHECK (
    -- Admins can invite, or user is adding themselves (team creation)
    is_team_admin(team_id) OR user_id = auth.uid()
  );

CREATE POLICY team_members_update ON team_members
  FOR UPDATE USING (is_team_admin(team_id));

CREATE POLICY team_members_delete ON team_members
  FOR DELETE USING (
    is_team_admin(team_id) OR user_id = auth.uid()
  );

-- ============================================================
-- CATEGORIES
-- ============================================================

CREATE POLICY categories_select ON categories
  FOR SELECT USING (is_team_member(team_id));

CREATE POLICY categories_insert ON categories
  FOR INSERT WITH CHECK (is_team_member(team_id));

CREATE POLICY categories_update ON categories
  FOR UPDATE USING (is_team_member(team_id));

CREATE POLICY categories_delete ON categories
  FOR DELETE USING (is_team_admin(team_id));

-- ============================================================
-- TAGS
-- ============================================================

CREATE POLICY tags_select ON tags
  FOR SELECT USING (is_team_member(team_id));

CREATE POLICY tags_insert ON tags
  FOR INSERT WITH CHECK (is_team_member(team_id));

CREATE POLICY tags_update ON tags
  FOR UPDATE USING (is_team_member(team_id));

CREATE POLICY tags_delete ON tags
  FOR DELETE USING (is_team_member(team_id));

-- ============================================================
-- PROJECTS
-- ============================================================

CREATE POLICY projects_select ON projects
  FOR SELECT USING (is_team_member(team_id));

CREATE POLICY projects_insert ON projects
  FOR INSERT WITH CHECK (is_team_member(team_id));

CREATE POLICY projects_update ON projects
  FOR UPDATE USING (is_team_member(team_id));

CREATE POLICY projects_delete ON projects
  FOR DELETE USING (is_team_admin(team_id));

-- ============================================================
-- TASKS (access through project → team)
-- ============================================================

CREATE POLICY tasks_select ON tasks
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM projects p
      WHERE p.id = tasks.project_id
        AND is_team_member(p.team_id)
    )
  );

CREATE POLICY tasks_insert ON tasks
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM projects p
      WHERE p.id = project_id
        AND is_team_member(p.team_id)
    )
  );

CREATE POLICY tasks_update ON tasks
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM projects p
      WHERE p.id = tasks.project_id
        AND is_team_member(p.team_id)
    )
  );

CREATE POLICY tasks_delete ON tasks
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM projects p
      WHERE p.id = tasks.project_id
        AND is_team_member(p.team_id)
    )
  );

-- ============================================================
-- TASK_TAGS (access through task → project → team)
-- ============================================================

CREATE POLICY task_tags_select ON task_tags
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM tasks t
      JOIN projects p ON p.id = t.project_id
      WHERE t.id = task_tags.task_id
        AND is_team_member(p.team_id)
    )
  );

CREATE POLICY task_tags_insert ON task_tags
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM tasks t
      JOIN projects p ON p.id = t.project_id
      WHERE t.id = task_id
        AND is_team_member(p.team_id)
    )
  );

CREATE POLICY task_tags_delete ON task_tags
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM tasks t
      JOIN projects p ON p.id = t.project_id
      WHERE t.id = task_tags.task_id
        AND is_team_member(p.team_id)
    )
  );

-- ============================================================
-- TASK_DEPENDENCIES (access through task → project → team)
-- ============================================================

CREATE POLICY task_deps_select ON task_dependencies
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM tasks t
      JOIN projects p ON p.id = t.project_id
      WHERE t.id = task_dependencies.blocked_task_id
        AND is_team_member(p.team_id)
    )
  );

CREATE POLICY task_deps_insert ON task_dependencies
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM tasks t
      JOIN projects p ON p.id = t.project_id
      WHERE t.id = blocked_task_id
        AND is_team_member(p.team_id)
    )
  );

CREATE POLICY task_deps_delete ON task_dependencies
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM tasks t
      JOIN projects p ON p.id = t.project_id
      WHERE t.id = task_dependencies.blocked_task_id
        AND is_team_member(p.team_id)
    )
  );

-- ============================================================
-- BLOCKER_INFO + BLOCKER_NOTES (through task → project → team)
-- ============================================================

CREATE POLICY blocker_info_select ON blocker_info
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM tasks t
      JOIN projects p ON p.id = t.project_id
      WHERE t.id = blocker_info.task_id
        AND is_team_member(p.team_id)
    )
  );

CREATE POLICY blocker_info_insert ON blocker_info
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM tasks t
      JOIN projects p ON p.id = t.project_id
      WHERE t.id = task_id
        AND is_team_member(p.team_id)
    )
  );

CREATE POLICY blocker_info_update ON blocker_info
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM tasks t
      JOIN projects p ON p.id = t.project_id
      WHERE t.id = blocker_info.task_id
        AND is_team_member(p.team_id)
    )
  );

CREATE POLICY blocker_info_delete ON blocker_info
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM tasks t
      JOIN projects p ON p.id = t.project_id
      WHERE t.id = blocker_info.task_id
        AND is_team_member(p.team_id)
    )
  );

CREATE POLICY blocker_notes_select ON blocker_notes
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM blocker_info bi
      JOIN tasks t ON t.id = bi.task_id
      JOIN projects p ON p.id = t.project_id
      WHERE bi.id = blocker_notes.blocker_info_id
        AND is_team_member(p.team_id)
    )
  );

CREATE POLICY blocker_notes_insert ON blocker_notes
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM blocker_info bi
      JOIN tasks t ON t.id = bi.task_id
      JOIN projects p ON p.id = t.project_id
      WHERE bi.id = blocker_info_id
        AND is_team_member(p.team_id)
    )
  );

CREATE POLICY blocker_notes_delete ON blocker_notes
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM blocker_info bi
      JOIN tasks t ON t.id = bi.task_id
      JOIN projects p ON p.id = t.project_id
      WHERE bi.id = blocker_notes.blocker_info_id
        AND is_team_member(p.team_id)
    )
  );

-- ============================================================
-- TIME_LOGS, TASK_LEARNINGS, TASK_FILES (through task → project → team)
-- ============================================================

CREATE POLICY time_logs_select ON time_logs
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM tasks t
      JOIN projects p ON p.id = t.project_id
      WHERE t.id = time_logs.task_id
        AND is_team_member(p.team_id)
    )
  );

CREATE POLICY time_logs_insert ON time_logs
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM tasks t
      JOIN projects p ON p.id = t.project_id
      WHERE t.id = task_id
        AND is_team_member(p.team_id)
    )
  );

CREATE POLICY time_logs_delete ON time_logs
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM tasks t
      JOIN projects p ON p.id = t.project_id
      WHERE t.id = time_logs.task_id
        AND is_team_member(p.team_id)
    )
  );

CREATE POLICY task_learnings_select ON task_learnings
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM tasks t
      JOIN projects p ON p.id = t.project_id
      WHERE t.id = task_learnings.task_id
        AND is_team_member(p.team_id)
    )
  );

CREATE POLICY task_learnings_insert ON task_learnings
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM tasks t
      JOIN projects p ON p.id = t.project_id
      WHERE t.id = task_id
        AND is_team_member(p.team_id)
    )
  );

CREATE POLICY task_learnings_delete ON task_learnings
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM tasks t
      JOIN projects p ON p.id = t.project_id
      WHERE t.id = task_learnings.task_id
        AND is_team_member(p.team_id)
    )
  );

CREATE POLICY task_files_select ON task_files
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM tasks t
      JOIN projects p ON p.id = t.project_id
      WHERE t.id = task_files.task_id
        AND is_team_member(p.team_id)
    )
  );

CREATE POLICY task_files_insert ON task_files
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM tasks t
      JOIN projects p ON p.id = t.project_id
      WHERE t.id = task_id
        AND is_team_member(p.team_id)
    )
  );

CREATE POLICY task_files_delete ON task_files
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM tasks t
      JOIN projects p ON p.id = t.project_id
      WHERE t.id = task_files.task_id
        AND is_team_member(p.team_id)
    )
  );

-- ============================================================
-- NOTEBOOKS + LAUNCHERS (through project → team)
-- ============================================================

CREATE POLICY notebooks_select ON notebooks
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM projects p
      WHERE p.id = notebooks.project_id
        AND is_team_member(p.team_id)
    )
  );

CREATE POLICY notebooks_insert ON notebooks
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM projects p
      WHERE p.id = project_id
        AND is_team_member(p.team_id)
    )
  );

CREATE POLICY notebooks_update ON notebooks
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM projects p
      WHERE p.id = notebooks.project_id
        AND is_team_member(p.team_id)
    )
  );

CREATE POLICY notebooks_delete ON notebooks
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM projects p
      WHERE p.id = notebooks.project_id
        AND is_team_member(p.team_id)
    )
  );

CREATE POLICY launchers_select ON launchers
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM projects p
      WHERE p.id = launchers.project_id
        AND is_team_member(p.team_id)
    )
  );

CREATE POLICY launchers_insert ON launchers
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM projects p
      WHERE p.id = project_id
        AND is_team_member(p.team_id)
    )
  );

CREATE POLICY launchers_update ON launchers
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM projects p
      WHERE p.id = launchers.project_id
        AND is_team_member(p.team_id)
    )
  );

CREATE POLICY launchers_delete ON launchers
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM projects p
      WHERE p.id = launchers.project_id
        AND is_team_member(p.team_id)
    )
  );

-- ============================================================
-- RECAP_ENTRIES + RECAP_ENTRY_TAGS + SAVED_RECAPS
-- ============================================================

CREATE POLICY recap_entries_select ON recap_entries
  FOR SELECT USING (is_team_member(team_id));

CREATE POLICY recap_entries_insert ON recap_entries
  FOR INSERT WITH CHECK (is_team_member(team_id));

CREATE POLICY recap_entries_update ON recap_entries
  FOR UPDATE USING (is_team_member(team_id));

CREATE POLICY recap_entries_delete ON recap_entries
  FOR DELETE USING (is_team_member(team_id));

CREATE POLICY recap_entry_tags_select ON recap_entry_tags
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM recap_entries re
      WHERE re.id = recap_entry_tags.recap_entry_id
        AND is_team_member(re.team_id)
    )
  );

CREATE POLICY recap_entry_tags_insert ON recap_entry_tags
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM recap_entries re
      WHERE re.id = recap_entry_id
        AND is_team_member(re.team_id)
    )
  );

CREATE POLICY recap_entry_tags_delete ON recap_entry_tags
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM recap_entries re
      WHERE re.id = recap_entry_tags.recap_entry_id
        AND is_team_member(re.team_id)
    )
  );

CREATE POLICY saved_recaps_select ON saved_recaps
  FOR SELECT USING (is_team_member(team_id));

CREATE POLICY saved_recaps_insert ON saved_recaps
  FOR INSERT WITH CHECK (is_team_member(team_id));

CREATE POLICY saved_recaps_delete ON saved_recaps
  FOR DELETE USING (is_team_member(team_id));

-- ============================================================
-- USER_PREFERENCES (own data only)
-- ============================================================

CREATE POLICY user_prefs_select ON user_preferences
  FOR SELECT USING (user_id = auth.uid());

CREATE POLICY user_prefs_insert ON user_preferences
  FOR INSERT WITH CHECK (user_id = auth.uid());

CREATE POLICY user_prefs_update ON user_preferences
  FOR UPDATE USING (user_id = auth.uid());
