-- ============================================================
-- 010: Project-scoped invite codes
--
-- Adds project_id to team_invitations so invite codes can
-- grant access to a specific project (not just the team).
-- Updates accept_invitation_by_code to also insert into
-- project_members when a project_id is present.
-- ============================================================

-- Add project_id column (nullable — team-level invites won't have one)
ALTER TABLE team_invitations ADD COLUMN IF NOT EXISTS project_id UUID REFERENCES projects(id) ON DELETE CASCADE;

-- ============================================================
-- Update: accept_invitation_by_code
-- Now also adds the user to project_members if project_id is set
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

  -- Check if already a team member
  IF NOT EXISTS (SELECT 1 FROM team_members WHERE team_id = _inv.team_id AND user_id = auth.uid()) THEN
    -- Add to team
    INSERT INTO public.team_members (team_id, user_id, role)
    VALUES (_inv.team_id, auth.uid(), _inv.role);

    -- Create user preferences for this team
    INSERT INTO public.user_preferences (user_id, team_id)
    VALUES (auth.uid(), _inv.team_id)
    ON CONFLICT (user_id, team_id) DO NOTHING;
  END IF;

  -- Add to specific project if project_id is set
  IF _inv.project_id IS NOT NULL THEN
    INSERT INTO public.project_members (project_id, user_id, role, added_by)
    VALUES (_inv.project_id, auth.uid(), 'editor', _inv.invited_by)
    ON CONFLICT (project_id, user_id) DO NOTHING;
  END IF;

  -- Mark invitation accepted
  UPDATE team_invitations SET status = 'accepted', accepted_at = now() WHERE id = _inv.id;

  RETURN jsonb_build_object(
    'success', true,
    'team_id', _inv.team_id,
    'project_id', _inv.project_id
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
