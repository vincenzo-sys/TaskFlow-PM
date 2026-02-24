-- ============================================================
-- 005: Team invitations
--
-- Allows team owners/admins to invite users by email.
-- When an invited user signs up (or already has an account),
-- they can accept the invitation to join the team.
-- ============================================================

CREATE TABLE team_invitations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  invited_by UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  role team_role NOT NULL DEFAULT 'member',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined', 'expired')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '7 days'),
  accepted_at TIMESTAMPTZ
);

CREATE INDEX team_invitations_email ON team_invitations(email, status);
CREATE INDEX team_invitations_team ON team_invitations(team_id, status);
CREATE UNIQUE INDEX team_invitations_unique_pending ON team_invitations(team_id, email) WHERE status = 'pending';

-- RLS
ALTER TABLE team_invitations ENABLE ROW LEVEL SECURITY;

-- Team members can see invitations for their team
CREATE POLICY invitations_select ON team_invitations
  FOR SELECT USING (
    is_team_member(team_id)
    OR email = (SELECT email FROM auth.users WHERE id = auth.uid())
  );

-- Only admins/owners can create invitations
CREATE POLICY invitations_insert ON team_invitations
  FOR INSERT WITH CHECK (is_team_admin(team_id));

-- Admins can update (cancel), or the invited user can accept/decline
CREATE POLICY invitations_update ON team_invitations
  FOR UPDATE USING (
    is_team_admin(team_id)
    OR email = (SELECT email FROM auth.users WHERE id = auth.uid())
  );

CREATE POLICY invitations_delete ON team_invitations
  FOR DELETE USING (is_team_admin(team_id));

-- ============================================================
-- Function: accept invitation
-- Called by the invited user to join the team
-- ============================================================

CREATE OR REPLACE FUNCTION accept_invitation(invitation_id UUID)
RETURNS JSONB AS $$
DECLARE
  _inv team_invitations%ROWTYPE;
  _user_email TEXT;
BEGIN
  -- Get the current user's email
  SELECT email INTO _user_email FROM auth.users WHERE id = auth.uid();

  -- Get the invitation
  SELECT * INTO _inv FROM team_invitations WHERE id = invitation_id;

  IF _inv IS NULL THEN
    RETURN jsonb_build_object('error', 'Invitation not found');
  END IF;

  IF _inv.email != _user_email THEN
    RETURN jsonb_build_object('error', 'This invitation is for a different email');
  END IF;

  IF _inv.status != 'pending' THEN
    RETURN jsonb_build_object('error', 'Invitation is no longer pending');
  END IF;

  IF _inv.expires_at < now() THEN
    UPDATE team_invitations SET status = 'expired' WHERE id = invitation_id;
    RETURN jsonb_build_object('error', 'Invitation has expired');
  END IF;

  -- Check if already a member
  IF EXISTS (SELECT 1 FROM team_members WHERE team_id = _inv.team_id AND user_id = auth.uid()) THEN
    UPDATE team_invitations SET status = 'accepted', accepted_at = now() WHERE id = invitation_id;
    RETURN jsonb_build_object('success', true, 'message', 'Already a team member');
  END IF;

  -- Add to team
  INSERT INTO public.team_members (team_id, user_id, role)
  VALUES (_inv.team_id, auth.uid(), _inv.role);

  -- Create user preferences for this team
  INSERT INTO public.user_preferences (user_id, team_id)
  VALUES (auth.uid(), _inv.team_id)
  ON CONFLICT (user_id, team_id) DO NOTHING;

  -- Mark invitation accepted
  UPDATE team_invitations SET status = 'accepted', accepted_at = now() WHERE id = invitation_id;

  RETURN jsonb_build_object('success', true, 'team_id', _inv.team_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ============================================================
-- Function: check pending invitations on login
-- Returns any pending invitations for the current user's email
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
