-- ============================================================
-- 007: Per-project member permissions
--
-- Adds a project_members table so individual projects can be
-- shared with specific team members. Replaces the blanket
-- is_team_member() check on project-dependent tables with
-- is_project_visible(), which supports:
--   1. Inbox projects: visible to all team members
--   2. Team admins/owners: see everything
--   3. Explicit project_members rows: per-project access
--   4. Projects with zero rows in project_members: visible
--      to all team members (backward-compatible default)
-- ============================================================

-- ============================================================
-- 1. CREATE project_members TABLE
-- ============================================================

CREATE TABLE project_members (
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'editor' CHECK (role IN ('admin', 'editor', 'viewer')),
  added_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  added_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  PRIMARY KEY (project_id, user_id)
);

CREATE INDEX project_members_user_id ON project_members(user_id);

ALTER TABLE project_members ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- 2. HELPER FUNCTION: is_project_visible
-- ============================================================

CREATE OR REPLACE FUNCTION is_project_visible(check_project_id UUID)
RETURNS BOOLEAN AS $$
DECLARE
  _team_id UUID;
  _is_inbox BOOLEAN;
BEGIN
  -- Get the project team_id and is_inbox flag
  SELECT p.team_id, p.is_inbox
    INTO _team_id, _is_inbox
    FROM public.projects p
   WHERE p.id = check_project_id;

  -- Project not found
  IF _team_id IS NULL THEN
    RETURN false;
  END IF;

  -- Inbox projects are visible to all team members
  IF _is_inbox = true THEN
    RETURN EXISTS (
      SELECT 1 FROM public.team_members
      WHERE team_id = _team_id
        AND user_id = auth.uid()
    );
  END IF;

  -- Team admins/owners can see all projects
  IF EXISTS (
    SELECT 1 FROM public.team_members
    WHERE team_id = _team_id
      AND user_id = auth.uid()
      AND role IN ('owner', 'admin')
  ) THEN
    RETURN true;
  END IF;

  -- User is explicitly in project_members
  IF EXISTS (
    SELECT 1 FROM public.project_members
    WHERE project_id = check_project_id
      AND user_id = auth.uid()
  ) THEN
    RETURN true;
  END IF;

  -- Fallback: if project has NO rows in project_members, it is
  -- visible to all team members (zero-disruption for existing projects)
  IF NOT EXISTS (
    SELECT 1 FROM public.project_members
    WHERE project_id = check_project_id
  ) THEN
    RETURN EXISTS (
      SELECT 1 FROM public.team_members
      WHERE team_id = _team_id
        AND user_id = auth.uid()
    );
  END IF;

  -- Otherwise, not visible
  RETURN false;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public;

-- ============================================================
-- 3. RLS POLICIES for project_members
-- ============================================================

-- Anyone who can see the project can see its members
CREATE POLICY project_members_select ON project_members
  FOR SELECT USING (is_project_visible(project_id));

-- Team admins can add members to any project in their team
CREATE POLICY project_members_insert ON project_members
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = project_id
        AND is_team_admin(p.team_id)
    )
  );

-- Team admins can update member roles
CREATE POLICY project_members_update ON project_members
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = project_members.project_id
        AND is_team_admin(p.team_id)
    )
  );

-- Team admins can remove members; users can remove themselves
CREATE POLICY project_members_delete ON project_members
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = project_members.project_id
        AND is_team_admin(p.team_id)
    )
    OR user_id = auth.uid()
  );

-- ============================================================
-- 4. REPLACE project-scoped SELECT policies with is_project_visible()
--
-- Only SELECT policies are upgraded — INSERT/UPDATE/DELETE
-- keep the original team-level checks for now. This makes
-- project visibility per-member while keeping write access
-- broad (any team member who can see a project can edit it).
-- Viewer/editor role enforcement can be added later.
-- ============================================================

-- ---- projects ------------------------------------------------
DROP POLICY IF EXISTS projects_select ON projects;
CREATE POLICY projects_select ON projects
  FOR SELECT USING (is_project_visible(id));

-- ---- tasks ---------------------------------------------------
DROP POLICY IF EXISTS tasks_select ON tasks;
CREATE POLICY tasks_select ON tasks
  FOR SELECT USING (is_project_visible(project_id));

