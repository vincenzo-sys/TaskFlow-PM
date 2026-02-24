-- Fix invitations RLS policies — replace auth.users reference with JWT claim
-- auth.users is not accessible to authenticated role, causing permission errors

DROP POLICY IF EXISTS invitations_select ON team_invitations;
CREATE POLICY invitations_select ON team_invitations
  FOR SELECT USING (
    is_team_member(team_id)
    OR email = auth.jwt()->>'email'
  );

DROP POLICY IF EXISTS invitations_update ON team_invitations;
CREATE POLICY invitations_update ON team_invitations
  FOR UPDATE USING (
    is_team_admin(team_id)
    OR email = auth.jwt()->>'email'
  );
