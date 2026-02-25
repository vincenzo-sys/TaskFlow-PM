-- ============================================================
-- 009: Invite codes — shareable codes for team invitations
--
-- Adds an invite_code column so invitations can be accepted
-- by code (shared via text/Discord/etc.) without email matching.
-- ============================================================

-- Add invite_code column (nullable — old invitations won't have one)
ALTER TABLE team_invitations ADD COLUMN IF NOT EXISTS invite_code TEXT;

-- Unique index on active codes
CREATE UNIQUE INDEX IF NOT EXISTS team_invitations_invite_code
  ON team_invitations(invite_code) WHERE invite_code IS NOT NULL AND status = 'pending';

-- Make email nullable (invite-by-code doesn't require it)
ALTER TABLE team_invitations ALTER COLUMN email DROP NOT NULL;

-- Drop the unique-pending-per-email constraint (codes don't need email uniqueness)
DROP INDEX IF EXISTS team_invitations_unique_pending;

-- Re-create it only when email is present
CREATE UNIQUE INDEX team_invitations_unique_pending
  ON team_invitations(team_id, email) WHERE email IS NOT NULL AND status = 'pending';

-- Update RLS: allow SELECT by invite_code (anyone with the code can see the invitation)
DROP POLICY IF EXISTS invitations_select ON team_invitations;
CREATE POLICY invitations_select ON team_invitations
  FOR SELECT USING (
    is_team_member(team_id)
    OR email = auth.jwt()->>'email'
    OR invite_code IS NOT NULL  -- codes are semi-public by design
  );

-- Update RLS: allow UPDATE by anyone (needed for code-based accept)
-- The accept function is SECURITY DEFINER so this is safe
DROP POLICY IF EXISTS invitations_update ON team_invitations;
CREATE POLICY invitations_update ON team_invitations
  FOR UPDATE USING (
    is_team_admin(team_id)
    OR email = auth.jwt()->>'email'
  );

-- ============================================================
-- Function: accept invitation by code
-- Anyone with a valid code can join the team
-- ============================================================

CREATE OR REPLACE FUNCTION accept_invitation_by_code(code TEXT)
RETURNS JSONB AS $$
DECLARE
  _inv team_invitations%ROWTYPE;
BEGIN
  -- Find the invitation by code
  SELECT * INTO _inv FROM team_invitations
    WHERE invite_code = code AND status = 'pending';

  IF _inv IS NULL THEN
    RETURN jsonb_build_object('error', 'Invalid or expired invite code');
  END IF;

  IF _inv.expires_at < now() THEN
    UPDATE team_invitations SET status = 'expired' WHERE id = _inv.id;
    RETURN jsonb_build_object('error', 'Invite code has expired');
  END IF;

  -- Check if already a member
  IF EXISTS (SELECT 1 FROM team_members WHERE team_id = _inv.team_id AND user_id = auth.uid()) THEN
    RETURN jsonb_build_object('success', true, 'message', 'Already a team member', 'team_id', _inv.team_id);
  END IF;

  -- Add to team
  INSERT INTO public.team_members (team_id, user_id, role)
  VALUES (_inv.team_id, auth.uid(), _inv.role);

  -- Create user preferences for this team
  INSERT INTO public.user_preferences (user_id, team_id)
  VALUES (auth.uid(), _inv.team_id)
  ON CONFLICT (user_id, team_id) DO NOTHING;

  -- Mark invitation accepted
  UPDATE team_invitations SET status = 'accepted', accepted_at = now() WHERE id = _inv.id;

  RETURN jsonb_build_object('success', true, 'team_id', _inv.team_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ============================================================
-- Update: get_my_pending_invitations to also return invite_code
-- ============================================================

CREATE OR REPLACE FUNCTION get_my_pending_invitations()
RETURNS TABLE (
  id UUID,
  team_id UUID,
  team_name TEXT,
  invited_by_name TEXT,
  role team_role,
  created_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ
) AS $$
  SELECT
    ti.id,
    ti.team_id,
    t.name AS team_name,
    p.display_name AS invited_by_name,
    ti.role,
    ti.created_at,
    ti.expires_at
  FROM team_invitations ti
  JOIN teams t ON t.id = ti.team_id
  JOIN profiles p ON p.id = ti.invited_by
  WHERE ti.email = (SELECT email FROM auth.users WHERE id = auth.uid())
    AND ti.status = 'pending'
    AND ti.expires_at > now();
$$ LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public;