DROP POLICY IF EXISTS tasks_insert ON tasks;
CREATE POLICY tasks_insert ON tasks
  FOR INSERT WITH CHECK (is_project_visible(project_id));

DROP POLICY IF EXISTS tasks_update ON tasks;
CREATE POLICY tasks_update ON tasks
  FOR UPDATE USING (is_project_visible(project_id));

DROP POLICY IF EXISTS tasks_delete ON tasks;
CREATE POLICY tasks_delete ON tasks
  FOR DELETE USING (is_project_visible(project_id));

-- ---- task_tags -----------------------------------------------
DROP POLICY IF EXISTS task_tags_select ON task_tags;
CREATE POLICY task_tags_select ON task_tags
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.tasks t WHERE t.id = task_tags.task_id AND is_project_visible(t.project_id))
  );

DROP POLICY IF EXISTS task_tags_insert ON task_tags;
CREATE POLICY task_tags_insert ON task_tags
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM public.tasks t WHERE t.id = task_id AND is_project_visible(t.project_id))
  );

DROP POLICY IF EXISTS task_tags_delete ON task_tags;
CREATE POLICY task_tags_delete ON task_tags
  FOR DELETE USING (
    EXISTS (SELECT 1 FROM public.tasks t WHERE t.id = task_tags.task_id AND is_project_visible(t.project_id))
  );

-- ---- task_dependencies ---------------------------------------
DROP POLICY IF EXISTS task_deps_select ON task_dependencies;
CREATE POLICY task_deps_select ON task_dependencies
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.tasks t WHERE t.id = task_dependencies.blocked_task_id AND is_project_visible(t.project_id))
  );

DROP POLICY IF EXISTS task_deps_insert ON task_dependencies;
CREATE POLICY task_deps_insert ON task_dependencies
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM public.tasks t WHERE t.id = blocked_task_id AND is_project_visible(t.project_id))
  );

DROP POLICY IF EXISTS task_deps_delete ON task_dependencies;
CREATE POLICY task_deps_delete ON task_dependencies
  FOR DELETE USING (
    EXISTS (SELECT 1 FROM public.tasks t WHERE t.id = task_dependencies.blocked_task_id AND is_project_visible(t.project_id))
  );

-- ---- blocker_info --------------------------------------------
DROP POLICY IF EXISTS blocker_info_select ON blocker_info;
CREATE POLICY blocker_info_select ON blocker_info
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.tasks t WHERE t.id = blocker_info.task_id AND is_project_visible(t.project_id))
  );

DROP POLICY IF EXISTS blocker_info_insert ON blocker_info;
CREATE POLICY blocker_info_insert ON blocker_info
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM public.tasks t WHERE t.id = task_id AND is_project_visible(t.project_id))
  );

DROP POLICY IF EXISTS blocker_info_update ON blocker_info;
CREATE POLICY blocker_info_update ON blocker_info
  FOR UPDATE USING (
    EXISTS (SELECT 1 FROM public.tasks t WHERE t.id = blocker_info.task_id AND is_project_visible(t.project_id))
  );

DROP POLICY IF EXISTS blocker_info_delete ON blocker_info;
CREATE POLICY blocker_info_delete ON blocker_info
  FOR DELETE USING (
    EXISTS (SELECT 1 FROM public.tasks t WHERE t.id = blocker_info.task_id AND is_project_visible(t.project_id))
  );

-- ---- blocker_notes -------------------------------------------
DROP POLICY IF EXISTS blocker_notes_select ON blocker_notes;
CREATE POLICY blocker_notes_select ON blocker_notes
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.blocker_info bi
      JOIN public.tasks t ON t.id = bi.task_id
      WHERE bi.id = blocker_notes.blocker_info_id
        AND is_project_visible(t.project_id)
    )
  );

DROP POLICY IF EXISTS blocker_notes_insert ON blocker_notes;
CREATE POLICY blocker_notes_insert ON blocker_notes
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.blocker_info bi
      JOIN public.tasks t ON t.id = bi.task_id
      WHERE bi.id = blocker_info_id
        AND is_project_visible(t.project_id)
    )
  );

