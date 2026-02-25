-- ============================================================
-- 011: Backfill project owners + allow owners to add themselves
--
-- 1. Updates project_members INSERT policy to also allow
--    team members to add themselves (not just admins).
-- 2. Backfills: for every project with zero project_members rows,
--    adds the team owner as project admin.
-- ============================================================

-- Allow team members to add themselves to a project
DROP POLICY IF EXISTS project_members_insert ON project_members;
CREATE POLICY project_members_insert ON project_members
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = project_id
        AND (
          is_team_admin(p.team_id)
          OR (user_id = auth.uid() AND is_team_member(p.team_id))
        )
    )
  );

-- Backfill: for each project with no members, insert the team owner
DO $$
DECLARE
  _proj RECORD;
  _owner_id UUID;
BEGIN
  FOR _proj IN
    SELECT p.id, p.team_id
    FROM public.projects p
    WHERE p.is_inbox = false
      AND NOT EXISTS (
        SELECT 1 FROM public.project_members pm WHERE pm.project_id = p.id
      )
  LOOP
    -- Find team owner (or first admin)
    SELECT tm.user_id INTO _owner_id
    FROM public.team_members tm
    WHERE tm.team_id = _proj.team_id
      AND tm.role IN ('owner', 'admin')
    ORDER BY CASE tm.role WHEN 'owner' THEN 0 ELSE 1 END
    LIMIT 1;

    -- Fallback: first team member
    IF _owner_id IS NULL THEN
      SELECT tm.user_id INTO _owner_id
      FROM public.team_members tm
      WHERE tm.team_id = _proj.team_id
      LIMIT 1;
    END IF;

    IF _owner_id IS NOT NULL THEN
      INSERT INTO public.project_members (project_id, user_id, role, added_by)
      VALUES (_proj.id, _owner_id, 'admin', _owner_id)
      ON CONFLICT (project_id, user_id) DO NOTHING;
    END IF;
  END LOOP;
END $$;