DROP POLICY IF EXISTS blocker_notes_delete ON blocker_notes;
CREATE POLICY blocker_notes_delete ON blocker_notes
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM public.blocker_info bi
      JOIN public.tasks t ON t.id = bi.task_id
      WHERE bi.id = blocker_notes.blocker_info_id
        AND is_project_visible(t.project_id)
    )
  );

-- ---- time_logs -----------------------------------------------
DROP POLICY IF EXISTS time_logs_select ON time_logs;
CREATE POLICY time_logs_select ON time_logs
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.tasks t WHERE t.id = time_logs.task_id AND is_project_visible(t.project_id))
  );

DROP POLICY IF EXISTS time_logs_insert ON time_logs;
CREATE POLICY time_logs_insert ON time_logs
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM public.tasks t WHERE t.id = task_id AND is_project_visible(t.project_id))
  );

DROP POLICY IF EXISTS time_logs_delete ON time_logs;
CREATE POLICY time_logs_delete ON time_logs
  FOR DELETE USING (
    EXISTS (SELECT 1 FROM public.tasks t WHERE t.id = time_logs.task_id AND is_project_visible(t.project_id))
  );

-- ---- task_learnings ------------------------------------------
DROP POLICY IF EXISTS task_learnings_select ON task_learnings;
CREATE POLICY task_learnings_select ON task_learnings
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.tasks t WHERE t.id = task_learnings.task_id AND is_project_visible(t.project_id))
  );

DROP POLICY IF EXISTS task_learnings_insert ON task_learnings;
CREATE POLICY task_learnings_insert ON task_learnings
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM public.tasks t WHERE t.id = task_id AND is_project_visible(t.project_id))
  );

DROP POLICY IF EXISTS task_learnings_delete ON task_learnings;
CREATE POLICY task_learnings_delete ON task_learnings
  FOR DELETE USING (
    EXISTS (SELECT 1 FROM public.tasks t WHERE t.id = task_learnings.task_id AND is_project_visible(t.project_id))
  );

-- ---- task_files ----------------------------------------------
DROP POLICY IF EXISTS task_files_select ON task_files;
CREATE POLICY task_files_select ON task_files
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.tasks t WHERE t.id = task_files.task_id AND is_project_visible(t.project_id))
  );

DROP POLICY IF EXISTS task_files_insert ON task_files;
CREATE POLICY task_files_insert ON task_files
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM public.tasks t WHERE t.id = task_id AND is_project_visible(t.project_id))
  );

DROP POLICY IF EXISTS task_files_delete ON task_files;
CREATE POLICY task_files_delete ON task_files
  FOR DELETE USING (
    EXISTS (SELECT 1 FROM public.tasks t WHERE t.id = task_files.task_id AND is_project_visible(t.project_id))
  );

-- ---- notebooks -----------------------------------------------
DROP POLICY IF EXISTS notebooks_select ON notebooks;
CREATE POLICY notebooks_select ON notebooks
  FOR SELECT USING (is_project_visible(project_id));

DROP POLICY IF EXISTS notebooks_insert ON notebooks;
CREATE POLICY notebooks_insert ON notebooks
  FOR INSERT WITH CHECK (is_project_visible(project_id));

DROP POLICY IF EXISTS notebooks_update ON notebooks;
CREATE POLICY notebooks_update ON notebooks
  FOR UPDATE USING (is_project_visible(project_id));

DROP POLICY IF EXISTS notebooks_delete ON notebooks;
CREATE POLICY notebooks_delete ON notebooks
  FOR DELETE USING (is_project_visible(project_id));

-- ---- launchers -----------------------------------------------
DROP POLICY IF EXISTS launchers_select ON launchers;
CREATE POLICY launchers_select ON launchers
  FOR SELECT USING (is_project_visible(project_id));

DROP POLICY IF EXISTS launchers_insert ON launchers;
CREATE POLICY launchers_insert ON launchers
  FOR INSERT WITH CHECK (is_project_visible(project_id));

DROP POLICY IF EXISTS launchers_update ON launchers;
CREATE POLICY launchers_update ON launchers
  FOR UPDATE USING (is_project_visible(project_id));

DROP POLICY IF EXISTS launchers_delete ON launchers;
CREATE POLICY launchers_delete ON launchers
  FOR DELETE USING (is_project_visible(project_id));
